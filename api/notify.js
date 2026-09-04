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

// Blob is the one dependency that has to answer within the function's budget:
// the notification is not sent until the write lands, so a stalled store means
// a late notification rather than a repeated one.
const BLOB_TIMEOUT_MS = 10000;

// An absent blob and an unreadable one are deliberately not the same thing.
// Absent is the normal first run: the engine reads it as "nothing announced
// yet" and re-announces the queue rather than swallowing it, which is the safe
// direction to fail in. A read that *errors* is not safe to treat that way —
// while the failure lasted, every ping would see a fresh queue and announce it
// again — so that propagates and the run makes no decision at all.
async function loadState() {
  const result = await get(STATE_BLOB, {
    access: "private",
    abortSignal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
  });
  if (result?.statusCode === 200 && result.stream) {
    return await new Response(result.stream).json();
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

    // Writes are funnelled through here so the engine can commit a notification
    // before sending it, and so the quiet-run write at the end doesn't repeat
    // one the engine already made. Identical writes are skipped: this runs
    // ~1440 times a day and almost all of them decide nothing has changed.
    let persistedJson = JSON.stringify(before);
    const persist = async (next) => {
      const json = JSON.stringify(next);
      if (dryRun || json === persistedJson) return;
      await put(STATE_BLOB, json, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        abortSignal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
      });
      persistedJson = json;
    };

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
        persist,
      });

    for (const n of notes) console.log(`note: ${n}`);
    console.log(log);

    // Persist even when staying quiet, so a baseline that followed a shrinking
    // queue down isn't re-raised by the next ping. A run that notified has
    // already written through persist(), so this is a no-op there.
    await persist(state);

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
