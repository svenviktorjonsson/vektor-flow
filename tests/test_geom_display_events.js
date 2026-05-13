"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "vf-display.js"),
  "utf8",
);

assert.ok(!source.includes("__vfGeomPickDispatch"));
assert.ok(!source.includes("lastPositiveHit"));
assert.ok(source.includes("body.__vfGeomDragState.hit = Object.assign({}, hit);"));
assert.ok(source.includes("if (!dragState.hit || !(Number(dragState.hit.object_id || 0) > 0))"));
assert.ok(source.includes("var hit = Object.assign({}, dragState.hit);"));
assert.ok(source.includes("function isGeomClaimedFrame(fid)"));
assert.ok(source.includes("function disableFrameCanvasEvents(fid)"));
assert.ok(source.includes("global.__vfGeomFrameIds[String(fid)] = true;"));
assert.ok(source.includes('canvas.style.pointerEvents = "none";'));
assert.ok(source.includes("if (canvas.__vfFrameEventsDisabled || isGeomClaimedFrame(fid))"));
assert.ok(source.includes("if (isGeomClaimedFrame(fid))"));

console.log("ok");
