#include "native/VfOverlay/vf/json.hpp"

#include <cstdint>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr const char* compiler_version = "vkf-webgpu-artifact-smoke-0.1";

class WebGpuArtifactFailure : public std::runtime_error {
public:
    explicit WebGpuArtifactFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Dependency {
    std::string name;
    std::filesystem::path path;
    std::string hash;
};

struct Binding {
    std::string name;
    enum class Kind {
        I32,
        I32Array,
        F64,
        F64Array,
    } kind;
    std::int32_t i32_value = 0;
    double f64_value = 0.0;
    std::vector<std::int32_t> i32_array_values;
    std::vector<double> f64_array_values;
    std::string axis_key;
};

struct EvaluatedBindingValue {
    bool is_array = false;
    double scalar_value = 0.0;
    std::vector<double> array_values;
    std::string axis_key;
};

struct UpdateExpr {
    enum class Kind {
        ConstI32,
        ConstF64,
        LoadState,
        LoadInput,
        LoadStateField,
        LoadInputField,
        LoadBinding,
        LoadBindingAxisElem,
        IntrinsicCall,
        BinaryOp,
    } kind;
    std::int32_t i32_value = 0;
    double f64_value = 0.0;
    std::string op;
    std::string binding_name;
    std::vector<UpdateExpr> args;
};

struct FieldDesc {
    std::string name;
    std::string type;
    std::string storage = "i32";
    std::string axis_key;
    std::size_t axis_length = 0;
    std::uint32_t offset = 0;
};

struct UpdatePlan {
    bool enabled = false;
    bool record_mode = false;
    bool axis_vector_mode = false;
    bool axis_input_vector = false;
    bool axis_float_mode = false;
    bool scalar_float_mode = false;
    std::string axis_key;
    std::size_t axis_vector_length = 0;
    std::vector<FieldDesc> state_fields;
    std::vector<FieldDesc> input_fields;
    UpdateExpr scalar_expr{UpdateExpr::Kind::ConstI32};
    std::vector<std::pair<std::string, UpdateExpr>> record_fields;
};

struct ModulePlan {
    std::vector<Binding> bindings;
    UpdatePlan update;
};

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw WebGpuArtifactFailure("expected object for " + context);
    }
    return value.as_object();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) {
        throw WebGpuArtifactFailure("expected array for " + context);
    }
    return value.as_array();
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw WebGpuArtifactFailure("missing field " + name + " in " + context);
    }
    return found->second;
}

std::string string_field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const vf::JsonValue& value = field(object, name, context);
    if (!value.is_string()) {
        throw WebGpuArtifactFailure("expected string field " + name + " in " + context);
    }
    return value.as_string();
}

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw WebGpuArtifactFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_text(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw WebGpuArtifactFailure("could not write " + path.string());
    }
    output << text;
}

std::string hex_u64(std::uint64_t value) {
    const char* digits = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) {
        out[static_cast<std::size_t>(i)] = digits[value & 0xF];
        value >>= 4;
    }
    return out;
}

std::string stable_hash(const std::string& text) {
    std::uint64_t hash = 1469598103934665603ull;
    for (unsigned char ch : text) {
        hash ^= ch;
        hash *= 1099511628211ull;
    }
    return hex_u64(hash);
}

std::filesystem::path repo_root_from_source(const std::filesystem::path& source) {
    auto parent = std::filesystem::absolute(source).parent_path();
    if (parent.empty()) {
        return std::filesystem::current_path();
    }
    return parent;
}

std::string stem_of(const std::filesystem::path& source) {
    std::string stem = source.stem().string();
    return stem.empty() ? "stdin" : stem;
}

std::int32_t checked_i32(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_number()) {
        throw WebGpuArtifactFailure("expected numeric value for " + context);
    }
    const double raw = value.as_number();
    const double integral = static_cast<double>(static_cast<std::int32_t>(raw));
    if (raw != integral || raw < static_cast<double>(std::numeric_limits<std::int32_t>::min())
        || raw > static_cast<double>(std::numeric_limits<std::int32_t>::max())) {
        throw WebGpuArtifactFailure("expected i32-compatible numeric value for " + context);
    }
    return static_cast<std::int32_t>(raw);
}

const Binding* find_binding(const std::vector<Binding>& bindings, const std::string& name) {
    for (const auto& binding : bindings) {
        if (binding.name == name) {
            return &binding;
        }
    }
    return nullptr;
}

bool is_i32_compatible(double raw) {
    const double integral = static_cast<double>(static_cast<std::int32_t>(raw));
    return raw == integral
        && raw >= static_cast<double>(std::numeric_limits<std::int32_t>::min())
        && raw <= static_cast<double>(std::numeric_limits<std::int32_t>::max());
}

std::string parse_math_intrinsic_name(const vf::JsonValue::Object& callee, const std::string& context);

EvaluatedBindingValue binding_to_evaluated_value(const Binding& binding) {
    EvaluatedBindingValue out;
    if (binding.kind == Binding::Kind::I32) {
        out.scalar_value = static_cast<double>(binding.i32_value);
        return out;
    }
    if (binding.kind == Binding::Kind::F64) {
        out.scalar_value = binding.f64_value;
        return out;
    }
    if (binding.kind == Binding::Kind::I32Array) {
        out.is_array = true;
        out.axis_key = binding.axis_key;
        out.array_values.reserve(binding.i32_array_values.size());
        for (std::int32_t value : binding.i32_array_values) {
            out.array_values.push_back(static_cast<double>(value));
        }
        return out;
    }
    if (binding.kind == Binding::Kind::F64Array) {
        out.is_array = true;
        out.axis_key = binding.axis_key;
        out.array_values = binding.f64_array_values;
        return out;
    }
    throw WebGpuArtifactFailure("unsupported binding kind for numeric evaluation");
}

EvaluatedBindingValue apply_binary_binding_op(
    const std::string& op,
    const EvaluatedBindingValue& left,
    const EvaluatedBindingValue& right
) {
    auto apply_scalar = [&op](double lhs, double rhs) -> double {
        if (op == "PLUS") return lhs + rhs;
        if (op == "MINUS") return lhs - rhs;
        if (op == "STAR") return lhs * rhs;
        if (op == "SLASH") return lhs / rhs;
        if (op == "CARET") return std::pow(lhs, rhs);
        throw WebGpuArtifactFailure("webgpu computed binding only supports PLUS, MINUS, STAR, SLASH, and CARET");
    };
    if (!left.is_array && !right.is_array) {
        EvaluatedBindingValue out;
        out.scalar_value = apply_scalar(left.scalar_value, right.scalar_value);
        return out;
    }
    EvaluatedBindingValue out;
    out.is_array = true;
    if (left.is_array && right.is_array) {
        if (left.axis_key != right.axis_key || left.array_values.size() != right.array_values.size()) {
            throw WebGpuArtifactFailure("webgpu computed binding only supports same-axis vector arithmetic");
        }
        out.axis_key = left.axis_key;
        for (std::size_t i = 0; i < left.array_values.size(); ++i) {
            out.array_values.push_back(apply_scalar(left.array_values[i], right.array_values[i]));
        }
        return out;
    }
    const EvaluatedBindingValue& array_side = left.is_array ? left : right;
    const EvaluatedBindingValue& scalar_side = left.is_array ? right : left;
    out.axis_key = array_side.axis_key;
    for (double value : array_side.array_values) {
        out.array_values.push_back(
            left.is_array ? apply_scalar(value, scalar_side.scalar_value) : apply_scalar(scalar_side.scalar_value, value)
        );
    }
    return out;
}

EvaluatedBindingValue evaluate_binding_value(const vf::JsonValue& value, const std::vector<Binding>& bindings) {
    const auto& object = object_of(value, "computed binding");
    const std::string kind = string_field(object, "kind", "computed binding");
    if (kind == "const") {
        const vf::JsonValue& const_value = field(object, "value", "const");
        if (!const_value.is_number() && !const_value.is_boolean()) {
            throw WebGpuArtifactFailure("webgpu computed binding const must be numeric or boolean");
        }
        EvaluatedBindingValue out;
        out.scalar_value = const_value.is_boolean() ? (const_value.as_boolean() ? 1.0 : 0.0) : const_value.as_number();
        return out;
    }
    if (kind == "axis_align") {
        EvaluatedBindingValue out;
        out.is_array = true;
        out.axis_key = string_field(object, "axis_key", "axis_align");
        const auto& inner = object_of(field(object, "value", "axis_align"), "axis_align.value");
        if (string_field(inner, "kind", "axis_align.value") != "list") {
            throw WebGpuArtifactFailure("webgpu axis_align binding requires a list value");
        }
        for (const auto& item_value : array_of(field(inner, "items", "list"), "list.items")) {
            const EvaluatedBindingValue item = evaluate_binding_value(item_value, bindings);
            if (item.is_array) {
                throw WebGpuArtifactFailure("webgpu axis_align binding only supports scalar items");
            }
            out.array_values.push_back(item.scalar_value);
        }
        return out;
    }
    if (kind == "load") {
        const std::string name = string_field(object, "name", "load");
        const Binding* binding = find_binding(bindings, name);
        if (binding == nullptr) {
            throw WebGpuArtifactFailure("unknown binding " + name + " in computed webgpu binding");
        }
        return binding_to_evaluated_value(*binding);
    }
    if (kind == "binary_op") {
        return apply_binary_binding_op(
            string_field(object, "op", "binary_op"),
            evaluate_binding_value(field(object, "left", "binary_op.left"), bindings),
            evaluate_binding_value(field(object, "right", "binary_op.right"), bindings)
        );
    }
    if (kind == "call") {
        const auto& callee = object_of(field(object, "callee", "call"), "call.callee");
        const std::string field_name = parse_math_intrinsic_name(callee, "call.callee");
        const auto& args = array_of(field(object, "args", "call"), "call.args");
        if (args.size() != 1
            || (field_name != "sin" && field_name != "cos" && field_name != "sqrt" && field_name != "exp")) {
            throw WebGpuArtifactFailure("webgpu computed binding only supports unary math.sin/math.cos/math.sqrt/math.exp");
        }
        const EvaluatedBindingValue arg = evaluate_binding_value(args[0], bindings);
        auto apply_intrinsic = [&field_name](double value) -> double {
            if (field_name == "sin") {
                return std::sin(value);
            }
            if (field_name == "cos") {
                return std::cos(value);
            }
            if (field_name == "sqrt") {
                return std::sqrt(value);
            }
            return std::exp(value);
        };
        if (!arg.is_array) {
            EvaluatedBindingValue out;
            out.scalar_value = apply_intrinsic(arg.scalar_value);
            return out;
        }
        EvaluatedBindingValue out;
        out.is_array = true;
        out.axis_key = arg.axis_key;
        for (double value : arg.array_values) {
            out.array_values.push_back(apply_intrinsic(value));
        }
        return out;
    }
    throw WebGpuArtifactFailure("unsupported computed webgpu binding kind " + kind);
}

Binding binding_from_store(const vf::JsonValue::Object& stmt, const std::vector<Binding>& bindings) {
    Binding binding;
    binding.name = string_field(stmt, "name", "store_binding");
    const auto& value = field(stmt, "value", "store_binding");
    const EvaluatedBindingValue evaluated = evaluate_binding_value(value, bindings);
    if (evaluated.is_array) {
        binding.axis_key = evaluated.axis_key;
        bool all_i32 = true;
        for (double item : evaluated.array_values) {
            if (!is_i32_compatible(item)) {
                all_i32 = false;
                break;
            }
        }
        if (all_i32) {
            binding.kind = Binding::Kind::I32Array;
            for (double item : evaluated.array_values) {
                binding.i32_array_values.push_back(static_cast<std::int32_t>(item));
            }
        } else {
            binding.kind = Binding::Kind::F64Array;
            binding.f64_array_values = evaluated.array_values;
        }
        return binding;
    }
    if (is_i32_compatible(evaluated.scalar_value)) {
        binding.kind = Binding::Kind::I32;
        binding.i32_value = static_cast<std::int32_t>(evaluated.scalar_value);
    } else {
        binding.kind = Binding::Kind::F64;
        binding.f64_value = evaluated.scalar_value;
    }
    return binding;
}

bool parse_axis_vector_type(
    const std::string& type_name,
    std::string& axis_key,
    std::string& value_type
);

const Binding* find_axis_seed_binding(const std::vector<Binding>& bindings, const std::string& axis_key);

std::string parse_math_intrinsic_name(const vf::JsonValue::Object& callee, const std::string& context) {
    const std::string callee_kind = string_field(callee, "kind", context);
    if (callee_kind == "field_access") {
        const std::string field_name = string_field(callee, "field", context);
        const auto& base = object_of(field(callee, "object", context + ".object"), context + ".object");
        if (string_field(base, "kind", context + ".object") != "load"
            || string_field(base, "name", context + ".object") != "math") {
            throw WebGpuArtifactFailure("webgpu update expr only supports math intrinsic calls");
        }
        return field_name;
    }
    if (callee_kind == "stdlib_function") {
        const std::string full_name = string_field(callee, "full_name", context);
        if (full_name == "math.sin") {
            return "sin";
        }
        if (full_name == "math.cos") {
            return "cos";
        }
        if (full_name == "math.sqrt") {
            return "sqrt";
        }
        if (full_name == "math.exp") {
            return "exp";
        }
        throw WebGpuArtifactFailure("webgpu update expr only supports math intrinsic calls");
    }
    throw WebGpuArtifactFailure("webgpu update expr only supports stdlib math intrinsic calls");
}

std::size_t binding_array_length(const Binding& binding) {
    if (binding.kind == Binding::Kind::I32Array) {
        return binding.i32_array_values.size();
    }
    if (binding.kind == Binding::Kind::F64Array) {
        return binding.f64_array_values.size();
    }
    return 0;
}

const FieldDesc* find_field_desc(const std::vector<FieldDesc>& fields, const std::string& name) {
    for (const auto& field : fields) {
        if (field.name == name) {
            return &field;
        }
    }
    return nullptr;
}

std::uint32_t field_storage_words(const FieldDesc& field) {
    return static_cast<std::uint32_t>(field.axis_length > 0 ? field.axis_length : 1);
}

bool is_webgpu_float_type(const std::string& type_name) {
    return type_name == "f32" || type_name == "f64";
}

bool is_float_field(const FieldDesc& field) {
    return field.storage == "f32";
}

std::string field_wgsl_scalar_type(const FieldDesc& field) {
    return is_float_field(field) ? "f32" : "i32";
}

std::string field_wgsl_type(const FieldDesc& field) {
    if (field.axis_length > 0) {
        return "array<" + field_wgsl_scalar_type(field) + ", " + std::to_string(field.axis_length) + ">";
    }
    return field_wgsl_scalar_type(field);
}

std::uint32_t layout_size_bytes(const std::vector<FieldDesc>& fields) {
    if (fields.empty()) {
        return 0;
    }
    const FieldDesc& last = fields.back();
    return last.offset + (field_storage_words(last) * 4);
}

std::vector<FieldDesc> parse_record_fields(
    const std::string& type_name,
    const std::string& context,
    const std::vector<Binding>& bindings
) {
    const std::string prefix = "record{";
    if (type_name.rfind(prefix, 0) != 0 || type_name.empty() || type_name.back() != '}') {
        throw WebGpuArtifactFailure(context + " must be a record{...} type");
    }
    const std::string inner = type_name.substr(prefix.size(), type_name.size() - prefix.size() - 1);
    std::vector<FieldDesc> fields;
    std::uint32_t next_offset = 0;
    if (inner.empty()) {
        return fields;
    }
    std::size_t start = 0;
    while (start < inner.size()) {
        const std::size_t comma = inner.find(',', start);
        const std::string part = inner.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
        const std::size_t colon = part.find(':');
        if (colon == std::string::npos) {
            throw WebGpuArtifactFailure("malformed record field in " + context);
        }
        FieldDesc field_desc;
        field_desc.name = part.substr(0, colon);
        const std::string field_type = part.substr(colon + 1);
        field_desc.type = field_type;
        field_desc.offset = next_offset;
        if (field_type == "num" || is_webgpu_float_type(field_type)) {
            if (is_webgpu_float_type(field_type)) {
                field_desc.storage = "f32";
            }
            next_offset += 4;
        } else {
            std::string axis_key;
            std::string value_type;
            if (!parse_axis_vector_type(field_type, axis_key, value_type)
                || (value_type != "list<num>" && value_type != "list<f32>" && value_type != "list<f64>")) {
                throw WebGpuArtifactFailure(context + " only supports num/f32/f64 fields or axis<k>:list<num|f32|f64> fields");
            }
            const Binding* seed = find_axis_seed_binding(bindings, axis_key);
            if (seed == nullptr) {
                throw WebGpuArtifactFailure(context + " axis-vector fields require an axis-aligned const binding seed");
            }
            field_desc.axis_key = axis_key;
            field_desc.axis_length = binding_array_length(*seed);
            if (value_type != "list<num>" || seed->kind == Binding::Kind::F64Array) {
                field_desc.storage = "f32";
            }
            next_offset += static_cast<std::uint32_t>(field_desc.axis_length * 4);
        }
        fields.push_back(std::move(field_desc));
        if (comma == std::string::npos) {
            break;
        }
        start = comma + 1;
    }
    return fields;
}

bool parse_axis_vector_type(
    const std::string& type_name,
    std::string& axis_key,
    std::string& value_type
) {
    const std::string prefix = "axis<";
    if (type_name.rfind(prefix, 0) != 0) {
        return false;
    }
    const std::size_t close = type_name.find(">:");
    if (close == std::string::npos) {
        return false;
    }
    axis_key = type_name.substr(prefix.size(), close - prefix.size());
    value_type = type_name.substr(close + 2);
    return !axis_key.empty() && !value_type.empty();
}

const Binding* find_axis_seed_binding(const std::vector<Binding>& bindings, const std::string& axis_key) {
    for (const auto& binding : bindings) {
        if ((binding.kind == Binding::Kind::I32Array || binding.kind == Binding::Kind::F64Array)
            && binding.axis_key == axis_key) {
            return &binding;
        }
    }
    return nullptr;
}

UpdateExpr parse_update_expr(
    const vf::JsonValue& value,
    const std::vector<Binding>& bindings,
    const std::vector<FieldDesc>* state_fields,
    const std::vector<FieldDesc>* input_fields,
    const std::map<std::string, vf::JsonValue>* local_bindings = nullptr
) {
    const auto& object = object_of(value, "webgpu update expr");
    const std::string kind = string_field(object, "kind", "webgpu update expr");
    if (kind == "const") {
        const vf::JsonValue& const_value = field(object, "value", "const");
        if (!const_value.is_number()) {
            throw WebGpuArtifactFailure("webgpu update expr only supports numeric const values");
        }
        UpdateExpr out{UpdateExpr::Kind::ConstI32};
        const double raw = const_value.as_number();
        if (is_i32_compatible(raw)) {
            out.i32_value = static_cast<std::int32_t>(raw);
        } else {
            out.kind = UpdateExpr::Kind::ConstF64;
            out.f64_value = raw;
        }
        return out;
    }
    if (kind == "load") {
        const std::string name = string_field(object, "name", "load");
        if (name == "state") {
            return UpdateExpr{UpdateExpr::Kind::LoadState};
        }
        if (name == "input") {
            return UpdateExpr{UpdateExpr::Kind::LoadInput};
        }
        if (local_bindings != nullptr) {
            const auto found_local = local_bindings->find(name);
            if (found_local != local_bindings->end()) {
                return parse_update_expr(found_local->second, bindings, state_fields, input_fields, local_bindings);
            }
        }
        const Binding* binding = find_binding(bindings, name);
        if (binding != nullptr) {
            if (binding->kind == Binding::Kind::I32Array || binding->kind == Binding::Kind::F64Array) {
                UpdateExpr out{UpdateExpr::Kind::LoadBindingAxisElem};
                out.binding_name = name;
                return out;
            }
            if (binding->kind == Binding::Kind::I32 || binding->kind == Binding::Kind::F64) {
                UpdateExpr out{UpdateExpr::Kind::LoadBinding};
                out.binding_name = name;
                return out;
            }
            throw WebGpuArtifactFailure("webgpu update expr only supports numeric const bindings and axis-aligned numeric bindings");
        }
        throw WebGpuArtifactFailure("webgpu update expr only supports load(state), load(input), or numeric const bindings");
    }
    if (kind == "field_access") {
        const auto& base = object_of(field(object, "object", "field_access.object"), "field_access.object");
        const std::string base_kind = string_field(base, "kind", "field_access.object");
        if (base_kind != "load") {
            throw WebGpuArtifactFailure("webgpu field_access only supports load(state) or load(input)");
        }
        const std::string base_name = string_field(base, "name", "field_access.object");
        const std::string field_name = string_field(object, "field", "field_access");
        if (base_name == "state" && state_fields != nullptr) {
            if (find_field_desc(*state_fields, field_name) == nullptr) {
                throw WebGpuArtifactFailure("unknown field " + field_name + " in state");
            }
            UpdateExpr out{UpdateExpr::Kind::LoadStateField};
            out.binding_name = field_name;
            return out;
        }
        if (base_name == "input" && input_fields != nullptr) {
            if (find_field_desc(*input_fields, field_name) == nullptr) {
                throw WebGpuArtifactFailure("unknown field " + field_name + " in input");
            }
            UpdateExpr out{UpdateExpr::Kind::LoadInputField};
            out.binding_name = field_name;
            return out;
        }
        throw WebGpuArtifactFailure("webgpu field_access only supports declared state/input record fields");
    }
    if (kind == "call") {
        const auto& callee = object_of(field(object, "callee", "call"), "call.callee");
        const std::string field_name = parse_math_intrinsic_name(callee, "call.callee");
        const auto& args = array_of(field(object, "args", "call"), "call.args");
        if (args.size() != 1
            || (field_name != "sin" && field_name != "cos" && field_name != "sqrt" && field_name != "exp")) {
            throw WebGpuArtifactFailure("webgpu update expr only supports unary math.sin/math.cos/math.sqrt/math.exp");
        }
        UpdateExpr out{UpdateExpr::Kind::IntrinsicCall};
        out.op = field_name;
        out.args.push_back(parse_update_expr(args[0], bindings, state_fields, input_fields, local_bindings));
        return out;
    }
    if (kind == "binary_op") {
        UpdateExpr out{UpdateExpr::Kind::BinaryOp};
        out.op = string_field(object, "op", "binary_op");
        out.args.push_back(parse_update_expr(field(object, "left", "binary_op.left"), bindings, state_fields, input_fields, local_bindings));
        out.args.push_back(parse_update_expr(field(object, "right", "binary_op.right"), bindings, state_fields, input_fields, local_bindings));
        if (out.op != "PLUS" && out.op != "MINUS" && out.op != "STAR" && out.op != "SLASH" && out.op != "CARET") {
            throw WebGpuArtifactFailure("webgpu update expr only supports PLUS, MINUS, STAR, SLASH, and CARET");
        }
        return out;
    }
    throw WebGpuArtifactFailure("unsupported webgpu update expr kind " + kind);
}

bool parse_update_function(const vf::JsonValue::Object& stmt, const std::vector<Binding>& bindings, UpdatePlan& out_plan) {
    if (string_field(stmt, "kind", "typed IR stmt") != "function") {
        return false;
    }
    if (string_field(stmt, "name", "function") != "vkf_update") {
        return false;
    }
    const auto& params = array_of(field(stmt, "params", "function"), "function.params");
    if (params.size() != 2) {
        throw WebGpuArtifactFailure("webgpu vkf_update function must take exactly two params");
    }
    const auto& p0 = object_of(params[0], "function.param");
    const auto& p1 = object_of(params[1], "function.param");
    const std::string p0_name = string_field(p0, "name", "function.param");
    const std::string p1_name = string_field(p1, "name", "function.param");
    const std::string p0_type = string_field(p0, "type", "function.param");
    const std::string p1_type = string_field(p1, "type", "function.param");
    const std::string return_type = string_field(stmt, "return_type", "function");
    if (p0_name != "state") {
        throw WebGpuArtifactFailure("webgpu vkf_update first param must be named state");
    }
    if (p1_name != "input") {
        throw WebGpuArtifactFailure("webgpu vkf_update second param must be named input");
    }
    const auto& body = object_of(field(stmt, "body", "function"), "function.body");
    if (string_field(body, "kind", "function.body") != "block") {
        throw WebGpuArtifactFailure("webgpu vkf_update body must be a block");
    }
    const auto& statements = array_of(field(body, "body", "function.body"), "function.body.body");
    if (statements.empty()) {
        throw WebGpuArtifactFailure("webgpu vkf_update body must contain a return");
    }
    std::map<std::string, vf::JsonValue> local_bindings;
    for (std::size_t i = 0; i + 1 < statements.size(); ++i) {
        const auto& local_stmt = object_of(statements[i], "function.body.stmt");
        const std::string local_kind = string_field(local_stmt, "kind", "function.body.stmt");
        if (local_kind != "store_binding") {
            throw WebGpuArtifactFailure("webgpu vkf_update body only supports local store_binding statements before the final return");
        }
        local_bindings[string_field(local_stmt, "name", "store_binding")] = field(local_stmt, "value", "store_binding");
    }
    const auto& only_stmt = object_of(statements.back(), "function.body.stmt");
    if (string_field(only_stmt, "kind", "function.body.stmt") != "return") {
        throw WebGpuArtifactFailure("webgpu vkf_update body must end with a return");
    }
    const vf::JsonValue& return_value = field(only_stmt, "value", "function.return");
    if ((p0_type == "num" || is_webgpu_float_type(p0_type))
        && p1_type == p0_type) {
        if (return_type != p0_type) {
            throw WebGpuArtifactFailure("webgpu scalar vkf_update must return the state scalar type");
        }
        out_plan.enabled = true;
        out_plan.record_mode = false;
        out_plan.scalar_float_mode = is_webgpu_float_type(p0_type);
        out_plan.scalar_expr = parse_update_expr(return_value, bindings, nullptr, nullptr, &local_bindings);
        return true;
    }
    std::string axis_key;
    std::string axis_value_type;
    std::string input_axis_key;
    std::string input_axis_value_type;
    if (parse_axis_vector_type(p0_type, axis_key, axis_value_type)
        && (p1_type == "num" || is_webgpu_float_type(p1_type) || parse_axis_vector_type(p1_type, input_axis_key, input_axis_value_type))) {
        if (return_type != p0_type
            || (axis_value_type != "list<num>" && axis_value_type != "list<f32>" && axis_value_type != "list<f64>")) {
            throw WebGpuArtifactFailure("webgpu axis-vector vkf_update must return the state axis-vector type");
        }
        const Binding* seed = find_axis_seed_binding(bindings, axis_key);
        if (seed == nullptr) {
            throw WebGpuArtifactFailure("webgpu axis-vector vkf_update requires an axis-aligned const binding seed");
        }
        bool vector_input = false;
        if (p1_type != "num" && !is_webgpu_float_type(p1_type)) {
            if (input_axis_key != axis_key
                || (input_axis_value_type != axis_value_type)) {
                throw WebGpuArtifactFailure("webgpu axis-vector vkf_update only supports matching axis-vector input");
            }
            vector_input = true;
        }
        out_plan.enabled = true;
        out_plan.axis_vector_mode = true;
        out_plan.axis_input_vector = vector_input;
        out_plan.axis_key = axis_key;
        out_plan.axis_float_mode = (axis_value_type != "list<num>") || seed->kind == Binding::Kind::F64Array;
        out_plan.axis_vector_length = binding_array_length(*seed);
        out_plan.scalar_expr = parse_update_expr(return_value, bindings, nullptr, nullptr, &local_bindings);
        return true;
    }
    if (p0_type.rfind("record{", 0) != 0 || p1_type.rfind("record{", 0) != 0) {
        throw WebGpuArtifactFailure("webgpu vkf_update must use either num/num->num or matching record state/input types");
    }
    if (return_type != p0_type) {
        throw WebGpuArtifactFailure("webgpu vkf_update record mode must return the state record type");
    }
    out_plan.enabled = true;
    out_plan.record_mode = true;
    out_plan.state_fields = parse_record_fields(p0_type, "webgpu vkf_update state", bindings);
    out_plan.input_fields = parse_record_fields(p1_type, "webgpu vkf_update input", bindings);
    const auto& returned = object_of(return_value, "webgpu vkf_update return");
    if (string_field(returned, "kind", "webgpu vkf_update return") != "record") {
        throw WebGpuArtifactFailure("webgpu vkf_update record mode must return a record");
    }
    const auto& fields = array_of(field(returned, "fields", "record"), "record.fields");
    if (fields.size() != out_plan.state_fields.size()) {
        throw WebGpuArtifactFailure("webgpu vkf_update record return must include every state field exactly once");
    }
    for (std::size_t i = 0; i < fields.size(); ++i) {
        const auto& field_object = object_of(fields[i], "record field");
        const std::string field_name = string_field(field_object, "name", "record field");
        if (field_name != out_plan.state_fields[i].name) {
            throw WebGpuArtifactFailure("webgpu vkf_update record fields must match state field order");
        }
        out_plan.record_fields.push_back({
            field_name,
            parse_update_expr(field(field_object, "value", "record field"), bindings, &out_plan.state_fields, &out_plan.input_fields, &local_bindings)
        });
    }
    return true;
}

ModulePlan collect_module_plan(const vf::JsonValue& root) {
    const auto& module = object_of(root, "typed IR module");
    const std::string kind = string_field(module, "kind", "typed IR module");
    if (kind != "typed_module") {
        throw WebGpuArtifactFailure("unsupported typed IR root kind " + kind);
    }
    ModulePlan plan;
    for (const auto& stmt_value : array_of(field(module, "body", "typed_module"), "typed_module.body")) {
        const auto& stmt = object_of(stmt_value, "typed IR stmt");
        const std::string stmt_kind = string_field(stmt, "kind", "typed IR stmt");
        if (stmt_kind == "store_binding") {
            plan.bindings.push_back(binding_from_store(stmt, plan.bindings));
            continue;
        }
        if (stmt_kind == "expr_stmt") {
            continue;
        }
        if (stmt_kind == "function") {
            if (plan.update.enabled) {
                throw WebGpuArtifactFailure("only one webgpu vkf_update function is supported");
            }
            if (parse_update_function(stmt, plan.bindings, plan.update)) {
                continue;
            }
        }
        throw WebGpuArtifactFailure("unsupported typed IR statement kind " + stmt_kind + " for webgpu artifact emission");
    }
    if (!plan.update.enabled) {
        throw WebGpuArtifactFailure("webgpu artifact smoke requires a vkf_update function");
    }
    return plan;
}

std::string emit_expr(
    const UpdateExpr& expr,
    const ModulePlan& plan,
    const std::string& state_name,
    const std::string& input_name,
    const std::string& axis_index_name = "",
    bool float_expr_mode_override = false
) {
    const bool float_expr_mode = float_expr_mode_override || (plan.update.axis_vector_mode && plan.update.axis_float_mode) || plan.update.scalar_float_mode;
    auto format_float = [](double value) -> std::string {
        std::ostringstream out;
        out.setf(std::ios::fixed);
        out.precision(8);
        out << static_cast<float>(value);
        std::string text = out.str();
        while (text.size() > 2 && text.back() == '0' && text[text.size() - 2] != '.') {
            text.pop_back();
        }
        if (!text.empty() && text.back() == '.') {
            text.push_back('0');
        }
        return text;
    };
    if (expr.kind == UpdateExpr::Kind::ConstI32) {
        return float_expr_mode ? format_float(static_cast<double>(expr.i32_value)) : std::to_string(expr.i32_value);
    }
    if (expr.kind == UpdateExpr::Kind::ConstF64) {
        return format_float(expr.f64_value);
    }
    if (expr.kind == UpdateExpr::Kind::LoadState) {
        return plan.update.axis_vector_mode ? (state_name + ".values[" + axis_index_name + "]") : (state_name + ".value");
    }
    if (expr.kind == UpdateExpr::Kind::LoadInput) {
        return (plan.update.axis_vector_mode && plan.update.axis_input_vector)
            ? (input_name + ".values[" + axis_index_name + "]")
            : (input_name + ".value");
    }
    if (expr.kind == UpdateExpr::Kind::LoadStateField) {
        const FieldDesc* field = find_field_desc(plan.update.state_fields, expr.binding_name);
        if (field == nullptr) {
            throw WebGpuArtifactFailure("unknown state field " + expr.binding_name + " during emission");
        }
        if (field->axis_length > 0) {
            if (axis_index_name.empty()) {
                throw WebGpuArtifactFailure("axis-vector state field " + expr.binding_name + " requires axis element context");
            }
            return state_name + "." + expr.binding_name + "[" + axis_index_name + "]";
        }
        return state_name + "." + expr.binding_name;
    }
    if (expr.kind == UpdateExpr::Kind::LoadInputField) {
        const FieldDesc* field = find_field_desc(plan.update.input_fields, expr.binding_name);
        if (field == nullptr) {
            throw WebGpuArtifactFailure("unknown input field " + expr.binding_name + " during emission");
        }
        if (field->axis_length > 0) {
            if (axis_index_name.empty()) {
                throw WebGpuArtifactFailure("axis-vector input field " + expr.binding_name + " requires axis element context");
            }
            return input_name + "." + expr.binding_name + "[" + axis_index_name + "]";
        }
        return input_name + "." + expr.binding_name;
    }
    if (expr.kind == UpdateExpr::Kind::LoadBinding) {
        return expr.binding_name;
    }
    if (expr.kind == UpdateExpr::Kind::LoadBindingAxisElem) {
        return expr.binding_name + "[" + axis_index_name + "]";
    }
    if (expr.kind == UpdateExpr::Kind::IntrinsicCall) {
        const std::string arg = emit_expr(expr.args[0], plan, state_name, input_name, axis_index_name, true);
        if (expr.op == "sin") {
            return "sin(" + arg + ")";
        }
        if (expr.op == "cos") {
            return "cos(" + arg + ")";
        }
        if (expr.op == "sqrt") {
            return "sqrt(" + arg + ")";
        }
        if (expr.op == "exp") {
            return "exp(" + arg + ")";
        }
        throw WebGpuArtifactFailure("unsupported webgpu intrinsic during emission");
    }
    if (expr.kind == UpdateExpr::Kind::BinaryOp) {
        const std::string left = emit_expr(expr.args[0], plan, state_name, input_name, axis_index_name, float_expr_mode_override);
        const std::string right = emit_expr(expr.args[1], plan, state_name, input_name, axis_index_name, float_expr_mode_override);
        if (expr.op == "CARET") {
            return "pow(" + left + ", " + right + ")";
        }
        std::string op = "+";
        if (expr.op == "MINUS") {
            op = "-";
        } else if (expr.op == "STAR") {
            op = "*";
        } else if (expr.op == "SLASH") {
            op = "/";
        }
        return "(" + left + " " + op + " " + right + ")";
    }
    throw WebGpuArtifactFailure("unsupported webgpu update expr during emission");
}

std::string emit_wgsl(const ModulePlan& plan) {
    std::ostringstream out;
    const std::string axis_scalar_type = plan.update.axis_float_mode ? "f32" : "i32";
    const std::string scalar_type = plan.update.scalar_float_mode ? "f32" : "i32";
    out << "// Generated by vkf_webgpu_artifact_smoke\n";
    if (plan.update.axis_vector_mode) {
        out << "struct State {\n  values: array<" << axis_scalar_type << ", " << plan.update.axis_vector_length << ">,\n};\n";
        if (plan.update.axis_input_vector) {
            out << "struct Input {\n  values: array<" << axis_scalar_type << ", " << plan.update.axis_vector_length << ">,\n};\n";
        } else {
            out << "struct Input {\n  value: " << axis_scalar_type << ",\n};\n";
        }
    } else if (plan.update.record_mode) {
        out << "struct State {\n";
        for (const auto& field_desc : plan.update.state_fields) {
            out << "  " << field_desc.name << ": " << field_wgsl_type(field_desc) << ",\n";
        }
        out << "};\n";
        out << "struct Input {\n";
        for (const auto& field_desc : plan.update.input_fields) {
            out << "  " << field_desc.name << ": " << field_wgsl_type(field_desc) << ",\n";
        }
        out << "};\n";
    } else {
        out << "struct State {\n  value: " << scalar_type << ",\n};\n";
        out << "struct Input {\n  value: " << scalar_type << ",\n};\n";
    }
    out << "@group(0) @binding(0) var<storage, read_write> state: State;\n";
    out << "@group(0) @binding(1) var<storage, read> input: Input;\n";
    for (const auto& binding : plan.bindings) {
        if (binding.kind == Binding::Kind::I32) {
            out << "const " << binding.name << ": i32 = " << binding.i32_value << ";\n";
        } else if (binding.kind == Binding::Kind::I32Array) {
            out << "const " << binding.name << ": array<i32, " << binding.i32_array_values.size() << "> = array<i32, " << binding.i32_array_values.size() << ">(";
            for (std::size_t i = 0; i < binding.i32_array_values.size(); ++i) {
                if (i > 0) {
                    out << ", ";
                }
                out << binding.i32_array_values[i];
            }
            out << ");\n";
        } else if (binding.kind == Binding::Kind::F64) {
            out << "const " << binding.name << ": f32 = " << static_cast<float>(binding.f64_value) << ";\n";
        } else if (binding.kind == Binding::Kind::F64Array) {
            out << "const " << binding.name << ": array<f32, " << binding.f64_array_values.size() << "> = array<f32, " << binding.f64_array_values.size() << ">(";
            for (std::size_t i = 0; i < binding.f64_array_values.size(); ++i) {
                if (i > 0) {
                    out << ", ";
                }
                out << static_cast<float>(binding.f64_array_values[i]);
            }
            out << ");\n";
        }
    }
    out << "@compute @workgroup_size(1)\n";
    out << "fn vkf_update() {\n";
    if (plan.update.axis_vector_mode) {
        for (std::size_t i = 0; i < plan.update.axis_vector_length; ++i) {
            out << "  let next_value_" << i << ": " << axis_scalar_type << " = "
                << emit_expr(plan.update.scalar_expr, plan, "state", "input", std::to_string(i)) << ";\n";
        }
        for (std::size_t i = 0; i < plan.update.axis_vector_length; ++i) {
            out << "  state.values[" << i << "] = next_value_" << i << ";\n";
        }
    } else if (plan.update.record_mode) {
        for (const auto& field_expr : plan.update.record_fields) {
            const FieldDesc* target_field = find_field_desc(plan.update.state_fields, field_expr.first);
            if (target_field == nullptr) {
                throw WebGpuArtifactFailure("unknown record result field " + field_expr.first);
            }
            if (target_field->axis_length > 0) {
                for (std::size_t i = 0; i < target_field->axis_length; ++i) {
                    out << "  let next_" << field_expr.first << "_" << i << ": " << field_wgsl_scalar_type(*target_field) << " = "
                        << emit_expr(field_expr.second, plan, "state", "input", std::to_string(i), is_float_field(*target_field)) << ";\n";
                }
            } else {
                out << "  let next_" << field_expr.first << ": " << field_wgsl_scalar_type(*target_field) << " = "
                    << emit_expr(field_expr.second, plan, "state", "input", "", is_float_field(*target_field)) << ";\n";
            }
        }
        for (const auto& field_expr : plan.update.record_fields) {
            const FieldDesc* target_field = find_field_desc(plan.update.state_fields, field_expr.first);
            if (target_field == nullptr) {
                throw WebGpuArtifactFailure("unknown record result field " + field_expr.first);
            }
            if (target_field->axis_length > 0) {
                for (std::size_t i = 0; i < target_field->axis_length; ++i) {
                    out << "  state." << field_expr.first << "[" << i << "] = next_" << field_expr.first << "_" << i << ";\n";
                }
            } else {
                out << "  state." << field_expr.first << " = next_" << field_expr.first << ";\n";
            }
        }
    } else {
        out << "  let next_value: " << scalar_type << " = " << emit_expr(plan.update.scalar_expr, plan, "state", "input") << ";\n";
        out << "  state.value = next_value;\n";
    }
    out << "}\n";
    return out.str();
}

vf::JsonValue::Object manifest_payload(
    const std::filesystem::path& source,
    const std::string& source_hash,
    const std::string& typed_ir_hash,
    const std::string& artifact_hash,
    const std::vector<Dependency>& dependencies,
    const std::filesystem::path& artifact_path,
    const std::string& status,
    const ModulePlan& plan
) {
    vf::JsonValue::Object manifest;
    manifest["artifact_kind"] = vf::JsonValue("webgpu-wgsl");
    manifest["artifact_path"] = vf::JsonValue(artifact_path.string());
    manifest["compiler_version"] = vf::JsonValue(compiler_version);
    manifest["source_path"] = vf::JsonValue(std::filesystem::absolute(source).string());
    manifest["source_sha256"] = vf::JsonValue(source_hash);
    manifest["status"] = vf::JsonValue(status);
    manifest["typed_ir_sha256"] = vf::JsonValue(typed_ir_hash);
    manifest["artifact_content_sha256"] = vf::JsonValue(artifact_hash);
    manifest["runtime_hash"] = vf::JsonValue(artifact_hash);
    manifest["shader_entry"] = vf::JsonValue("vkf_update");
    manifest["workgroup_size"] = vf::JsonValue(1.0);
    vf::JsonValue::Array deps;
    for (const auto& dependency : dependencies) {
        vf::JsonValue::Object dep;
        dep["name"] = vf::JsonValue(dependency.name);
        dep["path"] = vf::JsonValue(std::filesystem::absolute(dependency.path).string());
        dep["sha256"] = vf::JsonValue(dependency.hash);
        deps.push_back(vf::JsonValue(std::move(dep)));
    }
    manifest["dependencies"] = vf::JsonValue(std::move(deps));
    vf::JsonValue::Object runtime_surface;
    runtime_surface["update_mode"] = vf::JsonValue(
        plan.update.axis_vector_mode ? (plan.update.axis_input_vector ? "axis_vector_vector" : "axis_vector_scalar") : (plan.update.record_mode ? "record" : "scalar")
    );
    runtime_surface["state_binding"] = vf::JsonValue(0.0);
    runtime_surface["input_binding"] = vf::JsonValue(1.0);
    vf::JsonValue::Array binding_exports;
    for (const auto& binding : plan.bindings) {
        vf::JsonValue::Object item;
        item["name"] = vf::JsonValue(binding.name);
        if (binding.kind == Binding::Kind::I32Array) {
            item["kind"] = vf::JsonValue("axis_i32_array");
            item["axis_key"] = vf::JsonValue(binding.axis_key);
            vf::JsonValue::Array values;
            for (std::int32_t value : binding.i32_array_values) {
                values.push_back(vf::JsonValue(static_cast<double>(value)));
            }
            item["values"] = vf::JsonValue(std::move(values));
        } else if (binding.kind == Binding::Kind::F64Array) {
            item["kind"] = vf::JsonValue("axis_f64_array");
            item["axis_key"] = vf::JsonValue(binding.axis_key);
            vf::JsonValue::Array values;
            for (double value : binding.f64_array_values) {
                values.push_back(vf::JsonValue(value));
            }
            item["values"] = vf::JsonValue(std::move(values));
        } else if (binding.kind == Binding::Kind::F64) {
            item["kind"] = vf::JsonValue("f64_const");
            item["value"] = vf::JsonValue(binding.f64_value);
        } else {
            item["kind"] = vf::JsonValue("i32_const");
            item["value"] = vf::JsonValue(static_cast<double>(binding.i32_value));
        }
        binding_exports.push_back(vf::JsonValue(std::move(item)));
    }
    runtime_surface["bindings"] = vf::JsonValue(std::move(binding_exports));
    if (plan.update.axis_vector_mode) {
        runtime_surface["state_axis_key"] = vf::JsonValue(plan.update.axis_key);
        runtime_surface["state_axis_length"] = vf::JsonValue(static_cast<double>(plan.update.axis_vector_length));
        runtime_surface["input_axis_key"] = vf::JsonValue(plan.update.axis_input_vector ? plan.update.axis_key : "");
        runtime_surface["input_axis_length"] = vf::JsonValue(static_cast<double>(plan.update.axis_input_vector ? plan.update.axis_vector_length : 1));
        vf::JsonValue::Array state_fields;
        vf::JsonValue::Object state_field;
        state_field["name"] = vf::JsonValue("values");
        state_field["offset"] = vf::JsonValue(0.0);
        state_field["type"] = vf::JsonValue(
            plan.update.axis_float_mode
                ? ("axis<" + plan.update.axis_key + ">:list<f32>")
                : ("axis<" + plan.update.axis_key + ">:list<num>")
        );
        state_field["axis_key"] = vf::JsonValue(plan.update.axis_key);
        state_field["axis_length"] = vf::JsonValue(static_cast<double>(plan.update.axis_vector_length));
        if (plan.update.axis_float_mode) {
            state_field["storage"] = vf::JsonValue("f32");
        }
        state_fields.push_back(vf::JsonValue(std::move(state_field)));
        runtime_surface["state_fields"] = vf::JsonValue(std::move(state_fields));
        vf::JsonValue::Array input_fields;
        vf::JsonValue::Object input_field;
        input_field["name"] = vf::JsonValue(plan.update.axis_input_vector ? "values" : "value");
        input_field["offset"] = vf::JsonValue(0.0);
        input_field["type"] = vf::JsonValue(
            plan.update.axis_input_vector
                ? (plan.update.axis_float_mode
                    ? ("axis<" + plan.update.axis_key + ">:list<f32>")
                    : ("axis<" + plan.update.axis_key + ">:list<num>"))
                : (plan.update.axis_float_mode ? "f32" : "num")
        );
        if (plan.update.axis_input_vector) {
            input_field["axis_key"] = vf::JsonValue(plan.update.axis_key);
            input_field["axis_length"] = vf::JsonValue(static_cast<double>(plan.update.axis_vector_length));
        }
        if (plan.update.axis_float_mode) {
            input_field["storage"] = vf::JsonValue("f32");
        }
        input_fields.push_back(vf::JsonValue(std::move(input_field)));
        runtime_surface["input_fields"] = vf::JsonValue(std::move(input_fields));
    } else if (plan.update.record_mode) {
        vf::JsonValue::Array state_fields;
        for (const auto& field_info : plan.update.state_fields) {
            vf::JsonValue::Object field_desc;
            field_desc["name"] = vf::JsonValue(field_info.name);
            field_desc["offset"] = vf::JsonValue(static_cast<double>(field_info.offset));
            field_desc["type"] = vf::JsonValue(field_info.type);
            if (is_float_field(field_info)) {
                field_desc["storage"] = vf::JsonValue("f32");
            }
            if (!field_info.axis_key.empty()) {
                field_desc["axis_key"] = vf::JsonValue(field_info.axis_key);
                field_desc["axis_length"] = vf::JsonValue(static_cast<double>(field_info.axis_length));
            }
            state_fields.push_back(vf::JsonValue(std::move(field_desc)));
        }
        vf::JsonValue::Array input_fields;
        for (const auto& field_info : plan.update.input_fields) {
            vf::JsonValue::Object field_desc;
            field_desc["name"] = vf::JsonValue(field_info.name);
            field_desc["offset"] = vf::JsonValue(static_cast<double>(field_info.offset));
            field_desc["type"] = vf::JsonValue(field_info.type);
            if (is_float_field(field_info)) {
                field_desc["storage"] = vf::JsonValue("f32");
            }
            if (!field_info.axis_key.empty()) {
                field_desc["axis_key"] = vf::JsonValue(field_info.axis_key);
                field_desc["axis_length"] = vf::JsonValue(static_cast<double>(field_info.axis_length));
            }
            input_fields.push_back(vf::JsonValue(std::move(field_desc)));
        }
        runtime_surface["state_fields"] = vf::JsonValue(std::move(state_fields));
        runtime_surface["input_fields"] = vf::JsonValue(std::move(input_fields));
    } else {
        vf::JsonValue::Array state_fields;
        vf::JsonValue::Object state_value;
        state_value["name"] = vf::JsonValue("value");
        state_value["offset"] = vf::JsonValue(0.0);
        state_value["type"] = vf::JsonValue(plan.update.scalar_float_mode ? "f32" : "num");
        if (plan.update.scalar_float_mode) {
            state_value["storage"] = vf::JsonValue("f32");
        }
        state_fields.push_back(vf::JsonValue(std::move(state_value)));
        vf::JsonValue::Array input_fields;
        vf::JsonValue::Object input_value;
        input_value["name"] = vf::JsonValue("value");
        input_value["offset"] = vf::JsonValue(0.0);
        input_value["type"] = vf::JsonValue(plan.update.scalar_float_mode ? "f32" : "num");
        if (plan.update.scalar_float_mode) {
            input_value["storage"] = vf::JsonValue("f32");
        }
        input_fields.push_back(vf::JsonValue(std::move(input_value)));
        runtime_surface["state_fields"] = vf::JsonValue(std::move(state_fields));
        runtime_surface["input_fields"] = vf::JsonValue(std::move(input_fields));
    }
    manifest["runtime_surface"] = vf::JsonValue(std::move(runtime_surface));
    return manifest;
}

std::string manifest_key(
    const std::string& source_hash,
    const std::string& typed_ir_hash,
    const std::string& artifact_hash,
    const std::vector<Dependency>& dependencies,
    const std::filesystem::path& artifact_path
) {
    std::string out = std::string(compiler_version) + "\n" + source_hash + "\n" + typed_ir_hash + "\n"
        + artifact_hash + "\n" + artifact_path.string();
    for (const auto& dependency : dependencies) {
        out += "\n" + dependency.name + "\n" + std::filesystem::absolute(dependency.path).string() + "\n" + dependency.hash;
    }
    return out;
}

std::string existing_manifest_hash(const std::filesystem::path& manifest_path) {
    if (!std::filesystem::exists(manifest_path)) {
        return "";
    }
    try {
        const auto manifest = object_of(vf::parse_json(read_file(manifest_path)), "manifest");
        const auto found = manifest.find("manifest_hash");
        if (found == manifest.end() || !found->second.is_string()) {
            return "";
        }
        return found->second.as_string();
    } catch (const std::exception&) {
        return "";
    }
}

struct Args {
    std::filesystem::path source;
    std::filesystem::path typed_ir;
    std::vector<std::pair<std::string, std::filesystem::path>> dependencies;
};

Args parse_args(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--source" && i + 1 < argc) {
            args.source = argv[++i];
            continue;
        }
        if (arg == "--typed-ir" && i + 1 < argc) {
            args.typed_ir = argv[++i];
            continue;
        }
        if (arg == "--dependency" && i + 1 < argc) {
            const std::string spec = argv[++i];
            const std::size_t eq = spec.find('=');
            if (eq == std::string::npos || eq == 0 || eq + 1 >= spec.size()) {
                throw WebGpuArtifactFailure("dependency must be name=path");
            }
            args.dependencies.push_back({spec.substr(0, eq), spec.substr(eq + 1)});
            continue;
        }
        throw WebGpuArtifactFailure("usage: vkf_webgpu_artifact_smoke --source <file.vkf> --typed-ir <file.json>");
    }
    if (args.source.empty() || args.typed_ir.empty()) {
        throw WebGpuArtifactFailure("usage: vkf_webgpu_artifact_smoke --source <file.vkf> --typed-ir <file.json>");
    }
    return args;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
        const std::string source_text = read_file(args.source);
        const std::string typed_ir_text = read_file(args.typed_ir);
        const vf::JsonValue typed_ir = vf::parse_json(typed_ir_text);
        const ModulePlan plan = collect_module_plan(typed_ir);
        const std::string wgsl = emit_wgsl(plan);

        const std::string source_hash = stable_hash(source_text);
        const std::string typed_ir_hash = stable_hash(typed_ir_text);
        const std::string artifact_hash = stable_hash(wgsl);
        std::vector<Dependency> dependencies;
        for (const auto& dependency : args.dependencies) {
            dependencies.push_back({dependency.first, dependency.second, stable_hash(read_file(dependency.second))});
        }

        const auto build_dir = repo_root_from_source(args.source) / ".vkfbuild" / stem_of(args.source);
        const auto manifest_path = build_dir / "webgpu-manifest.json";
        const auto artifact_path = build_dir / (stem_of(args.source) + ".artifact.wgsl");
        const std::string desired_manifest_hash = stable_hash(
            manifest_key(source_hash, typed_ir_hash, artifact_hash, dependencies, artifact_path)
        );

        std::filesystem::create_directories(build_dir);
        std::string status = "compiled";
        const bool artifact_current = std::filesystem::exists(artifact_path)
            && stable_hash(read_file(artifact_path)) == artifact_hash;
        if (existing_manifest_hash(manifest_path) == desired_manifest_hash && artifact_current) {
            status = "current";
        } else {
            write_text(artifact_path, wgsl);
        }

        auto manifest = manifest_payload(
            args.source,
            source_hash,
            typed_ir_hash,
            artifact_hash,
            dependencies,
            artifact_path,
            status,
            plan
        );
        manifest["manifest_hash"] = vf::JsonValue(desired_manifest_hash);
        write_text(manifest_path, vf::json_stringify(vf::JsonValue(std::move(manifest)), 2) + "\n");

        vf::JsonValue::Object result;
        result["artifact_kind"] = vf::JsonValue("webgpu-wgsl");
        result["artifact_path"] = vf::JsonValue(artifact_path.string());
        result["manifest_path"] = vf::JsonValue(manifest_path.string());
        result["status"] = vf::JsonValue(status);
        std::cout << vf::json_stringify(vf::JsonValue(std::move(result)), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<webgpu-artifact-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
