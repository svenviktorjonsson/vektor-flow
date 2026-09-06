import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SITE_PAGES, buildSiteDocument, benchmarkSummary, pageHtml, writeSite } from "../../tools/build-site.mjs";
import { createSharedCompiler } from "../../web/playground/vkf-shared-compiler.mjs";
const root = new URL("../../", import.meta.url);
const sharedCompilerWasm = new URL(
  "../../web/playground/artifacts/vkf-shared-compiler.wasm",
  import.meta.url,
);

async function loadShippedCompiler() {
  const wasm = await readFile(sharedCompilerWasm);
  const module = new WebAssembly.Module(wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  return createSharedCompiler({ instance: new WebAssembly.Instance(module) });
}

const branches = [
  "docs/site/origins.md",
  "docs/site/getting-started.md",
  "docs/site/concepts.md",
];

const exactBrowserSandboxDiagnostics = new Set([
  "unsupported standard-library call time.wall_seconds in function __vkf_module_time__wall_time.body.body[0].expr",
  "unsupported standard-library call io.write_text in function $vkf_main.body.body[1].expr",
  "unsupported standard-library call system.os_name in function __vkf_module_system__os.body.body[0].expr",
  "unsupported standard-library call process.run_native in function __vkf_module_process__run.body.body[0].expr",
]);

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

test("the guide introduces Why, How and What before descending through links", async () => {
  const document = await buildSiteDocument(root, "docs/site/guide.md");
  const markdown = await readFile(new URL("docs/site/guide.md", root), "utf8");
  const prose = markdown.replaceAll(/<!--[^]*?-->/gu, "").replaceAll(/\]\([^)]*\)/gu, "]");
  assert.ok(prose.trim().split(/\s+/u).length <= 260, "keep the overview broad and short");
  assert.deepEqual(document.headings.filter(({ level }) => level === 2).map(({ title }) => title),
    ["Why", "How", "What"]);
  assert.equal(document.headings.length, 4, "deeper sections belong on linked pages");
  assert.deepEqual(document.examples.map(({ title }) => title), ["Why", "How", "What"]);
  assert.equal((document.html.match(/class="readme-example-play"/gu) ?? []).length, 3);
  const overview = document.html.split("<h2")[0];
  for (const source of branches) {
    const branch = await buildSiteDocument(root, source);
    assert.ok(document.dependencies.includes(source));
    assert.ok(overview.includes(`href="./${branch.route}"`), `${source} needs an overview link`);
  }
  assert.match(document.html, /href="\.\/reference\.html/u);
  assert.match(document.html, /href="\.\/performance\.html"/u);
  assert.match(document.html, /href="\.\/install\.html"/u);
  assert.match(document.html, /HTML and CSS/u);
  assert.match(document.html, /same VKF compiler as the desktop tools/u);
  assert.doesNotMatch(document.html, /subset of VKF/u);
  assert.doesNotMatch(document.html, /Recorded stdout|material-ui-gallery|readme-evidence/u);
});

test("the geometry example infers a continuous 2D topology from indexed channels", async () => {
  const document = await buildSiteDocument(root, "docs/site/guide.md");
  const source = document.examples.find(({ title }) => title === "What")?.source ?? "";

  assert.match(source, /display:\s*Display\(\)/u);
  assert.doesNotMatch(source, /Display\([^)]*dim\s*:/u);
  assert.match(source, /\bx\s*:\s*0\.1\[\.\.100\]/u);
  assert.match(source, /\by\s*:\s*sin\(x\)/u);
  assert.match(source, /frame\.add\([^]*\bx_u\s*:\s*x\b[^]*\by_u\s*:\s*y\b/u);
  assert.doesNotMatch(source, /\bp(?:_[A-Za-z]+)?\s*:/u);
  assert.doesNotMatch(source, /\bnum\s*\(/u);
  assert.doesNotMatch(source, /\bz(?:_[A-Za-z]+)?\s*:/u);
});

test("the bindings feature is an editable reference example with one prefilled console", async () => {
  const [document, canonical, compiler] = await Promise.all([
    buildSiteDocument(root, "docs/language-guide.md"),
    readFile(new URL("examples/generated/readme/core/01-bindings.vkf", root), "utf8"),
    loadShippedCompiler(),
  ]);
  const canonicalSource = canonical.replace(/\r\n/gu, "\n").trimEnd();
  const example = document.examples.find(({ source }) => source === canonicalSource);

  assert.ok(example, "the canonical bindings source must be editable");
  assert.equal(compiler.run(example.source).stdout, "7\n6\n");
  assert.equal(compiler.run(`${example.source}\n`).stdout, "7\n6\n");
  assert.match(document.html, /<span>Console<\/span><pre class="readme-example-output"[^>]*>7\n6<\/pre>/u);
  const bindingsSection = document.html.split('data-vkf-example-id="example-1"')[1]
    .split('<p>Declarations and updates are expressions')[0];
  assert.doesNotMatch(bindingsSection, /Recorded stdout/u);
});

test("binding expressions are editable and run from current source", async () => {
  const [document, canonical, compiler] = await Promise.all([
    buildSiteDocument(root, "docs/language-guide.md"),
    readFile(new URL("examples/generated/readme/core/02-bind-expression.vkf", root), "utf8"),
    loadShippedCompiler(),
  ]);
  const canonicalSource = canonical.replace(/\r\n/gu, "\n").trimEnd();
  const example = document.examples.find(({ source }) => source === canonicalSource);

  assert.ok(example, "the canonical binding-expression source must be editable");
  assert.equal(compiler.run(example.source).stdout, "3\n4\n");
  assert.equal(compiler.run(example.source.replace("+ 1", "+ 5")).stdout, "3\n8\n");
  assert.match(document.html, /<span>Console<\/span><pre class="readme-example-output"[^>]*>3\n4<\/pre>/u);
});

test("output and assertions are editable and run from current source", async () => {
  const [document, canonical, compiler] = await Promise.all([
    buildSiteDocument(root, "docs/language-guide.md"),
    readFile(new URL("examples/generated/readme/core/04-output-assert.vkf", root), "utf8"),
    loadShippedCompiler(),
  ]);
  const canonicalSource = canonical.replace(/\r\n/gu, "\n").trimEnd();
  const example = document.examples.find(({ source }) => source === canonicalSource);

  assert.ok(example, "the canonical output/assertion source must be editable");
  assert.equal(compiler.run(example.source).stdout, "42\n");
  const edited = example.source.replace("6 * 7", "6 * 8").replace("== 42", "== 48");
  assert.equal(compiler.run(edited).stdout, "48\n");
  assert.throws(
    () => compiler.run(example.source.replace("== 42", "== 41")),
    (error) => error instanceof WebAssembly.RuntimeError && error.message === "unreachable",
  );
  assert.match(document.html, /<span>Console<\/span><pre class="readme-example-output"[^>]*>42<\/pre>/u);
  const outputSection = document.html.split('data-vkf-example-id="example-3"')[1]
    .split('<h3 id="14-semicolons-preserve-logical-indentation">')[0];
  assert.doesNotMatch(outputSection, /Recorded stdout/u);
});

test("semicolon pipelines are editable and run from current source", async () => {
  const [document, canonical, compiler] = await Promise.all([
    buildSiteDocument(root, "docs/language-guide.md"),
    readFile(new URL("examples/generated/readme/core/49-semicolon-pipes.vkf", root), "utf8"),
    loadShippedCompiler(),
  ]);
  const canonicalSource = canonical.replace(/\r\n/gu, "\n").trimEnd();
  const example = document.examples.find(({ source }) => source === canonicalSource);

  assert.ok(example, "the canonical semicolon/pipeline source must be editable");
  assert.equal(compiler.run(example.source).stdout, "5\n[9, 25, 49]\n");
  const edited = example.source.replace("c: 5", "c: 6").replace("$ * 2", "$ * 3");
  assert.equal(compiler.run(edited).stdout, "6\n[16, 49, 100]\n");
  assert.throws(
    () => compiler.run(example.source.replace("; c:", " c:")),
    /named tuples require parentheses/u,
  );
  assert.match(document.html, /<span>Console<\/span><pre class="readme-example-output"[^>]*>5\n\[9, 25, 49\]<\/pre>/u);
  const semicolonSection = document.html.split('data-vkf-example-id="example-4"')[1]
    .split('<h3 id="15-tagged-tests">')[0];
  assert.doesNotMatch(semicolonSection, /Recorded stdout/u);
});

test("the loops feature is an editable reference example with one prefilled console", async () => {
  const [document, canonical, compiler] = await Promise.all([
    buildSiteDocument(root, "docs/language-guide.md"),
    readFile(new URL("examples/generated/readme/core/33-loops.vkf", root), "utf8"),
    loadShippedCompiler(),
  ]);
  const canonicalSource = canonical.replace(/\r\n/gu, "\n").trimEnd();
  const example = document.examples.find(({ source }) => source === canonicalSource);

  assert.ok(example, "the canonical loops source must be editable");
  assert.equal(compiler.run(example.source).stdout, "10\n2\n");
  assert.match(document.html, /<span>Console<\/span><pre class="readme-example-output"[^>]*>10\n2<\/pre>/u);
  const loopsSection = document.html.split('data-vkf-example-id="example-5"')[1]
    .split('<h3 id="54-return-continue-and-break">')[0];
  assert.doesNotMatch(loopsSection, /Recorded stdout/u);
  assert.equal((document.html.match(/Recorded stdout/gu) ?? []).length, 0);
});

test("every displayed browser example compiles and executes through the shipped WASM", async () => {
  const [document, compiler] = await Promise.all([
    buildSiteDocument(root, "docs/site/guide.md"),
    loadShippedCompiler(),
  ]);
  const results = document.examples.map(({ source }) => compiler.run(source));
  assert.equal(results[0].stdout, "[2, 4, 6]\n[[2, 4], [6, 8]]\n");
  assert.equal(results[1].stdout,
    "[[1, 2, 3], [2, 4, 6], [3, 6, 9]]\n[4, 10, 18]\n"
    + "[[[15, 18], [20, 24]], [[30, 36], [40, 48]]]\n");
  assert.equal(results[2].kind, "visual");
  assert.equal(results[2].retained_scene_arenas.length, 1);
  assert.equal(compiler.run(document.examples[0].source.replace("* 2", "* 3")).stdout,
    "[3, 6, 9]\n[[3, 6], [9, 12]]\n");
  const changedSource = document.examples[2].source.replace("0.1[..100]", "0.2[..100]");
  assert.notEqual(changedSource, document.examples[2].source);
  const changed = compiler.run(changedSource);
  const packet = changed.retained_scene_arenas[0];
  const mesh = packet.metadata.scene.meshes[0];
  const vertices = new Float32Array(
    packet.arena.buffer,
    packet.arena.byteOffset + mesh.vertices.byte_offset,
    mesh.vertices.length,
  );
  assert.equal(mesh.vertices.length / 10, 101);
  assert.ok(Math.abs(vertices[50 * 10] - 10) < 1e-6);
  assert.ok(Math.abs(vertices[100 * 10] - 20) < 1e-6);
  assert.ok(Math.abs(vertices[50 * 10 + 1] - Math.sin(10)) < 1e-6);
  assert.ok(Math.abs(vertices[100 * 10 + 1] - Math.sin(20)) < 1e-6);
});

test("every editor published anywhere on the site executes through the shipped WASM", async (t) => {
  const queue = Object.keys(SITE_PAGES);
  const visited = new Set();
  const documents = [];
  while (queue.length > 0) {
    const source = queue.shift();
    if (visited.has(source)) continue;
    visited.add(source);
    const document = await buildSiteDocument(root, source);
    documents.push(document);
    queue.push(...document.dependencies);
  }

  const compiler = await loadShippedCompiler();
  const editors = documents.flatMap((document) => document.examples.map((example) => ({
    page: document.source,
    ...example,
  })));

  assert.equal(editors.length, 89);
  assert.equal(new Set(editors.map(({ source }) => source)).size, 79);
  for (const editor of editors) {
    await t.test(`${editor.page}: ${editor.id}: ${editor.title}`, () => {
      let result;
      try {
        result = compiler.run(editor.source);
      } catch (error) {
        assert.ok(exactBrowserSandboxDiagnostics.has(error.message),
          `${editor.page}: ${editor.title}: ${error.message}`);
        return;
      }
      if (/\b(?:p|x|y)_[A-Za-z_][A-Za-z0-9_]*\s*:/u.test(editor.source)) {
        const geometry = result.retained_scene_arenas?.flatMap(({ metadata }) => (
          metadata.scene.meshes.filter(({ vertices }) => Number.isInteger(vertices?.length))
        )) ?? [];
        assert.ok(geometry.length > 0, `${editor.page}: ${editor.title} must emit indexed geometry`);
        assert.ok(geometry.every(({ vertices }) => vertices.length / 10 >= 100),
          `${editor.page}: ${editor.title} must emit at least 100 positions`);
      }
    });
  }
});

test("each guide branch links back and drills into the existing reference", async () => {
  for (const source of branches) {
    const document = await buildSiteDocument(root, source);
    assert.ok(document.dependencies.includes("docs/site/guide.md"), `${source}: missing parent`);
    assert.ok(document.dependencies.includes("docs/language-guide.md"), `${source}: missing reference`);
    assert.ok(document.examples.length > 0, `${source}: demonstrate the idea with runnable code`);
  }
  const how = await buildSiteDocument(root, branches[1]);
  assert.ok(how.dependencies.includes("INSTALL.md"));
  assert.ok(how.dependencies.includes("docs/site/browser.md"));
  const what = await buildSiteDocument(root, branches[2]);
  assert.ok(what.dependencies.includes("docs/site/execution.md"));
  assert.ok(what.dependencies.includes("docs/site/performance.md"));
  assert.ok(what.dependencies.includes("benchmarks/core-comparison/results/linux-x64-030.md"));
});

test("branch examples reuse canonical sources and execute like the overview examples", async () => {
  const overview = await buildSiteDocument(root, "docs/site/guide.md");
  const compiler = await loadShippedCompiler();
  const known = new Map(overview.examples.map(({ source }) => {
    const result = compiler.run(source);
    return [source, result];
  }));
  for (const source of branches) {
    const document = await buildSiteDocument(root, source);
    const markdown = await readFile(new URL(source, root), "utf8");
    assert.doesNotMatch(markdown, /```vkf/u, "include the canonical source rather than duplicating it");
    for (const example of document.examples) {
      assert.ok(known.has(example.source), `${source}: unexpected or duplicated example source`);
      const result = compiler.run(example.source);
      assert.deepEqual(result, known.get(example.source));
      if (result.kind === "visual") assert.equal(result.retained_scene_arenas.length, 1);
    }
  }
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

test("install VKF snippets are editable alongside the native release instructions", async () => {
  const document = await buildSiteDocument(root, "INSTALL.md");
  assert.equal(document.examples.length, 1);
  assert.match(document.html, /class="readme-example-source"/u);
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
