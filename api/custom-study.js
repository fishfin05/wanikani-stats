import { mergeCustomStudy } from './_custom-study-merge.js';

const blobPutDefault = (...args) => import('@vercel/blob').then(({ put }) => put(...args));
const blobGetDefault = (...args) => import('@vercel/blob').then(({ get }) => get(...args));
export function createHandler({ blobPut = blobPutDefault, blobGet = blobGetDefault, fetchFn = fetch } = {}) {
  return async function handler(req, res) {
    const origin = req.headers?.origin;
    if (origin === 'https://www.wanikani.com') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, x-wk-api-key');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'PUT'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    if (origin && origin !== 'https://www.wanikani.com') return res.status(403).json({ error: 'Origin not allowed' });
    const token = req.headers?.['x-wk-api-key'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const check = await fetchFn('https://api.wanikani.com/v2/user', { headers: { Authorization: `Bearer ${token.replace(/^\uFEFF/, '').trim()}`, 'Wanikani-Revision': '20170710' } });
      if (check.status === 401) return res.status(401).json({ error: 'Invalid WaniKani token' });
      if (!check.ok) return res.status(502).json({ error: 'Could not verify WaniKani token' });
      const { data } = await check.json();
      if (!data?.id) return res.status(401).json({ error: 'Invalid WaniKani token' });
      const pathname = `custom-study/${data.id}.json`;
      let existing = {};
      try {
        const result = await blobGet(pathname, { access: 'private' });
        if (result?.statusCode === 200 && result.stream) existing = await new Response(result.stream).json();
      } catch (e) { if (e?.status !== 404 && !/not found/i.test(e?.message ?? '')) throw e; }
      if (req.method === 'GET') return res.status(existing.updatedAt ? 200 : 200).json(existing.updatedAt ? existing : { empty: true });
      const body = req.body ?? {};
      if (Buffer.byteLength(JSON.stringify(body)) > 2 * 1024 * 1024) return res.status(413).json({ error: 'Payload too large' });
      const merged = mergeCustomStudy(existing, body);
      const updatedAt = new Date().toISOString();
      await blobPut(pathname, JSON.stringify({ ...merged, updatedAt }), { access: 'private', addRandomSuffix: false, allowOverwrite: true });
      return res.status(200).json({ srsState: merged.srsState, alternates: merged.alternates, logCount: merged.reviewLog.length, updatedAt });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  };
}
export default createHandler();
