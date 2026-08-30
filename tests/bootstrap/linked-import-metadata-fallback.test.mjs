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
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin");
const compiler = join(nativeBin, `vkf${executableSuffix}`);
const fallbackBin = process.env.VKF_FALLBACK_BIN
  ? resolve(process.env.VKF_FALLBACK_BIN)
  : nativeBin;
const fallback = join(fallbackBin, `vkf_cpp_aot_artifact${executableSuffix}`);

function compile(source) {
  return spawnSync(
    compiler,
    [
      "--source",
      source,
      "--artifact",
      fallback,
      "--diagnostics",
      "--optimizer-policy",
      "mask-0",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    },
  );
}

function makeWork(prefix) {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  return mkdtempSync(join(workRoot, prefix));
}

test("C++ fallback skips linked import metadata and executes its scalar function", () => {
  const work = makeWork("linked-import-metadata-fallback-");
  try {
    copyFileSync(
      join(root, "tests", "bootstrap", "fixtures", "linked-scalar-function.vkf"),
      join(work, "linked_scalar_function.vkf"),
    );
    const source = join(work, "linked-scalar-function-probe.vkf");
    writeFileSync(
      source,
      [
        "fixture: .linked_scalar_function",
        ":: fixture.twice(21)",
        "",
      ].join("\n"),
      "utf8",
    );

    const compiled = compile(source);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    const summary = JSON.parse(compiled.stdout);
    const typed = JSON.parse(readFileSync(summary.typed_ir_path, "utf8"));
    assert.ok(
      typed.body.some((item) => item.kind === "module_import"),
      "probe did not exercise linked module-import metadata",
    );
    assert.ok(
      typed.body.some(
        (item) => item.kind === "function" && item.name === "__vkf_module_fixture__twice",
      ),
      "linked scalar function was not retained",
    );

    const run = spawnSync(summary.artifact_path, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `linked scalar artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "42");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("unresolved linked imports fail before fallback artifact generation", () => {
  const work = makeWork("unresolved-import-fallback-");
  try {
    const source = join(work, "unresolved-import.vkf");
    writeFileSync(source, "missing: .definitely_missing_module\n:: 1\n", "utf8");
    const compiled = compile(source);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.notEqual(compiled.status, 0, "unresolved import unexpectedly compiled");
    assert.match(compiled.stderr, /module path does not exist|could not resolve|unresolved/i);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("resolved empty linked modules remain valid metadata", () => {
  const work = makeWork("empty-linked-import-fallback-");
  try {
    copyFileSync(
      join(root, "tests", "bootstrap", "fixtures", "empty-linked-module.vkf"),
      join(work, "empty_linked_module.vkf"),
    );
    const source = join(work, "empty-linked-import.vkf");
    writeFileSync(source, "empty: .empty_linked_module\n:: 5\n", "utf8");
    const compiled = compile(source);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    const summary = JSON.parse(compiled.stdout);
    const typed = JSON.parse(readFileSync(summary.typed_ir_path, "utf8"));
    assert.ok(typed.body.some((item) => item.kind === "module_import"));
    assert.equal(
      typed.body.some(
        (item) => typeof item.name === "string" && item.name.startsWith("__vkf_module_empty__"),
      ),
      false,
      "empty module unexpectedly needed a declaration marker",
    );
    const run = spawnSync(summary.artifact_path, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `empty-module artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "5");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
