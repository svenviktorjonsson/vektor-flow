#pragma once

#include "compiler/native/vkf_compiled_geometry_packet.hpp"
#include "compiler/native/vkf_wasm_value_layout.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <string>

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
            case wasm::values::Tag::Number:
                return vf::JsonValue(number(pointer, context));
            case wasm::values::Tag::Utf8String:
                return vf::JsonValue(string(pointer, context));
            case wasm::values::Tag::Array: {
                vf::JsonValue::Array result;
                for (const auto child : pointers(pointer, context)) {
                    result.emplace_back(value(child, context));
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

} // namespace vkf::ui_effect_packets
