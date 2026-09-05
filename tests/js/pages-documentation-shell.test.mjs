import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSiteDocument, pageHtml } from "../../tools/build-site.mjs";
const root = new URL("../../", import.meta.url);

test("the static documentation has lightweight navigation and progressively enhanced examples", async () => {
  const [client, workflow, runner, worker] = await Promise.all([
    readFile(new URL("web/documentation.mjs", root), "utf8"),
    readFile(new URL(".github/workflows/pages.yml", root), "utf8"),
    readFile(new URL("web/inline-runner.mjs", root), "utf8"),
    readFile(new URL("web/inline-runner-worker.mjs", root), "utf8"),
  ]);
  const html = pageHtml(await buildSiteDocument(root, "docs/site/guide.md"));
  assert.match(html, /id="readme-documentation"/u);
  assert.match(html, /aria-label="Main navigation"/u);
  assert.match(html, /<textarea/u);
  assert.doesNotMatch(html, /Loading README|example-catalog/u);
  assert.match(client, /import\("\.\/inline-runner\.mjs"\)/u);
  assert.match(client, /runner\.prewarm\(\)/u);
  assert.match(client, /\.innerHTML\s*=\s*document\.html/u);
  assert.match(client, /renderInlineResult\(canvas, packets, 0\)/u);
  assert.match(client, /cancelAnimationFrame\(request\)/u);
  assert.doesNotMatch(client, /window\.open|fetch\("\.\/generated/u);
  assert.match(runner, /new WorkerClass\(/u);
  assert.match(runner, /worker\.terminate\(\)/u);
  assert.match(worker, /WebAssembly\.Module\.imports\(module\)/u);
  assert.match(worker, /Object\.freeze\(\{\}\)/u);
  assert.match(workflow, /pages-readme-document\.test\.mjs/u);
  assert.match(workflow, /build-pages-readme\.mjs --output=web\/generated/u);
  assert.match(workflow, /PSNativeCommandUseErrorActionPreference/u);
  assert.match(workflow, /github\.event_name != 'pull_request'/u);
});
