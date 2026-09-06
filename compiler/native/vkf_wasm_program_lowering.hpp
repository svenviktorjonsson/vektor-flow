#pragma once

#include "compiler/native/vkf_wasm_typed_ir.hpp"

#include <deque>
#include <map>
#include <set>

namespace vkf::wasm {

namespace program_lowering_detail {

inline void collect_function_loads(
    const vf::JsonValue& value,
    const std::map<std::string, std::size_t>& functions,
    std::set<std::string>& discovered,
    std::deque<std::string>& pending
) {
    if (value.is_array()) {
        for (const auto& child : value.as_array()) {
            collect_function_loads(child, functions, discovered, pending);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    const auto name = object.find("name");
    if (kind != object.end() && kind->second.is_string()
        && kind->second.as_string() == "load"
        && name != object.end() && name->second.is_string()
        && functions.count(name->second.as_string())
        && discovered.insert(name->second.as_string()).second) {
        pending.push_back(name->second.as_string());
    }
    for (const auto& [field, child] : object) {
        (void)field;
        collect_function_loads(child, functions, discovered, pending);
    }
}

} // namespace program_lowering_detail

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
    std::map<std::string, std::size_t> function_indices;
    for (std::size_t index = 0; index < declarations.size(); ++index) {
        const auto& declaration = detail::require_object(
            declarations[index], "program declaration");
        if (detail::require_non_empty_string(
                declaration, "kind", "program declaration") == "function") {
            function_indices.emplace(detail::require_non_empty_string(
                declaration, "name", "program function"), index);
        }
    }
    std::set<std::string> reachable;
    std::deque<std::string> pending;
    program_lowering_detail::collect_function_loads(
        vf::JsonValue(statements), function_indices, reachable, pending);
    while (!pending.empty()) {
        const auto name = std::move(pending.front());
        pending.pop_front();
        program_lowering_detail::collect_function_loads(
            declarations[function_indices.at(name)],
            function_indices, reachable, pending);
    }
    vf::JsonValue::Array reachable_declarations;
    reachable_declarations.reserve(declarations.size() + 1);
    for (auto& declaration_value : declarations) {
        const auto& declaration = detail::require_object(
            declaration_value, "program declaration");
        const auto kind = detail::require_non_empty_string(
            declaration, "kind", "program declaration");
        if (kind != "function" || reachable.count(detail::require_non_empty_string(
                declaration, "name", "program function"))) {
            reachable_declarations.push_back(std::move(declaration_value));
        }
    }
    statements.emplace_back(vf::JsonValue::Object{
        {"kind", "expr_stmt"}, {"expr", vf::JsonValue::Object{{"kind", "wasm_output_values"}}}});
    reachable_declarations.emplace_back(vf::JsonValue::Object{
        {"kind", "function"}, {"name", "$vkf_main"}, {"type", "() -> list<any>"},
        {"params", vf::JsonValue::Array{}}, {"return_type", "list<any>"},
        {"body", vf::JsonValue::Object{{"kind", "block"}, {"body", std::move(statements)}}}});
    root["body"] = vf::JsonValue(std::move(reachable_declarations));
    auto module = parse_typed_module(vf::JsonValue(std::move(root)));
    // Inference consumes the canonical program, not private output opcodes
    // inserted into $vkf_main. Preserve the caller's prepared snapshots.
    module.inference_source = typed_ir;
    return module;
}

} // namespace vkf::wasm
