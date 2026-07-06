import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "data");

function loadApiKey() {
  if (process.env.WANIKANI_API_KEY) return process.env.WANIKANI_API_KEY;
  try {
    const lines = readFileSync(resolve(__dirname, ".env"), "utf8").split("\n");
    for (const line of lines) {
      const [key, ...rest] = line.split("=");
      if (key?.trim() === "WANIKANI_API_KEY") return rest.join("=").trim();
    }
  } catch {}
  throw new Error("WANIKANI_API_KEY not found in process.env or .env file");
}

const API_KEY = loadApiKey();

async function wkFetch(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Wanikani-Revision": "20170710",
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchAll(endpoint, label) {
  let url = `https://api.wanikani.com/v2/${endpoint}`;
  const items = [];
  let page = 1;

  while (url) {
    process.stdout.write(`\r  ${label}: page ${page}, ${items.length} fetched...`);
    const body = await wkFetch(url);
    items.push(...body.data);
    url = body.pages?.next_url ?? null;
    page++;
    if (url) await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\r  ${label}: ${items.length} total               `);
  return items;
}

// Only keep fields used by api/data.js — cuts subjects from ~22MB to ~700KB
function slimSubject(s) {
  return {
    id: s.id,
    type: s.object,
    level: s.data.level,
    characters: s.data.characters ?? s.data.slug,
    meanings: (s.data.meanings ?? []).map((m) => m.meaning),
    readings: (s.data.readings ?? []).map((r) => r.reading),
  };
}
function slimAssignment(a) {
  return {
    id: a.id, subject_id: a.data.subject_id, srs_stage: a.data.srs_stage,
    passed_at: a.data.passed_at ?? null, burned_at: a.data.burned_at ?? null,
    unlocked_at: a.data.unlocked_at ?? null,
  };
}
function slimReviewStat(s) {
  return {
    id: s.id, subject_id: s.data.subject_id,
    meaning_correct: s.data.meaning_correct ?? 0,
    meaning_incorrect: s.data.meaning_incorrect ?? 0,
    reading_correct: s.data.reading_correct ?? 0,
    reading_incorrect: s.data.reading_incorrect ?? 0,
    percentage_correct: s.data.percentage_correct ?? null,
  };
}
function slimLevelProg(lp) {
  return {
    id: lp.id, level: lp.data.level,
    unlocked_at: lp.data.unlocked_at ?? null,
    started_at: lp.data.started_at ?? null,
    passed_at: lp.data.passed_at ?? null,
  };
}

async function sync() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR);

  const started = Date.now();

  console.log("Syncing subjects...");
  const subjects = await fetchAll("subjects?types=radical,kanji,vocabulary", "subjects");
  writeFileSync(`${DATA_DIR}/subjects.json`, JSON.stringify(subjects.map(slimSubject)));

  console.log("Syncing assignments...");
  const assignments = await fetchAll("assignments", "assignments");
  writeFileSync(`${DATA_DIR}/assignments.json`, JSON.stringify(assignments.map(slimAssignment)));

  console.log("Syncing review statistics...");
  const reviewStats = await fetchAll("review_statistics", "review_statistics");
  writeFileSync(`${DATA_DIR}/review_statistics.json`, JSON.stringify(reviewStats.map(slimReviewStat)));

  console.log("Syncing level progressions...");
  const levelProgressions = await fetchAll("level_progressions", "level_progressions");
  writeFileSync(`${DATA_DIR}/level_progressions.json`, JSON.stringify(levelProgressions.map(slimLevelProg)));

  const syncedAt = new Date().toISOString();
  writeFileSync(`${DATA_DIR}/meta.json`, JSON.stringify({ syncedAt }));

  console.log(`\nSync complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  ${subjects.length} subjects, ${assignments.length} assignments`);
  console.log(`  ${reviewStats.length} review_statistics, ${levelProgressions.length} level_progressions`);
}

sync().catch((err) => {
  console.error("\nSync failed:", err.message);
  process.exit(1);
});
