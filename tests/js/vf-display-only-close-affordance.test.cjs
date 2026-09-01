const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const nativeSource = fs.readFileSync(
  path.join(__dirname, "../../native/VfOverlay/vf/release_overlay_host.cpp"),
  "utf8",
);

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-frame.js"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-frame.css"),
  "utf8",
);
assert.doesNotMatch(source, /vf-display-only-close/);
assert.doesNotMatch(css, /vf-display-only-close/);
assert.match(nativeSource, /FocusHostOnInteractiveHover/);
assert.match(nativeSource, /message == WM_MOUSEMOVE && interactive/);
assert.match(nativeSource, /SetForegroundWindow\(window\)/);
assert.match(nativeSource, /WM_SYSKEYDOWN/);
assert.match(nativeSource, /VK_F4/);
console.log("vf display-only hover-focus close policy tests passed");
