import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("downloadable browser compiler package runs VKF through its public module", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "vkf-browser-release-"));
  try {
    const packaged = spawnSync(
      process.execPath,
      ["tools/package-browser-compiler.mjs", "--output", output],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(packaged.status, 0, packaged.stderr || packaged.stdout);

    const [{ createBrowserCompiler }, wasm, manifest] = await Promise.all([
      import(pathToFileURL(path.join(output, "vkf-browser-compiler.mjs"))),
      readFile(path.join(output, "artifacts", "vkf-browser-compiler.wasm")),
      readFile(
        path.join(output, "artifacts", "vkf-browser-compiler.json"),
        "utf8",
      ).then(JSON.parse),
    ]);
    const { instance } = await WebAssembly.instantiate(wasm);
    const compiler = createBrowserCompiler({ instance, manifest });

    assert.deepEqual({ ...compiler.run("double(value:int) -> int: value * 2\n:: double([1, 2, 3])") }, {
      kind: "console",
      values: [[2, 4, 6]],
    });
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("tagged releases publish the browser compiler beside native installers", async () => {
  const workflow = await readFile(".github/workflows/native-release.yml", "utf8");

  assert.match(workflow, /^  browser-wasm:\s*$/mu);
  assert.match(workflow, /npm ci[\s\S]*?npm run build:browser-compiler/u);
  assert.match(workflow, /node tools\/package-browser-compiler\.mjs/u);
  assert.match(workflow, /vektor-flow-browser-wasm\.zip/u);
  assert.match(workflow, /vektor-flow-browser-wasm\.zip\.sha256/u);
  assert.match(workflow, /name: browser-wasm-release/u);
  assert.match(workflow, /publish:[\s\S]*?needs:[\s\S]*?- browser-wasm/u);
});

test("the linked documentation explains browser integration without bloating the README", async () => {
  const [readme, install, guide] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("INSTALL.md", "utf8"),
    readFile("docs/site/browser.md", "utf8"),
  ]);
  assert.match(readme, /vektorflow\.org\/guide\.html/u);
  assert.match(install, /docs\/site\/browser\.md/u);
  assert.match(guide, /vektor-flow-browser-wasm\.zip/u);
  assert.match(guide, /import \{ loadPackagedBrowserCompiler \} from "\.\/vkf-browser-compiler\.mjs"/u);
  assert.match(guide, /const compiler = await loadPackagedBrowserCompiler\(\)/u);
  assert.match(guide, /compiler\.run\(source\)/u);
  assert.match(guide, /entirely client-side/u);
  assert.match(guide, /no\s+network, server, filesystem, process, DOM, localhost, or host API access/u);
});
