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
      const unused = row === 123 ? "u".repeat(1_200_000) : `unused-payload-${row}`;
      rows.push(`${row},${row + 1},${2 * row + 3},${unused}`);
    }
    writeFileSync(csv, `${rows.join("\n")}\n`, "utf8");

    const sourcePath = csv.replaceAll("\\", "/").replaceAll('"', '\\"');
    const source = join(work, "public-csv-lazy.vkf");
    const artifact = join(work, `public-csv-lazy${suffix}`);
    writeFileSync(source, [
      `weather: data.load("${sourcePath}")`,
      "signal: (weather.x * 2 - weather.y) ^ 2",
      "answer: stat.sum(signal)",
      ":: answer",
    ].join("\n"), "utf8");

    assert.ok(nativeDriver, "VKF_NATIVE_DRIVER must name the focused strict native driver");
    const compiled = spawnSync(nativeDriver, ["-b", source, "-o", artifact, "--diagnostics"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(compiled.error, undefined, `failed to start compiler: ${compiled.error}`);
    assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
    assert.equal(existsSync(artifact), true, "native CSV demand executor emitted no artifact");
    const executed = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(executed.error, undefined, `failed to start artifact: ${executed.error}`);
    assert.equal(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
    assert.equal(executed.stdout.trim(), "20000");
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
    const machine = JSON.parse(readFileSync(
      join(work, ".vkfbuild", "public-csv-lazy", "machine-ir.json"),
      "utf8",
    ));
    const csvPlan = machine.entry.instructions.find(
      ({ kind, symbol }) => kind === "call" && symbol === "$internal.csv_project_transform_sum",
    );
    assert.equal(csvPlan.argument_count, 0);
    assert.equal(csvPlan.result_count, 1);
    assert.ok(machine.string_bytes < 4096, "Machine CSV demand plan grew with payload");
    assert.equal(
      readFileSync(artifact).includes(Buffer.from("u".repeat(32_768))),
      false,
      "unused CSV column payload leaked into the native artifact",
    );

    writeFileSync(csv, `${rows.slice(0, -1).join("\n")}\n`, "utf8");
    const truncated = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(truncated.error, undefined, `failed to rerun artifact: ${truncated.error}`);
    assert.notEqual(truncated.status, 0, "truncated CSV silently returned a partial reduction");
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
