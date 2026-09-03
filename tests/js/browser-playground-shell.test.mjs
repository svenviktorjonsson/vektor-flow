import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const playground = new URL("../../web/playground/", import.meta.url);

test("playground exposes an editable Prism-highlighted client-side compiler", async () => {
  const [html, app, examples] = await Promise.all([
    readFile(new URL("index.html", playground), "utf8"),
    readFile(new URL("app.mjs", playground), "utf8"),
    readFile(new URL("examples.mjs", playground), "utf8"),
  ]);
  assert.match(html, /<textarea[^>]+id="source"/u);
  assert.match(html, /<button[^>]+id="compile"/u);
  assert.match(html, /<pre[^>]+id="output"/u);
  assert.match(html, /<canvas[^>]+id="visualization"/u);
  assert.match(html, /<select[^>]+id="example"/u);
  assert.match(html, /prism(?:\.min)?\.js/u);
  assert.match(app, /registerVektorFlowPrism/u);
  assert.match(app, /loadPackagedBrowserCompiler/u);
  assert.match(app, /loadPackagedBrowserSymbolicPlotter/u);
  assert.match(app, /compiler\.run\(source\.value\)/u);
  assert.match(app, /console-arithmetic/u);
  assert.match(app, /value - \(20 \+ 4\) \* 2/u);
  assert.match(app, /browserRunnable/u);
  assert.match(app, /kind: "console"/u);
  assert.match(examples, /surface-static/u);
  assert.match(examples, /surface-time/u);
  assert.doesNotMatch(app, /fetch\([^)]*(?:compile|run)|XMLHttpRequest|WebSocket/u);
});
