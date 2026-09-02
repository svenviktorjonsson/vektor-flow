import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);
const newline = process.platform === "win32" ? "\r\n" : "\n";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("locked Stage 1 graph emits the smallest runnable Stage 2 artifact", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i148-locked-stage2-"));
  try {
    const manifest = JSON.parse(readFileSync(
      join(root, "compiler", "self_hosted", "vf-compiler-bootstrap.json"),
      "utf8",
    ));
    assert.equal(manifest.source_count, 10);
    assert.deepEqual(
      manifest.sources.map((source) => source.path),
      manifest.source_order,
    );
    for (const source of manifest.sources) {
      const bytes = readFileSync(join(root, source.path));
      const canonicalBytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
      assert.equal(sha256(canonicalBytes), source.source_sha256, source.path);
      copyFileSync(join(root, source.path), join(work, basename(source.path)));
    }

    const producerSource = join(work, "stage1-producer.vkf");
    const producerArtifact = join(work, `stage1-producer${suffix}`);
    writeFileSync(producerSource, [
      "compiler_stage: .compiler",
      "scene_stage: .native_scene_compiler",
      "stdlib_stage: .stdlib",
      "math_stage: .math",
      "io_stage: .io",
      'statement: compiler_stage.compile_tagged_dependency_tape("base: 40\\nfirst: base + 1\\nsecond: first + 1\\nsecond + 1")',
      ':: "vektorflow.machine_ir"',
      ":: 4",
      ':: "f64"',
      ":: 1",
      ":: statement.name",
      ":: statement.max_stack",
      ":: statement.opcodes.length()",
      ":: statement.opcodes",
      ":: statement.values",
      "",
    ].join("\n"), "utf8");
    const compiledProducer = spawnSync(
      compiler,
      [
        "-b",
        producerSource,
        "-o",
        producerArtifact,
        "--diagnostics",
        "--optimizer-policy",
        "mask-0",
      ],
      { cwd: root, encoding: "utf8", timeout: 180_000, windowsHide: true },
    );
    assert.equal(
      compiledProducer.status,
      0,
      compiledProducer.error?.message ?? compiledProducer.stderr,
    );

    const expected = [
      "vektorflow.machine_ir",
      "4",
      "f64",
      "1",
      "$entry",
      "2",
      "8",
      "[1, 1, 2, 1, 2, 1, 2, 3]",
      "[40, 1, 0, 1, 0, 1, 0, 0]",
    ].join(newline) + newline;
    const observed = spawnSync(producerArtifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(observed.status, 0, observed.stderr);
    assert.equal(observed.stdout, expected);

    const oracle = join(work, "stage1-observation.txt");
    const stage2Artifact = join(work, `stage2-tracer${suffix}`);
    const provenance = join(work, "stage2-provenance.json");
    writeFileSync(oracle, expected, "utf8");
    const dispatched = spawnSync(
      compiler,
      [
        "--vkf-internal-stage-component",
        "machine_ir.closed_dependency_chain.typed_module_pipeline",
        producerArtifact,
        producerSource,
        oracle,
        stage2Artifact,
        provenance,
      ],
      { cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true },
    );
    assert.equal(dispatched.status, 0, dispatched.stderr);
    if (process.platform === "win32") {
      assert.deepEqual([...readFileSync(stage2Artifact).subarray(0, 2)], [0x4d, 0x5a]);
    }
    const stage2 = spawnSync(stage2Artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(stage2.status, 0, stage2.stderr);
    assert.equal(stage2.stdout, `43${newline}`);

    const receipt = JSON.parse(readFileSync(provenance, "utf8"));
    assert.equal(receipt.implementation, "vkf_source_machine_module");
    assert.equal(receipt.consumer, "vkf_x64_backend.machine_ir");
    assert.equal(receipt.exact_oracle_match, true);
    assert.match(receipt.component_source_graph_fingerprint, /^[0-9a-f]{64}$/u);

    writeFileSync(join(work, "io.vkf"), "\n# stale locked source\n", { flag: "a" });
    const staleGraph = spawnSync(
      compiler,
      [
        "--vkf-internal-stage-component",
        "machine_ir.closed_dependency_chain.typed_module_pipeline",
        producerArtifact,
        producerSource,
        oracle,
        stage2Artifact,
        provenance,
      ],
      { cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true },
    );
    assert.notEqual(staleGraph.status, 0, "stale locked graph was consumed");
    assert.match(staleGraph.stderr, /artifact does not match its source graph/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
