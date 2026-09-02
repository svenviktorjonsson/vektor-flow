import {
  createSceneMediaCapture,
} from "./vf-media-capture.mjs";

const MAX_CAPTURE_PIXELS = 16_777_216;

function requireCapture(sceneFrame, presentation, width, height) {
  if (
    sceneFrame?.kind !== "procedural-material-scene-frame:v1"
    || !Number.isSafeInteger(sceneFrame.frame)
    || sceneFrame.frame < 0
  ) {
    throw new TypeError(
      "completed procedural material scene frame is required",
    );
  }
  if (
    presentation?.kind !== "wood-polarization-presentation:v1"
    || !Array.isArray(presentation.linearHdrRgb)
    || presentation.linearHdrRgb.length !== 3
    || presentation.linearHdrRgb.some((value) => !Number.isFinite(value))
    || !Array.isArray(presentation.displayLinearRgb)
    || presentation.displayLinearRgb.length !== 3
    || presentation.displayLinearRgb.some((value) => (
      !Number.isFinite(value) || value < 0.0 || value > 1.0
    ))
    || !Number.isFinite(presentation.exposureStops)
  ) {
    throw new TypeError("procedural material presentation is required");
  }
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width * height > MAX_CAPTURE_PIXELS
  ) {
    throw new RangeError("procedural material capture exceeds pixel budget");
  }
}

function linearToSrgb8(value) {
  const encoded = value <= 0.0031308
    ? value * 12.92
    : 1.055 * value ** (1.0 / 2.4) - 0.055;
  return Math.round(Math.max(0.0, Math.min(1.0, encoded)) * 255.0);
}

function hex(bytes) {
  return Array.from(bytes, (byte) => (
    byte.toString(16).padStart(2, "0")
  )).join("");
}

export async function captureProceduralMaterialSceneFrameReference(
  sceneFrame,
  presentation,
  {
    width,
    height,
    documentRef = globalThis.document,
    captureFactory = createSceneMediaCapture,
    cryptoRef = globalThis.crypto,
  },
) {
  requireCapture(sceneFrame, presentation, width, height);
  const canvas = documentRef?.createElement?.("canvas");
  const context = canvas?.getContext?.("2d");
  if (!canvas || !context) {
    throw new Error("procedural material capture canvas is unavailable");
  }
  canvas.width = width;
  canvas.height = height;
  const image = context.createImageData(width, height);
  const rgba = [
    ...presentation.displayLinearRgb.map(linearToSrgb8),
    255,
  ];
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data.set(rgba, offset);
  }
  context.putImageData(image, 0, 0);
  const capture = captureFactory({
    fallbackCanvas: canvas,
    document: documentRef,
    requestStream: () => canvas.captureStream(60),
  });
  const blob = await capture.screenshot();
  const imageBytes = new Uint8Array(await blob.arrayBuffer());
  const digest = new Uint8Array(await cryptoRef.subtle.digest(
    "SHA-256",
    imageBytes,
  ));
  return Object.freeze({
    kind: "procedural-material-scene-capture:v1",
    sourceFrame: sceneFrame,
    mimeType: blob.type,
    width,
    height,
    byteLength: imageBytes.byteLength,
    sha256: hex(digest),
    imageBytes,
    linearHdrRgb: Object.freeze(Array.from(presentation.linearHdrRgb)),
    displayLinearRgb: Object.freeze(
      Array.from(presentation.displayLinearRgb),
    ),
    exposureStops: presentation.exposureStops,
  });
}
