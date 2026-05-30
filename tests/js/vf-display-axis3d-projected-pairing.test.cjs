const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.ok(source.includes("var unsnapAngleDeg = Math.max(snapAngleDeg, Number(cfg && cfg.axis_projected_unsnap_angle_deg) || (snapAngleDeg + 3));"));
assert.ok(source.includes("var pairSnapAngleDeg = Math.max("));
assert.ok(source.includes("var pairUnsnapAngleDeg = Math.max("));
assert.ok(source.includes("var pairedAxes = {};"));
assert.ok(source.includes("var sideSigns = {};"));
assert.ok(source.includes("var pairTargets = {};"));
assert.ok(source.includes("var pairLeaders = {};"));
assert.ok(source.includes("var previouslyPaired = !!(previousPairs && (previousPairs[a] === b || previousPairs[b] === a));"));
assert.ok(source.includes("if (pairDiff > (previouslyPaired ? pairUnsnapAngleDeg : pairSnapAngleDeg)) { continue; }"));
assert.ok(source.includes("pairedAxes[a] = b;"));
assert.ok(source.includes("sideSigns[a] = sideA;"));
assert.ok(source.includes("pairTargets[follower] = rawAngles[leader];"));
assert.ok(source.includes("pairLeaders[follower] = leader;"));
assert.ok(source.includes("if (bestPairFollower) {"));
assert.ok(source.includes("bestPairFollower.targetAngleDeg"));
assert.ok(source.includes("function axis3DProjectedAxisSideSign(projectedSnapState, axisIndex, defaultSide)"));
assert.ok(!source.includes("snapState.hiddenAxisIndex === lineAxis"));
assert.ok(!source.includes("snapState.hiddenAxisIndex === sourceAxis"));
assert.ok(!source.includes("if (snapState.hiddenAxisIndex === axisIndex) { return null; }"));
assert.ok(!source.includes("if (snapState.hiddenAxisIndex === ti) { continue; }"));

console.log("vf-display-axis3d-projected-pairing tests passed");
