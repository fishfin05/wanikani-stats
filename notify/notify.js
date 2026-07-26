#!/usr/bin/env node
// Command-line front end for the notifier — the decision logic all lives in
// engine.js; this only handles file-backed state and console output.
//
// Kept for local testing and manual runs. The live notifier now runs as
// /api/notify on Vercel, pinged from outside, because GitHub's scheduler was
// dropping roughly five of every six runs.
//
//   node notify/notify.js            # normal run (may send a notification)
//   node notify/notify.js --dry-run  # decide + print, never send
//   node notify/notify.js --force    # ignore DND/cooldown/thresholds, send now
//
// Env: WANIKANI_API_KEY (required), NTFY_TOPIC (required unless --dry-run),
//      NTFY_SERVER (optional, defaults to https://ntfy.sh)

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { runNotifier } from "./engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "config.json");
const STATE_PATH = resolve(__dirname, "..", ".notify-state", "state.json");

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null; // engine normalizes this to "nothing announced yet"
  }
}

// Best-effort: by the time this runs a notification may already have been sent,
// so failing here must not fail the run. Losing the write costs at most one
// duplicate notification, which beats a red workflow and an alarming failure
// email for something already delivered.
function saveState(state) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, "state_changed=true\n");
    }
  } catch (e) {
    console.warn(`warning: could not persist notifier state (${e.message})`);
  }
}

async function main() {
  const apiKey = process.env.WANIKANI_API_KEY?.trim();
  if (!apiKey) throw new Error("WANIKANI_API_KEY is not set");

  const topic = process.env.NTFY_TOPIC?.trim();
  const server = process.env.NTFY_SERVER?.trim();
  if (!topic && !DRY_RUN) throw new Error("NTFY_TOPIC is not set");

  const before = loadState();
  const { state, notes, log } = await runNotifier({
    apiKey,
    topic,
    server,
    config: JSON.parse(readFileSync(CONFIG_PATH, "utf8")),
    state: before,
    dryRun: DRY_RUN,
    force: FORCE,
  });

  for (const n of notes) console.log(`note: ${n}`);
  // Persist even on runs that stay quiet, so a baseline that followed the queue
  // down isn't re-raised by the next run. Skipped on dry runs so testing locally
  // can't consume a batch the real run should have announced.
  if (!DRY_RUN && JSON.stringify(state) !== JSON.stringify(before)) saveState(state);
  console.log(log);
}

main().catch((e) => {
  console.error("notify failed:", e.message);
  process.exit(1);
});
