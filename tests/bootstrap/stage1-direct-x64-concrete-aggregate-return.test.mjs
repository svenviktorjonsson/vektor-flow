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
  : join(root, "build", "native-windows", "bin");
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);

test("direct x64 returns a concrete named aggregate", () => {
  const workRoot = join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "direct-x64-aggregate-return-"));
  try {
    const source = join(work, "aggregate-return.vkf");
    const artifact = join(work, `aggregate-return${executableSuffix}`);
    writeFileSync(
      source,
      [
        "ConcretePair: (left:num,right:num)",
        "make_pair(left:num,right:num) -> ConcretePair:",
        "    (left:left,right:right)",
        "pair: make_pair(20,22)",
        ":: pair.right",
        "",
      ].join("\n"),
      "utf8",
    );
    const compiled = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
    );
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.equal(existsSync(artifact), true, "compiler did not emit artifact");
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "22");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("direct x64 concrete MachineModule fallback does not retain speculative values", () => {
  const workRoot = join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "direct-x64-malformed-aggregate-return-"));
  try {
    const source = join(work, "malformed-aggregate-return.vkf");
    const artifact = join(work, `malformed-aggregate-return${executableSuffix}`);
    writeFileSync(
      source,
      [
        "ConcreteMachineModule: (schema:str,version:num,output_kind:str,output_count:num,outputs:any,output_tokens:any,string_data:any,entry:any,functions:any)",
        "make_module() -> ConcreteMachineModule:",
        '    (schema:"vektorflow.machine_ir",version:23,output_kind:"f64",output_count:1,outputs:[],output_tokens:[],string_bytes:77,entry:0,functions:[])',
        "module: make_module()",
        ":: module.version",
        "",
      ].join("\n"),
      "utf8",
    );
    const compiled = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
    );
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.equal(existsSync(artifact), true, "compiler did not emit artifact");
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "23");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
