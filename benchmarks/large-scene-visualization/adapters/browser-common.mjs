import { generatePointFixtureBytes } from '../point-fixture.mjs';
import {
  cameraOffsetForFrame,
  compareRegionStats,
  idealDiscRegionStats,
  opaqueFramebufferRegionStats,
} from '../point-frame-oracle.mjs';

export function cameraRangesForFrame(workload, frame) {
  const offset = cameraOffsetForFrame(workload, frame);
  return {
    x: workload.cameraPath.xRange.map((value) => value + offset[0]),
    y: workload.cameraPath.yRange.map((value) => value + offset[1]),
    offset,
  };
}

export function fixtureView(workload, suppliedBytes) {
  const bytes = suppliedBytes
    ? Uint8Array.from(suppliedBytes)
    : generatePointFixtureBytes(workload.fixture, workload.pointCount);
  return { bytes, points: new Float32Array(bytes.buffer) };
}

export async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function uploadBytes(value) {
  if (typeof value === 'number') return value;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return 0;
}

export function installLargeBufferUploadTracker(minimumBytes) {
  const contexts = new Set();
  const originals = [];
  let initialized = false;
  let lateLargeUploads = 0;
  const canvasPrototype = globalThis.HTMLCanvasElement?.prototype;
  if (canvasPrototype?.getContext) {
    const originalGetContext = canvasPrototype.getContext;
    originals.push([canvasPrototype, 'getContext', originalGetContext]);
    canvasPrototype.getContext = function(kind, ...args) {
      const context = originalGetContext.call(this, kind, ...args);
      if ((kind === 'webgl' || kind === 'experimental-webgl' || kind === 'webgl2') && context) {
        contexts.add(context);
      }
      return context;
    };
  }
  for (const constructor of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!constructor?.prototype) continue;
    for (const method of ['bufferData', 'bufferSubData']) {
      const original = constructor.prototype[method];
      if (typeof original !== 'function') continue;
      originals.push([constructor.prototype, method, original]);
      constructor.prototype[method] = function(...args) {
        contexts.add(this);
        if (initialized && args.some((value) => uploadBytes(value) >= minimumBytes)) {
          lateLargeUploads += 1;
        }
        return original.apply(this, args);
      };
    }
  }
  return Object.freeze({
    contexts,
    markInitialized() { initialized = true; },
    evidence() { return { largeBufferUploadsAfterInitialize: lateLargeUploads }; },
    restore() {
      for (const [prototype, method, original] of originals) prototype[method] = original;
    },
  });
}

function captureCanvases(host, workload, contexts) {
  const [width, height] = workload.viewport;
  if (contexts.size > 0) {
    const background = workload.backgroundRgba;
    const output = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      output[pixel * 4] = background[0];
      output[pixel * 4 + 1] = background[1];
      output[pixel * 4 + 2] = background[2];
      output[pixel * 4 + 3] = background[3];
    }
    for (const gl of contexts) {
      gl.finish();
      if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) continue;
      const source = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, source);
      for (let y = 0; y < height; y += 1) {
        const sourceY = height - 1 - y;
        for (let x = 0; x < width; x += 1) {
          const from = (sourceY * width + x) * 4;
          const to = (y * width + x) * 4;
          const alpha = source[from + 3] / 255;
          for (let channel = 0; channel < 3; channel += 1) {
            output[to + channel] = Math.round(source[from + channel] + output[to + channel] * (1 - alpha));
          }
        }
      }
    }
    return output;
  }
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d', { willReadFrequently: true });
  const background = workload.backgroundRgba;
  context.fillStyle = `rgba(${background[0]},${background[1]},${background[2]},${background[3] / 255})`;
  context.fillRect(0, 0, width, height);
  const canvases = [...host.querySelectorAll('canvas')];
  if (canvases.length === 0) throw new Error('peer adapter produced no canvas');
  for (const canvas of canvases) {
    if (canvas.width > 0 && canvas.height > 0) context.drawImage(canvas, 0, 0, width, height);
  }
  return new Uint8Array(context.getImageData(0, 0, width, height).data);
}

function failedRegionDiagnostics(expected, observed, rgba, workload) {
  let maximum = { error: -1, region: -1, channel: -1, expected: null, observed: null };
  let expectedCoverage = 0;
  let observedCoverage = 0;
  const minimum = [255, 255, 255, 255];
  const maximumRgba = [0, 0, 0, 0];
  let changedPixels = 0;
  for (let pixel = 0; pixel < rgba.length / 4; pixel += 1) {
    let changed = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const value = rgba[pixel * 4 + channel];
      minimum[channel] = Math.min(minimum[channel], value);
      maximumRgba[channel] = Math.max(maximumRgba[channel], value);
      changed ||= value !== workload.backgroundRgba[channel];
    }
    if (changed) changedPixels += 1;
  }
  for (let region = 0; region < expected.regions.length; region += 1) {
    expectedCoverage += expected.regions[region][0];
    observedCoverage += observed.regions[region][0];
    for (let channel = 0; channel < expected.regions[region].length; channel += 1) {
      const error = Math.abs(expected.regions[region][channel] - observed.regions[region][channel]);
      if (error > maximum.error) {
        maximum = {
          error,
          region,
          channel,
          expected: expected.regions[region][channel],
          observed: observed.regions[region][channel],
        };
      }
    }
  }
  return {
    maximum,
    expectedMeanCoverage: expectedCoverage / expected.regions.length,
    observedMeanCoverage: observedCoverage / observed.regions.length,
    rgba: { minimum, maximum: maximumRgba, changedPixels },
  };
}

export function createBrowserPeerAdapter(config) {
  const {
    version,
    host,
    workload,
    fixture,
    tracker,
    initializeImpl,
    renderFrameImpl,
    destroyImpl,
    debugImpl = () => null,
  } = config;
  const source = fixture.points;
  let initialized = false;

  return Object.freeze({
    version,
    async initialize() {
      if (initialized) return;
      const actualHash = await sha256(fixture.bytes);
      if (actualHash !== workload.fixture.sha256) {
        throw new Error(`${workload.id} fixture hash ${actualHash}; expected ${workload.fixture.sha256}`);
      }
      await initializeImpl();
      for (const gl of tracker.contexts) gl.finish();
      tracker.markInitialized();
      initialized = true;
    },
    async renderFrame(frame) {
      if (!initialized) throw new Error('peer adapter must initialize before rendering');
      await renderFrameImpl(frame);
    },
    async completeGpu() {
      if (tracker.contexts.size === 0) throw new Error('peer adapter created no tracked WebGL context');
      for (const gl of tracker.contexts) gl.finish();
      return tracker.contexts.size;
    },
    async capture(frame) {
      const rgba = captureCanvases(host, workload, tracker.contexts);
      const expected = idealDiscRegionStats(source, workload, frame);
      const observed = opaqueFramebufferRegionStats(rgba, workload, frame);
      const comparison = compareRegionStats(expected, observed, workload.correctness.maxRegionError);
      return {
        ...comparison,
        artifactSha256: await sha256(rgba),
        ...(comparison.passed ? {} : {
          diagnostics: {
            ...failedRegionDiagnostics(expected, observed, rgba, workload),
            contexts: [...tracker.contexts].map((gl) => ({
              drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
              error: gl.getError(),
            })),
            adapter: debugImpl(),
          },
        }),
      };
    },
    retainedEvidence() {
      return {
        sourceIdentityRetained: source === fixture.points,
        ...tracker.evidence(),
      };
    },
    async destroy() {
      try { await destroyImpl(); } finally {
        tracker.restore();
        initialized = false;
      }
    },
  });
}

export function prepareHost(host, workload) {
  if (!(host instanceof HTMLElement)) throw new TypeError('peer host must be an HTMLElement');
  const [width, height] = workload.viewport;
  host.replaceChildren();
  Object.assign(host.style, {
    position: 'relative',
    overflow: 'hidden',
    width: `${width}px`,
    height: `${height}px`,
  });
}
