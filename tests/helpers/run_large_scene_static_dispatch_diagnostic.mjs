import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(
  resolve(root, 'benchmarks', 'large-scene-visualization', 'manifest.json'),
  'utf8',
));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const workload = manifest.workloads.find(({ id }) => id === 'orthographic-points-100k-static');
const fixedDispatchesPerSample = 1000;
const warmupSamples = 50;
const measuredSamples = 1000;
const tCritical95 = 1.9623414611334487;

function sourceCommit() {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (git.status !== 0) throw new Error(`cannot resolve source commit: ${git.stderr}`);
  return git.stdout.trim();
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

function quantile(sorted, fraction) {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function distribution(samples, suffix) {
  const sorted = samples.map(Number).sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / (sorted.length - 1);
  const sampleStddev = Math.sqrt(variance);
  const margin = tCritical95 * sampleStddev / Math.sqrt(sorted.length);
  return {
    count: sorted.length,
    [`min${suffix}`]: sorted[0],
    [`median${suffix}`]: quantile(sorted, 0.5),
    [`p95${suffix}`]: quantile(sorted, 0.95),
    [`max${suffix}`]: sorted.at(-1),
    [`mean${suffix}`]: mean,
    [`sampleStddev${suffix}`]: sampleStddev,
    [`meanCi95Lower${suffix}`]: mean - margin,
    [`meanCi95Upper${suffix}`]: mean + margin,
  };
}

function runLane(implementation, port) {
  process.stderr.write(`fixed-dispatch: ${workload.id}/${implementation}\n`);
  const helper = resolve(root, 'tests', 'helpers', 'run_large_scene_peer_benchmark.js');
  const child = spawnSync(process.execPath, [helper], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60 * 60 * 1000,
    env: {
      ...process.env,
      VF_LARGE_SCENE_GPU_MODE: 'hardware',
      VF_LARGE_SCENE_IMPLEMENTATION: implementation,
      VF_LARGE_SCENE_WORKLOAD: workload.id,
      VF_LARGE_SCENE_CORRECTNESS_ONLY: '0',
      VF_LARGE_SCENE_WARMUPS: String(warmupSamples),
      VF_LARGE_SCENE_MEASURED: String(measuredSamples),
      VF_LARGE_SCENE_FIXED_DISPATCHES: String(fixedDispatchesPerSample),
      VF_LARGE_SCENE_CDP_PORT: String(port),
    },
  });
  let result = null;
  try { result = JSON.parse(child.stdout || 'null'); } catch (_) {}
  if (child.status !== 0 || result?.ok !== true || result.correctness?.passed !== true) {
    throw new Error(`${implementation} diagnostic failed: ${child.stderr || child.stdout}`);
  }
  const timing = result.timing;
  if (timing.warmupFrames !== warmupSamples
    || timing.measuredFrames !== measuredSamples
    || timing.samplesMs?.length !== measuredSamples
    || timing.fixedDispatchesPerSample !== fixedDispatchesPerSample
    || timing.measuredDispatches !== measuredSamples * fixedDispatchesPerSample
    || timing.adaptiveBatching !== false
    || timing.measuredGpuFrames !== measuredSamples
    || timing.gpuCompletionCalls !== workload.correctness.checkpoints.length
      + warmupSamples + measuredSamples) {
    throw new Error(`${implementation} diagnostic count mismatch`);
  }
  if (result.correctness.retained?.sourceIdentityRetained !== true
    || result.correctness.retained.largeBufferUploadsAfterInitialize !== 0) {
    throw new Error(`${implementation} diagnostic violated retained-data responsibility`);
  }
  const batch = distribution(timing.samplesMs, 'Ms');
  const perDispatchSamplesUs = timing.samplesMs.map(
    (sampleMs) => (sampleMs * 1000) / fixedDispatchesPerSample,
  );
  return {
    implementation,
    result,
    batchDistributionMs: batch,
    perDispatchDistributionUs: distribution(perDispatchSamplesUs, 'Us'),
    targetMinimumBatchMs: result.clock.minimumPositiveDeltaMs * 100,
    targetSatisfied: batch.medianMs >= result.clock.minimumPositiveDeltaMs * 100,
  };
}

const lanes = [];
for (const implementation of workload.comparableImplementations) {
  lanes.push(runLane(implementation, await availablePort()));
}
const renderer = lanes[0].result.environment.webglRenderer;
const environmentIdentity = JSON.stringify(lanes[0].result.environment);
if (/swiftshader|software/i.test(renderer)
  || lanes.some(({ result }) => JSON.stringify(result.environment) !== environmentIdentity)) {
  throw new Error('fixed-dispatch diagnostic requires one shared hardware environment');
}
if (lanes.some(({ targetSatisfied }) => !targetSatisfied)) {
  throw new Error('fixed-dispatch batch median did not reach 100 clock quanta');
}

const evidence = {
  schema: 'vkf.large-scene-static-fixed-dispatch-diagnostic',
  schemaVersion: 1,
  status: 'measured-diagnostic',
  performanceClaim: false,
  releaseGateChanged: false,
  sourceCommit: sourceCommit(),
  versions: {
    vkf: packageJson.version,
    'deck-gl': packageJson.devDependencies['@deck.gl/core'],
    'vtk-js': packageJson.devDependencies['@kitware/vtk.js'],
    'plotly-scattergl': packageJson.devDependencies['plotly.js-dist-min'],
  },
  workload: workload.id,
  responsibility: 'retained static no-change dispatch; identical fixed operation count; one GPU completion after each batch',
  fixedDispatchesPerSample,
  warmupSamples,
  measuredSamples,
  adaptiveBatching: false,
  rotatedOrder: workload.comparableImplementations,
  environment: lanes[0].result.environment,
  lanes,
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
const output = process.env.VF_LARGE_SCENE_DISPATCH_OUTPUT;
if (output) {
  const destination = resolve(root, output);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, serialized);
}
process.stdout.write(JSON.stringify({
  status: evidence.status,
  sourceCommit: evidence.sourceCommit,
  fixedDispatchesPerSample,
  distributions: lanes.map(({ implementation, batchDistributionMs, perDispatchDistributionUs }) => ({
    implementation,
    batchMedianMs: batchDistributionMs.medianMs,
    perDispatchMedianUs: perDispatchDistributionUs.medianUs,
  })),
  evidenceSha256: createHash('sha256').update(serialized).digest('hex'),
  output: output ?? null,
}));
