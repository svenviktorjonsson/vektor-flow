import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSiteDocument, escapeHtml } from "../../tools/build-site.mjs";
import { documentationSources } from "../../tools/verify-browser-frontend-parity.mjs";

const root = new URL("../../", import.meta.url);

test("VKF fences remain editable without a live label on every documentation page", async () => {
  const inventory = await documentationSources();
  const documents = new Map();
  for (const entry of inventory.filter(({ kind }) => kind === "fence")) {
    if (!documents.has(entry.document)) documents.set(entry.document, await buildSiteDocument(root, entry.document));
    const document = documents.get(entry.document);
    assert.ok(document.examples.some(({ source }) => source.trimEnd() === entry.source.trimEnd()),
      `${entry.document}:${entry.line}: VKF fence is not editable`);
  }
  assert.ok(documents.size > 3);
});

test("every complete canonical reference example has one editable source and one console", async () => {
  const markdown = await readFile(new URL("docs/language-guide.md", root), "utf8");
  const document = await buildSiteDocument(root, "docs/language-guide.md");
  const markers = [...markdown.matchAll(/<!-- readme-example: ([^>]+?) -->/gu)];
  assert.ok(markers.length > 50, "cover the full language reference, not only live-labelled examples");
  for (const [, file] of markers) {
    const canonical = (await readFile(new URL(`examples/generated/readme/${file}`, root), "utf8"))
      .replaceAll("\r\n", "\n").trimEnd();
    assert.ok(document.examples.some(({ source }) => source === canonical), `${file}: missing editor`);
    assert.ok(document.html.includes(`spellcheck="false">${escapeHtml(canonical)}</textarea>`),
      `${file}: original source must be the textarea default`);
  }
  assert.equal((document.html.match(/class="readme-example-source"/gu) ?? []).length, document.examples.length);
  assert.equal((document.html.match(/class="readme-example-output"/gu) ?? []).length, document.examples.length);
  assert.doesNotMatch(document.html, /Recorded stdout/u);
  assert.match(document.html, /class="readme-example-output"[^>]*>7\n6<\/pre>/u);
});

test("every published VKF editor starts with one visible console", async () => {
  for (const source of Object.keys((await import("../../tools/build-site.mjs")).SITE_PAGES)) {
    const document = await buildSiteDocument(root, source);
    const consoles = document.html.match(/class="readme-example-terminal"/gu) ?? [];
    assert.equal(consoles.length, document.examples.length, `${source}: one console per editor`);
    assert.doesNotMatch(
      document.html,
      /class="readme-example-terminal"[^>]*\shidden(?:\s|>)/u,
      `${source}: consoles must be visible before the first run`,
    );
  }
});

test("a fresh document restores original source while Run uses the current editor contents", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector: () => ({ querySelectorAll: () => [] }) };
  let renderDocumentation;
  try {
    ({ renderDocumentation } = await import("../../web/documentation.mjs"));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  const original = ":: 40 + 2";
  const calls = [];
  const runner = { run: async (source) => { calls.push(source); return { output: "result", packets: null }; } };
  function freshPage(restoredValue) {
    const listeners = new Map();
    const source = { value: restoredValue, defaultValue: original, style: {}, scrollHeight: 100,
      addEventListener: (name, callback) => listeners.set(`source:${name}`, callback) };
    const play = { disabled: false, addEventListener: (name, callback) => listeners.set(`play:${name}`, callback) };
    const output = { textContent: "42" };
    const elements = new Map([
      [".readme-example-source", source],
      [".readme-example-highlight code", { innerHTML: "", parentElement: {} }],
      [".readme-example-play", play],
      [".readme-example-terminal", { hidden: false }],
      [".readme-example-output", output],
      [".readme-example-layout", { classList: { remove() {} } }],
    ]);
    const example = { querySelector: (selector) => elements.get(selector) };
    const readme = { innerHTML: "", querySelectorAll: () => [example] };
    renderDocumentation({ html: `<textarea>${original}</textarea>`, examples: [{ source: original }] }, readme, runner);
    return { source, play, output, listeners };
  }
  const first = freshPage(":: 999");
  assert.equal(first.source.value, original, "discard browser-restored edits when initializing a fresh document");
  first.source.value = ":: 40 + 3";
  await first.listeners.get("play:click")();
  assert.deepEqual(calls, [":: 40 + 3"]);
  assert.equal(first.source.defaultValue, original, "editing must not overwrite the original source");
  assert.equal(first.output.textContent, "result");
  const refreshed = freshPage(first.source.value);
  assert.equal(refreshed.source.value, original);
  assert.equal(refreshed.output.textContent, "42");
  await refreshed.listeners.get("play:click")();
  assert.deepEqual(calls, [":: 40 + 3", original]);
});
