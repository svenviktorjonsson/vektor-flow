import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applicableLaneSpecs,
  buildTimingEvidence,
} from '../../benchmarks/large-scene-visualization/timing-matrix.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(
  resolve(root, 'benchmarks', 'large-scene-visualization', 'manifest.json'),
  'utf8',
));

function exactVersions() {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  return {
    vkf: packageJson.version,
    'deck-gl': packageJson.devDependencies['@deck.gl/core'],
    'vtk-js': packageJson.devDependencies['@kitware/vtk.js'],
    'plotly-scattergl': packageJson.devDependencies['plotly.js-dist-min'],
    esbuild: packageJson.devDependencies.esbuild,
  };
}

function sourceCommit() {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (git.status !== 0) throw new Error(`cannot resolve source commit: ${git.stderr}`);
  return git.stdout.trim();
}

function runLane(spec, phase, port) {
  process.stderr.write(`${phase}: ${spec.workload}/${spec.implementation}\n`);
  const helper = resolve(root, 'tests', 'helpers', 'run_large_scene_peer_benchmark.js');
  const child = spawnSync(process.execPath, [helper], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60 * 60 * 1000,
    env: {
      ...process.env,
      VF_LARGE_SCENE_IMPLEMENTATION: spec.implementation,
      VF_LARGE_SCENE_WORKLOAD: spec.workload,
      VF_LARGE_SCENE_CORRECTNESS_ONLY: phase === 'preflight' ? '1' : '0',
      VF_LARGE_SCENE_WARMUPS: String(manifest.measurement.minimumWarmupFrames),
      VF_LARGE_SCENE_MEASURED: String(manifest.measurement.minimumMeasuredFrames),
      VF_LARGE_SCENE_CDP_PORT: String(port),
    },
  });
  let result = null;
  try { result = JSON.parse(child.stdout || 'null'); } catch (_) {}
  const timingSatisfied = phase === 'preflight'
    ? result?.timing === null
    : result?.timing?.samplesMs?.length >= manifest.measurement.minimumMeasuredFrames;
  return {
    ...spec,
    phase,
    exitCode: child.status,
    passed: child.status === 0 && result?.ok === true
      && result?.correctness?.passed === true && timingSatisfied,
    result,
    stderr: child.stderr || '',
  };
}

function serialize(evidence) {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

function writeEvidence(evidence) {
  const serialized = serialize(evidence);
  const output = process.env.VF_LARGE_SCENE_TIMING_OUTPUT;
  if (output) {
    const destination = resolve(root, output);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, serialized);
  }
  process.stdout.write(JSON.stringify({
    status: evidence.status,
    performanceClaim: evidence.performanceClaim,
    ratchetError: evidence.ratchetError ?? null,
    ratios: evidence.ratchet?.rows?.map(({ workload, peer, ratio }) => ({ workload, peer, ratio })) ?? [],
    evidenceSha256: createHash('sha256').update(serialized).digest('hex'),
    output: output ?? null,
  }));
}

function main() {
  const specs = applicableLaneSpecs(manifest);
  let port = Number(process.env.VF_LARGE_SCENE_TIMING_PORT || 9400);
  const preflight = specs.map((spec) => runLane(spec, 'preflight', port++));
  if (preflight.some(({ passed }) => !passed)) {
    writeEvidence({
      schema: 'vkf.large-scene-peer-timing-evidence',
      schemaVersion: 1,
      status: 'withheld-correctness-preflight-failed',
      performanceClaim: false,
      sourceCommit: sourceCommit(),
      versions: exactVersions(),
      rotatedOrder: specs,
      rawPreflightLanes: preflight,
      rawTimingLanes: [],
    });
    return;
  }
  const timing = specs.map((spec) => runLane(spec, 'timing', port++));
  try {
    writeEvidence(buildTimingEvidence(manifest, {
      preflight,
      timing,
      environment: preflight[0].result.environment,
      versions: exactVersions(),
      sourceCommit: sourceCommit(),
    }));
  } catch (error) {
    writeEvidence({
      schema: 'vkf.large-scene-peer-timing-evidence',
      schemaVersion: 1,
      status: 'withheld-timing-execution-failed',
      performanceClaim: false,
      executionError: error instanceof Error ? error.stack : String(error),
      sourceCommit: sourceCommit(),
      versions: exactVersions(),
      environment: preflight[0].result.environment,
      rotatedOrder: specs,
      rawPreflightLanes: preflight,
      rawTimingLanes: timing,
    });
  }
}

main();
