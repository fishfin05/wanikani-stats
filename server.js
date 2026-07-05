import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { resolve, extname, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const kuromoji = require("kuromoji");

// Build tokenizer once at startup (async, dict loading takes ~1-2s)
let tokenizer = null;
kuromoji.builder({ dicPath: resolve(__dirname, "node_modules/kuromoji/dict") })
  .build((err, t) => {
    if (err) { console.error("kuromoji build error:", err.message); return; }
    tokenizer = t;
    console.log("  kuromoji tokenizer ready");
  });

const PORT = 3000;
const PUBLIC = resolve(__dirname, "public");
const DATA = resolve(__dirname, "data");

const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
};

function loadJson(name) {
  const path = `${DATA}/${name}.json`;
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

function buildApiData() {
  const subjects          = loadJson("subjects");
  const assignments       = loadJson("assignments");
  const reviewStats       = loadJson("review_statistics");
  const levelProgressions = loadJson("level_progressions");
  const jlpt              = JSON.parse(readFileSync(resolve(__dirname, "data/jlpt.json"), "utf8"));

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

  const items = subjects.map((s) => {
    const asgn  = assignmentBySubject[s.id] ?? {};
    const stats = statsBySubject[s.id] ?? {};
    const chars = s.data.characters ?? s.data.slug;
    // For kanji: direct lookup. For vocab: infer from hardest kanji in the word.
    const JLPT_ORDER = ["N5", "N4", "N3", "N2", "N1"];
    function jlptForChars(str) {
      if (!str) return null;
      if (jlpt[str]) return jlpt[str]; // direct kanji hit
      let hardest = null;
      for (const ch of str) {
        const lv = jlpt[ch];
        if (lv && (!hardest || JLPT_ORDER.indexOf(lv) > JLPT_ORDER.indexOf(hardest)))
          hardest = lv;
      }
      return hardest;
    }
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
    level:        lp.data.level,
    unlocked_at:  lp.data.unlocked_at,
    started_at:   lp.data.started_at,
    passed_at:    lp.data.passed_at,
  }));

  const metaPath = `${DATA}/meta.json`;
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  return { items, levelProgressions: levelProgs, subjectLevel, jlptTotals, currentLevel, syncedAt: meta.syncedAt ?? null, fromBlob: false };
}

const server = createServer((req, res) => {
  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "POST" && req.url === "/api/tokenize") {
    if (!tokenizer) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Tokenizer still loading — please retry in a moment" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { text } = JSON.parse(body);
        if (!text || typeof text !== "string") throw new Error("text field required");
        const raw = tokenizer.tokenize(text);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          tokens: raw.map((t) => ({
            surface:    t.surface_form,
            basic:      t.basic_form,
            reading:    t.reading,
            pos:        t.pos,
            pos_detail: t.pos_detail_1,
          })),
        }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === "/api/data") {
    try {
      const data = buildApiData();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // static file serving
  const urlPath = req.url.split("?")[0];
  const filePath = urlPath === "/"
    ? resolve(PUBLIC, "index.html")
    : resolve(PUBLIC, urlPath.slice(1));

  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "text/plain" });
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`WaniKani Stats running at http://localhost:${PORT}`);
  console.log(`(Run "node sync.js" first if you haven't synced data yet)`);
});
