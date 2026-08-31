import {
  planClusteredLights,
  planViewClusteredLights,
} from '../../web/vf-ui/geom/vf-clustered-light-plan.mjs';
import { createVkfMarkerImpostorAdapter } from './adapters/vkf-marker-impostor.mjs';
import { createRawWebGpuAdapter } from './adapters/raw-webgpu.mjs';
import { createThreeAdapter } from './adapters/three.mjs';
import { createDeckGlAdapter } from './adapters/deck-gl.mjs';
import { runIndicatorLane } from './measurement.mjs';
import { createCloudFixture, fixtureSha256 } from './protocol.mjs';
import { verifyCloudCapture } from './correctness.mjs';

globalThis.VfClusteredLightPlan = { planClusteredLights, planViewClusteredLights };

async function rendererInfo() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const info = adapter.info ?? {};
  return {
    vendor: info.vendor ?? null,
    architecture: info.architecture ?? null,
    device: info.device ?? null,
    description: info.description ?? null,
    features: [...adapter.features].sort(),
  };
}

function encodeCapturePng(capture) {
  const canvas = document.createElement('canvas');
  canvas.width = capture.width;
  canvas.height = capture.height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(new Uint8ClampedArray(capture.rgba), capture.width, capture.height), 0, 0);
  return canvas.toDataURL('image/png');
}

async function execute() {
  const query = new URLSearchParams(location.search);
  const pointCount = Number(query.get('pointCount') ?? 10_000);
  const pointSizePx = Number(query.get('pointSizePx') ?? 4);
  const mode = query.get('mode') ?? 'smoke';
  const implementation = query.get('implementation') ?? 'vkf';
  const captureArtifacts = query.get('captureArtifacts') === '1';
  const fixture = createCloudFixture(pointCount);
  const factories = {
    'deck-gl': createDeckGlAdapter,
    'raw-webgpu': createRawWebGpuAdapter,
    three: createThreeAdapter,
    vkf: createVkfMarkerImpostorAdapter,
  };
  const factory = factories[implementation];
  if (!factory) throw new Error(`unknown retained-cloud implementation ${implementation}`);
  const adapter = factory(document.getElementById('host'), fixture);
  let result;
  if (mode === 'full') {
    result = await runIndicatorLane(adapter, { pointSizePx }, {
      fixture,
      release: true,
      encodeCaptureArtifact: captureArtifacts ? encodeCapturePng : undefined,
    });
  } else {
    const cold = await adapter.initialize({ pointSizePx });
    try {
      const captures = [];
      for (const frame of [0, 25, 100]) {
        await adapter.submitFrame(frame, { pointSizePx });
        await adapter.completeGpu();
        const raw = await adapter.capture(frame, { pointSizePx });
        captures.push(await verifyCloudCapture(raw, fixture, frame, pointSizePx, {
          minimumChangedPixels: Math.max(100, Math.floor(pointCount / 20)),
          maxRegionError: 0.2,
        }));
      }
      result = { cold, captures, retained: adapter.retainedEvidence() };
    } finally {
      await adapter.destroy();
    }
  }
  return {
    implementation: adapter.id,
    mode,
    pointCount,
    pointSizePx,
    fixtureSha256: await fixtureSha256(fixture.bytes),
    renderer: await rendererInfo(),
    rendererLog: globalThis.__vfGeomWgpuLog ?? null,
    rendererError: globalThis.__vfGeomWgpuLastError ?? null,
    userAgent: navigator.userAgent,
    result,
  };
}

execute().then((result) => {
  globalThis.__vfRetainedCloudResult = { ok: true, ...result };
}).catch((error) => {
  globalThis.__vfRetainedCloudResult = {
    ok: false,
    error: String(error?.stack ?? error),
    rendererError: globalThis.__vfGeomWgpuLastError ?? null,
    rendererLog: globalThis.__vfGeomWgpuLog ?? null,
  };
});
