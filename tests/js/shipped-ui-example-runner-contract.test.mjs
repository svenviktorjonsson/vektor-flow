import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

test("shipped UI audit runner is hidden, dependency-free, and full-compositor", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "tests", "helpers", "run_staged_ui_example.js"),
    "utf8",
  );

  assert.match(source, /--headless=new/u);
  assert.match(source, /Page\.captureScreenshot/u);
  assert.match(source, /createServer/u);
  assert.match(source, /frameChrome/u);
  assert.match(source, /runningRenderers/u);
  assert.match(source, /composite_sha256/u);
  assert.match(source, /compositeOutputPath/u);
  assert.match(source, /writeFileSync\(compositeOutputPath/u);
  assert.doesNotMatch(source, /playwright|puppeteer|selenium/iu);
});
