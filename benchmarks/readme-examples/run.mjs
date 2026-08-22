import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchmarkRoot, '..', '..');
const examplesRoot = resolve(repoRoot, 'examples', 'generated', 'readme');
const resultsRoot = resolve(benchmarkRoot, 'results');
const packageMetadata = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));

function parseOptions(argv) {
  const defaults = platform() === 'win32'
    ? resolve(repoRoot, 'build', 'native-compiler-clang', 'bin', 'vkf-strict.exe')
    : resolve(repoRoot, 'build', 'native-compiler', 'bin', 'vkf-strict');
  const options = {
    compiler: defaults,
    compileRuns: 100,
    compileWarmups: 1,
    runs: 100,
    warmups: 5,
    output: `${platform()}-${process.arch}-readme`
  };
  const numberKeys = new Map([
    ['compile-runs', 'compileRuns'],
    ['compile-warmups', 'compileWarmups'],
    ['runs', 'runs'],
    ['warmups', 'warmups']
  ]);
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match) throw new Error(`invalid option: ${argument}`);
    if (match[1] === 'compiler') {
      options.compiler = resolve(repoRoot, match[2]);
      continue;
    }
    if (match[1] === 'output') {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(match[2])) {
        throw new Error('--output must be a safe file stem');
      }
      options.output = match[2];
      continue;
    }
    const key = numberKeys.get(match[1]);
    if (!key) throw new Error(`unknown option: ${argument}`);
    const value = Number(match[2]);
    if (!Number.isInteger(value) || value < (key.endsWith('Warmups') || key === 'warmups' ? 0 : 1)) {
      throw new Error(`${argument} must be a valid nonnegative run count`);
    }
    options[key] = value;
  }
  return Object.freeze(options);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function relativeSlash(path) {
  return relative(examplesRoot, path).split(sep).join('/');
}

function findExamples(root) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...findExamples(path));
    if (entry.isFile() && entry.name.endsWith('.vkf')) found.push(path);
  }
  return found.sort((left, right) => relativeSlash(left).localeCompare(relativeSlash(right)));
}

function stats(samples) {
  if (samples.length === 0) throw new Error('cannot summarize an empty timing series');
  const sorted = samples.map(Number).sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const variance = sorted.length > 1
    ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length - 1)
    : 0;
  const round = (value) => Number(value.toFixed(6));
  return Object.freeze({
    count: sorted.length,
    meanMs: round(mean),
    medianMs: round(median),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1)),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    stddevMs: round(Math.sqrt(variance))
  });
}

function runCompiler(compiler, manifest) {
  const result = spawnSync(compiler, ['--batch-sources', manifest], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15 * 60 * 1000,
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`batch compilation failed: ${result.error?.message || `${result.stdout}\n${result.stderr}`.trim()}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function runArtifact(artifact, cwd) {
  const started = performance.now();
  const result = spawnSync(artifact, [], {
    cwd,
    encoding: null,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024
  });
  const elapsedMs = performance.now() - started;
  if (result.error || result.signal !== null || result.status === null) {
    throw new Error(`failed to run ${artifact}: ${result.error?.message || result.signal || 'no exit status'}`);
  }
  return {
    elapsedMs,
    code: result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0)
  };
}

function exactStream(buffer) {
  return Object.freeze({
    bytes: buffer.length,
    sha256: sha256(buffer),
    utf8: buffer.toString('utf8'),
    base64: buffer.toString('base64')
  });
}

function machineConditions(compiler, options) {
  const processorList = cpus();
  return Object.freeze({
    measuredAtUtc: new Date().toISOString(),
    osPlatform: platform(),
    osRelease: release(),
    architecture: process.arch,
    cpuModel: processorList[0]?.model?.trim() || 'unknown',
    logicalCpuCount: processorList.length,
    nodeVersion: process.version,
    compilerVersion: packageMetadata.version,
    compilerPath: compiler,
    compilerBytes: statSync(compiler).size,
    compilerSha256: sha256(readFileSync(compiler)),
    clock: 'Node performance.now()',
    compileModel: 'one persistent native compiler process; fresh source path and emitted artifact for every sample',
    compileIncludes: 'source read, lex, parse, native stdlib resolution, typed IR, machine lowering, executable emission',
    compileExcludes: 'compiler process startup',
    runtimeModel: 'fresh operating-system process for every sample, with executable loading and stdout/stderr capture',
    runtimeIncludes: 'process startup, generated program work, output capture, process teardown',
    runtimeWorkingDirectory: 'one isolated temporary directory per example, reused across its runs',
    measuredCompileRunsPerExample: options.compileRuns,
    compileWarmupsPerExample: options.compileWarmups,
    measuredRuntimeRunsPerExample: options.runs,
    runtimeWarmupsPerExample: options.warmups
  });
}

function markdownStream(label, stream) {
  if (stream.bytes === 0) return [`**${label}:** empty (0 bytes)`];
  return [
    `**${label}:** ${stream.bytes} bytes, SHA-256 \`${stream.sha256}\``,
    '',
    '```text',
    stream.utf8.replace(/\n$/, ''),
    '```'
  ];
}

function createMarkdown(payload) {
  const condition = payload.conditions;
  const lines = [
    `# VKF ${payload.version} README example proof`,
    '',
    `Generated ${condition.measuredAtUtc}. Every example was compiled from ${payload.options.compileRuns} fresh paths and executed in ${payload.options.runs} fresh operating-system processes.`,
    '',
    '## Conditions',
    '',
    `- OS: \`${condition.osPlatform} ${condition.osRelease}\``,
    `- Architecture: \`${condition.architecture}\``,
    `- CPU: ${condition.cpuModel} (${condition.logicalCpuCount} logical CPUs)`,
    `- Node timing host: \`${condition.nodeVersion}\``,
    `- Native compiler: ${condition.compilerBytes} bytes, SHA-256 \`${condition.compilerSha256}\``,
    `- Compile: ${condition.compileWarmupsPerExample} warmup + ${condition.measuredCompileRunsPerExample} measured runs. ${condition.compileModel}.`,
    `- Compile scope: ${condition.compileIncludes}; excludes ${condition.compileExcludes}.`,
    `- Runtime: ${condition.runtimeWarmupsPerExample} warmups + ${condition.measuredRuntimeRunsPerExample} measured runs. ${condition.runtimeModel}.`,
    `- Working directory: ${condition.runtimeWorkingDirectory}.`,
    '',
    '## Timing summary',
    '',
    '| Example | Source bytes | Compile mean | Compile median | Compile p95 | Run mean | Run median | Run p95 | Output |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
  ];
  for (const example of payload.examples) {
    lines.push(`| \`${example.path}\` | ${example.sourceBytes} | ${example.compile.meanMs.toFixed(3)} ms | ${example.compile.medianMs.toFixed(3)} ms | ${example.compile.p95Ms.toFixed(3)} ms | ${example.runtime.meanMs.toFixed(3)} ms | ${example.runtime.medianMs.toFixed(3)} ms | ${example.runtime.p95Ms.toFixed(3)} ms | ${example.outputStable ? `${example.outputRuns}/${example.outputRuns} identical` : 'unstable'} |`);
  }
  lines.push('', '## Exact output', '');
  for (const example of payload.examples) {
    lines.push(
      `### \`${example.path}\``,
      '',
      `Exit code: \`${example.exitCode}\`. Output stability: ${example.outputRuns}/${example.outputRuns} byte-identical measured runs.`,
      '',
      ...markdownStream('stdout', example.stdout),
      '',
      ...markdownStream('stderr', example.stderr),
      ''
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function compileExamples(examples, options, workRoot) {
  const totalIterations = options.compileWarmups + options.compileRuns;
  const manifestPaths = [];
  const positions = [];
  for (let iteration = 0; iteration < totalIterations; iteration += 1) {
    for (let exampleIndex = 0; exampleIndex < examples.length; exampleIndex += 1) {
      const source = examples[exampleIndex];
      const destination = resolve(workRoot, 'compile', String(iteration), relative(examplesRoot, source));
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      manifestPaths.push(destination);
      positions.push({ iteration, exampleIndex });
    }
  }
  const manifest = resolve(workRoot, 'sources.txt');
  writeFileSync(manifest, `${manifestPaths.join('\n')}\n`, 'utf8');
  const summaries = runCompiler(options.compiler, manifest);
  if (summaries.length !== positions.length) {
    throw new Error(`compiler returned ${summaries.length} summaries; expected ${positions.length}`);
  }
  const compiled = examples.map(() => ({ samples: [], artifact: null }));
  for (let index = 0; index < summaries.length; index += 1) {
    const summary = summaries[index];
    const position = positions[index];
    if (!Number.isFinite(summary.batch_ms) || summary.batch_ms < 0 || !summary.artifact_path) {
      throw new Error(`invalid batch summary at position ${index}`);
    }
    if (summary.artifact_fallback) {
      throw new Error(`${relativeSlash(examples[position.exampleIndex])} used a non-native artifact fallback`);
    }
    if (position.iteration >= options.compileWarmups) {
      compiled[position.exampleIndex].samples.push(Number(summary.batch_ms));
      compiled[position.exampleIndex].artifact = resolve(repoRoot, summary.artifact_path);
    }
  }
  return compiled;
}

function executeExamples(examples, compiled, options, workRoot) {
  const runtime = examples.map((source, index) => {
    const cwd = resolve(workRoot, 'runtime', relative(examplesRoot, source).replace(/\.vkf$/, ''));
    mkdirSync(cwd, { recursive: true });
    return { cwd, artifact: compiled[index].artifact, samples: [], first: null };
  });
  for (let warmup = 0; warmup < options.warmups; warmup += 1) {
    for (const state of runtime) {
      const result = runArtifact(state.artifact, state.cwd);
      if (result.code !== 0) throw new Error(`runtime warmup exited ${result.code}: ${state.artifact}`);
    }
  }
  for (let iteration = 0; iteration < options.runs; iteration += 1) {
    for (let index = 0; index < runtime.length; index += 1) {
      const state = runtime[index];
      const result = runArtifact(state.artifact, state.cwd);
      if (result.code !== 0) {
        throw new Error(`${relativeSlash(examples[index])} exited ${result.code}`);
      }
      if (state.first === null) {
        state.first = result;
      } else if (
        result.code !== state.first.code
        || !result.stdout.equals(state.first.stdout)
        || !result.stderr.equals(state.first.stderr)
      ) {
        throw new Error(`${relativeSlash(examples[index])} produced unstable output at measured run ${iteration + 1}`);
      }
      state.samples.push(result.elapsedMs);
    }
  }
  return runtime;
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const examples = findExamples(examplesRoot);
  if (examples.length === 0) throw new Error(`no README examples found under ${examplesRoot}`);
  const workRoot = mkdtempSync(join(tmpdir(), 'vkf-readme-proof-'));
  try {
    const compiled = compileExamples(examples, options, workRoot);
    const runtime = executeExamples(examples, compiled, options, workRoot);
    const payload = {
      schema: 1,
      version: packageMetadata.version,
      options,
      conditions: machineConditions(options.compiler, options),
      exampleCount: examples.length,
      examples: examples.map((source, index) => ({
        path: relativeSlash(source),
        sourceBytes: statSync(source).size,
        sourceSha256: sha256(readFileSync(source)),
        compile: stats(compiled[index].samples),
        compileSamplesMs: compiled[index].samples.map((value) => Number(value.toFixed(6))),
        runtime: stats(runtime[index].samples),
        runtimeSamplesMs: runtime[index].samples.map((value) => Number(value.toFixed(6))),
        exitCode: runtime[index].first.code,
        outputRuns: options.runs,
        outputStable: true,
        stdout: exactStream(runtime[index].first.stdout),
        stderr: exactStream(runtime[index].first.stderr)
      }))
    };
    mkdirSync(resultsRoot, { recursive: true });
    const jsonPath = resolve(resultsRoot, `${options.output}.json`);
    const markdownPath = resolve(resultsRoot, `${options.output}.md`);
    writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    writeFileSync(markdownPath, createMarkdown(payload), 'utf8');
    const stress = payload.examples.find((example) => example.path === 'core/12b-container-stress.vkf');
    console.log(`${payload.exampleCount} examples: ${options.compileRuns} fresh compiles and ${options.runs} full runs each; all outputs stable`);
    if (stress) console.log(`container stress runtime mean: ${stress.runtime.meanMs.toFixed(3)} ms`);
    console.log(markdownPath);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

main();
