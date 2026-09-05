#pragma once

#include "native/VfOverlay/vf/json.hpp"

#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>

// Target-independent, definition-time snapshots of literal module bindings.
// This is the native compiler's existing pass, shared without changing semantics.
namespace vkf::module_snapshots {
namespace detail {
inline const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) throw std::runtime_error("expected object in " + context);
    return value.as_object();
}
inline const vf::JsonValue& field(const vf::JsonValue::Object& object,
                                  const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) throw std::runtime_error("missing " + name + " in " + context);
    return found->second;
}
inline std::string string_field(const vf::JsonValue::Object& object,
                                const std::string& name, const std::string& context) {
    const auto& value = field(object, name, context);
    if (!value.is_string()) throw std::runtime_error("expected string " + name + " in " + context);
    return value.as_string();
}
inline const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) throw std::runtime_error("expected array in " + context);
    return value.as_array();
}
} // namespace detail

inline void substitute_closure_loads(
    vf::JsonValue& value,
    const std::map<std::string, vf::JsonValue>& substitutions
) {
    if (value.is_array()) {
        for (auto& item : value.as_array()) substitute_closure_loads(item, substitutions);
        return;
    }
    if (!value.is_object()) return;
    auto& object = value.as_object();
    const auto kind = object.find("kind");
    const auto name = object.find("name");
    if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "load" &&
        name != object.end() && name->second.is_string()) {
        const auto replacement = substitutions.find(name->second.as_string());
        if (replacement != substitutions.end()) {
            value = replacement->second;
            return;
        }
    }
    for (auto& [field_name, child] : object) {
        (void)field_name;
        substitute_closure_loads(child, substitutions);
    }
}

inline void collect_function_local_names(const vf::JsonValue& value, std::set<std::string>& names) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) collect_function_local_names(item, names);
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    const auto name = object.find("name");
    if (kind != object.end() && kind->second.is_string() &&
        (kind->second.as_string() == "store_binding" || kind->second.as_string() == "function") &&
        name != object.end() && name->second.is_string()) {
        names.insert(name->second.as_string());
    }
    for (const auto& [field_name, child] : object) {
        if (field_name != "callee") collect_function_local_names(child, names);
    }
}

inline std::optional<vf::JsonValue> capture_module_literal_snapshots(const vf::JsonValue& typed_ir) {
    if (!typed_ir.is_object()) return std::nullopt;
    vf::JsonValue rewritten = typed_ir;
    auto& module = rewritten.as_object();
    auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) return std::nullopt;
    std::map<std::string, vf::JsonValue> visible_literals;
    for (auto& statement_value : body->second.as_array()) {
        if (!statement_value.is_object()) continue;
        auto& statement = statement_value.as_object();
        const std::string kind = detail::string_field(statement, "kind", "module snapshot statement");
        if (kind == "store_binding") {
            const std::string name = detail::string_field(statement, "name", "module snapshot binding");
            const auto& value = detail::field(statement, "value", "module snapshot binding");
            if (value.is_object() &&
                detail::string_field(value.as_object(), "kind", "module snapshot value") == "const") {
                visible_literals[name] = value;
            } else {
                visible_literals.erase(name);
            }
            continue;
        }
        if (kind != "function") continue;
        std::set<std::string> shadowed;
        for (const auto& parameter_value : detail::array_of(
                 detail::field(statement, "params", "snapshot function"), "snapshot function params")) {
            shadowed.insert(detail::string_field(
                detail::object_of(parameter_value, "snapshot function param"),
                "name", "snapshot function param"));
        }
        collect_function_local_names(detail::field(statement, "body", "snapshot function"), shadowed);
        std::map<std::string, vf::JsonValue> captures;
        for (const auto& [name, value] : visible_literals) {
            if (!shadowed.count(name)) captures[name] = value;
        }
        auto& function_body = statement.at("body");
        substitute_closure_loads(function_body, captures);
    }
    return rewritten;
}

} // namespace vkf::module_snapshots
