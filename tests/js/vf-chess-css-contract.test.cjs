const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const css = fs.readFileSync(path.join(root, "web", "vf-ui", "vf-chess.css"), "utf8");

assert.ok(css.includes(".vf-chess-mode select option"));
assert.ok(css.includes("background: #151821;"));
assert.ok(css.includes("color: #fff4dd;"));
assert.ok(css.includes("place-self: stretch;"));
assert.ok(css.includes("width: 100%;"));
assert.ok(css.includes("height: 100%;"));
assert.ok(!css.includes("aspect-ratio: 1 / 1;"));

console.log("vf-chess css contract tests passed");
