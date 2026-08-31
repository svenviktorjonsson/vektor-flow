import { INDICATOR_PROTOCOL } from './protocol.mjs';
import { summarizeIntervals } from './statistics.mjs';

const REQUIRED_METHODS = Object.freeze([
  'initialize',
  'submitFrame',
  'completeGpu',
  'drainGpu',
  'capture',
  'retainedEvidence',
  'destroy',
]);

function assertAdapter(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== 'function') {
      throw new TypeError(`indicator adapter must provide ${method}()`);
    }
  }
  if (typeof adapter.id !== 'string' || typeof adapter.version !== 'string') {
    throw new TypeError('indicator adapter must identify its implementation and version');
  }
}

function assertRetained(evidence, maximumUniformWrites) {
  if (evidence?.fixtureBufferWritesAfterInitialize !== 0) {
    throw new Error('fixture buffer write after initialization invalidates retained timing');
  }
  if (evidence?.fixtureBufferReallocationsAfterInitialize !== 0) {
    throw new Error('fixture buffer reallocation after initialization invalidates retained timing');
  }
  if (!Number.isSafeInteger(evidence?.cameraUniformWritesAfterInitialize)
    || evidence.cameraUniformWritesAfterInitialize < 0
    || evidence.cameraUniformWritesAfterInitialize > maximumUniformWrites) {
    throw new Error('camera uniform writes exceed the bounded per-frame responsibility');
  }
}

function browserAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export async function runIndicatorLane(adapter, lane, options = {}) {
  assertAdapter(adapter);
  if (!INDICATOR_PROTOCOL.pointSizesPx.includes(lane?.pointSizePx)) {
    throw new RangeError('indicator lane point size must be 1px or 4px');
  }
  const now = options.now ?? (() => performance.now());
  const nextAnimationFrame = options.nextAnimationFrame ?? browserAnimationFrame;
  let completionCalls = 0;
  const cold = await adapter.initialize(lane);
  try {
    await adapter.submitFrame(0, lane);
    await adapter.completeGpu();
    completionCalls += 1;
    const correctness = await adapter.capture(0, lane);
    if (correctness?.passed !== true || typeof correctness.hash !== 'string') {
      throw new Error(`correctness capture failed: ${JSON.stringify(correctness)}`);
    }
    assertRetained(adapter.retainedEvidence(), 1);

    let frame = 1;
    let previousAnimationTimestamp = null;
    for (let index = 0; index < INDICATOR_PROTOCOL.warmupFrames; index += 1) {
      previousAnimationTimestamp = await nextAnimationFrame();
      await adapter.submitFrame(frame, lane, { phase: 'presentation-warmup', index });
      frame = (frame + 1) % INDICATOR_PROTOCOL.orbitFrames;
    }

    const presentedIntervals = [];
    const cpuSubmit = [];
    const gpuTimestamps = [];
    for (let index = 0; index < INDICATOR_PROTOCOL.measuredFrames; index += 1) {
      const animationTimestamp = await nextAnimationFrame();
      const interval = animationTimestamp - previousAnimationTimestamp;
      if (!Number.isFinite(interval) || interval <= 0) {
        throw new Error('animation frame interval must be positive and finite');
      }
      presentedIntervals.push(interval);
      previousAnimationTimestamp = animationTimestamp;
      const beforeSubmit = now();
      await adapter.submitFrame(frame, lane, { phase: 'presentation-measured', index });
      const submitMs = now() - beforeSubmit;
      if (!Number.isFinite(submitMs) || submitMs <= 0) {
        throw new Error('CPU submit interval must be positive and finite');
      }
      cpuSubmit.push(submitMs);
      frame = (frame + 1) % INDICATOR_PROTOCOL.orbitFrames;
    }
    await adapter.drainGpu();
    let finalDrainCalls = 1;
    const queriedGpuTimestamps = typeof adapter.collectGpuTimestamps === 'function'
      ? await adapter.collectGpuTimestamps()
      : null;
    if (queriedGpuTimestamps != null) gpuTimestamps.push(...queriedGpuTimestamps);
    assertRetained(
      adapter.retainedEvidence(),
      1 + INDICATOR_PROTOCOL.warmupFrames + INDICATOR_PROTOCOL.measuredFrames,
    );

    for (let index = 0; index < INDICATOR_PROTOCOL.warmupFrames; index += 1) {
      await adapter.submitFrame(frame, lane, { phase: 'serialized-warmup', index });
      await adapter.completeGpu();
      completionCalls += 1;
      frame = (frame + 1) % INDICATOR_PROTOCOL.orbitFrames;
    }
    const serializedSubmitToCompletion = [];
    for (let index = 0; index < INDICATOR_PROTOCOL.measuredFrames; index += 1) {
      const before = now();
      await adapter.submitFrame(frame, lane, { phase: 'serialized-measured', index });
      await adapter.completeGpu();
      completionCalls += 1;
      const elapsed = now() - before;
      if (!Number.isFinite(elapsed) || elapsed <= 0) {
        throw new Error('serialized submit-to-completion interval must be positive and finite');
      }
      serializedSubmitToCompletion.push(elapsed);
      frame = (frame + 1) % INDICATOR_PROTOCOL.orbitFrames;
    }
    await adapter.drainGpu();
    finalDrainCalls += 1;
    const retainedAfterTiming = adapter.retainedEvidence();
    assertRetained(
      retainedAfterTiming,
      1 + (INDICATOR_PROTOCOL.warmupFrames + INDICATOR_PROTOCOL.measuredFrames) * 2,
    );
    if (gpuTimestamps.length !== 0 && gpuTimestamps.length !== INDICATOR_PROTOCOL.measuredFrames) {
      throw new Error('GPU timestamp support changed during the measured lane');
    }
    return Object.freeze({
      implementation: adapter.id,
      version: adapter.version,
      pointSizePx: lane.pointSizePx,
      cold,
      correctness,
      timing: {
        gpuCompletionCalls: completionCalls,
        finalDrainCalls,
        presentation: {
          warmupFrames: INDICATOR_PROTOCOL.warmupFrames,
          measuredFrames: INDICATOR_PROTOCOL.measuredFrames,
          presentedIntervals: summarizeIntervals(presentedIntervals),
          cpuSubmit: summarizeIntervals(cpuSubmit),
        },
        gpuTimestamp: gpuTimestamps.length ? summarizeIntervals(gpuTimestamps) : null,
        serializedSubmitToCompletion: summarizeIntervals(serializedSubmitToCompletion),
        retainedAfterTiming,
      },
    });
  } finally {
    await adapter.destroy();
  }
}
