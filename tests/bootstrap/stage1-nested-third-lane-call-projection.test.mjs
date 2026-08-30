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

function compileResult(source, artifact) {
  return spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
  );
}

function compile(source, artifact) {
  const result = compileResult(source, artifact);
  assert.equal(result.error, undefined, `compile did not start: ${result.error}`);
  assert.equal(result.status, 0, result.stderr);
}

function nestedApplicationSource(callExpression) {
  return [
    "third_lane_kind(value:any):",
    "    value.body.0.body.2.kind",
    "application: (",
    "    body: [(",
    "        body: [",
    '            (kind: "first", value: 1),',
    '            (kind: "second", label: "middle"),',
    '            (flag: true, kind: "third")',
    "        ],",
    '        kind: "function",',
    '        name: "sample"',
    "    ), (expr: (kind: \"const\", value: 7), kind: \"entry\")],",
    '    kind: "typed_module"',
    ")",
    `:: ${callExpression}`,
    "",
  ].join("\n");
}

test("direct calls project a nested heterogeneous third lane", () => {
  const work = makeWork("i31d-ok-");
  try {
    const source = join(work, "third-lane.vkf");
    const artifact = join(work, `third-lane${executableSuffix}`);
    writeFileSync(
      source,
      nestedApplicationSource("third_lane_kind(application)"),
      "utf8",
    );
    compile(source, artifact);

    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "third");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("exact nested layouts keep the no-projection call path", () => {
  const work = makeWork("i31d-full-");
  try {
    const source = join(work, "full-layout.vkf");
    const artifact = join(work, `full-layout${executableSuffix}`);
    writeFileSync(
      source,
      [
        "Leaf: (flag:bit,kind:str)",
        "Nested: (count:int,leaf:Leaf)",
        "identity(value:Nested): value",
        'payload: (count:3,leaf:(flag:true,kind:"third"))',
        "returned: identity(payload)",
        ":: returned.count",
        ":: returned.leaf.flag",
        ":: returned.leaf.kind",
        "",
      ].join("\n"),
      "utf8",
    );
    compile(source, artifact);

    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.stdout.trim().split(/\r?\n/), ["3", "1", "third"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("missing nested third lanes reject before artifact output", () => {
  const work = makeWork("i31d-bad-");
  try {
    const source = join(work, "missing-third-lane.vkf");
    const artifact = join(work, `missing-third-lane${executableSuffix}`);
    writeFileSync(
      source,
      [
        "third_lane_kind(value:any):",
        "    value.body.0.body.2.kind",
        "malformed: (",
        "    body: [(",
        "        body: [",
        '            (kind: "first", value: 1),',
        '            (kind: "second", label: "middle")',
        "        ],",
        '        kind: "function",',
        '        name: "sample"',
        "    ), (expr: (kind: \"const\", value: 7), kind: \"entry\")],",
        '    kind: "typed_module"',
        ")",
        ":: third_lane_kind(malformed)",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = compileResult(source, artifact);
    assert.equal(result.error, undefined, `compile did not start: ${result.error}`);
    assert.notEqual(result.status, 0, "malformed sparse layout unexpectedly compiled");
    assert.match(
      result.stderr,
      /machine IR call argument structure mismatch for third_lane_kind\.value/,
    );
    assert.equal(existsSync(artifact), false, "rejected input emitted an artifact");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
