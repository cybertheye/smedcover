// Writes ui/repaint-styles/index.json: the list of built-in repaint styles, read from the file names
// in that folder ("中文名_English name.md"). Runs before every build (see tauri.conf.json); `npm test`
// fails if the list and the folder disagree. Usage: node scripts/repaint-styles.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleIndex } from "../ui/js/repaint.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui", "repaint-styles");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
const { styles, errors } = styleIndex(files, (f) => fs.readFileSync(path.join(dir, f), "utf8"));
if (errors.length) { console.error("repaint styles:\n  " + errors.join("\n  ")); process.exit(1); }
const out = JSON.stringify(styles, null, 2) + "\n", target = path.join(dir, "index.json");
if (process.argv.includes("--check")) {
  const now = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (now !== out) { console.error("ui/repaint-styles/index.json is out of date: run  npm run styles"); process.exit(1); }
} else {
  fs.writeFileSync(target, out);
  console.log(`repaint styles: ${styles.length} — ${styles.map((s) => s.name.zh).join(", ")}`);
}
