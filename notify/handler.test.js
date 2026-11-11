import assert from 'node:assert/strict';
import { createHandler } from '../api/notify.js';
import { normalizeState, runNotifier } from './engine.js';
import { readFileSync } from 'node:fs';

// All credentials are synthetic. No network, local data, or real pushes.
const env = { CRON_SECRET: 'test-secret', WANIKANI_API_KEY: 'test-key', NTFY_TOPIC: 'test-topic', BLOB_READ_WRITE_TOKEN: 'test-blob' };
const config = { timezone: 'UTC', dnd: null, dailyLessonCap: null, reviewThreshold: 10000, lessonThreshold: 10000 };
const empty = () => normalizeState(null);
function fixture(initial = empty(), options = {}) {
  let stored = initial === null ? null : structuredClone(initial);
  let revision = 1, now = Date.parse('2026-01-01T00:00:00Z'), reviews = 0;
  let reads = 0, puts = 0, sends = 0, failGet = false, failPut = false;
  let calls = [], errors = [], readOptions = [];
  let referenceState = normalizeState(initial);
  const notifications = [], referenceNotifications = [];
  const makeHandler = () => createHandler({
    env, clock: () => now, readConfig: () => options.config ?? config,
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
    run: (args) => (options.run ?? runNotifier)({ ...args, now: new Date(now), send: async (payload) => { sends++; calls.push('send'); if (options.sendFails) throw new Error('send failed'); notifications.push({ at: now, payload }); } }),
  });
  let handler = makeHandler();
  return {
    async ping(query = {}, authorized = true) {
      const original = globalThis.fetch;
      globalThis.fetch = async () => new Response(JSON.stringify({ data: {
        reviews: [{ available_at: '2025-01-01T00:00:00Z', subject_ids: Array(reviews).fill(1) }],
        lessons: [{ available_at: '2025-01-01T00:00:00Z', subject_ids: Array(options.lessons ?? 0).fill(1) }],
      } }));
      const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; } };
      try {
        await handler({ method: 'GET', headers: { authorization: authorized ? 'Bearer test-secret' : 'bad' }, query }, res);
        if (options.compare) {
          const reference = await runNotifier({ apiKey: env.WANIKANI_API_KEY, topic: env.NTFY_TOPIC, server: null,
            state: referenceState, config: options.config ?? config, now: new Date(now),
            send: async (payload) => referenceNotifications.push({ at: now, payload }),
          });
          referenceState = reference.state;
        }
        return res;
      }
      finally { globalThis.fetch = original; }
    },
    set reviews(value) { reviews = value; },
    set failGet(value) { failGet = value; }, set failPut(value) { failPut = value; },
    advance(ms = 60000) { now += ms; },
    restart() { handler = makeHandler(); },
    flushBeforeExit() { return handler.flushBeforeExit(); },
    externalWrite(state) { stored = state; revision++; },
    get stats() { return { reads, puts, sends }; },
    get stored() { return stored; }, get errors() { return errors; }, get calls() { return calls; }, get readOptions() { return readOptions; },
    get notifications() { return notifications; }, get referenceNotifications() { return referenceNotifications; },
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
assert.equal(changed.stats.puts, 1); assert.equal(changed.stored.announcedReviewCount, 10);
changed.advance(31 * 60000); changed.reviews = 9;
assert.equal((await changed.ping()).body.sent, true);
assert.equal(changed.stats.puts, 2);
console.log('queue drift stays in memory; a new notification writes immediately');
const earlyNotice = fixture(empty(), { config: { ...config, newBatchCooldownMinutes: 0 } });
earlyNotice.reviews = 5; await earlyNotice.ping();
earlyNotice.advance(); earlyNotice.reviews = 4; await earlyNotice.ping();
assert.equal(earlyNotice.stats.puts, 1);
earlyNotice.advance(); earlyNotice.reviews = 6;
assert.equal((await earlyNotice.ping()).body.sent, true);
assert.equal(earlyNotice.stats.puts, 2); // immediate, only two minutes after save

const checkpoint = fixture(); checkpoint.reviews = 20; await checkpoint.ping();
for (let minute = 1; minute < 30; minute++) {
  checkpoint.advance(); checkpoint.reviews = Math.max(0, 20 - minute);
  await checkpoint.ping(); assert.equal(checkpoint.stats.puts, 1);
}
checkpoint.advance(); await checkpoint.ping();
assert.equal(checkpoint.stats.puts, 2); assert.equal(checkpoint.stored.announcedReviewCount, 0);
await checkpoint.ping(); assert.equal(checkpoint.stats.puts, 2);
console.log('no drift write before 30 minutes; exactly one checkpoint at the window');

const dry = fixture(); dry.reviews = 3;
await dry.ping({ dry: '1', force: '1' });
assert.deepEqual(dry.stats, { reads: 1, puts: 0, sends: 0 });
const unauthorized = fixture();
assert.equal((await unauthorized.ping({}, false)).code, 401);
assert.equal(unauthorized.stats.reads, 0);
assert.deepEqual((await unauthorized.ping({ health: '1' }, false)).body, { ok: true, status: 'ready', mode: 'health', version: '1.1.2' });
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

// Lose a dirty baseline. A restart re-announces conservatively once, after the
// saved cooldown, rather than suppressing a small new batch indefinitely.
const cold = fixture(); cold.reviews = 20; await cold.ping();
cold.advance(10 * 60000); cold.reviews = 2; await cold.ping();
assert.equal(cold.stored.announcedReviewCount, 20);
cold.restart(); cold.reviews = 3;
for (let minute = 10; minute < 30; minute++) {
  assert.equal((await cold.ping()).body.sent, false); cold.advance();
}
assert.equal((await cold.ping()).body.sent, true);
for (let minute = 0; minute < 120; minute++) { cold.advance(); await cold.ping(); }
assert.equal(cold.stats.sends, 2); // initial notice + one possible repeat/recovery
assert.equal(cold.stored.announcedReviewCount, 3);

// Checkpoint errors retain live drift. Notification errors cannot mark an
// unsent notification as delivered. Both return soft statuses, no retry loop.
const dirty = fixture(); dirty.reviews = 20; await dirty.ping();
dirty.advance(10 * 60000); dirty.reviews = 2; await dirty.ping();
dirty.advance(20 * 60000); dirty.failPut = true;
assert.equal((await dirty.ping()).body.status, 'storage_unavailable');
dirty.failPut = false; dirty.advance(); dirty.reviews = 3;
assert.equal((await dirty.ping()).body.sent, true);
assert.equal(dirty.stats.sends, 2);

const shutdown = fixture(); shutdown.reviews = 20; await shutdown.ping();
shutdown.advance(); shutdown.reviews = 2; await shutdown.ping();
assert.equal(shutdown.stats.puts, 1);
await shutdown.flushBeforeExit(); await shutdown.flushBeforeExit();
assert.equal(shutdown.stats.puts, 2); assert.equal(shutdown.stored.announcedReviewCount, 2);
assert.equal(shutdown.stats.sends, 1);
const dryShutdown = fixture({ ...empty(), announcedReviewCount: 20 });
await dryShutdown.ping({ dry: '1' }); await dryShutdown.flushBeforeExit();
assert.equal(dryShutdown.stats.puts, 0);

// Full-day and three-day traces, comparing every payload and send time with
// the unmodified engine and an immediately updated reference state.
async function simulate(days, cfg, label) {
  const study = fixture(empty(), { compare: true, config: cfg });
  const perDay = [];
  for (let day = 0; day < days; day++) {
    const before = study.stats.puts;
    for (let minute = 0; minute < 1440; minute++) {
      const phase = minute % 360;
      study.reviews = phase <= 20 ? 20 - phase : 0;
      assert.equal((await study.ping()).body.ok, true); study.advance();
    }
    perDay.push(study.stats.puts - before);
    assert.ok(perDay.at(-1) <= 25);
  }
  assert.deepEqual(study.notifications, study.referenceNotifications);
  assert.equal(study.stats.reads, days * 1440);
  console.log(`${label}: ${days} day(s), PUT/day ${perDay.join(', ')}, ${study.stats.puts} total PUT, ${study.stats.sends} notices; identical notice times and payloads`);
  return study.stats;
}
assert.equal((await simulate(1, config, 'existing traffic')).puts, 8);
assert.equal((await simulate(3, config, 'existing traffic')).puts, 24);
const actualConfig = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
await simulate(3, actualConfig, 'deployed config traffic');
const reminders = fixture(empty(), { compare: true, lessons: 5,
  config: { ...config, reviewThreshold: 10, lessonThreshold: 3 } });
for (let minute = 0; minute < 1440; minute++) {
  reminders.reviews = minute < 60 ? 0 : 12;
  assert.equal((await reminders.ping()).body.ok, true); reminders.advance();
}
assert.deepEqual(reminders.notifications, reminders.referenceNotifications);
assert.equal(reminders.stats.puts, reminders.stats.sends);
assert.ok(reminders.stats.puts <= 25);
console.log(`lesson/backstop day: ${reminders.stats.puts} PUT; all cooldowns and payloads match`);
console.log('All notifier handler tests passed: coalescing, immediate notification, checkpoints, restart recovery, soft failures, rollback, dry/auth/health, concurrent ETag refresh');
