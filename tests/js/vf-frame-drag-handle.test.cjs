const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-frame.js"),
  "utf8"
);

assert.ok(source.includes('dragHandle.className = "vf-frame__drag-handle";'));
assert.ok(source.includes('dragHandle.setAttribute("aria-label", "Drag window");'));
assert.ok(source.includes('dragHandle.dataset.vfDragHandle = "1";'));
assert.ok(source.includes("head.appendChild(dragHandle);"));
assert.ok(source.includes("VfFrame.attachHostWindowDrag([head, minibar, dragHandle]"));

console.log("vf-frame-drag-handle tests passed");
