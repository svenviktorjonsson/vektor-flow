#pragma once

#include "vkf_stdlib_classification.hpp"
#include "vkf_runtime_value_semantics.hpp"
#include "vkf_record_selector_plan.hpp"

#include "compiler/native/vkf_wasm_bytecode.hpp"
#include "compiler/native/vkf_wasm_typed_ir.hpp"
#include "compiler/native/vkf_call_binding_plan.hpp"
#include "compiler/native/vkf_fixed_spread_plan.hpp"
#include "compiler/native/vkf_named_variadic_plan.hpp"
#include "compiler/native/vkf_wasm_default_call_thunk.hpp"
#include "compiler/native/vkf_wasm_record_argument_plan.hpp"
#include "compiler/native/vkf_symbolic_value_encoding.hpp"
#include "compiler/native/vkf_capture_pattern.hpp"
#include "compiler/native/vkf_stat_semantics.hpp"
#include "compiler/native/vkf_wasm_stat_kernels.hpp"
#include "compiler/native/vkf_math_primitives.hpp"
#include "compiler/native/vkf_value_layout.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace vkf::wasm::bytecode {

class BytecodeLoweringError : public std::runtime_error {
public:
    explicit BytecodeLoweringError(const std::string& message)
        : std::runtime_error(message) {}
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

inline bool numeric_surface_type(const std::string& type) {
    return type == "int" || type == "num"
        || type == "f32" || type == "f64"
        || type == "i32" || type == "i64";
}

inline ValueType lower_type(
    const std::string& type,
    const std::string& context
) {
    if (type.rfind("axis<", 0) == 0) {
        const auto separator = type.find(">:");
        if (separator != std::string::npos) return lower_type(type.substr(separator + 2), context);
    }
    if (type == "num" || type == "f32" || type == "f64"
        || type == "i32" || type == "i64" || type == "Layer"
        || type.rfind("Display<", 0) == 0 || type.rfind("Frame<", 0) == 0
        || type.rfind("World<", 0) == 0
        || type.rfind("ui_measure_space<", 0) == 0
        || type.rfind("unit<", 0) == 0 || type.rfind("quantity<", 0) == 0) {
        return ValueType::Number;
    }
    if (type == "bool") {
        return ValueType::Boolean;
    }
    if (type == "str" || type == "string") {
        return ValueType::String;
    }
    // The frontend has already rendered a reflected type descriptor into its
    // canonical surface spelling. Preserve that compiler-owned text as a VM
    // string; the browser transport must never reconstruct type metadata.
    if (type.rfind("type<", 0) == 0 && type.back() == '>') {
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
    if (type.rfind("list<", 0) == 0 || (!type.empty() && type.front() == '[')) {
        return ValueType::Array;
    }
    if (type.rfind("multiset<", 0) == 0) {
        return ValueType::Dynamic;
    }
    if (type.rfind("record{", 0) == 0 || type.rfind("queue<", 0) == 0) {
        return ValueType::Object;
    }
    if (type.rfind("tuple<", 0) == 0 && type.back() == '>') {
        return ValueType::Dynamic;
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
        || opcode == Opcode::GreaterEqual
        || opcode == Opcode::StringLess
        || opcode == Opcode::StringLessEqual
        || opcode == Opcode::StringGreater
        || opcode == Opcode::StringGreaterEqual;
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
    std::vector<call_binding::Parameter> parameters;
    bool has_variadic_parameters = false;
    std::vector<bool> inferred_parameters;
    std::optional<std::size_t> variadic_positional_index;
    std::optional<std::size_t> variadic_named_index;
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
        struct LoopControl {
            std::uint32_t continue_target = 0;
            std::vector<std::size_t> break_jumps;
        };
        struct PipeControl {
            std::uint32_t value_local = 0;
            ValueType value_type = ValueType::Dynamic;
            std::vector<std::size_t> return_jumps;
        };
        Function* function = nullptr;
        std::map<std::string, std::uint32_t> locals;
        std::string context;
        bool returned = false;
        std::uint32_t next_temporary = 0;
        std::size_t scope_local_begin = 0;
        const vf::JsonValue::Object* forwarded_named_call = nullptr;
        std::optional<std::uint32_t> forwarded_named_local;
        std::vector<LoopControl> loop_controls;
        std::vector<PipeControl> pipe_controls;
        std::set<std::uint32_t> mutable_dynamic_numbers;
        std::set<std::uint32_t> mutable_numeric_arrays;
        std::set<std::uint32_t> complex_locals;
    };

    struct PendingDefaultThunk {
        FunctionDeclaration declaration;
        Function function;
        std::optional<std::string> forwarded_named_parameter;
    };

    const FunctionBinding& default_call_target(
        const std::string& name,
        const FunctionBinding& original,
        const call_binding::FixedCallPlan& plan
    ) {
        const auto key = std::make_pair(original.function_index, plan.provided_mask);
        const auto existing = default_call_targets_.find(key);
        if (existing != default_call_targets_.end()) return function_bindings_.at(existing->second);
        const std::string private_name = "$vkf_default$" + name + "$" + std::to_string(plan.provided_mask);
        if (function_bindings_.count(private_name)) throw BytecodeLoweringError("reserved default-call function name collision");
        const auto index = checked_index(typed_module_.functions.size() + pending_default_thunks_.size(), "default-call function table");
        auto declaration = make_default_call_thunk(
            typed_module_.functions.at(original.function_index), plan, private_name);
        FunctionBinding binding;
        binding.function_index = index;
        binding.return_type = original.return_type;
        for (std::size_t parameter = 0; parameter < original.parameters.size(); ++parameter) {
            if (plan.parameters[parameter]) {
                binding.parameters.push_back({original.parameters[parameter].name, false});
                binding.inferred_parameters.push_back(original.inferred_parameters[parameter]);
            }
        }
        binding.arity = checked_index(binding.parameters.size(), "default-call arity");
        binding.minimum_arity = binding.arity;
        binding.default_arguments.resize(binding.arity, nullptr);
        Function function;
        function.name_constant = intern_constant(Constant::utf8_string(private_name));
        function.parameter_count = binding.arity;
        function.return_type = binding.return_type;
        const auto forwarded_named_parameter = original.variadic_named_index
            ? std::optional<std::string>(original.parameters[*original.variadic_named_index].name)
            : std::nullopt;
        pending_default_thunks_.push_back({std::move(declaration), std::move(function), forwarded_named_parameter});
        default_call_targets_.emplace(key, private_name);
        return function_bindings_.emplace(private_name, std::move(binding)).first->second;
    }

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
            const auto* nominal_type = optional_field(object, "nominal_type");
            if (nominal_type != nullptr && nominal_type->is_string()) {
                nominal_display_names_.emplace(
                    nominal_type->as_string(), nominal_type->as_string());
            }
            const std::string return_type_name = string_field(
                object,
                "return_type",
                "function " + declaration.name
            );
            const auto& function_body = object_of(
                field(object, "body", "function " + declaration.name),
                "function " + declaration.name + ".body");
            if (string_field(function_body, "kind", "function " + declaration.name + ".body")
                == "block") {
                const auto& statements = array_of(
                    field(function_body, "body", "function " + declaration.name + ".body"),
                    "function " + declaration.name + ".body.body");
                bool returns_scope_identity = false;
                if (!statements.empty()) {
                    const auto& tail = object_of(
                        statements.back(), "function " + declaration.name + ".body.tail");
                    const auto* expression = optional_field(tail, "expr");
                    returns_scope_identity = expression != nullptr && expression->is_object()
                        && string_field(expression->as_object(), "kind",
                            "function " + declaration.name + ".body.tail.expr") == "scope_identity";
                }
                if (const auto display_name =
                        runtime_value_semantics::nominal_constructor_display_name(
                            declaration.name, return_type_name, returns_scope_identity)) {
                    nominal_display_names_.emplace(return_type_name, *display_name);
                }
            }
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
            std::vector<call_binding::Parameter> parameter_specs;
            std::vector<bool> inferred_parameters;
            bool has_variadic_parameters = false;
            std::optional<std::size_t> variadic_positional_index;
            std::optional<std::size_t> variadic_named_index;
            for (std::size_t param_index = 0;
                 param_index < params.size();
                 ++param_index) {
                const auto& param = object_of(
                    params[param_index],
                    "function " + declaration.name + ".params["
                        + std::to_string(param_index) + "]"
                );
                const auto* default_value = optional_field(param, "default");
                parameter_specs.push_back({string_field(param, "name", "function parameter"),
                    default_value != nullptr && !default_value->is_null()});
                inferred_parameters.push_back(string_field(param, "type", "function parameter") == "any");
                for (const auto* flag : {"variadic_positional", "variadic_named"}) {
                    const auto* variadic = optional_field(param, flag);
                    has_variadic_parameters = has_variadic_parameters ||
                        (variadic != nullptr && variadic->is_boolean() && variadic->as_boolean());
                }
                const auto* variadic_positional = optional_field(param, "variadic_positional");
                if (variadic_positional != nullptr && variadic_positional->is_boolean() && variadic_positional->as_boolean()) {
                    if (variadic_positional_index) throw BytecodeLoweringError("direct machine IR supports one variadic positional parameter");
                    variadic_positional_index = param_index;
                }
                const auto* variadic_named = optional_field(param, "variadic_named");
                if (variadic_named != nullptr && variadic_named->is_boolean() && variadic_named->as_boolean()) {
                    variadic_named_index = param_index;
                }
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
                    std::move(parameter_specs),
                    has_variadic_parameters,
                    std::move(inferred_parameters),
                    variadic_positional_index,
                    variadic_named_index,
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
        // Append only after original functions have been lowered. Queuing a
        // nested thunk must not invalidate an active FunctionState pointer.
        // Original indices and public manifest entries remain unchanged.
        for (std::size_t index = 0; index < pending_default_thunks_.size(); ++index) {
            auto& pending = pending_default_thunks_[index];
            module_.functions.push_back(std::move(pending.function));
            lower_function(pending.declaration, module_.functions.back(), pending.forwarded_named_parameter);
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
        const auto existing = state.locals.find(name);
        if (existing != state.locals.end()
            && existing->second >= state.scope_local_begin) {
            throw BytecodeLoweringError(
                "duplicate local name " + name + " in " + context
            );
        }
        const auto index = checked_index(
            state.function->local_types.size(),
            "local table"
        );
        state.locals[name] = index;
        state.function->local_types.push_back(type);
    }

    void lower_function(
        const FunctionDeclaration& declaration,
        Function& function,
        const std::optional<std::string>& forwarded_named_parameter = std::nullopt
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
            const auto* variadic_positional = optional_field(param, "variadic_positional");
            const bool packed_list = variadic_positional != nullptr && variadic_positional->is_boolean() && variadic_positional->as_boolean();
            add_local(
                state,
                string_field(param, "name", param_context),
                packed_list ? ValueType::Array : lower_type(
                    string_field(param, "type", param_context),
                    param_context
                ),
                param_context
            );
        }
        if (forwarded_named_parameter) {
            // Only the factory-owned thunk's final call forwards the captured
            // record. Default expressions may call the same function too; do
            // not identify this site by callee spelling or replay its fields.
            const auto& body = object_of(field(object, "body", context), context);
            const auto& statements = array_of(field(body, "body", context), context);
            state.forwarded_named_call = &object_of(
                field(object_of(statements.back(), context), "expr", context), context);
            state.forwarded_named_local = state.locals.at(*forwarded_named_parameter);
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

    std::optional<std::vector<runtime_value_semantics::RecordField>>
    named_record_fields(const std::string& type, const std::string& context) const {
        for (const auto& alias : typed_module_.type_aliases) {
            if (alias.name != type) continue;
            const auto& annotation = object_of(alias.type_annotation,
                context + ".type_alias");
            const std::string surface = string_field(annotation, "name",
                context + ".type_alias");
            if (surface.size() < 2 || surface.front() != '(' || surface.back() != ')') {
                return std::nullopt;
            }
            std::vector<runtime_value_semantics::RecordField> fields;
            for (const auto& field_surface :
                vkf::stat_semantics::Validation<BytecodeLoweringError>::split_top_level(
                    surface.substr(1, surface.size() - 2), ',')) {
                const auto colon = vkf::stat_semantics::Validation<BytecodeLoweringError>
                    ::find_top_level(field_surface, ':');
                if (colon == std::string::npos) return std::nullopt;
                fields.push_back({
                    vkf::stat_semantics::Validation<BytecodeLoweringError>::trim(
                        field_surface.substr(0, colon)),
                    vkf::stat_semantics::Validation<BytecodeLoweringError>::trim(
                        field_surface.substr(colon + 1)),
                });
            }
            return fields;
        }
        return std::nullopt;
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
            }
            const auto& update_value = field(object, "value", context);
            const bool complex_value = is_complex_expression(update_value, state);
            const auto& update_value_object = object_of(update_value, context + ".value");
            const auto* update_left = optional_field(update_value_object, "left");
            const bool compound_self_update = update
                && string_field(update_value_object, "kind", context + ".value") == "binary_op"
                && update_left != nullptr && update_left->is_object()
                && string_field(update_left->as_object(), "kind", context + ".value.left") == "load"
                && string_field(update_left->as_object(), "name", context + ".value.left") == name;
            if (compound_self_update) {
                const std::string operation = string_field(
                    update_value_object, "op", context + ".value");
                const auto operation_index = operation == "PLUS"
                    ? std::optional<std::uint32_t>(0)
                    : operation == "MINUS"
                        ? std::optional<std::uint32_t>(1)
                        : std::nullopt;
                const std::string left_surface = string_field(
                    update_value_object, "left_type", context + ".value");
                const std::string right_surface = string_field(
                    update_value_object, "right_type", context + ".value");
                const auto local_type = state.function->local_types.at(local_index);
                const bool numeric_slot = state.mutable_dynamic_numbers.find(local_index)
                        != state.mutable_dynamic_numbers.end()
                    && (local_type == ValueType::Number
                        || (local_type == ValueType::Dynamic
                            && numeric_surface_type(left_surface)
                            && numeric_surface_type(right_surface)));
                if (operation_index && numeric_slot) {
                    emit(state, Opcode::LoadLocal, local_type, local_index);
                    lower_expression(field(update_value_object, "right", context + ".value"),
                        state, context + ".value.right");
                    emit(state, Opcode::NumericSlotUpdate, local_type,
                        *operation_index);
                    emit(state, Opcode::StoreLocal, local_type, local_index);
                    return;
                }
                if (operation_index
                    && state.function->local_types.at(local_index) == ValueType::Array
                    && left_surface == right_surface
                    && !vector_path(left_surface).empty()
                    && state.mutable_numeric_arrays.find(local_index)
                        != state.mutable_numeric_arrays.end()) {
                    emit(state, Opcode::LoadLocal, ValueType::Array, local_index);
                    lower_expression(field(update_value_object, "right", context + ".value"),
                        state, context + ".value.right");
                    emit(state, Opcode::NumericArrayUpdate, ValueType::Array,
                        *operation_index);
                    emit(state, Opcode::StoreLocal, ValueType::Array, local_index);
                    return;
                }
            }
            const ValueType value_type = lower_expression(
                update_value,
                state,
                context + ".value"
            );
            // A declaration's initializer sees the original lexical scope;
            // only its completed value introduces the new binding.
            if (!update) {
                const ValueType type = lower_type(
                    string_field(object, "type", context), context);
                add_local(state, name, type, context);
                local_index = state.locals.at(name);
            }
            if (compound_self_update && value_type == ValueType::Array
                && state.function->local_types.at(local_index) == ValueType::Array) {
                const auto replacement = add_temporary_local(state, ValueType::Array);
                const auto index = add_temporary_local(state, ValueType::Number);
                emit(state, Opcode::StoreLocal, ValueType::Array, replacement);
                emit(state, Opcode::LoadLocal, ValueType::Array, local_index);
                emit(state, Opcode::ArrayLength, ValueType::Number);
                emit(state, Opcode::LoadLocal, ValueType::Array, replacement);
                emit(state, Opcode::ArrayLength, ValueType::Number);
                emit(state, Opcode::Equal, ValueType::Boolean);
                const auto rebind_jump = state.function->instructions.size();
                emit(state, Opcode::JumpIfFalse, ValueType::Void);
                emit_number(state, 0.0);
                emit(state, Opcode::StoreLocal, ValueType::Number, index);
                const auto loop_start = checked_index(state.function->instructions.size(),
                    "array update loop");
                emit(state, Opcode::LoadLocal, ValueType::Number, index);
                emit(state, Opcode::LoadLocal, ValueType::Array, replacement);
                emit(state, Opcode::ArrayLength, ValueType::Number);
                emit(state, Opcode::Less, ValueType::Boolean);
                const auto loop_end_jump = state.function->instructions.size();
                emit(state, Opcode::JumpIfFalse, ValueType::Void);
                emit(state, Opcode::LoadLocal, ValueType::Array, local_index);
                emit(state, Opcode::LoadLocal, ValueType::Number, index);
                emit(state, Opcode::LoadLocal, ValueType::Array, replacement);
                emit(state, Opcode::LoadLocal, ValueType::Number, index);
                emit(state, Opcode::ArrayGet, ValueType::Dynamic);
                emit(state, Opcode::ArraySet, ValueType::Array);
                emit(state, Opcode::Pop, ValueType::Void);
                emit(state, Opcode::LoadLocal, ValueType::Number, index);
                emit_number(state, 1.0);
                emit(state, Opcode::Add, ValueType::Number);
                emit(state, Opcode::StoreLocal, ValueType::Number, index);
                emit(state, Opcode::Jump, ValueType::Void, loop_start);
                const auto loop_end = checked_index(state.function->instructions.size(),
                    "array update continuation");
                emit(state, Opcode::Nop, ValueType::Void);
                patch_jump(state, loop_end_jump, loop_end);
                const auto end_jump = state.function->instructions.size();
                emit(state, Opcode::Jump, ValueType::Void);
                const auto rebind_target = checked_index(state.function->instructions.size(),
                    "array update rebind");
                emit(state, Opcode::Nop, ValueType::Void);
                patch_jump(state, rebind_jump, rebind_target);
                emit(state, Opcode::LoadLocal, ValueType::Array, replacement);
                emit(state, Opcode::StoreLocal, ValueType::Array, local_index);
                const auto end_target = checked_index(state.function->instructions.size(),
                    "array update end");
                emit(state, Opcode::Nop, ValueType::Void);
                patch_jump(state, end_jump, end_target);
                return;
            }
            emit(
                state,
                Opcode::StoreLocal,
                value_type,
                local_index
            );
            if (complex_value) state.complex_locals.insert(local_index);
            else state.complex_locals.erase(local_index);
            return;
        }
        if (kind == "spill_stmt") {
            const auto& value = object_of(
                field(object, "value", context),
                context + ".value"
            );
            const bool literal_record = string_field(value, "kind", context + ".value")
                == "record";
            const auto named_fields = literal_record
                ? std::optional<std::vector<runtime_value_semantics::RecordField>>{}
                : named_record_fields(string_field(value, "type", context + ".value"),
                    context + ".value");
            if (!literal_record && !named_fields) {
                throw BytecodeLoweringError(
                    "WASM spill currently requires a statically known "
                    "record in " + context
                );
            }
            if (!literal_record) {
                const ValueType source_type = lower_expression(
                    field(object, "value", context), state, context + ".value");
                const auto source = add_temporary_local(state, source_type);
                emit(state, Opcode::StoreLocal, source_type, source);
                for (const auto& record_field : *named_fields) {
                    const ValueType type = lower_type(record_field.type, context + "." + record_field.name);
                    add_local(state, record_field.name, type, context);
                    emit(state, Opcode::LoadLocal, source_type, source);
                    emit(state, Opcode::ObjectGet, type,
                        intern_constant(Constant::utf8_string(record_field.name)));
                    emit(state, Opcode::StoreLocal, type, state.locals.at(record_field.name));
                }
                return;
            }
            const auto& fields = array_of(field(value, "fields", context + ".value"),
                context + ".value.fields");
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
            const auto& expression = field(object, "expr", context);
            const auto& expression_object = object_of(expression, context + ".expr");
            const ValueType type = !is_final
                    && string_field(expression_object, "kind", context + ".expr") == "pipe_chain"
                ? lower_pipe_chain(expression_object, state, context + ".expr", true)
                : lower_expression(expression, state, context + ".expr");
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
            if (!state.pipe_controls.empty()) {
                const auto value_type = value != nullptr
                    ? lower_expression(*value, state, context + ".value")
                    : ValueType::Dynamic;
                if (value == nullptr) emit(state, Opcode::PushNull, ValueType::Dynamic);
                emit(state, Opcode::StoreLocal, value_type,
                    state.pipe_controls.back().value_local);
                state.pipe_controls.back().return_jumps.push_back(
                    state.function->instructions.size());
                emit(state, Opcode::Jump, ValueType::Void);
                return;
            }
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
        if (kind == "update_attr") {
            const std::string name = string_field(object, "base_name", context);
            const auto local = state.locals.find(name);
            if (local == state.locals.end()) {
                throw BytecodeLoweringError("update requires existing local " + name + " in " + context);
            }
            const auto value_type = lower_expression(field(object, "value", context), state, context + ".value");
            const auto value = add_temporary_local(state, value_type);
            emit(state, Opcode::StoreLocal, value_type, value);
            // Native projection updates evaluate the RHS before storing the
            // selected field. RecordSet preserves fields and returns a new value.
            emit(state, Opcode::LoadLocal, ValueType::Object, local->second);
            emit(state, Opcode::LoadLocal, value_type, value);
            emit(state, Opcode::ObjectSet, ValueType::Object,
                intern_constant(Constant::utf8_string(string_field(object, "field", context))));
            emit(state, Opcode::StoreLocal, ValueType::Object, local->second);
            return;
        }
        if (kind == "continue" || kind == "break") {
            if (state.loop_controls.empty()) {
                throw BytecodeLoweringError(kind + " requires an enclosing loop in " + context);
            }
            if (kind == "continue") {
                emit(state, Opcode::Jump, ValueType::Void,
                    state.loop_controls.back().continue_target);
            } else {
                state.loop_controls.back().break_jumps.push_back(
                    state.function->instructions.size());
                emit(state, Opcode::Jump, ValueType::Void);
            }
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
            const auto* nested_field = optional_field(object, "nested_index");
            const bool nested = nested_field != nullptr
                && nested_field->is_boolean() && nested_field->as_boolean();
            const auto& update_value = object_of(
                field(object, "value", context), context + ".value");
            const auto update_value_type = string_field(
                update_value, "type", context + ".value");
            const bool scatter = update_value_type.rfind("tuple<", 0) == 0
                || update_value_type.rfind("[", 0) == 0;
            if (indices.size() > 1 && !nested && scatter) {
                std::vector<std::uint32_t> index_locals;
                index_locals.reserve(indices.size());
                for (std::size_t index = 0; index < indices.size(); ++index) {
                    lower_expression(indices[index], state,
                        context + ".indices[" + std::to_string(index) + "]");
                    const auto local_index = add_temporary_local(state, ValueType::Number);
                    emit(state, Opcode::StoreLocal, ValueType::Number, local_index);
                    index_locals.push_back(local_index);
                }
                const auto value_type = lower_expression(
                    field(object, "value", context), state, context + ".value");
                const auto values = add_temporary_local(state, value_type);
                emit(state, Opcode::StoreLocal, value_type, values);
                for (std::size_t index = 0; index < indices.size(); ++index) {
                    emit(state, Opcode::LoadLocal, ValueType::Array, local->second);
                    emit(state, Opcode::LoadLocal, ValueType::Number, index_locals[index]);
                    emit(state, Opcode::LoadLocal, value_type, values);
                    emit_number(state, static_cast<double>(index));
                    emit(state, Opcode::ArrayGet, ValueType::Dynamic);
                    emit(state, Opcode::ArraySet, ValueType::Array);
                    emit(state, Opcode::StoreLocal, ValueType::Array, local->second);
                }
                return;
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

    void append_static_text(FunctionState& state, const std::string& text) {
        emit(state, Opcode::PushConstant, ValueType::String,
            intern_constant(Constant::utf8_string(text)));
        emit(state, Opcode::StringConcat, ValueType::String);
    }

    bool is_complex_expression(
        const vf::JsonValue& expression,
        const FunctionState& state
    ) const {
        if (!expression.is_object()) return false;
        const auto& object = expression.as_object();
        const auto* kind_value = optional_field(object, "kind");
        if (kind_value == nullptr || !kind_value->is_string()) return false;
        const auto& kind = kind_value->as_string();
        if (kind == "load") {
            const auto* name = optional_field(object, "name");
            if (name == nullptr || !name->is_string()) return false;
            const auto local = state.locals.find(name->as_string());
            return local != state.locals.end()
                && state.complex_locals.find(local->second) != state.complex_locals.end();
        }
        if (kind == "call") {
            const auto* callee_value = optional_field(object, "callee");
            const auto* args_value = optional_field(object, "args");
            if (callee_value == nullptr || !callee_value->is_object()
                || args_value == nullptr || !args_value->is_array()) return false;
            const auto& callee = callee_value->as_object();
            const auto* callee_kind = optional_field(callee, "kind");
            const auto* name = optional_field(callee, "name");
            return callee_kind != nullptr && callee_kind->is_string()
                && callee_kind->as_string() == "load"
                && name != nullptr && name->is_string() && name->as_string() == "num"
                && args_value->as_array().size() == 2;
        }
        if (kind == "binary_op") {
            const auto* left = optional_field(object, "left");
            const auto* right = optional_field(object, "right");
            return left != nullptr && right != nullptr
                && (is_complex_expression(*left, state)
                    || is_complex_expression(*right, state));
        }
        return false;
    }

    void format_complex_on_stack(FunctionState& state) {
        const auto complex = add_temporary_local(state, ValueType::Number);
        const auto real = add_temporary_local(state, ValueType::Number);
        const auto imaginary = add_temporary_local(state, ValueType::Number);
        const auto result = add_temporary_local(state, ValueType::String);
        emit(state, Opcode::StoreLocal, ValueType::Number, complex);
        emit(state, Opcode::LoadLocal, ValueType::Number, complex);
        emit(state, Opcode::ComplexReal, ValueType::Number);
        emit(state, Opcode::StoreLocal, ValueType::Number, real);
        emit(state, Opcode::PushConstant, ValueType::String,
            intern_constant(Constant::utf8_string("")));
        emit(state, Opcode::StoreLocal, ValueType::String, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, real);
        emit_number(state, 0.0);
        emit(state, Opcode::Less, ValueType::Boolean);
        const auto real_nonnegative_jump = state.function->instructions.size();
        emit(state, Opcode::JumpIfFalse, ValueType::Void);
        emit(state, Opcode::LoadLocal, ValueType::String, result);
        append_static_text(state, "-");
        emit(state, Opcode::StoreLocal, ValueType::String, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, real);
        emit(state, Opcode::Absolute, ValueType::Number);
        emit(state, Opcode::StoreLocal, ValueType::Number, real);
        const auto real_nonnegative = checked_index(state.function->instructions.size(),
            "complex display real sign continuation");
        emit(state, Opcode::Nop, ValueType::Void);
        patch_jump(state, real_nonnegative_jump, real_nonnegative);
        emit(state, Opcode::LoadLocal, ValueType::String, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, real);
        emit(state, Opcode::NumberToString, ValueType::String);
        emit(state, Opcode::StringConcat, ValueType::String);
        emit(state, Opcode::StoreLocal, ValueType::String, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, complex);
        emit(state, Opcode::ComplexImag, ValueType::Number);
        emit(state, Opcode::StoreLocal, ValueType::Number, imaginary);
        emit(state, Opcode::LoadLocal, ValueType::Number, imaginary);
        emit_number(state, 0.0);
        emit(state, Opcode::Less, ValueType::Boolean);
        const auto nonnegative_jump = state.function->instructions.size();
        emit(state, Opcode::JumpIfFalse, ValueType::Void);
        emit(state, Opcode::LoadLocal, ValueType::String, result);
        append_static_text(state, " - ");
        emit(state, Opcode::StoreLocal, ValueType::String, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, imaginary);
        emit(state, Opcode::Absolute, ValueType::Number);
        emit(state, Opcode::StoreLocal, ValueType::Number, imaginary);
        const auto sign_done_jump = state.function->instructions.size();
        emit(state, Opcode::Jump, ValueType::Void);
        const auto nonnegative = checked_index(state.function->instructions.size(),
            "complex display positive sign");
        emit(state, Opcode::Nop, ValueType::Void);
        patch_jump(state, nonnegative_jump, nonnegative);
        emit(state, Opcode::LoadLocal, ValueType::String, result);
        append_static_text(state, " + ");
        emit(state, Opcode::StoreLocal, ValueType::String, result);
        const auto sign_done = checked_index(state.function->instructions.size(),
            "complex display sign continuation");
        emit(state, Opcode::Nop, ValueType::Void);
        patch_jump(state, sign_done_jump, sign_done);
        emit(state, Opcode::LoadLocal, ValueType::String, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, imaginary);
        emit(state, Opcode::NumberToString, ValueType::String);
        emit(state, Opcode::StringConcat, ValueType::String);
        append_static_text(state, "i");
    }

    void format_number_on_stack(
        FunctionState& state,
        const std::string& format,
        const std::string& context
    ) {
        if (format.empty()) {
            emit(state, Opcode::NumberToString, ValueType::String);
            return;
        }
        const auto precision = runtime_value_semantics::fixed_precision(format);
        if (!precision || *precision != 2) {
            throw BytecodeLoweringError(
                "unsupported numeric interpolation format " + format
                + " in " + context);
        }

        const auto value = add_temporary_local(state, ValueType::Number);
        const auto scaled = add_temporary_local(state, ValueType::Number);
        const auto fraction = add_temporary_local(state, ValueType::Number);
        const auto result = add_temporary_local(state, ValueType::String);
        emit(state, Opcode::StoreLocal, ValueType::Number, value);
        emit(state, Opcode::PushConstant, ValueType::String,
            intern_constant(Constant::utf8_string("")));
        emit(state, Opcode::StoreLocal, ValueType::String, result);

        emit(state, Opcode::LoadLocal, ValueType::Number, value);
        emit_number(state, 0.0);
        emit(state, Opcode::Less, ValueType::Boolean);
        const auto nonnegative_jump = state.function->instructions.size();
        emit(state, Opcode::JumpIfFalse, ValueType::Void);
        emit(state, Opcode::LoadLocal, ValueType::String, result);
        append_static_text(state, "-");
        emit(state, Opcode::StoreLocal, ValueType::String, result);
        const auto nonnegative = checked_index(state.function->instructions.size(),
            "numeric interpolation sign continuation");
        emit(state, Opcode::Nop, ValueType::Void);
        patch_jump(state, nonnegative_jump, nonnegative);

        emit(state, Opcode::LoadLocal, ValueType::Number, value);
        emit(state, Opcode::Absolute, ValueType::Number);
        emit_number(state, 100.0);
        emit(state, Opcode::Multiply, ValueType::Number);
        emit_number(state, 0.5);
        emit(state, Opcode::Add, ValueType::Number);
        emit_number(state, 1.0);
        emit(state, Opcode::FloorDivide, ValueType::Number);
        emit(state, Opcode::StoreLocal, ValueType::Number, scaled);

        emit(state, Opcode::LoadLocal, ValueType::String, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, scaled);
        emit_number(state, 100.0);
        emit(state, Opcode::FloorDivide, ValueType::Number);
        emit(state, Opcode::NumberToString, ValueType::String);
        emit(state, Opcode::StringConcat, ValueType::String);
        append_static_text(state, ".");
        emit(state, Opcode::StoreLocal, ValueType::String, result);

        emit(state, Opcode::LoadLocal, ValueType::Number, scaled);
        emit_number(state, 100.0);
        emit(state, Opcode::Remainder, ValueType::Number);
        emit(state, Opcode::StoreLocal, ValueType::Number, fraction);
        emit(state, Opcode::LoadLocal, ValueType::Number, fraction);
        emit_number(state, 10.0);
        emit(state, Opcode::Less, ValueType::Boolean);
        const auto two_digit_jump = state.function->instructions.size();
        emit(state, Opcode::JumpIfFalse, ValueType::Void);
        emit(state, Opcode::LoadLocal, ValueType::String, result);
        append_static_text(state, "0");
        emit(state, Opcode::StoreLocal, ValueType::String, result);
        const auto two_digit = checked_index(state.function->instructions.size(),
            "numeric interpolation digit continuation");
        emit(state, Opcode::Nop, ValueType::Void);
        patch_jump(state, two_digit_jump, two_digit);
        emit(state, Opcode::LoadLocal, ValueType::String, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, fraction);
        emit(state, Opcode::NumberToString, ValueType::String);
        emit(state, Opcode::StringConcat, ValueType::String);
    }

    void format_stack_value(
        FunctionState& state,
        const std::string& type,
        const std::string& format,
        const std::string& context
    ) {
        const auto family = runtime_value_semantics::display_family(type);
        if (family == runtime_value_semantics::DisplayFamily::Text) {
            if (!format.empty() && format != "s") {
                throw BytecodeLoweringError(
                    "unsupported string interpolation format " + format
                    + " in " + context);
            }
            return;
        }
        if (family == runtime_value_semantics::DisplayFamily::Boolean) {
            if (!format.empty()) {
                throw BytecodeLoweringError(
                    "bit interpolation does not accept a format in " + context);
            }
            const auto false_jump = state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);
            emit(state, Opcode::PushConstant, ValueType::String,
                intern_constant(Constant::utf8_string("true")));
            const auto end_jump = state.function->instructions.size();
            emit(state, Opcode::Jump, ValueType::Void);
            const auto false_target = checked_index(state.function->instructions.size(),
                "bit interpolation false branch");
            emit(state, Opcode::Nop, ValueType::Void);
            emit(state, Opcode::PushConstant, ValueType::String,
                intern_constant(Constant::utf8_string("false")));
            const auto end_target = checked_index(state.function->instructions.size(),
                "bit interpolation continuation");
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, false_jump, false_target);
            patch_jump(state, end_jump, end_target);
            return;
        }
        if (family == runtime_value_semantics::DisplayFamily::Number) {
            format_number_on_stack(state, format, context);
            return;
        }
        if (family == runtime_value_semantics::DisplayFamily::Record) {
            if (!format.empty()) {
                throw BytecodeLoweringError(
                    "aggregate interpolation does not accept a format in " + context);
            }
            const auto object = add_temporary_local(state, ValueType::Object);
            const auto result = add_temporary_local(state, ValueType::String);
            emit(state, Opcode::StoreLocal, ValueType::Object, object);
            emit(state, Opcode::PushConstant, ValueType::String,
                intern_constant(Constant::utf8_string("(")));
            emit(state, Opcode::StoreLocal, ValueType::String, result);
            const auto fields = runtime_value_semantics::record_fields(type);
            if (!fields) {
                throw BytecodeLoweringError(
                    "record interpolation field needs a type in " + context);
            }
            for (std::size_t index = 0; index < fields->size(); ++index) {
                const auto& name = fields->at(index).name;
                const auto& field_type = fields->at(index).type;
                emit(state, Opcode::LoadLocal, ValueType::String, result);
                append_static_text(state, (index == 0 ? "" : ", ") + name + ":");
                emit(state, Opcode::LoadLocal, ValueType::Object, object);
                emit(state, Opcode::ObjectGet, ValueType::Dynamic,
                    intern_constant(Constant::utf8_string(name)));
                format_stack_value(state, field_type, "", context + "." + name);
                emit(state, Opcode::StringConcat, ValueType::String);
                emit(state, Opcode::StoreLocal, ValueType::String, result);
            }
            emit(state, Opcode::LoadLocal, ValueType::String, result);
            append_static_text(state, ")");
            return;
        }
        throw BytecodeLoweringError(
            "unsupported interpolation type " + type + " in " + context);
    }

    ValueType lower_interpolated_string(
        const vf::JsonValue::Object& object,
        FunctionState& state,
        const std::string& context
    ) {
        emit(state, Opcode::PushConstant, ValueType::String,
            intern_constant(Constant::utf8_string("")));
        const auto& segments = array_of(field(object, "segments", context),
            context + ".segments");
        for (std::size_t index = 0; index < segments.size(); ++index) {
            const auto segment_context = context + ".segments[" + std::to_string(index) + "]";
            const auto& segment = object_of(segments[index], segment_context);
            const auto kind = string_field(segment, "kind", segment_context);
            if (kind == "interpolation_text") {
                append_static_text(state, string_field(segment, "value", segment_context));
                continue;
            }
            if (kind != "interpolation_value") {
                throw BytecodeLoweringError(
                    "unsupported interpolation segment " + kind + " in " + segment_context);
            }
            const auto& value = object_of(field(segment, "value", segment_context),
                segment_context + ".value");
            lower_expression(vf::JsonValue(value), state, segment_context + ".value");
            const auto& format_value = field(segment, "format", segment_context);
            if (!format_value.is_string()) {
                throw BytecodeLoweringError(
                    "expected string field format in " + segment_context);
            }
            format_stack_value(state, string_field(value, "type", segment_context + ".value"),
                format_value.as_string(), segment_context);
            emit(state, Opcode::StringConcat, ValueType::String);
        }
        return ValueType::String;
    }

    ValueType lower_record_selector(
        const vf::JsonValue::Object& object,
        FunctionState& state,
        const std::string& context,
        const std::function<void()>& on_missing
    ) {
        const auto& selector = object_of(field(object, "selector", context),
            context + ".selector");
        const auto& fields = array_of(field(object, "fields", context),
            context + ".fields");
        std::vector<runtime_value_semantics::SelectorField> selector_fields;
        selector_fields.reserve(fields.size());
        for (std::size_t index = 0; index < fields.size(); ++index) {
            const auto field_context = context + ".fields[" + std::to_string(index) + "]";
            const auto& candidate = object_of(fields[index], field_context);
            selector_fields.push_back({
                string_field(candidate, "name", field_context),
                string_field(candidate, "type", field_context),
            });
        }
        const auto* fallback = optional_field(object, "fallback_symbol");
        std::optional<std::string> fallback_symbol;
        if (fallback != nullptr) {
            if (!fallback->is_string() || fallback->as_string().empty()) {
                throw BytecodeLoweringError(
                    "record selector fallback symbol must be a string in " + context);
            }
            fallback_symbol = fallback->as_string();
        }
        const auto plan = runtime_value_semantics::record_selector_plan(
            string_field(selector, "type", context + ".selector"),
            string_field(object, "type", context),
            std::move(selector_fields), std::move(fallback_symbol));
        if (!plan) {
            throw BytecodeLoweringError(
                "record selector requires ordered fields and a string selector in " + context);
        }
        const auto base_local = add_temporary_local(state, ValueType::Object);
        const auto selector_local = add_temporary_local(state, ValueType::String);
        const auto result_type = expression_type(object, context);
        const auto result_local = add_temporary_local(state, result_type);
        lower_expression(field(object, "base", context), state, context + ".base");
        emit(state, Opcode::StoreLocal, ValueType::Object, base_local);
        lower_expression(field(object, "selector", context), state, context + ".selector");
        emit(state, Opcode::StoreLocal, ValueType::String, selector_local);
        std::vector<std::size_t> finish_jumps;
        for (const auto& candidate : plan->fields) {
            emit(state, Opcode::LoadLocal, ValueType::String, selector_local);
            emit(state, Opcode::PushConstant, ValueType::String,
                intern_constant(Constant::utf8_string(candidate.name)));
            emit(state, Opcode::Equal, ValueType::Boolean);
            const auto next_field = state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);
            emit(state, Opcode::LoadLocal, ValueType::Object, base_local);
            emit(state, Opcode::ObjectGet, result_type,
                intern_constant(Constant::utf8_string(candidate.name)));
            emit(state, Opcode::StoreLocal, result_type, result_local);
            finish_jumps.push_back(state.function->instructions.size());
            emit(state, Opcode::Jump, ValueType::Void);
            const auto next_target = checked_index(state.function->instructions.size(),
                "record selector next field");
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, next_field, next_target);
        }
        if (plan->fallback_symbol) {
            const auto target = function_bindings_.find(*plan->fallback_symbol);
            if (target == function_bindings_.end()) {
                throw BytecodeLoweringError(
                    "unknown record selector fallback " + *plan->fallback_symbol
                    + " in " + context);
            }
            if (target->second.arity != 2 || target->second.return_type != result_type) {
                throw BytecodeLoweringError(
                    "record selector fallback signature is incompatible (arity "
                    + std::to_string(target->second.arity) + ", return "
                    + std::to_string(static_cast<unsigned>(target->second.return_type))
                    + ", result " + std::to_string(static_cast<unsigned>(result_type))
                    + ") in " + context);
            }
            emit(state, Opcode::LoadLocal, ValueType::Object, base_local);
            emit(state, Opcode::LoadLocal, ValueType::String, selector_local);
            emit(state, Opcode::Call, result_type,
                target->second.function_index, target->second.arity);
            emit(state, Opcode::StoreLocal, result_type, result_local);
            finish_jumps.push_back(state.function->instructions.size());
            emit(state, Opcode::Jump, ValueType::Void);
        }
        on_missing();
        const auto finish_target = checked_index(state.function->instructions.size(),
            "record selector continuation");
        emit(state, Opcode::Nop, ValueType::Void);
        for (const auto jump : finish_jumps) patch_jump(state, jump, finish_target);
        emit(state, Opcode::LoadLocal, result_type, result_local);
        return result_type;
    }

    ValueType lower_expression(
        const vf::JsonValue& expression,
        FunctionState& state,
        const std::string& context
    ) {
        const auto& object = object_of(expression, context);
        const std::string kind = string_field(object, "kind", context);
        if (kind == "interpolated_string") {
            return lower_interpolated_string(object, state, context);
        }
        if (kind == "wasm_output_reset") {
            emit(state, Opcode::ResetOutput, ValueType::Dynamic);
            return ValueType::Dynamic;
        }
        if (kind == "wasm_output_values") {
            emit(state, Opcode::OutputValues, ValueType::Array);
            return ValueType::Array;
        }
        if (kind == "retained_ui_effect") {
            emit(state, Opcode::PushConstant, ValueType::String,
                intern_constant(Constant::utf8_string(
                    string_field(object, "effect_kind", context))));
            std::size_t identity_count = 0;
            for (const auto* identity : {"display_id", "operation_index"}) {
                const auto* value = optional_field(object, identity);
                if (value == nullptr) continue;
                if (!value->is_number() || !std::isfinite(value->as_number())
                    || value->as_number() < 0.0
                    || std::floor(value->as_number()) != value->as_number()) {
                    throw BytecodeLoweringError(
                        "invalid retained UI effect identity " + std::string(identity)
                        + " in " + context);
                }
                emit(state, Opcode::PushConstant, ValueType::String,
                    intern_constant(Constant::utf8_string(identity)));
                emit_number(state, value->as_number());
                ++identity_count;
            }
            const auto& arguments = array_of(field(object, "arguments", context),
                context + ".arguments");
            for (std::size_t index = 0; index < arguments.size(); ++index) {
                const auto argument_context = context + ".arguments[" +
                    std::to_string(index) + "]";
                const auto& argument = object_of(arguments[index], argument_context);
                emit(state, Opcode::PushConstant, ValueType::String,
                    intern_constant(Constant::utf8_string(
                        string_field(argument, "name", argument_context))));
                lower_expression(field(argument, "value", argument_context), state,
                    argument_context + ".value");
            }
            emit(state, Opcode::MakeArray, ValueType::Array,
                checked_index(1 + (identity_count + arguments.size()) * 2,
                    "UI effect operand count"));
            emit(state, Opcode::CaptureUiEffect, ValueType::Dynamic);
            emit(state, Opcode::Pop, ValueType::Void);
            return lower_expression(field(object, "result", context), state,
                context + ".result");
        }
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
        if (kind == "axis_align") {
            return lower_expression(field(object, "value", context), state, context + ".value");
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
        if (kind == "list" || kind == "tuple") {
            const auto& items = array_of(
                field(object, "items", context),
                context + ".items"
            );
            std::size_t emitted_items = 0;
            for (std::size_t index = 0; index < items.size(); ++index) {
                const auto item_context = context + ".items[" + std::to_string(index) + "]";
                const auto& item = object_of(items[index], item_context);
                if (string_field(item, "kind", item_context) == "spread") {
                    const auto& literal = object_of(field(item, "value", item_context),
                        item_context + ".value");
                    const auto literal_kind = string_field(literal, "kind", item_context + ".value");
                    if (literal_kind != "list" && literal_kind != "tuple") {
                        throw BytecodeLoweringError(
                            "WASM literal spread requires a fixed list or tuple in " + item_context);
                    }
                    const auto& spread_items = array_of(field(literal, "items", item_context + ".value"),
                        item_context + ".value.items");
                    for (std::size_t spread_index = 0; spread_index < spread_items.size(); ++spread_index) {
                        lower_expression(spread_items[spread_index], state,
                            item_context + ".value.items[" + std::to_string(spread_index) + "]");
                    }
                    emitted_items += spread_items.size();
                } else {
                    lower_expression(items[index], state, item_context);
                    ++emitted_items;
                }
            }
            const bool spread_tuple = kind == "tuple" && std::any_of(
                items.begin(), items.end(), [&](const vf::JsonValue& item) {
                    return string_field(object_of(item, context + ".item"),
                        "kind", context + ".item") == "spread";
                });
            emit(
                state,
                kind == "tuple" && !spread_tuple ? Opcode::MakeTuple : Opcode::MakeArray,
                kind == "tuple" && !spread_tuple ? ValueType::Dynamic : ValueType::Array,
                checked_index(emitted_items, "array item count")
            );
            return kind == "tuple" && !spread_tuple ? ValueType::Dynamic : ValueType::Array;
        }
        if (kind == "multiset") {
            const auto& pairs = array_of(field(object, "pairs", context),
                context + ".pairs");
            for (std::size_t index = 0; index < pairs.size(); ++index) {
                const auto pair_context = context + ".pairs[" + std::to_string(index) + "]";
                const auto& pair = object_of(pairs[index], pair_context);
                if (string_field(pair, "kind", pair_context) != "multiset_pair") {
                    throw BytecodeLoweringError(
                        "WASM multiset requires key/count pairs in " + pair_context);
                }
                lower_expression(field(pair, "key", pair_context), state,
                    pair_context + ".key");
                lower_expression(field(pair, "count", pair_context), state,
                    pair_context + ".count");
            }
            emit(state, Opcode::MakeMultiset, ValueType::Dynamic,
                checked_index(pairs.size(), "multiset pair count"));
            return ValueType::Dynamic;
        }
        if (kind == "scope_identity") {
            using Validation = vkf::stat_semantics::Validation<BytecodeLoweringError>;
            const std::string type = string_field(object, "type", context);
            if (type.rfind("record{", 0) != 0 || type.back() != '}') {
                throw BytecodeLoweringError("machine IR scope identity requires a record type");
            }
            emit(state, Opcode::MakeObject, ValueType::Object);
            // The frontend's original scope type is the authoritative field
            // list and order, not backend temporaries or all allocated locals.
            for (const auto& field_surface : Validation::split_top_level(
                    type.substr(7, type.size() - 8), ',')) {
                const auto colon = Validation::find_top_level(field_surface, ':');
                if (colon == std::string::npos) {
                    throw BytecodeLoweringError("machine IR scope identity field needs a type");
                }
                const std::string name = Validation::trim(field_surface.substr(0, colon));
                vf::JsonValue::Object load;
                load["kind"] = "load";
                load["name"] = name;
                const ValueType value_type = lower_expression(
                    vf::JsonValue(std::move(load)), state, context + "." + name);
                emit(state, Opcode::ObjectSet, value_type,
                    intern_constant(Constant::utf8_string(name)));
            }
            return ValueType::Object;
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
                const std::string record_field_kind = string_field(
                        record_field,
                        "kind",
                        field_context
                    );
                if (record_field_kind != "field" && record_field_kind != "record_field") {
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
            const std::string object_surface = string_field(object, "object_type", context);
            const std::string member = string_field(object, "field", context);
            bool known_nominal_record = false;
            bool declared_member = false;
            for (const auto& alias : typed_module_.type_aliases) {
                if (alias.name != object_surface) continue;
                const auto& annotation = object_of(alias.type_annotation,
                    context + ".object_type");
                const std::string surface = string_field(annotation, "name",
                    context + ".object_type");
                if (surface.size() < 2 || surface.front() != '(' || surface.back() != ')') {
                    break;
                }
                known_nominal_record = true;
                for (const auto& field_surface :
                    vkf::stat_semantics::Validation<BytecodeLoweringError>::split_top_level(
                        surface.substr(1, surface.size() - 2), ',')) {
                    const auto colon = vkf::stat_semantics::Validation<BytecodeLoweringError>
                        ::find_top_level(field_surface, ':');
                    if (colon != std::string::npos
                        && vkf::stat_semantics::Validation<BytecodeLoweringError>::trim(
                            field_surface.substr(0, colon)) == member) {
                        declared_member = true;
                        break;
                    }
                }
                break;
            }
            const auto dot_fallback = function_bindings_.find(".");
            if (known_nominal_record && !declared_member
                && dot_fallback != function_bindings_.end()
                && dot_fallback->second.arity == 2) {
                lower_expression(field(object, "object", context), state,
                    context + ".object");
                emit(state, Opcode::PushConstant, ValueType::String,
                    intern_constant(Constant::utf8_string(member)));
                emit(state, Opcode::Call, dot_fallback->second.return_type,
                    dot_fallback->second.function_index, dot_fallback->second.arity);
                return dot_fallback->second.return_type;
            }
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
                    member
                ))
            );
            return result_type;
        }
        if (kind == "record_selector") {
            return lower_record_selector(object, state, context, [&] {
                emit(state, Opcode::Trap, ValueType::Void);
            });
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
            const auto* nested_field = optional_field(object, "nested_index");
            const bool nested = nested_field != nullptr
                && nested_field->is_boolean() && nested_field->as_boolean();
            const auto& base_object = object_of(field(object, "base", context), context + ".base");
            const auto base_path = vector_path(string_field(base_object, "type", context + ".base"));
            if (indices.size() > 1 && !nested && base_path == "*") {
                const auto base = add_temporary_local(state, ValueType::Array);
                emit(state, Opcode::StoreLocal, ValueType::Array, base);
                for (std::size_t index = 0; index < indices.size(); ++index) {
                    emit(state, Opcode::LoadLocal, ValueType::Array, base);
                    lower_expression(indices[index], state,
                        context + ".indices[" + std::to_string(index) + "]");
                    emit(state, Opcode::ArrayGet, ValueType::Dynamic);
                }
                emit(state, Opcode::MakeArray, ValueType::Array,
                    checked_index(indices.size(), "gather index count"));
                return ValueType::Array;
            }
            const auto shaped_index = std::find_if(indices.begin(), indices.end(), [&](const auto& value) {
                const auto& candidate = object_of(value, context + ".shaped_index");
                return string_field(candidate, "kind", context + ".shaped_index") == "list";
            });
            if (nested && indices.size() > 1 && shaped_index != indices.end()) {
                const auto base = add_temporary_local(state, ValueType::Array);
                emit(state, Opcode::StoreLocal, ValueType::Array, base);
                std::vector<std::uint32_t> index_locals;
                std::vector<bool> index_arrays;
                for (std::size_t index = 0; index < indices.size(); ++index) {
                    const auto index_context = context + ".indices[" + std::to_string(index) + "]";
                    const auto type = lower_expression(indices[index], state, index_context);
                    const auto local = add_temporary_local(state, type);
                    emit(state, Opcode::StoreLocal, type, local);
                    index_locals.push_back(local);
                    index_arrays.push_back(type == ValueType::Array);
                }
                std::function<void(const vf::JsonValue&, std::vector<std::size_t>)> emit_gather;
                emit_gather = [&](const vf::JsonValue& shape, std::vector<std::size_t> path) {
                    const auto& shape_object = object_of(shape, context + ".gather_shape");
                    const auto& items = array_of(field(shape_object, "items", context + ".gather_shape"),
                        context + ".gather_shape.items");
                    const bool nested_shape = !items.empty() && object_of(items.front(),
                        context + ".gather_shape.item").find("items")
                        != object_of(items.front(), context + ".gather_shape.item").end();
                    for (std::size_t item = 0; item < items.size(); ++item) {
                        auto item_path = path;
                        item_path.push_back(item);
                        if (nested_shape) {
                            emit_gather(items[item], std::move(item_path));
                            continue;
                        }
                        emit(state, Opcode::LoadLocal, ValueType::Array, base);
                        for (std::size_t index = 0; index < index_locals.size(); ++index) {
                            if (index_arrays[index]) {
                                emit(state, Opcode::LoadLocal, ValueType::Array, index_locals[index]);
                                for (const auto component : item_path) {
                                    emit_number(state, static_cast<double>(component));
                                    emit(state, Opcode::ArrayGet, ValueType::Dynamic);
                                }
                            } else {
                                emit(state, Opcode::LoadLocal, ValueType::Number, index_locals[index]);
                            }
                            emit(state, Opcode::ArrayGet, ValueType::Dynamic);
                        }
                    }
                    emit(state, Opcode::MakeArray, ValueType::Array,
                        checked_index(items.size(), "gather result count"));
                };
                emit_gather(*shaped_index, {});
                return ValueType::Array;
            }
            const auto* expanded_count_value = optional_field(object, "expanded_index_count");
            std::size_t expanded_count = indices.size();
            if (expanded_count_value != nullptr) {
                if (!expanded_count_value->is_number() || expanded_count_value->as_number() < 0
                    || std::floor(expanded_count_value->as_number())
                        != expanded_count_value->as_number()) {
                    throw BytecodeLoweringError(
                        "index expression requires a fixed expanded count in " + context);
                }
                expanded_count = static_cast<std::size_t>(expanded_count_value->as_number());
            } else if (std::any_of(indices.begin(), indices.end(), [&](const auto& index) {
                    const auto& index_object = object_of(index, context + ".index");
                    return string_field(index_object, "kind", context + ".index")
                        == "spread_index";
                })) {
                throw BytecodeLoweringError(
                    "spread index expression requires a fixed expanded count in " + context);
            }
            std::size_t expanded_index = 0;
            for (std::size_t index = 0; index < indices.size(); ++index) {
                const auto index_context = context + ".indices[" + std::to_string(index) + "]";
                const auto& index_object = object_of(indices[index], index_context);
                if (string_field(index_object, "kind", index_context) == "spread_index") {
                    const auto count_value = field(index_object, "count", index_context);
                    if (!count_value.is_number() || count_value.as_number() < 0
                        || std::floor(count_value.as_number()) != count_value.as_number()) {
                        throw BytecodeLoweringError("spread index requires a fixed count in " + index_context);
                    }
                    const auto spread_count = static_cast<std::size_t>(count_value.as_number());
                    const auto spread = add_temporary_local(state, ValueType::Array);
                    lower_expression(field(index_object, "value", index_context), state,
                        index_context + ".value");
                    emit(state, Opcode::StoreLocal, ValueType::Array, spread);
                    for (std::size_t component = 0; component < spread_count; ++component) {
                        emit(state, Opcode::LoadLocal, ValueType::Array, spread);
                        emit_number(state, static_cast<double>(component));
                        emit(state, Opcode::ArrayGet, ValueType::Number);
                        ++expanded_index;
                        result_type = expanded_index == expanded_count
                            ? expression_type(object, context) : ValueType::Dynamic;
                        emit(state, Opcode::ArrayGet, result_type);
                    }
                    continue;
                }
                lower_expression(
                    indices[index],
                    state,
                    index_context
                );
                ++expanded_index;
                result_type = expanded_index == expanded_count
                    ? expression_type(object, context)
                    : ValueType::Dynamic;
                emit(state, Opcode::ArrayGet, result_type);
            }
            return result_type;
        }
        if (kind == "block_expr" || kind == "block") {
            const auto outer_locals = state.locals;
            const auto outer_scope_local_begin = state.scope_local_begin;
            state.scope_local_begin = state.function->local_types.size();
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
                    state.scope_local_begin = outer_scope_local_begin;
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
            state.scope_local_begin = outer_scope_local_begin;
            return ValueType::Dynamic;
        }
        if (kind == "if_expr") {
            const auto& body = object_of(
                field(object, "body", context),
                context + ".body"
            );
            const std::string body_surface = string_field(
                body,
                "type",
                context + ".body"
            );
            if (body_surface != "int" && body_surface != "num"
                && body_surface != "f32" && body_surface != "f64"
                && body_surface != "i32" && body_surface != "i64") {
                throw BytecodeLoweringError(
                    "unsupported expression kind if_expr in " + context
                );
            }
            lower_expression(
                field(object, "condition", context),
                state,
                context + ".condition"
            );
            const std::size_t false_jump = state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);
            const ValueType body_type = lower_expression(
                field(object, "body", context),
                state,
                context + ".body"
            );
            if (body_type != ValueType::Number) {
                throw BytecodeLoweringError(
                    "unsupported expression kind if_expr in " + context
                );
            }
            const std::size_t end_jump = state.function->instructions.size();
            emit(state, Opcode::Jump, ValueType::Void);
            const auto false_target = checked_index(
                state.function->instructions.size(),
                "conditional expression false arm"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            emit_number(state, std::numeric_limits<double>::quiet_NaN());
            const auto end_target = checked_index(
                state.function->instructions.size(),
                "conditional expression continuation"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, false_jump, false_target);
            patch_jump(state, end_jump, end_target);
            return ValueType::Number;
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
        if (kind == "assert_expr") {
            lower_expression(
                field(object, "condition", context),
                state,
                context + ".condition"
            );
            emit(state, Opcode::Duplicate, ValueType::Boolean);
            const std::size_t failure_jump =
                state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);
            const std::size_t success_jump =
                state.function->instructions.size();
            emit(state, Opcode::Jump, ValueType::Void);
            const auto failure_target = checked_index(
                state.function->instructions.size(),
                "assertion failure"
            );
            emit(state, Opcode::Pop, ValueType::Void);
            emit(state, Opcode::Trap, ValueType::Void);
            const auto success_target = checked_index(
                state.function->instructions.size(),
                "assertion continuation"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, failure_jump, failure_target);
            patch_jump(state, success_jump, success_target);
            return ValueType::Boolean;
        }
        if (kind == "binary_op") {
            const std::string op = string_field(object, "op", context);
            const std::string left_multiset_type = string_field(object, "left_type", context);
            const std::string right_multiset_type = string_field(object, "right_type", context);
            if (left_multiset_type.rfind("multiset<", 0) == 0
                && right_multiset_type.rfind("multiset<", 0) == 0) {
                const std::map<std::string, std::uint32_t> operations{
                    {"PLUS", 0}, {"MINUS", 1}, {"FLOORDIV", 2}, {"PERCENT", 3},
                };
                const auto operation = operations.find(op);
                if (operation != operations.end()) {
                    lower_expression(field(object, "left", context), state, context + ".left");
                    lower_expression(field(object, "right", context), state, context + ".right");
                    emit(state, Opcode::MultisetAlgebra, ValueType::Dynamic, operation->second);
                    return ValueType::Dynamic;
                }
            }
            if (op == "XOR") {
                lower_expression(field(object, "left", context), state, context + ".left");
                emit_booleanize(state);
                lower_expression(field(object, "right", context), state, context + ".right");
                emit_booleanize(state);
                emit(state, Opcode::NotEqual, ValueType::Boolean);
                return ValueType::Boolean;
            }
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
            const bool complex_left = is_complex_expression(field(object, "left", context), state);
            const bool complex_right = is_complex_expression(field(object, "right", context), state);
            if (complex_left || complex_right) {
                if (op != "STAR" || !complex_left || !complex_right) {
                    throw BytecodeLoweringError(
                        "unsupported complex binary operator " + op + " in " + context);
                }
                emit(state, Opcode::ComplexMultiply, ValueType::Number);
                return ValueType::Number;
            }
            Opcode opcode = (op == "AMPERSAND" || op == "&")
                && left_type == ValueType::Array
                && right_type == ValueType::Array
                ? Opcode::ArrayConcat
                : lower_binary_opcode(op, context);
            const auto left_surface = string_field(object, "left_type", context);
            const auto right_surface = string_field(object, "right_type", context);
            const auto left_path = vector_path(left_surface);
            auto right_path = vector_path(right_surface);
            // Match native's distinct-named-axis outer product. The frontend
            // owns axis identities and output order; no names are inferred here.
            if (left_surface.rfind("axis<", 0) == 0 && right_surface.rfind("axis<", 0) == 0
                && left_surface.substr(5, left_surface.find('>') - 5)
                    != right_surface.substr(5, right_surface.find('>') - 5)) {
                for (const auto character : left_path) {
                    if (character == '*') right_path = "-." + right_path;
                }
            }
            if (opcode != Opcode::ArrayConcat
                && !runtime_value_semantics::aggregate_comparison_is_structural(op)
                && (!left_path.empty() || !right_path.empty())) {
                const auto right_local = add_temporary_local(state, ValueType::Dynamic);
                const auto left_local = add_temporary_local(state, ValueType::Dynamic);
                emit(state, Opcode::StoreLocal, ValueType::Dynamic, right_local);
                emit(state, Opcode::StoreLocal, ValueType::Dynamic, left_local);
                lower_vector_map(state, {left_local, right_local}, {left_path, right_path}, context,
                    [&]() {
                        if (comparison_opcode(opcode)) {
                            emit(state, opcode, ValueType::Boolean);
                            emit(state, Opcode::BitAsNumber, ValueType::Number);
                        } else {
                            emit(state, opcode, ValueType::Number);
                        }
                    });
                return ValueType::Array;
            }
            if (left_type == ValueType::String
                && right_type == ValueType::String) {
                if (opcode == Opcode::Less) opcode = Opcode::StringLess;
                if (opcode == Opcode::LessEqual) {
                    opcode = Opcode::StringLessEqual;
                }
                if (opcode == Opcode::Greater) opcode = Opcode::StringGreater;
                if (opcode == Opcode::GreaterEqual) {
                    opcode = Opcode::StringGreaterEqual;
                }
            }
            const ValueType result_type =
                comparison_opcode(opcode) ? ValueType::Boolean : type;
            emit(state, opcode, result_type);
            if (runtime_value_semantics::aggregate_comparison_is_structural(op)
                && (!left_path.empty() || !right_path.empty())) {
                emit(state, Opcode::BitAsNumber, ValueType::Number);
                return ValueType::Number;
            }
            return result_type;
        }
        if (kind == "unary_op") {
            const ValueType type = expression_type(object, context);
            const auto& operand = object_of(field(object, "operand", context),
                context + ".operand");
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
            if (op == "NORM") {
                using Validation = vkf::stat_semantics::Validation<BytecodeLoweringError>;
                const auto shape = Validation::fixed_numeric_vector_shape(
                    string_field(operand, "type", context + ".operand"));
                if (!shape || shape->dimensions.empty()) {
                    throw BytecodeLoweringError(
                        "WASM norm requires a fixed numeric aggregate in " + context);
                }
                const auto source = add_temporary_local(state, ValueType::Array);
                emit(state, Opcode::StoreLocal, ValueType::Array, source);
                emit_number(state, 0.0);
                std::vector<std::size_t> coordinates;
                std::function<void(std::size_t)> emit_components;
                emit_components = [&](std::size_t depth) {
                    if (depth == shape->dimensions.size()) {
                        emit(state, Opcode::LoadLocal, ValueType::Array, source);
                        for (std::size_t index = 0; index < coordinates.size(); ++index) {
                            emit_number(state, static_cast<double>(coordinates[index]));
                            emit(state, Opcode::ArrayGet,
                                index + 1 == coordinates.size()
                                    ? ValueType::Number : ValueType::Array);
                        }
                        emit(state, Opcode::Duplicate, ValueType::Number);
                        emit(state, Opcode::Multiply, ValueType::Number);
                        emit(state, Opcode::Add, ValueType::Number);
                        return;
                    }
                    for (std::size_t index = 0; index < shape->dimensions[depth]; ++index) {
                        coordinates.push_back(index);
                        emit_components(depth + 1);
                        coordinates.pop_back();
                    }
                };
                emit_components(0);
                emit(state, Opcode::SquareRoot, ValueType::Number);
                return ValueType::Number;
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
                const std::string full_name = string_field(callee, "full_name", context + ".callee");
                const auto family = stdlib::classify_call(full_name);
                if (family == stdlib::CallFamily::Statistics) {
                    return lower_stat_call(object, state, context, full_name.substr(5));
                }
                if (family == stdlib::CallFamily::Output && args.size() == 1) {
                    lower_expression(args.front(), state, context + ".args[0]");
                    const auto& argument = object_of(args.front(), context + ".args[0]");
                    const std::string argument_type = string_field(
                        argument, "type", context + ".args[0]");
                    const auto nominal = nominal_display_names_.find(argument_type);
                    if (nominal != nominal_display_names_.end()) {
                        emit(state, Opcode::PrintValue, ValueType::Dynamic,
                            intern_constant(Constant::utf8_string(nominal->second)), 1);
                    } else {
                        emit(state, Opcode::PrintValue, ValueType::Dynamic);
                    }
                    return ValueType::Dynamic;
                }
                if (family == stdlib::CallFamily::BrowserCapability) {
                    // Browser target has no host imports. Keep the established
                    // public diagnostic while making denial an explicit
                    // compiler target-capability decision.
                    throw BytecodeLoweringError(
                        "unsupported standard-library call " + full_name
                        + " in " + context);
                }
                if (family == stdlib::CallFamily::Collection) {
                    const auto& spreads = array_of(field(object, "spread_args", context), context);
                    const auto& named = array_of(field(object, "named_args", context), context);
                    if (!spreads.empty()) throw BytecodeLoweringError("direct machine IR stdlib calls do not accept spread arguments");
                    if (!named.empty()) throw BytecodeLoweringError("direct machine IR stdlib call does not accept named arguments collections.list");
                    for (std::size_t index = 0; index < args.size(); ++index) {
                        lower_expression(args[index], state, context + ".args[" + std::to_string(index) + "]");
                        const auto& argument = object_of(args[index], context);
                        auto layout = machine_ir::detail::layout_from_type(string_field(argument, "type", context));
                        if (layout.width != 1) {
                            throw BytecodeLoweringError("collections.list numeric element requires scalar values, got "
                                + machine_ir::detail::describe_layout(layout));
                        }
                        // Native fixed aggregates flatten into value cells. The
                        // tagged target unwraps the same one-cell vector shape.
                        while (layout.kind == machine_ir::detail::ValueKind::Aggregate
                            && !machine_ir::detail::is_record_layout(layout)) {
                            const auto elements = machine_ir::detail::indexed_element_layouts(layout);
                            if (elements.size() != 1) throw BytecodeLoweringError("unsupported collections.list scalar aggregate layout");
                            emit_number(state, 0);
                            emit(state, Opcode::ArrayGet, ValueType::Dynamic);
                            layout = elements.front();
                        }
                    }
                    emit(state, Opcode::MakeArray, ValueType::Array, checked_index(args.size(), context));
                    return ValueType::Array;
                }
                if (family == stdlib::CallFamily::Regex) {
                    if (args.size() != 2) {
                        throw BytecodeLoweringError(full_name
                            + " requires source and pattern in " + context);
                    }
                    const auto& source = object_of(args[0], context + ".args[0]");
                    const auto& pattern_value = object_of(args[1], context + ".args[1]");
                    const auto* source_literal = optional_field(source, "value");
                    const auto* pattern_literal = optional_field(pattern_value, "value");
                    if (string_field(source, "kind", context + ".args[0]") != "const"
                        || source_literal == nullptr || !source_literal->is_string()) {
                        throw BytecodeLoweringError(
                            "WASM regex runtime source is not yet supported in " + context);
                    }
                    if (string_field(pattern_value, "kind", context + ".args[1]") != "const"
                        || pattern_literal == nullptr || !pattern_literal->is_string()) {
                        throw BytecodeLoweringError(
                            "regex pattern must be a compile-time string constant in " + context);
                    }
                    vkf::capture::Pattern pattern;
                    try {
                        pattern = vkf::capture::parse(pattern_literal->as_string());
                    } catch (const vkf::capture::PatternFailure& error) {
                        throw BytecodeLoweringError(error.what());
                    }
                    const auto captured = vkf::capture::match(
                        pattern, source_literal->as_string());
                    if (!captured) {
                        throw BytecodeLoweringError("regular expression did not match");
                    }
                    if (full_name == "regex.match") {
                        emit(state, Opcode::MakeObject, ValueType::Object);
                        for (std::size_t index = 0; index < captured->groups.size(); ++index) {
                            emit(state, Opcode::PushConstant, ValueType::String,
                                intern_constant(Constant::utf8_string(captured->groups[index])));
                            emit(state, Opcode::ObjectSet, ValueType::String,
                                intern_constant(Constant::utf8_string(
                                    pattern.group_names[index])));
                        }
                        return ValueType::Object;
                    }
                    for (const auto& group : captured->groups) {
                        emit(state, Opcode::PushConstant, ValueType::String,
                            intern_constant(Constant::utf8_string(group)));
                    }
                    emit(state, Opcode::MakeArray, ValueType::Array,
                        checked_index(captured->groups.size(), "regex capture count"));
                    return ValueType::Array;
                }
                if (family != stdlib::CallFamily::MathUnary) {
                    throw BytecodeLoweringError(
                        "unsupported standard-library call " + full_name
                        + " in " + context
                    );
                }
                if (args.size() != 1) {
                    throw BytecodeLoweringError(
                        "WASM math intrinsic requires one argument in "
                        + context
                    );
                }
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
                }
                lower_expression(
                    args.front(),
                    state,
                    context + ".args[0]"
                );
                const auto path = vector_path(string_field(object_of(args.front(), context), "type", context));
                if (!path.empty()) {
                    const auto argument = add_temporary_local(state, ValueType::Array);
                    emit(state, Opcode::StoreLocal, ValueType::Array, argument);
                    lower_vector_map(state, {argument}, {path}, context,
                        [&]() { emit(state, opcode, ValueType::Number); });
                    return ValueType::Array;
                }
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
                const auto& direct_named = array_of(
                    field(object, "named_args", context), context + ".named_args");
                const auto& direct_spreads = array_of(
                    field(object, "spread_args", context), context + ".spread_args");
                if (name == "num" && args.size() == 2
                    && direct_named.empty() && direct_spreads.empty()) {
                    lower_expression(args[0], state, context + ".args[0]");
                    lower_expression(args[1], state, context + ".args[1]");
                    emit(state, Opcode::MakeComplex, ValueType::Number);
                    return ValueType::Number;
                }
                if (name == "num" && args.size() == 1
                    && direct_named.empty() && direct_spreads.empty()) {
                    lower_expression(args.front(), state, context + ".args[0]");
                    return ValueType::Number;
                }
                if (name == "chr" && args.size() == 1
                    && direct_named.empty() && direct_spreads.empty()) {
                    const auto& argument = object_of(args.front(), context + ".args[0]");
                    const auto* literal = optional_field(argument, "value");
                    if (string_field(argument, "kind", context + ".args[0]") == "const"
                        && literal != nullptr && literal->is_number()) {
                        const auto raw = literal->as_number();
                        if (!std::isfinite(raw) || std::floor(raw) != raw || raw < 0
                            || raw > 0x10ffff || (raw >= 0xd800 && raw <= 0xdfff)) {
                            throw BytecodeLoweringError(
                                "chr requires a valid Unicode scalar in " + context);
                        }
                    }
                    lower_expression(args.front(), state, context + ".args[0]");
                    emit(state, Opcode::NumberToUtf8String, ValueType::String);
                    return ValueType::String;
                }
                if (name == "int") {
                    if (args.size() != 1 || !direct_named.empty() || !direct_spreads.empty()) {
                        throw BytecodeLoweringError(
                            "int conversion requires one positional argument in " + context);
                    }
                    lower_expression(args.front(), state, context + ".args[0]");
                    emit(state, Opcode::Duplicate, ValueType::Number);
                    emit(state, Opcode::Duplicate, ValueType::Number);
                    emit_number(state, 1);
                    emit(state, Opcode::FloorDivide, ValueType::Number);
                    emit(state, Opcode::Equal, ValueType::Boolean);
                    const auto failure_jump = state.function->instructions.size();
                    emit(state, Opcode::JumpIfFalse, ValueType::Void);
                    const auto success_jump = state.function->instructions.size();
                    emit(state, Opcode::Jump, ValueType::Void);
                    const auto failure_target = checked_index(
                        state.function->instructions.size(), "int conversion failure");
                    emit(state, Opcode::Pop, ValueType::Void);
                    emit(state, Opcode::Trap, ValueType::Void);
                    const auto success_target = checked_index(
                        state.function->instructions.size(), "int conversion continuation");
                    emit(state, Opcode::Nop, ValueType::Void);
                    patch_jump(state, failure_jump, failure_target);
                    patch_jump(state, success_jump, success_target);
                    return ValueType::Number;
                }
                if (name == "str" && args.size() == 1
                    && direct_named.empty() && direct_spreads.empty()
                    && is_complex_expression(args.front(), state)) {
                    lower_expression(args.front(), state, context + ".args[0]");
                    format_complex_on_stack(state);
                    return ValueType::String;
                }
                if (name == "str" && args.size() == 1
                    && direct_named.empty() && direct_spreads.empty()) {
                    // Dispatch from the compiler-owned lowered value kind,
                    // because imported/self-hosted call surfaces may be `any`
                    // even when the executed operand is a string.
                    const auto argument_type = lower_expression(
                        args.front(), state, context + ".args[0]");
                    if (argument_type == ValueType::String) return ValueType::String;
                    emit(state, Opcode::NumberToString, ValueType::String);
                    return ValueType::String;
                }
                const auto primitive = vkf::math_primitives::classify(name);
                if (primitive != vkf::math_primitives::Kind::None) {
                    vkf::math_primitives::validate_builtin<BytecodeLoweringError>(name, args.size(),
                        array_of(field(object, "named_args", context), context).size(),
                        array_of(field(object, "spread_args", context), context).size());
                    const auto type = lower_expression(args.front(), state, context + ".args[0]");
                    if (type == ValueType::Array || type == ValueType::Object) {
                        throw BytecodeLoweringError("machine IR math builtin requires a scalar value");
                    }
                    using Primitive = vkf::math_primitives::Kind;
                    const Opcode opcode = primitive == Primitive::Absolute ? Opcode::Absolute
                        : primitive == Primitive::SquareRoot ? Opcode::SquareRoot
                        : primitive == Primitive::Sine ? Opcode::Sine
                        : primitive == Primitive::Cosine ? Opcode::Cosine
                        : primitive == Primitive::Exponential ? Opcode::Exponential : Opcode::NaturalLog;
                    emit(state, opcode, ValueType::Number);
                    return ValueType::Number;
                }
                ValueType intrinsic_type = ValueType::Dynamic;
                Opcode intrinsic_opcode = Opcode::Nop;
                if (runtime_intrinsic(
                    name,
                    args.size(),
                    intrinsic_opcode,
                    intrinsic_type
                )) {
                    if (name == "vkf_string_peek_scalar") {
                        intrinsic_type = expression_type(object, context)
                            == ValueType::String
                            ? ValueType::String
                            : ValueType::Number;
                    }
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
            const auto& named_args = array_of(field(object, "named_args", context), context + ".named_args");
            const auto& spread_args = array_of(field(object, "spread_args", context), context + ".spread_args");
            const auto variadic_index = function->second.variadic_positional_index;
            const auto variadic_named_index = function->second.variadic_named_index;
            std::map<std::string, std::size_t> captured_named;
            call_binding::FixedCallPlan call_plan;
            call_binding::PositionalCallPlacement positional_placement;
            try {
                positional_placement = call_binding::plan_positional_call(
                    function->second.arity, args.size(), variadic_index, name);
                call_plan = call_binding::plan_fixed_call(function->second.parameters, positional_placement.fixed_count, {}, name);
                if (variadic_index) {
                    call_plan.parameters[*variadic_index] = call_binding::OperandReference{
                        call_binding::OperandKind::PackedPositional, positional_placement.rest_begin};
                    const auto mask = std::uint32_t{1} << *variadic_index;
                    call_plan.provided_mask |= mask;
                    call_plan.defaulted_mask &= ~mask;
                    call_plan.missing_required_mask &= ~mask;
                }
                for (std::size_t index = 0; index < named_args.size(); ++index) {
                    const auto& named = object_of(named_args[index], context + ".named_args");
                    const auto argument_name = string_field(named, "name", context);
                    const auto parameter = std::find_if(function->second.parameters.begin(), function->second.parameters.end(),
                        [&](const auto& item) { return item.name == argument_name; });
                    if (variadic_named_index && parameter == function->second.parameters.end()) {
                        if (!captured_named.emplace(argument_name, index).second) {
                            throw call_binding::Error("multiple values for variadic named argument " + argument_name);
                        }
                        continue;
                    }
                    if (variadic_index && argument_name == function->second.parameters[*variadic_index].name) {
                        throw call_binding::Error("variadic positional argument must be positional for " + name);
                    }
                    call_binding::bind_named_argument(call_plan, function->second.parameters,
                        string_field(named, "name", context), index, name);
                }
                if (variadic_named_index) {
                    call_plan.parameters[*variadic_named_index] = call_binding::OperandReference{
                        call_binding::OperandKind::PackedNamed, 0};
                    const auto mask = std::uint32_t{1} << *variadic_named_index;
                    call_plan.provided_mask |= mask;
                    call_plan.defaulted_mask &= ~mask;
                    call_plan.missing_required_mask &= ~mask;
                }
            } catch (const call_binding::Error& error) {
                throw BytecodeLoweringError(error.what());
            }
            std::optional<call_binding::FixedSpreadPlan> fixed_spread;
            std::uint32_t fixed_spread_temporary = 0;
            ValueType fixed_spread_type = ValueType::Dynamic;
            if (!spread_args.empty() && !variadic_index) {
                if (spread_args.size() != 1) {
                    throw BytecodeLoweringError("direct machine IR fixed calls support one spread value");
                }
                // Native evaluates this once, before any ordinary operands.
                fixed_spread_type = lower_expression(spread_args.front(), state, context + ".fixed_spread");
                fixed_spread_temporary = add_temporary_local(state, fixed_spread_type);
                emit(state, Opcode::StoreLocal, fixed_spread_type, fixed_spread_temporary);
                if (!inferred_layouts_) inferred_layouts_ = value_layout::infer_module_layouts(typed_module_.inference_source);
                const auto signature = inferred_layouts_->signatures.find(name);
                if (signature == inferred_layouts_->signatures.end()) throw BytecodeLoweringError("missing native inferred function layout for " + name);
                const auto source = machine_ir::detail::layout_from_expression_shape(
                    object_of(spread_args.front(), context), inferred_layouts_->signatures);
                std::vector<call_binding::FixedSpreadParameter> parameters;
                for (std::size_t index = 0; index < function->second.arity; ++index) {
                    parameters.push_back({function->second.parameters[index].name,
                        signature->second.parameters[index], call_plan.parameters[index].has_value(),
                        variadic_named_index && index == *variadic_named_index});
                }
                fixed_spread = call_binding::plan_fixed_spread(source, parameters, name);
                if (fixed_spread->dynamic_list) {
                    // Exact native runtime count diagnostics require the shared
                    // runtime-error channel; a bare trap is not a substitute.
                    throw BytecodeLoweringError("WASM fixed-call binding does not yet support spread arguments for " + name);
                }
                for (const auto& [index, selection] : fixed_spread->parameters) {
                    (void)selection;
                    call_plan.parameters[index] = call_binding::OperandReference{call_binding::OperandKind::FixedSpread, index};
                    const auto mask = std::uint32_t{1} << index;
                    call_plan.provided_mask |= mask;
                    call_plan.defaulted_mask &= ~mask;
                    call_plan.missing_required_mask &= ~mask;
                }
            }
            const FunctionBinding* target = &function->second;
            if (call_plan.defaulted_mask != 0 && call_plan.missing_required_mask == 0) {
                target = &default_call_target(name, function->second, call_plan);
            }
            std::vector<const vf::JsonValue*> parameter_arguments;
            std::map<std::size_t, std::size_t> parameter_positions;
            // Preserve current native parameter-order evaluation. Authored
            // evaluation order is a separate language-authority decision.
            for (std::size_t index = 0; index < function->second.arity; ++index) {
                if (call_plan.parameters[index]) {
                    const auto operand = *call_plan.parameters[index];
                    if (operand.kind == call_binding::OperandKind::PackedNamed) {
                        if (&object == state.forwarded_named_call) {
                            const auto local = *state.forwarded_named_local;
                            emit(state, Opcode::LoadLocal, state.function->local_types[local], local);
                            continue;
                        }
                        if (!inferred_layouts_) inferred_layouts_ = value_layout::infer_module_layouts(typed_module_.inference_source);
                        const auto& signature = inferred_layouts_->signatures.at(name);
                        const auto& parameter_layout = signature.parameters[index];
                        emit(state, Opcode::MakeObject, ValueType::Object);
                        for (const auto& [field_name, slice] : call_binding::named_variadic_fields(parameter_layout)) {
                            const auto supplied = captured_named.find(field_name);
                            if (supplied == captured_named.end()) {
                                throw BytecodeLoweringError("missing captured named argument " + field_name + " for " + name);
                            }
                            const auto& argument = field(object_of(named_args[supplied->second], context), "value", context);
                            const auto type = lower_expression(argument, state, context + ".captured." + field_name);
                            const auto layout = machine_ir::detail::layout_from_expression_shape(
                                object_of(argument, context), inferred_layouts_->signatures);
                            const auto expected = machine_ir::detail::record_field_layout(parameter_layout, field_name, slice);
                            if (!machine_ir::detail::same_layout(layout, expected)) {
                                throw BytecodeLoweringError("variadic named argument layout mismatch for " + name + "." + field_name);
                            }
                            const auto shape = machine_ir::detail::fixed_numeric_vector_shape(
                                string_field(object_of(argument, context), "type", context));
                            if (shape) copy_named_numeric_vector(shape->dimensions, 0, state, context);
                            emit(state, Opcode::ObjectSet, type, intern_constant(Constant::utf8_string(field_name)));
                        }
                        continue;
                    }
                    if (operand.kind == call_binding::OperandKind::FixedSpread) {
                        const auto& selection = fixed_spread->parameters.at(index);
                        const auto& expected = inferred_layouts_->signatures.at(name).parameters[index];
                        if (!machine_ir::detail::same_layout(selection.layout, expected)) {
                            throw BytecodeLoweringError("spread argument layout mismatch for " + name + "." + function->second.parameters[index].name);
                        }
                        emit(state, Opcode::LoadLocal, fixed_spread_type, fixed_spread_temporary);
                        if (fixed_spread->record) {
                            emit(state, Opcode::ObjectGet, ValueType::Dynamic, intern_constant(Constant::utf8_string(selection.selector)));
                        } else {
                            emit(state, Opcode::PushConstant, ValueType::Number, intern_constant(Constant::number_value(selection.index)));
                            emit(state, Opcode::ArrayGet, ValueType::Dynamic);
                        }
                        continue;
                    }
                    if (operand.kind == call_binding::OperandKind::PackedPositional) {
                        for (std::size_t rest = operand.index; rest < args.size(); ++rest) {
                            const auto type = lower_expression(args[rest], state, context + ".variadic[" + std::to_string(rest) + "]");
                            if (type != ValueType::Number && type != ValueType::Boolean) {
                                throw BytecodeLoweringError("variadic numeric argument requires a scalar value");
                            }
                        }
                        emit(state, Opcode::MakeArray, ValueType::Array, checked_index(args.size() - operand.index, context));
                        for (const auto& spread : spread_args) {
                            lower_expression(spread, state, context + ".variadic_spread");
                            if (!inferred_layouts_) inferred_layouts_ = value_layout::infer_module_layouts(typed_module_.inference_source);
                            const auto layout = machine_ir::detail::layout_from_expression_shape(
                                object_of(spread, context), inferred_layouts_->signatures);
                            if (layout.kind != machine_ir::detail::ValueKind::DynamicF64List) {
                                throw BytecodeLoweringError("numeric variadic spread requires a dynamic numeric list");
                            }
                            emit(state, Opcode::ArrayConcat, ValueType::Array);
                        }
                        continue;
                    }
                    const auto& argument = operand.kind == call_binding::OperandKind::Positional
                        ? args[operand.index]
                        : field(object_of(named_args[operand.index], context), "value", context);
                    parameter_positions[index] = parameter_arguments.size();
                    parameter_arguments.push_back(&argument);
                    const auto argument_type = lower_expression(argument, state,
                        context + ".parameter[" + std::to_string(index) + "]");
                    adapt_record_argument(argument, argument_type, name, function->second, index, state, context);
                    continue;
                }
                const auto* default_argument =
                    function->second.default_arguments[index];
                if (default_argument == nullptr) {
                    std::string message = "missing required argument ";
                    message += std::to_string(index);
                    message += " for function ";
                    message += name;
                    message += " in ";
                    message += context;
                    throw BytecodeLoweringError(message);
                }
                // Missing defaults are lowered in the private target's own
                // parameter scope, never against these caller locals.
            }
            const auto* structural = optional_field(object, "structural_call");
            const auto* math = optional_field(object, "elementwise_math");
            const bool elementwise_math = math != nullptr && math->is_boolean() && math->as_boolean();
            if (elementwise_math || (structural != nullptr && structural->is_boolean() && structural->as_boolean())) {
                std::vector<std::string> argument_paths(target->arity);
                if (elementwise_math) {
                    // Source-defined math uses this distinct canonical frontend
                    // flag. Its scalar parameters lift over each actual vector
                    // argument; structural_paths alone is not an argument map.
                    for (std::size_t index = 0; index < parameter_arguments.size(); ++index) {
                        argument_paths[index] = vector_path(string_field(object_of(*parameter_arguments[index], context), "type", context));
                    }
                } else {
                const auto& indices = array_of(field(object, "structural_argument_indices", context), context);
                const auto& paths = array_of(field(object, "structural_paths", context), context);
                if (indices.size() != paths.size()) throw BytecodeLoweringError("invalid structural call metadata in " + context);
                for (std::size_t index = 0; index < indices.size(); ++index) {
                    if (!indices[index].is_number() || !paths[index].is_string()
                        || indices[index].as_number() < 0
                        || indices[index].as_number() >= function->second.arity) {
                        throw BytecodeLoweringError("invalid structural argument in " + context);
                    }
                    const auto position = parameter_positions.find(static_cast<std::size_t>(indices[index].as_number()));
                    if (position == parameter_positions.end()) throw BytecodeLoweringError("unbound structural argument in " + context);
                    argument_paths[position->second] = paths[index].as_string();
                }
                }
                std::vector<std::uint32_t> arguments(target->arity);
                for (std::size_t index = arguments.size(); index-- > 0;) {
                    arguments[index] = add_temporary_local(state, ValueType::Dynamic);
                    emit(state, Opcode::StoreLocal, ValueType::Dynamic, arguments[index]);
                }
                lower_vector_map(state, arguments, argument_paths, context, [&]() {
                    emit(state, Opcode::Call, target->return_type,
                        target->function_index, target->arity);
                });
                return expression_type(object, context);
            }
            emit(state, Opcode::Call, target->return_type,
                target->function_index, target->arity);
            return target->return_type;
        }
        throw BytecodeLoweringError(
            "unsupported expression kind " + kind + " in " + context
        );
    }

    ValueType lower_stat_call(const vf::JsonValue::Object& call, FunctionState& state,
        const std::string& context, const std::string& name) {
        using Validation = vkf::stat_semantics::Validation<BytecodeLoweringError>;
        const auto& args = array_of(field(call, "args", context), context);
        const auto& named = array_of(field(call, "named_args", context), context);
        const auto& spreads = array_of(field(call, "spread_args", context), context);
        if (!spreads.empty()) throw BytecodeLoweringError("direct machine IR stdlib calls do not accept spread arguments");
        const auto ddof = Validation::degrees_of_freedom(name, named);
        if (args.size() != 1) throw BytecodeLoweringError("unsupported machine IR stdlib call stat." + name);
        const auto& argument = object_of(args.front(), context);
        const auto surface = string_field(argument, "type", context);
        const auto shape = Validation::fixed_numeric_vector_shape(surface);
        if (name == "sum" && !named.empty()) {
            if (!shape) throw BytecodeLoweringError("stat.sum axis requires a fixed rectangular numeric vector");
            const auto axes = Validation::constant_stat_sum_axes(named, shape->dimensions.size());
            std::size_t input_count = 1;
            for (const auto dimension : shape->dimensions) input_count *= dimension;
            std::size_t output_count = 1;
            std::vector<std::size_t> output_dimensions;
            for (std::size_t dimension = 0; dimension < shape->dimensions.size(); ++dimension) {
                if (std::find(axes.begin(), axes.end(), dimension) != axes.end()) continue;
                output_count *= shape->dimensions[dimension];
                output_dimensions.push_back(shape->dimensions[dimension]);
            }
            std::vector<std::vector<std::vector<std::size_t>>> groups(output_count);
            for (std::size_t input = 0; input < input_count; ++input) {
                std::vector<std::size_t> coordinates(shape->dimensions.size());
                std::size_t remainder = input;
                for (std::size_t dimension = shape->dimensions.size(); dimension > 0; --dimension) {
                    const auto index = dimension - 1;
                    coordinates[index] = remainder % shape->dimensions[index];
                    remainder /= shape->dimensions[index];
                }
                std::size_t output = 0;
                for (std::size_t dimension = 0; dimension < shape->dimensions.size(); ++dimension) {
                    if (std::find(axes.begin(), axes.end(), dimension) != axes.end()) continue;
                    output = output * shape->dimensions[dimension] + coordinates[dimension];
                }
                groups[output].push_back(std::move(coordinates));
            }
            lower_expression(args.front(), state, context + ".args[0]");
            if (input_count == 0) throw BytecodeLoweringError("stat.sum axis requires a fixed rectangular numeric vector");
            const auto temporary = add_temporary_local(state, ValueType::Array);
            emit(state, Opcode::StoreLocal, ValueType::Array, temporary);
            std::size_t group_index = 0;
            const std::function<void(std::size_t)> emit_result = [&](std::size_t depth) {
                if (depth < output_dimensions.size()) {
                    for (std::size_t index = 0; index < output_dimensions[depth]; ++index) emit_result(depth + 1);
                    emit(state, Opcode::MakeArray, ValueType::Array, checked_index(output_dimensions[depth], context));
                    return;
                }
                const auto& group = groups.at(group_index++);
                if (group.empty()) throw BytecodeLoweringError("stat.sum axis produced an empty reduction group");
                for (const auto& coordinates : group) {
                    emit(state, Opcode::LoadLocal, ValueType::Array, temporary);
                    for (const auto coordinate : coordinates) {
                        emit_number(state, static_cast<double>(coordinate));
                        emit(state, Opcode::ArrayGet, ValueType::Dynamic);
                    }
                }
                emit(state, Opcode::MakeArray, ValueType::Array, checked_index(group.size(), context));
                emit(state, Opcode::StatSum, ValueType::Number, 0, stat_kernels::seed_first);
            };
            emit_result(0);
            return output_dimensions.empty() ? ValueType::Number : ValueType::Array;
        }
        // These are canonical typed-IR vector/list forms, not VKF source text.
        // Shape parsing and constant argument validation are shared with native.
        const bool dynamic = !shape && (surface.rfind("list<", 0) == 0
            || (surface.size() >= 2 && surface.front() == '[' && surface.back() == ']'
                && Validation::find_top_level(surface.substr(1, surface.size() - 2), ':') == std::string::npos));
        std::size_t count = 1;
        if (shape) for (const auto dimension : shape->dimensions) count *= dimension;
        if (!dynamic && (!shape && surface != "num" && surface != "int" && surface != "f32" && surface != "f64"))
            throw BytecodeLoweringError("machine IR stat call requires a non-empty numeric container");
        if (!dynamic && count == 0)
            throw BytecodeLoweringError("machine IR stat call requires a non-empty numeric container");
        if (!dynamic && (name == "variance" || name == "std") && count <= ddof)
            throw BytecodeLoweringError("stat." + name + " input is too small for ddof");
        const auto kind = string_field(argument, "kind", context);
        const bool local_reduction = kind == "load" || kind == "field_access" || kind == "dotted_index";
        const auto flags = dynamic ? stat_kernels::allow_empty
            : local_reduction && count >= 16 ? 0u : stat_kernels::seed_first;
        lower_expression(args.front(), state, context + ".args[0]");
        const auto opcode = name == "sum" ? Opcode::StatSum : name == "mean" ? Opcode::StatMean
            : name == "variance" ? Opcode::StatVariance : name == "std" ? Opcode::StatStdDev
            : name == "range" ? Opcode::StatRange : Opcode::StatCount;
        emit(state, opcode, ValueType::Number, ddof, flags);
        return ValueType::Number;
    }

    static std::string vector_path(const std::string& type) {
        if (type.rfind("axis<", 0) == 0) {
            const auto separator = type.find(">:");
            if (separator != std::string::npos) return vector_path(type.substr(separator + 2));
        }
        std::string path;
        for (std::size_t index = 0; index < type.size() && type[index] == '['; ++index) {
            if (!path.empty()) path += '.';
            path += '*';
        }
        return path;
    }

    void copy_named_numeric_vector(
        const std::vector<std::size_t>& dimensions,
        std::size_t depth,
        FunctionState& state,
        const std::string& context
    ) {
        // Native fixed aggregates cross the call boundary as copied components.
        // Preserve that value isolation without evaluating the source again.
        const auto source = add_temporary_local(state, ValueType::Array);
        emit(state, Opcode::StoreLocal, ValueType::Array, source);
        for (std::size_t index = 0; index < dimensions.at(depth); ++index) {
            emit(state, Opcode::LoadLocal, ValueType::Array, source);
            emit_number(state, static_cast<double>(index));
            emit(state, Opcode::ArrayGet, ValueType::Dynamic);
            if (depth + 1 < dimensions.size()) {
                copy_named_numeric_vector(dimensions, depth + 1, state, context);
            }
        }
        emit(state, Opcode::MakeArray, ValueType::Array, checked_index(dimensions.at(depth), context));
    }

    ValueType emit_record_argument_plan(
        const record_arguments::Plan& plan,
        std::uint32_t source,
        FunctionState& state,
        const std::string& context
    ) {
        if (plan.kind == record_arguments::PlanKind::Leaf) {
            emit(state, Opcode::LoadLocal, ValueType::Array, source);
            for (std::size_t depth = 0; depth < plan.source_indices.size(); ++depth) {
                emit(state, Opcode::PushConstant, ValueType::Number,
                    intern_constant(Constant::number_value(static_cast<double>(plan.source_indices[depth]))));
                emit(state, Opcode::ArrayGet,
                    depth + 1 == plan.source_indices.size() ? ValueType::Number : ValueType::Array);
            }
            return ValueType::Number;
        }
        if (plan.kind == record_arguments::PlanKind::Array) {
            for (const auto& child : plan.children) emit_record_argument_plan(child.second, source, state, context);
            emit(state, Opcode::MakeArray, ValueType::Array, checked_index(plan.children.size(), context));
            return ValueType::Array;
        }
        emit(state, Opcode::MakeObject, ValueType::Object);
        for (const auto& [name, child] : plan.children) {
            const auto type = emit_record_argument_plan(child, source, state, context);
            emit(state, Opcode::ObjectSet, type, intern_constant(Constant::utf8_string(name)));
        }
        return ValueType::Object;
    }

    void adapt_record_argument(
        const vf::JsonValue& argument,
        ValueType actual_type,
        const std::string& name,
        const FunctionBinding& function,
        std::size_t parameter,
        FunctionState& state,
        const std::string& context
    ) {
        // This packet handles fixed numeric arrays entering an inferred record
        // parameter. Already represented records and non-array values retain
        // their existing path; ObjectGet behavior is never broadened.
        if (actual_type != ValueType::Array || !function.inferred_parameters[parameter]) return;
        if (!inferred_layouts_) inferred_layouts_ = value_layout::infer_module_layouts(typed_module_.inference_source);
        const auto signature = inferred_layouts_->signatures.find(name);
        if (signature == inferred_layouts_->signatures.end() || parameter >= signature->second.parameters.size()) {
            throw BytecodeLoweringError("missing native inferred parameter layout for " + name);
        }
        const auto& expected = signature->second.parameters[parameter];
        if (!machine_ir::detail::is_record_layout(expected)) return;
        const auto source = machine_ir::detail::layout_from_expression_shape(
            object_of(argument, context), inferred_layouts_->signatures);
        const auto plan = record_arguments::make_plan(source, expected, name, function.parameters[parameter].name);
        if (!plan) return;
        const auto temporary = add_temporary_local(state, ValueType::Array);
        emit(state, Opcode::StoreLocal, ValueType::Array, temporary);
        emit_record_argument_plan(*plan, temporary, state, context);
    }

    void lower_vector_map(
        FunctionState& state,
        const std::vector<std::uint32_t>& arguments,
        const std::vector<std::string>& paths,
        const std::string& context,
        const std::function<void()>& emit_leaf
    ) {
        std::size_t driver = paths.size();
        for (std::size_t index = 0; index < paths.size(); ++index) {
            if (!paths[index].empty()) {
                if (paths[index] != "*" && paths[index].rfind("*.", 0) != 0
                    && paths[index].rfind("-.", 0) != 0) {
                    throw BytecodeLoweringError("unsupported structural vector path in " + context);
                }
                if (driver == paths.size() && paths[index].front() == '*') driver = index;
            }
        }
        if (driver == paths.size()) {
            for (const auto argument : arguments) emit(state, Opcode::LoadLocal, ValueType::Dynamic, argument);
            emit_leaf();
            return;
        }
        const auto length = add_temporary_local(state, ValueType::Number);
        const auto result = add_temporary_local(state, ValueType::Array);
        const auto position = add_temporary_local(state, ValueType::Number);
        emit(state, Opcode::LoadLocal, ValueType::Array, arguments[driver]);
        emit(state, Opcode::ArrayLength, ValueType::Number);
        emit(state, Opcode::StoreLocal, ValueType::Number, length);
        emit(state, Opcode::LoadLocal, ValueType::Number, length);
        emit(state, Opcode::AllocateArray, ValueType::Array);
        emit(state, Opcode::StoreLocal, ValueType::Array, result);
        emit(state, Opcode::PushConstant, ValueType::Number, intern_constant(Constant::number_value(0)));
        emit(state, Opcode::StoreLocal, ValueType::Number, position);
        const auto start = checked_index(state.function->instructions.size(), context);
        emit(state, Opcode::LoadLocal, ValueType::Number, position);
        emit(state, Opcode::LoadLocal, ValueType::Number, length);
        emit(state, Opcode::Less, ValueType::Boolean);
        const auto finish = state.function->instructions.size();
        emit(state, Opcode::JumpIfFalse, ValueType::Void);
        std::vector<std::uint32_t> children = arguments;
        std::vector<std::string> child_paths = paths;
        for (std::size_t index = 0; index < paths.size(); ++index) {
            if (paths[index].empty()) continue;
            if (paths[index].rfind("-.", 0) == 0) {
                child_paths[index] = paths[index].substr(2);
                continue;
            }
            children[index] = add_temporary_local(state, ValueType::Dynamic);
            emit(state, Opcode::LoadLocal, ValueType::Array, arguments[index]);
            emit(state, Opcode::LoadLocal, ValueType::Number, position);
            emit(state, Opcode::ArrayGet, ValueType::Dynamic);
            emit(state, Opcode::StoreLocal, ValueType::Dynamic, children[index]);
            child_paths[index] = paths[index] == "*" ? "" : paths[index].substr(2);
        }
        emit(state, Opcode::LoadLocal, ValueType::Array, result);
        emit(state, Opcode::LoadLocal, ValueType::Number, position);
        lower_vector_map(state, children, child_paths, context, emit_leaf);
        emit(state, Opcode::ArraySet, ValueType::Array);
        emit(state, Opcode::Pop, ValueType::Void);
        emit(state, Opcode::LoadLocal, ValueType::Number, position);
        emit(state, Opcode::PushConstant, ValueType::Number, intern_constant(Constant::number_value(1)));
        emit(state, Opcode::Add, ValueType::Number);
        emit(state, Opcode::StoreLocal, ValueType::Number, position);
        emit(state, Opcode::Jump, ValueType::Void, start);
        patch_jump(state, finish, checked_index(state.function->instructions.size(), context));
        emit(state, Opcode::Nop, ValueType::Void);
        emit(state, Opcode::LoadLocal, ValueType::Array, result);
    }

    void emit_booleanize(FunctionState& state) {
        emit(state, Opcode::LogicalNot, ValueType::Boolean);
        emit(state, Opcode::LogicalNot, ValueType::Boolean);
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
        emit_booleanize(state);
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
        emit_booleanize(state);
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

    static bool type_pattern_matches(
        const std::string& actual,
        const std::string& pattern
    ) {
        using Validation = vkf::stat_semantics::Validation<BytecodeLoweringError>;
        if (pattern == "any" || actual == pattern) return true;
        const auto union_parts = Validation::split_top_level(pattern, '|');
        if (union_parts.size() > 1) {
            return std::any_of(union_parts.begin(), union_parts.end(), [&](const auto& part) {
                return type_pattern_matches(actual, Validation::trim(part));
            });
        }
        const auto intersection_parts = Validation::split_top_level(pattern, '&');
        if (intersection_parts.size() > 1) {
            return std::all_of(intersection_parts.begin(), intersection_parts.end(), [&](const auto& part) {
                return type_pattern_matches(actual, Validation::trim(part));
            });
        }
        if (pattern == "num") {
            return actual == "int" || actual == "f32" || actual == "f64"
                || actual == "i32" || actual == "i64";
        }
        const auto structural_match = [&](std::string_view prefix, char close) {
            if (actual.rfind(prefix, 0) != 0 || pattern.rfind(prefix, 0) != 0
                || actual.back() != close || pattern.back() != close) return false;
            const auto actual_items = Validation::split_top_level(
                actual.substr(prefix.size(), actual.size() - prefix.size() - 1), ',');
            const auto pattern_items = Validation::split_top_level(
                pattern.substr(prefix.size(), pattern.size() - prefix.size() - 1), ',');
            if (actual_items.size() != pattern_items.size()) return false;
            for (std::size_t index = 0; index < actual_items.size(); ++index) {
                const auto actual_colon = Validation::find_top_level(actual_items[index], ':');
                const auto pattern_colon = Validation::find_top_level(pattern_items[index], ':');
                if ((actual_colon == std::string::npos) != (pattern_colon == std::string::npos)) return false;
                if (pattern_colon != std::string::npos) {
                    if (Validation::trim(actual_items[index].substr(0, actual_colon))
                        != Validation::trim(pattern_items[index].substr(0, pattern_colon))) return false;
                    if (!type_pattern_matches(
                            Validation::trim(actual_items[index].substr(actual_colon + 1)),
                            Validation::trim(pattern_items[index].substr(pattern_colon + 1)))) return false;
                } else if (!type_pattern_matches(Validation::trim(actual_items[index]),
                               Validation::trim(pattern_items[index]))) return false;
            }
            return true;
        };
        return structural_match("record{", '}') || structural_match("tuple<", '>');
    }

    ValueType lower_pipe_chain(
        const vf::JsonValue::Object& object,
        FunctionState& state,
        const std::string& context,
        bool discard_result = false
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
        const std::string source_surface = string_field(source, "type", context + ".source");
        const std::string result_surface = string_field(object, "type", context);

        const bool source_is_string = source_surface == "str" || source_surface == "string";
        const bool source_is_collection = source_kind == "range"
            || source_surface.rfind("list<", 0) == 0
            || source_surface.rfind("tuple<", 0) == 0
            || (!source_surface.empty() && source_surface.front() == '[');
        if (!source_is_collection && !source_is_string) {
            ValueType current_type = expression_type(source, context + ".source");
            auto current = add_temporary_local(state, current_type);
            lower_expression(field(object, "source", context), state, context + ".source");
            emit(state, Opcode::StoreLocal, current_type, current);
            for (std::size_t index = 0; index < segments.size(); ++index) {
                const auto previous_dollar = state.locals.find("$");
                const bool had_previous_dollar = previous_dollar != state.locals.end();
                const auto previous_dollar_index = had_previous_dollar ? previous_dollar->second : 0;
                state.locals["$"] = current;
                const ValueType next_type = lower_expression(segments[index], state,
                    context + ".segments[" + std::to_string(index) + "]");
                const auto next = add_temporary_local(state, next_type);
                emit(state, Opcode::StoreLocal, next_type, next);
                if (had_previous_dollar) state.locals["$"] = previous_dollar_index;
                else state.locals.erase("$");
                current = next;
                current_type = next_type;
            }
            emit(state, Opcode::LoadLocal, current_type, current);
            return current_type;
        }
        if (source_is_string) {
            auto current = add_temporary_local(state, ValueType::String);
            lower_expression(field(object, "source", context), state, context + ".source");
            emit(state, Opcode::StoreLocal, ValueType::String, current);
            for (std::size_t segment_index = 0; segment_index < segments.size(); ++segment_index) {
                const auto output = add_temporary_local(state, ValueType::String);
                const auto index = add_temporary_local(state, ValueType::Number);
                const auto length = add_temporary_local(state, ValueType::Number);
                const auto scalar = add_temporary_local(state, ValueType::String);
                emit(state, Opcode::PushConstant, ValueType::String,
                    intern_constant(Constant::utf8_string("")));
                emit(state, Opcode::StoreLocal, ValueType::String, output);
                emit_number(state, 0.0);
                emit(state, Opcode::StoreLocal, ValueType::Number, index);
                emit(state, Opcode::LoadLocal, ValueType::String, current);
                emit(state, Opcode::Utf8Length, ValueType::Number);
                emit(state, Opcode::StoreLocal, ValueType::Number, length);
                const auto loop_start = checked_index(state.function->instructions.size(),
                    "string pipe loop");
                emit(state, Opcode::LoadLocal, ValueType::Number, index);
                emit(state, Opcode::LoadLocal, ValueType::Number, length);
                emit(state, Opcode::Less, ValueType::Boolean);
                const auto loop_end_jump = state.function->instructions.size();
                emit(state, Opcode::JumpIfFalse, ValueType::Void);
                emit(state, Opcode::LoadLocal, ValueType::String, current);
                emit(state, Opcode::LoadLocal, ValueType::Number, index);
                emit(state, Opcode::Utf8PeekScalar, ValueType::String);
                emit(state, Opcode::StoreLocal, ValueType::String, scalar);
                const auto previous_dollar = state.locals.find("$");
                const bool had_previous_dollar = previous_dollar != state.locals.end();
                const auto previous_dollar_index = had_previous_dollar ? previous_dollar->second : 0;
                state.locals["$"] = scalar;
                const auto segment_type = expression_type(object_of(segments[segment_index],
                    context + ".segments[" + std::to_string(segment_index) + "]"), context);
                const auto segment_value = add_temporary_local(state, segment_type);
                state.loop_controls.push_back({loop_start, {}});
                state.pipe_controls.push_back({segment_value, segment_type, {}});
                const auto lowered_segment_type = lower_expression(segments[segment_index], state,
                    context + ".segments[" + std::to_string(segment_index) + "]");
                if (lowered_segment_type != ValueType::String) {
                    throw BytecodeLoweringError("string pipe segment must produce text in " + context);
                }
                emit(state, Opcode::StoreLocal, ValueType::String, segment_value);
                const auto segment_done = checked_index(state.function->instructions.size(),
                    "string pipe segment continuation");
                emit(state, Opcode::Nop, ValueType::Void);
                auto pipe_control = std::move(state.pipe_controls.back());
                state.pipe_controls.pop_back();
                for (const auto jump : pipe_control.return_jumps) patch_jump(state, jump, segment_done);
                emit(state, Opcode::LoadLocal, ValueType::String, output);
                emit(state, Opcode::LoadLocal, ValueType::String, segment_value);
                emit(state, Opcode::StringConcat, ValueType::String);
                emit(state, Opcode::StoreLocal, ValueType::String, output);
                if (had_previous_dollar) state.locals["$"] = previous_dollar_index;
                else state.locals.erase("$");
                emit(state, Opcode::LoadLocal, ValueType::String, current);
                emit(state, Opcode::LoadLocal, ValueType::Number, index);
                emit(state, Opcode::Utf8Advance, ValueType::Number);
                emit(state, Opcode::StoreLocal, ValueType::Number, index);
                emit(state, Opcode::Jump, ValueType::Void, loop_start);
                const auto loop_end = checked_index(state.function->instructions.size(),
                    "string pipe continuation");
                emit(state, Opcode::Nop, ValueType::Void);
                patch_jump(state, loop_end_jump, loop_end);
                auto loop_control = std::move(state.loop_controls.back());
                state.loop_controls.pop_back();
                for (const auto jump : loop_control.break_jumps) patch_jump(state, jump, loop_end);
                current = output;
            }
            emit(state, Opcode::LoadLocal, ValueType::String, current);
            return ValueType::String;
        }
        std::uint32_t current_array = 0;
        std::size_t first_segment = 0;

        if (source_kind == "range") {
            const auto* infinite_field = optional_field(source, "infinite");
            const bool infinite = infinite_field != nullptr && infinite_field->is_boolean()
                && infinite_field->as_boolean();
            const auto cursor = add_temporary_local(state, ValueType::Number);
            const auto end = add_temporary_local(state, ValueType::Number);
            const auto direction = add_temporary_local(state, ValueType::Number);
            const auto output_index = add_temporary_local(state, ValueType::Number);
            current_array = add_temporary_local(state, ValueType::Array);
            const bool discard_range_output = discard_result && segments.size() == 1;

            lower_expression(
                field(source, "start", context + ".source"),
                state,
                context + ".source.start"
            );
            emit(state, Opcode::StoreLocal, ValueType::Number, cursor);
            if (!infinite) {
                lower_expression(field(source, "end", context + ".source"), state,
                    context + ".source.end");
                emit(state, Opcode::StoreLocal, ValueType::Number, end);
            }

            if (!infinite) {
                emit(state, Opcode::LoadLocal, ValueType::Number, end);
                emit(state, Opcode::LoadLocal, ValueType::Number, cursor);
                emit(state, Opcode::GreaterEqual, ValueType::Boolean);
            } else {
                emit_number(state, 1.0);
            }
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

            if (!infinite && !discard_range_output) {
                emit(state, Opcode::LoadLocal, ValueType::Number, end);
                emit(state, Opcode::LoadLocal, ValueType::Number, cursor);
                emit(state, Opcode::Subtract, ValueType::Number);
                emit(state, Opcode::LoadLocal, ValueType::Number, direction);
                emit(state, Opcode::Multiply, ValueType::Number);
                emit_number(state, 1.0);
                emit(state, Opcode::Add, ValueType::Number);
            } else if (!discard_range_output) {
                emit_number(state, 0.0);
            }
            if (!discard_range_output) {
                emit(state, Opcode::AllocateArray, ValueType::Array);
                emit(state, Opcode::StoreLocal, ValueType::Array, current_array);
                emit_number(state, 0.0);
                emit(state, Opcode::StoreLocal, ValueType::Number, output_index);
            }

            std::optional<std::uint32_t> arena_mark;
            std::set<std::uint32_t> dynamic_integers;
            std::set<std::uint32_t> numeric_arrays;
            if (discard_range_output) {
                std::set<std::uint32_t> cloned;
                const auto& segment = object_of(segments.front(), context + ".segments[0]");
                const auto* segment_body = optional_field(segment, "body");
                if (string_field(segment, "kind", context + ".segments[0]") == "block_expr"
                    && segment_body != nullptr && segment_body->is_array()) {
                    for (const auto& statement_value : segment_body->as_array()) {
                        const auto& statement = object_of(statement_value, context + ".segments[0].body");
                        const auto* update = optional_field(statement, "update");
                        if (string_field(statement, "kind", context + ".segments[0].body")
                                != "store_binding"
                            || update == nullptr || !update->is_boolean()) {
                            cloned.clear();
                            break;
                        }
                        // New bindings inside the pipe block are iteration-local.
                        // They cannot retain an arena pointer after reset and do
                        // not prevent persistent updates from using an in-place
                        // lifetime plan.
                        if (!update->as_boolean()) continue;
                        const auto local = state.locals.find(string_field(
                            statement, "name", context + ".segments[0].body"));
                        if (local == state.locals.end()) {
                            cloned.clear();
                            break;
                        }
                        const auto local_type = state.function->local_types.at(local->second);
                        if (local_type == ValueType::Dynamic) {
                            const auto& update_value = object_of(field(statement, "value",
                                context + ".segments[0].body"),
                                context + ".segments[0].body.value");
                            if (string_field(update_value, "kind",
                                    context + ".segments[0].body.value") != "binary_op"
                                || !numeric_surface_type(string_field(update_value, "left_type",
                                       context + ".segments[0].body.value"))
                                || !numeric_surface_type(string_field(update_value, "right_type",
                                       context + ".segments[0].body.value"))) {
                                cloned.clear();
                                break;
                            }
                            dynamic_integers.insert(local->second);
                        } else if (local_type == ValueType::Array) {
                            const auto& update_value = object_of(field(statement, "value",
                                context + ".segments[0].body"),
                                context + ".segments[0].body.value");
                            const auto left_surface = string_field(update_value, "left_type",
                                context + ".segments[0].body.value");
                            if (string_field(update_value, "kind",
                                    context + ".segments[0].body.value") != "binary_op"
                                || left_surface != string_field(update_value, "right_type",
                                    context + ".segments[0].body.value")
                                || vector_path(left_surface).empty()) {
                                cloned.clear();
                                break;
                            }
                            numeric_arrays.insert(local->second);
                        } else {
                            // Arena reset is safe only when every persistent
                            // mutation has an in-place/clone plan. Strings,
                            // records, and other aggregate values may point at
                            // storage allocated by the loop body.
                            cloned.clear();
                            dynamic_integers.clear();
                            numeric_arrays.clear();
                            break;
                        }
                        cloned.insert(local->second);
                    }
                }
                if (!cloned.empty()) {
                    for (const auto local : cloned) {
                        const auto local_type = state.function->local_types.at(local);
                        if (local_type == ValueType::Number
                            || dynamic_integers.find(local) != dynamic_integers.end()) {
                            emit(state, Opcode::LoadLocal, local_type, local);
                            emit(state, Opcode::CloneNumber, local_type);
                            emit(state, Opcode::StoreLocal, local_type, local);
                            dynamic_integers.insert(local);
                            continue;
                        }
                        if (local_type != ValueType::Array) {
                            cloned.clear();
                            break;
                        }
                        const auto clone_index = add_temporary_local(state, ValueType::Number);
                        emit_number(state, 0.0);
                        emit(state, Opcode::StoreLocal, ValueType::Number, clone_index);
                        const auto clone_loop = checked_index(
                            state.function->instructions.size(), "arena clone loop");
                        emit(state, Opcode::LoadLocal, ValueType::Number, clone_index);
                        emit(state, Opcode::LoadLocal, ValueType::Array, local);
                        emit(state, Opcode::ArrayLength, ValueType::Number);
                        emit(state, Opcode::Less, ValueType::Boolean);
                        const auto clone_end_jump = state.function->instructions.size();
                        emit(state, Opcode::JumpIfFalse, ValueType::Void);
                        emit(state, Opcode::LoadLocal, ValueType::Array, local);
                        emit(state, Opcode::LoadLocal, ValueType::Number, clone_index);
                        emit(state, Opcode::LoadLocal, ValueType::Array, local);
                        emit(state, Opcode::LoadLocal, ValueType::Number, clone_index);
                        emit(state, Opcode::ArrayGet, ValueType::Number);
                        emit(state, Opcode::CloneNumber, ValueType::Number);
                        emit(state, Opcode::ArraySet, ValueType::Array);
                        emit(state, Opcode::Pop, ValueType::Void);
                        emit(state, Opcode::LoadLocal, ValueType::Number, clone_index);
                        emit_number(state, 1.0);
                        emit(state, Opcode::Add, ValueType::Number);
                        emit(state, Opcode::StoreLocal, ValueType::Number, clone_index);
                        emit(state, Opcode::Jump, ValueType::Void, clone_loop);
                        const auto clone_end = checked_index(
                            state.function->instructions.size(), "arena clone continuation");
                        emit(state, Opcode::Nop, ValueType::Void);
                        patch_jump(state, clone_end_jump, clone_end);
                    }
                    emit(state, Opcode::LoadLocal, ValueType::Number, cursor);
                    emit(state, Opcode::CloneNumber, ValueType::Number);
                    emit(state, Opcode::StoreLocal, ValueType::Number, cursor);
                    arena_mark = add_temporary_local(state, ValueType::Dynamic);
                    emit(state, Opcode::ArenaMark, ValueType::Dynamic);
                    emit(state, Opcode::StoreLocal, ValueType::Dynamic, *arena_mark);
                    state.mutable_dynamic_numbers.insert(
                        dynamic_integers.begin(), dynamic_integers.end());
                    state.mutable_numeric_arrays.insert(
                        numeric_arrays.begin(), numeric_arrays.end());
                }
            }

            const auto loop_start = checked_index(
                state.function->instructions.size(),
                "range pipe loop"
            );
            std::optional<std::size_t> loop_end_jump;
            if (!infinite) {
                emit(state, Opcode::LoadLocal, ValueType::Number, end);
                emit(state, Opcode::LoadLocal, ValueType::Number, cursor);
                emit(state, Opcode::Subtract, ValueType::Number);
                emit(state, Opcode::LoadLocal, ValueType::Number, direction);
                emit(state, Opcode::Multiply, ValueType::Number);
                emit_number(state, 0.0);
                emit(state, Opcode::GreaterEqual, ValueType::Boolean);
                loop_end_jump = state.function->instructions.size();
                emit(state, Opcode::JumpIfFalse, ValueType::Void);
            }

            const auto previous_dollar = state.locals.find("$");
            const bool had_previous_dollar = previous_dollar != state.locals.end();
            const std::uint32_t previous_dollar_index = had_previous_dollar
                ? previous_dollar->second
                : 0;
            state.locals["$"] = cursor;
            const auto segment_type = expression_type(
                object_of(segments.front(), context + ".segments[0]"),
                context + ".segments[0]");
            const auto segment_value = add_temporary_local(state, segment_type);
            state.loop_controls.push_back({loop_start, {}});
            state.pipe_controls.push_back({segment_value, segment_type, {}});
            const ValueType lowered_segment_type = lower_expression(
                segments.front(),
                state,
                context + ".segments[0]"
            );
            for (const auto local : dynamic_integers) {
                state.mutable_dynamic_numbers.erase(local);
            }
            for (const auto local : numeric_arrays) {
                state.mutable_numeric_arrays.erase(local);
            }
            emit(state, Opcode::StoreLocal, lowered_segment_type, segment_value);
            const auto segment_done = checked_index(state.function->instructions.size(),
                "pipe segment continuation");
            emit(state, Opcode::Nop, ValueType::Void);
            auto pipe_control = std::move(state.pipe_controls.back());
            state.pipe_controls.pop_back();
            for (const auto jump : pipe_control.return_jumps) patch_jump(state, jump, segment_done);
            if (!discard_range_output) {
                emit(state, Opcode::LoadLocal, ValueType::Array, current_array);
                if (!infinite) emit(state, Opcode::LoadLocal, ValueType::Number, output_index);
                emit(state, Opcode::LoadLocal, segment_type, segment_value);
                if (infinite) {
                    emit(state, Opcode::MakeArray, ValueType::Array, 1);
                    emit(state, Opcode::ArrayConcat, ValueType::Array);
                } else {
                    emit(state, Opcode::ArraySet, ValueType::Array);
                }
                emit(state, Opcode::StoreLocal, ValueType::Array, current_array);
            }
            if (had_previous_dollar) {
                state.locals["$"] = previous_dollar_index;
            } else {
                state.locals.erase("$");
            }

            emit(state, Opcode::LoadLocal, ValueType::Number, cursor);
            emit(state, Opcode::LoadLocal, ValueType::Number, direction);
            emit(state, arena_mark ? Opcode::NumericSlotUpdate : Opcode::Add,
                ValueType::Number, 0);
            emit(state, Opcode::StoreLocal, ValueType::Number, cursor);
            if (!discard_range_output) {
                emit(state, Opcode::LoadLocal, ValueType::Number, output_index);
                emit_number(state, 1.0);
                emit(state, Opcode::Add, ValueType::Number);
                emit(state, Opcode::StoreLocal, ValueType::Number, output_index);
            }
            if (arena_mark) {
                emit(state, Opcode::LoadLocal, ValueType::Dynamic, *arena_mark);
                emit(state, Opcode::ArenaReset, ValueType::Void);
            }
            emit(state, Opcode::Jump, ValueType::Void, loop_start);
            const auto loop_end = checked_index(
                state.function->instructions.size(),
                "range pipe continuation"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            if (loop_end_jump) patch_jump(state, *loop_end_jump, loop_end);
            auto loop_control = std::move(state.loop_controls.back());
            state.loop_controls.pop_back();
            for (const auto jump : loop_control.break_jumps) patch_jump(state, jump, loop_end);
            (void)segment_type;
            first_segment = 1;
            if (discard_range_output) {
                emit(state, Opcode::PushNull, ValueType::Dynamic);
                return ValueType::Dynamic;
            }
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
            const auto segment_type = expression_type(object_of(segments[segment_index],
                context + ".segments[" + std::to_string(segment_index) + "]"), context);
            const auto segment_value = add_temporary_local(state, segment_type);
            state.loop_controls.push_back({loop_start, {}});
            state.pipe_controls.push_back({segment_value, segment_type, {}});
            const ValueType lowered_segment_type = lower_expression(
                segments[segment_index],
                state,
                context + ".segments[" + std::to_string(segment_index) + "]"
            );
            emit(state, Opcode::StoreLocal, lowered_segment_type, segment_value);
            const auto segment_done = checked_index(state.function->instructions.size(),
                "array pipe segment continuation");
            emit(state, Opcode::Nop, ValueType::Void);
            auto pipe_control = std::move(state.pipe_controls.back());
            state.pipe_controls.pop_back();
            for (const auto jump : pipe_control.return_jumps) patch_jump(state, jump, segment_done);
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
            auto loop_control = std::move(state.loop_controls.back());
            state.loop_controls.pop_back();
            for (const auto jump : loop_control.break_jumps) patch_jump(state, jump, loop_end);
            current_array = output_array;
        }

        emit(state, Opcode::LoadLocal, ValueType::Array, current_array);
        if (result_surface.rfind("tuple<", 0) == 0) {
            emit(state, Opcode::ArrayAsTuple, ValueType::Dynamic);
            return ValueType::Dynamic;
        }
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
        const auto* catch_field = optional_field(object, "catch");
        const bool catches = catch_field != nullptr && catch_field->is_boolean()
            && catch_field->as_boolean();
        if (catches) {
            const auto& discriminant = object_of(field(object, "discriminant", context),
                context + ".discriminant");
            const std::string discriminant_kind = string_field(discriminant, "kind",
                context + ".discriminant");
            const auto error_value = add_temporary_local(state, ValueType::Dynamic);
            const auto error_mask = add_temporary_local(state, ValueType::Number);
            bool caught = false;
            std::optional<std::size_t> no_error_jump;
            std::optional<std::size_t> selector_error_jump;
            if (discriminant_kind == "record_selector") {
                lower_record_selector(discriminant, state,
                    context + ".discriminant", [&] {
                        emit(state, Opcode::MakeObject, ValueType::Object);
                        emit(state, Opcode::PushConstant, ValueType::String,
                            intern_constant(Constant::utf8_string(std::string(
                                runtime_value_semantics::missing_record_selector_message))));
                        emit(state, Opcode::ObjectSet, ValueType::String,
                            intern_constant(Constant::utf8_string("message")));
                        emit(state, Opcode::StoreLocal, ValueType::Dynamic, error_value);
                        emit_number(state, static_cast<double>(
                            runtime_value_semantics::missing_record_selector_error_mask));
                        emit(state, Opcode::StoreLocal, ValueType::Number, error_mask);
                        selector_error_jump = state.function->instructions.size();
                        emit(state, Opcode::Jump, ValueType::Void);
                    });
                emit(state, Opcode::Pop, ValueType::Void);
                no_error_jump = state.function->instructions.size();
                emit(state, Opcode::Jump, ValueType::Void);
                const auto catch_target = checked_index(state.function->instructions.size(),
                    "record selector catch entry");
                emit(state, Opcode::Nop, ValueType::Void);
                patch_jump(state, *selector_error_jump, catch_target);
                caught = true;
            } else if (discriminant_kind == "raise_expr") {
                lower_expression(field(discriminant, "value", context + ".discriminant"),
                    state, context + ".discriminant.value");
                emit(state, Opcode::StoreLocal, ValueType::Dynamic, error_value);
                emit(state, Opcode::LoadLocal, ValueType::Dynamic, error_value);
                emit(state, Opcode::ObjectGet, ValueType::Number,
                    intern_constant(Constant::utf8_string("mask")));
                emit(state, Opcode::StoreLocal, ValueType::Number, error_mask);
                caught = true;
            } else if (discriminant_kind == "call") {
                const auto& callee = object_of(field(discriminant, "callee",
                    context + ".discriminant"), context + ".discriminant.callee");
                const auto& args = array_of(field(discriminant, "args",
                    context + ".discriminant"), context + ".discriminant.args");
                if (string_field(callee, "kind", context + ".discriminant.callee") == "load"
                    && string_field(callee, "name", context + ".discriminant.callee") == "int"
                    && args.size() == 1) {
                    const auto& argument = object_of(args.front(), context + ".discriminant.args[0]");
                    const auto* literal = optional_field(argument, "value");
                    if (string_field(argument, "kind", context + ".discriminant.args[0]") == "const"
                        && literal != nullptr && literal->is_number()
                        && std::floor(literal->as_number()) != literal->as_number()) {
                        emit(state, Opcode::PushNull, ValueType::Dynamic);
                        emit(state, Opcode::StoreLocal, ValueType::Dynamic, error_value);
                        emit_number(state, 161.0);
                        emit(state, Opcode::StoreLocal, ValueType::Number, error_mask);
                        caught = true;
                    }
                }
            }
            if (!caught) {
                lower_expression(field(object, "discriminant", context), state,
                    context + ".discriminant");
                emit(state, Opcode::Pop, ValueType::Void);
                emit(state, Opcode::PushNull, ValueType::Dynamic);
                return ValueType::Dynamic;
            }

            const auto& arms = array_of(field(object, "arms", context), context + ".arms");
            std::vector<std::size_t> end_jumps;
            const auto previous_dollar = state.locals.find("$");
            const bool had_previous_dollar = previous_dollar != state.locals.end();
            const auto previous_dollar_index = had_previous_dollar ? previous_dollar->second : 0;
            state.locals["$"] = error_value;
            for (std::size_t index = 0; index < arms.size(); ++index) {
                const auto arm_context = context + ".arms[" + std::to_string(index) + "]";
                const auto& arm = object_of(arms[index], arm_context);
                const auto& condition = object_of(field(arm, "condition", arm_context),
                    arm_context + ".condition");
                if (string_field(condition, "kind", arm_context + ".condition") != "error_type") {
                    throw BytecodeLoweringError("catch arm requires an error type in " + arm_context);
                }
                const auto& mask = field(condition, "mask", arm_context + ".condition");
                if (!mask.is_number() || mask.as_number() < 0
                    || std::floor(mask.as_number()) != mask.as_number()) {
                    throw BytecodeLoweringError("catch arm requires an integer error mask in " + arm_context);
                }
                emit(state, Opcode::LoadLocal, ValueType::Number, error_mask);
                emit(state, Opcode::ErrorMaskMatches, ValueType::Boolean,
                    static_cast<std::uint32_t>(mask.as_number()));
                const auto next_arm = state.function->instructions.size();
                emit(state, Opcode::JumpIfFalse, ValueType::Void);
                const auto body_type = lower_expression(field(arm, "body", arm_context), state,
                    arm_context + ".body");
                if (body_type != ValueType::Void) emit(state, Opcode::Pop, ValueType::Void);
                end_jumps.push_back(state.function->instructions.size());
                emit(state, Opcode::Jump, ValueType::Void);
                const auto next_target = checked_index(state.function->instructions.size(),
                    "catch arm continuation");
                emit(state, Opcode::Nop, ValueType::Void);
                patch_jump(state, next_arm, next_target);
            }
            emit(state, Opcode::Trap, ValueType::Void);
            const auto end_target = checked_index(state.function->instructions.size(),
                "catch continuation");
            emit(state, Opcode::Nop, ValueType::Void);
            for (const auto jump : end_jumps) patch_jump(state, jump, end_target);
            if (no_error_jump) patch_jump(state, *no_error_jump, end_target);
            if (had_previous_dollar) state.locals["$"] = previous_dollar_index;
            else state.locals.erase("$");
            emit(state, Opcode::PushNull, ValueType::Dynamic);
            return ValueType::Dynamic;
        }
        const auto* loop_field = optional_field(object, "loop");
        const bool loop = loop_field != nullptr && loop_field->is_boolean()
            && loop_field->as_boolean();
        const auto loop_start = checked_index(state.function->instructions.size(),
            "match loop condition");
        if (loop) state.loop_controls.push_back({loop_start, {}});
        const auto& discriminant = object_of(field(object, "discriminant", context),
            context + ".discriminant");
        const std::string discriminant_surface = string_field(discriminant, "type",
            context + ".discriminant");
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
            const auto& condition_object = object_of(condition, arm_context + ".condition");
            if (string_field(condition_object, "kind", arm_context + ".condition")
                == "type_pattern") {
                emit(state, Opcode::Pop, ValueType::Dynamic);
                const bool matches = type_pattern_matches(discriminant_surface,
                    string_field(condition_object, "name", arm_context + ".condition"));
                emit(state, Opcode::PushConstant, ValueType::Boolean,
                    intern_constant(Constant::number_value(matches ? 1.0 : 0.0)));
            } else {
                lower_expression(condition, state, arm_context + ".condition");
                emit(state, Opcode::Equal, ValueType::Boolean);
            }
            const std::size_t next_arm =
                state.function->instructions.size();
            emit(state, Opcode::JumpIfFalse, ValueType::Void);
            emit(state, Opcode::Pop, ValueType::Void);
            result_type = lower_expression(
                field(arm, "body", arm_context),
                state,
                arm_context + ".body"
            );
            if (loop) emit(state, Opcode::Pop, ValueType::Void);
            end_jumps.push_back(state.function->instructions.size());
            emit(state, Opcode::Jump, ValueType::Void);

            const auto next_target = checked_index(
                state.function->instructions.size(),
                "match arm continuation"
            );
            emit(state, Opcode::Nop, ValueType::Void);
            patch_jump(state, next_arm, next_target);
        }
        if (!has_default && !loop) {
            throw BytecodeLoweringError(
                "match expression requires a default arm in " + context
            );
        }
        if (loop) {
            emit(state, Opcode::Pop, ValueType::Void);
            const auto repeat_target = checked_index(
                state.function->instructions.size(), "match loop repeat");
            emit(state, Opcode::Nop, ValueType::Void);
            for (const auto jump : end_jumps) patch_jump(state, jump, repeat_target);
            emit(state, Opcode::Jump, ValueType::Void, loop_start);
            auto control = std::move(state.loop_controls.back());
            state.loop_controls.pop_back();
            const auto break_target = checked_index(
                state.function->instructions.size(), "match loop continuation");
            emit(state, Opcode::Nop, ValueType::Void);
            for (const auto jump : control.break_jumps) patch_jump(state, jump, break_target);
            emit(state, Opcode::PushNull, ValueType::Dynamic);
            return ValueType::Dynamic;
        }
        const auto end_target = checked_index(
            state.function->instructions.size(),
            "match continuation"
        );
        emit(state, Opcode::Nop, ValueType::Void);
        for (const auto jump : end_jumps) {
            patch_jump(state, jump, end_target);
        }
        // A terminating default arm (for example a raised exhaustive-match
        // diagnostic) does not make the whole function terminal when any
        // earlier arm reaches the match continuation.
        if (!end_jumps.empty()) state.returned = false;
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
                "vkf_dense_power",
                1,
                Opcode::DensePower,
                ValueType::Number
            )
            || bind(
                "vkf_permutation_reduction",
                1,
                Opcode::PermutationReduction,
                ValueType::Number
            )
            || bind(
                "vkf_pairwise_system_energy",
                1,
                Opcode::PairwiseSystemEnergy,
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
    // Pointers inside the cache refer only to typed_module_.inference_source,
    // whose owning storage is stable and unmodified throughout lowering.
    std::optional<value_layout::InferredModuleLayouts> inferred_layouts_;
    Module module_;
    std::map<std::string, FunctionBinding> function_bindings_;
    std::map<std::string, ConstantBinding> constant_bindings_;
    std::map<std::string, std::string> nominal_display_names_;
    std::set<std::string> referenced_globals_;
    std::deque<PendingDefaultThunk> pending_default_thunks_;
    std::map<std::pair<std::uint32_t, std::uint32_t>, std::string> default_call_targets_;
};

}  // namespace lowering_detail

inline Module lower_typed_module_to_bytecode(const TypedModule& module) {
    return lowering_detail::Lowerer(module).lower();
}

}  // namespace vkf::wasm::bytecode
