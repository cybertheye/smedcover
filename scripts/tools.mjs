// Writes ui/tools.json: the agent tools (ui/js/tools.js) as the host's MCP endpoint lists them — their names,
// descriptions, schemas and hints, and what the host reads of each under x-smedcover. Runs before every build (see
// tauri.conf.json); `npm test` fails if the file and tools.js disagree. Usage: node scripts/tools.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toolsText, TOOLS } from "../ui/js/tools.js";

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui", "tools.json"), out = toolsText();
if (process.argv.includes("--check")) {
  const now = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (now !== out) { console.error("ui/tools.json is out of date: run npm run tools"); process.exit(1); }
} else {
  fs.writeFileSync(target, out);
  console.log(`tools: ${TOOLS.length} — ${TOOLS.map((d) => d.name).join(", ")}`);
}
