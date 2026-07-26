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
| `reviewThreshold` | Minimum reviews waiting before a notification fires. |
| `lessonThreshold` | Minimum *today's* lessons before the gentler lesson nudge fires. |
| `dailyLessonCap` | Mirror of WaniKani's **Maximum Recommended Daily Lessons**. See caveat below. |
| `cooldownMinutes` | Minimum gap between notifications. |
| `lessonCooldownMinutes` | Extra-long gap for lesson nudges (they'd otherwise repeat forever). |
| `urgentReviewCount` | Above this, the notification is sent at high priority. |

### The `dailyLessonCap` caveat

WaniKani's **Maximum Recommended Daily Lessons** is a web-app-only setting —
it is not exposed anywhere in API v2. The API's `/summary` endpoint always
reports the *full unlocked backlog* (e.g. 53), not the "Today's Lessons"
number the dashboard shows (e.g. 5).

So `dailyLessonCap` has to be set by hand to match your WaniKani setting.
Keep them in sync, or notifications will disagree with your dashboard.

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
Cooldown state persists between runs via the Actions cache; if it's ever
evicted, the worst case is one extra notification.

GitHub disables scheduled workflows after 60 days of repo inactivity, and cron
runs can be delayed under load — the cooldown logic tolerates both.
