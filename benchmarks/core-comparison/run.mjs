import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchmarkRoot, '..', '..');
export function benchmarkWorkRoot(
  hostPlatform = platform(),
  temporaryRoot = tmpdir(),
  repositoryWorkRoot = resolve(benchmarkRoot, '.work')
) {
  return hostPlatform === 'win32'
    ? resolve(temporaryRoot, 'vektor-flow-core-comparison')
    : resolve(repositoryWorkRoot);
}

const workRoot = benchmarkWorkRoot();
const resultsRoot = resolve(benchmarkRoot, 'results');
const executableExtension = platform() === 'win32' ? '.exe' : '';

const workloadSizes = Object.freeze([
  Object.freeze({ label: 'small', divisor: 100 }),
  Object.freeze({ label: 'medium', divisor: 10 }),
  Object.freeze({ label: 'large', divisor: 1 })
]);

function sizedCases(definition) {
  return workloadSizes.map(({ label, divisor }) => Object.freeze({
    ...definition,
    id: `${definition.template}-${label}`,
    size: label,
    count: Math.floor(definition.largeCount / divisor)
  }));
}

const cases = Object.freeze([
  Object.freeze({
    id: 'startup',
    template: 'startup',
    operation: 'startup',
    data: 'empty process',
    size: 'empty',
    requiresDirectVkf: true,
    tolerance: 0,
    languages: Object.freeze(['vkf', 'c', 'cpp', 'python-efficient', 'rust'])
  }),
  ...sizedCases(Object.freeze({
    template: 'scalar-control',
    operation: 'arithmetic + branch',
    data: 'scalar f64',
    largeCount: 2_000_000,
    requiresDirectVkf: true,
    tolerance: 1e-9,
    pythonExtension: 'py',
    languages: Object.freeze(['vkf', 'c', 'cpp', 'python-efficient', 'rust'])
  })),
  ...sizedCases(Object.freeze({
    template: 'fixed-vector',
    operation: 'linear recurrence',
    data: 'vector[4] f64',
    largeCount: 750_000,
    requiresDirectVkf: true,
    tolerance: 1e-7,
    pythonExtension: 'numpy.py',
    languages: Object.freeze(['vkf', 'c', 'cpp', 'python-efficient', 'rust'])
  })),
  ...sizedCases(Object.freeze({
    template: 'builtin-reduction',
    operation: 'sum + mean + count',
    data: 'fixed f64 container',
    largeCount: 6_400,
    requiresDirectVkf: true,
    tolerance: 1e-12,
    pythonExtension: 'numpy.py',
    languages: Object.freeze(['vkf', 'c', 'cpp', 'python-efficient', 'rust'])
  })),
  ...sizedCases(Object.freeze({
    template: 'record-value',
    operation: 'record update',
    data: 'record 4xf64',
    largeCount: 750_000,
    requiresDirectVkf: true,
    tolerance: 1e-9,
    pythonExtension: 'numpy.py',
    languages: Object.freeze(['vkf', 'c', 'cpp', 'python-efficient', 'rust'])
  })),
  ...sizedCases(Object.freeze({
    template: 'linear-filter',
    operation: 'IIR filter',
    data: 'series f64',
    largeCount: 2_000_000,
    requiresDirectVkf: true,
    tolerance: 1e-8,
    pythonExtension: 'scipy.py',
    languages: Object.freeze(['vkf', 'c', 'cpp', 'python-efficient', 'rust'])
  })),
  Object.freeze({
    id: 'welford-large',
    template: 'welford',
    operation: 'Welford population standard deviation',
    data: 'dynamic container f64',
    size: 'large',
    count: 6_400,
    explicitF64Values: true,
    requiresDirectVkf: true,
    tolerance: 1e-12,
    languages: Object.freeze(['vkf', 'c', 'cpp', 'rust'])
  }),
  Object.freeze({
    id: 'validated-sum-large',
    template: 'validated-sum',
    operation: 'typed integer validation',
    data: 'dynamic container f64',
    size: 'large',
    count: 6_400,
    explicitF64Values: true,
    requiresDirectVkf: true,
    tolerance: 0,
    languages: Object.freeze(['vkf', 'c', 'cpp', 'rust'])
  })
]);

export function parseOptions(argv) {
  const options = {
    caseId: null,
    languageId: null,
    outputStem: 'latest',
    compileRuns: 100,
    compileWarmups: 1,
    runs: 100,
    warmups: 5
  };
  const names = new Map([
    ['compile-runs', 'compileRuns'],
    ['compile-warmups', 'compileWarmups'],
    ['runs', 'runs'],
    ['warmups', 'warmups']
  ]);
  for (const arg of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match) throw new Error(`unknown option: ${arg}`);
    if (match[1] === 'case') {
      options.caseId = match[2];
      continue;
    }
    if (match[1] === 'language') {
      options.languageId = match[2];
      continue;
    }
    if (match[1] === 'output') {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(match[2])) {
        throw new Error(`${arg} must be a safe result name`);
      }
      options.outputStem = match[2];
      continue;
    }
    if (!names.has(match[1])) throw new Error(`unknown option: ${arg}`);
    const value = Number(match[2]);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${arg} must be a positive integer`);
    }
    options[names.get(match[1])] = value;
  }
  return options;
}

export function seriesStats(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('timing series must not be empty');
  }
  const sorted = samples.map(Number).sort((a, b) => a - b);
  const count = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / count;
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[(count - 1) / 2];
  const variance = count > 1
    ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)
    : 0;
  const stddev = Math.sqrt(variance);
  const margin = count > 1 ? 1.96 * stddev / Math.sqrt(count) : 0;
  const round = (value) => Number(value.toFixed(6));
  return Object.freeze({
    count,
    meanMs: round(mean),
    medianMs: round(median),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1)),
    p95Ms: round(sorted[Math.ceil(count * 0.95) - 1]),
    stddevMs: round(stddev),
    ci95LowerMs: round(Math.max(0, mean - margin)),
    ci95UpperMs: round(mean + margin)
  });
}

export function valuesAgree(left, right, tolerance) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function commandAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return result.status === 0;
}

function firstTool(candidates, label) {
  for (const candidate of candidates) {
    if (
      commandAvailable(candidate.command, candidate.versionArgs)
      && (!candidate.probeArgs || commandAvailable(candidate.command, candidate.probeArgs))
    ) return candidate;
  }
  throw new Error(`${label} unavailable; install it locally or run this benchmark in a matching Docker image`);
}

function toolVersion(tool) {
  const result = spawnSync(tool.command, tool.versionArgs, {
    encoding: 'utf8',
    windowsHide: true
  });
  return `${result.stdout || ''}${result.stderr || ''}`.trim().split(/\r?\n/, 1)[0];
}

function runCommand(command, args, { env = {}, timeoutMs = 180_000 } = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...env }
  });
  const elapsedMs = performance.now() - started;
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message || detail}`);
  }
  return { elapsedMs, stdout: result.stdout };
}

export function parseBatchCompileSummaries(stdout, expectedCount) {
  const summaries = String(stdout)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  if (summaries.length !== expectedCount) {
    throw new Error(`batch compiler returned ${summaries.length} summaries; expected ${expectedCount}`);
  }
  for (const summary of summaries) {
    if (!Number.isFinite(summary.batch_ms) || summary.batch_ms < 0) {
      throw new Error(`batch compiler returned invalid batch_ms: ${summary.batch_ms}`);
    }
  }
  return summaries;
}

function sourcePath(template, extension) {
  return resolve(benchmarkRoot, 'programs', `${template}.${extension}`);
}

function sourceSize(path) {
  const text = readFileSync(path, 'utf8');
  return Object.freeze({
    bytes: Buffer.byteLength(text),
    lines: text.trimEnd().split(/\r?\n/).length
  });
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function buildNativeCompilerTools(tools) {
  const toolRoot = resolve(workRoot, 'native-compiler');
  mkdirSync(toolRoot, { recursive: true });
  const processTimer = resolve(toolRoot, `native-process-timer${executableExtension}`);
  const entryTimer = resolve(toolRoot, `native-entry-timer${executableExtension}`);
  if (platform() === 'win32') {
    runCommand(tools.c.command, [
      '-O2', '-std=c17',
      resolve(benchmarkRoot, 'native_process_timer.c'),
      '-o', processTimer
    ]);
  }
  runCommand(tools.c.command, [
    '-O2', '-std=c17',
    resolve(benchmarkRoot, 'native_entry_timer.c'),
    '-o', entryTimer,
    ...(platform() === 'win32' ? [] : ['-lm'])
  ]);
  const jsonSource = resolve(repoRoot, 'native', 'VfOverlay', 'vf', 'json.cpp');
  const arm64Host = platform() === 'darwin' && process.arch === 'arm64';
  const definitions = [['driver', 'vkf_driver_artifact_smoke.cpp', true]];
  const built = {};
  if (platform() === 'win32') built.processTimer = processTimer;
  built.entryTimer = entryTimer;
  for (const [name, sourceName, needsJson, outputStem = `vkf-${name}`] of definitions) {
    const output = resolve(toolRoot, `${outputStem}${executableExtension}`);
    const sources = [resolve(repoRoot, 'compiler', 'native', sourceName)];
    const compileArgs = [];
    if (name === 'driver') {
      sources.push(
        resolve(repoRoot, 'compiler', 'native', 'vkf_lexer_cursor_smoke.cpp'),
        resolve(repoRoot, 'compiler', 'native', 'vkf_parser_token_stream_smoke.cpp'),
        resolve(repoRoot, 'compiler', 'native', 'vkf_ast_to_ir_smoke.cpp')
      );
      if (arm64Host) {
        compileArgs.push('-DVKF_ARM64_BACKEND_LIBRARY', '-DVKF_NATIVE_FRONTEND_LIBRARY');
      } else {
        sources.push(resolve(repoRoot, 'compiler', 'native', 'vkf_x64_artifact.cpp'));
        compileArgs.push('-DVKF_X64_BACKEND_LIBRARY', '-DVKF_NATIVE_FRONTEND_LIBRARY');
      }
    }
    if (needsJson) sources.push(jsonSource);
    const linkArgs = name === 'x64Template' && platform() === 'win32'
      ? [
          '-Xlinker', '/nodefaultlib',
          '-Xlinker', 'legacy_stdio_definitions.lib',
          '-Xlinker', 'legacy_stdio_wide_specifiers.lib',
          '-Xlinker', 'ucrt.lib',
          '-Xlinker', 'kernel32.lib'
        ]
      : [];
    runCommand(tools.cpp.command, [
      '-std=c++17', '-O2', '-DNDEBUG', '-I', repoRoot, '-I', resolve(repoRoot, 'native', 'VfOverlay'),
      ...compileArgs, ...sources, ...linkArgs, '-o', output
    ]);
    built[name] = output;
  }
  return Object.freeze(built);
}

function nativeProcessSamples(processTimer, output, warmups, runs) {
  const result = runCommand(processTimer, [
    output,
    String(warmups),
    String(runs)
  ]);
  const payload = JSON.parse(result.stdout);
  if (!Array.isArray(payload.samples_ms) || payload.samples_ms.length !== runs) {
    throw new Error(`native timer returned ${payload.samples_ms?.length ?? 0} samples; expected ${runs}`);
  }
  return payload.samples_ms.map(Number);
}

function interleavedNativeProcessSamples(processTimer, entries, warmups, runs) {
  const samples = new Map(entries.map(({ language }) => [language.id, []]));
  const chunkSize = 2;
  for (let offset = 0, batch = 0; offset < runs; offset += chunkSize, batch += 1) {
    const measured = Math.min(chunkSize, runs - offset);
    for (let position = 0; position < entries.length; position += 1) {
      const entry = entries[(batch + position) % entries.length];
      const batchSamples = nativeProcessSamples(
        processTimer,
        entry.compiled.runtimeArtifact,
        batch === 0 ? warmups : 0,
        chunkSize
      );
      samples.get(entry.language.id).push(...batchSamples.slice(0, measured));
    }
  }
  return samples;
}

function languageDefinitions(tools, nativeCompiler, requestedLanguages = null) {
  const nativeRuntimeBatch = nativeCompiler.processTimer
    ? (output, warmups, runs) => nativeProcessSamples(
        nativeCompiler.processTimer, output, warmups, runs)
    : null;
  const nativeEntryRuntimeBatch = (artifact, warmups, runs) => {
    const code = typeof artifact === 'string' ? artifact : artifact.code;
    const data = typeof artifact === 'string' ? null : artifact.data;
    const result = runCommand(nativeCompiler.entryTimer, [
      code,
      ...(data ? [data] : []),
      String(warmups),
      String(runs)
    ]);
    const payload = JSON.parse(result.stdout);
    if (!Array.isArray(payload.samples_ms) || payload.samples_ms.length !== runs) {
      throw new Error(`native entry timer returned ${payload.samples_ms?.length ?? 0} samples; expected ${runs}`);
    }
    return {
      samples: payload.samples_ms.map(Number),
      value: Number(payload.result)
    };
  };
  const enabled = (language) => requestedLanguages === null || requestedLanguages.has(language);
  const definitions = [
    Object.freeze({
      id: 'vkf',
      extension: 'vkf',
      version: `Vektor Flow 0.1.0 native compiler; ${toolVersion(tools.cpp)}`,
      compileModel: `persistent Python-free integrated frontend + compiler-owned direct ${process.arch} artifact`,
      freshSourcePerCompile: true,
      compileBatch(sources, manifestPath) {
        writeFileSync(manifestPath, `${sources.join('\n')}\n`, 'utf8');
        const result = runCommand(nativeCompiler.driver, ['--batch-sources', manifestPath]);
        return parseBatchCompileSummaries(result.stdout, sources.length).map((summary) => ({
          elapsedMs: Number(summary.batch_ms),
          runtimeArtifact: summary.artifact_path,
          artifactFallback: Boolean(summary.artifact_fallback),
          artifactFallbackReason: summary.artifact_fallback_reason || ''
        }));
      },
      compile(source) {
        const result = runCommand(nativeCompiler.driver, [
          '--aot',
          '--source', source
        ]);
        const summary = JSON.parse(result.stdout);
        return {
          ...result,
          runtimeArtifact: summary.artifact_path,
          artifactFallback: Boolean(summary.artifact_fallback),
          artifactFallbackReason: summary.artifact_fallback_reason || ''
        };
      },
      runtime(output) {
        return runCommand(output, []);
      },
      runtimeBatch: nativeRuntimeBatch,
      prepareNativeRuntime(source) {
        const result = runCommand(nativeCompiler.driver, [
          '--aot',
          '--diagnostics',
          '--source', source
        ]);
        const summary = JSON.parse(result.stdout);
        const manifest = JSON.parse(readFileSync(summary.manifest_path, 'utf8'));
        return { code: manifest.code_path, data: manifest.data_path };
      },
      nativeRuntimeBatch: nativeEntryRuntimeBatch
    }),
  ];
  if (enabled('c')) definitions.push(Object.freeze({
      id: 'c',
      extension: 'c',
      version: toolVersion(tools.c),
      compileModel: 'Clang -O3 -march=native native link',
      compile(source, output) {
        return runCommand(tools.c.command, [
          '-O3', '-march=native', '-std=c17', source, '-o', output,
          ...(platform() === 'win32' ? [] : ['-lm'])
        ]);
      },
      runtime(output) {
        return runCommand(output, []);
      },
      runtimeBatch: nativeRuntimeBatch
    }));
  if (enabled('cpp')) definitions.push(Object.freeze({
      id: 'cpp',
      extension: 'cpp',
      version: toolVersion(tools.cpp),
      compileModel: 'Clang++ -O3 -march=native native link',
      compile(source, output) {
        return runCommand(tools.cpp.command, [
          '-O3', '-march=native', '-std=c++17', source, '-o', output,
          ...(platform() === 'win32' ? [] : ['-lm'])
        ]);
      },
      runtime(output) {
        return runCommand(output, []);
      },
      runtimeBatch: nativeRuntimeBatch
    }));
  if (enabled('python-efficient')) {
    const pythonRuntime = (source) => runCommand(
      tools.python.command,
      [...tools.python.prefix, source],
      { env: { PYTHONDONTWRITEBYTECODE: '1' } }
    );
    const pythonCompile = (source, output) => runCommand(tools.python.command, [
      ...tools.python.prefix,
      '-c',
      'import py_compile,sys;py_compile.compile(sys.argv[1],cfile=sys.argv[2],doraise=True)',
      source,
      output
    ], { env: { PYTHONDONTWRITEBYTECODE: '1' } });
    const pythonVersion = toolVersion(tools.python);
    const packageVersions = runCommand(tools.python.command, [
      ...tools.python.prefix,
      '-c',
      "import numpy,scipy;print(f'NumPy {numpy.__version__}; SciPy {scipy.__version__}')"
    ]).stdout.trim();
    definitions.push(Object.freeze({
      id: 'python-efficient',
      extension: null,
      version: `${pythonVersion}; ${packageVersions}`,
      compileModel: 'CPython bytecode compile',
      compile: pythonCompile,
      runtime(_output, source) {
        return pythonRuntime(source);
      }
    }));
  }
  if (enabled('rust')) definitions.push(Object.freeze({
      id: 'rust',
      extension: 'rs',
      version: toolVersion(tools.rust),
      compileModel: 'rustc -O -C target-cpu=native native link',
      compile(source, output) {
        return runCommand(tools.rust.command, ['-O', '-C', 'target-cpu=native', source, '-o', output]);
      },
      runtime(output) {
        return runCommand(output, []);
      },
      runtimeBatch: nativeRuntimeBatch
    }));
  return Object.freeze(definitions);
}

function parseNumericOutput(stdout, languageId, caseId) {
  const tokens = String(stdout).trim().split(/\s+/);
  const value = Number(tokens.at(-1));
  if (!Number.isFinite(value)) {
    throw new Error(`${languageId}/${caseId} did not print one finite numeric result: ${stdout}`);
  }
  return value;
}

function materializeSource(language, benchmarkCase, caseWork) {
  let extension = language.extension;
  if (language.id === 'python-efficient') {
    extension = benchmarkCase.pythonExtension || 'scipy.py';
  }
  let template = sourcePath(benchmarkCase.template, extension);
  if (language.id === 'cpp' && !existsSync(template)) {
    template = sourcePath(benchmarkCase.template, 'c');
  }
  let text = readFileSync(template, 'utf8');
  if (benchmarkCase.count !== undefined) {
    text = text.replaceAll('{{COUNT}}', String(benchmarkCase.count));
    text = text.replaceAll(
      '{{VALUES}}',
      Array.from(
        { length: benchmarkCase.count },
        (_, index) => benchmarkCase.explicitF64Values ? `${index + 1}.0` : String(index + 1)
      ).join(', ')
    );
    text = text.replaceAll(
      '{{VALIDATION_VALUES}}',
      Array.from(
        { length: benchmarkCase.count },
        (_, index) => (index + 1) % 97 === 0 ? `${index + 1}.5` : `${index + 1}.0`
      ).join(', ')
    );
  }
  const sources = resolve(caseWork, 'sources');
  mkdirSync(sources, { recursive: true });
  const source = resolve(sources, `${language.id}.${extension}`);
  writeFileSync(source, text, 'utf8');
  return source;
}

function compileLanguageCase(language, benchmarkCase, options, caseWork) {
  const source = materializeSource(language, benchmarkCase, caseWork);
  const samples = [];
  let runtimeArtifact = null;
  let artifactFallback = false;
  let artifactFallbackReason = '';
  const total = options.compileWarmups + options.compileRuns;
  const compileSources = [];
  for (let index = 0; index < total; index += 1) {
    if (!language.freshSourcePerCompile) {
      compileSources.push(source);
      continue;
    }
    const freshRoot = resolve(caseWork, 'fresh-sources', String(index));
    mkdirSync(freshRoot, { recursive: true });
    const freshSource = resolve(freshRoot, `program-${index}.${language.extension}`);
    writeFileSync(freshSource, readFileSync(source));
    compileSources.push(freshSource);
  }
  const batchResults = language.compileBatch
    ? language.compileBatch(compileSources, resolve(caseWork, `${language.id}-batch-sources.txt`))
    : null;
  for (let index = 0; index < total; index += 1) {
    const suffix = language.id === 'python-efficient' ? '.pyc' : executableExtension;
    const output = resolve(caseWork, `${language.id}-compile-${index}${suffix}`);
    const result = batchResults ? batchResults[index] : language.compile(compileSources[index], output);
    if (language.id === 'vkf' && benchmarkCase.requiresDirectVkf && result.artifactFallback) {
      throw new Error(`${benchmarkCase.id} requires direct VKF machine code: ${result.artifactFallbackReason}`);
    }
    if (index >= options.compileWarmups) samples.push(result.elapsedMs);
    runtimeArtifact = result.runtimeArtifact || output;
    artifactFallback = result.artifactFallback || false;
    artifactFallbackReason = result.artifactFallbackReason || '';
  }
  const nativeRuntimeArtifact = language.prepareNativeRuntime
    ? language.prepareNativeRuntime(source)
    : null;
  return {
    source,
    runtimeArtifact,
    nativeRuntimeArtifact,
    nativeCodeSha256: nativeRuntimeArtifact
      ? fileSha256(typeof nativeRuntimeArtifact === 'string'
          ? nativeRuntimeArtifact
          : nativeRuntimeArtifact.code)
      : null,
    samples,
    artifactFallback,
    artifactFallbackReason
  };
}

function runLanguageCase(language, benchmarkCase, compiled, options) {
  if (language.runtimeBatch) {
    const validation = language.runtime(compiled.runtimeArtifact, compiled.source);
    const value = parseNumericOutput(validation.stdout, language.id, benchmarkCase.id);
    const samples = language.runtimeBatch(
      compiled.runtimeArtifact,
      options.warmups,
      options.runs
    );
    return { samples, value };
  }
  const samples = [];
  const values = [];
  const total = options.warmups + options.runs;
  for (let index = 0; index < total; index += 1) {
    const result = language.runtime(compiled.runtimeArtifact, compiled.source);
    const value = parseNumericOutput(result.stdout, language.id, benchmarkCase.id);
    if (index >= options.warmups) {
      samples.push(result.elapsedMs);
      values.push(value);
    }
  }
  if (!values.every((value) => valuesAgree(value, values[0], benchmarkCase.tolerance))) {
    throw new Error(`${language.id}/${benchmarkCase.id} produced unstable results`);
  }
  return { samples, value: values[0] };
}

function assertCrossLanguageParity(caseId, tolerance, results) {
  if (results.length < 2) return;
  const reference = results.find(({ language }) => language === 'python-efficient')?.value
    ?? results[0].value;
  for (const result of results) {
    if (!valuesAgree(reference, result.value, tolerance)) {
      throw new Error(`${caseId} mismatch: python-efficient=${reference}, ${result.language}=${result.value}`);
    }
  }
}

function cleanWorkRoot() {
  const repositoryWorkRoot = resolve(benchmarkRoot, '.work');
  const temporaryWorkRoot = resolve(tmpdir(), 'vektor-flow-core-comparison');
  const expectedRepositoryRoot = workRoot === repositoryWorkRoot
    && dirname(workRoot) === resolve(benchmarkRoot);
  const expectedWindowsTemporaryRoot = platform() === 'win32'
    && workRoot === temporaryWorkRoot
    && dirname(workRoot) === resolve(tmpdir());
  if (!expectedRepositoryRoot && !expectedWindowsTemporaryRoot) {
    throw new Error(`refusing to clean unexpected work path: ${workRoot}`);
  }
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
}

function formatMs(value) {
  return value.toFixed(3);
}

function meanStd(stats) {
  return `${formatMs(stats.meanMs)} ± ${formatMs(stats.stddevMs)}`;
}

function markdownTable(payload, metric) {
  const allLanguages = ['vkf', 'c', 'cpp', 'python-efficient', 'rust'];
  const languages = allLanguages.filter((language) => payload.results.some((result) => result.language === language));
  const labels = { vkf: 'VKF', c: 'C', cpp: 'C++', 'python-efficient': 'Python efficient', rust: 'Rust' };
  const title = metric === 'compile' ? 'Compile time (ms)' : 'Runtime (ms)';
  const lines = [
    `## ${title}`,
    '',
    `| operation | data | size | count | ${languages.map((language) => labels[language]).join(' | ')} |`,
    `| --- | --- | --- | ---: | ${languages.map(() => '---:').join(' | ')} |`
  ];
  for (const benchmarkCase of payload.cases) {
    const byLanguage = new Map(payload.results
      .filter((result) => result.case === benchmarkCase.id)
      .map((result) => [result.language, result]));
    lines.push([
      benchmarkCase.operation,
      benchmarkCase.data,
      benchmarkCase.size,
      benchmarkCase.count ?? 0,
      ...languages.map((language) => meanStd(byLanguage.get(language)[metric]))
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  return lines.join('\n');
}

function createReport(payload) {
  const nativeRuntimeResults = payload.results.filter((result) => result.nativeRuntime);
  const nativeRuntimeTable = nativeRuntimeResults.length === 0 ? [] : [
    '',
    '## VKF raw machine-entry runtime (ms)',
    '',
    '| operation | data | size | count | VKF |',
    '| --- | --- | --- | ---: | ---: |',
    ...nativeRuntimeResults.map((result) =>
      `| ${result.operation} | ${result.data} | ${result.size} | ${result.count} | ${meanStd(result.nativeRuntime)} |`
    )
  ];
  return [
    '# Core language benchmark',
    '',
    `${payload.options.compileRuns} compile runs and ${payload.options.runs} runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: ${payload.options.compileWarmups}. Runtime warmups: ${payload.options.warmups}.`,
    '',
    markdownTable(payload, 'compile'),
    '',
    markdownTable(payload, 'runtime'),
    ...nativeRuntimeTable,
    ''
  ].join('\n');
}

const VKF_ACCEPTANCE_BUDGETS = new Map([
  ['scalar-control-small', { compileMeanMs: 10, nativeRuntimeMeanMs: 0.5 }]
]);

export function assertVkfAcceptanceBudgets(results) {
  const failures = [];
  for (const result of results) {
    if (result.language !== 'vkf' || result.compile?.count < 100 ||
        result.nativeRuntime?.count < 100) continue;
    const budget = VKF_ACCEPTANCE_BUDGETS.get(result.case);
    if (!budget) continue;
    if (result.compile.meanMs >= budget.compileMeanMs) {
      failures.push(
        `${result.case} compile ${result.compile.meanMs.toFixed(6)} ms must be under ` +
        `${budget.compileMeanMs.toFixed(3)} ms`
      );
    }
    if (result.nativeRuntime.meanMs >= budget.nativeRuntimeMeanMs) {
      failures.push(
        `${result.case} raw runtime ${result.nativeRuntime.meanMs.toFixed(6)} ms must be under ` +
        `${budget.nativeRuntimeMeanMs.toFixed(3)} ms`
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`VKF acceptance budget exceeded: ${failures.join('; ')}`);
  }
}

function printReport(payload, report, resultsPath, reportPath) {
  console.log(`Core comparison: compile ${payload.options.compileRuns} measured runs; runtime ${payload.options.runs} measured runs`);
  console.log(report);
  console.log(`JSON: ${relative(repoRoot, resultsPath)}`);
  console.log(`Table: ${relative(repoRoot, reportPath)}`);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const resultsPath = resolve(resultsRoot, `${options.outputStem}.json`);
  const reportPath = resolve(resultsRoot, `${options.outputStem}.md`);
  const requestedCases = options.caseId === null
    ? null
    : new Set(options.caseId.split(',').filter(Boolean));
  const selectedCases = requestedCases === null
    ? cases
    : cases.filter((benchmarkCase) => requestedCases.has(benchmarkCase.id));
  if (selectedCases.length === 0) throw new Error(`unknown benchmark case: ${options.caseId}`);
  const requestedLanguages = options.languageId === null
    ? null
    : new Set(options.languageId.split(',').filter(Boolean));
  const supportedLanguages = new Set(['vkf', 'c', 'cpp', 'python-efficient', 'rust']);
  if (requestedLanguages) {
    for (const languageId of requestedLanguages) {
      if (!supportedLanguages.has(languageId)) {
        throw new Error(`unknown benchmark language: ${languageId}`);
      }
    }
  }
  const python = requestedLanguages === null || requestedLanguages.has('python-efficient')
    ? firstTool([
    {
      command: 'py',
      prefix: ['-3.13'],
      versionArgs: ['-3.13', '--version'],
      probeArgs: ['-3.13', '-c', 'import numpy,scipy']
    },
    {
      command: 'py',
      prefix: ['-3'],
      versionArgs: ['-3', '--version'],
      probeArgs: ['-3', '-c', 'import numpy,scipy']
    },
    {
      command: 'python',
      prefix: [],
      versionArgs: ['--version'],
      probeArgs: ['-c', 'import numpy,scipy']
    },
    {
      command: 'python3',
      prefix: [],
      versionArgs: ['--version'],
      probeArgs: ['-c', 'import numpy,scipy']
    }
      ], 'Python')
    : null;
  const tools = Object.freeze({
    python,
    c: firstTool([
      { command: 'clang', versionArgs: ['--version'] },
      { command: 'gcc', versionArgs: ['--version'] },
      { command: 'cc', versionArgs: ['--version'] }
    ], 'C compiler'),
    cpp: firstTool([
      { command: 'clang++', versionArgs: ['--version'] },
      { command: 'g++', versionArgs: ['--version'] }
    ], 'C++ compiler'),
    rust: requestedLanguages === null || requestedLanguages.has('rust')
      ? firstTool([{ command: 'rustc', versionArgs: ['--version'] }], 'Rust compiler')
      : null
  });
  cleanWorkRoot();
  const nativeCompiler = buildNativeCompilerTools(tools);
  const languages = languageDefinitions(tools, nativeCompiler, requestedLanguages);
  const languageById = new Map(languages.map((language) => [language.id, language]));
  const results = [];
  for (const benchmarkCase of selectedCases) {
    const caseWork = resolve(workRoot, benchmarkCase.id);
    mkdirSync(caseWork, { recursive: true });
    const caseResults = [];
    const prepared = [];
    for (const languageId of benchmarkCase.languages) {
      if (requestedLanguages && !requestedLanguages.has(languageId)) continue;
      const language = languageById.get(languageId);
      if (!language) throw new Error(`unknown language lane: ${languageId}`);
      const compiled = compileLanguageCase(language, benchmarkCase, options, caseWork);
      prepared.push({ language, compiled });
    }
    const nativePrepared = nativeCompiler.processTimer
      ? prepared.filter(({ language }) => Boolean(language.runtimeBatch))
      : [];
    const interleavedSamples = nativePrepared.length > 1
      ? interleavedNativeProcessSamples(
          nativeCompiler.processTimer,
          nativePrepared,
          options.warmups,
          options.runs
        )
      : new Map();
    for (const { language, compiled } of prepared) {
      let runtime;
      const samples = interleavedSamples.get(language.id);
      if (samples) {
        const validation = language.runtime(compiled.runtimeArtifact, compiled.source);
        runtime = {
          samples,
          value: parseNumericOutput(validation.stdout, language.id, benchmarkCase.id)
        };
      } else {
        runtime = runLanguageCase(language, benchmarkCase, compiled, options);
      }
      const nativeRuntime = compiled.nativeRuntimeArtifact && language.nativeRuntimeBatch
        ? language.nativeRuntimeBatch(
            compiled.nativeRuntimeArtifact,
            options.warmups,
            options.runs
          )
        : null;
      if (nativeRuntime && !valuesAgree(
        nativeRuntime.value, runtime.value, benchmarkCase.tolerance
      )) {
        throw new Error(
          `${benchmarkCase.id} raw VKF result mismatch: executable=${runtime.value}, entry=${nativeRuntime.value}`
        );
      }
      const result = Object.freeze({
        case: benchmarkCase.id,
        operation: benchmarkCase.operation,
        data: benchmarkCase.data,
        size: benchmarkCase.size,
        count: benchmarkCase.count ?? 0,
        language: language.id,
        version: language.version,
        compileModel: language.compileModel,
        artifactFallback: compiled.artifactFallback,
        artifactFallbackReason: compiled.artifactFallbackReason,
        source: sourceSize(compiled.source),
        compile: seriesStats(compiled.samples),
        runtime: seriesStats(runtime.samples),
        nativeRuntime: nativeRuntime ? seriesStats(nativeRuntime.samples) : null,
        nativeCodeSha256: compiled.nativeCodeSha256,
        value: runtime.value
      });
      caseResults.push(result);
      results.push(result);
    }
    assertCrossLanguageParity(benchmarkCase.id, benchmarkCase.tolerance, caseResults);
  }
  const startupMeans = new Map(
    results
      .filter((result) => result.case === 'startup')
      .map((result) => [result.language, result.runtime.meanMs])
  );
  const normalizedResults = results.map((result) => Object.freeze({
    ...result,
    runtime: Object.freeze({
      ...result.runtime,
      startupAdjustedMeanMs: Number(Math.max(
        0,
        result.runtime.meanMs - (startupMeans.get(result.language) || 0)
      ).toFixed(6))
    })
  }));
  const payload = Object.freeze({
    schema: 'vektor-flow/core-language-comparison-v1',
    generatedAt: new Date().toISOString(),
    environment: Object.freeze({
      platform: `${platform()} ${release()}`,
      architecture: process.arch,
      cpu: cpus()[0]?.model || 'unknown',
      logicalCpuCount: cpus().length,
      node: process.version
    }),
    cases: selectedCases,
    options,
    results: normalizedResults
  });
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const report = createReport(payload);
  writeFileSync(reportPath, report, 'utf8');
  printReport(payload, report, resultsPath, reportPath);
  assertVkfAcceptanceBudgets(normalizedResults);
  return payload;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
