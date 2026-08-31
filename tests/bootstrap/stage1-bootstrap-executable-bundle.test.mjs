import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const defaultNativeBin = process.platform === "win32"
  ? join(root, "build", "050-b00", "bin", "Release")
  : join(root, "build", "050-b00", "bin");
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : defaultNativeBin;
const frontendBin = process.env.VKF_BOOTSTRAP_FRONTEND_BIN
  ? resolve(process.env.VKF_BOOTSTRAP_FRONTEND_BIN)
  : nativeBin;
const bundleTool = process.env.VKF_BUNDLE_ARTIFACT_TOOL
  ? resolve(process.env.VKF_BUNDLE_ARTIFACT_TOOL)
  : join(nativeBin, `vkf_bootstrap_bundle_artifact_smoke${executableSuffix}`);

test("bootstrap bundle emits every declared compiler source as an executable", () => {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "i97-executable-bundle-"));
  try {
    const manifest = JSON.parse(readFileSync(
      join(root, "compiler", "self_hosted", "vf-compiler-bootstrap.json"),
      "utf8",
    ));
    for (const source of manifest.sources) {
      const destination = join(work, source.path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, source.path), destination);
    }
    const manifestPath = join(work, "compiler", "self_hosted", "vf-compiler-bootstrap.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const run = spawnSync(bundleTool, [
      "--manifest", manifestPath,
      "--lexer", join(frontendBin, `vkf_lexer_cursor_smoke${executableSuffix}`),
      "--parser", join(frontendBin, `vkf_parser_token_stream_smoke${executableSuffix}`),
      "--ir", join(frontendBin, `vkf_ast_to_ir_smoke${executableSuffix}`),
    ], {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, VKF_NATIVE_BIN: nativeBin },
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `bundle tool did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);

    const summary = JSON.parse(run.stdout);
    assert.equal(summary.status, "ok");
    assert.equal(summary.artifact_count, manifest.source_count);
    assert.deepEqual(summary.units.map((unit) => unit.path), manifest.source_order);
    for (const unit of summary.units) {
      if (process.platform === "win32") {
        assert.deepEqual([...readFileSync(unit.artifact_path).subarray(0, 2)], [0x4d, 0x5a]);
      }
      const executed = spawnSync(unit.artifact_path, [], {
        cwd: work,
        encoding: "utf8",
        timeout: 2_000,
        windowsHide: true,
      });
      assert.equal(executed.error, undefined, `${unit.path} did not start: ${executed.error}`);
      assert.equal(executed.status, 0, `${unit.path}: ${executed.stderr}`);
      assert.equal(executed.stdout, "", unit.path);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
