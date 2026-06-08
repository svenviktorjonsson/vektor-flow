const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-frame.js"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-frame.css"),
  "utf8"
);

assert.ok(!source.includes("vf-frame__drag-handle"));
assert.ok(!source.includes("vfDragHandle"));
assert.ok(!source.includes("Drag window"));
assert.ok(!source.includes("head.appendChild(dragHandle);"));
assert.ok(source.includes("VfFrame.attachHostWindowDrag([head, minibar]"));
assert.ok(source.includes("setFrameDragCursorState(true"));
assert.ok(source.includes('data-vf-frame-dragging'));
assert.ok(css.includes("cursor: grab"));
assert.ok(css.includes("cursor: grabbing"));
assert.ok(css.includes('body.vf-frame-dragging .vf-frame__header[data-vf-frame-dragging="1"]'));

console.log("vf-frame header drag surface tests passed");
