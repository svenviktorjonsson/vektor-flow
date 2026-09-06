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
    path.join(artifactsSource, "vkf-shared-compiler.wasm"),
    path.join(artifactsOutput, "vkf-shared-compiler.wasm"),
  ),
  build({
    entryPoints: [path.join(repositoryRoot, "web", "playground", "vkf-shared-compiler.mjs")],
    outfile: path.join(output, "vkf-shared-compiler.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    legalComments: "none",
  }),
]);
