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

function validateState(state, expectedView, index) {
  const rgba = Buffer.from(String(state.rgba_base64 || ""), "base64");
  if (state.view !== expectedView ||
      !Number.isSafeInteger(state.width) || state.width <= 0 ||
      !Number.isSafeInteger(state.height) || state.height <= 0 ||
      rgba.length !== state.width * state.height * 4) {
    throw new Error(`native Frame.capture state ${index} is malformed`);
  }
  if (!hasColorVariation(rgba)) {
    throw new Error(`native Frame.capture state ${index} is a uniform placeholder`);
  }
  return rgba;
}

function validateNativeCapture(evidence, evidencePath) {
  if (!evidence || evidence.type !== "vf_native_frame_media_capture_v1" ||
      evidence.schema !== "vektor-flow/native-frame-media-capture-v1" ||
      evidence.status !== "ok" || evidence.capture_api !== "Frame.capture" ||
      evidence.boundary !== "frame-internal") {
    throw new Error("native Frame.capture evidence is invalid");
  }
  const playback = evidence.playback;
  if (playback && playback.mode === "repeat") {
    const count = Number(playback.sample_count);
    if (!Number.isSafeInteger(count) || count < 2 || count > 360 ||
        playback.first_sample !== 0 || playback.last_sample !== count - 1 ||
        !evidencePath) {
      throw new Error("native Frame.capture repeat metadata is invalid");
    }
    const frameDirectory = path.join(
      path.dirname(evidencePath),
      `${path.parse(evidencePath).name}-frames`,
    );
    const checksums = new Set();
    for (let index = 0; index < count; index += 1) {
      const frame = JSON.parse(fs.readFileSync(
        path.join(frameDirectory, `${String(index).padStart(3, "0")}.json`),
        "utf8",
      ));
      const expectedView = `orbit-degree-${String(index).padStart(3, "0")}`;
      if (frame.type !== "vf_native_frame_media_capture_frame_v1" ||
          frame.sample_index !== index || frame.status !== "frame") {
        throw new Error(`native Frame.capture streamed frame ${index} is invalid`);
      }
      validateState(frame.state, expectedView, index);
      checksums.add(frame.state.checksum);
    }
    if (checksums.size < 2) {
      throw new Error("native Frame.capture repeat frames are identical");
    }
    return evidence;
  }
  const expectedViews = ["camera-default", "camera-wheel-detail"];
  if (!Array.isArray(evidence.states) || evidence.states.length !== expectedViews.length) {
    throw new Error("native Frame.capture requires two camera states");
  }
  const capturedStates = [];
  evidence.states.forEach((state, index) => {
    capturedStates.push(validateState(state, expectedViews[index], index));
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
  const timeoutMs = Number(
    process.env.VKF_NATIVE_FRAME_CAPTURE_TIMEOUT_MS ||
    process.env.VKF_CAPTURE_TIMEOUT_MS ||
    30000,
  );
  waitForEvidence(evidencePath, timeoutMs);
  const evidence = validateNativeCapture(JSON.parse(
    fs.readFileSync(evidencePath, "utf8"),
  ), evidencePath);
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
