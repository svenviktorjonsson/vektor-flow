const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

const adapterCall = source.indexOf("createJsAxis3DProjectionKernelAdapter");
const kernelCall = source.indexOf("createProjectionKernel");

assert.ok(adapterCall >= 0, "projection adapter call missing");
assert.ok(kernelCall >= 0, "projection kernel fallback missing");
assert.ok(adapterCall < kernelCall, "adapter must be preferred before fallback kernel");

assert.ok(source.includes("function axis3DProjectionKernelDeps()"));
assert.ok(source.includes("function axis3DKernelMethod(name)"));
assert.ok(source.includes("function buildAxis3DCrosshairHelperMesh(fid, cfg, camera, target, color)"));
assert.ok(source.includes("function ensureAxis3DProjectionKernel()"));
assert.ok(source.includes("function axis3DProjectionKernelMethod(name)"));
assert.ok(source.includes("function axis3DVirtualTrackballRotate(camera, cfg, body, prevPx, prevPy, curPx, curPy)"));
assert.ok(source.includes("function axis3DApplyViewDirectionSnap(camera, cfg, dragState)"));
assert.ok(source.includes("function axis3DApplyProjectedAngleSnap(camera, cfg, body, dragState, snapTargets)"));
assert.ok(source.includes("function axis3DApplyProjectedPairSnap(camera, cfg, body, dragState, rawCamera)"));
assert.ok(source.includes("function axis3DRotationSnapActive(state)"));
assert.ok(source.includes("function axis3DVirtualTrackballRotationController()"));
assert.ok(source.includes("virtual_trackball: axis3DVirtualTrackballRotationController()"));
assert.ok(source.includes("cfg && cfg.rotation_controller || \"virtual_trackball\""));
assert.ok(source.includes("rawCamera: axis3DCloneCamera(camera || {})"));
assert.ok(source.includes("snappedCamera: axis3DCloneCamera(camera || {})"));
assert.ok(source.includes("axis3DApplyProjectedAngleSnap(snappedCamera, cfg || {}, body, dragState, [0, 45, 90, 135])"));
assert.ok(source.includes("axis3DApplyProjectedPairSnap(snappedCamera, cfg || {}, body, dragState, rawCamera);"));
assert.ok(source.includes("projectedPairRawSnapState: null"));
assert.ok(source.includes("projectedPairSnapState: null"));
assert.ok(source.includes("var snapGain = axis3DRotationSnapActive(state)"));
assert.ok(source.includes("Number(cfg && cfg.axis_snap_rotation_gain) || 1.45"));
assert.ok(source.includes("axis3DVirtualTrackballRotate(rawCamera, cfg || {}, body, prevX, prevY, effectiveCurX, effectiveCurY);"));
assert.ok(source.includes("state.rawCamera = axis3DCloneCamera(rawCamera);"));
assert.ok(source.includes("state.snappedCamera = axis3DCloneCamera(snappedCamera);"));
assert.ok(source.includes("camera.pos = snappedCamera.pos.slice();"));
assert.ok(source.includes("rotationCenter: axis3DRotationCenter"));
assert.ok(source.includes("projectWorldToPixel: projectWorldToPixel"));
assert.ok(source.includes("clipPixelLineToRect: clipPixelLineToRect"));
assert.ok(source.includes("cloneCamera: axis3DCloneCamera"));
assert.ok(source.includes("screenBasis: axis3DScreenBasis"));
assert.ok(source.includes("applyWorldRotation: axis3DApplyWorldRotation"));
assert.ok(source.includes("var builder = axis3DKernelMethod(\"buildCrosshairHelperLineMesh\");"));
assert.equal((source.match(/axis3DProjectionKernelDeps\(\)/g) || []).length, 3);
assert.equal((source.match(/axis3DKernelMethod\(/g) || []).length, 10);
assert.equal((source.match(/axis3DProjectionKernelMethod\(/g) || []).length, 5);
assert.equal((source.match(/typeof _vfAxis3DKernel\./g) || []).length, 0);
assert.equal((source.match(/typeof _vfAxis3DProjectionKernel\./g) || []).length, 0);

console.log("vf-display-axis3d-seams tests passed");
