const REQUIRED_METHODS = Object.freeze([
  'initialize',
  'renderFrame',
  'completeGpu',
  'capture',
  'retainedEvidence',
  'destroy',
]);

export function assertComparableAdapter(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== 'function') {
      throw new TypeError(`comparable peer adapter must provide ${method}()`);
    }
  }
  if (typeof adapter.version !== 'string' || !adapter.version) {
    throw new TypeError('comparable peer adapter must report its exact version');
  }
  return true;
}

function positiveCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be positive`);
  return value;
}

export async function runCorrectnessThenTiming(adapter, workload, options = {}) {
  assertComparableAdapter(adapter);
  const warmupFrames = positiveCount(options.warmupFrames ?? 60, 'warmupFrames');
  const measuredFrames = positiveCount(options.measuredFrames ?? 120, 'measuredFrames');
  const now = options.now ?? (() => performance.now());
  let sequence = 0;
  const checkpointResults = [];
  await adapter.initialize();
  try {
    for (const frame of workload.correctness.checkpoints) {
      await adapter.renderFrame(frame);
      await adapter.completeGpu();
      const result = await adapter.capture(frame);
      checkpointResults.push({ frame, ...result });
      if (result.passed !== true || !Number.isFinite(result.maxRegionError)) {
        throw new Error(`correctness failed at frame ${frame}`);
      }
    }
    const retained = adapter.retainedEvidence();
    if (retained?.sourceIdentityRetained !== true) {
      throw new Error('point source identity changed after initialization');
    }
    if (retained.largeBufferUploadsAfterInitialize !== 0) {
      throw new Error('large point buffer upload after initialization');
    }
    const correctness = {
      passed: true,
      completedAtSequence: ++sequence,
      checkpoints: checkpointResults,
      retained,
    };

    for (let index = 0; index < warmupFrames; index += 1) {
      await adapter.renderFrame(index % workload.cameraPath.frames);
      await adapter.completeGpu();
    }
    const startedAtSequence = ++sequence;
    const samplesMs = [];
    for (let index = 0; index < measuredFrames; index += 1) {
      const before = now();
      await adapter.renderFrame(index % workload.cameraPath.frames);
      await adapter.completeGpu();
      const elapsed = now() - before;
      if (!Number.isFinite(elapsed) || elapsed <= 0) throw new Error('timing sample must be finite and positive');
      samplesMs.push(elapsed);
    }
    return {
      version: adapter.version,
      correctness,
      timing: { startedAtSequence, samplesMs },
    };
  } finally {
    await adapter.destroy();
  }
}
