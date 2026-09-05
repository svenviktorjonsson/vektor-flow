#include "native/VfOverlay/vf/json.hpp"
#include "runtime/vkf_trig.h"
#include "vkf_native_scene_lowering.hpp"
#include "compiler/native/vkf_wasm_typed_ir.hpp"
#include "vkf_retained_scene_packet.hpp"
#include "vkf_static_html_bundle.hpp"
#include "vkf_world_mesh_packet.hpp"

#include <cstdint>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr const char* compiler_version = "vkf-wasm-artifact-smoke-0.1";
constexpr std::uint32_t symbolic_text_capacity = 4096;

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
        Bytes,
        I32Array,
        F64Array,
    } kind;
    std::int32_t i32_value = 0;
    double f64_value = 0.0;
    std::string string_value;
    std::vector<std::uint8_t> byte_values;
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
    std::vector<vf::static_html::Bundle> static_html_bundles;
    std::string event_program_json;
    bool has_retained_scene_arena = false;
    vf::JsonValue::Array render_parameter_sections;
    vf::JsonValue::Array render_parameter_draw_lists;
    std::vector<vkf::native_scene::PackedRenderParameters::TemporalParameterUpdate>
        temporal_parameter_updates;
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

std::string artifact_stem_of(const std::filesystem::path& source) {
    const std::string stem = stem_of(source);
    constexpr std::size_t max_stem_length = 16;
    if (stem.size() <= max_stem_length) {
        return stem;
    }
    constexpr std::size_t hash_length = 8;
    constexpr std::size_t prefix_length = max_stem_length - hash_length - 1;
    return stem.substr(0, prefix_length) + "-" + stable_hash(stem).substr(0, hash_length);
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

void append_f32(std::vector<std::uint8_t>& out, float value) {
    std::uint32_t bits = 0;
    static_assert(sizeof(float) == sizeof(std::uint32_t),
        "float must be 32-bit");
    std::memcpy(&bits, &value, sizeof(bits));
    for (int i = 0; i < 4; ++i) {
        out.push_back(static_cast<std::uint8_t>(
            (bits >> (8 * i)) & 0xFFu));
    }
}

void emit_camera_control_body(
    std::vector<std::uint8_t>& body,
    std::uint32_t camera_offset
) {
    constexpr float orbit_substep = 0.0175f;
    const float orbit_cos = std::cos(orbit_substep);
    const float orbit_sin = std::sin(orbit_substep);

    const auto i32_const = [&body](std::int32_t value) {
        append_u8(body, 0x41);
        append_i32_leb(body, value);
    };
    const auto f32_const = [&body](float value) {
        append_u8(body, 0x43);
        append_f32(body, value);
    };
    const auto local_get = [&body](std::uint32_t index) {
        append_u8(body, 0x20);
        append_u32_leb(body, index);
    };
    const auto local_set = [&body](std::uint32_t index) {
        append_u8(body, 0x21);
        append_u32_leb(body, index);
    };
    const auto f32_load = [&body, &i32_const](std::uint32_t address) {
        i32_const(static_cast<std::int32_t>(address));
        append_u8(body, 0x2A);
        append_u32_leb(body, 2);
        append_u32_leb(body, 0);
    };
    const auto f32_store = [&body](std::uint32_t address) {
        append_u8(body, 0x41);
        append_i32_leb(body, static_cast<std::int32_t>(address));
    };

    // Nineteen f32 locals: offset, authored up, rotated offset, scalar
    // temporaries, current rotation axis, and the pre-control offset. Camera control is expressed
    // in the authored camera basis; no world axis is privileged.
    append_u32_leb(body, 1);
    append_u32_leb(body, 19);
    append_u8(body, 0x7D);

    for (std::uint32_t axis = 0; axis < 3; ++axis) {
        f32_load(camera_offset + axis * 4);
        f32_load(camera_offset + 12 + axis * 4);
        append_u8(body, 0x93);  // f32.sub
        local_set(3 + axis);
        local_get(3 + axis);
        local_set(19 + axis);
    }

    // Normalize the authored camera up vector into locals 6..8.
    for (std::uint32_t axis = 0; axis < 3; ++axis) {
        f32_load(camera_offset + 24 + axis * 4);
        f32_load(camera_offset + 24 + axis * 4);
        append_u8(body, 0x94);  // f32.mul
        if (axis != 0) append_u8(body, 0x92);  // f32.add
    }
    append_u8(body, 0x91);  // f32.sqrt
    f32_const(1.0e-6f);
    append_u8(body, 0x97);  // f32.max
    local_set(13);
    for (std::uint32_t axis = 0; axis < 3; ++axis) {
        f32_load(camera_offset + 24 + axis * 4);
        local_get(13);
        append_u8(body, 0x95);  // f32.div
        local_set(6 + axis);
    }

    const auto emit_dot = [&](std::uint32_t lhs, std::uint32_t rhs) {
        for (std::uint32_t axis = 0; axis < 3; ++axis) {
            local_get(lhs + axis);
            local_get(rhs + axis);
            append_u8(body, 0x94);  // f32.mul
            if (axis != 0) append_u8(body, 0x92);  // f32.add
        }
    };
    const auto emit_rotation = [&](std::uint32_t rotation_axis,
                                   std::uint32_t direction_local) {
        f32_const(orbit_sin);
        local_get(direction_local);
        append_u8(body, 0xB2);  // f32.convert_i32_s
        append_u8(body, 0x94);  // f32.mul
        local_set(14);
        emit_dot(rotation_axis, 3);
        local_set(12);
        for (std::uint32_t axis = 0; axis < 3; ++axis) {
            const std::uint32_t next = (axis + 1) % 3;
            const std::uint32_t last = (axis + 2) % 3;
            f32_const(orbit_cos);
            local_get(3 + axis);
            append_u8(body, 0x94);  // cos * offset
            local_get(14);
            local_get(rotation_axis + next);
            local_get(3 + last);
            append_u8(body, 0x94);
            local_get(rotation_axis + last);
            local_get(3 + next);
            append_u8(body, 0x94);
            append_u8(body, 0x93);  // axis cross offset
            append_u8(body, 0x94);
            append_u8(body, 0x92);  // + sin * cross
            f32_const(1.0f - orbit_cos);
            local_get(rotation_axis + axis);
            append_u8(body, 0x94);
            local_get(12);
            append_u8(body, 0x94);
            append_u8(body, 0x92);  // + (1-cos) * axis * dot
            local_set(9 + axis);
        }
    };

    // Horizontal orbit: four substeps around the authored up axis.
    local_get(0);
    append_u8(body, 0x04); append_u8(body, 0x40);  // if
    for (int substep = 0; substep < 4; ++substep) {
        emit_rotation(6, 0);
        for (std::uint32_t axis = 0; axis < 3; ++axis) {
            local_get(9 + axis);
            local_set(3 + axis);
        }
    }
    append_u8(body, 0x0B);

    // Vertical orbit uses the right axis derived from the current offset and
    // authored up, then rejects a substep that would cross the pole.
    local_get(1);
    append_u8(body, 0x04); append_u8(body, 0x40);
    for (int substep = 0; substep < 4; ++substep) {
        for (std::uint32_t axis = 0; axis < 3; ++axis) {
            const std::uint32_t next = (axis + 1) % 3;
            const std::uint32_t last = (axis + 2) % 3;
            local_get(3 + next);
            local_get(6 + last);
            append_u8(body, 0x94);
            local_get(3 + last);
            local_get(6 + next);
            append_u8(body, 0x94);
            append_u8(body, 0x93);  // offset cross up
            local_set(15 + axis);
        }
        emit_dot(15, 15);
        append_u8(body, 0x91);  // f32.sqrt
        local_set(13);
        local_get(13); f32_const(1.0e-6f); append_u8(body, 0x5E);
        append_u8(body, 0x04); append_u8(body, 0x40);
        for (std::uint32_t axis = 0; axis < 3; ++axis) {
            local_get(15 + axis);
            local_get(13);
            append_u8(body, 0x95);
            local_set(15 + axis);
        }
        emit_rotation(15, 1);
        emit_dot(9, 6);
        local_set(12);
        for (std::uint32_t axis = 0; axis < 3; ++axis) {
            local_get(9 + axis);
            local_get(6 + axis);
            local_get(12);
            append_u8(body, 0x94);
            append_u8(body, 0x93);
            local_get(9 + axis);
            local_get(6 + axis);
            local_get(12);
            append_u8(body, 0x94);
            append_u8(body, 0x93);
            append_u8(body, 0x94);
            if (axis != 0) append_u8(body, 0x92);
        }
        append_u8(body, 0x91);  // f32.sqrt
        f32_const(0.05f);
        append_u8(body, 0x5E);
        append_u8(body, 0x04); append_u8(body, 0x40);
        for (std::uint32_t axis = 0; axis < 3; ++axis) {
            local_get(9 + axis);
            local_set(3 + axis);
        }
        append_u8(body, 0x0B);
        append_u8(body, 0x0B);
    }
    append_u8(body, 0x0B);

    // Negative wheel direction moves closer; positive moves farther away.
    local_get(2);
    append_u8(body, 0x04); append_u8(body, 0x40);
    local_get(2); i32_const(0); append_u8(body, 0x48);
    append_u8(body, 0x04); append_u8(body, 0x7D);
    f32_const(0.90f);
    append_u8(body, 0x05);
    f32_const(1.10f);
    append_u8(body, 0x0B); local_set(13);
    local_get(3); local_get(13); append_u8(body, 0x94); local_set(3);
    local_get(4); local_get(13); append_u8(body, 0x94); local_set(4);
    local_get(5); local_get(13); append_u8(body, 0x94); local_set(5);
    append_u8(body, 0x0B);

    for (std::uint32_t axis = 0; axis < 3; ++axis) {
        f32_store(camera_offset + 84 + axis * 4);
        f32_load(camera_offset + 84 + axis * 4);
        local_get(3 + axis);
        local_get(19 + axis);
        append_u8(body, 0x93);  // controlled offset delta
        append_u8(body, 0x92);  // accumulate interaction offset
        append_u8(body, 0x38);  // f32.store
        append_u32_leb(body, 2);
        append_u32_leb(body, 0);
        f32_store(camera_offset + axis * 4);
        f32_load(camera_offset + 12 + axis * 4);
        local_get(3 + axis);
        append_u8(body, 0x92);  // f32.add
        append_u8(body, 0x38);  // f32.store
        append_u32_leb(body, 2);
        append_u32_leb(body, 0);
    }
}

void emit_temporal_parameter_updates(
    std::vector<std::uint8_t>& body,
    const std::vector<
        vkf::native_scene::PackedRenderParameters::TemporalParameterUpdate>& updates,
    std::uint32_t parameter_arena_offset,
    std::uint32_t time_local
) {
    const auto i32_const = [&body](std::int32_t value) {
        append_u8(body, 0x41);
        append_i32_leb(body, value);
    };
    const auto f32_const = [&body](double value) {
        append_u8(body, 0x43);
        append_f32(body, static_cast<float>(value));
    };
    const auto local_get = [&body](std::uint32_t index) {
        append_u8(body, 0x20);
        append_u32_leb(body, index);
    };
    const auto local_set = [&body](std::uint32_t index) {
        append_u8(body, 0x21);
        append_u32_leb(body, index);
    };
    const auto elapsed = [&body, &i32_const] {
        i32_const(0);
        append_u8(body, 0x28);  // i32.load
        append_u32_leb(body, 2);
        append_u32_leb(body, 0);
        append_u8(body, 0xB2);  // f32.convert_i32_s
    };
    const auto store = [&body, &i32_const](std::uint32_t address) {
        i32_const(static_cast<std::int32_t>(address));
    };
    const auto load = [&body, &i32_const](std::uint32_t address) {
        i32_const(static_cast<std::int32_t>(address));
        append_u8(body, 0x2A);  // f32.load
        append_u32_leb(body, 2);
        append_u32_leb(body, 0);
    };

    for (const auto& update : updates) {
        const auto cycle =
            vkf::retained_scene::detail::layer_time_cycle(update.coordinates);
        const double first = cycle.first;
        const double duration = cycle.duration;
        if (update.mode == "repeat" || update.mode == "mirror") {
            elapsed();
            elapsed();
            f32_const(update.mode == "mirror" ? duration * 2.0 : cycle.repeat_period);
            append_u8(body, 0x95);  // f32.div
            append_u8(body, 0x8E);  // f32.floor
            f32_const(update.mode == "mirror" ? duration * 2.0 : cycle.repeat_period);
            append_u8(body, 0x94);  // f32.mul
            append_u8(body, 0x93);  // f32.sub
            local_set(time_local);
            if (update.mode == "mirror") {
                local_get(time_local);
                f32_const(duration);
                append_u8(body, 0x5E);  // f32.gt
                append_u8(body, 0x04);
                append_u8(body, 0x7D);  // if (result f32)
                f32_const(duration * 2.0);
                local_get(time_local);
                append_u8(body, 0x93);  // f32.sub
                append_u8(body, 0x05);  // else
                local_get(time_local);
                append_u8(body, 0x0B);  // end
                local_set(time_local);
            }
            local_get(time_local);
            f32_const(first);
            append_u8(body, 0x92);  // f32.add
            local_set(time_local);
        } else if (update.mode == "stop") {
            elapsed();
            f32_const(duration);
            append_u8(body, 0x96);  // f32.min
            f32_const(first);
            append_u8(body, 0x92);  // f32.add
            local_set(time_local);
        } else {
            elapsed();
            f32_const(duration);
            append_u8(body, 0x60);  // f32.ge
            append_u8(body, 0x04);
            append_u8(body, 0x7D);  // if (result f32)
            f32_const(first);
            append_u8(body, 0x05);  // else
            elapsed();
            f32_const(first);
            append_u8(body, 0x92);  // f32.add
            append_u8(body, 0x0B);  // end
            local_set(time_local);
        }

        const auto emit_component = [&](const auto& self,
                                        std::size_t segment,
                                        std::size_t component) -> void {
            local_get(time_local);
            f32_const(update.coordinates[segment + 1]);
            append_u8(body, 0x5F);  // f32.le
            append_u8(body, 0x04);
            append_u8(body, 0x7D);  // if (result f32)
            f32_const(update.samples[segment][component]);
            f32_const(
                update.samples[segment + 1][component] -
                update.samples[segment][component]);
            local_get(time_local);
            f32_const(update.coordinates[segment]);
            append_u8(body, 0x93);  // f32.sub
            f32_const(
                update.coordinates[segment + 1] -
                update.coordinates[segment]);
            append_u8(body, 0x95);  // f32.div
            append_u8(body, 0x94);  // f32.mul
            append_u8(body, 0x92);  // f32.add
            append_u8(body, 0x05);  // else
            if (segment + 2 < update.samples.size()) {
                self(self, segment + 1, component);
            } else if (update.mode == "repeat") {
                f32_const(update.samples.back()[component]);
                f32_const(
                    update.samples.front()[component] -
                    update.samples.back()[component]);
                local_get(time_local);
                f32_const(update.coordinates.back());
                append_u8(body, 0x93);  // f32.sub
                f32_const(cycle.closing_interval);
                append_u8(body, 0x95);  // f32.div
                append_u8(body, 0x94);  // f32.mul
                append_u8(body, 0x92);  // f32.add
            } else {
                f32_const(update.samples.back()[component]);
            }
            append_u8(body, 0x0B);  // end
        };

        for (const auto& target : update.targets) {
            for (std::uint32_t component = 0;
                 component < update.samples.front().size(); ++component) {
                store(parameter_arena_offset + target.byte_offset + component * 4);
                emit_component(emit_component, 0, component);
                if (target.additive_offset_byte_offset.has_value()) {
                    load(parameter_arena_offset +
                         *target.additive_offset_byte_offset + component * 4);
                    append_u8(body, 0x92);  // preserve interactive camera offset
                }
                if (target.relative_to_first) {
                    f32_const(update.samples.front()[component]);
                    append_u8(body, 0x93);  // f32.sub: transform delta
                }
                append_u8(body, 0x38);  // f32.store
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
            }
        }
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
        if (op == "SLASH") {
            if (rhs == 0.0) throw WasmArtifactFailure("wasm computed binding divides by zero");
            return lhs / rhs;
        }
        if (op == "CARET" || op == "POWER") {
            return std::pow(lhs, rhs);
        }
        throw WasmArtifactFailure(
            "wasm computed binding only supports numeric arithmetic");
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
    if (kind == "list") {
        EvaluatedBindingValue out;
        out.is_array = true;
        for (const auto& item_value : array_of(field(object, "items", "list"), "list.items")) {
            const EvaluatedBindingValue item = evaluate_binding_value(item_value, bindings);
            if (item.is_array) {
                throw WasmArtifactFailure("wasm computed binding list only supports scalar items");
            }
            out.array_values.push_back(item.scalar_value);
        }
        return out;
    }
    if (kind == "axis_align") {
        EvaluatedBindingValue out = evaluate_binding_value(
            field(object, "value", "axis_align"), bindings);
        if (!out.is_array || !out.axis_key.empty()) {
            throw WasmArtifactFailure(
                "wasm axis_align binding requires one unaligned vector value");
        }
        out.axis_key = string_field(object, "axis_key", "axis_align");
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
        const std::string callee_kind = string_field(callee, "kind", "call.callee");
        std::string field_name;
        if (callee_kind == "stdlib_function" &&
            string_field(callee, "module", "call.callee") == "math") {
            field_name = string_field(callee, "name", "call.callee");
        } else if (callee_kind == "field_access") {
            field_name = string_field(callee, "field", "call.callee");
            const auto& base = object_of(
                field(callee, "object", "call.callee.object"), "call.callee.object");
            if (string_field(base, "kind", "call.callee.object") != "load" ||
                string_field(base, "name", "call.callee.object") != "math") {
                throw WasmArtifactFailure(
                    "wasm computed binding only supports math intrinsic calls");
            }
        } else {
            throw WasmArtifactFailure(
                "wasm computed binding only supports stdlib math calls");
        }
        const auto& args = array_of(field(object, "args", "call"), "call.args");
        if (args.size() != 1 || (field_name != "sin" && field_name != "cos")) {
            throw WasmArtifactFailure("wasm computed binding only supports unary math.sin/math.cos");
        }
        const EvaluatedBindingValue arg = evaluate_binding_value(args[0], bindings);
        auto apply_intrinsic = [&field_name](double value) -> double {
            return field_name == "sin" ? vkf_trig_v1_sin(value) : vkf_trig_v1_cos(value);
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

void flatten_retained_html_numeric_value(
    const vf::JsonValue& value,
    std::vector<double>& out
) {
    if (value.is_number()) {
        out.push_back(value.as_number());
        return;
    }
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            flatten_retained_html_numeric_value(item, out);
        }
        return;
    }
    if (value.is_object()) {
        const auto& object = value.as_object();
        const std::string kind = string_field(
            object, "kind", "retained HTML numeric value");
        if (kind == "const") {
            flatten_retained_html_numeric_value(
                field(object, "value", "retained HTML const"), out);
            return;
        }
        if (kind == "list") {
            flatten_retained_html_numeric_value(
                field(object, "items", "retained HTML list"), out);
            return;
        }
    }
    throw WasmArtifactFailure("retained HTML Frame geometry must be numeric");
}

void collect_lowered_scene_arena_bindings(
    const vkf::native_scene::LoweredSourceScene& lowered,
    WasmModulePlan& plan
) {
    WasmBinding metadata_binding;
    metadata_binding.name = "native_scene";
    metadata_binding.kind = WasmBinding::Kind::String;
    metadata_binding.string_value = lowered.packed.metadata_json;
    plan.bindings.push_back(std::move(metadata_binding));

    WasmBinding arena_binding;
    arena_binding.name = "$ui$compiled$scene$arena";
    arena_binding.kind = WasmBinding::Kind::Bytes;
    arena_binding.byte_values = lowered.packed.arena_bytes;
    plan.bindings.push_back(std::move(arena_binding));

    WasmBinding render_parameters_binding;
    render_parameters_binding.name =
        "$ui$compiled$render$parameter$arena";
    render_parameters_binding.kind = WasmBinding::Kind::Bytes;
    render_parameters_binding.byte_values =
        lowered.render_parameters.arena_bytes;
    plan.bindings.push_back(std::move(render_parameters_binding));

    plan.has_retained_scene_arena = true;
    plan.render_parameter_sections = lowered.render_parameters.sections;
    plan.render_parameter_draw_lists = lowered.render_parameters.draw_lists;
    plan.temporal_parameter_updates =
        lowered.render_parameters.temporal_parameter_updates;
}

bool collect_retained_scene_packet_binding(
    const vf::JsonValue& root,
    const std::filesystem::path& source_path,
    WasmModulePlan& plan
) {
    try {
        const auto source_text = read_file(source_path);
        const auto loads = vkf::native_scene::canonical_source_loads(
            source_text, source_path);
        const auto packets = vkf::retained_scene::compile_packets(root, &loads);
        if (!packets.has_value()) return false;
        WasmBinding packet_binding;
        packet_binding.name = "$ui$compiled$packets";
        packet_binding.kind = WasmBinding::Kind::String;
        packet_binding.string_value = vf::json_stringify(*packets, -1);
        plan.bindings.push_back(std::move(packet_binding));
        const auto event_program = vkf::retained_scene::compile_event_program(
            root, *packets);
        if (event_program.has_value()) {
            WasmBinding event_binding;
            event_binding.name = "$ui$compiled$event_program";
            event_binding.kind = WasmBinding::Kind::String;
            event_binding.string_value = vf::json_stringify(*event_program, -1);
            plan.event_program_json = event_binding.string_value;
            plan.bindings.push_back(std::move(event_binding));
        }
        if (const auto lowered =
                vkf::native_scene::lower_typed_retained_scene(
                    root, source_text, source_path)) {
            collect_lowered_scene_arena_bindings(*lowered, plan);
        }
        std::map<std::string, bool> loaded_frames;
        for (const auto& load : vkf::retained_scene::static_html_loads(root)) {
            std::filesystem::path resource_path(load.resource);
            if (resource_path.is_absolute()) {
                throw WasmArtifactFailure("Frame.load resource path must be source-relative");
            }
            if (loaded_frames[load.frame_id]) {
                throw WasmArtifactFailure("Frame.load initial slice accepts one load per Frame");
            }
            loaded_frames[load.frame_id] = true;
            plan.static_html_bundles.push_back(vf::static_html::collect(
                source_path, source_path.parent_path() / resource_path,
                load.frame_id));
        }
        return true;
    } catch (const vkf::retained_scene::Error& error) {
        throw WasmArtifactFailure(error.what());
    } catch (const vf::static_html::Error& error) {
        throw WasmArtifactFailure(error.what());
    }
}

void collect_retained_html_packet_binding(
    const vf::JsonValue& root_value,
    const std::filesystem::path& source_path,
    WasmModulePlan& plan
) {
    const auto& root = object_of(root_value, "typed IR root");
    const auto program_entry = root.find("ui_program");
    if (program_entry == root.end()) return;
    const auto& program = object_of(program_entry->second, "typed UI program");
    if (string_field(program, "schema", "typed UI program") !=
        "vektor-flow/ui-program") {
        throw WasmArtifactFailure("typed UI program has an unsupported schema");
    }
    const auto& operations = array_of(
        field(program, "operations", "typed UI program"),
        "typed UI program.operations");
    bool has_attachment = false;
    for (const auto& raw_operation : operations) {
        const auto& operation = object_of(raw_operation, "typed UI operation");
        const std::string kind = string_field(operation, "kind", "typed UI operation");
        if (kind == "load" || kind == "__vf_internal_attach_html_tree") {
            has_attachment = true;
            break;
        }
    }
    if (!has_attachment) return;

    struct FrameRect {
        double x;
        double y;
        double w;
        double h;
    };
    std::map<std::int32_t, FrameRect> frames;
    std::map<std::int32_t, std::vector<std::string>> component_trees;
    std::map<std::int32_t, vf::static_html::Bundle> static_bundles;
    for (const auto& raw_operation : operations) {
        const auto& operation = object_of(raw_operation, "typed UI operation");
        const std::string kind = string_field(operation, "kind", "typed UI operation");
        if (kind == "show") continue;
        if (kind == "add_frame") {
            if (string_field(operation, "parent_kind", "typed UI add_frame") !=
                "display") {
                throw WasmArtifactFailure(
                    "retained HTML attachment requires a Display-owned Frame");
            }
            const std::int32_t frame_id = checked_i32(
                field(operation, "frame_id", "typed UI add_frame"),
                "typed UI frame id");
            std::vector<double> pos;
            std::vector<double> size;
            flatten_retained_html_numeric_value(
                field(operation, "pos", "typed UI add_frame"), pos);
            flatten_retained_html_numeric_value(
                field(operation, "size", "typed UI add_frame"), size);
            if (pos.size() != 2 || size.size() != 2) {
                throw WasmArtifactFailure(
                    "retained HTML attachment requires two-dimensional Frame geometry");
            }
            frames[frame_id] = {
                pos[0], pos[1], size[0], size[1]};
            continue;
        }
        if (kind == "load") {
            const auto& target = object_of(
                field(operation, "target", "Frame.load operation"),
                "Frame.load target");
            if (string_field(target, "kind", "Frame.load target") != "frame") {
                throw WasmArtifactFailure("Frame.load requires a Frame target");
            }
            const std::int32_t frame_id = checked_i32(
                field(target, "id", "Frame.load target"), "Frame.load frame id");
            std::filesystem::path resource_path = string_field(
                operation, "resource", "Frame.load operation");
            if (resource_path.is_absolute()) {
                throw WasmArtifactFailure("Frame.load resource path must be source-relative");
            }
            if (static_bundles.find(frame_id) != static_bundles.end()) {
                throw WasmArtifactFailure("Frame.load initial slice accepts one load per Frame");
            }
            resource_path = source_path.parent_path() / resource_path;
            try {
                static_bundles.emplace(frame_id, vf::static_html::collect(
                    source_path, resource_path, "frame_" + std::to_string(frame_id)));
            } catch (const vf::static_html::Error& error) {
                throw WasmArtifactFailure(error.what());
            }
            continue;
        }
        if (kind == "__vf_internal_attach_html_tree") {
            const auto& target = object_of(
                field(operation, "target", "internal component-tree attachment"),
                "internal component-tree target");
            if (string_field(target, "kind", "internal component-tree target") !=
                "frame") {
                throw WasmArtifactFailure(
                    "internal component-tree attachment requires a Frame target");
            }
            const std::int32_t frame_id = checked_i32(
                field(target, "id", "internal component-tree target"),
                "internal component-tree frame id");
            if (component_trees.find(frame_id) != component_trees.end()) {
                throw WasmArtifactFailure(
                    "internal component-tree attachment accepts one tree per Frame");
            }
            const auto& identities = array_of(
                field(operation, "identities", "internal component-tree attachment"),
                "internal component identities");
            if (identities.empty()) {
                throw WasmArtifactFailure(
                    "internal component-tree attachment requires component identities");
            }
            std::vector<std::string> tree;
            for (const auto& identity : identities) {
                if (!identity.is_string() ||
                    (identity.as_string() != "Div" && identity.as_string() != "Button")) {
                    throw WasmArtifactFailure(
                        "internal component-tree attachment only accepts compiled Div and Button identities");
                }
                tree.push_back(identity.as_string());
            }
            component_trees.emplace(frame_id, std::move(tree));
            continue;
        }
        throw WasmArtifactFailure(
            "retained HTML attachment does not combine UI operation `" + kind + "`");
    }

    vf::JsonValue::Array commands;
    std::set<std::int32_t> target_frames;
    for (const auto& entry : component_trees) target_frames.insert(entry.first);
    for (const auto& entry : static_bundles) target_frames.insert(entry.first);
    for (const std::int32_t frame_id : target_frames) {
        const auto frame = frames.find(frame_id);
        if (frame == frames.end()) {
            throw WasmArtifactFailure(
                "retained HTML target was not created by Display.add_frame");
        }
        const std::string retained_frame_id = "frame_" + std::to_string(frame_id);
        vf::JsonValue::Object rect;
        rect["x"] = vf::JsonValue(frame->second.x);
        rect["y"] = vf::JsonValue(frame->second.y);
        rect["w"] = vf::JsonValue(frame->second.w);
        rect["h"] = vf::JsonValue(frame->second.h);
        vf::JsonValue::Object flags;
        flags["draggable"] = vf::JsonValue(true);
        flags["dockable"] = vf::JsonValue(true);
        flags["resizable"] = vf::JsonValue(true);
        flags["closable"] = vf::JsonValue(true);
        flags["use_browser"] = vf::JsonValue(true);
        vf::JsonValue::Object spec;
        spec["id"] = vf::JsonValue(retained_frame_id);
        spec["title"] = vf::JsonValue("");
        spec["title_align"] = vf::JsonValue("left");
        spec["rect"] = vf::JsonValue(std::move(rect));
        spec["flags"] = vf::JsonValue(std::move(flags));
        spec["alpha"] = vf::JsonValue(1.0);
        spec["master"] = vf::JsonValue(false);
        spec["dock_location"] = vf::JsonValue("tl");
        spec["anchor"] = vf::JsonValue("tl");
        spec["body"] = vf::JsonValue(nullptr);
        spec["body_transparent"] = vf::JsonValue(false);
        spec["body_layout"] = vf::JsonValue(nullptr);
        spec["parent_id"] = vf::JsonValue(nullptr);
        spec["aspect"] = vf::JsonValue(nullptr);
        spec["frameless"] = vf::JsonValue(false);
        const auto component_tree = component_trees.find(frame_id);
        if (component_tree != component_trees.end()) {
            vf::JsonValue::Array tree;
            for (const auto& identity : component_tree->second) {
                tree.push_back(vf::JsonValue(identity));
            }
            spec["__vf_internal_html_components"] = vf::JsonValue(std::move(tree));
        }
        vf::JsonValue::Object payload;
        payload["spec"] = vf::JsonValue(std::move(spec));
        vf::JsonValue::Object command;
        command["kind"] = vf::JsonValue("frame_upsert");
        command["id"] = vf::JsonValue(retained_frame_id);
        command["payload"] = vf::JsonValue(std::move(payload));
        commands.push_back(vf::JsonValue(std::move(command)));
    }

    vf::JsonValue::Array packets;
    vf::JsonValue::Object scene_payload;
    scene_payload["commands"] = vf::JsonValue(std::move(commands));
    vf::JsonValue::Object scene;
    scene["seq"] = vf::JsonValue(1.0);
    scene["kind"] = vf::JsonValue("scene.replace");
    scene["payload"] = vf::JsonValue(std::move(scene_payload));
    packets.push_back(vf::JsonValue(std::move(scene)));
    vf::JsonValue::Object state_payload;
    state_payload["state"] = vf::JsonValue(vf::JsonValue::Object{});
    vf::JsonValue::Object state;
    state["seq"] = vf::JsonValue(2.0);
    state["kind"] = vf::JsonValue("ui_state.replace");
    state["payload"] = vf::JsonValue(std::move(state_payload));
    packets.push_back(vf::JsonValue(std::move(state)));
    vf::JsonValue::Object display_data;
    display_data["screen"] = vf::JsonValue(vf::JsonValue::Array{});
    display_data["frames"] = vf::JsonValue(vf::JsonValue::Object{});
    display_data["geom"] = vf::JsonValue(vf::JsonValue::Object{});
    vf::JsonValue::Object display_payload;
    display_payload["display"] = vf::JsonValue(std::move(display_data));
    vf::JsonValue::Object display;
    display["seq"] = vf::JsonValue(3.0);
    display["kind"] = vf::JsonValue("display.replace");
    display["payload"] = vf::JsonValue(std::move(display_payload));
    packets.push_back(vf::JsonValue(std::move(display)));

    WasmBinding packet_binding;
    packet_binding.name = "$ui$compiled$packets";
    packet_binding.kind = WasmBinding::Kind::String;
    packet_binding.string_value = vf::json_stringify(
        vf::JsonValue(std::move(packets)), -1);
    plan.bindings.push_back(std::move(packet_binding));
    for (auto& entry : static_bundles) {
        plan.static_html_bundles.push_back(std::move(entry.second));
    }
}

class TypedWorldWasmEvaluator {
public:
    explicit TypedWorldWasmEvaluator(const vf::JsonValue& root) {
        const auto& module = object_of(root, "typed World module");
        for (const auto& raw_statement : array_of(
                 field(module, "body", "typed World module"), "typed World module.body")) {
            const auto& statement = object_of(raw_statement, "typed World statement");
            const std::string kind = string_field(statement, "kind", "typed World statement");
            const auto name = statement.find("name");
            if (name == statement.end() || !name->second.is_string()) continue;
            if (kind == "function") functions_[name->second.as_string()] = &raw_statement;
            if (kind == "store_binding") bindings_[name->second.as_string()] = &raw_statement;
        }
    }

    vf::JsonValue evaluate(const vf::JsonValue& expression) {
        std::map<std::string, vf::JsonValue> locals;
        std::map<std::string, bool> active;
        return evaluate(expression, locals, active, 0);
    }

private:
    using Locals = std::map<std::string, vf::JsonValue>;

    vf::JsonValue evaluate(
        const vf::JsonValue& expression,
        Locals& locals,
        std::map<std::string, bool>& active,
        std::size_t depth
    ) {
        if (depth > 64) throw WasmArtifactFailure("typed World value evaluation exceeded its bound");
        const auto& value = object_of(expression, "typed World value expression");
        const std::string kind = string_field(value, "kind", "typed World value expression");
        if (kind == "const") return field(value, "value", "typed World const");
        if (kind == "list" || kind == "tuple") {
            vf::JsonValue::Array result;
            for (const auto& item : array_of(
                     field(value, "items", "typed World list"), "typed World list.items")) {
                result.push_back(evaluate(item, locals, active, depth + 1));
            }
            return vf::JsonValue(std::move(result));
        }
        if (kind == "record") {
            vf::JsonValue::Object result;
            for (const auto& raw_field : array_of(
                     field(value, "fields", "typed World record"), "typed World record.fields")) {
                const auto& record_field = object_of(raw_field, "typed World record field");
                const std::string name = string_field(
                    record_field, "name", "typed World record field");
                result[name] = evaluate(
                    field(record_field, "value", "typed World record field"),
                    locals,
                    active,
                    depth + 1);
            }
            return vf::JsonValue(std::move(result));
        }
        if (kind == "load") {
            const std::string name = string_field(value, "name", "typed World load");
            const auto local = locals.find(name);
            if (local != locals.end()) return local->second;
            const auto binding = bindings_.find(name);
            if (binding == bindings_.end()) {
                throw WasmArtifactFailure("typed World value references unknown binding " + name);
            }
            if (active[name]) throw WasmArtifactFailure("typed World value binding cycle at " + name);
            active[name] = true;
            const auto& binding_object = object_of(*binding->second, "typed World binding");
            vf::JsonValue result = evaluate(
                field(binding_object, "value", "typed World binding"), locals, active, depth + 1);
            active[name] = false;
            return result;
        }
        if (kind == "field_access") {
            const vf::JsonValue subject_value = evaluate(
                field(value, "object", "typed World field access"), locals, active, depth + 1);
            const auto& subject = object_of(subject_value, "typed World selected record");
            return field(
                subject,
                string_field(value, "field", "typed World field access"),
                "typed World selected record");
        }
        if (kind == "binary_op") {
            const vf::JsonValue left = evaluate(
                field(value, "left", "typed World binary op"), locals, active, depth + 1);
            const vf::JsonValue right = evaluate(
                field(value, "right", "typed World binary op"), locals, active, depth + 1);
            if (string_field(value, "op", "typed World binary op") != "STAR" ||
                !left.is_number() || !right.is_number()) {
                throw WasmArtifactFailure("typed World value only supports numeric multiplication");
            }
            return vf::JsonValue(left.as_number() * right.as_number());
        }
        if (kind == "call") {
            const auto& callee = object_of(field(value, "callee", "typed World call"), "typed World callee");
            if (string_field(callee, "kind", "typed World callee") != "load") {
                throw WasmArtifactFailure("typed World value call requires a named function");
            }
            const std::string name = string_field(callee, "name", "typed World callee");
            const auto function = functions_.find(name);
            if (function == functions_.end()) {
                throw WasmArtifactFailure("typed World value calls unknown function " + name);
            }
            const auto& function_object = object_of(*function->second, "typed World function");
            const auto& params = array_of(
                field(function_object, "params", "typed World function"), "typed World function.params");
            const auto& args = array_of(field(value, "args", "typed World call"), "typed World call.args");
            if (params.size() != args.size()) {
                throw WasmArtifactFailure("typed World value call arity mismatch for " + name);
            }
            Locals function_locals;
            for (std::size_t index = 0; index < params.size(); ++index) {
                const auto& param = object_of(params[index], "typed World parameter");
                function_locals[string_field(param, "name", "typed World parameter")] =
                    evaluate(args[index], locals, active, depth + 1);
            }
            const auto& block = object_of(
                field(function_object, "body", "typed World function"), "typed World function body");
            const auto& statements = array_of(
                field(block, "body", "typed World function body"), "typed World function statements");
            if (statements.empty()) throw WasmArtifactFailure("typed World function has no result " + name);
            const auto& tail = object_of(statements.back(), "typed World function result");
            const std::string tail_kind = string_field(tail, "kind", "typed World function result");
            const std::string result_field = tail_kind == "return" ? "value" : "expr";
            if (tail_kind != "return" && tail_kind != "expr_stmt") {
                throw WasmArtifactFailure("typed World function result must be a return or expression");
            }
            return evaluate(
                field(tail, result_field, "typed World function result"),
                function_locals,
                active,
                depth + 1);
        }
        throw WasmArtifactFailure("unsupported typed World value expression " + kind);
    }

    std::map<std::string, const vf::JsonValue*> functions_;
    std::map<std::string, const vf::JsonValue*> bindings_;
};

std::vector<double> typed_world_wasm_numbers(
    const vf::JsonValue& value,
    const std::string& context
) {
    std::vector<double> result;
    const auto flatten = [&](const auto& self, const vf::JsonValue& item) -> void {
        if (item.is_number()) {
            if (!std::isfinite(item.as_number())) throw WasmArtifactFailure(context + " must be finite");
            result.push_back(item.as_number());
            return;
        }
        if (item.is_array()) {
            for (const auto& child : item.as_array()) self(self, child);
            return;
        }
        throw WasmArtifactFailure(context + " must contain only numbers");
    };
    flatten(flatten, value);
    return result;
}

bool collect_typed_world_packet_binding(const vf::JsonValue& root_value, WasmModulePlan& plan) {
    const auto& root = object_of(root_value, "typed World root");
    const auto world_entry = root.find("__vf_internal_world");
    const auto ui_entry = root.find("ui_program");
    if (world_entry == root.end() || ui_entry == root.end()) return false;
    const auto& world_program = object_of(world_entry->second, "typed World program");
    const auto& ui_program = object_of(ui_entry->second, "typed World UI program");
    if (string_field(ui_program, "schema", "typed World UI program") != "vektor-flow/ui-program") {
        throw WasmArtifactFailure("typed World UI program has an unsupported schema");
    }
    const auto& worlds = array_of(
        field(world_program, "worlds", "typed World program"), "typed World program.worlds");
    const auto& world_operations = array_of(
        field(world_program, "operations", "typed World program"), "typed World program.operations");
    const auto& operations = array_of(
        field(ui_program, "operations", "typed World UI program"), "typed World UI operations");
    if (worlds.size() != 1 || world_operations.size() != 1 || operations.size() != 3) {
        throw WasmArtifactFailure("the first typed World presentation requires one World, object, and layer");
    }
    const auto& world = object_of(worlds.front(), "typed World definition");
    const std::int32_t world_dimension = checked_i32(
        field(world, "dimension", "typed World definition"), "typed World dimension");
    if (checked_i32(field(world_program, "version", "typed World program"), "typed World version") != 1 ||
        checked_i32(field(ui_program, "version", "typed World UI program"), "typed World UI version") != 1 ||
        checked_i32(field(world, "id", "typed World definition"), "typed World id") != 0 ||
        (world_dimension != 2 && world_dimension != 3)) {
        throw WasmArtifactFailure("the first typed World presentation requires dimension 2 or 3");
    }
    for (const std::string option : {"em", "gravity", "rigid_collisions"}) {
        const auto value = world.find(option);
        if (value == world.end() || !value->second.is_boolean() || value->second.as_boolean()) {
            throw WasmArtifactFailure(
                "the first typed World presentation requires `" + option + ":false`");
        }
    }
    const auto& add = object_of(operations[0], "typed World add");
    if (string_field(add, "kind", "typed World add") != "add" ||
        string_field(object_of(operations[1], "typed World push"), "kind", "typed World push") != "push" ||
        string_field(object_of(operations[2], "typed World show"), "kind", "typed World show") != "show") {
        throw WasmArtifactFailure("typed World presentation requires ordered add, push, show operations");
    }
    const auto& source = object_of(field(add, "source", "typed World add"), "typed World source");
    if (string_field(source, "kind", "typed World source") != "world_embedding" ||
        checked_i32(field(source, "world_id", "typed World source"), "typed World source id") != 0 ||
        checked_i32(field(source, "object_id", "typed World source"), "typed World object id") != 0) {
        throw WasmArtifactFailure("typed World layer source does not match its retained object");
    }
    const auto& world_add = object_of(world_operations.front(), "typed World object operation");
    if (string_field(world_add, "kind", "typed World object operation") != "add" ||
        checked_i32(field(world_add, "world_id", "typed World object operation"), "typed World id") != 0 ||
        checked_i32(field(world_add, "object_id", "typed World object operation"), "typed World object id") != 0 ||
        string_field(world_add, "object_type", "typed World object operation") !=
            string_field(source, "object_type", "typed World source")) {
        throw WasmArtifactFailure("typed World object operation does not match its layer source");
    }

    TypedWorldWasmEvaluator evaluator(root_value);
    std::map<std::string, std::vector<double>> values;
    const auto& channels = array_of(field(add, "channels", "typed World add"), "typed World channels");
    for (const auto& raw_channel : channels) {
        const auto& channel = object_of(raw_channel, "typed World channel");
        const std::string name = string_field(channel, "name", "typed World channel");
        if (name != "p" && name != "c" && name != "s" &&
            name != "positions" && name != "topology" &&
            name != "color" && name != "material") {
            throw WasmArtifactFailure("typed World layer contains an unsupported channel " + name);
        }
        if (values.find(name) != values.end()) {
            throw WasmArtifactFailure("typed World layer contains duplicate channel " + name);
        }
        values[name] = typed_world_wasm_numbers(
            evaluator.evaluate(field(channel, "value", "typed World channel")),
            "typed World channel " + name);
    }

    const std::string frame_id = "world_0_view_0";
    vf::JsonValue::Object rect;
    rect["x"] = vf::JsonValue(0.0);
    rect["y"] = vf::JsonValue(0.0);
    rect["w"] = vf::JsonValue(1.0);
    rect["h"] = vf::JsonValue(1.0);
    vf::JsonValue::Object flags;
    flags["draggable"] = vf::JsonValue(false);
    flags["dockable"] = vf::JsonValue(false);
    flags["resizable"] = vf::JsonValue(false);
    flags["closable"] = vf::JsonValue(false);
    flags["use_browser"] = vf::JsonValue(true);
    vf::JsonValue::Object spec;
    spec["id"] = vf::JsonValue(frame_id);
    spec["title"] = vf::JsonValue("");
    spec["title_align"] = vf::JsonValue("left");
    spec["rect"] = vf::JsonValue(std::move(rect));
    spec["flags"] = vf::JsonValue(std::move(flags));
    spec["alpha"] = vf::JsonValue(1.0);
    spec["master"] = vf::JsonValue(false);
    spec["dock_location"] = vf::JsonValue("tl");
    spec["anchor"] = vf::JsonValue("tl");
    spec["body"] = vf::JsonValue(vf::JsonValue::Array{});
    vf::JsonValue::Object frame_payload;
    frame_payload["spec"] = vf::JsonValue(std::move(spec));
    vf::JsonValue::Object frame;
    frame["kind"] = vf::JsonValue("frame_upsert");
    frame["id"] = vf::JsonValue(frame_id);
    frame["payload"] = vf::JsonValue(std::move(frame_payload));

    vf::JsonValue::Object mesh;
    std::optional<vf::JsonValue> materials;
    const bool particle_channels = values.size() == 3 &&
        values.count("p") == 1 && values.count("c") == 1 && values.count("s") == 1;
    const bool mesh_channels = values.size() == 4 &&
        values.count("positions") == 1 && values.count("topology") == 1 &&
        values.count("color") == 1 && values.count("material") == 1;
    if (particle_channels) {
        const auto& position = values["p"];
        const auto& color = values["c"];
        const auto& size = values["s"];
        if (world_dimension != 2 || position.size() != 2 ||
            color.size() != 4 || size.size() != 1) {
            throw WasmArtifactFailure(
                "the first typed World particle requires dimension 2, one position, RGBA color, and size");
        }
        vf::JsonValue::Array vertices;
        for (double value : std::vector<double>{
                 position[0], position[1], 0.0, 0.0, 0.0, 1.0,
                 color[0], color[1], color[2], color[3]}) {
            vertices.emplace_back(value);
        }
        mesh["type"] = vf::JsonValue("field_mesh");
        mesh["id"] = vf::JsonValue("world_0_layer_0");
        mesh["topology"] = vf::JsonValue("point-list");
        mesh["render_mode"] = vf::JsonValue("marker_impostor");
        mesh["marker_space"] = vf::JsonValue("world");
        mesh["mode3d"] = vf::JsonValue(false);
        mesh["vertices"] = vf::JsonValue(std::move(vertices));
        mesh["indices"] = vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(0.0)});
        mesh["vertex_size"] = vf::JsonValue(size[0]);
        mesh["depth_write"] = vf::JsonValue(false);
        mesh["no_lighting"] = vf::JsonValue(true);
        mesh["pickable"] = vf::JsonValue(true);
        mesh["layer_id"] = vf::JsonValue(0.0);
    } else if (mesh_channels) {
        if (world_dimension != 3) {
            throw WasmArtifactFailure("typed World mesh channels require dimension 3");
        }
        try {
            const auto compiled = vkf::world_mesh::compile(
                values["positions"], values["topology"],
                values["color"], values["material"]);
            mesh = object_of(
                vf::parse_json(vkf::world_mesh::mesh_json(
                    compiled, "world_0_layer_0", 0)),
                "typed World mesh packet");
            materials = vf::parse_json(vkf::world_mesh::materials_json(compiled));
        } catch (const std::exception& error) {
            throw WasmArtifactFailure(error.what());
        }
    } else {
        throw WasmArtifactFailure(
            "typed World layer requires either p/c/s or positions/topology/color/material channels");
    }
    vf::JsonValue::Object frame_geom;
    frame_geom["frame"] = vf::JsonValue(frame_id);
    frame_geom["meshes"] = vf::JsonValue(
        vf::JsonValue::Array{vf::JsonValue(std::move(mesh))});
    frame_geom["texts"] = vf::JsonValue(vf::JsonValue::Array{});
    if (materials.has_value()) frame_geom["materials"] = std::move(*materials);
    vf::JsonValue::Object geom;
    geom[frame_id] = vf::JsonValue(std::move(frame_geom));

    vf::JsonValue::Array packets;
    vf::JsonValue::Object scene_payload;
    scene_payload["commands"] = vf::JsonValue(
        vf::JsonValue::Array{vf::JsonValue(std::move(frame))});
    vf::JsonValue::Object scene;
    scene["seq"] = vf::JsonValue(1.0);
    scene["kind"] = vf::JsonValue("scene.replace");
    scene["payload"] = vf::JsonValue(std::move(scene_payload));
    packets.emplace_back(std::move(scene));
    vf::JsonValue::Object state_payload;
    state_payload["state"] = vf::JsonValue(vf::JsonValue::Object{});
    vf::JsonValue::Object state;
    state["seq"] = vf::JsonValue(2.0);
    state["kind"] = vf::JsonValue("ui_state.replace");
    state["payload"] = vf::JsonValue(std::move(state_payload));
    packets.emplace_back(std::move(state));
    vf::JsonValue::Object display_data;
    display_data["screen"] = vf::JsonValue(vf::JsonValue::Array{});
    display_data["frames"] = vf::JsonValue(vf::JsonValue::Object{});
    display_data["geom"] = vf::JsonValue(std::move(geom));
    vf::JsonValue::Object display_payload;
    display_payload["display"] = vf::JsonValue(std::move(display_data));
    vf::JsonValue::Object display;
    display["seq"] = vf::JsonValue(3.0);
    display["kind"] = vf::JsonValue("display.replace");
    display["payload"] = vf::JsonValue(std::move(display_payload));
    packets.emplace_back(std::move(display));

    WasmBinding binding;
    binding.name = "$ui$compiled$packets";
    binding.kind = WasmBinding::Kind::String;
    binding.string_value = vf::json_stringify(vf::JsonValue(std::move(packets)), -1);
    plan.bindings.push_back(std::move(binding));
    return true;
}

void collect_owner_event_poll_binding(
    const vf::JsonValue& root_value,
    WasmModulePlan& plan
) {
    const auto& root = object_of(root_value, "typed IR root");
    vf::JsonValue::Array polls;
    for (const auto& raw_statement : array_of(
             field(root, "body", "typed IR root"), "typed IR root.body")) {
        const auto& statement = object_of(raw_statement, "typed IR statement");
        if (string_field(statement, "kind", "typed IR statement") != "store_binding") {
            continue;
        }
        const auto& value = object_of(
            field(statement, "value", "typed IR store_binding"),
            "typed IR store_binding.value");
        if (string_field(value, "kind", "typed IR store_binding.value") !=
            "ui_owner_event_get") {
            continue;
        }
        const auto& owner = object_of(
            field(value, "owner", "owner event poll"), "owner event poll owner");
        const std::string owner_kind = string_field(value, "owner_kind", "owner event poll");
        const std::string poll_type = string_field(value, "type", "owner event poll");
        const std::string owner_type = string_field(owner, "type", "owner event poll owner");
        const bool button_poll = owner_kind == "Button" &&
            poll_type == "ButtonEvent|null" && owner_type == "ui_component<Button>";
        const bool slider_poll = owner_kind == "Input" &&
            poll_type == "SliderEvent|null" && owner_type == "ui_component<Input>";
        if ((!button_poll && !slider_poll) ||
            string_field(owner, "kind", "owner event poll owner") != "load") {
            throw WasmArtifactFailure("malformed internal component owner event poll");
        }
        vf::JsonValue::Object descriptor;
        descriptor["binding"] = field(statement, "name", "owner event poll binding");
        descriptor["poll"] = vf::JsonValue(value);
        polls.push_back(vf::JsonValue(std::move(descriptor)));
    }
    if (polls.empty()) return;

    WasmBinding binding;
    binding.name = "$ui$owner$event$polls";
    binding.kind = WasmBinding::Kind::String;
    binding.string_value = vf::json_stringify(vf::JsonValue(std::move(polls)), -1);
    plan.bindings.push_back(std::move(binding));
}

void collect_owner_event_loop_binding(
    const vf::JsonValue& root_value,
    WasmModulePlan& plan
) {
    const auto& root = object_of(root_value, "typed IR root");
    vf::JsonValue::Array loops;
    for (const auto& raw_statement : array_of(
             field(root, "body", "typed IR root"), "typed IR root.body")) {
        const auto& statement = object_of(raw_statement, "typed IR statement");
        if (string_field(statement, "kind", "typed IR statement") != "expr_stmt") {
            continue;
        }
        const auto& loop = object_of(
            field(statement, "expr", "typed IR expression statement"),
            "typed IR expression statement.expr");
        const std::string expression_kind = string_field(
            loop, "kind", "typed IR expression");
        if (expression_kind == "match_stmt") {
            const auto& repeats = field(loop, "loop", "typed IR match statement");
            const auto& discriminant = object_of(
                field(loop, "discriminant", "typed IR match statement"),
                "typed IR match discriminant");
            if (repeats.is_boolean() && repeats.as_boolean() &&
                string_field(discriminant, "kind", "typed IR match discriminant") ==
                    "bind_expr" &&
                field(discriminant, "value", "typed IR match discriminant").is_object() &&
                string_field(
                    object_of(field(discriminant, "value", "typed IR match discriminant"),
                              "typed IR match value"),
                    "kind", "typed IR match value") == "ui_owner_event_get") {
                throw WasmArtifactFailure("unsupported internal owner event loop");
            }
        }
        if (expression_kind != "ui_owner_event_loop") {
            continue;
        }
        const std::string binding_name = string_field(
            loop, "binding", "owner event loop");
        if (binding_name.empty()) {
            throw WasmArtifactFailure("malformed internal owner event loop binding");
        }
        const auto& poll = object_of(
            field(loop, "poll", "owner event loop"), "owner event loop poll");
        const auto& owner = object_of(
            field(poll, "owner", "owner event loop poll"), "owner event loop owner");
        const std::string owner_kind = string_field(
            poll, "owner_kind", "owner event loop poll");
        const std::string poll_type = string_field(
            poll, "type", "owner event loop poll");
        const std::string owner_type = string_field(
            owner, "type", "owner event loop owner");
        const bool button_poll = owner_kind == "Button" &&
            poll_type == "ButtonEvent|null" && owner_type == "ui_component<Button>";
        const bool slider_poll = owner_kind == "Input" &&
            poll_type == "SliderEvent|null" && owner_type == "ui_component<Input>";
        const bool display_poll = owner_kind == "Display" &&
            poll_type == "DisplayEvent|null" && owner_type == "Display<2>";
        if (string_field(poll, "kind", "owner event loop poll") != "ui_owner_event_get" ||
            string_field(owner, "kind", "owner event loop owner") != "load" ||
            (!button_poll && !slider_poll && !display_poll)) {
            throw WasmArtifactFailure("malformed internal owner event loop poll");
        }

        vf::JsonValue::Array event_types;
        const auto& arms = array_of(field(loop, "arms", "owner event loop"),
                                    "owner event loop arms");
        if (arms.empty()) {
            throw WasmArtifactFailure("malformed internal owner event loop arms");
        }
        for (const auto& raw_arm : arms) {
            const auto& arm = object_of(raw_arm, "owner event loop arm");
            const std::string event_type = string_field(
                arm, "event_type", "owner event loop arm");
            if (string_field(arm, "kind", "owner event loop arm") !=
                    "ui_owner_event_arm" ||
                (event_type != "ButtonEvent" && event_type != "ButtonClicked" &&
                 event_type != "SliderEvent" && event_type != "SliderValueChanged") ||
                !field(arm, "body", "owner event loop arm").is_object()) {
                throw WasmArtifactFailure("malformed internal owner event loop arm");
            }
            event_types.emplace_back(event_type);
        }
        vf::JsonValue::Object descriptor;
        descriptor["binding"] = vf::JsonValue(binding_name);
        descriptor["poll"] = vf::JsonValue(poll);
        descriptor["event_types"] = vf::JsonValue(std::move(event_types));
        loops.emplace_back(std::move(descriptor));
    }
    if (loops.empty()) return;

    WasmBinding binding;
    binding.name = "$ui$owner$event$loops";
    binding.kind = WasmBinding::Kind::String;
    binding.string_value = vf::json_stringify(vf::JsonValue(std::move(loops)), -1);
    plan.bindings.push_back(std::move(binding));
}

WasmModulePlan collect_module_plan(
    const vf::JsonValue& root,
    const std::filesystem::path& source_path
) {
    auto filtered_root = object_of(root, "typed IR root");
    vf::JsonValue::Array filtered_body;
    for (const auto& item : array_of(field(filtered_root, "body", "typed IR root"), "typed IR root.body")) {
        const auto& declaration = object_of(item, "typed IR declaration");
        if (string_field(declaration, "kind", "typed IR declaration") != "module_import") {
            filtered_body.push_back(item);
        }
    }
    filtered_root["body"] = vf::JsonValue(std::move(filtered_body));
    WasmModulePlan plan;
    if (collect_typed_world_packet_binding(root, plan)) return plan;
    try {
        const auto source_text = read_file(source_path);
        const auto lowered = vkf::native_scene::lower_source(
            source_text, source_path);
        if (lowered.has_value()) {
            collect_lowered_scene_arena_bindings(*lowered, plan);
            for (const auto& load :
                 vkf::retained_scene::static_html_loads(root)) {
                const std::filesystem::path resource_path(load.resource);
                if (resource_path.is_absolute()) {
                    throw WasmArtifactFailure(
                        "Frame.load resource path must be source-relative");
                }
                plan.static_html_bundles.push_back(vf::static_html::collect(
                    source_path,
                    source_path.parent_path() / resource_path,
                    load.frame_id));
            }
            collect_owner_event_poll_binding(root, plan);
            collect_owner_event_loop_binding(root, plan);
            return plan;
        }
    } catch (const vkf::native_scene::Error& error) {
        throw WasmArtifactFailure(error.what());
    } catch (const vf::static_html::Error& error) {
        throw WasmArtifactFailure(error.what());
    }
    // A retained native scene is a compiler-owned structured artifact, not a
    // scalar computed binding. Compile it before the generic binding walk so
    // nested records/vectors are lowered once into the retained scene packet
    // arena instead of being interpreted as runtime arithmetic.
    if (collect_retained_scene_packet_binding(root, source_path, plan)) {
        collect_owner_event_poll_binding(root, plan);
        collect_owner_event_loop_binding(root, plan);
        return plan;
    }
    const auto module = vkf::wasm::parse_typed_module(vf::JsonValue(std::move(filtered_root)));
    for (const auto& item : module.items) {
        if (item.kind == vkf::wasm::ModuleItemKind::TypeAlias
            || item.kind == vkf::wasm::ModuleItemKind::ExpressionStatement) {
            continue;
        }
        if (item.kind == vkf::wasm::ModuleItemKind::RuntimeBinding) {
            const auto& stmt = object_of(
                module.runtime_bindings[item.category_index].declaration,
                "typed IR runtime binding"
            );
            const auto& value = object_of(
                field(stmt, "value", "typed IR runtime binding"),
                "typed IR runtime binding.value");
            if (string_field(value, "kind", "typed IR runtime binding.value") ==
                "ui_owner_event_get") {
                continue;
            }
            try {
                plan.bindings.push_back(binding_from_store(stmt, plan.bindings));
            } catch (const WasmArtifactFailure&) {
                // Imported and structured `any` values remain in the dependency
                // module; scalar runtime kernels are emitted by the symbolic
                // bytecode artifact path.
                if (string_field(stmt, "type", "typed IR runtime binding") == "any") continue;
                throw;
            }
            continue;
        }
        if (item.kind == vkf::wasm::ModuleItemKind::Function) {
            const auto& stmt = object_of(
                module.functions[item.category_index].declaration,
                "typed IR function"
            );
            if (plan.update.enabled) {
                throw WasmArtifactFailure("only one wasm vkf_update function is supported");
            }
            if (parse_update_function(stmt, plan.bindings, plan.update)) {
                continue;
            }
            throw WasmArtifactFailure(
                "unsupported typed IR function "
                + module.functions[item.category_index].name
                + " for wasm artifact emission"
            );
        }
        throw WasmArtifactFailure("unsupported typed IR module item for wasm artifact emission");
    }
    collect_retained_html_packet_binding(root, source_path, plan);
    collect_owner_event_poll_binding(root, plan);
    collect_owner_event_loop_binding(root, plan);
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
        } else if (binding.kind == WasmBinding::Kind::Bytes) {
            next_offset = (next_offset + 3u) & ~3u;
            binding.string_offset = next_offset;
            next_offset += static_cast<std::uint32_t>(binding.byte_values.size());
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
    append_u32_leb(type_section, 5);
    append_u8(type_section, 0x60); append_u32_leb(type_section, 0); append_u32_leb(type_section, 0);
    append_u8(type_section, 0x60); append_u32_leb(type_section, 0); append_u32_leb(type_section, 1); append_u8(type_section, 0x7F);
    append_u8(type_section, 0x60); append_u32_leb(type_section, 0); append_u32_leb(type_section, 1); append_u8(type_section, 0x7C);
    append_u8(type_section, 0x60); append_u32_leb(type_section, 1); append_u8(type_section, 0x7F);
    append_u32_leb(type_section, 1); append_u8(type_section, 0x7F);
    append_u8(type_section, 0x60); append_u32_leb(type_section, 3);
    append_u8(type_section, 0x7F); append_u8(type_section, 0x7F);
    append_u8(type_section, 0x7F); append_u32_leb(type_section, 0);
    append_section(module, 1, type_section);

    struct FunctionSpec {
        std::string export_name;
        std::uint32_t type_index;
        enum class BodyKind {
            Noop,
            ResetTick,
            IncrementTick,
            I32Const,
            F64Const,
            CameraControl,
            SetSymbolicInputLength,
            TraceSymbolicText,
        } body_kind;
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
            || binding.kind == WasmBinding::Kind::Bytes
            || binding.kind == WasmBinding::Kind::I32Array
            || binding.kind == WasmBinding::Kind::F64Array) {
            binding.string_offset += data_offset;
        }
    }
    const std::uint32_t symbolic_lengths_offset = (data_offset + next_offset + 3u) & ~3u;
    const std::uint32_t symbolic_input_length_offset = symbolic_lengths_offset;
    const std::uint32_t symbolic_output_length_offset = symbolic_lengths_offset + 4u;
    const std::uint32_t symbolic_input_offset = symbolic_lengths_offset + 8u;
    const std::uint32_t symbolic_output_offset = symbolic_input_offset + symbolic_text_capacity;
    const std::uint32_t memory_size = symbolic_output_offset + symbolic_text_capacity;
    const WasmBinding* render_parameters = find_binding(
        bindings, "$ui$compiled$render$parameter$arena");
    const bool has_camera_controls = render_parameters != nullptr &&
        !plan.render_parameter_sections.empty() &&
        render_parameters->byte_values.size() >= 36;

    functions.push_back({"vkf_init", 0, FunctionSpec::BodyKind::ResetTick});
    functions.push_back({"vkf_update", 0, FunctionSpec::BodyKind::IncrementTick});
    functions.push_back({"vkf_shutdown", 0, FunctionSpec::BodyKind::Noop});
    if (has_camera_controls) {
        functions.push_back({"vkf_camera_control", 4,
            FunctionSpec::BodyKind::CameraControl});
    }
    functions.push_back({"vkf_state_ptr", 1, FunctionSpec::BodyKind::I32Const, 0});
    functions.push_back({"vkf_state_size", 1, FunctionSpec::BodyKind::I32Const, static_cast<std::int32_t>(state_size)});
    functions.push_back({"vkf_input_ptr", 1, FunctionSpec::BodyKind::I32Const, static_cast<std::int32_t>(input_offset)});
    functions.push_back({"vkf_input_size", 1, FunctionSpec::BodyKind::I32Const, static_cast<std::int32_t>(input_size)});
    functions.push_back({"vkf_symbolic_input_ptr", 1, FunctionSpec::BodyKind::I32Const,
        static_cast<std::int32_t>(symbolic_input_offset)});
    functions.push_back({"vkf_symbolic_input_capacity", 1, FunctionSpec::BodyKind::I32Const,
        static_cast<std::int32_t>(symbolic_text_capacity)});
    functions.push_back({"vkf_symbolic_input_len", 1, FunctionSpec::BodyKind::I32Const,
        static_cast<std::int32_t>(symbolic_input_length_offset)});
    functions.back().body_kind = FunctionSpec::BodyKind::I32Const;
    functions.push_back({"vkf_symbolic_set_input_len", 3, FunctionSpec::BodyKind::SetSymbolicInputLength});
    functions.push_back({"vkf_symbolic_output_ptr", 1, FunctionSpec::BodyKind::I32Const,
        static_cast<std::int32_t>(symbolic_output_offset)});
    functions.push_back({"vkf_symbolic_output_capacity", 1, FunctionSpec::BodyKind::I32Const,
        static_cast<std::int32_t>(symbolic_text_capacity)});
    functions.push_back({"vkf_symbolic_output_len", 1, FunctionSpec::BodyKind::I32Const,
        static_cast<std::int32_t>(symbolic_output_length_offset)});
    functions.back().body_kind = FunctionSpec::BodyKind::I32Const;
    functions.push_back({"vkf_symbolic_trace", 1, FunctionSpec::BodyKind::TraceSymbolicText});
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
        } else if (binding.kind == WasmBinding::Kind::Bytes) {
            functions.push_back({"vkf_get_" + suffix + "_ptr", 1, FunctionSpec::BodyKind::I32Const,
                static_cast<std::int32_t>(binding.string_offset)});
            functions.push_back({"vkf_get_" + suffix + "_len", 1, FunctionSpec::BodyKind::I32Const,
                static_cast<std::int32_t>(binding.byte_values.size())});
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
    append_u32_leb(memory_section, std::max(1u, (memory_size + 65535u) / 65536u));
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
            for (std::uint32_t length_offset : {
                symbolic_input_length_offset,
                symbolic_output_length_offset,
            }) {
                append_u8(body, 0x41);
                append_i32_leb(body, static_cast<std::int32_t>(length_offset));
                append_u8(body, 0x41);
                append_i32_leb(body, 0);
                append_u8(body, 0x36);
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
            }
        } else if (function.body_kind == FunctionSpec::BodyKind::IncrementTick) {
            if (plan.update.enabled && plan.update.axis_vector_mode) {
                append_u32_leb(body, plan.temporal_parameter_updates.empty() ? 0 : 1);
                if (!plan.temporal_parameter_updates.empty()) {
                    append_u32_leb(body, 1);
                    append_u8(body, 0x7D);
                }
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
                append_u32_leb(body, plan.temporal_parameter_updates.empty() ? 0 : 1);
                if (!plan.temporal_parameter_updates.empty()) {
                    append_u32_leb(body, 1);
                    append_u8(body, 0x7D);
                }
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
                append_u32_leb(body, plan.temporal_parameter_updates.empty() ? 0 : 1);
                if (!plan.temporal_parameter_updates.empty()) {
                    append_u32_leb(body, 1);
                    append_u8(body, 0x7D);
                }
                append_u8(body, 0x41);
                append_i32_leb(body, 0);
                emit_update_expr(body, plan.update.scalar_expr, bindings, input_offset, &plan.update);
                append_u8(body, 0x36);
                append_u32_leb(body, 2);
                append_u32_leb(body, 0);
            } else {
                append_u32_leb(body,
                    plan.temporal_parameter_updates.empty() ? 1 : 2);
                append_u32_leb(body, 1);
                append_u8(body, 0x7F);
                if (!plan.temporal_parameter_updates.empty()) {
                    append_u32_leb(body, 1);
                    append_u8(body, 0x7D);
                }
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
            if (!plan.temporal_parameter_updates.empty()) {
                if (render_parameters == nullptr) {
                    throw WasmArtifactFailure(
                        "temporal positions require the render parameter arena");
                }
                emit_temporal_parameter_updates(
                    body,
                    plan.temporal_parameter_updates,
                    render_parameters->string_offset,
                    plan.update.enabled ? 0u : 1u);
            }
        } else if (function.body_kind == FunctionSpec::BodyKind::CameraControl) {
            emit_camera_control_body(body, render_parameters->string_offset);
        } else if (function.body_kind == FunctionSpec::BodyKind::SetSymbolicInputLength) {
            append_u32_leb(body, 0);
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_input_length_offset));
            append_u8(body, 0x20);
            append_u32_leb(body, 0);
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_text_capacity));
            append_u8(body, 0x4B);
            append_u8(body, 0x04);
            append_u8(body, 0x7F);
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_text_capacity));
            append_u8(body, 0x05);
            append_u8(body, 0x20);
            append_u32_leb(body, 0);
            append_u8(body, 0x0B);
            append_u8(body, 0x36);
            append_u32_leb(body, 2);
            append_u32_leb(body, 0);
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_input_length_offset));
            append_u8(body, 0x28);
            append_u32_leb(body, 2);
            append_u32_leb(body, 0);
        } else if (function.body_kind == FunctionSpec::BodyKind::TraceSymbolicText) {
            append_u32_leb(body, 0);
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_output_offset));
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_input_offset));
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_input_length_offset));
            append_u8(body, 0x28);
            append_u32_leb(body, 2);
            append_u32_leb(body, 0);
            append_u8(body, 0xFC);
            append_u32_leb(body, 10);
            append_u32_leb(body, 0);
            append_u32_leb(body, 0);
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_output_length_offset));
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_input_length_offset));
            append_u8(body, 0x28);
            append_u32_leb(body, 2);
            append_u32_leb(body, 0);
            append_u8(body, 0x36);
            append_u32_leb(body, 2);
            append_u32_leb(body, 0);
            append_u8(body, 0x41);
            append_i32_leb(body, static_cast<std::int32_t>(symbolic_output_length_offset));
            append_u8(body, 0x28);
            append_u32_leb(body, 2);
            append_u32_leb(body, 0);
        } else {
            append_u32_leb(body, 0);
        }
        if (function.body_kind == FunctionSpec::BodyKind::I32Const
            && (function.export_name == "vkf_symbolic_input_len"
                || function.export_name == "vkf_symbolic_output_len")) {
            append_u8(body, 0x41);
            append_i32_leb(body, function.i32_value);
            append_u8(body, 0x28);
            append_u32_leb(body, 2);
            append_u32_leb(body, 0);
        } else if (function.body_kind == FunctionSpec::BodyKind::I32Const) {
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
                || binding.kind == WasmBinding::Kind::Bytes
                || binding.kind == WasmBinding::Kind::I32Array
                || binding.kind == WasmBinding::Kind::F64Array) {
                ++segment_count;
            }
        }
        append_u32_leb(data_section, segment_count);
        for (const auto& binding : bindings) {
            if (binding.kind != WasmBinding::Kind::String
                && binding.kind != WasmBinding::Kind::Bytes
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
            } else if (binding.kind == WasmBinding::Kind::Bytes) {
                append_u32_leb(data_section, static_cast<std::uint32_t>(binding.byte_values.size()));
                append_bytes(data_section, binding.byte_values);
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
    const UpdateFunctionPlan& update_plan,
    bool has_retained_scene_arena,
    bool has_temporal_playback,
    const vf::JsonValue::Array& temporal_parameter_sections,
    const vf::JsonValue::Array& render_parameter_sections,
    const vf::JsonValue::Array& render_parameter_draw_lists
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
    vf::JsonValue::Object symbolic_text;
    symbolic_text["input_ptr_export"] = vf::JsonValue("vkf_symbolic_input_ptr");
    symbolic_text["input_capacity_export"] = vf::JsonValue("vkf_symbolic_input_capacity");
    symbolic_text["input_len_export"] = vf::JsonValue("vkf_symbolic_input_len");
    symbolic_text["set_input_len_export"] = vf::JsonValue("vkf_symbolic_set_input_len");
    symbolic_text["output_ptr_export"] = vf::JsonValue("vkf_symbolic_output_ptr");
    symbolic_text["output_capacity_export"] = vf::JsonValue("vkf_symbolic_output_capacity");
    symbolic_text["output_len_export"] = vf::JsonValue("vkf_symbolic_output_len");
    symbolic_text["trace_export"] = vf::JsonValue("vkf_symbolic_trace");
    symbolic_text["encoding"] = vf::JsonValue("utf-8");
    runtime_surface["symbolic_text"] = vf::JsonValue(std::move(symbolic_text));
    runtime_surface["update_mode"] = vf::JsonValue(
        update_plan.axis_vector_mode ? (update_plan.axis_input_vector ? "axis_vector_vector" : "axis_vector_scalar")
        : (update_plan.record_mode ? "record" : (update_plan.enabled ? "scalar" : "builtin"))
    );
    if (has_temporal_playback) {
        runtime_surface["temporal_playback"] = vf::JsonValue(
            vf::JsonValue::Object{
                {"schema", vf::JsonValue(
                    "vektor-flow/layer-time-playback")},
                {"version", vf::JsonValue(1.0)},
                {"changed_parameter_sections", vf::JsonValue(
                    temporal_parameter_sections)},
            });
    }
    vf::JsonValue::Array exports;
    exports.push_back(vf::JsonValue("vkf_init"));
    exports.push_back(vf::JsonValue("vkf_update"));
    exports.push_back(vf::JsonValue("vkf_shutdown"));
    if (!render_parameter_sections.empty()) {
        exports.push_back(vf::JsonValue("vkf_camera_control"));
        runtime_surface["camera_controls"] = vf::JsonValue(
            vf::JsonValue::Object{
                {"schema", vf::JsonValue(
                    "vektor-flow/camera-control")},
                {"version", vf::JsonValue(1.0)},
                {"export", vf::JsonValue("vkf_camera_control")},
            });
    }
    exports.push_back(vf::JsonValue("vkf_state_ptr"));
    exports.push_back(vf::JsonValue("vkf_state_size"));
    exports.push_back(vf::JsonValue("vkf_input_ptr"));
    exports.push_back(vf::JsonValue("vkf_input_size"));
    exports.push_back(vf::JsonValue("vkf_symbolic_input_ptr"));
    exports.push_back(vf::JsonValue("vkf_symbolic_input_capacity"));
    exports.push_back(vf::JsonValue("vkf_symbolic_input_len"));
    exports.push_back(vf::JsonValue("vkf_symbolic_set_input_len"));
    exports.push_back(vf::JsonValue("vkf_symbolic_output_ptr"));
    exports.push_back(vf::JsonValue("vkf_symbolic_output_capacity"));
    exports.push_back(vf::JsonValue("vkf_symbolic_output_len"));
    exports.push_back(vf::JsonValue("vkf_symbolic_trace"));
    vf::JsonValue::Array binding_exports;
    std::string retained_metadata_ptr_export;
    std::string retained_metadata_len_export;
    std::string retained_arena_ptr_export;
    std::string retained_arena_len_export;
    std::string render_parameters_ptr_export;
    std::string render_parameters_len_export;
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
            if (binding.name == "native_scene") {
                retained_metadata_ptr_export = "vkf_get_" + suffix + "_ptr";
                retained_metadata_len_export = "vkf_get_" + suffix + "_len";
            }
        } else if (binding.kind == WasmBinding::Kind::Bytes) {
            binding_export["kind"] = vf::JsonValue("bytes");
            binding_export["ptr_export"] = vf::JsonValue("vkf_get_" + suffix + "_ptr");
            binding_export["len_export"] = vf::JsonValue("vkf_get_" + suffix + "_len");
            exports.push_back(vf::JsonValue("vkf_get_" + suffix + "_ptr"));
            exports.push_back(vf::JsonValue("vkf_get_" + suffix + "_len"));
            if (binding.name == "$ui$compiled$scene$arena") {
                retained_arena_ptr_export = "vkf_get_" + suffix + "_ptr";
                retained_arena_len_export = "vkf_get_" + suffix + "_len";
            } else if (
                binding.name == "$ui$compiled$render$parameter$arena") {
                render_parameters_ptr_export = "vkf_get_" + suffix + "_ptr";
                render_parameters_len_export = "vkf_get_" + suffix + "_len";
            }
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
    if (has_retained_scene_arena) {
        if (retained_metadata_ptr_export.empty() || retained_metadata_len_export.empty() ||
            retained_arena_ptr_export.empty() || retained_arena_len_export.empty()) {
            throw WasmArtifactFailure("retained scene arena exports are incomplete");
        }
        runtime_surface["retained_scene_arena"] = vf::JsonValue(vf::JsonValue::Object{
            {"schema", vf::JsonValue("vektor-flow/retained-scene-arena")},
            {"version", vf::JsonValue(1.0)},
            {"metadata_encoding", vf::JsonValue("utf-8")},
            {"byte_offsets", vf::JsonValue("relative_to_arena_ptr")},
            {"metadata_ptr_export", vf::JsonValue(retained_metadata_ptr_export)},
            {"metadata_len_export", vf::JsonValue(retained_metadata_len_export)},
            {"arena_ptr_export", vf::JsonValue(retained_arena_ptr_export)},
            {"arena_len_export", vf::JsonValue(retained_arena_len_export)},
        });
    }
    if (!render_parameter_sections.empty()) {
        if (render_parameters_ptr_export.empty() ||
            render_parameters_len_export.empty()) {
            throw WasmArtifactFailure(
                "render parameter arena exports are incomplete");
        }
        runtime_surface["render_parameter_arena"] = vf::JsonValue(
            vf::JsonValue::Object{
                {"schema", vf::JsonValue(
                    "vektor-flow/render-parameter-arena")},
                {"version", vf::JsonValue(1.0)},
                {"memory_export", vf::JsonValue("memory")},
                {"ptr_export", vf::JsonValue(render_parameters_ptr_export)},
                {"len_export", vf::JsonValue(render_parameters_len_export)},
                {"scalar_storage", vf::JsonValue("float32")},
                {"byte_order", vf::JsonValue("little-endian")},
                {"sections", vf::JsonValue(render_parameter_sections)},
                {"draw_lists", vf::JsonValue(render_parameter_draw_lists)},
            });
    }
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
        auto plan = collect_module_plan(typed_ir, std::filesystem::absolute(args.source));
        const std::vector<std::uint8_t> wasm_bytes = build_wasm_module(plan);

        const std::string source_hash = stable_hash(source_text);
        const std::string typed_ir_hash = stable_hash(typed_ir_text);
        const std::string artifact_hash = stable_hash_bytes(wasm_bytes);
        std::vector<Dependency> dependencies;
        for (const auto& dependency : args.dependencies) {
            dependencies.push_back({dependency.first, dependency.second, stable_hash(read_file(dependency.second))});
        }

        const std::string artifact_stem = artifact_stem_of(args.source);
        const auto build_dir = repo_root_from_source(args.source) / ".vkfbuild" / artifact_stem;
        const auto manifest_path = build_dir / "wasm-manifest.json";
        const auto artifact_path = build_dir / (artifact_stem + ".wasm");
        std::string manifest_material = manifest_key(
            source_hash, typed_ir_hash, artifact_hash, dependencies, artifact_path);
        for (const auto& bundle : plan.static_html_bundles) {
            manifest_material += "\nstatic-html\n" + bundle.frame_id + "\n" + bundle.entry;
        }
        if (!plan.event_program_json.empty()) {
            manifest_material += "\nretained-event-program\n" + plan.event_program_json;
        }
        const std::string desired_manifest_hash = stable_hash(manifest_material);

        std::filesystem::create_directories(build_dir);
        std::string status = "compiled";
        const bool artifact_current = std::filesystem::exists(artifact_path)
            && stable_hash(read_file(artifact_path)) == artifact_hash;
        if (existing_manifest_hash(manifest_path) == desired_manifest_hash && artifact_current) {
            status = "current";
        } else {
            write_bytes(artifact_path, wasm_bytes);
        }

        if (!plan.static_html_bundles.empty()) {
            vf::JsonValue::Array mounts;
            for (const auto& bundle : plan.static_html_bundles) {
                vf::JsonValue::Object mount;
                mount["frame_id"] = vf::JsonValue(bundle.frame_id);
                mount["resource"] = vf::JsonValue(bundle.entry);
                mounts.push_back(vf::JsonValue(std::move(mount)));
                for (const auto& resource : bundle.resources) {
                    const std::filesystem::path output = build_dir / resource.name;
                    std::filesystem::create_directories(output.parent_path());
                    write_text(output, resource.bytes);
                }
            }
            write_text(
                build_dir / "vf-static-html-loads.json",
                vf::json_stringify(vf::JsonValue(std::move(mounts)), 2) + "\n");
        }
        if (!plan.event_program_json.empty()) {
            write_text(build_dir / "vf-event-program.json", plan.event_program_json + "\n");
        }

        vf::JsonValue::Array temporal_parameter_sections;
        std::set<std::string> seen_temporal_sections;
        for (const auto& update : plan.temporal_parameter_updates) {
            for (const auto& target : update.targets) {
                if (seen_temporal_sections.insert(target.section).second) {
                    temporal_parameter_sections.emplace_back(target.section);
                }
            }
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
            plan.update,
            plan.has_retained_scene_arena,
            !plan.temporal_parameter_updates.empty(),
            temporal_parameter_sections,
            plan.render_parameter_sections,
            plan.render_parameter_draw_lists
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
