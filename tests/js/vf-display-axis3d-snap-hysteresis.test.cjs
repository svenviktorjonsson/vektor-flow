const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.ok(source.includes("var hysteresisDeg = Math.max(0, Number(cfg && cfg.axis_direction_snap_hysteresis_deg) || 2);"));
assert.ok(source.includes("best.candidates = candidates;"));
assert.ok(source.includes("var previousStillCompetitive = false;"));
assert.ok(source.includes("Number(previousCandidate.angleDeg) <= (snapAngleDeg + hysteresisDeg)"));
assert.ok(source.includes("Number(previousCandidate.absDot) >= (Number(rawOrientation.absDot || 0) - 0.02)"));

console.log("vf-display-axis3d-snap-hysteresis tests passed");
