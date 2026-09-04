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

function compile(source, artifact) {
  const compiled = spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 180_000, windowsHide: true },
  );
  assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
}

function runCompiler(artifact, lines, cwd) {
  return spawnSync(artifact, [], {
    cwd,
    encoding: "utf8",
    input: `${lines.join(newline)}${newline}`,
    timeout: 20_000,
    windowsHide: true,
  });
}

test("Stage 2 materializes the complete locked source graph at fixed point", {
  skip: process.platform !== "win32",
}, () => {
  const rootWork = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i180-stage2-source-graph-"));
  try {
    const manifest = JSON.parse(readFileSync(
      join(root, "compiler", "self_hosted", "vf-compiler-bootstrap.json"),
      "utf8",
    ));
    assert.equal(manifest.sources.length, 11);

    const stage2Input = join(work, "stage2-input");
    const stage3Graph = join(work, "stage3-graph");
    const stage4Graph = join(work, "stage4-graph");
    mkdirSync(stage2Input);
    mkdirSync(stage3Graph);
    mkdirSync(stage4Graph);
    for (const source of manifest.sources) {
      const bytes = readFileSync(join(root, source.path));
      const canonicalBytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
      assert.equal(sha256(canonicalBytes), source.source_sha256, source.path);
      writeFileSync(join(stage2Input, basename(source.path)), canonicalBytes);
    }

    const stage2CompilerSource = join(stage2Input, "stage2-graph-compiler.vkf");
    const stage2Compiler = join(work, `stage2-graph-compiler${suffix}`);
    const sourceReads = manifest.sources.map((source) => (
      `    io_stage.read_bytes(input_root & "/${basename(source.path)}")`
    ));
    const sourceWrites = manifest.sources.map((source, index) => (
      `io_stage.write_bytes(output_root & "/${basename(source.path)}", graph.sources.${index})`
    ));
    writeFileSync(stage2CompilerSource, [
      "compiler_stage: .compiler",
      "io_stage: .io",
      "self_path: io_stage.read_line()",
      "input_root: io_stage.read_line()",
      "output_root: io_stage.read_line()",
      "next_compiler_path: io_stage.read_line()",
      "graph: compiler_stage._compile_locked_valid_source_graph([",
      sourceReads.join(",\n"),
      "])",
      ...sourceWrites,
      'io_stage.write_text(output_root & "/source-count.txt", "$graph.source_count")',
      "io_stage.write_bytes(next_compiler_path, io_stage.read_bytes(self_path))",
      "",
    ].join("\n"), "utf8");
    assert.doesNotMatch(
      readFileSync(stage2CompilerSource, "utf8"),
      /vkf-internal-stage-observation|process\.run_native/,
    );
    compile(stage2CompilerSource, stage2Compiler);

    const stage3Compiler = join(work, `stage3-graph-compiler${suffix}`);
    const stage2 = runCompiler(stage2Compiler, [
      stage2Compiler,
      stage2Input,
      stage3Graph,
      stage3Compiler,
    ], work);
    assert.equal(stage2.status, 0, stage2.error?.message ?? stage2.stderr);
    assert.equal(stage2.stdout, "");
    assert.equal(readFileSync(join(stage3Graph, "source-count.txt"), "utf8"), "11");

    const stage4Compiler = join(work, `stage4-graph-compiler${suffix}`);
    const stage3 = runCompiler(stage3Compiler, [
      stage3Compiler,
      stage3Graph,
      stage4Graph,
      stage4Compiler,
    ], work);
    assert.equal(stage3.status, 0, stage3.error?.message ?? stage3.stderr);
    assert.equal(stage3.stdout, "");
    assert.equal(readFileSync(join(stage4Graph, "source-count.txt"), "utf8"), "11");

    assert.deepEqual(readFileSync(stage3Compiler), readFileSync(stage2Compiler));
    assert.deepEqual(readFileSync(stage4Compiler), readFileSync(stage3Compiler));
    for (const source of manifest.sources) {
      const name = basename(source.path);
      const stage2Bytes = readFileSync(join(stage2Input, name));
      const stage3Bytes = readFileSync(join(stage3Graph, name));
      const stage4Bytes = readFileSync(join(stage4Graph, name));
      assert.deepEqual(stage3Bytes, stage2Bytes, `${name} changed in Stage 2`);
      assert.deepEqual(stage4Bytes, stage3Bytes, `${name} changed in Stage 3`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
