import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-i95", "bin");
const bundleTool = process.env.VKF_BUNDLE_ARTIFACT_TOOL
  ? resolve(process.env.VKF_BUNDLE_ARTIFACT_TOOL)
  : join(root, "build", "050-i95", "bin", `vkf_bootstrap_bundle_artifact_smoke${executableSuffix}`);

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

test("bootstrap bundle emits an executable compiler-source unit", () => {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "i95-executable-unit-"));
  try {
    const sourceFile = join(work, "compiler.vkf");
    copyFileSync(join(root, "compiler", "self_hosted", "compiler.vkf"), sourceFile);
    for (const dependency of [
      "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation", "pe_x64",
    ]) {
      copyFileSync(
        join(root, "compiler", "self_hosted", `${dependency}.vkf`),
        join(work, `${dependency}.vkf`),
      );
    }
    const sourcePath = relative(dirname(workRoot), sourceFile).replaceAll("\\", "/");
    const canonicalSource = readFileSync(sourceFile, "utf8").replace(/\r\n/g, "\n");
    const sourceIdentity = sha256(canonicalSource);
    const manifest = {
      schema: "vektor-flow/compiler-bootstrap",
      version: 1,
      bootstrap_boundary: {
        parser: "native-bootstrap",
        scope: "executable compiler-source tracer",
        handoff_goal: "emit one executable Stage-1 bundle unit",
      },
      sources: [{
        path: sourcePath,
        source_sha256: sourceIdentity,
        parsed_with_native_parser: true,
      }],
      source_order: [sourcePath],
      source_count: 1,
      bundle_sha256: sha256(`${sourcePath}\n${sourceIdentity}`),
    };
    const manifestPath = join(work, "vf-compiler-bootstrap.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const run = spawnSync(bundleTool, [
      "--manifest", manifestPath,
      "--lexer", join(nativeBin, `vkf_lexer_cursor_smoke${executableSuffix}`),
      "--parser", join(nativeBin, `vkf_parser_token_stream_smoke${executableSuffix}`),
      "--ir", join(nativeBin, `vkf_ast_to_ir_smoke${executableSuffix}`),
    ], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, VKF_NATIVE_BIN: nativeBin },
      timeout: 30_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `bundle tool did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);

    const summary = JSON.parse(run.stdout);
    assert.equal(summary.status, "ok");
    assert.equal(summary.artifact_count, 1);
    const artifactPath = summary.units[0].artifact_path;
    assert.equal(artifactPath.endsWith(executableSuffix), true, artifactPath);
    assert.deepEqual([...readFileSync(artifactPath).subarray(0, 2)], [0x4d, 0x5a]);

    const executed = spawnSync(artifactPath, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(executed.error, undefined, `bundle unit did not start: ${executed.error}`);
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
