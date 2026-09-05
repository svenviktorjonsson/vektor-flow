import assert from "node:assert/strict";
import test from "node:test";
import { loadSharedFrontend } from "../../tools/verify-browser-frontend-parity.mjs";

test("native and WASM compiler transport preserve every bit of a parsed double", async () => {
  const api = await loadSharedFrontend();
  const value = 0.010000000000000002;
  const source = `value: ${value}\n:: value\n`;
  for (const target of ["native", "browser"]) {
    const result = api[target](source);
    assert.equal(result.ok, true, result.message);
    const binding = result.typed_ir.body.find(statement => statement.name === "value");
    assert.equal(binding.value.value, value, `${target} compiler JSON transport rounded a valid double`);
  }
});
