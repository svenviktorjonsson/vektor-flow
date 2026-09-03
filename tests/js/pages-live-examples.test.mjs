import assert from "node:assert/strict";
import test from "node:test";

import { LIVE_EXAMPLES, LIVE_EXAMPLE_GROUPS } from "../../web/playground/examples.mjs";

test("Pages ships ten runnable examples for every visual variant", () => {
  assert.equal(LIVE_EXAMPLES.length, 40);
  assert.deepEqual(
    LIVE_EXAMPLE_GROUPS.map(({ kind, examples }) => [kind, examples.length]),
    [
      ["plot", 10],
      ["plot-time", 10],
      ["surface", 10],
      ["surface-time", 10],
    ],
  );
  assert.equal(new Set(LIVE_EXAMPLES.map(({ id }) => id)).size, 40);
  for (const example of LIVE_EXAMPLES) {
    assert.match(example.source, /[xyt]/u);
    assert.ok(example.title.length > 0);
  }
});

test("Pages root exposes the runnable example hierarchy", async () => {
  const [html, catalogue] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("../../web/index.html", import.meta.url),
      "utf8",
    )),
    import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("../../web/example-catalog.mjs", import.meta.url),
      "utf8",
    )),
  ]);

  assert.match(html, /id="live-example-tree"/u);
  assert.match(catalogue, /LIVE_EXAMPLE_GROUPS/u);
  assert.match(catalogue, /40 live/u);
});
