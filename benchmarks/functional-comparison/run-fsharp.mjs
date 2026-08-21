import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = dirname(fileURLToPath(import.meta.url));
const project = resolve(root, 'FunctionalBench.fsproj');
const work = resolve(root, '.fsharp-work');
const compileRuns = 100;
const compileWarmups = 3;
const runtimeRuns = 100;
const runtimeWarmups = 5;

function command(args, { quiet = false } = {}) {
  const started = performance.now();
  const result = spawnSync('dotnet', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: quiet ? 'ignore' : 'pipe'
  });
  const elapsedMs = performance.now() - started;
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed: ${result.stderr || ''}`);
  }
  return { elapsedMs, stdout: result.stdout || '' };
}

function stats(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
command(['restore', project, '--nologo']);

const compileSamples = [];
let runtimeDll = '';
for (let index = 0; index < compileWarmups + compileRuns; index += 1) {
  const output = resolve(work, String(index));
  mkdirSync(output, { recursive: true });
  const result = command([
    'build', project,
    '--configuration', 'Release',
    '--no-restore',
    '--nologo',
    '--target:Rebuild',
    `--property:OutputPath=${output}`
  ]);
  if (index >= compileWarmups) compileSamples.push(result.elapsedMs);
  runtimeDll = resolve(output, 'FunctionalBench.dll');
}

const runtimeSamples = [];
for (let index = 0; index < runtimeWarmups + runtimeRuns; index += 1) {
  const result = command([runtimeDll], { quiet: true });
  if (index >= runtimeWarmups) runtimeSamples.push(result.elapsedMs);
}

const compile = stats(compileSamples);
const runtime = stats(runtimeSamples);
const value = command([runtimeDll]).stdout.trim();
console.log('language,compile_mean_ms,compile_std_ms,runtime_mean_ms,runtime_std_ms,value');
console.log(`fsharp,${compile.mean.toFixed(6)},${compile.std.toFixed(6)},${runtime.mean.toFixed(6)},${runtime.std.toFixed(6)},${value}`);
