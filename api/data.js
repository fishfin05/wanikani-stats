import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DATA = join(process.cwd(), "data");

function loadJson(name) {
  const path = join(DATA, `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

function buildApiData() {
  const subjects          = loadJson("subjects");
  const assignments       = loadJson("assignments");
  const reviewStats       = loadJson("review_statistics");
  const levelProgressions = loadJson("level_progressions");
  const jlpt              = JSON.parse(readFileSync(join(DATA, "jlpt.json"), "utf8"));

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

  return { items, levelProgressions: levelProgs, subjectLevel, jlptTotals, currentLevel };
}

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json(buildApiData());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
