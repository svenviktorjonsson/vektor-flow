import {
  createSceneMediaCapture,
} from './vf-media-capture.mjs';

const MAX_CAPTURE_PIXELS = 16_777_216;

function hex(bytes) {
  return Array.from(bytes, (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('');
}

export async function captureProceduralRoadSceneFrameReference(
  sceneFrame,
  {
    width,
    height,
    documentRef = globalThis.document,
    captureFactory = createSceneMediaCapture,
    cryptoRef = globalThis.crypto,
  },
) {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width * height > MAX_CAPTURE_PIXELS
  ) {
    throw new RangeError(
      'procedural road scene capture exceeds pixel budget',
    );
  }
  const rgba8 = sceneFrame.output.rgba8;
  if (!(rgba8 instanceof Uint8Array) || rgba8.length !== width * height * 4) {
    throw new RangeError(
      'procedural road scene RGBA image size is invalid',
    );
  }
  const canvas = documentRef.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  image.data.set(rgba8);
  context.putImageData(image, 0, 0);
  const capture = captureFactory({
    fallbackCanvas: canvas,
    document: documentRef,
    requestStream: () => canvas.captureStream(60),
  });
  const blob = await capture.screenshot();
  const imageBytes = new Uint8Array(await blob.arrayBuffer());
  const digest = new Uint8Array(await cryptoRef.subtle.digest(
    'SHA-256',
    imageBytes,
  ));
  return Object.freeze({
    kind: 'procedural-road-scene-capture:v1',
    sourceFrame: sceneFrame,
    mimeType: blob.type,
    width,
    height,
    byteLength: imageBytes.byteLength,
    sha256: hex(digest),
    imageBytes,
  });
}
