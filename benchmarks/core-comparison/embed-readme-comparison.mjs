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
const report = JSON.parse(readFileSync(resolve(options.report), 'utf8'));
const version = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version;
const expectedCases = [
  'startup',
  'spectral-norm-medium',
  'fannkuch-redux-medium',
  'n-body-medium'
];
const expectedLanguages = [
  'vkf', 'c', 'rust', 'zig', 'go', 'julia', 'python-efficient'
];
const labels = {
  vkf: 'VKF', c: 'C', rust: 'Rust', zig: 'Zig', go: 'Go',
  julia: 'Julia', 'python-efficient': 'Python'
};

if (report.schema !== 'vektor-flow/core-language-comparison-v1') fail('unexpected report schema');
if (report.version !== version) fail(`comparison is ${report.version}; README is ${version}`);
if (report.options?.compileRuns !== 100 || report.options?.runs !== 100) {
  fail('comparison must contain 100 measured compile and runtime runs');
}

const canonicalSource = (value) => value.replace(/\r\n/g, '\n').replace(/\n$/, '');
const sha256 = (value) => createHash('sha256').update(canonicalSource(value)).digest('hex');
const meanStd = (stats) => `${stats.meanMs.toFixed(3)} ± ${stats.stddevMs.toFixed(3)} ms`;
const byKey = new Map(report.results.map((result) => [
  `${result.case}/${result.language}`,
  result
]));

function resultFor(caseId, language) {
  const result = byKey.get(`${caseId}/${language}`);
  if (!result) fail(`comparison missing ${caseId}/${language}`);
  if (result.compile.count !== 100 || result.runtime.count !== 100) {
    fail(`${caseId}/${language} does not contain 100 samples`);
  }
  const sourcePath = resolve(repoRoot, result.source.template);
  const source = readFileSync(sourcePath, 'utf8');
  if (sha256(source) !== result.source.sha256 || result.source.sha256 !== result.source.templateSha256) {
    fail(`${caseId}/${language} source hash does not match ${result.source.template}`);
  }
  return { ...result, sourcePath, source };
}

function sourceLink(result) {
  return `[source](${relative(dirname(readmePath), result.sourcePath).replaceAll('\\', '/')})`;
}

function section(caseId) {
  const results = expectedLanguages.map((language) => resultFor(caseId, language));
  const vkf = results[0];
  const title = caseId === 'startup'
    ? 'Startup and output'
    : `${vkf.operation} — ${vkf.size}, scale ${vkf.count.toLocaleString('en-US')}`;
  const rows = results.map((result) => [
    labels[result.language],
    meanStd(result.compile),
    result.internalCompile ? meanStd(result.internalCompile) : '—',
    meanStd(result.runtime),
    result.nativeRuntime ? meanStd(result.nativeRuntime) : '—',
    sourceLink(result)
  ]);
  return [
    `### ${title}`,
    '',
    `Mode: **${vkf.comparisonMode}**. ${vkf.approach}.`,
    '',
    '```vkf',
    vkf.source.trimEnd(),
    '```',
    '',
    `All implementations returned the same checked numeric result within tolerance: \`${vkf.value}\`.`,
    '',
    '| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw kernel | Exact code |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n');
}

for (const caseId of expectedCases) {
  for (const language of expectedLanguages) resultFor(caseId, language);
}

const versions = expectedLanguages.map((language) => {
  const result = resultFor('startup', language);
  return `- ${labels[language]}: \`${result.version}\`; ${result.compileModel}`;
});
const fragment = [
  `Measured on \`${report.environment.platform}\`, \`${report.environment.architecture}\`, ` +
    `${report.environment.cpu}, ${report.environment.logicalCpuCount} logical CPUs, at \`${report.generatedAt}\`.`,
  '',
  'Every table cell is mean ± sample standard deviation from 100 measured runs. Fresh-process compile includes tool startup for every language. Julia parses source and JIT-compiles during runtime; Python produces bytecode; native toolchains emit executables. VKF compiler-core time excludes compiler startup. The <10 ms compiler-core and <500 µs raw-entry limits apply only to the historical 20,000-operation scalar engineering gate. Raw kernel timing excludes process launch and is available where a stable native entry can be loaded.',
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
