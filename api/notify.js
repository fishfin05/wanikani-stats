// Pinged every minute by cron-job.org. Notification decisions live in engine.js.
import { put, get } from "@vercel/blob";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runNotifier, normalizeState } from "../notify/engine.js";

// SDK 2.5.0 otherwise retries transient PUT failures up to ten times. This
// setting is local to this function's process; no environment file is changed.
process.env.VERCEL_BLOB_RETRIES = "0";

const STATE_BLOB = "wk-notify-state.json";
const BLOB_TIMEOUT_MS = 10000;
const RETRY_AFTER_MS = 60000;
const stateJson = (state) => JSON.stringify(normalizeState(state));

export function createHandler({
  blobGet = get,
  blobPut = put,
  run = runNotifier,
  env = process.env,
  clock = Date.now,
  logger = console,
  readConfig = () => JSON.parse(readFileSync(join(process.cwd(), "notify", "config.json"), "utf8")),
} = {}) {
  // Cache only committed state. Revalidate its ETag with GET on every ping:
  // another Vercel instance may have sent a notification since our last run.
  let cached = null;
  let retryAt = 0;
  let busy = false;

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const soft = (status, extra = {}) => res.status(200).json({
      ok: false, sent: false, status, ...extra,
    });
    // Public deployment check: never reads state or contacts WaniKani/ntfy.
    if (req.method === "GET" && req.query?.health === "1") {
      return res.status(200).json({ ok: true, status: "ready", mode: "health" });
    }
    const secret = env.CRON_SECRET;
    if (!secret) return soft("configuration_error", { error: "CRON_SECRET not configured" });
    const supplied = req.headers.authorization?.replace(/^Bearer /, "") ?? req.query?.key ?? null;
    if (supplied !== secret) return res.status(401).json({ error: "Unauthorized" });

    const sanitize = (v) => v?.replace(/^\uFEFF/, "").trim() || null;
    const apiKey = sanitize(env.WANIKANI_API_KEY);
    const topic = sanitize(env.NTFY_TOPIC);
    if (!apiKey || !topic || !env.BLOB_READ_WRITE_TOKEN) {
      logger.error("notify status=configuration_error");
      return soft("configuration_error", { error: "Required notifier configuration is missing" });
    }
    if (clock() < retryAt) return soft("storage_backoff", {
      retryAfterSeconds: Math.ceil((retryAt - clock()) / 1000),
    });
    if (busy) return soft("busy");

    const dryRun = req.query?.dry === "1";
    const force = req.query?.force === "1";
    let storageOperation = false;
    busy = true;
    try {
      storageOperation = true;
      const loaded = await blobGet(STATE_BLOB, {
        access: "private",
        ...(cached?.etag ? { ifNoneMatch: cached.etag } : {}),
        abortSignal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
      });
      let before;
      let etag;
      if (loaded?.statusCode === 304 && cached) {
        before = JSON.parse(cached.json);
        etag = cached.etag;
      } else if (loaded?.statusCode === 200 && loaded.stream) {
        before = await new Response(loaded.stream).json();
        etag = loaded.blob?.etag;
        cached = { json: stateJson(before), etag };
      } else if (loaded === null) {
        before = null;
        cached = null;
      } else {
        throw new Error("Unexpected Blob response");
      }
      storageOperation = false;

      let persistedJson = stateJson(before);
      const persist = async (next) => {
        const json = stateJson(next);
        if (dryRun || json === persistedJson) return;
        storageOperation = true;
        const written = await blobPut(STATE_BLOB, json, {
          access: "private",
          addRandomSuffix: false,
          // Never overwrite a concurrent notification; a conflict is a soft
          // failure, with no retry. GET already supplied the ETag; no HEAD.
          allowOverwrite: before !== null,
          ...(etag ? { ifMatch: etag } : {}),
          abortSignal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
        });
        persistedJson = json;
        before = JSON.parse(json);
        etag = written?.etag;
        cached = { json, etag };
        storageOperation = false;
      };

      const { state, sent, verdict, notes, log, summary, unannounced, lessonsToday } = await run({
        apiKey, topic, server: sanitize(env.NTFY_SERVER), config: readConfig(),
        state: before, dryRun, force, persist,
      });
      // The engine commits before sending. This only writes a quiet run when
      // its baseline actually fell; the post-send call is an identical no-op.
      await persist(state);
      for (const note of notes) logger.log(`note: ${note}`);
      logger.log(log);
      return res.status(200).json({
        ok: true, sent, verdict, reviews: summary.reviews, unannounced,
        lessonsToday, nextReviewAt: summary.nextReviewAt, notes,
      });
    } catch {
      // Do not log raw SDK/fetch errors: they can include credential URLs.
      const status = storageOperation ? "storage_unavailable" : "run_failed";
      if (storageOperation) {
        cached = null;
        retryAt = clock() + RETRY_AFTER_MS;
      }
      logger.error(`notify status=${status}`);
      return soft(status, storageOperation ? { retryAfterSeconds: RETRY_AFTER_MS / 1000 } : {});
    } finally {
      busy = false;
    }
  };
}

export default createHandler();
