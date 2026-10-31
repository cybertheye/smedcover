// The cut-out models as Settings shows them (ui/js/cutmodels.js): states, progress, errors, the way chosen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutErr, cutRow, cutProgress, progressText, pickCutEngine, filesByHand, mb, CUT_SOURCES } from "../ui/js/cutmodels.js";

const MB = 1048576;
const runtime = (have) => ({ what: "runtime", url: "https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-win-x64-1.23.2.zip", mirrors: [], bytes: 78 * MB, have });
const modelFile = (id, have, bytes = 224 * MB) => ({ what: "model", url: `https://huggingface.co/onnx-community/${id}/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model.onnx`, mirrors: [`https://hf-mirror.com/onnx-community/${id}/resolve/x/onnx/model.onnx`], bytes, have });

test("errors are told by their kind; a cancel is nothing", () => {
  assert.deepEqual(cutErr("network: huggingface.co (direct): timed out; hf-mirror.com (direct): HTTP 403"), { kind: "network", detail: "huggingface.co (direct): timed out; hf-mirror.com (direct): HTTP 403" });
  assert.deepEqual(cutErr(new Error("tls: github.com (the system's proxy 127.0.0.1:7890): invalid peer certificate: UnknownIssuer")).kind, "tls");
  for (const k of ["proxy", "http", "checksum", "disk", "file", "busy"]) assert.equal(cutErr(`${k}: x`).kind, k);
  assert.equal(cutErr("cancelled"), null);
  assert.equal(cutErr(""), null);
  assert.deepEqual(cutErr("unknown model: x"), { kind: "other", detail: "unknown model: x" });
  assert.deepEqual(cutErr("weird: thing"), { kind: "other", detail: "weird: thing" }, "only the kinds the core gives");
});

test("each model's row: busy, there, partly there, its file without the runtime, missing, unknown", () => {
  const m = { id: "birefnet-lite", bytes: 224 * MB, have: false, model: false, runtime: false, partial: 0, files: [runtime(0), modelFile("BiRefNet_lite-ONNX", 0)] };
  assert.deepEqual(cutRow(m), { state: "missing", mb: 224 });
  assert.deepEqual(cutRow(m, { id: "birefnet-lite" }), { state: "busy" });
  assert.deepEqual(cutRow(m, { id: "birefnet" }), { state: "missing", mb: 224 });
  assert.deepEqual(cutRow({ ...m, partial: 120 * MB, files: [runtime(30 * MB), modelFile("BiRefNet_lite-ONNX", 90 * MB)] }), { state: "partial", mb: 302, partMb: 120 });
  assert.deepEqual(cutRow({ ...m, model: true, files: [runtime(0), modelFile("BiRefNet_lite-ONNX", 224 * MB)] }), { state: "noRuntime", mb: 78 });
  assert.deepEqual(cutRow({ ...m, have: true, model: true, runtime: true }), { state: "have", mb: 224 });
  assert.deepEqual(cutRow(undefined), { state: "unknown" });
  // an older app's item, {id, bytes, have} alone
  assert.deepEqual(cutRow({ id: "birefnet", bytes: 972 * MB, have: false }), { state: "missing", mb: 972 });
});

test("progress: what it is doing, where it resumed, how it is connected", () => {
  const t = (k, ...a) => `${k}(${a.join(",")})`;
  const base = { id: "birefnet-lite", done: 120 * MB, total: 240 * MB, file: "model", source: "hf-mirror.com", via: "system", proxy: "127.0.0.1:7890", resumedFrom: 0 };
  assert.deepEqual(cutProgress({ id: "x", done: 50 * MB, total: 200 * MB }), [["cutset.progress", 25, 50, 200]], "an older app's payload");
  assert.deepEqual(cutProgress({ ...base, phase: "downloading" }), [["cutset.progressFrom", 50, 120, 240, { key: "cutset.file.model" }, "hf-mirror.com"], ["cutset.via.system", "127.0.0.1:7890"]]);
  assert.deepEqual(cutProgress({ ...base, phase: "downloading", resumedFrom: 60 * MB, via: "direct", proxy: null }).slice(1), [["cutset.resumed", 60], ["cutset.via.direct", ""]]);
  assert.deepEqual(cutProgress({ ...base, phase: "connecting", source: "huggingface.co" })[0], ["cutset.phase.connecting", "huggingface.co"]);
  assert.deepEqual(cutProgress({ ...base, phase: "connecting", retry: { from: "huggingface.co", why: "network: Connection Failed: Connect error: connection timed out", to: "hf-mirror.com" } })[0],
    ["cutset.phase.retrying", "huggingface.co", "Connection Failed: Connect error: connection timed out", "hf-mirror.com"]);
  assert.deepEqual(cutProgress({ ...base, phase: "connecting", retry: { from: "hf-mirror.com", why: "network: " + "x".repeat(200), to: "hf-mirror.com" } })[0][0], "cutset.phase.again");
  assert.equal(cutProgress({ ...base, phase: "connecting", retry: { from: "a", why: "x".repeat(200), to: "b" } })[0][2].length, 80);
  assert.deepEqual(cutProgress({ ...base, phase: "checking" }), [["cutset.phase.checking", 50]]);
  assert.deepEqual(cutProgress({ ...base, phase: "verifying" }), [["cutset.phase.verifying"]]);
  assert.deepEqual(cutProgress({ ...base, phase: "unpacking", file: "runtime" }), [["cutset.phase.unpacking"]]);
  assert.deepEqual(cutProgress({ ...base, phase: "importing", file: "runtime" }), [["cutset.phase.importing", 50, { key: "cutset.file.runtime" }]]);
  assert.equal(progressText(cutProgress({ ...base, phase: "downloading" }), t), "cutset.progressFrom(50,120,240,cutset.file.model(),hf-mirror.com) · cutset.via.system(127.0.0.1:7890)");
  assert.deepEqual(cutProgress(null), []);
});

test("the way of cutting out: as chosen on a computer, an installed model on a server", () => {
  const lite = { id: "birefnet-lite", have: true }, full = { id: "birefnet", have: true }, none = [{ id: "birefnet-lite", have: false }, { id: "birefnet", have: false }];
  // on a computer, what it always was
  for (const [chosen, mac, want] of [["", true, "vision"], ["", false, "birefnet-lite"], ["vision", true, "vision"], ["vision", false, "birefnet-lite"], ["birefnet", true, "birefnet"], ["birefnet-lite", false, "birefnet-lite"]]) {
    assert.equal(pickCutEngine(chosen, none, { mac }), want, `${chosen} ${mac}`);
  }
  // on a server, never Vision
  assert.equal(pickCutEngine("vision", [lite, full], { server: true }), "birefnet-lite");
  assert.equal(pickCutEngine("birefnet", [lite, full], { server: true }), "birefnet");
  assert.equal(pickCutEngine("", [{ id: "birefnet-lite", have: false }, full], { server: true }), "birefnet");
  assert.equal(pickCutEngine("birefnet", [lite, { id: "birefnet", have: false }], { server: true }), "birefnet-lite");
  assert.equal(pickCutEngine("birefnet", none, { server: true }), "birefnet");
  assert.equal(pickCutEngine("", none, { server: true, mac: true }), "birefnet-lite");
});

test("the files to download by hand: the runtime once, first, then each model", () => {
  const ms = [
    { id: "birefnet-lite", files: [runtime(0), modelFile("BiRefNet_lite-ONNX", 0)] },
    { id: "birefnet", files: [runtime(0), modelFile("BiRefNet-ONNX", 0, 972 * MB)] },
  ];
  const got = filesByHand(ms);
  assert.deepEqual(got.map((f) => [f.what, f.id]), [["runtime", "runtime"], ["model", "birefnet-lite"], ["model", "birefnet"]]);
  assert.equal(got[1].mirrors.length, 1);
  assert.deepEqual(filesByHand([{ id: "x", bytes: 1, have: false }]), [], "an older app's items have none");
  assert.equal(mb(1.6 * MB), 2);
  assert.deepEqual(CUT_SOURCES, ["auto", "huggingface", "hf-mirror"]);
});
