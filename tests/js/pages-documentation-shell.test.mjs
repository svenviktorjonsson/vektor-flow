import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const web = new URL("../../web/", import.meta.url);

test("Pages is only the repository README with inline execution", async () => {
  const [html, client, workflow, runner, worker] = await Promise.all([
    readFile(new URL("index.html", web), "utf8"),
    readFile(new URL("documentation.mjs", web), "utf8"),
    readFile(new URL("../../.github/workflows/pages.yml", import.meta.url), "utf8"),
    readFile(new URL("inline-runner.mjs", web), "utf8"),
    readFile(new URL("inline-runner-worker.mjs", web), "utf8"),
  ]);

  assert.match(html, /id="readme-documentation"/u);
  assert.doesNotMatch(html, /documentation-shell|documentation-navigation|site-header|example-catalog|hero|cards/u);
  assert.match(client, /fetch\("\.\/generated\/readme\.json"\)/u);
  assert.match(client, /\.innerHTML\s*=\s*document\.html/u);
  assert.match(client, /\.readme-example-play/u);
  assert.match(client, /\.readme-example-source/u);
  assert.match(client, /createElement\("canvas"\)/u);
  assert.match(client, /renderInlineResult\(canvas, packets, 0\)/u);
  assert.match(client, /requestAnimationFrame\(paint\)/u);
  assert.match(client, /cancelAnimationFrame\(request\)/u);
  assert.doesNotMatch(client, /location\.|window\.open|playground\//u);
  assert.match(runner, /new WorkerClass\(/u);
  assert.match(runner, /worker\.terminate\(\)/u);
  assert.match(worker, /WebAssembly\.Module\.imports\(module\)/u);
  assert.match(worker, /Object\.freeze\(\{\}\)/u);
  assert.match(workflow, /pages-documentation-shell\.test\.mjs/u);
  assert.match(workflow, /pages-readme-document\.test\.mjs/u);
  assert.match(workflow, /pages-inline-runner\.test\.mjs/u);
  assert.match(workflow, /build-pages-readme\.mjs --output=web\/generated/u);
  assert.doesNotMatch(workflow, /build-pages-example-catalog|pages-example-catalog|pages-example-tree|pages-live-examples/u);
});
