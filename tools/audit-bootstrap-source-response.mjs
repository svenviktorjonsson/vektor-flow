import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

// Diagnostic harness, not a replacement release gate or compiler frontend.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeBin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const compiler = join(nativeBin, "vkf-strict.exe");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(process.platform, "win32", "this audit uses the existing Windows stage fixture");
const workRoot = join(root, "build/bootstrap-source-response");
mkdirSync(workRoot, { recursive: true });
const work = mkdtempSync(join(workRoot, "run-"));
const manifest = JSON.parse(readFileSync(join(root, "compiler/self_hosted/vf-compiler-bootstrap.json"), "utf8"));
const fixturePath = join(root, "tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs");
const fixture = readFileSync(fixturePath, "utf8").replace(/\r\n/g, "\n");
const sourceReads = manifest.sources.map((source) => `    io_stage.read_bytes(input_root & "/${basename(source.path)}")`);
const sourceWrites = manifest.sources.map((source, index) => `io_stage.write_bytes(output_root & "/${basename(source.path)}", graph.sources.${index})`);
// Reuse the exact checked-in driver expression, including its self-copy seam.
const marker = "writeFileSync(stage2CompilerSource, ";
const start = fixture.indexOf(marker) + marker.length;
assert.ok(start >= marker.length);
const stop = fixture.indexOf('].join("\\n"), "utf8");', start);
assert.ok(stop > start);
const driver = runInNewContext(fixture.slice(start, stop + '].join("\\n")'.length), { sourceReads, sourceWrites });
const original = "(sources:sources, source_count:sources.length())";
const replacement = "(sources:sources, source_count:sources.length() + 1)";
const inputRoots = { baseline: join(work, "baseline-input"), mutated: join(work, "mutated-input") };
for (const path of Object.values(inputRoots)) mkdirSync(path);
const identities = [];
for (const item of manifest.sources) {
  const source = readFileSync(join(root, item.path), "utf8").replace(/\r\n/g, "\n");
  assert.equal(sha(source), item.source_sha256, `stale canonical source: ${item.path}`);
  let mutated = source;
  if (item.path === "compiler/self_hosted/compiler.vkf") {
    assert.equal(source.split(original).length, 2, "mutation must address exactly one existing expression");
    mutated = source.replace(original, replacement);
  }
  writeFileSync(join(inputRoots.baseline, basename(item.path)), source);
  writeFileSync(join(inputRoots.mutated, basename(item.path)), mutated);
  identities.push({ path: item.path, baseline_sha256: sha(source), mutated_sha256: sha(mutated) });
}

function compileAt(inputRoot, name) {
  const source = join(inputRoot, "stage2-graph-compiler.vkf");
  const artifact = join(work, `${name}.exe`);
  writeFileSync(source, driver);
  const built = spawnSync(compiler, ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"], {
    cwd: root, encoding: "utf8", timeout: 180_000, windowsHide: true,
  });
  assert.equal(built.status, 0, built.error?.message ?? built.stderr);
  return artifact;
}
function execute(artifact, inputRoot, name) {
  const outputRoot = join(work, `${name}-graph`);
  const successor = join(work, `${name}-successor.exe`);
  mkdirSync(outputRoot);
  const run = spawnSync(artifact, [], {
    cwd: work, encoding: "utf8", timeout: 20_000, windowsHide: true,
    input: [artifact, inputRoot, outputRoot, successor, ""].join("\r\n"),
  });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  assert.equal(run.stdout, "");
  return {
    outputRoot, successor, status: run.status, stdout: run.stdout, stderr: run.stderr,
    count: readFileSync(join(outputRoot, "source-count.txt"), "utf8"),
    successor_sha256: sha(readFileSync(successor)),
  };
}
const seed = compileAt(inputRoots.baseline, "baseline-stage");
const baseline = execute(seed, inputRoots.baseline, "baseline-production");
const mutated = execute(seed, inputRoots.mutated, "mutated-production");
const baselineSuccessor = execute(baseline.successor, baseline.outputRoot, "baseline-next");
const mutatedSuccessor = execute(mutated.successor, mutated.outputRoot, "mutated-next");
// Native compilation is a test-only semantic control, never invoked by a stage.
const control = compileAt(inputRoots.mutated, "native-mutated-control");
const controlRun = execute(control, inputRoots.mutated, "native-control");
assert.equal(baselineSuccessor.count, String(manifest.sources.length));
assert.equal(controlRun.count, String(manifest.sources.length + 1), "native control must prove a genuine semantic mutation");
assert.equal(readFileSync(join(mutated.outputRoot, "compiler.vkf"), "utf8"),
  readFileSync(join(inputRoots.mutated, "compiler.vkf"), "utf8"), "mutation must survive source materialization");
const receipt = {
  scope: "Diagnostic RED: successor compiler must respond to compiler-source semantics; not an accepted self-compilation result",
  fixture_sha256: sha(fixture), driver_sha256: sha(driver), native_compiler_sha256: sha(readFileSync(compiler)),
  bundle_sha256: manifest.bundle_sha256, seed_sha256: sha(readFileSync(seed)),
  mutation: { original, replacement }, identities,
  baseline, mutated, baselineSuccessor, mutatedSuccessor, nativeControl: controlRun,
  expected_mutated_successor_count: controlRun.count,
  observed_mutated_successor_count: mutatedSuccessor.count,
};
writeFileSync(join(work, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ work, ...receipt }, null, 2));
assert.equal(mutatedSuccessor.count, controlRun.count,
  "successor ignored semantic compiler-source mutation: current driver copies its executable");
