import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const host = readFileSync(
  resolve(root, "native/VfOverlay/vf/release_overlay_host.cpp"),
  "utf8",
);
const runtime = readFileSync(resolve(root, "web/vf-ui/vf-native-scene.js"), "utf8");
const stager = readFileSync(
  resolve(root, "compiler/native/vkf_native_scene_artifact_stager.cpp"),
  "utf8",
);
const gallery = readFileSync(
  resolve(root, "examples/material_ui_gallery/app.vkf"),
  "utf8",
);

test("native scenes default to a regular taskbar window and can request topmost", () => {
  assert.match(
    host,
    /(?:CreateWindowExW\(\s*WS_EX_APPWINDOW,|:\s*WS_EX_APPWINDOW;)/u,
  );
  assert.match(host, /ReleaseHostMessageTryWindowTopmost/u);
  assert.match(host, /HWND_TOPMOST/u);
  assert.match(host, /HWND_NOTOPMOST/u);
  assert.match(runtime, /type: "vf-window-mode"/u);
  assert.match(runtime, /always_ontop: config\.always_ontop === true/u);
  assert.match(stager, /"always_ontop":/u);
  assert.match(gallery, /always_ontop:false/u);
});
