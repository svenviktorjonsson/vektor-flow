import { INDICATOR_PROTOCOL, fixtureSha256 } from './protocol.mjs';
import { summarizeIntervals } from './statistics.mjs';
import { compareCloudRegionStats, verifyCloudCapture } from './correctness.mjs';

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

function assertCameraSubmission(submission, frame) {
  const expected = 2 * Math.PI * frame / INDICATOR_PROTOCOL.orbitFrames;
  if (!Number.isFinite(submission?.cameraAngleRadians)
    || Math.abs(submission.cameraAngleRadians - expected) > 1e-12) {
    throw new Error(`frame ${frame} did not submit the exact deterministic orbit camera`);
  }
}

export async function runIndicatorLane(adapter, lane, options = {}) {
  assertAdapter(adapter);
  if (!INDICATOR_PROTOCOL.pointSizesPx.includes(lane?.pointSizePx)) {
    throw new RangeError('indicator lane point size must be 1px or 4px');
  }
  if (options.release === true) {
    const fixture = options.fixture;
    if (fixture?.pointCount !== INDICATOR_PROTOCOL.pointCount
      || await fixtureSha256(fixture?.bytes) !== INDICATOR_PROTOCOL.fixtureSha256) {
      throw new Error('release indicator requires the frozen one-million fixture bytes');
    }
  }
  const now = options.now ?? (() => performance.now());
  const nextAnimationFrame = options.nextAnimationFrame ?? browserAnimationFrame;
  const verifyCapture = options.verifyCapture ?? (async (capture, frame) => (
    await verifyCloudCapture(capture, options.fixture, frame, lane.pointSizePx)
  ));
  let completionCalls = 0;
  let cold;
  try {
    cold = await adapter.initialize(lane);
    const captures = [];
    for (const frame of INDICATOR_PROTOCOL.correctnessFrames) {
      const submission = await adapter.submitFrame(frame, lane, { phase: 'correctness' });
      assertCameraSubmission(submission, frame);
      await adapter.completeGpu();
      completionCalls += 1;
      const rawCapture = await adapter.capture(frame, lane);
      const verified = await verifyCapture(rawCapture, frame, lane);
      if (verified?.passed !== true || typeof verified.artifactSha256 !== 'string') {
        throw new Error(`correctness capture failed at frame ${frame}: ${JSON.stringify(verified)}`);
      }
      if (typeof options.encodeCaptureArtifact === 'function') {
        verified.artifactPngDataUrl = await options.encodeCaptureArtifact(rawCapture, frame, lane);
      }
      captures.push(verified);
    }
    const anchorHashes = new Set(captures.slice(0, -1).map(({ artifactSha256 }) => artifactSha256));
    if (anchorHashes.size !== INDICATOR_PROTOCOL.correctnessFrames.length - 1) {
      throw new Error('correctness captures contain a stale or wrong-camera anchor frame');
    }
    const closure = compareCloudRegionStats(captures[0].observed, captures.at(-1).observed, 0.01);
    if (!closure.passed) throw new Error(`closed orbit did not return to frame zero: ${closure.maxRegionError}`);
    const correctness = { passed: true, captures, closure };
    assertRetained(adapter.retainedEvidence(), INDICATOR_PROTOCOL.correctnessFrames.length);

    let frame = 1;
    let previousAnimationTimestamp = null;
    for (let index = 0; index < INDICATOR_PROTOCOL.warmupFrames; index += 1) {
      previousAnimationTimestamp = await nextAnimationFrame();
      const submission = await adapter.submitFrame(frame, lane, { phase: 'raf-warmup', index });
      assertCameraSubmission(submission, frame);
      frame = (frame + 1) % INDICATOR_PROTOCOL.orbitFrames;
    }

    const rafCallbackIntervals = [];
    const cpuSubmit = [];
    const gpuTimestamps = [];
    for (let index = 0; index < INDICATOR_PROTOCOL.measuredFrames; index += 1) {
      const animationTimestamp = await nextAnimationFrame();
      const interval = animationTimestamp - previousAnimationTimestamp;
      if (!Number.isFinite(interval) || interval <= 0) {
        throw new Error('animation frame interval must be positive and finite');
      }
      rafCallbackIntervals.push(interval);
      previousAnimationTimestamp = animationTimestamp;
      const beforeSubmit = now();
      const submission = await adapter.submitFrame(frame, lane, { phase: 'raf-measured', index });
      assertCameraSubmission(submission, frame);
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
      INDICATOR_PROTOCOL.correctnessFrames.length
        + INDICATOR_PROTOCOL.warmupFrames + INDICATOR_PROTOCOL.measuredFrames,
    );

    for (let index = 0; index < INDICATOR_PROTOCOL.warmupFrames; index += 1) {
      const submission = await adapter.submitFrame(frame, lane, { phase: 'serialized-warmup', index });
      assertCameraSubmission(submission, frame);
      await adapter.completeGpu();
      completionCalls += 1;
      frame = (frame + 1) % INDICATOR_PROTOCOL.orbitFrames;
    }
    const serializedSubmitToCompletion = [];
    for (let index = 0; index < INDICATOR_PROTOCOL.measuredFrames; index += 1) {
      const before = now();
      const submission = await adapter.submitFrame(frame, lane, { phase: 'serialized-measured', index });
      assertCameraSubmission(submission, frame);
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
      INDICATOR_PROTOCOL.correctnessFrames.length
        + (INDICATOR_PROTOCOL.warmupFrames + INDICATOR_PROTOCOL.measuredFrames) * 2,
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
        rafCallbackScheduling: {
          warmupFrames: INDICATOR_PROTOCOL.warmupFrames,
          measuredFrames: INDICATOR_PROTOCOL.measuredFrames,
          rafCallbackIntervals: summarizeIntervals(rafCallbackIntervals),
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
