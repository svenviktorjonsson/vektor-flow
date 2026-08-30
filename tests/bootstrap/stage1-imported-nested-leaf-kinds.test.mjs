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
    [
      "-b",
      source,
      "-o",
      artifact,
      "--diagnostics",
      "--optimizer-policy",
      "mask-0",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    },
  );
}

function writeNestedModule(work) {
  writeFileSync(
    join(work, "nested_leaf_kinds.vkf"),
    [
      "Leaf: (count:int, enabled:bit, absent:any, scale:num)",
      "Envelope: (items:(Leaf,), marker:bit)",
      "",
      "make_envelope() -> Envelope:",
      "    (items:((count:7, enabled:false, absent:null, scale:2.5),), marker:true)",
      "",
    ].join("\n"),
    "utf8",
  );
}

test("imported nominal nested returns preserve exact structural leaf kinds", () => {
  const work = makeWork("i31c-imported-leaf-kinds-");
  try {
    writeNestedModule(work);
    const source = join(work, "probe.vkf");
    const artifact = join(work, `probe${executableSuffix}`);
    writeFileSync(
      source,
      [
        "nested: .nested_leaf_kinds",
        "envelope: nested.make_envelope()",
        ":: envelope.items.0.count",
        ":: envelope.items.0.enabled",
        ":: envelope.items.0.absent",
        ":: envelope.items.0.scale",
        ":: envelope.marker",
        "",
      ].join("\n"),
      "utf8",
    );

    const compile = compileResult(source, artifact);
    assert.equal(compile.error, undefined, `failed to start ${compiler}: ${compile.error}`);
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `nested return probe did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.stdout.trim().split(/\r?\n/), ["7", "false", "null", "2.5", "true"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("malformed imported nested projections never emit an artifact", () => {
  const work = makeWork("i31c-malformed-projection-");
  try {
    writeNestedModule(work);
    const source = join(work, "malformed.vkf");
    const artifact = join(work, `malformed${executableSuffix}`);
    writeFileSync(
      source,
      [
        "nested: .nested_leaf_kinds",
        "envelope: nested.make_envelope()",
        ":: envelope.items.0.missing",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = compileResult(source, artifact);
    assert.equal(result.error, undefined, `failed to start ${compiler}: ${result.error}`);
    assert.notEqual(result.status, 0, "malformed projection unexpectedly compiled");
    assert.notEqual(result.status, 3221225477, "compiler crashed with 0xC0000005");
    assert.notEqual(result.status, -1073741819, "compiler crashed with 0xC0000005");
    assert.match(result.stderr, /unknown machine IR aggregate projection .*\.missing/);
    assert.equal(existsSync(artifact), false, "malformed projection emitted an artifact");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
