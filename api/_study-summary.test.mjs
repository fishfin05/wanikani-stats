import assert from 'node:assert/strict';
import { summarizeStudy, validTimeZone } from './_study-summary.js';
import { createHandler } from './study-summary.js';

// Two sittings on one day: 3 answers 30s apart, then (an hour later) 2 answers 60s apart.
const log = [
  '2026-11-05T17:00:00Z', '2026-11-05T17:00:30Z', '2026-11-05T17:01:00Z',
  '2026-11-05T18:00:00Z', '2026-11-05T18:01:00Z',
  '2026-11-06T07:30:00Z', // 23:30 the previous evening in Los Angeles
].map((timestamp, i) => ({ timestamp, subjectId: i, mode: 'en_to_jp', correct: true }));
const backup = {
  reviewLog: [...log, { timestamp: 'not a date' }],
  srsState: { '10:en_to_jp': { stage: 3 }, '11:en_to_jp': { stage: 9 }, '12:audio_to_en': { stage: 5 }, '13:en_to_jp': { stage: 0 }, '14:jp_to_en': { stage: 4 } },
  updatedAt: '2026-11-06T08:00:00Z',
};

const utc = summarizeStudy(backup);
assert.equal(utc.answerCount, 6);
assert.equal(utc.sessionCount, 3);
// Day 1: 10 + 30 + 30 (first sitting) + 10 + 60 (second) = 140s
assert.deepEqual(utc.days['2026-11-05'], { seconds: 140, answers: 5, sessions: 2 });
assert.deepEqual(utc.days['2026-11-06'], { seconds: 10, answers: 1, sessions: 1 });

const la = summarizeStudy(backup, { timeZone: 'America/Los_Angeles' });
assert.deepEqual(la.days['2026-11-05'], { seconds: 150, answers: 6, sessions: 3 });
assert.equal(la.days['2026-11-06'], undefined);

assert.deepEqual(utc.directions.en_to_jp.cards, [[10, 3], [11, 9]]);
assert.deepEqual(utc.directions.audio_to_en.cards, [[12, 5]]);
assert.equal(utc.directions.jp_to_en, undefined, 'native direction comes from WaniKani, not the backup');
assert.equal(validTimeZone('Not/AZone'), 'UTC');
assert.equal(summarizeStudy({}).hasData, false);

// Accuracy is deliberately not part of the summary.
assert.ok(!JSON.stringify(utc).includes('correct'));

// Handler: requires a key, verifies it, reads only that account's backup.
function fakeRes() {
  return { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
let asked = null;
const handler = createHandler({
  fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ data: { id: 'user-1' } }) }),
  blobGet: async (path) => { asked = path; return { statusCode: 200, stream: new Response(JSON.stringify(backup)).body }; },
});
let res = fakeRes();
await handler({ method: 'GET', headers: {}, url: '/api/study-summary' }, res);
assert.equal(res.code, 401);
res = fakeRes();
await handler({ method: 'GET', headers: { 'x-wk-api-key': 'k' }, url: '/api/study-summary?tz=America/Los_Angeles' }, res);
assert.equal(res.code, 200);
assert.equal(asked, 'custom-study/user-1.json');
assert.equal(res.body.days['2026-11-05'].answers, 6);
assert.equal(res.headers['Cache-Control'], 'private, no-store');
res = fakeRes();
await handler({ method: 'PUT', headers: { 'x-wk-api-key': 'k' }, url: '/' }, res);
assert.equal(res.code, 405);
console.log('study-summary tests passed');
