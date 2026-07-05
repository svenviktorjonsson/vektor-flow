#include "native/VfOverlay/vf/json.hpp"
#include "compiler/native/vkf_symbolic_lowering.hpp"

#include <cctype>
#include <map>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
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

private:
    std::vector<Binding> bindings_;
};

class FunctionTable {
public:
    void set(FunctionInfo info) {
        for (auto& existing : functions_) {
            if (existing.name == info.name) {
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
    out["type"] = vf::JsonValue("fn(any)->any");
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
    return string_field(object, "name", "type annotation");
}

vf::JsonValue coerce_value_to_type(vf::JsonValue value, const std::string& target_type, const std::string& context) {
    if (target_type == "any") {
        return value;
    }
    auto& object = const_cast<vf::JsonValue::Object&>(object_of(value, context));
    const std::string source_type = string_field(object, "type", context);
    if (source_type == target_type || source_type == "null") {
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
    return "any";
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
                vf::JsonValue value = lower_expr(field(object, "value", "bind"), env);
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
                env.set(name, value_type);

                auto out = node("store_binding");
                out["name"] = vf::JsonValue(name);
                out["type"] = vf::JsonValue(value_type);
                out["value"] = std::move(value);
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
            return vf::JsonValue(std::move(out));
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
            function_env.set(param_name, param_type);
            param_names.push_back(param_name);
            param_types.push_back(param_type);
            const auto default_it = param.find("default");
            if (default_it == param.end() || default_it->second.is_null()) {
                param_defaults.push_back(vf::JsonValue(nullptr));
            } else {
                param_defaults.push_back(coerce_value_to_type(lower_expr(default_it->second, function_env), param_type, "param default"));
            }
            variadic_positional.push_back(
                optional_bool_field(param, "variadic_positional")
            );
            variadic_named.push_back(
                optional_bool_field(param, "variadic_named")
            );

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

        auto out = node("function");
        out["body"] = lower_body(field(object, "body", "function_definition"), function_env);
        out["name"] = vf::JsonValue(name);
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
            auto out = node("const");
            out["type"] = vf::JsonValue("str");
            out["value"] = field(object, "value", "string_literal");
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
        if (kind == "identifier") {
            const std::string name = string_field(object, "name", "identifier");
            auto out = node("load");
            out["name"] = vf::JsonValue(name);
            out["type"] = vf::JsonValue(env.get(name));
            return vf::JsonValue(std::move(out));
        }
        if (kind == "call") {
            vf::JsonValue callee = lower_expr(field(object, "callee", "call"), env);
            vf::JsonValue::Array args;
            vf::JsonValue::Array arg_types;
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
                arg_types.push_back(field(lowered_arg.as_object(), "type", "call arg"));
                args.push_back(std::move(lowered_arg));
            }
            const std::string callee_type = string_field(callee.as_object(), "type", "call callee");
            std::string call_type = "any";
            const auto& callee_ast = object_of(field(object, "callee", "call"), "call.callee");
            if (string_field(callee_ast, "kind", "call.callee") == "identifier") {
                const std::string callee_name = string_field(callee_ast, "name", "call.callee");
                if (const FunctionInfo* function = functions_.get(callee_name)) {
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
                            if (!is_variadic) {
                                args[i] = coerce_value_to_type(std::move(args[i]), function->param_types[i], "call arg");
                                arg_types[i] = vf::JsonValue(function->param_types[i]);
                            }
                        }
                    }
                    call_type = function->return_type;
                }
            }
            if (call_type == "any") {
                const std::size_t arrow = callee_type.find("->");
                if (arrow != std::string::npos && arrow + 2 < callee_type.size()) {
                    call_type = callee_type.substr(arrow + 2);
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
            return vf::JsonValue(std::move(out));
        }
        if (kind == "unary_op") {
            vf::JsonValue operand = lower_expr(field(object, "operand", "unary_op"), env);
            const std::string operand_type = string_field(operand.as_object(), "type", "unary_op.operand");
            const std::string op = string_field(object, "op", "unary_op");
            auto out = node("unary_op");
            out["op"] = vf::JsonValue(op);
            out["operand"] = std::move(operand);
            out["operand_type"] = vf::JsonValue(operand_type);
            out["type"] = vf::JsonValue(op == "NOT" ? "bit" : operand_type);
            return vf::JsonValue(std::move(out));
        }
        if (kind == "range_expr") {
            vf::JsonValue folded;
            if (try_fold_range_expr(object, folded)) {
                return folded;
            }
            throw IRFailure("unsupported range_expr for native typed IR subset");
        }
        if (kind == "pipe_chain") {
            vf::JsonValue folded;
            if (try_fold_pipe_chain_expr(object, env, functions_, folded)) {
                return folded;
            }
            throw IRFailure("unsupported pipe_chain for native typed IR subset");
        }
        if (kind == "block") {
            const auto& statements = array_of(field(object, "statements", "block"), "block.statements");
            vf::JsonValue::Array lowered;
            TypeEnv block_env = env;
            for (const auto& stmt : statements) {
                lowered.push_back(lower_stmt(stmt, block_env));
            }
            auto out = node("block_expr");
            out["body"] = vf::JsonValue(std::move(lowered));
            out["type"] = vf::JsonValue("any");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "binary_op") {
            vf::JsonValue left = lower_expr(field(object, "left", "binary_op"), env);
            vf::JsonValue right = lower_expr(field(object, "right", "binary_op"), env);
            const std::string left_type = string_field(left.as_object(), "type", "binary_op.left");
            const std::string right_type = string_field(right.as_object(), "type", "binary_op.right");
            const std::string op = string_field(object, "op", "binary_op");
            const bool scalar_builtin = ((left_type == "num" || left_type == "int") && (right_type == "num" || right_type == "int"))
                || (left_type == "bit" && right_type == "bit")
                || (left_type == "str" && right_type == "str");
            if (const FunctionInfo* function = functions_.get(op);
                function != nullptr && !scalar_builtin && left_type != "any" && right_type != "any") {
                auto call = node("call");
                vf::JsonValue::Array args;
                vf::JsonValue::Array arg_types;
                args.push_back(std::move(left));
                args.push_back(std::move(right));
                arg_types.push_back(vf::JsonValue(left_type));
                arg_types.push_back(vf::JsonValue(right_type));
                auto callee = node("load");
                callee["name"] = vf::JsonValue(op);
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
            vf::JsonValue lowered_value = lower_expr(field(object, "value", "type_of"), env);
            const std::string value_type = string_field(lowered_value.as_object(), "type", "type_of.value");
            auto out = node("const");
            out["type"] = vf::JsonValue("str");
            out["value"] = vf::JsonValue(render_surface_type(value_type));
            return vf::JsonValue(std::move(out));
        }
        if (kind == "abs_expr") {
            vf::JsonValue folded;
            if (try_fold_abs_expr(object, env, folded)) {
                return folded;
            }
            throw IRFailure("unsupported abs_expr for native typed IR subset");
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
                vf::JsonValue lowered_item = lower_expr(elements[i], env);
                const std::string item_type = string_field(lowered_item.as_object(), "type", "tuple item");
                if (i > 0) {
                    tuple_type += ",";
                }
                tuple_type += item_type;
                items.push_back(std::move(lowered_item));
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
                if (module_name == "math") {
                    if (field_name == "pi") {
                        return num_const(3.141592653589793);
                    }
                    if (field_name == "tau") {
                        return num_const(6.283185307179586);
                    }
                    if (field_name == "sqrt" || field_name == "sin" || field_name == "cos" || field_name == "exp") {
                        return stdlib_function("math", field_name);
                    }
                    throw IRFailure("unknown stdlib math member " + field_name);
                }
                if (module_name == "stat") {
                    if (field_name == "mean"
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
                if (module_name == "collections") {
                    if (field_name == "map" || field_name == "list" || field_name == "queue") {
                        return stdlib_function("collections", field_name);
                    }
                    throw IRFailure("unknown stdlib collections member " + field_name);
                }
                if (module_name == "io") {
                    if (field_name == "print") {
                        return stdlib_function("io", "print");
                    }
                    throw IRFailure("unknown stdlib io member " + field_name);
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
            vf::JsonValue::Array indices;
            for (const auto& index_ast : array_of(field(object, "indices", "dotted_index"), "dotted_index.indices")) {
                indices.push_back(lower_expr(index_ast, env));
            }
            auto out = node("dotted_index");
            out["base"] = std::move(base);
            out["indices"] = vf::JsonValue(std::move(indices));
            out["type"] = vf::JsonValue("any");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "match_stmt") {
            vf::JsonValue discriminant = lower_expr(field(object, "discriminant", "match_stmt"), env);
            vf::JsonValue::Array arms;
            for (const auto& arm_value : array_of(field(object, "arms", "match_stmt"), "match_stmt.arms")) {
                const auto& arm = object_of(arm_value, "match arm");
                auto lowered_arm = node("match_arm");
                const vf::JsonValue& cond_ast = field(arm, "condition", "match arm");
                lowered_arm["condition"] = cond_ast.is_null() ? vf::JsonValue(nullptr) : lower_expr(cond_ast, env);
                const vf::JsonValue& body_ast = field(arm, "body", "match arm");
                if (kind_of(body_ast) == "block") {
                    TypeEnv body_env = env;
                    lowered_arm["body"] = lower_body(body_ast, body_env);
                } else {
                    lowered_arm["body"] = lower_expr(body_ast, env);
                }
                arms.push_back(vf::JsonValue(std::move(lowered_arm)));
            }
            auto out = node("match_stmt");
            out["discriminant"] = std::move(discriminant);
            out["arms"] = vf::JsonValue(std::move(arms));
            out["loop"] = field(object, "loop", "match_stmt");
            out["catch"] = field(object, "catch", "match_stmt");
            out["type"] = vf::JsonValue("any");
            return vf::JsonValue(std::move(out));
        }
        if (kind == "struct_identity") {
            auto out = node("scope_identity");
            out["type"] = vf::JsonValue("any");
            return vf::JsonValue(std::move(out));
        }
        throw IRFailure("unsupported AST kind " + kind);
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
                return axis_tagged_type(left_axis + right_axis, "list<list<num>>");
            }
            return "any";
        }
        if (op == "EQ" || op == "EXACT_EQ" || op == "NEQ" || op == "STRUCT_NEQ"
            || op == "LT" || op == "LE" || op == "GT" || op == "GE"
            || op == "AND" || op == "OR" || op == "XOR") {
            return "bit";
        }
        if (op == "AMPERSAND") {
            return "str";
        }
        if (op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH"
            || op == "FLOORDIV" || op == "PERCENT" || op == "CARET") {
            if ((op == "PLUS" || op == "MINUS" || op == "STAR" || op == "FLOORDIV" || op == "PERCENT")
                && left_type == "int" && right_type == "int") {
                return "int";
            }
            if ((left_type == "int" || left_type == "num") && (right_type == "int" || right_type == "num")) {
                return "num";
            }
            if (left_type == "num" && right_type == "num") {
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
    bool symbolic_imported_ = false;
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
    out_value = list_of_numbers(values);
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

int main(int argc, char** argv) {
    try {
        Lowerer lowerer;
        std::cout << vf::json_stringify(lowerer.lower_module(vf::parse_json(input_text(argc, argv))), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<ast-to-ir>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
