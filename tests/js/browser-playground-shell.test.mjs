import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { highlightVkf } from "../../web/editor/vkf-highlighter.mjs";

const playground = new URL("../../web/playground/", import.meta.url);

test("playground is only an editor and a compiler-owned Console or Result", async () => {
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
  assert.match(html, /id="output-heading">Console</u);
  assert.doesNotMatch(html, /class="hero"|class="lede"|example-links|reference-image|<script[^>]+https?:/u);
  assert.doesNotMatch(`${html}\n${app}`, /Prism|prismjs|showReference/u);
  assert.match(app, /highlightVkf/u);
  assert.match(app, /loadPackagedBrowserCompiler/u);
  assert.match(app, /loadPackagedBrowserSymbolicPlotter/u);
  assert.match(app, /compiler\.run\(source\.value\)/u);
  assert.match(app, /console-arithmetic/u);
  assert.match(app, /value - \(20 \+ 4\) \* 2/u);
  assert.match(app, /browserRunnable/u);
  assert.match(app, /kind: "console"/u);
  assert.match(app, /parameters\.get\("readme"\)/u);
  assert.match(app, /Not supported by the packaged browser compiler\. No fallback result was rendered\./u);
  assert.match(examples, /surface-static/u);
  assert.match(examples, /surface-time/u);
  assert.doesNotMatch(app, /fetch\([^)]*(?:compile|run)|XMLHttpRequest|WebSocket/u);
});

test("the in-repository VKF highlighter is deterministic and HTML-safe", () => {
  const source = 'answer: double(21)\n:: "<done>" # output';
  const expected = highlightVkf(source);

  assert.equal(highlightVkf(source), expected);
  assert.match(expected, /class="vf-token binding">answer<\/span>/u);
  assert.match(expected, /class="vf-token function">double<\/span>/u);
  assert.match(expected, /class="vf-token number">21<\/span>/u);
  assert.match(expected, /&lt;done&gt;/u);
  assert.match(expected, /class="vf-token comment"># output<\/span>/u);
  assert.doesNotMatch(expected, /<done>/u);
});
