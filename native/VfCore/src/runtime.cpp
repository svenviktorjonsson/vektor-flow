#include "vf/runtime.hpp"

#include "vf/json.hpp"

#include <cmath>
#include <sstream>
#include <unordered_map>
#include <type_traits>

namespace vf {

RuntimeBuildError::RuntimeBuildError(std::string message)
    : std::runtime_error(std::move(message)) {}

RuntimeLoadError::RuntimeLoadError(std::string message)
    : std::runtime_error(std::move(message)) {}

RuntimeExecuteError::RuntimeExecuteError(std::string message)
    : std::runtime_error(std::move(message)) {}

namespace {

struct RuntimeValue;
using RuntimeVectorElements = std::vector<RuntimeValue>;

struct RuntimeValue {
    std::variant<double, RuntimeVectorElements> data;
};

RuntimeExpr lower_expr(const Expr& expr);
RuntimeStep lower_stmt(const Stmt& stmt);
RuntimeExpr parse_runtime_expr(const JsonValue& value);
RuntimeStep parse_runtime_step(const JsonValue& value);
RuntimeValue eval_runtime_expr(
    const RuntimeExpr& expr,
    const std::unordered_map<std::string, RuntimeValue>& env);
std::string runtime_value_to_text(const RuntimeValue& value);
double require_runtime_scalar_number(const RuntimeValue& value, const char* context);
const RuntimeVectorElements& require_runtime_vector_elements(const RuntimeValue& value, const char* context);
std::string format_runtime_number(double value);
std::size_t runtime_vector_attribute_index(char component);
RuntimeValue eval_runtime_vector_attribute(const RuntimeValue& value, const std::string& name);

const JsonValue::Object& require_object(const JsonValue& value, const char* context) {
    try {
        return value.as_object();
    } catch (const std::exception&) {
        throw RuntimeLoadError(std::string(context) + " must be an object");
    }
}

const JsonValue::Array& require_array(const JsonValue& value, const char* context) {
    try {
        return value.as_array();
    } catch (const std::exception&) {
        throw RuntimeLoadError(std::string(context) + " must be an array");
    }
}

const JsonValue& require_field(const JsonValue::Object& object, const char* key, const char* context) {
    const auto it = object.find(key);
    if (it == object.end()) {
        throw RuntimeLoadError(std::string(context) + " missing field: " + key);
    }
    return it->second;
}

std::string require_string_field(const JsonValue::Object& object, const char* key, const char* context) {
    try {
        return require_field(object, key, context).as_string();
    } catch (const std::exception&) {
        throw RuntimeLoadError(std::string(context) + " field must be a string: " + key);
    }
}

int require_int_field(const JsonValue::Object& object, const char* key, const char* context) {
    try {
        const double number = require_field(object, key, context).as_number();
        if (!std::isfinite(number) || std::floor(number) != number) {
            throw RuntimeLoadError(std::string(context) + " field must be an integer: " + key);
        }
        return static_cast<int>(number);
    } catch (const RuntimeLoadError&) {
        throw;
    } catch (const std::exception&) {
        throw RuntimeLoadError(std::string(context) + " field must be a number: " + key);
    }
}

std::optional<TypeExpr> parse_optional_type_expr(const JsonValue& value);
TypeExpr parse_type_expr(const JsonValue& value);

TypeExpr parse_type_expr(const JsonValue& value) {
    const auto& object = require_object(value, "runtime type");
    const std::string kind = require_string_field(object, "kind", "runtime type");
    if (kind == "PrimitiveTypeRef") {
        return PrimitiveTypeRef{require_string_field(object, "name", "runtime type")};
    }
    if (kind == "FixedVectorType") {
        auto vector_type = std::make_shared<FixedVectorType>();
        vector_type->element_type = parse_type_expr(require_field(object, "element_type", "runtime type"));
        vector_type->size = require_int_field(object, "size", "runtime type");
        return vector_type;
    }
    throw RuntimeLoadError("unknown runtime type kind: " + kind);
}

std::optional<TypeExpr> parse_optional_type_expr(const JsonValue& value) {
    if (value.is_null()) {
        return std::nullopt;
    }
    return parse_type_expr(value);
}

RuntimeExpr lower_expr(const Expr& expr) {
    return std::visit(
        [](const auto& current) -> RuntimeExpr {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, NumberLit>) {
                return RuntimeNumberConstant{current.text};
            } else if constexpr (std::is_same_v<Value, Ident>) {
                return RuntimeBindingRef{current.name};
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<VectorLit>>) {
                auto lowered = std::make_shared<RuntimeVectorValue>();
                lowered->elements.reserve(current->elements.size());
                for (const auto& element : current->elements) {
                    lowered->elements.push_back(lower_expr(element));
                }
                return lowered;
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<Call>>) {
                auto lowered = std::make_shared<RuntimeCallValue>();
                lowered->func = lower_expr(current->func);
                lowered->args.reserve(current->args.size());
                for (const auto& arg : current->args) {
                    lowered->args.push_back(lower_expr(arg));
                }
                return lowered;
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<Attribute>>) {
                auto lowered = std::make_shared<RuntimeAttributeValue>();
                lowered->value = lower_expr(current->value);
                lowered->name = current->name;
                return lowered;
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<DottedIndex>>) {
                auto lowered = std::make_shared<RuntimeIndexValue>();
                lowered->value = lower_expr(current->value);
                lowered->index = current->index;
                return lowered;
            } else {
                auto lowered = std::make_shared<RuntimeLooseDotValue>();
                lowered->value = lower_expr(current->value);
                return lowered;
            }
        },
        expr);
}

RuntimeStep lower_stmt(const Stmt& stmt) {
    return std::visit(
        [](const auto& current) -> RuntimeStep {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, BindStmt>) {
                const Ident* ident = std::get_if<Ident>(&current.target);
                if (ident == nullptr) {
                    throw RuntimeBuildError("native runtime bind target must be an identifier");
                }
                return RuntimeBindStep{
                    ident->name,
                    current.type_expr,
                    lower_expr(current.value),
                };
            } else {
                return RuntimeEmitStep{lower_expr(current.value)};
            }
        },
        stmt);
}

RuntimeExpr parse_runtime_expr(const JsonValue& value) {
    const auto& object = require_object(value, "runtime expr");
    const std::string kind = require_string_field(object, "kind", "runtime expr");
    if (kind == "NumberConstant") {
        return RuntimeNumberConstant{require_string_field(object, "text", "runtime expr")};
    }
    if (kind == "BindingRef") {
        return RuntimeBindingRef{require_string_field(object, "name", "runtime expr")};
    }
    if (kind == "VectorValue") {
        auto vector_value = std::make_shared<RuntimeVectorValue>();
        const auto& elements = require_array(require_field(object, "elements", "runtime expr"), "runtime expr elements");
        vector_value->elements.reserve(elements.size());
        for (const auto& element : elements) {
            vector_value->elements.push_back(parse_runtime_expr(element));
        }
        return vector_value;
    }
    if (kind == "CallValue") {
        auto call_value = std::make_shared<RuntimeCallValue>();
        call_value->func = parse_runtime_expr(require_field(object, "func", "runtime expr"));
        const auto& args = require_array(require_field(object, "args", "runtime expr"), "runtime expr args");
        call_value->args.reserve(args.size());
        for (const auto& arg : args) {
            call_value->args.push_back(parse_runtime_expr(arg));
        }
        return call_value;
    }
    if (kind == "AttributeValue") {
        auto attribute_value = std::make_shared<RuntimeAttributeValue>();
        attribute_value->name = require_string_field(object, "name", "runtime expr");
        attribute_value->value = parse_runtime_expr(require_field(object, "value", "runtime expr"));
        return attribute_value;
    }
    if (kind == "IndexValue") {
        auto index_value = std::make_shared<RuntimeIndexValue>();
        index_value->index = require_int_field(object, "index", "runtime expr");
        index_value->value = parse_runtime_expr(require_field(object, "value", "runtime expr"));
        return index_value;
    }
    if (kind == "LooseDotValue") {
        auto loose_dot_value = std::make_shared<RuntimeLooseDotValue>();
        loose_dot_value->value = parse_runtime_expr(require_field(object, "value", "runtime expr"));
        return loose_dot_value;
    }
    throw RuntimeLoadError("unknown runtime expr kind: " + kind);
}

RuntimeStep parse_runtime_step(const JsonValue& value) {
    const auto& object = require_object(value, "runtime step");
    const std::string kind = require_string_field(object, "kind", "runtime step");
    if (kind == "BindStep") {
        return RuntimeBindStep{
            require_string_field(object, "target_name", "runtime step"),
            parse_optional_type_expr(require_field(object, "type_expr", "runtime step")),
            parse_runtime_expr(require_field(object, "value", "runtime step")),
        };
    }
    if (kind == "EmitStep") {
        return RuntimeEmitStep{
            parse_runtime_expr(require_field(object, "value", "runtime step")),
        };
    }
    throw RuntimeLoadError("unknown runtime step kind: " + kind);
}

JsonValue type_to_json_value(const TypeExpr& type_expr) {
    return std::visit(
        [](const auto& current) -> JsonValue {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, PrimitiveTypeRef>) {
                return JsonValue::Object{
                    {"kind", JsonValue("PrimitiveTypeRef")},
                    {"name", JsonValue(current.name)},
                };
            } else {
                return JsonValue::Object{
                    {"element_type", type_to_json_value(current->element_type)},
                    {"kind", JsonValue("FixedVectorType")},
                    {"size", JsonValue(static_cast<double>(current->size))},
                };
            }
        },
        type_expr);
}

RuntimeValue eval_runtime_expr(
    const RuntimeExpr& expr,
    const std::unordered_map<std::string, RuntimeValue>& env) {
    return std::visit(
        [&](const auto& current) -> RuntimeValue {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, RuntimeNumberConstant>) {
                try {
                    return RuntimeValue{std::stod(current.text)};
                } catch (const std::exception&) {
                    throw RuntimeExecuteError("invalid runtime number constant: " + current.text);
                }
            } else if constexpr (std::is_same_v<Value, RuntimeBindingRef>) {
                const auto it = env.find(current.name);
                if (it == env.end()) {
                    throw RuntimeExecuteError("unknown runtime binding: " + current.name);
                }
                return it->second;
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<RuntimeVectorValue>>) {
                RuntimeVectorElements elements;
                elements.reserve(current->elements.size());
                for (const auto& element : current->elements) {
                    elements.push_back(eval_runtime_expr(element, env));
                }
                return RuntimeValue{std::move(elements)};
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<RuntimeCallValue>>) {
                const RuntimeBindingRef* builtin = std::get_if<RuntimeBindingRef>(&current->func);
                if (builtin == nullptr) {
                    throw RuntimeExecuteError("native runtime execution only supports direct builtin calls");
                }

                std::vector<RuntimeValue> args;
                args.reserve(current->args.size());
                for (const auto& arg : current->args) {
                    args.push_back(eval_runtime_expr(arg, env));
                }

                if (builtin->name == "add") {
                    if (args.size() != 2) {
                        throw RuntimeExecuteError("builtin add expects 2 arguments");
                    }
                    return RuntimeValue{
                        require_runtime_scalar_number(args[0], "add") +
                        require_runtime_scalar_number(args[1], "add")};
                }
                if (builtin->name == "sub") {
                    if (args.size() != 2) {
                        throw RuntimeExecuteError("builtin sub expects 2 arguments");
                    }
                    return RuntimeValue{
                        require_runtime_scalar_number(args[0], "sub") -
                        require_runtime_scalar_number(args[1], "sub")};
                }
                if (builtin->name == "mul") {
                    if (args.size() != 2) {
                        throw RuntimeExecuteError("builtin mul expects 2 arguments");
                    }
                    return RuntimeValue{
                        require_runtime_scalar_number(args[0], "mul") *
                        require_runtime_scalar_number(args[1], "mul")};
                }
                if (builtin->name == "div") {
                    if (args.size() != 2) {
                        throw RuntimeExecuteError("builtin div expects 2 arguments");
                    }
                    const double rhs = require_runtime_scalar_number(args[1], "div");
                    if (rhs == 0.0) {
                        throw RuntimeExecuteError("builtin div does not allow division by zero");
                    }
                    return RuntimeValue{
                        require_runtime_scalar_number(args[0], "div") / rhs};
                }
                if (builtin->name == "neg") {
                    if (args.size() != 1) {
                        throw RuntimeExecuteError("builtin neg expects 1 argument");
                    }
                    return RuntimeValue{-require_runtime_scalar_number(args[0], "neg")};
                }
                throw RuntimeExecuteError("unknown native runtime builtin: " + builtin->name);
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<RuntimeAttributeValue>>) {
                const RuntimeValue base_value = eval_runtime_expr(current->value, env);
                return eval_runtime_vector_attribute(base_value, current->name);
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<RuntimeIndexValue>>) {
                const RuntimeValue base_value = eval_runtime_expr(current->value, env);
                const RuntimeVectorElements& elements =
                    require_runtime_vector_elements(base_value, "dotted index");
                if (current->index < 0 ||
                    static_cast<std::size_t>(current->index) >= elements.size()) {
                    throw RuntimeExecuteError(
                        "runtime dotted index out of bounds: " +
                        std::to_string(current->index) +
                        " for vector size " + std::to_string(elements.size()));
                }
                return elements[static_cast<std::size_t>(current->index)];
            } else {
                throw RuntimeExecuteError("native runtime execution does not support LooseDotValue yet");
            }
        },
        expr);
}

double require_runtime_scalar_number(const RuntimeValue& value, const char* context) {
    const double* number = std::get_if<double>(&value.data);
    if (number == nullptr) {
        throw RuntimeExecuteError(std::string("builtin ") + context + " expects scalar number arguments");
    }
    return *number;
}

const RuntimeVectorElements& require_runtime_vector_elements(
    const RuntimeValue& value,
    const char* context) {
    const RuntimeVectorElements* elements = std::get_if<RuntimeVectorElements>(&value.data);
    if (elements == nullptr) {
        throw RuntimeExecuteError(std::string("runtime ") + context + " expects a vector value");
    }
    return *elements;
}

std::size_t runtime_vector_attribute_index(char component) {
    switch (component) {
        case 'x':
        case 'r':
            return 0;
        case 'y':
        case 'g':
            return 1;
        case 'z':
        case 'b':
            return 2;
        case 'w':
        case 'a':
            return 3;
        default:
            throw RuntimeExecuteError(
                std::string("unsupported runtime vector attribute component: ") + component);
    }
}

RuntimeValue eval_runtime_vector_attribute(const RuntimeValue& value, const std::string& name) {
    const RuntimeVectorElements& elements = require_runtime_vector_elements(value, "attribute");
    if (name.empty()) {
        throw RuntimeExecuteError("runtime attribute name must not be empty");
    }

    RuntimeVectorElements selected;
    selected.reserve(name.size());
    for (char component : name) {
        const std::size_t index = runtime_vector_attribute_index(component);
        if (index >= elements.size()) {
            throw RuntimeExecuteError(
                "runtime vector attribute out of bounds: ." + name +
                " for vector size " + std::to_string(elements.size()));
        }
        selected.push_back(elements[index]);
    }

    if (selected.size() == 1) {
        return selected.front();
    }
    return RuntimeValue{std::move(selected)};
}

std::string format_runtime_number(double value) {
    std::ostringstream out;
    out << value;
    return out.str();
}

std::string runtime_value_to_text(const RuntimeValue& value) {
    return std::visit(
        [](const auto& current) -> std::string {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, double>) {
                return format_runtime_number(current);
            } else {
                std::ostringstream out;
                out << "[";
                for (std::size_t index = 0; index < current.size(); ++index) {
                    if (index > 0) {
                        out << ", ";
                    }
                    out << runtime_value_to_text(current[index]);
                }
                out << "]";
                return out.str();
            }
        },
        value.data);
}

}  // namespace

JsonValue ToJsonValue(const RuntimeExpr& expr) {
    return std::visit(
        [](const auto& current) -> JsonValue {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, RuntimeNumberConstant>) {
                return JsonValue::Object{
                    {"kind", JsonValue("NumberConstant")},
                    {"text", JsonValue(current.text)},
                };
            } else if constexpr (std::is_same_v<Value, RuntimeBindingRef>) {
                return JsonValue::Object{
                    {"kind", JsonValue("BindingRef")},
                    {"name", JsonValue(current.name)},
                };
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<RuntimeVectorValue>>) {
                JsonValue::Array elements;
                elements.reserve(current->elements.size());
                for (const auto& element : current->elements) {
                    elements.push_back(ToJsonValue(element));
                }
                return JsonValue::Object{
                    {"elements", JsonValue(elements)},
                    {"kind", JsonValue("VectorValue")},
                };
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<RuntimeCallValue>>) {
                JsonValue::Array args;
                args.reserve(current->args.size());
                for (const auto& arg : current->args) {
                    args.push_back(ToJsonValue(arg));
                }
                return JsonValue::Object{
                    {"args", JsonValue(args)},
                    {"func", ToJsonValue(current->func)},
                    {"kind", JsonValue("CallValue")},
                };
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<RuntimeAttributeValue>>) {
                return JsonValue::Object{
                    {"kind", JsonValue("AttributeValue")},
                    {"name", JsonValue(current->name)},
                    {"value", ToJsonValue(current->value)},
                };
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<RuntimeIndexValue>>) {
                return JsonValue::Object{
                    {"index", JsonValue(static_cast<double>(current->index))},
                    {"kind", JsonValue("IndexValue")},
                    {"value", ToJsonValue(current->value)},
                };
            } else {
                return JsonValue::Object{
                    {"kind", JsonValue("LooseDotValue")},
                    {"value", ToJsonValue(current->value)},
                };
            }
        },
        expr);
}

JsonValue ToJsonValue(const RuntimeStep& step) {
    return std::visit(
        [](const auto& current) -> JsonValue {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, RuntimeBindStep>) {
                JsonValue type_expr = JsonValue(nullptr);
                if (current.type_expr.has_value()) {
                    type_expr = type_to_json_value(*current.type_expr);
                }
                return JsonValue::Object{
                    {"kind", JsonValue("BindStep")},
                    {"target_name", JsonValue(current.target_name)},
                    {"type_expr", type_expr},
                    {"value", ToJsonValue(current.value)},
                };
            } else {
                return JsonValue::Object{
                    {"kind", JsonValue("EmitStep")},
                    {"value", ToJsonValue(current.value)},
                };
            }
        },
        step);
}

JsonValue ToJsonValue(const RuntimeProgramArtifact& artifact) {
    JsonValue::Array steps;
    steps.reserve(artifact.steps.size());
    for (const auto& step : artifact.steps) {
        steps.push_back(ToJsonValue(step));
    }

    return JsonValue::Object{
        {"initial_snapshot", ToJsonValue(artifact.initial_snapshot)},
        {"origin", JsonValue(artifact.origin)},
        {"schema", JsonValue("vektorflow.native_runtime_program")},
        {"steps", JsonValue(steps)},
        {"version", JsonValue(1.0)},
    };
}

RuntimeProgramArtifact build_runtime_program(const Module& module, const std::string& origin) {
    RuntimeProgramArtifact artifact;
    artifact.origin = origin;
    artifact.initial_snapshot = MakeEmptyUiRuntimePacketSnapshot();
    artifact.steps.reserve(module.statements.size());
    for (const auto& stmt : module.statements) {
        artifact.steps.push_back(lower_stmt(stmt));
    }
    return artifact;
}

RuntimeProgramArtifact parse_runtime_program(const JsonValue& value) {
    const auto& object = require_object(value, "runtime program artifact");
    const std::string schema = require_string_field(object, "schema", "runtime program artifact");
    if (schema != "vektorflow.native_runtime_program") {
        throw RuntimeLoadError("unexpected runtime program schema: " + schema);
    }
    const double version = require_field(object, "version", "runtime program artifact").as_number();
    if (version != 1.0) {
        throw RuntimeLoadError("unsupported runtime program version");
    }

    RuntimeProgramArtifact artifact;
    artifact.origin = require_string_field(object, "origin", "runtime program artifact");
    artifact.initial_snapshot = ParseUiRuntimePacketSnapshot(require_field(object, "initial_snapshot", "runtime program artifact"));

    const auto& steps = require_array(require_field(object, "steps", "runtime program artifact"), "runtime program steps");
    artifact.steps.reserve(steps.size());
    for (const auto& step : steps) {
        artifact.steps.push_back(parse_runtime_step(step));
    }
    return artifact;
}

RuntimeProgramArtifact parse_runtime_program(const std::string& text) {
    return parse_runtime_program(parse_json(text));
}

RuntimeProgramArtifact parse_runtime_program(const char* text) {
    return parse_runtime_program(std::string(text == nullptr ? "" : text));
}

std::string runtime_program_to_json(const RuntimeProgramArtifact& artifact, int indent) {
    return json_stringify(ToJsonValue(artifact), indent);
}

std::string execute_runtime_program(const RuntimeProgramArtifact& artifact) {
    std::unordered_map<std::string, RuntimeValue> env;
    std::ostringstream out;
    bool emitted_any = false;

    for (const auto& step : artifact.steps) {
        std::visit(
            [&](const auto& current) {
                using Value = std::decay_t<decltype(current)>;
                if constexpr (std::is_same_v<Value, RuntimeBindStep>) {
                    env[current.target_name] = eval_runtime_expr(current.value, env);
                } else {
                    if (emitted_any) {
                        out << "\n";
                    }
                    out << runtime_value_to_text(eval_runtime_expr(current.value, env));
                    emitted_any = true;
                }
            },
            step);
    }

    if (emitted_any) {
        out << "\n";
    }
    return out.str();
}

}  // namespace vf
