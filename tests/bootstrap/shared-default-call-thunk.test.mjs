import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadSharedFrontend } from "../../tools/verify-browser-frontend-parity.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const executable = `${root}build/default-call-thunk-probe`;
const built = spawnSync("g++", ["-std=c++17", "-O1", `-I${root}`, `-I${root}native/VfOverlay`,
  `${root}tests/fixtures/default_call_thunk_probe.cpp`, `${root}native/VfOverlay/vf/json.cpp`, "-o", executable],
{ encoding: "utf8", timeout: 30_000, windowsHide: true });
const compiler = loadSharedFrontend();

async function construct(source, positional, names = []) {
  assert.equal(built.error, undefined, built.error?.message);
  assert.equal(built.status, 0, built.stderr);
  const api = await compiler;
  const native = api.native(source);
  assert.deepEqual(api.browser(source), native);
  assert.equal(native.ok, true, native.message);
  const probe = spawnSync(executable, [], { input: JSON.stringify({ typed_ir: native.typed_ir, positional, names }),
    encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(probe.error, undefined, probe.error?.message);
  assert.equal(probe.status, 0, probe.stderr);
  const result = JSON.parse(probe.stdout);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.original_unchanged, true);
  return result.thunk;
}

test("private default thunk retains callee binding order without changing original public parameters", async () => {
  const source = "f(x:num=2, y:num=x+1, z:num=y+1) -> num: x+y+z\n";
  for (const [positional, names, provided, omitted] of [
    [0, [], [], ["x", "y", "z"]],
    [1, [], ["x"], ["y", "z"]],
    [0, ["y"], ["y"], ["x", "z"]],
  ]) {
    const thunk = await construct(source, positional, names);
    assert.deepEqual(thunk.params.map(parameter => parameter.name), provided);
    assert.ok(thunk.params.every(parameter => parameter.default === null));
    const body = thunk.body.body;
    assert.deepEqual(body.slice(0, -1).map(binding => binding.name), omitted);
    const call = body.at(-1).expr;
    assert.equal(call.callee.name, "f");
    assert.deepEqual(call.args.map(argument => argument.name), ["x", "y", "z"]);
    assert.deepEqual(call.named_args, []);
    assert.deepEqual(call.spread_args, []);
  }
});

test("private default thunk excludes a supplied parameter's failing default expression", async () => {
  const thunk = await construct("f(x:num=(0)?!) -> num: x\n", 0, ["x"]);
  assert.equal(thunk.params[0].default, null);
  assert.equal(thunk.body.body.length, 1);
  assert.equal(thunk.body.body[0].expr.kind, "call");
});
