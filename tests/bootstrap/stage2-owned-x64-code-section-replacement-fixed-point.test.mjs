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

function findPeSection(bytes, name) {
  assert.equal(bytes.subarray(0, 2).toString("ascii"), "MZ", "DOS signature changed");
  const peOffset = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.subarray(peOffset, peOffset + 4).toString("hex"), "50450000");
  const sectionCount = bytes.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = bytes.readUInt16LE(peOffset + 20);
  const sectionTableOffset = peOffset + 24 + optionalHeaderSize;
  for (let index = 0; index < sectionCount; index += 1) {
    const headerOffset = sectionTableOffset + index * 40;
    const sectionName = bytes.subarray(headerOffset, headerOffset + 8)
      .toString("ascii").replace(/\0.*$/, "");
    if (sectionName === name) {
      return {
        headerOffset,
        virtualSize: bytes.readUInt32LE(headerOffset + 8),
        virtualAddress: bytes.readUInt32LE(headerOffset + 12),
        rawSize: bytes.readUInt32LE(headerOffset + 16),
        rawOffset: bytes.readUInt32LE(headerOffset + 20),
      };
    }
  }
  return undefined;
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function peChecksum(bytes, checksumOffset) {
  let checksum = 0;
  for (let offset = 0; offset < bytes.length; offset += 2) {
    if (offset === checksumOffset || offset === checksumOffset + 2) continue;
    const word = bytes[offset] | ((bytes[offset + 1] ?? 0) << 8);
    checksum = (checksum & 0xffff) + (checksum >>> 16) + word;
    checksum = (checksum & 0xffff) + (checksum >>> 16);
  }
  return ((checksum & 0xffff) + bytes.length) >>> 0;
}

function makePackedRunnerTemplate(lockedTemplate, lockedSection) {
  const peOffset = lockedTemplate.readUInt32LE(0x3c);
  const optionalHeaderSize = lockedTemplate.readUInt16LE(peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  const sectionAlignment = lockedTemplate.readUInt32LE(optionalHeaderOffset + 32);
  const sizeOfHeaders = lockedTemplate.readUInt32LE(optionalHeaderOffset + 60);
  const retainedCount = (lockedSection.headerOffset - sectionTableOffset) / 40;
  assert.equal(retainedCount, 4, "packed fixture retained-section count changed");
  const packed = Buffer.from(lockedTemplate.subarray(0, lockedSection.rawOffset));
  packed.writeUInt16LE(retainedCount, peOffset + 6);
  packed.writeUInt16LE(packed.readUInt16LE(peOffset + 22) | 0x0001, peOffset + 22);
  packed.writeUInt16LE(packed.readUInt16LE(optionalHeaderOffset + 70) & ~0x0060, optionalHeaderOffset + 70);
  for (const name of [".vkfcod", ".CRT", ".rsrc", ".reloc"]) {
    const section = findPeSection(lockedTemplate, name);
    assert.ok(section, `locked runner ${name} section is missing`);
    packed.writeUInt32LE(
      packed.readUInt32LE(optionalHeaderOffset + 8) - section.rawSize,
      optionalHeaderOffset + 8,
    );
  }
  const lastRetainedHeader = sectionTableOffset + (retainedCount - 1) * 40;
  const retainedImageEnd = (
    packed.readUInt32LE(lastRetainedHeader + 12) +
    Math.max(
      packed.readUInt32LE(lastRetainedHeader + 8),
      packed.readUInt32LE(lastRetainedHeader + 16),
    )
  );
  packed.writeUInt32LE(
    align(retainedImageEnd, sectionAlignment),
    optionalHeaderOffset + 56,
  );
  const checksumOffset = optionalHeaderOffset + 64;
  packed.writeUInt32LE(0, checksumOffset);
  for (const directoryIndex of [2, 5]) {
    packed.fill(
      0,
      optionalHeaderOffset + 112 + directoryIndex * 8,
      optionalHeaderOffset + 120 + directoryIndex * 8,
    );
  }
  packed.fill(0, lockedSection.headerOffset, sizeOfHeaders);
  packed.writeUInt32LE(peChecksum(packed, checksumOffset), checksumOffset);
  assert.notEqual(packed.readUInt32LE(checksumOffset), 0);
  assert.equal(packed.length, lockedSection.rawOffset);
  for (let index = 0; index + 1 < retainedCount; index += 1) {
    const current = sectionTableOffset + index * 40;
    const next = current + 40;
    const currentVirtualEnd = (
      packed.readUInt32LE(current + 12) +
      align(Math.max(
        packed.readUInt32LE(current + 8),
        packed.readUInt32LE(current + 16),
      ), sectionAlignment)
    );
    assert.equal(
      currentVirtualEnd,
      packed.readUInt32LE(next + 12),
      "packed fixture must have no virtual gap",
    );
  }
  const rawSections = Array.from({ length: retainedCount }, (_, index) => (
    sectionTableOffset + index * 40
  )).filter((headerOffset) => packed.readUInt32LE(headerOffset + 16) > 0);
  for (let index = 0; index + 1 < rawSections.length; index += 1) {
    const current = rawSections[index];
    const next = rawSections[index + 1];
    assert.equal(
      packed.readUInt32LE(current + 20) + packed.readUInt32LE(current + 16),
      packed.readUInt32LE(next + 20),
      "packed fixture must have no raw gap",
    );
  }
  return packed;
}

function makeMiddleRunnerTemplate(lockedTemplate, lockedSection) {
  const peOffset = lockedTemplate.readUInt32LE(0x3c);
  const optionalHeaderSize = lockedTemplate.readUInt16LE(peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  const sectionAlignment = lockedTemplate.readUInt32LE(optionalHeaderOffset + 32);
  const sizeOfHeaders = lockedTemplate.readUInt32LE(optionalHeaderOffset + 60);
  const crt = findPeSection(lockedTemplate, ".CRT");
  const resources = findPeSection(lockedTemplate, ".rsrc");
  const relocations = findPeSection(lockedTemplate, ".reloc");
  assert.ok(crt && resources && relocations, "locked runner suffix sections changed");
  const compact = Buffer.concat([
    lockedTemplate.subarray(0, lockedSection.rawOffset),
    lockedTemplate.subarray(crt.rawOffset, crt.rawOffset + crt.rawSize),
    lockedTemplate.subarray(
      relocations.rawOffset,
      relocations.rawOffset + relocations.rawSize,
    ),
  ]);
  const retainedCount = 6;
  compact.writeUInt16LE(retainedCount, peOffset + 6);
  compact.fill(0, lockedSection.headerOffset, sizeOfHeaders);
  lockedTemplate.copy(compact, lockedSection.headerOffset, crt.headerOffset, crt.headerOffset + 40);
  lockedTemplate.copy(
    compact,
    lockedSection.headerOffset + 40,
    relocations.headerOffset,
    relocations.headerOffset + 40,
  );
  const compactCrt = lockedSection.headerOffset;
  const compactRelocations = compactCrt + 40;
  compact.writeUInt32LE(0x5000, compactCrt + 12);
  compact.writeUInt32LE(lockedSection.rawOffset, compactCrt + 20);
  compact.writeUInt32LE(0x6000, compactRelocations + 12);
  compact.writeUInt32LE(lockedSection.rawOffset + crt.rawSize, compactRelocations + 20);
  compact.writeUInt32LE(
    compact.readUInt32LE(optionalHeaderOffset + 8) - lockedSection.rawSize - resources.rawSize,
    optionalHeaderOffset + 8,
  );
  compact.writeUInt32LE(0x7000, optionalHeaderOffset + 56);
  compact.fill(
    0,
    optionalHeaderOffset + 112 + 2 * 8,
    optionalHeaderOffset + 120 + 2 * 8,
  );
  compact.writeUInt32LE(0x6000, optionalHeaderOffset + 112 + 5 * 8);
  compact.writeUInt32LE(0x5000, lockedSection.rawOffset + crt.rawSize);
  const checksumOffset = optionalHeaderOffset + 64;
  compact.writeUInt32LE(0, checksumOffset);
  compact.writeUInt32LE(peChecksum(compact, checksumOffset), checksumOffset);
  assert.notEqual(compact.readUInt32LE(checksumOffset), 0);
  assert.equal(compact.length, lockedSection.rawOffset + crt.rawSize + relocations.rawSize);
  for (let index = 0; index + 1 < retainedCount; index += 1) {
    const current = sectionTableOffset + index * 40;
    const next = current + 40;
    assert.equal(
      compact.readUInt32LE(current + 12) + align(Math.max(
        compact.readUInt32LE(current + 8),
        compact.readUInt32LE(current + 16),
      ), sectionAlignment),
      compact.readUInt32LE(next + 12),
      "middle fixture must have no virtual gap",
    );
  }
  const rawSections = Array.from({ length: retainedCount }, (_, index) => (
    sectionTableOffset + index * 40
  )).filter((headerOffset) => compact.readUInt32LE(headerOffset + 16) > 0);
  for (let index = 0; index + 1 < rawSections.length; index += 1) {
    const current = rawSections[index];
    const next = rawSections[index + 1];
    assert.equal(
      compact.readUInt32LE(current + 20) + compact.readUInt32LE(current + 16),
      compact.readUInt32LE(next + 20),
      "middle fixture must have no raw gap",
    );
  }
  return compact;
}

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

function verifyCodeSectionFixture(mode) {
  const rootWork = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, `i234-${mode}-`));
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

    const lockedTemplate = readFileSync(runnerTemplate);
    assert.throws(
      () => new TextDecoder("utf-8", { fatal: true }).decode(lockedTemplate),
      "fixture must exercise opaque bytes that a text slice cannot preserve",
    );
    const lockedSection = findPeSection(lockedTemplate, ".vkfcod");
    assert.ok(lockedSection, "locked runner code section is missing");
    assert.equal(lockedSection.rawOffset, lockedTemplate.indexOf(marker));
    assert.equal(lockedSection.rawSize, 32768, "locked runner capacity changed");
    const packed = mode === "packed";
    const middle = mode === "middle";
    const growing = packed || middle;
    const codeCapacity = mode === "missing" ? lockedSection.rawSize : growing ? 512 : 16384;
    const template = packed
      ? makePackedRunnerTemplate(lockedTemplate, lockedSection)
      : middle
        ? makeMiddleRunnerTemplate(lockedTemplate, lockedSection)
        : Buffer.from(lockedTemplate);
    if (mode === "missing") {
      template.fill(0, lockedSection.headerOffset, lockedSection.headerOffset + 40);
    } else if (!packed) {
      template.writeUInt32LE(codeCapacity, lockedSection.headerOffset + 16);
    }
    if (!growing) {
      template.fill(0, lockedSection.rawOffset, lockedSection.rawOffset + marker.length);
    }
    assert.equal(template.indexOf(marker), -1, "fixture must not expose the locked marker");
    const templatePath = join(work, `marker-free-template${suffix}`);
    writeFileSync(templatePath, template);
    const section = findPeSection(template, ".vkfcod");
    if (mode === "missing" || growing) {
      assert.equal(section, undefined, "fixture must require section creation");
    } else {
      assert.equal(section.rawSize, codeCapacity);
      assert.equal(section.rawOffset, lockedSection.rawOffset);
    }
    const expectedTemplate = Buffer.from(template);
    if (mode === "missing") {
      lockedTemplate.copy(
        expectedTemplate,
        lockedSection.headerOffset,
        lockedSection.headerOffset,
        lockedSection.headerOffset + 40,
      );
    }

    const functionProloguePath = join(work, "function-prologue.bin");
    const multiplicationPath = join(work, "multiplication.bin");
    const functionEpiloguePath = join(work, "function-epilogue.bin");
    const resultBridgePath = join(work, "result-bridge.bin");
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
    const identityHelper = Buffer.concat([
      functionPrologue,
      Buffer.from([0x6a, 0x01]),
      multiplication,
      functionEpilogue,
    ]);
    const generated = Buffer.concat([
      Buffer.from([0xeb, 0x3c]),
      firstHelper,
      identityHelper,
      identityHelper,
      Buffer.from([0x6a, 0x15]),
      Buffer.from([0xe8, 0xbd, 0xff, 0xff, 0xff]),
      resultBridge,
      Buffer.from([0xe8, 0xc6, 0xff, 0xff, 0xff]),
      resultBridge,
      Buffer.from([0xe8, 0xcf, 0xff, 0xff, 0xff]),
      Buffer.from([0xc3]),
    ]);
    assert.equal(generated.length, 92, "selected code-section layout changed");
    if (packed) {
      const peOffset = expectedTemplate.readUInt32LE(0x3c);
      const optionalHeaderOffset = peOffset + 24;
      expectedTemplate.writeUInt16LE(5, peOffset + 6);
      expectedTemplate.writeUInt32LE(
        expectedTemplate.readUInt32LE(optionalHeaderOffset + 4) + codeCapacity,
        optionalHeaderOffset + 4,
      );
      expectedTemplate.writeUInt32LE(
        expectedTemplate.readUInt32LE(optionalHeaderOffset + 8) + codeCapacity,
        optionalHeaderOffset + 8,
      );
      expectedTemplate.writeUInt32LE(0x6000, optionalHeaderOffset + 56);
      expectedTemplate.writeUInt32LE(0, optionalHeaderOffset + 64);
      const header = Buffer.alloc(40);
      header.write(".vkfcod", 0, "ascii");
      header.writeUInt32LE(generated.length, 8);
      header.writeUInt32LE(0x5000, 12);
      header.writeUInt32LE(codeCapacity, 16);
      header.writeUInt32LE(lockedSection.rawOffset, 20);
      header.writeUInt32LE(0x60000040, 36);
      header.copy(expectedTemplate, lockedSection.headerOffset);
    }
    if (middle) {
      const peOffset = expectedTemplate.readUInt32LE(0x3c);
      const optionalHeaderSize = expectedTemplate.readUInt16LE(peOffset + 20);
      const optionalHeaderOffset = peOffset + 24;
      const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
      const oldSectionCount = expectedTemplate.readUInt16LE(peOffset + 6);
      const oldSectionTableEnd = sectionTableOffset + oldSectionCount * 40;
      const laterHeaders = Buffer.from(expectedTemplate.subarray(
        lockedSection.headerOffset,
        oldSectionTableEnd,
      ));
      laterHeaders.copy(expectedTemplate, lockedSection.headerOffset + 40);
      expectedTemplate.writeUInt16LE(oldSectionCount + 1, peOffset + 6);
      expectedTemplate.writeUInt32LE(
        expectedTemplate.readUInt32LE(optionalHeaderOffset + 4) + codeCapacity,
        optionalHeaderOffset + 4,
      );
      expectedTemplate.writeUInt32LE(
        expectedTemplate.readUInt32LE(optionalHeaderOffset + 8) + codeCapacity,
        optionalHeaderOffset + 8,
      );
      expectedTemplate.writeUInt32LE(0x8000, optionalHeaderOffset + 56);
      expectedTemplate.writeUInt32LE(0, optionalHeaderOffset + 64);
      expectedTemplate.writeUInt32LE(0x7000, optionalHeaderOffset + 112 + 5 * 8);
      const header = Buffer.alloc(40);
      header.write(".vkfcod", 0, "ascii");
      header.writeUInt32LE(generated.length, 8);
      header.writeUInt32LE(0x5000, 12);
      header.writeUInt32LE(codeCapacity, 16);
      header.writeUInt32LE(lockedSection.rawOffset, 20);
      header.writeUInt32LE(0x60000040, 36);
      header.copy(expectedTemplate, lockedSection.headerOffset);
      for (let index = 1; index <= 2; index += 1) {
        const headerOffset = lockedSection.headerOffset + index * 40;
        expectedTemplate.writeUInt32LE(
          expectedTemplate.readUInt32LE(headerOffset + 12) + 0x1000,
          headerOffset + 12,
        );
        expectedTemplate.writeUInt32LE(
          expectedTemplate.readUInt32LE(headerOffset + 20) + codeCapacity,
          headerOffset + 20,
        );
      }
      expectedTemplate.writeUInt32LE(0x6000, lockedSection.rawOffset + 512);
    }
    writeFileSync(functionProloguePath, functionPrologue);
    writeFileSync(multiplicationPath, multiplication);
    writeFileSync(functionEpiloguePath, functionEpilogue);
    writeFileSync(resultBridgePath, resultBridge);

    const firstSource = join(work, "first.vkf");
    const secondSource = join(work, "second.vkf");
    const thirdSource = join(work, "third.vkf");
    const oracleArtifact = join(work, `oracle${suffix}`);
    copyFileSync(join(root, "examples", "native_core", "hello_native.vkf"), firstSource);
    writeFileSync(secondSource, [
      "identity(x:num) -> num:",
      "    x * 1",
      "",
      ":: identity(42)",
      "",
    ].join("\n"), "utf8");
    writeFileSync(thirdSource, [
      "same(x:num) -> num:",
      "    x * 1",
      "",
      ":: same(42)",
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
      "third_source_path: io_stage.read_line()",
      "template_path: io_stage.read_line()",
      "function_prologue_path: io_stage.read_line()",
      "multiplication_path: io_stage.read_line()",
      "function_epilogue_path: io_stage.read_line()",
      "result_bridge_path: io_stage.read_line()",
      "byte_arena_root: io_stage.read_line()",
      "artifact_path: io_stage.read_line()",
      "next_compiler_path: io_stage.read_line()",
      "artifact: compiler_stage._compile_tagged_numeric_literal_function_chain_template_x64(",
      "    io_stage.read_text(first_source_path),",
      "    io_stage.read_text(second_source_path),",
      "    io_stage.read_text(third_source_path),",
      "    io_stage.read_bytes(template_path),",
      "    io_stage.read_bytes(function_prologue_path),",
      "    io_stage.read_bytes(multiplication_path),",
      "    io_stage.read_bytes(function_epilogue_path),",
      "    io_stage.read_bytes(result_bridge_path),",
      "    [",
      arenaReads.join(",\n"),
      "    ]",
      ")",
      "io_stage.write_bytes(artifact_path, artifact)",
      "io_stage.write_bytes(next_compiler_path, io_stage.read_bytes(self_path))",
      "",
    ].join("\n"), "utf8");
    const generatedCompilerSource = readFileSync(stage2CompilerSource, "utf8");
    assert.doesNotMatch(
      generatedCompilerSource,
      /vkf-internal-stage-observation|process\.run_native/,
    );
    assert.doesNotMatch(
      generatedCompilerSource,
      /artifact_tail|code_capacity|template_prefix|artifact_suffix|marker_offset|header_offset|raw_offset|raw_size|virtual_address|3072|32768/,
      "caller must not prebuild or supply the PE code-section layout",
    );
    compile(stage2CompilerSource, stage2Compiler);

    const compilerInput = [
      firstSource,
      secondSource,
      thirdSource,
      templatePath,
      functionProloguePath,
      multiplicationPath,
      functionEpiloguePath,
      resultBridgePath,
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

    const stage2Bytes = readFileSync(stage2Program);
    assert.equal(
      stage2Bytes.length,
      growing ? template.length + codeCapacity : template.length,
      growing ? "executable container did not grow by one aligned section" : "executable container size changed",
    );
    if (growing) {
      const expectedArtifact = Buffer.concat([
        expectedTemplate.subarray(0, lockedSection.rawOffset),
        generated,
        Buffer.alloc(codeCapacity - generated.length),
        expectedTemplate.subarray(lockedSection.rawOffset),
      ]);
      assert.deepEqual(stage2Bytes, expectedArtifact, "grown PE container bytes differ");
    }
    assert.deepEqual(
      stage2Bytes.subarray(0, lockedSection.rawOffset),
      expectedTemplate.subarray(0, lockedSection.rawOffset),
      "opaque executable prefix was reinterpreted as text",
    );
    assert.deepEqual(
      stage2Bytes.subarray(lockedSection.rawOffset, lockedSection.rawOffset + generated.length),
      generated,
      "compiler-owned code-section bytes differ from the selected artifact",
    );
    assert.deepEqual(
      stage2Bytes.subarray(lockedSection.rawOffset + generated.length, lockedSection.rawOffset + codeCapacity),
      Buffer.alloc(codeCapacity - generated.length),
      "compiler-owned code-section padding is not zero-filled",
    );
    assert.deepEqual(
      stage2Bytes.subarray(lockedSection.rawOffset + codeCapacity),
      middle
        ? expectedTemplate.subarray(lockedSection.rawOffset)
        : template.subarray(lockedSection.rawOffset + codeCapacity),
      "opaque executable suffix was reinterpreted as text",
    );
    assert.deepEqual(readFileSync(stage3Compiler), readFileSync(stage2Compiler));
    assert.deepEqual(readFileSync(stage4Compiler), readFileSync(stage3Compiler));
    assert.deepEqual(readFileSync(stage3Program), stage2Bytes);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test("Stage 2 discovers and replaces a marker-free x64 PE code section", {
  skip: process.platform !== "win32",
}, () => {
  verifyCodeSectionFixture("existing");
});

test("Stage 2 creates a missing x64 PE code section at fixed point", {
  skip: process.platform !== "win32",
}, () => {
  verifyCodeSectionFixture("missing");
});

test("Stage 2 grows a packed x64 PE with a new aligned code section", {
  skip: process.platform !== "win32",
}, () => {
  verifyCodeSectionFixture("packed");
});

test("Stage 2 inserts x64 code before later PE sections", {
  skip: process.platform !== "win32",
}, () => {
  verifyCodeSectionFixture("middle");
});
