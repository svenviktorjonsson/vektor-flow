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

test("Stage 2 owns a valid artifact and reaches a first bounded fixed point", {
  skip: process.platform !== "win32",
}, () => {
  const rootWork = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i179-stage2-owned-output-"));
  try {
    const manifest = JSON.parse(readFileSync(
      join(root, "compiler", "self_hosted", "vf-compiler-bootstrap.json"),
      "utf8",
    ));
    for (const source of manifest.sources) {
      const bytes = readFileSync(join(root, source.path));
      const canonicalBytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
      assert.equal(sha256(canonicalBytes), source.source_sha256, source.path);
      copyFileSync(join(root, source.path), join(work, basename(source.path)));
    }

    const inputSource = join(work, "valid-input.vkf");
    const oracleArtifact = join(work, `oracle${suffix}`);
    writeFileSync(inputSource, "value: 40\n:: value + 2\n", "utf8");
    compile(inputSource, oracleArtifact);
    const oracle = spawnSync(oracleArtifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.equal(oracle.stdout, `42${newline}`);

    const runnerSource = join(work, "stage2-program-runner.vkf");
    const runnerArtifact = join(work, `stage2-program-runner${suffix}`);
    writeFileSync(runnerSource, [
      "io_stage: .io",
      ':: io_stage.read_text("stage2-program-output.txt")',
      "",
    ].join("\n"), "utf8");
    compile(runnerSource, runnerArtifact);

    const stage2CompilerSource = join(work, "stage2-compiler.vkf");
    const stage2Compiler = join(work, `stage2-compiler${suffix}`);
    writeFileSync(stage2CompilerSource, [
      "compiler_stage: .compiler",
      "io_stage: .io",
      "self_path: io_stage.read_line()",
      "source_path: io_stage.read_line()",
      "runner_path: io_stage.read_line()",
      "artifact_path: io_stage.read_line()",
      "bundle_path: io_stage.read_line()",
      "next_compiler_path: io_stage.read_line()",
      "source: io_stage.read_text(source_path)",
      "value: compiler_stage.compile_tagged_printed_dynamic_addition_value(source)",
      'io_stage.write_text(bundle_path, "$value")',
      "io_stage.write_bytes(artifact_path, io_stage.read_bytes(runner_path))",
      "io_stage.write_bytes(next_compiler_path, io_stage.read_bytes(self_path))",
      "",
    ].join("\n"), "utf8");
    assert.doesNotMatch(
      readFileSync(stage2CompilerSource, "utf8"),
      /vkf-internal-stage-observation/,
      "Stage 2 output delegated to the Stage 0 observation bridge",
    );
    compile(stage2CompilerSource, stage2Compiler);

    const stage2Dir = join(work, "stage2-output");
    const stage3Dir = join(work, "stage3-output");
    mkdirSync(stage2Dir);
    mkdirSync(stage3Dir);
    const stage2Program = join(stage2Dir, `program${suffix}`);
    const stage2Bundle = join(stage2Dir, "stage2-program-output.txt");
    const stage3Compiler = join(work, `stage3-compiler${suffix}`);
    const stage2 = runCompiler(stage2Compiler, [
      stage2Compiler,
      inputSource,
      runnerArtifact,
      stage2Program,
      stage2Bundle,
      stage3Compiler,
    ], work);
    assert.equal(stage2.status, 0, stage2.error?.message ?? stage2.stderr);
    assert.equal(stage2.stdout, "");

    const stage2Run = spawnSync(stage2Program, [], {
      cwd: stage2Dir,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(stage2Run.status, 0, stage2Run.stderr);
    assert.equal(stage2Run.stdout, oracle.stdout);

    const stage3Program = join(stage3Dir, `program${suffix}`);
    const stage3Bundle = join(stage3Dir, "stage2-program-output.txt");
    const stage4Compiler = join(work, `stage4-compiler${suffix}`);
    const stage3 = runCompiler(stage3Compiler, [
      stage3Compiler,
      inputSource,
      runnerArtifact,
      stage3Program,
      stage3Bundle,
      stage4Compiler,
    ], work);
    assert.equal(stage3.status, 0, stage3.error?.message ?? stage3.stderr);
    assert.equal(stage3.stdout, "");

    const stage3Run = spawnSync(stage3Program, [], {
      cwd: stage3Dir,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(stage3Run.status, 0, stage3Run.stderr);
    assert.equal(stage3Run.stdout, oracle.stdout);

    assert.deepEqual(readFileSync(stage3Compiler), readFileSync(stage2Compiler));
    assert.deepEqual(readFileSync(stage4Compiler), readFileSync(stage3Compiler));
    assert.deepEqual(readFileSync(stage3Program), readFileSync(stage2Program));
    assert.deepEqual(readFileSync(stage3Bundle), readFileSync(stage2Bundle));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
