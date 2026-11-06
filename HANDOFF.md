# WaniKani Stats handoff - 2026-11-06

## What this project is and where things live
Personal WaniKani analytics dashboard, review notifier and cloud backup service for Custom Study.
Separate from the browser extension in ../wanikani-custom-study/.
- Live: https://wanikani-stats.vercel.app; repo: https://github.com/fishfin05/wanikani-stats (master).
- Plain Node server.js/sync.js/wanikani.js; public/ dashboard; data/ enrichment/raw data; api/ serverless routes; notify/ rules.

## Current state
- package.json 1.0.0; latest local commit 6611cca adds Custom Study cloud backup. Existing AGENTS.md was untracked Nov 6.
- Charts, JLPT breakdowns, item search, insights/leeches and level-60 projection exist. Local server uses 3000.
- node sync.js manually pulls WaniKani data; live service uses Vercel Blob too. Data freshness wasn't rechecked for this handoff.
- api/custom-study.js supports extension backup; its local extension version is 0.12.17, distinct from dashboard package version.
- api/notify.js is designed for an external minute pinger; notify/config.json holds quiet hours/lesson limits.
- Sept 4 change records notification before sending to avoid duplicates. Preserve this behavior.
- Nov 3 question: do notifications cover the new custom-study system? Unverified; native API counts don't prove custom-direction coverage.
- Latest WaniKani chat mostly developed the extension; read that folder's HANDOFF.md for card formatting/count/schedule concerns.

## User preferences and decisions
- Granular progress per study direction; don't merge custom progress into misleading native counts.
- Alerts for new review batches with quiet hours, not repeated backlog nagging.
- Preserve study history/cloud data; don't reset progress to fix a chart.

## Gotchas / do-not-touch
- Vocabulary JLPT levels are inferred from hardest kanji, not official vocabulary classifications.
- Heatmap uses unlock/pass/burn events, not literal per-review timestamps; README records historical API limitations.
- Website daily lesson cap isn't in API; manually keep notify/config.json aligned with WaniKani's cap.
- Notification topics/provider credentials are private; don't print topic names or authenticated URLs.
- Real sync/force-notify calls have effects. Use dry runs/fixtures for checks.
- This folder is NOT the Custom Study installation folder.

## Next steps the user mentioned
- Verify notifier coverage for custom directions and reconcile counts with actual dashboard/extension.
- Check live data/cloud-backup freshness if resuming work; no recent live dashboard verification performed here.
- History: WaniKani chat in this project covers BOTH this backend and the separate extension.
