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
const component = "machine_ir.numeric_positive_conditional.typed_module_pipeline";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function structuralLeafPaths(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.length === 0
      ? [prefix]
      : value.flatMap((item, index) => structuralLeafPaths(item, `${prefix}.${index}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value).flatMap((key) =>
      structuralLeafPaths(value[key], prefix ? `${prefix}.${key}` : key)
    );
  }
  return [prefix];
}

function valueAtPath(value, path) {
  return path.split(".").reduce((owner, key) => owner[key], value);
}

function compile(source, artifact) {
  const compiled = spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 180_000, windowsHide: true },
  );
  assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
}

test("Stage 2 compiler CLI lowers one conditional function and call", {
  skip: process.platform !== "win32",
}, () => {
  const rootWork = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i152-stage2-conditional-"));
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

    const inputSource = join(work, "conditional-input.vkf");
    const oracleArtifact = join(work, `conditional-oracle${suffix}`);
    writeFileSync(inputSource, [
      "system: .system",
      "positive(x:num) -> num:",
      "    x > 0?",
      "        @: 1",
      "    @: 0",
      ":: positive(system.cpu_count())",
      "",
    ].join("\n"), "utf8");
    compile(inputSource, oracleArtifact);
    const oracleRun = spawnSync(oracleArtifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(oracleRun.status, 0, oracleRun.stderr);
    assert.equal(oracleRun.stdout.trim(), "1");

    const machine = JSON.parse(readFileSync(
      join(work, ".vkfbuild", "conditional-input", "machine-ir.json"),
      "utf8",
    ));
    const paths = structuralLeafPaths(machine);
    const observationExpression = paths
      .map((path) => {
        const value = valueAtPath(machine, path);
        return Array.isArray(value)
          ? '"[]"'
          : value === null
            ? '"null"'
            : typeof value === "boolean"
              ? JSON.stringify(String(value))
              : `module.${path}`;
      })
      .join(' & "\\n" & ');
    const shapeGuards = paths.flatMap((path) => {
      const value = valueAtPath(machine, path);
      if (Array.isArray(value)) {
        return [`(module.${path}.length() = 0)?! "MachineModule empty-vector shape changed"`];
      }
      if (value === null) {
        return [`(module.${path} = null)?! "MachineModule null shape changed"`];
      }
      if (typeof value === "boolean") {
        return [`(module.${path} = ${value})?! "MachineModule bit value changed"`];
      }
      return [];
    });

    const stage2Artifact = join(work, `stage2-conditional${suffix}`);
    const observation = join(work, "stage2-conditional-observation.txt");
    const provenance = join(work, "stage2-conditional-provenance.json");
    const cliSource = join(work, "stage2-conditional-compiler.vkf");
    const cliArtifact = join(work, `stage2-conditional-compiler${suffix}`);
    writeFileSync(cliSource, [
      "compiler_stage: .compiler",
      "scene_stage: .native_scene_compiler",
      "stdlib_stage: .stdlib",
      "math_stage: .math",
      "io_stage: .io",
      "source_path: io_stage.read_line()",
      "source: io_stage.read_text(source_path)",
      "module: compiler_stage.compile_tagged_numeric_positive_conditional(source)",
      ...shapeGuards,
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

    writeFileSync(inputSource, [
      "system: .system",
      "positive(x:num) -> num:",
      "    x > 0?",
      "        @: 2",
      "    @: 0",
      ":: positive(system.cpu_count())",
      "",
    ].join("\n"), "utf8");
    const rejected = runCli();
    assert.notEqual(rejected.status, 0, "invalid conditional source was accepted");
    assert.deepEqual(readFileSync(stage2Artifact), firstArtifact);
    assert.deepEqual(readFileSync(provenance), firstProvenance);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
