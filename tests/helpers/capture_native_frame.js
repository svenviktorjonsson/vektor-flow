"use strict";

const fs = require("node:fs");
const path = require("node:path");

function waitForEvidence(evidencePath, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(evidencePath)) {
    if (Date.now() >= deadline) {
      throw new Error("native Frame.capture evidence timed out");
    }
    Atomics.wait(waitBuffer, 0, 0, 100);
  }
}

function hasColorVariation(rgba) {
  for (let offset = 4; offset < rgba.length; offset += 4) {
    if (rgba[offset] !== rgba[0] || rgba[offset + 1] !== rgba[1] ||
        rgba[offset + 2] !== rgba[2] || rgba[offset + 3] !== rgba[3]) {
      return true;
    }
  }
  return false;
}

function validateNativeCapture(evidence) {
  if (!evidence || evidence.type !== "vf_native_frame_media_capture_v1" ||
      evidence.schema !== "vektor-flow/native-frame-media-capture-v1" ||
      evidence.status !== "ok" || evidence.capture_api !== "Frame.capture" ||
      evidence.boundary !== "frame-internal") {
    throw new Error("native Frame.capture evidence is invalid");
  }
  const expectedViews = ["camera-default", "camera-wheel-detail"];
  if (!Array.isArray(evidence.states) || evidence.states.length !== expectedViews.length) {
    throw new Error("native Frame.capture requires two camera states");
  }
  const capturedStates = [];
  evidence.states.forEach((state, index) => {
    const rgba = Buffer.from(String(state.rgba_base64 || ""), "base64");
    if (state.view !== expectedViews[index] ||
        !Number.isSafeInteger(state.width) || state.width <= 0 ||
        !Number.isSafeInteger(state.height) || state.height <= 0 ||
        rgba.length !== state.width * state.height * 4) {
      throw new Error(`native Frame.capture state ${index} is malformed`);
    }
    if (!hasColorVariation(rgba)) {
      throw new Error(
        `native Frame.capture state ${index} is a uniform placeholder`,
      );
    }
    capturedStates.push(rgba);
  });
  if (capturedStates[0].equals(capturedStates[1])) {
    throw new Error("native Frame.capture camera states are identical");
  }
  return evidence;
}

function main() {
  if (!process.argv[2]) {
    throw new Error("usage: capture_native_frame.js <native-capture.json>");
  }
  const evidencePath = path.resolve(process.argv[2]);
  waitForEvidence(evidencePath);
  const evidence = validateNativeCapture(JSON.parse(
    fs.readFileSync(evidencePath, "utf8"),
  ));
  process.stdout.write(JSON.stringify(evidence));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { validateNativeCapture };
