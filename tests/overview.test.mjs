import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { timeSeries, studyTiles, directionRows, jlptCoverage, formatMinutes, addDays, groupOf } from '../public/overview.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const shown = JSON.parse(readFileSync(new URL('../public/version.json', import.meta.url)));
assert.equal(shown.version, pkg.version, 'run npm run version:write after bumping package.json');

assert.equal(addDays('2026-03-01', -1), '2026-02-28');
assert.equal(formatMinutes(42.4), '42m');
assert.equal(formatMinutes(125), '2h 5m');
assert.equal(groupOf(0), null); assert.equal(groupOf(4), 'apprentice'); assert.equal(groupOf(9), 'burned');

const today = '2026-11-07';
const days = {
  '2026-01-15': { seconds: 3600 },         // long before the 30-day window
  '2026-11-01': { seconds: 1200 },
  '2026-11-06': { seconds: 600 },
  '2026-11-07': { seconds: 900 },
};
const t = studyTiles(days, today);
assert.equal(t.today, 15);
assert.equal(t.week, 45);              // Nov 1..7
assert.equal(t.studyDays30, 3);
assert.equal(t.avgPerStudyDay, 15);
assert.equal(t.total, 105);

const d = timeSeries(days, 'day', today);
assert.equal(d.buckets.length, 30);
assert.equal(d.buckets.at(-1), today);
assert.equal(d.minutes.at(-1), 15);
assert.equal(d.cumulativeHours.at(-1), 105 / 60, 'running total includes time before the window');
assert.equal(d.cumulativeHours[0], 1, 'starts from the January hour');

const w = timeSeries(days, 'week', today);
assert.equal(w.buckets.length, 16);
assert.equal(w.buckets.at(-1), '2026-11-02'); // Monday
assert.equal(w.minutes.at(-1), 25);            // Nov 6 + Nov 7
assert.equal(w.minutes.at(-2), 20);            // Nov 1 (Sunday) belongs to the week of Oct 26

const m = timeSeries(days, 'month', today);
assert.equal(m.buckets[0], '2026-01');
assert.equal(m.buckets.at(-1), '2026-11');
assert.equal(m.minutes.at(-1), 45);

const items = [
  { id: 1, type: 'kanji', srs_stage: 5, jlpt: 'N5' },
  { id: 2, type: 'vocabulary', srs_stage: 6 },
  { id: 3, type: 'vocabulary', srs_stage: 7 },
  { id: 4, type: 'vocabulary', srs_stage: 2 },   // not yet open for extra directions
  { id: 5, type: 'kanji', srs_stage: -1, jlpt: 'N5' },
];
const rows = directionRows(items, { directions: { en_to_jp: { label: 'English → Japanese', cards: [[2, 3]] }, audio_to_en: { label: 'Audio → English', cards: [] } } });
assert.equal(rows.length, 3);
assert.equal(rows[0].learned, 4);
assert.equal(rows[1].learned, 1);
assert.equal(rows[1].available, 2);
assert.match(rows[1].caption, /1 words to catch up/);
assert.match(rows[2].caption, /2 words to catch up/);
assert.equal(directionRows(items, null).length, 1, 'without the backup only the native row shows');
for (const r of rows) assert.ok(!/accura|correct/i.test(JSON.stringify(r)));

const cov = jlptCoverage(items, { N5: 4 });
assert.deepEqual(cov[0], { level: 'N5', known: 1, total: 4, pct: 25 });
console.log('overview tests passed');
