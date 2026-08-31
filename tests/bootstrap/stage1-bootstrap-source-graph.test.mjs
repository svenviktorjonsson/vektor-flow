import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = join(root, "compiler", "self_hosted", "vf-compiler-bootstrap.json");

test("bootstrap source graph includes Machine IR validation in dependency order", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const machineIr = "compiler/self_hosted/machine_ir.vkf";
  const validation = "compiler/self_hosted/machine_ir_validation.vkf";
  const compiler = "compiler/self_hosted/compiler.vkf";

  assert.deepEqual(
    manifest.sources.map((source) => source.path),
    manifest.source_order,
    "sources and source_order differ",
  );
  assert.equal(manifest.source_count, manifest.sources.length);
  assert.equal(manifest.source_count, manifest.source_order.length);

  const machineIrIndex = manifest.source_order.indexOf(machineIr);
  const validationIndex = manifest.source_order.indexOf(validation);
  const compilerIndex = manifest.source_order.indexOf(compiler);
  assert.notEqual(machineIrIndex, -1, "Machine IR source is missing");
  assert.notEqual(validationIndex, -1, "Machine IR validator is missing");
  assert.notEqual(compilerIndex, -1, "compiler source is missing");
  assert.equal(validationIndex, machineIrIndex + 1, "validator must follow Machine IR");
  assert.equal(compilerIndex, validationIndex + 1, "compiler must follow the validator");
});

test("bootstrap source and bundle digests match canonical source bytes", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const source of manifest.sources) {
    const canonicalSource = readFileSync(join(root, source.path), "utf8").replace(/\r\n/g, "\n");
    const actual = createHash("sha256").update(canonicalSource).digest("hex");
    assert.equal(source.source_sha256, actual, `${source.path} digest is stale`);
  }

  const bundleIdentity = manifest.sources
    .map((source) => `${source.path}\n${source.source_sha256}`)
    .join("\n");
  const actualBundle = createHash("sha256").update(bundleIdentity).digest("hex");
  assert.equal(manifest.bundle_sha256, actualBundle, "bundle digest is stale");
});
