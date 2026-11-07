// Turns the Custom Study cloud backup into study-time totals and per-direction
// progress for the dashboard's Overview tab. Read-only: never writes anything.
//
// Study time is estimated from the timestamp of every answer the extension
// saved: answers less than GAP_CAP_MS apart belong to one sitting and the gap
// between them counts as study time; a longer gap starts a new session (you
// walked away), and the first card of each session is credited FIRST_CARD_MS.
// Only answers in Custom Study's extra directions are logged, so WaniKani's
// own reviews are not timed here (WaniKani doesn't share review times).

export const GAP_CAP_MS = 2 * 60 * 1000;
export const FIRST_CARD_MS = 10 * 1000;
export const DIRECTIONS = {
  en_to_jp: "English → Japanese",
  audio_to_en: "Audio → English",
};

export function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

export function summarizeStudy(backup = {}, { timeZone = "UTC" } = {}) {
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone: validTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" });
  const times = (backup.reviewLog ?? [])
    .map((entry) => Date.parse(entry?.timestamp))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const days = {};
  let prev = null, sessions = 0;
  for (const t of times) {
    const key = dayOf.format(t);
    const day = (days[key] ??= { seconds: 0, answers: 0, sessions: 0 });
    let ms;
    if (prev !== null && t - prev <= GAP_CAP_MS) ms = t - prev;
    else { ms = FIRST_CARD_MS; sessions++; day.sessions++; }
    day.seconds += ms / 1000;
    day.answers++;
    prev = t;
  }
  for (const d of Object.values(days)) d.seconds = Math.round(d.seconds);

  const directions = {};
  for (const id of Object.keys(DIRECTIONS)) directions[id] = { label: DIRECTIONS[id], cards: [] };
  for (const [key, record] of Object.entries(backup.srsState ?? {})) {
    const [subjectId, mode] = key.split(":");
    const stage = Number(record?.stage);
    if (!directions[mode] || !Number.isFinite(stage) || stage < 1) continue;
    directions[mode].cards.push([Number(subjectId), stage]);
  }

  return {
    hasData: times.length > 0 || Object.values(directions).some((d) => d.cards.length),
    answerCount: times.length,
    sessionCount: sessions,
    firstAnswerAt: times.length ? new Date(times[0]).toISOString() : null,
    lastAnswerAt: times.length ? new Date(times.at(-1)).toISOString() : null,
    backupUpdatedAt: backup.updatedAt ?? null,
    timeZone: validTimeZone(timeZone),
    days,
    directions,
  };
}
