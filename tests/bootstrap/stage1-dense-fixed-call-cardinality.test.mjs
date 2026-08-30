import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);

function makeWork(prefix) {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  return mkdtempSync(join(workRoot, prefix));
}

function compile(source, artifact) {
  return spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
  );
}

test("dense fixed call layouts reject extra source lanes", () => {
  const work = makeWork("i31e-extra-");
  try {
    const source = join(work, "extra-lane.vkf");
    const artifact = join(work, `extra-lane${executableSuffix}`);
    writeFileSync(
      source,
      [
        "sum_three(values:any):",
        "    values.0.value + values.1.value + values.2.value",
        "values: [(value:1,),(value:2,),(value:3,),(value:4,)]",
        ":: sum_three(values)",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = compile(source, artifact);
    assert.equal(result.error, undefined, `compile did not start: ${result.error}`);
    assert.notEqual(result.status, 0, "extra dense lane unexpectedly compiled");
    assert.match(
      result.stderr,
      /machine IR call argument width mismatch for sum_three\.values: expected 3\[0:1,1:1,2:1\], got 4\[0:1,1:1,2:1,3:1\]/,
    );
    assert.equal(existsSync(artifact), false, "rejected dense layout emitted an artifact");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("dense fixed call layouts preserve exact source lanes", () => {
  const work = makeWork("i31e-exact-");
  try {
    const source = join(work, "exact-lanes.vkf");
    const artifact = join(work, `exact-lanes${executableSuffix}`);
    writeFileSync(
      source,
      [
        "sum_three(values:any):",
        "    values.0.value + values.1.value + values.2.value",
        "values: [(value:1,),(value:2,),(value:3,)]",
        ":: sum_three(values)",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = compile(source, artifact);
    assert.equal(result.error, undefined, `compile did not start: ${result.error}`);
    assert.equal(result.status, 0, result.stderr);
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "6");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
