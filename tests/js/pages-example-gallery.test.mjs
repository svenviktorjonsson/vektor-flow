import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const web = new URL("../../web/", import.meta.url);

test("Pages root delegates every example to the inline README runner", async () => {
  const html = await readFile(new URL("index.html", web), "utf8");
  const client = await readFile(new URL("documentation.mjs", web), "utf8");
  assert.match(html, /id="readme-documentation"/u);
  assert.match(html, /src="\.\/documentation\.mjs"/u);
  assert.match(client, /\.querySelectorAll\("\.readme-example"\)/u);
  assert.match(client, /createInlineRunner/u);
  assert.doesNotMatch(html, /href="\.\/playground\/\?example=/u);
  assert.doesNotMatch(html, /server required|backend required/iu);
});
