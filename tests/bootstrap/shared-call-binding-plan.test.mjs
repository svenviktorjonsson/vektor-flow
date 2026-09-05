import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const executable = fileURLToPath(new URL("../../build/call-binding-plan-probe", import.meta.url));
const built = spawnSync("g++", ["-std=c++17", "-O1", `-I${root}`,
  `${root}/tests/fixtures/call_binding_plan_probe.cpp`, "-o", executable],
{ encoding: "utf8", timeout: 30_000, windowsHide: true });

for (const name of ["binding", "incremental", "defaults", "diagnostics", "mask-boundaries"]) {
  test(`shared pure call plan: ${name}`, () => {
    assert.equal(built.error, undefined, built.error?.message);
    assert.equal(built.status, 0, built.stderr);
    const result = spawnSync(executable, [name], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "ok\n");
  });
}
