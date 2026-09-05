import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSiteDocument, benchmarkSummary, pageHtml, writeSite } from "../../tools/build-site.mjs";
import { createBrowserCompiler } from "../../web/playground/vkf-browser-compiler.mjs";
const root = new URL("../../", import.meta.url);

test("one short README supplies the complete static homepage", async () => {
  const [document, readme] = await Promise.all([buildSiteDocument(root), readFile(new URL("README.md", root), "utf8")]);
  assert.ok(readme.split(/\s+/u).length <= 160);
  assert.equal(document.examples.length, 0);
  assert.equal(document.headings.length, 1);
  const html = pageHtml(document);
  assert.match(html, /no keywords/u);
  assert.match(html, /Viktor Jonsson/u);
  assert.match(html, /immutable values and rebinding/u);
  assert.match(html, /<code>\.<\/code> reaches in, <code>:<\/code> spills/u);
  assert.match(html, /<code>::<\/code>/u);
  assert.match(html, /shorthand built on top/u);
  assert.match(html, /Explore the guide and run examples at vektorflow\.org/u);
  assert.match(html, /href="\.\/guide\.html"/u);
  assert.doesNotMatch(html, /<textarea|<script|Loading README|Material UI Gallery|material-ui-gallery|scene-gallery/u);
});

test("the guide keeps exactly three runnable examples and links to deeper documentation", async () => {
  const document = await buildSiteDocument(root, "docs/site/guide.md");
  assert.equal(document.examples.length, 3);
  assert.equal((document.html.match(/class="readme-example-play"/gu) ?? []).length, 3);
  assert.match(document.html, /href="\.\/reference\.html/u);
  assert.match(document.html, /href="\.\/performance\.html"/u);
  assert.match(document.html, /href="\.\/install\.html"/u);
  assert.match(document.html, /HTML and CSS/u);
  assert.match(document.html, /subset/u);
  assert.doesNotMatch(document.html, /Recorded stdout|material-ui-gallery|readme-evidence/u);
});

test("every displayed browser example compiles and executes through the shipped WASM", async () => {
  const base = new URL("web/playground/artifacts/", root);
  const [document, wasm, manifest] = await Promise.all([
    buildSiteDocument(root, "docs/site/guide.md"),
    readFile(new URL("vkf-browser-compiler.wasm", base)),
    readFile(new URL("vkf-browser-compiler.json", base), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(wasm)), []);
  const { instance } = await WebAssembly.instantiate(wasm);
  const compiler = createBrowserCompiler({ instance, manifest });
  const results = document.examples.map(({ source }) => compiler.run(source));
  assert.deepEqual(results[0].values, [[2, 4, 6], [[2, 4], [6, 8]]]);
  assert.deepEqual(results[1].values, [
    [[1, 2, 3], [2, 4, 6], [3, 6, 9]], [4, 10, 18],
    [[[15, 18], [20, 24]], [[30, 36], [40, 48]]],
  ]);
  assert.equal(results[2].kind, "visual");
  assert.equal(results[2].packet_records.length, 1);
  assert.deepEqual(compiler.run(document.examples[0].source.replace("* 2", "* 3")).values,
    [[3, 6, 9], [[3, 6], [9, 12]]]);
  const changed = compiler.run(document.examples[2].source.replaceAll("-3, -2, -1", "-4, -2, -1"));
  assert.equal(changed.packet_records[0].x[0][0], -4);
});

test("performance ratios are derived from the versioned native report", async () => {
  const document = await buildSiteDocument(root, "docs/site/performance.md");
  assert.match(document.html, /VKF 0\.3\.0/u);
  assert.match(document.html, /0\.30×/u);
  assert.match(document.html, /1\.49×/u);
  assert.match(document.html, /1,000 measured runs/u);
  assert.match(document.html, /do not predict browser/u);
  assert.throws(() => benchmarkSummary("no measurements"), /Missing raw-kernel/u);
});

test("native reference and install snippets are not advertised as browser-runnable", async () => {
  const document = await buildSiteDocument(root, "INSTALL.md");
  assert.equal(document.examples.length, 0);
  assert.match(document.html, /data-vkf-source/u);
  assert.match(document.html, /Published preview: VKF 0\.4\.0/u);
  assert.match(document.html, /release candidate/u);
  assert.match(document.html, /not a public/u);
  assert.match(document.html, /application\/wasm/u);
});

test("Markdown links remain on-site, scripts stay text, and traversal is rejected", async () => {
  const temp = await mkdtemp(join(tmpdir(), "vkf-docs-"));
  try {
    await mkdir(join(temp, "docs"));
    await writeFile(join(temp, "README.md"), '# Home\n\n[Detail](docs/detail.md#topic)\n\n<script>alert(1)</script>\n');
    await writeFile(join(temp, "docs/detail.md"), '# Detail\n\n## Topic\n\n[Home](../README.md)\n\n```vkf\n:: "native"\n```\n');
    const document = await buildSiteDocument(temp);
    assert.match(document.html, /reference\/docs\/detail\.html#topic/u);
    assert.doesNotMatch(document.html, /<script>/u);
    await writeSite(temp, join(temp, "public/generated"), { pages: ["README.md"] });
    const deep = await readFile(join(temp, "public/reference/docs/detail.html"), "utf8");
    assert.match(deep, /href="\.\.\/\.\.\/index\.html"/u);
    await writeFile(join(temp, "README.md"), "# Home\n\n[Unsafe](../../outside.md)\n");
    await assert.rejects(buildSiteDocument(temp), /Unsafe link/u);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
