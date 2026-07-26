# WaniKani review notifier

Pushes a phone notification when reviews pile up, with do-not-disturb hours.
Runs on GitHub Actions every 15 minutes; `notify.js` decides whether any given
run should actually notify.

## Phone setup (one time)

1. Install **ntfy** — [iOS](https://apps.apple.com/us/app/ntfy/id1625396347) ·
   [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
2. Tap **+** to subscribe to a topic.
3. Enter the topic name stored in the `NTFY_TOPIC` GitHub secret (also saved
   locally in the gitignored `.notify-topic.txt`).

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

You can also trigger it from the repo's **Actions** tab → *WaniKani review
notifier* → **Run workflow**, which exposes the same dry-run and force flags.

## How the scheduling works

GitHub cron is UTC-only and can't express "10pm your time" across DST, so the
workflow runs on a dumb fixed interval and all real logic lives in the script.

The 15-minute interval is also the resolution of batch detection — a batch is
noticed up to 15 minutes after it lands. State (cooldowns plus the last seen
review count) persists between runs via the Actions cache; if it's ever evicted
the script re-baselines against the current count, so the cost is one missed
batch announcement rather than a false one.

GitHub disables scheduled workflows after 60 days of repo inactivity, and cron
runs can be delayed under load — the cooldown logic tolerates both.
