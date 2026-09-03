import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { INDICATOR_PROTOCOL } from './protocol.mjs';
import {
  SUITE_IMPLEMENTATION_QUERIES,
  SUITE_REPEATS,
  aggregateRunMeans,
  validateSuiteMatrix,
} from './suite-contract.mjs';

const execFileAsync = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(directory, '..', '..');
const runner = path.join(directory, 'run-browser.cjs');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function sourceTreeHash() {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else files.push(target);
    }
  }
  await walk(directory);
  files.push(path.join(repoRoot, 'web', 'vf-ui', 'geom', 'vf-geom-wgpu.js'));
  files.push(path.join(repoRoot, 'package-lock.json'));
  files.sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(repoRoot, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function environmentIdentity(payload) {
  return JSON.stringify({
    ...payload.environment,
    gpu: payload.renderer,
    userAgent: payload.userAgent,
  });
}

function decodePngDataUrl(value) {
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    throw new Error('capture artifact is not a PNG data URL');
  }
  return Buffer.from(value.slice(prefix.length), 'base64');
}

function metricAggregate(runs, selector) {
  const values = runs.map(selector).filter((value) => value != null);
  return values.length === runs.length ? aggregateRunMeans(values) : null;
}

async function runLane(query, pointSizePx, repeat, captureArtifacts) {
  const { stdout } = await execFileAsync(process.execPath, [runner], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VF_RETAINED_CLOUD_MODE: 'full',
      VF_RETAINED_CLOUD_POINTS: String(INDICATOR_PROTOCOL.pointCount),
      VF_RETAINED_CLOUD_POINT_SIZE: String(pointSizePx),
      VF_RETAINED_CLOUD_IMPLEMENTATION: query,
      VF_RETAINED_CLOUD_CAPTURE_ARTIFACTS: captureArtifacts ? '1' : '0',
      VF_RETAINED_CLOUD_ALLOW_CORRECTNESS_UNSUPPORTED: '0',
      VF_RETAINED_CLOUD_GPU_MODE: 'hardware',
    },
    maxBuffer: 96 * 1024 * 1024,
    windowsHide: true,
  });
  const payload = JSON.parse(stdout);
  if (payload.ok !== true) throw new Error(`${query}:${pointSizePx}:${repeat} failed: ${payload.error}`);
  return payload;
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const { stdout: commitStdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
  const sourceCommit = commitStdout.trim();
  const outputPath = path.resolve(
    repoRoot,
    process.env.VF_RETAINED_CLOUD_SUITE_OUTPUT
      ?? path.join('.test-tmp', 'retained-cloud-indicator-suite.json'),
  );
  const captureDirectory = outputPath.replace(/\.json$/i, '-captures');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(captureDirectory, { recursive: true });
  const rowsByKey = new Map();
  const executionOrder = [];
  let pinnedEnvironment = null;
  let environmentKey = null;
  for (let repeat = 0; repeat < SUITE_REPEATS; repeat += 1) {
    for (const pointSizePx of INDICATOR_PROTOCOL.pointSizesPx) {
      for (const query of SUITE_IMPLEMENTATION_QUERIES) {
        const captureArtifacts = repeat === 0;
        process.stderr.write(`retained-cloud ${repeat + 1}/${SUITE_REPEATS} ${pointSizePx}px ${query}\n`);
        const payload = await runLane(query, pointSizePx, repeat, captureArtifacts);
        const identity = environmentIdentity(payload);
        const currentEnvironmentKey = sha256(identity);
        if (environmentKey == null) {
          environmentKey = currentEnvironmentKey;
          pinnedEnvironment = JSON.parse(identity);
        } else if (currentEnvironmentKey !== environmentKey) {
          throw new Error('browser/hardware environment changed during suite');
        }
        const captures = payload.result.correctness.captures;
        if (captureArtifacts) {
          for (const capture of captures) {
            const png = decodePngDataUrl(capture.artifactPngDataUrl);
            const filename = `${payload.implementation}-${pointSizePx}px-frame-${capture.frame}.png`;
            const target = path.join(captureDirectory, filename);
            await writeFile(target, png);
            capture.artifactPng = {
              path: path.relative(repoRoot, target).replaceAll('\\', '/'),
              sha256: sha256(png),
              bytes: png.byteLength,
            };
            delete capture.artifactPngDataUrl;
          }
        }
        const key = `${payload.implementation}:${pointSizePx}`;
        if (!rowsByKey.has(key)) {
          rowsByKey.set(key, {
            implementation: payload.implementation,
            version: payload.result.version,
            pointSizePx,
            backend: payload.result.cold.backend,
            timestampMode: payload.result.cold.timestampMode ?? 'unsupported',
            runs: [],
          });
        }
        rowsByKey.get(key).runs.push({
          repeat: repeat + 1,
          environmentKey,
          result: payload.result,
        });
        executionOrder.push({ repeat: repeat + 1, pointSizePx, implementation: payload.implementation });
      }
    }
  }
  const rows = [...rowsByKey.values()];
  validateSuiteMatrix(rows, environmentKey);
  for (const row of rows) {
    row.runLevelStatistics = {
      rafCallbackMean: metricAggregate(
        row.runs,
        (run) => run.result.timing?.rafCallbackScheduling.rafCallbackIntervals.meanMs ?? null,
      ),
      cpuSubmitMean: metricAggregate(
        row.runs,
        (run) => run.result.timing?.rafCallbackScheduling.cpuSubmit.meanMs ?? null,
      ),
      gpuTimestampMean: metricAggregate(
        row.runs,
        (run) => run.result.timing?.gpuTimestamp?.meanMs ?? null,
      ),
      serializedSubmitToCompletionMean: metricAggregate(
        row.runs,
        (run) => run.result.timing?.serializedSubmitToCompletion.meanMs ?? null,
      ),
      coldFirstVisibleMean: metricAggregate(row.runs, (run) => run.result.cold.firstVisibleMs),
    };
  }
  const artifact = {
    schema: 'vkf.retained-cloud-indicator-evidence',
    schemaVersion: 1,
    packageVersion: packageJson.version,
    sourceCommit,
    benchmarkSourceHash: await sourceTreeHash(),
    protocolHash: sha256(JSON.stringify(INDICATOR_PROTOCOL)),
    fixtureSha256: INDICATOR_PROTOCOL.fixtureSha256,
    protocol: INDICATOR_PROTOCOL,
    repeatPolicy: {
      independentRunsPerRow: SUITE_REPEATS,
      executionOrder: 'repeat, then 1px/4px, then raw WebGPU/Three.js/deck.gl/VKF',
      noAdaptiveBatching: true,
      vkfMarkerResponsibility: 'internal exact flat opaque path; correctness required before timing',
    },
    environmentKey,
    pinnedEnvironment,
    executionOrder,
    rows,
  };
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(JSON.stringify({
    outputPath,
    artifactSha256: sha256(await readFile(outputPath)),
    sourceCommit,
    rows: rows.map((row) => ({
      implementation: row.implementation,
      pointSizePx: row.pointSizePx,
      rafMeanMs: row.runLevelStatistics.rafCallbackMean?.meanOfRunMeansMs ?? null,
      gpuMeanMs: row.runLevelStatistics.gpuTimestampMean?.meanOfRunMeansMs ?? null,
      serializedMeanMs: row.runLevelStatistics.serializedSubmitToCompletionMean?.meanOfRunMeansMs ?? null,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
