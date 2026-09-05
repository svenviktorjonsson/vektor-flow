#pragma once

#include "native/VfOverlay/vf/json.hpp"

#include <algorithm>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vkf::output_effects {

class OutputEffectsFailure : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};
using Functions = std::map<std::string, const vf::JsonValue::Object*>;
using Statements = std::vector<const vf::JsonValue::Object*>;
using Callees = std::map<std::string, std::vector<std::string>>;

namespace detail {
template<class Failure>
inline const vf::JsonValue& field(const vf::JsonValue::Object& object,
                                  const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) throw Failure("missing " + name + " in " + context);
    return found->second;
}
template<class Failure>
inline const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) throw Failure("expected object in " + context);
    return value.as_object();
}
template<class Failure>
inline std::string string_field(const vf::JsonValue::Object& object,
                                const std::string& name, const std::string& context) {
    const auto& value = field<Failure>(object, name, context);
    if (!value.is_string()) throw Failure("expected string " + name + " in " + context);
    return value.as_string();
}
} // namespace detail

inline void collect_error_effects(
    const vf::JsonValue& value,
    bool& directly_raises,
    std::vector<std::string>& callees
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            collect_error_effects(item, directly_raises, callees);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string()) {
        if (kind->second.as_string() == "assert_expr" ||
            kind->second.as_string() == "raise_expr" ||
            kind->second.as_string() == "dotted_index" ||
            kind->second.as_string() == "record_selector" ||
            kind->second.as_string() == "update_index") {
            directly_raises = true;
        }
        if (kind->second.as_string() == "call") {
            const auto callee = object.find("callee");
            if (callee != object.end() && callee->second.is_object()) {
                const auto& callee_object = callee->second.as_object();
                const auto callee_kind = callee_object.find("kind");
                const auto callee_name = callee_object.find("name");
                if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                    callee_kind->second.as_string() == "load" &&
                    callee_name != callee_object.end() && callee_name->second.is_string()) {
                    if (callee_name->second.as_string() == "int") directly_raises = true;
                    callees.push_back(callee_name->second.as_string());
                } else if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                           callee_kind->second.as_string() == "stdlib_function") {
                    const auto module = callee_object.find("module");
                    if (module != callee_object.end() && module->second.is_string() &&
                        module->second.as_string() == "io" &&
                        callee_name != callee_object.end() && callee_name->second.is_string()) {
                        const std::string name = callee_name->second.as_string();
                        if (name == "read_text" || name == "read_bytes" ||
                            name == "write_text" || name == "write_bytes" ||
                            name == "append_text") {
                            directly_raises = true;
                        }
                    } else if (module != callee_object.end() && module->second.is_string() &&
                               module->second.as_string() == "regex" &&
                               callee_name != callee_object.end() &&
                               callee_name->second.is_string()) {
                        const std::string name = callee_name->second.as_string();
                        if (name == "match" || name == "groups") directly_raises = true;
                    }
                }
            }
        } else if (kind->second.as_string() == "record_selector") {
            const auto fallback = object.find("fallback_symbol");
            if (fallback != object.end() && fallback->second.is_string()) {
                callees.push_back(fallback->second.as_string());
            }
        } else if (kind->second.as_string() == "binary_op") {
            const auto op = object.find("op");
            if (op != object.end() && op->second.is_string()) {
                const std::string token = op->second.as_string();
                const std::string overload = token == "PLUS" ? "+" : token == "MINUS" ? "-"
                    : token == "STAR" ? "*" : token == "SLASH" ? "/"
                    : token == "FLOORDIV" ? "//" : token == "PERCENT" ? "%"
                    : token == "CARET" ? "^" : token == "AMPERSAND" ? "&" : "";
                if (!overload.empty()) callees.push_back(overload);
            }
        } else if (kind->second.as_string() == "unary_op") {
            const auto op = object.find("op");
            if (op != object.end() && op->second.is_string()) {
                const std::string token = op->second.as_string();
                const std::string overload = token == "MINUS" ? "-"
                    : token == "NOT" ? "~" : "";
                if (!overload.empty()) callees.push_back(overload);
            }
        }
    }
    for (const auto& [name, child] : object) {
        if (name != "callee" || !child.is_object()) {
            collect_error_effects(child, directly_raises, callees);
        }
    }
}

template<class Failure = OutputEffectsFailure>
inline bool is_print_statement(const vf::JsonValue::Object& statement) {
    if (detail::string_field<Failure>(statement, "kind", "top-level statement") != "expr_stmt") return false;
    const auto& expression = detail::object_of<Failure>(
        detail::field<Failure>(statement, "expr", "top-level statement"), "top-level expression");
    if (detail::string_field<Failure>(expression, "kind", "top-level expression") != "call") return false;
    const auto& callee = detail::object_of<Failure>(
        detail::field<Failure>(expression, "callee", "top-level expression"), "top-level callee");
    return detail::string_field<Failure>(callee, "kind", "top-level callee") == "stdlib_function" &&
        detail::string_field<Failure>(callee, "name", "top-level callee") == "print";
}

inline std::set<std::string> reachable_functions_for(
    const Functions& functions, const Callees& function_callees, const Statements& entry_statements
) {
    std::vector<std::string> reachability_worklist;
    bool entry_raises = false;
    for (const auto* statement : entry_statements) {
        collect_error_effects(*statement, entry_raises, reachability_worklist);
    }
    if (functions.count("::")) reachability_worklist.push_back("::");
    if (functions.count(".")) reachability_worklist.push_back(".");
    std::set<std::string> reachable_functions;
    while (!reachability_worklist.empty()) {
        const std::string name = std::move(reachability_worklist.back());
        reachability_worklist.pop_back();
        if (functions.find(name) == functions.end() || !reachable_functions.insert(name).second) {
            continue;
        }
        const auto callees = function_callees.find(name);
        if (callees != function_callees.end()) {
            reachability_worklist.insert(
                reachability_worklist.end(), callees->second.begin(), callees->second.end());
        }
    }
    return reachable_functions;
}

template<class Failure = OutputEffectsFailure>
inline bool has_nested_output_effect(
    const Functions& functions, const std::set<std::string>& reachable_functions,
    const Statements& entry_statements
) {
    const auto contains_output_effect = [](const auto& self, const vf::JsonValue& value) -> bool {
        if (value.is_array()) {
            return std::any_of(value.as_array().begin(), value.as_array().end(),
                [&](const auto& child) { return self(self, child); });
        }
        if (!value.is_object()) return false;
        const auto& object = value.as_object();
        const auto kind = object.find("kind");
        if (kind != object.end() && kind->second.is_string()) {
            if (kind->second.as_string() == "label_print") return true;
            if (kind->second.as_string() == "stdlib_function") {
                const auto module = object.find("module");
                const auto name = object.find("name");
                if (module != object.end() && module->second.is_string() &&
                    module->second.as_string() == "io" && name != object.end() &&
                    name->second.is_string() &&
                    (name->second.as_string() == "print" || name->second.as_string() == "eprint")) {
                    return true;
                }
            }
        }
        return std::any_of(object.begin(), object.end(),
            [&](const auto& item) { return self(self, item.second); });
    };
    bool has_nested_output_effect = false;
    for (const auto& name : reachable_functions) {
        if (contains_output_effect(contains_output_effect, *functions.at(name))) {
            has_nested_output_effect = true;
            break;
        }
    }
    for (const auto* statement : entry_statements) {
        if (is_print_statement<Failure>(*statement)) {
            const auto& call = detail::object_of<Failure>(detail::field<Failure>(*statement, "expr", "output scan"), "output scan call");
            if (contains_output_effect(contains_output_effect, detail::field<Failure>(call, "args", "output scan"))) {
                has_nested_output_effect = true;
            }
        } else if (contains_output_effect(contains_output_effect, *statement)) {
            has_nested_output_effect = true;
        }
    }
    return has_nested_output_effect;
}

// This selects the native scalar/vector output path, not custom/nominal or
// complex display metadata. Run after target-independent IR preparation.
template<class Failure = OutputEffectsFailure>
inline bool has_nested_output_effect(const vf::JsonValue& typed_ir) {
    const auto& module = detail::object_of<Failure>(typed_ir, "module");
    const auto& body = detail::field<Failure>(module, "body", "module");
    if (!body.is_array()) throw Failure("expected array in module body");
    Functions functions;
    Statements statements;
    for (const auto& raw : body.as_array()) {
        const auto& statement = detail::object_of<Failure>(raw, "module statement");
        const auto kind = detail::string_field<Failure>(statement, "kind", "module statement");
        if (kind == "function") {
            functions[detail::string_field<Failure>(statement, "name", "function")] = &statement;
        } else if (kind == "store_binding" || kind == "update_attr" || kind == "update_index" ||
                   kind == "expr_stmt" || kind == "label_print") {
            statements.push_back(&statement);
        }
    }
    Callees callees;
    for (const auto& [name, function] : functions) {
        bool raises = false;
        collect_error_effects(detail::field<Failure>(*function, "body", "function"), raises, callees[name]);
    }
    return has_nested_output_effect<Failure>(functions, reachable_functions_for(functions, callees, statements), statements);
}

} // namespace vkf::output_effects
