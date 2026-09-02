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
const component = "machine_ir.closed_nested_addition.typed_module_pipeline";

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

test("Stage 2 compiler CLI lowers a nested addition", {
  skip: process.platform !== "win32",
}, () => {
  const rootWork = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i158-stage2-nested-addition-"));
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

    const inputSource = join(work, "nested-addition-input.vkf");
    const oracleArtifact = join(work, `nested-addition-oracle${suffix}`);
    writeFileSync(inputSource, "value: 31\n:: value + 1 + 2\n", "utf8");
    compile(inputSource, oracleArtifact);
    const oracleRun = spawnSync(oracleArtifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(oracleRun.status, 0, oracleRun.stderr);
    assert.equal(oracleRun.stdout, `34${newline}`);

    const stage2Artifact = join(work, `stage2-nested-addition${suffix}`);
    const observation = join(work, "stage2-nested-addition-observation.txt");
    const provenance = join(work, "stage2-nested-addition-provenance.json");
    const cliSource = join(work, "stage2-nested-addition-compiler.vkf");
    const cliArtifact = join(work, `stage2-nested-addition-compiler${suffix}`);
    const observationExpression = [
      "module.schema", "module.version", "module.output_kind", "module.output_count",
      "module.entry.name", "module.entry.max_stack",
      "module.entry.instructions.0.kind", "module.entry.instructions.0.value",
      "module.entry.instructions.1.kind", "module.entry.instructions.1.value",
      "module.entry.instructions.2.kind",
      "module.entry.instructions.3.kind", "module.entry.instructions.3.value",
      "module.entry.instructions.4.kind", "module.entry.instructions.5.kind",
    ].join(' & "\\n" & ');
    writeFileSync(cliSource, [
      "compiler_stage: .compiler",
      "scene_stage: .native_scene_compiler",
      "stdlib_stage: .stdlib",
      "math_stage: .math",
      "io_stage: .io",
      "source_path: io_stage.read_line()",
      "source: io_stage.read_text(source_path)",
      "module: compiler_stage.compile_tagged_printed_nested_addition(source)",
      `observation: ${observationExpression} & "\\n"`,
      `io_stage.write_text(${JSON.stringify(observation)}, observation)`,
      `dispatch: process.run_native(${JSON.stringify(compiler)}, (`,
      '    "--vkf-internal-stage-observation",',
      `    ${JSON.stringify(component)},`,
      `    ${JSON.stringify(cliArtifact)},`,
      `    ${JSON.stringify(cliSource)},`,
      `    ${JSON.stringify(observation)},`,
      `    ${JSON.stringify(stage2Artifact)},`,
      `    ${JSON.stringify(provenance)},`,
      "))",
      "(dispatch.code = 0)?! dispatch.err",
      `run: process.run_native(${JSON.stringify(stage2Artifact)}, ())`,
      "(run.code = 0)?! run.err",
      ":: run.out",
      "",
    ].join("\n"), "utf8");
    compile(cliSource, cliArtifact);

    const runCli = () => spawnSync(cliArtifact, [], {
      cwd: work,
      encoding: "utf8",
      input: `${inputSource}${newline}`,
      timeout: 20_000,
      windowsHide: true,
    });
    const first = runCli();
    assert.equal(first.status, 0, first.error?.message ?? JSON.stringify({
      stderr: first.stderr,
      stdout: first.stdout,
    }));
    assert.equal(first.stdout.trim(), oracleRun.stdout.trim());
    const firstArtifact = readFileSync(stage2Artifact);
    const firstProvenance = readFileSync(provenance);

    rmSync(stage2Artifact);
    rmSync(observation);
    rmSync(provenance);
    const second = runCli();
    assert.equal(second.status, 0, second.error?.message ?? second.stderr);
    assert.equal(second.stdout, first.stdout);
    assert.deepEqual(readFileSync(stage2Artifact), firstArtifact);
    assert.deepEqual(readFileSync(provenance), firstProvenance);

    const receipt = JSON.parse(readFileSync(provenance, "utf8"));
    assert.equal(receipt.component, component);
    assert.equal(receipt.implementation, "vkf_source_machine_module");
    assert.equal(receipt.consumer, "vkf_x64_backend.machine_ir");
    assert.equal(receipt.exact_oracle_match, false);

    writeFileSync(inputSource, "value: 31\n:: other + 1 + 2\n", "utf8");
    const rejected = runCli();
    assert.notEqual(rejected.status, 0, "unknown nested binding was accepted");
    assert.deepEqual(readFileSync(stage2Artifact), firstArtifact);
    assert.deepEqual(readFileSync(provenance), firstProvenance);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
