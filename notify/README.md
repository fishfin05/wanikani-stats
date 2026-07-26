# WaniKani review notifier

Pushes a phone notification when new reviews become available, with
do-not-disturb hours.

Three pieces:

| | |
| --- | --- |
| [`engine.js`](./engine.js) | All the "should I bother you right now" logic. Storage- and schedule-agnostic. |
| [`../api/notify.js`](../api/notify.js) | The live notifier. Pinged every minute, keeps state in Vercel Blob. |
| [`notify.js`](./notify.js) | Command-line front end for local testing, keeps state in a file. |

## Phone setup (one time)

1. Install **ntfy** — [iOS](https://apps.apple.com/us/app/ntfy/id1625396347) ·
   [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
2. Tap **+** to subscribe to a topic.
3. Enter the topic name from the `NTFY_TOPIC` env var (also saved locally in
   the gitignored `.notify-topic.txt`).

The topic name is the only thing protecting the channel — ntfy.sh topics are
public to anyone who knows the name. Don't share it; regenerate if leaked.

## Tuning

Everything lives in [`config.json`](./config.json):

| Setting | What it does |
| --- | --- |
| `timezone` | IANA zone for all time logic. DST is handled automatically. |
| `dnd.start` / `dnd.end` | Quiet hours. Wraps midnight (`22:30`→`08:00`). Set both equal to disable. |
| `quietDays` | Weekdays to skip entirely, e.g. `["Sat", "Sun"]`. |
| `notifyOnNewBatch` | Notify every time new reviews become available. The main trigger — set `false` to go back to threshold-only. |
| `newBatchMinSize` | How many reviews have to arrive before it's worth a buzz. `1` = every batch. |
| `newBatchCooldownMinutes` | Minimum gap between batch notifications. |
| `reviewThreshold` | Backstop: minimum reviews waiting before the "you're sitting on a pile" nag fires. |
| `lessonThreshold` | Minimum *today's* lessons before the gentler lesson nudge fires. |
| `dailyLessonCap` | Mirror of WaniKani's **Maximum Recommended Daily Lessons**. See caveat below. |
| `cooldownMinutes` | Minimum gap between notifications. |
| `lessonCooldownMinutes` | Extra-long gap for lesson nudges (they'd otherwise repeat forever). |
| `urgentReviewCount` | Above this, the notification is sent at high priority. |

### When notifications fire

WaniKani releases reviews in batches on the SRS clock, so the thing worth being
told about is the *arrival*, not the total sitting there. Each run compares the
available review count against the previous run's and notifies when it went up.

Three triggers, in priority order:

1. **New batch** — reviews arrived since the last check. Fires however small the
   batch is, subject to `newBatchMinSize` and `newBatchCooldownMinutes`.
2. **Backstop nag** — `reviewThreshold`+ reviews still waiting, no more often
   than `cooldownMinutes`. Catches a pile you were already told about and
   ignored.
3. **Lesson nudge** — the slow one, on `lessonCooldownMinutes`.

Batches arriving during quiet hours accumulate rather than being lost, so the
first run after DND lifts announces everything that landed overnight at once. A
review count that goes *down* means you're working through the queue, which
retires anything pending — you've seen it, so it won't be re-announced.

### The `dailyLessonCap` caveat

WaniKani's **Maximum Recommended Daily Lessons** is a web-app-only setting —
it is not exposed anywhere in API v2. The API's `/summary` endpoint always
reports the *full unlocked backlog* (e.g. 53), not the "Today's Lessons"
number the dashboard shows.

Only the cap itself is configured by hand. Everything else is derived:

```
today's lessons = clamp(cap − lessons completed today, 0, unlocked backlog)
```

Lessons completed today come from assignments whose `started_at` falls after
local midnight, so the number counts down through the day exactly like the
dashboard does rather than going stale.

The one thing to keep in sync manually is `dailyLessonCap` — update it here
whenever you change it in WaniKani.

> The daily reset is assumed to be local midnight in `timezone`. That matches
> observed behaviour, but WaniKani doesn't document it; if your counts drift,
> a rolling 24-hour window is the likely alternative.

## Testing

```bash
export WANIKANI_API_KEY=...   # from .env
export NTFY_TOPIC=...         # from .notify-topic.txt

node notify/notify.js --dry-run   # decide + log, never send
node notify/notify.js --force     # send now, ignoring DND/cooldown/thresholds
node notify/notify.test.js        # DND / timezone / parsing tests
```

The live endpoint takes the same flags as query parameters:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://wanikani-stats.vercel.app/api/notify?dry=1"     # decide, never send
  "https://wanikani-stats.vercel.app/api/notify?force=1"   # send now
```

The GitHub workflow also survives as a manual escape hatch — **Actions** tab →
*WaniKani review notifier* → **Run workflow**. It keeps its own state, separate
from the endpoint's, so a manual run there can repeat a notification the
endpoint already sent.

## How the scheduling works

`/api/notify` is stateless per request and does nothing unless it decides to,
so the schedule is just something calling it constantly. That job belongs to an
external pinger ([cron-job.org](https://cron-job.org)) hitting it every minute
with `Authorization: Bearer $CRON_SECRET`. One minute is therefore the
resolution of batch detection.

This started on a GitHub Actions cron and moved off it. GitHub treats schedules
as best-effort and was firing roughly one run in six, which turned "tell me when
a batch lands" into "tell me within a couple of hours". Vercel's own cron is
once-a-day on Hobby, hence the outside pinger.

State lives in a private Blob (`wk-notify-state.json`) and only records
cooldowns plus the review count as of the last notification. Nothing depends on
runs being evenly spaced or on any particular one happening — see the
`unannouncedReviews` comment in [`engine.js`](./engine.js) for why a dropped
ping makes a notification late rather than losing it.

### Environment

| Var | Where | Notes |
| --- | --- | --- |
| `WANIKANI_API_KEY` | Vercel + `.env` | |
| `NTFY_TOPIC` | Vercel + `.notify-topic.txt` | The topic name *is* the credential. |
| `CRON_SECRET` | Vercel | Also what the pinger sends; shared with `/api/sync`. |
| `BLOB_READ_WRITE_TOKEN` | Vercel | Auto-set by the Blob integration. |

Env vars are baked in at deploy time, so changing one needs a redeploy before
it takes effect. Same for `config.json` — the endpoint reads it from the
deployed bundle, so edits are only live once pushed.
