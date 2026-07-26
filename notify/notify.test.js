// Tests for the do-not-disturb / time logic — the parts that decide whether
// you get woken up, and that are otherwise only observable by waiting around
// until 3am. Run with: node notify/notify.test.js
import { inDndWindow, parseHHMM, localNow, startOfLocalDay } from "./notify.js";

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${actual}, want ${expected}`}`);
}

const at = (h, m = 0) => h * 60 + m;

// ── overnight window (the common case: 22:30 → 08:00) ──────────────────────
const night = { start: "22:30", end: "08:00" };
check("23:00 is quiet",            inDndWindow(at(23), night), true);
check("02:00 is quiet",            inDndWindow(at(2), night), true);
check("07:59 is quiet",            inDndWindow(at(7, 59), night), true);
check("08:00 is awake (end excl)", inDndWindow(at(8), night), false);
check("12:00 is awake",            inDndWindow(at(12), night), false);
check("22:29 is awake",            inDndWindow(at(22, 29), night), false);
check("22:30 is quiet (start inc)", inDndWindow(at(22, 30), night), true);
check("midnight is quiet",         inDndWindow(at(0), night), true);

// ── same-day window (e.g. quiet through the workday) ───────────────────────
const day = { start: "09:00", end: "17:00" };
check("10:00 quiet in day window",  inDndWindow(at(10), day), true);
check("08:00 awake before window",  inDndWindow(at(8), day), false);
check("17:00 awake at window end",  inDndWindow(at(17), day), false);
check("23:00 awake outside window", inDndWindow(at(23), day), false);

// ── disabled / malformed config should never silence notifications ─────────
check("null dnd disables",      inDndWindow(at(3), null), false);
check("equal start/end disables", inDndWindow(at(3), { start: "08:00", end: "08:00" }), false);
check("garbage times disable",  inDndWindow(at(3), { start: "nope", end: "08:00" }), false);
check("missing fields disable", inDndWindow(at(3), {}), false);

// ── time parsing ───────────────────────────────────────────────────────────
check("parse 00:00", parseHHMM("00:00"), 0);
check("parse 8:05",  parseHHMM("8:05"), 485);
check("parse 23:59", parseHHMM("23:59"), 1439);
check("reject 24:00", parseHHMM("24:00"), null);
check("reject 12:60", parseHHMM("12:60"), null);
check("reject empty", parseHHMM(""), null);

// ── timezone conversion, incl. the midnight "24" normalization ─────────────
// 2026-07-26T07:30:00Z is 00:30 Pacific (PDT, UTC-7) — crosses the date line
// and exercises the hour12:false "24" edge case.
const pacificMidnight = localNow(new Date("2026-07-26T07:30:00Z"), "America/Los_Angeles");
check("PDT midnight hour normalized", pacificMidnight.minutes, at(0, 30));
check("PDT midnight is quiet",        inDndWindow(pacificMidnight.minutes, night), true);

// DST correctness: the same UTC instant maps to different local times in
// January (PST, UTC-8) vs July (PDT, UTC-7). Hardcoded offsets would break this.
const winter = localNow(new Date("2026-01-15T16:00:00Z"), "America/Los_Angeles");
const summer = localNow(new Date("2026-07-15T16:00:00Z"), "America/Los_Angeles");
check("PST winter 16:00Z → 08:00", winter.minutes, at(8));
check("PDT summer 16:00Z → 09:00", summer.minutes, at(9));

// ── local-midnight boundary (drives the "lessons done today" count) ────────
// Getting this wrong would count yesterday's lessons against today's cap, so
// both DST offsets are pinned explicitly rather than assumed.
const sod = (iso) => startOfLocalDay(new Date(iso), "America/Los_Angeles").toISOString();
check("PDT evening → 07:00Z midnight", sod("2026-07-25T18:14:00-07:00"), "2026-07-25T07:00:00.000Z");
check("PST evening → 08:00Z midnight", sod("2026-01-15T18:14:00-08:00"), "2026-01-15T08:00:00.000Z");
// Just after local midnight the boundary must be the new day, not the old one.
check("PDT 00:05 local → same day",    sod("2026-07-25T00:05:00-07:00"), "2026-07-25T07:00:00.000Z");
// A UTC instant that has already rolled over while it's still "yesterday" locally.
check("PDT 17:00 (00:00Z next day)",   sod("2026-07-25T17:00:00-07:00"), "2026-07-25T07:00:00.000Z");

console.log(failures ? `\n${failures} test(s) failed` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
