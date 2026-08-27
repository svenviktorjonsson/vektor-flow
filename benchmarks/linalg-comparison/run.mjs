import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchmarkRoot, '..', '..');

export const kernels = Object.freeze({
  'solve-general-96': {
    fixture: 'general-96',
    limits: { residual: 3e-12, solution_error: 3e-11 },
  },
  'least-squares-tall-96x48': {
    fixture: 'tall-96x48',
    limits: { residual: 3e-11, solution_error: 3e-10 },
  },
  'lu-general-96': {
    fixture: 'general-96',
    limits: { reconstruction: 3e-11 },
  },
  'qr-tall-96x48': {
    fixture: 'tall-96x48',
    limits: { reconstruction: 3e-11, orthogonality: 3e-11 },
  },
  'cholesky-spd-96': {
    fixture: 'spd-96',
    limits: { reconstruction: 3e-11 },
  },
  'svd-tall-96x48': {
    fixture: 'tall-96x48',
    limits: { reconstruction: 6e-11, orthogonality: 6e-11 },
  },
  'eigen-symmetric-96': {
    fixture: 'spd-96',
    limits: { residual: 6e-11, reconstruction: 6e-11, orthogonality: 6e-11 },
  },
});

export function parseRunnerOutput(stdout) {
  const fields = {};
  for (const line of String(stdout).trim().split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  const elapsedMs = Number(fields.elapsed_ms);
  const checksum = Number(fields.checksum);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(checksum)) {
    throw new Error(`invalid linalg runner output: ${JSON.stringify(String(stdout))}`);
  }
  const metrics = {};
  for (const name of ['residual', 'reconstruction', 'orthogonality', 'solution_error']) {
    if (fields[name] !== undefined) metrics[name] = Number(fields[name]);
  }
  return { elapsedMs, checksum, metrics, fields };
}

export function validateSample(sample, limits) {
  for (const [name, limit] of Object.entries(limits)) {
    const value = sample.metrics[name];
    if (!Number.isFinite(value)) throw new Error(`missing or non-finite ${name}`);
    if (value > limit) throw new Error(`${name} ${value} exceeds ${limit}`);
  }
  return true;
}

export function seriesStats(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('empty sample series');
  const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.length > 1
    ? samples.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) / (samples.length - 1)
    : 0;
  return { count: samples.length, meanMs, stddevMs: Math.sqrt(variance) };
}

export function rotateEntries(entries, offset) {
  const start = ((offset % entries.length) + entries.length) % entries.length;
  return [...entries.slice(start), ...entries.slice(0, start)];
}

export function comparison(vkfMeanMs, competitorMeanMs) {
  return { ratio: vkfMeanMs / competitorMeanMs };
}

function parseArguments(argv) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith('--') || !argument.includes('=')) {
      throw new Error(`expected --name=value, received ${argument}`);
    }
    const [name, ...rest] = argument.slice(2).split('=');
    values.set(name, rest.join('='));
  }
  const list = (name, fallback) => (values.get(name) ?? fallback).split(',').filter(Boolean);
  const integer = (name, fallback) => {
    const value = Number(values.get(name) ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be positive`);
    return value;
  };
  const selectedKernels = list('kernels', Object.keys(kernels).join(','));
  const languages = list('languages', 'vkf,eigen,faer,scipy');
  for (const kernel of selectedKernels) if (!kernels[kernel]) throw new Error(`unknown kernel ${kernel}`);
  for (const language of languages) {
    if (!['vkf', 'eigen', 'faer', 'scipy'].includes(language)) throw new Error(`unknown language ${language}`);
  }
  return {
    kernels: selectedKernels,
    languages,
    runs: integer('runs', 10),
    timeoutMs: integer('timeout-ms', 30000),
    threads: integer('threads', 1),
    vkfRunner: values.get('vkf-runner') ? resolve(values.get('vkf-runner')) : undefined,
    vkfManifest: values.get('vkf-manifest') ? resolve(values.get('vkf-manifest')) : undefined,
    eigenRunner: values.get('eigen') ? resolve(values.get('eigen')) : undefined,
    faerRunner: values.get('faer') ? resolve(values.get('faer')) : undefined,
    python: values.get('python') ?? (platform() === 'win32' ? 'python' : 'python3'),
    fixtureRoot: resolve(values.get('fixtures') ?? join(benchmarkRoot, 'fixtures')),
    output: resolve(values.get('output') ?? join(
      benchmarkRoot, 'results', `${platform()}-${arch()}-development.json`,
    )),
  };
}

function execute(command, args, { timeoutMs, env }) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? detail}`);
  }
  return result.stdout;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function entries(options) {
  const vkfManifest = options.vkfManifest
    ? JSON.parse(readFileSync(options.vkfManifest, 'utf8'))
    : undefined;
  const commands = {
    vkf: vkfManifest
      ? ((kernel, hash) => {
        const runner = vkfManifest.runners?.[kernel];
        if (!runner) throw new Error(`VKF manifest has no runner for ${kernel}`);
        if (runner.fixtureSha256 !== hash) {
          throw new Error(`${kernel} VKF runner fixture ${runner.fixtureSha256}; expected ${hash}`);
        }
        if (sha256(runner.executable) !== runner.executableSha256) {
          throw new Error(`${kernel} VKF runner executable hash changed`);
        }
        return [runner.executable, []];
      })
      : options.vkfRunner && ((kernel, hash) => [options.vkfRunner, [kernel, options.fixtureRoot, hash]]),
    eigen: options.eigenRunner && ((kernel, hash) => [options.eigenRunner, [kernel, options.fixtureRoot, hash]]),
    faer: options.faerRunner && ((kernel, hash) => [options.faerRunner, [kernel, options.fixtureRoot, hash]]),
    scipy: (kernel, hash) => [options.python, [
      join(benchmarkRoot, 'competitors', 'scipy_runner.py'), kernel, options.fixtureRoot, hash,
    ]],
  };
  return options.languages.map((id) => {
    if (!commands[id]) throw new Error(`runner path required for ${id}`);
    return { id, command: commands[id] };
  });
}

function threadEnvironment(threads) {
  const value = String(threads);
  return {
    OMP_NUM_THREADS: value,
    OPENBLAS_NUM_THREADS: value,
    MKL_NUM_THREADS: value,
    BLIS_NUM_THREADS: value,
    VECLIB_MAXIMUM_THREADS: value,
    NUMEXPR_NUM_THREADS: value,
    VKF_LINALG_THREADS: value,
  };
}

function runKernel(id, languageEntries, options, manifest, kernelIndex) {
  const spec = kernels[id];
  const expectedHash = manifest.fixtures[spec.fixture].sha256;
  const samples = Object.fromEntries(languageEntries.map((entry) => [entry.id, []]));
  const validation = Object.fromEntries(languageEntries.map((entry) => [entry.id, {}]));
  const metadata = Object.fromEntries(languageEntries.map((entry) => [entry.id, {}]));
  for (let round = 0; round < options.runs; round += 1) {
    for (const entry of rotateEntries(languageEntries, round + kernelIndex)) {
      const [command, args] = entry.command(id, expectedHash);
      const parsed = parseRunnerOutput(execute(command, args, {
        timeoutMs: options.timeoutMs,
        env: threadEnvironment(options.threads),
      }));
      validateSample(parsed, spec.limits);
      if (parsed.fields.input_sha256 !== expectedHash) {
        throw new Error(`${id}/${entry.id} used fixture ${parsed.fields.input_sha256}; expected ${expectedHash}`);
      }
      samples[entry.id].push(parsed.elapsedMs);
      for (const field of ['implementation', 'backend', 'algorithm']) {
        if (parsed.fields[field] !== undefined) {
          if (metadata[entry.id][field] && metadata[entry.id][field] !== parsed.fields[field]) {
            throw new Error(`${id}/${entry.id} changed ${field} between samples`);
          }
          metadata[entry.id][field] = parsed.fields[field];
        }
      }
      for (const [metric, value] of Object.entries(parsed.metrics)) {
        validation[entry.id][metric] = Math.max(validation[entry.id][metric] ?? 0, value);
      }
    }
  }
  const languages = Object.fromEntries(languageEntries.map(({ id: language }) => [language, {
    samplesMs: samples[language],
    stats: seriesStats(samples[language]),
    validation: validation[language],
    metadata: metadata[language],
  }]));
  const comparisons = {};
  if (languages.vkf) {
    for (const language of Object.keys(languages)) {
      if (language !== 'vkf') comparisons[language] = comparison(
        languages.vkf.stats.meanMs, languages[language].stats.meanMs,
      );
    }
  }
  return { id, fixture: spec.fixture, limits: spec.limits, languages, comparisons, pass: true };
}

function markdown(report) {
  const competitors = report.conditions.languages.filter((id) => id !== 'vkf');
  const headings = competitors.map((id) => `VKF / ${id}`);
  const rows = report.kernels.map((kernel) => {
    const vkf = kernel.languages.vkf?.stats;
    const ratios = competitors.map((id) => kernel.comparisons[id]?.ratio.toFixed(3) ?? '—');
    return `| ${kernel.id} | ${vkf ? `${vkf.meanMs.toFixed(3)} ± ${vkf.stddevMs.toFixed(3)} ms` : '—'} | ${ratios.join(' | ')} |`;
  });
  return [
    '# VKF linear-algebra comparison evidence', '',
    `Host: \`${report.machine.cpu}\`, ${report.machine.platform}-${report.machine.architecture}  `,
    `Samples: ${report.conditions.runs}; threads: ${report.conditions.threads}`, '',
    `| Kernel | VKF mean ± std | ${headings.join(' | ')} |`,
    `| --- | ---: | ${headings.map(() => '---:').join(' | ')} |`,
    ...rows, '',
    'Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.', '',
  ].join('\n');
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifestPath = join(options.fixtureRoot, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const languageEntries = entries(options);
  const report = {
    schema: 'vkf.linalg-comparison',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision: execute('git', ['rev-parse', 'HEAD'], { timeoutMs: 30000, env: {} }).trim(),
    machine: {
      hostname: hostname(), platform: platform(), architecture: arch(), osRelease: release(),
      cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, memoryBytes: totalmem(),
    },
    conditions: {
      runs: options.runs,
      timeoutMs: options.timeoutMs,
      threads: options.threads,
      kernels: options.kernels,
      languages: options.languages,
      scheduling: 'rotating same-host process order',
      timer: 'factorization/solve only; fixture load, warmup, cloning, and validation excluded',
      vkfRunnerManifest: options.vkfManifest ? {
        path: options.vkfManifest,
        sha256: sha256(options.vkfManifest),
      } : undefined,
    },
    fixtures: Object.fromEntries(Object.entries(manifest.fixtures).map(([name, fixture]) => {
      const fileSha256 = sha256(join(options.fixtureRoot, fixture.file));
      if (fileSha256 !== fixture.sha256) {
        throw new Error(`${name} fixture hash ${fileSha256}; expected ${fixture.sha256}`);
      }
      return [name, { ...fixture, fileSha256 }];
    })),
    kernels: [],
  };
  for (let index = 0; index < options.kernels.length; index += 1) {
    const id = options.kernels[index];
    process.stderr.write(`benchmarking ${id}\n`);
    report.kernels.push(runKernel(id, languageEntries, options, manifest, index));
  }
  report.pass = true;
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(options.output.replace(/\.json$/i, '.md'), markdown(report));
  process.stdout.write(`${markdown(report)}\nJSON: ${options.output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
