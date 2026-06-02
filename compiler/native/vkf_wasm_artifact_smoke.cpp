#include "native/VfOverlay/vf/json.hpp"

#include <cstdint>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr const char* compiler_version = "vkf-wasm-artifact-smoke-0.1";

class WasmArtifactFailure : public std::runtime_error {
public:
    explicit WasmArtifactFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Dependency {
    std::string name;
    std::filesystem::path path;
    std::string hash;
};

struct WasmBinding {
    std::string name;
    enum class Kind {
        I32,
        F64,
        String,
        I32Array,
        F64Array,
    } kind;
    std::int32_t i32_value = 0;
    double f64_value = 0.0;
    std::string string_value;
    std::vector<std::int32_t> i32_array_values;
    std::vector<double> f64_array_values;
    std::string axis_key;
    std::uint32_t string_offset = 0;
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
    std::string axis_key;
    std::size_t axis_length = 0;
    std::uint32_t offset = 0;
};

struct UpdateFunctionPlan {
    bool enabled = false;
    bool record_mode = false;
    bool axis_vector_mode = false;
    bool axis_input_vector = false;
    bool axis_float_mode = false;
    std::string axis_key;
    std::size_t axis_vector_length = 0;
    std::vector<std::int32_t> axis_seed_values;
    std::vector<double> axis_seed_numeric_values;
    std::vector<FieldDesc> state_fields;
    std::vector<FieldDesc> input_fields;
    UpdateExpr scalar_expr{UpdateExpr::Kind::ConstI32};
    std::vector<std::pair<std::string, UpdateExpr>> record_fields;
};

struct WasmModulePlan {
    std::vector<WasmBinding> bindings;
    UpdateFunctionPlan update;
};

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw WasmArtifactFailure("expected object for " + context);
    }
    return value.as_object();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) {
        throw WasmArtifactFailure("expected array for " + context);
    }
    return value.as_array();
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw WasmArtifactFailure("missing field " + name + " in " + context);
    }
    return found->second;
}

std::string string_field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const vf::JsonValue& value = field(object, name, context);
    if (!value.is_string()) {
        throw WasmArtifactFailure("expected string field " + name + " in " + context);
    }
    return value.as_string();
}

std::int32_t checked_i32(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_number()) {
        throw WasmArtifactFailure("expected numeric value for " + context);
    }
    const double raw = value.as_number();
    const double integral = static_cast<double>(static_cast<std::int32_t>(raw));
    if (raw != integral || raw < static_cast<double>(std::numeric_limits<std::int32_t>::min())
        || raw > static_cast<double>(std::numeric_limits<std::int32_t>::max())) {
        throw WasmArtifactFailure("expected i32-compatible numeric value for " + context);
    }
    return static_cast<std::int32_t>(raw);
}

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw WasmArtifactFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_bytes(const std::filesystem::path& path, const std::vector<std::uint8_t>& bytes) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw WasmArtifactFailure("could not write " + path.string());
    }
    output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
}

void write_text(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw WasmArtifactFailure("could not write " + path.string());
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

std::string stable_hash_bytes(const std::vector<std::uint8_t>& bytes) {
    std::uint64_t hash = 1469598103934665603ull;
    for (std::uint8_t byte : bytes) {
        hash ^= byte;
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

std::string sanitize_export_suffix(const std::string& name) {
    std::string out;
    out.reserve(name.size());
    for (unsigned char ch : name) {
        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
            out.push_back(static_cast<char>(ch));
        } else {
            out.push_back('_');
        }
    }
    if (out.empty()) {
        return "value";
    }
    return out;
}

void append_u8(std::vector<std::uint8_t>& out, std::uint8_t value) {
    out.push_back(value);
}

void append_bytes(std::vector<std::uint8_t>& out, const std::vector<std::uint8_t>& bytes) {
    out.insert(out.end(), bytes.begin(), bytes.end());
}

void append_string(std::vector<std::uint8_t>& out, const std::string& text) {
    std::uint32_t value = static_cast<std::uint32_t>(text.size());
    do {
        std::uint8_t byte = static_cast<std::uint8_t>(value & 0x7Fu);
        value >>= 7u;
        if (value != 0) {
            byte |= 0x80u;
        }
        out.push_back(byte);
    } while (value != 0);
    out.insert(out.end(), text.begin(), text.end());
}

void append_u32_leb(std::vector<std::uint8_t>& out, std::uint32_t value) {
    do {
        std::uint8_t byte = static_cast<std::uint8_t>(value & 0x7Fu);
        value >>= 7u;
        if (value != 0) {
            byte |= 0x80u;
        }
        out.push_back(byte);
    } while (value != 0);
}

void append_i32_leb(std::vector<std::uint8_t>& out, std::int32_t value) {
    bool more = true;
    while (more) {
        std::uint8_t byte = static_cast<std::uint8_t>(value & 0x7F);
        value >>= 7;
        const bool sign_bit = (byte & 0x40u) != 0;
        more = !((value == 0 && !sign_bit) || (value == -1 && sign_bit));
        if (more) {
            byte |= 0x80u;
        }
        out.push_back(byte);
    }
}

void append_f64(std::vector<std::uint8_t>& out, double value) {
    std::uint64_t bits = 0;
    static_assert(sizeof(double) == sizeof(std::uint64_t), "double must be 64-bit");
    std::memcpy(&bits, &value, sizeof(bits));
    for (int i = 0; i < 8; ++i) {
        out.push_back(static_cast<std::uint8_t>((bits >> (8 * i)) & 0xFFu));
    }
}

void append_section(std::vector<std::uint8_t>& module, std::uint8_t id, const std::vector<std::uint8_t>& payload) {
    append_u8(module, id);
    append_u32_leb(module, static_cast<std::uint32_t>(payload.size()));
    append_bytes(module, payload);
}

const WasmBinding* find_binding(const std::vector<WasmBinding>& bindings, const std::string& name) {
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

const EvaluatedBindingValue binding_to_evaluated_value(const WasmBinding& binding) {
    EvaluatedBindingValue out;
    if (binding.kind == WasmBinding::Kind::I32) {
        out.scalar_value = static_cast<double>(binding.i32_value);
        return out;
    }
    if (binding.kind == WasmBinding::Kind::F64) {
        out.scalar_value = binding.f64_value;
        return out;
    }
    if (binding.kind == WasmBinding::Kind::I32Array) {
        out.is_array = true;
        out.axis_key = binding.axis_key;
        out.array_values.reserve(binding.i32_array_values.size());
        for (std::int32_t value : binding.i32_array_values) {
            out.array_values.push_back(static_cast<double>(value));
        }
        return out;
    }
    if (binding.kind == WasmBinding::Kind::F64Array) {
        out.is_array = true;
        out.axis_key = binding.axis_key;
        out.array_values = binding.f64_array_values;
        return out;
    }
    throw WasmArtifactFailure("unsupported binding kind for numeric evaluation");
}

EvaluatedBindingValue apply_binary_binding_op(
    const std::string& op,
    const EvaluatedBindingValue& left,
    const EvaluatedBindingValue& right
) {
    auto apply_scalar = [&op](double lhs, double rhs) -> double {
        if (op == "PLUS") {
            return lhs + rhs;
        }
        if (op == "MINUS") {
            return lhs - rhs;
        }
        if (op == "STAR") {
            return lhs * rhs;
        }
        throw WasmArtifactFailure("wasm computed binding only supports PLUS, MINUS, and STAR");
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
            throw WasmArtifactFailure("wasm computed binding only supports same-axis vector arithmetic");
        }
        out.axis_key = left.axis_key;
        out.array_values.reserve(left.array_values.size());
        for (std::size_t i = 0; i < left.array_values.size(); ++i) {
            out.array_values.push_back(apply_scalar(left.array_values[i], right.array_values[i]));
        }
        return out;
    }
    const EvaluatedBindingValue& array_side = left.is_array ? left : right;
    const EvaluatedBindingValue& scalar_side = left.is_array ? right : left;
    out.axis_key = array_side.axis_key;
    out.array_values.reserve(array_side.array_values.size());
    for (double value : array_side.array_values) {
        out.array_values.push_back(
            left.is_array
                ? apply_scalar(value, scalar_side.scalar_value)
                : apply_scalar(scalar_side.scalar_value, value)
        );
    }
    return out;
}

EvaluatedBindingValue evaluate_binding_value(
    const vf::JsonValue& value,
    const std::vector<WasmBinding>& bindings
) {
    const auto& object = object_of(value, "computed binding");
    const std::string kind = string_field(object, "kind", "computed binding");
    if (kind == "const") {
        const vf::JsonValue& const_value = field(object, "value", "const");
        if (!const_value.is_number() && !const_value.is_boolean()) {
            throw WasmArtifactFailure("wasm computed binding const must be numeric or boolean");
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
            throw WasmArtifactFailure("wasm axis_align binding requires a list value");
        }
        for (const auto& item_value : array_of(field(inner, "items", "list"), "list.items")) {
            const EvaluatedBindingValue item = evaluate_binding_value(item_value, bindings);
            if (item.is_array) {
                throw WasmArtifactFailure("wasm axis_align binding only supports scalar items");
            }
            out.array_values.push_back(item.scalar_value);
        }
        return out;
    }
    if (kind == "load") {
        const std::string name = string_field(object, "name", "load");
        const WasmBinding* binding = find_binding(bindings, name);
        if (binding == nullptr) {
            throw WasmArtifactFailure("unknown binding " + name + " in computed wasm binding");
        }
        if (binding->kind == WasmBinding::Kind::String) {
            throw WasmArtifactFailure("wasm computed binding does not support string arithmetic");
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
        if (string_field(callee, "kind", "call.callee") != "field_access") {
            throw WasmArtifactFailure("wasm computed binding only supports stdlib math field access calls");
        }
        const std::string field_name = string_field(callee, "field", "call.callee");
        const auto& base = object_of(field(callee, "object", "call.callee.object"), "call.callee.object");
        if (string_field(base, "kind", "call.callee.object") != "load"
            || string_field(base, "name", "call.callee.object") != "math") {
            throw WasmArtifactFailure("wasm computed binding only supports math intrinsic calls");
        }
        const auto& args = array_of(field(object, "args", "call"), "call.args");
        if (args.size() != 1 || (field_name != "sin" && field_name != "cos")) {
            throw WasmArtifactFailure("wasm computed binding only supports unary math.sin/math.cos");
        }
        const EvaluatedBindingValue arg = evaluate_binding_value(args[0], bindings);
        auto apply_intrinsic = [&field_name](double value) -> double {
            return field_name == "sin" ? std::sin(value) : std::cos(value);
        };
        if (!arg.is_array) {
            EvaluatedBindingValue out;
            out.scalar_value = apply_intrinsic(arg.scalar_value);
            return out;
        }
        EvaluatedBindingValue out;
        out.is_array = true;
        out.axis_key = arg.axis_key;
        out.array_values.reserve(arg.array_values.size());
        for (double value : arg.array_values) {
            out.array_values.push_back(apply_intrinsic(value));
        }
        return out;
    }
    throw WasmArtifactFailure("unsupported computed wasm binding kind " + kind);
}

WasmBinding binding_from_store(const vf::JsonValue::Object& stmt, const std::vector<WasmBinding>& bindings) {
    WasmBinding binding;
    binding.name = string_field(stmt, "name", "store_binding");
    const auto& value = field(stmt, "value", "store_binding");
    const auto& value_object = object_of(value, "store_binding.value");
    if (string_field(value_object, "kind", "store_binding.value") == "const") {
        const vf::JsonValue& const_value = field(value_object, "value", "const");
        if (const_value.is_string()) {
            binding.kind = WasmBinding::Kind::String;
            binding.string_value = const_value.as_string();
            return binding;
        }
    }
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
            binding.kind = WasmBinding::Kind::I32Array;
            for (double item : evaluated.array_values) {
                binding.i32_array_values.push_back(static_cast<std::int32_t>(item));
            }
        } else {
            binding.kind = WasmBinding::Kind::F64Array;
            binding.f64_array_values = evaluated.array_values;
        }
        return binding;
    }
    if (is_i32_compatible(evaluated.scalar_value)) {
        binding.kind = WasmBinding::Kind::I32;
        binding.i32_value = static_cast<std::int32_t>(evaluated.scalar_value);
        return binding;
    }
    binding.kind = WasmBinding::Kind::F64;
    binding.f64_value = evaluated.scalar_value;
    return binding;
}

bool parse_axis_vector_type(
    const std::string& type_name,
    std::string& axis_key,
    std::string& value_type
);

const WasmBinding* find_axis_seed_binding(const std::vector<WasmBinding>& bindings, const std::string& axis_key);

std::size_t binding_array_length(const WasmBinding& binding) {
    if (binding.kind == WasmBinding::Kind::I32Array) {
        return binding.i32_array_values.size();
    }
    if (binding.kind == WasmBinding::Kind::F64Array) {
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
    const std::vector<WasmBinding>& bindings
) {
    const std::string prefix = "record{";
    if (type_name.rfind(prefix, 0) != 0 || type_name.empty() || type_name.back() != '}') {
        throw WasmArtifactFailure(context + " must be a record{...} type");
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
            throw WasmArtifactFailure("malformed record field in " + context);
        }
        const std::string name = part.substr(0, colon);
        const std::string field_type = part.substr(colon + 1);
        FieldDesc field_desc;
        field_desc.name = name;
        field_desc.type = field_type;
        field_desc.offset = next_offset;
        if (field_type == "num") {
            next_offset += 4;
        } else {
            std::string axis_key;
            std::string value_type;
            if (!parse_axis_vector_type(field_type, axis_key, value_type) || value_type != "list<num>") {
                throw WasmArtifactFailure(context + " only supports num fields or axis<k>:list<num> fields");
            }
            const WasmBinding* seed = find_axis_seed_binding(bindings, axis_key);
            if (seed == nullptr) {
                throw WasmArtifactFailure(context + " axis-vector fields require an axis-aligned const binding seed");
            }
            field_desc.axis_key = axis_key;
            field_desc.axis_length = binding_array_length(*seed);
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

const WasmBinding* find_axis_seed_binding(const std::vector<WasmBinding>& bindings, const std::string& axis_key) {
    for (const auto& binding : bindings) {
        if ((binding.kind == WasmBinding::Kind::I32Array || binding.kind == WasmBinding::Kind::F64Array)
            && binding.axis_key == axis_key) {
            return &binding;
        }
    }
    return nullptr;
}

UpdateExpr parse_update_expr(
    const vf::JsonValue& value,
    const std::vector<WasmBinding>& bindings,
    const std::vector<FieldDesc>* state_fields,
    const std::vector<FieldDesc>* input_fields
) {
    const auto& object = object_of(value, "wasm update expr");
    const std::string kind = string_field(object, "kind", "wasm update expr");
    if (kind == "const") {
        const vf::JsonValue& const_value = field(object, "value", "const");
        if (!const_value.is_number()) {
            throw WasmArtifactFailure("wasm update expr only supports numeric const values");
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
        const WasmBinding* binding = find_binding(bindings, name);
        if (binding != nullptr) {
            if (binding->kind == WasmBinding::Kind::I32Array || binding->kind == WasmBinding::Kind::F64Array) {
                UpdateExpr out{UpdateExpr::Kind::LoadBindingAxisElem};
                out.binding_name = name;
                return out;
            }
            if (binding->kind == WasmBinding::Kind::I32 || binding->kind == WasmBinding::Kind::F64) {
                UpdateExpr out{UpdateExpr::Kind::LoadBinding};
                out.binding_name = name;
                return out;
            }
            throw WasmArtifactFailure("wasm update expr only supports numeric const bindings and axis-aligned numeric bindings");
        }
        throw WasmArtifactFailure("wasm update expr only supports load(state), load(input), or numeric const bindings");
    }
    if (kind == "field_access") {
        const auto& base = object_of(field(object, "object", "field_access.object"), "field_access.object");
        const std::string base_kind = string_field(base, "kind", "field_access.object");
        if (base_kind != "load") {
            throw WasmArtifactFailure("wasm field_access only supports load(state) or load(input)");
        }
        const std::string base_name = string_field(base, "name", "field_access.object");
        const std::string field_name = string_field(object, "field", "field_access");
        if (base_name == "state" && state_fields != nullptr) {
            if (find_field_desc(*state_fields, field_name) == nullptr) {
                throw WasmArtifactFailure("unknown field " + field_name + " in state");
            }
            UpdateExpr out{UpdateExpr::Kind::LoadStateField};
            out.binding_name = field_name;
            return out;
        }
        if (base_name == "input" && input_fields != nullptr) {
            if (find_field_desc(*input_fields, field_name) == nullptr) {
                throw WasmArtifactFailure("unknown field " + field_name + " in input");
            }
            UpdateExpr out{UpdateExpr::Kind::LoadInputField};
            out.binding_name = field_name;
            return out;
        }
        throw WasmArtifactFailure("wasm field_access only supports declared state/input record fields");
    }
    if (kind == "binary_op") {
        UpdateExpr out{UpdateExpr::Kind::BinaryOp};
        out.op = string_field(object, "op", "binary_op");
        out.args.push_back(parse_update_expr(field(object, "left", "binary_op.left"), bindings, state_fields, input_fields));
        out.args.push_back(parse_update_expr(field(object, "right", "binary_op.right"), bindings, state_fields, input_fields));
        if (out.op != "PLUS" && out.op != "MINUS" && out.op != "STAR") {
            throw WasmArtifactFailure("wasm update expr only supports PLUS, MINUS, and STAR");
        }
        return out;
    }
    throw WasmArtifactFailure("unsupported wasm update expr kind " + kind);
}

bool parse_update_function(const vf::JsonValue::Object& stmt, const std::vector<WasmBinding>& bindings, UpdateFunctionPlan& out_plan) {
    if (string_field(stmt, "kind", "typed IR stmt") != "function") {
        return false;
    }
    if (string_field(stmt, "name", "function") != "vkf_update") {
        return false;
    }
    const auto& params = array_of(field(stmt, "params", "function"), "function.params");
    if (params.size() != 2) {
        throw WasmArtifactFailure("wasm vkf_update function must take exactly two params");
    }
    const auto& p0 = object_of(params[0], "function.param");
    const auto& p1 = object_of(params[1], "function.param");
    const std::string p0_name = string_field(p0, "name", "function.param");
    const std::string p1_name = string_field(p1, "name", "function.param");
    const std::string p0_type = string_field(p0, "type", "function.param");
    const std::string p1_type = string_field(p1, "type", "function.param");
    const std::string return_type = string_field(stmt, "return_type", "function");
    if (p0_name != "state") {
        throw WasmArtifactFailure("wasm vkf_update first param must be named state");
    }
    if (p1_name != "input") {
        throw WasmArtifactFailure("wasm vkf_update second param must be named input");
    }
    const auto& body = object_of(field(stmt, "body", "function"), "function.body");
    if (string_field(body, "kind", "function.body") != "block") {
        throw WasmArtifactFailure("wasm vkf_update body must be a block");
    }
    const auto& statements = array_of(field(body, "body", "function.body"), "function.body.body");
    if (statements.size() != 1) {
        throw WasmArtifactFailure("wasm vkf_update body must contain exactly one return");
    }
    const auto& only_stmt = object_of(statements[0], "function.body.stmt");
    if (string_field(only_stmt, "kind", "function.body.stmt") != "return") {
        throw WasmArtifactFailure("wasm vkf_update body must contain a return");
    }
    const vf::JsonValue& return_value = field(only_stmt, "value", "function.return");
    if (p0_type == "num" && p1_type == "num") {
        if (return_type != "num") {
            throw WasmArtifactFailure("wasm scalar vkf_update must return num");
        }
        out_plan.enabled = true;
        out_plan.record_mode = false;
        out_plan.scalar_expr = parse_update_expr(return_value, bindings, nullptr, nullptr);
        return true;
    }
    std::string axis_key;
    std::string axis_value_type;
    std::string input_axis_key;
    std::string input_axis_value_type;
    if (parse_axis_vector_type(p0_type, axis_key, axis_value_type)
        && (p1_type == "num" || parse_axis_vector_type(p1_type, input_axis_key, input_axis_value_type))) {
        if (return_type != p0_type || axis_value_type != "list<num>") {
            throw WasmArtifactFailure("wasm axis-vector vkf_update must return the state axis-vector type");
        }
        const WasmBinding* seed = find_axis_seed_binding(bindings, axis_key);
        if (seed == nullptr) {
            throw WasmArtifactFailure("wasm axis-vector vkf_update requires an axis-aligned const binding seed");
        }
        bool vector_input = false;
        if (p1_type != "num") {
            if (input_axis_key != axis_key || input_axis_value_type != "list<num>") {
                throw WasmArtifactFailure("wasm axis-vector vkf_update only supports matching axis-vector input");
            }
            vector_input = true;
        }
        out_plan.enabled = true;
        out_plan.axis_vector_mode = true;
        out_plan.axis_input_vector = vector_input;
        out_plan.axis_key = axis_key;
        out_plan.axis_float_mode = seed->kind == WasmBinding::Kind::F64Array;
        out_plan.axis_vector_length = binding_array_length(*seed);
        out_plan.axis_seed_numeric_values.clear();
        if (seed->kind == WasmBinding::Kind::I32Array) {
            out_plan.axis_seed_values = seed->i32_array_values;
            out_plan.axis_seed_numeric_values.reserve(seed->i32_array_values.size());
            for (std::int32_t value : seed->i32_array_values) {
                out_plan.axis_seed_numeric_values.push_back(static_cast<double>(value));
            }
        } else {
            out_plan.axis_seed_values.clear();
            out_plan.axis_seed_numeric_values = seed->f64_array_values;
        }
        out_plan.scalar_expr = parse_update_expr(return_value, bindings, nullptr, nullptr);
        return true;
    }
    if (p0_type.rfind("record{", 0) != 0 || p1_type.rfind("record{", 0) != 0) {
        throw WasmArtifactFailure("wasm vkf_update must use either num/num->num or matching record state/input types");
    }
    if (return_type != p0_type) {
        throw WasmArtifactFailure("wasm vkf_update record mode must return the state record type");
    }
    out_plan.enabled = true;
    out_plan.record_mode = true;
    out_plan.state_fields = parse_record_fields(p0_type, "wasm vkf_update state", bindings);
    out_plan.input_fields = parse_record_fields(p1_type, "wasm vkf_update input", bindings);
    const auto& returned = object_of(return_value, "wasm vkf_update return");
    if (string_field(returned, "kind", "wasm vkf_update return") != "record") {
        throw WasmArtifactFailure("wasm vkf_update record mode must return a record");
    }
    const auto& fields = array_of(field(returned, "fields", "record"), "record.fields");
    if (fields.size() != out_plan.state_fields.size()) {
        throw WasmArtifactFailure("wasm vkf_update record return must include every state field exactly once");
    }
    for (std::size_t i = 0; i < fields.size(); ++i) {
        const auto& field_object = object_of(fields[i], "record field");
        const std::string field_name = string_field(field_object, "name", "record field");
        if (field_name != out_plan.state_fields[i].name) {
            throw WasmArtifactFailure("wasm vkf_update record fields must match state field order");
        }
        out_plan.record_fields.push_back({
            field_name,
            parse_update_expr(field(field_object, "value", "record field"), bindings, &out_plan.state_fields, &out_plan.input_fields)
        });
    }
    return true;
}

WasmModulePlan collect_module_plan(const vf::JsonValue& root) {
    const auto& module = object_of(root, "typed IR module");
    const std::string kind = string_field(module, "kind", "typed IR module");
    if (kind != "typed_module") {
        throw WasmArtifactFailure("unsupported typed IR root kind " + kind);
    }
    WasmModulePlan plan;
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
                throw WasmArtifactFailure("only one wasm vkf_update function is supported");
            }
            if (parse_update_function(stmt, plan.bindings, plan.update)) {
                continue;
            }
        }
        throw WasmArtifactFailure("unsupported typed IR statement kind " + stmt_kind + " for wasm artifact emission");
    }
    return plan;
}

void emit_update_expr(
    std::vector<std::uint8_t>& body,
    const UpdateExpr& expr,
    const std::vector<WasmBinding>& bindings,
    std::uint32_t input_offset,
    const UpdateFunctionPlan* update_plan,
    std::int32_t axis_state_offset = 0,
    bool axis_element_context = false
) {
    const bool float_axis_mode = update_plan != nullptr && update_plan->axis_vector_mode && update_plan->axis_float_mode;
    if (expr.kind == UpdateExpr::Kind::ConstI32) {
        if (float_axis_mode) {
            append_u8(body, 0x44);
            append_f64(body, static_cast<double>(expr.i32_value));
        } else {
            append_u8(body, 0x41);
            append_i32_leb(body, expr.i32_value);
        }
        return;
    }
    if (expr.kind == UpdateExpr::Kind::ConstF64) {
        append_u8(body, 0x44);
        append_f64(body, expr.f64_value);
        return;
    }
    if (expr.kind == UpdateExpr::Kind::LoadState) {
        append_u8(body, 0x41);
        append_i32_leb(body, axis_state_offset);
        append_u8(body, float_axis_mode ? 0x2B : 0x28);
        append_u32_leb(body, float_axis_mode ? 3 : 2);
        append_u32_leb(body, 0);
        return;
    }
    if (expr.kind == UpdateExpr::Kind::LoadInput) {
        append_u8(body, 0x41);
        append_i32_leb(body, static_cast<std::int32_t>(input_offset + ((update_plan != nullptr && update_plan->axis_input_vector) ? axis_state_offset : 0)));
        append_u8(body, float_axis_mode ? 0x2B : 0x28);
        append_u32_leb(body, float_axis_mode ? 3 : 2);
        append_u32_leb(body, 0);
        return;
    }
    if (expr.kind == UpdateExpr::Kind::LoadStateField) {
        if (update_plan == nullptr || !update_plan->record_mode) {
            throw WasmArtifactFailure("state field load requires record-mode update plan");
        }
        const FieldDesc* field = find_field_desc(update_plan->state_fields, expr.binding_name);
        if (field == nullptr) {
            throw WasmArtifactFailure("unknown field " + expr.binding_name + " in state");
        }
        if (field->axis_length > 0 && !axis_element_context) {
            throw WasmArtifactFailure("axis-vector state field load requires axis element emission context");
        }
        append_u8(body, 0x41);
        append_i32_leb(body, static_cast<std::int32_t>(field->offset) + (field->axis_length > 0 ? axis_state_offset : 0));
        append_u8(body, float_axis_mode ? 0x2B : 0x28);
        append_u32_leb(body, float_axis_mode ? 3 : 2);
        append_u32_leb(body, 0);
        return;
    }
    if (expr.kind == UpdateExpr::Kind::LoadInputField) {
        if (update_plan == nullptr || !update_plan->record_mode) {
            throw WasmArtifactFailure("input field load requires record-mode update plan");
        }
        const FieldDesc* field = find_field_desc(update_plan->input_fields, expr.binding_name);
        if (field == nullptr) {
            throw WasmArtifactFailure("unknown field " + expr.binding_name + " in input");
        }
        if (field->axis_length > 0 && !axis_element_context) {
            throw WasmArtifactFailure("axis-vector input field load requires axis element emission context");
        }
        append_u8(body, 0x41);
        append_i32_leb(body, static_cast<std::int32_t>(input_offset + field->offset) + (field->axis_length > 0 ? axis_state_offset : 0));
        append_u8(body, float_axis_mode ? 0x2B : 0x28);
        append_u32_leb(body, float_axis_mode ? 3 : 2);
        append_u32_leb(body, 0);
        return;
    }
    if (expr.kind == UpdateExpr::Kind::LoadBinding) {
        const WasmBinding* binding = find_binding(bindings, expr.binding_name);
        if (binding == nullptr) {
            throw WasmArtifactFailure("wasm update binding load only supports numeric const bindings");
        }
        if (float_axis_mode) {
            append_u8(body, 0x44);
            if (binding->kind == WasmBinding::Kind::I32) {
                append_f64(body, static_cast<double>(binding->i32_value));
                return;
            }
            if (binding->kind == WasmBinding::Kind::F64) {
                append_f64(body, binding->f64_value);
                return;
            }
            throw WasmArtifactFailure("wasm float axis update binding load only supports numeric scalar const bindings");
        }
        if (binding->kind != WasmBinding::Kind::I32) {
            throw WasmArtifactFailure("wasm update binding load only supports i32 const bindings");
        }
        append_u8(body, 0x41);
        append_i32_leb(body, binding->i32_value);
        return;
    }
    if (expr.kind == UpdateExpr::Kind::LoadBindingAxisElem) {
        const WasmBinding* binding = find_binding(bindings, expr.binding_name);
        if (binding == nullptr) {
            throw WasmArtifactFailure("wasm update binding axis load only supports axis-aligned const bindings");
        }
        if (float_axis_mode && binding->kind != WasmBinding::Kind::F64Array) {
            throw WasmArtifactFailure("wasm float axis update binding axis load only supports axis-aligned f64 bindings");
        }
        if (!float_axis_mode && binding->kind != WasmBinding::Kind::I32Array) {
            throw WasmArtifactFailure("wasm update binding axis load only supports axis-aligned i32 bindings");
        }
        append_u8(body, 0x41);
        append_i32_leb(body, static_cast<std::int32_t>(binding->string_offset + static_cast<std::uint32_t>(axis_state_offset)));
        append_u8(body, float_axis_mode ? 0x2B : 0x28);
        append_u32_leb(body, float_axis_mode ? 3 : 2);
        append_u32_leb(body, 0);
        return;
    }
    if (expr.kind == UpdateExpr::Kind::BinaryOp) {
        emit_update_expr(body, expr.args[0], bindings, input_offset, update_plan, axis_state_offset, axis_element_context);
        emit_update_expr(body, expr.args[1], bindings, input_offset, update_plan, axis_state_offset, axis_element_context);
        if (expr.op == "PLUS") {
            append_u8(body, float_axis_mode ? 0xA0 : 0x6A);
            return;
        }
        if (expr.op == "MINUS") {
            append_u8(body, float_axis_mode ? 0xA1 : 0x6B);
            return;
        }
        if (expr.op == "STAR") {
            append_u8(body, float_axis_mode ? 0xA2 : 0x6C);
            return;
        }
    }
    throw WasmArtifactFailure("unsupported wasm update expr during emission");
}

std::vector<std::uint8_t> build_wasm_module(WasmModulePlan plan) {
    std::vector<WasmBinding>& bindings = plan.bindings;
    std::uint32_t next_offset = 0;
    for (auto& binding : bindings) {
        if (binding.kind == WasmBinding::Kind::String) {
            binding.string_offset = next_offset;
            next_offset += static_cast<std::uint32_t>(binding.string_value.size());
        } else if (binding.kind == WasmBinding::Kind::I32Array) {
            binding.string_offset = next_offset;
            next_offset += static_cast<std::uint32_t>(binding.i32_array_values.size() * 4);
        } else if (binding.kind == WasmBinding::Kind::F64Array) {
            binding.string_offset = next_offset;
            next_offset += static_cast<std::uint32_t>(binding.f64_array_values.size() * 8);
        }
    }

    std::vector<std::uint8_t> module = {0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00};

    std::vector<std::uint8_t> type_section;
    append_u32_leb(type_section, 3);
    append_u8(type_section, 0x60); append_u32_leb(type_section, 0); append_u32_leb(type_section, 0);
    append_u8(type_section, 0x60); append_u32_leb(type_section, 0); append_u32_leb(type_section, 1); append_u8(type_section, 0x7F);
    append_u8(type_section, 0x60); append_u32_leb(type_section, 0); append_u32_leb(type_section, 1); append_u8(type_section, 0x7C);
    append_section(module, 1, type_section);

    struct FunctionSpec {
        std::string export_name;
        std::uint32_t type_index;
        enum class BodyKind { Noop, ResetTick, IncrementTick, I32Const, F64Const } body_kind;
        std::int32_t i32_value = 0;
        double f64_value = 0.0;
    };

    std::vector<FunctionSpec> functions;
    const std::uint32_t axis_word_size = plan.update.axis_float_mode ? 8u : 4u;
    const std::uint32_t state_size = plan.update.axis_vector_mode
        ? static_cast<std::uint32_t>(plan.update.axis_vector_length * axis_word_size)
        : (plan.update.record_mode
        ? layout_size_bytes(plan.update.state_fields)
        : 8);  // tick:i32, wheel_accum:i32
    const std::uint32_t input_offset = state_size;
    const std::uint32_t input_size = plan.update.axis_vector_mode
        ? static_cast<std::uint32_t>((plan.update.axis_input_vector ? plan.update.axis_vector_length : 1) * axis_word_size)
        : (plan.update.record_mode
        ? layout_size_bytes(plan.update.input_fields)
        : 4);  // wheel_step:i32
    const std::uint32_t data_offset = input_offset + input_size;
    for (auto& binding : bindings) {
        if (binding.kind == WasmBinding::Kind::String
            || binding.kind == WasmBinding::Kind::I32Array
            || binding.kind == WasmBinding::Kind::F64Array) {
            binding.string_offset += data_offset;
        }
    }

    functions.push_back({"vkf_init", 0, FunctionSpec::BodyKind::ResetTick});
    functions.push_back({"vkf_update", 0, FunctionSpec::BodyKind::IncrementTick});
    functions.push_back({"vkf_shutdown", 0, FunctionSpec::BodyKind::Noop});
    functions.push_back({"vkf_state_ptr", 1, FunctionSpec::BodyKind::I32Const, 0});
    functions.push_back({"vkf_state_size", 1, FunctionSpec::BodyKind::I32Const, static_cast<std::int32_t>(state_size)});
    functions.push_back({"vkf_input_ptr", 1, FunctionSpec::BodyKind::I32Const, static_cast<std::int32_t>(input_offset)});
    functions.push_back({"vkf_input_size", 1, FunctionSpec::BodyKind::I32Const, static_cast<std::int32_t>(input_size)});
    for (const auto& binding : bindings) {
        const std::string suffix = sanitize_export_suffix(binding.name);
        if (binding.kind == WasmBinding::Kind::I32) {
            functions.push_back({"vkf_get_" + suffix, 1, FunctionSpec::BodyKind::I32Const, binding.i32_value});
        } else if (binding.kind == WasmBinding::Kind::F64) {
            functions.push_back({"vkf_get_" + suffix, 2, FunctionSpec::BodyKind::F64Const, 0, binding.f64_value});
        } else if (binding.kind == WasmBinding::Kind::String) {
            functions.push_back({"vkf_get_" + suffix + "_ptr", 1, FunctionSpec::BodyKind::I32Const,
                static_cast<std::int32_t>(binding.string_offset)});
            functions.push_back({"vkf_get_" + suffix + "_len", 1, FunctionSpec::BodyKind::I32Const,
                static_cast<std::int32_t>(binding.string_value.size())});
        } else if (binding.kind == WasmBinding::Kind::I32Array) {
            functions.push_back({"vkf_get_" + suffix + "_ptr", 1, FunctionSpec::BodyKind::I32Const,
                static_cast<std::int32_t>(binding.string_offset)});
            functions.push_back({"vkf_get_" + suffix + "_len", 1, FunctionSpec::BodyKind::I32Const,
                static_cast<std::int32_t>(binding.i32_array_values.size())});
        } else if (binding.kind == WasmBinding::Kind::F64Array) {
            functions.push_back({"vkf_get_" + suffix + "_ptr", 1, FunctionSpec::BodyKind::I32Const,
                static_cast<std::int32_t>(binding.string_offset)});
            functions.push_back({"vkf_get_" + suffix + "_len", 1, FunctionSpec::BodyKind::I32Const,
                static_cast<std::int32_t>(binding.f64_array_values.size())});
        }
    }

    std::vector<std::uint8_t> function_section;
    append_u32_leb(function_section, static_cast<std::uint32_t>(functions.size()));
    for (const auto& function : functions) {
        append_u32_leb(function_section, function.type_index);
    }
    append_section(module, 3, function_section);

    std::vector<std::uint8_t> memory_section;
    append_u32_leb(memory_section, 1);
    append_u8(memory_section, 0x00);
    append_u32_leb(memory_section, 1);
    append_section(module, 5, memory_section);

    std::vector<std::uint8_t> export_section;
    append_u32_leb(export_section, static_cast<std::uint32_t>(functions.size() + 1));
    append_string(export_section, "memory");
    append_u8(export_section, 0x02);
    append_u32_leb(export_section, 0);
    for (std::uint32_t i = 0; i < functions.size(); ++i) {
        append_string(export_section, functions[i].export_name);
        append_u8(export_section, 0x00);
        append_u32_leb(export_section, i);
    }
    append_section(module, 7, export_section);

    std::vector<std::uint8_t> code_section;
    append_u32_leb(code_section, static_cast<std::uint32_t>(functions.size()));
    for (const auto& function : functions) {
        std::vector<std::uint8_t> body;
        if (function.body_kind == FunctionSpec::BodyKind::ResetTick) {
            append_u32_leb(body, 0);
            if (plan.update.axis_vector_mode) {
                for (std::size_t i = 0; i < plan.update.axis_seed_numeric_values.size(); ++i) {
                    append_u8(body, 0x41);
                    append_i32_leb(body, static_cast<std::int32_t>(i * axis_word_size));
                    if (plan.update.axis_float_mode) {
                        append_u8(body, 0x44);
                        append_f64(body, plan.update.axis_seed_numeric_values[i]);
                        append_u8(body, 0x39);
                        append_u32_leb(body, 3);
                    } else {
                        append_u8(body, 0x41);
                        append_i32_leb(body, static_cast<std::int32_t>(plan.update.axis_seed_numeric_values[i]));
                        append_u8(body, 0x36);
                        append_u32_leb(body, 2);
                    }
                    append_u32_leb(body, 0);
                }
            } else for (std::uint32_t offset = 0; offset < state_size; offset += 4) {
                append_u8(body, 0x41);
                append_i32_leb(body, static_cast<std::int32_t>(offset));
                append_u8(body, 0x41);
                append_i32_leb(body, 0);
                append_u8(body, 0x36);
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
            }
        } else if (function.body_kind == FunctionSpec::BodyKind::IncrementTick) {
            if (plan.update.enabled && plan.update.axis_vector_mode) {
                append_u32_leb(body, 0);
                for (std::size_t i = 0; i < plan.update.axis_vector_length; ++i) {
                    append_u8(body, 0x41);
                    append_i32_leb(body, static_cast<std::int32_t>(i * axis_word_size));
                    emit_update_expr(
                        body,
                        plan.update.scalar_expr,
                        bindings,
                        input_offset,
                        &plan.update,
                        static_cast<std::int32_t>(i * axis_word_size)
                    );
                    append_u8(body, plan.update.axis_float_mode ? 0x39 : 0x36);
                    append_u32_leb(body, plan.update.axis_float_mode ? 3 : 2);
                    append_u32_leb(body, 0);
                }
            } else if (plan.update.enabled && plan.update.record_mode) {
                append_u32_leb(body, 0);
                for (std::size_t i = 0; i < plan.update.record_fields.size(); ++i) {
                    const FieldDesc* target_field = find_field_desc(plan.update.state_fields, plan.update.record_fields[i].first);
                    if (target_field == nullptr) {
                        throw WasmArtifactFailure("unknown record result field " + plan.update.record_fields[i].first);
                    }
                    if (target_field->axis_length > 0) {
                        for (std::size_t axis_index = 0; axis_index < target_field->axis_length; ++axis_index) {
                            append_u8(body, 0x41);
                            append_i32_leb(body, static_cast<std::int32_t>(target_field->offset + axis_index * 4));
                            emit_update_expr(
                                body,
                                plan.update.record_fields[i].second,
                                bindings,
                                input_offset,
                                &plan.update,
                                static_cast<std::int32_t>(axis_index * 4),
                                true
                            );
                            append_u8(body, 0x36);
                            append_u32_leb(body, 2);
                            append_u32_leb(body, 0);
                        }
                    } else {
                        append_u8(body, 0x41);
                        append_i32_leb(body, static_cast<std::int32_t>(target_field->offset));
                        emit_update_expr(body, plan.update.record_fields[i].second, bindings, input_offset, &plan.update);
                        append_u8(body, 0x36);
                        append_u32_leb(body, 2);
                        append_u32_leb(body, 0);
                    }
                }
            } else if (plan.update.enabled) {
                append_u32_leb(body, 0);
                append_u8(body, 0x41);
                append_i32_leb(body, 0);
                emit_update_expr(body, plan.update.scalar_expr, bindings, input_offset, &plan.update);
                append_u8(body, 0x36);
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
            } else {
                append_u32_leb(body, 1);
                append_u32_leb(body, 1);
                append_u8(body, 0x7F);
                append_u8(body, 0x41);
                append_i32_leb(body, 0);
                append_u8(body, 0x28);
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
                append_u8(body, 0x41);
                append_i32_leb(body, 1);
                append_u8(body, 0x6A);
                append_u8(body, 0x21);
                append_u32_leb(body, 0);
                append_u8(body, 0x41);
                append_i32_leb(body, 0);
                append_u8(body, 0x20);
                append_u32_leb(body, 0);
                append_u8(body, 0x36);
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
                append_u8(body, 0x41);
                append_i32_leb(body, 4);
                append_u8(body, 0x41);
                append_i32_leb(body, 4);
                append_u8(body, 0x28);
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
                append_u8(body, 0x41);
                append_i32_leb(body, static_cast<std::int32_t>(input_offset));
                append_u8(body, 0x28);
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
                append_u8(body, 0x6A);
                append_u8(body, 0x36);
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
            }
        } else {
            append_u32_leb(body, 0);
        }
        if (function.body_kind == FunctionSpec::BodyKind::I32Const) {
            append_u8(body, 0x41);
            append_i32_leb(body, function.i32_value);
        } else if (function.body_kind == FunctionSpec::BodyKind::F64Const) {
            append_u8(body, 0x44);
            append_f64(body, function.f64_value);
        }
        append_u8(body, 0x0B);
        append_u32_leb(code_section, static_cast<std::uint32_t>(body.size()));
        append_bytes(code_section, body);
    }
    append_section(module, 10, code_section);

    if (next_offset > 0) {
        std::vector<std::uint8_t> data_section;
        std::uint32_t segment_count = 0;
        for (const auto& binding : bindings) {
            if (binding.kind == WasmBinding::Kind::String
                || binding.kind == WasmBinding::Kind::I32Array
                || binding.kind == WasmBinding::Kind::F64Array) {
                ++segment_count;
            }
        }
        append_u32_leb(data_section, segment_count);
        for (const auto& binding : bindings) {
            if (binding.kind != WasmBinding::Kind::String
                && binding.kind != WasmBinding::Kind::I32Array
                && binding.kind != WasmBinding::Kind::F64Array) {
                continue;
            }
            append_u8(data_section, 0x00);
            append_u8(data_section, 0x41);
            append_i32_leb(data_section, static_cast<std::int32_t>(binding.string_offset));
            append_u8(data_section, 0x0B);
            if (binding.kind == WasmBinding::Kind::String) {
                append_u32_leb(data_section, static_cast<std::uint32_t>(binding.string_value.size()));
                data_section.insert(data_section.end(), binding.string_value.begin(), binding.string_value.end());
            } else if (binding.kind == WasmBinding::Kind::I32Array) {
                append_u32_leb(data_section, static_cast<std::uint32_t>(binding.i32_array_values.size() * 4));
                for (std::int32_t value : binding.i32_array_values) {
                    for (int i = 0; i < 4; ++i) {
                        data_section.push_back(static_cast<std::uint8_t>((static_cast<std::uint32_t>(value) >> (8 * i)) & 0xFFu));
                    }
                }
            } else {
                append_u32_leb(data_section, static_cast<std::uint32_t>(binding.f64_array_values.size() * 8));
                for (double value : binding.f64_array_values) {
                    append_f64(data_section, value);
                }
            }
        }
        append_section(module, 11, data_section);
    }

    return module;
}

vf::JsonValue::Object manifest_payload(
    const std::filesystem::path& source,
    const std::string& source_hash,
    const std::string& typed_ir_hash,
    const std::string& artifact_hash,
    const std::vector<Dependency>& dependencies,
    const std::filesystem::path& artifact_path,
    const std::string& status,
    const std::vector<WasmBinding>& bindings,
    const UpdateFunctionPlan& update_plan
) {
    const std::uint32_t state_size = update_plan.axis_vector_mode
        ? static_cast<std::uint32_t>(update_plan.axis_vector_length * 4)
        : (update_plan.record_mode
        ? layout_size_bytes(update_plan.state_fields)
        : 8);
    const std::uint32_t input_offset = state_size;
    const std::uint32_t input_size = update_plan.axis_vector_mode
        ? static_cast<std::uint32_t>((update_plan.axis_input_vector ? update_plan.axis_vector_length : 1) * 4)
        : (update_plan.record_mode
        ? layout_size_bytes(update_plan.input_fields)
        : 4);
    vf::JsonValue::Object manifest;
    manifest["artifact_kind"] = vf::JsonValue("wasm");
    manifest["artifact_path"] = vf::JsonValue(artifact_path.string());
    manifest["compiler_version"] = vf::JsonValue(compiler_version);
    manifest["source_path"] = vf::JsonValue(std::filesystem::absolute(source).string());
    manifest["source_sha256"] = vf::JsonValue(source_hash);
    manifest["status"] = vf::JsonValue(status);
    manifest["typed_ir_sha256"] = vf::JsonValue(typed_ir_hash);
    manifest["artifact_content_sha256"] = vf::JsonValue(artifact_hash);
    manifest["runtime_hash"] = vf::JsonValue(artifact_hash);
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
    runtime_surface["memory_export"] = vf::JsonValue("memory");
    runtime_surface["state_ptr_export"] = vf::JsonValue("vkf_state_ptr");
    runtime_surface["state_size_export"] = vf::JsonValue("vkf_state_size");
    runtime_surface["input_ptr_export"] = vf::JsonValue("vkf_input_ptr");
    runtime_surface["input_size_export"] = vf::JsonValue("vkf_input_size");
    runtime_surface["init_export"] = vf::JsonValue("vkf_init");
    runtime_surface["update_export"] = vf::JsonValue("vkf_update");
    runtime_surface["shutdown_export"] = vf::JsonValue("vkf_shutdown");
    runtime_surface["state_size"] = vf::JsonValue(static_cast<double>(state_size));
    runtime_surface["input_offset"] = vf::JsonValue(static_cast<double>(input_offset));
    runtime_surface["input_size"] = vf::JsonValue(static_cast<double>(input_size));
    runtime_surface["update_mode"] = vf::JsonValue(
        update_plan.axis_vector_mode ? (update_plan.axis_input_vector ? "axis_vector_vector" : "axis_vector_scalar")
        : (update_plan.record_mode ? "record" : (update_plan.enabled ? "scalar" : "builtin"))
    );
    vf::JsonValue::Array exports;
    exports.push_back(vf::JsonValue("vkf_init"));
    exports.push_back(vf::JsonValue("vkf_update"));
    exports.push_back(vf::JsonValue("vkf_shutdown"));
    exports.push_back(vf::JsonValue("vkf_state_ptr"));
    exports.push_back(vf::JsonValue("vkf_state_size"));
    exports.push_back(vf::JsonValue("vkf_input_ptr"));
    exports.push_back(vf::JsonValue("vkf_input_size"));
    vf::JsonValue::Array binding_exports;
    for (const auto& binding : bindings) {
        const std::string suffix = sanitize_export_suffix(binding.name);
        vf::JsonValue::Object binding_export;
        binding_export["name"] = vf::JsonValue(binding.name);
        if (binding.kind == WasmBinding::Kind::String) {
            binding_export["kind"] = vf::JsonValue("string");
            binding_export["ptr_export"] = vf::JsonValue("vkf_get_" + suffix + "_ptr");
            binding_export["len_export"] = vf::JsonValue("vkf_get_" + suffix + "_len");
            exports.push_back(vf::JsonValue("vkf_get_" + suffix + "_ptr"));
            exports.push_back(vf::JsonValue("vkf_get_" + suffix + "_len"));
        } else if (binding.kind == WasmBinding::Kind::I32Array) {
            binding_export["kind"] = vf::JsonValue("axis_i32_array");
            binding_export["axis_key"] = vf::JsonValue(binding.axis_key);
            binding_export["ptr_export"] = vf::JsonValue("vkf_get_" + suffix + "_ptr");
            binding_export["len_export"] = vf::JsonValue("vkf_get_" + suffix + "_len");
            exports.push_back(vf::JsonValue("vkf_get_" + suffix + "_ptr"));
            exports.push_back(vf::JsonValue("vkf_get_" + suffix + "_len"));
        } else if (binding.kind == WasmBinding::Kind::F64Array) {
            binding_export["kind"] = vf::JsonValue("axis_f64_array");
            binding_export["axis_key"] = vf::JsonValue(binding.axis_key);
            binding_export["ptr_export"] = vf::JsonValue("vkf_get_" + suffix + "_ptr");
            binding_export["len_export"] = vf::JsonValue("vkf_get_" + suffix + "_len");
            exports.push_back(vf::JsonValue("vkf_get_" + suffix + "_ptr"));
            exports.push_back(vf::JsonValue("vkf_get_" + suffix + "_len"));
        } else if (binding.kind == WasmBinding::Kind::F64) {
            binding_export["kind"] = vf::JsonValue("f64");
            binding_export["value_export"] = vf::JsonValue("vkf_get_" + suffix);
            exports.push_back(vf::JsonValue("vkf_get_" + suffix));
        } else {
            binding_export["kind"] = vf::JsonValue("i32");
            binding_export["value_export"] = vf::JsonValue("vkf_get_" + suffix);
            exports.push_back(vf::JsonValue("vkf_get_" + suffix));
        }
        binding_exports.push_back(vf::JsonValue(std::move(binding_export)));
    }
    runtime_surface["exports"] = vf::JsonValue(std::move(exports));
    runtime_surface["bindings"] = vf::JsonValue(std::move(binding_exports));
    if (update_plan.axis_vector_mode) {
        runtime_surface["state_axis_key"] = vf::JsonValue(update_plan.axis_key);
        runtime_surface["state_axis_length"] = vf::JsonValue(static_cast<double>(update_plan.axis_vector_length));
        runtime_surface["input_axis_key"] = vf::JsonValue(update_plan.axis_input_vector ? update_plan.axis_key : "");
        runtime_surface["input_axis_length"] = vf::JsonValue(static_cast<double>(update_plan.axis_input_vector ? update_plan.axis_vector_length : 1));
        vf::JsonValue::Array state_fields;
        vf::JsonValue::Object state_field;
        state_field["name"] = vf::JsonValue("values");
        state_field["offset"] = vf::JsonValue(0.0);
        state_field["type"] = vf::JsonValue(
            update_plan.axis_float_mode
                ? ("axis<" + update_plan.axis_key + ">:list<f64>")
                : ("axis<" + update_plan.axis_key + ">:list<num>")
        );
        state_field["axis_key"] = vf::JsonValue(update_plan.axis_key);
        state_field["axis_length"] = vf::JsonValue(static_cast<double>(update_plan.axis_vector_length));
        if (update_plan.axis_float_mode) {
            state_field["storage"] = vf::JsonValue("f64");
        }
        state_fields.push_back(vf::JsonValue(std::move(state_field)));
        runtime_surface["state_fields"] = vf::JsonValue(std::move(state_fields));
        vf::JsonValue::Array input_fields;
        vf::JsonValue::Object input_field;
        input_field["name"] = vf::JsonValue(update_plan.axis_input_vector ? "values" : "value");
        input_field["offset"] = vf::JsonValue(0.0);
        input_field["type"] = vf::JsonValue(
            update_plan.axis_input_vector
                ? (update_plan.axis_float_mode
                    ? ("axis<" + update_plan.axis_key + ">:list<f64>")
                    : ("axis<" + update_plan.axis_key + ">:list<num>"))
                : (update_plan.axis_float_mode ? "f64" : "num")
        );
        if (update_plan.axis_input_vector) {
            input_field["axis_key"] = vf::JsonValue(update_plan.axis_key);
            input_field["axis_length"] = vf::JsonValue(static_cast<double>(update_plan.axis_vector_length));
        }
        if (update_plan.axis_float_mode) {
            input_field["storage"] = vf::JsonValue("f64");
        }
        input_fields.push_back(vf::JsonValue(std::move(input_field)));
        runtime_surface["input_fields"] = vf::JsonValue(std::move(input_fields));
    } else if (update_plan.record_mode) {
        vf::JsonValue::Array state_fields;
        for (std::size_t i = 0; i < update_plan.state_fields.size(); ++i) {
            vf::JsonValue::Object field_desc;
            field_desc["name"] = vf::JsonValue(update_plan.state_fields[i].name);
            field_desc["offset"] = vf::JsonValue(static_cast<double>(update_plan.state_fields[i].offset));
            field_desc["type"] = vf::JsonValue(update_plan.state_fields[i].type);
            if (update_plan.state_fields[i].axis_length > 0) {
                field_desc["axis_key"] = vf::JsonValue(update_plan.state_fields[i].axis_key);
                field_desc["axis_length"] = vf::JsonValue(static_cast<double>(update_plan.state_fields[i].axis_length));
            }
            state_fields.push_back(vf::JsonValue(std::move(field_desc)));
        }
        vf::JsonValue::Array input_fields;
        for (std::size_t i = 0; i < update_plan.input_fields.size(); ++i) {
            vf::JsonValue::Object field_desc;
            field_desc["name"] = vf::JsonValue(update_plan.input_fields[i].name);
            field_desc["offset"] = vf::JsonValue(static_cast<double>(update_plan.input_fields[i].offset));
            field_desc["type"] = vf::JsonValue(update_plan.input_fields[i].type);
            if (update_plan.input_fields[i].axis_length > 0) {
                field_desc["axis_key"] = vf::JsonValue(update_plan.input_fields[i].axis_key);
                field_desc["axis_length"] = vf::JsonValue(static_cast<double>(update_plan.input_fields[i].axis_length));
            }
            input_fields.push_back(vf::JsonValue(std::move(field_desc)));
        }
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
                throw WasmArtifactFailure("dependency must be name=path");
            }
            args.dependencies.push_back({spec.substr(0, eq), spec.substr(eq + 1)});
            continue;
        }
        throw WasmArtifactFailure("usage: vkf_wasm_artifact_smoke --source <file.vkf> --typed-ir <file.json>");
    }
    if (args.source.empty() || args.typed_ir.empty()) {
        throw WasmArtifactFailure("usage: vkf_wasm_artifact_smoke --source <file.vkf> --typed-ir <file.json>");
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
        auto plan = collect_module_plan(typed_ir);
        const std::vector<std::uint8_t> wasm_bytes = build_wasm_module(plan);

        const std::string source_hash = stable_hash(source_text);
        const std::string typed_ir_hash = stable_hash(typed_ir_text);
        const std::string artifact_hash = stable_hash_bytes(wasm_bytes);
        std::vector<Dependency> dependencies;
        for (const auto& dependency : args.dependencies) {
            dependencies.push_back({dependency.first, dependency.second, stable_hash(read_file(dependency.second))});
        }

        const auto build_dir = repo_root_from_source(args.source) / ".vkfbuild" / stem_of(args.source);
        const auto manifest_path = build_dir / "wasm-manifest.json";
        const auto artifact_path = build_dir / (stem_of(args.source) + ".artifact.wasm");
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
            write_bytes(artifact_path, wasm_bytes);
        }

        auto manifest = manifest_payload(
            args.source,
            source_hash,
            typed_ir_hash,
            artifact_hash,
            dependencies,
            artifact_path,
            status,
            plan.bindings,
            plan.update
        );
        manifest["manifest_hash"] = vf::JsonValue(desired_manifest_hash);
        write_text(manifest_path, vf::json_stringify(vf::JsonValue(std::move(manifest)), 2) + "\n");

        vf::JsonValue::Object result;
        result["artifact_kind"] = vf::JsonValue("wasm");
        result["artifact_path"] = vf::JsonValue(artifact_path.string());
        result["manifest_path"] = vf::JsonValue(manifest_path.string());
        result["status"] = vf::JsonValue(status);
        std::cout << vf::json_stringify(vf::JsonValue(std::move(result)), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<wasm-artifact-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
