import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const cmake = readFileSync(path.join(root, "native", "VfOverlay", "CMakeLists.txt"), "utf8");
const hostPath = path.join(root, "native", "VfOverlay", "vf", "release_overlay_host.cpp");
const launcher = readFileSync(
  path.join(root, "native", "VfOverlay", "vkf_launcher.cpp"),
  "utf8",
);
const embeddedAssets = readFileSync(
  path.join(root, "native", "VfOverlay", "tools", "generate_embedded_vf_ui_assets.cmake"),
  "utf8",
);

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
  assert.match(source, /CreateCoreWebView2CompositionController/);
  assert.doesNotMatch(source, /->CreateCoreWebView2Controller\(/);
  assert.match(source, /SendMouseInput/);
  assert.match(source, /SetWindowRgn/);
  assert.match(source, /ClearHostInputRegionForDrag/);
  assert.match(source, /WS_EX_APPWINDOW/);
  assert.doesNotMatch(source, /WS_EX_TOOLWINDOW/);
  assert.match(source, /WM_SETICON/);
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

test("browser runtime maps the opaque host event arena without UI semantics", () => {
  const runtime = readFileSync(
    path.join(root, "web", "vf-ui", "vf-runtime-shell.js"),
    "utf8",
  );
  assert.match(runtime, /vf_host_event_arena_v1/);
  assert.match(runtime, /__vfHostEventArena/);
});

test("packaged UI runtime carries the retained event adapter", () => {
  assert.match(embeddedAssets, /"vf-retained-event-adapter\.js"/);
  assert.match(launcher, /L"vf-retained-event-adapter\.js"/);
});

test("release package builds the retained scene stager with repository headers", () => {
  const sources = cmake.match(
    /add_executable\(vkf-native-scene-artifact-stager([\s\S]*?)\n\)/,
  );
  assert.ok(sources, "retained scene stager target is missing");
  assert.match(sources[1], /vf\/json\.cpp/);
  const target = cmake.match(
    /add_executable\(vkf-native-scene-artifact-stager[\s\S]*?target_include_directories\(vkf-native-scene-artifact-stager PRIVATE([\s\S]*?)\n\)/,
  );
  assert.ok(target, "retained scene stager is missing private include roots");
  assert.match(target[1], /VF_REPO_ROOT/);
  assert.match(target[1], /CMAKE_CURRENT_SOURCE_DIR/);
});
