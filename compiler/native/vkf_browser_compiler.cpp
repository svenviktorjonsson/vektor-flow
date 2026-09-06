#include "compiler/native/vkf_native_frontend.hpp"
#include "compiler/native/vkf_private_ui_frontend_probe.hpp"
#include "compiler/native/vkf_private_compilation_form.hpp"
#include "compiler/native/vkf_module_snapshots.hpp"
#include "compiler/native/vkf_machine_ir_lowering.hpp"
#include "compiler/native/vkf_test_suite.hpp"
#include "compiler/native/vkf_output_effects.hpp"
#include "compiler/native/vkf_ui_effect_packets.hpp"
#include "compiler/native/vkf_stdout_format.hpp"
#include "compiler/native/vkf_wasm_artifact_manifest.hpp"
#include "compiler/native/vkf_wasm_program_lowering.hpp"
#include "compiler/native/vkf_packaged_module_sources.hpp"

#include <cstdint>
#include <algorithm>
#include <exception>
#include <string>

namespace {
std::string result;
vf::JsonValue typed_ir;
vf::JsonValue execution_ir;
bool compiled = false;
bool ordered_stdout = false;
std::vector<std::uint8_t> program;
}

// This adapter deliberately calls the same frontend as vkf-strict. The
// browser owns byte transport only; language rules stay in the shared library.
extern "C" int vkf_compile_source(const char* source, std::uint32_t length) {
    compiled = false;
    program.clear();
    execution_ir = vf::JsonValue(nullptr);
    try {
        // Match the native driver's source normalization before lexing.
        std::string text(source, length);
        text.erase(std::remove(text.begin(), text.end(), '\r'), text.end());
        const auto tokens = vkf::native_frontend::lex_value(text, "<browser>");
        const auto ast = vkf::native_frontend::parse_value(tokens);
        auto form = vkf::native_frontend::private_compilation::lower_module(
            vkf::module_linker::link_packaged_modules(ast, "<browser>"));
        typed_ir = std::move(form.canonical_ir);
        execution_ir = std::move(form.execution_ir);
        compiled = true;
        vf::JsonValue::Object response;
        response["ok"] = vf::JsonValue(true);
        response["typed_ir"] = typed_ir;
#ifdef VKF_PRIVATE_UI_EFFECTS_TEST_PROBE
        response["execution_ir"] = execution_ir.is_null() ? typed_ir : execution_ir;
#endif
        result = vf::json_stringify(vf::JsonValue(std::move(response)), -1);
        return 0;
    } catch (const std::exception& error) {
        vf::JsonValue::Object response;
        response["ok"] = vf::JsonValue(false);
        response["message"] = vf::JsonValue(error.what());
        result = vf::json_stringify(vf::JsonValue(std::move(response)), -1);
        return 1;
    }
}

extern "C" int vkf_emit_program() {
    program.clear();
    try {
        if (!compiled) throw std::runtime_error("No successfully compiled VKF source");
        const auto& runtime_ir = execution_ir.is_null() ? typed_ir : execution_ir;
        const auto captured = vkf::module_snapshots::capture_module_literal_snapshots(runtime_ir);
        const auto& prepared = captured ? *captured : runtime_ir;
        ordered_stdout = vkf::output_effects::has_nested_output_effect(prepared);
        const auto stored_closures = vkf::machine_ir::specialize_stored_closures(prepared);
        const auto& closure_prepared = stored_closures ? *stored_closures : prepared;
        const auto immediate_closures =
            vkf::machine_ir::specialize_immediate_closures(closure_prepared);
        const auto& callable_prepared = immediate_closures
            ? *immediate_closures : closure_prepared;
        const auto module = vkf::wasm::lower_program_entry(callable_prepared);
        const auto bytecode = vkf::wasm::bytecode::lower_typed_module_to_bytecode(module);
        vkf::wasm::vm::EmitterOptions emitter_options;
        emitter_options.arena_capacity = 64U * 1024U * 1024U;
        const auto emitted = vkf::wasm::vm::emit(bytecode, emitter_options);
        vf::JsonValue::Object response;
        response["ok"] = vf::JsonValue(true);
        response["manifest"] = vkf::wasm::manifest_value(module, bytecode, emitted, "program.wasm");
        program = emitted.wasm;
        result = vf::json_stringify(vf::JsonValue(std::move(response)), -1);
        return 0;
    } catch (const std::exception& error) {
        vf::JsonValue::Object response;
        response["ok"] = vf::JsonValue(false);
        response["message"] = vf::JsonValue(error.what());
        result = vf::json_stringify(vf::JsonValue(std::move(response)), -1);
        return 1;
    }
}

// Internal test-host transport. Selection and generated entry source are the
// same implementation used by vkf-strict -t, not a browser-specific test parser.
extern "C" int vkf_describe_tests(const char* source, std::uint32_t length,
                                 const char* identity, std::uint32_t identity_length) {
    try {
        const std::string text(source, length);
        const auto expected = vkf::testing::expected_compile_error(text);
        vf::JsonValue::Array tests;
        if (!expected) {
            for (const auto& test : vkf::testing::discover_tests(text, std::string(identity, identity_length))) {
                tests.emplace_back(vf::JsonValue::Object{
                    {"name", test.name}, {"compatible", test.compatible},
                    {"incompatibility", test.incompatibility},
                    {"source", vkf::testing::test_entry_source(text, test.name)}});
            }
        }
        result = vf::json_stringify(vf::JsonValue::Object{
            {"ok", true}, {"expectedCompileError", expected ? vf::JsonValue(*expected) : vf::JsonValue(nullptr)},
            {"source", vkf::testing::normalized_source(text)}, {"tests", std::move(tests)}}, -1);
        return 0;
    } catch (const std::exception& error) {
        result = vf::json_stringify(vf::JsonValue::Object{{"ok", false}, {"message", error.what()}}, -1);
        return 1;
    }
}

extern "C" int vkf_select_test_files(const char* paths, std::uint32_t length) {
    try {
        const auto request = vf::parse_json(std::string(paths, length));
        if (!request.is_array()) throw std::runtime_error("test paths must be an array");
        std::vector<std::string> files;
        for (const auto& file : request.as_array()) {
            if (!file.is_string()) throw std::runtime_error("test path must be a string");
            files.push_back(file.as_string());
        }
        vf::JsonValue::Array selected;
        for (const auto& file : vkf::testing::select_test_source_files(files)) selected.emplace_back(file);
        result = vf::json_stringify(vf::JsonValue::Object{{"ok", true}, {"files", std::move(selected)}}, -1);
        return 0;
    } catch (const std::exception& error) {
        result = vf::json_stringify(vf::JsonValue::Object{{"ok", false}, {"message", error.what()}}, -1);
        return 1;
    }
}

extern "C" int vkf_format_stdout(const std::uint8_t* memory, std::uint32_t length,
                                 std::uint32_t output_pointer) {
    try {
        if (!compiled || program.empty()) throw std::runtime_error("No successfully compiled VKF program");
        const auto output = vkf::stdout_format::format_console(memory, length, output_pointer, ordered_stdout);
        result = vf::json_stringify(vf::JsonValue::Object{{"ok", true}, {"stdout", output}}, -1);
        return 0;
    } catch (const std::exception& error) {
        result = vf::json_stringify(vf::JsonValue::Object{{"ok", false}, {"message", error.what()}}, -1);
        return 1;
    }
}

#ifdef VKF_PRIVATE_UI_EFFECTS_TEST_PROBE
extern "C" int vkf_format_ui_packets(const std::uint8_t* memory, std::uint32_t length,
                                      std::uint32_t output_pointer,
                                      double width, double height) {
    try {
        result = vf::json_stringify(vf::JsonValue::Object{
            {"ok", true}, {"packets", vkf::ui_effect_packets::extract(
                memory, length, output_pointer, width, height)}}, -1);
        return 0;
    } catch (const std::exception& error) {
        result = vf::json_stringify(vf::JsonValue::Object{
            {"ok", false}, {"message", error.what()}}, -1);
        return 1;
    }
}
#endif

extern "C" const std::uint8_t* vkf_program_pointer() { return program.data(); }
extern "C" std::uint32_t vkf_program_length() {
    return static_cast<std::uint32_t>(program.size());
}

extern "C" const char* vkf_result_pointer() { return result.data(); }
extern "C" std::uint32_t vkf_result_length() {
    return static_cast<std::uint32_t>(result.size());
}

#ifdef VKF_BROWSER_COMPILER_PROBE
#include <iostream>
#include <iterator>
int main() {
    const std::string source{std::istreambuf_iterator<char>(std::cin), {}};
    vkf_compile_source(source.data(), static_cast<std::uint32_t>(source.size()));
    std::cout << result;
}
#endif
