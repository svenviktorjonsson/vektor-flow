import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');
const runnerPath = fileURLToPath(import.meta.url);
const packageVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const expectedOutput = 1.2742238666431718;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    compiler: path.join(root, 'build', 'native-policy-ninja', 'bin', process.platform === 'win32' ? 'vkf-strict.exe' : 'vkf-strict'),
    source: path.join(root, 'benchmarks', 'core-comparison', 'published', 'spectral-norm-medium', 'vkf.vkf'),
    runs: 200,
    output: path.join(root, 'benchmarks', 'policy-landscape', 'evidence', `${process.platform}-${process.arch}-v0.1.5`),
  };
  for (const argument of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match) fail(`unknown argument: ${argument}`);
    const [, name, value] = match;
    if (name === 'compiler' || name === 'source' || name === 'output') options[name] = path.resolve(value);
    else if (name === 'runs') options.runs = Number(value);
    else fail(`unknown argument: --${name}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 10_000) {
    fail('--runs must be an integer between 1 and 10000');
  }
  return options;
}

function run(command, args, timeout = 1_200_000) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${command} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function lastJsonLine(text) {
  for (const line of text.split(/\r?\n/).reverse()) {
    if (!line.trim().startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {}
  }
  fail('compiler did not emit a JSON summary');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fixed(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function generateSvg(report) {
  const values = [...report.candidates].sort((left, right) => right.meanMs - left.meanMs);
  const width = 1200;
  const height = 660;
  const margin = { left: 90, right: 36, top: 64, bottom: 78 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const extrema = values.flatMap((value) => [value.meanMs - value.stddevMs, value.meanMs + value.stddevMs]);
  const minimum = Math.max(0, Math.min(...extrema));
  const maximum = Math.max(...extrema);
  const padding = (maximum - minimum) * 0.05;
  const yMinimum = Math.max(0, minimum - padding);
  const yMaximum = maximum + padding;
  const x = (index) => margin.left + (index / (values.length - 1)) * plotWidth;
  const y = (value) => margin.top + ((yMaximum - value) / (yMaximum - yMinimum)) * plotHeight;
  const pathFor = (selector) => values.map((value, index) => `${index ? 'L' : 'M'}${fixed(x(index), 2)},${fixed(y(selector(value)), 2)}`).join(' ');
  const upper = pathFor((value) => value.meanMs + value.stddevMs);
  const lowerValues = [...values].reverse();
  const lower = lowerValues.map((value, reverseIndex) => {
    const index = values.length - reverseIndex - 1;
    return `L${fixed(x(index), 2)},${fixed(y(Math.max(0, value.meanMs - value.stddevMs)), 2)}`;
  }).join(' ');
  const selectedIndex = values.findIndex((value) => value.policy === report.summary.selectedPolicy);
  const defaultIndex = values.findIndex((value) => value.policy === 'mask-ff');
  const yTicks = Array.from({ length: 7 }, (_, index) => yMinimum + ((yMaximum - yMinimum) * index) / 6);
  const xTicks = [0, 63, 127, 191, 255];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="660" viewBox="0 0 1200 660" role="img" aria-labelledby="title description">
  <title id="title">VKF spectral-norm optimizer policy landscape</title>
  <desc id="description">Mean native execution time plus and minus one standard deviation for all 256 policies, sorted slowest to fastest.</desc>
  <style>
    :root { color-scheme: light dark; }
    .background { fill: #ffffff; }
    .text { fill: #172033; font: 16px system-ui, sans-serif; }
    .muted { fill: #586174; font: 14px system-ui, sans-serif; }
    .grid { stroke: #d8dde8; stroke-width: 1; }
    .frame { fill: none; stroke: #8c96aa; stroke-width: 1; }
    .band { fill: #3478d4; opacity: .15; }
    .mean { fill: none; stroke: #1261a8; stroke-width: 3; }
    .upper { fill: none; stroke: #d46b28; stroke-width: 1.5; }
    .lower { fill: none; stroke: #2f8f5b; stroke-width: 1.5; }
    .selected { fill: #9b4dcc; stroke: #172033; stroke-width: 1.5; }
    .default { fill: #d44444; stroke: #172033; stroke-width: 1.5; }
    @media (prefers-color-scheme: dark) {
      .background { fill: #0d1117; }
      .text { fill: #e6edf3; }
      .muted { fill: #a6b1c2; }
      .grid { stroke: #30363d; }
      .frame { stroke: #6e7681; }
      .mean { stroke: #58a6ff; }
      .upper { stroke: #f2a65a; }
      .lower { stroke: #56d18b; }
      .selected, .default { stroke: #e6edf3; }
    }
  </style>
  <rect class="background" width="1200" height="660"/>
  <text class="text" x="90" y="30" font-size="22" font-weight="600">VKF spectral-norm policy landscape</text>
  <text class="muted" x="90" y="52">256 policies · ${report.summary.uniqueBinaries} distinct binaries · ${report.conditions.runsPerDistinctBinary} timed runs per distinct binary · slowest → fastest</text>
  ${yTicks.map((tick) => `<line class="grid" x1="${margin.left}" y1="${fixed(y(tick), 2)}" x2="${width - margin.right}" y2="${fixed(y(tick), 2)}"/><text class="muted" x="${margin.left - 12}" y="${fixed(y(tick) + 5, 2)}" text-anchor="end">${fixed(tick, 0)}</text>`).join('\n  ')}
  ${xTicks.map((tick) => `<text class="muted" x="${fixed(x(tick), 2)}" y="${height - margin.bottom + 28}" text-anchor="${tick === 0 ? 'start' : tick === 255 ? 'end' : 'middle'}">${tick + 1}</text>`).join('\n  ')}
  <rect class="frame" x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}"/>
  <path class="band" d="${upper} ${lower} Z"/>
  <path class="upper" d="${upper}"/>
  <path class="lower" d="${pathFor((value) => Math.max(0, value.meanMs - value.stddevMs))}"/>
  <path class="mean" d="${pathFor((value) => value.meanMs)}"/>
  <circle class="default" cx="${fixed(x(defaultIndex), 2)}" cy="${fixed(y(values[defaultIndex].meanMs), 2)}" r="6"/>
  <circle class="selected" cx="${fixed(x(selectedIndex), 2)}" cy="${fixed(y(values[selectedIndex].meanMs), 2)}" r="7"/>
  <text class="muted" x="${margin.left + plotWidth / 2}" y="642" text-anchor="middle">Policy rank (slowest → fastest)</text>
  <text class="muted" x="22" y="${margin.top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 22 ${margin.top + plotHeight / 2})">Native execution time (ms)</text>
  <line class="mean" x1="765" y1="30" x2="800" y2="30"/><text class="muted" x="808" y="35">mean</text>
  <line class="upper" x1="870" y1="30" x2="905" y2="30"/><text class="muted" x="913" y="35">mean + std</text>
  <line class="lower" x1="1020" y1="30" x2="1055" y2="30"/><text class="muted" x="1063" y="35">mean − std</text>
  <text class="muted" x="${fixed(x(selectedIndex) - 8, 2)}" y="${fixed(y(values[selectedIndex].meanMs) - 14, 2)}" text-anchor="end">${escapeXml(report.summary.selectedPolicy)} ${fixed(report.summary.selectedMeanMs)} ms</text>
  <text class="muted" x="${fixed(x(defaultIndex) - 8, 2)}" y="${fixed(y(values[defaultIndex].meanMs) + 24, 2)}" text-anchor="end">mask-ff ${fixed(report.summary.defaultMeanMs)} ms</text>
</svg>
`;
}

function generateMarkdown(report, svgName, jsonName, sourceLink) {
  const s = report.summary;
  return `# VKF 0.1.5 Optimizer Policy Landscape

![Sorted optimizer policy landscape](./${svgName})

This experiment compiles the exact [spectral-norm medium VKF program](${sourceLink}) under every combination of eight legal optimizer switches. It checks every candidate against the scalar policy, deduplicates byte-identical machine code, and times each distinct binary ${report.conditions.runsPerDistinctBinary} times in interleaved rounds.

| Result | Value |
| --- | ---: |
| Correct policies | ${s.correctPolicies} / ${s.policyCount} |
| Distinct machine-code binaries | ${s.uniqueBinaries} |
| Actual executions | ${s.totalRuns} |
| Search time | ${fixed(s.elapsedMs, 1)} ms |
| Slowest policy mean | ${fixed(s.maximumMeanMs)} ms |
| Fastest measured policy | \`${s.selectedPolicy}\` |
| Fastest measured mean | ${fixed(s.selectedMeanMs)} ± ${fixed(s.selectedStddevMs)} ms |
| Default \`mask-ff\` mean | ${fixed(s.defaultMeanMs)} ± ${fixed(s.defaultStddevMs)} ms |
| Fastest/slowest spread | ${fixed(s.maximumMeanMs / s.minimumMeanMs, 2)}× |
| Selected/default difference | ${fixed(s.selectedGainPercent, 1)}% |

The complete machine-readable evidence, including all 256 policy records, hashes, output, compiler identity, and host conditions, is [${jsonName}](./${jsonName}).

## What The Policy Bits Mean

| Bit | Policy |
| ---: | --- |
| 0 | Borrow aggregate parameters instead of copying them. |
| 1 | Forward aggregate results directly into their destination. |
| 2 | Use packed matrix-reduction kernels when the exact safe loop shape is proven. |
| 3 | Keep proven integer locals as native integers. |
| 4 | Address proven vector indices with native integer registers. |
| 5 | Specialize parity checks. |
| 6 | Fuse multiply-add where target support and numeric rules permit it. |
| 7 | Use packed dual-dot reductions when the exact safe loop shape is proven. |

## The Idea

A single global optimization recipe is rarely best for every program. VKF represents lowering choices as data, emits several legal machine-code variants, verifies their result, and can retain the best policy for the exact program and host. A compilation time limit bounds the search in normal use; exhaustive search is an explicit benchmark mode.

Code-identical policies are timed once. Here, 256 logical policies collapse to ${s.uniqueBinaries} binaries, so the experiment performs ${s.totalRuns} executions rather than naively timing every alias independently.

## Honest Interpretation

The robust result is the large policy landscape: the best basin is about ${fixed(s.maximumMeanMs / s.minimumMeanMs, 2)}× faster than the slowest legal policy. The exact ${fixed(s.selectedGainPercent, 1)}% lead of \`${s.selectedPolicy}\` over \`mask-ff\` is smaller than run-to-run variance and was not stable in a separate order-reversed check. It is a measured winner, not proof that it is universally faster. Release defaults therefore remain conservative, while profiles and future selectors can learn from the larger, repeatable policy effects.

## Reproduce

\`\`\`powershell
node benchmarks/policy-landscape/run.mjs --compiler=${report.conditions.compiler} --runs=${report.conditions.runsPerDistinctBinary} --output=benchmarks/policy-landscape/evidence/windows-x64-v0.1.5
\`\`\`

The command is a benchmark tool only. Compiling or running VKF programs does not require Node, Python, a C++ compiler, assembler, or external linker.
`;
}

const options = parseArgs(process.argv.slice(2));
const compilerVersion = run(options.compiler, ['-v']);
if (compilerVersion !== `VKF ${packageVersion}`) {
  fail(`compiler is ${compilerVersion}; package is ${packageVersion}`);
}
const sourceText = readFileSync(options.source, 'utf8');
const started = new Date();
const stdout = run(options.compiler, [
  '-b',
  options.source,
  '--diagnostics',
  '--optimizer-landscape-runs',
  String(options.runs),
]);
const compileSummary = lastJsonLine(stdout);
if (compileSummary.status !== 'compiled' || compileSummary.artifact_fallback) {
  fail('landscape requires direct native compilation without fallback');
}
const programOutput = run(compileSummary.artifact_path, []);
const actualOutput = Number(programOutput.trim());
if (!Number.isFinite(actualOutput) || Math.abs(actualOutput - expectedOutput) > 1e-12) {
  fail(`wrong spectral-norm output: ${programOutput}`);
}
const manifest = JSON.parse(readFileSync(compileSummary.manifest_path, 'utf8'));
const tuning = manifest.empirical_tuning;
if (!tuning?.tuned || tuning.candidates?.length !== 256) fail('expected a complete 256-policy tuning report');
if (tuning.candidates.some((candidate) => !candidate.tested || !candidate.correct)) fail('one or more optimizer policies failed verification');

const candidates = tuning.candidates.map((candidate) => ({
  policy: candidate.policy,
  codeHash: candidate.code_hash,
  codeBytes: candidate.code_bytes,
  runs: candidate.runs,
  meanMs: candidate.mean_ns / 1e6,
  medianMs: candidate.median_ns / 1e6,
  stddevMs: candidate.stddev_ns / 1e6,
  tested: candidate.tested,
  correct: candidate.correct,
}));
const selected = candidates.find((candidate) => candidate.policy === tuning.selected_policy);
const defaultPolicy = candidates.find((candidate) => candidate.policy === 'mask-ff');
if (!selected || !defaultPolicy) fail('selected or default policy missing from report');
const means = candidates.map((candidate) => candidate.meanMs);
const report = {
  schema: 'vkf.optimizer-policy-landscape',
  schemaVersion: 1,
  release: compilerVersion.replace(/^VKF\s+/, ''),
  measuredUtc: started.toISOString(),
  workload: {
    name: 'spectral-norm-medium',
    scale: 250,
    expectedOutput,
    actualOutput,
    source: path.relative(root, options.source).replaceAll('\\', '/'),
    sourceBytes: Buffer.byteLength(sourceText),
    sourceSha256: sha256(options.source),
  },
  conditions: {
    platform: process.platform,
    osRelease: os.release(),
    architecture: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    logicalCpus: os.cpus().length,
    node: process.version,
    compiler: path.relative(root, options.compiler).replaceAll('\\', '/'),
    compilerVersion,
    compilerBytes: readFileSync(options.compiler).byteLength,
    compilerSha256: sha256(options.compiler),
    harness: path.relative(root, runnerPath).replaceAll('\\', '/'),
    harnessSha256: sha256(runnerPath),
    runsPerDistinctBinary: options.runs,
    command: `${path.relative(root, options.compiler).replaceAll('\\', '/')} -b ${path.relative(root, options.source).replaceAll('\\', '/')} --diagnostics --optimizer-landscape-runs ${options.runs}`,
  },
  summary: {
    policyCount: candidates.length,
    correctPolicies: candidates.filter((candidate) => candidate.correct).length,
    uniqueBinaries: new Set(candidates.map((candidate) => candidate.codeHash)).size,
    totalRuns: tuning.total_runs,
    elapsedMs: tuning.elapsed_ms,
    selectedPolicy: tuning.selected_policy,
    selectedMeanMs: selected.meanMs,
    selectedMedianMs: selected.medianMs,
    selectedStddevMs: selected.stddevMs,
    defaultMeanMs: defaultPolicy.meanMs,
    defaultMedianMs: defaultPolicy.medianMs,
    defaultStddevMs: defaultPolicy.stddevMs,
    selectedGainPercent: (1 - selected.meanMs / defaultPolicy.meanMs) * 100,
    minimumMeanMs: Math.min(...means),
    maximumMeanMs: Math.max(...means),
  },
  compileSummary,
  candidates,
};

mkdirSync(path.dirname(options.output), { recursive: true });
const jsonPath = `${options.output}.json`;
const markdownPath = `${options.output}.md`;
const svgPath = `${options.output}.svg`;
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(svgPath, generateSvg(report));
const sourceLink = path.relative(path.dirname(markdownPath), options.source).replaceAll('\\', '/');
writeFileSync(markdownPath, generateMarkdown(
  report,
  path.basename(svgPath),
  path.basename(jsonPath),
  sourceLink,
));
console.log(JSON.stringify({
  json: path.relative(root, jsonPath).replaceAll('\\', '/'),
  markdown: path.relative(root, markdownPath).replaceAll('\\', '/'),
  svg: path.relative(root, svgPath).replaceAll('\\', '/'),
  ...report.summary,
}));
