import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const retiredShims = [
  "web/vf-ui/native-event-probe.html",
  "web/vf-ui/native-scene-probe.js",
  "web/vf-ui/vf-native-scene-cube-hover.js",
  "web/vf-ui/vf-native-scene-dimension-mix.js",
  "web/vf-ui/vf-native-scene-face-edge-vertex.js",
  "web/vf-ui/vf-native-scene-ocean.js",
];

test("retired native-scene shims stay outside the runtime", () => {
  for (const relativePath of retiredShims) {
    assert.equal(existsSync(resolve(root, relativePath)), false, relativePath);
  }

  const embeddedAssets = readFileSync(
    resolve(root, "native/VfOverlay/tools/generate_embedded_vf_ui_assets.cmake"),
    "utf8",
  );
  const launcher = readFileSync(
    resolve(root, "native/VfOverlay/vkf_launcher.cpp"),
    "utf8",
  );
  for (const relativePath of retiredShims) {
    const fileName = relativePath.split("/").at(-1);
    assert.doesNotMatch(embeddedAssets, new RegExp(fileName, "u"));
    assert.doesNotMatch(launcher, new RegExp(fileName, "u"));
  }
});
