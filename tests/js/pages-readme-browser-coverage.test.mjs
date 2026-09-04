import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildReadmeDocument } from "../../tools/build-pages-readme.mjs";
import { createBrowserCompiler } from "../../web/playground/vkf-browser-compiler.mjs";

const root = new URL("../../", import.meta.url);
const artifacts = new URL("../../web/playground/artifacts/", import.meta.url);

async function compilerAndExamples() {
  const [document, wasm, manifest] = await Promise.all([
    buildReadmeDocument(root),
    readFile(new URL("vkf-browser-compiler.wasm", artifacts)),
    readFile(new URL("vkf-browser-compiler.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  return { compiler: createBrowserCompiler({ instance, manifest }), examples: document.examples };
}

test("browser coverage matrix classifies every README VKF fence exactly once", async () => {
  const [matrix, document] = await Promise.all([
    readFile(new URL("../fixtures/pages-readme-browser-coverage.json", import.meta.url), "utf8").then(JSON.parse),
    buildReadmeDocument(root),
  ]);
  const classified = matrix.clusters.flatMap(({ examples }) => examples);

  assert.equal(classified.length, 26);
  assert.deepEqual([...new Set(classified)].sort(), document.examples.map(({ id }) => id).sort());
});

test("browser compiler runs the complete README recursive vector-lifting fence", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-01");

  assert.deepEqual({ ...compiler.run(example.source) }, {
    kind: "console",
    values: [[2, 4, 6], [[2, 4], [6, 8]]],
  });
  assert.deepEqual({ ...compiler.run([
    "triple(item:int) -> int: item * 3",
    ":: triple([2, 4])",
    ":: triple([[1, 3], [5, 7]])",
  ].join("\n")) }, {
    kind: "console",
    values: [[6, 12], [[3, 9], [15, 21]]],
  });
});

test("browser compiler runs the complete README named-axis tensor fence", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-02");

  assert.deepEqual({ ...compiler.run(example.source) }, {
    kind: "console",
    values: [
      [[1, 2, 3], [2, 4, 6], [3, 6, 9]],
      [4, 10, 18],
      [[[15, 18], [20, 24]], [[30, 36], [40, 48]]],
    ],
  });
  assert.deepEqual({ ...compiler.run([
    "hadamard: [2, 3]->row * [5, 7]->row",
    "outer: [2, 4]->x * [3, 5]->y",
    ":: outer",
    ":: hadamard",
  ].join("\n")) }, {
    kind: "console",
    values: [[[6, 10], [12, 20]], [10, 21]],
  });
});

test("browser execution coverage is measured against all 26 README VKF fences", async () => {
  const [{ compiler, examples }, matrix] = await Promise.all([
    compilerAndExamples(),
    readFile(new URL("../fixtures/pages-readme-browser-coverage.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const runnable = [];

  for (const example of examples) {
    try {
      compiler.run(example.source);
      runnable.push(example.id);
    } catch (error) {
      assert.match(error.message, /browser compiler could not run the VKF source/u);
    }
  }

  assert.deepEqual(runnable, matrix.browser_runnable_after_slice);
  assert.equal(runnable.length, 2);
  assert.equal(examples.length, 26);
});
