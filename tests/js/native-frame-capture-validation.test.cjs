const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateNativeCapture,
} = require("../helpers/capture_material_ui_gallery.js");

function state(view, rgba) {
  return {
    view,
    width: 2,
    height: 1,
    rgba_base64: Buffer.from(rgba).toString("base64"),
  };
}

function evidence(rgba) {
  return {
    type: "vf_native_frame_media_capture_v1",
    schema: "vektor-flow/native-frame-media-capture-v1",
    status: "ok",
    capture_api: "Frame.capture",
    boundary: "frame-internal",
    states: [
      state("camera-default", rgba),
      state("camera-wheel-detail", rgba),
    ],
  };
}

test("native frame evidence rejects a uniform placeholder", () => {
  const white = [255, 255, 255, 255, 255, 255, 255, 255];
  assert.throws(
    () => validateNativeCapture(evidence(white)),
    /uniform placeholder/u,
  );
});

test("native frame evidence accepts rendered color variation", () => {
  const rendered = [12, 18, 30, 255, 220, 96, 42, 255];
  assert.equal(validateNativeCapture(evidence(rendered)).status, "ok");
});
