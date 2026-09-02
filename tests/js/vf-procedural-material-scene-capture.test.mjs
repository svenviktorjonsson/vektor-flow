import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  captureProceduralMaterialSceneFrameReference,
} from "../../web/vf-ui/vf-procedural-material-scene-capture.mjs";

function captureDocument() {
  return {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      const canvas = {
        width: 0,
        height: 0,
        pixels: null,
      };
      canvas.getContext = (kind) => {
        assert.equal(kind, "2d");
        return {
          createImageData(width, height) {
            return {
              width,
              height,
              data: new Uint8ClampedArray(width * height * 4),
            };
          },
          putImageData(image) {
            canvas.pixels = image.data.slice();
          },
        };
      };
      return canvas;
    },
  };
}

function captureFactory({ fallbackCanvas }) {
  return {
    async screenshot() {
      return new Blob([fallbackCanvas.pixels], { type: "image/png" });
    },
  };
}

test("released frame captures repeatable image and HDR metadata", async () => {
  const sceneFrame = {
    kind: "procedural-material-scene-frame:v1",
    frame: 1,
    timestamp: 26,
    output: {},
  };
  const presentation = {
    kind: "wood-polarization-presentation:v1",
    linearHdrRgb: [4.0, 2.0, 1.0],
    displayLinearRgb: [0.25, 0.5, 0.75],
    exposureStops: 1.0,
  };
  const options = {
    width: 2,
    height: 2,
    documentRef: captureDocument(),
    captureFactory,
  };
  const first = await captureProceduralMaterialSceneFrameReference(
    sceneFrame,
    presentation,
    options,
  );
  const second = await captureProceduralMaterialSceneFrameReference(
    sceneFrame,
    presentation,
    options,
  );
  const pixels = Uint8Array.from([
    137, 188, 225, 255,
    137, 188, 225, 255,
    137, 188, 225, 255,
    137, 188, 225, 255,
  ]);
  const expectedHash = createHash("sha256")
    .update(pixels)
    .digest("hex");

  assert.equal(first.kind, "procedural-material-scene-capture:v1");
  assert.equal(first.mimeType, "image/png");
  assert.equal(first.width, 2);
  assert.equal(first.height, 2);
  assert.equal(first.byteLength, 16);
  assert.equal(first.sha256, expectedHash);
  assert.equal(second.sha256, first.sha256);
  assert.deepEqual(first.linearHdrRgb, [4.0, 2.0, 1.0]);
  assert.deepEqual(first.displayLinearRgb, [0.25, 0.5, 0.75]);
  assert.equal(first.exposureStops, 1.0);
  assert.strictEqual(first.sourceFrame, sceneFrame);
});
