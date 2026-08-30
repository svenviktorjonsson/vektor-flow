import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function producerSource({ moduleExtra = "", functionExtra = "", loopExtra = "" }) {
  return [
    "make_payload(seed:num):",
    "    (",
    "        body:[(",
    "            body:(body:[",
    '                (kind:"first",),',
    "                (",
    `                    body:(body:[(kind:\"nested\",)${loopExtra}],kind:\"block\"),`,
    '                    kind:"loop"',
    "                ),",
    `                (kind:\"last\",)${functionExtra}`,
    '            ],kind:"block"),',
    '            kind:"function"',
    `        ),(kind:\"entry\",)${moduleExtra}],`,
    '        kind:"typed_module"',
    "    )",
    "",
  ].join("\n");
}

const consumerSource = [
  "cardinalities_match(value:any) -> bit:",
  "    (value.body.length() = 2 /\\",
  "        value.body.0.body.body.length() = 3 /\\",
  "        value.body.0.body.body.1.body.body.length() = 1)",
  "accepts_payload(value:any) -> bit:",
  "    value.kind",
  "    value.body.0.kind",
  "    value.body.0.body.kind",
  "    value.body.0.body.body.0.kind",
  "    value.body.0.body.body.1.kind",
  "    value.body.0.body.body.1.body.kind",
  "    value.body.0.body.body.1.body.body.0.kind",
  "    value.body.0.body.body.2.kind",
  "    value.body.1.kind",
  "    cardinalities_match(value)",
  "",
].join("\n");

const mainSource = [
  "shapes: .shapes",
  "checks: .checks",
  "payload: shapes.make_payload(0)",
  ":: checks.accepts_payload(payload)",
  "",
].join("\n");

function compileAndRun(producerText, prefix) {
  const work = makeWork(prefix);
  try {
    const source = join(work, "cardinality.vkf");
    const artifact = join(work, `cardinality${executableSuffix}`);
    writeFileSync(join(work, "shapes.vkf"), producerText, "utf8");
    writeFileSync(join(work, "checks.vkf"), consumerSource, "utf8");
    writeFileSync(source, mainSource, "utf8");
    const compile = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
    );
    assert.equal(compile.error, undefined, `compile did not start: ${compile.error}`);
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test("forwarded fixed-list cardinality preserves exact producer shapes", () => {
  assert.equal(compileAndRun(producerSource({}), "i31g-exact-"), "true");
  assert.equal(
    compileAndRun(producerSource({ moduleExtra: ',(kind:"extra",)' }), "i31g-module-"),
    "false",
  );
  assert.equal(
    compileAndRun(producerSource({ functionExtra: ',(kind:"extra",)' }), "i31g-function-"),
    "false",
  );
  assert.equal(
    compileAndRun(producerSource({ loopExtra: ',(kind:"extra",)' }), "i31g-loop-"),
    "false",
  );
});
