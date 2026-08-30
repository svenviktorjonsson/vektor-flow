import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const nativeDriver = process.env.VKF_NATIVE_DRIVER;
const suffix = process.platform === "win32" ? ".exe" : "";

function binding(module, name) {
  const statement = module.body.find(
    ({ kind, name: candidate }) => kind === "store_binding" && candidate === name,
  );
  assert.ok(statement, `missing store binding ${name}`);
  return statement.value;
}

test("public data.load binds header columns lazily through a demanded projection", () => {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(repositoryRoot, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "public-csv-lazy-"));
  try {
    const csv = join(work, "fixture.csv");
    const rows = ["row_id,x,y,unused"];
    for (let row = 0; row < 20_000; row += 1) {
      rows.push(`${row},${row + 1},${2 * row + 3},unused-payload-${row}`);
    }
    writeFileSync(csv, `${rows.join("\n")}\n`, "utf8");

    const sourcePath = csv.replaceAll("\\", "/").replaceAll('"', '\\"');
    const source = join(work, "public-csv-lazy.vkf");
    const artifact = join(work, `public-csv-lazy${suffix}`);
    writeFileSync(source, [
      `weather: data.load("${sourcePath}")`,
      "signal: (weather.x * 2 - weather.y) ^ 2",
      "answer: stat.sum(signal)",
    ].join("\n"), "utf8");

    assert.ok(nativeDriver, "VKF_NATIVE_DRIVER must name the focused strict native driver");
    const compiled = spawnSync(nativeDriver, ["-b", source, "-o", artifact, "--diagnostics"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(compiled.error, undefined, `failed to start compiler: ${compiled.error}`);
    assert.notEqual(
      compiled.status,
      0,
      "the native CSV demand executor landed; replace this frontend boundary with execution evidence",
    );
    assert.equal(existsSync(artifact), false, "unsupported CSV execution emitted an artifact");
    const typed = JSON.parse(readFileSync(
      join(work, ".vkfbuild", "public-csv-lazy", "typed-ir.json"),
      "utf8",
    ));

    const weather = binding(typed, "weather");
    assert.equal(weather.kind, "csv_lazy_record");
    assert.equal(weather.type, "record{row_id:[any],x:[any],y:[any],unused:[any]}");
    assert.equal(weather.row_count, 20_000);
    assert.deepEqual(weather.fields.map(({ name }) => name), ["row_id", "x", "y", "unused"]);
    for (const [index, field] of weather.fields.entries()) {
      assert.equal(field.value.kind, "csv_lazy_column");
      assert.equal(field.value.column, index);
      assert.equal(field.value.type, "[any]");
      assert.equal(field.value.row_count, 20_000);
      assert.equal("items" in field.value, false, "lazy column unexpectedly embeds payload");
    }

    const signal = binding(typed, "signal");
    assert.equal(signal.type, "[any]");
    assert.deepEqual(
      [...JSON.stringify(signal).matchAll(/"field":"([^"]+)"/gu)].map((match) => match[1]),
      ["x", "y"],
    );
    assert.equal(binding(typed, "answer").type, "num");
    assert.ok(JSON.stringify(typed).length < 16_384, "typed demand plan grew with CSV payload");
    assert.doesNotMatch(JSON.stringify(typed), /unused-payload-19999/u);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
