import assert from 'node:assert/strict';
import { mergeCustomStudy } from './_custom-study-merge.js';
const result = mergeCustomStudy({
  srsState: { '1:a': { lastAnsweredAt: '2024-01-02' }, '2:a': { lastAnsweredAt: '2024-01-01' } },
  alternates: { '1:meaning': ['first'] },
  reviewLog: [{ timestamp: '2024-01-02', subjectId: 1, mode: 'a' }],
}, {
  srsState: { '1:a': { lastAnsweredAt: '2024-01-03' }, '2:b': { lastAnsweredAt: '2024-01-01' } },
  alternates: { '1:meaning': ['second', 'first'] },
  logAppend: [{ timestamp: '2024-01-02', subjectId: 1, mode: 'a' }, { timestamp: '2024-01-01', subjectId: 2, mode: 'b' }],
});
assert.equal(result.srsState['1:a'].lastAnsweredAt, '2024-01-03');
assert.ok(result.srsState['2:b']);
assert.deepEqual(result.alternates['1:meaning'], ['first', 'second']);
assert.deepEqual(result.reviewLog.map(x => x.subjectId), [2, 1]);
assert.deepEqual(mergeCustomStudy().reviewLog, []);
console.log('merge tests passed: newer wins, missing record, alternates union, log dedupe/sort, empty inputs');
