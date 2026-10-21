import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler } from './custom-study.js';
const db = new Map();
let authStatus = 200;
const handler = createHandler({
  fetchFn: async () => ({ status: authStatus, ok: authStatus === 200, json: async () => ({ data: { id: 77 } }) }),
  blobGet: async key => db.has(key) ? { statusCode: 200, stream: Readable.from([JSON.stringify(db.get(key))]) } : null,
  blobPut: async (key, value) => db.set(key, JSON.parse(value)),
});
function response() { return { headers: {}, setHeader(k,v){this.headers[k]=v}, status(n){this.code=n;return this}, json(v){this.body=v;return this}, end(){return this} }; }
async function call(method, body) { const res=response(); await handler({ method, body, headers:{ origin:'https://www.wanikani.com', 'x-wk-api-key':'token' } },res); return res; }
authStatus=401; assert.equal((await call('GET')).code,401); authStatus=200;
assert.deepEqual((await call('GET')).body,{empty:true});
const first=await call('PUT',{srsState:{'1:m':{lastAnsweredAt:'2024-01-01'}},alternates:{},logAppend:[{timestamp:'2024-01-01',subjectId:1,mode:'m'}]}); assert.equal(first.code,200);
const second=await call('PUT',{srsState:{'1:m':{lastAnsweredAt:'2024-01-02'}},alternates:{'1:meaning':['alt']},logAppend:[{timestamp:'2024-01-02',subjectId:1,mode:'m'}]}); assert.equal(second.body.srsState['1:m'].lastAnsweredAt,'2024-01-02');
const roundTrip=(await call('GET')).body; assert.equal(roundTrip.srsState['1:m'].lastAnsweredAt,'2024-01-02'); assert.equal(roundTrip.reviewLog.length,2); assert.deepEqual(roundTrip.alternates['1:meaning'],['alt']);
const cors=await call('OPTIONS'); assert.equal(cors.code,204); assert.equal(cors.headers['Access-Control-Allow-Origin'],'https://www.wanikani.com');
console.log('handler tests passed: auth, GET empty, PUT/GET, merge, CORS, OPTIONS');
