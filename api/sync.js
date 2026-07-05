import { put, list } from "@vercel/blob";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const WK_API = "https://api.wanikani.com/v2";

async function wkFetch(url, apiKey) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Wanikani-Revision": "20170710",
    },
  });
  if (!res.ok) throw new Error(`WK API ${res.status} on ${url}`);
  return res.json();
}

async function fetchAll(endpoint, apiKey, updatedAfter) {
  const qs = updatedAfter ? `?updated_after=${encodeURIComponent(updatedAfter)}` : "";
  let url = `${WK_API}/${endpoint}${qs}`;
  const items = [];
  while (url) {
    const body = await wkFetch(url, apiKey);
    items.push(...body.data);
    url = body.pages?.next_url ?? null;
    if (url) await new Promise((r) => setTimeout(r, 150));
  }
  return items;
}

function mergeById(existing, updates) {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of updates) map.set(item.id, item);
  return Array.from(map.values());
}

function loadBundled(name) {
  const path = join(process.cwd(), "data", `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const apiKey = process.env.WANIKANI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "WANIKANI_API_KEY not configured" });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({
      error: "Vercel Blob storage not configured. Go to vercel.com → your project → Storage → Connect Store → Blob.",
    });
  }

  const started = Date.now();

  try {
    // Try to load existing blob data for incremental sync
    let existing = null;
    try {
      const { blobs } = await list({ prefix: "wk-dynamic" });
      if (blobs.length > 0) {
        const r = await fetch(blobs[0].url);
        if (r.ok) existing = await r.json();
      }
    } catch (e) {
      console.warn("Could not load existing blob:", e.message);
    }

    // On first sync (no blob), seed from bundled files so we only fetch deltas
    if (!existing) {
      const metaPath = join(process.cwd(), "data", "meta.json");
      const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
      existing = {
        syncedAt: meta.syncedAt ?? null,
        assignments: loadBundled("assignments"),
        reviewStats: loadBundled("review_statistics"),
        levelProgressions: loadBundled("level_progressions"),
      };
    }

    const updatedAfter = existing.syncedAt;
    const syncedAt = new Date().toISOString();

    // Fetch only items changed since last sync
    const newAssignments       = await fetchAll("assignments",        apiKey, updatedAfter);
    const newReviewStats       = await fetchAll("review_statistics",  apiKey, updatedAfter);
    const newLevelProgressions = await fetchAll("level_progressions", apiKey, updatedAfter);

    const assignments       = mergeById(existing.assignments,       newAssignments);
    const reviewStats       = mergeById(existing.reviewStats,       newReviewStats);
    const levelProgressions = mergeById(existing.levelProgressions, newLevelProgressions);

    await put("wk-dynamic.json", JSON.stringify({ syncedAt, assignments, reviewStats, levelProgressions }), {
      access: "public",
      addRandomSuffix: false,
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    res.status(200).json({
      ok: true,
      syncedAt,
      incremental: !!existing.syncedAt,
      updatedAfter,
      assignments: assignments.length,
      reviewStats: reviewStats.length,
      levelProgressions: levelProgressions.length,
      newItems: newAssignments.length + newReviewStats.length + newLevelProgressions.length,
      elapsed: `${elapsed}s`,
    });
  } catch (e) {
    console.error("Sync error:", e);
    res.status(500).json({ error: e.message, elapsed: `${((Date.now() - started) / 1000).toFixed(1)}s` });
  }
}
