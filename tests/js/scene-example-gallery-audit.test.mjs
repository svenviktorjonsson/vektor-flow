import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const galleryRoot = resolve(root, "examples", "scene_gallery");
const manifest = JSON.parse(readFileSync(resolve(galleryRoot, "manifest.json"), "utf8"));
const sources = new Map(manifest.examples.map((example) => [
  example.id,
  readFileSync(resolve(galleryRoot, example.source), "utf8").replaceAll("\r\n", "\n"),
]));

function example(id) {
  return manifest.examples.find((candidate) => candidate.id === id);
}

function bracketField(source, field) {
  const match = new RegExp(`\\b${field}\\s*:\\s*\\[`, "u").exec(source);
  if (!match) return null;
  const start = source.indexOf("[", match.index);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "[") depth += 1;
    if (source[index] !== "]") continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  return null;
}

function geometryIds(source) {
  return new Set([...source.matchAll(/\bid\s*:\s*"([^"]+)"/gu)].map((match) => match[1]));
}

test("2D Frame.add plots omit the 3D z field", () => {
  const plotIds = ["01-line-plot", "14-layered-bands", "18-polar-ribbon"];
  const violations = plotIds
    .filter((id) => /\bz\s*:/u.test(sources.get(id)))
    .map((id) => `${id}: z`);
  assert.deepEqual(violations, []);
});

test("the first 2D plot is one x/y line with default constant pixel width", () => {
  const source = sources.get("01-line-plot");
  const x = JSON.parse(bracketField(source, "x"));
  const y = JSON.parse(bracketField(source, "y"));
  const violations = [];
  if (!x.every(Number.isFinite)) violations.push("x is not one flat numeric vector");
  if (!y.every(Number.isFinite)) violations.push("y is not one flat numeric vector");
  if (x.length !== y.length) violations.push("x/y vector lengths differ");
  if (/\bz\s*:/u.test(source)) violations.push("z is present");
  if (/(?:\bw\s*:|(?:line|stroke|pixel)_?width\s*:)/u.test(source)) {
    violations.push("explicit w/width is present");
  }
  const verification = example("01-line-plot").capture.verification;
  const expectedVerification = {
    kind: "constant-line-width",
    meshId: "sine",
    width: "default",
    constant: true,
  };
  if (JSON.stringify(verification) !== JSON.stringify(expectedVerification)) {
    violations.push("default constant-pixel capture verification is missing");
  }
  assert.deepEqual(violations, []);
});

test("gallery sources contain no empty no-op fields", () => {
  const violations = [];
  for (const item of manifest.examples) {
    for (const match of sources.get(item.id).matchAll(/\b([a-z_][a-z0-9_]*)\s*:\s*\[\s*\]/giu)) {
      violations.push(`${item.id}: ${match[1]}:[]`);
    }
  }
  assert.deepEqual(violations, []);
});

test("every gallery source stays within the minimal example budget", () => {
  const violations = manifest.examples.flatMap((item) => {
    const nonblankLines = sources.get(item.id)
      .split("\n")
      .filter((line) => line.trim()).length;
    return nonblankLines <= 24 ? [] : [`${item.id}: ${nonblankLines} lines`];
  });
  assert.deepEqual(violations, []);
});

test("mirror captures verify a distinct reflected subject", () => {
  const violations = [];
  const mirrors = manifest.examples.filter((item) =>
    item.features.includes("mirror")
    || item.features.includes("reflection")
    || sources.get(item.id).includes("mirror_of:"));
  for (const item of mirrors) {
    const verification = item.capture.verification;
    if (!verification || verification.kind !== "mirror-subject") {
      violations.push(`${item.id}: missing mirror-subject capture verification`);
      continue;
    }
    const ids = geometryIds(sources.get(item.id));
    if (!ids.has(verification.mirrorId)) {
      violations.push(`${item.id}: missing mirror ${verification.mirrorId}`);
    }
    if (!ids.has(verification.subjectId)) {
      violations.push(`${item.id}: missing subject ${verification.subjectId}`);
    }
    if (verification.subjectId === verification.mirrorId) {
      violations.push(`${item.id}: reflected subject is the mirror`);
    }
    if (!(verification.minSurfaceSpanPx >= 8)) {
      violations.push(`${item.id}: reflected subject has no measurable surface span`);
    }
  }
  assert.deepEqual(violations, []);
});

test("the dice capture verifies multiple visible marked faces", () => {
  const source = sources.get("16-dice-texture");
  assert.match(source, /\bid\s*:\s*"die"/u);
  assert.match(source, /\bkind\s*:\s*"dice"/u);
  const rotation = JSON.parse(bracketField(source, "rotation"));
  assert.ok(rotation.filter((value) => Math.abs(value) > 0.001).length >= 2);

  const verification = example("16-dice-texture").capture.verification;
  assert.equal(verification?.kind, "multi-face-die");
  assert.equal(verification?.meshId, "die");
  assert.ok(verification?.minVisibleFaces >= 3);
  assert.ok(verification?.minMarkedFaces >= 2);
});

test("the hidden capture runner consumes per-example verification", () => {
  const capture = readFileSync(resolve(root, "scripts", "capture-scene-example.mjs"), "utf8");
  const runner = readFileSync(resolve(root, "tests", "helpers", "run_staged_ui_example.js"), "utf8");
  assert.match(capture, /manifest\.json/u);
  assert.match(capture, /capture\.verification/u);
  assert.match(runner, /sceneVerification/u);
  assert.match(runner, /analyzeSurfaceTextures/u);
});
