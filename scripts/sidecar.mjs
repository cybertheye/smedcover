// Builds the command line, smedcover (cli/, the package smedcover-cli), for the target the app is built for, and copies
// it to src-tauri/binaries/smedcover-<target triple>[.exe], where tauri.conf.json's bundle.externalBin has the bundler
// find it and put it beside the app's own executable: SmedCover.app/Contents/MacOS/smedcover, /usr/bin/smedcover from
// the .deb and the .rpm, smedcover.exe in the folder the Windows installers install to. Runs before every `tauri build`
// (beforeBuildCommand), which says the target in TAURI_ENV_TARGET_TRIPLE (--target's, else this machine's) and
// TAURI_ENV_DEBUG=true for --debug: the command line is then built in debug too, else in release. A target other than
// this machine's is passed to cargo as --target (the Intel Mac's app, built on an Apple-silicon one); this machine's is
// built without, into the target/ folder the app's own build uses. The folder is git-ignored, and plain cargo never
// needs it (src-tauri/build.rs). Usage: node scripts/sidecar.mjs [target triple]
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The file the bundler looks for, for `triple`: smedcover-<triple>, with .exe for Windows (tauri-utils' external_binaries). */
export const sidecarName = (triple) => `smedcover-${triple}${triple.includes("windows") ? ".exe" : ""}`;

/**
 * How the command line is built for `triple` on a machine whose own is `host`, in debug or release: cargo's arguments
 * (--target only for another machine's), and where cargo puts it, under its target folder.
 */
export function plan(triple, host, debug) {
  const args = ["build", "-p", "smedcover-cli", "--bin", "smedcover"];
  if (!debug) args.push("--release");
  if (triple !== host) args.push("--target", triple);
  const exe = "smedcover" + (triple.includes("windows") ? ".exe" : "");
  return { args, built: path.join(...(triple !== host ? [triple] : []), debug ? "debug" : "release", exe) };
}

/** Whether this file is the one node was told to run (through a link too), not one a test imports. */
const ran = (() => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]).toLowerCase() === fs.realpathSync(fileURLToPath(import.meta.url)).toLowerCase(); } catch { return false; } })();
if (ran) {
  const host = /^host: (.+)$/m.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1].trim();
  const triple = process.argv[2] || process.env.TAURI_ENV_TARGET_TRIPLE || host;
  if (triple.startsWith("universal-")) { console.error("sidecar: a universal macOS build is not made: build aarch64-apple-darwin and x86_64-apple-darwin each on its own"); process.exit(1); }
  const debug = process.env.TAURI_ENV_DEBUG === "true";
  const { args, built } = plan(triple, host, debug);
  console.log(`sidecar: cargo ${args.join(" ")}`);
  const run = spawnSync("cargo", args, { cwd: ROOT, stdio: "inherit" });
  if (run.error) { console.error(`sidecar: cargo could not be run: ${run.error.message}`); process.exit(1); }
  if (run.status !== 0) process.exit(run.status || 1);   // a signal leaves no status
  const { target_directory } = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }));
  const from = path.join(target_directory, built), to = path.join(ROOT, "src-tauri", "binaries", sidecarName(triple));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.chmodSync(to, 0o755);
  console.log(`sidecar: ${path.relative(ROOT, to)} (${debug ? "debug" : "release"}, ${(fs.statSync(to).size / 1048576).toFixed(1)} MB)`);
}
