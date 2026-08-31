import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const examples = [
  "material_ui_gallery",
  "ui_plot_card",
  "ui_status_board",
];

test("several shipped UI examples use ordinary add with separate script-free HTML and CSS", async () => {
  for (const name of examples) {
    const root = path.join(repositoryRoot, "examples", name);
    const [source, html, css] = await Promise.all([
      readFile(path.join(root, "app.vkf"), "utf8"),
      readFile(path.join(root, "ui", "main.html"), "utf8"),
      readFile(path.join(root, "ui", "theme.css"), "utf8")
        .catch(() => readFile(path.join(root, "ui", "gallery.css"), "utf8")),
    ]);
    assert.match(source, /\b[a-z_][a-z0-9_]*\.add\s*\(/u, `${name} ordinary add`);
    assert.match(source, /\.load\s*\(\s*"ui\/main\.html"\s*\)/u, `${name} static HTML load`);
    assert.match(html, /<link\b[^>]*rel="stylesheet"/u, `${name} stylesheet link`);
    assert.doesNotMatch(html, /<script\b|\son[a-z]+\s*=/iu, `${name} authored HTML must be script-free`);
    assert.ok(css.trim().length > 0, `${name} separate CSS must not be empty`);
  }
});

test("portable package inputs include the shipped UI example source trees", async () => {
  const [manifest, windowsPackaging] = await Promise.all([
    readFile(path.join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "scripts", "package-native-release.ps1"), "utf8"),
  ]);
  for (const name of examples) {
    assert.ok(manifest.files.includes(`examples/${name}`), `${name} npm archive input`);
    assert.match(windowsPackaging, new RegExp(`examples/${name}`, "u"), `${name} Windows archive input`);
  }
  assert.match(windowsPackaging, /Copy-Item[^\n]+-Recurse/u);
});
