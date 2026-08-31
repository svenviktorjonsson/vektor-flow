const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/geom/vf-geom-wgpu.js"),
  "utf8"
);
const displaySource = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

const context = vm.createContext({
  console,
  Date,
  setTimeout,
  clearTimeout,
  GPUTextureUsage: {
    COPY_SRC: 1,
    RENDER_ATTACHMENT: 2,
    TEXTURE_BINDING: 4,
  },
  VfGeomMath: {},
});
vm.runInContext(source, context, { filename: "vf-geom-wgpu.js" });

const renderer = new context.VfGeomWgpu(
  { width: 800, height: 450 },
  () => null
);
const createdTextures = [];
renderer._device = {
  createTexture(descriptor) {
    const texture = {
      descriptor,
      destroyed: false,
      createView() { return {}; },
      destroy() { this.destroyed = true; },
    };
    createdTextures.push(texture);
    return texture;
  },
};
renderer._format = "bgra8unorm";
renderer._ensurePartBindGroup = () => {};
renderer._frameId = "mirror-room";
renderer._renderEvidenceSequence = 9;
renderer._lastSurfacePassCount = 2;
renderer._lastShadowDrawCount = 7;
renderer._lastShadowCacheHitCount = 3;
renderer._lastActiveLightCount = 4;

const surface = {};
renderer._parts = [surface, { surfaceExternalView: {} }];
renderer._ensureSurfaceTarget(surface, 320, 180);

const receipt = JSON.parse(JSON.stringify(renderer._debugRenderEvidence()));
assert.deepEqual(receipt, {
  schema: "vf-render-evidence/1",
  frameId: "mirror-room",
  frameSequence: 9,
  width: 800,
  height: 450,
  format: "bgra8unorm",
  sampleCount: 4,
  surfacePasses: 2,
  surfaceTargetPixels: 57600,
  surfaceTargetBytes: 2073600,
  shadowDraws: 7,
  shadowCacheHits: 3,
  activeLights: 4,
});
assert.equal(createdTextures.length, 3);

receipt.surfacePasses = 99;
assert.equal(renderer._debugRenderEvidence().surfacePasses, 2);

const renderedSurface = {
  objectId: 17,
  mesh: {
    visible: true,
    surface_system: { kind: "screen" },
  },
};
renderer._parts = [renderedSurface];
renderer._lastSurfacePassCount = 0;
renderer._surfaceTargetDimsForPart = () => ({ width: 256, height: 128 });
renderer._resolveScreenRenderCamera = () => ({});
renderer._encodeScenePartsColorPass = () => {};
renderer._renderSurfacePasses({}, { camera: {} }, 0, 800, 450);
assert.equal(renderer._debugRenderEvidence().surfacePasses, 1);

assert.match(
  displaySource,
  /renderEvidence:\s*renderer\s*&&\s*typeof renderer\._debugRenderEvidence === "function"/
);

console.log("vf-geom render evidence tests passed");
