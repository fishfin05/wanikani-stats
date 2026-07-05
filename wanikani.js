import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, ".env");
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
}

async function waniKaniFetch(endpoint) {
  const res = await fetch(`https://api.wanikani.com/v2/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${process.env.WANIKANI_API_KEY}`,
      "Wanikani-Revision": "20170710",
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

async function main() {
  loadEnv();

  const key = process.env.WANIKANI_API_KEY;
  if (!key || key === "your_api_key_here") {
    console.error("Set your WANIKANI_API_KEY in the .env file first.");
    process.exit(1);
  }

  console.log("Connecting to WaniKani...\n");

  const { data: user } = await waniKaniFetch("user");

  console.log("=== WaniKani Account ===");
  console.log(`Username:     ${user.username}`);
  console.log(`Level:        ${user.level}`);
  console.log(`Started:      ${new Date(user.started_at).toLocaleDateString()}`);
  console.log(`Subscription: ${user.subscription.type}`);

  console.log("\nConnection successful!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
