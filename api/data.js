import { list, get } from "@vercel/blob";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DATA = join(process.cwd(), "data");

function loadJson(name) {
  const path = join(DATA, `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

async function loadDynamic() {
  // Try Vercel Blob first (kept fresh by daily cron). The store is private,
  // so blobs must be read with get() (authenticated) rather than a plain
  // fetch() of the blob URL.
  try {
    const { blobs } = await list({ prefix: "wk-dynamic" });
    if (blobs.length > 0) {
      const result = await get(blobs[0].pathname, { access: "private" });
      if (result?.statusCode === 200 && result.stream) {
        const blob = await new Response(result.stream).json();
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
  const subjects   = loadJson("subjects");
  const jlpt       = JSON.parse(readFileSync(join(DATA, "jlpt.json"), "utf8"));
  const jlptVocab  = JSON.parse(readFileSync(join(DATA, "jlpt_vocab.json"), "utf8"));
  const dynamic    = await loadDynamic();
  const { assignments, reviewStats, levelProgressions, syncedAt, fromBlob } = dynamic;

  const assignmentBySubject = {};
  for (const a of assignments) assignmentBySubject[a.subject_id] = a;

  const statsBySubject = {};
  for (const s of reviewStats) statsBySubject[s.subject_id] = s;

  const subjectLevel = {};
  for (const s of subjects) subjectLevel[s.id] = s.level;

  const jlptTotals = {};
  for (const level of Object.values(jlpt)) jlptTotals[level] = (jlptTotals[level] || 0) + 1;

  // Reference-list totals for the vocab proficiency metric — see data/SOURCES.md.
  // Only ~53% of WK vocab has an exact match in this list; unmatched words are
  // simply not counted toward JLPT-vocab percentages (not guessed at).
  const vocabTotals = {};
  for (const level of Object.values(jlptVocab)) vocabTotals[level] = (vocabTotals[level] || 0) + 1;

  // Which reference-list entries WK doesn't teach at all, per level — lets the
  // UI show the actual characters/words behind the "WK covers X/Y ⚠" note
  // instead of just a count.
  const wkKanjiChars = new Set(subjects.filter((s) => s.type === "kanji").map((s) => s.characters));
  const wkVocabWords = new Set(subjects.filter((s) => s.type === "vocabulary").map((s) => s.characters));
  const jlptGapKanji = {};
  for (const [ch, lvl] of Object.entries(jlpt)) {
    if (!wkKanjiChars.has(ch)) (jlptGapKanji[lvl] ??= []).push(ch);
  }
  const jlptGapVocab = {};
  for (const [word, lvl] of Object.entries(jlptVocab)) {
    if (!wkVocabWords.has(word)) (jlptGapVocab[lvl] ??= []).push(word);
  }

  const currentLevel = levelProgressions.reduce((max, lp) =>
    lp.started_at ? Math.max(max, lp.level) : max, 0);

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
    return {
      id:                s.id,
      type:              s.type,
      level:             s.level,
      characters:        s.characters,
      meanings:          s.meanings,
      readings:          s.readings,
      jlpt:              jlptForChars(s.characters),
      jlptExact:         s.type === "vocabulary" ? (jlptVocab[s.characters] ?? null) : null,
      srs_stage:         asgn.srs_stage ?? -1,
      passed_at:         asgn.passed_at ?? null,
      burned_at:         asgn.burned_at ?? null,
      unlocked_at:       asgn.unlocked_at ?? null,
      available_at:      asgn.available_at ?? null,
      meaning_correct:   stats.meaning_correct ?? 0,
      meaning_incorrect: stats.meaning_incorrect ?? 0,
      reading_correct:   stats.reading_correct ?? 0,
      reading_incorrect: stats.reading_incorrect ?? 0,
      pct_correct:       stats.percentage_correct ?? null,
    };
  });

  const levelProgs = levelProgressions.map((lp) => ({
    level:       lp.level,
    unlocked_at: lp.unlocked_at,
    started_at:  lp.started_at,
    passed_at:   lp.passed_at,
  }));

  return { items, levelProgressions: levelProgs, subjectLevel, jlptTotals, vocabTotals, jlptGapKanji, jlptGapVocab, currentLevel, syncedAt, fromBlob };
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
