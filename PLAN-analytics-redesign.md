# Plan: WaniKani analytics redesign (Skill Tracker style)

Written 2026-11-07. Planning only: no code has been changed. Nothing gets built until you pick.

## 1. What the dashboard already has

The live dashboard (wanikani-stats.vercel.app) already has five tabs:

- **Reviews**: items reaching Guru/Burned over time, how long each level took (green/orange/red by pace), a level-60 finish-date projection with a "what if I went faster" box, upcoming review forecast, milestones.
- **Analytics**: JLPT kanji and vocabulary estimate (N5 to N1) with cards and charts, a JLPT gap table, SRS donut, items per level, accuracy by level and by type.
- **Items**: a searchable table of every item.
- **Insights**: streak numbers, an activity heatmap, and a leech table.
- **Text**: paste Japanese text and see how much of it you already know.

So the raw ingredients are good. What's missing is (a) a nicer look, (b) anything about **time**, and (c) anything about your **Custom Study directions** (English to Japanese, audio, and so on). The dashboard currently ignores the Custom Study cloud backup completely.

Data the dashboard can use:

| Source | What it holds | Notes |
|---|---|---|
| WaniKani API (synced daily) | every item, its SRS stage, unlock/pass/burn dates, right/wrong totals per item, level dates | WaniKani stopped giving out individual review times in 2023, so the heatmap uses unlock/pass/burn dates instead |
| Custom Study cloud backup (`api/custom-study.js`) | per-direction SRS state, and a **log of every answer** with exact time, item, direction, right/wrong, lesson or review | This is the new goldmine. Stored privately, keyed to your WaniKani account |
| `data/jlpt.json` | JLPT level for ~2,000 kanji | vocabulary levels are guessed from the hardest kanji in the word |
| Skill Tracker | hand-logged WaniKani minutes | 24 hours under "WaniKani", 49 entries, the latest on Jun 8 |

## 2. Where study time comes from (honest answer)

**Nothing records WaniKani minutes directly yet.** The Skill Tracker notes from Nov 6 say "WaniKani duration sync ... not established", and your Skill Tracker WaniKani entries stop on Jun 8.

But the Custom Study extension **does** save the exact time of every answer, and backs those times up to the cloud. From that you can work out real study time quite accurately:

- Answers close together (say under 2 minutes apart) count as one study session.
- Session time = first answer to last answer, plus a little for the final card.
- Long gaps (you walked away) don't count.

This is the same "active time" idea Skill Tracker uses for its other automatic senders. One limit: it only covers studying done **through the extension**, and only since the answer log started. Reviews done on the plain WaniKani site or a phone app wouldn't appear. Before building, a quick check is needed to confirm whether native Japanese-to-English answers also go into the log, or only the custom directions.

Optional later step: the dashboard could send those daily minutes into Skill Tracker automatically, so your Japanese tracker fills itself in. The rules there are strict (one sender only, send daily totals that replace rather than add, never send twice), so this would be its own small project.

## 3. The Skill Tracker look, described so a builder can match it

- **Feel:** clean, calm, mostly black/white/grey ("shadcn" style). Lots of white space, colour used only for meaning. Light mode by default, with a dark mode toggle. The current WaniKani dashboard is the opposite: always dark navy with a bright orange accent.
- **Font:** Geist (a free Google font), sans-serif. Numbers use tabular (even-width) digits.
- **Colours (light):** white page, near-black text, grey secondary text (`oklch(0.556 0 0)`, about #737373), light grey borders (about #e5e5e5), soft grey fill for empty bar tracks (about #f5f5f5). Green for "good" and amber for "warning", used sparingly.
- **Colours (dark):** near-black page (about #0a0a0a), dark grey cards (about #171717), white text, borders at 10% white.
- **Chart colours:** blue `#2563eb`, amber `#d97706`, teal `#0d9488`, purple `#9333ea`, slate grey `#64748b` for "Other". No more than 5 colours on one chart; smaller groups go into "Other".
- **Cards:** thin 1px border, rounded corners (10px), padding about 16px, no heavy shadows. Title in normal-size bold text, small grey description underneath.
- **Big numbers:** a row of three stat tiles; small grey label on top ("Today", "Streak"), large bold number below.
- **Page header:** a tiny uppercase grey label with wide letter spacing above a big bold title.
- **Progress bars:** thin pill-shaped bars (8px tall) with a grey track; sub-bars 6px with a small coloured dot next to each label.
- **Charts:** bars with a dashed "running total" line on top; axis text small (11px) and grey; no axis lines or tick marks; hover highlight is a faint grey band; animations off.
- **Layout:** one centred column (about 900px wide) that stacks cleanly on a phone.

Recommended twist for WaniKani: keep the calm Skill Tracker base but **keep WaniKani's own SRS colours** (pink Apprentice, purple Guru, blue Master, light blue Enlightened, dark Burned) wherever stages are shown, because they mean something to a WaniKani user.

## 4. Analytics ideas (best first)

1. **Study time dashboard** - Minutes per day/week/month as bars with a running-total line (exactly like Skill Tracker's chart), plus tiles: Today, This week, Average per study day. *Why:* the thing you asked for; shows real effort, not just item counts. *Data:* Custom Study answer log. *Effort:* medium.

2. **Progress per study direction** - One card per direction (Japanese to English, English to Japanese, Audio to English...) with thin bars for Apprentice / Guru / Master / Enlightened / Burned, and "how far behind your most advanced direction" each one is. *Why:* matches your wish for granular, honest progress per direction instead of one misleading total. *Data:* Custom Study SRS state. *Effort:* medium.

3. **Kanji mastery grid** - Every WaniKani kanji as a small tile, coloured by SRS stage, grouped by level or by JLPT level; hover shows meaning and accuracy. *Why:* one glance shows everything you know; very satisfying to watch it fill in. *Data:* WaniKani API. *Effort:* small to medium.

4. **JLPT coverage rings** - For N5 to N1: what percent of that level's kanji you have at Guru or higher, with a "next 10 kanji to learn for N4" list. *Why:* turns WaniKani's fixed order into a clear JLPT goal. *Data:* WaniKani API + jlpt.json (already half-built in the Analytics tab; this is a cleaner presentation). *Effort:* small.

5. **Next level date forecast** - a plain sentence like "At your current pace, your next level arrives about <date>; level 60 about <date>" (made-up example wording, real dates come from your data), with a pace trend (getting faster or slower). *Why:* motivation and planning. *Data:* WaniKani level dates (already projected; needs a simpler, friendlier card). *Effort:* small.

6. **Time per item learned** - Minutes spent per item that reached Guru, per week. *Why:* shows whether study is getting more efficient, or whether a stretch is unusually hard. *Data:* answer log + WaniKani pass dates. *Effort:* medium.

7. **Best study hour** - Accuracy by hour of day and by day of week (a small 7x24 grid). *Why:* tells you when your brain works best, e.g. "you are 9% more accurate before noon". *Data:* answer log. *Effort:* small.

8. **Session length vs accuracy** - Does accuracy drop after 20 minutes? Chart of accuracy by minute into the session. *Why:* tells you a sensible session length. *Data:* answer log. *Effort:* small to medium.

9. **Streak calendar with real study days** - GitHub-style calendar coloured by minutes studied (not just unlock/pass events), current and longest streak. *Why:* more truthful than today's heatmap, and fun. *Data:* answer log (+ the old event heatmap for earlier months). *Effort:* small.

10. **Leech trends** - Is your leech pile growing or shrinking each week, and which leeches you finally fixed. *Why:* leeches cost the most time; seeing them shrink is rewarding. *Data:* WaniKani review statistics (today only), so the trend needs the daily sync to save a small snapshot each day. *Effort:* medium.

11. **Weakest direction / confusions** - Items you get right one way but wrong the other (e.g. you can read it but can't produce it), and common mix-ups from the log's "other word" field. *Why:* exactly the gaps reverse study is meant to catch. *Data:* answer log. *Effort:* small to medium.

12. **Send minutes to Skill Tracker** - See section 2. *Why:* your Japanese tracker stays up to date with no typing. *Effort:* medium, with careful testing.

## 5. Recommended first version

Build these five first:

1. **Study time dashboard** (#1)
2. **Progress per direction** (#2)
3. **Kanji mastery grid** (#3)
4. **Next level forecast + JLPT coverage** as one "Where you're headed" card (#5 + #4)
5. **Best study hour** (#7), small to build and fun

**How to do the redesign:**

- Keep the same plain website and Chart.js (no rebuild into Skill Tracker's Next.js); copy Skill Tracker's *look* into a fresh stylesheet: its colour tokens, Geist font, card and tile styles, thin progress bars, light/dark toggle.
- Add a new first tab, **Overview**, holding the five ideas above. Leave the existing tabs working (restyled) so nothing you rely on disappears.
- Add one small read-only server route that loads your Custom Study backup and works out minutes/sessions. It reads only; it never changes your study data or the native WaniKani schedule.
- Test with a copy of the data first (fake fixtures), check light, dark and phone widths with screenshots, then compare one real day's minutes with what you remember studying.
- Show the version number in the header and bump it (1.0.0 to 1.1.0), commit and push to the private repo after each working step.

Open questions for you:
- Pick which ideas go in the first version (the five above, or swap some).
- Light mode by default like Skill Tracker, or keep dark by default?
- Want the automatic "send minutes to Skill Tracker" now, or later?
