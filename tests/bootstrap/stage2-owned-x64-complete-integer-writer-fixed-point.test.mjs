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

test("Stage 2 integrates its high-byte arena in the complete integer writer", {
  skip: process.platform !== "win32",
}, () => {
  const rootWork = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i198-"));
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

    const template = readFileSync(runnerTemplate);
    const markerOffset = template.indexOf(marker);
    assert.ok(markerOffset >= 0, "x64 runner marker is missing");
    assert.ok(markerOffset + codeCapacity <= template.length, "x64 runner slot is truncated");

    const prefixPath = join(work, "prefix.bin");
    const additionPath = join(work, "add.bin");
    const multiplicationPath = join(work, "multiply.bin");
    const subtractionPath = join(work, "subtract.bin");
    const powerPath = join(work, "power.bin");
    const floorDivisionPath = join(work, "floor-divide.bin");
    const remainderPath = join(work, "remainder.bin");
    const printTailPath = join(work, "print-tail.bin");
    const byteArenaRoot = join(work, "bytes");
    mkdirSync(byteArenaRoot);
    for (let value = 128; value <= 255; value += 1) {
      writeFileSync(join(byteArenaRoot, `${value}.bin`), Buffer.from([value]));
    }

    const addition = Buffer.from([0x58, 0x59, 0x48, 0x01, 0xc8, 0x50]);
    const multiplication = Buffer.from([0x58, 0x59, 0x48, 0x0f, 0xaf, 0xc1, 0x50]);
    const subtraction = Buffer.from([0x58, 0x59, 0x48, 0x29, 0xc1, 0x51]);
    const floorDivision = Buffer.from([0x59, 0x58, 0x48, 0x99, 0x48, 0xf7, 0xf9, 0x50]);
    const remainder = Buffer.from([0x59, 0x58, 0x48, 0x99, 0x48, 0xf7, 0xf9, 0x52]);
    const power = Buffer.from([
      0x59, 0x58,
      0xba, 0x01, 0x00, 0x00, 0x00,
      0x48, 0x85, 0xc9, 0x74, 0x09,
      0x48, 0x0f, 0xaf, 0xd0,
      0x48, 0xff, 0xc9, 0x75, 0xf7,
      0x52,
    ]);
    const print = Buffer.from([0x58, 0xf2, 0x48, 0x0f, 0x2a, 0xc0, 0xc3]);
    const generated = Buffer.concat([
      Buffer.from([0x68, 0xe8, 0x03, 0x02, 0x01]),
      Buffer.from([0x6a, 0x64]), remainder,
      Buffer.from([0x6a, 0x01]), addition,
      print,
    ]);
    writeFileSync(prefixPath, template.subarray(0, markerOffset));
    writeFileSync(additionPath, addition);
    writeFileSync(multiplicationPath, multiplication);
    writeFileSync(subtractionPath, subtraction);
    writeFileSync(powerPath, power);
    writeFileSync(floorDivisionPath, floorDivision);
    writeFileSync(remainderPath, remainder);
    writeFileSync(printTailPath, Buffer.concat([
      print,
      Buffer.alloc(codeCapacity - generated.length),
      template.subarray(markerOffset + codeCapacity),
    ]));

    const inputSource = join(work, "input.vkf");
    const oracleArtifact = join(work, `oracle${suffix}`);
    writeFileSync(
      inputSource,
      "value: 16909288\n:: value % 100 + 1\n",
      "utf8",
    );
    compile(inputSource, oracleArtifact);
    const oracle = spawnSync(oracleArtifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.equal(oracle.stdout, `89${newline}`);

    const arenaReads = Array.from({ length: 128 }, (_, index) => (
      `        io_stage.read_bytes(byte_arena_root & "/${index + 128}.bin")`
    ));
    const stage2CompilerSource = join(work, "s2c.vkf");
    const stage2Compiler = join(work, `s2c${suffix}`);
    writeFileSync(stage2CompilerSource, [
      "compiler_stage: .compiler",
      "io_stage: .io",
      "self_path: io_stage.read_line()",
      "source_path: io_stage.read_line()",
      "prefix_path: io_stage.read_line()",
      "addition_path: io_stage.read_line()",
      "multiplication_path: io_stage.read_line()",
      "subtraction_path: io_stage.read_line()",
      "power_path: io_stage.read_line()",
      "floor_division_path: io_stage.read_line()",
      "remainder_path: io_stage.read_line()",
      "print_tail_path: io_stage.read_line()",
      "byte_arena_root: io_stage.read_line()",
      "artifact_path: io_stage.read_line()",
      "next_compiler_path: io_stage.read_line()",
      "artifact: compiler_stage._compile_printed_dynamic_integer_chain_x64(",
      "    io_stage.read_text(source_path),",
      "    io_stage.read_bytes(prefix_path),",
      "    io_stage.read_bytes(addition_path),",
      "    io_stage.read_bytes(multiplication_path),",
      "    io_stage.read_bytes(subtraction_path),",
      "    io_stage.read_bytes(power_path),",
      "    io_stage.read_bytes(floor_division_path),",
      "    io_stage.read_bytes(remainder_path),",
      "    io_stage.read_bytes(print_tail_path),",
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
    compile(stage2CompilerSource, stage2Compiler);

    const compilerInput = [
      stage2Compiler,
      inputSource,
      prefixPath,
      additionPath,
      multiplicationPath,
      subtractionPath,
      powerPath,
      floorDivisionPath,
      remainderPath,
      printTailPath,
      byteArenaRoot,
    ];
    const stage2Program = join(work, `s2p${suffix}`);
    const stage3Compiler = join(work, `s3c${suffix}`);
    const stage2 = runCompiler(
      stage2Compiler,
      [...compilerInput, stage2Program, stage3Compiler],
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
      [[stage3Compiler, ...compilerInput.slice(1)], stage3Program, stage4Compiler].flat(),
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
      "complete writer bytes differ from the selected Machine-IR tape",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
