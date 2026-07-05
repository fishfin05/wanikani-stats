import { createRequire } from "module";
import { join } from "path";

const require = createRequire(import.meta.url);
const kuromoji = require("kuromoji");

let _tokenizer = null;
let _initPromise = null;

function getTokenizer() {
  if (_tokenizer) return Promise.resolve(_tokenizer);
  if (_initPromise) return _initPromise;
  _initPromise = new Promise((resolve, reject) => {
    const dicPath = join(process.cwd(), "node_modules/kuromoji/dict");
    kuromoji.builder({ dicPath }).build((err, t) => {
      if (err) { _initPromise = null; reject(err); }
      else { _tokenizer = t; resolve(t); }
    });
  });
  return _initPromise;
}

// Warm up on module load so the first real request isn't delayed
getTokenizer().catch(() => {});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { text } = body ?? {};
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text field required" });
      return;
    }

    const tokenizer = await getTokenizer();
    const raw = tokenizer.tokenize(text);
    res.status(200).json({
      tokens: raw.map((t) => ({
        surface:    t.surface_form,
        basic:      t.basic_form,
        reading:    t.reading,
        pos:        t.pos,
        pos_detail: t.pos_detail_1,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
