#pragma once

#include "compiler/native/vkf_wasm_typed_ir.hpp"

namespace vkf::wasm {

// Program statements execute in order in a compiler-private entry function.
// This consumes canonical typed IR; it never inspects or rewrites VKF source.
inline TypedModule lower_program_entry(const vf::JsonValue& typed_ir) {
    auto root = detail::require_object(typed_ir, "typed IR root");
    const auto& source_body = detail::require_array(
        detail::require_field(root, "body", "typed_module"), "typed_module.body");
    vf::JsonValue::Array declarations;
    vf::JsonValue::Array statements;
    statements.emplace_back(vf::JsonValue::Object{
        {"kind", "expr_stmt"}, {"expr", vf::JsonValue::Object{{"kind", "wasm_output_reset"}}}});
    for (const auto& item : source_body) {
        const auto& declaration = detail::require_object(item, "typed_module.body item");
        const auto kind = detail::require_non_empty_string(declaration, "kind", "typed_module.body item");
        // Imports have already been resolved by the shared module linker and
        // frontend. Like native lowering, retain no runtime import operation.
        if (kind == "module_import") continue;
        if (kind == "function" || kind == "type_alias") declarations.push_back(item);
        else statements.push_back(item);
    }
    statements.emplace_back(vf::JsonValue::Object{
        {"kind", "expr_stmt"}, {"expr", vf::JsonValue::Object{{"kind", "wasm_output_values"}}}});
    declarations.emplace_back(vf::JsonValue::Object{
        {"kind", "function"}, {"name", "$vkf_main"}, {"type", "() -> list<any>"},
        {"params", vf::JsonValue::Array{}}, {"return_type", "list<any>"},
        {"body", vf::JsonValue::Object{{"kind", "block"}, {"body", std::move(statements)}}}});
    root["body"] = vf::JsonValue(std::move(declarations));
    auto module = parse_typed_module(vf::JsonValue(std::move(root)));
    // Inference consumes the canonical program, not private output opcodes
    // inserted into $vkf_main. Preserve the caller's prepared snapshots.
    module.inference_source = typed_ir;
    return module;
}

} // namespace vkf::wasm
