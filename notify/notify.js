#!/usr/bin/env node
// WaniKani review/lesson push notifier with do-not-disturb support.
//
// Runs on a dumb every-15-minutes cron (see .github/workflows/notify.yml) and
// decides for itself whether this particular run should actually notify. All
// the "should I bother you right now" logic lives here rather than in the cron
// schedule, because cron can only think in UTC and fixed times — it can't
// handle DST, quiet days, cooldowns, or "only if there's enough waiting".
//
//   node notify/notify.js            # normal run (may send a notification)
//   node notify/notify.js --dry-run  # decide + print, never send
//   node notify/notify.js --force    # ignore DND/cooldown/thresholds, send now
//
// Env: WANIKANI_API_KEY (required), NTFY_TOPIC (required unless --dry-run),
//      NTFY_SERVER (optional, defaults to https://ntfy.sh)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "config.json");
const STATE_PATH = resolve(__dirname, "..", ".notify-state", "state.json");

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

// ── config / state ──────────────────────────────────────────────────────────
function loadConfig() {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  return {
    timezone: cfg.timezone ?? "UTC",
    dnd: cfg.dnd ?? null,
    quietDays: cfg.quietDays ?? [],
    reviewThreshold: cfg.reviewThreshold ?? 10,
    lessonThreshold: cfg.lessonThreshold ?? 3,
    dailyLessonCap: cfg.dailyLessonCap ?? null,
    cooldownMinutes: cfg.cooldownMinutes ?? 180,
    lessonCooldownMinutes: cfg.lessonCooldownMinutes ?? 1200,
    urgentReviewCount: cfg.urgentReviewCount ?? 100,
  };
}

// State only exists to enforce cooldowns. If it's ever lost (cache eviction,
// first run) the worst case is one extra notification, so a missing/corrupt
// file is treated as "no history" rather than a hard error.
function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { lastReviewNotifyAt: null, lastLessonNotifyAt: null };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── local-time helpers ──────────────────────────────────────────────────────
// Everything time-related goes through Intl with an IANA timezone so DST is
// handled by the platform instead of by us guessing UTC offsets.
function localNow(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  // hour12:false yields "24" for midnight on some platforms — normalize to 0.
  const hour = Number(parts.hour) % 24;
  return {
    minutes: hour * 60 + Number(parts.minute),
    weekday: parts.weekday,
    label: `${String(hour).padStart(2, "0")}:${parts.minute}`,
  };
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  // Validate each field separately — checking only the total would let an
  // out-of-range minute silently roll over into a different valid time
  // (e.g. "12:60" reading as 13:00 instead of being rejected as a typo).
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

// A DND window that ends earlier than it starts (22:30 → 08:00) wraps midnight,
// so it's "after start OR before end" rather than a simple between-check.
function inDndWindow(nowMinutes, dnd) {
  if (!dnd) return false;
  const start = parseHHMM(dnd.start);
  const end = parseHHMM(dnd.end);
  if (start === null || end === null || start === end) return false;
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
}

const minutesSince = (iso) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity;

// ── WaniKani ────────────────────────────────────────────────────────────────
async function fetchSummary(apiKey) {
  const res = await fetch("https://api.wanikani.com/v2/summary", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Wanikani-Revision": "20170710",
    },
  });
  if (!res.ok) throw new Error(`WaniKani API ${res.status}: ${await res.text()}`);
  const body = await res.json();

  const now = Date.now();
  const countAvailable = (buckets) =>
    (buckets ?? [])
      .filter((b) => new Date(b.available_at).getTime() <= now)
      .reduce((n, b) => n + b.subject_ids.length, 0);

  // The next bucket that actually contains items — WaniKani includes empty
  // hourly buckets, and next_reviews_at can point at one of them.
  const nextReviewAt =
    (body.data.reviews ?? [])
      .filter((b) => new Date(b.available_at).getTime() > now && b.subject_ids.length > 0)
      .map((b) => b.available_at)
      .sort()[0] ?? null;

  return {
    reviews: countAvailable(body.data.reviews),
    lessons: countAvailable(body.data.lessons),
    nextReviewAt,
  };
}

// ── notification ────────────────────────────────────────────────────────────
async function sendNtfy({ topic, server, title, message, priority, tags }) {
  const res = await fetch(`${server.replace(/\/$/, "")}/${topic}`, {
    method: "POST",
    headers: {
      Title: title,
      Priority: String(priority),
      Tags: tags.join(","),
      Click: "https://www.wanikani.com/dashboard",
    },
    body: message,
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
}

function describeNext(nextReviewAt, timezone) {
  if (!nextReviewAt) return "";
  const mins = Math.round((new Date(nextReviewAt).getTime() - Date.now()) / 60000);
  if (mins <= 0 || mins > 720) return "";
  const when = new Date(nextReviewAt).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  return mins < 60
    ? `\nNext batch in ${mins} min.`
    : `\nNext batch at ${when}.`;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.WANIKANI_API_KEY?.trim();
  if (!apiKey) throw new Error("WANIKANI_API_KEY is not set");

  const topic = process.env.NTFY_TOPIC?.trim();
  const server = process.env.NTFY_SERVER?.trim() || "https://ntfy.sh";
  if (!topic && !DRY_RUN) throw new Error("NTFY_TOPIC is not set");

  const cfg = loadConfig();
  const state = loadState();
  const now = localNow(new Date(), cfg.timezone);
  const summary = await fetchSummary(apiKey);

  // The API only knows the full unlocked lesson backlog; WaniKani's dashboard
  // shows "Today's Lessons", which is that backlog clamped by the web-only
  // "Maximum Recommended Daily Lessons" setting. Notifying on the raw backlog
  // would tell you to do 53 lessons when your dashboard says 5, so the
  // configured cap is applied here to keep the two in agreement.
  const lessonsToday =
    cfg.dailyLessonCap === null
      ? summary.lessons
      : Math.min(summary.lessons, cfg.dailyLessonCap);

  const log = (verdict) =>
    console.log(
      `${now.weekday} ${now.label} ${cfg.timezone} | ` +
        `${summary.reviews} reviews, ${lessonsToday} lessons today ` +
        `(${summary.lessons} unlocked) | ${verdict}`
    );

  if (!FORCE) {
    if (cfg.quietDays.includes(now.weekday)) return log(`skip: quiet day (${now.weekday})`);
    if (inDndWindow(now.minutes, cfg.dnd))
      return log(`skip: DND ${cfg.dnd.start}–${cfg.dnd.end}`);
  }

  // Reviews are the real trigger: they expire in the sense that a growing
  // backlog is what actually hurts. Lessons sit there forever until you do
  // them, so they get a much slower nudge of their own rather than firing
  // every cooldown window and turning into noise.
  const reviewsReady = summary.reviews >= cfg.reviewThreshold;
  const reviewCooled = minutesSince(state.lastReviewNotifyAt) >= cfg.cooldownMinutes;
  const lessonsReady = lessonsToday >= cfg.lessonThreshold;
  const lessonCooled = minutesSince(state.lastLessonNotifyAt) >= cfg.lessonCooldownMinutes;

  // The lesson nudge also waits out the general cooldown, not just its own.
  // Review notifications already include the lesson count, so letting the two
  // cooldowns run independently would fire a redundant second buzz moments
  // after a review ping.
  const lastAnyNotifyAt =
    [state.lastReviewNotifyAt, state.lastLessonNotifyAt].filter(Boolean).sort().at(-1) ?? null;
  const anyCooled = minutesSince(lastAnyNotifyAt) >= cfg.cooldownMinutes;

  let kind = null;
  if (FORCE) kind = "review";
  else if (reviewsReady && reviewCooled) kind = "review";
  else if (lessonsReady && lessonCooled && anyCooled) kind = "lesson";

  if (!kind) {
    if (reviewsReady && !reviewCooled) {
      const wait = Math.ceil(cfg.cooldownMinutes - minutesSince(state.lastReviewNotifyAt));
      return log(`skip: cooldown, ${wait} min left`);
    }
    return log(`skip: below threshold (need ${cfg.reviewThreshold} reviews)`);
  }

  const urgent = summary.reviews >= cfg.urgentReviewCount;
  const backlogNote =
    cfg.dailyLessonCap !== null && summary.lessons > lessonsToday
      ? ` (${summary.lessons} unlocked)`
      : "";
  const payload =
    kind === "review"
      ? {
          title: urgent ? `${summary.reviews} reviews piling up` : `${summary.reviews} reviews ready`,
          message:
            `${summary.reviews} reviews waiting` +
            (lessonsToday ? ` · ${lessonsToday} lessons today${backlogNote}` : "") +
            describeNext(summary.nextReviewAt, cfg.timezone),
          priority: urgent ? 4 : 3,
          tags: urgent ? ["warning", "books"] : ["books"],
        }
      : {
          title: `${lessonsToday} lessons for today`,
          message:
            `${lessonsToday} lessons ready to start${backlogNote}` +
            (summary.reviews ? ` · ${summary.reviews} reviews ready too` : ""),
          priority: 2,
          tags: ["seedling"],
        };

  if (DRY_RUN) return log(`WOULD SEND (${kind}): ${payload.title} — ${payload.message.replace(/\n/g, " ")}`);

  await sendNtfy({ topic, server, ...payload });

  if (kind === "review") state.lastReviewNotifyAt = new Date().toISOString();
  else state.lastLessonNotifyAt = new Date().toISOString();
  saveState(state);

  log(`SENT (${kind}): ${payload.title}`);
}

// Exported for notify/notify.test.js; only auto-run when invoked directly so
// importing the pure helpers doesn't fire a real notification.
export { inDndWindow, parseHHMM, localNow, minutesSince };

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error("notify failed:", e.message);
    process.exit(1);
  });
}
