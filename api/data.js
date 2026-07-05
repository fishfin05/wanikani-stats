import { list } from "@vercel/blob";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DATA = join(process.cwd(), "data");

function loadJson(name) {
  const path = join(DATA, `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

async function loadDynamic() {
  // Try Vercel Blob first (kept fresh by daily cron)
  try {
    const { blobs } = await list({ prefix: "wk-dynamic" });
    if (blobs.length > 0) {
      const r = await fetch(blobs[0].url);
      if (r.ok) {
        const blob = await r.json();
        return {
          assignments: blob.assignments ?? [],
          reviewStats: blob.reviewStats ?? [],
          levelProgressions: blob.levelProgressions ?? [],
          syncedAt: blob.syncedAt ?? null,
          fromBlob: true,
        };
      }
    }
  } catch (e) {
    console.warn("Blob load failed, using bundled data:", e.message);
  }

  // Fall back to bundled files (from last deploy)
  const metaPath = join(DATA, "meta.json");
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  return {
    assignments: loadJson("assignments"),
    reviewStats: loadJson("review_statistics"),
    levelProgressions: loadJson("level_progressions"),
    syncedAt: meta.syncedAt ?? null,
    fromBlob: false,
  };
}

async function buildApiData() {
  const subjects = loadJson("subjects");
  const jlpt     = JSON.parse(readFileSync(join(DATA, "jlpt.json"), "utf8"));
  const dynamic  = await loadDynamic();
  const { assignments, reviewStats, levelProgressions, syncedAt, fromBlob } = dynamic;

  const assignmentBySubject = {};
  for (const a of assignments) assignmentBySubject[a.data.subject_id] = a.data;

  const statsBySubject = {};
  for (const s of reviewStats) statsBySubject[s.data.subject_id] = s.data;

  const subjectLevel = {};
  for (const s of subjects) subjectLevel[s.id] = s.data.level;

  const jlptTotals = {};
  for (const level of Object.values(jlpt)) jlptTotals[level] = (jlptTotals[level] || 0) + 1;

  const currentLevel = levelProgressions.reduce((max, lp) =>
    lp.data.started_at ? Math.max(max, lp.data.level) : max, 0);

  const JLPT_ORDER = ["N5", "N4", "N3", "N2", "N1"];
  function jlptForChars(str) {
    if (!str) return null;
    if (jlpt[str]) return jlpt[str];
    let hardest = null;
    for (const ch of str) {
      const lv = jlpt[ch];
      if (lv && (!hardest || JLPT_ORDER.indexOf(lv) > JLPT_ORDER.indexOf(hardest)))
        hardest = lv;
    }
    return hardest;
  }

  const items = subjects.map((s) => {
    const asgn  = assignmentBySubject[s.id] ?? {};
    const stats = statsBySubject[s.id] ?? {};
    const chars = s.data.characters ?? s.data.slug;
    return {
      id:                s.id,
      type:              s.object,
      level:             s.data.level,
      characters:        chars,
      meanings:          s.data.meanings?.map((m) => m.meaning) ?? [],
      readings:          s.data.readings?.map((r) => r.reading) ?? [],
      jlpt:              jlptForChars(chars),
      srs_stage:         asgn.srs_stage ?? -1,
      passed_at:         asgn.passed_at ?? null,
      burned_at:         asgn.burned_at ?? null,
      unlocked_at:       asgn.unlocked_at ?? null,
      meaning_correct:   stats.meaning_correct ?? 0,
      meaning_incorrect: stats.meaning_incorrect ?? 0,
      reading_correct:   stats.reading_correct ?? 0,
      reading_incorrect: stats.reading_incorrect ?? 0,
      pct_correct:       stats.percentage_correct ?? null,
    };
  });

  const levelProgs = levelProgressions.map((lp) => ({
    level:       lp.data.level,
    unlocked_at: lp.data.unlocked_at,
    started_at:  lp.data.started_at,
    passed_at:   lp.data.passed_at,
  }));

  return { items, levelProgressions: levelProgs, subjectLevel, jlptTotals, currentLevel, syncedAt, fromBlob };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    const data = await buildApiData();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
