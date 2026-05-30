const assert = require("node:assert/strict");
const registry = require("../../web/vf-ui/vf-compiled-ui-module-registry.js");

assert.equal(registry.BUILTIN_MODULE_IDS.rectDemo, "rect-demo");
assert.equal(registry.BUILTIN_NATIVE_LIBRARIES.rectDemo, "vf-compiled-ui-demo.dll");
assert.equal(registry.FACTORY_IDS.fullDemo, "full-demo");

const rectDemo = registry.getBuiltinCompiledUiModule("rect-demo");
assert.ok(rectDemo);
assert.equal(rectDemo.name, "rect-demo");
assert.equal(rectDemo.nativeLibrary, "vf-compiled-ui-demo.dll");
assert.equal(rectDemo.wasmFactory, "full-demo");

const resolved = registry.resolveBuiltinCompiledUiWasmFactory("rect-demo");
assert.ok(resolved);
assert.equal(resolved.name, "rect-demo");
assert.equal(resolved.wasmFactory, "full-demo");
assert.equal(typeof resolved.instantiate, "function");

console.log("vf-compiled-ui-module-registry-seams tests passed");
