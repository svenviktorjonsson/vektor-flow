#pragma once

#include "compiler/native/vkf_compiled_geometry_packet.hpp"
#include "compiler/native/vkf_retained_scene_arena.hpp"
#include "compiler/native/vkf_retained_scene_packet.hpp"
#include "compiler/native/vkf_wasm_value_layout.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <string>
#include <map>

namespace vkf::ui_effect_packets {

class Reader {
public:
    Reader(const std::uint8_t* memory, std::size_t size)
        : memory_(memory), size_(size) {}

    vf::JsonValue::Array extract(std::uint32_t output_pointer,
                                 double width, double height) const {
        require_tag(output_pointer, wasm::values::Tag::Array, "UI output root");
        const auto count = u32(output_pointer + wasm::values::length_offset);
        const auto payload = u32(output_pointer + wasm::values::payload_offset);
        range(payload, static_cast<std::size_t>(count) * wasm::values::pointer_size);
        std::size_t displays = 0;
        std::size_t frames = 0;
        vf::JsonValue::Array packets;
        for (std::uint32_t index = 0; index < count; ++index) {
            const auto effect = u32(payload + index * wasm::values::pointer_size);
            if (tag(effect) != wasm::values::Tag::UiEffect) continue;
            const auto values = pointers(effect, "UI effect");
            if (values.empty() || (values.size() & 1U) == 0U) {
                throw std::runtime_error("compiler-owned UI effect payload is malformed");
            }
            const auto kind = string(values[0], "UI effect kind");
            vf::JsonValue::Object properties;
            for (std::size_t operand = 1; operand < values.size(); operand += 2) {
                const auto name = string(values[operand], "UI effect operand name");
                if (!properties.emplace(name, value(values[operand + 1], name)).second) {
                    throw std::runtime_error("duplicate compiler-owned UI effect operand " + name);
                }
            }
            // Retained-scene identity is compiler-private routing metadata, not
            // a legacy geometry operand.
            properties.erase("operation_index");
            properties.erase("display_id");
            if (kind == "display") {
                if (!properties.empty()) throw std::runtime_error("Display runtime effect has unexpected operands");
                ++displays;
            } else if (kind == "add_frame") {
                if (displays == 0) throw std::runtime_error("Display.add_frame ran before Display");
                require_vec2(properties, "pos");
                require_vec2(properties, "size");
                ++frames;
            } else if (kind == "add") {
                if (frames == 0) throw std::runtime_error("Frame.add ran before Display.add_frame");
                auto packet = compiled_geometry::build_u_curve(properties, width, height);
                vf::JsonValue::Array arena;
                arena.reserve(packet.packed.arena_bytes.size());
                for (const auto byte : packet.packed.arena_bytes) arena.emplace_back(static_cast<double>(byte));
                packets.emplace_back(vf::JsonValue::Object{
                    {"metadata", vf::parse_json(packet.packed.metadata_json)},
                    {"arena", vf::JsonValue(std::move(arena))},
                    {"layout", std::move(packet.layout)},
                });
            } else {
                throw std::runtime_error("unsupported compiler-owned UI runtime effect " + kind);
            }
        }
        return packets;
    }

    vf::JsonValue::Array extract_retained(
        std::uint32_t output_pointer,
        const vf::JsonValue& typed_ir
    ) const {
        const auto& root = typed_ir.as_object();
        const auto program = root.find("ui_program");
        if (program == root.end() || !program->second.is_object()) return {};
        const auto operations_value = program->second.as_object().find("operations");
        if (operations_value == program->second.as_object().end()
            || !operations_value->second.is_array()) {
            throw std::runtime_error("compiler-owned retained UI operations are missing");
        }
        const auto& operations = operations_value->second.as_array();
        struct Frame {
            std::uint32_t id = 0;
            vf::JsonValue::Array meshes;
        };
        std::map<std::uint32_t, Frame> frames;

        require_tag(output_pointer, wasm::values::Tag::Array, "UI output root");
        const auto count = u32(output_pointer + wasm::values::length_offset);
        const auto payload = u32(output_pointer + wasm::values::payload_offset);
        range(payload, static_cast<std::size_t>(count) * wasm::values::pointer_size);
        for (std::uint32_t index = 0; index < count; ++index) {
            const auto effect = u32(payload + index * wasm::values::pointer_size);
            if (tag(effect) != wasm::values::Tag::UiEffect) continue;
            const auto values = pointers(effect, "UI effect");
            if (values.empty() || (values.size() & 1U) == 0U) {
                throw std::runtime_error("compiler-owned UI effect payload is malformed");
            }
            const auto kind = string(values[0], "UI effect kind");
            vf::JsonValue::Object properties;
            for (std::size_t operand = 1; operand < values.size(); operand += 2) {
                const auto name = string(values[operand], "UI effect operand name");
                if (!properties.emplace(name, value(values[operand + 1], name)).second) {
                    throw std::runtime_error("duplicate compiler-owned UI effect operand " + name);
                }
            }
            if (kind == "display") continue;
            const auto identity = properties.find("operation_index");
            if (identity == properties.end() || !identity->second.is_number()
                || identity->second.as_number() < 0.0
                || std::floor(identity->second.as_number()) != identity->second.as_number()) {
                throw std::runtime_error("compiler-owned UI effect operation identity is missing");
            }
            const auto operation_index = static_cast<std::size_t>(identity->second.as_number());
            properties.erase(identity);
            if (operation_index >= operations.size() || !operations[operation_index].is_object()) {
                throw std::runtime_error("compiler-owned UI effect operation identity is invalid");
            }
            const auto& operation = operations[operation_index].as_object();
            const auto operation_kind = operation.find("kind");
            if (operation_kind == operation.end() || !operation_kind->second.is_string()
                || operation_kind->second.as_string() != kind) {
                throw std::runtime_error("executed UI effect does not match its canonical operation");
            }
            const auto frame_value = operation.find("frame_id");
            if (frame_value == operation.end() || !frame_value->second.is_number()
                || frame_value->second.as_number() < 0.0
                || std::floor(frame_value->second.as_number()) != frame_value->second.as_number()) {
                throw std::runtime_error("canonical retained UI operation has no Frame identity");
            }
            const auto frame_id = static_cast<std::uint32_t>(frame_value->second.as_number());
            if (kind == "add_frame") {
                auto [entry, inserted] = frames.emplace(frame_id, Frame{frame_id, {}});
                if (!inserted) throw std::runtime_error("retained UI Frame was created twice");
                continue;
            }
            if (kind != "add") {
                throw std::runtime_error("unsupported executed retained UI operation " + kind);
            }
            const auto frame = frames.find(frame_id);
            if (frame == frames.end()) {
                throw std::runtime_error("Frame.add executed before Display.add_frame");
            }
            const auto canonical_properties = operation.find("properties");
            if (canonical_properties == operation.end() || !canonical_properties->second.is_object()) {
                throw std::runtime_error("canonical Frame.add properties are missing");
            }
            for (const auto* coordinate : {"x", "y", "z"}) {
                if (properties.find(coordinate) != properties.end()) continue;
                const auto alias = properties.find(std::string(coordinate) + "_u");
                if (alias != properties.end()) {
                    properties[coordinate] = std::move(alias->second);
                    properties.erase(alias);
                }
            }
            for (const auto& [name, expression] : canonical_properties->second.as_object()) {
                (void)expression;
                if (properties.find(name) != properties.end()) continue;
                const auto alias = properties.find(name + "_u");
                if (alias != properties.end()) {
                    properties[name] = std::move(alias->second);
                    properties.erase(alias);
                }
            }
            const auto layer_value = operation.find("layer_id");
            if (layer_value == operation.end() || !layer_value->second.is_number()
                || layer_value->second.as_number() < 0.0
                || std::floor(layer_value->second.as_number()) != layer_value->second.as_number()) {
                throw std::runtime_error("canonical Frame.add Layer identity is missing");
            }
            frame->second.meshes.emplace_back(retained_scene::detail::material_mesh(
                properties, static_cast<std::uint64_t>(layer_value->second.as_number())));
        }

        vf::JsonValue::Array retained;
        for (auto& [id, frame] : frames) {
            if (frame.meshes.empty()) continue;
            vf::JsonValue scene(vf::JsonValue::Object{
                {"frame", vf::JsonValue("frame_" + std::to_string(id))},
                {"meshes", vf::JsonValue(std::move(frame.meshes))},
                {"texts", vf::JsonValue(vf::JsonValue::Array{})},
                {"lights", vf::JsonValue(vf::JsonValue::Array{})},
            });
            const auto packed = native_scene::pack_scene_geometry(std::move(scene));
            vf::JsonValue::Array arena;
            arena.reserve(packed.arena_bytes.size());
            for (const auto byte : packed.arena_bytes) {
                arena.emplace_back(static_cast<double>(byte));
            }
            retained.emplace_back(vf::JsonValue::Object{
                {"schema", vf::JsonValue("vektor-flow/retained-scene-arena")},
                {"version", vf::JsonValue(1.0)},
                {"metadata", vf::parse_json(packed.metadata_json)},
                {"arena", vf::JsonValue(std::move(arena))},
            });
        }
        return retained;
    }

private:
    const std::uint8_t* memory_;
    std::size_t size_;

    void range(std::uint32_t pointer, std::size_t length) const {
        if (pointer > size_ || length > size_ - pointer || (!memory_ && length)) {
            throw std::runtime_error("compiler-owned UI effect addressed invalid WASM memory");
        }
    }

    std::uint32_t u32(std::uint32_t pointer) const {
        range(pointer, 4);
        return static_cast<std::uint32_t>(memory_[pointer]) |
            (static_cast<std::uint32_t>(memory_[pointer + 1]) << 8) |
            (static_cast<std::uint32_t>(memory_[pointer + 2]) << 16) |
            (static_cast<std::uint32_t>(memory_[pointer + 3]) << 24);
    }

    wasm::values::Tag tag(std::uint32_t pointer) const {
        range(pointer, wasm::values::slot_size);
        return static_cast<wasm::values::Tag>(u32(pointer));
    }

    void require_tag(std::uint32_t pointer, wasm::values::Tag expected,
                     const std::string& context) const {
        if (tag(pointer) != expected) throw std::runtime_error(context + " has the wrong runtime value tag");
    }

    std::string string(std::uint32_t pointer, const std::string& context) const {
        require_tag(pointer, wasm::values::Tag::Utf8String, context);
        const auto length = u32(pointer + wasm::values::length_offset);
        const auto payload = u32(pointer + wasm::values::payload_offset);
        range(payload, length);
        return std::string(reinterpret_cast<const char*>(memory_ + payload), length);
    }

    double number(std::uint32_t pointer, const std::string& context) const {
        require_tag(pointer, wasm::values::Tag::Number, context);
        const std::uint64_t bits = static_cast<std::uint64_t>(u32(pointer + 8)) |
            (static_cast<std::uint64_t>(u32(pointer + 12)) << 32);
        double result = 0;
        std::memcpy(&result, &bits, sizeof(result));
        if (!std::isfinite(result)) throw std::runtime_error(context + " must be finite");
        return result;
    }

    std::vector<std::uint32_t> pointers(std::uint32_t pointer,
                                        const std::string& context) const {
        const auto value_tag = tag(pointer);
        if (value_tag != wasm::values::Tag::Array && value_tag != wasm::values::Tag::UiEffect) {
            throw std::runtime_error(context + " must be an array");
        }
        const auto length = u32(pointer + wasm::values::length_offset);
        const auto payload = u32(pointer + wasm::values::payload_offset);
        range(payload, static_cast<std::size_t>(length) * wasm::values::pointer_size);
        std::vector<std::uint32_t> result;
        result.reserve(length);
        for (std::uint32_t index = 0; index < length; ++index) {
            result.push_back(u32(payload + index * wasm::values::pointer_size));
        }
        return result;
    }

    vf::JsonValue value(std::uint32_t pointer, const std::string& context) const {
        switch (tag(pointer)) {
            case wasm::values::Tag::Null:
                return vf::JsonValue(nullptr);
            case wasm::values::Tag::Boolean:
                return vf::JsonValue(u32(pointer + wasm::values::payload_offset) != 0);
            case wasm::values::Tag::Number:
                return vf::JsonValue(number(pointer, context));
            case wasm::values::Tag::Utf8String:
                return vf::JsonValue(string(pointer, context));
            case wasm::values::Tag::Array:
            case wasm::values::Tag::Tuple: {
                vf::JsonValue::Array result;
                for (const auto child : pointers(pointer, context)) {
                    result.emplace_back(value(child, context));
                }
                return vf::JsonValue(std::move(result));
            }
            case wasm::values::Tag::Record: {
                const auto count = u32(pointer + wasm::values::length_offset);
                const auto payload = u32(pointer + wasm::values::payload_offset);
                range(payload, static_cast<std::size_t>(count) * wasm::values::record_entry_size);
                vf::JsonValue::Object result;
                for (std::uint32_t index = 0; index < count; ++index) {
                    const auto entry = payload + index * wasm::values::record_entry_size;
                    const auto name = string(u32(entry + wasm::values::record_key_offset),
                                             context + " field name");
                    if (!result.emplace(name, value(
                            u32(entry + wasm::values::record_value_offset),
                            context + "." + name)).second) {
                        throw std::runtime_error("duplicate compiler-owned UI operand field " + name);
                    }
                }
                return vf::JsonValue(std::move(result));
            }
            default:
                throw std::runtime_error("unsupported compiler-owned UI operand " + context);
        }
    }

    static void require_vec2(const vf::JsonValue::Object& properties,
                             const std::string& name) {
        const auto found = properties.find(name);
        if (found == properties.end() || !found->second.is_array() ||
            found->second.as_array().size() != 2) {
            throw std::runtime_error("Display.add_frame " + name + " must be a two-value vector");
        }
    }
};

inline vf::JsonValue extract(const std::uint8_t* memory, std::size_t size,
                             std::uint32_t output_pointer,
                             double width, double height) {
    return vf::JsonValue(Reader(memory, size).extract(output_pointer, width, height));
}

inline vf::JsonValue extract_retained(
    const std::uint8_t* memory,
    std::size_t size,
    std::uint32_t output_pointer,
    const vf::JsonValue& typed_ir
) {
    return vf::JsonValue(Reader(memory, size).extract_retained(output_pointer, typed_ir));
}

} // namespace vkf::ui_effect_packets
