const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sceneSource = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-runtime-scene.js"),
  "utf8"
);
const displaySource = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.ok(sceneSource.includes("function runtimeHasStandaloneDisplayContent()"));
assert.ok(sceneSource.includes("function runtimeSceneDeclaresFrames()"));
assert.ok(sceneSource.includes("global.__vfSceneDeclaredFrameCount = upserts.length;"));
assert.ok(sceneSource.includes("(!runtimeHasStandaloneDisplayContent() || runtimeSceneDeclaresFrames())"));
assert.ok(sceneSource.includes('if (attr === "false") { return false; }'));
assert.ok(sceneSource.includes('if (attr === "true") { return true; }'));
assert.ok(sceneSource.includes("return !!(global.chrome && global.chrome.webview);"));
assert.ok(displaySource.includes("function _setStandaloneDisplayContentPresent(present)"));
assert.ok(displaySource.includes("global.__vfHasStandaloneDisplayContent = !!present;"));
const frameSource = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-frame.js"),
  "utf8"
);
assert.ok(frameSource.includes("postEmptyNativeHostLayout(layer)"));
assert.ok(frameSource.includes("forceEmpty: true"));
assert.ok(frameSource.includes("clearOverlayGeometry: true"));
assert.ok(frameSource.indexOf("api.destroy();") < frameSource.indexOf("wv.postMessage({ type: \"close\" });"));

console.log("vf-runtime-scene-close-policy tests passed");
