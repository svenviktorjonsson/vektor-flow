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

test("Stage 2 compiler CLI accepts and emits one closed source", {
  skip: process.platform !== "win32",
}, () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i149-stage2-cli-"));
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
    const inputSource = join(work, "input.vkf");
    const stage2Artifact = join(work, `stage2-output${suffix}`);
    const observation = join(work, "stage2-observation.txt");
    const provenance = join(work, "stage2-provenance.json");
    const cliSource = join(work, "stage2-compiler.vkf");
    const cliArtifact = join(work, `stage2-compiler${suffix}`);
    writeFileSync(inputSource, [
      "base: 40",
      "first: base + 1",
      "second: first + 1",
      "second + 1",
      "",
    ].join("\n"), "utf8");
    writeFileSync(cliSource, [
      "compiler_stage: .compiler",
      "scene_stage: .native_scene_compiler",
      "stdlib_stage: .stdlib",
      "math_stage: .math",
      "io_stage: .io",
      "source_path: io_stage.read_line()",
      "source: io_stage.read_text(source_path)",
      "statement: compiler_stage.compile_tagged_dependency_tape(source)",
      'observation: "vektorflow.machine_ir\\n4\\nf64\\n1\\n\\$entry\\n" & statement.max_stack & "\\n" & statement.opcodes.length() & "\\n$statement.opcodes\\n$statement.values\\n"',
      `io_stage.write_text(${JSON.stringify(observation)}, observation)`,
      `dispatch: process.run_native(${JSON.stringify(compiler)}, (`,
      '    "--vkf-internal-stage-observation",',
      '    "machine_ir.closed_dependency_chain.typed_module_pipeline",',
      `    ${JSON.stringify(cliArtifact)},`,
      `    ${JSON.stringify(cliSource)},`,
      `    ${JSON.stringify(observation)},`,
      `    ${JSON.stringify(stage2Artifact)},`,
      `    ${JSON.stringify(provenance)},`,
      "))",
      "(dispatch.code = 0)?! dispatch.err",
      `run: process.run_native(${JSON.stringify(stage2Artifact)}, ())`,
      "(run.code = 0)?! run.err",
      `(run.out = ${JSON.stringify(`43${newline}`)})?! run.out`,
      ":: 43",
      "",
    ].join("\n"), "utf8");

    const compiledCli = spawnSync(
      compiler,
      [
        "-b",
        cliSource,
        "-o",
        cliArtifact,
        "--diagnostics",
        "--optimizer-policy",
        "mask-0",
      ],
      { cwd: root, encoding: "utf8", timeout: 180_000, windowsHide: true },
    );
    assert.equal(compiledCli.status, 0, compiledCli.error?.message ?? compiledCli.stderr);
    assert.deepEqual([...readFileSync(cliArtifact).subarray(0, 2)], [0x4d, 0x5a]);

    const cli = spawnSync(cliArtifact, [], {
      cwd: work,
      encoding: "utf8",
      input: `${inputSource}${newline}`,
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(cli.status, 0, cli.error?.message ?? cli.stderr);
    assert.equal(cli.stdout, `43${newline}`);
    assert.deepEqual([...readFileSync(stage2Artifact).subarray(0, 2)], [0x4d, 0x5a]);
    const emitted = spawnSync(stage2Artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(emitted.status, 0, emitted.stderr);
    assert.equal(emitted.stdout, `43${newline}`);
    const receipt = JSON.parse(readFileSync(provenance, "utf8"));
    assert.equal(receipt.component, "machine_ir.closed_dependency_chain.typed_module_pipeline");
    assert.equal(receipt.implementation, "vkf_source_machine_module");
    assert.equal(receipt.consumer, "vkf_x64_backend.machine_ir");
    assert.equal(receipt.exact_oracle_match, false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
