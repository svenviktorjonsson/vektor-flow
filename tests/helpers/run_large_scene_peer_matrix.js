const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IMPLEMENTATIONS = ['vkf', 'deck-gl', 'vtk-js', 'plotly-scattergl'];
const WORKLOADS = ['orthographic-points-100k-static', 'orthographic-points-1m-pan'];

function exactVersions(repoRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(repoRoot, 'package.json'), 'utf8'));
  return {
    vkf: packageJson.version,
    'deck-gl': packageJson.devDependencies['@deck.gl/core'],
    'vtk-js': packageJson.devDependencies['@kitware/vtk.js'],
    'plotly-scattergl': packageJson.devDependencies['plotly.js-dist-min'],
    esbuild: packageJson.devDependencies.esbuild,
  };
}

function runLane(repoRoot, implementation, workload, port) {
  const helper = path.resolve(repoRoot, 'tests', 'helpers', 'run_large_scene_peer_benchmark.js');
  const child = spawnSync(process.execPath, [helper], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30 * 60 * 1000,
    env: {
      ...process.env,
      VF_LARGE_SCENE_IMPLEMENTATION: implementation,
      VF_LARGE_SCENE_WORKLOAD: workload,
      VF_LARGE_SCENE_CORRECTNESS_ONLY: '1',
      VF_LARGE_SCENE_CDP_PORT: String(port),
    },
  });
  let result = null;
  try { result = JSON.parse(child.stdout || 'null'); } catch (_) {}
  return {
    implementation,
    workload,
    exitCode: child.status,
    passed: child.status === 0 && result?.ok === true && result?.correctness?.passed === true,
    result,
    stderr: child.stderr || '',
  };
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const lanes = [];
  let port = Number(process.env.VF_LARGE_SCENE_MATRIX_PORT || 9360);
  for (let workloadIndex = 0; workloadIndex < WORKLOADS.length; workloadIndex += 1) {
    const rotated = IMPLEMENTATIONS.map((_, index) => IMPLEMENTATIONS[(index + workloadIndex) % IMPLEMENTATIONS.length]);
    for (const implementation of rotated) {
      lanes.push(runLane(repoRoot, implementation, WORKLOADS[workloadIndex], port++));
    }
  }
  const allCorrect = lanes.every(({ passed }) => passed);
  const firstEnvironment = lanes.find(({ result }) => result?.webgl)?.result;
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  const report = {
    schema: 'vkf.large-scene-peer-matrix-evidence',
    schemaVersion: 1,
    mode: 'headless-swiftshader-correctness-first',
    performanceClaim: false,
    status: allCorrect ? 'correctness-passed-timing-not-run' : 'withheld-peer-correctness-failed',
    globalGate: {
      allEightCorrect: allCorrect,
      timingStarted: false,
      validCorrectnessRows: lanes.filter(({ passed }) => passed).length,
      requiredCorrectnessRows: lanes.length,
    },
    environment: {
      operatingSystem: `${os.type()} ${os.release()}`,
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      browserUserAgent: firstEnvironment?.userAgent ?? 'unavailable',
      webgl: firstEnvironment?.webgl ?? null,
      viewport: [1280, 720],
      devicePixelRatio: 1,
      launch: '--headless=new --use-angle=swiftshader --force-device-scale-factor=1',
    },
    versions: exactVersions(repoRoot),
    sourceCommit: git.status === 0 ? git.stdout.trim() : 'unknown',
    lanes,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const output = process.env.VF_LARGE_SCENE_MATRIX_OUTPUT;
  if (output) {
    const destination = path.resolve(repoRoot, output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, serialized);
  }
  process.stdout.write(JSON.stringify({
    status: report.status,
    validCorrectnessRows: report.globalGate.validCorrectnessRows,
    requiredCorrectnessRows: report.globalGate.requiredCorrectnessRows,
    timingStarted: false,
    performanceClaim: false,
    evidenceSha256: createHash('sha256').update(serialized).digest('hex'),
    output: output ?? null,
  }));
}

main();
