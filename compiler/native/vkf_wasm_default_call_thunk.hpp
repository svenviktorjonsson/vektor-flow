#pragma once

#include "compiler/native/vkf_call_binding_plan.hpp"
#include "compiler/native/vkf_wasm_typed_ir.hpp"

namespace vkf::wasm {

// Existing contract: language-guide.md:719 and tests/vkf/calls.vkf:13-20.
// Missing defaults use earlier callee parameters; supplied parameters skip
// defaults. This pure constructor only creates one private function using
// existing IR nodes. It is not wired into compilation and executes no values.
// No public syntax/schema/API/ABI or argument-evaluation-order change.
inline FunctionDeclaration make_default_call_thunk(
    const FunctionDeclaration& original,
    const call_binding::FixedCallPlan& plan,
    const std::string& private_name
) {
    const auto& declaration = detail::require_object(original.declaration, original.name);
    const auto& parameters = detail::require_array(
        detail::require_field(declaration, "params", original.name), original.name);
    if (parameters.size() != plan.parameters.size()) {
        throw std::logic_error("default-call plan parameter count mismatch");
    }
    vf::JsonValue::Array supplied_parameters;
    vf::JsonValue::Array body;
    vf::JsonValue::Array final_arguments;
    vf::JsonValue::Array final_spreads;
    std::string type = "(";
    for (std::size_t index = 0; index < parameters.size(); ++index) {
        auto parameter = detail::require_object(parameters[index], original.name);
        const auto name = detail::require_non_empty_string(parameter, "name", original.name);
        const auto original_type = detail::require_non_empty_string(parameter, "type", original.name);
        const auto variadic = parameter.find("variadic_positional");
        const bool packed_positional = variadic != parameter.end() && variadic->second.is_boolean() && variadic->second.as_boolean();
        const auto parameter_type = packed_positional ? "list<" + original_type + ">" : original_type;
        if (plan.parameters[index]) {
            if (!supplied_parameters.empty()) type += ",";
            type += parameter_type;
            parameter["default"] = vf::JsonValue(nullptr);
            if (packed_positional) {
                // The wrapper receives the already packed list as one value.
                // Its final source-equivalent call spreads that list once.
                parameter["type"] = vf::JsonValue(parameter_type);
                parameter["variadic_positional"] = vf::JsonValue(false);
            }
            supplied_parameters.emplace_back(std::move(parameter));
        } else {
            const auto& default_value = detail::require_field(parameter, "default", original.name);
            if (default_value.is_null()) throw std::logic_error("default-call thunk has a required parameter hole");
            body.emplace_back(vf::JsonValue::Object{{"kind", "store_binding"},
                {"name", name}, {"type", parameter_type}, {"update", false}, {"value", default_value}});
        }
        auto& final_values = packed_positional ? final_spreads : final_arguments;
        final_values.emplace_back(vf::JsonValue::Object{{"kind", "load"},
            {"name", name}, {"type", parameter_type}});
    }
    const auto return_type = detail::require_non_empty_string(declaration, "return_type", original.name);
    type += ") -> " + return_type;
    body.emplace_back(vf::JsonValue::Object{{"kind", "expr_stmt"},
        {"expr", vf::JsonValue::Object{{"kind", "call"},
            {"callee", vf::JsonValue::Object{{"kind", "load"}, {"name", original.name}, {"type", original.type}}},
            {"args", std::move(final_arguments)}, {"named_args", vf::JsonValue::Array{}},
            {"spread_args", std::move(final_spreads)}, {"type", return_type}}}});
    vf::JsonValue thunk(vf::JsonValue::Object{{"kind", "function"}, {"name", private_name},
        {"type", type}, {"params", std::move(supplied_parameters)}, {"return_type", return_type},
        {"body", vf::JsonValue::Object{{"kind", "block"}, {"body", std::move(body)}}}});
    return {private_name, type, std::move(thunk), original.source_index};
}

} // namespace vkf::wasm
