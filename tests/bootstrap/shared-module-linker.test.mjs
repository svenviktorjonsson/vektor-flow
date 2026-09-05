import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const build = await mkdtemp(path.join(root, "build/module-linker-test-"));
const probe = path.join(build, "probe");
const cpp = path.join(build, "probe.cpp");
await writeFile(cpp, String.raw`
#include "compiler/native/vkf_module_linker.hpp"
#include "compiler/native/vkf_native_frontend.hpp"
#include <algorithm>
#include <iostream>
#include <iterator>
int main() {
    try {
        const std::string input(std::istreambuf_iterator<char>(std::cin), {});
        const auto request = vf::parse_json(input).as_object();
        const auto& sources = request.at("sources").as_object();
        const auto parse = [&](const std::string& name) {
            std::string source = sources.at(name).as_string();
            source.erase(std::remove(source.begin(), source.end(), '\r'), source.end());
            return vkf::native_frontend::parse_value(vkf::native_frontend::lex_value(source, name));
        };
        vkf::module_linker::SourceProvider provider;
        provider.resolve = [&](const std::string&, const std::string& module) -> std::optional<std::string> {
            std::string name = module;
            std::replace(name.begin(), name.end(), '.', '/');
            name += ".vkf";
            return sources.count(name) ? std::optional<std::string>(name) : std::nullopt;
        };
        provider.parse = parse;
        provider.canonical = [](const std::string& source) { return source; };
        const auto ast = vkf::module_linker::Linker(provider).link(parse("main.vkf"), "main.vkf");
        vf::JsonValue::Object response;
        response["ast"] = ast;
        response["typed_ir"] = vkf::native_frontend::lower_value(ast);
        std::cout << vf::json_stringify(vf::JsonValue(response), -1);
    } catch (const std::exception& error) {
        vf::JsonValue::Object response;
        response["error"] = error.what();
        std::cout << vf::json_stringify(vf::JsonValue(response), -1);
    }
}
`);

const objects = path.join(root, "build/native-compiler-docker/CMakeFiles/vkf_strict.dir");
const compilation = spawnSync(process.env.CXX ?? "g++", [
  "-std=c++17", "-O0", `-I${root}`, `-I${path.join(root, "native/VfOverlay")}`, cpp,
  ...["vkf_lexer_cursor_smoke.cpp.o", "vkf_parser_token_stream_smoke.cpp.o",
    "vkf_ast_to_ir_smoke.cpp.o", "vkf_csv_demand_source_scanner.cpp.o",
    "src/native/VfOverlay/vf/json.cpp.o"].map((file) => path.join(objects, file)),
  "-o", probe,
], { encoding: "utf8", timeout: 120_000 });

function linked(sources) {
  assert.equal(compilation.status, 0, compilation.stderr ?? compilation.error?.message);
  const result = spawnSync(probe, [], { input: JSON.stringify({ sources }), encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("an in-memory stdlib import uses the same linked typed IR as the native CLI", async () => {
  const source = await readFile(path.join(root, "examples/generated/readme/stdlib/01-math.vkf"), "utf8");
  const math = await readFile(path.join(root, "compiler/self_hosted/stdlib/math.vkf"), "utf8");
  const nativeSource = path.join(build, "main.vkf");
  await writeFile(nativeSource, source);
  const native = spawnSync(process.env.VKF_NATIVE_COMPILER
    ?? path.join(root, "build/native-compiler-docker/bin/vkf-strict"),
  ["--diagnostics", nativeSource], { encoding: "utf8", timeout: 30_000 });
  assert.equal(native.status, 0, native.stderr);
  assert.ok(native.stdout.startsWith("9\n1\n3\n"), native.stdout);
  const actual = linked({ "main.vkf": source, "math.vkf": math });
  assert.equal(actual.error, undefined, actual.error);
  const expected = JSON.parse(await readFile(path.join(build, ".vkfbuild/main/typed-ir.json"), "utf8"));
  assert.deepEqual(actual.typed_ir, expected);
});

test("source-defined dependencies precede importers and preserve default argument calls", () => {
  const actual = linked({
    "main.vkf": "outer: .outer\n:: outer.result()\n",
    "outer.vkf": "inner: .inner\nresult() -> num: inner.value()\n",
    "inner.vkf": "value(x:num=7) -> num: x\n",
  });
  assert.equal(actual.error, undefined, actual.error);
  const functions = actual.ast.body.filter((item) => item.kind === "function_definition").map((item) => item.name);
  assert.deepEqual(functions, ["__vkf_module_inner__value", "__vkf_module_outer__result"]);
});

test("missing aliased imports retain source-order diagnostics without substitution", () => {
  for (const [first, second] of [["first", "second"], ["second", "first"]]) {
    const actual = linked({ "main.vkf": `${first}: .${first}\n${second}: .${second}\n` });
    assert.equal(actual.error, `could not resolve linked module import ${first}`);
  }
});
