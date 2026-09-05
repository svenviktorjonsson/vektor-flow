import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const build = await mkdtemp(path.join(root, "build/packaged-modules-test-"));
const generator = path.join(root, "tools/build-packaged-stdlib.mjs");
function generate(directory) {
  const result = spawnSync(process.execPath, [generator, `--output=${directory}`],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
}

test("packaged canonical stdlib sources rebuild deterministically with exact source hashes", async () => {
  generate(build);
  const header = await readFile(path.join(build, "vkf_packaged_stdlib.generated.hpp"));
  const manifest = await readFile(path.join(build, "vkf_packaged_stdlib.manifest.json"));
  const knownTime = new Date("2000-01-01T00:00:00Z");
  for (const name of ["vkf_packaged_stdlib.generated.hpp", "vkf_packaged_stdlib.manifest.json"]) {
    await utimes(path.join(build, name), knownTime, knownTime);
  }
  generate(build);
  assert.deepEqual(await readFile(path.join(build, "vkf_packaged_stdlib.generated.hpp")), header);
  assert.deepEqual(await readFile(path.join(build, "vkf_packaged_stdlib.manifest.json")), manifest);
  for (const name of ["vkf_packaged_stdlib.generated.hpp", "vkf_packaged_stdlib.manifest.json"]) {
    assert.equal((await stat(path.join(build, name))).mtimeMs, knownTime.getTime(),
      "unchanged generation must preserve timestamps for incremental builds");
  }
  const report = JSON.parse(manifest);
  assert.ok(report.modules.some((entry) => entry.module === "math"));
  assert.ok(report.modules.some((entry) => entry.module === "physics.units.si"));
  assert.ok(report.modules.every((entry) => !entry.source.includes("smoke")));
  for (const entry of report.modules) {
    const source = (await readFile(path.join(root, "compiler/self_hosted/stdlib", entry.source), "utf8"))
      .replaceAll("\r", "");
    assert.equal(entry.sha256, createHash("sha256").update(source).digest("hex"));
    assert.equal(entry.bytes, Buffer.byteLength(source));
  }
  const checked = spawnSync(process.execPath, [generator, `--output=${build}`, "--check"],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(checked.status, 0, checked.stderr);
  await writeFile(path.join(build, "vkf_packaged_stdlib.generated.hpp"), Buffer.concat([header, Buffer.from("\n")]));
  const stale = spawnSync(process.execPath, [generator, `--output=${build}`, "--check"],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /Stale packaged stdlib/u);
  generate(build);
});

test("the packaged provider links canonical math source identically to native without host files", async () => {
  generate(build);
  const cpp = path.join(build, "probe.cpp");
  const probe = path.join(build, "probe");
  await writeFile(cpp, String.raw`
#include "compiler/native/vkf_packaged_module_sources.hpp"
#include <iostream>
#include <iterator>
int main() {
    try {
        const std::string source(std::istreambuf_iterator<char>(std::cin), {});
        const auto tokens = vkf::native_frontend::lex_value(source, "<browser>");
        const auto ast = vkf::native_frontend::parse_value(tokens);
        const auto linked = vkf::module_linker::link_packaged_modules(ast, "<browser>");
        std::cout << vf::json_stringify(vkf::native_frontend::lower_value(linked), -1);
    } catch (const std::exception& error) {
        std::cerr << error.what();
        return 1;
    }
}
`);
  const objects = path.join(root, "build/native-compiler-docker/CMakeFiles/vkf_strict.dir");
  const compilation = spawnSync(process.env.CXX ?? "g++", [
    "-std=c++17", "-O0", `-I${root}`, `-I${path.join(root, "native/VfOverlay")}`, `-I${build}`, cpp,
    ...["vkf_lexer_cursor_smoke.cpp.o", "vkf_parser_token_stream_smoke.cpp.o", "vkf_ast_to_ir_smoke.cpp.o",
      "vkf_csv_demand_source_scanner.cpp.o", "src/native/VfOverlay/vf/json.cpp.o"].map((file) => path.join(objects, file)),
    "-o", probe,
  ], { encoding: "utf8", timeout: 120_000 });
  assert.equal(compilation.status, 0, compilation.stderr);
  const nativeSource = path.join(build, "main.vkf");
  for (const [source, stdout] of [
    ["m: .math\n:: m.log(8, 2)\n", "3\n"],
    ["l: .linalg\n:: l.dot([1, 2], [3, 4])\n", "11\n"],
  ]) {
    const actual = spawnSync(probe, [], { input: source, encoding: "utf8", timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024 });
    assert.equal(actual.status, 0, actual.stderr);
    await writeFile(nativeSource, source);
    const native = spawnSync(process.env.VKF_NATIVE_COMPILER
      ?? path.join(root, "build/native-compiler-docker/bin/vkf-strict"),
    ["--diagnostics", nativeSource], { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr);
    assert.ok(native.stdout.startsWith(stdout), native.stdout);
    const expected = JSON.parse(await readFile(path.join(build, ".vkfbuild/main/typed-ir.json"), "utf8"));
    assert.deepEqual(JSON.parse(actual.stdout), expected);
  }
  const missing = spawnSync(probe, [], { input: "absent: .unknown_module\n", encoding: "utf8", timeout: 30_000 });
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, "could not resolve linked module import absent");
});
