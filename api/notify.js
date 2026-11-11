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
const CHECKPOINT_MS = 30 * 60000;
const VERSION = "1.1.2";
const stateJson = (state) => JSON.stringify(normalizeState(state));
const stampsJson = (state) => JSON.stringify([
  state.lastBatchNotifyAt, state.lastReviewNotifyAt, state.lastLessonNotifyAt,
]);

export function createHandler({
  blobGet = get,
  blobPut = put,
  run = runNotifier,
  env = process.env,
  clock = Date.now,
  logger = console,
  readConfig = () => JSON.parse(readFileSync(join(process.cwd(), "notify", "config.json"), "utf8")),
} = {}) {
  // live is authoritative between pings, including unsaved queue decreases.
  // Revalidate the committed ETag without discarding that in-memory drift.
  let cached = null;
  let retryAt = 0;
  let busy = false;
  let hasLiveDecision = false;
  let shutdownAttempted = false;

  const handler = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const soft = (status, extra = {}) => res.status(200).json({
      ok: false, sent: false, status, ...extra,
    });
    // Public deployment check: never reads state or contacts WaniKani/ntfy.
    if (req.method === "GET" && req.query?.health === "1") {
      return res.status(200).json({ ok: true, status: "ready", mode: "health", version: VERSION });
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
      let remote;
      let etag = cached?.etag;
      if (loaded?.statusCode === 304 && cached) {
        remote = JSON.parse(cached.persistedJson);
      } else if (loaded?.statusCode === 200 && loaded.stream) {
        remote = normalizeState(await new Response(loaded.stream).json());
        etag = loaded.blob?.etag;
      } else if (loaded === null) {
        remote = normalizeState(null);
        etag = undefined;
      } else {
        throw new Error("Unexpected Blob response");
      }
      const remoteJson = stateJson(remote);
      if (!cached) {
        cached = {
          live: normalizeState(remote), persistedJson: remoteJson, etag,
          exists: loaded !== null, lastWriteAt: clock(),
        };
        // A cold start cannot know which queue decreases were lost. Recover
        // conservatively: at most one repeat after the saved cooldown/DND,
        // rather than letting a stale high baseline swallow a small new batch.
        // Notification stamps themselves are always committed immediately.
        cached.live.announcedReviewCount = 0;
      } else if (remoteJson !== cached.persistedJson) {
        if (stampsJson(remote) !== stampsJson(cached.live)) {
          cached.live = normalizeState(remote);
        } else {
          // Another instance checkpointed drift; retain the lower observation.
          cached.live.announcedReviewCount = Math.min(
            cached.live.announcedReviewCount, remote.announcedReviewCount,
          );
        }
        cached.persistedJson = remoteJson;
        cached.lastWriteAt = clock();
      }
      cached.etag = etag;
      cached.exists = loaded !== null;
      storageOperation = false;

      const save = async (next, immediate) => {
        const json = stateJson(next);
        if (dryRun) return;
        hasLiveDecision = true;
        immediate ||= stampsJson(next) !== stampsJson(JSON.parse(cached.persistedJson));
        if (!immediate || json === cached.persistedJson) cached.live = normalizeState(next);
        if (json === cached.persistedJson) return;
        if (!immediate && clock() - cached.lastWriteAt < CHECKPOINT_MS) return;
        storageOperation = true;
        const written = await blobPut(STATE_BLOB, json, {
          access: "private",
          addRandomSuffix: false,
          // Never overwrite a concurrent notification; a conflict is a soft
          // failure, with no retry. GET already supplied the ETag; no HEAD.
          allowOverwrite: cached.exists,
          ...(cached.etag ? { ifMatch: cached.etag } : {}),
          abortSignal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
        });
        cached.live = normalizeState(next);
        cached.persistedJson = json;
        cached.lastWriteAt = clock();
        cached.etag = written?.etag;
        cached.exists = true;
        storageOperation = false;
      };

      const { state, sent, verdict, notes, log, summary, unannounced, lessonsToday } = await run({
        apiKey, topic, server: sanitize(env.NTFY_SERVER), config: readConfig(),
        state: normalizeState(cached.live), dryRun, force,
        // Engine calls this only for notification commits and their rollbacks.
        persist: (next) => save(next, true),
      });
      // Quiet drift stays in memory and checkpoints at most every 30 minutes.
      // A notification's immediate save also resets the checkpoint clock.
      await save(state, false);
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
        retryAt = clock() + RETRY_AFTER_MS;
      }
      logger.error(`notify status=${status}`);
      return soft(status, storageOperation ? { retryAfterSeconds: RETRY_AFTER_MS / 1000 } : {});
    } finally {
      busy = false;
    }
  };
  // Vercel gives SIGTERM cleanup only 500 ms. Attempt one conditional, bounded
  // checkpoint only while idle; correctness never depends on this completing.
  // No hook on beforeExit: that event is not a reliable serverless shutdown.
  handler.flushBeforeExit = async () => {
    if (shutdownAttempted || busy || clock() < retryAt || !hasLiveDecision || !cached) return;
    shutdownAttempted = true;
    const json = stateJson(cached.live);
    if (json === cached.persistedJson) return;
    busy = true;
    try {
      const written = await blobPut(STATE_BLOB, json, {
        access: "private", addRandomSuffix: false, allowOverwrite: cached.exists,
        ...(cached.etag ? { ifMatch: cached.etag } : {}),
        abortSignal: AbortSignal.timeout(400),
      });
      cached.persistedJson = json;
      cached.etag = written?.etag;
      cached.lastWriteAt = clock();
      cached.exists = true;
    } catch {
      logger.error("notify status=shutdown_checkpoint_failed");
    } finally {
      busy = false;
    }
  };
  return handler;
}

const handler = createHandler();
process.on("SIGTERM", () => { void handler.flushBeforeExit(); });
export default handler;
