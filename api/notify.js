// The live review notifier, pinged from outside every minute.
//
// This exists because GitHub Actions' scheduler was dropping roughly five of
// every six runs, which turned "tell me when a batch lands" into "tell me
// sometime in the next couple of hours". Vercel's own cron is once-a-day on
// Hobby, so the schedule comes from an external pinger (cron-job.org) hitting
// this endpoint; all it needs to do is be cheap and idempotent enough to call
// constantly.
//
// Env: WANIKANI_API_KEY, NTFY_TOPIC, CRON_SECRET (all required),
//      NTFY_SERVER (optional, defaults to https://ntfy.sh)

import { put, get } from "@vercel/blob";
import { readFileSync } from "fs";
import { join } from "path";
import { runNotifier } from "../notify/engine.js";

const STATE_BLOB = "wk-notify-state.json";

async function loadState() {
  try {
    const result = await get(STATE_BLOB, { access: "private" });
    if (result?.statusCode === 200 && result.stream) {
      return await new Response(result.stream).json();
    }
  } catch (e) {
    // A missing blob is the normal first-run case. The engine reads absent
    // state as "nothing announced yet", so the queue gets re-announced rather
    // than swallowed — the safe direction to fail in.
    console.warn("Could not load notifier state:", e.message);
  }
  return null;
}

export default async function handler(req, res) {
  // The pinger is a public URL being hit every minute, so the secret is the
  // only thing standing between a stranger and the ability to spam the phone.
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const supplied =
    req.headers.authorization?.replace(/^Bearer /, "") ?? req.query?.key ?? null;
  if (supplied !== secret) return res.status(401).json({ error: "Unauthorized" });

  const sanitize = (v) => v?.replace(/^﻿/, "").trim() || null;
  const apiKey = sanitize(process.env.WANIKANI_API_KEY);
  const topic = sanitize(process.env.NTFY_TOPIC);
  if (!apiKey) return res.status(500).json({ error: "WANIKANI_API_KEY not configured" });
  if (!topic) return res.status(500).json({ error: "NTFY_TOPIC not configured" });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: "Vercel Blob storage not configured" });
  }

  // Query flags mirror the CLI's, for testing the live endpoint without
  // actually buzzing the phone or waiting out a cooldown.
  const dryRun = req.query?.dry === "1";
  const force = req.query?.force === "1";

  try {
    const before = await loadState();
    const { state, sent, verdict, notes, log, summary, unannounced, lessonsToday } =
      await runNotifier({
        apiKey,
        topic,
        server: sanitize(process.env.NTFY_SERVER),
        config: JSON.parse(
          readFileSync(join(process.cwd(), "notify", "config.json"), "utf8")
        ),
        state: before,
        dryRun,
        force,
      });

    for (const n of notes) console.log(`note: ${n}`);
    console.log(log);

    // Persist even when staying quiet, so a baseline that followed a shrinking
    // queue down isn't re-raised by the next ping. Skipping identical writes
    // matters here: this runs ~1440 times a day and almost all of them decide
    // nothing has changed.
    const changed = JSON.stringify(state) !== JSON.stringify(before);
    if (!dryRun && changed) {
      await put(STATE_BLOB, JSON.stringify(state), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    }

    res.status(200).json({
      ok: true,
      sent,
      verdict,
      reviews: summary.reviews,
      unannounced,
      lessonsToday,
      nextReviewAt: summary.nextReviewAt,
      notes,
    });
  } catch (e) {
    console.error("Notify error:", e);
    res.status(500).json({ error: e.message });
  }
}
