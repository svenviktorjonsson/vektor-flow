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
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);
const runnerTemplate = join(nativeBin, `vkf_x64_runner_template${suffix}`);
const newline = process.platform === "win32" ? "\r\n" : "\n";
const marker = Buffer.from("VKFX64AOTCODE001", "ascii");
const codeCapacity = 32768;

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

test("Stage 2 applies a relocation collection to two source-owned functions", {
  skip: process.platform !== "win32",
}, () => {
  const rootWork = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i228-"));
  try {
    const manifest = JSON.parse(readFileSync(
      join(root, "compiler", "self_hosted", "vf-compiler-bootstrap.json"),
      "utf8",
    ));
    for (const source of manifest.sources) {
      const bytes = readFileSync(join(root, source.path));
      const canonical = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
      assert.equal(sha256(canonical), source.source_sha256, source.path);
      copyFileSync(join(root, source.path), join(work, basename(source.path)));
    }

    const template = readFileSync(runnerTemplate);
    const markerOffset = template.indexOf(marker);
    assert.ok(markerOffset >= 0, "x64 runner marker is missing");
    assert.ok(markerOffset + codeCapacity <= template.length, "x64 runner slot is truncated");

    const prefixPath = join(work, "prefix.bin");
    const functionProloguePath = join(work, "function-prologue.bin");
    const multiplicationPath = join(work, "multiplication.bin");
    const functionEpiloguePath = join(work, "function-epilogue.bin");
    const resultBridgePath = join(work, "result-bridge.bin");
    const artifactTailPath = join(work, "artifact-tail.bin");
    const byteArenaRoot = join(work, "bytes");
    mkdirSync(byteArenaRoot);
    for (let value = 128; value <= 255; value += 1) {
      writeFileSync(join(byteArenaRoot, `${value}.bin`), Buffer.from([value]));
    }

    const functionPrologue = Buffer.from([0x41, 0x5b]);
    const multiplication = Buffer.from([
      0x58, 0x59, 0x48, 0x0f, 0xaf, 0xc1, 0x50,
    ]);
    const functionEpilogue = Buffer.from([
      0x58,
      0xf2, 0x48, 0x0f, 0x2a, 0xc0,
      0x41, 0x53,
      0xc3,
    ]);
    const resultBridge = Buffer.from([
      0xf2, 0x48, 0x0f, 0x2c, 0xc0,
      0x50,
    ]);
    const firstHelper = Buffer.concat([
      functionPrologue,
      Buffer.from([0x6a, 0x02]),
      multiplication,
      functionEpilogue,
    ]);
    const secondHelper = Buffer.concat([
      functionPrologue,
      Buffer.from([0x6a, 0x01]),
      multiplication,
      functionEpilogue,
    ]);
    assert.equal(firstHelper.length, 20, "first helper layout changed");
    assert.equal(secondHelper.length, 20, "second helper layout changed");
    const entryOffset = 2 + firstHelper.length + secondHelper.length;
    const firstCallReturnOffset = entryOffset + 2 + 5;
    const secondCallReturnOffset = firstCallReturnOffset + resultBridge.length + 5;
    assert.equal(entryOffset, 42, "entry symbol position changed");
    assert.equal(2 - firstCallReturnOffset, -47, "first relocation changed");
    assert.equal(22 - secondCallReturnOffset, -38, "second relocation changed");
    const generated = Buffer.concat([
      Buffer.from([0xeb, 0x28]),
      firstHelper,
      secondHelper,
      Buffer.from([0x6a, 0x15]),
      Buffer.from([0xe8, 0xd1, 0xff, 0xff, 0xff]),
      resultBridge,
      Buffer.from([0xe8, 0xda, 0xff, 0xff, 0xff]),
      Buffer.from([0xc3]),
    ]);
    writeFileSync(prefixPath, template.subarray(0, markerOffset));
    writeFileSync(functionProloguePath, functionPrologue);
    writeFileSync(multiplicationPath, multiplication);
    writeFileSync(functionEpiloguePath, functionEpilogue);
    writeFileSync(resultBridgePath, resultBridge);
    writeFileSync(artifactTailPath, Buffer.concat([
      Buffer.alloc(codeCapacity - generated.length),
      template.subarray(markerOffset + codeCapacity),
    ]));

    const firstSource = join(work, "first.vkf");
    const secondSource = join(work, "second.vkf");
    const oracleArtifact = join(work, `oracle${suffix}`);
    copyFileSync(join(root, "examples", "native_core", "hello_native.vkf"), firstSource);
    writeFileSync(secondSource, [
      "identity(x:num) -> num:",
      "    x * 1",
      "",
      ":: identity(42)",
      "",
    ].join("\n"), "utf8");
    compile(firstSource, oracleArtifact);
    const oracle = spawnSync(oracleArtifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.equal(oracle.stdout, `42${newline}`);

    const arenaReads = Array.from({ length: 128 }, (_, index) => (
      `        io_stage.read_bytes(byte_arena_root & "/${index + 128}.bin")`
    ));
    const stage2CompilerSource = join(work, "s2c.vkf");
    const stage2Compiler = join(work, `s2c${suffix}`);
    writeFileSync(stage2CompilerSource, [
      "compiler_stage: .compiler",
      "io_stage: .io",
      "self_path: io_stage.read_line()",
      "first_source_path: io_stage.read_line()",
      "second_source_path: io_stage.read_line()",
      "prefix_path: io_stage.read_line()",
      "function_prologue_path: io_stage.read_line()",
      "multiplication_path: io_stage.read_line()",
      "function_epilogue_path: io_stage.read_line()",
      "result_bridge_path: io_stage.read_line()",
      "artifact_tail_path: io_stage.read_line()",
      "byte_arena_root: io_stage.read_line()",
      "artifact_path: io_stage.read_line()",
      "next_compiler_path: io_stage.read_line()",
      "artifact: compiler_stage._compile_tagged_numeric_literal_function_pair_symbols_x64(",
      "    io_stage.read_text(first_source_path),",
      "    io_stage.read_text(second_source_path),",
      "    io_stage.read_bytes(prefix_path),",
      "    io_stage.read_bytes(function_prologue_path),",
      "    io_stage.read_bytes(multiplication_path),",
      "    io_stage.read_bytes(function_epilogue_path),",
      "    io_stage.read_bytes(result_bridge_path),",
      "    io_stage.read_bytes(artifact_tail_path),",
      "    [",
      arenaReads.join(",\n"),
      "    ]",
      ")",
      "io_stage.write_bytes(artifact_path, artifact)",
      "io_stage.write_bytes(next_compiler_path, io_stage.read_bytes(self_path))",
      "",
    ].join("\n"), "utf8");
    assert.doesNotMatch(
      readFileSync(stage2CompilerSource, "utf8"),
      /vkf-internal-stage-observation|process\.run_native/,
    );
    assert.doesNotMatch(
      readFileSync(stage2CompilerSource, "utf8"),
      /\n\s+(?:42|-47|-38),/,
      "caller must not supply symbol positions or relocation displacements",
    );
    compile(stage2CompilerSource, stage2Compiler);

    const compilerInput = [
      firstSource,
      secondSource,
      prefixPath,
      functionProloguePath,
      multiplicationPath,
      functionEpiloguePath,
      resultBridgePath,
      artifactTailPath,
      byteArenaRoot,
    ];
    const stage2Program = join(work, `s2p${suffix}`);
    const stage3Compiler = join(work, `s3c${suffix}`);
    const stage2 = runCompiler(
      stage2Compiler,
      [stage2Compiler, ...compilerInput, stage2Program, stage3Compiler],
      work,
    );
    assert.equal(stage2.status, 0, stage2.error?.message ?? JSON.stringify({
      stderr: stage2.stderr,
      stdout: stage2.stdout,
    }));
    const stage2Run = spawnSync(stage2Program, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(stage2Run.status, 0, stage2Run.stderr);
    assert.equal(stage2Run.stdout, oracle.stdout);

    const stage3Program = join(work, `s3p${suffix}`);
    const stage4Compiler = join(work, `s4c${suffix}`);
    const stage3 = runCompiler(
      stage3Compiler,
      [stage3Compiler, ...compilerInput, stage3Program, stage4Compiler],
      work,
    );
    assert.equal(stage3.status, 0, stage3.error?.message ?? stage3.stderr);
    const stage3Run = spawnSync(stage3Program, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(stage3Run.status, 0, stage3Run.stderr);
    assert.equal(stage3Run.stdout, oracle.stdout);

    assert.deepEqual(readFileSync(stage3Compiler), readFileSync(stage2Compiler));
    assert.deepEqual(readFileSync(stage4Compiler), readFileSync(stage3Compiler));
    assert.deepEqual(readFileSync(stage3Program), readFileSync(stage2Program));
    assert.deepEqual(
      readFileSync(stage2Program).subarray(markerOffset, markerOffset + generated.length),
      generated,
      "relocation collection bytes differ from the selected artifact",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
