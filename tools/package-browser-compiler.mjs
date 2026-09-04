import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const outputIndex = process.argv.indexOf("--output");
const outputValue = outputArgument?.slice("--output=".length)
  ?? (outputIndex >= 0 ? process.argv[outputIndex + 1] : null);

if (!outputValue) {
  throw new Error("usage: node tools/package-browser-compiler.mjs --output=<directory>");
}

const output = path.resolve(outputValue);
const artifactsOutput = path.join(output, "artifacts");
const artifactsSource = path.join(repositoryRoot, "web", "playground", "artifacts");

await mkdir(artifactsOutput, { recursive: true });
await Promise.all([
  copyFile(
    path.join(artifactsSource, "vkf-browser-compiler.wasm"),
    path.join(artifactsOutput, "vkf-browser-compiler.wasm"),
  ),
  copyFile(
    path.join(artifactsSource, "vkf-browser-compiler.json"),
    path.join(artifactsOutput, "vkf-browser-compiler.json"),
  ),
  build({
    entryPoints: [path.join(repositoryRoot, "web", "playground", "vkf-browser-compiler.mjs")],
    outfile: path.join(output, "vkf-browser-compiler.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    legalComments: "none",
  }),
]);
