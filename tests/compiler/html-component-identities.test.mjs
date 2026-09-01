import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;

function compilerTool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function runCompilerStage(name, input, args = []) {
  const result = spawnSync(compilerTool(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed without diagnostics`);
  return result.stdout;
}

test("every compiled zero-argument HTML identity creates its canonical tag", async () => {
  const catalog = JSON.parse(await readFile(
    path.join(repositoryRoot, "spec", "html-component-identities.json"),
    "utf8",
  ));
  const source = [
    ": .ui.display",
    ...catalog.map(([identity], index) => `component${index}: ${identity}()`),
  ].join("\n");

  const tokens = runCompilerStage("vkf_lexer_cursor_smoke", undefined, [source]);
  const ast = runCompilerStage("vkf_parser_token_stream_smoke", tokens);
  const typedIr = JSON.parse(runCompilerStage("vkf_ast_to_ir_smoke", ast));
  const loweredIdentities = typedIr.body
    .filter(({ kind, name }) => kind === "store_binding" && /^component\d+$/.test(name))
    .map(({ value }) => value.value);

  assert.deepEqual(loweredIdentities, catalog.map(([identity]) => identity));

  const browserSource = await readFile(
    path.join(repositoryRoot, "web", "vf-ui", "vf-html-components.js"),
    "utf8",
  );
  const browserGlobal = {
    Object,
    WeakMap,
    document: {
      createElement(tag) {
        return { localName: tag };
      },
    },
  };
  browserGlobal.window = browserGlobal;
  vm.runInNewContext(browserSource, browserGlobal);
  const loweredTags = loweredIdentities.map(
    (identity) => new browserGlobal.VfHtmlComponents[identity]().localName,
  );
  assert.deepEqual(loweredTags, catalog.map(([, tag]) => tag));
});
