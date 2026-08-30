const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const generated = spawnSync(
  process.execPath,
  [path.join(repositoryRoot, "tools", "generate-html-component-catalog.mjs"), "--check"],
  { cwd: repositoryRoot, encoding: "utf8", windowsHide: true },
);
assert.equal(generated.status, 0, generated.stderr);

const catalog = JSON.parse(readFileSync(
  path.join(repositoryRoot, "spec", "html-component-identities.json"),
  "utf8",
));
const browser = readFileSync(
  path.join(repositoryRoot, "web", "vf-ui", "vf-html-components.js"),
  "utf8",
);
const compiler = readFileSync(
  path.join(repositoryRoot, "compiler", "native", "vkf_html_component_catalog.generated.hpp"),
  "utf8",
);
assert.equal(catalog.length, 113);
assert.equal(catalog.some(([identity, tag]) => identity === "Script" || tag === "script"), false);
for (const [identity, tag] of catalog) {
  assert.match(browser, new RegExp(`\\[\\"${identity}\\",\\"${tag}\\"\\]`));
  assert.ok(compiler.includes(`Entry{"${identity}", "${tag}"}`));
}

console.log("vf-html-component-catalog generated parity tests passed");
