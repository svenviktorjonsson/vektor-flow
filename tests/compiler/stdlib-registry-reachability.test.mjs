import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeDriver = process.env.VKF_NATIVE_DRIVER;
const workRoot = path.join(repositoryRoot, ".work", `stdlib-registry-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

test("strict release rejects a known unavailable stdlib through the retained registry query", async () => {
  assert.ok(nativeDriver, "VKF_NATIVE_DRIVER must name the focused strict native driver");
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "events.vkf");
  const artifact = path.join(workRoot, "events.exe");
  await writeFile(source, ": .events\nvalue: 1\n", "utf8");

  const result = spawnSync(nativeDriver, ["-b", source, "-o", artifact], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  const diagnostic = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, "unavailable events module unexpectedly compiled");
  assert.match(
    diagnostic,
    /stdlib module 'events' is not included in the strict native release/u,
  );
});

test("stdlib registry retains no uncalled native-availability wrapper", async () => {
  const registry = await readFile(
    path.join(repositoryRoot, "compiler", "native", "vkf_stdlib_registry.hpp"),
    "utf8",
  );

  assert.match(registry, /inline bool known_but_unavailable\(/u);
  assert.doesNotMatch(registry, /inline bool native_release_available\(/u);
});
