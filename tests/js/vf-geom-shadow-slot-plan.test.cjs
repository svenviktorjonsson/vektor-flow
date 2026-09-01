const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/geom/vf-geom-wgpu.js"),
  "utf8"
);

const context = vm.createContext({
  console,
  Date,
  setTimeout,
  clearTimeout,
  VfGeomMath: {},
});
vm.runInContext(source, context, { filename: "vf-geom-wgpu.js" });

const renderer = new context.VfGeomWgpu(
  { width: 800, height: 450 },
  () => null
);

const slots = renderer._planShadowLightSlots([
  { id: "warm-key", casts_shadow: true },
  { id: "cool-fill", casts_shadow: false },
  { id: "mirror-rim", casts_shadow: true },
]);

assert.deepEqual(
  Array.from(slots, (light) => light ? light.id : null),
  ["warm-key", null, "mirror-rim", null]
);
