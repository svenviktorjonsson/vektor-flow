import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const cmake = readFileSync(path.join(root, "native", "VfOverlay", "CMakeLists.txt"), "utf8");
const hostPath = path.join(root, "native", "VfOverlay", "vf", "release_overlay_host.cpp");

const forbiddenObjects = [
  "compiled_ui_bootstrap_host",
  "compiled_ui_bootstrap_packet_bridge",
  "compiled_ui_bootstrap_runtime",
  "compiled_ui_runtime_demo",
  "compiled_ui_runtime_loader",
  "compiled_ui_runtime_registry",
  "overlay_geometry_ledger_runtime",
  "overlay_packet_runtime",
];

test("shipped overlay targets use the thin resource host source set", () => {
  const match = cmake.match(/set\(VF_OVERLAY_RELEASE_HOST_SOURCES([\s\S]*?)\n\)/);
  assert.ok(match, "release host source set is missing");
  const releaseSources = match[1];
  assert.match(releaseSources, /vf\/release_overlay_host\.cpp/);
  for (const forbidden of forbiddenObjects) {
    assert.doesNotMatch(releaseSources, new RegExp(forbidden));
  }
  for (const target of ["vf-overlay", "vkf-ui-package", "vkf-runner"]) {
    const targetPattern = new RegExp(`add_executable\\(${target}[\\s\\S]*?VF_OVERLAY_RELEASE_HOST_SOURCES`);
    assert.match(cmake, targetPattern, `${target} does not use the release source set`);
  }
});

test("thin release host maps packaged resources without legacy semantic transports", () => {
  const source = readFileSync(hostPath, "utf8");
  assert.match(source, /SetVirtualHostNameToFolderMapping/);
  assert.match(source, /CreateCoreWebView2Controller/);
  assert.match(source, /WM_NCHITTEST/);
  assert.match(source, /HTTRANSPARENT/);
  assert.match(source, /ApplyHitRegionAdapterMessage/);
  assert.match(source, /PushOpaqueEvent/);
  assert.match(source, /CreateSharedBuffer/);
  assert.match(source, /PostSharedBufferToScript/);
  assert.doesNotMatch(source, /localhost|\bHTTP\b|cJSON|runtime.packet|compiled.ui|geometry.ledger/i);
});

test("release hit regions and events use a semantics-free internal adapter", () => {
  const adapter = readFileSync(
    path.join(root, "native", "VfOverlay", "vf", "release_host_adapter.cpp"),
    "utf8",
  );
  assert.match(adapter, /vf_host_hit_regions_v1/);
  assert.match(adapter, /PushOpaqueEvent/);
  assert.doesNotMatch(adapter, /ButtonClicked|SliderValueChanged|FrameEvent|SliderEvent/);
});
