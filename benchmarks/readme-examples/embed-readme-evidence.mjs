import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const match = /^--([^=]+)=(.+)$/.exec(argument);
    if (!match) fail(`expected --name=value, received ${argument}`);
    return [match[1], match[2]];
  }),
);

for (const name of ["readme", "windows", "linux", "macos"]) {
  if (!options[name]) fail(`missing --${name}=path`);
}

const platforms = [
  ["Windows x64", JSON.parse(readFileSync(resolve(options.windows), "utf8"))],
  ["Linux x64", JSON.parse(readFileSync(resolve(options.linux), "utf8"))],
  ["macOS ARM64", JSON.parse(readFileSync(resolve(options.macos), "utf8"))],
];

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptRoot, "..", "..");
const currentVersion = JSON.parse(
  readFileSync(resolve(repoRoot, "package.json"), "utf8"),
).version;
for (const [label, report] of platforms) {
  if (report.version !== currentVersion || report.conditions?.compilerVersion !== currentVersion) {
    fail(`${label} proof is ${report.version}/${report.conditions?.compilerVersion}; README is ${currentVersion}`);
  }
  if (report.options?.compileRuns !== 100 || report.options?.runs !== 100) {
    fail(`${label} proof must contain 100 measured compile and runtime runs`);
  }
}

const examplesByPlatform = platforms.map(([label, report]) => [
  label,
  new Map(report.examples.map((example) => [example.path, example])),
]);

function normalizedOutput(value) {
  return value.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalSource(value) {
  return value.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

function outputBlock(path, examples) {
  const outputs = examples.map((example) => normalizedOutput(example.stdout.utf8));
  const sameOutput = outputs.every((output) => output === outputs[0]);
  const preface = "Recorded stdout (exit code `0`; stderr empty)";

  if (sameOutput && outputs[0] === "") {
    return `**${preface}:** no output.`;
  }
  if (sameOutput) {
    return `**${preface}, all platforms:**\n\n\`\`\`text\n${outputs[0]}\n\`\`\``;
  }

  return [
    `**${preface}:**`,
    ...platforms.flatMap(([label], index) => [
      `**${label}:**`,
      `\`\`\`text\n${outputs[index]}\n\`\`\``,
    ]),
  ].join("\n\n");
}

function platformConditionsTable() {
  const conditions = platforms.map(([, report]) => report.conditions);
  const cells = (render) => conditions.map(render).join(" | ");
  return [
    "| Detail | Windows x64 | Linux x64 | macOS ARM64 |",
    "| --- | --- | --- | --- |",
    `| Measured UTC | ${cells((value) => `\`${value.measuredAtUtc}\``)} |`,
    `| OS | ${cells((value) => `\`${value.osPlatform} ${value.osRelease}\``)} |`,
    `| Architecture | ${cells((value) => `\`${value.architecture}\``)} |`,
    `| CPU | ${cells((value) => value.cpuModel)} |`,
    `| Logical CPUs | ${cells((value) => value.logicalCpuCount)} |`,
    `| Compiler size | ${cells((value) => `${value.compilerBytes.toLocaleString("en-US")} bytes`)} |`,
    `| Compiler SHA-256 | ${cells((value) => `\`${value.compilerSha256}\``)} |`,
    `| Timing host | ${cells((value) => `${value.nodeVersion} \`${value.clock}\``)} |`,
  ].join("\n");
}

const readmePath = resolve(options.readme);
const allowSubset = options["allow-subset"] === "true";
let readme = readFileSync(readmePath, "utf8");
const conditionsPattern = /<!-- readme-platform-evidence:start -->[\s\S]*?<!-- readme-platform-evidence:end -->/;
if (!conditionsPattern.test(readme)) fail("README is missing platform evidence markers");
readme = readme.replace(
  conditionsPattern,
  `<!-- readme-platform-evidence:start -->\n${platformConditionsTable()}\n<!-- readme-platform-evidence:end -->`,
);
readme = readme.replace(
  /(?:\r?\n)+<!-- readme-evidence:start [^\n]+ -->[\s\S]*?<!-- readme-evidence:end -->(?:\r?\n)+/g,
  "\n\n",
);

const tagPattern = /<!-- readme-example: ([^\n]+) -->\r?\n```vkf\r?\n[\s\S]*?\r?\n```/g;
const seen = new Set();
readme = readme.replace(tagPattern, (snippet, path) => {
  const examples = examplesByPlatform.map(([label, map]) => {
    const example = map.get(path);
    if (!example) fail(`${label} report is missing ${path}`);
    return example;
  });
  const source = /```vkf\r?\n([\s\S]*?)\r?\n```/.exec(snippet)?.[1];
  if (source === undefined) fail(`could not extract source for ${path}`);
  const sourceHash = sha256(canonicalSource(source));
  for (let index = 0; index < examples.length; index += 1) {
    if (examples[index].compile?.count !== 100 || examples[index].runtime?.count !== 100) {
      fail(`${platforms[index][0]} proof for ${path} does not contain 100 samples`);
    }
    if (examples[index].sourceSha256 !== sourceHash) {
      fail(`${platforms[index][0]} proof for ${path} is stale: source hash mismatch`);
    }
  }
  seen.add(path);
  return [
    snippet,
    `<!-- readme-evidence:start ${path} -->`,
    outputBlock(path, examples),
    "<!-- readme-evidence:end -->",
  ].join("\n\n");
});

for (const [label, map] of examplesByPlatform) {
  if (!allowSubset && map.size !== seen.size) {
    const extras = [...map.keys()].filter((path) => !seen.has(path));
    fail(`${label} report/README mismatch: ${map.size} report examples, ${seen.size} tags; extras: ${extras.join(", ")}`);
  }
}

writeFileSync(readmePath, readme);
console.log(`embedded verified output evidence for ${seen.size} examples`);
