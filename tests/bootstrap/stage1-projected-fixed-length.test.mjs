import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function nestedPayloadSource(bodyExpression) {
  return [
    "nested_body_length(value:any) -> num:",
    "    value.body.0.body.length()",
    "payload: (",
    "    body: [(",
    `        body: ${bodyExpression},`,
    '        kind: "function"',
    "    )],",
    '    kind: "typed_module"',
    ")",
    ":: nested_body_length(payload)",
    "",
  ].join("\n");
}

test("length observes every lane of a structurally projected fixed list", () => {
  const work = makeWork("i31f-ok-");
  try {
    const source = join(work, "projected-length.vkf");
    const artifact = join(work, `projected-length${executableSuffix}`);
    writeFileSync(
      source,
      nestedPayloadSource(
        '[(kind:"first",value:1),(kind:"second",label:"middle"),(flag:true,kind:"third")]',
      ),
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
    assert.equal(run.stdout.trim(), "3");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("length still rejects a projected scalar", () => {
  const work = makeWork("i31f-bad-");
  try {
    const source = join(work, "scalar-length.vkf");
    const artifact = join(work, `scalar-length${executableSuffix}`);
    writeFileSync(
      source,
      [
        "payload: (count:3,)",
        ":: payload.count.length()",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = compile(source, artifact);
    assert.equal(result.error, undefined, `compile did not start: ${result.error}`);
    assert.notEqual(result.status, 0, "projected scalar length unexpectedly compiled");
    assert.equal(existsSync(artifact), false);
    assert.match(result.stderr, /machine IR length\(\) requires a tuple, vector, or variadic list/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
