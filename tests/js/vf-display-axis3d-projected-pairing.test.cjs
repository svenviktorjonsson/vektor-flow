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
assert.ok(source.includes("Number(cfg && cfg.axis_projected_pair_snap_angle_deg) || 5"));
assert.ok(source.includes("Number(cfg && cfg.axis_projected_pair_unsnap_angle_deg) || pairSnapAngleDeg"));
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
assert.ok(source.includes("function axis3DApplyProjectedPairSnap(camera, cfg, body, dragState, rawCamera)"));
assert.ok(source.includes("var rawPairState = axis3DProjectedAxisSnapState(rawProjected.axisInfos, previous, cfg);"));
assert.ok(source.includes("function axis3DSnapViewToAxisPairOverlap(camera, cfg, axisAIndex, axisBIndex)"));
assert.ok(source.includes("var pairPlaneNormal = normalizeVec3Local(crossVec3(axisA, axisB), [0, 0, 1]);"));
assert.ok(source.includes("var projectedForward = ["));
assert.ok(source.includes("var snappedForward = [projectedForward[0] / projectedLen, projectedForward[1] / projectedLen, projectedForward[2] / projectedLen];"));
assert.ok(source.includes("var aligned = axis3DSnapViewToAxisPairOverlap(camera, cfg, bestPair.leaderIndex, bestPair.followerIndex);"));
assert.ok(source.includes("axis3DApplyProjectedPairSnap(snappedCamera, cfg || {}, body, dragState, rawCamera);"));
assert.ok(source.includes("function axis3DProjectedAxisSideSign(projectedSnapState, axisInfos, axisIndex, defaultSide)"));
assert.ok(source.includes("var canonicalIndex = Math.min(Number(axisIndex), paired);"));
assert.ok(source.includes("var normalDot = (nx * cnx) + (ny * cny);"));
assert.ok(source.includes("var desiredCanonicalSide = Number(axisIndex) === canonicalIndex ? -1 : 1;"));
assert.ok(source.includes("var localSide = desiredCanonicalSide * (normalDot < 0 ? -1 : 1);"));
assert.ok(source.includes("return localSide;"));
assert.ok(source.includes("side = axis3DProjectedAxisSideSign(projectedSnapState, axisInfos, axisIndex, side);"));
assert.ok(source.includes("side = axis3DProjectedAxisSideSign(projectedSnapState, axisInfos, ti, side);"));
assert.ok(source.includes("geomSpec.texts = preservedAxis3DTexts.concat(axisNameLabelSpecs, tickLabelSpecs);"));
assert.ok(!source.includes("snapState.hiddenAxisIndex === lineAxis"));
assert.ok(!source.includes("snapState.hiddenAxisIndex === sourceAxis"));
assert.ok(!source.includes("if (snapState.hiddenAxisIndex === axisIndex) { return null; }"));
assert.ok(!source.includes("if (snapState.hiddenAxisIndex === ti) { continue; }"));

console.log("vf-display-axis3d-projected-pairing tests passed");
