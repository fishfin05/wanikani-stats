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

async function sync() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR);

  const started = Date.now();

  console.log("Syncing subjects...");
  const subjects = await fetchAll("subjects?types=radical,kanji,vocabulary", "subjects");
  writeFileSync(`${DATA_DIR}/subjects.json`, JSON.stringify(subjects));

  console.log("Syncing assignments...");
  const assignments = await fetchAll("assignments", "assignments");
  writeFileSync(`${DATA_DIR}/assignments.json`, JSON.stringify(assignments));

  console.log("Syncing review statistics...");
  const reviewStats = await fetchAll("review_statistics", "review_statistics");
  writeFileSync(`${DATA_DIR}/review_statistics.json`, JSON.stringify(reviewStats));

  console.log("Syncing level progressions...");
  const levelProgressions = await fetchAll("level_progressions", "level_progressions");
  writeFileSync(`${DATA_DIR}/level_progressions.json`, JSON.stringify(levelProgressions));

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
