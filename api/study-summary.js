import { summarizeStudy } from "./_study-summary.js";

// GET /api/study-summary?tz=America/Los_Angeles  (header X-Wk-Api-Key)
// Reads the private Custom Study backup for the key's WaniKani account and
// returns study minutes + per-direction progress. Never writes anything.
const blobGetDefault = (...args) => import("@vercel/blob").then(({ get }) => get(...args));

export function createHandler({ blobGet = blobGetDefault, fetchFn = fetch } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    const token = String(req.headers?.["x-wk-api-key"] ?? "").replace(/^﻿/, "").trim();
    if (!token) return res.status(401).json({ error: "Add your WaniKani API key first" });
    try {
      const check = await fetchFn("https://api.wanikani.com/v2/user", { headers: { Authorization: `Bearer ${token}`, "Wanikani-Revision": "20170710" } });
      if (check.status === 401) return res.status(401).json({ error: "Invalid WaniKani token" });
      if (!check.ok) return res.status(502).json({ error: "Could not verify WaniKani token" });
      const { data } = await check.json();
      if (!data?.id) return res.status(401).json({ error: "Invalid WaniKani token" });
      let backup = {};
      try {
        const result = await blobGet(`custom-study/${data.id}.json`, { access: "private" });
        if (result?.statusCode === 200 && result.stream) backup = await new Response(result.stream).json();
      } catch (e) { if (e?.status !== 404 && !/not found/i.test(e?.message ?? "")) throw e; }
      const url = new URL(req.url ?? "/", "http://localhost");
      return res.status(200).json(summarizeStudy(backup, { timeZone: url.searchParams.get("tz") }));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  };
}

export default createHandler();
