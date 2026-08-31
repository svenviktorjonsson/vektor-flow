#pragma once

#include "native/VfOverlay/vf/json.hpp"

#include <cmath>
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vkf::retained_scene {

class Error : public std::runtime_error {
public:
    explicit Error(std::string message) : std::runtime_error(std::move(message)) {}
};

namespace detail {

inline const vf::JsonValue::Object& object(
    const vf::JsonValue& value,
    const std::string& context
) {
    if (!value.is_object()) throw Error(context + " must be an object");
    return value.as_object();
}

inline const vf::JsonValue& field(
    const vf::JsonValue::Object& value,
    const std::string& name,
    const std::string& context
) {
    const auto found = value.find(name);
    if (found == value.end()) throw Error(context + " is missing `" + name + "`");
    return found->second;
}

inline std::string text(
    const vf::JsonValue::Object& value,
    const std::string& name,
    const std::string& context
) {
    const auto& item = field(value, name, context);
    if (!item.is_string()) throw Error(context + "." + name + " must be a string");
    return item.as_string();
}

inline std::uint64_t id(
    const vf::JsonValue::Object& value,
    const std::string& name,
    const std::string& context
) {
    const auto& item = field(value, name, context);
    if (!item.is_number() || !std::isfinite(item.as_number()) ||
        item.as_number() < 0.0 || std::floor(item.as_number()) != item.as_number()) {
        throw Error(context + "." + name + " must be a non-negative integer");
    }
    return static_cast<std::uint64_t>(item.as_number());
}

inline vf::JsonValue evaluate(const vf::JsonValue& raw) {
    if (!raw.is_object()) return raw;
    const auto& value = raw.as_object();
    const auto kind_entry = value.find("kind");
    if (kind_entry == value.end() || !kind_entry->second.is_string()) {
        throw Error("retained scene value must have a kind");
    }
    const std::string& kind = kind_entry->second.as_string();
    if (kind == "const") return field(value, "value", "retained scene const");
    if (kind == "list" || kind == "tuple") {
        const auto& items = field(value, "items", "retained scene " + kind);
        if (!items.is_array()) throw Error("retained scene " + kind + " items must be an array");
        vf::JsonValue::Array result;
        result.reserve(items.as_array().size());
        for (const auto& item : items.as_array()) result.push_back(evaluate(item));
        return vf::JsonValue(std::move(result));
    }
    if (kind == "record") {
        const auto& fields = field(value, "fields", "retained scene record");
        if (!fields.is_array()) throw Error("retained scene record fields must be an array");
        vf::JsonValue::Object result;
        for (const auto& raw_field : fields.as_array()) {
            const auto& record_field = object(raw_field, "retained scene record field");
            result[text(record_field, "name", "retained scene record field")] =
                evaluate(field(record_field, "value", "retained scene record field"));
        }
        return vf::JsonValue(std::move(result));
    }
    throw Error("retained scene requires compile-time values, got `" + kind + "`");
}

inline vf::JsonValue::Object properties(const vf::JsonValue::Object& operation) {
    const auto& raw = object(
        field(operation, "properties", "retained scene operation"),
        "retained scene properties");
    vf::JsonValue::Object result;
    for (const auto& entry : raw) result[entry.first] = evaluate(entry.second);
    return result;
}

inline std::vector<double> numbers(const vf::JsonValue& value, const std::string& context) {
    std::vector<double> result;
    const auto flatten = [&](const auto& self, const vf::JsonValue& item) -> void {
        if (item.is_number()) {
            if (!std::isfinite(item.as_number())) throw Error(context + " must be finite");
            result.push_back(item.as_number());
            return;
        }
        if (item.is_array()) {
            for (const auto& child : item.as_array()) self(self, child);
            return;
        }
        throw Error(context + " must contain only numbers");
    };
    flatten(flatten, value);
    return result;
}

inline bool boolean_or(
    const vf::JsonValue::Object& value,
    const std::string& name,
    bool fallback
) {
    const auto found = value.find(name);
    if (found == value.end()) return fallback;
    if (!found->second.is_boolean()) throw Error("retained scene `" + name + "` must be bit");
    return found->second.as_boolean();
}

inline vf::JsonValue frame_command(
    std::uint64_t frame_id,
    const std::vector<double>& pos,
    const std::vector<double>& size
) {
    const std::string id_text = "frame_" + std::to_string(frame_id);
    vf::JsonValue::Object rect{
        {"x", vf::JsonValue(pos[0])}, {"y", vf::JsonValue(pos[1])},
        {"w", vf::JsonValue(size[0])}, {"h", vf::JsonValue(size[1])},
    };
    vf::JsonValue::Object flags{
        {"draggable", vf::JsonValue(true)}, {"dockable", vf::JsonValue(true)},
        {"resizable", vf::JsonValue(true)}, {"closable", vf::JsonValue(true)},
        {"use_browser", vf::JsonValue(true)},
    };
    vf::JsonValue::Object spec{
        {"id", vf::JsonValue(id_text)}, {"title", vf::JsonValue("")},
        {"title_align", vf::JsonValue("left")}, {"rect", vf::JsonValue(std::move(rect))},
        {"flags", vf::JsonValue(std::move(flags))}, {"alpha", vf::JsonValue(1.0)},
        {"master", vf::JsonValue(false)}, {"dock_location", vf::JsonValue("tl")},
        {"anchor", vf::JsonValue("tl")}, {"body", vf::JsonValue(nullptr)},
        {"body_transparent", vf::JsonValue(false)}, {"body_layout", vf::JsonValue(nullptr)},
        {"parent_id", vf::JsonValue(nullptr)}, {"aspect", vf::JsonValue(nullptr)},
        {"frameless", vf::JsonValue(false)},
    };
    vf::JsonValue::Object payload{{"spec", vf::JsonValue(std::move(spec))}};
    return vf::JsonValue(vf::JsonValue::Object{
        {"kind", vf::JsonValue("frame_upsert")}, {"id", vf::JsonValue(id_text)},
        {"payload", vf::JsonValue(std::move(payload))},
    });
}

inline vf::JsonValue material_mesh(
    const vf::JsonValue::Object& properties,
    std::uint64_t layer_id
) {
    const auto x = numbers(field(properties, "x", "Frame.add"), "Frame.add x");
    const auto y = numbers(field(properties, "y", "Frame.add"), "Frame.add y");
    const auto z = numbers(field(properties, "z", "Frame.add"), "Frame.add z");
    const auto color = numbers(field(properties, "color", "Frame.add"), "Frame.add color");
    if (x.size() != 4 || y.size() != 4 || z.size() != 4) {
        throw Error("retained Frame.add first material slice requires a 2 by 2 surface");
    }
    if (color.size() != 3 && color.size() != 4) {
        throw Error("retained Frame.add color must have three or four components");
    }
    const double ux = x[1] - x[0];
    const double uy = y[1] - y[0];
    const double uz = z[1] - z[0];
    const double vx = x[2] - x[0];
    const double vy = y[2] - y[0];
    const double vz = z[2] - z[0];
    double nx = uy * vz - uz * vy;
    double ny = uz * vx - ux * vz;
    double nz = ux * vy - uy * vx;
    const double length = std::sqrt(nx * nx + ny * ny + nz * nz);
    if (!(length > 1e-12)) throw Error("retained Frame.add surface must have non-zero area");
    nx /= length;
    ny /= length;
    nz /= length;
    const double alpha = color.size() == 4 ? color[3] : 1.0;
    vf::JsonValue::Array vertices;
    vertices.reserve(40);
    for (std::size_t index = 0; index < 4; ++index) {
        for (const double item : {
                 x[index], y[index], z[index], nx, ny, nz,
                 color[0], color[1], color[2], alpha}) {
            vertices.push_back(vf::JsonValue(item));
        }
    }
    vf::JsonValue::Array indices;
    for (const double item : {0.0, 1.0, 3.0, 0.0, 3.0, 2.0}) {
        indices.push_back(vf::JsonValue(item));
    }
    const auto id_value = field(properties, "id", "Frame.add");
    if (!id_value.is_string()) throw Error("Frame.add id must be a string");
    vf::JsonValue::Object mesh{
        {"id", id_value}, {"layer_id", vf::JsonValue(static_cast<double>(layer_id))},
        {"type", vf::JsonValue("field_mesh")}, {"topology", vf::JsonValue("triangle-list")},
        {"mode3d", vf::JsonValue(true)}, {"vertices", vf::JsonValue(std::move(vertices))},
        {"indices", vf::JsonValue(std::move(indices))},
    };
    for (const std::string& name : {
             "representation", "render_mode", "texture", "specular_strength", "roughness",
             "reflectivity", "alpha", "transparent", "depth_write", "casts_shadow",
             "receives_shadow", "surface_system", "interpolation", "visible"}) {
        const auto found = properties.find(name);
        if (found != properties.end()) mesh[name] = found->second;
    }
    const auto no_lighting = properties.find("no_lighting");
    if (no_lighting != properties.end()) {
        mesh["no_lighting"] = no_lighting->second;
    } else {
        mesh["no_lighting"] = vf::JsonValue(!boolean_or(properties, "receives_lighting", true));
    }
    if (mesh.find("transparent") == mesh.end()) {
        mesh["transparent"] = vf::JsonValue(alpha < 0.999);
    }
    if (mesh.find("depth_write") == mesh.end()) {
        mesh["depth_write"] = vf::JsonValue(!mesh.at("transparent").as_boolean());
    }
    return vf::JsonValue(std::move(mesh));
}

struct Frame {
    std::vector<double> pos;
    std::vector<double> size;
    vf::JsonValue::Object options;
    std::optional<vf::JsonValue> camera;
    vf::JsonValue::Array lights;
    vf::JsonValue::Array meshes;
};

}  // namespace detail

inline std::optional<vf::JsonValue> compile_packets(const vf::JsonValue& root_value) {
    const auto& root = detail::object(root_value, "typed IR root");
    const auto program_entry = root.find("ui_program");
    if (program_entry == root.end()) return std::nullopt;
    const auto& program = detail::object(program_entry->second, "typed UI program");
    if (detail::text(program, "schema", "typed UI program") != "vektor-flow/ui-program") {
        throw Error("typed UI program has an unsupported schema");
    }
    const auto& raw_operations = detail::field(program, "operations", "typed UI program");
    if (!raw_operations.is_array()) throw Error("typed UI operations must be an array");
    bool has_scene = false;
    for (const auto& raw : raw_operations.as_array()) {
        const std::string kind = detail::text(
            detail::object(raw, "typed UI operation"), "kind", "typed UI operation");
        if (kind == "set_geom_options" || kind == "add_camera" ||
            kind == "add_light" || kind == "add") {
            has_scene = true;
        }
    }
    if (!has_scene) return std::nullopt;

    std::map<std::uint64_t, detail::Frame> frames;
    for (const auto& raw : raw_operations.as_array()) {
        const auto& operation = detail::object(raw, "typed UI operation");
        const std::string kind = detail::text(operation, "kind", "typed UI operation");
        if (kind == "show") continue;
        if (kind == "add_frame") {
            if (detail::text(operation, "parent_kind", "typed UI add_frame") != "display") {
                throw Error("retained scene requires a Display-owned Frame");
            }
            const auto frame_id = detail::id(operation, "frame_id", "typed UI add_frame");
            detail::Frame frame;
            frame.pos = detail::numbers(
                detail::evaluate(detail::field(operation, "pos", "typed UI add_frame")),
                "Frame position");
            frame.size = detail::numbers(
                detail::evaluate(detail::field(operation, "size", "typed UI add_frame")),
                "Frame size");
            if (frame.pos.size() != 2 || frame.size.size() != 2) {
                throw Error("retained scene requires two-dimensional Frame geometry");
            }
            frames.emplace(frame_id, std::move(frame));
            continue;
        }
        if (kind == "set_geom_options" || kind == "add_camera" ||
            kind == "add_light" || kind == "add") {
            const auto frame_id = detail::id(operation, "frame_id", "retained scene operation");
            const auto found = frames.find(frame_id);
            if (found == frames.end()) throw Error("retained scene target Frame was not created");
            auto properties = detail::properties(operation);
            if (kind == "set_geom_options") {
                for (auto& entry : properties) found->second.options[entry.first] = std::move(entry.second);
            } else if (kind == "add_camera") {
                found->second.camera = vf::JsonValue(std::move(properties));
            } else if (kind == "add_light") {
                found->second.lights.push_back(vf::JsonValue(std::move(properties)));
            } else {
                found->second.meshes.push_back(detail::material_mesh(
                    properties, detail::id(operation, "layer_id", "Frame.add")));
            }
            continue;
        }
        throw Error("retained scene does not combine UI operation `" + kind + "`");
    }

    vf::JsonValue::Array commands;
    vf::JsonValue::Object geom;
    for (auto& entry : frames) {
        if (entry.second.meshes.empty() && entry.second.lights.empty() &&
            !entry.second.camera.has_value() && entry.second.options.empty()) {
            continue;
        }
        commands.push_back(detail::frame_command(entry.first, entry.second.pos, entry.second.size));
        vf::JsonValue::Object scene;
        scene["frame"] = vf::JsonValue("frame_" + std::to_string(entry.first));
        scene["meshes"] = vf::JsonValue(std::move(entry.second.meshes));
        scene["texts"] = vf::JsonValue(vf::JsonValue::Array{});
        scene["lights"] = vf::JsonValue(std::move(entry.second.lights));
        if (entry.second.camera.has_value()) scene["camera"] = std::move(*entry.second.camera);
        for (auto& option : entry.second.options) scene[option.first] = std::move(option.second);
        geom["frame_" + std::to_string(entry.first)] = vf::JsonValue(std::move(scene));
    }

    vf::JsonValue::Array packets;
    packets.push_back(vf::JsonValue(vf::JsonValue::Object{
        {"seq", vf::JsonValue(1.0)}, {"kind", vf::JsonValue("scene.replace")},
        {"payload", vf::JsonValue(vf::JsonValue::Object{{"commands", vf::JsonValue(std::move(commands))}})},
    }));
    packets.push_back(vf::JsonValue(vf::JsonValue::Object{
        {"seq", vf::JsonValue(2.0)}, {"kind", vf::JsonValue("ui_state.replace")},
        {"payload", vf::JsonValue(vf::JsonValue::Object{{"state", vf::JsonValue(vf::JsonValue::Object{})}})},
    }));
    vf::JsonValue::Object display_data{
        {"screen", vf::JsonValue(vf::JsonValue::Array{})},
        {"frames", vf::JsonValue(vf::JsonValue::Object{})},
        {"geom", vf::JsonValue(std::move(geom))},
    };
    packets.push_back(vf::JsonValue(vf::JsonValue::Object{
        {"seq", vf::JsonValue(3.0)}, {"kind", vf::JsonValue("display.replace")},
        {"payload", vf::JsonValue(vf::JsonValue::Object{{"display", vf::JsonValue(std::move(display_data))}})},
    }));
    return vf::JsonValue(std::move(packets));
}

}  // namespace vkf::retained_scene
