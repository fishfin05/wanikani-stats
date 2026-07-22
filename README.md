# WaniKani API

> Vault note: [WaniKani API](obsidian://open?vault=Notes&file=Projects%2FStarted%2FWaniKani%20API)

Personal dashboard that syncs your WaniKani (kanji/vocabulary SRS study tool) data locally and visualizes it with JLPT-level enrichment that WaniKani itself doesn't provide.

## Stack

Plain Node.js — no framework. `server.js` (HTTP server), `sync.js` (data puller), `wanikani.js` (API client), static `public/` dashboard (Chart.js).

## How it works

1. **`node sync.js`** (manual, not cron) — pulls from WaniKani API v2 (`subjects`, `assignments`, `review_statistics`, `level_progressions`), paginated with a 200ms throttle between requests, using `WANIKANI_API_KEY` from `.env`. Writes raw JSON to `data/` (subjects.json, assignments.json, review_statistics.json, level_progressions.json — roughly 2,760 subjects).
2. **`node server.js`** — serves the dashboard on port 3000 and a `/api/data` endpoint that merges the synced JSON into one enriched payload: each subject gets its assignment state (SRS stage, unlock/pass/burn timestamps) and review stats (meaning/reading accuracy) attached.
3. **JLPT enrichment** (the actual value-add over stock WaniKani): `data/jlpt.json` maps ~2,000 kanji characters directly to JLPT levels (N5–N1). Vocabulary doesn't have official JLPT lists, so a word's level is inferred as its *hardest* kanji's level. Current WaniKani level is read off `level_progressions`.

## Dashboard (`public/index.html` + `app.js`)

Three tabs:

- **Reviews** — review activity over time (day/week/month), items hitting Guru/Burned vs. newly unlocked, level-duration chart (color-coded by pace: ≤7d green, ≤14d orange, >14d red), trend overlay.
- **Analytics** — JLPT kanji proficiency breakdown (% of N5–N1 kanji at each SRS stage), vocabulary mastery by inferred JLPT level, SRS stage donut (apprentice/guru/master/enlightened/burned), items-per-WK-level stacked bars, meaning vs. reading accuracy side-by-side, an estimated-JLPT-level badge derived from burned-kanji proficiency.
- **Items** — searchable/filterable/sortable table of every subject (character, type, WK level, JLPT level, meanings, readings, SRS stage, accuracy), paginated 100/page, multi-select filters.
- **Insights** — study streak + a GitHub-style activity heatmap (built from item unlock/pass/burn events, since WaniKani's `/reviews` API endpoint has returned empty for everyone since a 2023 database-performance incident — there's no way to pull literal per-review timestamps from anywhere), plus a leech list (items you keep getting wrong, sorted worst-accuracy-first) with a "critical only" filter matching WaniKani's own Guru+-but-under-75%-accuracy definition.

## Notes

`wanikani.js` also has a standalone connection-test utility (prints account info) — not used by the dashboard itself, just a manual sanity check for the API key.
