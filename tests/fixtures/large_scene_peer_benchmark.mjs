import manifest from '../../benchmarks/large-scene-visualization/manifest.json';
import { installLargeBufferUploadTracker } from '../../benchmarks/large-scene-visualization/adapters/browser-common.mjs';
import { createDeckGlLargeSceneAdapter } from '../../benchmarks/large-scene-visualization/adapters/deck-gl.mjs';
import { createPlotlyScatterGlLargeSceneAdapter } from '../../benchmarks/large-scene-visualization/adapters/plotly-scattergl.mjs';
import { createVkfBrowserLargeSceneAdapter } from '../../benchmarks/large-scene-visualization/adapters/vkf-browser.mjs';
import { createVtkJsLargeSceneAdapter } from '../../benchmarks/large-scene-visualization/adapters/vtk-js.mjs';
import { runCorrectnessThenTiming } from '../../benchmarks/large-scene-visualization/peer-measurement.mjs';
import { staticDispatchWorkload } from '../../benchmarks/large-scene-visualization/static-dispatch-diagnostic.mjs';

const factories = Object.freeze({
  vkf: createVkfBrowserLargeSceneAdapter,
  'deck-gl': createDeckGlLargeSceneAdapter,
  'vtk-js': createVtkJsLargeSceneAdapter,
  'plotly-scattergl': createPlotlyScatterGlLargeSceneAdapter,
});

const benchmarkLogs = [];
for (const method of ['warn', 'error']) {
  const original = console[method].bind(console);
  console[method] = (...values) => {
    benchmarkLogs.push({ method, values: values.map((value) => String(value?.stack ?? value)) });
    original(...values);
  };
}

function rendererInfo(gl) {
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    version: gl.getParameter(gl.VERSION),
    vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  };
}

function clockEvidence(reads = 100_000) {
  if (globalThis.crossOriginIsolated !== true) {
    throw new Error('large-scene timing requires a cross-origin-isolated origin');
  }
  let previous = performance.now();
  let minimumPositiveDeltaMs = Infinity;
  let positiveReads = 0;
  for (let index = 0; index < reads; index += 1) {
    const current = performance.now();
    const delta = current - previous;
    if (delta > 0) {
      minimumPositiveDeltaMs = Math.min(minimumPositiveDeltaMs, delta);
      positiveReads += 1;
    }
    previous = current;
  }
  if (!Number.isFinite(minimumPositiveDeltaMs) || minimumPositiveDeltaMs > 0.01) {
    throw new Error(`large-scene timing clock resolution ${minimumPositiveDeltaMs}ms exceeds 0.01ms`);
  }
  return { crossOriginIsolated: true, minimumPositiveDeltaMs, reads, positiveReads };
}

async function execute() {
  const query = new URLSearchParams(location.search);
  const implementation = query.get('implementation');
  const workloadId = query.get('workload');
  const factory = factories[implementation];
  const sourceWorkload = manifest.workloads.find(({ id }) => id === workloadId);
  const workload = query.get('staticDispatchDiagnostic') === 'true'
    ? staticDispatchWorkload(sourceWorkload, manifest.implementations)
    : sourceWorkload;
  if (!factory) throw new Error(`unknown implementation ${implementation}`);
  if (!workload) throw new Error(`unknown workload ${workloadId}`);
  const clock = clockEvidence();
  const tracker = installLargeBufferUploadTracker(workload.pointCount * 4);
  const staticDispatchDiagnostic = query.get('staticDispatchDiagnostic') === 'true';
  const adapter = factory(document.getElementById('host'), workload, {
    tracker,
    forceStaticDraw: staticDispatchDiagnostic,
  });
  const result = await runCorrectnessThenTiming(adapter, workload, {
    correctnessOnly: query.get('correctnessOnly') === 'true',
    warmupFrames: Number(query.get('warmups') ?? manifest.measurement.minimumWarmupFrames),
    measuredFrames: Number(query.get('measured') ?? manifest.measurement.minimumMeasuredFrames),
  });
  const gl = [...tracker.contexts][0];
  return {
    mode: 'headless-peer-gpu-complete',
    implementation,
    workload: workload.id,
    pointCount: workload.pointCount,
    adapterVersion: result.version,
    userAgent: navigator.userAgent,
    webgl: rendererInfo(gl),
    clock,
    correctness: result.correctness,
    timing: result.timing,
  };
}

execute().then((result) => {
  window.__vfLargeScenePeerResult = { ok: true, ...result };
}).catch((error) => {
  window.__vfLargeScenePeerResult = {
    ok: false,
    error: String(error?.stack ?? error),
    logs: benchmarkLogs,
  };
});
