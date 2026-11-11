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
available review count against the count as of the last *notification* — not
against the previous run — so a dropped ping makes a notification late rather
than losing the batch entirely.

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

`/api/notify` revalidates its committed state on each request and does nothing unless it decides to,
so the schedule is just something calling it constantly. That job belongs to an
external pinger ([cron-job.org](https://cron-job.org)) hitting it every minute
with `Authorization: Bearer $CRON_SECRET`. One minute is therefore the
resolution of batch detection.

This started on a GitHub Actions cron and moved off it. GitHub treats schedules
as best-effort and was firing roughly one run in six, which turned "tell me when
a batch lands" into "tell me within a couple of hours". Vercel's own cron is
once-a-day on Hobby, hence the outside pinger.

Each notification is written to state *before* it is sent, and the write is
rolled back if the send then fails. The endpoint runs on a wall-clock budget and
is killed when it runs out; recording afterwards meant a run cut short between
the two left a delivered notification with no record of it, so the next ping saw
the same batch and sent it again — every minute until some run finished in time.
Committing first turns that failure into a late notification instead of a loop.

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

## Blob coalescing and failures (1.1.2)

The warm process keeps the live decision state in memory between pings. Quiet
queue decreases update that state immediately, so the next batch is measured
against the current baseline even when it has not been uploaded to Blob yet.
Notification stamps and notification commits still save immediately, before
sending, with the existing rollback on a failed push. Other changed state is
checkpointed only when at least 30 minutes have passed since the last successful
save. A notification also resets that checkpoint clock. Identical state never
writes, including at the end of a notification run.

The installed @vercel/blob 2.5.0 SDK uses authenticated GET for reads, with no
HEAD or LIST. A warm process revalidates the persisted ETag on every ping, while
keeping its unsaved live baseline. If another instance changed only the queue
checkpoint, the lower observed baseline wins; an external notification's stamps
and state take precedence. Writes use the ETag from GET and do not retry conflicts.
SDK retries remain disabled only in this function process, without editing any
environment file. No new storage service or config.json changes are needed.

### Cold-start trade-off and shutdown

A restart can lose up to 30 minutes of queue drift. It must not use an outdated
high count to suppress a small new batch indefinitely. On a cold load, keep all
saved cooldown/lesson/review stamps but start the in-memory announced baseline
at zero. This can repeat at most one batch notice per cold restart, after the
existing DND and batch cooldown allow it. The normal warm-process schedule and
message content are unchanged; a restart during cooldown can make that recovery
notice slightly late. Once committed, that notice updates the saved stamps and
the live baseline normally. Repeated separate cold starts can each incur this
trade-off; Blob unavailability can delay recovery further.

A best-effort SIGTERM handler attempts one conditional checkpoint of dirty state
only while idle, using a 400 ms timeout. Vercel allows just 500 ms of function
cleanup, so the application does not depend on this write completing. Busy
notifications, failed storage backoff, unchanged state, and dry-only sessions do
not flush on shutdown. No beforeExit or periodic background timer is used.
See [Vercel's SIGTERM documentation](https://vercel.com/docs/functions/functions-api-reference#sigterm-signal).

### Mocked operation counts

Run npm test for all existing checks, engine tests, handler simulations, and the
installed SDK transport test. Each day below includes all 1,440 minute pings.

| Traffic | v1.1.1 PUT/day | v1.1.2 PUT/day | Three-day PUT total |
| --- | ---: | ---: | ---: |
| Unchanged queue | 0 | 0 | 0 |
| Existing stress trace: four 20-review batches, one completion/minute | 84 | 8 | 24 |
| Same trace with deployed DND/cooldown/threshold config | not separately measured | 6 | 18 |
| Lesson nudge plus a persistent review backlog | not separately measured | 9 | not separately measured |

The existing stress trace now costs four notification saves plus four delayed
queue checkpoints = 8 PUT/day, or about 240 PUT per 30-day month (previously
2,520). Every warm-process notice time and payload is compared with the unchanged
engine using immediately updated reference state. Each tested day is below the
25 PUT/day target (750 per 30-day month).

This is a traffic-tested target, not a hard daily quota: notification saves always
take priority, sustained queue changes can occupy more 30-minute windows, and
cold starts, shutdown checkpoints, rollback writes, or failures can add writes.
No notice is dropped to enforce an arbitrary daily cap. The tests also cover no
write inside the window, a write after it, immediate notification commits, cold
recovery with at most one repeat, read/write soft failures, and bounded shutdown.

GET remains 1,440 requests/day and is a simple operation on a cache miss, not an
advanced one. ETags reduce downloaded bytes; actual billed simple operations
depend on Vercel cache hits. Other users of this Blob store (dashboard LISTs,
sync, custom-study backups) have their own operations and are unchanged.

### Error and deployment checks

Storage failures return HTTP 200, ok:false, sent:false,
status:storage_unavailable, retryAfterSeconds:60. A warm process preserves its
live state and skips storage attempts during that backoff. Other run failures
return run_failed. A failed pre-send write never marks an unsent notice as
successful in memory. One fixed error line is logged, without raw credential
URLs. Unauthorized requests still return 401.

Public GET /api/notify?health=1 returns the deployed version and ready status,
without Blob, WaniKani, or ntfy calls. It proves availability/version only.
Authenticated dry=1 evaluates decisions but never saves, sends, or creates
shutdown writes. To resume scheduling, sign into cron-job.org yourself and
re-enable WaniKani notifier with its existing URL, headers, and schedule.

[Blob billing](https://vercel.com/docs/vercel-blob/usage-and-pricing) and
[SDK reference](https://vercel.com/docs/vercel-blob/using-blob-sdk).
