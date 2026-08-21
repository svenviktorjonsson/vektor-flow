#include "native/VfOverlay/vf/json.hpp"
#include "compiler/native/vkf_native_frontend.hpp"
#include "compiler/native/vkf_symbolic_lowering.hpp"
#include "compiler/native/vkf_capture_pattern.hpp"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <map>
#include <optional>
#include <fstream>
#include <iostream>
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
    std::string signature;
    vf::JsonValue body_ast;
};

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

    const std::vector<Binding>& bindings() const { return bindings_; }

private:
    std::vector<Binding> bindings_;
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

    const FunctionInfo* get(
        const std::string& name,
        const std::vector<std::string>& argument_types
    ) const {
        const FunctionInfo* only = nullptr;
        std::size_t family_size = 0;
        for (const auto& function : functions_) {
            if (function.name != name) continue;
            only = &function;
            ++family_size;
        }
        if (family_size == 1) return only;
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
            for (std::size_t index = 0;
                 index < argument_types.size() && index < function.param_types.size(); ++index) {
                const std::string& actual = argument_types[index];
                const std::string& expected = function.param_types[index];
                if (actual == expected) {
                    score += 100;
                } else if (expected == "any" || actual == "any") {
                    score += 1;
                } else if (expected == "num" &&
                           (actual == "int" || actual == "f32" || actual == "f64")) {
                    score += 50;
                } else if (expected == "int" && actual == "num") {
                    score += 25;
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
    const std::string name = string_field(object, "name", "type annotation");
    if (name == "bool") return "bit";
    if (name.size() >= 2 && name.front() == '(' && name.back() == ')' && name.find(':') != std::string::npos) {
        return "record{" + name.substr(1, name.size() - 2) + "}";
    }
    if (name.size() >= 2 && name.front() == '(' && name.back() == ')' && name.find(',') != std::string::npos) {
        return "tuple<" + name.substr(1, name.size() - 2) + ">";
    }
    return name;
}

std::vector<std::string> split_top_level_type_parts(const std::string& text) {
    std::vector<std::string> parts;
    std::size_t start = 0;
    int depth = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch == '(' || ch == '[' || ch == '{' || ch == '<') ++depth;
        if (ch == ')' || ch == ']' || ch == '}' || ch == '>') --depth;
        if (ch == ',' && depth == 0) {
            parts.push_back(text.substr(start, index - start));
            start = index + 1;
        }
    }
    parts.push_back(text.substr(start));
    return parts;
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
    if (starts_with(type, "fn(")) return type;
    int depth = 0;
    for (std::size_t index = 0; index + 1 < type.size(); ++index) {
        const char ch = type[index];
        if (ch == '(' || ch == '[' || ch == '{' || ch == '<') ++depth;
        if (ch == ')' || ch == ']' || ch == '}' || ch == '>') --depth;
        if (depth == 0 && ch == '-' && type[index + 1] == '>') {
            std::string domain = type.substr(0, index);
            if (domain.size() >= 2 && domain.front() == '(' && domain.back() == ')') {
                domain = domain.substr(1, domain.size() - 2);
            }
            return "fn(" + domain + ")->" + type.substr(index + 2);
        }
    }
    return type;
}

struct VectorTypeParts {
    std::string element;
    std::string shape;
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

std::optional<std::string> maybe_dynamic_list_element_type(const std::string& type) {
    if (!starts_with(type, "list<") || type.size() < 7 || type.back() != '>') {
        return std::nullopt;
    }
    return type.substr(5, type.size() - 6);
}

bool structurally_compatible_type(const std::string& actual, const std::string& expected) {
    if (expected == "any" || actual == "any" || actual == expected) return true;
    if (expected == "num" && (actual == "int" || actual == "f32" || actual == "f64")) {
        return true;
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

std::string structurally_lifted_result_type(
    const std::string& actual,
    const std::string& expected,
    const std::string& result
) {
    if (structurally_compatible_type(actual, expected)) return result;
    if (const auto vector = vector_type_parts(actual)) {
        const std::string element = structurally_lifted_result_type(
            vector->element, expected, result);
        return "[" + element + (vector->shape.empty() ? "" : ":" + vector->shape) + "]";
    }
    if (const auto list = maybe_dynamic_list_element_type(actual)) {
        return "list<" + structurally_lifted_result_type(*list, expected, result) + ">";
    }
    if (starts_with(actual, "tuple<") && actual.back() == '>') {
        const auto items = split_top_level_type_parts(actual.substr(6, actual.size() - 7));
        std::string transformed = "tuple<";
        for (std::size_t index = 0; index < items.size(); ++index) {
            if (index != 0) transformed += ",";
            transformed += structurally_lifted_result_type(items[index], expected, result);
        }
        return transformed + ">";
    }
    if (starts_with(actual, "record{") && actual.back() == '}') {
        const auto fields = split_top_level_type_parts(actual.substr(7, actual.size() - 8));
        std::string transformed = "record{";
        for (std::size_t index = 0; index < fields.size(); ++index) {
            int depth = 0;
            std::size_t colon = std::string::npos;
            for (std::size_t position = 0; position < fields[index].size(); ++position) {
                const char ch = fields[index][position];
                if (ch == '(' || ch == '[' || ch == '{' || ch == '<') ++depth;
                if (ch == ')' || ch == ']' || ch == '}' || ch == '>') --depth;
                if (ch == ':' && depth == 0) { colon = position; break; }
            }
            if (index != 0) transformed += ",";
            if (colon == std::string::npos) {
                transformed += fields[index];
            } else {
                transformed += fields[index].substr(0, colon + 1);
                transformed += structurally_lifted_result_type(
                    fields[index].substr(colon + 1), expected, result);
            }
        }
        return transformed + "}";
    }
    return actual;
}

void collect_structural_match_paths(
    const std::string& actual,
    const std::string& expected,
    const std::string& prefix,
    std::vector<std::string>& paths
) {
    if (structurally_compatible_type(actual, expected)) {
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
    if (starts_with(actual, "tuple<") && actual.back() == '>') {
        const auto items = split_top_level_type_parts(actual.substr(6, actual.size() - 7));
        for (std::size_t index = 0; index < items.size(); ++index) {
            const std::string component = std::to_string(index);
            collect_structural_match_paths(
                items[index], expected, prefix.empty() ? component : prefix + "." + component, paths);
        }
        return;
    }
    for (const auto& [name, field_type] : record_type_fields(actual)) {
        collect_structural_match_paths(
            field_type, expected, prefix.empty() ? name : prefix + "." + name, paths);
    }
}

bool structural_container_type(const std::string& type) {
    return vector_type_parts(type).has_value() ||
        maybe_dynamic_list_element_type(type).has_value() ||
        (starts_with(type, "tuple<") && type.back() == '>') ||
        (starts_with(type, "record{") && type.back() == '}');
}

std::string instantiate_vector_type(
    const std::string& type,
    const std::map<std::string, std::string>& dimensions
) {
    const auto parts = vector_type_parts(type);
    if (!parts || parts->shape.empty()) return type;
    const auto found = dimensions.find(parts->shape);
    if (found == dimensions.end()) return type;
    return "[" + parts->element + ":" + found->second + "]";
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
    if (target_type == "num" && source_type == "int") {
        object["type"] = vf::JsonValue("num");
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
        const bool element_coercible = source_element == target_element
            || source_element == "any"
            || (source_element == "int" && target_element == "num");
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
    if (!target_type.empty()
        && std::isupper(static_cast<unsigned char>(target_type.front()))
        && starts_with(source_type, "record{")) {
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

vf::JsonValue symbolic_type_facts_json(const VkfSymbolicTypeFacts& facts) {
    auto out = node("symbolic_type_facts");
    out["symbolic"] = vf::JsonValue(facts.symbolic);
    std::string shape = "none";
    if (facts.shape == VkfSymbolicTypeShape::ScalarDomain) shape = "scalar_domain";
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
            if (segments.size() == 1 && segments.front().is_string()) {
                const auto& alias = field(statement, "alias", "spill_import");
                if (alias.is_null()) spilled_modules_.push_back(segments.front().as_string());
                imported_modules_[alias.is_string() ? alias.as_string() : segments.front().as_string()] =
                    segments.front().as_string();
            }
        }
        for (const auto& stmt : statements) {
            register_function_if_present(stmt, module_env_);
        }

        vf::JsonValue::Array body;
        for (const auto& stmt : statements) {
            body.push_back(lower_stmt(stmt, module_env_));
        }
        auto out = node("typed_module");
        out["body"] = vf::JsonValue(std::move(body));
        return vf::JsonValue(std::move(out));
    }

private:
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
        return type;
    }

    static vf::JsonValue string_const(std::string value) {
        auto out = node("const");
        out["type"] = vf::JsonValue("str");
        out["value"] = vf::JsonValue(std::move(value));
        return vf::JsonValue(std::move(out));
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
        const bool type_spill = explicit_type || !primitive.empty();
        vf::JsonValue lowered_subject = lower_expr(subject, env);
        std::string subject_type = string_field(
            lowered_subject.as_object(), "type", "container spill subject");
        subject_type = resolve_type_alias(subject_type);

        if (!type_spill && container == "record") return lowered_subject;

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
        if (members.empty()) {
            throw IRFailure("container type spill requires a structured or primitive type");
        }

        if (container == "record") {
            vf::JsonValue::Array fields;
            std::string type = "record{";
            for (std::size_t index = 0; index < members.size(); ++index) {
                if (index != 0) type += ",";
                type += members[index].first + ":str";
                auto item = node("field");
                item["name"] = vf::JsonValue(members[index].first);
                item["type"] = vf::JsonValue("str");
                item["value"] = string_const(render_surface_type(members[index].second));
                fields.emplace_back(std::move(item));
            }
            type += "}";
            auto out = node("record");
            out["fields"] = vf::JsonValue(std::move(fields));
            out["type"] = vf::JsonValue(std::move(type));
            return vf::JsonValue(std::move(out));
        }
        if (container == "vector") {
            vf::JsonValue::Array items;
            for (const auto& member : members) {
                items.push_back(string_const(render_surface_type(member.second)));
            }
            auto out = node("list");
            out["items"] = vf::JsonValue(std::move(items));
            out["element_type"] = vf::JsonValue("str");
            out["type"] = vf::JsonValue("list<str>");
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
        const std::string return_type = type_annotation_name(field(object, "return_type", "function_definition"));
        const std::string signature = function_signature_type(param_types, return_type);
        functions_.set({name, {}, param_types, {}, {}, {}, return_type, signature, vf::JsonValue(nullptr)});
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
                const auto& raw_value = object_of(field(object, "value", "bind"), "bind value");
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
                    const std::string symbolic_surface = symbolic_type_surface_from_value(value);
                    if (!symbolic_surface.empty()) {
                        auto symbolic_value = node("symbolic_var");
                        symbolic_value["name"] = vf::JsonValue(name);
                        symbolic_value["domain"] = vf::JsonValue(symbolic_surface);
                        symbolic_value["type"] = vf::JsonValue("symbolic");
                        attach_expression_facts(
                            symbolic_value,
                            VkfExpressionLoweringMode::SymbolicNode,
                            symbolic_surface,
                            VkfSymbolicCompilerNodeKind::Symbol,
                            {name}
                        );
                        value = vf::JsonValue(std::move(symbolic_value));
                        value_type = "symbolic";
                    }
                }
                std::string environment_type = value_type;
                if ((type_it == object.end() || type_it->second.is_null()) &&
                    string_field(value.as_object(), "kind", "IR value") == "list") {
                    const auto& items = array_of(
                        field(value.as_object(), "items", "IR list"), "IR list items");
                    const auto element = value.as_object().find("element_type");
                    if (element != value.as_object().end() && element->second.is_string()) {
                        environment_type = "[" + element->second.as_string() + ":" +
                            std::to_string(items.size()) + "]";
                    }
                }
                env.set(name, environment_type);

                auto out = node("store_binding");
                out["name"] = vf::JsonValue(name);
                out["type"] = vf::JsonValue(value_type);
                out["value"] = std::move(value);
                const auto update = object.find("update");
                if (update != object.end() && update->second.is_boolean()) {
                    out["update"] = update->second;
                }
                return vf::JsonValue(std::move(out));
            }
            if (target_kind == "attribute") {
                const auto& base = object_of(field(target, "object", "attribute"), "bind.target.object");
                if (string_field(base, "kind", "bind.target.object") != "identifier") {
                    throw IRFailure("unsupported attribute bind base");
                }
                auto out = node("update_attr");
                out["base_name"] = vf::JsonValue(string_field(base, "name", "bind.target.object"));
                out["field"] = vf::JsonValue(string_field(target, "name", "bind.target"));
                vf::JsonValue value = lower_expr(field(object, "value", "bind"), env);
                out["value"] = std::move(value);
                return vf::JsonValue(std::move(out));
            }
            if (target_kind == "dotted_index") {
                const auto& base = object_of(field(target, "base", "dotted_index"), "bind.target.base");
                if (string_field(base, "kind", "bind.target.base") != "identifier") {
                    throw IRFailure("unsupported dotted_index bind base");
                }
                vf::JsonValue::Array indices;
                for (const auto& index_ast : array_of(field(target, "indices", "dotted_index"), "bind.target.indices")) {
                    indices.push_back(lower_expr(index_ast, env));
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
            auto out = node("spill_stmt");
            out["value"] = lower_expr(field(object, "value", "spill_value"), env);
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
            function_env.set(
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

        const std::string return_type = type_annotation_name(field(object, "return_type", "function_definition"));
        const std::string signature = function_signature_type(param_types, return_type);
        functions_.set({name, param_names, param_types, param_defaults, variadic_positional, variadic_named, return_type, signature, field(object, "body", "function_definition")});
        env.set(name, signature);
        function_env.set("$return", return_type);
        const FunctionInfo* registered_function = functions_.get(name, param_types);
        if (registered_function == nullptr) {
            throw IRFailure("cannot resolve registered function " + name);
        }

        auto out = node("function");
        vf::JsonValue lowered_body = lower_body(
            field(object, "body", "function_definition"), function_env);
        if (return_type != "any") {
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
                        std::move(expression->second), return_type, "function tail");
                }
            }
        }
        out["body"] = std::move(lowered_body);
        out["name"] = vf::JsonValue(functions_.runtime_name(*registered_function));
        out["params"] = vf::JsonValue(std::move(params));
        out["return_type"] = vf::JsonValue(return_type);
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
            const std::string value_type = string_field(
                value.as_object(), "type", "raise expression value");
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
            if ((name == "i" || name == "j") && !env.contains(name)) {
                auto out = node("complex_const");
                out["real"] = vf::JsonValue(0.0);
                out["imag"] = vf::JsonValue(1.0);
                out["type"] = vf::JsonValue("num");
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
            const bool spilled_time = std::find(
                spilled_modules_.begin(), spilled_modules_.end(), "time") != spilled_modules_.end();
            if (spilled_time && !env.contains(name) &&
                (name == "monotonic_seconds" || name == "wall_seconds" ||
                 name == "sleep_seconds" || name == "local_parts")) {
                return stdlib_function("time", name);
            }
            auto out = node("load");
            out["name"] = vf::JsonValue(name);
            out["type"] = vf::JsonValue(env.get(name));
            return vf::JsonValue(std::move(out));
        }
        if (kind == "call") {
            const auto& callee_ast = object_of(field(object, "callee", "call"), "call.callee");
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
            if (string_field(callee_ast, "kind", "call.callee") == "identifier") {
                primitive_callee = primitive_type_name(
                    string_field(callee_ast, "name", "call.callee"), env);
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
            for (const auto& arg : array_of(field(object, "args", "call"), "call.args")) {
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
            if (string_field(callee_ast, "kind", "call.callee") == "attribute") {
                const auto& owner_ast = object_of(
                    field(callee_ast, "object", "method callee"), "method owner");
                if (string_field(owner_ast, "kind", "method owner") == "identifier") {
                    const std::string queue_name = string_field(owner_ast, "name", "method owner");
                    const std::string queue_type = env.get(queue_name);
                    const std::string method = string_field(callee_ast, "name", "method callee");
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
            bool structural_paths_present = false;
            std::vector<std::string> structural_paths;
            if (string_field(callee_ast, "kind", "call.callee") == "identifier") {
                const std::string callee_name = primitive_callee.empty()
                    ? string_field(callee_ast, "name", "call.callee")
                    : primitive_callee;
                const FunctionInfo* function = advanced_call_shape
                    ? functions_.get(callee_name)
                    : functions_.get(callee_name, argument_type_names);
                if (function != nullptr) {
                    static const std::set<std::string> elementwise_math_functions{
                        "tan", "sec", "cot", "csc", "sinh", "cosh", "tanh",
                        "lg", "lg2", "asinh", "acosh", "atanh", "atan", "asin",
                        "acos", "atan2", "acot", "asec", "acsc", "gamma", "erf", "log",
                    };
                    const bool spilled_math = std::find(
                        spilled_modules_.begin(), spilled_modules_.end(), "math") != spilled_modules_.end();
                    const auto structural_numeric_type = [](const std::string& type) {
                        return type.rfind("list<", 0) == 0 || type.rfind("tuple<", 0) == 0 ||
                            type.rfind("record{", 0) == 0 ||
                            (type.size() >= 3 && type.front() == '[' && type.back() == ']');
                    };
                    const auto module_separator = callee_name.rfind("__");
                    const std::string math_name = module_separator == std::string::npos
                        ? callee_name : callee_name.substr(module_separator + 2);
                    const bool namespaced_math = callee_name.rfind("__vkf_module_", 0) == 0;
                    elementwise_math_call = (spilled_math || namespaced_math) && !advanced_call_shape &&
                        elementwise_math_functions.count(math_name) &&
                        std::any_of(
                            argument_type_names.begin(), argument_type_names.end(),
                            structural_numeric_type);
                    std::map<std::string, std::string> dimension_bindings;
                    for (std::size_t i = 0; i < argument_type_names.size() && i < function->param_types.size(); ++i) {
                        const auto parameter_vector = vector_type_parts(function->param_types[i]);
                        const auto argument_vector = vector_type_parts(argument_type_names[i]);
                        if (!parameter_vector || !symbolic_shape_name(parameter_vector->shape)) {
                            continue;
                        }
                        std::string concrete_shape;
                        if (argument_vector && decimal_shape(argument_vector->shape)) {
                            concrete_shape = argument_vector->shape;
                        } else if (i < args.size() && args[i].is_object()) {
                            const auto& argument = args[i].as_object();
                            const auto argument_kind = argument.find("kind");
                            const auto items = argument.find("items");
                            if (argument_kind != argument.end() && argument_kind->second.is_string() &&
                                argument_kind->second.as_string() == "list" &&
                                items != argument.end() && items->second.is_array()) {
                                concrete_shape = std::to_string(items->second.as_array().size());
                            }
                        }
                        if (concrete_shape.empty()) continue;
                        const auto existing = dimension_bindings.find(parameter_vector->shape);
                        if (existing != dimension_bindings.end() && existing->second != concrete_shape) {
                            throw IRFailure("conflicting vector dimension " + parameter_vector->shape +
                                " for function " + callee_name);
                        }
                        dimension_bindings[parameter_vector->shape] = concrete_shape;
                    }
                    std::vector<std::string> instantiated_params = function->param_types;
                    for (auto& parameter_type : instantiated_params) {
                        parameter_type = instantiate_vector_type(parameter_type, dimension_bindings);
                    }
                    const std::string instantiated_return =
                        instantiate_vector_type(function->return_type, dimension_bindings);
                    const std::string structural_parameter = instantiated_params.empty()
                        ? std::string{} : resolve_type_alias(instantiated_params.front());
                    const std::string structural_result = resolve_type_alias(instantiated_return);
                    if (!elementwise_math_call && !advanced_call_shape && args.size() == 1 &&
                        instantiated_params.size() == 1 &&
                        !structurally_compatible_type(
                            resolve_type_alias(argument_type_names.front()), structural_parameter) &&
                        structural_container_type(resolve_type_alias(argument_type_names.front()))) {
                        structural_call = true;
                    }
                    callee.as_object()["name"] = vf::JsonValue(functions_.runtime_name(*function));
                    callee_type = function_signature_type(instantiated_params, instantiated_return);
                    callee.as_object()["type"] = vf::JsonValue(callee_type);
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
                            if (!is_variadic && !elementwise_math_call && !structural_call) {
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
                    } else if (structural_call) {
                        call_type = structurally_lifted_result_type(
                            resolve_type_alias(argument_type_names.front()),
                            structural_parameter,
                            structural_result);
                        structural_paths_present = true;
                        collect_structural_match_paths(
                            resolve_type_alias(argument_type_names.front()),
                            structural_parameter,
                            "",
                            structural_paths);
                    }
                } else if (functions_.contains(callee_name)) {
                    throw IRFailure("no matching overload for function " + callee_name);
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
                string_field(callee_ir, "module", "call callee IR") == "math" &&
                arg_types.size() == 1 && arg_types.front().is_string()) {
                const std::string argument_type = arg_types.front().as_string();
                if (vector_type_parts(argument_type) ||
                    maybe_dynamic_list_element_type(argument_type) ||
                    argument_type.rfind("tuple<", 0) == 0 ||
                    argument_type.rfind("record{", 0) == 0) {
                    call_type = structurally_lifted_result_type(
                        resolve_type_alias(argument_type), "num", "num");
                    structural_paths_present = true;
                    collect_structural_match_paths(
                        resolve_type_alias(argument_type), "num", "", structural_paths);
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
            if (elementwise_math_call) out["elementwise_math"] = vf::JsonValue(true);
            if (structural_call) out["structural_call"] = vf::JsonValue(true);
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
            if (const FunctionInfo* function = functions_.get(overload_name, {operand_type});
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
            if (try_fold_range_expr(object, folded)) {
                return folded;
            }
            auto out = node("range");
            const auto& raw_start = field(object, "start", "range_expr");
            const auto& raw_end = field(object, "end", "range_expr");
            out["start"] = raw_start.is_null() ? num_const(0.0) : lower_expr(raw_start, env);
            out["end"] = raw_end.is_null() ? vf::JsonValue(nullptr) : lower_expr(raw_end, env);
            out["infinite"] = vf::JsonValue(raw_end.is_null());
            out["type"] = vf::JsonValue("range<num>");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "pipe_chain") {
            vf::JsonValue folded;
            if (try_fold_pipe_chain_expr(object, env, functions_, folded)) {
                return folded;
            }
            vf::JsonValue source = lower_expr(field(object, "source", "pipe_chain"), env);
            const std::string source_type = string_field(source.as_object(), "type", "pipe source");
            std::string element_type = "any";
            if (!source_type.empty() && source_type.front() == '[') {
                const auto colon = source_type.find(':');
                const auto close = source_type.rfind(']');
                if (close != std::string::npos) {
                    element_type = source_type.substr(1, (colon == std::string::npos ? close : colon) - 1);
                }
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
            } else if (source_type == "range<num>") {
                element_type = "num";
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
            if (!source_type.empty() && source_type.front() == '[') {
                const auto colon = source_type.find(':');
                if (colon != std::string::npos) result_type = "[" + result_element_type + source_type.substr(colon);
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
            } else if (source_type == "range<num>") {
                result_type = "list<" + result_element_type + ">";
            } else if (source_type == "num" || source_type == "int" ||
                       source_type == "f32" || source_type == "f64" ||
                       source_type == "bit" || source_type == "chr" ||
                       source_type == "null") {
                result_type = result_element_type;
            }
            auto out = node("pipe_chain");
            out["source"] = std::move(source);
            out["segments"] = vf::JsonValue(std::move(segments));
            out["type"] = vf::JsonValue(result_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "block") {
            const auto& statements = array_of(field(object, "statements", "block"), "block.statements");
            vf::JsonValue::Array lowered;
            TypeEnv block_env = env;
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
            const auto numeric_scalar = [](const std::string& type) {
                return type == "int" || type == "num" || type == "f32" || type == "f64";
            };
            const bool scalar_builtin = (numeric_scalar(left_type) && numeric_scalar(right_type))
                || (left_type == "bit" && right_type == "bit")
                || (left_type == "str" && right_type == "str");
            const std::string overload_name = op == "PLUS" ? "+" : op == "MINUS" ? "-"
                : op == "STAR" ? "*" : op == "SLASH" ? "/"
                : op == "FLOORDIV" ? "//" : op == "PERCENT" ? "%"
                : op == "CARET" ? "^" : op == "AMPERSAND" ? "&" : "";
            if (const FunctionInfo* function = functions_.get(
                    overload_name, {left_type, right_type});
                function != nullptr && !scalar_builtin && left_type != "any" && right_type != "any") {
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
            auto out = node("binary_op");
            out["op"] = vf::JsonValue(op);
            out["left"] = std::move(left);
            out["right"] = std::move(right);
            out["left_type"] = vf::JsonValue(left_type);
            out["right_type"] = vf::JsonValue(right_type);
            const std::string result_type = binary_result_type(op, left_type, right_type);
            out["type"] = vf::JsonValue(result_type);
            if (result_type == "symbolic") {
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
                const std::string function_surface = primitive == "bit" ? "(any) -> bit"
                    : primitive == "chr" ? "(any) -> chr"
                    : primitive == "int" ? "(any) -> int"
                    : primitive == "num" ? "(any, any = 0) -> num"
                    : primitive == "str" ? "(any) -> str" : "";
                if (!function_surface.empty()) {
                    auto out = node("const");
                    out["type"] = vf::JsonValue("str");
                    out["value"] = vf::JsonValue(function_surface);
                    return vf::JsonValue(std::move(out));
                }
            }
            vf::JsonValue lowered_value = lower_expr(raw_value, env);
            const std::string value_type = string_field(lowered_value.as_object(), "type", "type_of.value");
            std::string surface_type = render_surface_type(value_type);
            const auto& lowered_object = lowered_value.as_object();
            if (string_field(lowered_object, "kind", "type_of.value") == "list" &&
                value_type.rfind("list<", 0) == 0 && !value_type.empty() && value_type.back() == '>') {
                const auto& items = array_of(field(lowered_object, "items", "type_of list"), "type_of list items");
                surface_type = "[" + render_surface_type(value_type.substr(5, value_type.size() - 6)) +
                    ":" + std::to_string(items.size()) + "]";
            }
            auto out = node("const");
            out["type"] = vf::JsonValue("str");
            out["value"] = vf::JsonValue(surface_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "bind_expr") {
            vf::JsonValue value = lower_expr(field(object, "value", "bind expression"), env);
            const std::string type = string_field(value.as_object(), "type", "bind expression");
            const std::string name = string_field(object, "name", "bind expression");
            env.set(name, type);
            auto out = node("bind_expr");
            out["name"] = vf::JsonValue(name);
            out["value"] = std::move(value);
            out["type"] = vf::JsonValue(type);
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
            vf::JsonValue::Array items;
            std::string element_type = "any";
            bool first = true;
            for (const auto& item : array_of(field(object, "items", kind), kind + ".items")) {
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
                    vf::JsonValue range_value = lower_expr(item, env);
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
            const std::string container_type = "list<" + element_type + ">";
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
            for (const auto& pair_value : pairs) {
                const auto& pair_object = object_of(pair_value, "multiset_pair");
                vf::JsonValue lowered_key = lower_expr(field(pair_object, "key", "multiset_pair"), env);
                vf::JsonValue lowered_count = lower_expr(field(pair_object, "count", "multiset_pair"), env);
                const std::string key_type = string_field(lowered_key.as_object(), "type", "multiset key");
                if (first) {
                    element_type = key_type;
                    first = false;
                } else {
                    element_type = merge_nullable_type(element_type, key_type);
                }
                auto lowered_pair = node("multiset_pair");
                lowered_pair["key"] = std::move(lowered_key);
                lowered_pair["count"] = std::move(lowered_count);
                lowered_pairs.push_back(vf::JsonValue(std::move(lowered_pair)));
            }
            auto out = node("multiset");
            out["pairs"] = vf::JsonValue(std::move(lowered_pairs));
            out["element_type"] = vf::JsonValue(element_type);
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
                if (canonical_module == "errors") {
                    return error_type_value(field_name);
                }
                if (canonical_module == "math") {
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
                if (canonical_module == "stat") {
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
                if (canonical_module == "time") {
                    if (field_name == "monotonic_seconds" || field_name == "wall_seconds" ||
                        field_name == "sleep_seconds" || field_name == "local_parts") {
                        return stdlib_function("time", field_name);
                    }
                    throw IRFailure("unknown stdlib time member " + field_name);
                }
                if (canonical_module == "collections") {
                    if (field_name == "map" || field_name == "list" || field_name == "queue") {
                        return stdlib_function("collections", field_name);
                    }
                    throw IRFailure("unknown stdlib collections member " + field_name);
                }
                if (canonical_module == "io") {
                    if (field_name == "print" || field_name == "eprint" ||
                        field_name == "read_line" || field_name == "read_text" ||
                        field_name == "write_text" || field_name == "read_bytes" ||
                        field_name == "write_bytes" || field_name == "append_text") {
                        return stdlib_function("io", field_name);
                    }
                    throw IRFailure("unknown stdlib io member " + field_name);
                }
                if (canonical_module == "system") {
                    if (field_name == "os_name" || field_name == "arch_name" ||
                        field_name == "cpu_count_native" || field_name == "cwd_native" ||
                        field_name == "env_native") {
                        return stdlib_function("system", field_name);
                    }
                    throw IRFailure("unknown stdlib system member " + field_name);
                }
                if (canonical_module == "process") {
                    if (field_name == "run_native" || field_name == "shell_native") {
                        return stdlib_function("process", field_name);
                    }
                    throw IRFailure("unknown stdlib process member " + field_name);
                }
                if (canonical_module == "regex") {
                    if (field_name == "match" || field_name == "groups") {
                        return stdlib_function("regex", field_name);
                    }
                    throw IRFailure("unknown stdlib regex member " + field_name);
                }
            }
            vf::JsonValue object_ir = lower_expr(field(object, "object", "attribute"), env);
            const std::string object_type = string_field(object_ir.as_object(), "type", "attribute object");
            const std::string field_name = string_field(object, "name", "attribute");
            auto out = node("field_access");
            out["field"] = vf::JsonValue(field_name);
            out["object"] = std::move(object_ir);
            out["object_type"] = vf::JsonValue(object_type);
            out["type"] = vf::JsonValue(field_type_from_record(object_type, field_name));
            return vf::JsonValue(std::move(out));
        }
        if (kind == "dotted_index") {
            vf::JsonValue base = lower_expr(field(object, "base", "dotted_index"), env);
            std::string result_type = string_field(base.as_object(), "type", "dotted_index.base");
            vf::JsonValue::Array indices;
            for (const auto& index_ast : array_of(field(object, "indices", "dotted_index"), "dotted_index.indices")) {
                indices.push_back(lower_expr(index_ast, env));
                if (starts_with(result_type, "list<") && result_type.back() == '>') {
                    result_type = result_type.substr(5, result_type.size() - 6);
                } else if (result_type.size() >= 2 && result_type.front() == '[' && result_type.back() == ']') {
                    const std::string inner = result_type.substr(1, result_type.size() - 2);
                    const auto shape = inner.rfind(':');
                    result_type = shape == std::string::npos ? inner : inner.substr(0, shape);
                } else {
                    result_type = "any";
                }
            }
            auto out = node("dotted_index");
            out["base"] = std::move(base);
            out["indices"] = vf::JsonValue(std::move(indices));
            out["type"] = vf::JsonValue(result_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "match_stmt") {
            vf::JsonValue discriminant = lower_expr(field(object, "discriminant", "match_stmt"), env);
            const auto& catch_value = field(object, "catch", "match_stmt");
            const bool catch_errors = catch_value.is_boolean() && catch_value.as_boolean();
            vf::JsonValue::Array arms;
            for (const auto& arm_value : array_of(field(object, "arms", "match_stmt"), "match_stmt.arms")) {
                const auto& arm = object_of(arm_value, "match arm");
                auto lowered_arm = node("match_arm");
                const vf::JsonValue& cond_ast = field(arm, "condition", "match arm");
                lowered_arm["condition"] = cond_ast.is_null() ? vf::JsonValue(nullptr) : lower_expr(cond_ast, env);
                const vf::JsonValue& body_ast = field(arm, "body", "match arm");
                TypeEnv body_env = env;
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
            out["loop"] = field(object, "loop", "match_stmt");
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
        if (left_type == "symbolic" || right_type == "symbolic") {
            return "symbolic";
        }
        if (left_is_axis && right_is_axis) {
            if (left_axis == right_axis) {
                return axis_tagged_type(left_axis, binary_result_type(op, left_value_type, right_value_type));
            }
            if ((op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH")
                && starts_with(left_value_type, "list<") && starts_with(right_value_type, "list<")) {
                const auto outer_value_type = [&](const auto& self,
                                                  const std::string& left_value,
                                                  const std::string& right_value) -> std::string {
                    if (starts_with(left_value, "list<") && left_value.back() == '>') {
                        return "list<" + self(
                            self,
                            left_value.substr(5, left_value.size() - 6),
                            right_value) + ">";
                    }
                    if (starts_with(right_value, "list<") && right_value.back() == '>') {
                        return "list<" + self(
                            self,
                            left_value,
                            right_value.substr(5, right_value.size() - 6)) + ">";
                    }
                    return "num";
                };
                return axis_tagged_type(
                    left_axis + right_axis,
                    outer_value_type(outer_value_type, left_value_type, right_value_type));
            }
            return "any";
        }
        if (op == "EQ" || op == "EXACT_EQ" || op == "NEQ" || op == "STRUCT_NEQ"
            || op == "LT" || op == "LE" || op == "GT" || op == "GE"
            || op == "AND" || op == "OR" || op == "XOR") {
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
        const auto numeric_scalar = [](const std::string& type) {
            return type == "int" || type == "num" || type == "f32" || type == "f64";
        };
        if (!left_multiset.empty() && numeric_scalar(right_type) &&
            (op == "PLUS" || op == "MINUS" || op == "FLOORDIV")) {
            return left_type;
        }
        if (!right_multiset.empty() && numeric_scalar(left_type) && op == "PLUS") {
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
            if ((op == "PLUS" || op == "MINUS" || op == "STAR" || op == "FLOORDIV" || op == "PERCENT")
                && left_type == "int" && right_type == "int") {
                return "int";
            }
            if (numeric_scalar(left_type) && numeric_scalar(right_type)) {
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
    std::map<std::string, std::string> imported_modules_;
    std::vector<std::string> spilled_modules_;
    bool symbolic_imported_ = false;
    std::uint64_t next_lambda_local_ = 0;
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

vf::JsonValue tuple_of_numbers(const std::vector<double>& values) {
    vf::JsonValue::Array items;
    std::string type = "tuple<";
    for (std::size_t index = 0; index < values.size(); ++index) {
        if (index != 0) type += ",";
        type += "num";
        items.push_back(num_const(values[index]));
    }
    type += ">";
    auto out = node("tuple");
    out["items"] = vf::JsonValue(std::move(items));
    out["element_type"] = vf::JsonValue("num");
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
    out_value = tuple_of_numbers(values);
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
            current = eval_pipe_segment_expr(segment, locals, functions);
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
