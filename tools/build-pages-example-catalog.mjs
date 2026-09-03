import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OMITTED_DIRECTORIES = new Set([
  ".git",
  ".work",
  ".worktrees",
  "build",
  "node_modules",
]);

function filesystemRoot(root) {
  return root instanceof URL ? fileURLToPath(root) : resolve(root);
}

function slash(path) {
  return path.split(sep).join("/");
}

async function walk(root, accept) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && OMITTED_DIRECTORIES.has(entry.name)) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) found.push(...await walk(path, accept));
    else if (entry.isFile() && accept(path)) found.push(path);
  }
  return found;
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function canonicalSource(source) {
  return source.replaceAll("\r\n", "\n").replace(/\n$/u, "");
}

function sourceSha256(source) {
  return createHash("sha256").update(canonicalSource(source)).digest("hex");
}

function humanTitle(path) {
  const stem = basename(path, ".vkf") === "app"
    ? basename(dirname(path))
    : basename(path, ".vkf") === "main"
      ? basename(dirname(path))
      : basename(path, ".vkf");
  return stem
    .replace(/^\d+[a-z]?[-_]/u, "")
    .replaceAll(/[-_]+/gu, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    .replaceAll(/\bUi\b/gu, "UI")
    .replaceAll(/\bVkf\b/gu, "VKF")
    .replaceAll(/\b3d\b/giu, "3D");
}

function groupsFor(path, sceneByPath) {
  if (path.startsWith("examples/generated/readme/core/")) return ["Language", "Core"];
  if (path.startsWith("examples/generated/readme/stdlib/")) return ["Language", "Standard library"];
  if (path.startsWith("examples/symbolic/")) return ["Language", "Symbolic"];
  if (path.startsWith("examples/native_core/")) return ["Language", "Native core"];
  if (path.startsWith("examples/scene_gallery/")) {
    const scene = sceneByPath.get(path);
    const motion = scene?.features?.includes("animation") ? "Animation" : "Static";
    return ["Visual", `${scene?.dimension ?? 3}D`, motion];
  }
  if (path.startsWith("examples/material_ui_gallery/")) return ["Visual", "UI", "Materials"];
  if (path.startsWith("examples/ui_")) return ["Visual", "UI", "Components"];
  if (path.includes("physics") || path.includes("rigid")) return ["Visual", "Physics"];
  if (path.startsWith("examples/programs/vkf_chess_3d/") || path.includes("chess")) {
    return ["Applications", "Chess", "3D"];
  }
  if (path.startsWith("examples/programs/")) return ["Applications", "Programs"];
  if (path.includes("benchmark")) return ["Performance", "Benchmarks"];
  return ["Examples", "Language tour"];
}

function runtimeKind(path, groups) {
  if (groups[0] === "Visual") return "visual";
  if (groups[0] === "Applications") return "application";
  if (path.startsWith("examples/symbolic/")) return "symbolic";
  return "console";
}

async function sceneMetadata(root) {
  const path = resolve(root, "examples", "scene_gallery", "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  return new Map(manifest.examples.map((scene) => [
    `examples/scene_gallery/${scene.source}`,
    scene,
  ]));
}

async function resolveMention(root, readme, mention) {
  const normalized = mention.replaceAll("\\", "/").replace(/^\.\//u, "");
  const candidates = [];
  if (normalized.startsWith("examples/") || normalized.startsWith("benchmarks/")) {
    candidates.push(resolve(root, normalized));
  }
  candidates.push(resolve(dirname(readme), normalized));
  candidates.push(resolve(root, "examples", "generated", "readme", normalized));
  for (const candidate of candidates) {
    if (await isFile(candidate)) return slash(relative(root, candidate));
  }
  return null;
}

export async function discoverReadmeReferencedVkfPaths(repoRoot) {
  const root = filesystemRoot(repoRoot);
  const paths = new Set();
  const readmes = await walk(root, (path) => /^README(?:\.[^.]+)?\.md$/iu.test(basename(path)));
  for (const readme of readmes) {
    const text = await readFile(readme, "utf8");
    const mentions = text.matchAll(/(?<![\p{L}\p{N}_])([\p{L}\p{N}_.\\/-]+\.vkf)\b/giu);
    for (const match of mentions) {
      const resolved = await resolveMention(root, readme, match[1]);
      if (resolved) paths.add(resolved);
    }
  }

  const generated = resolve(root, "examples", "generated", "readme");
  for (const path of await walk(generated, (candidate) => candidate.endsWith(".vkf"))) {
    paths.add(slash(relative(root, path)));
  }
  for (const path of (await sceneMetadata(root)).keys()) paths.add(path);
  return Object.freeze([...paths].sort());
}

export async function buildReadmeExampleCatalog(repoRoot) {
  const root = filesystemRoot(repoRoot);
  const [paths, sceneByPath] = await Promise.all([
    discoverReadmeReferencedVkfPaths(root),
    sceneMetadata(root),
  ]);
  const examples = await Promise.all(paths.map(async (path) => {
    const source = await readFile(resolve(root, path), "utf8");
    const scene = sceneByPath.get(path);
    const groups = groupsFor(path, sceneByPath);
    return Object.freeze({
      id: path.replace(/\.vkf$/u, "").replaceAll(/[^a-zA-Z0-9]+/gu, "-"),
      title: scene?.title ?? humanTitle(path),
      path,
      groups: Object.freeze(groups),
      kind: runtimeKind(path, groups),
      features: Object.freeze(scene?.features ?? []),
      sourceSha256: sourceSha256(source),
    });
  }));
  examples.sort((left, right) => (
    left.groups.join("/").localeCompare(right.groups.join("/"))
    || left.title.localeCompare(right.title)
    || left.path.localeCompare(right.path)
  ));
  return Object.freeze({ examples: Object.freeze(examples) });
}

export async function writePagesExampleCatalog(repoRoot, outputRoot) {
  const root = filesystemRoot(repoRoot);
  const output = resolve(outputRoot);
  const catalog = await buildReadmeExampleCatalog(root);
  await mkdir(resolve(output, "sources"), { recursive: true });
  for (const example of catalog.examples) {
    const destination = resolve(output, "sources", example.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(root, example.path), destination);
  }
  await writeFile(resolve(output, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return catalog;
}

async function main() {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--output="));
  if (!argument) throw new Error("usage: node tools/build-pages-example-catalog.mjs --output=<directory>");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = resolve(root, argument.slice("--output=".length));
  const catalog = await writePagesExampleCatalog(root, output);
  console.log(`${catalog.examples.length} README examples written to ${slash(relative(root, output))}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
