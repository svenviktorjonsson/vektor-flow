import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readmePath = resolve(root, "README.md");
const start = "<!-- scene-gallery:start -->";
const end = "<!-- scene-gallery:end -->";
const original = readFileSync(readmePath, "utf8");
let updated = original;

if (original.includes(start)) {
  const startIndex = original.indexOf(start);
  const endIndex = original.indexOf(end, startIndex);
  if (endIndex < 0) throw new Error(`README is missing ${end}`);
  const before = original.slice(0, startIndex).trimEnd();
  const after = original.slice(endIndex + end.length).trimStart();
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  updated = `${before}${newline.repeat(2)}${after}`;
}

if (process.argv.includes("--check")) {
  if (updated !== original) {
    console.error("README contains the retired non-runnable scene gallery");
    process.exitCode = 1;
  }
} else if (updated !== original) {
  writeFileSync(readmePath, updated);
}
