import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readmePath = resolve(root, "README.md");
const manifestPath = resolve(root, "examples", "scene_gallery", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function card(example, index) {
  const sourcePath = `examples/scene_gallery/${example.source}`;
  const source = readFileSync(resolve(root, sourcePath), "utf8")
    .replaceAll("\r\n", "\n")
    .trimEnd();
  const title = example.title;
  return `<!-- scene-example:${example.id}:start -->
### ${String(index + 1).padStart(2, "0")} · [${title}](${sourcePath})

\`\`\`vkf
${source}
\`\`\`

[![${title} full-compositor capture](${example.media.path})](${example.media.path})
<!-- scene-example:${example.id}:end -->`;
}

const gallery = `<!-- scene-gallery:start -->
## Scene example gallery

These 20 complete programs are deliberately small: each source is followed by
its result, and each heading opens the executable source. The checked-in
[capture manifest](examples/scene_gallery/manifest.json) hash-locks every source
and PNG.

Every PNG is a full composited viewport captured with DevTools
\`Page.captureScreenshot\` from a hidden Edge \`--headless=new\` session after
the requested frame became ready. The capture includes frame chrome and the
WebGPU canvas, plus static HTML/CSS where an example loads them; it is not a
renderer-only illustration. Application behavior remains compiled VKF and uses
no application JavaScript.

${manifest.examples.map(card).join("\n\n")}
<!-- scene-gallery:end -->`;

const original = readFileSync(readmePath, "utf8");
const newline = original.includes("\r\n") ? "\r\n" : "\n";
const rendered = gallery.replaceAll("\n", newline);
const start = "<!-- scene-gallery:start -->";
const end = "<!-- scene-gallery:end -->";
let updated;

if (original.includes(start)) {
  const startIndex = original.indexOf(start);
  const endIndex = original.indexOf(end, startIndex);
  if (endIndex < 0) throw new Error(`README is missing ${end}`);
  updated = original.slice(0, startIndex)
    + rendered
    + original.slice(endIndex + end.length);
} else {
  const installIndex = original.indexOf("## Install VKF");
  if (installIndex < 0) throw new Error("README is missing its install section");
  updated = original.slice(0, installIndex)
    + rendered
    + newline.repeat(2)
    + original.slice(installIndex);
}

if (process.argv.includes("--check")) {
  if (updated !== original) {
    console.error("README scene gallery is stale; run node tools/update-scene-gallery-readme.mjs");
    process.exitCode = 1;
  }
} else if (updated !== original) {
  writeFileSync(readmePath, updated);
}
