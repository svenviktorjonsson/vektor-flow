import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const suffix = process.platform === 'win32' ? '.exe' : '';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function sourceFor(maxCores, iterationsPerLane) {
  const source = [`process.max_cores: ${maxCores}`];
  for (let lane = 0; lane < 4; ++lane) {
    source.push(
      `lane_${lane}() -> int:`,
      '    i: 0',
      `    value: ${lane + 1}`,
      `    i < ${iterationsPerLane}?>`,
      '        .value: value + 1',
      '        .i: i + 1',
      '    @: value',
    );
  }
  for (let lane = 0; lane < 4; ++lane) source.push(`result_${lane}: lane_${lane}()`);
  for (let lane = 0; lane < 4; ++lane) source.push(`:: result_${lane}`);
  return `${source.join('\n')}\n`;
}

function expectedOutput(iterationsPerLane) {
  return Array.from(
    { length: 4 },
    (_, lane) => String(iterationsPerLane + lane + 1),
  );
}

function outputOf(result) {
  return String(result.stdout ?? '').trim().split(/\r?\n/u);
}

function compileWorkload({ compiler, workRoot, maxCores, iterationsPerLane, stem }) {
  const directory = join(workRoot, stem);
  mkdirSync(directory, { recursive: true });
  const source = join(directory, `${stem}.vkf`);
  const artifact = join(directory, `${stem}${suffix}`);
  writeFileSync(source, sourceFor(maxCores, iterationsPerLane), 'utf8');
  run(compiler, ['-b', source, '-o', artifact, '--diagnostics']);
  const manifest = JSON.parse(readFileSync(
    join(directory, '.vkfbuild', stem, 'x64-manifest.json'),
    'utf8',
  ));
  const entry = manifest.adaptive_optimizer.functions.find(({ name }) => name === '$entry');
  if (!entry) throw new Error(`${stem} optimizer manifest omitted the entry function`);
  return {
    artifact,
    cwd: directory,
    groupSelected: entry.strategies.includes('automatic-cpu-group-selected'),
  };
}

function timedArtifact(workload, expected) {
  const started = process.hrtime.bigint();
  const executed = run(workload.artifact, [], { cwd: workload.cwd });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const output = outputOf(executed);
  if (JSON.stringify(output) !== JSON.stringify(expected)) {
    throw new Error(
      `incorrect ${workload.artifact} output: ${JSON.stringify(output)} ` +
        `!= ${JSON.stringify(expected)}`,
    );
  }
  return { elapsedMs, output };
}

export function summarizeSamples(samplesMs) {
  if (!Array.isArray(samplesMs) || samplesMs.length === 0 ||
      samplesMs.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('timing samples must be a non-empty array of positive finite milliseconds');
  }
  const sorted = [...samplesMs].sort((left, right) => left - right);
  const meanMs = samplesMs.reduce((total, value) => total + value, 0) / samplesMs.length;
  const sampleVariance = samplesMs.length === 1
    ? 0
    : samplesMs.reduce((total, value) => total + (value - meanMs) ** 2, 0) /
      (samplesMs.length - 1);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    samplesMs: [...samplesMs],
    meanMs,
    sampleStddevMs: Math.sqrt(sampleVariance),
    medianMs,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
  };
}

export function runAutomaticCpuBenchmark({
  compiler,
  workRoot,
  samples = 7,
  iterationsPerLane = 250_000_000,
}) {
  if (!compiler || !existsSync(compiler)) throw new Error('compiler does not exist');
  if (!Number.isSafeInteger(samples) || samples < 5) {
    throw new Error('samples must be an integer of at least 5');
  }
  if (!Number.isSafeInteger(iterationsPerLane) || iterationsPerLane < 10_000_000) {
    throw new Error('iterationsPerLane must be a large positive integer');
  }
  mkdirSync(workRoot, { recursive: true });
  const expected = expectedOutput(iterationsPerLane);
  const oneCore = compileWorkload({
    compiler,
    workRoot,
    maxCores: 1,
    iterationsPerLane,
    stem: 'one-core',
  });
  const fourCore = compileWorkload({
    compiler,
    workRoot,
    maxCores: 4,
    iterationsPerLane,
    stem: 'four-core',
  });

  const oneWarmup = timedArtifact(oneCore, expected);
  const fourWarmup = timedArtifact(fourCore, expected);
  const samplesByCore = { one: [], four: [] };
  let oneOutput = oneWarmup.output;
  let fourOutput = fourWarmup.output;
  for (let index = 0; index < samples; ++index) {
    const order = index % 2 === 0
      ? [['one', oneCore], ['four', fourCore]]
      : [['four', fourCore], ['one', oneCore]];
    for (const [name, workload] of order) {
      const measured = timedArtifact(workload, expected);
      samplesByCore[name].push(measured.elapsedMs);
      if (name === 'one') oneOutput = measured.output;
      else fourOutput = measured.output;
    }
  }

  const oneSummary = summarizeSamples(samplesByCore.one);
  const fourSummary = summarizeSamples(samplesByCore.four);
  const equalOutputs = JSON.stringify(oneOutput) === JSON.stringify(fourOutput) &&
    JSON.stringify(oneOutput) === JSON.stringify(expected);
  return {
    schemaVersion: 1,
    workload: 'four-independent-integer-recurrences',
    iterationsPerLane,
    sampleCount: samples,
    compilerSha256: createHash('sha256').update(readFileSync(compiler)).digest('hex'),
    correctness: { equalOutputs },
    oneCore: {
      configuredCores: 1,
      groupSelected: oneCore.groupSelected,
      output: oneOutput,
      ...oneSummary,
    },
    fourCore: {
      configuredCores: 4,
      groupSelected: fourCore.groupSelected,
      output: fourOutput,
      ...fourSummary,
    },
    speedup: {
      median: oneSummary.medianMs / fourSummary.medianMs,
      p95: oneSummary.p95Ms / fourSummary.p95Ms,
    },
  };
}

function parseCli(args) {
  const options = {};
  for (let index = 0; index < args.length; ++index) {
    const name = args[index];
    const value = args[++index];
    if (value === undefined) throw new Error(`missing value for ${name}`);
    if (name === '--compiler') options.compiler = resolve(value);
    else if (name === '--work-root') options.workRoot = resolve(value);
    else if (name === '--output') options.output = resolve(value);
    else if (name === '--samples') options.samples = Number(value);
    else if (name === '--iterations') options.iterationsPerLane = Number(value);
    else throw new Error(`unknown argument ${name}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCli(process.argv.slice(2));
  let removeWorkRoot = false;
  if (!options.workRoot) {
    options.workRoot = mkdtempSync(join(tmpdir(), 'vkf-automatic-flow-cpu-'));
    removeWorkRoot = true;
  }
  try {
    const result = runAutomaticCpuBenchmark(options);
    const rendered = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) {
      mkdirSync(dirname(options.output), { recursive: true });
      writeFileSync(options.output, rendered, 'utf8');
    } else {
      process.stdout.write(rendered);
    }
  } finally {
    if (removeWorkRoot) {
      rmSync(options.workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }
}
