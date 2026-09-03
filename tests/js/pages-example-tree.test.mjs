import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const web = new URL("../../web/", import.meta.url);

test("Pages root exposes a searchable hierarchical README example tree", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("index.html", web), "utf8"),
    readFile(new URL("example-catalog.mjs", web), "utf8"),
  ]);

  assert.match(html, /id="example-search"/u);
  assert.match(html, /id="example-tree"/u);
  assert.match(html, /src="\.\/example-catalog\.mjs"/u);
  assert.match(app, /playground\/generated\/catalog\.json/u);
  assert.match(app, /document\.createElement\("details"\)/u);
  assert.match(app, /URLSearchParams/u);
  assert.match(app, /source/u);
  assert.match(app, /Verified native render/u);
  assert.match(app, /Source example/u);
});

test("playground loads catalogue source files without server compilation", async () => {
  const app = await readFile(new URL("playground/app.mjs", web), "utf8");

  assert.match(app, /generated\/sources/u);
  assert.match(app, /requestedSource/u);
  assert.match(app, /Browser execution is not yet available for this full program/u);
  assert.doesNotMatch(app, /fetch\([^)]*(?:compile|run)|XMLHttpRequest|WebSocket/u);
});
