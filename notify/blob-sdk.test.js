import assert from 'node:assert/strict';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { put } from '@vercel/blob';
import '../api/notify.js';
// Exercise the installed SDK, not just an injected put() mock. The dispatcher
// blocks every real network request and counts attempts without credentials.
const original = getGlobalDispatcher();
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
let attempts = 0;
mock.get('https://vercel.com').intercept({ path: /./, method: 'PUT' }).reply(() => {
  attempts++;
  return { statusCode: 503, data: JSON.stringify({ error: { code: 'service_unavailable' } }), responseOptions: { headers: { 'content-type': 'application/json' } } };
}).persist();
try {
  await assert.rejects(put('test.json', '{}', { access: 'private', token: 'vercel_blob_rw_teststore_testkey', abortSignal: AbortSignal.timeout(3000) }));
  assert.equal(attempts, 1);
  console.log('installed Blob SDK 2.5.0: transient PUT failure makes exactly 1 HTTP attempt');
} finally { setGlobalDispatcher(original); await mock.close(); }
