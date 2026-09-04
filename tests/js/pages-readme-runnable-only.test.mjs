import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const readme = readFileSync(resolve(root, "README.md"), "utf8")
  .replaceAll("\r\n", "\n");

test("README omits the non-runnable scene capture gallery", () => {
  assert.doesNotMatch(readme, /<!-- scene-gallery:start -->/u);
  assert.doesNotMatch(readme, /## Scene example gallery/u);
  assert.doesNotMatch(readme, /<!-- scene-example:/u);
});
