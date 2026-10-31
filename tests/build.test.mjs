// What the build itself must keep true: one version for the app, its package and its crates — the command line's among
// them, which is in the app's installers and must say the app's version (cli.json's, /health's) — and the command line
// put in the installers as tauri.conf.json, scripts/sidecar.mjs and src-tauri/build.rs have it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sidecarName, plan } from "../scripts/sidecar.mjs";
import { REQUIRED, checkSignature, isUpdaterPackage, manifest, publicKey, updaterTarget } from "../scripts/updater.mjs";

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

test("the updater's signing: the public key in the app, the installers signed on GitHub only, their manifest written once", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(publicKey(conf.plugins.updater.pubkey).id.length, 8, "plugins.updater.pubkey is a minisign public key");
  assert.equal(conf.bundle.createUpdaterArtifacts, undefined, "a build of one's own needs no key");
  assert.deepEqual(JSON.parse(read("src-tauri/tauri.release.conf.json")), { bundle: { createUpdaterArtifacts: true } });
  const yml = read(".github/workflows/build.yml");
  assert.match(yml, /args: --config src-tauri\/tauri\.release\.conf\.json \$\{\{ matrix\.args \}\}/);
  for (const k of ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]) assert.ok(yml.includes(`${k}: \${{ secrets.${k} }}`), k);
  assert.match(yml, /includeUpdaterJson: false/, "not by each of the four jobs");
  assert.match(yml, /node scripts\/updater\.mjs verify target\/release\/bundle target\/\*\/release\/bundle/);
  assert.match(yml, /needs: build\n\s+if: startsWith\(github\.ref, 'refs\/tags\/'\)/);
  assert.match(yml, /node scripts\/updater\.mjs manifest release --repo "\$GITHUB_REPOSITORY" --tag "\$GITHUB_REF_NAME" --out latest\.json/);
});

test("what each of a release's files updates, and the manifest made of them", () => {
  // v0.5.0's files, as tauri-action named them
  assert.deepEqual(updaterTarget("SmedCover_aarch64.app.tar.gz"), { os: "darwin", arch: "aarch64", installer: "app" });
  assert.deepEqual(updaterTarget("SmedCover_x64.app.tar.gz"), { os: "darwin", arch: "x86_64", installer: "app" });
  assert.deepEqual(updaterTarget("SmedCover_0.5.0_x64-setup.exe"), { os: "windows", arch: "x86_64", installer: "nsis" });
  assert.deepEqual(updaterTarget("SmedCover_0.5.0_x64_en-US.msi"), { os: "windows", arch: "x86_64", installer: "msi" });
  assert.deepEqual(updaterTarget("SmedCover_0.5.0_amd64.AppImage"), { os: "linux", arch: "x86_64", installer: "appimage" });
  assert.deepEqual(updaterTarget("SmedCover_0.5.0_amd64.deb"), { os: "linux", arch: "x86_64", installer: "deb" });
  assert.deepEqual(updaterTarget("SmedCover-0.5.0-1.x86_64.rpm"), { os: "linux", arch: "x86_64", installer: "rpm" });
  for (const n of ["SmedCover_0.5.0_aarch64.dmg", "SmedCover_0.5.0_x64.dmg", "SmedCover_x64.app.tar.gz.sig", "latest.json", "smedcover-linux.tar.gz", "smedcover.exe"]) {
    assert.equal(updaterTarget(n), null, n);
  }
  // in a bundle folder, before tauri-action names them
  for (const n of ["SmedCover.app.tar.gz", "SmedCover_0.5.0_x64-setup.exe", "SmedCover_0.5.0_x64_en-US.msi", "SmedCover_0.5.0_amd64.AppImage", "SmedCover_0.5.0_amd64.deb", "SmedCover-0.5.0-1.x86_64.rpm"]) {
    assert.ok(isUpdaterPackage(n), n);
  }
  for (const n of ["SmedCover_0.5.0_x64.dmg", "SmedCover.app.tar.gz.sig", "smedcover.exe"]) assert.ok(!isUpdaterPackage(n), n);

  const names = ["SmedCover_aarch64.app.tar.gz", "SmedCover_x64.app.tar.gz", "SmedCover_0.6.0_x64-setup.exe", "SmedCover_0.6.0_x64_en-US.msi",
    "SmedCover_0.6.0_amd64.AppImage", "SmedCover_0.6.0_amd64.deb", "SmedCover-0.6.0-1.x86_64.rpm", "SmedCover_0.6.0_x64.dmg"];
  const m = manifest({ version: "0.6.0", pubDate: "2026-11-01T00:00:00.000Z", repo: "cybertheye/smedcover", tag: "v0.6.0", files: names.map((name) => ({ name, signature: `sig of ${name}` })) });
  assert.equal(m.version, "0.6.0");
  assert.equal(m.notes, "");
  assert.equal(m.pub_date, "2026-11-01T00:00:00.000Z");
  assert.deepEqual(Object.keys(m.platforms), ["darwin-aarch64", "darwin-aarch64-app", "darwin-x86_64", "darwin-x86_64-app", "linux-x86_64",
    "linux-x86_64-appimage", "linux-x86_64-deb", "linux-x86_64-rpm", "windows-x86_64", "windows-x86_64-msi", "windows-x86_64-nsis"]);
  for (const k of REQUIRED) assert.ok(m.platforms[k], k);
  assert.deepEqual(m.platforms["windows-x86_64-msi"], { signature: "sig of SmedCover_0.6.0_x64_en-US.msi", url: "https://github.com/cybertheye/smedcover/releases/download/v0.6.0/SmedCover_0.6.0_x64_en-US.msi" });
  // the fallback, for an app that cannot tell what it came from: the NSIS installer, the AppImage
  assert.equal(m.platforms["windows-x86_64"], m.platforms["windows-x86_64-nsis"]);
  assert.equal(m.platforms["linux-x86_64"], m.platforms["linux-x86_64-appimage"]);
  assert.equal(m.platforms["darwin-x86_64"].url, "https://github.com/cybertheye/smedcover/releases/download/v0.6.0/SmedCover_x64.app.tar.gz");
  // with no NSIS installer, the MSI
  const msiOnly = manifest({ version: "0.6.0", repo: "o/r", tag: "v0.6.0", files: [{ name: "SmedCover_0.6.0_x64_en-US.msi", signature: "s" }] });
  assert.equal(msiOnly.platforms["windows-x86_64"].url, "https://github.com/o/r/releases/download/v0.6.0/SmedCover_0.6.0_x64_en-US.msi");
});

test("a .sig checked as the updater checks it: the file, the key, the version in the signed comment", () => {
  // made with `tauri signer generate` (a key made for this test alone, not the app's) and `tauri signer sign --app-version 0.6.0`
  const pubkey = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IENGMjExNDcxRUM0QThFRjYKUldUMmprcnNjUlFoejRkb0NNSTkxTndUY0h6NVhITHEwK1RPUWRHYXVydFdXZGpZVmZoYnNhSVAK";
  const sig = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUMmprcnNjUlFoenpSaEcxSXBXM3pCRHoyQzFYTUJoK0kvK1JpZXB6OWlJVWM1OFpPdi9aNTlyYkFHaTFQRmVHUVMzeFVkU1dqZTV3WTc0R05oWEhpTjZqNmdKN2FuaHdnPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNDQ1Mjk3CWZpbGU6c2FtcGxlLmJpbgl2ZXJzaW9uOjAuNi4wCmFwRXBaR2lwUTRLblNBWVpjaFlNUUQ3R0JMaEx4OE15Zk5Pc0JQTmZHL3hwZDdYazlJalRJd2VGOXBpejZva2NaQm4vNFdrYXdwemlyMFlqOGZNa0JBPT0K";
  const file = Buffer.from("SmedCover updater test\n");
  assert.deepEqual(checkSignature(file, sig, pubkey), { timestamp: "1793445297", file: "sample.bin", version: "0.6.0" });
  assert.throws(() => checkSignature(Buffer.from("SmedCover updater test!\n"), sig, pubkey), /does not match the file/);
  const appKey = JSON.parse(read("src-tauri/tauri.conf.json")).plugins.updater.pubkey;
  assert.throws(() => checkSignature(file, sig, appKey), /another key/);
  // another version written into the comment: its own signature no longer holds
  const text = Buffer.from(sig, "base64").toString("utf8").replace("version:0.6.0", "version:0.6.1");
  assert.throws(() => checkSignature(file, Buffer.from(text).toString("base64"), pubkey), /trusted comment is not signed/);
  assert.throws(() => checkSignature(file, "not a signature", pubkey), /not a minisign signature/);
});

test("updates in the app: the plugin, where it reads, and the commands Settings → About calls", () => {
  assert.match(read("src-tauri/Cargo.toml"), /^tauri-plugin-updater = "2\.14"$/m, "2.14: the version signed in a package checked");
  const lib = read("src-tauri/src/lib.rs");
  assert.match(lib, /\.plugin\(tauri_plugin_updater::Builder::new\(\)\.build\(\)\)/);
  assert.match(lib, /\.manage\(update::Updates::default\(\)\)/);
  const app = read("ui/js/app.js");
  for (const cmd of ["update_status", "update_check", "update_download", "update_cancel", "update_install", "update_release_page", "selftest_updates"]) {
    assert.ok(lib.includes(`update::${cmd},`), `${cmd} is a command`);
    assert.ok(app.includes(`"${cmd}"`), `the page calls ${cmd}`);
  }
  const u = JSON.parse(read("src-tauri/tauri.conf.json")).plugins.updater;
  // the manifest the job `updater` puts on each release, the latest one's
  assert.deepEqual(u.endpoints, ["https://github.com/cybertheye/smedcover/releases/latest/download/latest.json"]);
  assert.equal(u.requireSignedVersion, true);
  assert.equal(u.windows.installMode, "passive");
  assert.match(read(".github/workflows/build.yml"), /gh release upload "\$GITHUB_REF_NAME" latest\.json/);
});

