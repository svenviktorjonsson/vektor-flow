import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);

test("fixed aggregate concat owns nested strings returned from a function", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i115-fixed-aggregate-concat-"));
  try {
    const source = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(source, [
      "Item: (name:str, value:num)",
      "",
      "append_item(items:[Item:1], item:Item):",
      "    items & [item]",
      "",
      "Item first: (name:\"alpha\", value:42)",
      "Item second: (name:\"beta\", value:7)",
      "items: append_item([first], second)",
      ":: items.(0).name",
      ":: items.(1).name",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(
      compiler, ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, `status ${executed.status}: ${executed.stderr}`);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), ["alpha", "beta"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
