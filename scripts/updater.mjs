// The updater's files, for the releases built on GitHub (.github/workflows/build.yml). `tauri build` with
// src-tauri/tauri.release.conf.json signs each installer the app can update itself from, with the key in the
// repository's secrets (TAURI_SIGNING_PRIVATE_KEY and its password): a `.sig` beside it, minisign's signature as base64
// (Ed25519 over the file's BLAKE2b-512, and over a trusted comment naming the version signed). The app checks a download
// against the public key, tauri.conf.json's plugins.updater.pubkey, before it installs it; this checks the same, with
// nothing but Node's own crypto, and writes the release's latest.json, the manifest the updater reads: the version, and
// for each platform the file's link and its signature, under `{os}-{arch}-{installer}`, which the updater looks for first
// (tauri-plugin-updater's Installer: the kind of bundle the running app came from), and `{os}-{arch}`, its fallback.
//
//   node scripts/updater.mjs verify <folder>...
//     every installer the app updates from in the folders (a bundle folder, as `tauri build` leaves it) has its .sig,
//     made with the key the app has, for this version; folders that are not there are passed over, one at least must be
//   node scripts/updater.mjs manifest <folder> --repo <owner/name> --tag <tag> [--out <file>]
//     the same for a release's files, downloaded into <folder>, then its latest.json, its links the release's own
import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** What each operating system's fallback, `{os}-{arch}`, is, the first there is: Windows' NSIS installer, Linux's AppImage. */
const FALLBACK = { darwin: ["app"], windows: ["nsis", "msi"], linux: ["appimage", "deb", "rpm"] };

/** The entries every release's manifest must have: one for each installer the builds of build.yml's matrix make. */
export const REQUIRED = [
  "darwin-aarch64-app", "darwin-x86_64-app",
  "windows-x86_64-nsis", "windows-x86_64-msi",
  "linux-x86_64-appimage", "linux-x86_64-deb", "linux-x86_64-rpm",
];

/** Whether a file is one the app updates itself from (in a bundle folder or on a release), so one that is signed. */
export const isUpdaterPackage = (name) => /(\.app\.tar\.gz|-setup\.exe|\.msi|\.AppImage|\.deb|\.rpm)$/.test(name);

/**
 * What a release's file updates, by its name as tauri-action uploads it: `{os, arch, installer}` in the updater's words,
 * or null for a file it does not update from (a .dmg, a .sig, the command line alone).
 */
export function updaterTarget(name) {
  const arch = (a) => ({ x64: "x86_64", amd64: "x86_64", x86_64: "x86_64", aarch64: "aarch64", arm64: "aarch64" })[a];
  const kinds = [
    [/_(x64|aarch64)\.app\.tar\.gz$/, "darwin", "app"],
    [/_(x64|arm64)-setup\.exe$/, "windows", "nsis"],
    [/_(x64|arm64)_[A-Za-z]+-[A-Za-z]+\.msi$/, "windows", "msi"],
    [/_(amd64|aarch64)\.AppImage$/, "linux", "appimage"],
    [/_(amd64|arm64)\.deb$/, "linux", "deb"],
    [/\.(x86_64|aarch64)\.rpm$/, "linux", "rpm"],
  ];
  for (const [re, os, installer] of kinds) {
    const m = re.exec(name);
    if (m) return { os, arch: arch(m[1]), installer };
  }
  return null;
}

/** The lines of a minisign file Tauri hands about as base64 (a public key, a signature). */
const linesOf = (b64) => Buffer.from(String(b64).trim(), "base64").toString("utf8").split(/\r?\n/);

/** An Ed25519 public key's DER, the 32 bytes after this. */
const SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** A minisign public key, as tauri.conf.json has it: its id (8 bytes) and the key. */
export function publicKey(pubkey) {
  const raw = Buffer.from(linesOf(pubkey)[1] || "", "base64");
  if (raw.length !== 42 || raw.toString("latin1", 0, 2) !== "Ed") throw new Error("not a minisign public key");
  return { id: raw.subarray(2, 10), key: createPublicKey({ key: Buffer.concat([SPKI, raw.subarray(10)]), format: "der", type: "spki" }) };
}

/**
 * Checks `bytes` against a `.sig`'s contents and the public key, as the updater does, and returns the trusted comment's
 * fields (`timestamp`, `file`, `version`). Throws, saying why, when the signature is another key's, does not match the
 * bytes, or its trusted comment is not signed.
 */
export function checkSignature(bytes, signature, pubkey) {
  const [, sigLine, trustedLine, globalLine] = linesOf(signature);
  const sig = Buffer.from(sigLine || "", "base64");
  const alg = sig.toString("latin1", 0, 2);
  if (sig.length !== 74 || (alg !== "ED" && alg !== "Ed")) throw new Error("not a minisign signature");
  const { id, key } = publicKey(pubkey);
  if (!sig.subarray(2, 10).equals(id)) throw new Error("signed with another key");
  // "ED": the file's BLAKE2b-512 is signed (what Tauri makes); "Ed", minisign's legacy, the file itself
  const signed = alg === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  if (!verify(null, signed, key, sig.subarray(10))) throw new Error("the signature does not match the file");
  const prefix = "trusted comment: ";
  if (!trustedLine || !trustedLine.startsWith(prefix)) throw new Error("no trusted comment");
  const comment = trustedLine.slice(prefix.length);
  if (!verify(null, Buffer.concat([sig.subarray(10), Buffer.from(comment, "utf8")]), key, Buffer.from(globalLine || "", "base64"))) {
    throw new Error("the trusted comment is not signed");
  }
  return Object.fromEntries(comment.split("\t").map((f) => [f.slice(0, f.indexOf(":")), f.slice(f.indexOf(":") + 1)]));
}

/**
 * The manifest for a release: `files` are its updater files, `{name, signature}`, named as on the release, which the links
 * point at (`https://github.com/<repo>/releases/download/<tag>/<name>`). Each is under `{os}-{arch}-{installer}`, and the
 * first of each system's FALLBACK under `{os}-{arch}` too; the entries sorted, so one release always writes the same.
 */
export function manifest({ version, notes = "", pubDate, repo, tag, files }) {
  const entries = {};
  for (const { name, signature } of files) {
    const t = updaterTarget(name);
    if (!t) continue;
    const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
    entries[`${t.os}-${t.arch}-${t.installer}`] = { signature, url };
  }
  for (const key of Object.keys(entries)) {
    const [os, arch] = key.split("-");
    const first = FALLBACK[os].map((i) => entries[`${os}-${arch}-${i}`]).find(Boolean);
    entries[`${os}-${arch}`] = first;
  }
  const platforms = Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));
  return { version, notes, pub_date: pubDate, platforms };
}

/** The updater files under `dir` (not inside an .app or an AppDir, which a bundle folder holds as well). */
function packagesIn(dir) {
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/\.(app|AppDir)$/.test(e.name)) found.push(...packagesIn(p));
    } else if (isUpdaterPackage(e.name)) found.push(p);
  }
  return found;
}

/** Checks each file against its .sig and the version: the trusted comment's fields of each, or the problems found. */
function checkFiles(files, pubkey, version) {
  const problems = [];
  const checked = [];
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    if (!fs.existsSync(file + ".sig")) { problems.push(`${rel}: no .sig beside it`); continue; }
    const signature = fs.readFileSync(file + ".sig", "utf8").trim();
    try {
      const fields = checkSignature(fs.readFileSync(file), signature, pubkey);
      if (fields.version !== version) problems.push(`${rel}: signed for version ${fields.version || "(none)"}, not ${version}`);
      else checked.push({ file, name: path.basename(file), signature, rel });
    } catch (e) {
      problems.push(`${rel}: ${e.message}`);
    }
  }
  return { checked, problems };
}

function fail(lines) {
  for (const l of [].concat(lines)) console.error(`updater: ${l}`);
  process.exit(1);
}

/** Whether this file is the one node was told to run (through a link too), not one a test imports. */
const ran = (() => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]).toLowerCase() === fs.realpathSync(fileURLToPath(import.meta.url)).toLowerCase(); } catch { return false; } })();
if (ran) {
  const [command, ...rest] = process.argv.slice(2);
  const flags = {};
  const folders = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
    else folders.push(rest[i]);
  }
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
  const pubkey = conf.plugins?.updater?.pubkey;
  if (!pubkey) fail("tauri.conf.json has no plugins.updater.pubkey");
  const version = conf.version;

  if (command === "verify") {
    const there = folders.filter((f) => fs.existsSync(f));
    if (!there.length) fail(`none of these folders is there: ${folders.join(", ") || "(none given)"}`);
    const files = there.flatMap(packagesIn);
    if (!files.length) fail(`no installer the app updates from in ${there.join(", ")}`);
    const { checked, problems } = checkFiles(files, pubkey, version);
    if (problems.length) fail(problems);
    for (const c of checked) console.log(`updater: ${c.rel}: signed for ${version}`);
  } else if (command === "manifest") {
    const [dir] = folders;
    if (!dir || !flags.repo || !flags.tag) fail("usage: manifest <folder> --repo <owner/name> --tag <tag> [--out <file>]");
    if (flags.tag !== `v${version}`) fail(`the tag is ${flags.tag}, the version v${version}`);
    const files = fs.readdirSync(dir).filter((n) => updaterTarget(n)).map((n) => path.join(dir, n));
    const { checked, problems } = checkFiles(files, pubkey, version);
    if (problems.length) fail(problems);
    const m = manifest({ version, pubDate: new Date().toISOString(), repo: flags.repo, tag: flags.tag, files: checked });
    const missing = REQUIRED.filter((k) => !m.platforms[k]);
    if (missing.length) fail(`no signed file for ${missing.join(", ")}`);
    const json = JSON.stringify(m, null, 2) + "\n";
    if (flags.out) fs.writeFileSync(flags.out, json);
    else process.stdout.write(json);
    console.error(`updater: latest.json for ${version}: ${Object.keys(m.platforms).join(", ")}`);
  } else {
    fail("usage: node scripts/updater.mjs verify <folder>... | manifest <folder> --repo <owner/name> --tag <tag> [--out <file>]");
  }
}
