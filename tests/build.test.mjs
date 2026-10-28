// What the build itself must keep true: one version for the app, its package and its crates — the command line's among
// them, which is in the app's installers and must say the app's version (cli.json's, /health's) — and the command line
// put in the installers as tauri.conf.json, scripts/sidecar.mjs and src-tauri/build.rs have it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sidecarName, plan } from "../scripts/sidecar.mjs";

/** A file of the repository, its line ends as Unix's (a Windows checkout may have made them \r\n). */
const read = (p) => readFileSync(fileURLToPath(new URL("../" + p, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("one version: package.json and its lock, tauri.conf.json, the Cargo workspace, each crate and Cargo.lock", () => {
  const v = JSON.parse(read("package.json")).version;
  assert.match(v, /^\d+\.\d+\.\d+$/);
  const lockJson = JSON.parse(read("package-lock.json"));
  assert.equal(lockJson.version, v, "package-lock.json");
  assert.equal(lockJson.packages[""].version, v, "package-lock.json's own package");
  assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, v, "tauri.conf.json");
  assert.equal((/\[workspace\.package\]\nversion = "([^"]+)"/.exec(read("Cargo.toml")) || [])[1], v, "Cargo.toml's [workspace.package]");
  for (const c of ["core", "src-tauri", "cli"]) {
    const toml = read(`${c}/Cargo.toml`);
    assert.match(toml, /^\[package\]\nname = "[^"]+"\nversion\.workspace = true$/m, `${c}/Cargo.toml takes the workspace's version`);
    assert.doesNotMatch(toml, /^version = "/m, `${c}/Cargo.toml has no version of its own`);
  }
  const lock = read("Cargo.lock");
  for (const name of ["smedcover", "smedcover-core", "smedcover-cli"]) assert.ok(lock.includes(`name = "${name}"\nversion = "${v}"\n`), `Cargo.lock: ${name} ${v}`);
});

test("the command line in the installers: externalBin, built before each build, git-ignored, never asked of plain cargo", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.deepEqual(conf.bundle.externalBin, ["binaries/smedcover"]);
  assert.match(conf.build.beforeBuildCommand, /&& npm run sidecar$/);
  assert.doesNotMatch(conf.build.beforeDevCommand, /sidecar/, "tauri dev bundles nothing");
  assert.equal(JSON.parse(read("package.json")).scripts.sidecar, "node scripts/sidecar.mjs");
  assert.match(read(".gitignore"), /^src-tauri\/binaries\/$/m);
  for (const p of ["src-tauri/tauri.linux.conf.json", "src-tauri/tauri.windows.conf.json"]) assert.equal(JSON.parse(read(p)).bundle, undefined, `${p} keeps the bundle's settings as they are`);
  // tauri-build is handed the configuration without it: plain cargo has no such file, and target/<profile>/smedcover is the command line's own
  assert.match(read("src-tauri/build.rs"), /patch\["bundle"\]\["externalBin"\] = serde_json::Value::Null;/);
  assert.match(read("src-tauri/build.rs"), /without_sidecar\(\);\n\s*tauri_build::build\(\)/);
});

test("Windows' copy of the command line: one name for the file naming the app, and the uninstaller's hook removing the folder", () => {
  const named = (p) => (/const APP_PATH: &str = "([^"]+)";/.exec(read(p)) || [])[1];
  assert.equal(named("cli/src/app.rs"), "app-path");
  assert.equal(named("src-tauri/src/install.rs"), "app-path", "install.rs writes what the command line reads");
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(conf.bundle.windows.nsis.installerHooks, "windows/hooks.nsh");
  const hooks = read("src-tauri/windows/hooks.nsh");
  assert.match(hooks, /^!macro NSIS_HOOK_POSTUNINSTALL$/m);
  for (const f of ["smedcover.exe", "app-path"]) assert.ok(hooks.includes(`Delete "$LOCALAPPDATA\\\${BUNDLEID}\\bin\\${f}"`), f);
  assert.ok(hooks.includes(`RMDir "$LOCALAPPDATA\\\${BUNDLEID}\\bin"`), "the folder, only when empty");
  assert.match(hooks, /\$\{If\} \$UpdateMode <> 1/, "not on an update");
  assert.match(read("src-tauri/src/install.rs"), /const IDENTIFIER: &str = "com\.cyven\.smedcover";/);
  assert.equal(conf.identifier, "com.cyven.smedcover", "${BUNDLEID} is the folder install.rs uses");
});

test("the sidecar's name and its build for each target", () => {
  assert.equal(sidecarName("aarch64-apple-darwin"), "smedcover-aarch64-apple-darwin");
  assert.equal(sidecarName("x86_64-apple-darwin"), "smedcover-x86_64-apple-darwin");
  assert.equal(sidecarName("x86_64-pc-windows-msvc"), "smedcover-x86_64-pc-windows-msvc.exe");
  assert.equal(sidecarName("x86_64-unknown-linux-gnu"), "smedcover-x86_64-unknown-linux-gnu");
  const base = ["build", "-p", "smedcover-cli", "--bin", "smedcover"];
  // this machine's: no --target, into the target folder's release/ (or debug/ for tauri build --debug), as the app's own build
  assert.deepEqual(plan("aarch64-apple-darwin", "aarch64-apple-darwin", false), { args: [...base, "--release"], built: join("release", "smedcover") });
  assert.deepEqual(plan("x86_64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", true), { args: base, built: join("debug", "smedcover") });
  assert.deepEqual(plan("x86_64-pc-windows-msvc", "x86_64-pc-windows-msvc", false), { args: [...base, "--release"], built: join("release", "smedcover.exe") });
  // another's (the Intel Mac's, built on an Apple-silicon runner): --target, into target/<triple>/
  assert.deepEqual(plan("x86_64-apple-darwin", "aarch64-apple-darwin", false), { args: [...base, "--release", "--target", "x86_64-apple-darwin"], built: join("x86_64-apple-darwin", "release", "smedcover") });
});
