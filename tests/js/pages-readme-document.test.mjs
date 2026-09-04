import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildReadmeDocument,
} from "../../tools/build-pages-readme.mjs";

const repoRoot = new URL("../../", import.meta.url);

test("Pages renders the complete repository README with executable VKF examples", async () => {
  const [document, readme] = await Promise.all([
    buildReadmeDocument(repoRoot),
    readFile(new URL("../../README.md", import.meta.url), "utf8"),
  ]);
  const headingCount = [...readme.matchAll(/^#{1,6} /gmu)].length;
  const vkfFenceCount = [...readme.matchAll(/^```vkf\s*$/gmu)].length;

  assert.equal(document.headings.length, headingCount);
  assert.equal(document.examples.length, vkfFenceCount);
  assert.ok(document.examples.every(({ source }) => source.length > 0));
  assert.match(document.html, /<h1[^>]*>Vektor Flow<\/h1>/u);
  assert.match(document.html, /Why VKF Is Different/u);
  assert.doesNotMatch(document.html, /Native Material UI Gallery|material-ui-gallery|renderer-only oracle|full-compositor capture below/u);
  assert.match(document.html, /Performance Evidence/u);
  assert.match(document.html, /Development History/u);
  assert.match(document.html, /<button[^>]+class="readme-example-play"[^>]*>Play<\/button>/u);
  assert.match(document.html, /<textarea[^>]+class="readme-example-source"/u);
  assert.match(document.html, /<strong><a href="https:\/\/vektorflow\.org\/">Try VKF live at vektorflow\.org<\/a><\/strong>/u);
  assert.match(document.html, /<a href="[^"]+\/docs\/public\/images\/scene-gallery\/01-line-plot\.png"><img src="\.\/generated\/assets\/docs\/public\/images\/scene-gallery\/01-line-plot\.png"/u);
  assert.match(document.html, /Every VKF block on this page is editable in place/iu);
  assert.doesNotMatch(document.html, /hierarchical catalogue/iu);
  assert.doesNotMatch(document.html, /\[Try VKF live|>!\[/u);
  assert.doesNotMatch(document.html, /class="token|vf-token/u);
});

test("every README VKF block is an exact inline editable source", async () => {
  const document = await buildReadmeDocument(repoRoot);
  for (const example of document.examples) {
    const escaped = example.source
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
    assert.match(document.html, new RegExp(`<textarea[^>]+data-example-id="${example.id}"[^>]*>${escaped.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}<\\/textarea>`, "u"));
  }
  assert.doesNotMatch(document.html, /href="\.\/playground\/|browserRunnable|data-kind=/u);
});

test("Pages consumes recorded stdout into exactly one inline Console", async () => {
  const [document, readme] = await Promise.all([
    buildReadmeDocument(repoRoot),
    readFile(new URL("../../README.md", import.meta.url), "utf8"),
  ]);
  const recorded = [...readme.replaceAll("\r\n", "\n").matchAll(
    /\*\*(?:Recorded stdout[^\r\n]*|Exact output[^\r\n]*):\*\*\r?\n\r?\n```text\r?\n([\s\S]*?)\r?\n```/gu,
  )].map((match) => match[1]);
  const ids = ["readme-01", "readme-02", "readme-23", "readme-24", "readme-25"];

  assert.equal(recorded.length, 6);
  for (const [index, id] of ids.entries()) {
    const escaped = recorded[index]
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(
      document.html,
      new RegExp(
        `<section class="readme-example" data-vkf-example-id="${id}">[\\s\\S]*?<section class="readme-example-terminal"><span>Console<\\/span><pre class="readme-example-output" aria-live="polite">${escaped}<\\/pre><\\/section>`,
        "u",
      ),
    );
  }
  assert.match(
    document.html,
    /data-vkf-example-id="readme-26">[\s\S]*?<section class="readme-example-terminal" hidden><span>Console<\/span><pre class="readme-example-output" aria-live="polite"><\/pre><\/section>/u,
  );
  assert.doesNotMatch(document.html, /Recorded stdout \(exit code/u);
  assert.equal(
    [...document.html.matchAll(/Exact output \(all implementations\)/gu)].length,
    1,
  );
});

test("README states the release scope of published benchmark measurements", async () => {
  const document = await buildReadmeDocument(repoRoot);

  assert.match(document.html, /The 0\.4\.1 release candidate adds the compiled Windows UI runtime/iu);
  assert.match(document.html, /<h2 id="install-vkf-041">Install VKF 0\.4\.1<\/h2>/u);
  assert.match(document.html, /releases\/tag\/v0\.4\.1/u);
  assert.doesNotMatch(document.html, /0\.4\.0 release candidate/iu);
  assert.match(document.html, /published timings[^.]*0\.3\.0/iu);
  assert.match(document.html, /0\.4\.1[^.]*UI/iu);
  assert.match(document.html, /0\.5\.0[^.]*complete benchmark matrix/iu);
});
