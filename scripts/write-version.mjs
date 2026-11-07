// Copies the version from package.json into public/version.json so the
// dashboard header can show it. Run after every version bump: npm run version:write
import { readFileSync, writeFileSync } from "fs";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
writeFileSync(new URL("../public/version.json", import.meta.url), JSON.stringify({ version }) + "\n");
console.log(`public/version.json -> ${version}`);
