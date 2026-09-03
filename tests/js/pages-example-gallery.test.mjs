import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const web = new URL("../../web/", import.meta.url);

test("Pages root links to each runnable browser example", async () => {
  const html = await readFile(new URL("index.html", web), "utf8");
  assert.match(html, /href="\.\/playground\/\?example=console"/u);
  assert.match(html, /href="\.\/playground\/\?example=curve-static"/u);
  assert.match(html, /href="\.\/playground\/\?example=curve-time"/u);
  assert.match(html, /Console/u);
  assert.match(html, /2D static/u);
  assert.match(html, /2D with time/u);
  assert.doesNotMatch(html, /server required|backend required/iu);
});
