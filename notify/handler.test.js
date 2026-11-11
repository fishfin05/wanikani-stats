import assert from 'node:assert/strict';
import { createHandler } from '../api/notify.js';
import { normalizeState, runNotifier } from './engine.js';

// All credentials are synthetic. No network, local data, or real pushes.
const env = { CRON_SECRET: 'test-secret', WANIKANI_API_KEY: 'test-key', NTFY_TOPIC: 'test-topic', BLOB_READ_WRITE_TOKEN: 'test-blob' };
const config = { timezone: 'UTC', dnd: null, dailyLessonCap: null, reviewThreshold: 10000, lessonThreshold: 10000 };
const empty = () => normalizeState(null);
function fixture(initial = empty(), options = {}) {
  let stored = initial === null ? null : structuredClone(initial);
  let revision = 1, now = Date.parse('2026-01-01T00:00:00Z'), reviews = 0;
  let reads = 0, puts = 0, sends = 0, failGet = false, failPut = false;
  let calls = [], errors = [], readOptions = [];
  const handler = createHandler({
    env, clock: () => now, readConfig: () => config,
    logger: { log() {}, error: (line) => errors.push(line) },
    blobGet: async (key, opts) => {
      reads++; readOptions.push(opts);
      if (failGet) throw new Error('sensitive SDK error must stay private');
      if (stored === null) return null;
      const etag = `v${revision}`;
      if (opts.ifNoneMatch === etag) return { statusCode: 304 };
      return { statusCode: 200, stream: new Response(JSON.stringify(stored)).body, blob: { etag } };
    },
    blobPut: async (key, json, opts) => {
      puts++; calls.push('put');
      if (failPut) throw new Error('quota');
      assert.equal(opts.addRandomSuffix, false);
      if (stored === null) assert.equal(opts.allowOverwrite, false);
      else assert.equal(opts.ifMatch, `v${revision}`);
      stored = JSON.parse(json);
      return { etag: `v${++revision}` };
    },
    run: (args) => (options.run ?? runNotifier)({ ...args, now: new Date(now), send: async () => { sends++; calls.push('send'); if (options.sendFails) throw new Error('send failed'); } }),
  });
  return {
    async ping(query = {}, authorized = true) {
      const original = globalThis.fetch;
      globalThis.fetch = async () => new Response(JSON.stringify({ data: {
        reviews: [{ available_at: '2025-01-01T00:00:00Z', subject_ids: Array(reviews).fill(1) }], lessons: [],
      } }));
      const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; } };
      try { await handler({ method: 'GET', headers: { authorization: authorized ? 'Bearer test-secret' : 'bad' }, query }, res); return res; }
      finally { globalThis.fetch = original; }
    },
    set reviews(value) { reviews = value; },
    set failGet(value) { failGet = value; }, set failPut(value) { failPut = value; },
    advance(ms = 60000) { now += ms; },
    externalWrite(state) { stored = state; revision++; },
    get stats() { return { reads, puts, sends }; },
    get stored() { return stored; }, get errors() { return errors; }, get calls() { return calls; }, get readOptions() { return readOptions; },
  };
}

// Reproduce normal daily operation and count every store call.
const quiet = fixture();
for (let i = 0; i < 1440; i++) { assert.equal((await quiet.ping()).body.ok, true); quiet.advance(); }
assert.deepEqual(quiet.stats, { reads: 1440, puts: 0, sends: 0 });
assert.equal(quiet.readOptions[1].ifNoneMatch, 'v1');
console.log('quiet day: 1440 GET, 0 PUT, 0 LIST, 0 HEAD');

// Formatting, extra legacy fields, or absent optional fields are not changes.
const legacy = fixture({ announcedReviewCount: 0, obsolete: true });
await legacy.ping(); assert.equal(legacy.stats.puts, 0);
const missing = fixture(null);
await missing.ping(); assert.equal(missing.stats.puts, 0);

const changed = fixture(); changed.reviews = 10;
assert.equal((await changed.ping()).body.sent, true);
assert.deepEqual(changed.calls, ['put', 'send']);
await changed.ping(); assert.equal(changed.stats.puts, 1);
changed.reviews = 8; await changed.ping();
assert.equal(changed.stats.puts, 2); assert.equal(changed.stored.announcedReviewCount, 8);
changed.advance(31 * 60000); changed.reviews = 9;
assert.equal((await changed.ping()).body.sent, true);
assert.equal(changed.stats.puts, 3);
console.log('changed state: exactly 1 PUT; shrinking baseline survives and next batch still alerts');

const dry = fixture(); dry.reviews = 3;
await dry.ping({ dry: '1', force: '1' });
assert.deepEqual(dry.stats, { reads: 1, puts: 0, sends: 0 });
const unauthorized = fixture();
assert.equal((await unauthorized.ping({}, false)).code, 401);
assert.equal(unauthorized.stats.reads, 0);
assert.deepEqual((await unauthorized.ping({ health: '1' }, false)).body, { ok: true, status: 'ready', mode: 'health' });
assert.equal(unauthorized.stats.reads, 0);

for (const operation of ['failGet', 'failPut']) {
  const f = fixture(); f.reviews = 5; f[operation] = true;
  const result = await f.ping();
  assert.equal(result.code, 200); assert.equal(result.body.ok, false);
  assert.equal(result.body.status, 'storage_unavailable'); assert.equal(result.body.sent, false);
  assert.equal(f.stats.reads, 1); assert.equal(f.stats.puts, operation === 'failPut' ? 1 : 0);
  assert.equal(f.stats.sends, 0); assert.deepEqual(f.errors, ['notify status=storage_unavailable']);
  assert.equal((await f.ping()).body.status, 'storage_backoff');
  assert.equal(f.stats.reads, 1); assert.equal(f.errors.length, 1);
  f[operation] = false; f.advance();
  assert.equal((await f.ping()).body.sent, true);
}
const corrupt = fixture({}, { run: async () => { throw new Error('must not expose private details'); } });
assert.equal((await corrupt.ping()).body.status, 'run_failed');
assert.deepEqual(corrupt.errors, ['notify status=run_failed']);
const rollback = fixture(empty(), { sendFails: true }); rollback.reviews = 1;
assert.equal((await rollback.ping()).body.status, 'run_failed');
assert.deepEqual(rollback.calls, ['put', 'send', 'put']);
assert.deepEqual(rollback.stored, empty());

// A cached state must never hide another function instance's committed send.
const shared = fixture(); await shared.ping();
shared.externalWrite({ ...empty(), announcedReviewCount: 3, lastBatchNotifyAt: '2026-01-01T00:00:00Z' });
shared.reviews = 3; await shared.ping(); assert.equal(shared.stats.sends, 0);

// Exact behavior requires 1 write per observed decline, even on busy days.
const study = fixture();
for (let minute = 0; minute < 1440; minute++) {
  // Four batches of 20 reviews, followed by minute-by-minute study.
  const phase = minute % 360;
  study.reviews = phase <= 20 ? 20 - phase : 0;
  await study.ping(); study.advance();
}
assert.deepEqual(study.stats, { reads: 1440, puts: 84, sends: 4 });
console.log('study day: 1440 GET, 84 PUT (4 notifications + 80 queue drops), 0 LIST, 0 HEAD');
console.log('All notifier handler tests passed: unchanged, one PUT, dry, auth, soft read/write failure, backoff, rollback, cache revalidation');
