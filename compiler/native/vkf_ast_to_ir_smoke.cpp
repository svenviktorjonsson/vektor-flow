#include "native/VfOverlay/vf/json.hpp"
#include "compiler/native/vkf_native_frontend.hpp"
#include "compiler/native/vkf_symbolic_lowering.hpp"
#include "compiler/native/vkf_capture_pattern.hpp"
#include "compiler/native/vkf_csv_demand_source_scanner.hpp"
#include "compiler/native/vkf_physical_dimensions.hpp"
#include "compiler/native/vkf_html_component_catalog.generated.hpp"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <fstream>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

class IRFailure : public std::runtime_error {
public:
    explicit IRFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Binding {
    std::string name;
    std::string type;
};

struct FunctionInfo {
    std::string name;
    std::vector<std::string> param_names;
    std::vector<std::string> param_types;
    std::vector<vf::JsonValue> param_defaults;
    std::vector<bool> variadic_positional;
    std::vector<bool> variadic_named;
    std::string return_type;
    std::string representation_type;
    std::string signature;
    vf::JsonValue body_ast;
};

bool structurally_compatible_type(const std::string& actual, const std::string& expected);
bool named_generic_type_variable(const std::string& type);
bool collect_named_type_bindings(
    const std::string& actual,
    const std::string& pattern,
    std::map<std::string, std::string>& bindings
);
std::optional<std::pair<std::string, std::size_t>>
fixed_vector_type_descriptor_expansion(
    const std::string& descriptor_type,
    const std::string& target_type
);
std::optional<std::vector<std::string>> tuple_type_descriptor_expansion(
    const std::string& descriptor_type,
    const std::string& target_type
);

bool is_nominal_constructor_name(const std::string& name) {
    auto first_public = name.begin();
    if (name.rfind("__vkf_module_", 0) == 0) {
        const auto separator = name.rfind("__");
        if (separator != std::string::npos) {
            first_public = name.begin() + static_cast<std::ptrdiff_t>(separator + 2);
        }
    }
    first_public = std::find_if(
        first_public, name.end(), [](unsigned char ch) { return ch != '_'; });
    return first_public != name.end() &&
        std::isupper(static_cast<unsigned char>(*first_public));
}

bool contains_unresolved_any_type(const std::string& type) {
    std::size_t cursor = 0;
    while ((cursor = type.find("any", cursor)) != std::string::npos) {
        const bool left_boundary = cursor == 0 ||
            (!std::isalnum(static_cast<unsigned char>(type[cursor - 1])) &&
             type[cursor - 1] != '_');
        const std::size_t end = cursor + 3;
        const bool right_boundary = end == type.size() ||
            (!std::isalnum(static_cast<unsigned char>(type[end])) && type[end] != '_');
        if (left_boundary && right_boundary) return true;
        cursor = end;
    }
    return false;
}

class TypeEnv {
public:
    void set(std::string name, std::string type) {
        for (auto& binding : bindings_) {
            if (binding.name == name) {
                binding.type = std::move(type);
                return;
            }
        }
        bindings_.push_back({std::move(name), std::move(type)});
    }

    std::string get(const std::string& name) const {
        for (auto it = bindings_.rbegin(); it != bindings_.rend(); ++it) {
            if (it->name == name) {
                return it->type;
            }
        }
        return "any";
    }

    bool contains(const std::string& name) const {
        return std::any_of(bindings_.begin(), bindings_.end(), [&](const auto& binding) {
            return binding.name == name;
        });
    }

    bool declared_here(const std::string& name) const {
        return std::find(declared_here_.begin(), declared_here_.end(), name) !=
            declared_here_.end();
    }

    void declare(std::string name, std::string type) {
        set(name, std::move(type));
        declared_here_.push_back(std::move(name));
    }

    void mark_declared(const std::string& name) {
        if (!declared_here(name)) declared_here_.push_back(name);
    }

    void begin_scope() {
        declared_here_.clear();
    }

    const std::vector<Binding>& bindings() const { return bindings_; }

private:
    std::vector<Binding> bindings_;
    std::vector<std::string> declared_here_;
};

class FunctionTable {
public:
    void set(FunctionInfo info) {
        for (auto& existing : functions_) {
            if (existing.name == info.name && existing.param_types == info.param_types) {
                existing = std::move(info);
                return;
            }
        }
        functions_.push_back(std::move(info));
    }

    const FunctionInfo* get(const std::string& name) const {
        for (const auto& function : functions_) {
            if (function.name == name) {
                return &function;
            }
        }
        return nullptr;
    }

    bool contains(const std::string& name) const {
        return get(name) != nullptr;
    }

    std::vector<const FunctionInfo*> family(const std::string& name) const {
        std::vector<const FunctionInfo*> matches;
        for (const auto& function : functions_) {
            if (function.name == name) matches.push_back(&function);
        }
        return matches;
    }

    const FunctionInfo* get_unique_arity(
        const std::string& name,
        std::size_t argument_count
    ) const {
        const FunctionInfo* selected = nullptr;
        for (const auto& function : functions_) {
            if (function.name != name) continue;
            std::size_t required = 0;
            bool variadic = false;
            for (std::size_t index = 0; index < function.param_types.size(); ++index) {
                const bool has_default = index < function.param_defaults.size() &&
                    !function.param_defaults[index].is_null();
                const bool captured =
                    (index < function.variadic_positional.size() && function.variadic_positional[index]) ||
                    (index < function.variadic_named.size() && function.variadic_named[index]);
                if (!has_default && !captured) ++required;
                variadic = variadic || captured;
            }
            if (argument_count < required ||
                (!variadic && argument_count > function.param_types.size())) continue;
            if (selected != nullptr) return nullptr;
            selected = &function;
        }
        return selected;
    }

    const FunctionInfo* get(
        const std::string& name,
        const std::vector<std::string>& argument_types
    ) const {
        const FunctionInfo* best = nullptr;
        int best_score = -1;
        bool ambiguous = false;
        for (const auto& function : functions_) {
            if (function.name != name) continue;
            std::size_t required = 0;
            bool variadic = false;
            for (std::size_t index = 0; index < function.param_types.size(); ++index) {
                const bool has_default = index < function.param_defaults.size() &&
                    !function.param_defaults[index].is_null();
                const bool captured =
                    (index < function.variadic_positional.size() && function.variadic_positional[index]) ||
                    (index < function.variadic_named.size() && function.variadic_named[index]);
                if (!has_default && !captured) ++required;
                variadic = variadic || captured;
            }
            if (argument_types.size() < required ||
                (!variadic && argument_types.size() > function.param_types.size())) continue;
            int score = 0;
            bool compatible = true;
            std::map<std::string, std::string> generic_bindings;
            for (std::size_t index = 0;
                 index < argument_types.size() && index < function.param_types.size(); ++index) {
                const std::string& actual = argument_types[index];
                const std::string& expected = function.param_types[index];
                auto candidate_bindings = generic_bindings;
                if (!collect_named_type_bindings(actual, expected, candidate_bindings)) {
                    compatible = false;
                    break;
                }
                generic_bindings = std::move(candidate_bindings);
                if (actual == expected) {
                    score += 100;
                } else if (named_generic_type_variable(expected)) {
                    score += 10;
                } else if (expected == "type" && actual.rfind("type<", 0) == 0 &&
                           actual.back() == '>') {
                    score += 90;
                } else if (fixed_vector_type_descriptor_expansion(actual, expected)) {
                    score += 20;
                } else if (tuple_type_descriptor_expansion(actual, expected)) {
                    score += 20;
                } else if (expected == "any" || actual == "any") {
                    score += 1;
                } else if (expected == "num" &&
                           (actual == "int" || actual == "f32" || actual == "f64")) {
                    score += 50;
                } else if (expected == "int" && actual == "num") {
                    score += 25;
                } else if (structurally_compatible_type(actual, expected)) {
                    score += 40;
                } else {
                    compatible = false;
                    break;
                }
            }
            if (!compatible) continue;
            if (score > best_score) {
                best = &function;
                best_score = score;
                ambiguous = false;
            } else if (score == best_score) {
                ambiguous = true;
            }
        }
        if (ambiguous) return nullptr;
        return best;
    }

    std::string runtime_name(const FunctionInfo& target) const {
        std::size_t family_size = 0;
        std::size_t family_index = 0;
        for (const auto& function : functions_) {
            if (function.name != target.name) continue;
            if (&function == &target) family_index = family_size;
            ++family_size;
        }
        return family_size <= 1
            ? target.name
            : target.name + "__overload_" + std::to_string(family_index);
    }

private:
    std::vector<FunctionInfo> functions_;
};

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw IRFailure("expected object for " + context);
    }
    return value.as_object();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) {
        throw IRFailure("expected array for " + context);
    }
    return value.as_array();
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw IRFailure("missing field " + name + " in " + context);
    }
    return found->second;
}

std::string string_field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const vf::JsonValue& value = field(object, name, context);
    if (!value.is_string()) {
        throw IRFailure("expected string field " + name + " in " + context);
    }
    return value.as_string();
}

std::string kind_of(const vf::JsonValue& value) {
    const auto& object = object_of(value, "AST node");
    return string_field(object, "kind", "AST node");
}

vf::JsonValue::Object node(std::string kind) {
    vf::JsonValue::Object out;
    out["kind"] = vf::JsonValue(std::move(kind));
    return out;
}

vf::JsonValue stdlib_function(std::string module, std::string name) {
    auto out = node("stdlib_function");
    out["module"] = vf::JsonValue(module);
    out["name"] = vf::JsonValue(name);
    out["full_name"] = vf::JsonValue(module + "." + name);
    std::string type = "fn(any)->any";
    if (module == "time") {
        if (name == "monotonic_seconds" || name == "wall_seconds") type = "fn()->num";
        else if (name == "sleep_seconds") type = "fn(num)->null";
        else if (name == "local_parts") {
            type = "fn(num)->record{second:num,minute:num,hour:num,day:num,month:num,year:num,weekday:num,yearday:num,dst:num}";
        }
    } else if (module == "io") {
        if (name == "read_text" || name == "read_bytes") type = "fn(str)->str";
        else if (name == "read_line") type = "fn()->str";
        else if (name == "write_text" || name == "write_bytes" || name == "append_text") {
            type = "fn(str,str)->null";
        } else if (name == "print" || name == "eprint") type = "fn(any)->any";
        else if (name == "write_to_clipboard") type = "fn(any)->null";
    } else if (module == "system") {
        if (name == "os_name" || name == "arch_name" || name == "cwd_native") type = "fn()->str";
        else if (name == "cpu_count_native") type = "fn()->int";
        else if (name == "env_native") type = "fn(str)->record{found:bit,value:str}";
    } else if (module == "process") {
        if (name == "run_native") type = "fn(str,any)->record{code:int,out:str,err:str}";
        else if (name == "shell_native") type = "fn(str)->record{code:int,out:str,err:str}";
    } else if (module == "regex" && (name == "match" || name == "groups")) {
        type = "fn(str,str)->any";
    }
    out["type"] = vf::JsonValue(type);
    return vf::JsonValue(std::move(out));
}

vf::JsonValue num_const(double value) {
    auto out = node("const");
    out["type"] = vf::JsonValue("num");
    out["value"] = vf::JsonValue(value);
    return vf::JsonValue(std::move(out));
}

std::string format_label_expr(const vf::JsonValue& ast) {
    const auto& object = object_of(ast, "label expr");
    const std::string kind = string_field(object, "kind", "label expr");
    if (kind == "identifier") {
        return string_field(object, "name", "identifier");
    }
    if (kind == "attribute") {
        return format_label_expr(field(object, "object", "attribute"))
            + "." + string_field(object, "name", "attribute");
    }
    if (kind == "dotted_index") {
        std::string out = format_label_expr(field(object, "base", "dotted_index")) + ".(";
        const auto& indices = array_of(field(object, "indices", "dotted_index"), "dotted_index.indices");
        for (std::size_t i = 0; i < indices.size(); ++i) {
            if (i > 0) {
                out += ", ";
            }
            const auto& index_object = object_of(indices[i], "dotted_index.index");
            const std::string index_kind = string_field(index_object, "kind", "dotted_index.index");
            if (index_kind == "const") {
                const vf::JsonValue& raw = field(index_object, "value", "dotted_index.index");
                if (raw.is_number()) {
                    std::ostringstream stream;
                    stream << raw.as_number();
                    out += stream.str();
                } else if (raw.is_string()) {
                    out += raw.as_string();
                } else if (raw.is_boolean()) {
                    out += raw.as_boolean() ? "true" : "false";
                } else {
                    out += "?";
                }
            } else if (index_kind == "number_literal") {
                std::ostringstream stream;
                stream << field(index_object, "value", "number_literal").as_number();
                out += stream.str();
            } else {
                out += "?";
            }
        }
        out += ")";
        return out;
    }
    if (kind == "call") {
        return format_label_expr(field(object, "callee", "call")) + "()";
    }
    return "<expr>";
}

vf::JsonValue bool_const(bool value) {
    auto out = node("const");
    out["type"] = vf::JsonValue("bit");
    out["value"] = vf::JsonValue(value);
    return vf::JsonValue(std::move(out));
}

bool optional_bool_field(const vf::JsonValue::Object& object, const std::string& name) {
    const auto found = object.find(name);
    return found != object.end() && found->second.is_boolean() && found->second.as_boolean();
}
bool starts_with(const std::string& text, const std::string& prefix);
std::string axis_tagged_type(const std::string& axis_key, const std::string& value_type);
bool parse_axis_tagged_type(
    const std::string& text,
    std::string& axis_key,
    std::string& value_type
);
std::string render_surface_type(const std::string& type_name);
std::string normalize_surface_type_annotation(const std::string& type_name);
bool try_fold_abs_expr(const vf::JsonValue::Object& object, const TypeEnv& env, vf::JsonValue& out_value);
bool try_fold_range_expr(const vf::JsonValue::Object& object, vf::JsonValue& out_value);
bool try_fold_pipe_chain_expr(
    const vf::JsonValue::Object& object,
    const TypeEnv& env,
    const FunctionTable& functions,
    vf::JsonValue& out_value
);
vf::JsonValue coerce_value_to_type(vf::JsonValue value, const std::string& target_type, const std::string& context);
std::string merge_nullable_type(const std::string& current, const std::string& incoming);

std::string type_annotation_name(const vf::JsonValue& value) {
    if (value.is_null()) {
        return "any";
    }
    const auto& object = object_of(value, "type annotation");
    const std::string kind = string_field(object, "kind", "type annotation");
    if (kind != "type_annotation") {
        throw IRFailure("unsupported type annotation kind " + kind);
    }
    return normalize_surface_type_annotation(
        string_field(object, "name", "type annotation"));
}

vf::JsonValue int_const(double value) {
    auto out = node("const");
    out["type"] = vf::JsonValue("int");
    out["value"] = vf::JsonValue(value);
    return vf::JsonValue(std::move(out));
}

std::vector<std::string> split_top_level_type_parts(const std::string& text) {
    std::vector<std::string> parts;
    std::size_t start = 0;
    int paren_depth = 0;
    int bracket_depth = 0;
    int brace_depth = 0;
    int angle_depth = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch == '(') ++paren_depth;
        else if (ch == ')') --paren_depth;
        else if (ch == '[') ++bracket_depth;
        else if (ch == ']') --bracket_depth;
        else if (ch == '{') ++brace_depth;
        else if (ch == '}') --brace_depth;
        else if (ch == '<') ++angle_depth;
        else if (ch == '>' && (index == 0 || text[index - 1] != '-') && angle_depth > 0) {
            --angle_depth;
        }
        if (ch == ',' && paren_depth == 0 && bracket_depth == 0 &&
            brace_depth == 0 && angle_depth == 0) {
            parts.push_back(text.substr(start, index - start));
            start = index + 1;
        }
    }
    parts.push_back(text.substr(start));
    return parts;
}

namespace {

bool surface_type_is_wrapped(const std::string& text, char open, char close) {
    if (text.size() < 2 || text.front() != open || text.back() != close) return false;
    int depth = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        if (text[index] == open) ++depth;
        else if (text[index] == close) {
            --depth;
            if (depth == 0 && index + 1 != text.size()) return false;
        }
    }
    return depth == 0;
}

std::size_t surface_type_top_level_arrow(const std::string& text) {
    int paren_depth = 0;
    int bracket_depth = 0;
    int brace_depth = 0;
    int angle_depth = 0;
    for (std::size_t index = 0; index + 1 < text.size(); ++index) {
        const char ch = text[index];
        if (ch == '-' && text[index + 1] == '>' && paren_depth == 0 &&
            bracket_depth == 0 && brace_depth == 0 && angle_depth == 0) {
            return index;
        }
        if (ch == '(') ++paren_depth;
        else if (ch == ')') --paren_depth;
        else if (ch == '[') ++bracket_depth;
        else if (ch == ']') --bracket_depth;
        else if (ch == '{') ++brace_depth;
        else if (ch == '}') --brace_depth;
        else if (ch == '<') ++angle_depth;
        else if (ch == '>' && (index == 0 || text[index - 1] != '-') && angle_depth > 0) {
            --angle_depth;
        }
    }
    return std::string::npos;
}

std::size_t surface_type_top_level_colon(const std::string& text) {
    int paren_depth = 0;
    int bracket_depth = 0;
    int brace_depth = 0;
    int angle_depth = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch == ':' && paren_depth == 0 && bracket_depth == 0 &&
            brace_depth == 0 && angle_depth == 0) {
            return index;
        }
        if (ch == '(') ++paren_depth;
        else if (ch == ')') --paren_depth;
        else if (ch == '[') ++bracket_depth;
        else if (ch == ']') --bracket_depth;
        else if (ch == '{') ++brace_depth;
        else if (ch == '}') --brace_depth;
        else if (ch == '<') ++angle_depth;
        else if (ch == '>' && (index == 0 || text[index - 1] != '-') && angle_depth > 0) {
            --angle_depth;
        }
    }
    return std::string::npos;
}

std::size_t surface_type_top_level_comma(const std::string& text) {
    int paren_depth = 0;
    int bracket_depth = 0;
    int brace_depth = 0;
    int angle_depth = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch == ',' && paren_depth == 0 && bracket_depth == 0 &&
            brace_depth == 0 && angle_depth == 0) {
            return index;
        }
        if (ch == '(') ++paren_depth;
        else if (ch == ')') --paren_depth;
        else if (ch == '[') ++bracket_depth;
        else if (ch == ']') --bracket_depth;
        else if (ch == '{') ++brace_depth;
        else if (ch == '}') --brace_depth;
        else if (ch == '<') ++angle_depth;
        else if (ch == '>' && (index == 0 || text[index - 1] != '-') && angle_depth > 0) {
            --angle_depth;
        }
    }
    return std::string::npos;
}

std::string normalize_non_function_surface_type(const std::string& type_name) {
    if (type_name == "bool") return "bit";
    if (type_name.empty() || starts_with(type_name, "fn(")) return type_name;

    if (starts_with(type_name, "tuple<") && type_name.back() == '>') {
        const auto parts = split_top_level_type_parts(
            type_name.substr(6, type_name.size() - 7));
        std::string out = "tuple<";
        bool first = true;
        for (const auto& part : parts) {
            if (part.empty()) continue;
            if (!first) out += ',';
            first = false;
            out += normalize_surface_type_annotation(part);
        }
        return out + ">";
    }
    if (starts_with(type_name, "record{") && type_name.back() == '}') {
        const auto parts = split_top_level_type_parts(
            type_name.substr(7, type_name.size() - 8));
        std::string out = "record{";
        bool first = true;
        for (const auto& part : parts) {
            if (part.empty()) continue;
            const auto colon = surface_type_top_level_colon(part);
            if (!first) out += ',';
            first = false;
            out += colon == std::string::npos
                ? part
                : part.substr(0, colon) + ":" +
                    normalize_surface_type_annotation(part.substr(colon + 1));
        }
        return out + "}";
    }
    if (starts_with(type_name, "list<") && type_name.back() == '>') {
        return "list<" + normalize_surface_type_annotation(
            type_name.substr(5, type_name.size() - 6)) + ">";
    }
    if (starts_with(type_name, "multiset<") && type_name.back() == '>') {
        return "multiset<" + normalize_surface_type_annotation(
            type_name.substr(9, type_name.size() - 10)) + ">";
    }
    if (surface_type_is_wrapped(type_name, '[', ']')) {
        const std::string inner = type_name.substr(1, type_name.size() - 2);
        const auto colon = surface_type_top_level_colon(inner);
        return "[" + normalize_surface_type_annotation(
            colon == std::string::npos ? inner : inner.substr(0, colon)) +
            (colon == std::string::npos ? "" : inner.substr(colon)) + "]";
    }
    if (surface_type_is_wrapped(type_name, '{', '}')) {
        return "{" + normalize_surface_type_annotation(
            type_name.substr(1, type_name.size() - 2)) + "}";
    }
    if (surface_type_is_wrapped(type_name, '(', ')')) {
        const std::string inner = type_name.substr(1, type_name.size() - 2);
        const auto parts = split_top_level_type_parts(inner);
        const bool has_separator = parts.size() > 1;
        const bool has_fields = surface_type_top_level_colon(inner) != std::string::npos;
        if (!has_separator && !has_fields) {
            return normalize_surface_type_annotation(inner);
        }
        std::string out = has_fields ? "record{" : "tuple<";
        bool first = true;
        for (const auto& part : parts) {
            if (part.empty()) continue;
            if (!first) out += ',';
            first = false;
            if (has_fields) {
                const auto colon = surface_type_top_level_colon(part);
                out += colon == std::string::npos
                    ? part
                    : part.substr(0, colon) + ":" +
                        normalize_surface_type_annotation(part.substr(colon + 1));
            } else {
                out += normalize_surface_type_annotation(part);
            }
        }
        return out + (has_fields ? "}" : ">");
    }
    return type_name;
}

}  // namespace

std::string normalize_surface_type_annotation(const std::string& type_name) {
    if (starts_with(type_name, "fn(")) return type_name;
    const auto arrow = surface_type_top_level_arrow(type_name);
    const auto comma = surface_type_top_level_comma(type_name);
    if (comma != std::string::npos &&
        (arrow == std::string::npos || comma + 1 != arrow)) {
        const auto parts = split_top_level_type_parts(type_name);
        std::string out = "tuple<";
        bool first = true;
        for (const auto& part : parts) {
            if (part.empty()) continue;
            if (!first) out += ',';
            first = false;
            out += normalize_surface_type_annotation(part);
        }
        return out + ">";
    }
    if (arrow == std::string::npos) {
        return normalize_non_function_surface_type(type_name);
    }

    const std::string raw_domain = type_name.substr(0, arrow);
    const std::string raw_codomain = type_name.substr(arrow + 2);
    std::vector<std::string> parameters;
    if (surface_type_is_wrapped(raw_domain, '(', ')')) {
        const std::string inner = raw_domain.substr(1, raw_domain.size() - 2);
        const auto parts = split_top_level_type_parts(inner);
        if (inner.empty()) {
            parameters.clear();
        } else if (parts.size() == 2 && parts.back().empty()) {
            parameters.push_back("tuple<" + normalize_surface_type_annotation(parts.front()) + ">");
        } else if (parts.size() > 1) {
            for (const auto& part : parts) {
                if (!part.empty()) parameters.push_back(normalize_surface_type_annotation(part));
            }
        } else {
            parameters.push_back(normalize_surface_type_annotation(inner));
        }
    } else if (!raw_domain.empty() && raw_domain.back() == ',') {
        parameters.push_back("tuple<" + normalize_surface_type_annotation(
            raw_domain.substr(0, raw_domain.size() - 1)) + ">");
    } else {
        parameters.push_back(normalize_surface_type_annotation(raw_domain));
    }

    std::string out = "fn(";
    for (std::size_t index = 0; index < parameters.size(); ++index) {
        if (index != 0) out += ',';
        out += parameters[index];
    }
    return out + ")->" + normalize_surface_type_annotation(raw_codomain);
}

std::map<std::string, std::string> record_type_fields(const std::string& type_name) {
    std::map<std::string, std::string> fields;
    if (!starts_with(type_name, "record{") || type_name.back() != '}') return fields;
    const std::string inner = type_name.substr(7, type_name.size() - 8);
    for (const auto& part : split_top_level_type_parts(inner)) {
        int depth = 0;
        std::size_t colon = std::string::npos;
        for (std::size_t index = 0; index < part.size(); ++index) {
            const char ch = part[index];
            if (ch == '(' || ch == '[' || ch == '{' || ch == '<') ++depth;
            if (ch == ')' || ch == ']' || ch == '}' || ch == '>') --depth;
            if (ch == ':' && depth == 0) { colon = index; break; }
        }
        if (colon != std::string::npos) fields[part.substr(0, colon)] = part.substr(colon + 1);
    }
    return fields;
}

struct EmissionVectorType {
    bool numeric = false;
    std::optional<std::size_t> fixed_length;
};

EmissionVectorType emission_vector_type(const std::string& type_name) {
    if (starts_with(type_name, "list<") && type_name.back() == '>') {
        const std::string element = type_name.substr(5, type_name.size() - 6);
        return {element == "int" || element == "num", std::nullopt};
    }
    if (type_name.size() < 5 || type_name.front() != '[' ||
        type_name.back() != ']') {
        return {};
    }
    const std::string inner = type_name.substr(1, type_name.size() - 2);
    const auto colon = inner.rfind(':');
    if (colon == std::string::npos) return {};
    const std::string element = inner.substr(0, colon);
    const std::string extent = inner.substr(colon + 1);
    if ((element != "int" && element != "num") || extent.empty() ||
        !std::all_of(extent.begin(), extent.end(), [](const char ch) {
            return ch >= '0' && ch <= '9';
        })) {
        return {};
    }
    return {true, static_cast<std::size_t>(std::stoull(extent))};
}

void validate_emission_type(const vf::JsonValue& expression) {
    const auto& value = object_of(expression, "Frame.add emission");
    const std::string type = string_field(value, "type", "Frame.add emission");
    const auto rgb = emission_vector_type(type);
    if (rgb.numeric) {
        if (rgb.fixed_length.has_value() && *rgb.fixed_length == 3) return;
        throw IRFailure("Frame.add RGB emission must have exactly three components");
    }
    const auto fields = record_type_fields(type);
    if (fields.size() != 2 || fields.find("wavelength") == fields.end() ||
        fields.find("radiance") == fields.end()) {
        throw IRFailure(
            "Frame.add emission must be an RGB vector or a wavelength/radiance record");
    }
    const auto wavelength = emission_vector_type(fields.at("wavelength"));
    const auto radiance = emission_vector_type(fields.at("radiance"));
    if (!wavelength.numeric || !radiance.numeric) {
        throw IRFailure("Frame.add emission wavelength and radiance must be numeric vectors");
    }
    if ((wavelength.fixed_length.has_value() && *wavelength.fixed_length == 0) ||
        (radiance.fixed_length.has_value() && *radiance.fixed_length == 0) ||
        (wavelength.fixed_length.has_value() && radiance.fixed_length.has_value() &&
         *wavelength.fixed_length != *radiance.fixed_length)) {
        throw IRFailure(
            "Frame.add emission wavelength and radiance vectors must have the same nonzero length");
    }
}

std::vector<std::pair<std::string, std::string>> ordered_record_type_fields(
    const std::string& type_name
) {
    std::vector<std::pair<std::string, std::string>> fields;
    if (!starts_with(type_name, "record{") || type_name.empty() || type_name.back() != '}') {
        return fields;
    }
    const std::string inner = type_name.substr(7, type_name.size() - 8);
    for (const auto& part : split_top_level_type_parts(inner)) {
        int depth = 0;
        std::size_t colon = std::string::npos;
        for (std::size_t index = 0; index < part.size(); ++index) {
            const char ch = part[index];
            if (ch == '(' || ch == '[' || ch == '{' || ch == '<') ++depth;
            if (ch == ')' || ch == ']' || ch == '}' || ch == '>') --depth;
            if (ch == ':' && depth == 0) {
                colon = index;
                break;
            }
        }
        if (colon != std::string::npos) {
            fields.push_back({part.substr(0, colon), part.substr(colon + 1)});
        }
    }
    return fields;
}

bool type_name_coercible(const std::string& source, const std::string& target) {
    if (source == target || target == "any" || source == "any" || source == "null") return true;
    if (source == "int" && target == "num") return true;
    if (starts_with(source, "list<") && source.back() == '>'
        && target.size() >= 2 && target.front() == '[' && target.back() == ']') {
        const std::string source_element = source.substr(5, source.size() - 6);
        const std::string target_inner = target.substr(1, target.size() - 2);
        const std::size_t separator = target_inner.rfind(':');
        const std::string target_element = separator == std::string::npos
            ? target_inner : target_inner.substr(0, separator);
        return type_name_coercible(source_element, target_element);
    }
    if (starts_with(source, "multiset<") && source.back() == '>'
        && target.size() >= 2 && target.front() == '{' && target.back() == '}') {
        return type_name_coercible(
            source.substr(9, source.size() - 10),
            target.substr(1, target.size() - 2)
        );
    }
    if (source.size() >= 2 && source.front() == '[' && source.back() == ']'
        && target.size() >= 2 && target.front() == '[' && target.back() == ']') {
        const std::string source_inner = source.substr(1, source.size() - 2);
        const std::string target_inner = target.substr(1, target.size() - 2);
        const std::size_t source_separator = source_inner.rfind(':');
        const std::size_t target_separator = target_inner.rfind(':');
        const std::string source_element = source_separator == std::string::npos
            ? source_inner : source_inner.substr(0, source_separator);
        const std::string target_element = target_separator == std::string::npos
            ? target_inner : target_inner.substr(0, target_separator);
        return type_name_coercible(source_element, target_element);
    }
    if (starts_with(source, "tuple<") && source.back() == '>' &&
        starts_with(target, "tuple<") && target.back() == '>') {
        const auto source_items = split_top_level_type_parts(
            source.substr(6, source.size() - 7));
        const auto target_items = split_top_level_type_parts(
            target.substr(6, target.size() - 7));
        if (source_items.size() != target_items.size()) return false;
        for (std::size_t index = 0; index < source_items.size(); ++index) {
            if (!type_name_coercible(source_items[index], target_items[index])) return false;
        }
        return true;
    }
    if (!target.empty() && std::isupper(static_cast<unsigned char>(target.front()))
        && starts_with(source, "record{")) return true;
    const auto source_fields = record_type_fields(source);
    const auto target_fields = record_type_fields(target);
    if (!source_fields.empty() && source_fields.size() == target_fields.size()) {
        for (const auto& [name, target_field] : target_fields) {
            const auto source_it = source_fields.find(name);
            if (source_it == source_fields.end() || !type_name_coercible(source_it->second, target_field)) return false;
        }
        return true;
    }
    return false;
}

std::string canonical_function_type(std::string type) {
    return normalize_surface_type_annotation(type);
}

struct VectorTypeParts {
    std::string element;
    std::string shape;
};

struct FixedNumericVectorShape {
    std::vector<std::size_t> dimensions;
    std::string leaf_type;
};

std::optional<VectorTypeParts> vector_type_parts(const std::string& type) {
    if (type.size() < 3 || type.front() != '[' || type.back() != ']') return std::nullopt;
    const std::string inner = type.substr(1, type.size() - 2);
    const auto separator = inner.rfind(':');
    if (separator == std::string::npos) return VectorTypeParts{inner, {}};
    return VectorTypeParts{inner.substr(0, separator), inner.substr(separator + 1)};
}

bool decimal_shape(const std::string& shape) {
    return !shape.empty() && std::all_of(shape.begin(), shape.end(), [](unsigned char ch) {
        return std::isdigit(ch);
    });
}

bool symbolic_shape_name(const std::string& shape) {
    if (shape.empty() || !(std::isalpha(static_cast<unsigned char>(shape.front())) || shape.front() == '_')) {
        return false;
    }
    return std::all_of(shape.begin() + 1, shape.end(), [](unsigned char ch) {
        return std::isalnum(ch) || ch == '_';
    });
}

std::optional<std::pair<std::string, std::size_t>>
fixed_vector_type_descriptor_expansion(
    const std::string& descriptor_type,
    const std::string& target_type
) {
    if (!starts_with(descriptor_type, "type<") || descriptor_type.back() != '>') {
        return std::nullopt;
    }
    const std::string represented = descriptor_type.substr(
        5, descriptor_type.size() - 6);
    const auto represented_vector = vector_type_parts(represented);
    const auto target_vector = vector_type_parts(target_type);
    if (!represented_vector || !target_vector || target_vector->element != "type" ||
        !decimal_shape(represented_vector->shape) ||
        !decimal_shape(target_vector->shape) ||
        represented_vector->shape != target_vector->shape) {
        return std::nullopt;
    }
    return std::pair<std::string, std::size_t>{
        represented_vector->element,
        static_cast<std::size_t>(std::stoull(represented_vector->shape))
    };
}

std::optional<std::vector<std::string>> tuple_type_descriptor_expansion(
    const std::string& descriptor_type,
    const std::string& target_type
) {
    if (!starts_with(descriptor_type, "type<") || descriptor_type.back() != '>') {
        return std::nullopt;
    }
    const std::string represented = descriptor_type.substr(
        5, descriptor_type.size() - 6);
    if (!starts_with(represented, "tuple<") || represented.back() != '>' ||
        !starts_with(target_type, "tuple<") || target_type.back() != '>') {
        return std::nullopt;
    }
    const auto represented_items = split_top_level_type_parts(
        represented.substr(6, represented.size() - 7));
    const auto target_items = split_top_level_type_parts(
        target_type.substr(6, target_type.size() - 7));
    if (represented_items.size() != target_items.size() ||
        !std::all_of(target_items.begin(), target_items.end(),
            [](const std::string& item) { return item == "type"; })) {
        return std::nullopt;
    }
    return represented_items;
}

std::optional<FixedNumericVectorShape> fixed_numeric_vector_shape(std::string type) {
    FixedNumericVectorShape result;
    while (const auto vector = vector_type_parts(type)) {
        if (!decimal_shape(vector->shape)) return std::nullopt;
        result.dimensions.push_back(static_cast<std::size_t>(std::stoull(vector->shape)));
        type = vector->element;
    }
    if (result.dimensions.empty() ||
        (type != "int" && type != "num" && type != "f32" && type != "f64")) {
        return std::nullopt;
    }
    result.leaf_type = std::move(type);
    return result;
}

std::optional<std::vector<std::size_t>>
fixed_rectangular_vector_dimensions(std::string type) {
    std::vector<std::size_t> dimensions;
    while (const auto vector = vector_type_parts(type)) {
        if (!decimal_shape(vector->shape)) return std::nullopt;
        dimensions.push_back(static_cast<std::size_t>(std::stoull(vector->shape)));
        type = vector->element;
    }
    if (dimensions.empty() || type == "any") return std::nullopt;
    return dimensions;
}

std::vector<std::size_t> constant_stat_axes(
    const vf::JsonValue::Array& named_args,
    std::size_t rank
) {
    if (named_args.size() != 1) {
        throw IRFailure("stat.sum accepts only one named argument: axis");
    }
    const auto& named = object_of(named_args.front(), "stat.sum axis");
    if (string_field(named, "name", "stat.sum axis") != "axis") {
        throw IRFailure("unknown named argument for stat.sum");
    }
    const auto& axis_value = object_of(field(named, "value", "stat.sum axis"), "stat.sum axis value");
    std::vector<std::int64_t> raw_axes;
    const auto append_axis = [&](const vf::JsonValue::Object& value) {
        const auto& raw = field(value, "value", "stat.sum axis value");
        if (string_field(value, "kind", "stat.sum axis value") != "const" ||
            !raw.is_number() || !std::isfinite(raw.as_number()) ||
            std::floor(raw.as_number()) != raw.as_number()) {
            throw IRFailure("stat.sum axis must be a constant integer or tuple of integers");
        }
        raw_axes.push_back(static_cast<std::int64_t>(raw.as_number()));
    };
    if (string_field(axis_value, "kind", "stat.sum axis value") == "tuple") {
        const auto& items = array_of(field(axis_value, "items", "stat.sum axis tuple"), "stat.sum axis tuple");
        if (items.empty()) throw IRFailure("stat.sum axis tuple must not be empty");
        for (const auto& item : items) append_axis(object_of(item, "stat.sum axis tuple item"));
    } else {
        append_axis(axis_value);
    }

    std::vector<std::size_t> axes;
    for (auto axis : raw_axes) {
        if (axis < 0) axis += static_cast<std::int64_t>(rank);
        if (axis < 0 || axis >= static_cast<std::int64_t>(rank)) {
            throw IRFailure("stat.sum axis is out of range for rank " + std::to_string(rank));
        }
        const auto normalized = static_cast<std::size_t>(axis);
        if (std::find(axes.begin(), axes.end(), normalized) != axes.end()) {
            throw IRFailure("stat.sum axis tuple contains a duplicate axis");
        }
        axes.push_back(normalized);
    }
    std::sort(axes.begin(), axes.end());
    return axes;
}

std::string stat_axis_result_type(
    const FixedNumericVectorShape& shape,
    const std::vector<std::size_t>& axes
) {
    std::string result = shape.leaf_type;
    for (std::size_t axis = shape.dimensions.size(); axis > 0; --axis) {
        const auto index = axis - 1;
        if (std::find(axes.begin(), axes.end(), index) != axes.end()) continue;
        result = "[" + result + ":" + std::to_string(shape.dimensions[index]) + "]";
    }
    return result;
}

std::optional<std::string> maybe_dynamic_list_element_type(const std::string& type) {
    if (!starts_with(type, "list<") || type.size() < 7 || type.back() != '>') {
        return std::nullopt;
    }
    return type.substr(5, type.size() - 6);
}

bool symbolic_expression_type(const std::string& type) {
    return type == "symbolic" || type == "expression" || type == "symbol" ||
        type == "constant" || type == "relation" || type == "proposition";
}

bool symbolic_subtype(const std::string& actual, const std::string& expected) {
    if (!symbolic_expression_type(actual) || !symbolic_expression_type(expected)) return false;
    if (actual == expected) return true;
    if (actual == "symbolic") return true;
    if (expected == "symbolic" || expected == "expression") return true;
    if (expected == "proposition" && actual == "relation") return true;
    if (expected == "symbol" && actual == "constant") return true;
    return false;
}

bool named_generic_type_variable(const std::string& type) {
    return type.size() == 1 && type.front() >= 'A' && type.front() <= 'Z';
}

bool collect_named_type_bindings(
    const std::string& actual,
    const std::string& pattern,
    std::map<std::string, std::string>& bindings
) {
    if (named_generic_type_variable(pattern)) {
        const auto found = bindings.find(pattern);
        if (found != bindings.end()) return found->second == actual;
        bindings[pattern] = actual;
        return true;
    }

    const auto actual_vector = vector_type_parts(actual);
    const auto pattern_vector = vector_type_parts(pattern);
    if (actual_vector || pattern_vector) {
        if (!actual_vector || !pattern_vector) return true;
        return collect_named_type_bindings(
            actual_vector->element, pattern_vector->element, bindings);
    }

    const auto dynamic_element = [](const std::string& type) -> std::optional<std::string> {
        if (!starts_with(type, "list<") || type.size() < 7 || type.back() != '>') {
            return std::nullopt;
        }
        return type.substr(5, type.size() - 6);
    };
    const auto actual_dynamic = dynamic_element(actual);
    const auto pattern_dynamic = dynamic_element(pattern);
    if (actual_dynamic || pattern_dynamic) {
        if (!actual_dynamic || !pattern_dynamic) return true;
        return collect_named_type_bindings(*actual_dynamic, *pattern_dynamic, bindings);
    }

    const auto multiset_element = [](const std::string& type) -> std::optional<std::string> {
        if (starts_with(type, "multiset<") && type.back() == '>') {
            return type.substr(9, type.size() - 10);
        }
        if (type.size() >= 3 && type.front() == '{' && type.back() == '}' &&
            type.find(':') == std::string::npos) {
            return type.substr(1, type.size() - 2);
        }
        return std::nullopt;
    };
    const auto actual_multiset = multiset_element(actual);
    const auto pattern_multiset = multiset_element(pattern);
    if (actual_multiset || pattern_multiset) {
        if (!actual_multiset || !pattern_multiset) return true;
        return collect_named_type_bindings(*actual_multiset, *pattern_multiset, bindings);
    }

    if (starts_with(actual, "tuple<") && actual.back() == '>' &&
        starts_with(pattern, "tuple<") && pattern.back() == '>') {
        const auto actual_items = split_top_level_type_parts(actual.substr(6, actual.size() - 7));
        const auto pattern_items = split_top_level_type_parts(pattern.substr(6, pattern.size() - 7));
        if (actual_items.size() != pattern_items.size()) return true;
        for (std::size_t index = 0; index < actual_items.size(); ++index) {
            if (!collect_named_type_bindings(actual_items[index], pattern_items[index], bindings)) {
                return false;
            }
        }
        return true;
    }

    const auto actual_fields = ordered_record_type_fields(actual);
    const auto pattern_fields = ordered_record_type_fields(pattern);
    if (!actual_fields.empty() && !pattern_fields.empty() &&
        actual_fields.size() == pattern_fields.size()) {
        for (std::size_t index = 0; index < actual_fields.size(); ++index) {
            if (actual_fields[index].first != pattern_fields[index].first) return true;
            if (!collect_named_type_bindings(
                    actual_fields[index].second,
                    pattern_fields[index].second,
                    bindings)) return false;
        }
    }
    return true;
}

bool structurally_compatible_type(const std::string& actual, const std::string& expected) {
    if (expected == "any" || actual == "any" || actual == expected ||
        named_generic_type_variable(expected)) return true;
    if (fixed_vector_type_descriptor_expansion(actual, expected)) return true;
    if (tuple_type_descriptor_expansion(actual, expected)) return true;
    if (expected == "type" && starts_with(actual, "type<") && actual.back() == '>') {
        return true;
    }
    if (symbolic_subtype(actual, expected)) return true;
    if (expected == "num" && (actual == "int" || actual == "f32" || actual == "f64")) {
        return true;
    }

    const auto multiset_element = [](const std::string& type) -> std::optional<std::string> {
        if (starts_with(type, "multiset<") && type.back() == '>') {
            return type.substr(9, type.size() - 10);
        }
        if (type.size() >= 3 && type.front() == '{' && type.back() == '}' &&
            type.find(':') == std::string::npos) {
            return type.substr(1, type.size() - 2);
        }
        return std::nullopt;
    };
    const auto actual_multiset = multiset_element(actual);
    const auto expected_multiset = multiset_element(expected);
    if (actual_multiset && expected_multiset) {
        return structurally_compatible_type(*actual_multiset, *expected_multiset);
    }

    const auto actual_vector = vector_type_parts(actual);
    const auto expected_vector = vector_type_parts(expected);
    const auto actual_list = maybe_dynamic_list_element_type(actual);
    const auto expected_list = maybe_dynamic_list_element_type(expected);
    if ((actual_vector || actual_list) && (expected_vector || expected_list)) {
        const std::string actual_element = actual_vector ? actual_vector->element : *actual_list;
        const std::string expected_element = expected_vector ? expected_vector->element : *expected_list;
        if (!structurally_compatible_type(actual_element, expected_element)) return false;
        if (actual_vector && expected_vector && decimal_shape(actual_vector->shape) &&
            decimal_shape(expected_vector->shape) && actual_vector->shape != expected_vector->shape) {
            return false;
        }
        return true;
    }

    if (starts_with(actual, "tuple<") && actual.back() == '>' &&
        starts_with(expected, "tuple<") && expected.back() == '>') {
        const auto actual_items = split_top_level_type_parts(actual.substr(6, actual.size() - 7));
        const auto expected_items = split_top_level_type_parts(expected.substr(6, expected.size() - 7));
        if (actual_items.size() != expected_items.size()) return false;
        for (std::size_t index = 0; index < actual_items.size(); ++index) {
            if (!structurally_compatible_type(actual_items[index], expected_items[index])) return false;
        }
        return true;
    }

    const auto actual_fields = record_type_fields(actual);
    const auto expected_fields = record_type_fields(expected);
    if (!actual_fields.empty() || !expected_fields.empty()) {
        if (actual_fields.size() != expected_fields.size()) return false;
        for (const auto& [name, expected_type] : expected_fields) {
            const auto found = actual_fields.find(name);
            if (found == actual_fields.end() ||
                !structurally_compatible_type(found->second, expected_type)) return false;
        }
        return true;
    }
    return false;
}

bool exact_broadcast_target_type(const std::string& actual, const std::string& expected) {
    if (actual == expected) return true;
    const auto actual_vector = vector_type_parts(actual);
    const auto expected_vector = vector_type_parts(expected);
    const auto actual_list = maybe_dynamic_list_element_type(actual);
    const auto expected_list = maybe_dynamic_list_element_type(expected);
    if (!(actual_vector || actual_list) || !(expected_vector || expected_list)) {
        return false;
    }
    const std::string actual_element = actual_vector ? actual_vector->element : *actual_list;
    const std::string expected_element = expected_vector ? expected_vector->element : *expected_list;
    if (!exact_broadcast_target_type(actual_element, expected_element)) return false;
    if (actual_vector && expected_vector && decimal_shape(actual_vector->shape) &&
        decimal_shape(expected_vector->shape) && actual_vector->shape != expected_vector->shape) {
        return false;
    }
    return true;
}

bool compatible_broadcast_target_type(const std::string& actual, const std::string& expected) {
    if (structurally_compatible_type(actual, expected)) return true;
    const auto actual_vector = vector_type_parts(actual);
    const auto expected_vector = vector_type_parts(expected);
    const auto actual_list = maybe_dynamic_list_element_type(actual);
    const auto expected_list = maybe_dynamic_list_element_type(expected);
    if (!(actual_vector || actual_list) || !(expected_vector || expected_list)) return false;
    const std::string actual_element = actual_vector ? actual_vector->element : *actual_list;
    const std::string expected_element = expected_vector ? expected_vector->element : *expected_list;
    if (!compatible_broadcast_target_type(actual_element, expected_element)) return false;
    if (actual_vector && expected_vector && decimal_shape(actual_vector->shape) &&
        decimal_shape(expected_vector->shape) && actual_vector->shape != expected_vector->shape) {
        return false;
    }
    return true;
}

bool has_exact_broadcast_path(const std::string& actual, const std::string& expected) {
    if (exact_broadcast_target_type(actual, expected)) return true;
    if (const auto vector = vector_type_parts(actual)) {
        return has_exact_broadcast_path(vector->element, expected);
    }
    if (const auto list = maybe_dynamic_list_element_type(actual)) {
        return has_exact_broadcast_path(*list, expected);
    }
    return false;
}

bool collect_broadcast_dimension_bindings(
    const std::string& actual,
    const std::string& expected,
    std::map<std::string, std::string>& dimensions
) {
    const auto actual_vector = vector_type_parts(actual);
    const auto expected_vector = vector_type_parts(expected);
    if (!expected_vector) {
        if (structurally_compatible_type(actual, expected)) return true;
        if (actual_vector) {
            return collect_broadcast_dimension_bindings(
                actual_vector->element, expected, dimensions);
        }
        if (const auto actual_list = maybe_dynamic_list_element_type(actual)) {
            return collect_broadcast_dimension_bindings(*actual_list, expected, dimensions);
        }
        return false;
    }
    if (!actual_vector) return false;

    if (structurally_compatible_type(actual_vector->element, expected_vector->element)) {
        if (symbolic_shape_name(expected_vector->shape) &&
            (actual_vector->shape.empty() || decimal_shape(actual_vector->shape) ||
             symbolic_shape_name(actual_vector->shape))) {
            const auto found = dimensions.find(expected_vector->shape);
            if (found != dimensions.end() && found->second != actual_vector->shape) return false;
            dimensions[expected_vector->shape] = actual_vector->shape;
        }
        return collect_broadcast_dimension_bindings(
            actual_vector->element, expected_vector->element, dimensions);
    }
    return collect_broadcast_dimension_bindings(
        actual_vector->element, expected, dimensions);
}

std::string structurally_lifted_result_type(
    const std::string& actual,
    const std::string& expected,
    const std::string& result
) {
    if (compatible_broadcast_target_type(actual, expected)) {
        const auto actual_vector = vector_type_parts(actual);
        const auto expected_vector = vector_type_parts(expected);
        const auto result_vector = vector_type_parts(result);
        if (actual_vector && expected_vector && result_vector &&
            decimal_shape(actual_vector->shape) && expected_vector->shape.empty() &&
            result_vector->shape.empty()) {
            return "[" + structurally_lifted_result_type(
                actual_vector->element,
                expected_vector->element,
                result_vector->element) + ":" + actual_vector->shape + "]";
        }
        return result;
    }
    if (const auto vector = vector_type_parts(actual)) {
        const std::string element = structurally_lifted_result_type(
            vector->element, expected, result);
        return "[" + element + (vector->shape.empty() ? "" : ":" + vector->shape) + "]";
    }
    if (const auto list = maybe_dynamic_list_element_type(actual)) {
        return "list<" + structurally_lifted_result_type(*list, expected, result) + ">";
    }
    return actual;
}

void collect_structural_match_paths(
    const std::string& actual,
    const std::string& expected,
    const std::string& prefix,
    std::vector<std::string>& paths
) {
    if (compatible_broadcast_target_type(actual, expected)) {
        paths.push_back(prefix);
        return;
    }
    if (const auto vector = vector_type_parts(actual)) {
        collect_structural_match_paths(
            vector->element, expected, prefix.empty() ? "*" : prefix + ".*", paths);
        return;
    }
    if (const auto list = maybe_dynamic_list_element_type(actual)) {
        collect_structural_match_paths(
            *list, expected, prefix.empty() ? "*" : prefix + ".*", paths);
        return;
    }
}

bool structural_container_type(const std::string& type) {
    return vector_type_parts(type).has_value() ||
        maybe_dynamic_list_element_type(type).has_value();
}

std::string instantiate_vector_type(
    const std::string& type,
    const std::map<std::string, std::string>& dimensions,
    const std::map<std::string, std::string>& named_types = {}
) {
    if (const auto found = named_types.find(type); found != named_types.end()) {
        return found->second;
    }
    if (const auto parts = vector_type_parts(type)) {
        const std::string element = instantiate_vector_type(parts->element, dimensions, named_types);
        std::string shape = parts->shape;
        if (const auto found = dimensions.find(shape); found != dimensions.end()) {
            shape = found->second;
        }
        return "[" + element + (shape.empty() ? "" : ":" + shape) + "]";
    }
    if (starts_with(type, "tuple<") && type.back() == '>') {
        const auto items = split_top_level_type_parts(type.substr(6, type.size() - 7));
        std::string result = "tuple<";
        for (std::size_t index = 0; index < items.size(); ++index) {
            if (index != 0) result += ",";
            result += instantiate_vector_type(items[index], dimensions, named_types);
        }
        return result + ">";
    }
    if (starts_with(type, "record{") && type.back() == '}') {
        const auto fields = ordered_record_type_fields(type);
        std::string result = "record{";
        for (std::size_t index = 0; index < fields.size(); ++index) {
            if (index != 0) result += ",";
            result += fields[index].first + ":" +
                instantiate_vector_type(fields[index].second, dimensions, named_types);
        }
        return result + "}";
    }
    if (starts_with(type, "list<") && type.back() == '>') {
        return "list<" + instantiate_vector_type(
            type.substr(5, type.size() - 6), dimensions, named_types) + ">";
    }
    if (starts_with(type, "multiset<") && type.back() == '>') {
        return "multiset<" + instantiate_vector_type(
            type.substr(9, type.size() - 10), dimensions, named_types) + ">";
    }
    if (type.size() >= 3 && type.front() == '{' && type.back() == '}') {
        return "{" + instantiate_vector_type(
            type.substr(1, type.size() - 2), dimensions, named_types) + "}";
    }
    return type;
}

vf::JsonValue coerce_value_to_type(vf::JsonValue value, const std::string& target_type, const std::string& context) {
    if (target_type == "any") {
        return value;
    }
    auto& object = const_cast<vf::JsonValue::Object&>(object_of(value, context));
    const std::string source_type = string_field(object, "type", context);
    if (source_type == target_type || source_type == "null" ||
        canonical_function_type(source_type) == canonical_function_type(target_type)) {
        if (starts_with(source_type, "fn(") || starts_with(target_type, "fn(") ||
            source_type.find("->") != std::string::npos || target_type.find("->") != std::string::npos) {
            object["type"] = vf::JsonValue(canonical_function_type(target_type));
        }
        return value;
    }
    if (source_type == "any") {
        object["type"] = vf::JsonValue(target_type);
        return value;
    }
    if (const auto expansion = fixed_vector_type_descriptor_expansion(
            source_type, target_type)) {
        vf::JsonValue::Array items;
        items.reserve(expansion->second);
        for (std::size_t index = 0; index < expansion->second; ++index) {
            auto item = node("const");
            item["type"] = vf::JsonValue("type<" + expansion->first + ">");
            item["value"] = vf::JsonValue(render_surface_type(expansion->first));
            items.emplace_back(std::move(item));
        }
        auto expanded = node("list");
        expanded["items"] = vf::JsonValue(std::move(items));
        expanded["element_type"] = vf::JsonValue("type");
        expanded["type"] = vf::JsonValue(target_type);
        return vf::JsonValue(std::move(expanded));
    }
    if (const auto expansion = tuple_type_descriptor_expansion(
            source_type, target_type)) {
        vf::JsonValue::Array items;
        items.reserve(expansion->size());
        for (const auto& represented_type : *expansion) {
            auto item = node("const");
            item["type"] = vf::JsonValue("type<" + represented_type + ">");
            item["value"] = vf::JsonValue(render_surface_type(represented_type));
            items.emplace_back(std::move(item));
        }
        auto expanded = node("tuple");
        expanded["items"] = vf::JsonValue(std::move(items));
        expanded["type"] = vf::JsonValue(target_type);
        return vf::JsonValue(std::move(expanded));
    }
    if (target_type == "num" && source_type == "int") {
        object["type"] = vf::JsonValue("num");
        return value;
    }
    if (target_type == "type" && starts_with(source_type, "type<") &&
        source_type.back() == '>') {
        // Preserve the concrete metatype so native specialization can rewrite
        // calls through this parameter to the exact constructor.
        return value;
    }
    if (symbolic_subtype(source_type, target_type)) {
        object["type"] = vf::JsonValue(target_type);
        return value;
    }
    // Symbolic expressions use the direct runtime's owned numeric stream.
    // The native symbolic stdlib constructs stream slices as dynamic numeric
    // lists and seals them back to the opaque symbolic surface type.
    if (symbolic_expression_type(target_type) &&
        (source_type == "[num]" || source_type == "list<num>")) {
        object["type"] = vf::JsonValue(target_type);
        return value;
    }
    if (target_type.rfind("unit<", 0) == 0
        && (source_type == "int" || source_type == "num"
            || source_type == "f32" || source_type == "f64")) {
        object["type"] = vf::JsonValue(target_type);
        return value;
    }
    if (target_type.size() >= 3 && target_type.front() == '[' && target_type.back() == ']'
        && source_type.size() >= 3 && source_type.front() == '[' && source_type.back() == ']') {
        const std::string target_inner = target_type.substr(1, target_type.size() - 2);
        const std::string source_inner = source_type.substr(1, source_type.size() - 2);
        const std::size_t target_separator = target_inner.rfind(':');
        const std::size_t source_separator = source_inner.rfind(':');
        const std::string target_element = target_separator == std::string::npos
            ? target_inner : target_inner.substr(0, target_separator);
        const std::string source_element = source_separator == std::string::npos
            ? source_inner : source_inner.substr(0, source_separator);
        const bool element_coercible = structurally_compatible_type(source_element, target_element);
        bool shape_coercible = true;
        if (target_separator != std::string::npos && source_separator != std::string::npos) {
            const std::string target_shape = target_inner.substr(target_separator + 1);
            const std::string source_shape = source_inner.substr(source_separator + 1);
            const bool target_numeric = !target_shape.empty()
                && std::all_of(target_shape.begin(), target_shape.end(), [](unsigned char ch) { return std::isdigit(ch); });
            const bool source_numeric = !source_shape.empty()
                && std::all_of(source_shape.begin(), source_shape.end(), [](unsigned char ch) { return std::isdigit(ch); });
            shape_coercible = !(target_numeric && source_numeric && target_shape != source_shape);
        }
        if (element_coercible && shape_coercible) {
            const std::string target_shape = target_separator == std::string::npos
                ? std::string{} : target_inner.substr(target_separator + 1);
            const std::string source_shape = source_separator == std::string::npos
                ? std::string{} : source_inner.substr(source_separator + 1);
            // A symbolic dimension constrains the call but is not the runtime
            // representation. Preserve the concrete argument shape so native
            // monomorphic layout inference can allocate the exact width.
            if (!(symbolic_shape_name(target_shape) && decimal_shape(source_shape))) {
                object["type"] = vf::JsonValue(target_type);
            }
            return value;
        }
    }
    if (starts_with(target_type, "tuple<") && target_type.back() == '>' &&
        starts_with(source_type, "tuple<") && source_type.back() == '>') {
        const auto target_items = split_top_level_type_parts(
            target_type.substr(6, target_type.size() - 7));
        const auto source_items = split_top_level_type_parts(
            source_type.substr(6, source_type.size() - 7));
        auto items_it = object.find("items");
        if (target_items.size() == source_items.size() &&
            items_it != object.end() && items_it->second.is_array() &&
            items_it->second.as_array().size() == target_items.size()) {
            auto& items = items_it->second.as_array();
            for (std::size_t index = 0; index < items.size(); ++index) {
                items[index] = coerce_value_to_type(
                    std::move(items[index]), target_items[index],
                    context + " tuple item " + std::to_string(index));
            }
            object["type"] = vf::JsonValue(target_type);
            return value;
        }
    }
    if (target_type.size() >= 3 && target_type.front() == '[' && target_type.back() == ']'
        && starts_with(source_type, "list<") && source_type.back() == '>') {
        const std::string target_inner = target_type.substr(1, target_type.size() - 2);
        const std::size_t shape_separator = target_inner.rfind(':');
        const std::string target_element = shape_separator == std::string::npos
            ? target_inner
            : target_inner.substr(0, shape_separator);
        const std::string source_element = source_type.substr(5, source_type.size() - 6);
        const bool element_coercible = source_element == target_element
            || source_element == "any"
            || (source_element == "int" && target_element == "num");
        auto items_it = object.find("items");
        if (element_coercible && items_it != object.end() && items_it->second.is_array()) {
            auto& items = items_it->second.as_array();
            if (shape_separator != std::string::npos) {
                const std::string shape = target_inner.substr(shape_separator + 1);
                const bool numeric_shape = !shape.empty()
                    && std::all_of(shape.begin(), shape.end(), [](unsigned char ch) { return std::isdigit(ch); });
                if (numeric_shape && items.size() != static_cast<std::size_t>(std::stoull(shape))) {
                    throw IRFailure("cannot coerce " + source_type + " to " + target_type
                        + " in " + context + ": vector length mismatch");
                }
            }
            for (auto& item : items) {
                item = coerce_value_to_type(std::move(item), target_element, context + " vector item");
            }
            object["element_type"] = vf::JsonValue(target_element);
            object["type"] = vf::JsonValue(target_type);
            return value;
        }
    }
    if (starts_with(target_type, "record{") && target_type.back() == '}'
        && starts_with(source_type, "record{") && source_type.back() == '}') {
        auto target_field_type = [&](const std::string& field_name) -> std::string {
            const std::string inner = target_type.substr(7, target_type.size() - 8);
            std::size_t start = 0;
            while (start <= inner.size()) {
                const std::size_t comma = inner.find(',', start);
                const std::string part = inner.substr(
                    start,
                    comma == std::string::npos ? std::string::npos : comma - start
                );
                const std::size_t colon = part.find(':');
                if (colon != std::string::npos && part.substr(0, colon) == field_name) {
                    return part.substr(colon + 1);
                }
                if (comma == std::string::npos) break;
                start = comma + 1;
            }
            return "";
        };
        auto fields_it = object.find("fields");
        if (fields_it != object.end() && fields_it->second.is_array()) {
            for (auto& field_value : fields_it->second.as_array()) {
                auto& lowered_field = field_value.as_object();
                const std::string field_name = string_field(lowered_field, "name", context + " record field");
                const std::string field_target = target_field_type(field_name);
                if (field_target.empty()) {
                    throw IRFailure("cannot coerce " + source_type + " to " + target_type
                        + " in " + context + ": unexpected field " + field_name);
                }
                auto value_it = lowered_field.find("value");
                if (value_it == lowered_field.end()) {
                    throw IRFailure("missing record field value in " + context);
                }
                value_it->second = coerce_value_to_type(
                    std::move(value_it->second), field_target, context + " field " + field_name
                );
                lowered_field["type"] = vf::JsonValue(field_target);
            }
            object["type"] = vf::JsonValue(target_type);
            return value;
        }
    }
    if (is_nominal_constructor_name(target_type) && starts_with(source_type, "record{")) {
        object["type"] = vf::JsonValue(target_type);
        return value;
    }
    if (target_type == "bit" && source_type == "num") {
        const vf::JsonValue& raw = field(object, "value", context);
        if (raw.is_number() && (raw.as_number() == 0.0 || raw.as_number() == 1.0)) {
            object["type"] = vf::JsonValue("bit");
            object["value"] = vf::JsonValue(raw.as_number() == 1.0);
            return value;
        }
    }
    if (type_name_coercible(source_type, target_type)) {
        object["type"] = vf::JsonValue(target_type);
        return value;
    }
    if (target_type == "bit" && source_type == "int") {
        const vf::JsonValue& raw = field(object, "value", context);
        if (raw.is_number() && (raw.as_number() == 0.0 || raw.as_number() == 1.0)) {
            object["type"] = vf::JsonValue("bit");
            object["value"] = vf::JsonValue(raw.as_number() == 1.0);
            return value;
        }
    }
    throw IRFailure("cannot coerce " + source_type + " to " + target_type + " in " + context);
}

std::string merge_nullable_type(const std::string& current, const std::string& incoming) {
    if (current == "null") return incoming;
    if (incoming == "null") return current;
    if (current == incoming) return current;
    if ((current == "int" && incoming == "num") ||
        (current == "num" && incoming == "int")) return "num";
    if (symbolic_expression_type(current) && symbolic_expression_type(incoming)) {
        if (symbolic_subtype(current, incoming)) return incoming;
        if (symbolic_subtype(incoming, current)) return current;
        return "expression";
    }
    return "any";
}

std::string interpolation_text(std::string_view value) {
    std::string result;
    result.reserve(value.size());
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (value[index] == '\\' && index + 1 < value.size() && value[index + 1] == '$') {
            result.push_back('$');
            ++index;
        } else {
            result.push_back(value[index]);
        }
    }
    return result;
}

vf::JsonValue error_type_value(const std::string& name) {
    static const std::map<std::string, std::uint32_t> masks = {
        {"Error", 0b1},
        {"VektorFlowError", 0b11},
        {"LexError", 0b111},
        {"ParseError", 0b1011},
        {"EvalError", 0b10011},
        {"AssertionError", 0b1000011},
        {"PythonError", 0b100001},
        {"TypeError", 0b1100001},
        {"ValueError", 0b10100001},
        {"KeyError", 0b100100001},
        {"IndexError", 0b1000100001},
        {"FileNotFoundError", 0b10000100001},
        {"RuntimeError", 0b100000100001},
    };
    const auto found = masks.find(name);
    if (found == masks.end()) {
        throw IRFailure("unknown errors member " + name);
    }
    auto out = node("error_type");
    out["name"] = vf::JsonValue(name);
    out["mask"] = vf::JsonValue(static_cast<double>(found->second));
    out["type"] = vf::JsonValue("error_type");
    return vf::JsonValue(std::move(out));
}

std::string dynamic_list_element_type(const std::string& type_name) {
    if (starts_with(type_name, "list<") && type_name.size() > 6 && type_name.back() == '>') {
        return type_name.substr(5, type_name.size() - 6);
    }
    if (type_name.size() >= 3 && type_name.front() == '[' && type_name.back() == ']') {
        const std::string inner = type_name.substr(1, type_name.size() - 2);
        if (inner.find(':') == std::string::npos) return inner;
    }
    return "";
}

std::string symbolic_type_surface_from_value(const vf::JsonValue& value) {
    const auto& object = object_of(value, "symbolic type value");
    if (string_field(object, "kind", "symbolic type value") != "load") {
        return "";
    }
    const std::string name = string_field(object, "name", "symbolic type value");
    return vkf_symbolic_surface_is_scalar_domain(name) ? name : "";
}

std::string symbolic_greek_latex(const std::string& name) {
    static const std::map<std::string, std::string> names{
        {"alpha", "\\alpha"}, {"beta", "\\beta"}, {"gamma", "\\gamma"},
        {"delta", "\\delta"}, {"epsilon", "\\epsilon"}, {"zeta", "\\zeta"},
        {"eta", "\\eta"}, {"theta", "\\theta"}, {"iota", "\\iota"},
        {"kappa", "\\kappa"}, {"lambda", "\\lambda"}, {"mu", "\\mu"},
        {"nu", "\\nu"}, {"xi", "\\xi"}, {"omicron", "o"}, {"pi", "\\pi"},
        {"rho", "\\rho"}, {"sigma", "\\sigma"}, {"tau", "\\tau"},
        {"upsilon", "\\upsilon"}, {"phi", "\\phi"}, {"chi", "\\chi"},
        {"psi", "\\psi"}, {"omega", "\\omega"},
        {"Alpha", "\\mathrm{A}"}, {"Beta", "\\mathrm{B}"}, {"Gamma", "\\Gamma"},
        {"Delta", "\\Delta"}, {"Epsilon", "\\mathrm{E}"}, {"Zeta", "\\mathrm{Z}"},
        {"Eta", "\\mathrm{H}"}, {"Theta", "\\Theta"}, {"Iota", "\\mathrm{I}"},
        {"Kappa", "\\mathrm{K}"}, {"Lambda", "\\Lambda"}, {"Mu", "\\mathrm{M}"},
        {"Nu", "\\mathrm{N}"}, {"Xi", "\\Xi"}, {"Omicron", "\\mathrm{O}"},
        {"Pi", "\\Pi"}, {"Rho", "\\mathrm{P}"}, {"Sigma", "\\Sigma"},
        {"Tau", "\\mathrm{T}"}, {"Upsilon", "\\Upsilon"}, {"Phi", "\\Phi"},
        {"Chi", "\\mathrm{X}"}, {"Psi", "\\Psi"}, {"Omega", "\\Omega"},
    };
    const auto found = names.find(name);
    return found == names.end() ? name : found->second;
}

std::string default_symbolic_latex(const std::string& name, bool subscript = false) {
    const auto separator = name.find('_');
    if (separator == std::string::npos) {
        const std::string greek = symbolic_greek_latex(name);
        if (subscript && greek == name && name.size() > 1) {
            return "\\mathrm{" + name + "}";
        }
        if (!subscript && greek == name && name.size() > 1) {
            return "\\operatorname{" + name + "}";
        }
        return greek;
    }
    const std::string base = name.substr(0, separator);
    const std::string tail = name.substr(separator + 1);
    return default_symbolic_latex(base) + "_{" + default_symbolic_latex(tail, true) + "}";
}

vf::JsonValue symbolic_type_facts_json(const VkfSymbolicTypeFacts& facts) {
    auto out = node("symbolic_type_facts");
    out["symbolic"] = vf::JsonValue(facts.symbolic);
    std::string shape = "none";
    if (facts.shape == VkfSymbolicTypeShape::ScalarDomain) shape = "scalar_domain";
    if (facts.shape == VkfSymbolicTypeShape::VectorSpaceDomain) shape = "vector_space_domain";
    if (facts.shape == VkfSymbolicTypeShape::FunctionDomain) shape = "function_domain";
    if (facts.shape == VkfSymbolicTypeShape::FixedVectorDomain) shape = "fixed_vector_domain";
    out["shape"] = vf::JsonValue(shape);
    out["surface"] = vf::JsonValue(facts.surface);
    out["scalar_domain"] = vf::JsonValue(vkf_sym_domain_surface(facts.scalar_domain));
    out["base_surface"] = vf::JsonValue(facts.base_surface);
    out["exponent_surface"] = vf::JsonValue(facts.exponent_surface);
    out["domain_surface"] = vf::JsonValue(facts.domain_surface);
    out["codomain_surface"] = vf::JsonValue(facts.codomain_surface);
    return vf::JsonValue(std::move(out));
}

void attach_expression_facts(
    vf::JsonValue::Object& out,
    VkfExpressionLoweringMode mode,
    const std::string& value_type,
    VkfSymbolicCompilerNodeKind node_kind,
    const std::vector<std::string>& free_variables = {}
) {
    out["expression_mode"] = vf::JsonValue(mode == VkfExpressionLoweringMode::SymbolicNode ? "symbolic_node" : "value");
    if (mode != VkfExpressionLoweringMode::SymbolicNode) {
        return;
    }
    std::string kind = "literal";
    if (node_kind == VkfSymbolicCompilerNodeKind::Symbol) kind = "symbol";
    if (node_kind == VkfSymbolicCompilerNodeKind::Binary) kind = "binary";
    if (node_kind == VkfSymbolicCompilerNodeKind::Call) kind = "call";
    if (node_kind == VkfSymbolicCompilerNodeKind::Relation) kind = "relation";
    if (node_kind == VkfSymbolicCompilerNodeKind::Derivative) kind = "derivative";
    if (node_kind == VkfSymbolicCompilerNodeKind::Integral) kind = "integral";
    if (node_kind == VkfSymbolicCompilerNodeKind::Sum) kind = "sum";
    out["symbolic_node_kind"] = vf::JsonValue(kind);
    out["symbolic_type"] = symbolic_type_facts_json(vkf_symbolic_type_facts(value_type));
    vf::JsonValue::Array vars;
    for (const auto& variable : free_variables) {
        vars.push_back(vf::JsonValue(variable));
    }
    out["free_variables"] = vf::JsonValue(std::move(vars));
}

struct UiHandleRef {
    std::string kind;
    std::uint64_t id = 0;
};

struct UiStaticIdentity {
    std::string id;
    std::string type;
};

struct WorldObjectRef {
    std::uint64_t id = 0;
    std::string type;
    vf::JsonValue value;
};

struct WorldRef {
    std::uint64_t id = 0;
    vf::JsonValue::Object options;
    std::vector<WorldObjectRef> objects;
};

class Lowerer {
public:
    vf::JsonValue lower_module(const vf::JsonValue& ast) {
        const auto& object = object_of(ast, "module");
        const std::string kind = string_field(object, "kind", "module");
        if (kind != "module") {
            throw IRFailure("unsupported AST kind " + kind);
        }
        const auto& statements = array_of(field(object, "body", "module"), "module.body");
        for (const auto& stmt : statements) {
            const auto& statement = object_of(stmt, "module statement");
            if (string_field(statement, "kind", "module statement") != "type_alias") continue;
            type_aliases_[string_field(statement, "name", "type alias")] =
                type_annotation_name(field(statement, "type", "type alias"));
        }
        for (const auto& stmt : statements) {
            const auto& statement = object_of(stmt, "module statement");
            if (string_field(statement, "kind", "module statement") != "spill_import") continue;
            const auto& path = object_of(field(statement, "path", "spill_import"), "spill_import.path");
            if (string_field(path, "kind", "spill_import.path") != "dot_module_path") continue;
            const auto& segments = array_of(field(path, "segments", "spill_import.path"), "spill_import.path.segments");
            if (!segments.empty()) {
                std::string module_name;
                for (const auto& segment : segments) {
                    if (!segment.is_string()) {
                        module_name.clear();
                        break;
                    }
                    if (!module_name.empty()) module_name += '.';
                    module_name += segment.as_string();
                }
                if (module_name.empty()) continue;
                const auto& alias = field(statement, "alias", "spill_import");
                if (alias.is_null()) spilled_modules_.push_back(module_name);
                imported_modules_[alias.is_string() ? alias.as_string() : module_name] =
                    module_name;
            }
        }
        discover_static_ui_identities(statements);
        for (const auto& stmt : statements) {
            register_function_if_present(stmt, module_env_);
        }

        vf::JsonValue::Array body;
        vf::JsonValue::Object process_limits;
        for (const auto& stmt : statements) {
            const auto& statement = object_of(stmt, "module statement");
            if (string_field(statement, "kind", "module statement") == "bind") {
                const auto& target = object_of(
                    field(statement, "target", "process setting"), "process setting target");
                if (string_field(target, "kind", "process setting target") == "attribute") {
                    const auto& base = object_of(
                        field(target, "object", "process setting target"),
                        "process setting base");
                    if (string_field(base, "kind", "process setting base") == "identifier" &&
                        string_field(base, "name", "process setting base") == "process" &&
                        !module_env_.contains("process")) {
                        const std::string name = string_field(
                            target, "name", "process setting target");
                        if (name != "max_cores" && name != "enable_gpu") {
                            throw IRFailure("unknown process setting " + name);
                        }
                        if (process_limits.find(name) != process_limits.end()) {
                            throw IRFailure("duplicate process setting " + name);
                        }
                        const auto lowered = lower_expr(
                            field(statement, "value", "process setting"), module_env_);
                        const auto& value = object_of(lowered, "process setting value");
                        const auto raw = value.find("value");
                        if (string_field(value, "kind", "process setting value") != "const" ||
                            raw == value.end()) {
                            throw IRFailure("process." + name + " must be a compile-time constant");
                        }
                        if (name == "max_cores") {
                            if (string_field(value, "type", "process.max_cores") != "int" ||
                                !raw->second.is_number() || !std::isfinite(raw->second.as_number()) ||
                                std::floor(raw->second.as_number()) != raw->second.as_number() ||
                                raw->second.as_number() < 1.0 ||
                                raw->second.as_number() >
                                    static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
                                throw IRFailure("process.max_cores must be a positive constant int");
                            }
                        } else if (string_field(value, "type", "process.enable_gpu") != "bit" ||
                                   !raw->second.is_boolean()) {
                            throw IRFailure("process.enable_gpu must be a constant bit");
                        }
                        process_limits[name] = raw->second;
                        continue;
                    }
                }
            }
            body.push_back(lower_stmt(stmt, module_env_));
        }
        for (auto& binding : ui_retained_bindings_) {
            body.push_back(std::move(binding));
        }
        auto out = node("typed_module");
        out["body"] = vf::JsonValue(std::move(body));
        if (!process_limits.empty()) {
            out["process_limits"] = vf::JsonValue(std::move(process_limits));
        }
        if (!worlds_.empty()) {
            vf::JsonValue::Array worlds;
            for (const auto& world : worlds_) {
                vf::JsonValue::Object definition;
                definition["id"] = vf::JsonValue(static_cast<double>(world.id));
                definition["dimension"] = vf::JsonValue(2.0);
                for (const auto& [name, value] : world.options) {
                    definition[name] = value;
                }
                worlds.emplace_back(std::move(definition));
            }
            vf::JsonValue::Object program;
            program["version"] = vf::JsonValue(1.0);
            program["worlds"] = vf::JsonValue(std::move(worlds));
            program["operations"] = vf::JsonValue(std::move(world_operations_));
            out["__vf_internal_world"] = vf::JsonValue(std::move(program));
        }
        if (!ui_displays_.empty() || !ui_operations_.empty()) {
            vf::JsonValue::Object program;
            program["schema"] = vf::JsonValue("vektor-flow/ui-program");
            program["version"] = vf::JsonValue(1.0);
            program["displays"] = vf::JsonValue(std::move(ui_displays_));
            program["operations"] = vf::JsonValue(std::move(ui_operations_));
            program["result"] = vf::JsonValue(ui_result_type_);
            out["ui_program"] = vf::JsonValue(std::move(program));
        }
        return vf::JsonValue(std::move(out));
    }

private:
    void discover_static_ui_identities(const vf::JsonValue::Array& statements) {
        std::set<std::string> frame_bindings;
        for (const auto& statement_value : statements) {
            if (!statement_value.is_object()) continue;
            const auto& statement = statement_value.as_object();
            if (string_field(statement, "kind", "static Frame binding") != "bind") continue;
            const auto& target = object_of(
                field(statement, "target", "static Frame binding"),
                "static Frame binding target");
            const auto& value = object_of(
                field(statement, "value", "static Frame binding"),
                "static Frame binding value");
            if (string_field(target, "kind", "static Frame binding target") != "identifier" ||
                string_field(value, "kind", "static Frame binding value") != "call") {
                continue;
            }
            const auto& callee = object_of(
                field(value, "callee", "static Frame binding call"),
                "static Frame binding callee");
            if (string_field(callee, "kind", "static Frame binding callee") == "attribute" &&
                string_field(callee, "name", "static Frame binding callee") == "add_frame") {
                frame_bindings.insert(string_field(
                    target, "name", "static Frame binding target"));
            }
        }

        const auto inspect_for_load = [&](const auto& self, const vf::JsonValue& value) -> void {
            if (value.is_array()) {
                for (const auto& item : value.as_array()) self(self, item);
                return;
            }
            if (!value.is_object()) return;
            const auto& object = value.as_object();
            const auto kind = object.find("kind");
            if (kind != object.end() && kind->second.is_string() &&
                kind->second.as_string() == "call") {
                const auto callee = object.find("callee");
                if (callee != object.end() && callee->second.is_object()) {
                    const auto& callee_object = callee->second.as_object();
                    const auto callee_kind = callee_object.find("kind");
                    const auto name = callee_object.find("name");
                    if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                        callee_kind->second.as_string() == "attribute" &&
                        name != callee_object.end() && name->second.is_string() &&
                        name->second.as_string() == "load") {
                        const auto owner = callee_object.find("object");
                        if (owner != callee_object.end() && owner->second.is_object()) {
                            const auto& owner_object = owner->second.as_object();
                            const auto owner_kind = owner_object.find("kind");
                            const auto owner_name = owner_object.find("name");
                            has_static_html_load_ = has_static_html_load_ ||
                                (owner_kind != owner_object.end() &&
                                 owner_kind->second.is_string() &&
                                 owner_kind->second.as_string() == "identifier" &&
                                 owner_name != owner_object.end() &&
                                 owner_name->second.is_string() &&
                                 frame_bindings.find(owner_name->second.as_string()) !=
                                     frame_bindings.end());
                        }
                    }
                }
            }
            for (const auto& [name, child] : object) {
                (void)name;
                self(self, child);
            }
        };

        for (const auto& statement_value : statements) {
            inspect_for_load(inspect_for_load, statement_value);
            if (!statement_value.is_object()) continue;
            const auto& statement = statement_value.as_object();
            if (string_field(statement, "kind", "static retained identity") != "bind") continue;
            const auto& value = object_of(
                field(statement, "value", "static retained identity"),
                "static retained identity value");
            if (string_field(value, "kind", "static retained identity value") != "call") continue;
            const auto& callee = object_of(
                field(value, "callee", "static retained identity call"),
                "static retained identity callee");
            if (string_field(callee, "kind", "static retained identity callee") != "identifier") {
                continue;
            }
            const std::string identity = string_field(
                callee, "name", "static retained identity callee");
            if (!vf::html_component_catalog::Contains(identity)) continue;
            for (const auto& argument_value : array_of(
                     field(value, "args", "static retained identity call"),
                     "static retained identity arguments")) {
                if (!argument_value.is_object()) continue;
                const auto& argument = argument_value.as_object();
                if (string_field(argument, "kind", "static retained identity argument") !=
                        "named_call_arg" ||
                    string_field(argument, "name", "static retained identity argument") != "id") {
                    continue;
                }
                const auto& id = object_of(
                    field(argument, "value", "static retained identity id"),
                    "static retained identity id");
                const auto raw = id.find("value");
                if (string_field(id, "kind", "static retained identity id") == "string_literal" &&
                    raw != id.end() && raw->second.is_string() && !raw->second.as_string().empty()) {
                    ui_static_identities_.push_back(UiStaticIdentity{
                        raw->second.as_string(), identity});
                }
            }
        }
    }

    std::string ui_owner_lookup_type(const vf::JsonValue& id) const {
        std::optional<std::string> literal;
        std::string id_type;
        if (id.is_object()) {
            const auto& object = id.as_object();
            const auto kind = object.find("kind");
            const auto type = object.find("type");
            const auto value = object.find("value");
            if (type != object.end() && type->second.is_string()) {
                id_type = type->second.as_string();
            }
            if (kind != object.end() && kind->second.is_string() &&
                kind->second.as_string() == "const" &&
                id_type == "str" &&
                value != object.end() && value->second.is_string()) {
                literal = value->second.as_string();
            }
        }

        std::vector<std::string> types;
        const auto add = [&](const std::string& type) {
            if (std::find(types.begin(), types.end(), type) == types.end()) {
                types.push_back(type);
            }
        };
        if (id_type == "str") {
            for (const auto& identity : ui_static_identities_) {
                if (!literal.has_value() || identity.id == *literal) add(identity.type);
            }
            if (has_static_html_load_ && (!literal.has_value() || types.empty())) {
                for (const auto& entry : vf::html_component_catalog::kEntries) {
                    add(std::string(entry.identity));
                }
            }
        } else if (id_type == "int") {
            add("Frame<2>");
            add("View");
            add("Layer");
        }
        if (types.empty()) return "null";
        std::string result;
        for (const auto& type : types) {
            if (!result.empty()) result += "|";
            result += type;
        }
        return result + "|null";
    }

    static std::string primitive_type_name(const std::string& name, const TypeEnv& env) {
        const auto direct = [](const std::string& value) {
            return value == "bit" || value == "chr" || value == "int" ||
                value == "num" || value == "str";
        };
        if (direct(name) && !env.contains(name)) return name;
        const std::string type = env.get(name);
        if (starts_with(type, "type<") && type.size() > 6 && type.back() == '>') {
            const std::string primitive = type.substr(5, type.size() - 6);
            if (direct(primitive)) return primitive;
        }
        return "";
    }

    static std::vector<std::pair<std::string, std::string>> primitive_type_fields(
        const std::string& primitive
    ) {
        std::vector<std::pair<std::string, std::string>> fields{
            {"size", "(value:" + primitive + ") -> int"}
        };
        if (primitive == "str") {
            fields.push_back({"length", "(value:str) -> int"});
            fields.push_back({"has", "(value:str, item:any) -> bit"});
            fields.push_back({"count", "(value:str, item:any) -> int"});
            fields.push_back({"is_num", "(value:str) -> bit"});
            fields.push_back({"is_int", "(value:str) -> bit"});
            fields.push_back({"is_bool", "(value:str) -> bit"});
        }
        return fields;
    }

    std::string resolve_type_alias(std::string type) const {
        std::set<std::string> visited;
        while (visited.insert(type).second) {
            const auto found = type_aliases_.find(type);
            if (found == type_aliases_.end()) break;
            type = found->second;
        }
        if (const auto vector = vector_type_parts(type)) {
            return "[" + resolve_type_alias(vector->element) +
                (vector->shape.empty() ? "" : ":" + vector->shape) + "]";
        }
        if (starts_with(type, "list<") && type.back() == '>') {
            return "list<" + resolve_type_alias(type.substr(5, type.size() - 6)) + ">";
        }
        if (starts_with(type, "tuple<") && type.back() == '>') {
            const auto items = split_top_level_type_parts(type.substr(6, type.size() - 7));
            std::string resolved = "tuple<";
            for (std::size_t index = 0; index < items.size(); ++index) {
                if (index != 0) resolved += ",";
                resolved += resolve_type_alias(items[index]);
            }
            return resolved + ">";
        }
        if (starts_with(type, "record{") && type.back() == '}') {
            const auto fields = split_top_level_type_parts(type.substr(7, type.size() - 8));
            std::string resolved = "record{";
            for (std::size_t index = 0; index < fields.size(); ++index) {
                const auto colon = fields[index].find(':');
                if (index != 0) resolved += ",";
                if (colon == std::string::npos) resolved += fields[index];
                else resolved += fields[index].substr(0, colon + 1) +
                    resolve_type_alias(fields[index].substr(colon + 1));
            }
            return resolved + "}";
        }
        if (type.size() >= 2 && type.front() == '(' && type.back() == ')' &&
            type.find(':') != std::string::npos) {
            return resolve_type_alias("record{" + type.substr(1, type.size() - 2) + "}");
        }
        return type;
    }

    static vf::JsonValue string_const(std::string value) {
        auto out = node("const");
        out["type"] = vf::JsonValue("str");
        out["value"] = vf::JsonValue(std::move(value));
        return vf::JsonValue(std::move(out));
    }

    static vf::JsonValue type_const(const std::string& represented_type) {
        vf::JsonValue out = string_const(render_surface_type(represented_type));
        out.as_object()["type"] = vf::JsonValue("type<" + represented_type + ">");
        return out;
    }

    vf::JsonValue lower_container_spill(
        const vf::JsonValue::Object& object,
        TypeEnv& env
    ) {
        const std::string container = string_field(object, "container", "container spill");
        const auto& raw_value = object_of(field(object, "value", "container spill"),
                                          "container spill value");
        const bool explicit_type = string_field(raw_value, "kind", "container spill value") == "type_of";
        const auto& subject = explicit_type
            ? object_of(field(raw_value, "value", "type spill"), "type spill subject")
            : raw_value;
        std::string primitive;
        if (string_field(subject, "kind", "container spill subject") == "identifier") {
            primitive = primitive_type_name(
                string_field(subject, "name", "container spill subject"), env);
        }
        bool type_spill = explicit_type || !primitive.empty();
        vf::JsonValue lowered_subject = lower_expr(subject, env);
        std::string subject_type = string_field(
            lowered_subject.as_object(), "type", "container spill subject");
        if (primitive.empty() && starts_with(subject_type, "type<") &&
            subject_type.back() == '>') {
            type_spill = true;
            subject_type = subject_type.substr(5, subject_type.size() - 6);
        }
        if (primitive.empty() && type_spill) {
            const auto representation = nominal_representations_.find(subject_type);
            if (representation != nominal_representations_.end()) {
                subject_type = representation->second;
            }
        }
        const auto nominal_representation = nominal_representations_.find(subject_type);
        if (!type_spill && container == "record" &&
            nominal_representation != nominal_representations_.end()) {
            lowered_subject.as_object()["type"] = vf::JsonValue(
                nominal_representation->second);
            return lowered_subject;
        }
        subject_type = resolve_type_alias(subject_type);
        std::string record_value_type = subject_type;
        if (!type_spill && (container == "vector" || container == "multiset") &&
            nominal_representation != nominal_representations_.end()) {
            record_value_type = resolve_type_alias(nominal_representation->second);
        }
        const bool record_value_key_spill =
            !type_spill && (container == "vector" || container == "multiset") &&
            starts_with(record_value_type, "record{") && record_value_type.back() == '}';
        if (record_value_key_spill) subject_type = std::move(record_value_type);
        const bool record_key_vector_spill =
            container == "vector" && primitive.empty() &&
            starts_with(subject_type, "record{") && subject_type.back() == '}';

        if (type_spill && primitive.empty() && container == "record" &&
            (!ordered_record_type_fields(subject_type).empty() ||
             (starts_with(subject_type, "tuple<") && subject_type.back() == '>'))) {
            return type_const(subject_type);
        }

        if (!type_spill && container == "record") return lowered_subject;

        if (!type_spill &&
            (container == "vector" || container == "multiset") &&
            !record_value_key_spill) {
            std::vector<std::string> element_types;
            bool dynamic_vector = false;
            if (starts_with(subject_type, "tuple<") && subject_type.back() == '>') {
                element_types = split_top_level_type_parts(
                    subject_type.substr(6, subject_type.size() - 7));
            } else if (subject_type.size() >= 2 && subject_type.front() == '[' &&
                       subject_type.back() == ']') {
                const std::string inner = subject_type.substr(1, subject_type.size() - 2);
                const std::size_t shape = inner.rfind(':');
                const std::string element = shape == std::string::npos
                    ? inner : inner.substr(0, shape);
                std::size_t count = 1;
                if (shape == std::string::npos) {
                    dynamic_vector = true;
                } else {
                    try {
                        count = static_cast<std::size_t>(std::stoull(inner.substr(shape + 1)));
                    } catch (...) {
                        if (symbolic_shape_name(inner.substr(shape + 1))) {
                            dynamic_vector = true;
                        } else {
                            throw IRFailure("container value spill requires a fixed numeric shape");
                        }
                    }
                }
                element_types.assign(count, element);
            } else if (starts_with(subject_type, "list<") && subject_type.back() == '>') {
                element_types.push_back(subject_type.substr(5, subject_type.size() - 6));
                dynamic_vector = true;
            } else if (starts_with(subject_type, "multiset<") && subject_type.back() == '>') {
                if (container == "multiset") return lowered_subject;
                throw IRFailure("vector generation from a multiset requires explicit count expansion");
            } else {
                throw IRFailure("container value spill requires a vector, tuple, list, or multiset");
            }
            if (element_types.empty()) {
                throw IRFailure("container value spill requires at least one element");
            }
            const std::string element_type = element_types.front();
            if (!std::all_of(element_types.begin(), element_types.end(),
                             [&](const auto& item) { return item == element_type; })) {
                throw IRFailure("vector and multiset generation require one compatible element type");
            }
            if (container == "vector") {
                if (dynamic_vector) return lowered_subject;
                auto spread = node("spread");
                spread["value"] = std::move(lowered_subject);
                spread["type"] = vf::JsonValue(subject_type);
                vf::JsonValue::Array items;
                items.emplace_back(std::move(spread));
                auto out = node("list");
                out["items"] = vf::JsonValue(std::move(items));
                out["element_type"] = vf::JsonValue(element_type);
                out["type"] = vf::JsonValue(
                    "[" + element_type + ":" + std::to_string(element_types.size()) + "]");
                return vf::JsonValue(std::move(out));
            }
            auto out = node("multiset_from_collection");
            out["value"] = std::move(lowered_subject);
            out["element_type"] = vf::JsonValue(element_type);
            out["type"] = vf::JsonValue("multiset<" + element_type + ">");
            return vf::JsonValue(std::move(out));
        }

        std::vector<std::pair<std::string, std::string>> members;
        if (!primitive.empty()) {
            members = primitive_type_fields(primitive);
        } else {
            members = ordered_record_type_fields(subject_type);
            if (members.empty() && starts_with(subject_type, "tuple<") &&
                subject_type.back() == '>') {
                const auto items = split_top_level_type_parts(
                    subject_type.substr(6, subject_type.size() - 7));
                for (std::size_t index = 0; index < items.size(); ++index) {
                    members.push_back({std::to_string(index), items[index]});
                }
            }
        }
        if (members.empty() && !record_key_vector_spill) {
            throw IRFailure("container type spill requires a structured or primitive type");
        }

        if (container == "record") {
            vf::JsonValue::Array fields;
            std::string type = "record{";
            for (std::size_t index = 0; index < members.size(); ++index) {
                if (index != 0) type += ",";
                const std::string member_type = resolve_type_alias(members[index].second);
                const std::string value_type = "type<" + member_type + ">";
                type += members[index].first + ":" + value_type;
                auto item = node("field");
                item["name"] = vf::JsonValue(members[index].first);
                item["type"] = vf::JsonValue(value_type);
                item["value"] = type_const(member_type);
                fields.emplace_back(std::move(item));
            }
            type += "}";
            auto out = node("record");
            out["fields"] = vf::JsonValue(std::move(fields));
            out["type"] = vf::JsonValue(std::move(type));
            return vf::JsonValue(std::move(out));
        }
        if (container == "vector") {
            if (record_key_vector_spill) {
                vf::JsonValue::Array items;
                for (const auto& member : members) {
                    items.push_back(string_const(member.first));
                }
                auto out = node("list");
                out["items"] = vf::JsonValue(std::move(items));
                out["element_type"] = vf::JsonValue("str");
                out["type"] = vf::JsonValue(
                    "[str:" + std::to_string(members.size()) + "]");
                return vf::JsonValue(std::move(out));
            }
            if (primitive.empty()) {
                const std::string element_type = resolve_type_alias(members.front().second);
                if (!std::all_of(members.begin() + 1, members.end(), [&](const auto& member) {
                        return resolve_type_alias(member.second) == element_type;
                    })) {
                    throw IRFailure("vector type spill requires one exact member type");
                }
                return type_const(
                    "[" + element_type + ":" + std::to_string(members.size()) + "]");
            }
            vf::JsonValue::Array items;
            std::string element_type;
            for (const auto& member : members) {
                const std::string member_type = resolve_type_alias(member.second);
                const std::string value_type = "type<" + member_type + ">";
                if (element_type.empty()) element_type = value_type;
                else if (element_type != value_type) element_type = "type";
                items.push_back(type_const(member_type));
            }
            auto out = node("list");
            out["items"] = vf::JsonValue(std::move(items));
            out["element_type"] = vf::JsonValue(element_type);
            out["type"] = vf::JsonValue("list<" + element_type + ">");
            return vf::JsonValue(std::move(out));
        }
        if (container == "multiset") {
            vf::JsonValue::Array pairs;
            for (const auto& member : members) {
                auto pair = node("multiset_pair");
                pair["key"] = string_const(member.first);
                pair["count"] = num_const(1.0);
                pairs.emplace_back(std::move(pair));
            }
            auto out = node("multiset");
            out["pairs"] = vf::JsonValue(std::move(pairs));
            out["element_type"] = vf::JsonValue("str");
            out["type"] = vf::JsonValue("multiset<str>");
            return vf::JsonValue(std::move(out));
        }
        throw IRFailure("unknown container spill kind " + container);
    }

    void register_function_if_present(const vf::JsonValue& ast, TypeEnv& env) {
        if (kind_of(ast) != "function_definition") {
            return;
        }
        const auto& object = object_of(ast, "function_definition");
        const std::string name = string_field(object, "name", "function_definition");
        std::vector<std::string> param_types;
        for (const auto& param_value : array_of(field(object, "params", "function_definition"), "function params")) {
            const auto& param = object_of(param_value, "param");
            param_types.push_back(type_annotation_name(field(param, "type", "param")));
        }
        const std::string representation_type = type_annotation_name(
            field(object, "return_type", "function_definition"));
        const std::string return_type = is_nominal_constructor_name(name)
            ? name : representation_type;
        const std::string signature = function_signature_type(param_types, return_type);
        functions_.set({
            name, {}, param_types, {}, {}, {}, return_type, representation_type,
            signature, vf::JsonValue(nullptr)});
        env.set(name, signature);
    }

    vf::JsonValue lower_stmt(const vf::JsonValue& ast, TypeEnv& env) {
        const auto& object = object_of(ast, "statement");
        const std::string kind = string_field(object, "kind", "statement");
        if (kind == "type_alias") {
            auto out = node("type_alias");
            out["name"] = field(object, "name", "type_alias");
            out["type_annotation"] = field(object, "type", "type_alias");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "bind") {
            const auto& target = object_of(field(object, "target", "bind"), "bind.target");
            const std::string target_kind = string_field(target, "kind", "bind.target");
            if (target_kind == "identifier") {
                const std::string name = string_field(target, "name", "bind.target");
                const auto update_only = object.find("update_only");
                const bool is_update = update_only != object.end() &&
                    update_only->second.is_boolean() && update_only->second.as_boolean();
                if (is_update && !env.contains(name)) {
                    throw IRFailure(
                        "Cannot update unknown name ." + name +
                        "; declare it first with " + name + ":value");
                }
                if (!is_update && env.declared_here(name)) {
                    throw IRFailure(
                        "Cannot declare existing name " + name +
                        "; update it with ." + name + ":value");
                }
                const auto& raw_value = object_of(field(object, "value", "bind"), "bind value");
                if (symbolic_imported_ && string_field(raw_value, "kind", "bind value") == "call") {
                    const auto& compile_callee = object_of(
                        field(raw_value, "callee", "compiled expression"), "compiled expression callee");
                    if (string_field(compile_callee, "kind", "compiled expression callee") == "identifier" &&
                        string_field(compile_callee, "name", "compiled expression callee") == "compile") {
                        if (is_update) throw IRFailure("compiled function bindings cannot be updated in place");
                        const auto& compile_args = array_of(
                            field(raw_value, "args", "compiled expression"), "compiled expression args");
                        if (compile_args.size() != 2) {
                            throw IRFailure("compile(expression, [variables]) requires exactly two arguments");
                        }
                        const auto& variable_list = object_of(
                            compile_args[1], "compiled expression variables");
                        if (string_field(variable_list, "kind", "compiled expression variables") != "list_literal") {
                            throw IRFailure("compile variables must be a vector of symbols");
                        }
                        vf::JsonValue::Array params;
                        std::set<std::string> parameter_names;
                        for (const auto& variable : array_of(
                                 field(variable_list, "items", "compiled expression variables"),
                                 "compiled expression variable items")) {
                            const auto& variable_object = object_of(variable, "compiled expression variable");
                            if (string_field(variable_object, "kind", "compiled expression variable") != "identifier") {
                                throw IRFailure("compile variables must contain only named symbols");
                            }
                            const std::string parameter_name = string_field(
                                variable_object, "name", "compiled expression variable");
                            if (symbolic_bindings_.find(parameter_name) == symbolic_bindings_.end()) {
                                throw IRFailure("compile variable " + parameter_name + " is not a symbolic binding");
                            }
                            if (!parameter_names.insert(parameter_name).second) {
                                throw IRFailure("compile variable " + parameter_name + " is duplicated");
                            }
                            auto param = node("param");
                            param["name"] = vf::JsonValue(parameter_name);
                            auto type = node("type_annotation");
                            type["name"] = vf::JsonValue("num");
                            param["type"] = vf::JsonValue(std::move(type));
                            param["default"] = vf::JsonValue(nullptr);
                            param["variadic_positional"] = vf::JsonValue(false);
                            param["variadic_named"] = vf::JsonValue(false);
                            params.emplace_back(std::move(param));
                        }
                        if (params.empty()) throw IRFailure("compile requires at least one symbolic variable");
                        vf::JsonValue compiled_body = compile_args[0];
                        std::set<std::string> expanding_sources;
                        expand_bound_symbolic_expression_sources(
                            compiled_body,
                            expanding_sources
                        );
                        const bool fully_bound = symbolic_expression_is_fully_bound(
                            compiled_body, parameter_names);
                        auto function = node("function_definition");
                        function["name"] = vf::JsonValue(name);
                        function["params"] = vf::JsonValue(std::move(params));
                        auto return_type = node("type_annotation");
                        return_type["name"] = vf::JsonValue(fully_bound ? "num" : "expression");
                        function["return_type"] = vf::JsonValue(std::move(return_type));
                        if (!fully_bound) {
                            materialize_unbound_symbolic_bindings(compiled_body, parameter_names);
                        }
                        function["body"] = std::move(compiled_body);
                        vf::JsonValue lowered = lower_function(function, env);
                        env.mark_declared(name);
                        return lowered;
                    }
                }
                if (string_field(raw_value, "kind", "bind value") == "lambda_expr") {
                    vf::JsonValue::Array params;
                    for (const auto& raw_param : array_of(
                             field(raw_value, "params", "stored lambda"),
                             "stored lambda params")) {
                        if (!raw_param.is_string()) {
                            throw IRFailure("lambda parameter must be name");
                        }
                        auto param = node("param");
                        param["name"] = raw_param;
                        auto type = node("type_annotation");
                        type["name"] = vf::JsonValue("any");
                        param["type"] = vf::JsonValue(std::move(type));
                        param["default"] = vf::JsonValue(nullptr);
                        param["variadic_positional"] = vf::JsonValue(false);
                        param["variadic_named"] = vf::JsonValue(false);
                        params.emplace_back(std::move(param));
                    }
                    auto function = node("function_definition");
                    function["name"] = vf::JsonValue(name);
                    function["params"] = vf::JsonValue(std::move(params));
                    auto return_type = node("type_annotation");
                    return_type["name"] = vf::JsonValue("any");
                    function["return_type"] = vf::JsonValue(std::move(return_type));
                    function["body"] = field(raw_value, "body", "stored lambda");
                    vf::JsonValue lowered = lower_function(function, env);
                    if (!is_update) env.mark_declared(name);
                    return lowered;
                }
                std::string primitive_value;
                if (string_field(raw_value, "kind", "bind value") == "identifier") {
                    primitive_value = primitive_type_name(
                        string_field(raw_value, "name", "bind value"), env);
                }
                vf::JsonValue value = primitive_value.empty()
                    ? lower_expr(field(object, "value", "bind"), env)
                    : string_const(primitive_value);
                if (!primitive_value.empty()) {
                    value.as_object()["type"] = vf::JsonValue("type<" + primitive_value + ">");
                }
                std::string value_type = string_field(value.as_object(), "type", "IR value");
                const auto type_it = object.find("type");
                if (type_it != object.end() && !type_it->second.is_null()) {
                    const std::string declared_type = type_annotation_name(type_it->second);
                    value = coerce_value_to_type(std::move(value), declared_type, "declared bind");
                    value_type = declared_type;
                } else if (symbolic_imported_) {
                    std::string symbolic_surface = symbolic_surface_ast(raw_value);
                    if (symbolic_surface.empty()) {
                        symbolic_surface = symbolic_type_surface_from_value(value);
                    }
                    if (!symbolic_surface.empty()) {
                        auto symbolic_value = node("symbolic_var");
                        symbolic_value["name"] = vf::JsonValue(name);
                        symbolic_value["domain"] = vf::JsonValue(symbolic_surface);
                        symbolic_value["symbol_kind"] = vf::JsonValue("variable");
                        symbolic_value["latex"] = vf::JsonValue(default_symbolic_latex(name));
                        symbolic_value["type"] = vf::JsonValue("symbol");
                        attach_expression_facts(
                            symbolic_value,
                            VkfExpressionLoweringMode::SymbolicNode,
                            symbolic_surface,
                            VkfSymbolicCompilerNodeKind::Symbol,
                            {name}
                        );
                        value = vf::JsonValue(std::move(symbolic_value));
                        value_type = "symbol";
                    }
                }
                std::string environment_type = value_type;
                if (is_update && value_type == "any") {
                    environment_type = env.get(name);
                }
                if ((type_it == object.end() || type_it->second.is_null()) &&
                    string_field(value.as_object(), "kind", "IR value") == "list") {
                    const auto& items = array_of(
                        field(value.as_object(), "items", "IR list"), "IR list items");
                    const bool has_spread = std::any_of(
                        items.begin(), items.end(), [](const auto& item) {
                            return item.is_object() &&
                                string_field(item.as_object(), "kind", "IR list item") == "spread";
                        });
                    const auto element = value.as_object().find("element_type");
                    if (!has_spread && element != value.as_object().end() &&
                        element->second.is_string()) {
                        environment_type = "[" + element->second.as_string() + ":" +
                            std::to_string(items.size()) + "]";
                    }
                }
                if (is_update) env.set(name, environment_type);
                else env.declare(name, environment_type);
                if (value_type == "Display<2>" || value_type == "Frame<2>" ||
                    value_type == "Layer") {
                    const auto& handle = object_of(value, "UI handle");
                    const auto& raw_handle = field(handle, "value", "UI handle");
                    if (string_field(handle, "kind", "UI handle") != "const" ||
                        !raw_handle.is_number() || raw_handle.as_number() < 0.0) {
                        throw IRFailure("retained UI handle must be a non-negative constant");
                    }
                    ui_handle_bindings_[name] = UiHandleRef{
                        value_type == "Display<2>" ? "display" :
                        value_type == "Frame<2>" ? "frame" : "layer",
                        static_cast<std::uint64_t>(raw_handle.as_number())
                    };
                }
                if (value_type == "World<2>") {
                    const auto& handle = object_of(value, "World handle");
                    const auto& raw_handle = field(handle, "value", "World handle");
                    if (string_field(handle, "kind", "World handle") != "const" ||
                        !raw_handle.is_number() || raw_handle.as_number() < 0.0) {
                        throw IRFailure("retained World handle must be a non-negative constant");
                    }
                    world_handle_bindings_[name] = static_cast<std::uint64_t>(
                        raw_handle.as_number());
                }
                remember_symbolic_binding(name, value);
                if (is_update) {
                    symbolic_expression_sources_.erase(name);
                } else if (value_type == "expression" || value_type == "symbolic") {
                    symbolic_expression_sources_[name] = raw_value;
                }

                auto out = node("store_binding");
                out["name"] = vf::JsonValue(name);
                out["type"] = vf::JsonValue(value_type);
                out["value"] = std::move(value);
                out["update"] = vf::JsonValue(is_update);
                return vf::JsonValue(std::move(out));
            }
            if (target_kind == "attribute") {
                const auto& base = object_of(field(target, "object", "attribute"), "bind.target.object");
                if (string_field(base, "kind", "bind.target.object") != "identifier") {
                    throw IRFailure("unsupported attribute bind base");
                }
                const std::string base_name = string_field(base, "name", "bind.target.object");
                const std::string index_name = string_field(target, "name", "bind.target");
                const std::string base_type = env.get(base_name);
                if (symbolic_expression_type(base_type) && index_name == "latex") {
                    vf::JsonValue latex_value = lower_expr(field(object, "value", "symbolic latex"), env);
                    const auto& latex_object = object_of(latex_value, "symbolic latex");
                    const auto raw = latex_object.find("value");
                    if (string_field(latex_object, "kind", "symbolic latex") != "const" ||
                        string_field(latex_object, "type", "symbolic latex") != "str" ||
                        raw == latex_object.end() || !raw->second.is_string()) {
                        throw IRFailure("symbolic .latex override must be a compile-time string");
                    }
                    const auto known = symbolic_bindings_.find(base_name);
                    if (known == symbolic_bindings_.end()) {
                        throw IRFailure("symbolic .latex can only update a named symbolic variable, function, or constant");
                    }
                    auto replacement = node("symbolic_var");
                    replacement["name"] = vf::JsonValue(known->second.name);
                    replacement["domain"] = vf::JsonValue(known->second.domain);
                    replacement["symbol_kind"] = vf::JsonValue(known->second.kind);
                    replacement["latex"] = raw->second;
                    replacement["type"] = vf::JsonValue(base_type);
                    known->second.latex = raw->second.as_string();
                    auto out = node("store_binding");
                    out["name"] = vf::JsonValue(base_name);
                    out["type"] = vf::JsonValue(base_type);
                    out["value"] = vf::JsonValue(std::move(replacement));
                    out["update"] = vf::JsonValue(true);
                    return vf::JsonValue(std::move(out));
                }
                const bool vector_base = starts_with(base_type, "list<") ||
                    (base_type.size() >= 2 && base_type.front() == '[' && base_type.back() == ']');
                if (vector_base && index_name != "length") {
                    throw IRFailure(
                        "vector member " + index_name + " is not an index; use .(" +
                        index_name + ") to evaluate it");
                }
                auto out = node("update_attr");
                out["base_name"] = vf::JsonValue(base_name);
                out["field"] = vf::JsonValue(index_name);
                vf::JsonValue value = lower_expr(field(object, "value", "bind"), env);
                out["value"] = std::move(value);
                return vf::JsonValue(std::move(out));
            }
            if (target_kind == "dotted_index") {
                const vf::JsonValue* base_value = &field(target, "base", "dotted_index");
                std::vector<const vf::JsonValue::Array*> nested_index_groups;
                while (string_field(object_of(*base_value, "bind.target.base"), "kind", "bind.target.base") == "dotted_index") {
                    const auto& nested = object_of(*base_value, "bind.target.base");
                    nested_index_groups.push_back(&array_of(
                        field(nested, "indices", "dotted_index"),
                        "bind.target.indices"));
                    base_value = &field(nested, "base", "dotted_index");
                }
                const auto& base = object_of(*base_value, "bind.target.base");
                if (string_field(base, "kind", "bind.target.base") != "identifier") {
                    throw IRFailure("unsupported dotted_index bind base");
                }
                vf::JsonValue::Array indices;
                const auto append_index = [&](const vf::JsonValue& index_ast) {
                    const auto& index_object = object_of(index_ast, "bind.target.index");
                    const std::string index_kind = string_field(
                        index_object, "kind", "bind.target.index");
                    if (index_kind == "spread_arg") {
                        vf::JsonValue spread_value = lower_expr(
                            field(index_object, "expr", "bind target index spill"), env);
                        const std::string spread_type = string_field(
                            spread_value.as_object(), "type", "bind target index spill");
                        const auto spread_shape = fixed_numeric_vector_shape(spread_type);
                        if (!spread_shape.has_value() || spread_shape->dimensions.size() != 1) {
                            throw IRFailure(
                                "multidimensional index spill requires one fixed vector of numeric coordinates");
                        }
                        auto spread = node("spread_index");
                        spread["value"] = std::move(spread_value);
                        spread["count"] = vf::JsonValue(
                            static_cast<double>(spread_shape->dimensions.front()));
                        spread["type"] = vf::JsonValue(spread_type);
                        indices.emplace_back(std::move(spread));
                        return;
                    }
                    if (index_kind == "named_call_arg") {
                        throw IRFailure("multidimensional indices do not accept named arguments");
                    }
                    indices.push_back(lower_expr(index_ast, env));
                };
                for (auto group = nested_index_groups.rbegin(); group != nested_index_groups.rend(); ++group) {
                    for (const auto& index_ast : **group) {
                        append_index(index_ast);
                    }
                }
                for (const auto& index_ast : array_of(field(target, "indices", "dotted_index"), "bind.target.indices")) {
                    append_index(index_ast);
                }
                auto out = node("update_index");
                out["base_name"] = vf::JsonValue(string_field(base, "name", "bind.target.base"));
                out["indices"] = vf::JsonValue(std::move(indices));
                vf::JsonValue value = lower_expr(field(object, "value", "bind"), env);
                out["value"] = std::move(value);
                return vf::JsonValue(std::move(out));
            }
            throw IRFailure("unsupported bind target kind " + target_kind);
        }
        if (kind == "spill_import") {
            auto out = node("module_import");
            out["path"] = field(object, "path", "spill_import");
            out["alias"] = field(object, "alias", "spill_import");
            const auto& path_object = object_of(field(object, "path", "spill_import"), "spill_import.path");
            if (string_field(path_object, "kind", "spill_import.path") == "dot_module_path") {
                const auto& segments = array_of(field(path_object, "segments", "spill_import.path"), "spill_import.path.segments");
                if (segments.size() == 1 && segments[0].is_string() && segments[0].as_string() == "symbolic") {
                    symbolic_imported_ = true;
                    env.set("N", "symbolic_domain");
                    env.set("Z", "symbolic_domain");
                    env.set("Q", "symbolic_domain");
                    env.set("R", "symbolic_domain");
                    env.set("C", "symbolic_domain");
                    env.set("path_status", "fn(symbolic,symbolic)->symbolic");
                    env.set("transform_path_status", "fn(symbolic)->symbolic");
                    env.set("transform_path_beam_status", "fn(symbolic,int)->symbolic");
                }
            }
            return vf::JsonValue(std::move(out));
        }
        if (kind == "spill_value") {
            const auto& raw_value = object_of(field(object, "value", "spill_value"),
                                              "spill_value value");
            if (string_field(raw_value, "kind", "spill_value value") == "identifier") {
                const std::string primitive = primitive_type_name(
                    string_field(raw_value, "name", "spill_value value"), env);
                if (!primitive.empty()) {
                    for (const auto& member : primitive_type_fields(primitive)) {
                        env.set(member.first,
                            "primitive_member<" + primitive + ":" + member.first + ">");
                    }
                    auto out = node("expr_stmt");
                    auto empty = node("const");
                    empty["type"] = vf::JsonValue("null");
                    empty["value"] = vf::JsonValue(nullptr);
                    out["expr"] = vf::JsonValue(std::move(empty));
                    return vf::JsonValue(std::move(out));
                }
            }
            vf::JsonValue lowered_value = lower_expr(
                field(object, "value", "spill_value"), env);
            const std::string spill_type = resolve_type_alias(string_field(
                lowered_value.as_object(), "type", "spill value"));
            for (const auto& [field_name, field_type] :
                 ordered_record_type_fields(spill_type)) {
                if (env.declared_here(field_name)) {
                    throw IRFailure("Cannot spill duplicate binding " + field_name);
                }
                env.declare(field_name, field_type);
            }
            if (string_field(lowered_value.as_object(), "kind", "spill value") == "record") {
                for (const auto& raw_field : array_of(
                         field(lowered_value.as_object(), "fields", "spill record"),
                         "spill record fields")) {
                    const auto& record_field = object_of(raw_field, "spill record field");
                    remember_symbolic_binding(
                        string_field(record_field, "name", "spill record field"),
                        field(record_field, "value", "spill record field"));
                }
            }
            auto out = node("spill_stmt");
            out["value"] = std::move(lowered_value);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "emit") {
            vf::JsonValue lowered_value = lower_expr(field(object, "value", "emit"), env);
            const std::string value_type = string_field(lowered_value.as_object(), "type", "emit value");
            vf::JsonValue::Array args;
            args.push_back(std::move(lowered_value));
            vf::JsonValue::Array arg_types;
            arg_types.push_back(vf::JsonValue(value_type));
            auto call = node("call");
            call["callee"] = stdlib_function("io", "print");
            call["callee_type"] = vf::JsonValue("fn(any)->any");
            call["arg_types"] = vf::JsonValue(std::move(arg_types));
            call["args"] = vf::JsonValue(std::move(args));
            call["named_args"] = vf::JsonValue(vf::JsonValue::Array{});
            call["spread_args"] = vf::JsonValue(vf::JsonValue::Array{});
            call["type"] = vf::JsonValue("any");
            auto out = node("expr_stmt");
            out["expr"] = vf::JsonValue(std::move(call));
            return vf::JsonValue(std::move(out));
        }
        if (kind == "label_emit") {
            auto out = node("label_print");
            out["label"] = vf::JsonValue(format_label_expr(field(object, "value", "label_emit")));
            out["value"] = lower_expr(field(object, "value", "label_emit"), env);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "function_definition") {
            return lower_function(object, env);
        }
        if (kind == "return") {
            vf::JsonValue value = lower_expr(field(object, "value", "return"), env);
            std::string value_type = string_field(value.as_object(), "type", "return value");
            const std::string declared_return_type = env.get("$return");
            if (declared_return_type != "any") {
                value = coerce_value_to_type(std::move(value), declared_return_type, "return value");
                value_type = declared_return_type;
            }
            auto out = node("return");
            out["type"] = vf::JsonValue(value_type);
            out["value"] = std::move(value);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "conditional_expr") {
            auto out = node("if_stmt");
            out["condition"] = lower_expr(field(object, "condition", "conditional_expr"), env);
            out["loop"] = field(object, "loop", "conditional_expr");
            TypeEnv body_env = env;
            out["body"] = lower_body(field(object, "body", "conditional_expr"), body_env);
            if (field(object, "loop", "conditional_expr").as_boolean()) {
                for (const auto& binding : body_env.bindings()) {
                    if (!env.contains(binding.name)) continue;
                    const std::string prior = env.get(binding.name);
                    const bool empty_fixed = prior.size() >= 5 && prior.front() == '[' &&
                        prior.compare(prior.size() - 3, 3, ":0]") == 0;
                    if (empty_fixed && starts_with(binding.type, "list<")) {
                        env.set(binding.name, binding.type);
                    } else if (prior == "list<any>" && starts_with(binding.type, "list<")) {
                        env.set(binding.name, binding.type);
                    }
                }
            }
            return vf::JsonValue(std::move(out));
        }
        if (kind == "continue" || kind == "break" || kind == "exit_program") {
            return vf::JsonValue(node(kind));
        }

        vf::JsonValue expr = lower_expr(ast, env);
        auto out = node("expr_stmt");
        out["expr"] = std::move(expr);
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue lower_function(const vf::JsonValue::Object& object, TypeEnv& env) {
        const std::string name = string_field(object, "name", "function_definition");
        vf::JsonValue::Array params;
        std::vector<std::string> param_types;
        std::vector<std::string> param_names;
        std::vector<vf::JsonValue> param_defaults;
        std::vector<bool> variadic_positional;
        std::vector<bool> variadic_named;
        TypeEnv function_env;
        for (const auto& param_value : array_of(field(object, "params", "function_definition"), "function params")) {
            const auto& param = object_of(param_value, "param");
            const std::string param_kind = string_field(param, "kind", "param");
            if (param_kind != "param") {
                throw IRFailure("unsupported param kind " + param_kind);
            }
            const std::string param_name = string_field(param, "name", "param");
            const std::string param_type = type_annotation_name(field(param, "type", "param"));
            const bool is_variadic_positional = optional_bool_field(param, "variadic_positional");
            const bool is_variadic_named = optional_bool_field(param, "variadic_named");
            if (function_env.declared_here(param_name)) {
                throw IRFailure("Cannot declare duplicate parameter " + param_name);
            }
            function_env.declare(
                param_name,
                is_variadic_positional ? "list<" + param_type + ">" : param_type);
            param_names.push_back(param_name);
            param_types.push_back(param_type);
            const auto default_it = param.find("default");
            if (default_it == param.end() || default_it->second.is_null()) {
                param_defaults.push_back(vf::JsonValue(nullptr));
            } else {
                param_defaults.push_back(coerce_value_to_type(lower_expr(default_it->second, function_env), param_type, "param default"));
            }
            variadic_positional.push_back(is_variadic_positional);
            variadic_named.push_back(is_variadic_named);

            auto ir_param = node("param");
            ir_param["name"] = vf::JsonValue(param_name);
            ir_param["type"] = vf::JsonValue(param_type);
            ir_param["default"] = param_defaults.back();
            ir_param["variadic_positional"] = vf::JsonValue(variadic_positional.back());
            ir_param["variadic_named"] = vf::JsonValue(variadic_named.back());
            params.push_back(vf::JsonValue(std::move(ir_param)));
        }

        const std::string declared_representation_type = type_annotation_name(
            field(object, "return_type", "function_definition"));
        std::string representation_type = declared_representation_type;
        const bool nominal_constructor = is_nominal_constructor_name(name);
        std::string return_type = nominal_constructor ? name : representation_type;
        std::string signature = function_signature_type(param_types, return_type);
        functions_.set({
            name, param_names, param_types, param_defaults, variadic_positional,
            variadic_named, return_type, representation_type, signature,
            field(object, "body", "function_definition")});
        env.set(name, signature);
        function_env.set("$return", representation_type);
        const FunctionInfo* registered_function = functions_.get(name, param_types);
        if (registered_function == nullptr) {
            throw IRFailure("cannot resolve registered function " + name);
        }
        // Lowering a body can register nested functions and grow FunctionTable's
        // storage. Keep no pointer into that storage across lower_body().
        const std::string runtime_name = functions_.runtime_name(*registered_function);

        auto out = node("function");
        vf::JsonValue lowered_body;
        try {
            lowered_body = lower_body(
                field(object, "body", "function_definition"), function_env);
        } catch (const IRFailure& error) {
            throw IRFailure("in function " + name + ": " + error.what());
        }
        if (representation_type == "any") {
            const auto& statements = array_of(
                field(lowered_body.as_object(), "body", "lowered function body"),
                "lowered function body");
            for (auto statement = statements.rbegin(); statement != statements.rend(); ++statement) {
                const auto& tail = object_of(*statement, "lowered function result");
                const std::string tail_kind = string_field(
                    tail, "kind", "lowered function result");
                const vf::JsonValue* result = nullptr;
                if (tail_kind == "expr_stmt") {
                    result = &field(tail, "expr", "lowered function result");
                } else if (tail_kind == "return") {
                    result = &field(tail, "value", "lowered function result");
                }
                if (result != nullptr && result->is_object()) {
                    const auto type = result->as_object().find("type");
                    if (type != result->as_object().end() && type->second.is_string() &&
                        !contains_unresolved_any_type(type->second.as_string())) {
                        representation_type = type->second.as_string();
                    }
                }
                break;
            }
        }
        if (nominal_constructor && representation_type == name) {
            const auto known = nominal_representations_.find(name);
            representation_type = known == nominal_representations_.end()
                ? "any" : known->second;
        }
        if (nominal_constructor && representation_type != "any") {
            const auto [known, inserted] = nominal_representations_.emplace(
                name, representation_type);
            if (!inserted && known->second != representation_type) {
                throw IRFailure(
                    "constructor overloads for " + name +
                    " must return the same underlying representation");
            }
        }
        return_type = nominal_constructor ? name : representation_type;
        signature = function_signature_type(param_types, return_type);
        functions_.set({
            name, param_names, param_types, param_defaults, variadic_positional,
            variadic_named, return_type, representation_type, signature,
            field(object, "body", "function_definition")});
        env.set(name, signature);
        if (declared_representation_type != "any") {
            auto& block = lowered_body.as_object();
            auto& statements = block.at("body").as_array();
            if (!statements.empty()) {
                auto& tail = statements.back().as_object();
                if (string_field(tail, "kind", "function tail") == "expr_stmt") {
                    auto expression = tail.find("expr");
                    if (expression == tail.end()) {
                        throw IRFailure("missing function tail expression");
                    }
                    expression->second = coerce_value_to_type(
                        std::move(expression->second), declared_representation_type,
                        "return value of " + name);
                }
            }
        }
        out["body"] = std::move(lowered_body);
        out["name"] = vf::JsonValue(runtime_name);
        out["params"] = vf::JsonValue(std::move(params));
        out["return_type"] = vf::JsonValue(return_type);
        out["representation_type"] = vf::JsonValue(representation_type);
        if (nominal_constructor) out["nominal_type"] = vf::JsonValue(name);
        auto sig = node("function_signature");
        vf::JsonValue::Array param_type_values;
        for (const auto& param_type : param_types) {
            param_type_values.push_back(vf::JsonValue(param_type));
        }
        sig["params"] = vf::JsonValue(std::move(param_type_values));
        sig["return_type"] = vf::JsonValue(return_type);
        sig["type"] = vf::JsonValue(signature);
        out["signature"] = vf::JsonValue(std::move(sig));
        out["type"] = vf::JsonValue(signature);
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue lower_body(const vf::JsonValue& body, TypeEnv& env) {
        const std::string kind = kind_of(body);
        vf::JsonValue::Array statements;
        if (kind == "block") {
            const auto& object = object_of(body, "block");
            for (const auto& stmt : array_of(field(object, "statements", "block"), "block.statements")) {
                statements.push_back(lower_stmt(stmt, env));
            }
        } else {
            statements.push_back(lower_stmt(body, env));
        }
        auto out = node("block");
        out["body"] = vf::JsonValue(std::move(statements));
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue lower_temporal_time_axis(
        const vf::JsonValue::Object& properties,
        std::size_t time_count,
        const std::string& context
    ) {
        const auto required = [&](const std::string& name) -> const vf::JsonValue& {
            const auto found = properties.find(name);
            if (found == properties.end()) {
                throw IRFailure(context + " requires `" + name + ":`");
            }
            return found->second;
        };
        const auto fixed_shape = [&](const std::string& name) {
            const auto& value = required(name);
            const auto result = fixed_numeric_vector_shape(string_field(
                object_of(value, context + " " + name), "type", context + " " + name));
            if (!result) {
                throw IRFailure(context + " `" + name + "` requires fixed numeric data");
            }
            return *result;
        };
        const bool has_time_coordinates = properties.find("t") != properties.end();
        const bool has_time_min = properties.find("t_min") != properties.end();
        const bool has_time_max = properties.find("t_max") != properties.end();
        if (has_time_coordinates && (has_time_min || has_time_max)) {
            throw IRFailure(context + " accepts either `t:` or `t_min:` with `t_max:`");
        }
        if (!has_time_coordinates && (!has_time_min || !has_time_max)) {
            throw IRFailure(context + " requires `t:` or both `t_min:` and `t_max:`");
        }
        if (has_time_coordinates) {
            const auto time_shape = fixed_shape("t");
            if (time_shape.dimensions != std::vector<std::size_t>{time_count}) {
                throw IRFailure(context + " `t` must match the temporal channel length");
            }
        } else {
            for (const std::string& name : {"t_min", "t_max"}) {
                const auto& scalar = object_of(required(name), context + " " + name);
                const std::string type = string_field(scalar, "type", context + " " + name);
                if (type != "num" && type != "int") {
                    throw IRFailure(context + " `" + name + "` requires a numeric scalar");
                }
            }
        }
        const auto& time_mode = object_of(required("t_mode"), context + " t_mode");
        const auto& raw_time_mode = field(time_mode, "value", context + " t_mode");
        static const std::set<std::string> time_modes{
            "repeat", "mirror", "stop", "reset"
        };
        if (string_field(time_mode, "kind", context + " t_mode") != "const" ||
            string_field(time_mode, "type", context + " t_mode") != "str" ||
            !raw_time_mode.is_string() ||
            time_modes.find(raw_time_mode.as_string()) == time_modes.end()) {
            throw IRFailure(context + " t_mode must be repeat, mirror, stop, or reset");
        }
        vf::JsonValue::Object time;
        time["axis"] = vf::JsonValue("t");
        time["sample_count"] = vf::JsonValue(static_cast<double>(time_count));
        if (has_time_coordinates) {
            time["coordinates"] = required("t");
        } else {
            time["min"] = required("t_min");
            time["max"] = required("t_max");
        }
        time["mode"] = required("t_mode");
        return vf::JsonValue(std::move(time));
    }

    bool lower_temporal_frame_add(
        const vf::JsonValue::Object& properties,
        vf::JsonValue::Object& operation
    ) {
        if (properties.find("p_t") == properties.end()) return false;

        const auto required = [&](const std::string& name) -> const vf::JsonValue& {
            const auto found = properties.find(name);
            if (found == properties.end()) {
                throw IRFailure("temporal Frame.add requires `" + name + ":`");
            }
            return found->second;
        };
        const auto fixed_shape = [&](const std::string& name) {
            const auto& value = required(name);
            const auto result = fixed_numeric_vector_shape(string_field(
                object_of(value, "temporal Frame.add " + name),
                "type", "temporal Frame.add " + name));
            if (!result) {
                throw IRFailure(
                    "temporal Frame.add `" + name + "` requires fixed numeric data");
            }
            return *result;
        };

        const auto position_shape = fixed_shape("p_t");
        if (position_shape.dimensions.size() != 2 ||
            position_shape.dimensions.front() == 0 ||
            (position_shape.dimensions.back() != 2 &&
             position_shape.dimensions.back() != 3)) {
            throw IRFailure("temporal Frame.add `p_t` requires shape [t,2|3]");
        }
        const std::size_t time_count = position_shape.dimensions.front();
        const auto color_shape = fixed_shape("c_tc");
        const auto size_shape = fixed_shape("s_t");
        if (color_shape.dimensions != std::vector<std::size_t>{time_count, 4}) {
            throw IRFailure("temporal Frame.add `c_tc` requires shape [t,4]");
        }
        if (size_shape.dimensions != std::vector<std::size_t>{time_count}) {
            throw IRFailure("temporal Frame.add `s_t` requires shape [t]");
        }

        const auto& size_mode = object_of(
            required("s_mode"), "temporal Frame.add s_mode");
        if (string_field(size_mode, "type", "temporal Frame.add s_mode") !=
            "ui_measure_space<data>") {
            throw IRFailure("temporal Frame.add requires s_mode:data");
        }
        const auto json_axes = [](std::initializer_list<const char*> values) {
            vf::JsonValue::Array result;
            for (const auto* value : values) result.emplace_back(value);
            return result;
        };
        const auto json_shape = [](const std::vector<std::size_t>& values) {
            vf::JsonValue::Array result;
            for (const auto value : values) {
                result.emplace_back(static_cast<double>(value));
            }
            return result;
        };
        vf::JsonValue::Array channels;
        const auto add_channel = [&](const std::string& name,
                                     std::initializer_list<const char*> axes,
                                     const std::vector<std::size_t>& shape,
                                     const std::string& value_kind,
                                     const vf::JsonValue& value,
                                     bool broadcast,
                                     bool data_measure) {
            vf::JsonValue::Object channel;
            channel["name"] = vf::JsonValue(name);
            channel["semantic_axes"] = vf::JsonValue(json_axes(axes));
            channel["shape"] = vf::JsonValue(json_shape(shape));
            if (broadcast) {
                channel["broadcast_axes"] = vf::JsonValue(vf::JsonValue::Array{});
            }
            if (data_measure) channel["measure_space"] = vf::JsonValue("data");
            channel["value_kind"] = vf::JsonValue(value_kind);
            channel["value"] = value;
            channels.emplace_back(std::move(channel));
        };
        add_channel("p", {"t", "c"}, position_shape.dimensions,
                    "position", required("p_t"), false, false);
        add_channel("c", {"t", "c"}, color_shape.dimensions,
                    "rgba", required("c_tc"), true, false);
        add_channel("s", {"t"}, size_shape.dimensions,
                    "size", required("s_t"), true, true);
        operation["layer_axes"] = vf::JsonValue(json_axes({"t"}));
        operation["channels"] = vf::JsonValue(std::move(channels));

        operation["time"] = lower_temporal_time_axis(
            properties, time_count, "temporal Frame.add");
        return true;
    }

    bool lower_temporal_frame_camera(
        const vf::JsonValue::Object& properties,
        vf::JsonValue::Object& operation
    ) {
        struct CameraTemporalArgument {
            const char* argument;
            const char* channel;
            std::size_t width;
            bool scalar;
            const char* value_kind;
        };
        static const std::array<CameraTemporalArgument, 6> arguments{{
            {"p_t", "p", 3, false, "position"},
            {"x_t", "x", 1, true, "position_component"},
            {"y_t", "y", 1, true, "position_component"},
            {"z_t", "z", 1, true, "position_component"},
            {"target_t", "target", 3, false, "target"},
            {"fov_t", "fov", 1, true, "fov"},
        }};
        const bool has_temporal = std::any_of(
            arguments.begin(), arguments.end(), [&](const auto& argument) {
                return properties.find(argument.argument) != properties.end();
            });
        if (!has_temporal) return false;
        if (properties.find("p_t") != properties.end() &&
            (properties.find("p") != properties.end() ||
             properties.find("pos") != properties.end() ||
             properties.find("x_t") != properties.end() ||
             properties.find("y_t") != properties.end() ||
             properties.find("z_t") != properties.end())) {
            throw IRFailure(
                "Frame.add_camera accepts one `p`, `p_t`, or component `_t` position source");
        }
        if (properties.find("target") != properties.end() &&
            properties.find("target_t") != properties.end()) {
            throw IRFailure("Frame.add_camera accepts `target` or `target_t`, not both");
        }
        if (properties.find("fov") != properties.end() &&
            properties.find("fov_t") != properties.end()) {
            throw IRFailure("Frame.add_camera accepts `fov` or `fov_t`, not both");
        }
        const auto json_shape = [](const std::vector<std::size_t>& values) {
            vf::JsonValue::Array result;
            for (const auto value : values) result.emplace_back(static_cast<double>(value));
            return result;
        };
        std::size_t time_count = 0;
        vf::JsonValue::Array channels;
        for (const auto& argument : arguments) {
            const auto found = properties.find(argument.argument);
            if (found == properties.end()) continue;
            const auto shape = fixed_numeric_vector_shape(string_field(
                object_of(found->second, "temporal Frame.add_camera " +
                    std::string(argument.argument)),
                "type", "temporal Frame.add_camera " +
                    std::string(argument.argument)));
            const bool valid_shape = shape && !shape->dimensions.empty() &&
                shape->dimensions.front() >= 2 &&
                ((!argument.scalar && shape->dimensions.size() == 2 &&
                  shape->dimensions.back() == argument.width) ||
                 (argument.scalar && shape->dimensions.size() == 1));
            if (!valid_shape) {
                throw IRFailure(
                    "temporal Frame.add_camera `" + std::string(argument.argument) +
                    "` requires shape [t" + (argument.scalar ? "]" : ",3]") );
            }
            if (time_count == 0) time_count = shape->dimensions.front();
            if (shape->dimensions.front() != time_count) {
                throw IRFailure(
                    "temporal Frame.add_camera channels must share one t length");
            }
            vf::JsonValue::Object channel;
            channel["name"] = vf::JsonValue(argument.channel);
            vf::JsonValue::Array axes{vf::JsonValue("t")};
            if (!argument.scalar) axes.emplace_back("c");
            channel["semantic_axes"] = vf::JsonValue(std::move(axes));
            channel["shape"] = vf::JsonValue(json_shape(shape->dimensions));
            channel["value_kind"] = vf::JsonValue(argument.value_kind);
            channel["value"] = found->second;
            channels.emplace_back(std::move(channel));
        }
        operation["layer_axes"] = vf::JsonValue(vf::JsonValue::Array{vf::JsonValue("t")});
        operation["channels"] = vf::JsonValue(std::move(channels));
        operation["time"] = lower_temporal_time_axis(
            properties, time_count, "temporal Frame.add_camera");
        return true;
    }

    vf::JsonValue lower_world_embedding_add(
        const vf::JsonValue::Array& named_args,
        vf::JsonValue source
    ) {
        const vf::JsonValue* position = nullptr;
        const vf::JsonValue* color = nullptr;
        const vf::JsonValue* size = nullptr;
        const vf::JsonValue* size_mode = nullptr;
        for (const auto& raw_named : named_args) {
            const auto& named = object_of(raw_named, "World embedding argument");
            const std::string name = string_field(
                named, "name", "World embedding argument");
            const vf::JsonValue& value = field(
                named, "value", "World embedding argument");
            if (name == "p_u") position = &value;
            else if (name == "c_uc") color = &value;
            else if (name == "s_u") size = &value;
            else if (name == "s_mode") size_mode = &value;
            else {
                throw IRFailure(
                    "the first World embedding supports p_u, c_uc, s_u, and s_mode");
            }
        }
        if (position == nullptr || color == nullptr || size == nullptr || size_mode == nullptr) {
            throw IRFailure(
                "the first World embedding requires p_u, c_uc, s_u, and s_mode");
        }
        const auto require_shape = [](const vf::JsonValue& value,
                                      const std::vector<std::size_t>& expected,
                                      const std::string& context) {
            const auto shape = fixed_numeric_vector_shape(string_field(
                object_of(value, context), "type", context));
            if (!shape || shape->dimensions != expected) {
                throw IRFailure(context + " has an incompatible fixed numeric shape");
            }
        };
        require_shape(*position, {1, 2}, "World embedding p_u");
        require_shape(*color, {1, 4}, "World embedding c_uc");
        require_shape(*size, {1}, "World embedding s_u");
        if (string_field(
                object_of(*size_mode, "World embedding s_mode"),
                "type", "World embedding s_mode") != "ui_measure_space<data>") {
            throw IRFailure("the canonical World embedding requires s_mode:data");
        }

        const auto axes = [](std::initializer_list<const char*> values) {
            vf::JsonValue::Array result;
            for (const auto* value : values) result.emplace_back(value);
            return result;
        };
        const auto shape = [](std::initializer_list<double> values) {
            vf::JsonValue::Array result;
            for (const double value : values) result.emplace_back(value);
            return result;
        };

        vf::JsonValue::Array channels;
        vf::JsonValue::Object position_channel;
        position_channel["name"] = vf::JsonValue("p");
        position_channel["semantic_axes"] = vf::JsonValue(axes({"u", "c"}));
        position_channel["shape"] = vf::JsonValue(shape({1, 2}));
        position_channel["value_kind"] = vf::JsonValue("position");
        position_channel["value"] = *position;
        channels.emplace_back(std::move(position_channel));

        vf::JsonValue::Object color_channel;
        color_channel["name"] = vf::JsonValue("c");
        color_channel["semantic_axes"] = vf::JsonValue(axes({"u", "c"}));
        color_channel["shape"] = vf::JsonValue(shape({1, 4}));
        color_channel["broadcast_axes"] = vf::JsonValue(vf::JsonValue::Array{});
        color_channel["value_kind"] = vf::JsonValue("rgba");
        color_channel["value"] = *color;
        channels.emplace_back(std::move(color_channel));

        vf::JsonValue::Object size_channel;
        size_channel["name"] = vf::JsonValue("s");
        size_channel["semantic_axes"] = vf::JsonValue(axes({"u"}));
        size_channel["shape"] = vf::JsonValue(shape({1}));
        size_channel["broadcast_axes"] = vf::JsonValue(vf::JsonValue::Array{});
        size_channel["measure_space"] = vf::JsonValue("data");
        size_channel["value_kind"] = vf::JsonValue("size");
        size_channel["value"] = *size;
        channels.emplace_back(std::move(size_channel));

        vf::JsonValue::Object add;
        add["kind"] = vf::JsonValue("add");
        add["layer_axes"] = vf::JsonValue(axes({"u"}));
        add["channels"] = vf::JsonValue(std::move(channels));
        add["source"] = std::move(source);
        ui_operations_.emplace_back(std::move(add));

        vf::JsonValue layer = num_const(
            static_cast<double>(ui_operations_.size() - 1));
        layer.as_object()["type"] = vf::JsonValue("Layer");
        return layer;
    }

    std::optional<vf::JsonValue> lower_adjacent_symbol_product(
        const std::string& spelling,
        const TypeEnv& env
    ) const {
        if (!symbolic_imported_ || env.contains(spelling) || spelling.empty()) {
            return std::nullopt;
        }

        std::vector<std::string> symbols;
        for (const auto& binding : env.bindings()) {
            if (!symbolic_expression_type(binding.type) || binding.name.empty()) continue;
            if (std::find(symbols.begin(), symbols.end(), binding.name) == symbols.end()) {
                symbols.push_back(binding.name);
            }
        }
        std::sort(symbols.begin(), symbols.end(), [](const auto& left, const auto& right) {
            if (left.size() != right.size()) return left.size() > right.size();
            return left < right;
        });

        using Product = std::vector<std::string>;
        std::vector<std::vector<Product>> products(spelling.size() + 1);
        products[0].push_back({});
        for (std::size_t offset = 0; offset < spelling.size(); ++offset) {
            for (const auto& product : products[offset]) {
                for (const auto& symbol : symbols) {
                    if (spelling.compare(offset, symbol.size(), symbol) != 0) continue;
                    auto candidate = product;
                    candidate.push_back(symbol);
                    auto& destination = products[offset + symbol.size()];
                    if (destination.size() < 2) destination.push_back(std::move(candidate));
                }
            }
        }

        std::vector<Product> matches;
        for (const auto& product : products.back()) {
            if (product.size() >= 2) matches.push_back(product);
        }
        if (matches.empty()) return std::nullopt;
        if (matches.size() > 1) {
            throw IRFailure(
                "ambiguous adjacent symbolic product " + spelling
                + "; separate its factors with spaces or `*`");
        }

        const auto load_symbol = [](const std::string& name) {
            auto load = node("load");
            load["name"] = vf::JsonValue(name);
            load["type"] = vf::JsonValue("symbol");
            return vf::JsonValue(std::move(load));
        };
        vf::JsonValue result = load_symbol(matches.front().front());
        for (std::size_t index = 1; index < matches.front().size(); ++index) {
            auto product = node("binary_op");
            product["op"] = vf::JsonValue("STAR");
            product["left"] = std::move(result);
            product["right"] = load_symbol(matches.front()[index]);
            product["left_type"] = vf::JsonValue("symbol");
            product["right_type"] = vf::JsonValue("symbol");
            product["type"] = vf::JsonValue("expression");
            attach_expression_facts(
                product,
                VkfExpressionLoweringMode::SymbolicNode,
                "R",
                VkfSymbolicCompilerNodeKind::Binary,
                matches.front());
            result = vf::JsonValue(std::move(product));
        }
        return result;
    }

    vf::JsonValue lower_expr(const vf::JsonValue& ast, TypeEnv& env) {
        const auto& object = object_of(ast, "expression");
        const std::string kind = string_field(object, "kind", "expression");
        if (kind == "container_spill") {
            return lower_container_spill(object, env);
        }
        if (kind == "conditional_expr") {
            if (field(object, "loop", "conditional expression").as_boolean()) {
                throw IRFailure("value-producing conditional cannot loop");
            }
            const auto& body_ast = field(object, "body", "conditional expression");
            vf::JsonValue body = lower_expr(body_ast, env);
            const std::string body_type = string_field(body.as_object(), "type", "conditional body");
            auto out = node("if_expr");
            out["condition"] = lower_expr(field(object, "condition", "conditional expression"), env);
            out["body"] = std::move(body);
            out["type"] = vf::JsonValue(body_type + "|null");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "type_annotation") {
            auto out = node("type_pattern");
            out["name"] = vf::JsonValue(type_annotation_name(ast));
            out["type"] = vf::JsonValue("type_pattern");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "number_literal") {
            auto out = node("const");
            const auto integer_it = object.find("is_integer_surface");
            const bool is_integer_surface = integer_it != object.end()
                && integer_it->second.is_boolean()
                && integer_it->second.as_boolean();
            out["type"] = vf::JsonValue(is_integer_surface ? "int" : "num");
            out["value"] = field(object, "value", "number_literal");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "string_literal") {
            const auto interpolations = object.find("interpolations");
            const auto raw = object.find("raw");
            const bool is_raw = raw != object.end() && raw->second.is_boolean() && raw->second.as_boolean();
            if (!is_raw && interpolations != object.end() && interpolations->second.is_array() &&
                !interpolations->second.as_array().empty()) {
                const std::string template_text = string_field(object, "value", "string_literal");
                vf::JsonValue::Array segments;
                std::size_t cursor = 0;
                for (const auto& raw_interpolation : interpolations->second.as_array()) {
                    const auto& interpolation = object_of(raw_interpolation, "string interpolation");
                    const auto offset = [&](const std::string& name) -> std::size_t {
                        const auto& value = field(interpolation, name, "string interpolation");
                        if (!value.is_number() || !std::isfinite(value.as_number()) ||
                            value.as_number() < 0 || std::floor(value.as_number()) != value.as_number()) {
                            throw IRFailure("invalid string interpolation " + name);
                        }
                        return static_cast<std::size_t>(value.as_number());
                    };
                    const std::size_t start = offset("start");
                    const std::size_t end = offset("end");
                    if (start < cursor || end < start || end > template_text.size()) {
                        throw IRFailure("invalid string interpolation bounds");
                    }
                    if (start > cursor) {
                        auto text = node("interpolation_text");
                        text["value"] = vf::JsonValue(interpolation_text(
                            std::string_view(template_text).substr(cursor, start - cursor)));
                        segments.emplace_back(std::move(text));
                    }
                    auto value = node("interpolation_value");
                    value["value"] = lower_expr(
                        field(interpolation, "expression", "string interpolation"), env);
                    value["format"] = vf::JsonValue(string_field(
                        interpolation, "format", "string interpolation"));
                    segments.emplace_back(std::move(value));
                    cursor = end;
                }
                if (cursor < template_text.size()) {
                    auto text = node("interpolation_text");
                    text["value"] = vf::JsonValue(interpolation_text(
                        std::string_view(template_text).substr(cursor)));
                    segments.emplace_back(std::move(text));
                }
                auto out = node("interpolated_string");
                out["segments"] = vf::JsonValue(std::move(segments));
                out["type"] = vf::JsonValue("str");
                return vf::JsonValue(std::move(out));
            }
            auto out = node("const");
            out["type"] = vf::JsonValue("str");
            out["value"] = vf::JsonValue(interpolation_text(
                string_field(object, "value", "string_literal")));
            return vf::JsonValue(std::move(out));
        }
        if (kind == "bool_literal") {
            auto out = node("const");
            out["type"] = vf::JsonValue("bit");
            out["value"] = field(object, "value", "bool_literal");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "null_literal") {
            auto out = node("const");
            out["type"] = vf::JsonValue("null");
            out["value"] = vf::JsonValue(nullptr);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "raise_expr") {
            vf::JsonValue value = lower_expr(field(object, "value", "raise expression"), env);
            std::string value_type = string_field(
                value.as_object(), "type", "raise expression value");
            if (value_type == "error_type") {
                const auto& error_type = value.as_object();
                const std::string error_name = string_field(
                    error_type, "name", "raised error type");
                const auto& mask_value = field(error_type, "mask", "raised error type");
                if (!mask_value.is_number()) {
                    throw IRFailure("raised error type needs a mask");
                }
                auto message = node("const");
                message["type"] = vf::JsonValue("str");
                message["value"] = vf::JsonValue("");
                auto type_name = node("const");
                type_name["type"] = vf::JsonValue("str");
                type_name["value"] = vf::JsonValue(error_name);
                auto mask = node("const");
                mask["type"] = vf::JsonValue("num");
                mask["value"] = mask_value;
                vf::JsonValue::Array fields;
                const auto add_field = [&](std::string name, std::string type, vf::JsonValue field_value) {
                    auto record_field = node("record_field");
                    record_field["name"] = vf::JsonValue(std::move(name));
                    record_field["value"] = std::move(field_value);
                    record_field["type"] = vf::JsonValue(std::move(type));
                    fields.emplace_back(std::move(record_field));
                };
                add_field("message", "str", vf::JsonValue(std::move(message)));
                add_field("type", "str", vf::JsonValue(std::move(type_name)));
                add_field("mask", "num", vf::JsonValue(std::move(mask)));
                auto error = node("record");
                error["fields"] = vf::JsonValue(std::move(fields));
                error["type"] = vf::JsonValue("record{message:str,type:str,mask:num}");
                value = vf::JsonValue(std::move(error));
                value_type = "record{message:str,type:str,mask:num}";
            }
            if (value_type != "record{message:str,type:str,mask:num}") {
                throw IRFailure("`!` expects an error value");
            }
            auto out = node("raise_expr");
            out["value"] = std::move(value);
            out["type"] = vf::JsonValue("any");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "identifier") {
            const std::string name = string_field(object, "name", "identifier");
            const bool spilled_ui_display = std::find(
                spilled_modules_.begin(), spilled_modules_.end(), "ui.display") !=
                spilled_modules_.end();
            if (spilled_ui_display && !env.contains(name) && name == "data") {
                vf::JsonValue out = num_const(0.0);
                out.as_object()["type"] = vf::JsonValue("ui_measure_space<data>");
                return out;
            }
            if (name == "type" && !env.contains(name)) {
                vf::JsonValue out = string_const("type");
                out.as_object()["type"] = vf::JsonValue("type<type>");
                return out;
            }
            if (name == "any" && !env.contains(name)) {
                return type_const("any");
            }
            if (!env.contains(name) && name == "write_to_clipboard") {
                return stdlib_function("io", name);
            }
            const std::string primitive = primitive_type_name(name, env);
            if (!primitive.empty()) {
                vf::JsonValue out = string_const(primitive);
                out.as_object()["type"] = vf::JsonValue("type<" + primitive + ">");
                return out;
            }
            if (is_nominal_constructor_name(name) && !functions_.family(name).empty()) {
                vf::JsonValue out = string_const(name);
                out.as_object()["type"] = vf::JsonValue("type<" + name + ">");
                return out;
            }
            if ((name == "i" || name == "j") && !env.contains(name)) {
                auto out = node("complex_const");
                out["real"] = vf::JsonValue(0.0);
                out["imag"] = vf::JsonValue(1.0);
                out["type"] = vf::JsonValue("num");
                return vf::JsonValue(std::move(out));
            }
            const bool spilled_symbolic = std::find(
                spilled_modules_.begin(), spilled_modules_.end(), "symbolic") != spilled_modules_.end();
            if ((symbolic_imported_ || spilled_symbolic) && name == "inf" && !env.contains(name)) {
                auto out = node("symbolic_var");
                out["name"] = vf::JsonValue("inf");
                out["domain"] = vf::JsonValue("R");
                out["symbol_kind"] = vf::JsonValue("constant");
                out["latex"] = vf::JsonValue("\\infty");
                out["type"] = vf::JsonValue("constant");
                attach_expression_facts(
                    out,
                    VkfExpressionLoweringMode::SymbolicNode,
                    "R",
                    VkfSymbolicCompilerNodeKind::Symbol,
                    {"inf"}
                );
                return vf::JsonValue(std::move(out));
            }
            const bool spilled_math = std::find(
                spilled_modules_.begin(), spilled_modules_.end(), "math") != spilled_modules_.end();
            if (spilled_math && !env.contains(name)) {
                if (name == "pi") return num_const(3.141592653589793);
                if (name == "e") return num_const(2.718281828459045);
                if (name == "tau") return num_const(6.283185307179586);
                if (name == "abs" || name == "sqrt" || name == "sin" ||
                    name == "cos" || name == "exp" || name == "ln") {
                    return stdlib_function("math", name);
                }
            }
            const bool spilled_errors = std::find(
                spilled_modules_.begin(), spilled_modules_.end(), "errors") != spilled_modules_.end();
            if (spilled_errors && !env.contains(name)) {
                static const std::vector<std::string> error_names = {
                    "Error", "VektorFlowError", "LexError", "ParseError", "EvalError",
                    "AssertionError", "PythonError", "TypeError", "ValueError", "KeyError",
                    "IndexError", "FileNotFoundError", "RuntimeError"
                };
                if (std::find(error_names.begin(), error_names.end(), name) != error_names.end()) {
                    return error_type_value(name);
                }
            }
            const bool spilled_time = std::find(
                spilled_modules_.begin(), spilled_modules_.end(), "time") != spilled_modules_.end();
            if (spilled_time && !env.contains(name) &&
                (name == "monotonic_seconds" || name == "wall_seconds" ||
                 name == "sleep_seconds" || name == "local_parts")) {
                return stdlib_function("time", name);
            }
            if (auto product = lower_adjacent_symbol_product(name, env)) {
                return std::move(*product);
            }
            auto out = node("load");
            out["name"] = vf::JsonValue(name);
            out["type"] = vf::JsonValue(env.get(name));
            return vf::JsonValue(std::move(out));
        }
        if (kind == "call") {
            const auto& callee_ast = object_of(field(object, "callee", "call"), "call.callee");
            if (auto generated = lower_symbolic_generator_call(object)) {
                return std::move(*generated);
            }
            if (string_field(callee_ast, "kind", "call.callee") == "identifier") {
                const std::string symbolic_name = string_field(callee_ast, "name", "symbolic call");
                const auto known_symbol = symbolic_bindings_.find(symbolic_name);
                if (symbolic_expression_type(env.get(symbolic_name)) && known_symbol != symbolic_bindings_.end() &&
                    known_symbol->second.domain.find("->") != std::string::npos) {
                    const auto& raw_args = array_of(field(object, "args", "symbolic call"), "symbolic call args");
                    const auto expected_domains =
                        symbolic_function_input_surfaces(known_symbol->second.domain);
                    if (expected_domains.empty()) {
                        throw IRFailure("invalid symbolic function signature " + known_symbol->second.domain);
                    }
                    if (raw_args.size() != expected_domains.size()) {
                        throw IRFailure(
                            "symbolic function " + symbolic_name + " expects "
                            + std::to_string(expected_domains.size()) + " arguments, received "
                            + std::to_string(raw_args.size()));
                    }
                    for (std::size_t argument_index = 0; argument_index < raw_args.size(); ++argument_index) {
                        const auto& raw_arg = raw_args[argument_index];
                        const auto& argument = object_of(raw_arg, "symbolic function argument");
                        const std::string argument_kind = string_field(argument, "kind", "symbolic function argument");
                        if (argument_kind == "named_call_arg" || argument_kind == "spread_arg") {
                            throw IRFailure("symbolic function calls currently require positional arguments");
                        }
                        if (argument_kind == "identifier") {
                            const std::string argument_name =
                                string_field(argument, "name", "symbolic function argument");
                            const auto known_argument = symbolic_bindings_.find(argument_name);
                            if (known_argument != symbolic_bindings_.end() &&
                                known_argument->second.domain.find("->") == std::string::npos &&
                                !symbolic_domain_accepts(
                                    expected_domains[argument_index], known_argument->second.domain)) {
                                throw IRFailure(
                                    "symbolic function " + symbolic_name + " argument "
                                    + std::to_string(argument_index + 1u) + " requires "
                                    + expected_domains[argument_index] + ", received "
                                    + known_argument->second.domain);
                            }
                        }
                    }
                    auto at_identifier = node("identifier");
                    at_identifier["name"] = vf::JsonValue("at");
                    vf::JsonValue::Array at_args;
                    auto symbol_identifier = node("identifier");
                    symbol_identifier["name"] = vf::JsonValue(symbolic_name);
                    at_args.emplace_back(std::move(symbol_identifier));
                    if (raw_args.size() == 1) {
                        at_args.push_back(raw_args.front());
                    } else {
                        auto arguments = node("list_literal");
                        arguments["items"] = vf::JsonValue(raw_args);
                        at_args.emplace_back(std::move(arguments));
                    }
                    auto at_call = node("call");
                    at_call["callee"] = vf::JsonValue(std::move(at_identifier));
                    at_call["args"] = vf::JsonValue(std::move(at_args));
                    return lower_expr(vf::JsonValue(std::move(at_call)), env);
                }
            }
            std::string size_primitive;
            if (string_field(callee_ast, "kind", "call.callee") == "attribute" &&
                string_field(callee_ast, "name", "call.callee") == "size") {
                const auto& owner = object_of(
                    field(callee_ast, "object", "type size call"), "type size owner");
                if (string_field(owner, "kind", "type size owner") == "identifier") {
                    size_primitive = primitive_type_name(
                        string_field(owner, "name", "type size owner"), env);
                }
            } else if (string_field(callee_ast, "kind", "call.callee") == "identifier") {
                const std::string member_type = env.get(
                    string_field(callee_ast, "name", "type member call"));
                const std::string prefix = "primitive_member<";
                if (starts_with(member_type, prefix) && member_type.back() == '>' &&
                    member_type.find(":size>") != std::string::npos) {
                    size_primitive = member_type.substr(
                        prefix.size(), member_type.find(':') - prefix.size());
                }
            }
            const auto size_bits = size_primitive == "bit" ? 1.0
                : size_primitive == "chr" ? 8.0
                : size_primitive == "int" ? 64.0
                : size_primitive == "num" ? 128.0 : -1.0;
            if (size_bits >= 0.0) {
                const auto& raw_args = array_of(
                    field(object, "args", "type size call"), "type size args");
                if (raw_args.size() != 1) throw IRFailure("type size requires one value");
                (void)lower_expr(raw_args.front(), env);
                return num_const(size_bits);
            }
            if (string_field(callee_ast, "kind", "call.callee") == "lambda_expr") {
                const auto& raw_args = array_of(field(object, "args", "lambda call"), "lambda args");
                const auto& params = array_of(field(callee_ast, "params", "lambda"), "lambda params");
                if (raw_args.size() != params.size()) throw IRFailure("wrong arity for lambda");
                TypeEnv lambda_env = env;
                vf::JsonValue::Array body;
                std::map<std::string, std::string> renamed;
                for (std::size_t index = 0; index < params.size(); ++index) {
                    if (!params[index].is_string()) throw IRFailure("lambda parameter must be name");
                    const auto& raw_arg = object_of(raw_args[index], "lambda argument");
                    const std::string raw_kind = string_field(raw_arg, "kind", "lambda argument");
                    if (raw_kind == "named_call_arg" || raw_kind == "spread_arg") {
                        throw IRFailure("lambda calls require positional arguments");
                    }
                    vf::JsonValue argument = lower_expr(raw_args[index], env);
                    const std::string type = string_field(argument.as_object(), "type", "lambda argument");
                    const std::string parameter = params[index].as_string();
                    const std::string hidden = "$lambda$" + std::to_string(next_lambda_local_++);
                    lambda_env.set(parameter, type);
                    renamed[parameter] = hidden;
                    auto binding = node("store_binding");
                    binding["name"] = vf::JsonValue(hidden);
                    binding["type"] = vf::JsonValue(type);
                    binding["update"] = vf::JsonValue(false);
                    binding["value"] = std::move(argument);
                    body.emplace_back(std::move(binding));
                }
                vf::JsonValue result = lower_expr(field(callee_ast, "body", "lambda"), lambda_env);
                rename_lambda_loads(result, renamed);
                const std::string result_type = string_field(result.as_object(), "type", "lambda result");
                auto result_statement = node("expr_stmt");
                result_statement["expr"] = std::move(result);
                body.emplace_back(std::move(result_statement));
                auto block = node("block_expr");
                block["body"] = vf::JsonValue(std::move(body));
                block["type"] = vf::JsonValue(result_type);
                return vf::JsonValue(std::move(block));
            }
            std::string primitive_callee;
            std::string instance_method_callee;
            std::string instance_method_owner_type;
            vf::JsonValue instance_method_owner;
            if (string_field(callee_ast, "kind", "call.callee") == "identifier") {
                primitive_callee = primitive_type_name(
                    string_field(callee_ast, "name", "call.callee"), env);
            } else if (string_field(callee_ast, "kind", "call.callee") == "attribute") {
                const auto& owner_ast = object_of(
                    field(callee_ast, "object", "method callee"), "method owner");
                const std::string owner_type = string_field(
                    owner_ast, "kind", "method owner") == "identifier"
                    ? env.get(string_field(owner_ast, "name", "method owner"))
                    : "";
                const bool string_cursor = owner_type == "StringCursor" ||
                    (owner_type.size() > std::string("__StringCursor").size() &&
                     owner_type.compare(
                         owner_type.size() - std::string("__StringCursor").size(),
                         std::string("__StringCursor").size(), "__StringCursor") == 0);
                if (string_cursor) {
                    const std::string method = string_field(callee_ast, "name", "method callee");
                    if (method == "peek" || method == "advance" || method == "slice") {
                        const std::string prefix = owner_type == "StringCursor"
                            ? ""
                            : owner_type.substr(
                                0, owner_type.size() - std::string("StringCursor").size());
                        instance_method_callee = prefix + "_string_cursor_" + method;
                        instance_method_owner_type = owner_type;
                        instance_method_owner = lower_expr(
                            field(callee_ast, "object", "method callee"), env);
                    }
                }
            }
            vf::JsonValue callee = lower_expr(field(object, "callee", "call"), env);
            if (!primitive_callee.empty()) {
                callee = vf::JsonValue(node("load"));
                callee.as_object()["name"] = vf::JsonValue(primitive_callee);
                callee.as_object()["type"] = vf::JsonValue("fn(any)->" + primitive_callee);
            }
            vf::JsonValue::Array args;
            vf::JsonValue::Array arg_types;
            std::vector<std::string> argument_type_names;
            vf::JsonValue::Array named_args;
            vf::JsonValue::Array spread_args;
            bool advanced_call_shape = false;
            const auto& raw_call_args = array_of(field(object, "args", "call"), "call.args");
            for (const auto& arg : raw_call_args) {
                const auto& arg_object = object_of(arg, "call arg AST");
                const std::string arg_kind = string_field(arg_object, "kind", "call arg AST");
                if (arg_kind == "named_call_arg") {
                    advanced_call_shape = true;
                    auto named_arg = node("named_arg");
                    named_arg["name"] = field(arg_object, "name", "named_call_arg");
                    named_arg["value"] = lower_expr(field(arg_object, "value", "named_call_arg"), env);
                    named_args.push_back(vf::JsonValue(std::move(named_arg)));
                    continue;
                }
                if (arg_kind == "spread_arg") {
                    advanced_call_shape = true;
                    spread_args.push_back(lower_expr(field(arg_object, "expr", "spread_arg"), env));
                    continue;
                }
                vf::JsonValue lowered_arg = lower_expr(arg, env);
                const auto& argument_type = field(lowered_arg.as_object(), "type", "call arg");
                arg_types.push_back(argument_type);
                argument_type_names.push_back(argument_type.as_string());
                args.push_back(std::move(lowered_arg));
            }
            if (!instance_method_callee.empty()) {
                argument_type_names.insert(
                    argument_type_names.begin(), instance_method_owner_type);
                arg_types.insert(
                    arg_types.begin(), vf::JsonValue(instance_method_owner_type));
                args.insert(args.begin(), std::move(instance_method_owner));
                auto method_callee = node("load");
                method_callee["name"] = vf::JsonValue(instance_method_callee);
                method_callee["type"] = vf::JsonValue("any");
                callee = vf::JsonValue(std::move(method_callee));
            }
            const bool spilled_ui_display = std::find(
                spilled_modules_.begin(), spilled_modules_.end(), "ui.display") !=
                spilled_modules_.end();
            const bool spilled_physics = std::find(
                spilled_modules_.begin(), spilled_modules_.end(), "physics") !=
                spilled_modules_.end();
            const auto named_value = [&](const std::string& wanted,
                                         const std::string& context) -> const vf::JsonValue* {
                const vf::JsonValue* result = nullptr;
                for (const auto& raw_named : named_args) {
                    const auto& named = object_of(raw_named, context);
                    if (string_field(named, "name", context) != wanted) continue;
                    if (result != nullptr) {
                        throw IRFailure(context + " received duplicate `" + wanted + "`");
                    }
                    result = &field(named, "value", context);
                }
                return result;
            };
            if (spilled_ui_display &&
                string_field(callee_ast, "kind", "call.callee") == "identifier") {
                const std::string component_identity = string_field(
                    callee_ast, "name", "call.callee");
                if (vf::html_component_catalog::Contains(component_identity)) {
                    if (!args.empty() || !spread_args.empty() || named_args.size() > 1) {
                        throw IRFailure(
                            component_identity + " currently accepts only optional `id:`");
                    }
                    vf::JsonValue component = string_const(component_identity);
                    component.as_object()["type"] = vf::JsonValue(
                        "ui_component<" + component_identity + ">");
                    if (!named_args.empty()) {
                        const vf::JsonValue* id = named_value("id", component_identity);
                        if (id == nullptr) {
                            throw IRFailure(
                                component_identity + " currently accepts only `id:`");
                        }
                        const auto& value = object_of(*id, component_identity + " id");
                        const auto& raw = field(value, "value", component_identity + " id");
                        if (string_field(value, "kind", component_identity + " id") != "const" ||
                            string_field(value, "type", component_identity + " id") != "str" ||
                            !raw.is_string() || raw.as_string().empty()) {
                            throw IRFailure(
                                component_identity + " `id:` requires a non-empty constant string");
                        }
                        component.as_object()["id"] = raw;
                    }
                    return component;
                }
            }
            if (spilled_physics &&
                string_field(callee_ast, "kind", "call.callee") == "identifier" &&
                string_field(callee_ast, "name", "call.callee") == "World") {
                if (!args.empty() || !spread_args.empty()) {
                    throw IRFailure("World currently accepts named arguments only");
                }
                const vf::JsonValue* dimension_value = named_value("dim", "World");
                if (dimension_value == nullptr) {
                    throw IRFailure("World requires `dim:`");
                }
                const auto& dimension = object_of(*dimension_value, "World dim");
                const auto& raw_dimension = field(dimension, "value", "World dim");
                if (string_field(dimension, "kind", "World dim") != "const" ||
                    !raw_dimension.is_number() || raw_dimension.as_number() != 2.0) {
                    throw IRFailure("the first World reference application requires `dim:2`");
                }
                static const std::set<std::string> supported{
                    "dim", "em", "gravity", "rigid_collisions"
                };
                vf::JsonValue::Object world_options;
                for (const auto& raw_named : named_args) {
                    const auto& named = object_of(raw_named, "World argument");
                    const std::string name = string_field(named, "name", "World argument");
                    if (supported.find(name) == supported.end()) {
                        throw IRFailure("the first World reference application does not support `" + name + "`");
                    }
                    if (name == "dim") continue;
                    const auto& value = object_of(
                        field(named, "value", "World switch"), "World switch");
                    if (string_field(value, "kind", "World switch") != "const" ||
                        !field(value, "value", "World switch").is_boolean()) {
                        throw IRFailure("World `" + name + "` requires a constant bit");
                    }
                    world_options[name] = field(value, "value", "World switch");
                }
                const std::uint64_t world_id = worlds_.size();
                worlds_.push_back(WorldRef{world_id, std::move(world_options), {}});
                vf::JsonValue handle = num_const(static_cast<double>(world_id));
                handle.as_object()["type"] = vf::JsonValue("World<2>");
                return handle;
            }
            if (spilled_ui_display &&
                string_field(callee_ast, "kind", "call.callee") == "identifier" &&
                string_field(callee_ast, "name", "call.callee") == "Display") {
                if (!args.empty() || !spread_args.empty() || named_args.size() != 1) {
                    throw IRFailure("Display currently requires exactly `dim:`");
                }
                const vf::JsonValue* dimension_value = named_value("dim", "Display");
                if (dimension_value == nullptr) {
                    throw IRFailure("Display currently requires exactly `dim:`");
                }
                const auto& dimension = object_of(*dimension_value, "Display dim");
                const auto& raw_dimension = field(dimension, "value", "Display dim");
                if (string_field(dimension, "kind", "Display dim") != "const" ||
                    !raw_dimension.is_number() || raw_dimension.as_number() != 2.0) {
                    throw IRFailure("Display currently requires `dim:2`");
                }
                vf::JsonValue::Object display;
                display["dimension"] = vf::JsonValue(2.0);
                display["surface"] = vf::JsonValue("web_surface");
                display["transparent"] = vf::JsonValue(true);
                ui_displays_.emplace_back(std::move(display));
                vf::JsonValue handle = num_const(
                    static_cast<double>(ui_displays_.size() - 1));
                handle.as_object()["type"] = vf::JsonValue("Display<2>");
                return handle;
            }
            if (string_field(callee_ast, "kind", "call.callee") == "attribute") {
                const auto& owner_ast = object_of(
                    field(callee_ast, "object", "method callee"), "method owner");
                const std::string method = string_field(callee_ast, "name", "method callee");
                if (method == "get" &&
                    string_field(owner_ast, "kind", "method owner") == "attribute" &&
                    string_field(owner_ast, "name", "method owner") == "events") {
                    const auto& event_owner_ast = object_of(
                        field(owner_ast, "object", "events owner"), "events owner");
                    if (string_field(event_owner_ast, "kind", "events owner") == "identifier") {
                        const std::string owner_name = string_field(
                            event_owner_ast, "name", "events owner");
                        const std::string owner_type = env.get(owner_name);
                        if (args.empty() && named_args.empty() && spread_args.empty() &&
                            (owner_type == "ui_component<Button>" ||
                             owner_type == "ui_component<Input>" ||
                             owner_type == "Display<2>")) {
                            const bool button_owner = owner_type == "ui_component<Button>";
                            const bool slider_owner = owner_type == "ui_component<Input>";
                            auto owner = node("load");
                            owner["name"] = vf::JsonValue(owner_name);
                            owner["type"] = vf::JsonValue(owner_type);
                            auto poll = node("ui_owner_event_get");
                            poll["owner"] = vf::JsonValue(std::move(owner));
                            poll["owner_kind"] = vf::JsonValue(
                                button_owner ? "Button" : slider_owner ? "Input" : "Display");
                            poll["type"] = vf::JsonValue(
                                button_owner ? "ButtonEvent|null" :
                                slider_owner ? "SliderEvent|null" : "DisplayEvent|null");
                            return vf::JsonValue(std::move(poll));
                        }
                    }
                }
                if (string_field(owner_ast, "kind", "method owner") == "identifier") {
                    const std::string queue_name = string_field(owner_ast, "name", "method owner");
                    const std::string queue_type = env.get(queue_name);
                    const bool retained_owner = queue_type == "Display<2>" ||
                        queue_type == "Frame<2>" || queue_type == "View" ||
                        queue_type == "Layer" || starts_with(queue_type, "ui_component<");
                    if (spilled_ui_display && retained_owner && method == "get") {
                        if (args.size() != 1 || !named_args.empty() || !spread_args.empty()) {
                            throw IRFailure("retained owner.get requires exactly one id");
                        }
                        const std::string id_type = string_field(
                            object_of(args.front(), "retained owner.get id"),
                            "type", "retained owner.get id");
                        if (id_type != "str" && id_type != "int") {
                            throw IRFailure("retained owner.get id must be str or int");
                        }
                        auto owner = node("load");
                        owner["name"] = vf::JsonValue(queue_name);
                        owner["type"] = vf::JsonValue(queue_type);
                        auto lookup = node("ui_owner_get");
                        lookup["owner"] = vf::JsonValue(std::move(owner));
                        lookup["owner_kind"] = vf::JsonValue(
                            queue_type == "Display<2>" ? "Display" :
                            queue_type == "Frame<2>" ? "Frame" :
                            queue_type == "View" ? "View" :
                            queue_type == "Layer" ? "Layer" :
                            queue_type.substr(13, queue_type.size() - 14));
                        lookup["id"] = args.front();
                        lookup["type"] = vf::JsonValue(ui_owner_lookup_type(args.front()));
                        return vf::JsonValue(std::move(lookup));
                    }
                    if (spilled_ui_display && queue_type == "Frame<2>" &&
                        method == "capture") {
                        if (!args.empty() || !named_args.empty() || !spread_args.empty()) {
                            throw IRFailure("Frame.capture does not accept arguments");
                        }
                        const auto target = ui_handle_bindings_.find(queue_name);
                        if (target == ui_handle_bindings_.end() ||
                            target->second.kind != "frame") {
                            throw IRFailure("Frame.capture requires a retained Frame binding");
                        }
                        auto capture = node("ui_frame_capture");
                        capture["frame_id"] = vf::JsonValue(
                            "frame_" + std::to_string(target->second.id));
                        capture["type"] = vf::JsonValue("list<list<list<int>>>");
                        return vf::JsonValue(std::move(capture));
                    }
                    if (spilled_ui_display && queue_type == "Frame<2>" &&
                        method == "push") {
                        if (!args.empty() || !named_args.empty() || !spread_args.empty()) {
                            throw IRFailure("Frame.push does not accept arguments");
                        }
                        const auto target = ui_handle_bindings_.find(queue_name);
                        if (target == ui_handle_bindings_.end() ||
                            target->second.kind != "frame") {
                            throw IRFailure("Frame.push requires a retained Frame binding");
                        }
                        vf::JsonValue::Object push;
                        push["kind"] = vf::JsonValue("push");
                        push["frame_id"] = vf::JsonValue(
                            static_cast<double>(target->second.id));
                        ui_operations_.emplace_back(std::move(push));
                        ui_result_type_ = "View";
                        vf::JsonValue view = num_const(
                            static_cast<double>(ui_operations_.size() - 1));
                        view.as_object()["type"] = vf::JsonValue("View");
                        return view;
                    }
                    if (spilled_ui_display && queue_type == "Frame<2>" &&
                        (method == "set_geom_options" || method == "add_camera" ||
                         method == "add_light" || method == "add")) {
                        if (!args.empty() || !spread_args.empty()) {
                            throw IRFailure("Frame." + method + " accepts named arguments only");
                        }
                        const auto target = ui_handle_bindings_.find(queue_name);
                        if (target == ui_handle_bindings_.end() ||
                            target->second.kind != "frame") {
                            throw IRFailure("Frame." + method + " requires a retained Frame binding");
                        }
                        static const std::map<std::string, std::set<std::string>> supported{
                            {"set_geom_options", {
                                "background", "unified_renderer", "combine_transparent"
                            }},
                            {"add_camera", {
                                "p", "pos", "target", "up", "fov", "projection", "ortho_scale",
                                "p_t", "x_t", "y_t", "z_t", "target_t", "fov_t",
                                "t", "t_min", "t_max", "t_mode"
                            }},
                            {"add_light", {
                                "id", "kind", "pos", "target", "color", "intensity",
                                "range", "casts_shadow", "model", "source_radius", "spread",
                                "show_marker"
                            }},
                            {"add", {
                                "x", "y", "z", "id", "color", "representation", "render_mode",
                                "p_uc", "faces_uvw",
                                "p_t", "c_tc", "s_t", "t", "t_min", "t_max", "t_mode", "s_mode",
                                "texture", "specular_strength", "roughness", "reflectivity", "alpha",
                                "emission",
                                "transparent", "depth_write", "receives_lighting", "no_lighting",
                                "casts_shadow", "receives_shadow", "surface_system", "interpolation",
                                "visible"
                            }}
                        };
                        vf::JsonValue::Object properties;
                        for (const auto& raw_named : named_args) {
                            const auto& named = object_of(
                                raw_named, "Frame." + method + " argument");
                            const std::string name = string_field(
                                named, "name", "Frame." + method + " argument");
                            if (supported.at(method).find(name) == supported.at(method).end()) {
                                throw IRFailure(
                                    "Frame." + method + " does not support `" + name + "`");
                            }
                            if (properties.find(name) != properties.end()) {
                                throw IRFailure(
                                    "Frame." + method + " received duplicate `" + name + "`");
                            }
                            properties[name] = field(
                                named, "value", "Frame." + method + " argument");
                        }
                        const bool temporal_camera = method == "add_camera" &&
                            (properties.find("p_t") != properties.end() ||
                             properties.find("x_t") != properties.end() ||
                             properties.find("y_t") != properties.end() ||
                             properties.find("z_t") != properties.end() ||
                             properties.find("target_t") != properties.end() ||
                             properties.find("fov_t") != properties.end());
                        if (method == "add_camera" &&
                            ((properties.find("p") == properties.end() &&
                              properties.find("pos") == properties.end() &&
                              properties.find("p_t") == properties.end() &&
                              properties.find("x_t") == properties.end() &&
                              properties.find("y_t") == properties.end() &&
                              properties.find("z_t") == properties.end()) ||
                             (properties.find("target") == properties.end() &&
                              properties.find("target_t") == properties.end()))) {
                            throw IRFailure(
                                "Frame.add_camera requires a position channel and `target:` or `target_t:`");
                        }
                        if (method == "add_camera" &&
                            properties.find("p") != properties.end() &&
                            properties.find("pos") != properties.end()) {
                            throw IRFailure("Frame.add_camera accepts `p:` or `pos:`, not both");
                        }
                        if (method == "add_light" &&
                            (properties.find("id") == properties.end() ||
                             properties.find("pos") == properties.end())) {
                            throw IRFailure("Frame.add_light requires `id:` and `pos:`");
                        }
                        const bool temporal_add = method == "add" &&
                            properties.find("p_t") != properties.end();
                        const bool indexed_add = method == "add" &&
                            (properties.find("p_uc") != properties.end() ||
                             properties.find("faces_uvw") != properties.end());
                        if (indexed_add &&
                            (properties.find("p_uc") == properties.end() ||
                             properties.find("faces_uvw") == properties.end() ||
                             properties.find("id") == properties.end() ||
                             properties.find("color") == properties.end())) {
                            throw IRFailure(
                                "indexed Frame.add geometry requires `p_uc:`, `faces_uvw:`, "
                                "`id:`, and `color:`");
                        }
                        if (method == "add" && !temporal_add && !indexed_add &&
                            (properties.find("x") == properties.end() ||
                             properties.find("y") == properties.end() ||
                             properties.find("id") == properties.end() ||
                             properties.find("color") == properties.end())) {
                            throw IRFailure(
                                "Frame.add geometry requires `x:`, `y:`, `id:`, and `color:`");
                        }
                        if (method == "add") {
                            const auto emission = properties.find("emission");
                            if (emission != properties.end()) {
                                validate_emission_type(emission->second);
                            }
                        }
                        vf::JsonValue::Object operation;
                        operation["kind"] = vf::JsonValue(method);
                        operation["frame_id"] = vf::JsonValue(
                            static_cast<double>(target->second.id));
                        if (temporal_add) {
                            (void)lower_temporal_frame_add(properties, operation);
                        } else if (temporal_camera) {
                            (void)lower_temporal_frame_camera(properties, operation);
                        }
                        operation["properties"] = vf::JsonValue(std::move(properties));
                        if (method == "add") {
                            const std::uint64_t layer_id = next_ui_layer_++;
                            operation["layer_id"] = vf::JsonValue(
                                static_cast<double>(layer_id));
                            ui_operations_.emplace_back(std::move(operation));
                            ui_result_type_ = "Layer";
                            vf::JsonValue layer = num_const(static_cast<double>(layer_id));
                            layer.as_object()["type"] = vf::JsonValue("Layer");
                            return layer;
                        }
                        ui_operations_.emplace_back(std::move(operation));
                        auto result = node("const");
                        result["type"] = vf::JsonValue("null");
                        result["value"] = vf::JsonValue(nullptr);
                        return vf::JsonValue(std::move(result));
                    }
                    if (spilled_physics && queue_type == "World<2>" && method == "add") {
                        if (args.size() != 1 || !named_args.empty() || !spread_args.empty()) {
                            throw IRFailure("World.add requires exactly one positional object");
                        }
                        const auto world_binding = world_handle_bindings_.find(queue_name);
                        if (world_binding == world_handle_bindings_.end() ||
                            world_binding->second >= worlds_.size()) {
                            throw IRFailure("World.add requires a retained World binding");
                        }
                        const std::uint64_t world_id = world_binding->second;
                        const std::uint64_t object_id = worlds_[world_id].objects.size();
                        const std::string object_type = string_field(
                            object_of(args.front(), "World.add object"),
                            "type", "World.add object");
                        worlds_[world_id].objects.push_back(WorldObjectRef{
                            object_id, object_type, args.front()
                        });

                        vf::JsonValue::Object operation;
                        operation["kind"] = vf::JsonValue("add");
                        operation["world_id"] = vf::JsonValue(static_cast<double>(world_id));
                        operation["object_id"] = vf::JsonValue(static_cast<double>(object_id));
                        operation["object_type"] = vf::JsonValue(object_type);
                        world_operations_.emplace_back(std::move(operation));
                        return std::move(args.front());
                    }
                    if (spilled_ui_display &&
                        (queue_type == "Display<2>" || queue_type == "Frame<2>") &&
                        method == "append_world") {
                        if (args.size() != 2 || !named_args.empty() || !spread_args.empty() ||
                            raw_call_args.size() != 2) {
                            throw IRFailure(
                                "append_world requires one World and one embedding overload group");
                        }
                        const auto& raw_world = object_of(
                            raw_call_args[0], "append_world World argument");
                        const auto& raw_embedding = object_of(
                            raw_call_args[1], "append_world embedding argument");
                        if (string_field(raw_world, "kind", "append_world World argument") !=
                                "identifier" ||
                            string_field(raw_embedding, "kind", "append_world embedding argument") !=
                                "identifier") {
                            throw IRFailure(
                                "append_world requires named World and embedding bindings");
                        }
                        const std::string world_name = string_field(
                            raw_world, "name", "append_world World argument");
                        const std::string embedding_name = string_field(
                            raw_embedding, "name", "append_world embedding argument");
                        const auto world_binding = world_handle_bindings_.find(world_name);
                        if (world_binding == world_handle_bindings_.end() ||
                            world_binding->second >= worlds_.size()) {
                            throw IRFailure("append_world requires a retained World binding");
                        }
                        if (!functions_.contains(embedding_name)) {
                            throw IRFailure("append_world requires a named embedding overload group");
                        }

                        const std::uint64_t world_id = world_binding->second;
                        std::size_t matched = 0;
                        for (const auto& object_ref : worlds_[world_id].objects) {
                            const FunctionInfo* embedding = functions_.get(
                                embedding_name, {object_ref.type});
                            if (embedding == nullptr) continue;
                            std::string representation = resolve_type_alias(
                                embedding->representation_type);
                            if (representation == "any") {
                                representation = resolve_type_alias(embedding->return_type);
                            }
                            const auto output_fields = ordered_record_type_fields(representation);
                            if (output_fields.empty()) {
                                throw IRFailure(
                                    "embedding overload for " + object_ref.type +
                                    " must return normal Display.add channels");
                            }

                            auto callee = node("load");
                            callee["name"] = vf::JsonValue(
                                functions_.runtime_name(*embedding));
                            callee["type"] = vf::JsonValue(embedding->signature);
                            vf::JsonValue::Array call_args;
                            call_args.push_back(object_ref.value);
                            auto call = node("call");
                            call["args"] = vf::JsonValue(std::move(call_args));
                            call["arg_types"] = vf::JsonValue(
                                vf::JsonValue::Array{vf::JsonValue(object_ref.type)});
                            call["named_args"] = vf::JsonValue(vf::JsonValue::Array{});
                            call["spread_args"] = vf::JsonValue(vf::JsonValue::Array{});
                            call["callee"] = vf::JsonValue(std::move(callee));
                            call["callee_type"] = vf::JsonValue(embedding->signature);
                            call["type"] = vf::JsonValue(representation);

                            const std::string retained_name =
                                "$ui$world$" + std::to_string(world_id) + "$object$" +
                                std::to_string(object_ref.id) + "$embedding$" +
                                std::to_string(matched);
                            auto retained = node("store_binding");
                            retained["name"] = vf::JsonValue(retained_name);
                            retained["type"] = vf::JsonValue(representation);
                            retained["value"] = vf::JsonValue(std::move(call));
                            retained["update"] = vf::JsonValue(false);
                            ui_retained_bindings_.emplace_back(std::move(retained));

                            vf::JsonValue::Array embedding_args;
                            for (const auto& [field_name, field_type] : output_fields) {
                                auto load = node("load");
                                load["name"] = vf::JsonValue(retained_name);
                                load["type"] = vf::JsonValue(representation);
                                auto access = node("field_access");
                                access["object"] = vf::JsonValue(std::move(load));
                                access["object_type"] = vf::JsonValue(representation);
                                access["field"] = vf::JsonValue(field_name);
                                access["type"] = vf::JsonValue(resolve_type_alias(field_type));
                                auto named = node("named_arg");
                                named["name"] = vf::JsonValue(field_name);
                                named["value"] = vf::JsonValue(std::move(access));
                                embedding_args.emplace_back(std::move(named));
                            }

                            vf::JsonValue::Object source;
                            source["kind"] = vf::JsonValue("world_embedding");
                            source["world_id"] = vf::JsonValue(static_cast<double>(world_id));
                            source["object_id"] = vf::JsonValue(
                                static_cast<double>(object_ref.id));
                            source["object_type"] = vf::JsonValue(object_ref.type);
                            source["embedding"] = vf::JsonValue(embedding_name);
                            (void)lower_world_embedding_add(
                                embedding_args, vf::JsonValue(std::move(source)));
                            ++matched;
                        }
                        if (matched == 0) {
                            throw IRFailure("append_world found no matching embedding overload");
                        }
                        vf::JsonValue::Object push;
                        push["kind"] = vf::JsonValue("push");
                        ui_operations_.emplace_back(std::move(push));
                        ui_result_type_ = "View";
                        vf::JsonValue view = num_const(0.0);
                        view.as_object()["type"] = vf::JsonValue("View");
                        return view;
                    }
                    if (spilled_ui_display &&
                        (queue_type == "Display<2>" || queue_type == "Frame<2>") &&
                        method == "show") {
                        if (!args.empty() || !named_args.empty() || !spread_args.empty()) {
                            throw IRFailure("show does not accept arguments");
                        }
                        vf::JsonValue::Object show;
                        show["kind"] = vf::JsonValue("show");
                        ui_operations_.emplace_back(std::move(show));
                        auto result = node("const");
                        result["type"] = vf::JsonValue("null");
                        result["value"] = vf::JsonValue(nullptr);
                        return vf::JsonValue(std::move(result));
                    }
                    if (spilled_ui_display && queue_type == "Frame<2>" &&
                        method == "load") {
                        if (args.size() != 1 || !named_args.empty() || !spread_args.empty()) {
                            throw IRFailure("Frame.load requires exactly one resource path");
                        }
                        const auto target = ui_handle_bindings_.find(queue_name);
                        if (target == ui_handle_bindings_.end() ||
                            target->second.kind != "frame") {
                            throw IRFailure("Frame.load requires a retained Frame binding");
                        }
                        const auto& resource = object_of(args.front(), "Frame.load resource");
                        const auto& raw_resource = field(resource, "value", "Frame.load resource");
                        if (string_field(resource, "kind", "Frame.load resource") != "const" ||
                            string_field(resource, "type", "Frame.load resource") != "str" ||
                            !raw_resource.is_string()) {
                            throw IRFailure("Frame.load requires a constant string resource path");
                        }
                        vf::JsonValue::Object target_value;
                        target_value["kind"] = vf::JsonValue("frame");
                        target_value["id"] = vf::JsonValue(
                            static_cast<double>(target->second.id));
                        vf::JsonValue::Object load;
                        load["kind"] = vf::JsonValue("load");
                        load["resource"] = vf::JsonValue(raw_resource.as_string());
                        load["target"] = vf::JsonValue(std::move(target_value));
                        ui_operations_.emplace_back(std::move(load));
                        auto result = node("const");
                        result["type"] = vf::JsonValue("null");
                        result["value"] = vf::JsonValue(nullptr);
                        return vf::JsonValue(std::move(result));
                    }
                    if (spilled_ui_display && queue_type == "Display<2>" &&
                        method == "add_frame") {
                        if (!args.empty() || !spread_args.empty() || named_args.size() != 2) {
                            throw IRFailure("Display.add_frame requires exactly `pos:` and `size:`");
                        }
                        const vf::JsonValue* pos = named_value("pos", "Display.add_frame");
                        const vf::JsonValue* size = named_value("size", "Display.add_frame");
                        if (pos == nullptr || size == nullptr) {
                            throw IRFailure("Display.add_frame requires exactly `pos:` and `size:`");
                        }
                        const auto require_vec2 = [](const vf::JsonValue& value,
                                                     const std::string& context) {
                            const std::string type = string_field(
                                object_of(value, context), "type", context);
                            const auto shape = fixed_numeric_vector_shape(type);
                            if (!shape || shape->dimensions != std::vector<std::size_t>{2}) {
                                throw IRFailure(context + " requires a fixed numeric vector of length 2");
                            }
                        };
                        require_vec2(*pos, "Display.add_frame pos");
                        require_vec2(*size, "Display.add_frame size");
                        const auto parent = ui_handle_bindings_.find(queue_name);
                        if (parent == ui_handle_bindings_.end() ||
                            parent->second.kind != "display") {
                            throw IRFailure("Display.add_frame requires a retained Display binding");
                        }
                        const std::uint64_t frame_index = next_ui_frame_++;
                        vf::JsonValue::Object add_frame;
                        add_frame["kind"] = vf::JsonValue("add_frame");
                        add_frame["frame_id"] = vf::JsonValue(
                            static_cast<double>(frame_index));
                        add_frame["parent_kind"] = vf::JsonValue("display");
                        add_frame["parent_id"] = vf::JsonValue(
                            static_cast<double>(parent->second.id));
                        add_frame["pos"] = *pos;
                        add_frame["size"] = *size;
                        ui_operations_.emplace_back(std::move(add_frame));
                        ui_result_type_ = "Frame<2>";
                        vf::JsonValue frame = num_const(static_cast<double>(frame_index));
                        frame.as_object()["type"] = vf::JsonValue("Frame<2>");
                        return frame;
                    }
                    if (starts_with(queue_type, "queue<")) {
                        if (!named_args.empty() || !spread_args.empty()) {
                            throw IRFailure("collections.queue methods do not accept named or spread arguments");
                        }
                        const auto queue_load = [&]() {
                            auto load = node("load");
                            load["name"] = vf::JsonValue(queue_name);
                            load["type"] = vf::JsonValue(queue_type);
                            return vf::JsonValue(std::move(load));
                        };
                        const auto queue_field = [&](const std::string& name, const std::string& type) {
                            auto access = node("field_access");
                            access["object"] = queue_load();
                            access["object_type"] = vf::JsonValue(queue_type);
                            access["field"] = vf::JsonValue(name);
                            access["type"] = vf::JsonValue(type);
                            return vf::JsonValue(std::move(access));
                        };
                        const auto count_values = [&]() {
                            auto count = node("call");
                            vf::JsonValue::Array count_args;
                            count_args.push_back(queue_field("values", "list<num>"));
                            count["args"] = vf::JsonValue(std::move(count_args));
                            count["arg_types"] = vf::JsonValue(
                                vf::JsonValue::Array{vf::JsonValue("list<num>")});
                            count["named_args"] = vf::JsonValue(vf::JsonValue::Array{});
                            count["spread_args"] = vf::JsonValue(vf::JsonValue::Array{});
                            count["callee"] = stdlib_function("stat", "count");
                            count["callee_type"] = vf::JsonValue("fn(any)->num");
                            count["type"] = vf::JsonValue("num");
                            return vf::JsonValue(std::move(count));
                        };
                        if (method == "put") {
                            if (args.size() != 1) throw IRFailure("queue.put requires one numeric argument");
                            auto singleton = node("list");
                            singleton["items"] = vf::JsonValue(
                                vf::JsonValue::Array{args.front()});
                            singleton["element_type"] = vf::JsonValue("num");
                            singleton["type"] = vf::JsonValue("list<num>");
                            auto concat = node("binary_op");
                            concat["op"] = vf::JsonValue("AMPERSAND");
                            concat["left"] = queue_field("values", "list<num>");
                            concat["right"] = vf::JsonValue(std::move(singleton));
                            concat["left_type"] = vf::JsonValue("list<num>");
                            concat["right_type"] = vf::JsonValue("list<num>");
                            concat["type"] = vf::JsonValue("list<num>");
                            auto update = node("update_attr");
                            update["base_name"] = vf::JsonValue(queue_name);
                            update["field"] = vf::JsonValue("values");
                            update["value"] = vf::JsonValue(std::move(concat));
                            auto tail = node("expr_stmt");
                            auto null_value = node("const");
                            null_value["type"] = vf::JsonValue("null");
                            null_value["value"] = vf::JsonValue(nullptr);
                            tail["expr"] = vf::JsonValue(std::move(null_value));
                            auto block = node("block_expr");
                            block["body"] = vf::JsonValue(vf::JsonValue::Array{
                                vf::JsonValue(std::move(update)), vf::JsonValue(std::move(tail))});
                            block["type"] = vf::JsonValue("null");
                            return vf::JsonValue(std::move(block));
                        }
                        if (method == "empty") {
                            if (!args.empty()) throw IRFailure("queue.empty takes no arguments");
                            auto equal = node("binary_op");
                            equal["op"] = vf::JsonValue("EQ");
                            equal["left"] = queue_field("head", "num");
                            equal["right"] = count_values();
                            equal["left_type"] = vf::JsonValue("num");
                            equal["right_type"] = vf::JsonValue("num");
                            equal["type"] = vf::JsonValue("bit");
                            return vf::JsonValue(std::move(equal));
                        }
                        if (method == "get") {
                            if (!args.empty()) throw IRFailure("queue.get takes no arguments");
                            auto condition = node("binary_op");
                            condition["op"] = vf::JsonValue("LT");
                            condition["left"] = queue_field("head", "num");
                            condition["right"] = count_values();
                            condition["left_type"] = vf::JsonValue("num");
                            condition["right_type"] = vf::JsonValue("num");
                            condition["type"] = vf::JsonValue("bit");
                            auto indexed = node("dotted_index");
                            indexed["base"] = queue_field("values", "list<num>");
                            indexed["indices"] = vf::JsonValue(
                                vf::JsonValue::Array{queue_field("head", "num")});
                            indexed["type"] = vf::JsonValue("num");
                            const std::string value_name = "$queue_get$" +
                                std::to_string(next_lambda_local_++);
                            auto value_binding = node("store_binding");
                            value_binding["name"] = vf::JsonValue(value_name);
                            value_binding["type"] = vf::JsonValue("num");
                            value_binding["value"] = vf::JsonValue(std::move(indexed));
                            auto advance = node("binary_op");
                            advance["op"] = vf::JsonValue("PLUS");
                            advance["left"] = queue_field("head", "num");
                            advance["right"] = num_const(1.0);
                            advance["left_type"] = vf::JsonValue("num");
                            advance["right_type"] = vf::JsonValue("num");
                            advance["type"] = vf::JsonValue("num");
                            auto update = node("update_attr");
                            update["base_name"] = vf::JsonValue(queue_name);
                            update["field"] = vf::JsonValue("head");
                            update["value"] = vf::JsonValue(std::move(advance));
                            auto result_load = node("load");
                            result_load["name"] = vf::JsonValue(value_name);
                            result_load["type"] = vf::JsonValue("num");
                            auto tail = node("expr_stmt");
                            tail["expr"] = vf::JsonValue(std::move(result_load));
                            auto body = node("block_expr");
                            body["body"] = vf::JsonValue(vf::JsonValue::Array{
                                vf::JsonValue(std::move(value_binding)),
                                vf::JsonValue(std::move(update)),
                                vf::JsonValue(std::move(tail))});
                            body["type"] = vf::JsonValue("num");
                            auto conditional = node("if_expr");
                            conditional["condition"] = vf::JsonValue(std::move(condition));
                            conditional["body"] = vf::JsonValue(std::move(body));
                            conditional["type"] = vf::JsonValue("num|null");
                            return vf::JsonValue(std::move(conditional));
                        }
                        throw IRFailure("unknown collections.queue method " + method);
                    }
                }
            }
            std::string callee_type = string_field(callee.as_object(), "type", "call callee");
            std::string call_type = "any";
            bool elementwise_math_call = false;
            bool structural_call = false;
            std::vector<std::size_t> structural_argument_indices;
            bool structural_paths_present = false;
            std::vector<std::string> structural_paths;
            std::vector<std::string> specialization_argument_types;
            const auto& lowered_callee = object_of(callee, "lowered call callee");
            if (string_field(lowered_callee, "kind", "lowered call callee") == "stdlib_function" &&
                string_field(lowered_callee, "module", "lowered call callee") == "math" &&
                std::any_of(argument_type_names.begin(), argument_type_names.end(), symbolic_expression_type)) {
                const std::string operation = string_field(lowered_callee, "name", "symbolic math call");
                static const std::set<std::string> analytic_operations{
                    "sin", "cos", "ln", "log", "sqrt", "exp"
                };
                if (analytic_operations.count(operation)) {
                    const auto& raw_args = array_of(field(object, "args", "symbolic math call"), "symbolic math args");
                    for (const auto& raw_arg : raw_args) {
                        validate_symbolic_analytic_domains(raw_arg, operation);
                    }
                    const FunctionInfo* symbolic_function = functions_.get(operation, argument_type_names);
                    if (symbolic_function == nullptr) {
                        throw IRFailure("math." + operation + " has no symbolic overload for these arguments");
                    }
                    auto symbolic_callee = node("load");
                    symbolic_callee["name"] = vf::JsonValue(functions_.runtime_name(*symbolic_function));
                    symbolic_callee["type"] = vf::JsonValue(symbolic_function->signature);
                    callee = vf::JsonValue(std::move(symbolic_callee));
                    callee_type = symbolic_function->signature;
                    call_type = symbolic_function->return_type;
                }
            }
            if (string_field(callee_ast, "kind", "call.callee") == "identifier" ||
                !instance_method_callee.empty()) {
                const std::string callee_name = !instance_method_callee.empty()
                    ? instance_method_callee
                    : (primitive_callee.empty()
                        ? string_field(callee_ast, "name", "call.callee")
                        : primitive_callee);
                static const std::set<std::string> elementwise_math_functions{
                    "tan", "sec", "cot", "csc", "sinh", "cosh", "tanh",
                    "lg", "lg2", "asinh", "acosh", "atanh", "atan", "asin",
                    "acos", "atan2", "acot", "asec", "acsc", "gamma", "erf", "log",
                };
                const auto structural_numeric_type = [](const std::string& type) {
                    return type.rfind("list<", 0) == 0 ||
                        (type.size() >= 3 && type.front() == '[' && type.back() == ']');
                };
                const bool spilled_math = std::find(
                    spilled_modules_.begin(), spilled_modules_.end(), "math") != spilled_modules_.end();
                const auto module_separator = callee_name.rfind("__");
                const std::string math_name = module_separator == std::string::npos
                    ? callee_name : callee_name.substr(module_separator + 2);
                const bool namespaced_math = callee_name.rfind("__vkf_module_", 0) == 0;
                const bool elementwise_math_candidate =
                    (spilled_math || namespaced_math) && !advanced_call_shape &&
                    elementwise_math_functions.count(math_name) &&
                    std::any_of(
                        argument_type_names.begin(), argument_type_names.end(),
                        structural_numeric_type);
                const FunctionInfo* function = advanced_call_shape
                    ? functions_.get(callee_name)
                    : functions_.get(callee_name, argument_type_names);
                if (function == nullptr && !advanced_call_shape &&
                    functions_.contains(callee_name)) {
                    const FunctionInfo* lifted = nullptr;
                    int lifted_score = -1;
                    bool lifted_ambiguous = false;
                    for (const auto* candidate : functions_.family(callee_name)) {
                        std::size_t required = 0;
                        bool variadic = false;
                        for (std::size_t index = 0;
                             index < candidate->param_types.size(); ++index) {
                            const bool has_default = index < candidate->param_defaults.size() &&
                                !candidate->param_defaults[index].is_null();
                            const bool captured =
                                (index < candidate->variadic_positional.size() &&
                                 candidate->variadic_positional[index]) ||
                                (index < candidate->variadic_named.size() &&
                                 candidate->variadic_named[index]);
                            if (!has_default && !captured) ++required;
                            variadic = variadic || captured;
                        }
                        if (argument_type_names.size() < required ||
                            (!variadic && argument_type_names.size() >
                                candidate->param_types.size())) {
                            continue;
                        }
                        bool compatible = true;
                        bool uses_lifting = false;
                        int score = 0;
                        std::map<std::string, std::string> dimensions;
                        for (std::size_t index = 0;
                             index < argument_type_names.size() &&
                             index < candidate->param_types.size(); ++index) {
                            const std::string actual =
                                resolve_type_alias(argument_type_names[index]);
                            const std::string expected =
                                resolve_type_alias(candidate->param_types[index]);
                            auto candidate_dimensions = dimensions;
                            const bool dimension_match = collect_broadcast_dimension_bindings(
                                actual, expected, candidate_dimensions);
                            if (!dimension_match) {
                                compatible = false;
                                break;
                            }
                            dimensions = std::move(candidate_dimensions);
                            if (structurally_compatible_type(actual, expected)) {
                                score += actual == expected ? 100 : 60;
                                continue;
                            }
                            std::vector<std::string> paths;
                            collect_structural_match_paths(actual, expected, "", paths);
                            if (paths.empty()) {
                                compatible = false;
                                break;
                            }
                            uses_lifting = true;
                            score += has_exact_broadcast_path(actual, expected) ? 30 : 20;
                        }
                        if (!compatible || !uses_lifting) continue;
                        if (score > lifted_score) {
                            lifted = candidate;
                            lifted_score = score;
                            lifted_ambiguous = false;
                        } else if (score == lifted_score) {
                            lifted_ambiguous = true;
                        }
                    }
                    if (!lifted_ambiguous) function = lifted;
                }
                if (function == nullptr && !advanced_call_shape &&
                    std::any_of(argument_type_names.begin(), argument_type_names.end(), symbolic_expression_type)) {
                    const FunctionInfo* trace = functions_.get_unique_arity(callee_name, args.size());
                    if (trace != nullptr && !trace->body_ast.is_null() &&
                        trace->param_names.size() == args.size() && kind_of(trace->body_ast) != "block") {
                        bool traceable = true;
                        std::map<std::string, vf::JsonValue> replacements;
                        const auto& raw_args = array_of(field(object, "args", "symbolic trace"), "symbolic trace args");
                        for (std::size_t index = 0; index < args.size(); ++index) {
                            const std::string& parameter_type = trace->param_types[index];
                            if (parameter_type != "any" && parameter_type != "num" &&
                                parameter_type != "int" && parameter_type != "f32" && parameter_type != "f64") {
                                traceable = false;
                                break;
                            }
                            if (parameter_type == "int") {
                                std::optional<std::string> argument_name;
                                if (kind_of(raw_args[index]) == "identifier") {
                                    argument_name = string_field(
                                        raw_args[index].as_object(), "name", "symbolic trace argument");
                                }
                                if (argument_name.has_value()) {
                                    const auto binding = symbolic_bindings_.find(*argument_name);
                                    if (binding != symbolic_bindings_.end() &&
                                        binding->second.domain != "N" && binding->second.domain != "Z") {
                                        throw IRFailure(
                                            "symbolic argument " + *argument_name + " in domain " +
                                            binding->second.domain + " does not satisfy int parameter " +
                                            trace->param_names[index] + " of " + callee_name);
                                    }
                                }
                            }
                            replacements[trace->param_names[index]] = raw_args[index];
                        }
                        if (traceable) {
                            if (!symbolic_trace_stack_.insert(callee_name).second) {
                                throw IRFailure("recursive symbolic tracing requires an explicit symbolic definition for " + callee_name);
                            }
                            vf::JsonValue traced_body = trace->body_ast;
                            substitute_symbolic_trace_arguments(traced_body, replacements);
                            try {
                                vf::JsonValue traced = lower_expr(traced_body, env);
                                symbolic_trace_stack_.erase(callee_name);
                                return traced;
                            } catch (...) {
                                symbolic_trace_stack_.erase(callee_name);
                                throw;
                            }
                        }
                    }
                }
                if (function == nullptr && elementwise_math_candidate) {
                    function = functions_.get(callee_name);
                }
                if (function == nullptr && !advanced_call_shape &&
                    functions_.contains(callee_name)) {
                    // Shape-erased callables are considered only after ordinary
                    // and vector-lifted overload resolution.
                    function = functions_.get_unique_arity(callee_name, args.size());
                }
                if (function != nullptr) {
                    elementwise_math_call = elementwise_math_candidate;
                    std::map<std::string, std::string> dimension_bindings;
                    std::map<std::string, std::string> named_type_bindings;
                    for (std::size_t i = 0; i < argument_type_names.size() && i < function->param_types.size(); ++i) {
                        auto type_candidate = named_type_bindings;
                        if (!collect_named_type_bindings(
                                resolve_type_alias(argument_type_names[i]),
                                resolve_type_alias(function->param_types[i]),
                                type_candidate)) {
                            throw IRFailure(
                                "named generic type " + function->param_types[i] +
                                " received inconsistent argument types");
                        }
                        named_type_bindings = std::move(type_candidate);
                        auto candidate = dimension_bindings;
                        if (!collect_broadcast_dimension_bindings(
                                resolve_type_alias(argument_type_names[i]),
                                resolve_type_alias(function->param_types[i]),
                                candidate)) {
                            continue;
                        }
                        dimension_bindings = std::move(candidate);
                    }
                    std::vector<std::string> instantiated_params = function->param_types;
                    for (auto& parameter_type : instantiated_params) {
                        parameter_type = instantiate_vector_type(
                            parameter_type, dimension_bindings, named_type_bindings);
                    }
                    std::string instantiated_return =
                        instantiate_vector_type(
                            function->return_type, dimension_bindings, named_type_bindings);
                    if (instantiated_return == "any") {
                        const auto dependent = metatype_return_parameter(*function);
                        if (dependent.has_value() && *dependent < argument_type_names.size()) {
                            const std::string& concrete = argument_type_names[*dependent];
                            if (starts_with(concrete, "type<") && concrete.back() == '>') {
                                instantiated_return = concrete.substr(5, concrete.size() - 6);
                            }
                        }
                    }
                    specialization_argument_types = instantiated_params;
                    for (std::size_t index = 0;
                         index < specialization_argument_types.size() &&
                         index < argument_type_names.size(); ++index) {
                        if (instantiated_params[index] == "type" &&
                            starts_with(argument_type_names[index], "type<") &&
                            argument_type_names[index].back() == '>') {
                            specialization_argument_types[index] = argument_type_names[index];
                        }
                    }
                    const std::string structural_parameter = instantiated_params.empty()
                        ? std::string{} : resolve_type_alias(instantiated_params.front());
                    const std::string structural_result = resolve_type_alias(instantiated_return);
                    if (!elementwise_math_call && !advanced_call_shape) {
                        for (std::size_t index = 0;
                             index < argument_type_names.size() && index < instantiated_params.size();
                             ++index) {
                            const std::string structural_argument =
                                resolve_type_alias(argument_type_names[index]);
                            const std::string expected = resolve_type_alias(instantiated_params[index]);
                            if (structurally_compatible_type(structural_argument, expected)) continue;
                            if (structural_container_type(structural_argument)) {
                                std::vector<std::string> paths;
                                collect_structural_match_paths(structural_argument, expected, "", paths);
                                if (paths.empty()) {
                                    throw IRFailure(
                                        "automatic function broadcasting requires a compatible vector element type: got " +
                                        structural_argument + " for " + expected);
                                }
                                if (!structural_argument_indices.empty() && paths != structural_paths) {
                                    throw IRFailure(
                                        "automatic function broadcasting requires lifted arguments to have the same vector depth");
                                }
                                structural_call = true;
                                structural_argument_indices.push_back(index);
                                structural_paths = std::move(paths);
                                structural_paths_present = true;
                            } else if ((starts_with(structural_argument, "tuple<") &&
                                        structural_argument.back() == '>') ||
                                       (starts_with(structural_argument, "record{") &&
                                        structural_argument.back() == '}')) {
                                throw IRFailure(
                                    "automatic function broadcasting only descends through vectors");
                            }
                        }
                    }
                    auto resolved_callee = node("load");
                    resolved_callee["name"] = vf::JsonValue(functions_.runtime_name(*function));
                    callee_type = function_signature_type(instantiated_params, instantiated_return);
                    resolved_callee["type"] = vf::JsonValue(callee_type);
                    callee = vf::JsonValue(std::move(resolved_callee));
                    if (!advanced_call_shape) {
                        std::size_t required = 0;
                        bool has_variadic = false;
                        for (std::size_t i = 0; i < function->param_types.size(); ++i) {
                            const bool has_default = i < function->param_defaults.size() && !function->param_defaults[i].is_null();
                            const bool is_variadic = (i < function->variadic_positional.size() && function->variadic_positional[i])
                                || (i < function->variadic_named.size() && function->variadic_named[i]);
                            has_variadic = has_variadic || is_variadic;
                            if (!has_default && !is_variadic) {
                                required += 1;
                            }
                        }
                        if (args.size() < required || (!has_variadic && args.size() > function->param_types.size())) {
                            throw IRFailure(
                                "wrong arity for function " + callee_name + ": expected "
                                + std::to_string(function->param_types.size()) + ", got "
                                + std::to_string(args.size())
                            );
                        }
                        for (std::size_t i = 0; i < args.size() && i < function->param_types.size(); ++i) {
                            const bool is_variadic = (i < function->variadic_positional.size() && function->variadic_positional[i])
                                || (i < function->variadic_named.size() && function->variadic_named[i]);
                            const bool lifted = std::find(
                                structural_argument_indices.begin(),
                                structural_argument_indices.end(), i) != structural_argument_indices.end();
                            if (!is_variadic && !elementwise_math_call && !lifted) {
                                args[i] = coerce_value_to_type(
                                    std::move(args[i]),
                                    instantiated_params[i],
                                    "call arg " + std::to_string(i) + " for " + function->name
                                );
                                arg_types[i] = vf::JsonValue(instantiated_params[i]);
                            }
                        }
                    }
                    call_type = instantiated_return;
                    if (elementwise_math_call) {
                        const auto structural = std::find_if(
                            argument_type_names.begin(), argument_type_names.end(),
                            structural_numeric_type);
                        call_type = structurally_lifted_result_type(
                            resolve_type_alias(*structural), "num", "num");
                        structural_paths_present = true;
                        collect_structural_match_paths(
                            resolve_type_alias(*structural), "num", "", structural_paths);
                        if (structural_paths.empty()) {
                            throw IRFailure(
                                "automatic math broadcasting requires num-compatible vector elements");
                        }
                    } else if (structural_call) {
                        const std::size_t carrier_index = structural_argument_indices.front();
                        call_type = structurally_lifted_result_type(
                            resolve_type_alias(argument_type_names[carrier_index]),
                            resolve_type_alias(instantiated_params[carrier_index]),
                            structural_result);
                        if (structural_paths.empty()) {
                            throw IRFailure(
                                "automatic function broadcasting requires a compatible vector element type for " +
                                callee_name);
                        }
                    }
                } else if (functions_.contains(callee_name)) {
                    std::string received;
                    for (std::size_t index = 0; index < argument_type_names.size(); ++index) {
                        if (index != 0) received += ", ";
                        received += argument_type_names[index];
                    }
                    std::string candidates;
                    for (const auto* candidate : functions_.family(callee_name)) {
                        if (!candidates.empty()) candidates += "; ";
                        candidates += candidate->signature;
                    }
                    throw IRFailure(
                        "no matching overload for function " + callee_name +
                        " with (" + received + "); candidates: " + candidates);
                } else if (callee_name == "bit" || callee_name == "chr" ||
                           callee_name == "int" || callee_name == "num" ||
                           callee_name == "str") {
                    call_type = callee_name;
                }
            }
            if (call_type == "any") {
                const std::size_t arrow = callee_type.find("->");
                if (arrow != std::string::npos && arrow + 2 < callee_type.size()) {
                    call_type = callee_type.substr(arrow + 2);
                }
            }
            const auto& callee_ir = object_of(callee, "call callee IR");
            if (string_field(callee_ir, "kind", "call callee IR") == "error_type") {
                if (!named_args.empty() || !spread_args.empty() || args.size() > 1) {
                    throw IRFailure("error constructors accept at most one positional message");
                }
                vf::JsonValue message;
                if (args.empty()) {
                    auto empty = node("const");
                    empty["type"] = vf::JsonValue("str");
                    empty["value"] = vf::JsonValue("");
                    message = vf::JsonValue(std::move(empty));
                } else {
                    const std::string message_type = string_field(
                        args.front().as_object(), "type", "error constructor message");
                    if (message_type != "str") {
                        throw IRFailure("error constructor message must be str");
                    }
                    message = std::move(args.front());
                }
                const std::string error_name = string_field(
                    callee_ir, "name", "error constructor type");
                const auto& mask_value = field(callee_ir, "mask", "error constructor type");
                if (!mask_value.is_number()) {
                    throw IRFailure("error constructor type needs a mask");
                }
                auto type_name = node("const");
                type_name["type"] = vf::JsonValue("str");
                type_name["value"] = vf::JsonValue(error_name);
                auto mask = node("const");
                mask["type"] = vf::JsonValue("num");
                mask["value"] = mask_value;
                vf::JsonValue::Array fields;
                const auto add_field = [&](std::string name, std::string type, vf::JsonValue value) {
                    auto record_field = node("record_field");
                    record_field["name"] = vf::JsonValue(std::move(name));
                    record_field["value"] = std::move(value);
                    record_field["type"] = vf::JsonValue(std::move(type));
                    fields.emplace_back(std::move(record_field));
                };
                add_field("message", "str", std::move(message));
                add_field("type", "str", vf::JsonValue(std::move(type_name)));
                add_field("mask", "num", vf::JsonValue(std::move(mask)));
                auto error = node("record");
                error["fields"] = vf::JsonValue(std::move(fields));
                error["type"] = vf::JsonValue("record{message:str,type:str,mask:num}");
                return vf::JsonValue(std::move(error));
            }
            if (string_field(callee_ir, "kind", "call callee IR") == "stdlib_function" &&
                string_field(callee_ir, "module", "call callee IR") == "data" &&
                string_field(callee_ir, "name", "call callee IR") == "load") {
                if (args.size() == 1 && named_args.empty() && spread_args.empty()) {
                    const auto& source_value = object_of(args.front(), "data.load source");
                    const auto source_text = source_value.find("value");
                    if (string_field(source_value, "kind", "data.load source") == "const" &&
                        string_field(source_value, "type", "data.load source") == "str" &&
                        source_text != source_value.end() && source_text->second.is_string()) {
                        try {
                            const std::string source = source_text->second.as_string();
                            std::ifstream input(source, std::ios::binary);
                            if (input) {
                                const auto scanner =
                                    vkf::data::detail::CsvDemandSourceScanner::scan(
                                        input,
                                        vkf::data::detail::CsvScanLimits{
                                            128u,
                                            1024u * 1024u,
                                            1024u * 1024u,
                                        },
                                        vkf::data::detail::CsvHeaderMode::present);
                                const auto valid_field_name = [](const std::string& name) {
                                    if (name.empty() ||
                                        !(std::isalpha(static_cast<unsigned char>(name.front())) ||
                                          name.front() == '_')) {
                                        return false;
                                    }
                                    return std::all_of(
                                        name.begin() + 1, name.end(), [](unsigned char ch) {
                                            return std::isalnum(ch) || ch == '_';
                                        });
                                };
                                const auto& names = scanner.raw_column_names();
                                std::set<std::string> unique_names;
                                const bool supported_header =
                                    names.size() == scanner.column_count() &&
                                    std::all_of(
                                        names.begin(), names.end(), [&](const std::string& name) {
                                            return valid_field_name(name) &&
                                                unique_names.insert(name).second;
                                        });
                                if (supported_header) {
                                    vf::JsonValue::Array fields;
                                    std::string record_type = "record{";
                                    for (std::size_t column = 0; column < names.size(); ++column) {
                                        if (column != 0) record_type += ',';
                                        record_type += names[column] + ":[any]";
                                        auto lazy_column = node("csv_lazy_column");
                                        lazy_column["column"] =
                                            vf::JsonValue(static_cast<double>(column));
                                        lazy_column["row_count"] = vf::JsonValue(
                                            static_cast<double>(scanner.row_count()));
                                        lazy_column["type"] = vf::JsonValue("[any]");
                                        auto field_value = node("field");
                                        field_value["name"] = vf::JsonValue(names[column]);
                                        field_value["type"] = vf::JsonValue("[any]");
                                        field_value["value"] =
                                            vf::JsonValue(std::move(lazy_column));
                                        fields.emplace_back(std::move(field_value));
                                    }
                                    record_type += '}';
                                    auto record = node("csv_lazy_record");
                                    record["source"] = vf::JsonValue(source);
                                    record["row_count"] = vf::JsonValue(
                                        static_cast<double>(scanner.row_count()));
                                    record["fields"] = vf::JsonValue(std::move(fields));
                                    record["type"] = vf::JsonValue(std::move(record_type));
                                    return vf::JsonValue(std::move(record));
                                }
                            }
                        } catch (const std::exception&) {
                            // Public failure timing and diagnostics remain unfrozen.
                        }
                    }
                }
            }
            if (string_field(callee_ir, "kind", "call callee IR") == "stdlib_function" &&
                string_field(callee_ir, "module", "call callee IR") == "collections" &&
                string_field(callee_ir, "name", "call callee IR") == "map") {
                if (!args.empty() || !spread_args.empty()) {
                    throw IRFailure("collections.map accepts named fields only");
                }
                vf::JsonValue::Array fields;
                std::string record_type = "record{";
                for (std::size_t index = 0; index < named_args.size(); ++index) {
                    auto& named = named_args[index].as_object();
                    const std::string name = string_field(
                        named, "name", "collections.map field");
                    vf::JsonValue value = std::move(named.at("value"));
                    const std::string value_type = string_field(
                        value.as_object(), "type", "collections.map field value");
                    if (index != 0) record_type += ",";
                    record_type += name + ":" + value_type;
                    auto record_field = node("record_field");
                    record_field["name"] = vf::JsonValue(name);
                    record_field["value"] = std::move(value);
                    record_field["type"] = vf::JsonValue(value_type);
                    fields.emplace_back(std::move(record_field));
                }
                record_type += "}";
                auto record = node("record");
                record["fields"] = vf::JsonValue(std::move(fields));
                record["type"] = vf::JsonValue(record_type);
                return vf::JsonValue(std::move(record));
            }
            if (string_field(callee_ir, "kind", "call callee IR") == "stdlib_function" &&
                string_field(callee_ir, "module", "call callee IR") == "collections" &&
                string_field(callee_ir, "name", "call callee IR") == "queue") {
                if (!args.empty() || !named_args.empty() || !spread_args.empty()) {
                    throw IRFailure("collections.queue constructor takes no arguments");
                }
                auto values = node("list");
                values["items"] = vf::JsonValue(vf::JsonValue::Array{});
                values["element_type"] = vf::JsonValue("num");
                values["type"] = vf::JsonValue("list<num>");
                auto values_field = node("record_field");
                values_field["name"] = vf::JsonValue("values");
                values_field["value"] = vf::JsonValue(std::move(values));
                values_field["type"] = vf::JsonValue("list<num>");
                auto head_field = node("record_field");
                head_field["name"] = vf::JsonValue("head");
                head_field["value"] = num_const(0.0);
                head_field["type"] = vf::JsonValue("num");
                auto queue = node("record");
                queue["fields"] = vf::JsonValue(vf::JsonValue::Array{
                    vf::JsonValue(std::move(values_field)),
                    vf::JsonValue(std::move(head_field))});
                queue["type"] = vf::JsonValue("queue<num>");
                return vf::JsonValue(std::move(queue));
            }
            if (string_field(callee_ir, "kind", "call callee IR") == "stdlib_function" &&
                string_field(callee_ir, "module", "call callee IR") == "collections" &&
                string_field(callee_ir, "name", "call callee IR") == "list") {
                std::string element_type = "any";
                bool first = true;
                for (const auto& value : arg_types) {
                    if (!value.is_string()) throw IRFailure("collections.list argument type must be string");
                    element_type = first ? value.as_string()
                        : merge_nullable_type(element_type, value.as_string());
                    first = false;
                }
                call_type = "list<" + element_type + ">";
            }
            if (string_field(callee_ir, "kind", "call callee IR") == "stdlib_function" &&
                string_field(callee_ir, "module", "call callee IR") == "regex") {
                const std::string regex_name = string_field(
                    callee_ir, "name", "regex call");
                if (args.size() != 2 || !named_args.empty() || !spread_args.empty()) {
                    throw IRFailure("regex." + regex_name +
                        " requires source and a constant pattern");
                }
                const auto& pattern_value = object_of(args[1], "regex pattern");
                const auto value = pattern_value.find("value");
                if (string_field(pattern_value, "kind", "regex pattern") != "const" ||
                    value == pattern_value.end() || !value->second.is_string()) {
                    throw IRFailure("regex pattern must be a compile-time string constant");
                }
                vkf::capture::Pattern pattern;
                try {
                    pattern = vkf::capture::parse(value->second.as_string());
                } catch (const vkf::capture::PatternFailure& error) {
                    throw IRFailure(error.what());
                }
                if (regex_name == "match") {
                    call_type = "record{";
                    for (std::size_t index = 0; index < pattern.group_names.size(); ++index) {
                        if (index != 0) call_type += ",";
                        call_type += pattern.group_names[index] + ":str";
                    }
                    call_type += "}";
                } else if (regex_name == "groups") {
                    call_type = "tuple<";
                    for (std::size_t index = 0; index < pattern.group_names.size(); ++index) {
                        if (index != 0) call_type += ",";
                        call_type += "str";
                    }
                    call_type += ">";
                } else {
                    throw IRFailure("unknown stdlib regex member " + regex_name);
                }
                callee_type = "fn(str,str)->" + call_type;
                callee.as_object()["type"] = vf::JsonValue(callee_type);
            }
            if (string_field(callee_ir, "kind", "call callee IR") == "stdlib_function" &&
                string_field(callee_ir, "module", "call callee IR") == "stat" &&
                string_field(callee_ir, "name", "call callee IR") == "sum") {
                if (args.size() != 1 || !spread_args.empty()) {
                    throw IRFailure("stat.sum requires one vector argument");
                }
                std::string leaf_type = resolve_type_alias(
                    string_field(args.front().as_object(), "type", "stat.sum argument"));
                bool has_vector_layer = false;
                while (true) {
                    if (const auto vector = vector_type_parts(leaf_type)) {
                        leaf_type = vector->element;
                        has_vector_layer = true;
                        continue;
                    }
                    if (const auto list = maybe_dynamic_list_element_type(leaf_type)) {
                        leaf_type = *list;
                        has_vector_layer = true;
                        continue;
                    }
                    break;
                }
                if (leaf_type == "any") {
                    // Some resource-owning tuple/record projections are shape
                    // erased in typed IR. Machine layout validation still
                    // requires their selected field to be a numeric vector.
                    call_type = "num";
                } else if (!has_vector_layer ||
                    (leaf_type != "int" && leaf_type != "num" &&
                     leaf_type != "f32" && leaf_type != "f64")) {
                    throw IRFailure("stat.sum requires a numeric vector argument");
                } else {
                    call_type = leaf_type;
                }
                if (!named_args.empty()) {
                    const std::string argument_type = resolve_type_alias(
                        string_field(args.front().as_object(), "type", "stat.sum argument"));
                    const auto shape = fixed_numeric_vector_shape(argument_type);
                    if (!shape) {
                        throw IRFailure(
                            "stat.sum axis requires a fixed rectangular numeric vector");
                    }
                    call_type = stat_axis_result_type(
                        *shape, constant_stat_axes(named_args, shape->dimensions.size()));
                }
                callee_type = "fn(any)->" + call_type;
                callee.as_object()["type"] = vf::JsonValue(callee_type);
            }
            if (string_field(callee_ir, "kind", "call callee IR") == "stdlib_function" &&
                string_field(callee_ir, "module", "call callee IR") == "math" &&
                arg_types.size() == 1 && arg_types.front().is_string()) {
                const std::string argument_type = arg_types.front().as_string();
                if (vector_type_parts(argument_type) ||
                    maybe_dynamic_list_element_type(argument_type)) {
                    call_type = structurally_lifted_result_type(
                        resolve_type_alias(argument_type), "num", "num");
                    structural_paths_present = true;
                    collect_structural_match_paths(
                        resolve_type_alias(argument_type), "num", "", structural_paths);
                    if (structural_paths.empty()) {
                        throw IRFailure(
                            "automatic math broadcasting requires num-compatible vector elements");
                    }
                } else if ((starts_with(argument_type, "tuple<") && argument_type.back() == '>') ||
                           (starts_with(argument_type, "record{") && argument_type.back() == '}')) {
                    throw IRFailure(
                        "automatic function broadcasting only descends through vectors");
                }
            }
            auto out = node("call");
            out["args"] = vf::JsonValue(std::move(args));
            out["arg_types"] = vf::JsonValue(std::move(arg_types));
            out["named_args"] = vf::JsonValue(std::move(named_args));
            out["spread_args"] = vf::JsonValue(std::move(spread_args));
            out["callee"] = std::move(callee);
            out["callee_type"] = vf::JsonValue(callee_type);
            out["type"] = vf::JsonValue(call_type);
            if (!specialization_argument_types.empty()) {
                vf::JsonValue::Array types;
                for (const auto& type : specialization_argument_types) types.emplace_back(type);
                out["specialization_arg_types"] = vf::JsonValue(std::move(types));
            }
            if (elementwise_math_call) out["elementwise_math"] = vf::JsonValue(true);
            if (structural_call) out["structural_call"] = vf::JsonValue(true);
            if (!structural_argument_indices.empty()) {
                vf::JsonValue::Array indices;
                for (const auto index : structural_argument_indices) {
                    indices.emplace_back(static_cast<double>(index));
                }
                out["structural_argument_indices"] = vf::JsonValue(std::move(indices));
            }
            if (structural_paths_present) {
                vf::JsonValue::Array paths;
                for (const auto& path : structural_paths) paths.emplace_back(path);
                out["structural_paths"] = vf::JsonValue(std::move(paths));
            }
            return vf::JsonValue(std::move(out));
        }
        if (kind == "unary_op") {
            vf::JsonValue operand = lower_expr(field(object, "operand", "unary_op"), env);
            const std::string operand_type = string_field(operand.as_object(), "type", "unary_op.operand");
            const std::string op = string_field(object, "op", "unary_op");
            const std::string overload_name = op == "MINUS" ? "-" : op == "NOT" ? "~" : "";
            const bool scalar_builtin = operand_type == "bit" || operand_type == "int" ||
                operand_type == "num" || operand_type == "f32" || operand_type == "f64";
            const FunctionInfo* unary_function = functions_.get(overload_name, {operand_type});
            if (unary_function == nullptr && !overload_name.empty()) {
                for (const auto* candidate : functions_.family(overload_name)) {
                    if (candidate->param_types.size() != 1 ||
                        !structurally_compatible_type(
                            resolve_type_alias(operand_type),
                            resolve_type_alias(candidate->param_types.front()))) continue;
                    if (unary_function != nullptr) {
                        unary_function = nullptr;
                        break;
                    }
                    unary_function = candidate;
                }
            }
            if (const FunctionInfo* function = unary_function;
                function != nullptr && !scalar_builtin && operand_type != "any") {
                auto out = node("call");
                vf::JsonValue::Array args;
                args.push_back(std::move(operand));
                vf::JsonValue::Array arg_types;
                arg_types.push_back(vf::JsonValue(operand_type));
                auto callee = node("load");
                callee["name"] = vf::JsonValue(functions_.runtime_name(*function));
                callee["type"] = vf::JsonValue(function->signature);
                out["args"] = vf::JsonValue(std::move(args));
                out["arg_types"] = vf::JsonValue(std::move(arg_types));
                out["named_args"] = vf::JsonValue(vf::JsonValue::Array{});
                out["spread_args"] = vf::JsonValue(vf::JsonValue::Array{});
                out["callee"] = vf::JsonValue(std::move(callee));
                out["callee_type"] = vf::JsonValue(function->signature);
                out["type"] = vf::JsonValue(function->return_type);
                return vf::JsonValue(std::move(out));
            }
            auto out = node("unary_op");
            out["op"] = vf::JsonValue(op);
            out["operand"] = std::move(operand);
            out["operand_type"] = vf::JsonValue(operand_type);
            out["type"] = vf::JsonValue(op == "NOT" ? "bit" : operand_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "assert_expr") {
            vf::JsonValue condition = lower_expr(field(object, "condition", "assert_expr"), env);
            const std::string condition_type = string_field(
                condition.as_object(), "type", "assert_expr.condition");
            const bool scalar = condition_type == "bit" || condition_type == "int" ||
                condition_type == "num" || condition_type == "f32" || condition_type == "f64";
            if (!scalar) {
                throw IRFailure("assertion condition must be scalar, got " + condition_type);
            }
            auto out = node("assert_expr");
            out["condition"] = std::move(condition);
            const auto message = object.find("message");
            if (message == object.end() || message->second.is_null()) {
                out["message"] = vf::JsonValue(nullptr);
            } else {
                out["message"] = lower_expr(message->second, env);
            }
            out["type"] = vf::JsonValue(condition_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "range_expr") {
            vf::JsonValue folded;
            if (optional_bool_field(object, "parenthesized") &&
                try_fold_range_expr(object, folded)) {
                return folded;
            }
            auto out = node("range");
            const auto& raw_start = field(object, "start", "range_expr");
            const auto& raw_end = field(object, "end", "range_expr");
            out["start"] = raw_start.is_null() ? int_const(0.0) : lower_expr(raw_start, env);
            out["end"] = raw_end.is_null() ? vf::JsonValue(nullptr) : lower_expr(raw_end, env);
            const auto numeric_range_bound = [](const std::string& type) {
                return type == "int" || type == "num" || type == "f32" || type == "f64";
            };
            if (!numeric_range_bound(string_field(
                    out["start"].as_object(), "type", "range start")) ||
                (!out["end"].is_null() && !numeric_range_bound(string_field(
                    out["end"].as_object(), "type", "range end")))) {
                throw IRFailure("range bounds must be numeric integers");
            }
            out["infinite"] = vf::JsonValue(raw_end.is_null());
            out["type"] = vf::JsonValue("range<int>");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "pipe_chain") {
            vf::JsonValue folded;
            if (try_fold_pipe_chain_expr(object, env, functions_, folded)) {
                return folded;
            }
            const auto& raw_source = object_of(
                field(object, "source", "pipe_chain"), "pipe source");
            std::optional<vf::JsonValue> range_source;
            std::optional<std::size_t> fixed_range_count;
            if (string_field(raw_source, "kind", "pipe source") == "range_expr") {
                vf::JsonValue folded_range;
                if (try_fold_range_expr(raw_source, folded_range)) {
                    fixed_range_count = array_of(
                        field(folded_range.as_object(), "items", "fixed pipe range"),
                        "fixed pipe range items").size();
                }
                auto range = node("range");
                const auto& raw_start = field(raw_source, "start", "pipe range");
                const auto& raw_end = field(raw_source, "end", "pipe range");
                vf::JsonValue lowered_start = raw_start.is_null()
                    ? int_const(0.0) : lower_expr(raw_start, env);
                if (raw_start.is_null() && !raw_end.is_null()) {
                    vf::JsonValue lowered_end = lower_expr(raw_end, env);
                    if (string_field(
                            lowered_end.as_object(), "type", "pipe range end") == "int") {
                        lowered_start.as_object()["type"] = vf::JsonValue("int");
                    }
                    range["end"] = std::move(lowered_end);
                } else {
                    range["end"] = raw_end.is_null()
                        ? vf::JsonValue(nullptr) : lower_expr(raw_end, env);
                }
                const auto numeric_range_bound = [](const std::string& type) {
                    return type == "int" || type == "num" || type == "f32" || type == "f64";
                };
                if (!numeric_range_bound(string_field(
                        lowered_start.as_object(), "type", "pipe range start")) ||
                    (!range["end"].is_null() && !numeric_range_bound(string_field(
                        range["end"].as_object(), "type", "pipe range end")))) {
                    throw IRFailure("range bounds must be numeric integers");
                }
                range["start"] = std::move(lowered_start);
                range["infinite"] = vf::JsonValue(raw_end.is_null());
                range["type"] = vf::JsonValue("range<int>");
                range_source = vf::JsonValue(std::move(range));
            }
            vf::JsonValue source = lower_expr(field(object, "source", "pipe_chain"), env);
            const std::string source_type = string_field(source.as_object(), "type", "pipe source");
            std::string element_type = "any";
            if (const auto vector = vector_type_parts(source_type)) {
                element_type = vector->element;
            } else if (source_type.rfind("list<", 0) == 0 && source_type.back() == '>') {
                element_type = source_type.substr(5, source_type.size() - 6);
            } else if (source_type.rfind("tuple<", 0) == 0 && source_type.back() == '>') {
                const auto tuple_types = split_top_level_type_parts(
                    source_type.substr(6, source_type.size() - 7));
                if (!tuple_types.empty() && std::all_of(
                        tuple_types.begin() + 1, tuple_types.end(),
                        [&](const auto& item) { return item == tuple_types.front(); })) {
                    element_type = tuple_types.front();
                }
            } else if (source_type == "str") {
                element_type = "chr";
            } else if (source_type.rfind("multiset<", 0) == 0 && source_type.back() == '>') {
                element_type = source_type.substr(9, source_type.size() - 10);
            } else if (source_type == "range<int>") {
                element_type = "int";
            } else if (source_type == "num" || source_type == "int" ||
                       source_type == "f32" || source_type == "f64" ||
                       source_type == "bit" || source_type == "chr" ||
                       source_type == "null") {
                element_type = source_type;
            }
            if (element_type == "any") {
                throw IRFailure("runtime pipe requires a statically shaped element type");
            }
            TypeEnv pipe_env = env;
            pipe_env.set("$", element_type);
            vf::JsonValue::Array segments;
            std::string result_element_type = element_type;
            for (const auto& segment : array_of(field(object, "segments", "pipe_chain"), "pipe segments")) {
                const auto& raw_segment = object_of(segment, "pipe segment");
                const std::string raw_kind = string_field(raw_segment, "kind", "pipe segment");
                vf::JsonValue lowered;
                if (raw_kind == "emit") {
                    vf::JsonValue statement = lower_stmt(segment, pipe_env);
                    lowered = field(statement.as_object(), "expr", "pipe emit");
                } else if (raw_kind == "label_emit") {
                    vf::JsonValue::Array body;
                    body.push_back(lower_stmt(segment, pipe_env));
                    auto tail = node("expr_stmt");
                    auto current = node("load");
                    current["name"] = vf::JsonValue("$");
                    current["type"] = vf::JsonValue(result_element_type);
                    tail["expr"] = vf::JsonValue(std::move(current));
                    body.emplace_back(std::move(tail));
                    auto block = node("block_expr");
                    block["body"] = vf::JsonValue(std::move(body));
                    block["type"] = vf::JsonValue(result_element_type);
                    lowered = vf::JsonValue(std::move(block));
                } else {
                    lowered = lower_expr(segment, pipe_env);
                }
                result_element_type = string_field(lowered.as_object(), "type", "pipe segment");
                pipe_env.set("$", result_element_type);
                segments.push_back(std::move(lowered));
            }
            std::string result_type = source_type;
            if (const auto vector = vector_type_parts(source_type)) {
                result_type = "[" + result_element_type +
                    (vector->shape.empty() ? "" : ":" + vector->shape) + "]";
            } else if (source_type.rfind("list<", 0) == 0) {
                result_type = "list<" + result_element_type + ">";
            } else if (source_type.rfind("tuple<", 0) == 0 && source_type.back() == '>') {
                const auto tuple_types = split_top_level_type_parts(
                    source_type.substr(6, source_type.size() - 7));
                result_type = "tuple<";
                for (std::size_t index = 0; index < tuple_types.size(); ++index) {
                    if (index != 0) result_type += ",";
                    result_type += result_element_type;
                }
                result_type += ">";
            } else if (source_type.rfind("multiset<", 0) == 0) {
                result_type = "multiset<" + result_element_type + ">";
            } else if (source_type == "str") {
                result_type = result_element_type == "chr" || result_element_type == "str"
                    ? "str" : "list<" + result_element_type + ">";
            } else if (source_type == "range<int>") {
                if (fixed_range_count) {
                    result_type = "tuple<";
                    for (std::size_t index = 0; index < *fixed_range_count; ++index) {
                        if (index != 0) result_type += ",";
                        result_type += result_element_type;
                    }
                    result_type += ">";
                } else {
                    result_type = "list<" + result_element_type + ">";
                }
            } else if (source_type == "num" || source_type == "int" ||
                       source_type == "f32" || source_type == "f64" ||
                       source_type == "bit" || source_type == "chr" ||
                       source_type == "null") {
                result_type = result_element_type;
            }
            auto out = node("pipe_chain");
            out["source"] = std::move(source);
            if (range_source) out["range_source"] = std::move(*range_source);
            out["segments"] = vf::JsonValue(std::move(segments));
            out["type"] = vf::JsonValue(result_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "block") {
            const auto& statements = array_of(field(object, "statements", "block"), "block.statements");
            vf::JsonValue::Array lowered;
            TypeEnv block_env = env;
            block_env.begin_scope();
            // @: inside an expression block returns from that block, not from
            // the surrounding function. Its value therefore follows the block
            // result shape instead of the function's declared result type.
            block_env.set("$return", "any");
            for (const auto& stmt : statements) {
                lowered.push_back(lower_stmt(stmt, block_env));
            }
            std::string block_type = "any";
            if (!lowered.empty()) {
                const auto& tail = object_of(lowered.back(), "block tail");
                const std::string tail_kind = string_field(tail, "kind", "block tail");
                if (tail_kind == "expr_stmt") {
                    const auto& tail_expr = object_of(field(tail, "expr", "block tail"), "block tail expr");
                    block_type = string_field(tail_expr, "type", "block tail expr");
                } else if (tail_kind == "return" || tail_kind == "store_binding") {
                    block_type = string_field(tail, "type", "block tail");
                }
            }
            auto out = node("block_expr");
            out["body"] = vf::JsonValue(std::move(lowered));
            out["type"] = vf::JsonValue(block_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "binary_op") {
            vf::JsonValue left = lower_expr(field(object, "left", "binary_op"), env);
            vf::JsonValue right = lower_expr(field(object, "right", "binary_op"), env);
            const std::string left_type = string_field(left.as_object(), "type", "binary_op.left");
            const std::string right_type = string_field(right.as_object(), "type", "binary_op.right");
            const std::string op = string_field(object, "op", "binary_op");
            const auto left_dimension = vkf::physical::parse_dimension_type(left_type);
            const auto right_dimension = vkf::physical::parse_dimension_type(right_type);
            const bool dimension_checked = op == "PLUS" || op == "MINUS"
                || op == "EQ" || op == "EXACT_EQ" || op == "NEQ"
                || op == "LT" || op == "LE" || op == "GT" || op == "GE";
            if (dimension_checked && left_dimension && right_dimension
                && *left_dimension != *right_dimension) {
                throw IRFailure(
                    "cannot add quantities with dimensions "
                    + vkf::physical::dimension_name(*left_dimension) + " and "
                    + vkf::physical::dimension_name(*right_dimension));
            }
            const auto numeric_scalar = [](const std::string& type) {
                return type == "int" || type == "num" || type == "f32" || type == "f64";
            };
            const bool scalar_builtin = (numeric_scalar(left_type) && numeric_scalar(right_type))
                || (left_type == "bit" && right_type == "bit")
                || (left_type == "str" && right_type == "str");
            const std::string overload_name = op == "PLUS" ? "+" : op == "MINUS" ? "-"
                : op == "STAR" ? "*" : op == "SLASH" ? "/"
                : op == "FLOORDIV" ? "//" : op == "PERCENT" ? "%"
                : op == "CARET" ? "^" : op == "AMPERSAND" ? "&"
                : op == "IMPLIES" ? "=>"
                : op == "EQ" ? "=" : op == "LT" ? "<" : op == "LE" ? "<="
                : op == "GT" ? ">" : op == "GE" ? ">=" : "";
            const FunctionInfo* function = functions_.get(
                overload_name, {left_type, right_type});
            if (function == nullptr && !overload_name.empty()) {
                for (const auto* candidate : functions_.family(overload_name)) {
                    if (candidate->param_types.size() != 2 ||
                        !structurally_compatible_type(
                            resolve_type_alias(left_type),
                            resolve_type_alias(candidate->param_types[0])) ||
                        !structurally_compatible_type(
                            resolve_type_alias(right_type),
                            resolve_type_alias(candidate->param_types[1]))) continue;
                    if (function != nullptr) {
                        function = nullptr;
                        break;
                    }
                    function = candidate;
                }
            }
            if (
                function != nullptr && function->param_types.size() == 2 &&
                structurally_compatible_type(
                    resolve_type_alias(left_type),
                    resolve_type_alias(function->param_types[0])) &&
                structurally_compatible_type(
                    resolve_type_alias(right_type),
                    resolve_type_alias(function->param_types[1])) &&
                !scalar_builtin && left_type != "any" && right_type != "any") {
                auto call = node("call");
                vf::JsonValue::Array args;
                vf::JsonValue::Array arg_types;
                args.push_back(std::move(left));
                args.push_back(std::move(right));
                arg_types.push_back(vf::JsonValue(left_type));
                arg_types.push_back(vf::JsonValue(right_type));
                auto callee = node("load");
                callee["name"] = vf::JsonValue(functions_.runtime_name(*function));
                callee["type"] = vf::JsonValue(function->signature);
                call["args"] = vf::JsonValue(std::move(args));
                call["arg_types"] = vf::JsonValue(std::move(arg_types));
                call["named_args"] = vf::JsonValue(vf::JsonValue::Array{});
                call["spread_args"] = vf::JsonValue(vf::JsonValue::Array{});
                call["callee"] = vf::JsonValue(std::move(callee));
                call["callee_type"] = vf::JsonValue(function->signature);
                call["type"] = vf::JsonValue(function->return_type);
                return vf::JsonValue(std::move(call));
            }
            const auto tuple_or_record = [](const std::string& type) {
                return (starts_with(type, "tuple<") && type.back() == '>') ||
                    (starts_with(type, "record{") && type.back() == '}');
            };
            const bool arithmetic = op == "PLUS" || op == "MINUS" || op == "STAR" ||
                op == "SLASH" || op == "FLOORDIV" || op == "PERCENT" || op == "CARET";
            if (arithmetic && (tuple_or_record(left_type) || tuple_or_record(right_type))) {
                throw IRFailure("tuple and record arithmetic requires an operator overload");
            }
            if (op == "IMPLIES" && left_type == "bit" && right_type == "bit") {
                auto negated = node("unary_op");
                negated["op"] = vf::JsonValue("NOT");
                negated["operand"] = std::move(left);
                negated["type"] = vf::JsonValue("bit");
                auto out = node("binary_op");
                out["op"] = vf::JsonValue("OR");
                out["left"] = vf::JsonValue(std::move(negated));
                out["right"] = std::move(right);
                out["left_type"] = vf::JsonValue("bit");
                out["right_type"] = vf::JsonValue("bit");
                out["type"] = vf::JsonValue("bit");
                return vf::JsonValue(std::move(out));
            }
            auto out = node("binary_op");
            out["op"] = vf::JsonValue(op);
            out["left"] = std::move(left);
            out["right"] = std::move(right);
            out["left_type"] = vf::JsonValue(left_type);
            out["right_type"] = vf::JsonValue(right_type);
            const std::string result_type = binary_result_type(op, left_type, right_type);
            out["type"] = vf::JsonValue(result_type);
            if (symbolic_expression_type(result_type)) {
                attach_expression_facts(
                    out,
                    VkfExpressionLoweringMode::SymbolicNode,
                    "R",
                    op == "EQ" || op == "EXACT_EQ" || op == "NEQ"
                        ? VkfSymbolicCompilerNodeKind::Relation
                        : VkfSymbolicCompilerNodeKind::Binary
                );
            }
            return vf::JsonValue(std::move(out));
        }
        if (kind == "type_of") {
            const auto& raw_value = object_of(field(object, "value", "type_of"), "type_of value");
            if (string_field(raw_value, "kind", "type_of value") == "identifier") {
                const std::string name = string_field(raw_value, "name", "type_of value");
                const std::string primitive = primitive_type_name(name, env);
                if (!primitive.empty()) {
                    auto out = node("const");
                    out["type"] = vf::JsonValue("type<type>");
                    out["value"] = vf::JsonValue("type");
                    return vf::JsonValue(std::move(out));
                }
                const auto family = functions_.family(name);
                if (!family.empty()) {
                    if (is_nominal_constructor_name(name)) {
                        auto out = node("const");
                        out["type"] = vf::JsonValue("type<type>");
                        out["value"] = vf::JsonValue("type");
                        return vf::JsonValue(std::move(out));
                    }
                    std::string surface;
                    for (const auto* function : family) {
                        if (!surface.empty()) surface += " | ";
                        surface += render_surface_type(function->signature);
                    }
                    auto out = node("const");
                    const std::string represented = family.size() == 1
                        ? family.front()->signature : surface;
                    out["type"] = vf::JsonValue("type<" + represented + ">");
                    out["value"] = vf::JsonValue(std::move(surface));
                    return vf::JsonValue(std::move(out));
                }
            }
            vf::JsonValue lowered_value = lower_expr(raw_value, env);
            const std::string value_type = string_field(lowered_value.as_object(), "type", "type_of.value");
            std::string surface_type = value_type == "type" ||
                    (starts_with(value_type, "type<") && value_type.back() == '>')
                ? "type" : render_surface_type(value_type);
            const auto& lowered_object = lowered_value.as_object();
            if (string_field(lowered_object, "kind", "type_of.value") == "list" &&
                value_type.rfind("list<", 0) == 0 && !value_type.empty() && value_type.back() == '>') {
                const auto& items = array_of(field(lowered_object, "items", "type_of list"), "type_of list items");
                surface_type = "[" + render_surface_type(value_type.substr(5, value_type.size() - 6)) +
                    ":" + std::to_string(items.size()) + "]";
            }
            auto out = node("const");
            const std::string represented_type = value_type == "type" ||
                    (starts_with(value_type, "type<") && value_type.back() == '>')
                ? "type" : value_type;
            out["type"] = vf::JsonValue("type<" + represented_type + ">");
            out["value"] = vf::JsonValue(surface_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "bind_expr") {
            const std::string name = string_field(object, "name", "bind expression");
            const auto update_only = object.find("update_only");
            const bool is_update = update_only != object.end() &&
                update_only->second.is_boolean() && update_only->second.as_boolean();
            if (is_update && !env.contains(name)) {
                throw IRFailure(
                    "Cannot update unknown name ." + name +
                    "; declare it first with " + name + ":value");
            }
            if (!is_update && env.declared_here(name)) {
                throw IRFailure(
                    "Cannot declare existing name " + name +
                    "; update it with ." + name + ":value");
            }
            vf::JsonValue value = lower_expr(field(object, "value", "bind expression"), env);
            const std::string type = string_field(value.as_object(), "type", "bind expression");
            if (is_update) env.set(name, type);
            else env.declare(name, type);
            auto out = node("bind_expr");
            out["name"] = vf::JsonValue(name);
            out["value"] = std::move(value);
            out["type"] = vf::JsonValue(type);
            out["update_only"] = vf::JsonValue(is_update);
            const auto update = object.find("update");
            if (update != object.end() && update->second.is_boolean()) {
                out["update"] = update->second;
            }
            return vf::JsonValue(std::move(out));
        }
        if (kind == "abs_expr") {
            vf::JsonValue folded;
            if (try_fold_abs_expr(object, env, folded)) {
                return folded;
            }
            vf::JsonValue value = lower_expr(field(object, "value", "abs_expr"), env);
            const std::string value_type = string_field(value.as_object(), "type", "abs_expr.value");
            auto out = node("unary_op");
            out["op"] = vf::JsonValue(
                value_type.rfind("list<", 0) == 0 ||
                (!value_type.empty() && value_type.front() == '[') ||
                (!value_type.empty() && value_type.front() == '(')
                    ? "NORM" : "ABS");
            out["operand"] = std::move(value);
            out["type"] = vf::JsonValue("num");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "axis_align") {
            vf::JsonValue lowered_value = lower_expr(field(object, "value", "axis_align"), env);
            const std::string value_type = string_field(lowered_value.as_object(), "type", "axis_align.value");
            std::string axis_key = "any";
            const vf::JsonValue& label = field(object, "label", "axis_align");
            const vf::JsonValue& indices = field(object, "indices", "axis_align");
            if (!label.is_null()) {
                if (!label.is_string()) {
                    throw IRFailure("axis_align label must be string");
                }
                axis_key = label.as_string();
            } else if (!indices.is_null()) {
                const auto& index_values = array_of(indices, "axis_align.indices");
                if (index_values.size() != 1) {
                    throw IRFailure("axis_align dynamic indices must contain exactly one expression");
                }
                vf::JsonValue index_value = lower_expr(index_values.front(), env);
                const std::string index_type = string_field(index_value.as_object(), "type", "axis_align.index");
                if (index_type != "str" && index_type != "num" && index_type != "any") {
                    throw IRFailure("axis_align index must be str, num, or any");
                }
            }
            auto out = node("axis_align");
            out["value"] = std::move(lowered_value);
            out["axis_key"] = vf::JsonValue(axis_key);
            out["type"] = vf::JsonValue(axis_tagged_type(axis_key, value_type));
            return vf::JsonValue(std::move(out));
        }
        if (kind == "list_literal" || kind == "vector_literal") {
            const auto& source_items = array_of(field(object, "items", kind), kind + ".items");
            if (source_items.size() == 1) {
                const auto& item = object_of(source_items.front(), "list item AST");
                if (string_field(item, "kind", "list item AST") == "repeat_element") {
                    const auto& count = object_of(
                        field(item, "count", "repeat element"), "repeat count");
                    if (string_field(count, "kind", "repeat count") != "number_literal") {
                        vf::JsonValue value = lower_expr(
                            field(item, "value", "repeat element"), env);
                        vf::JsonValue lowered_count = lower_expr(
                            field(item, "count", "repeat element"), env);
                        const std::string element_type = string_field(
                            value.as_object(), "type", "repeat element");
                        const std::string count_type = string_field(
                            lowered_count.as_object(), "type", "repeat count");
                        if (count_type != "num" && count_type != "int" &&
                            count_type != "f32" && count_type != "f64") {
                            throw IRFailure(
                                "vector repeat count must be numeric; got " + count_type +
                                " from " + vf::json_stringify(
                                    field(item, "count", "repeat element"), -1));
                        }
                        auto out = node("repeat_list");
                        out["value"] = std::move(value);
                        out["count"] = std::move(lowered_count);
                        out["element_type"] = vf::JsonValue(element_type);
                        out["type"] = vf::JsonValue("list<" + element_type + ">");
                        return vf::JsonValue(std::move(out));
                    }
                }
            }
            vf::JsonValue::Array items;
            std::string element_type = "any";
            bool first = true;
            bool has_spread = false;
            for (const auto& item : source_items) {
                const auto& item_object = object_of(item, "list item AST");
                if (string_field(item_object, "kind", "list item AST") == "repeat_element") {
                    const auto& count = object_of(
                        field(item_object, "count", "repeat element"), "repeat count");
                    if (string_field(count, "kind", "repeat count") != "number_literal") {
                        throw IRFailure("vector repeat count must be a constant integer");
                    }
                    const double raw_count = field(count, "value", "repeat count").as_number();
                    if (raw_count < 0 || std::floor(raw_count) != raw_count) {
                        throw IRFailure("vector repeat count must be a nonnegative integer");
                    }
                    vf::JsonValue lowered_item = lower_expr(
                        field(item_object, "value", "repeat element"), env);
                    const std::string item_type = string_field(
                        lowered_item.as_object(), "type", "repeat element");
                    if (starts_with(item_type, "type<") && item_type.back() == '>') {
                        return type_const(
                            "[" + item_type.substr(5, item_type.size() - 6) + ":" +
                            std::to_string(static_cast<std::uint64_t>(raw_count)) + "]");
                    }
                    for (std::uint64_t repeat = 0;
                         repeat < static_cast<std::uint64_t>(raw_count); ++repeat) {
                        if (first) {
                            element_type = item_type;
                            first = false;
                        } else {
                            element_type = merge_nullable_type(element_type, item_type);
                        }
                        items.push_back(lowered_item);
                    }
                    continue;
                }
                if (string_field(item_object, "kind", "list item AST") == "spread_element") {
                    has_spread = true;
                    vf::JsonValue lowered_value = lower_expr(
                        field(item_object, "expr", "spread element"), env);
                    auto spread = node("spread");
                    spread["value"] = lowered_value;
                    spread["type"] = field(lowered_value.as_object(), "type", "spread value");
                    items.emplace_back(std::move(spread));
                    element_type = "any";
                    first = false;
                    continue;
                }
                if (string_field(item_object, "kind", "list item AST") == "range_expr") {
                    vf::JsonValue range_value;
                    if (!try_fold_range_expr(item_object, range_value)) {
                        throw IRFailure(
                            "runtime range materialization in vectors is not yet supported");
                    }
                    const auto& range_object = range_value.as_object();
                    const auto& range_items = array_of(field(range_object, "items", "range list"), "range list.items");
                    const std::string range_type = string_field(range_object, "element_type", "range list");
                    for (const auto& range_item : range_items) {
                        if (first) {
                            element_type = range_type;
                            first = false;
                        } else {
                            element_type = merge_nullable_type(element_type, range_type);
                        }
                        items.push_back(range_item);
                    }
                    continue;
                }
                vf::JsonValue lowered_item = lower_expr(item, env);
                const std::string item_type = string_field(lowered_item.as_object(), "type", "list item");
                if (first) {
                    element_type = item_type;
                    first = false;
                } else {
                    element_type = merge_nullable_type(element_type, item_type);
                }
                items.push_back(std::move(lowered_item));
            }
            if (!items.empty() && !has_spread) {
                std::string represented_type;
                bool all_type_values = true;
                bool all_same_type_values = true;
                for (const auto& item : items) {
                    const std::string item_type = string_field(
                        item.as_object(), "type", "type vector item");
                    if (!starts_with(item_type, "type<") || item_type.back() != '>') {
                        all_type_values = false;
                        all_same_type_values = false;
                        break;
                    }
                    const std::string represented = item_type.substr(5, item_type.size() - 6);
                    if (represented_type.empty()) represented_type = represented;
                    else if (represented_type != represented) all_same_type_values = false;
                }
                if (all_same_type_values) {
                    return type_const(items.size() == 1
                        ? "[" + represented_type + "]"
                        : "[" + represented_type + ":" + std::to_string(items.size()) + "]");
                }
                if (all_type_values) element_type = "type";
            }
            const std::string container_type = items.empty() || has_spread
                ? "list<" + element_type + ">"
                : "[" + element_type + ":" + std::to_string(items.size()) + "]";
            auto out = node("list");
            out["items"] = vf::JsonValue(std::move(items));
            out["element_type"] = vf::JsonValue(element_type);
            out["type"] = vf::JsonValue(container_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "tuple_literal") {
            vf::JsonValue::Array items;
            std::string tuple_type = "tuple<";
            const auto& elements = array_of(field(object, "elements", "tuple_literal"), "tuple_literal.elements");
            for (std::size_t i = 0; i < elements.size(); ++i) {
                const auto& element = object_of(elements[i], "tuple element AST");
                const bool spread_element =
                    string_field(element, "kind", "tuple element AST") == "spread_element";
                vf::JsonValue lowered_item = lower_expr(
                    spread_element ? field(element, "expr", "spread element") : elements[i], env);
                const std::string item_type = string_field(lowered_item.as_object(), "type", "tuple item");
                if (i > 0) {
                    tuple_type += ",";
                }
                tuple_type += spread_element ? "any" : item_type;
                if (spread_element) {
                    auto spread = node("spread");
                    spread["value"] = lowered_item;
                    spread["type"] = vf::JsonValue(item_type);
                    items.emplace_back(std::move(spread));
                } else {
                    items.push_back(std::move(lowered_item));
                }
            }
            tuple_type += ">";
            if (!items.empty()) {
                std::string represented = "tuple<";
                bool all_type_values = true;
                for (std::size_t index = 0; index < items.size(); ++index) {
                    const std::string item_type = string_field(
                        items[index].as_object(), "type", "tuple type item");
                    if (!starts_with(item_type, "type<") || item_type.back() != '>') {
                        all_type_values = false;
                        break;
                    }
                    if (index != 0) represented += ",";
                    represented += item_type.substr(5, item_type.size() - 6);
                }
                if (all_type_values) return type_const(represented + ">");
            }
            auto out = node("tuple");
            out["items"] = vf::JsonValue(std::move(items));
            out["type"] = vf::JsonValue(tuple_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "multiset_literal") {
            const auto& pairs = array_of(field(object, "pairs", "multiset_literal"), "multiset_literal.pairs");
            vf::JsonValue::Array lowered_pairs;
            std::string element_type = "any";
            bool first = true;
            bool implicit_type_key = false;
            for (const auto& pair_value : pairs) {
                const auto& pair_object = object_of(pair_value, "multiset_pair");
                vf::JsonValue lowered_count = lower_expr(field(pair_object, "count", "multiset_pair"), env);
                const auto& raw_key = field(pair_object, "key", "multiset_pair");
                const auto& raw_key_object = object_of(raw_key, "multiset key");
                if (string_field(raw_key_object, "kind", "multiset key") == "range_expr") {
                    vf::JsonValue materialized;
                    if (!try_fold_range_expr(raw_key_object, materialized)) {
                        throw IRFailure(
                            "runtime range materialization in multisets is not yet supported");
                    }
                    for (const auto& range_key : array_of(
                            field(materialized.as_object(), "items", "range multiset"),
                            "range multiset.items")) {
                        const std::string range_key_type = string_field(
                            range_key.as_object(), "type", "range multiset key");
                        if (first) {
                            element_type = range_key_type;
                            first = false;
                        } else if (element_type != range_key_type) {
                            throw IRFailure("multiset values require one exact element type");
                        }
                        auto lowered_pair = node("multiset_pair");
                        lowered_pair["key"] = range_key;
                        lowered_pair["count"] = lowered_count;
                        lowered_pairs.push_back(vf::JsonValue(std::move(lowered_pair)));
                    }
                    continue;
                }
                vf::JsonValue lowered_key = lower_expr(raw_key, env);
                const std::string raw_key_type = string_field(
                    lowered_key.as_object(), "type", "multiset key");
                const bool key_is_type = starts_with(raw_key_type, "type<") &&
                    raw_key_type.back() == '>';
                const auto explicit_count = pair_object.find("explicit_count");
                const bool counted = explicit_count != pair_object.end() &&
                    explicit_count->second.is_boolean() &&
                    explicit_count->second.as_boolean();
                if (key_is_type && !counted) implicit_type_key = true;
                const std::string key_type = key_is_type ? "type" : raw_key_type;
                if (first) {
                    element_type = key_type;
                    first = false;
                } else if (element_type != key_type) {
                    throw IRFailure("multiset values require one exact element type");
                }
                auto lowered_pair = node("multiset_pair");
                lowered_pair["key"] = std::move(lowered_key);
                lowered_pair["count"] = std::move(lowered_count);
                lowered_pairs.push_back(vf::JsonValue(std::move(lowered_pair)));
            }
            if (implicit_type_key) {
                if (pairs.size() != 1) {
                    throw IRFailure("multiset type literal requires exactly one element type");
                }
                const auto& key = object_of(
                    field(lowered_pairs.front().as_object(), "key", "multiset type key"),
                    "multiset type key");
                const std::string key_type = string_field(key, "type", "multiset type key");
                return type_const(
                    "multiset<" + key_type.substr(5, key_type.size() - 6) + ">");
            }
            auto out = node("multiset");
            out["pairs"] = vf::JsonValue(std::move(lowered_pairs));
            out["element_type"] = vf::JsonValue(element_type == "type" ? "str" : element_type);
            out["type"] = vf::JsonValue("multiset<" + element_type + ">");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "record_literal" || kind == "struct_literal") {
            const auto& fields = array_of(field(object, "fields", kind), kind + ".fields");
            vf::JsonValue::Array lowered_fields;
            std::string record_type = "record{";
            for (std::size_t i = 0; i < fields.size(); ++i) {
                const auto& field_object = object_of(fields[i], "record field");
                const std::string field_name = string_field(field_object, "name", "record field");
                vf::JsonValue lowered_value = lower_expr(field(field_object, "value", "record field"), env);
                const std::string value_type = string_field(lowered_value.as_object(), "type", "record field value");
                if (i > 0) {
                    record_type += ",";
                }
                record_type += field_name + ":" + value_type;
                auto lowered_field = node("field");
                lowered_field["name"] = vf::JsonValue(field_name);
                lowered_field["type"] = vf::JsonValue(value_type);
                lowered_field["value"] = std::move(lowered_value);
                lowered_fields.push_back(vf::JsonValue(std::move(lowered_field)));
            }
            record_type += "}";
            auto out = node("record");
            out["fields"] = vf::JsonValue(std::move(lowered_fields));
            out["type"] = vf::JsonValue(record_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "attribute") {
            const auto& object_ast = object_of(field(object, "object", "attribute"), "attribute object AST");
            if (string_field(object_ast, "kind", "attribute object AST") == "identifier") {
                const std::string module_name = string_field(object_ast, "name", "attribute object AST");
                const std::string field_name = string_field(object, "name", "attribute");
                const auto imported = imported_modules_.find(module_name);
                const std::string canonical_module = imported == imported_modules_.end()
                    ? module_name : imported->second;
                const bool module_reference =
                    imported != imported_modules_.end() || !env.contains(module_name);
                if (module_reference && canonical_module == "errors") {
                    return error_type_value(field_name);
                }
                if (module_reference && canonical_module == "math") {
                    if (field_name == "pi") {
                        return num_const(3.141592653589793);
                    }
                    if (field_name == "e") {
                        return num_const(2.718281828459045);
                    }
                    if (field_name == "tau") {
                        return num_const(6.283185307179586);
                    }
                    if (field_name == "abs" || field_name == "sqrt" ||
                        field_name == "sin" || field_name == "cos" || field_name == "exp" ||
                        field_name == "ln") {
                        return stdlib_function("math", field_name);
                    }
                    throw IRFailure("unknown stdlib math member " + field_name);
                }
                if (module_reference && canonical_module == "stat") {
                    if (field_name == "mean"
                        || field_name == "sum"
                        || field_name == "variance"
                        || field_name == "std"
                        || field_name == "median"
                        || field_name == "iqr"
                        || field_name == "zscore"
                        || field_name == "normalize"
                        || field_name == "covariance"
                        || field_name == "correlation"
                        || field_name == "range"
                        || field_name == "count") {
                        return stdlib_function("stat", field_name);
                    }
                    throw IRFailure("unknown stdlib stat member " + field_name);
                }
                if (module_reference && canonical_module == "time") {
                    if (field_name == "monotonic_seconds" || field_name == "wall_seconds" ||
                        field_name == "sleep_seconds" || field_name == "local_parts") {
                        return stdlib_function("time", field_name);
                    }
                    throw IRFailure("unknown stdlib time member " + field_name);
                }
                if (module_reference && canonical_module == "collections") {
                    if (field_name == "map" || field_name == "list" || field_name == "queue") {
                        return stdlib_function("collections", field_name);
                    }
                    throw IRFailure("unknown stdlib collections member " + field_name);
                }
                if (module_reference && canonical_module == "data") {
                    if (field_name == "load") {
                        return stdlib_function("data", field_name);
                    }
                    throw IRFailure("unknown stdlib data member " + field_name);
                }
                if (module_reference && canonical_module == "io") {
                    if (field_name == "print" || field_name == "eprint" ||
                        field_name == "read_line" || field_name == "read_text" ||
                        field_name == "write_text" || field_name == "read_bytes" ||
                        field_name == "write_bytes" || field_name == "append_text") {
                        return stdlib_function("io", field_name);
                    }
                    throw IRFailure("unknown stdlib io member " + field_name);
                }
                if (module_reference && canonical_module == "system") {
                    if (field_name == "os_name" || field_name == "arch_name" ||
                        field_name == "cpu_count_native" || field_name == "cwd_native" ||
                        field_name == "env_native") {
                        return stdlib_function("system", field_name);
                    }
                    throw IRFailure("unknown stdlib system member " + field_name);
                }
                if (module_reference && canonical_module == "process") {
                    if (field_name == "run_native" || field_name == "shell_native") {
                        return stdlib_function("process", field_name);
                    }
                    throw IRFailure("unknown stdlib process member " + field_name);
                }
                if (module_reference && canonical_module == "regex") {
                    if (field_name == "match" || field_name == "groups") {
                        return stdlib_function("regex", field_name);
                    }
                    throw IRFailure("unknown stdlib regex member " + field_name);
                }
            }
            vf::JsonValue object_ir = lower_expr(field(object, "object", "attribute"), env);
            const std::string object_type = string_field(object_ir.as_object(), "type", "attribute object");
            std::string structural_object_type = resolve_type_alias(object_type);
            const auto nominal_representation = nominal_representations_.find(object_type);
            if (nominal_representation != nominal_representations_.end()) {
                structural_object_type = resolve_type_alias(nominal_representation->second);
            }
            const std::string field_name = string_field(object, "name", "attribute");
            const bool vector_object = starts_with(object_type, "list<") ||
                (object_type.size() >= 2 && object_type.front() == '[' && object_type.back() == ']');
            const bool length_object = vector_object || symbolic_expression_type(object_type);
            if (vector_object && (field_name == "shape" || field_name == "ndim")) {
                const auto dimensions = fixed_rectangular_vector_dimensions(object_type);
                if (!dimensions) {
                    throw IRFailure(
                        "vector " + field_name + " requires a fixed rectangular vector");
                }
                if (field_name == "ndim") {
                    auto rank = node("const");
                    rank["type"] = vf::JsonValue("int");
                    rank["value"] = vf::JsonValue(
                        static_cast<double>(dimensions->size()));
                    return vf::JsonValue(std::move(rank));
                }
                vf::JsonValue::Array items;
                items.reserve(dimensions->size());
                for (const auto dimension : *dimensions) {
                    auto value = node("const");
                    value["type"] = vf::JsonValue("int");
                    value["value"] = vf::JsonValue(static_cast<double>(dimension));
                    items.emplace_back(std::move(value));
                }
                auto shape = node("list");
                shape["element_type"] = vf::JsonValue("int");
                shape["items"] = vf::JsonValue(std::move(items));
                shape["type"] = vf::JsonValue(
                    "[int:" + std::to_string(dimensions->size()) + "]");
                return vf::JsonValue(std::move(shape));
            }
            if (vector_object && field_name != "length") {
                throw IRFailure(
                    "vector member " + field_name + " is not an index; use .(" +
                    field_name + ") to evaluate it");
            }
            auto out = node("field_access");
            out["field"] = vf::JsonValue(field_name);
            out["object"] = std::move(object_ir);
            out["object_type"] = vf::JsonValue(object_type);
            out["type"] = vf::JsonValue(
                length_object && field_name == "length"
                ? "fn()->int"
                : field_type_from_record(structural_object_type, field_name));
            return vf::JsonValue(std::move(out));
        }
        if (kind == "dotted_index") {
            vf::JsonValue base = lower_expr(field(object, "base", "dotted_index"), env);
            std::string result_type = string_field(base.as_object(), "type", "dotted_index.base");
            std::string structural_type = resolve_type_alias(result_type);
            const auto nominal_representation = nominal_representations_.find(result_type);
            if (nominal_representation != nominal_representations_.end()) {
                structural_type = resolve_type_alias(nominal_representation->second);
            }
            const bool structural_record = starts_with(structural_type, "record{") &&
                !structural_type.empty() && structural_type.back() == '}';
            const auto structural_fields = ordered_record_type_fields(structural_type);
            const auto& raw_indices = array_of(
                field(object, "indices", "dotted_index"), "dotted_index.indices");
            if (structural_record && raw_indices.size() == 1) {
                vf::JsonValue selector = lower_expr(raw_indices.front(), env);
                const auto& selector_object = selector.as_object();
                const std::string selector_kind = string_field(
                    selector_object, "kind", "record selector");
                const auto dot_overload = [&]() -> const FunctionInfo* {
                    if (const auto* exact = functions_.get(".", {result_type, "str"})) {
                        return exact;
                    }
                    if (nominal_representation != nominal_representations_.end()) {
                        return nullptr;
                    }
                    const FunctionInfo* match = nullptr;
                    for (const auto* candidate : functions_.family(".")) {
                        if (candidate->param_types.size() != 2 ||
                            !structurally_compatible_type(
                                structural_type,
                                resolve_type_alias(candidate->param_types[0])) ||
                            !structurally_compatible_type(
                                "str", resolve_type_alias(candidate->param_types[1]))) continue;
                        if (match != nullptr) return nullptr;
                        match = candidate;
                    }
                    return match;
                }();
                const auto make_dot_call = [&](vf::JsonValue subject,
                                               vf::JsonValue key,
                                               const FunctionInfo& function) {
                    auto call = node("call");
                    call["args"] = vf::JsonValue(vf::JsonValue::Array{
                        std::move(subject), std::move(key)});
                    call["arg_types"] = vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue(result_type), vf::JsonValue("str")});
                    call["named_args"] = vf::JsonValue(vf::JsonValue::Array{});
                    call["spread_args"] = vf::JsonValue(vf::JsonValue::Array{});
                    auto callee = node("load");
                    callee["name"] = vf::JsonValue(functions_.runtime_name(function));
                    callee["type"] = vf::JsonValue(function.signature);
                    call["callee"] = vf::JsonValue(std::move(callee));
                    call["callee_type"] = vf::JsonValue(function.signature);
                    call["type"] = vf::JsonValue(function.return_type);
                    return vf::JsonValue(std::move(call));
                };
                const auto common_result_type = [&](const auto& fields) {
                    if (fields.empty()) return std::string("any");
                    std::string common = resolve_type_alias(fields.front().second);
                    for (auto candidate = fields.begin() + 1; candidate != fields.end(); ++candidate) {
                        const std::string type = resolve_type_alias(candidate->second);
                        if (type_name_coercible(type, common)) continue;
                        if (type_name_coercible(common, type)) {
                            common = type;
                            continue;
                        }
                        return std::string("any");
                    }
                    return common;
                };
                const auto fixed_selector_items = [&]() {
                    vf::JsonValue::Array items;
                    if (selector_kind == "list") {
                        for (const auto& item : array_of(
                                 field(selector_object, "items", "record selector"),
                                 "record selector items")) {
                            items.push_back(item);
                        }
                    }
                    return items;
                }();
                const auto selector_value = selector_object.find("value");
                if (selector_kind == "const" && selector_value != selector_object.end() &&
                    selector_value->second.is_string()) {
                    const std::string key = selector_value->second.as_string();
                    const auto selected = std::find_if(
                        structural_fields.begin(), structural_fields.end(),
                        [&](const auto& candidate) { return candidate.first == key; });
                    if (selected == structural_fields.end()) {
                        if (dot_overload == nullptr) {
                            throw IRFailure("unknown record selector key " + key);
                        }
                        return make_dot_call(std::move(base), selector, *dot_overload);
                    }
                    auto access = node("field_access");
                    access["field"] = vf::JsonValue(key);
                    access["object"] = std::move(base);
                    access["object_type"] = vf::JsonValue(result_type);
                    access["type"] = vf::JsonValue(resolve_type_alias(selected->second));
                    return vf::JsonValue(std::move(access));
                }
                if (!fixed_selector_items.empty()) {
                    struct FixedSelectorLane {
                        std::string key;
                        std::string type;
                        bool uses_fallback = false;
                    };
                    std::vector<FixedSelectorLane> selected_fields;
                    bool fixed_string_selector = true;
                    for (const auto& selector_item_value : fixed_selector_items) {
                        const auto& selector_item = object_of(
                            selector_item_value, "record selector item");
                        const auto value = selector_item.find("value");
                        if (string_field(
                                selector_item, "kind", "record selector item") != "const" ||
                            value == selector_item.end() || !value->second.is_string()) {
                            fixed_string_selector = false;
                            break;
                        }
                        const std::string key = value->second.as_string();
                        const auto selected = std::find_if(
                            structural_fields.begin(), structural_fields.end(),
                            [&](const auto& field) { return field.first == key; });
                        if (selected == structural_fields.end()) {
                            if (dot_overload == nullptr) {
                                throw IRFailure("unknown record selector key " + key);
                            }
                            selected_fields.push_back({
                                key, resolve_type_alias(dot_overload->return_type), true});
                            continue;
                        }
                        selected_fields.push_back({
                            selected->first, resolve_type_alias(selected->second), false});
                    }
                    if (fixed_string_selector && !selected_fields.empty()) {
                        std::vector<std::pair<std::string, std::string>> selected_types;
                        selected_types.reserve(selected_fields.size());
                        for (const auto& selected : selected_fields) {
                            selected_types.emplace_back(selected.key, selected.type);
                        }
                        const std::string common_type = common_result_type(selected_types);
                        const bool homogeneous = common_type != "any";
                        const auto aggregate_type = [&]() {
                            if (homogeneous) {
                                return "[" + common_type +
                                    ":" + std::to_string(selected_fields.size()) + "]";
                            }
                            std::string type = "tuple<";
                            for (std::size_t index = 0; index < selected_fields.size(); ++index) {
                                if (index != 0) type += ",";
                                type += selected_fields[index].type;
                            }
                            return type + ">";
                        }();
                        const auto make_aggregate = [&](const vf::JsonValue& subject) {
                            vf::JsonValue::Array items;
                            for (const auto& selected : selected_fields) {
                                vf::JsonValue value;
                                if (selected.uses_fallback) {
                                    auto key = node("const");
                                    key["type"] = vf::JsonValue("str");
                                    key["value"] = vf::JsonValue(selected.key);
                                    value = make_dot_call(
                                        subject, vf::JsonValue(std::move(key)), *dot_overload);
                                } else {
                                    auto access = node("field_access");
                                    access["field"] = vf::JsonValue(selected.key);
                                    access["object"] = subject;
                                    access["object_type"] = vf::JsonValue(result_type);
                                    access["type"] = vf::JsonValue(selected.type);
                                    value = vf::JsonValue(std::move(access));
                                }
                                if (homogeneous) {
                                    value = coerce_value_to_type(
                                        std::move(value), common_type, "record selector field");
                                }
                                items.emplace_back(std::move(value));
                            }
                            auto aggregate = node(homogeneous ? "list" : "tuple");
                            aggregate["items"] = vf::JsonValue(std::move(items));
                            if (homogeneous) {
                                aggregate["element_type"] = vf::JsonValue(
                                    common_type);
                            }
                            aggregate["type"] = vf::JsonValue(aggregate_type);
                            return vf::JsonValue(std::move(aggregate));
                        };
                        if (string_field(base.as_object(), "kind", "record selector base") == "load" ||
                            selected_fields.size() == 1) {
                            return make_aggregate(base);
                        }
                        const std::string subject_name = "$record_select$" +
                            std::to_string(next_lambda_local_++);
                        auto binding = node("store_binding");
                        binding["name"] = vf::JsonValue(subject_name);
                        binding["type"] = vf::JsonValue(result_type);
                        binding["update"] = vf::JsonValue(false);
                        binding["value"] = std::move(base);
                        auto subject = node("load");
                        subject["name"] = vf::JsonValue(subject_name);
                        subject["type"] = vf::JsonValue(result_type);
                        auto tail = node("expr_stmt");
                        tail["expr"] = make_aggregate(vf::JsonValue(std::move(subject)));
                        auto block = node("block_expr");
                        block["body"] = vf::JsonValue(vf::JsonValue::Array{
                            vf::JsonValue(std::move(binding)), vf::JsonValue(std::move(tail))});
                        block["type"] = vf::JsonValue(aggregate_type);
                        return vf::JsonValue(std::move(block));
                    }
                }
                const std::string selector_type = string_field(
                    selector_object, "type", "record selector");
                if (selector_type == "str" && selector_kind != "const") {
                    if (structural_fields.empty() && dot_overload == nullptr) {
                        throw IRFailure(
                            "dynamic record selector requires one compatible result type");
                    }
                    auto dynamic_result_fields = structural_fields;
                    if (dot_overload != nullptr) {
                        dynamic_result_fields.emplace_back(
                            "$missing", dot_overload->return_type);
                    }
                    const std::string common_type = common_result_type(dynamic_result_fields);
                    if (common_type == "any") {
                        throw IRFailure(dot_overload == nullptr
                            ? "dynamic record selector requires one compatible result type"
                            : "dynamic record selector and dot overload require one compatible result type");
                    }
                    const auto make_selector = [&](vf::JsonValue subject) {
                        vf::JsonValue::Array fields;
                        for (const auto& candidate : structural_fields) {
                            vf::JsonValue::Object descriptor;
                            descriptor["name"] = vf::JsonValue(candidate.first);
                            descriptor["type"] = vf::JsonValue(
                                resolve_type_alias(candidate.second));
                            fields.emplace_back(std::move(descriptor));
                        }
                        auto out = node("record_selector");
                        out["base"] = std::move(subject);
                        out["selector"] = selector;
                        out["fields"] = vf::JsonValue(std::move(fields));
                        if (dot_overload != nullptr) {
                            out["fallback_symbol"] = vf::JsonValue(
                                functions_.runtime_name(*dot_overload));
                        }
                        out["type"] = vf::JsonValue(common_type);
                        return vf::JsonValue(std::move(out));
                    };
                    if (string_field(base.as_object(), "kind", "record selector base") == "load") {
                        return make_selector(std::move(base));
                    }
                    const std::string subject_name = "$record_select$" +
                        std::to_string(next_lambda_local_++);
                    auto binding = node("store_binding");
                    binding["name"] = vf::JsonValue(subject_name);
                    binding["type"] = vf::JsonValue(result_type);
                    binding["update"] = vf::JsonValue(false);
                    binding["value"] = std::move(base);
                    auto subject = node("load");
                    subject["name"] = vf::JsonValue(subject_name);
                    subject["type"] = vf::JsonValue(result_type);
                    auto tail = node("expr_stmt");
                    tail["expr"] = make_selector(vf::JsonValue(std::move(subject)));
                    auto block = node("block_expr");
                    block["body"] = vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue(std::move(binding)), vf::JsonValue(std::move(tail))});
                    block["type"] = vf::JsonValue(common_type);
                    return vf::JsonValue(std::move(block));
                }
            }
            const auto base_shape = fixed_numeric_vector_shape(result_type);
            vf::JsonValue::Array current_indices;
            std::optional<FixedNumericVectorShape> broadcast_index_shape;
            std::optional<std::string> broadcast_index_type;
            std::size_t expanded_index_count = 0;
            const auto descend_result_type = [&]() {
                if (symbolic_expression_type(result_type)) {
                    result_type = "num";
                } else if (starts_with(result_type, "list<") && result_type.back() == '>') {
                    result_type = result_type.substr(5, result_type.size() - 6);
                } else if (result_type.size() >= 2 && result_type.front() == '[' && result_type.back() == ']') {
                    const std::string inner = result_type.substr(1, result_type.size() - 2);
                    const auto shape = inner.rfind(':');
                    result_type = shape == std::string::npos ? inner : inner.substr(0, shape);
                } else {
                    result_type = "any";
                }
            };
            for (const auto& index_ast : array_of(field(object, "indices", "dotted_index"), "dotted_index.indices")) {
                const auto& index_object = object_of(index_ast, "dotted_index.index");
                const std::string index_kind = string_field(
                    index_object, "kind", "dotted_index.index");
                if (index_kind == "spread_arg") {
                    vf::JsonValue spread_value = lower_expr(
                        field(index_object, "expr", "dotted_index spread"), env);
                    const std::string spread_type = string_field(
                        spread_value.as_object(), "type", "dotted_index spread");
                    const auto spread_shape = fixed_numeric_vector_shape(spread_type);
                    if (!spread_shape.has_value() || spread_shape->dimensions.size() != 1) {
                        throw IRFailure(
                            "multidimensional index spill requires one fixed vector of numeric coordinates");
                    }
                    auto spread = node("spread_index");
                    spread["value"] = std::move(spread_value);
                    spread["count"] = vf::JsonValue(
                        static_cast<double>(spread_shape->dimensions.front()));
                    spread["type"] = vf::JsonValue(spread_type);
                    current_indices.emplace_back(std::move(spread));
                    expanded_index_count += spread_shape->dimensions.front();
                    for (std::size_t index = 0; index < spread_shape->dimensions.front(); ++index) {
                        descend_result_type();
                    }
                    continue;
                }
                if (index_kind == "named_call_arg") {
                    throw IRFailure("multidimensional indices do not accept named arguments");
                }
                vf::JsonValue lowered_index = lower_expr(index_ast, env);
                const std::string index_type = string_field(
                    lowered_index.as_object(), "type", "dotted_index.index");
                if (const auto index_shape = fixed_numeric_vector_shape(index_type)) {
                    if (broadcast_index_shape.has_value() &&
                        broadcast_index_shape->dimensions != index_shape->dimensions) {
                        throw IRFailure(
                            "distributed multidimensional index vectors must have matching shapes");
                    }
                    if (!broadcast_index_shape.has_value()) {
                        broadcast_index_type = index_type;
                    }
                    broadcast_index_shape = *index_shape;
                } else if (vector_type_parts(index_type).has_value()) {
                    throw IRFailure(
                        "multidimensional vector index must contain a fixed multivec of numeric indices");
                }
                current_indices.push_back(std::move(lowered_index));
                ++expanded_index_count;
                descend_result_type();
            }
            if (broadcast_index_shape.has_value()) {
                result_type = structurally_lifted_result_type(
                    *broadcast_index_type,
                    broadcast_index_shape->leaf_type,
                    result_type);
            }
            vf::JsonValue::Array indices;
            bool nested_index = base_shape.has_value() &&
                base_shape->dimensions.size() > 1 &&
                base_shape->dimensions.size() == expanded_index_count;
            if (string_field(base.as_object(), "kind", "dotted_index.base") == "dotted_index") {
                const auto dynamic_index = [](const vf::JsonValue& value) {
                    return !value.is_object() || value.as_object().find("value") == value.as_object().end();
                };
                const auto& nested = base.as_object().at("indices").as_array();
                nested_index = nested_index ||
                    std::any_of(nested.begin(), nested.end(), dynamic_index) ||
                    std::any_of(current_indices.begin(), current_indices.end(), dynamic_index);
                if (nested_index) {
                    const auto nested_expanded = base.as_object().find("expanded_index_count");
                    expanded_index_count += nested_expanded != base.as_object().end() &&
                            nested_expanded->second.is_number()
                        ? static_cast<std::size_t>(nested_expanded->second.as_number())
                        : nested.size();
                    auto nested_indices = std::move(base.as_object().at("indices").as_array());
                    for (auto& index : nested_indices) indices.push_back(std::move(index));
                    vf::JsonValue nested_base = std::move(base.as_object().at("base"));
                    base = std::move(nested_base);
                }
            }
            for (auto& index : current_indices) indices.push_back(std::move(index));
            auto out = node("dotted_index");
            out["base"] = std::move(base);
            out["indices"] = vf::JsonValue(std::move(indices));
            out["type"] = vf::JsonValue(result_type);
            out["expanded_index_count"] = vf::JsonValue(
                static_cast<double>(expanded_index_count));
            if (nested_index) out["nested_index"] = vf::JsonValue(true);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "match_stmt") {
            vf::JsonValue discriminant = lower_expr(field(object, "discriminant", "match_stmt"), env);
            const auto& catch_value = field(object, "catch", "match_stmt");
            const bool catch_errors = catch_value.is_boolean() && catch_value.as_boolean();
            const auto& loop_value = field(object, "loop", "match_stmt");
            const bool repeats = loop_value.is_boolean() && loop_value.as_boolean();
            const auto& discriminant_object = object_of(discriminant, "match_stmt discriminant");
            const bool owner_event_binding = repeats && !catch_errors &&
                string_field(discriminant_object, "kind", "match_stmt discriminant") == "bind_expr" &&
                field(discriminant_object, "value", "match_stmt discriminant").is_object() &&
                string_field(
                    object_of(field(discriminant_object, "value", "match_stmt discriminant"),
                              "match_stmt discriminant value"),
                    "kind", "match_stmt discriminant value") == "ui_owner_event_get";
            if (owner_event_binding) {
                const std::string binding = string_field(
                    discriminant_object, "name", "owner event loop binding");
                bool supported = true;
                for (const auto& arm_value : array_of(
                         field(object, "arms", "match_stmt"), "match_stmt.arms")) {
                    const auto& arm = object_of(arm_value, "match arm");
                    const vf::JsonValue& condition = field(arm, "condition", "match arm");
                    if (!condition.is_object() ||
                        string_field(object_of(condition, "match arm condition"),
                                     "kind", "match arm condition") != "identifier") {
                        supported = false;
                        continue;
                    }
                    const std::string event_type = string_field(
                        object_of(condition, "match arm condition"),
                        "name", "match arm condition");
                    supported = supported &&
                        (event_type == "ButtonEvent" || event_type == "ButtonClicked" ||
                         event_type == "SliderEvent" || event_type == "SliderValueChanged");
                }
                if (supported) {
                    vf::JsonValue::Array arms;
                    for (const auto& arm_value : array_of(
                             field(object, "arms", "match_stmt"), "match_stmt.arms")) {
                        const auto& arm = object_of(arm_value, "match arm");
                        const std::string event_type = string_field(
                            object_of(field(arm, "condition", "match arm"),
                                      "match arm condition"),
                            "name", "match arm condition");
                        auto lowered_arm = node("ui_owner_event_arm");
                        lowered_arm["event_type"] = vf::JsonValue(event_type);
                        const vf::JsonValue& body_ast = field(arm, "body", "match arm");
                        TypeEnv body_env = env;
                        body_env.begin_scope();
                        body_env.set(binding, event_type);
                        lowered_arm["body"] = kind_of(body_ast) == "block"
                            ? lower_body(body_ast, body_env)
                            : lower_expr(body_ast, body_env);
                        arms.emplace_back(std::move(lowered_arm));
                    }
                    auto out = node("ui_owner_event_loop");
                    out["binding"] = vf::JsonValue(binding);
                    out["poll"] = field(
                        discriminant_object, "value", "owner event loop poll");
                    out["arms"] = vf::JsonValue(std::move(arms));
                    out["type"] = vf::JsonValue("any");
                    return vf::JsonValue(std::move(out));
                }
                throw IRFailure(
                    "owner event loop currently supports ButtonEvent, ButtonClicked, "
                    "SliderEvent, and SliderValueChanged branches");
            }
            vf::JsonValue::Array arms;
            for (const auto& arm_value : array_of(field(object, "arms", "match_stmt"), "match_stmt.arms")) {
                const auto& arm = object_of(arm_value, "match arm");
                auto lowered_arm = node("match_arm");
                const vf::JsonValue& cond_ast = field(arm, "condition", "match arm");
                lowered_arm["condition"] = cond_ast.is_null() ? vf::JsonValue(nullptr) : lower_expr(cond_ast, env);
                const vf::JsonValue& body_ast = field(arm, "body", "match arm");
                TypeEnv body_env = env;
                body_env.begin_scope();
                if (catch_errors) body_env.set("$", "record{message:str}");
                if (kind_of(body_ast) == "block") {
                    lowered_arm["body"] = lower_body(body_ast, body_env);
                } else {
                    lowered_arm["body"] = lower_expr(body_ast, body_env);
                }
                arms.push_back(vf::JsonValue(std::move(lowered_arm)));
            }
            auto out = node("match_stmt");
            out["discriminant"] = std::move(discriminant);
            out["arms"] = vf::JsonValue(std::move(arms));
            out["loop"] = loop_value;
            out["catch"] = catch_value;
            out["type"] = vf::JsonValue("any");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "struct_identity") {
            auto out = node("scope_identity");
            std::string type = "record{";
            bool first = true;
            for (const auto& binding : env.bindings()) {
                if (binding.name == "$return" || starts_with(binding.type, "fn(")) continue;
                if (!first) type += ",";
                first = false;
                type += binding.name + ":" + binding.type;
            }
            type += "}";
            out["type"] = vf::JsonValue(type);
            return vf::JsonValue(std::move(out));
        }
        throw IRFailure("unsupported AST kind " + kind);
    }

    static void rename_lambda_loads(
        vf::JsonValue& value,
        const std::map<std::string, std::string>& renamed
    ) {
        if (value.is_array()) {
            for (auto& item : value.as_array()) rename_lambda_loads(item, renamed);
            return;
        }
        if (!value.is_object()) return;
        auto& object = value.as_object();
        const auto kind = object.find("kind");
        const auto name = object.find("name");
        if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "load" &&
            name != object.end() && name->second.is_string()) {
            const auto replacement = renamed.find(name->second.as_string());
            if (replacement != renamed.end()) name->second = vf::JsonValue(replacement->second);
        }
        for (auto& [field_name, child] : object) {
            (void)field_name;
            rename_lambda_loads(child, renamed);
        }
    }

    static std::string binary_result_type(
        const std::string& op,
        const std::string& left_type,
        const std::string& right_type
    ) {
        std::string left_axis;
        std::string left_value_type;
        std::string right_axis;
        std::string right_value_type;
        const bool left_is_axis = parse_axis_tagged_type(left_type, left_axis, left_value_type);
        const bool right_is_axis = parse_axis_tagged_type(right_type, right_axis, right_value_type);
        const auto left_dimension = vkf::physical::parse_dimension_type(left_type);
        const auto right_dimension = vkf::physical::parse_dimension_type(right_type);
        const auto numeric_scalar = [](const std::string& type) {
            return type == "int" || type == "num" || type == "f32" || type == "f64";
        };
        if (left_dimension || right_dimension) {
            if (op == "EQ" || op == "EXACT_EQ" || op == "NEQ"
                || op == "LT" || op == "LE" || op == "GT" || op == "GE") {
                return "bit";
            }
            if ((op == "PLUS" || op == "MINUS")
                && left_dimension && right_dimension && *left_dimension == *right_dimension) {
                return vkf::physical::quantity_type(*left_dimension);
            }
            if (op == "STAR") {
                if (left_dimension && right_dimension) {
                    return vkf::physical::quantity_type(
                        vkf::physical::add(*left_dimension, *right_dimension));
                }
                if (left_dimension && numeric_scalar(right_type)) {
                    return vkf::physical::quantity_type(*left_dimension);
                }
                if (right_dimension && numeric_scalar(left_type)) {
                    return vkf::physical::quantity_type(*right_dimension);
                }
            }
            if (op == "SLASH") {
                if (left_dimension && right_dimension) {
                    return vkf::physical::quantity_type(
                        vkf::physical::subtract(*left_dimension, *right_dimension));
                }
                if (left_dimension && numeric_scalar(right_type)) {
                    return vkf::physical::quantity_type(*left_dimension);
                }
                if (right_dimension && numeric_scalar(left_type)) {
                    return vkf::physical::quantity_type(
                        vkf::physical::subtract(vkf::physical::Dimension{}, *right_dimension));
                }
            }
            return "any";
        }
        if (symbolic_expression_type(left_type) || symbolic_expression_type(right_type)) {
            if (op == "IMPLIES") return "proposition";
            if (op == "EQ" || op == "LT" || op == "LE" || op == "GT" || op == "GE") {
                return "relation";
            }
            return "expression";
        }
        if (left_is_axis && right_is_axis) {
            if (left_axis == right_axis) {
                return axis_tagged_type(left_axis, binary_result_type(op, left_value_type, right_value_type));
            }
            const bool left_is_vector =
                starts_with(left_value_type, "list<") || vector_type_parts(left_value_type).has_value();
            const bool right_is_vector =
                starts_with(right_value_type, "list<") || vector_type_parts(right_value_type).has_value();
            if ((op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH")
                && left_is_vector && right_is_vector) {
                const auto outer_value_type = [&](const auto& self,
                                                  const std::string& left_value,
                                                  const std::string& right_value) -> std::string {
                    if (const auto left_vector = vector_type_parts(left_value)) {
                        return "[" + self(self, left_vector->element, right_value) +
                            (left_vector->shape.empty() ? "" : ":" + left_vector->shape) + "]";
                    }
                    if (starts_with(left_value, "list<") && left_value.back() == '>') {
                        return "list<" + self(
                            self,
                            left_value.substr(5, left_value.size() - 6),
                            right_value) + ">";
                    }
                    if (const auto right_vector = vector_type_parts(right_value)) {
                        return "[" + self(self, left_value, right_vector->element) +
                            (right_vector->shape.empty() ? "" : ":" + right_vector->shape) + "]";
                    }
                    if (starts_with(right_value, "list<") && right_value.back() == '>') {
                        return "list<" + self(
                            self,
                            left_value,
                            right_value.substr(5, right_value.size() - 6)) + ">";
                    }
                    return binary_result_type(op, left_value, right_value);
                };
                return axis_tagged_type(
                    left_axis + right_axis,
                    outer_value_type(outer_value_type, left_value_type, right_value_type));
            }
            return "any";
        }
        if (op == "EQ" || op == "EXACT_EQ" || op == "NEQ" || op == "STRUCT_NEQ"
            || op == "LT" || op == "LE" || op == "GT" || op == "GE"
            || op == "AND" || op == "OR" || op == "XOR" || op == "IMPLIES") {
            return "bit";
        }
        const auto multiset_element = [](const std::string& type) -> std::string {
            return starts_with(type, "multiset<") && type.back() == '>'
                ? type.substr(9, type.size() - 10) : std::string{};
        };
        const std::string left_multiset = multiset_element(left_type);
        const std::string right_multiset = multiset_element(right_type);
        if (!left_multiset.empty() && !right_multiset.empty() &&
            (op == "PLUS" || op == "AMPERSAND" || op == "MINUS" ||
             op == "FLOORDIV" || op == "PERCENT")) {
            std::string element = merge_nullable_type(left_multiset, right_multiset);
            if ((left_multiset == "int" && right_multiset == "num") ||
                (left_multiset == "num" && right_multiset == "int")) {
                element = "num";
            }
            return "multiset<" + element + ">";
        }
        const auto plain_numeric_scalar = [](const std::string& type) {
            return type == "int" || type == "num" || type == "f32" || type == "f64";
        };
        if (!left_multiset.empty() && plain_numeric_scalar(right_type) &&
            (op == "PLUS" || op == "MINUS" || op == "FLOORDIV")) {
            return left_type;
        }
        if (!right_multiset.empty() && plain_numeric_scalar(left_type) && op == "PLUS") {
            return right_type;
        }
        if (op == "AMPERSAND") {
            const auto empty_fixed_vector = [](const std::string& type) {
                return type.size() >= 5 && type.front() == '[' &&
                    type.compare(type.size() - 3, 3, ":0]") == 0;
            };
            if (empty_fixed_vector(left_type) && !dynamic_list_element_type(right_type).empty()) {
                return right_type;
            }
            if (empty_fixed_vector(right_type) && !dynamic_list_element_type(left_type).empty()) {
                return left_type;
            }
            const auto shaped_vector = [](const std::string& type,
                                          std::string& element,
                                          std::string& shape) {
                if (type.size() < 5 || type.front() != '[' || type.back() != ']') return false;
                const std::string inner = type.substr(1, type.size() - 2);
                const std::size_t separator = inner.rfind(':');
                if (separator == std::string::npos) return false;
                element = inner.substr(0, separator);
                shape = inner.substr(separator + 1);
                return !element.empty() && !shape.empty();
            };
            std::string left_shaped_element;
            std::string left_shape;
            std::string right_shaped_element;
            std::string right_shape;
            if (shaped_vector(left_type, left_shaped_element, left_shape) &&
                shaped_vector(right_type, right_shaped_element, right_shape)) {
                std::string element = merge_nullable_type(
                    left_shaped_element, right_shaped_element);
                if ((left_shaped_element == "int" && right_shaped_element == "num") ||
                    (left_shaped_element == "num" && right_shaped_element == "int")) {
                    element = "num";
                }
                const bool left_numeric = std::all_of(
                    left_shape.begin(), left_shape.end(), [](unsigned char ch) { return std::isdigit(ch); });
                const bool right_numeric = std::all_of(
                    right_shape.begin(), right_shape.end(), [](unsigned char ch) { return std::isdigit(ch); });
                const std::string result_shape = left_numeric && right_numeric
                    ? std::to_string(std::stoul(left_shape) + std::stoul(right_shape))
                    : left_shape + "+" + right_shape;
                return "[" + element + ":" + result_shape + "]";
            }
            const std::string left_element = dynamic_list_element_type(left_type);
            const std::string right_element = dynamic_list_element_type(right_type);
            if (shaped_vector(left_type, left_shaped_element, left_shape) &&
                !right_element.empty()) {
                if (type_name_coercible(left_shaped_element, right_element)) {
                    return right_type;
                }
                if (type_name_coercible(right_element, left_shaped_element)) {
                    return "list<" + left_shaped_element + ">";
                }
                return "list<any>";
            }
            if (!left_element.empty() &&
                shaped_vector(right_type, right_shaped_element, right_shape)) {
                if (type_name_coercible(right_shaped_element, left_element)) {
                    return left_type;
                }
                if (type_name_coercible(left_element, right_shaped_element)) {
                    return "list<" + right_shaped_element + ">";
                }
                return "list<any>";
            }
            if (!left_element.empty() && !right_element.empty()) {
                std::string element = merge_nullable_type(left_element, right_element);
                if ((left_element == "int" && right_element == "num") ||
                    (left_element == "num" && right_element == "int")) {
                    element = "num";
                }
                return "list<" + element + ">";
            }
            return "str";
        }
        if (op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH"
            || op == "FLOORDIV" || op == "PERCENT" || op == "CARET") {
            const auto left_vector = vector_type_parts(left_type);
            const auto right_vector = vector_type_parts(right_type);
            if (left_vector && right_vector) {
                if (left_vector->shape != right_vector->shape) return "any";
                return "[" + binary_result_type(
                    op, left_vector->element, right_vector->element) +
                    (left_vector->shape.empty() ? "" : ":" + left_vector->shape) + "]";
            }
            if (left_vector && plain_numeric_scalar(right_type)) {
                return "[" + binary_result_type(op, left_vector->element, right_type) +
                    (left_vector->shape.empty() ? "" : ":" + left_vector->shape) + "]";
            }
            if (right_vector && plain_numeric_scalar(left_type)) {
                return "[" + binary_result_type(op, left_type, right_vector->element) +
                    (right_vector->shape.empty() ? "" : ":" + right_vector->shape) + "]";
            }
            const std::string left_list = dynamic_list_element_type(left_type);
            const std::string right_list = dynamic_list_element_type(right_type);
            if (!left_list.empty() && !right_list.empty()) {
                return "list<" + binary_result_type(op, left_list, right_list) + ">";
            }
            if (!left_list.empty() && plain_numeric_scalar(right_type)) {
                return "list<" + binary_result_type(op, left_list, right_type) + ">";
            }
            if (!right_list.empty() && plain_numeric_scalar(left_type)) {
                return "list<" + binary_result_type(op, left_type, right_list) + ">";
            }
            if ((op == "PLUS" || op == "MINUS" || op == "STAR" || op == "FLOORDIV" || op == "PERCENT")
                && left_type == "int" && right_type == "int") {
                return "int";
            }
            if (plain_numeric_scalar(left_type) && plain_numeric_scalar(right_type)) {
                if (left_type == "f64" || right_type == "f64") return "f64";
                if (left_type == "f32" || right_type == "f32") return "f32";
                return "num";
            }
            return "any";
        }
        return "any";
    }

    static std::string function_signature_type(const std::vector<std::string>& params, const std::string& ret) {
        std::string out = "fn(";
        for (std::size_t i = 0; i < params.size(); ++i) {
            if (i > 0) {
                out += ",";
            }
            out += params[i];
        }
        out += ")->";
        out += ret;
        return out;
    }

    static std::optional<std::size_t> metatype_return_parameter(
        const FunctionInfo& function
    ) {
        const vf::JsonValue* result = &function.body_ast;
        if (result->is_null()) return std::nullopt;
        if (kind_of(*result) == "block") {
            const auto& statements = array_of(
                field(result->as_object(), "statements", "metatype return block"),
                "metatype return block");
            if (statements.empty()) return std::nullopt;
            result = &statements.back();
        }
        if (kind_of(*result) == "return") {
            result = &field(result->as_object(), "value", "metatype return");
        }
        if (kind_of(*result) != "call") return std::nullopt;
        const auto& callee = object_of(
            field(result->as_object(), "callee", "metatype return call"),
            "metatype return callee");
        if (string_field(callee, "kind", "metatype return callee") != "identifier") {
            return std::nullopt;
        }
        const std::string name = string_field(callee, "name", "metatype return callee");
        for (std::size_t index = 0; index < function.param_names.size() &&
             index < function.param_types.size(); ++index) {
            if (function.param_types[index] == "type" && function.param_names[index] == name) {
                return index;
            }
        }
        return std::nullopt;
    }

    static void substitute_symbolic_trace_arguments(
        vf::JsonValue& value,
        const std::map<std::string, vf::JsonValue>& replacements
    ) {
        if (value.is_array()) {
            for (auto& item : value.as_array()) substitute_symbolic_trace_arguments(item, replacements);
            return;
        }
        if (!value.is_object()) return;
        auto& object = value.as_object();
        const auto kind = object.find("kind");
        const auto name = object.find("name");
        if (kind != object.end() && kind->second.is_string() &&
            kind->second.as_string() == "identifier" && name != object.end() && name->second.is_string()) {
            const auto replacement = replacements.find(name->second.as_string());
            if (replacement != replacements.end()) {
                value = replacement->second;
                return;
            }
        }
        for (auto& [field_name, child] : object) {
            (void)field_name;
            substitute_symbolic_trace_arguments(child, replacements);
        }
    }

    void expand_bound_symbolic_expression_sources(
        vf::JsonValue& value,
        std::set<std::string>& expanding
    ) const {
        if (value.is_array()) {
            for (auto& item : value.as_array()) {
                expand_bound_symbolic_expression_sources(item, expanding);
            }
            return;
        }
        if (!value.is_object()) return;
        auto& object = value.as_object();
        const auto kind = object.find("kind");
        const auto name = object.find("name");
        if (kind != object.end() && kind->second.is_string() &&
            kind->second.as_string() == "identifier" && name != object.end() &&
            name->second.is_string()) {
            const std::string identifier = name->second.as_string();
            const auto source = symbolic_expression_sources_.find(identifier);
            if (source != symbolic_expression_sources_.end()) {
                if (!expanding.insert(identifier).second) {
                    throw IRFailure(
                        "cyclic symbolic expression source " + identifier
                    );
                }
                value = source->second;
                expand_bound_symbolic_expression_sources(value, expanding);
                expanding.erase(identifier);
                return;
            }
        }
        for (auto& [field_name, child] : object) {
            (void)field_name;
            expand_bound_symbolic_expression_sources(child, expanding);
        }
    }

    void validate_symbolic_analytic_domains(
        const vf::JsonValue& value,
        const std::string& operation
    ) const {
        if (value.is_array()) {
            for (const auto& item : value.as_array()) validate_symbolic_analytic_domains(item, operation);
            return;
        }
        if (!value.is_object()) return;
        const auto& object = value.as_object();
        const auto kind = object.find("kind");
        const auto name = object.find("name");
        if (kind != object.end() && kind->second.is_string() &&
            kind->second.as_string() == "identifier" && name != object.end() && name->second.is_string()) {
            const auto binding = symbolic_bindings_.find(name->second.as_string());
            if (binding != symbolic_bindings_.end() && binding->second.domain != "R" &&
                binding->second.domain != "C") {
                throw IRFailure(
                    "math." + operation + " requires symbolic domain R or C, received " +
                    binding->second.domain + " for " + name->second.as_string());
            }
        }
        for (const auto& [field_name, child] : object) {
            (void)field_name;
            validate_symbolic_analytic_domains(child, operation);
        }
    }

    bool symbolic_expression_is_fully_bound(
        const vf::JsonValue& value,
        const std::set<std::string>& parameters
    ) const {
        if (value.is_array()) {
            return std::all_of(value.as_array().begin(), value.as_array().end(), [&](const auto& item) {
                return symbolic_expression_is_fully_bound(item, parameters);
            });
        }
        if (!value.is_object()) return true;
        const auto& object = value.as_object();
        const auto kind = object.find("kind");
        const auto name = object.find("name");
        if (kind != object.end() && kind->second.is_string() &&
            kind->second.as_string() == "identifier" && name != object.end() && name->second.is_string()) {
            const std::string identifier = name->second.as_string();
            if (symbolic_bindings_.find(identifier) != symbolic_bindings_.end() &&
                parameters.find(identifier) == parameters.end()) {
                return false;
            }
        }
        for (const auto& [field_name, child] : object) {
            (void)field_name;
            if (!symbolic_expression_is_fully_bound(child, parameters)) return false;
        }
        return true;
    }

    void materialize_unbound_symbolic_bindings(
        vf::JsonValue& value,
        const std::set<std::string>& parameters
    ) const {
        if (value.is_array()) {
            for (auto& item : value.as_array()) {
                materialize_unbound_symbolic_bindings(item, parameters);
            }
            return;
        }
        if (!value.is_object()) return;
        auto& object = value.as_object();
        const auto kind = object.find("kind");
        const auto name = object.find("name");
        if (kind != object.end() && kind->second.is_string() &&
            kind->second.as_string() == "identifier" && name != object.end() && name->second.is_string()) {
            const std::string identifier = name->second.as_string();
            const auto binding = symbolic_bindings_.find(identifier);
            if (binding != symbolic_bindings_.end() && parameters.find(identifier) == parameters.end()) {
                auto callee = node("identifier");
                callee["name"] = vf::JsonValue("symbol");
                auto symbol_name = node("string_literal");
                symbol_name["value"] = vf::JsonValue(binding->second.name);
                auto domain = node("identifier");
                domain["name"] = vf::JsonValue(binding->second.domain);
                auto constant_value = node("bool_literal");
                constant_value["value"] = vf::JsonValue(binding->second.kind == "constant");
                auto constant_arg = node("named_call_arg");
                constant_arg["name"] = vf::JsonValue("constant");
                constant_arg["value"] = vf::JsonValue(std::move(constant_value));
                auto symbol_call = node("call");
                symbol_call["callee"] = vf::JsonValue(std::move(callee));
                symbol_call["args"] = vf::JsonValue(vf::JsonValue::Array{
                    vf::JsonValue(std::move(symbol_name)),
                    vf::JsonValue(std::move(domain)),
                    vf::JsonValue(std::move(constant_arg)),
                });
                value = vf::JsonValue(std::move(symbol_call));
                return;
            }
        }
        for (auto& [field_name, child] : object) {
            (void)field_name;
            materialize_unbound_symbolic_bindings(child, parameters);
        }
    }

    struct SymbolicBindingSpec {
        std::string name;
        std::string domain;
        std::string kind;
        std::string latex;
    };

    void remember_symbolic_binding(const std::string& binding, const vf::JsonValue& value) {
        if (!value.is_object()) return;
        const auto& object = value.as_object();
        const auto kind_field = object.find("kind");
        if (kind_field == object.end() || !kind_field->second.is_string() ||
            kind_field->second.as_string() != "symbolic_var") {
            return;
        }
        const auto symbol_kind = object.find("symbol_kind");
        const auto latex = object.find("latex");
        symbolic_bindings_[binding] = {
            string_field(object, "name", "symbolic binding"),
            string_field(object, "domain", "symbolic binding"),
            symbol_kind != object.end() && symbol_kind->second.is_string()
                ? symbol_kind->second.as_string() : "variable",
            latex != object.end() && latex->second.is_string()
                ? latex->second.as_string() : string_field(object, "name", "symbolic binding"),
        };
    }

    static bool valid_generated_symbol_name(const std::string& name) {
        if (name.empty() || !(std::isalpha(static_cast<unsigned char>(name.front())) ||
            name.front() == '_')) {
            return false;
        }
        return std::all_of(name.begin() + 1, name.end(), [](unsigned char ch) {
            return std::isalnum(ch) || ch == '_';
        });
    }

    static std::string symbolic_surface_ast(const vf::JsonValue& raw) {
        const auto& object = object_of(raw, "symbolic generator domain");
        const std::string kind = string_field(object, "kind", "symbolic generator domain");
        if (kind == "identifier") {
            const std::string name = string_field(object, "name", "symbolic generator domain");
            if (vkf_symbolic_surface_is_scalar_domain(name)) return name;
            return "";
        }
        if (kind == "binary_op" &&
            string_field(object, "op", "symbolic vector-space domain") == "CARET") {
            const std::string base = symbolic_surface_ast(
                field(object, "left", "symbolic vector-space base"));
            if (!vkf_symbolic_surface_is_scalar_domain(base)) return "";
            const auto& raw_right = field(object, "right", "symbolic vector-space dimension");
            const auto& right = object_of(raw_right, "symbolic vector-space dimension");
            const vf::JsonValue* raw_exponent = &raw_right;
            std::string codomain;
            if (string_field(right, "kind", "symbolic vector-space dimension") == "axis_align") {
                raw_exponent = &field(right, "value", "symbolic vector-space dimension");
                const auto& label = field(right, "label", "symbolic vector-space codomain");
                if (!label.is_string() || !vkf_symbolic_surface_is_scalar_domain(label.as_string())) {
                    return "";
                }
                codomain = label.as_string();
            }
            const auto& exponent = object_of(*raw_exponent, "symbolic vector-space dimension");
            if (string_field(exponent, "kind", "symbolic vector-space dimension") != "number_literal") {
                throw IRFailure("symbolic vector-space dimension must be a positive compile-time integer");
            }
            const auto& raw_dimension = field(exponent, "value", "symbolic vector-space dimension");
            const auto integer_surface = exponent.find("is_integer_surface");
            if (!raw_dimension.is_number() || raw_dimension.as_number() < 1.0 ||
                std::floor(raw_dimension.as_number()) != raw_dimension.as_number() ||
                integer_surface == exponent.end() || !integer_surface->second.is_boolean() ||
                !integer_surface->second.as_boolean()) {
                throw IRFailure("symbolic vector-space dimension must be a positive compile-time integer");
            }
            const std::string vector_space = base + "^" + std::to_string(
                static_cast<std::uint64_t>(raw_dimension.as_number()));
            return codomain.empty() ? vector_space : vector_space + "->" + codomain;
        }
        if (kind == "tuple_literal") {
            const auto& elements = array_of(
                field(object, "elements", "symbolic function input domains"),
                "symbolic function input domains");
            if (elements.empty()) return "";
            std::string result = "(";
            for (std::size_t index = 0; index < elements.size(); ++index) {
                const std::string element = symbolic_surface_ast(elements[index]);
                if (symbolic_domain_surface_parts(element).first.empty()) return "";
                if (index != 0) result += ",";
                result += element;
            }
            return result + ")";
        }
        if (kind == "axis_align") {
            const auto& value = object_of(
                field(object, "value", "symbolic function domain"), "symbolic function domain value");
            const auto& label = field(object, "label", "symbolic function codomain");
            if (!label.is_string()) return "";
            const std::string input = symbolic_surface_ast(vf::JsonValue(value));
            const std::string output = label.as_string();
            if (input.empty() ||
                !vkf_symbolic_surface_is_scalar_domain(output)) {
                return "";
            }
            return input + "->" + output;
        }
        return "";
    }

    static std::pair<std::string, std::uint64_t> symbolic_domain_surface_parts(
        const std::string& surface
    ) {
        if (vkf_symbolic_surface_is_scalar_domain(surface)) return {surface, 1u};
        const auto power = surface.find('^');
        if (power == std::string::npos) return {"", 0u};
        const std::string base = surface.substr(0, power);
        const std::string dimension = surface.substr(power + 1u);
        if (!vkf_symbolic_surface_is_scalar_domain(base) || dimension.empty()) return {"", 0u};
        std::uint64_t parsed = 0u;
        for (const unsigned char ch : dimension) {
            if (!std::isdigit(ch)) return {"", 0u};
            parsed = parsed * 10u + static_cast<std::uint64_t>(ch - '0');
        }
        return parsed == 0u ? std::pair<std::string, std::uint64_t>{"", 0u}
                            : std::pair<std::string, std::uint64_t>{base, parsed};
    }

    static std::vector<std::string> symbolic_function_input_surfaces(
        const std::string& signature
    ) {
        const auto arrow = signature.find("->");
        if (arrow == std::string::npos) return {};
        const std::string input = signature.substr(0, arrow);
        if (!symbolic_domain_surface_parts(input).first.empty()) return {input};
        if (input.size() < 3u || input.front() != '(' || input.back() != ')') return {};
        std::vector<std::string> result;
        std::size_t start = 1u;
        while (start < input.size() - 1u) {
            const std::size_t separator = input.find(',', start);
            const std::size_t end = separator == std::string::npos ? input.size() - 1u : separator;
            const std::string domain = input.substr(start, end - start);
            if (symbolic_domain_surface_parts(domain).first.empty()) return {};
            result.push_back(domain);
            if (separator == std::string::npos) break;
            start = separator + 1u;
        }
        return result;
    }

    static unsigned symbolic_scalar_domain_rank(const std::string& domain) {
        if (domain == "N") return 1u;
        if (domain == "Z") return 2u;
        if (domain == "Q") return 3u;
        if (domain == "R") return 4u;
        if (domain == "C") return 5u;
        return 0u;
    }

    static bool symbolic_domain_accepts(
        const std::string& expected,
        const std::string& actual
    ) {
        const auto expected_parts = symbolic_domain_surface_parts(expected);
        const auto actual_parts = symbolic_domain_surface_parts(actual);
        const unsigned expected_rank = symbolic_scalar_domain_rank(expected_parts.first);
        const unsigned actual_rank = symbolic_scalar_domain_rank(actual_parts.first);
        return expected_rank != 0u && actual_rank != 0u &&
            expected_parts.second == actual_parts.second && actual_rank <= expected_rank;
    }

    static std::optional<std::string> greek_symbol_case(
        const vf::JsonValue::Array& args
    ) {
        std::optional<std::string> selected;
        for (const auto& argument : args) {
            const auto& object = object_of(argument, "Greek symbol generator argument");
            if (string_field(object, "kind", "Greek symbol generator argument") != "named_call_arg") {
                continue;
            }
            if (string_field(object, "name", "Greek symbol generator option") != "case") {
                throw IRFailure("greek_symbols accepts only the named option case:");
            }
            if (selected.has_value()) {
                throw IRFailure("greek_symbols case: may be supplied only once");
            }
            const auto& value = object_of(
                field(object, "value", "Greek symbol case"), "Greek symbol case");
            if (string_field(value, "kind", "Greek symbol case") != "string_literal") {
                throw IRFailure("greek_symbols case: must be the compile-time string \"lower\" or \"upper\"");
            }
            const auto& raw = field(value, "value", "Greek symbol case");
            if (!raw.is_string() || (raw.as_string() != "lower" && raw.as_string() != "upper")) {
                throw IRFailure("greek_symbols case: must be \"lower\" or \"upper\"");
            }
            selected = raw.as_string();
        }
        return selected;
    }

    static const vf::JsonValue* greek_symbol_domain(
        const vf::JsonValue::Array& args
    ) {
        const vf::JsonValue* domain = nullptr;
        for (const auto& argument : args) {
            const auto& object = object_of(argument, "Greek symbol generator argument");
            if (string_field(object, "kind", "Greek symbol generator argument") == "named_call_arg") {
                continue;
            }
            if (domain != nullptr) {
                throw IRFailure("greek_symbols accepts at most one domain/signature");
            }
            domain = &argument;
        }
        return domain;
    }

    static std::vector<std::string> symbolic_generator_names(
        const std::string& generator,
        const vf::JsonValue::Array& args
    ) {
        if (generator == "greek_symbols") {
            const std::vector<std::string> all = {
                "Alpha", "alpha", "Beta", "beta", "Gamma", "gamma", "Delta", "delta",
                "Epsilon", "epsilon", "Zeta", "zeta", "Eta", "eta", "Theta", "theta",
                "Iota", "iota", "Kappa", "kappa", "Lambda", "lambda", "Mu", "mu",
                "Nu", "nu", "Xi", "xi", "Omicron", "omicron", "Pi", "pi", "Rho", "rho",
                "Sigma", "sigma", "Tau", "tau", "Upsilon", "upsilon", "Phi", "phi",
                "Chi", "chi", "Psi", "psi", "Omega", "omega"
            };
            const auto selected = greek_symbol_case(args);
            if (!selected.has_value()) return all;
            std::vector<std::string> result;
            const std::size_t parity = *selected == "upper" ? 0u : 1u;
            for (std::size_t index = parity; index < all.size(); index += 2u) {
                result.push_back(all[index]);
            }
            return result;
        }
        if (args.empty()) return {};
        const auto& names = object_of(args.front(), "symbolic generator names");
        const std::string kind = string_field(names, "kind", "symbolic generator names");
        std::vector<std::string> result;
        if (generator == "symbols") {
            if (kind == "string_literal") {
                const auto& value = field(names, "value", "symbolic character names");
                if (!value.is_string()) return {};
                for (const unsigned char ch : value.as_string()) {
                    if (ch >= 128) {
                        throw IRFailure("symbolic plural string generators currently require ASCII identifiers");
                    }
                    result.emplace_back(1, static_cast<char>(ch));
                }
                return result;
            }
        }
        if (generator == "symbol") {
            if (kind != "string_literal") return {};
            const auto& value = field(names, "value", "symbolic character names");
            if (!value.is_string()) return {};
            result.push_back(value.as_string());
            return result;
        }
        if (generator == "symbols") {
            if (kind != "list_literal") return {};
            for (const auto& item : array_of(field(names, "items", "symbolic names"), "symbolic names")) {
                const auto& item_object = object_of(item, "symbolic name");
                if (string_field(item_object, "kind", "symbolic name") != "string_literal") {
                    throw IRFailure("symbolic generator names must be compile-time strings");
                }
                const auto& name = field(item_object, "value", "symbolic name");
                if (!name.is_string()) throw IRFailure("symbolic generator name must be string");
                result.push_back(name.as_string());
            }
        }
        return result;
    }

    static std::vector<std::string> symbolic_generator_surfaces(const vf::JsonValue& raw) {
        const auto& object = object_of(raw, "symbolic generator domains");
        if (string_field(object, "kind", "symbolic generator domains") != "tuple_literal") {
            const std::string surface = symbolic_surface_ast(raw);
            return surface.empty() ? std::vector<std::string>{} : std::vector<std::string>{surface};
        }
        std::vector<std::string> result;
        for (const auto& element : array_of(
                 field(object, "elements", "symbolic generator domains"),
                 "symbolic generator domains")) {
            const std::string surface = symbolic_surface_ast(element);
            if (surface.empty()) return {};
            result.push_back(surface);
        }
        return result;
    }

    static std::vector<bool> symbolic_generator_constant_flags(
        const vf::JsonValue::Array& args,
        std::size_t count
    ) {
        if (args.size() == 2) return std::vector<bool>(count, false);
        if (args.size() != 3) return {};
        const auto& named = object_of(args[2], "symbolic constant assumption");
        if (string_field(named, "kind", "symbolic constant assumption") != "named_call_arg" ||
            string_field(named, "name", "symbolic constant assumption") != "constant") {
            throw IRFailure("symbol and symbols accept only the named option constant:");
        }
        const auto& value = object_of(
            field(named, "value", "symbolic constant assumption"),
            "symbolic constant assumption value");
        const std::string kind = string_field(value, "kind", "symbolic constant assumption value");
        if (kind == "bool_literal") {
            const auto& raw = field(value, "value", "symbolic constant assumption value");
            if (!raw.is_boolean()) throw IRFailure("symbolic constant assumption must be bit");
            return std::vector<bool>(count, raw.as_boolean());
        }
        if (kind != "tuple_literal") {
            throw IRFailure("symbolic constant assumption must be one bit or a matching tuple of bits");
        }
        std::vector<bool> result;
        for (const auto& element : array_of(
                 field(value, "elements", "symbolic constant assumptions"),
                 "symbolic constant assumptions")) {
            const auto& item = object_of(element, "symbolic constant assumption");
            const auto& raw = field(item, "value", "symbolic constant assumption");
            if (string_field(item, "kind", "symbolic constant assumption") != "bool_literal" ||
                !raw.is_boolean()) {
                throw IRFailure("symbolic constant assumption tuple must contain only bits");
            }
            result.push_back(raw.as_boolean());
        }
        if (result.size() != count) {
            throw IRFailure("symbolic constant assumption count must match the generated name count");
        }
        return result;
    }

    std::optional<vf::JsonValue> lower_symbolic_generator_call(
        const vf::JsonValue::Object& call
    ) const {
        if (!symbolic_imported_) return std::nullopt;
        const auto& callee = object_of(field(call, "callee", "symbolic generator"), "symbolic generator");
        if (string_field(callee, "kind", "symbolic generator") != "identifier") {
            return std::nullopt;
        }
        const std::string generator = string_field(callee, "name", "symbolic generator");
        if (generator != "symbol" && generator != "symbols" && generator != "greek_symbols") {
            return std::nullopt;
        }
        const auto& args = array_of(field(call, "args", "symbolic generator"), "symbolic generator args");
        const bool greek = generator == "greek_symbols";
        if (!greek && (args.size() < 2u || args.size() > 3u)) {
            throw IRFailure(generator + " requires names and a domain/signature");
        }
        const vf::JsonValue* greek_domain = nullptr;
        if (greek) {
            greek_symbol_case(args);
            greek_domain = greek_symbol_domain(args);
            if (args.size() > (greek_domain == nullptr ? 1u : 2u)) {
                throw IRFailure("greek_symbols accepts one optional domain/signature and case:");
            }
        }
        const std::vector<std::string> names = symbolic_generator_names(generator, args);
        if (names.empty()) throw IRFailure(generator + " requires at least one valid name");
        std::vector<std::string> surfaces = greek
            ? (greek_domain == nullptr ? std::vector<std::string>{"Unknown"}
                                       : symbolic_generator_surfaces(*greek_domain))
            : symbolic_generator_surfaces(args[1]);
        if (surfaces.empty()) {
            throw IRFailure(generator + " requires symbolic domains such as R or R->R");
        }
        if (surfaces.size() == 1 && names.size() > 1) surfaces.resize(names.size(), surfaces.front());
        if (surfaces.size() != names.size()) {
            throw IRFailure(generator + " domain count must be one or match the generated name count");
        }
        const std::vector<bool> constant_flags = greek
            ? std::vector<bool>(names.size(), false)
            : symbolic_generator_constant_flags(args, names.size());
        if (constant_flags.size() != names.size()) {
            throw IRFailure(generator + " constant assumption count must be one or match the generated name count");
        }
        const bool singular = generator == "symbol";
        std::set<std::string> unique;
        vf::JsonValue::Array fields;
        std::string record_type = "record{";
        for (std::size_t index = 0; index < names.size(); ++index) {
            const std::string& name = names[index];
            if (!valid_generated_symbol_name(name)) {
                throw IRFailure("invalid generated symbolic identifier " + name);
            }
            if (!unique.insert(name).second) {
                throw IRFailure("duplicate generated symbolic identifier " + name);
            }
            auto symbol = node("symbolic_var");
            symbol["name"] = vf::JsonValue(name);
            symbol["domain"] = vf::JsonValue(surfaces[index]);
            symbol["symbol_kind"] = vf::JsonValue(constant_flags[index] ? "constant" : "variable");
            symbol["latex"] = vf::JsonValue(default_symbolic_latex(name));
            const std::string public_type = constant_flags[index] ? "constant" : "symbol";
            symbol["type"] = vf::JsonValue(public_type);
            attach_expression_facts(
                symbol, VkfExpressionLoweringMode::SymbolicNode, surfaces[index],
                VkfSymbolicCompilerNodeKind::Symbol, {name});
            if (singular) return vf::JsonValue(std::move(symbol));
            auto record_field = node("record_field");
            record_field["name"] = vf::JsonValue(name);
            record_field["value"] = vf::JsonValue(std::move(symbol));
            record_field["type"] = vf::JsonValue(public_type);
            fields.emplace_back(std::move(record_field));
            if (index != 0) record_type += ",";
            record_type += name + ":" + public_type;
        }
        record_type += "}";
        auto record = node("record");
        record["fields"] = vf::JsonValue(std::move(fields));
        record["type"] = vf::JsonValue(record_type);
        return vf::JsonValue(std::move(record));
    }

    static std::string field_type_from_record(const std::string& record_type, const std::string& field_name) {
        const std::string prefix = "record{";
        if (record_type.rfind(prefix, 0) != 0 || record_type.empty() || record_type.back() != '}') {
            return "any";
        }
        const std::string inner = record_type.substr(prefix.size(), record_type.size() - prefix.size() - 1);
        std::size_t start = 0;
        while (start <= inner.size()) {
            const std::size_t comma = inner.find(',', start);
            const std::string part = inner.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
            const std::size_t colon = part.find(':');
            if (colon != std::string::npos && part.substr(0, colon) == field_name) {
                return part.substr(colon + 1);
            }
            if (comma == std::string::npos) {
                break;
            }
            start = comma + 1;
        }
        return "any";
    }

    FunctionTable functions_;
    TypeEnv module_env_;
    std::map<std::string, std::string> type_aliases_;
    std::map<std::string, std::string> nominal_representations_;
    std::map<std::string, std::string> imported_modules_;
    std::vector<std::string> spilled_modules_;
    std::map<std::string, SymbolicBindingSpec> symbolic_bindings_;
    std::map<std::string, vf::JsonValue> symbolic_expression_sources_;
    std::set<std::string> symbolic_trace_stack_;
    std::map<std::string, UiHandleRef> ui_handle_bindings_;
    std::vector<UiStaticIdentity> ui_static_identities_;
    std::map<std::string, std::uint64_t> world_handle_bindings_;
    std::vector<WorldRef> worlds_;
    vf::JsonValue::Array world_operations_;
    vf::JsonValue::Array ui_displays_;
    vf::JsonValue::Array ui_operations_;
    vf::JsonValue::Array ui_retained_bindings_;
    std::string ui_result_type_ = "null";
    bool symbolic_imported_ = false;
    bool has_static_html_load_ = false;
    std::uint64_t next_lambda_local_ = 0;
    std::uint64_t next_ui_frame_ = 0;
    std::uint64_t next_ui_layer_ = 0;
};

double require_const_number(const vf::JsonValue& value, const std::string& context) {
    const auto& object = object_of(value, context);
    if (string_field(object, "kind", context) != "const") {
        throw IRFailure("expected const for " + context);
    }
    const vf::JsonValue& raw = field(object, "value", context);
    if (!raw.is_number()) {
        throw IRFailure("expected numeric const for " + context);
    }
    return raw.as_number();
}

vf::JsonValue list_of_numbers(const std::vector<double>& values) {
    vf::JsonValue::Array items;
    for (double value : values) {
        items.push_back(num_const(value));
    }
    auto out = node("list");
    out["items"] = vf::JsonValue(std::move(items));
    out["element_type"] = vf::JsonValue("num");
    out["type"] = vf::JsonValue("list<num>");
    return vf::JsonValue(std::move(out));
}

vf::JsonValue tuple_of_range_integers(const std::vector<double>& values) {
    vf::JsonValue::Array items;
    std::string type = "tuple<";
    for (std::size_t index = 0; index < values.size(); ++index) {
        if (index != 0) type += ",";
        type += "int";
        items.push_back(int_const(values[index]));
    }
    type += ">";
    auto out = node("tuple");
    out["items"] = vf::JsonValue(std::move(items));
    out["element_type"] = vf::JsonValue("int");
    out["type"] = vf::JsonValue(std::move(type));
    return vf::JsonValue(std::move(out));
}

bool try_fold_range_expr(const vf::JsonValue::Object& object, vf::JsonValue& out_value) {
    const vf::JsonValue& start_value = field(object, "start", "range_expr");
    const vf::JsonValue& end_value = field(object, "end", "range_expr");
    double start = 0.0;
    if (!start_value.is_null()) {
        const auto& start_object = object_of(start_value, "range_expr.start");
        if (string_field(start_object, "kind", "range_expr.start") != "number_literal") {
            return false;
        }
        start = field(start_object, "value", "range_expr.start").as_number();
    }
    if (end_value.is_null()) {
        return false;
    }
    const auto& end_object = object_of(end_value, "range_expr.end");
    if (string_field(end_object, "kind", "range_expr.end") != "number_literal") {
        return false;
    }
    const double end = field(end_object, "value", "range_expr.end").as_number();
    if (std::floor(start) != start || std::floor(end) != end) {
        return false;
    }
    std::vector<double> values;
    const int step = start <= end ? 1 : -1;
    for (double current = start;; current += step) {
        values.push_back(current);
        if (current == end) {
            break;
        }
        if (values.size() > 100000) {
            throw IRFailure("range_expr too large for native typed IR subset");
        }
    }
    out_value = tuple_of_range_integers(values);
    return true;
}

double eval_pipe_segment_expr(
    const vf::JsonValue& ast,
    std::map<std::string, double>& env,
    const FunctionTable& functions
);

double eval_pipe_function_call(
    const std::string& name,
    const vf::JsonValue::Array& args,
    std::map<std::string, double>& env,
    const FunctionTable& functions
) {
    const FunctionInfo* function = functions.get(name);
    if (function == nullptr) {
        throw IRFailure("unknown pipe function " + name);
    }
    if (args.size() != function->param_names.size()) {
        throw IRFailure("wrong arity for pipe function " + name);
    }
    std::map<std::string, double> nested_env;
    for (std::size_t index = 0; index < args.size(); ++index) {
        nested_env[function->param_names[index]] = eval_pipe_segment_expr(args[index], env, functions);
    }
    return eval_pipe_segment_expr(function->body_ast, nested_env, functions);
}

double eval_pipe_segment_expr(
    const vf::JsonValue& ast,
    std::map<std::string, double>& env,
    const FunctionTable& functions
) {
    const auto& object = object_of(ast, "pipe segment");
    const std::string kind = string_field(object, "kind", "pipe segment");
    if (kind == "number_literal") {
        return field(object, "value", "number_literal").as_number();
    }
    if (kind == "identifier") {
        const std::string name = string_field(object, "name", "identifier");
        const auto found = env.find(name);
        if (found == env.end()) {
            throw IRFailure("unknown pipe identifier " + name);
        }
        return found->second;
    }
    if (kind == "binary_op") {
        const std::string op = string_field(object, "op", "binary_op");
        const double left = eval_pipe_segment_expr(field(object, "left", "binary_op"), env, functions);
        const double right = eval_pipe_segment_expr(field(object, "right", "binary_op"), env, functions);
        if (op == "PLUS") return left + right;
        if (op == "MINUS") return left - right;
        if (op == "STAR") return left * right;
        if (op == "SLASH") return left / right;
        if (op == "CARET") return std::pow(left, right);
        throw IRFailure("unsupported pipe binary op " + op);
    }
    if (kind == "call") {
        const auto& callee = object_of(field(object, "callee", "call"), "pipe call callee");
        if (string_field(callee, "kind", "pipe call callee") != "identifier") {
            throw IRFailure("unsupported pipe call target");
        }
        return eval_pipe_function_call(
            string_field(callee, "name", "pipe call callee"),
            array_of(field(object, "args", "call"), "pipe call args"),
            env,
            functions
        );
    }
    throw IRFailure("unsupported pipe segment kind " + kind);
}

bool try_fold_pipe_chain_expr(
    const vf::JsonValue::Object& object,
    const TypeEnv& env,
    const FunctionTable& functions,
    vf::JsonValue& out_value
) {
    (void)env;
    const auto& source_ast = object_of(field(object, "source", "pipe_chain"), "pipe_chain.source");
    if (string_field(source_ast, "kind", "pipe_chain.source") != "list_literal") {
        return false;
    }
    std::vector<double> source_values;
    for (const auto& item : array_of(field(source_ast, "items", "pipe_chain.source"), "pipe_chain.source.items")) {
        const auto& item_object = object_of(item, "pipe_chain item");
        const std::string item_kind = string_field(item_object, "kind", "pipe_chain item");
        if (item_kind == "range_expr") {
            vf::JsonValue folded_range;
            if (!try_fold_range_expr(item_object, folded_range)) {
                return false;
            }
            const auto& folded_items = array_of(field(folded_range.as_object(), "items", "pipe range"), "pipe range.items");
            for (const auto& folded_item : folded_items) {
                source_values.push_back(require_const_number(folded_item, "pipe range item"));
            }
            continue;
        }
        if (item_kind != "number_literal") {
            return false;
        }
        source_values.push_back(field(item_object, "value", "pipe_chain item").as_number());
    }

    std::vector<double> mapped;
    for (double source_value : source_values) {
        double current = source_value;
        for (const auto& segment : array_of(field(object, "segments", "pipe_chain"), "pipe_chain.segments")) {
            std::map<std::string, double> locals;
            locals["$"] = current;
            try {
                current = eval_pipe_segment_expr(segment, locals, functions);
            } catch (const IRFailure&) {
                // Constant folding is optional. Block-bodied calls and pipe
                // blocks retain their ordinary typed lowering semantics.
                return false;
            }
        }
        mapped.push_back(current);
    }
    out_value = list_of_numbers(mapped);
    return true;
}

std::string read_stdin() {
    std::ostringstream buffer;
    buffer << std::cin.rdbuf();
    return buffer.str();
}

std::string read_file(const std::string& path) {
    std::ifstream input(path);
    if (!input) {
        return "";
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

bool starts_with(const std::string& text, const std::string& prefix) {
    return text.rfind(prefix, 0) == 0;
}

std::string axis_tagged_type(const std::string& axis_key, const std::string& value_type) {
    return "axis<" + axis_key + ">:" + value_type;
}

bool parse_axis_tagged_type(
    const std::string& text,
    std::string& axis_key,
    std::string& value_type
) {
    const std::string prefix = "axis<";
    if (!starts_with(text, prefix)) {
        return false;
    }
    const std::size_t close = text.find(">:");
    if (close == std::string::npos || close < prefix.size()) {
        return false;
    }
    axis_key = text.substr(prefix.size(), close - prefix.size());
    value_type = text.substr(close + 2);
    return !axis_key.empty() && !value_type.empty();
}

std::string render_surface_type(const std::string& type_name) {
    if (starts_with(type_name, "fn(")) {
        std::size_t close = std::string::npos;
        std::size_t depth = 1;
        for (std::size_t index = 3; index < type_name.size(); ++index) {
            if (type_name[index] == '(') {
                ++depth;
            } else if (type_name[index] == ')' && --depth == 0) {
                close = index;
                break;
            }
        }
        if (close != std::string::npos && close + 2 < type_name.size() &&
            type_name.substr(close + 1, 2) == "->") {
            const std::string parameter_text = type_name.substr(3, close - 3);
            const auto parameters = parameter_text.empty()
                ? std::vector<std::string>{}
                : split_top_level_type_parts(parameter_text);
            if (parameters.size() == 1 && starts_with(parameters.front(), "tuple<") &&
                parameters.front().back() == '>') {
                const auto tuple_items = split_top_level_type_parts(
                    parameters.front().substr(6, parameters.front().size() - 7));
                if (tuple_items.size() == 1) {
                    return render_surface_type(parameters.front()) + " -> " +
                        render_surface_type(type_name.substr(close + 3));
                }
            }
            std::string out = "(";
            for (std::size_t index = 0; index < parameters.size(); ++index) {
                if (index != 0) out += ", ";
                out += render_surface_type(parameters[index]);
            }
            return out + ") -> " + render_surface_type(type_name.substr(close + 3));
        }
    }
    if (starts_with(type_name, "tuple<") && !type_name.empty() && type_name.back() == '>') {
        const auto items = split_top_level_type_parts(
            type_name.substr(6, type_name.size() - 7));
        std::string out = "(";
        for (std::size_t index = 0; index < items.size(); ++index) {
            if (index != 0) out += ", ";
            out += render_surface_type(items[index]);
        }
        if (items.size() == 1) out += ',';
        return out + ")";
    }
    if (starts_with(type_name, "record{") && !type_name.empty() && type_name.back() == '}') {
        const std::string inner = type_name.substr(7, type_name.size() - 8);
        std::string out = "(";
        std::size_t start = 0;
        bool first = true;
        while (start <= inner.size()) {
            const std::size_t comma = inner.find(',', start);
            const std::string part = inner.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
            if (!first) {
                out += ", ";
            }
            first = false;
            const std::size_t colon = part.find(':');
            if (colon == std::string::npos) {
                out += part;
            } else {
                out += part.substr(0, colon) + ":" + render_surface_type(part.substr(colon + 1));
            }
            if (comma == std::string::npos) {
                break;
            }
            start = comma + 1;
        }
        out += ")";
        return out;
    }
    if (starts_with(type_name, "list<") && !type_name.empty() && type_name.back() == '>') {
        return "[" + render_surface_type(type_name.substr(5, type_name.size() - 6)) + "]";
    }
    if (starts_with(type_name, "multiset<") && !type_name.empty() && type_name.back() == '>') {
        return "{" + render_surface_type(type_name.substr(9, type_name.size() - 10)) + "}";
    }
    return type_name;
}

bool try_fold_abs_expr(const vf::JsonValue::Object& object, const TypeEnv& env, vf::JsonValue& out_value) {
    const auto& value_ast = object_of(field(object, "value", "abs_expr"), "abs_expr.value");
    const std::string kind = string_field(value_ast, "kind", "abs_expr.value");
    if (kind == "number_literal") {
        out_value = num_const(std::fabs(field(value_ast, "value", "number_literal").as_number()));
        return true;
    }
    if (kind == "unary_op" && string_field(value_ast, "op", "unary_op") == "MINUS") {
        const auto& operand = object_of(field(value_ast, "operand", "unary_op"), "unary_op.operand");
        if (string_field(operand, "kind", "unary_op.operand") == "number_literal") {
            out_value = num_const(std::fabs(field(operand, "value", "number_literal").as_number()));
            return true;
        }
    }
    if (kind == "list_literal") {
        const auto& items = array_of(field(value_ast, "items", "list_literal"), "list_literal.items");
        if (items.empty()) {
            return false;
        }
        double sum = 0.0;
        for (const auto& item_value : items) {
            const auto& item = object_of(item_value, "list item");
            if (string_field(item, "kind", "list item") != "number_literal") {
                return false;
            }
            const double number = field(item, "value", "list item").as_number();
            sum += number * number;
        }
        out_value = num_const(std::sqrt(sum));
        return true;
    }
    (void)env;
    return false;
}

std::string input_text(int argc, char** argv) {
    if (argc <= 1) {
        return read_stdin();
    }
    const std::string file_text = read_file(argv[1]);
    if (!file_text.empty()) {
        return file_text;
    }
    return argv[1];
}

}  // namespace

vf::JsonValue vkf::native_frontend::lower_value(const vf::JsonValue& ast) {
    Lowerer lowerer;
    return lowerer.lower_module(ast);
}

std::string vkf::native_frontend::lower(const std::string& ast_json) {
    return vf::json_stringify(lower_value(vf::parse_json(ast_json)), -1) + "\n";
}

#ifndef VKF_NATIVE_FRONTEND_LIBRARY
int main(int argc, char** argv) {
    try {
        std::cout << vkf::native_frontend::lower(input_text(argc, argv));
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<ast-to-ir>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
#endif
