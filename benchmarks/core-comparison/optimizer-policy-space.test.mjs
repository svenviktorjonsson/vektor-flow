import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const source = resolve(
  benchmarkRoot,
  "published",
  "scalar-control-small",
  "vkf.vkf",
);

function focusedDriver() {
  const executable = `vkf-driver${process.platform === "win32" ? ".exe" : ""}`;
  const candidates = [
    process.env.VKF_NBODY_NATIVE_DRIVER,
    process.platform === "win32"
      ? resolve(
          tmpdir(),
          "vektor-flow-core-comparison",
          "native-compiler",
          executable,
        )
      : resolve(benchmarkRoot, ".work", "native-compiler", executable),
  ].filter(Boolean);
  const driver = candidates.find(existsSync);
  assert.ok(
    driver,
    `focused native compiler not found; checked ${candidates.join(", ")}`,
  );
  return driver;
}

function compileWithTuner(extraArguments) {
  const workRoot = mkdtempSync(resolve(tmpdir(), "vkf-policy-space-"));
  try {
    const isolatedSource = resolve(workRoot, basename(source));
    copyFileSync(source, isolatedSource);
    const result = spawnSync(
      focusedDriver(),
      [
        "--aot",
        "--diagnostics",
        "--optimizer-policy",
        "tune",
        ...extraArguments,
        "--source",
        isolatedSource,
      ],
      {
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
      },
    );
    assert.equal(
      result.status,
      0,
      `${result.stdout}\n${result.stderr}`.trim(),
    );
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
    return JSON.parse(readFileSync(summary.manifest_path, "utf8"));
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

test("scalar tuning excludes vector-only FMA policies", () => {
  const manifest = compileWithTuner(["--optimizer-time-limit-ms", "80"]);
  assert.deepEqual(
    manifest.empirical_tuning.candidates.map(({ policy }) => policy),
    ["mask-8", "mask-0"],
  );
});

test("explicit landscapes retain the complete policy space", () => {
  const manifest = compileWithTuner(["--optimizer-landscape-runs", "1"]);
  const policies = new Set(
    manifest.empirical_tuning.candidates.map(({ policy }) => policy),
  );
  assert.equal(policies.size, 256);
  assert.ok(policies.has("mask-0"));
  assert.ok(policies.has("mask-40"));
  assert.ok(policies.has("mask-ff"));
});
