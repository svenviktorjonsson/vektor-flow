import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeSite } from "./build-site.mjs";
export { buildSiteDocument, pageHtml } from "./build-site.mjs";

/**
 * Compatibility export for the original 26-example compiler regression suite.
 * Native samples and their historical browser inputs differ. Preserve those
 * exact inputs separately from the changing public README. This corpus is
 * never rendered or shipped as a second README or a public gallery.
 */
export async function buildReadmeDocument(repoRoot) {
  const root = repoRoot instanceof URL ? fileURLToPath(repoRoot) : resolve(repoRoot);
  const manifest = JSON.parse(await readFile(resolve(root, "examples/scene_gallery/manifest.json"), "utf8"));
  const browserScenes = JSON.parse(await readFile(resolve(root, "tests/fixtures/browser-scene-sources.json"), "utf8")).sources;
  const paths = [
    "examples/introduction/vector-functions.vkf",
    "examples/introduction/named-axes.vkf",
    ...manifest.examples.map(({ source }, index) => index === 0 ? "examples/introduction/geometry.vkf" : `examples/scene_gallery/${source}`),
    "tests/fixtures/browser-control-flow.vkf",
    "benchmarks/core-comparison/published/spectral-norm-large/vkf.vkf",
    "benchmarks/core-comparison/published/fannkuch-redux-large/vkf.vkf",
    "benchmarks/core-comparison/published/n-body-large/vkf.vkf",
  ];
  if (paths.length !== 26) throw new Error("The browser regression corpus must contain 26 programs");
  return Object.freeze({ examples: Object.freeze(await Promise.all(paths.map(async (path, index) => {
    const id = `readme-${String(index + 1).padStart(2, "0")}`;
    const source = browserScenes[id] ?? await readFile(resolve(root, path), "utf8");
    return Object.freeze({ id, title: path, source: source.replaceAll("\r\n", "\n").trimEnd() });
  }))) });
}

export async function writeReadmeDocument(repoRoot, outputRoot) {
  return writeSite(repoRoot, outputRoot);
}

async function main() {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--output="));
  if (!argument) throw new Error("usage: node tools/build-pages-readme.mjs --output=<directory>");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await writeSite(root, resolve(root, argument.slice("--output=".length)));
  console.log(`${result.pages} documentation pages and ${result.examples} runnable examples published`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
