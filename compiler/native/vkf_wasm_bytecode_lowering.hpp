#pragma once

#include "compiler/native/vkf_wasm_bytecode.hpp"
#include "compiler/native/vkf_wasm_typed_ir.hpp"
#include "compiler/native/vkf_symbolic_value_encoding.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vkf::wasm::bytecode {

class BytecodeLoweringError : public std::runtime_error {
public:
    explicit BytecodeLoweringError(std::string message)
        : std::runtime_error(std::move(message)) {}
};

namespace lowering_detail {

inline bool symbolic_expression_surface_type(const std::string& type) {
    return type == "symbolic" || type == "expression" || type == "symbol" ||
        type == "constant" || type == "relation" || type == "proposition";
}

inline const vf::JsonValue::Object& object_of(
    const vf::JsonValue& value,
    const std::string& context
) {
    if (!value.is_object()) {
        throw BytecodeLoweringError("expected object for " + context);
    }
    return value.as_object();
}

inline const vf::JsonValue::Array& array_of(
    const vf::JsonValue& value,
    const std::string& context
) {
    if (!value.is_array()) {
        throw BytecodeLoweringError("expected array for " + context);
    }
    return value.as_array();
}

inline const vf::JsonValue& field(
    const vf::JsonValue::Object& object,
    const std::string& name,
    const std::string& context
) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw BytecodeLoweringError(
            "missing field " + name + " in " + context
        );
    }
    return found->second;
}

inline std::string string_field(
    const vf::JsonValue::Object& object,
    const std::string& name,
    const std::string& context
) {
    const auto& value = field(object, name, context);
    if (!value.is_string() || value.as_string().empty()) {
        throw BytecodeLoweringError(
            "expected non-empty string field " + name + " in " + context
        );
    }
    return value.as_string();
}

inline const vf::JsonValue* optional_field(
    const vf::JsonValue::Object& object,
    const std::string& name
) {
    const auto found = object.find(name);
    return found == object.end() ? nullptr : &found->second;
}

inline std::uint32_t checked_index(
    std::size_t value,
    const std::string& context
) {
    if (value > std::numeric_limits<std::uint32_t>::max()) {
        throw BytecodeLoweringError(context + " exceeds bytecode index range");
    }
    return static_cast<std::uint32_t>(value);
}

inline ValueType lower_type(
    const std::string& type,
    const std::string& context
) {
    if (type == "num" || type == "f32" || type == "f64"
        || type == "i32" || type == "i64") {
        return ValueType::Number;
    }
    if (type == "bool") {
        return ValueType::Boolean;
    }
    if (type == "str" || type == "string") {
        return ValueType::String;
    }
    if (symbolic_expression_surface_type(type)) {
        return ValueType::Array;
    }
    if (type == "any" || type == "dynamic" || type == "null") {
        return ValueType::Dynamic;
    }
    if (type == "void" || type == "unit") {
        return ValueType::Void;
    }
    if (type.rfind("list<", 0) == 0) {
        return ValueType::Array;
    }
    if (type.rfind("record{", 0) == 0) {
        return ValueType::Object;
    }
    // Named aliases are represented by tagged dynamic values at this layer.
    if (type.find_first_of("<>{}(),") == std::string::npos) {
        return ValueType::Dynamic;
    }
    throw BytecodeLoweringError("unsupported type " + type + " in " + context);
}

inline Opcode lower_binary_opcode(
    const std::string& op,
    const std::string& context
) {
    if (op == "PLUS" || op == "+") return Opcode::Add;
    if (op == "MINUS" || op == "-") return Opcode::Subtract;
    if (op == "STAR" || op == "*") return Opcode::Multiply;
    if (op == "SLASH" || op == "/") return Opcode::Divide;
    if (op == "FLOORDIV" || op == "//") return Opcode::FloorDivide;
    if (op == "PERCENT" || op == "%") return Opcode::Remainder;
    if (op == "CARET" || op == "^") return Opcode::Power;
    if (op == "AMPERSAND" || op == "&") return Opcode::StringConcat;
    if (op == "EQ" || op == "EXACT_EQ" || op == "==") {
        return Opcode::Equal;
    }
    if (op == "NE" || op == "NEQ" || op == "STRUCT_NEQ" || op == "!=") {
        return Opcode::NotEqual;
    }
    if (op == "LT" || op == "<") return Opcode::Less;
    if (op == "LE" || op == "<=") return Opcode::LessEqual;
    if (op == "GT" || op == ">") return Opcode::Greater;
    if (op == "GE" || op == ">=") return Opcode::GreaterEqual;
    if (op == "AMPERSAND" || op == "&") {
        throw BytecodeLoweringError(
            "missing bytecode opcode contract for collection/string "
            "concatenation in " + context
        );
    }
    throw BytecodeLoweringError(
        "unsupported binary operator " + op + " in " + context
    );
}

inline bool comparison_opcode(Opcode opcode) {
    return opcode == Opcode::Equal
        || opcode == Opcode::NotEqual
        || opcode == Opcode::Less
        || opcode == Opcode::LessEqual
        || opcode == Opcode::Greater
        || opcode == Opcode::GreaterEqual;
}

struct ConstantBinding {
    std::uint32_t constant_index = 0;
    ValueType type = ValueType::Dynamic;
};

struct FunctionBinding {
    std::uint32_t function_index = 0;
    std::uint32_t arity = 0;
    std::uint32_t minimum_arity = 0;
    ValueType return_type = ValueType::Dynamic;
    std::vector<const vf::JsonValue*> default_arguments;
};

class Lowerer {
public:
    explicit Lowerer(const TypedModule& typed_module)
        : typed_module_(typed_module) {}

    Module lower() {
        predeclare_functions();
        collect_referenced_globals();
        predeclare_constants();
        lower_functions();
        validate(module_);
        return module_;
    }

private:
    struct FunctionState {
        Function* function = nullptr;
        std::map<std::string, std::uint32_t> locals;
        std::string context;
        bool returned = false;
        std::uint32_t next_temporary = 0;
    };

    std::uint32_t intern_constant(Constant constant) {
        for (std::size_t index = 0; index < module_.constants.size(); ++index) {
            if (module_.constants[index] == constant) {
                return checked_index(index, "constant pool");
            }
        }
        const auto index = checked_index(
            module_.constants.size(),
            "constant pool"
        );
        module_.constants.push_back(std::move(constant));
        return index;
    }

    ValueType expression_type(
        const vf::JsonValue::Object& expression,
        const std::string& context
    ) const {
        const auto* type = optional_field(expression, "type");
        if (type == nullptr) {
            return ValueType::Dynamic;
        }
        if (!type->is_string()) {
            throw BytecodeLoweringError(
                "expected string field type in " + context
            );
        }
        return lower_type(type->as_string(), context);
    }

    ConstantBinding literal_constant(
        const vf::JsonValue& expression,
        const std::string& context
    ) {
        const auto& object = object_of(expression, context);
        const std::string kind = string_field(object, "kind", context);
        if (kind != "const") {
            throw BytecodeLoweringError(
                "top-level binding requires const value in " + context
            );
        }
        const auto& value = field(object, "value", context);
        const ValueType declared_type = expression_type(object, context);
        if (value.is_number()) {
            return {
                intern_constant(Constant::number_value(value.as_number())),
                declared_type == ValueType::Dynamic
                    ? ValueType::Number
                    : declared_type,
            };
        }
        if (value.is_string()) {
            return {
                intern_constant(Constant::utf8_string(value.as_string())),
                declared_type == ValueType::Dynamic
                    ? ValueType::String
                    : declared_type,
            };
        }
        if (value.is_boolean()) {
            return {
                intern_constant(Constant::number_value(
                    value.as_boolean() ? 1.0 : 0.0
                )),
                ValueType::Boolean,
            };
        }
        if (value.is_null()) {
            throw BytecodeLoweringError(
                "null top-level constants cannot be represented by the "
                "current constant pool in " + context
            );
        }
        throw BytecodeLoweringError(
            "unsupported scalar constant in " + context
        );
    }

    void predeclare_functions() {
        module_.functions.reserve(typed_module_.functions.size());
        for (std::size_t index = 0;
             index < typed_module_.functions.size();
             ++index) {
            const auto& declaration = typed_module_.functions[index];
            const auto& object = object_of(
                declaration.declaration,
                "function " + declaration.name
            );
            const auto& params = array_of(
                field(object, "params", "function " + declaration.name),
                "function " + declaration.name + ".params"
            );
            const std::string return_type_name = string_field(
                object,
                "return_type",
                "function " + declaration.name
            );
            Function function;
            function.name_constant = intern_constant(
                Constant::utf8_string(declaration.name)
            );
            function.parameter_count = checked_index(
                params.size(),
                "function parameter count"
            );
            function.return_type = lower_type(
                return_type_name,
                "function " + declaration.name + ".return_type"
            );
            const auto function_index = checked_index(
                module_.functions.size(),
                "function table"
            );
            std::vector<const vf::JsonValue*> default_arguments(
                params.size(),
                nullptr
            );
            std::size_t minimum_arity = params.size();
            for (std::size_t param_index = 0;
                 param_index < params.size();
                 ++param_index) {
                const auto& param = object_of(
                    params[param_index],
                    "function " + declaration.name + ".params["
                        + std::to_string(param_index) + "]"
                );
                const auto* default_value = optional_field(param, "default");
                if (default_value != nullptr && !default_value->is_null()) {
                    default_arguments[param_index] = default_value;
                    minimum_arity = std::min(minimum_arity, param_index);
                }
            }
            function_bindings_.emplace(
                declaration.name,
                FunctionBinding{
                    function_index,
                    function.parameter_count,
                    checked_index(minimum_arity, "minimum function arity"),
                    function.return_type,
                    std::move(default_arguments),
                }
            );
            module_.functions.push_back(std::move(function));
        }
    }

    void predeclare_constants() {
        for (const auto& binding : typed_module_.runtime_bindings) {
            if (referenced_globals_.find(binding.name)
                == referenced_globals_.end()) {
                continue;
            }
            const std::string context =
                "top-level binding " + binding.name;
            constant_bindings_.emplace(
                binding.name,
                literal_constant(binding.value, context)
            );
        }
    }

    void collect_referenced_globals() {
        for (const auto& function : typed_module_.functions) {
            collect_load_names(function.declaration);
        }
    }

    void collect_load_names(const vf::JsonValue& value) {
        if (value.is_array()) {
            for (const auto& item : value.as_array()) {
                collect_load_names(item);
            }
            return;
        }
        if (!value.is_object()) {
            return;
        }
        const auto& object = value.as_object();
        const auto kind = object.find("kind");
        const auto name = object.find("name");
        if (kind != object.end() && kind->second.is_string()
            && kind->second.as_string() == "load"
            && name != object.end() && name->second.is_string()) {
            referenced_globals_.insert(name->second.as_string());
        }
        for (const auto& entry : object) {
            collect_load_names(entry.second);
        }
    }

    void lower_functions() {
        for (std::size_t index = 0;
             index < typed_module_.functions.size();
             ++index) {
            lower_function(
                typed_module_.functions[index],
                module_.functions[index]
            );
        }
    }

    void add_local(
        FunctionState& state,
        const std::string& name,
        ValueType type,
        const std::string& context
    ) {
        // VKF uses lexical scope: a function-local declaration may shadow a
        // module binding or function. Loads already resolve locals first, so
        // only a second declaration in the same local scope is a duplicate.
        if (state.locals.find(name) != state.locals.end()) {
            throw BytecodeLoweringError(
                "duplicate local name " + name + " in " + context
            );
        }
        const auto index = checked_index(
            state.function->local_types.size(),
            "local table"
        );
        state.locals.emplace(name, index);
        state.function->local_types.push_back(type);
    }

    void lower_function(
        const FunctionDeclaration& declaration,
        Function& function
    ) {
        const std::string context = "function " + declaration.name;
        const auto& object = object_of(declaration.declaration, context);
        const auto& params = array_of(
            field(object, "params", context),
            context + ".params"
        );
        FunctionState state{&function, {}, context, false, 0};
        for (std::size_t index = 0; index < params.size(); ++index) {
            const std::string param_context =
                context + ".params[" + std::to_string(index) + "]";
            const auto& param = object_of(params[index], param_context);
            if (string_field(param, "kind", param_context) != "param") {
                throw BytecodeLoweringError(
                    "unsupported parameter kind in " + param_context
                );
            }
            add_local(
                state,
                string_field(param, "name", param_context),
                lower_type(
                    string_field(param, "type", param_context),
                    param_context
                ),
                param_context
            );
        }
        lower_function_body(field(object, "body", context), state);
        if (!state.returned) {
            if (function.return_type == ValueType::Dynamic) {
                emit(state, Opcode::PushNull, ValueType::Dynamic);
                emit(state, Opcode::Return, ValueType::Void);
            } else if (function.return_type != ValueType::Void) {
                throw BytecodeLoweringError(
                    "function " + declaration.name
                    + " has no explicit or implicit return"
                );
            } else {
                emit(state, Opcode::PushNull, ValueType::Dynamic);
                emit(state, Opcode::Return, ValueType::Void);
            }
        }
    }

    void lower_function_body(
        const vf::JsonValue& body,
        FunctionState& state,
        bool implicit_return = true
    ) {
        const auto& object = object_of(body, state.context + ".body");
        const std::string kind = string_field(
            object,
            "kind",
            state.context + ".body"
        );
        if (kind != "block") {
            const ValueType type = lower_expression(
                body,
                state,
                state.context + ".body"
            );
            if (!state.returned) {
                if (implicit_return) {
                    emit(state, Opcode::Return, type);
                    state.returned = true;
                } else {
                    emit(state, Opcode::Pop, ValueType::Void);
                }
            }
            return;
        }

        const auto& statements = array_of(
            field(object, "body", state.context + ".body"),
            state.context + ".body.body"
        );
        for (std::size_t index = 0; index < statements.size(); ++index) {
            if (state.returned) {
                throw BytecodeLoweringError(
                    "unreachable statement in " + state.context
                    + ".body.body[" + std::to_string(index) + "]"
                );
            }
            lower_statement(
                statements[index],
                state,
                implicit_return && index + 1 == statements.size(),
                state.context + ".body.body[" + std::to_string(index) + "]"
            );
        }
    }

    void lower_statement(
        const vf::JsonValue& statement,
        FunctionState& state,
        bool is_final,
        const std::string& context
    ) {
        const auto& object = object_of(statement, context);
        const std::string kind = string_field(object, "kind", context);
        if (kind == "store_binding") {
            const std::string name = string_field(object, "name", context);
            const auto* update_field = optional_field(object, "update");
            const bool update = update_field != nullptr
                && update_field->is_boolean()
                && update_field->as_boolean();
            std::uint32_t local_index = 0;
            if (update) {
                const auto local = state.locals.find(name);
                if (local == state.locals.end()) {
                    throw BytecodeLoweringError(
                        "update requires existing local " + name
                        + " in " + context
                    );
                }
                local_index = local->second;
            } else {
                const ValueType type = lower_type(
                    string_field(object, "type", context),
                    context
                );
                add_local(state, name, type, context);
                local_index = state.locals.at(name);
            }
            const ValueType value_type = lower_expression(
                field(object, "value", context),
                state,
                context + ".value"
            );
            emit(
                state,
                Opcode::StoreLocal,
                value_type,
                local_index
            );
            return;
        }
        if (kind == "spill_stmt") {
            const auto& value = object_of(
                field(object, "value", context),
                context + ".value"
            );
            if (string_field(value, "kind", context + ".value")
                != "record") {
                throw BytecodeLoweringError(
                    "WASM spill currently requires a statically known "
                    "record in " + context
                );
            }
            const auto& fields = array_of(
                field(value, "fields", context + ".value"),
                context + ".value.fields"
            );
            for (std::size_t index = 0; index < fields.size(); ++index) {
                const std::string field_context = context + ".value.fields["
                    + std::to_string(index) + "]";
                const auto& record_field = object_of(
                    fields[index],
                    field_context
                );
                if (string_field(record_field, "kind", field_context)
                    != "record_field") {
                    throw BytecodeLoweringError(
                        "WASM spill requires record fields in " + field_context
                    );
                }
                const std::string name = string_field(
                    record_field,
                    "name",
                    field_context
                );
                const ValueType type = lower_type(
                    string_field(record_field, "type", field_context),
                    field_context
                );
                add_local(state, name, type, field_context);
                const ValueType value_type = lower_expression(
                    field(record_field, "value", field_context),
                    state,
                    field_context + ".value"
                );
                emit(
                    state,
                    Opcode::StoreLocal,
                    value_type,
                    state.locals.at(name)
                );
            }
            return;
        }
        if (kind == "expr_stmt") {
            const ValueType type = lower_expression(
                field(object, "expr", context),
                state,
                context + ".expr"
            );
            if (state.returned) {
                return;
            }
            if (is_final) {
                emit(state, Opcode::Return, type);
                state.returned = true;
            } else {
                emit(state, Opcode::Pop, ValueType::Void);
            }
            return;
        }
        if (kind == "return") {
            const auto* value = optional_field(object, "value");
            if (value != nullptr) {
                lower_expression(*value, state, context + ".value");
            } else if (state.function->return_type != ValueType::Void) {
                throw BytecodeLoweringError(
                    "missing return value in " + context
                );
            }
            emit(state, Opcode::Return, ValueType::Void);
            state.returned = true;
            return;
        }
        if (kind == "if_stmt") {
            const auto* loop_field = optional_field(object, "loop");
            const bool loop = loop_field != nullptr
                && loop_field->is_boolean()
                && loop_field->as_boolean();
            const auto loop_start = checked_index(
                state.function->instructions.size(),
                "loop condition"
            );
            lower_expression(
                field(object, "condition", context),
                state,
                context + ".condition"
            );
            const std::size_t jump_index =
                state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);

            const bool outer_returned = state.returned;
            const auto outer_locals = state.locals;
            state.returned = false;
            lower_function_body(
                field(object, "body", context),
                state,
                false
            );
            state.locals = outer_locals;
            state.returned = outer_returned;
            if (loop) {
                emit(state, Opcode::Jump, ValueType::Void, loop_start);
            }
            const auto target = checked_index(
                state.function->instructions.size(),
                "conditional continuation"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, jump_index, target);
            return;
        }
        if (kind == "update_index") {
            const std::string base_name = string_field(
                object,
                "base_name",
                context
            );
            const auto local = state.locals.find(base_name);
            if (local == state.locals.end()) {
                throw BytecodeLoweringError(
                    "indexed update requires existing local " + base_name
                    + " in " + context
                );
            }
            const auto& indices = array_of(
                field(object, "indices", context),
                context + ".indices"
            );
            if (indices.empty()) {
                throw BytecodeLoweringError(
                    "WASM indexed update requires at least one index in "
                    + context
                );
            }
            emit(state, Opcode::LoadLocal, ValueType::Array, local->second);
            for (std::size_t index = 0; index + 1 < indices.size(); ++index) {
                lower_expression(
                    indices[index],
                    state,
                    context + ".indices[" + std::to_string(index) + "]"
                );
                emit(state, Opcode::ArrayGet, ValueType::Array);
            }
            lower_expression(
                indices.back(),
                state,
                context + ".indices["
                    + std::to_string(indices.size() - 1) + "]"
            );
            lower_expression(
                field(object, "value", context),
                state,
                context + ".value"
            );
            emit(state, Opcode::ArraySet, ValueType::Array);
            if (indices.size() == 1) {
                emit(state, Opcode::StoreLocal, ValueType::Array, local->second);
            } else {
                // Nested arrays are mutable VM objects. ArraySet updates the
                // selected child in place, so the root local remains valid.
                emit(state, Opcode::Pop, ValueType::Void);
            }
            return;
        }
        throw BytecodeLoweringError(
            "unsupported statement kind " + kind + " in " + context
        );
    }

    static void patch_jump(
        FunctionState& state,
        std::size_t instruction_index,
        std::uint32_t target
    ) {
        state.function->instructions[instruction_index].first = target;
    }

    ValueType lower_expression(
        const vf::JsonValue& expression,
        FunctionState& state,
        const std::string& context
    ) {
        const auto& object = object_of(expression, context);
        const std::string kind = string_field(object, "kind", context);
        if (kind == "const") {
            const ValueType type = expression_type(object, context);
            const auto& value = field(object, "value", context);
            if (value.is_null()) {
                emit(state, Opcode::PushNull, ValueType::Dynamic);
                return ValueType::Dynamic;
            }
            Constant constant;
            ValueType literal_type = type;
            if (value.is_number()) {
                constant = Constant::number_value(value.as_number());
                if (literal_type == ValueType::Dynamic) {
                    literal_type = ValueType::Number;
                }
            } else if (value.is_string()) {
                constant = Constant::utf8_string(value.as_string());
                if (literal_type == ValueType::Dynamic) {
                    literal_type = ValueType::String;
                }
            } else if (value.is_boolean()) {
                constant = Constant::number_value(
                    value.as_boolean() ? 1.0 : 0.0
                );
                literal_type = ValueType::Boolean;
            } else {
                throw BytecodeLoweringError(
                    "unsupported scalar constant in " + context
                );
            }
            emit(
                state,
                Opcode::PushConstant,
                literal_type,
                intern_constant(std::move(constant))
            );
            return literal_type;
        }
        if (kind == "symbolic_var") {
            const std::string name = string_field(object, "name", context);
            const std::string domain = string_field(object, "domain", context);
            const auto symbol_kind_field = object.find("symbol_kind");
            const std::string symbol_kind = symbol_kind_field != object.end() && symbol_kind_field->second.is_string()
                ? symbol_kind_field->second.as_string() : "variable";
            const double symbol_kind_tag = symbol_kind == "function" ? 2.0 : symbol_kind == "constant" ? 3.0 : 1.0;
            const auto latex_field = object.find("latex");
            const std::string latex = latex_field != object.end() && latex_field->second.is_string()
                ? latex_field->second.as_string() : name;
            const auto signature = vkf::symbolic_value::function_signature_tags(domain);
            std::vector<double> encoded{
                1.0,
                static_cast<double>(name.size() + latex.size() + signature.inputs.size() * 2u + 7u),
                vkf::symbolic_value::encoded_domain_tag(domain),
                symbol_kind_tag,
                static_cast<double>(name.size()),
            };
            for (const unsigned char byte : name) {
                encoded.push_back(static_cast<double>(byte));
            }
            encoded.push_back(static_cast<double>(latex.size()));
            for (const unsigned char byte : latex) {
                encoded.push_back(static_cast<double>(byte));
            }
            encoded.push_back(static_cast<double>(signature.inputs.size()));
            for (const auto& input : signature.inputs) {
                encoded.push_back(input.tag);
                encoded.push_back(input.dimension);
            }
            encoded.push_back(signature.output.tag);
            encoded.push_back(signature.output.dimension);
            encoded.push_back(1.0);
            encoded.push_back(0.0);
            encoded.push_back(static_cast<double>(encoded.size() + 1u));
            for (const double value : encoded) {
                emit(
                    state,
                    Opcode::PushConstant,
                    ValueType::Number,
                    intern_constant(Constant::number_value(value))
                );
            }
            emit(
                state,
                Opcode::MakeArray,
                ValueType::Array,
                checked_index(encoded.size(), "symbolic variable width")
            );
            return ValueType::Array;
        }
        if (kind == "load") {
            const std::string name = string_field(object, "name", context);
            const auto local = state.locals.find(name);
            if (local != state.locals.end()) {
                const ValueType local_type =
                    state.function->local_types[local->second];
                emit(state, Opcode::LoadLocal, local_type, local->second);
                return local_type;
            }
            const auto constant = constant_bindings_.find(name);
            if (constant != constant_bindings_.end()) {
                emit(
                    state,
                    Opcode::PushConstant,
                    constant->second.type,
                    constant->second.constant_index
                );
                return constant->second.type;
            }
            throw BytecodeLoweringError(
                "unknown scalar binding " + name + " in " + context
            );
        }
        if (kind == "bind_expr") {
            const std::string name = string_field(object, "name", context);
            const auto* update_only_field = optional_field(
                object,
                "update_only"
            );
            const bool update_only = update_only_field != nullptr
                && update_only_field->is_boolean()
                && update_only_field->as_boolean();
            std::uint32_t local_index = 0;
            if (update_only) {
                const auto local = state.locals.find(name);
                if (local == state.locals.end()) {
                    throw BytecodeLoweringError(
                        "binding expression update requires existing local "
                        + name + " in " + context
                    );
                }
                local_index = local->second;
            } else {
                const ValueType declared_type = lower_type(
                    string_field(object, "type", context),
                    context
                );
                add_local(state, name, declared_type, context);
                local_index = state.locals.at(name);
            }
            const ValueType value_type = lower_expression(
                field(object, "value", context),
                state,
                context + ".value"
            );
            emit(state, Opcode::Duplicate, value_type);
            emit(state, Opcode::StoreLocal, value_type, local_index);
            return value_type;
        }
        if (kind == "list") {
            const auto& items = array_of(
                field(object, "items", context),
                context + ".items"
            );
            for (std::size_t index = 0; index < items.size(); ++index) {
                lower_expression(
                    items[index],
                    state,
                    context + ".items[" + std::to_string(index) + "]"
                );
            }
            emit(
                state,
                Opcode::MakeArray,
                ValueType::Array,
                checked_index(items.size(), "array item count")
            );
            return ValueType::Array;
        }
        if (kind == "record") {
            const auto& fields = array_of(
                field(object, "fields", context),
                context + ".fields"
            );
            emit(state, Opcode::MakeObject, ValueType::Object);
            for (std::size_t index = 0; index < fields.size(); ++index) {
                const std::string field_context =
                    context + ".fields[" + std::to_string(index) + "]";
                const auto& record_field =
                    object_of(fields[index], field_context);
                if (string_field(
                        record_field,
                        "kind",
                        field_context
                    ) != "field") {
                    throw BytecodeLoweringError(
                        "unsupported record field in " + field_context
                    );
                }
                const ValueType value_type = lower_expression(
                    field(record_field, "value", field_context),
                    state,
                    field_context + ".value"
                );
                emit(
                    state,
                    Opcode::ObjectSet,
                    value_type,
                    intern_constant(Constant::utf8_string(string_field(
                        record_field,
                        "name",
                        field_context
                    )))
                );
            }
            return ValueType::Object;
        }
        if (kind == "field_access") {
            lower_expression(
                field(object, "object", context),
                state,
                context + ".object"
            );
            const ValueType result_type = expression_type(object, context);
            emit(
                state,
                Opcode::ObjectGet,
                result_type,
                intern_constant(Constant::utf8_string(
                    string_field(object, "field", context)
                ))
            );
            return result_type;
        }
        if (kind == "dotted_index") {
            ValueType result_type = lower_expression(
                field(object, "base", context),
                state,
                context + ".base"
            );
            const auto& indices = array_of(
                field(object, "indices", context),
                context + ".indices"
            );
            for (std::size_t index = 0; index < indices.size(); ++index) {
                lower_expression(
                    indices[index],
                    state,
                    context + ".indices[" + std::to_string(index) + "]"
                );
                result_type = index + 1 == indices.size()
                    ? expression_type(object, context)
                    : ValueType::Dynamic;
                emit(state, Opcode::ArrayGet, result_type);
            }
            return result_type;
        }
        if (kind == "block_expr" || kind == "block") {
            const auto outer_locals = state.locals;
            const auto& statements = array_of(
                field(object, "body", context),
                context + ".body"
            );
            for (std::size_t index = 0; index < statements.size(); ++index) {
                const std::string statement_context =
                    context + ".body[" + std::to_string(index) + "]";
                const auto& statement =
                    object_of(statements[index], statement_context);
                const std::string statement_kind =
                    string_field(statement, "kind", statement_context);
                if (statement_kind == "store_binding") {
                    lower_statement(
                        statements[index],
                        state,
                        false,
                        statement_context
                    );
                    continue;
                }
                if (statement_kind == "expr_stmt"
                    && index + 1 == statements.size()) {
                    const ValueType result_type = lower_expression(
                        field(statement, "expr", statement_context),
                        state,
                        statement_context + ".expr"
                    );
                    state.locals = outer_locals;
                    return result_type;
                }
                lower_statement(
                    statements[index],
                    state,
                    false,
                    statement_context
                );
            }
            emit(state, Opcode::PushNull, ValueType::Dynamic);
            state.locals = outer_locals;
            return ValueType::Dynamic;
        }
        if (kind == "match_stmt") {
            return lower_match_expression(object, state, context);
        }
        if (kind == "pipe_chain") {
            return lower_pipe_chain(object, state, context);
        }
        if (kind == "repeat_list") {
            return lower_repeat_list(object, state, context);
        }
        if (kind == "raise_expr") {
            emit(state, Opcode::Trap, ValueType::Void);
            state.returned = true;
            return ValueType::Void;
        }
        if (kind == "binary_op") {
            const std::string op = string_field(object, "op", context);
            if (op == "AND" || op == "OR") {
                return lower_logical_expression(
                    object,
                    state,
                    context,
                    op == "AND"
                );
            }
            const auto* surface_type = optional_field(object, "type");
            if (surface_type != nullptr
                && surface_type->is_string()
                && symbolic_expression_surface_type(surface_type->as_string())) {
                const auto& left = field(object, "left", context);
                const auto& right = field(object, "right", context);
                const auto lower_symbolic_operand = [this, &state](
                    const vf::JsonValue& operand,
                    const std::string& operand_context
                ) {
                    const auto& operand_object = object_of(
                        operand,
                        operand_context
                    );
                    const ValueType operand_type = lower_expression(
                        operand,
                        state,
                        operand_context
                    );
                    const auto* operand_surface = optional_field(
                        operand_object,
                        "type"
                    );
                    const bool symbolic_operand =
                        operand_type == ValueType::Array
                        || (operand_surface != nullptr
                            && operand_surface->is_string()
                            && symbolic_expression_surface_type(operand_surface->as_string()));
                    if (symbolic_operand) return;
                    if (operand_type != ValueType::Number
                        && operand_type != ValueType::Boolean) {
                        throw BytecodeLoweringError(
                            "symbolic binary operand must be numeric or "
                            "symbolic in " + operand_context
                        );
                    }
                    const auto numeric = add_temporary_local(
                        state,
                        operand_type
                    );
                    emit(
                        state,
                        Opcode::StoreLocal,
                        operand_type,
                        numeric
                    );
                    emit_number(state, 2.0);
                    emit(
                        state,
                        Opcode::LoadLocal,
                        operand_type,
                        numeric
                    );
                    emit_number(state, 3.0);
                    emit(state, Opcode::MakeArray, ValueType::Array, 3);
                };

                const auto left_local = add_temporary_local(
                    state,
                    ValueType::Array
                );
                lower_symbolic_operand(left, context + ".left");
                emit(
                    state,
                    Opcode::StoreLocal,
                    ValueType::Array,
                    left_local
                );
                const auto right_local = add_temporary_local(
                    state,
                    ValueType::Array
                );
                lower_symbolic_operand(right, context + ".right");
                emit(
                    state,
                    Opcode::StoreLocal,
                    ValueType::Array,
                    right_local
                );

                const auto subtree_size = add_temporary_local(
                    state,
                    ValueType::Number
                );
                emit(
                    state,
                    Opcode::LoadLocal,
                    ValueType::Array,
                    left_local
                );
                emit(state, Opcode::ArrayLength, ValueType::Number);
                emit(
                    state,
                    Opcode::LoadLocal,
                    ValueType::Array,
                    right_local
                );
                emit(state, Opcode::ArrayLength, ValueType::Number);
                emit(state, Opcode::Add, ValueType::Number);
                emit_number(state, 3.0);
                emit(state, Opcode::Add, ValueType::Number);
                emit(
                    state,
                    Opcode::StoreLocal,
                    ValueType::Number,
                    subtree_size
                );

                emit(
                    state,
                    Opcode::LoadLocal,
                    ValueType::Array,
                    left_local
                );
                emit(
                    state,
                    Opcode::LoadLocal,
                    ValueType::Array,
                    right_local
                );
                emit(state, Opcode::ArrayConcat, ValueType::Array);

                const double symbolic_opcode = op == "PLUS" ? 1.0
                    : op == "MINUS" ? 2.0
                    : op == "STAR" ? 3.0
                    : op == "SLASH" ? 4.0
                    : op == "CARET" ? 5.0
                    : op == "EQ" || op == "EXACT_EQ" ? 6.0
                    : op == "NE" || op == "NEQ" ? 7.0
                    : op == "LT" ? 8.0
                    : op == "LE" ? 9.0
                    : op == "GT" ? 10.0
                    : op == "GE" ? 11.0
                    : 0.0;
                if (symbolic_opcode == 0.0) {
                    throw BytecodeLoweringError(
                        "unsupported symbolic binary operator " + op
                        + " in " + context
                    );
                }
                emit_number(state, 3.0);
                emit_number(state, symbolic_opcode);
                emit(
                    state,
                    Opcode::LoadLocal,
                    ValueType::Number,
                    subtree_size
                );
                emit(state, Opcode::MakeArray, ValueType::Array, 3);
                emit(state, Opcode::ArrayConcat, ValueType::Array);
                return ValueType::Array;
            }
            const ValueType type = expression_type(object, context);
            const ValueType left_type = lower_expression(
                field(object, "left", context),
                state,
                context + ".left"
            );
            const ValueType right_type = lower_expression(
                field(object, "right", context),
                state,
                context + ".right"
            );
            const Opcode opcode = (op == "AMPERSAND" || op == "&")
                && left_type == ValueType::Array
                && right_type == ValueType::Array
                ? Opcode::ArrayConcat
                : lower_binary_opcode(op, context);
            const ValueType result_type =
                comparison_opcode(opcode) ? ValueType::Boolean : type;
            emit(state, opcode, result_type);
            return result_type;
        }
        if (kind == "unary_op") {
            const ValueType type = expression_type(object, context);
            lower_expression(
                field(object, "operand", context),
                state,
                context + ".operand"
            );
            const std::string op = string_field(object, "op", context);
            if (op == "MINUS" || op == "-") {
                emit(state, Opcode::Negate, type);
                return type;
            }
            if (op == "NOT" || op == "!") {
                emit(state, Opcode::LogicalNot, ValueType::Boolean);
                return ValueType::Boolean;
            }
            throw BytecodeLoweringError(
                "unsupported unary operator " + op + " in " + context
            );
        }
        if (kind == "call") {
            const auto& callee = object_of(
                field(object, "callee", context),
                context + ".callee"
            );
            const std::string callee_kind = string_field(
                callee,
                "kind",
                context + ".callee"
            );
            if (callee_kind == "field_access") {
                const auto& args = array_of(
                    field(object, "args", context),
                    context + ".args"
                );
                const std::string method = string_field(
                    callee,
                    "field",
                    context + ".callee"
                );
                if (method == "length" && args.empty()) {
                    lower_expression(
                        field(callee, "object", context + ".callee"),
                        state,
                        context + ".callee.object"
                    );
                    emit(state, Opcode::ArrayLength, ValueType::Number);
                    return ValueType::Number;
                }
                throw BytecodeLoweringError(
                    "unsupported method call " + method + " in " + context
                );
            }
            if (callee_kind == "stdlib_function") {
                const auto& args = array_of(
                    field(object, "args", context),
                    context + ".args"
                );
                if (args.size() != 1) {
                    throw BytecodeLoweringError(
                        "WASM math intrinsic requires one argument in "
                        + context
                    );
                }
                const std::string full_name = string_field(
                    callee,
                    "full_name",
                    context + ".callee"
                );
                Opcode opcode = Opcode::Nop;
                if (full_name == "math.sin") opcode = Opcode::Sine;
                else if (full_name == "math.cos") opcode = Opcode::Cosine;
                else if (full_name == "math.tan") opcode = Opcode::Tangent;
                else if (full_name == "math.sqrt") opcode = Opcode::SquareRoot;
                else if (full_name == "math.abs") opcode = Opcode::Absolute;
                else if (full_name == "math.ln" || full_name == "math.log") {
                    opcode = Opcode::NaturalLog;
                } else if (full_name == "math.exp") {
                    opcode = Opcode::Exponential;
                } else {
                    throw BytecodeLoweringError(
                        "unsupported standard-library call " + full_name
                        + " in " + context
                    );
                }
                lower_expression(
                    args.front(),
                    state,
                    context + ".args[0]"
                );
                emit(state, opcode, ValueType::Number);
                return ValueType::Number;
            }
            if (callee_kind != "load") {
                throw BytecodeLoweringError(
                    "direct calls require load callee in " + context
                );
            }
            const std::string name = string_field(
                callee,
                "name",
                context + ".callee"
            );
            const auto function = function_bindings_.find(name);
            if (function == function_bindings_.end()) {
                const auto& args = array_of(
                    field(object, "args", context),
                    context + ".args"
                );
                ValueType intrinsic_type = ValueType::Dynamic;
                Opcode intrinsic_opcode = Opcode::Nop;
                if (runtime_intrinsic(
                    name,
                    args.size(),
                    intrinsic_opcode,
                    intrinsic_type
                )) {
                    for (std::size_t index = 0; index < args.size(); ++index) {
                        lower_expression(
                            args[index],
                            state,
                            context + ".args[" + std::to_string(index) + "]"
                        );
                    }
                    emit(
                        state,
                        intrinsic_opcode,
                        intrinsic_type,
                        checked_index(args.size(), "intrinsic arity")
                    );
                    return intrinsic_type;
                }
                throw BytecodeLoweringError(
                    "unknown direct function " + name + " in " + context
                );
            }
            const auto& args = array_of(
                field(object, "args", context),
                context + ".args"
            );
            if (args.size() < function->second.minimum_arity
                || args.size() > function->second.arity) {
                throw BytecodeLoweringError(
                    "wrong arity for function " + name + " in " + context
                    + ": expected "
                    + std::to_string(function->second.minimum_arity)
                    + ".." + std::to_string(function->second.arity)
                    + ", got " + std::to_string(args.size())
                );
            }
            for (std::size_t index = 0; index < args.size(); ++index) {
                lower_expression(
                    args[index],
                    state,
                    context + ".args[" + std::to_string(index) + "]"
                );
            }
            for (std::size_t index = args.size();
                 index < function->second.arity;
                 ++index) {
                const auto* default_argument =
                    function->second.default_arguments[index];
                if (default_argument == nullptr) {
                    throw BytecodeLoweringError(
                        "missing required argument " + std::to_string(index)
                        + " for function " + name + " in " + context
                    );
                }
                lower_expression(
                    *default_argument,
                    state,
                    context + ".defaults[" + std::to_string(index) + "]"
                );
            }
            emit(
                state,
                Opcode::Call,
                function->second.return_type,
                function->second.function_index,
                function->second.arity
            );
            return function->second.return_type;
        }
        throw BytecodeLoweringError(
            "unsupported expression kind " + kind + " in " + context
        );
    }

    ValueType lower_logical_expression(
        const vf::JsonValue::Object& object,
        FunctionState& state,
        const std::string& context,
        bool is_and
    ) {
        lower_expression(
            field(object, "left", context),
            state,
            context + ".left"
        );
        emit(state, Opcode::Duplicate, ValueType::Boolean);
        if (!is_and) {
            emit(state, Opcode::LogicalNot, ValueType::Boolean);
        }
        const std::size_t jump_index = state.function->instructions.size();
        emit(state, Opcode::JumpIfFalse, ValueType::Void);
        emit(state, Opcode::Pop, ValueType::Void);
        lower_expression(
            field(object, "right", context),
            state,
            context + ".right"
        );
        const auto target = checked_index(
            state.function->instructions.size(),
            "logical continuation"
        );
        emit(state, Opcode::Nop, ValueType::Void);
        patch_jump(state, jump_index, target);
        return ValueType::Boolean;
    }

    std::uint32_t add_temporary_local(
        FunctionState& state,
        ValueType type
    ) {
        const auto index = checked_index(
            state.function->local_types.size(),
            "temporary local table"
        );
        state.function->local_types.push_back(type);
        ++state.next_temporary;
        return index;
    }

    void emit_number(
        FunctionState& state,
        double value
    ) {
        emit(
            state,
            Opcode::PushConstant,
            ValueType::Number,
            intern_constant(Constant::number_value(value))
        );
    }

    ValueType lower_pipe_chain(
        const vf::JsonValue::Object& object,
        FunctionState& state,
        const std::string& context
    ) {
        const auto& segments = array_of(
            field(object, "segments", context),
            context + ".segments"
        );
        if (segments.empty()) {
            throw BytecodeLoweringError(
                "pipe chain requires at least one segment in " + context
            );
        }

        const auto& source = object_of(
            field(object, "source", context),
            context + ".source"
        );
        const std::string source_kind = string_field(
            source,
            "kind",
            context + ".source"
        );
        std::uint32_t current_array = 0;
        std::size_t first_segment = 0;

        if (source_kind == "range") {
            const auto cursor = add_temporary_local(state, ValueType::Number);
            const auto end = add_temporary_local(state, ValueType::Number);
            const auto direction = add_temporary_local(state, ValueType::Number);
            const auto output_index = add_temporary_local(state, ValueType::Number);
            current_array = add_temporary_local(state, ValueType::Array);

            lower_expression(
                field(source, "start", context + ".source"),
                state,
                context + ".source.start"
            );
            emit(state, Opcode::StoreLocal, ValueType::Number, cursor);
            lower_expression(
                field(source, "end", context + ".source"),
                state,
                context + ".source.end"
            );
            emit(state, Opcode::StoreLocal, ValueType::Number, end);

            emit(state, Opcode::LoadLocal, ValueType::Number, end);
            emit(state, Opcode::LoadLocal, ValueType::Number, cursor);
            emit(state, Opcode::GreaterEqual, ValueType::Boolean);
            const std::size_t descending_jump =
                state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);
            emit_number(state, 1.0);
            emit(state, Opcode::StoreLocal, ValueType::Number, direction);
            const std::size_t direction_end_jump =
                state.function->instructions.size();
            emit(state, Opcode::Jump, ValueType::Void);
            const auto descending_target = checked_index(
                state.function->instructions.size(),
                "descending range direction"
            );
            emit_number(state, -1.0);
            emit(state, Opcode::StoreLocal, ValueType::Number, direction);
            const auto direction_end = checked_index(
                state.function->instructions.size(),
                "range direction continuation"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, descending_jump, descending_target);
            patch_jump(state, direction_end_jump, direction_end);

            emit(state, Opcode::LoadLocal, ValueType::Number, end);
            emit(state, Opcode::LoadLocal, ValueType::Number, cursor);
            emit(state, Opcode::Subtract, ValueType::Number);
            emit(state, Opcode::LoadLocal, ValueType::Number, direction);
            emit(state, Opcode::Multiply, ValueType::Number);
            emit_number(state, 1.0);
            emit(state, Opcode::Add, ValueType::Number);
            emit(state, Opcode::AllocateArray, ValueType::Array);
            emit(state, Opcode::StoreLocal, ValueType::Array, current_array);
            emit_number(state, 0.0);
            emit(state, Opcode::StoreLocal, ValueType::Number, output_index);

            const auto loop_start = checked_index(
                state.function->instructions.size(),
                "range pipe loop"
            );
            emit(state, Opcode::LoadLocal, ValueType::Number, end);
            emit(state, Opcode::LoadLocal, ValueType::Number, cursor);
            emit(state, Opcode::Subtract, ValueType::Number);
            emit(state, Opcode::LoadLocal, ValueType::Number, direction);
            emit(state, Opcode::Multiply, ValueType::Number);
            emit_number(state, 0.0);
            emit(state, Opcode::GreaterEqual, ValueType::Boolean);
            const std::size_t loop_end_jump =
                state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);

            const auto previous_dollar = state.locals.find("$");
            const bool had_previous_dollar = previous_dollar != state.locals.end();
            const std::uint32_t previous_dollar_index = had_previous_dollar
                ? previous_dollar->second
                : 0;
            state.locals["$"] = cursor;
            const ValueType segment_type = lower_expression(
                segments.front(),
                state,
                context + ".segments[0]"
            );
            const auto segment_value = add_temporary_local(state, segment_type);
            emit(state, Opcode::StoreLocal, segment_type, segment_value);
            emit(state, Opcode::LoadLocal, ValueType::Array, current_array);
            emit(state, Opcode::LoadLocal, ValueType::Number, output_index);
            emit(state, Opcode::LoadLocal, segment_type, segment_value);
            emit(state, Opcode::ArraySet, ValueType::Array);
            emit(state, Opcode::StoreLocal, ValueType::Array, current_array);
            if (had_previous_dollar) {
                state.locals["$"] = previous_dollar_index;
            } else {
                state.locals.erase("$");
            }

            emit(state, Opcode::LoadLocal, ValueType::Number, cursor);
            emit(state, Opcode::LoadLocal, ValueType::Number, direction);
            emit(state, Opcode::Add, ValueType::Number);
            emit(state, Opcode::StoreLocal, ValueType::Number, cursor);
            emit(state, Opcode::LoadLocal, ValueType::Number, output_index);
            emit_number(state, 1.0);
            emit(state, Opcode::Add, ValueType::Number);
            emit(state, Opcode::StoreLocal, ValueType::Number, output_index);
            emit(state, Opcode::Jump, ValueType::Void, loop_start);
            const auto loop_end = checked_index(
                state.function->instructions.size(),
                "range pipe continuation"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, loop_end_jump, loop_end);
            (void)segment_type;
            first_segment = 1;
        } else {
            current_array = add_temporary_local(state, ValueType::Array);
            lower_expression(
                field(object, "source", context),
                state,
                context + ".source"
            );
            emit(state, Opcode::StoreLocal, ValueType::Array, current_array);
        }

        for (std::size_t segment_index = first_segment;
             segment_index < segments.size();
             ++segment_index) {
            const auto source_array = current_array;
            const auto output_array = add_temporary_local(state, ValueType::Array);
            const auto index = add_temporary_local(state, ValueType::Number);
            const auto length = add_temporary_local(state, ValueType::Number);
            const auto current_value = add_temporary_local(state, ValueType::Dynamic);

            emit(state, Opcode::LoadLocal, ValueType::Array, source_array);
            emit(state, Opcode::ArrayLength, ValueType::Number);
            emit(state, Opcode::StoreLocal, ValueType::Number, length);
            emit(state, Opcode::LoadLocal, ValueType::Number, length);
            emit(state, Opcode::AllocateArray, ValueType::Array);
            emit(state, Opcode::StoreLocal, ValueType::Array, output_array);
            emit_number(state, 0.0);
            emit(state, Opcode::StoreLocal, ValueType::Number, index);

            const auto loop_start = checked_index(
                state.function->instructions.size(),
                "array pipe loop"
            );
            emit(state, Opcode::LoadLocal, ValueType::Number, index);
            emit(state, Opcode::LoadLocal, ValueType::Number, length);
            emit(state, Opcode::Less, ValueType::Boolean);
            const std::size_t loop_end_jump =
                state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);
            emit(state, Opcode::LoadLocal, ValueType::Array, source_array);
            emit(state, Opcode::LoadLocal, ValueType::Number, index);
            emit(state, Opcode::ArrayGet, ValueType::Dynamic);
            emit(state, Opcode::StoreLocal, ValueType::Dynamic, current_value);

            const auto previous_dollar = state.locals.find("$");
            const bool had_previous_dollar = previous_dollar != state.locals.end();
            const std::uint32_t previous_dollar_index = had_previous_dollar
                ? previous_dollar->second
                : 0;
            state.locals["$"] = current_value;
            const ValueType segment_type = lower_expression(
                segments[segment_index],
                state,
                context + ".segments[" + std::to_string(segment_index) + "]"
            );
            const auto segment_value = add_temporary_local(state, segment_type);
            emit(state, Opcode::StoreLocal, segment_type, segment_value);
            emit(state, Opcode::LoadLocal, ValueType::Array, output_array);
            emit(state, Opcode::LoadLocal, ValueType::Number, index);
            emit(state, Opcode::LoadLocal, segment_type, segment_value);
            emit(state, Opcode::ArraySet, ValueType::Array);
            emit(state, Opcode::StoreLocal, ValueType::Array, output_array);
            if (had_previous_dollar) {
                state.locals["$"] = previous_dollar_index;
            } else {
                state.locals.erase("$");
            }

            emit(state, Opcode::LoadLocal, ValueType::Number, index);
            emit_number(state, 1.0);
            emit(state, Opcode::Add, ValueType::Number);
            emit(state, Opcode::StoreLocal, ValueType::Number, index);
            emit(state, Opcode::Jump, ValueType::Void, loop_start);
            const auto loop_end = checked_index(
                state.function->instructions.size(),
                "array pipe continuation"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, loop_end_jump, loop_end);
            current_array = output_array;
        }

        emit(state, Opcode::LoadLocal, ValueType::Array, current_array);
        return ValueType::Array;
    }

    ValueType lower_repeat_list(
        const vf::JsonValue::Object& object,
        FunctionState& state,
        const std::string& context
    ) {
        const auto count = add_temporary_local(state, ValueType::Number);
        const auto index = add_temporary_local(state, ValueType::Number);
        const auto result = add_temporary_local(state, ValueType::Array);
        lower_expression(
            field(object, "count", context),
            state,
            context + ".count"
        );
        emit(state, Opcode::StoreLocal, ValueType::Number, count);
        const ValueType item_type = lower_expression(
            field(object, "value", context),
            state,
            context + ".value"
        );
        const auto item = add_temporary_local(state, item_type);
        emit(state, Opcode::StoreLocal, item_type, item);
        emit(state, Opcode::LoadLocal, ValueType::Number, count);
        emit(state, Opcode::AllocateArray, ValueType::Array);
        emit(state, Opcode::StoreLocal, ValueType::Array, result);
        emit_number(state, 0.0);
        emit(state, Opcode::StoreLocal, ValueType::Number, index);

        const auto loop_start = checked_index(
            state.function->instructions.size(),
            "repeated-list loop"
        );
        emit(state, Opcode::LoadLocal, ValueType::Number, index);
        emit(state, Opcode::LoadLocal, ValueType::Number, count);
        emit(state, Opcode::Less, ValueType::Boolean);
        const std::size_t loop_end_jump =
            state.function->instructions.size();
        emit(state, Opcode::JumpIfFalse, ValueType::Void);
        emit(state, Opcode::LoadLocal, ValueType::Array, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, index);
        emit(state, Opcode::LoadLocal, item_type, item);
        emit(state, Opcode::ArraySet, ValueType::Array);
        emit(state, Opcode::StoreLocal, ValueType::Array, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, index);
        emit_number(state, 1.0);
        emit(state, Opcode::Add, ValueType::Number);
        emit(state, Opcode::StoreLocal, ValueType::Number, index);
        emit(state, Opcode::Jump, ValueType::Void, loop_start);
        const auto loop_end = checked_index(
            state.function->instructions.size(),
            "repeated-list continuation"
        );
        emit(state, Opcode::Nop, ValueType::Void);
        patch_jump(state, loop_end_jump, loop_end);
        emit(state, Opcode::LoadLocal, ValueType::Array, result);
        return ValueType::Array;
    }

    ValueType lower_match_expression(
        const vf::JsonValue::Object& object,
        FunctionState& state,
        const std::string& context
    ) {
        lower_expression(
            field(object, "discriminant", context),
            state,
            context + ".discriminant"
        );
        const auto& arms = array_of(
            field(object, "arms", context),
            context + ".arms"
        );
        std::vector<std::size_t> end_jumps;
        bool has_default = false;
        ValueType result_type = expression_type(object, context);
        for (std::size_t index = 0; index < arms.size(); ++index) {
            const std::string arm_context =
                context + ".arms[" + std::to_string(index) + "]";
            const auto& arm = object_of(arms[index], arm_context);
            const auto& condition = field(arm, "condition", arm_context);
            if (condition.is_null()) {
                has_default = true;
                emit(state, Opcode::Pop, ValueType::Void);
                result_type = lower_expression(
                    field(arm, "body", arm_context),
                    state,
                    arm_context + ".body"
                );
                break;
            }

            emit(state, Opcode::Duplicate, ValueType::Dynamic);
            lower_expression(
                condition,
                state,
                arm_context + ".condition"
            );
            emit(state, Opcode::Equal, ValueType::Boolean);
            const std::size_t next_arm =
                state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);
            emit(state, Opcode::Pop, ValueType::Void);
            result_type = lower_expression(
                field(arm, "body", arm_context),
                state,
                arm_context + ".body"
            );
            end_jumps.push_back(state.function->instructions.size());
            emit(state, Opcode::Jump, ValueType::Void);

            const auto next_target = checked_index(
                state.function->instructions.size(),
                "match arm continuation"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, next_arm, next_target);
        }
        if (!has_default) {
            throw BytecodeLoweringError(
                "match expression requires a default arm in " + context
            );
        }
        const auto end_target = checked_index(
            state.function->instructions.size(),
            "match continuation"
        );
        emit(state, Opcode::Nop, ValueType::Void);
        for (const auto jump : end_jumps) {
            patch_jump(state, jump, end_target);
        }
        return result_type;
    }

    static bool runtime_intrinsic(
        const std::string& name,
        std::size_t arity,
        Opcode& opcode,
        ValueType& result
    ) {
        const auto bind = [&](
            const char* expected_name,
            std::size_t expected_arity,
            Opcode expected_opcode,
            ValueType expected_result
        ) {
            if (name != expected_name) return false;
            if (arity != expected_arity) {
                throw BytecodeLoweringError(
                    "wrong arity for runtime intrinsic " + name
                    + ": expected " + std::to_string(expected_arity)
                    + ", got " + std::to_string(arity)
                );
            }
            opcode = expected_opcode;
            result = expected_result;
            return true;
        };
        return bind("str", 1, Opcode::NumberToString, ValueType::String)
            || bind(
                "vkf_utf8_advance",
                2,
                Opcode::Utf8Advance,
                ValueType::Number
            )
            || bind(
                "vkf_string_eof",
                2,
                Opcode::Utf8Eof,
                ValueType::Boolean
            )
            || bind(
                "vkf_string_peek_scalar",
                2,
                Opcode::Utf8PeekScalar,
                ValueType::String
            )
            || bind(
                "vkf_decimal_parse",
                1,
                Opcode::DecimalParse,
                ValueType::Number
            )
            || bind(
                "vkf_decimal_scan_end",
                2,
                Opcode::DecimalScanEnd,
                ValueType::Number
            )
            || bind(
                "vkf_identifier_scan_end",
                2,
                Opcode::IdentifierScanEnd,
                ValueType::Number
            )
            || bind(
                "vkf_operator_width",
                2,
                Opcode::OperatorWidth,
                ValueType::Number
            )
            || bind(
                "vkf_operator_kind",
                1,
                Opcode::OperatorKind,
                ValueType::String
            )
            || bind(
                "vkf_plot_pack",
                2,
                Opcode::PlotPack,
                ValueType::Array
            )
            || bind(
                "vkf_plot_builder_create",
                2,
                Opcode::PlotBuilderCreate,
                ValueType::Array
            )
            || bind(
                "vkf_plot_builder_push",
                2,
                Opcode::PlotBuilderPush,
                ValueType::Array
            )
            || bind(
                "vkf_plot_builder_finish",
                1,
                Opcode::PlotBuilderFinish,
                ValueType::Array
            )
            || bind(
                "vkf_utf8_slice",
                3,
                Opcode::Utf8Slice,
                ValueType::String
            )
            || bind(
                "vkf_list_length",
                1,
                Opcode::ArrayLength,
                ValueType::Number
            )
            || bind("vkf_list_empty", 0, Opcode::MakeArray, ValueType::Array)
            || bind("vkf_list_single", 1, Opcode::MakeArray, ValueType::Array)
            || bind("vkf_list_pair", 2, Opcode::MakeArray, ValueType::Array)
            || bind(
                "vkf_math_sqrt",
                1,
                Opcode::SquareRoot,
                ValueType::Number
            )
            || bind(
                "vkf_math_atan2",
                2,
                Opcode::Atan2,
                ValueType::Number
            )
            || bind("vkf_math_sin", 1, Opcode::Sine, ValueType::Number)
            || bind("vkf_math_cos", 1, Opcode::Cosine, ValueType::Number)
            || bind("vkf_math_tan", 1, Opcode::Tangent, ValueType::Number)
            || bind("vkf_math_abs", 1, Opcode::Absolute, ValueType::Number);
    }

    static void emit(
        FunctionState& state,
        Opcode opcode,
        ValueType result_type,
        std::uint32_t first = 0,
        std::uint32_t second = 0
    ) {
        state.function->instructions.push_back({
            opcode,
            result_type,
            first,
            second,
        });
    }

    const TypedModule& typed_module_;
    Module module_;
    std::map<std::string, FunctionBinding> function_bindings_;
    std::map<std::string, ConstantBinding> constant_bindings_;
    std::set<std::string> referenced_globals_;
};

}  // namespace lowering_detail

inline Module lower_typed_module_to_bytecode(const TypedModule& module) {
    return lowering_detail::Lowerer(module).lower();
}

inline Module lower_typed_ir_to_bytecode(const vf::JsonValue& typed_ir) {
    return lower_typed_module_to_bytecode(parse_typed_module(typed_ir));
}

}  // namespace vkf::wasm::bytecode
