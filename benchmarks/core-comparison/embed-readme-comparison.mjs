import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = /^--([^=]+)=(.+)$/.exec(argument);
  if (!match) fail(`expected --name=value, received ${argument}`);
  return [match[1], match[2]];
}));
if (!options.readme || !options.report) fail('required: --readme=path --report=path');

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, '..', '..');
const readmePath = resolve(options.readme);
const reportPath = resolve(options.report);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const version = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version;
const expectedCases = [
  'spectral-norm-medium',
  'fannkuch-redux-medium',
  'n-body-medium'
];
const expectedLanguages = [
  'vkf', 'c', 'rust', 'zig'
];
const labels = {
  vkf: 'VKF', c: 'C', rust: 'Rust', zig: 'Zig'
};

if (report.schema !== 'vektor-flow/core-language-comparison-v1') fail('unexpected report schema');
if (report.version !== version) fail(`comparison is ${report.version}; README is ${version}`);
if (report.options?.runs !== 100) {
  fail('comparison must contain 100 measured runtime runs');
}

const canonicalSource = (value) => value.replace(/\r\n/g, '\n').replace(/\n$/, '');
const sha256 = (value) => createHash('sha256').update(canonicalSource(value)).digest('hex');
const meanStd = (stats) => `${stats.meanMs.toFixed(3)} ± ${stats.stddevMs.toFixed(3)} ms`;
const rawLanguages = ['c', 'rust', 'zig'];
const sourceNames = { vkf: 'vkf.vkf', c: 'c.c', rust: 'rust.rs', zig: 'zig.zig' };
const byKey = new Map(report.results.map((result) => [
  `${result.case}/${result.language}`,
  result
]));

function resultFor(caseId, language) {
  const result = byKey.get(`${caseId}/${language}`);
  if (!result) fail(`comparison missing ${caseId}/${language}`);
  const templatePath = resolve(repoRoot, result.source.template);
  const template = readFileSync(templatePath, 'utf8');
  if (sha256(template) !== result.source.templateSha256) {
    fail(`${caseId}/${language} template hash does not match ${result.source.template}`);
  }
  const sourcePath = resolve(root, 'published', caseId, sourceNames[language]);
  const source = readFileSync(sourcePath, 'utf8');
  if (sha256(source) !== result.source.sha256) {
    fail(`${caseId}/${language} materialized source hash does not match ${sourcePath}`);
  }
  return { ...result, sourcePath, source };
}

function sourceLink(result) {
  return `[source](${relative(dirname(readmePath), result.sourcePath).replaceAll('\\', '/')})`;
}

function rawKernelSummary() {
  const caseLabels = {
    'spectral-norm-medium': 'Spectral norm',
    'fannkuch-redux-medium': 'Fannkuch',
    'n-body-medium': 'N-body'
  };
  const vkfResults = new Map(expectedCases.map((caseId) => [caseId, resultFor(caseId, 'vkf')]));
  for (const [caseId, result] of vkfResults) {
    if (result.nativeRuntime?.count !== 100) fail(`${caseId}/vkf lacks 100 raw-kernel samples`);
  }
  const rows = expectedCases.map((caseId) => {
    const vkf = vkfResults.get(caseId);
    const ratios = rawLanguages.map((language) => {
      const competitor = resultFor(caseId, language);
      if (competitor.nativeRuntime?.count !== 100) {
        fail(`${caseId}/${language} lacks 100 raw-kernel samples`);
      }
      return vkf.nativeRuntime.meanMs / competitor.nativeRuntime.meanMs;
    });
    if (ratios.some((ratio) => !(ratio < 2))) {
      fail(`${caseId} exceeds the strict raw-kernel goal: ${ratios.map((value) => value.toFixed(4)).join(', ')}`);
    }
    return [
      caseLabels[caseId],
      meanStd(vkf.nativeRuntime),
      ...ratios.map((ratio) => `${ratio.toFixed(3)}×`),
      'PASS'
    ];
  });
  return [
    '### Current raw-kernel goal',
    '',
    'Every ratio is `VKF mean / competitor mean` from the same pinned Linux x64 container and the same 100-run report. A value above `1` means VKF took longer. The goal is strict: every individual ratio must be below `2×`; there is no aggregate score that can hide a failed kernel.',
    '',
    '| Kernel | VKF mean ± std | VKF / C | VKF / Rust | VKF / Zig | `<2×` each |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n');
}

function section(caseId) {
  const results = expectedLanguages.map((language) => resultFor(caseId, language));
  const vkf = results[0];
  const title = caseId === 'startup'
    ? 'Startup and output'
    : `${vkf.operation} — ${vkf.size}, scale ${vkf.count.toLocaleString('en-US')}`;
  return [
    `### ${title}`,
    '',
    `Mode: **${vkf.comparisonMode}**. ${vkf.approach}.`,
    '',
    '```vkf',
    vkf.source.trimEnd(),
    '```',
    '',
    '**Exact output (all implementations):**',
    '',
    '```text',
    String(vkf.value),
    '```',
    '',
    `Exact implementations: ${results.map((result) => `${labels[result.language]} ${sourceLink(result)}`).join('; ')}.`
  ].join('\n');
}

for (const caseId of expectedCases) {
  for (const language of expectedLanguages) resultFor(caseId, language);
}

const versions = expectedLanguages.map((language) => {
  const result = resultFor(expectedCases[0], language);
  return `- ${labels[language]}: \`${result.version}\`; ${result.compileModel}`;
});
const fragment = [
  `Measured on \`${report.environment.platform}\`, \`${report.environment.architecture}\`, ` +
    `${report.environment.cpu}, ${report.environment.logicalCpuCount} logical CPUs, at \`${report.generatedAt}\`.`,
  '',
  'Only the three substantial optimization kernels are timed. VKF provides the absolute reference; C, Rust, and Zig are same-host ratios to VKF. Absolute times are never compared across machines. Each raw lane contains 100 measured runs after 10 warmups and excludes process launch.',
  '',
  `Evidence: [all samples and hashes](${relative(dirname(readmePath), reportPath).replaceAll('\\', '/')}) and [readable laboratory report](${relative(dirname(readmePath), reportPath.replace(/\.json$/, '.md')).replaceAll('\\', '/')}).`,
  '',
  rawKernelSummary(),
  '',
  ...expectedCases.flatMap((caseId) => [section(caseId), '']),
  '<details>',
  '<summary>Exact toolchains and compile models</summary>',
  '',
  ...versions,
  '',
  '</details>'
].join('\n');

let readme = readFileSync(readmePath, 'utf8');
const marker = /<!-- readme-comparison-evidence:start -->[\s\S]*?<!-- readme-comparison-evidence:end -->/;
if (!marker.test(readme)) fail('README is missing comparison evidence markers');
readme = readme.replace(
  marker,
  `<!-- readme-comparison-evidence:start -->\n${fragment.trimEnd()}\n<!-- readme-comparison-evidence:end -->`
);
writeFileSync(readmePath, readme);
console.log(`embedded ${expectedCases.length} verified cross-language comparisons`);
