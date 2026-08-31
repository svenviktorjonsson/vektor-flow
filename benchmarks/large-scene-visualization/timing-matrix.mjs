import { createHash } from 'node:crypto';

import {
  evaluateReport,
  sha256Json,
  workloadContractSha256,
} from './contract.mjs';

function laneKey({ implementation, workload }) {
  return `${workload}/${implementation}`;
}

export function applicableLaneSpecs(manifest) {
  const specs = [];
  for (let workloadIndex = 0; workloadIndex < manifest.workloads.length; workloadIndex += 1) {
    const workload = manifest.workloads[workloadIndex];
    const rotated = manifest.implementations.map((_, index) => (
      manifest.implementations[(index + workloadIndex) % manifest.implementations.length]
    ));
    for (const implementation of rotated) {
      if (workload.comparableImplementations.includes(implementation)) {
        specs.push({ implementation, workload: workload.id });
      }
    }
  }
  return specs;
}

function exactLanes(manifest, lanes, phase) {
  const expected = applicableLaneSpecs(manifest);
  if (!Array.isArray(lanes) || lanes.length !== expected.length
    || lanes.some((lane, index) => laneKey(lane) !== laneKey(expected[index]))) {
    throw new Error(`${phase} must use every applicable lane in rotated order`);
  }
  return expected;
}

function assertCorrectness(workload, lane, phase) {
  const correctness = lane.result?.correctness;
  const clock = lane.result?.clock;
  if (lane.passed !== true || lane.exitCode !== 0 || lane.result?.ok !== true
    || correctness?.passed !== true
    || correctness.retained?.sourceIdentityRetained !== true
    || correctness.retained.largeBufferUploadsAfterInitialize !== 0
    || correctness.checkpoints?.length !== workload.correctness.checkpoints.length) {
    throw new Error(`${phase} failed for ${laneKey(lane)}`);
  }
  if (clock?.crossOriginIsolated !== true
    || !Number.isFinite(clock.minimumPositiveDeltaMs)
    || clock.minimumPositiveDeltaMs <= 0
    || clock.minimumPositiveDeltaMs > 0.01) {
    throw new Error(`${phase} high-resolution clock evidence failed for ${laneKey(lane)}`);
  }
  for (const checkpoint of correctness.checkpoints) {
    if (checkpoint.passed !== true || !Number.isFinite(checkpoint.maxRegionError)
      || checkpoint.maxRegionError > workload.correctness.maxRegionError
      || !/^[0-9a-f]{64}$/.test(checkpoint.artifactSha256 ?? '')) {
      throw new Error(`${phase} correctness evidence failed for ${laneKey(lane)}`);
    }
  }
}

function environmentIdentity(environment) {
  return JSON.stringify({
    operatingSystem: environment?.operatingSystem,
    architecture: environment?.architecture,
    cpu: environment?.cpu,
    browserUserAgent: environment?.browserUserAgent,
    webglVendor: environment?.webglVendor,
    webglRenderer: environment?.webglRenderer,
    viewport: environment?.viewport,
    devicePixelRatio: environment?.devicePixelRatio,
  });
}

function assertEnvironment(lanes, environment) {
  const identity = environmentIdentity(environment);
  if (lanes.some((lane) => environmentIdentity(lane.result?.environment) !== identity)) {
    throw new Error('every timing lane must use the same browser and GPU environment');
  }
  if (/swiftshader|software/i.test(`${environment?.gpu ?? ''} ${environment?.webglRenderer ?? ''}`)) {
    throw new Error('published timing requires a hardware renderer; software fallback is correctness-only');
  }
}

function combinedArtifactSha256(checkpoints) {
  const canonical = checkpoints
    .map(({ frame, artifactSha256 }) => `${frame}:${artifactSha256}`)
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

function publishedMeasurement(manifest, workload, lane, sourceCommit) {
  const correctness = lane.result.correctness;
  const maximumError = Math.max(...correctness.checkpoints.map(({ maxRegionError }) => maxRegionError));
  return {
    implementation: lane.implementation,
    state: 'published',
    comparable: true,
    versions: {
      implementation: lane.result.adapterVersion,
      harness: sourceCommit,
    },
    correctness: {
      passed: true,
      completedAtSequence: correctness.completedAtSequence,
      oracle: workload.correctness.oracle,
      artifactSha256: combinedArtifactSha256(correctness.checkpoints),
      datasetSha256: workload.fixture.sha256,
      workloadContractSha256: workloadContractSha256(workload),
      maxRegionError: maximumError,
      allowedRegionError: workload.correctness.maxRegionError,
    },
    timing: {
      startedAtSequence: lane.result.timing.startedAtSequence,
      metric: manifest.measurement.ratchetMetric,
      samplesMs: lane.result.timing.samplesMs,
    },
  };
}

function candidateReport(manifest, timing, environment, sourceCommit) {
  const laneMap = new Map(timing.map((lane) => [laneKey(lane), lane]));
  return {
    schema: 'vkf.large-scene-visualization-report',
    schemaVersion: 1,
    manifestSha256: sha256Json(manifest),
    status: 'measured',
    environment: {
      operatingSystem: environment.operatingSystem,
      architecture: environment.architecture,
      cpu: environment.cpu,
      gpu: environment.gpu,
      browser: environment.browser,
      browserVersion: environment.browserVersion,
      devicePixelRatio: environment.devicePixelRatio,
      viewport: environment.viewport,
      powerMode: environment.powerMode,
    },
    workloads: manifest.workloads.map((workload) => ({
      id: workload.id,
      measurements: manifest.implementations.map((implementation) => {
        if (!workload.comparableImplementations.includes(implementation)) {
          const exclusion = workload.nonComparableImplementations.find(({ id }) => id === implementation);
          return {
            implementation,
            state: 'not-applicable',
            comparable: false,
            reason: exclusion.reason,
          };
        }
        return publishedMeasurement(
          manifest,
          workload,
          laneMap.get(laneKey({ implementation, workload: workload.id })),
          sourceCommit,
        );
      }),
    })),
  };
}

export function buildTimingEvidence(manifest, options) {
  const { preflight, timing, environment, versions, sourceCommit } = options;
  exactLanes(manifest, preflight, 'global correctness preflight');
  exactLanes(manifest, timing, 'timing phase');
  for (const lane of preflight) {
    const workload = manifest.workloads.find(({ id }) => id === lane.workload);
    assertCorrectness(workload, lane, 'global correctness preflight');
    if (lane.result.timing !== null) throw new Error('global correctness preflight must not start timing');
  }
  for (const lane of timing) {
    const workload = manifest.workloads.find(({ id }) => id === lane.workload);
    assertCorrectness(workload, lane, 'timing phase');
    const result = lane.result.timing;
    if (!Array.isArray(result?.samplesMs)
      || result.samplesMs.length < manifest.measurement.minimumMeasuredFrames) {
      throw new Error(`${laneKey(lane)} requires at least ${manifest.measurement.minimumMeasuredFrames} measured frames`);
    }
    if (result.measuredGpuFrames !== result.samplesMs.length) {
      throw new Error(`${laneKey(lane)} must use exactly one completed GPU frame per timing sample`);
    }
    const requiredCompletions = workload.correctness.checkpoints.length
      + manifest.measurement.minimumWarmupFrames
      + result.samplesMs.length;
    if (result.gpuCompletionCalls < requiredCompletions) {
      throw new Error(`${laneKey(lane)} did not explicitly complete every GPU frame`);
    }
  }
  assertEnvironment([...preflight, ...timing], environment);
  const report = candidateReport(manifest, timing, environment, sourceCommit);
  const base = {
    schema: 'vkf.large-scene-peer-timing-evidence',
    schemaVersion: 1,
    sourceCommit,
    versions,
    environment,
    warmupFrames: manifest.measurement.minimumWarmupFrames,
    measuredFrames: manifest.measurement.minimumMeasuredFrames,
    rotatedOrder: applicableLaneSpecs(manifest),
    rawPreflightLanes: preflight,
    rawTimingLanes: timing,
  };
  try {
    const ratchet = evaluateReport(manifest, report);
    return {
      ...base,
      status: 'measured',
      performanceClaim: true,
      ratchet,
      publishedReport: report,
    };
  } catch (error) {
    return {
      ...base,
      status: 'withheld-ratchet-failed',
      performanceClaim: false,
      ratchetError: error instanceof Error ? error.message : String(error),
    };
  }
}
