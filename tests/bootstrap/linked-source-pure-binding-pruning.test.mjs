import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin");
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);

test("linked modules prune only unused pure literal bindings", () => {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "linked-pure-binding-pruning-"));
  try {
    copyFileSync(
      join(root, "tests", "bootstrap", "fixtures", "linked-pure-binding-module.vkf"),
      join(work, "linked_pure_binding_module.vkf"),
    );
    const source = join(work, "linked-pure-binding-probe.vkf");
    const artifact = join(work, `linked-pure-binding-probe${executableSuffix}`);
    writeFileSync(
      source,
      [
        "fixture: .linked_pure_binding_module",
        ":: fixture.referenced_value",
        "",
      ].join("\n"),
      "utf8",
    );

    const compiled = spawnSync(
      compiler,
      [
        "-b",
        source,
        "-o",
        artifact,
        "--diagnostics",
        "--optimizer-policy",
        "mask-0",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
        windowsHide: true,
      },
    );
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.notEqual(compiled.status, 0, "effectful linked binding was unexpectedly discarded");
    assert.match(compiled.stderr, /unknown direct machine IR call cpu_count/);

    const typed = JSON.parse(
      readFileSync(
        join(work, ".vkfbuild", "linked-pure-binding-probe", "typed-ir.json"),
        "utf8",
      ),
    );
    const linkedNames = typed.body
      .filter((item) => item.kind === "store_binding")
      .map((item) => item.name)
      .filter((name) => name.startsWith("__vkf_module_fixture__"));

    assert.equal(
      linkedNames.some((name) => name.includes("unused_catalog")),
      false,
      `unused pure catalog leaked into executable initialization: ${linkedNames.join(", ")}`,
    );
    assert.ok(
      linkedNames.includes("__vkf_module_fixture__referenced_value"),
      `referenced binding was pruned: ${linkedNames.join(", ")}`,
    );
    assert.ok(
      linkedNames.includes("__vkf_module_fixture__retained_effect"),
      `effectful binding was pruned: ${linkedNames.join(", ")}`,
    );
    assert.ok(
      linkedNames.includes("__vkf_module_fixture__retained_nonliteral"),
      `unknown nonliteral binding was not retained conservatively: ${linkedNames.join(", ")}`,
    );

  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
