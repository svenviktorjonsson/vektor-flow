import assert from "node:assert/strict";
import test from "node:test";
import { loadSharedFrontend } from "../../tools/verify-browser-frontend-parity.mjs";

const compiler = loadSharedFrontend();

test("browser and native compiler produce identical typed IR for ordinary source", async () => {
  const api = await compiler;
  const source = "value: 42\n:: value\n";
  const actual = api.browser(source);
  assert.deepEqual(actual, api.native(source));
  assert.equal(actual.ok, true, actual.message);
  assert.equal(actual.typed_ir.kind, "typed_module");
});

test("source edits to names, range bounds and implicit multiplication reach the shared frontend", async () => {
  const api = await compiler;
  const sources = [
    ":.math\nx: 0.1[..100]\ny: sin(x)\n:: y",
    ":.math\nsamples: 0.1[..100]\nheights: sin(samples)\n:: heights",
    ":.math\nx: 0.2[..50]\ny: sin(x)\n:: y",
  ];
  const results = sources.map((source) => {
    const browser = api.browser(source);
    assert.deepEqual(browser, api.native(source), source);
    assert.equal(browser.ok, true, browser.message);
    return browser;
  });
  assert.notDeepEqual(results[0], results[1]);
  assert.notDeepEqual(results[0], results[2]);
});

test("malformed source preserves native diagnostics and the next compilation recovers", async () => {
  const api = await compiler;
  for (const source of ["value: (", ".first_missing:1\n.second_missing:2", ".second_missing:2\n.first_missing:1"]) {
    const browser = api.browser(source);
    assert.deepEqual(browser, api.native(source));
    assert.equal(browser.ok, false);
    assert.equal(typeof browser.message, "string");
    assert.ok(browser.message.length > 0);
  }
  const first = api.browser(".first_missing:1\n.second_missing:2");
  const second = api.browser(".second_missing:2\n.first_missing:1");
  assert.notEqual(first.message, second.message, "the first unknown update name determines the diagnostic");
  const source = "answer: 42\n:: answer";
  assert.deepEqual(api.browser(source), api.native(source));
  assert.equal(api.browser(source).ok, true);
});
