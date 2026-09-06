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

    const [{ createSharedCompiler, loadSharedCompiler }, wasm] = await Promise.all([
      import(pathToFileURL(path.join(output, "vkf-shared-compiler.mjs"))),
      readFile(path.join(output, "artifacts", "vkf-shared-compiler.wasm")),
    ]);
    const module = new WebAssembly.Module(wasm);
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    const compiler = createSharedCompiler({ instance: new WebAssembly.Instance(module) });

    assert.deepEqual(compiler.run("double(value:int) -> int: value * 2\n:: double([1, 2, 3])"), {
      kind: "console",
      stdout: "[2, 4, 6]\n",
      stderr: "",
    });
    let requestedWasm;
    const loaded = await loadSharedCompiler({
      fetchImpl: async (url) => {
        requestedWasm = String(url);
        return { ok: true, arrayBuffer: async () => wasm };
      },
      compileModule: async (bytes) => new WebAssembly.Module(bytes),
    });
    assert.match(requestedWasm, /artifacts\/vkf-shared-compiler\.wasm$/u);
    assert.equal(loaded.run(":: 40 + 2").stdout, "42\n");
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
  assert.match(guide, /import \{ loadSharedCompiler \} from "\.\/vkf-shared-compiler\.mjs"/u);
  assert.match(guide, /const compiler = await loadSharedCompiler\(\)/u);
  assert.match(guide, /compiler\.run\(source\)/u);
  assert.match(guide, /result\.stdout/u);
  assert.match(guide, /entirely client-side/u);
  assert.match(guide, /no\s+network, server, filesystem, process, DOM, localhost, or host API access/u);
});
