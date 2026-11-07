# WaniKani Stats - notes for Codex
<!-- generated from the folder contents on 2026-10-09; edit freely -->
The user is a beginner, not a developer: explain in plain words, one step at a time. Their weekly AI budget is tight: prefer small, focused changes and run any tests.

## What it is (from README.md)
# WaniKani API
> Vault note: [WaniKani API](obsidian://open?vault=Notes&file=Projects%2FStarted%2FWaniKani%20API)
Personal dashboard that syncs your WaniKani (kanji/vocabulary SRS study tool) data locally and visualizes it with JLPT-level enrichment that WaniKani itself doesn't provide.
## Stack
Plain Node.js â€” no framework. `server.js` (HTTP server), `sync.js` (data puller), `wanikani.js` (API client), static `public/` dashboard (Chart.js).
## How it works
1. **`node sync.js`** (manual, not cron) â€” pulls from WaniKani API v2 (`subjects`, `assignments`, `review_statistics`, `level_progressions`), paginated with a 200ms throttle between requests, using 
2. **`node server.js`** â€” serves the dashboard on port 3000 and a `/api/data` endpoint that merges the synced JSON into one enriched payload: each subject gets its assignment state (SRS stage, unloc
3. **JLPT enrichment** (the actual value-add over stock WaniKani): `data/jlpt.json` maps ~2,000 kanji characters directly to JLPT levels (N5â€“N1). Vocabulary doesn't have official JLPT lists, so a wo
## Dashboard (`public/index.html` + `app.js`)
Three tabs:
- **Reviews** â€” review activity over time (day/week/month), items hitting Guru/Burned vs. newly unlocked, level-duration chart (color-coded by pace: â‰¤7d green, â‰¤14d orange, >14d red), trend over

## Tech and commands (package.json)
- npm run sync  ->  node sync.js
- npm run start  ->  node server.js
- npm run dev  ->  node server.js
- main dependencies: @vercel/blob, kuromoji

## Layout (top level)
- .github/
- api/
- data/
- notify/
- public/
- .gitignore
- .vercelignore
- package-lock.json
- package.json
- README.md
- server.js
- sync.js
- vercel.json
- wanikani.js

## Git
- branch: master
- 2026-09-04 Record each notification before sending it, not after
- 2026-07-26 Update notifier docs for the Vercel endpoint
- 2026-07-26 Run the notifier as a Vercel endpoint driven by an external pinger
- 2026-07-25 Measure new reviews against the last notification, not the last run
- 2026-07-25 Notify on every new review batch, not just on a large backlog

## Rules
- Never print or commit secrets/API keys or read auth.json files.
- Back up before overwriting; keep changes small; do not touch other project folders.
