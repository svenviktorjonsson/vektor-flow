import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const styleGuide = readFileSync(resolve(root, "docs", "style-guide.md"), "utf8");
const lines = readme.split(/\r?\n/u);

function proseWidth(line) {
  return line.replaceAll(/\]\([^)]*\)/gu, "]()").length;
}

function proseWidthViolations() {
  const violations = [];
  let fence = false;
  let htmlTable = false;
  let generated = false;

  for (const [index, line] of lines.entries()) {
    if (/^<!-- readme-(?:platform|comparison)-evidence:start -->$/u.test(line)) {
      generated = true;
      continue;
    }
    if (/^<!-- readme-(?:platform|comparison)-evidence:end -->$/u.test(line)) {
      generated = false;
      continue;
    }
    if (/^```/u.test(line)) {
      fence = !fence;
      continue;
    }
    if (line === "<table>") htmlTable = true;
    if (line === "</table>") {
      htmlTable = false;
      continue;
    }

    const exempt = fence
      || htmlTable
      || generated
      || /^\s*(?:#|\||<!--|!\[|\[[^\]]+\]:)/u.test(line)
      || /^<\/?(?:details|summary)>/u.test(line);
    if (!exempt && proseWidth(line) > 80) {
      violations.push(`${index + 1}:${proseWidth(line)}`);
    }
  }
  return violations;
}

test("README omits the retired static material gallery", () => {
  assert.doesNotMatch(readme, /material-ui-gallery\.(?:png|gif)/u);
});

test("README fenced snippets have a stable nearby label", () => {
  const openings = [];
  let fence = false;
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^```(\w*)/u);
    if (!marker) continue;
    if (!fence) openings.push({ index, language: marker[1] });
    fence = !fence;
  }
  assert.equal(fence, false, "README has an unclosed fenced block");

  for (const { index, language } of openings) {
    const prior = lines.slice(Math.max(0, index - 4), index);
    const previousNonblank = [...prior].reverse().find((line) => line !== "");
    const located = language === "text"
      ? /^\*\*(?:Recorded stdout|Exact output)/u.test(previousNonblank)
      : language === "bash"
        ? previousNonblank === "Open a new terminal:"
        : /^<!-- readme-example: [^ ]+ -->$/u.test(previousNonblank)
          || prior.some((line) => /^### (?:\d{2} · )?/u.test(line));
    assert.ok(
      located,
      `fenced ${language || "plain"} block on line ${index + 1} has no local locator`,
    );
  }
});

test("README omits the retired static scene gallery", () => {
  const cards = [...readme.matchAll(
    /<!-- scene-example:([^:]+):start -->([\s\S]*?)<!-- scene-example:\1:end -->/gu,
  )];
  assert.deepEqual(cards, []);
});

test("README prose follows the repository's 80-column documentation rule", () => {
  assert.match(styleGuide, /Markdown prose[^\n]*80 columns/iu);
  assert.deepEqual(proseWidthViolations(), []);
});
