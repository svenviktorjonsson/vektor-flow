#pragma once

#include "native/VfOverlay/vf/json.hpp"
#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace vkf::native_scene {

class Error : public std::runtime_error {
public:
    explicit Error(const std::string& message) : std::runtime_error(message) {}
};

inline void append_f32(std::vector<std::uint8_t>& bytes, double value) {
    if (!std::isfinite(value) ||
        std::abs(value) > static_cast<double>(std::numeric_limits<float>::max())) {
        throw Error("retained scene vertex is not f32-compatible");
    }
    const float packed = static_cast<float>(value);
    std::uint32_t bits = 0;
    std::memcpy(&bits, &packed, sizeof(bits));
    for (int shift = 0; shift < 32; shift += 8) {
        bytes.push_back(static_cast<std::uint8_t>((bits >> shift) & 0xffu));
    }
}

inline void append_u32(std::vector<std::uint8_t>& bytes, const vf::JsonValue& value) {
    if (!value.is_number() || !std::isfinite(value.as_number()) ||
        value.as_number() < 0.0 || std::floor(value.as_number()) != value.as_number() ||
        value.as_number() > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
        throw Error("retained scene index is not u32-compatible");
    }
    const auto packed = static_cast<std::uint32_t>(value.as_number());
    for (int shift = 0; shift < 32; shift += 8) {
        bytes.push_back(static_cast<std::uint8_t>((packed >> shift) & 0xffu));
    }
}

struct PackedScene {
    std::string metadata_json;
    std::vector<std::uint8_t> arena_bytes;
};

// Pure packing seam: geometry has already been evaluated and materialized by
// VKF. No source parser, expression interpreter, filesystem or renderer work.
inline PackedScene pack_scene_geometry(vf::JsonValue scene,
    const std::function<void(vf::JsonValue::Object&)>& prepare_surface = {}) {
    std::vector<std::uint8_t> arena;
    auto& scene_object = scene.as_object();
    const auto pack_geometry = [&](vf::JsonValue::Object& geometry) {
        for (const auto& field_spec : {
                 std::pair<const char*, const char*>{"vertices", "float32"},
                 std::pair<const char*, const char*>{"indices", "uint32"}}) {
            const auto found = geometry.find(field_spec.first);
            if (found == geometry.end()) continue;
            if (!found->second.is_array()) {
                throw Error(std::string("native_scene geometry.") + field_spec.first + " must be a vector");
            }
            while ((arena.size() & 3u) != 0u) arena.push_back(0);
            const std::size_t byte_offset = arena.size();
            const std::size_t length = found->second.as_array().size();
            for (const auto& item : found->second.as_array()) {
                if (std::string(field_spec.second) == "float32") {
                    if (!item.is_number()) throw Error("retained scene vertex must be numeric");
                    append_f32(arena, item.as_number());
                } else append_u32(arena, item);
            }
            found->second = vf::JsonValue(vf::JsonValue::Object{
                {"byte_offset", vf::JsonValue(static_cast<double>(byte_offset))},
                {"length", vf::JsonValue(static_cast<double>(length))},
                {"storage", vf::JsonValue(field_spec.second)},
            });
        }
    };
    for (const auto* collection : {"surfaces", "meshes"}) {
        const auto found = scene_object.find(collection);
        if (found == scene_object.end()) continue;
        if (!found->second.is_array()) throw Error(std::string("native_scene.") + collection + " must be a vector");
        for (auto& geometry : found->second.as_array()) {
            if (!geometry.is_object()) throw Error(std::string("native_scene ") +
                (std::string(collection) == "surfaces" ? "surface" : "mesh") + " must be a struct");
            if (std::string(collection) == "surfaces" && prepare_surface) prepare_surface(geometry.as_object());
            pack_geometry(geometry.as_object());
        }
    }
    return {vf::json_stringify(vf::JsonValue(vf::JsonValue::Object{
        {"schema", vf::JsonValue("vektor-flow/retained-scene-arena")},
        {"version", vf::JsonValue(1.0)}, {"scene", std::move(scene)},
    }), -1), std::move(arena)};
}

} // namespace vkf::native_scene
