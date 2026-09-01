#pragma once

#include "native/VfOverlay/vf/json.hpp"

#include <cmath>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
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

struct EvaluationContext {
    std::map<std::string, vf::JsonValue> bindings;
    std::map<std::string, vf::JsonValue> cache;
    std::set<std::string> active;
};

inline vf::JsonValue evaluate(
    const vf::JsonValue& raw,
    EvaluationContext* context = nullptr
);

inline vf::JsonValue elementwise_binary(
    const vf::JsonValue& left,
    const vf::JsonValue& right,
    const std::string& op
) {
    if (left.is_array() || right.is_array()) {
        vf::JsonValue::Array result;
        if (left.is_array() && right.is_array()) {
            if (left.as_array().size() != right.as_array().size()) {
                throw Error("retained scene vector operands must have the same shape");
            }
            result.reserve(left.as_array().size());
            for (std::size_t index = 0; index < left.as_array().size(); ++index) {
                result.push_back(elementwise_binary(
                    left.as_array()[index], right.as_array()[index], op));
            }
        } else {
            const auto& items = left.is_array() ? left.as_array() : right.as_array();
            result.reserve(items.size());
            for (const auto& item : items) {
                result.push_back(left.is_array()
                    ? elementwise_binary(item, right, op)
                    : elementwise_binary(left, item, op));
            }
        }
        return vf::JsonValue(std::move(result));
    }
    if (!left.is_number() || !right.is_number()) {
        throw Error("retained scene arithmetic requires numeric values");
    }
    const double lhs = left.as_number();
    const double rhs = right.as_number();
    double value = 0.0;
    if (op == "PLUS") value = lhs + rhs;
    else if (op == "MINUS") value = lhs - rhs;
    else if (op == "STAR") value = lhs * rhs;
    else if (op == "SLASH") {
        if (rhs == 0.0) throw Error("retained scene arithmetic divides by zero");
        value = lhs / rhs;
    } else if (op == "CARET" || op == "POWER") value = std::pow(lhs, rhs);
    else throw Error("retained scene arithmetic does not support `" + op + "`");
    if (!std::isfinite(value)) throw Error("retained scene arithmetic must stay finite");
    return vf::JsonValue(value);
}

inline vf::JsonValue elementwise_math(
    const vf::JsonValue& value,
    const std::string& function
) {
    if (value.is_array()) {
        vf::JsonValue::Array result;
        result.reserve(value.as_array().size());
        for (const auto& item : value.as_array()) {
            result.push_back(elementwise_math(item, function));
        }
        return vf::JsonValue(std::move(result));
    }
    if (!value.is_number()) throw Error("retained scene math requires numeric values");
    const double input = value.as_number();
    double output = 0.0;
    if (function == "sin") output = std::sin(input);
    else if (function == "cos") output = std::cos(input);
    else if (function == "tan") output = std::tan(input);
    else if (function == "exp") output = std::exp(input);
    else if (function == "sqrt") output = std::sqrt(input);
    else if (function == "abs") output = std::abs(input);
    else throw Error("retained scene math does not support `math." + function + "`");
    if (!std::isfinite(output)) throw Error("retained scene math must stay finite");
    return vf::JsonValue(output);
}

inline vf::JsonValue evaluate(const vf::JsonValue& raw, EvaluationContext* context) {
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
        for (const auto& item : items.as_array()) result.push_back(evaluate(item, context));
        return vf::JsonValue(std::move(result));
    }
    if (kind == "record") {
        const auto& fields = field(value, "fields", "retained scene record");
        if (!fields.is_array()) throw Error("retained scene record fields must be an array");
        vf::JsonValue::Object result;
        for (const auto& raw_field : fields.as_array()) {
            const auto& record_field = object(raw_field, "retained scene record field");
            result[text(record_field, "name", "retained scene record field")] =
                evaluate(field(record_field, "value", "retained scene record field"), context);
        }
        return vf::JsonValue(std::move(result));
    }
    if (kind == "load") {
        if (context == nullptr) throw Error("retained scene cannot resolve a binding here");
        const std::string name = text(value, "name", "retained scene load");
        const auto cached = context->cache.find(name);
        if (cached != context->cache.end()) return cached->second;
        const auto binding = context->bindings.find(name);
        if (binding == context->bindings.end()) {
            throw Error("retained scene binding `" + name + "` is unavailable");
        }
        if (!context->active.insert(name).second) {
            throw Error("retained scene binding `" + name + "` is recursive");
        }
        auto resolved = evaluate(binding->second, context);
        context->active.erase(name);
        context->cache[name] = resolved;
        return resolved;
    }
    if (kind == "binary_op") {
        return elementwise_binary(
            evaluate(field(value, "left", "retained scene binary operation"), context),
            evaluate(field(value, "right", "retained scene binary operation"), context),
            text(value, "op", "retained scene binary operation"));
    }
    if (kind == "call") {
        const auto& callee = object(
            field(value, "callee", "retained scene call"), "retained scene callee");
        const auto& args = field(value, "args", "retained scene call");
        if (!args.is_array() || args.as_array().size() != 1 ||
            text(callee, "kind", "retained scene callee") != "stdlib_function" ||
            text(callee, "module", "retained scene callee") != "math") {
            throw Error("retained scene only evaluates one-argument math calls");
        }
        return elementwise_math(
            evaluate(args.as_array().front(), context),
            text(callee, "name", "retained scene callee"));
    }
    throw Error("retained scene requires compile-time values, got `" + kind + "`");
}

inline vf::JsonValue::Object properties(
    const vf::JsonValue::Object& operation,
    EvaluationContext* context = nullptr
) {
    const auto& raw = object(
        field(operation, "properties", "retained scene operation"),
        "retained scene properties");
    vf::JsonValue::Object result;
    for (const auto& entry : raw) result[entry.first] = evaluate(entry.second, context);
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

struct NumericGrid {
    std::size_t rows = 0;
    std::size_t columns = 0;
    std::vector<double> values;
};

inline std::vector<double> numeric_vector(
    const vf::JsonValue& value,
    const std::string& context
) {
    if (!value.is_array() || value.as_array().size() < 2) {
        throw Error(context + " must have at least two values");
    }
    std::vector<double> result;
    result.reserve(value.as_array().size());
    for (const auto& item : value.as_array()) {
        if (!item.is_number() || !std::isfinite(item.as_number())) {
            throw Error(context + " must contain only finite numbers");
        }
        result.push_back(item.as_number());
    }
    return result;
}

inline NumericGrid numeric_grid(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array() || value.as_array().size() < 2) {
        throw Error(context + " must have at least two rows");
    }
    NumericGrid result;
    result.rows = value.as_array().size();
    for (const auto& raw_row : value.as_array()) {
        if (!raw_row.is_array() || raw_row.as_array().size() < 2) {
            throw Error(context + " rows must have at least two columns");
        }
        if (result.columns == 0) {
            result.columns = raw_row.as_array().size();
            result.values.reserve(result.rows * result.columns);
        } else if (raw_row.as_array().size() != result.columns) {
            throw Error(context + " must be rectangular");
        }
        for (const auto& raw_item : raw_row.as_array()) {
            if (!raw_item.is_number() || !std::isfinite(raw_item.as_number())) {
                throw Error(context + " must contain only finite numbers");
            }
            result.values.push_back(raw_item.as_number());
        }
    }
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
    const auto& x_value = field(properties, "x", "Frame.add");
    const auto& y_value = field(properties, "y", "Frame.add");
    const bool line = x_value.is_array() && !x_value.as_array().empty() &&
        x_value.as_array().front().is_number();
    if (line) {
        const auto x = numeric_vector(x_value, "Frame.add x");
        const auto y = numeric_vector(y_value, "Frame.add y");
        const auto color = numbers(field(properties, "color", "Frame.add"), "Frame.add color");
        if (x.size() != y.size()) {
            throw Error("retained Frame.add x and y lines must have the same length");
        }
        if (color.size() != 3 && color.size() != 4) {
            throw Error("retained Frame.add color must have three or four components");
        }
        std::vector<double> z(x.size(), 0.0);
        bool mode3d = false;
        const auto z_entry = properties.find("z");
        if (z_entry != properties.end()) {
            z = numeric_vector(z_entry->second, "Frame.add z");
            if (z.size() != x.size()) {
                throw Error("retained Frame.add x, y, and z lines must have the same length");
            }
            mode3d = true;
        }
        const double alpha = color.size() == 4 ? color[3] : 1.0;
        vf::JsonValue::Array vertices;
        vertices.reserve(x.size() * 10);
        for (std::size_t index = 0; index < x.size(); ++index) {
            for (const double item : {
                     x[index], y[index], z[index], 0.0, 0.0, 1.0,
                     color[0], color[1], color[2], alpha}) {
                vertices.push_back(vf::JsonValue(item));
            }
        }
        vf::JsonValue::Array indices;
        indices.reserve((x.size() - 1) * 2);
        for (std::size_t index = 0; index + 1 < x.size(); ++index) {
            indices.push_back(vf::JsonValue(static_cast<double>(index)));
            indices.push_back(vf::JsonValue(static_cast<double>(index + 1)));
        }
        const auto id_value = field(properties, "id", "Frame.add");
        if (!id_value.is_string()) throw Error("Frame.add id must be a string");
        vf::JsonValue::Object mesh{
            {"id", id_value},
            {"layer_id", vf::JsonValue(static_cast<double>(layer_id))},
            {"type", vf::JsonValue("field_mesh")},
            {"topology", vf::JsonValue("line-list")},
            {"render_mode", vf::JsonValue("line")},
            {"marker_space", vf::JsonValue("pixel")},
            {"edge_width", vf::JsonValue(1.0)},
            {"mode3d", vf::JsonValue(mode3d)},
            {"vertices", vf::JsonValue(std::move(vertices))},
            {"indices", vf::JsonValue(std::move(indices))},
            {"no_lighting", vf::JsonValue(true)},
            {"casts_shadow", vf::JsonValue(false)},
        };
        for (const std::string& name : {
                 "representation", "render_mode", "alpha", "transparent", "depth_write",
                 "receives_lighting", "no_lighting", "casts_shadow", "receives_shadow",
                 "interpolation", "visible"}) {
            const auto found = properties.find(name);
            if (found != properties.end()) mesh[name] = found->second;
        }
        if (mesh.find("transparent") == mesh.end()) {
            mesh["transparent"] = vf::JsonValue(alpha < 0.999);
        }
        if (mesh.find("depth_write") == mesh.end()) {
            mesh["depth_write"] = vf::JsonValue(!mesh.at("transparent").as_boolean());
        }
        return vf::JsonValue(std::move(mesh));
    }
    const auto x = numeric_grid(field(properties, "x", "Frame.add"), "Frame.add x");
    const auto y = numeric_grid(field(properties, "y", "Frame.add"), "Frame.add y");
    const auto z = numeric_grid(field(properties, "z", "Frame.add"), "Frame.add z");
    const auto color = numbers(field(properties, "color", "Frame.add"), "Frame.add color");
    if (x.rows != y.rows || x.rows != z.rows ||
        x.columns != y.columns || x.columns != z.columns) {
        throw Error("retained Frame.add x, y, and z surfaces must have the same shape");
    }
    if (color.size() != 3 && color.size() != 4) {
        throw Error("retained Frame.add color must have three or four components");
    }
    const std::size_t vertex_count = x.rows * x.columns;
    std::vector<double> normals(vertex_count * 3, 0.0);
    vf::JsonValue::Array indices;
    indices.reserve((x.rows - 1) * (x.columns - 1) * 6);
    bool has_area = false;
    const auto accumulate_triangle = [&](std::size_t a, std::size_t b, std::size_t c) {
        const double ux = x.values[b] - x.values[a];
        const double uy = y.values[b] - y.values[a];
        const double uz = z.values[b] - z.values[a];
        const double vx = x.values[c] - x.values[a];
        const double vy = y.values[c] - y.values[a];
        const double vz = z.values[c] - z.values[a];
        const double nx = uy * vz - uz * vy;
        const double ny = uz * vx - ux * vz;
        const double nz = ux * vy - uy * vx;
        if (nx * nx + ny * ny + nz * nz > 1e-24) has_area = true;
        for (const std::size_t index : {a, b, c}) {
            normals[index * 3] += nx;
            normals[index * 3 + 1] += ny;
            normals[index * 3 + 2] += nz;
        }
        indices.push_back(vf::JsonValue(static_cast<double>(a)));
        indices.push_back(vf::JsonValue(static_cast<double>(b)));
        indices.push_back(vf::JsonValue(static_cast<double>(c)));
    };
    for (std::size_t row = 0; row + 1 < x.rows; ++row) {
        for (std::size_t column = 0; column + 1 < x.columns; ++column) {
            const std::size_t a = row * x.columns + column;
            const std::size_t b = a + 1;
            const std::size_t c = (row + 1) * x.columns + column;
            const std::size_t d = c + 1;
            accumulate_triangle(a, b, d);
            accumulate_triangle(a, d, c);
        }
    }
    if (!has_area) throw Error("retained Frame.add surface must have non-zero area");
    for (std::size_t index = 0; index < vertex_count; ++index) {
        const double nx = normals[index * 3];
        const double ny = normals[index * 3 + 1];
        const double nz = normals[index * 3 + 2];
        const double length = std::sqrt(nx * nx + ny * ny + nz * nz);
        if (length > 1e-12) {
            normals[index * 3] /= length;
            normals[index * 3 + 1] /= length;
            normals[index * 3 + 2] /= length;
        }
    }
    const double alpha = color.size() == 4 ? color[3] : 1.0;
    vf::JsonValue::Array vertices;
    vertices.reserve(vertex_count * 10);
    for (std::size_t index = 0; index < vertex_count; ++index) {
        for (const double item : {
                 x.values[index], y.values[index], z.values[index],
                 normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2],
                 color[0], color[1], color[2], alpha}) {
            vertices.push_back(vf::JsonValue(item));
        }
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
    bool targeted = false;
    std::vector<double> pos;
    std::vector<double> size;
    vf::JsonValue::Object options;
    std::optional<vf::JsonValue> camera;
    vf::JsonValue::Array lights;
    vf::JsonValue::Array meshes;
};

}  // namespace detail

struct StaticHtmlLoad {
    std::uint64_t frame_id;
    std::string resource;
};

inline std::vector<StaticHtmlLoad> static_html_loads(const vf::JsonValue& root_value) {
    std::vector<StaticHtmlLoad> result;
    const auto& root = detail::object(root_value, "typed IR root");
    const auto program_entry = root.find("ui_program");
    if (program_entry == root.end()) return result;
    const auto& program = detail::object(program_entry->second, "typed UI program");
    const auto& raw_operations = detail::field(program, "operations", "typed UI program");
    if (!raw_operations.is_array()) throw Error("typed UI operations must be an array");
    for (const auto& raw : raw_operations.as_array()) {
        const auto& operation = detail::object(raw, "typed UI operation");
        if (detail::text(operation, "kind", "typed UI operation") != "load") continue;
        const auto& target = detail::object(
            detail::field(operation, "target", "Frame.load"), "Frame.load target");
        if (detail::text(target, "kind", "Frame.load target") != "frame") {
            throw Error("Frame.load requires a Frame target");
        }
        const auto& resource = detail::field(operation, "resource", "Frame.load");
        if (!resource.is_string()) throw Error("Frame.load resource must be a string");
        result.push_back({detail::id(target, "id", "Frame.load target"), resource.as_string()});
    }
    return result;
}

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
    detail::EvaluationContext evaluation;
    const auto body_entry = root.find("body");
    if (body_entry != root.end()) {
        if (!body_entry->second.is_array()) throw Error("typed IR body must be an array");
        for (const auto& raw_statement : body_entry->second.as_array()) {
            if (!raw_statement.is_object()) continue;
            const auto& statement = raw_statement.as_object();
            const auto kind_entry = statement.find("kind");
            if (kind_entry == statement.end() || !kind_entry->second.is_string() ||
                kind_entry->second.as_string() != "store_binding" ||
                detail::boolean_or(statement, "update", false)) {
                continue;
            }
            evaluation.bindings[detail::text(statement, "name", "typed IR binding")] =
                detail::field(statement, "value", "typed IR binding");
        }
    }
    bool has_scene = false;
    for (const auto& raw : raw_operations.as_array()) {
        const auto& operation = detail::object(raw, "typed UI operation");
        const std::string kind = detail::text(
            operation, "kind", "typed UI operation");
        if (kind == "set_geom_options" || kind == "add_camera" ||
            kind == "add_light" || kind == "add") {
            if (operation.find("frame_id") == operation.end()) continue;
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
                detail::evaluate(
                    detail::field(operation, "pos", "typed UI add_frame"), &evaluation),
                "Frame position");
            frame.size = detail::numbers(
                detail::evaluate(
                    detail::field(operation, "size", "typed UI add_frame"), &evaluation),
                "Frame size");
            if (frame.pos.size() != 2 || frame.size.size() != 2) {
                throw Error("retained scene requires two-dimensional Frame geometry");
            }
            frames.emplace(frame_id, std::move(frame));
            continue;
        }
        if (kind == "load") {
            const auto& target = detail::object(
                detail::field(operation, "target", "Frame.load"), "Frame.load target");
            const auto frame_id = detail::id(target, "id", "Frame.load target");
            const auto found = frames.find(frame_id);
            if (found == frames.end()) throw Error("Frame.load target Frame was not created");
            found->second.targeted = true;
            continue;
        }
        if (kind == "set_geom_options" || kind == "add_camera" ||
            kind == "add_light" || kind == "add") {
            const auto frame_id = detail::id(operation, "frame_id", "retained scene operation");
            const auto found = frames.find(frame_id);
            if (found == frames.end()) throw Error("retained scene target Frame was not created");
            found->second.targeted = true;
            auto properties = detail::properties(operation, &evaluation);
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
        if (!entry.second.targeted) continue;
        commands.push_back(detail::frame_command(entry.first, entry.second.pos, entry.second.size));
        if (entry.second.meshes.empty() && entry.second.lights.empty() &&
            !entry.second.camera.has_value() && entry.second.options.empty()) continue;
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

inline std::optional<vf::JsonValue> compile_event_program(
    const vf::JsonValue& root_value,
    const vf::JsonValue& packets_value
) {
    const auto& root = detail::object(root_value, "typed IR root");
    const auto& body_value = detail::field(root, "body", "typed IR root");
    if (!body_value.is_array()) throw Error("typed IR body must be an array");

    struct Component {
        std::string kind;
        std::string id;
    };
    struct Layer {
        std::uint64_t frame_id;
        std::string mesh_id;
    };
    std::map<std::string, Component> components;
    std::map<std::string, std::uint64_t> layer_bindings;
    for (const auto& raw_statement : body_value.as_array()) {
        const auto& statement = detail::object(raw_statement, "typed IR statement");
        const auto kind_entry = statement.find("kind");
        if (kind_entry == statement.end() || !kind_entry->second.is_string() ||
            kind_entry->second.as_string() != "store_binding") continue;
        const std::string name = detail::text(statement, "name", "typed IR binding");
        const std::string type = detail::text(statement, "type", "typed IR binding");
        const auto& value = detail::object(
            detail::field(statement, "value", "typed IR binding"), "typed IR binding value");
        if (type == "Layer") {
            layer_bindings[name] = detail::id(value, "value", "Layer binding");
            continue;
        }
        const std::string component_prefix = "ui_component<";
        if (type.rfind(component_prefix, 0) == 0 && !type.empty() && type.back() == '>') {
            const auto id_entry = value.find("id");
            if (id_entry == value.end() || !id_entry->second.is_string()) {
                throw Error("event owner component requires an explicit id");
            }
            components[name] = {
                type.substr(component_prefix.size(), type.size() - component_prefix.size() - 1),
                id_entry->second.as_string(),
            };
        }
    }

    std::map<std::uint64_t, Layer> layers;
    const auto& program = detail::object(
        detail::field(root, "ui_program", "typed IR root"), "typed UI program");
    const auto& operations = detail::field(program, "operations", "typed UI program");
    if (!operations.is_array()) throw Error("typed UI operations must be an array");
    for (const auto& raw_operation : operations.as_array()) {
        const auto& operation = detail::object(raw_operation, "typed UI operation");
        if (detail::text(operation, "kind", "typed UI operation") != "add") continue;
        const auto& raw_properties = detail::object(
            detail::field(operation, "properties", "Frame.add"), "Frame.add properties");
        const auto id_value = detail::evaluate(
            detail::field(raw_properties, "id", "Frame.add"));
        if (!id_value.is_string()) throw Error("Frame.add id must be a string");
        layers[detail::id(operation, "layer_id", "Frame.add")] = {
            detail::id(operation, "frame_id", "Frame.add"), id_value.as_string()};
    }

    const auto& packets = packets_value.as_array();
    if (packets.size() < 3) throw Error("retained event program requires display packets");
    const auto& display_packet = detail::object(packets[2], "display packet");
    const auto& display_payload = detail::object(
        detail::field(display_packet, "payload", "display packet"), "display payload");
    const auto& display = detail::object(
        detail::field(display_payload, "display", "display payload"), "display payload data");
    const auto& geom = detail::object(
        detail::field(display, "geom", "display payload data"), "display geom");

    const auto value_descriptor = [&](const vf::JsonValue& raw_value,
                                      const std::string& binding) -> vf::JsonValue {
        const auto& value = detail::object(raw_value, "retained event patch value");
        const std::string kind = detail::text(value, "kind", "retained event patch value");
        if (kind == "const") {
            return vf::JsonValue(vf::JsonValue::Object{
                {"kind", vf::JsonValue("const")},
                {"value", detail::field(value, "value", "retained event patch const")},
            });
        }
        if (kind == "field_access") {
            const auto& subject = detail::object(
                detail::field(value, "object", "retained event field access"),
                "retained event field access object");
            if (detail::text(subject, "kind", "retained event field access object") != "load" ||
                detail::text(subject, "name", "retained event field access object") != binding) {
                throw Error("retained event patch can only read its current event binding");
            }
            return vf::JsonValue(vf::JsonValue::Object{
                {"kind", vf::JsonValue("event_field")},
                {"field", detail::field(value, "field", "retained event field access")},
            });
        }
        throw Error("retained event patch requires a constant or event field");
    };

    vf::JsonValue::Array rules;
    for (const auto& raw_statement : body_value.as_array()) {
        const auto& statement = detail::object(raw_statement, "typed IR statement");
        const auto statement_kind = statement.find("kind");
        if (statement_kind == statement.end() || !statement_kind->second.is_string() ||
            statement_kind->second.as_string() != "expr_stmt") continue;
        const auto& loop = detail::object(
            detail::field(statement, "expr", "typed IR expression statement"),
            "typed IR expression");
        if (detail::text(loop, "kind", "typed IR expression") != "ui_owner_event_loop") continue;
        const std::string binding = detail::text(loop, "binding", "owner event loop");
        const auto& poll = detail::object(
            detail::field(loop, "poll", "owner event loop"), "owner event loop poll");
        const auto& owner = detail::object(
            detail::field(poll, "owner", "owner event loop poll"), "owner event loop owner");
        const std::string owner_name = detail::text(owner, "name", "owner event loop owner");
        const auto component = components.find(owner_name);
        if (component == components.end()) throw Error("retained event owner requires a component id");
        const auto& arms = detail::field(loop, "arms", "owner event loop");
        if (!arms.is_array()) throw Error("owner event loop arms must be an array");
        for (const auto& raw_arm : arms.as_array()) {
            const auto& arm = detail::object(raw_arm, "owner event loop arm");
            const auto& arm_body = detail::object(
                detail::field(arm, "body", "owner event loop arm"), "owner event loop arm body");
            vf::JsonValue::Array statements;
            if (detail::text(arm_body, "kind", "owner event loop arm body") == "block") {
                const auto& block = detail::field(arm_body, "body", "owner event loop arm block");
                if (!block.is_array()) throw Error("owner event loop arm block must be an array");
                statements = block.as_array();
            } else {
                statements.push_back(detail::field(arm, "body", "owner event loop arm"));
            }
            vf::JsonValue::Array actions;
            for (const auto& raw_action : statements) {
                const auto& action = detail::object(raw_action, "owner event loop action");
                if (detail::text(action, "kind", "owner event loop action") != "update_attr") {
                    throw Error("retained event branches currently require direct Layer member assignments");
                }
                const std::string base_name = detail::text(action, "base_name", "Layer patch");
                const auto layer_binding = layer_bindings.find(base_name);
                if (layer_binding == layer_bindings.end()) {
                    throw Error("retained event member assignment requires a Layer binding");
                }
                const auto layer = layers.find(layer_binding->second);
                if (layer == layers.end()) throw Error("retained event Layer was not added to a Frame");
                const std::string property = detail::text(action, "field", "Layer patch");
                const std::vector<std::string> allowed{
                    "visible", "alpha", "reflectivity", "roughness", "specular_strength"};
                bool supported = false;
                for (const auto& candidate : allowed) supported = supported || candidate == property;
                if (!supported) throw Error("retained event Layer patch does not support `" + property + "`");
                const std::string frame_id = "frame_" + std::to_string(layer->second.frame_id);
                const auto frame_geom = geom.find(frame_id);
                if (frame_geom == geom.end()) throw Error("retained event Layer Frame has no geometry");
                vf::JsonValue::Object state{
                    {"layer_id", vf::JsonValue(static_cast<double>(layer_binding->second))},
                    {"mesh_id", vf::JsonValue(layer->second.mesh_id)},
                    {"property", vf::JsonValue(property)},
                    {"value", value_descriptor(
                        detail::field(action, "value", "Layer patch"), binding)},
                    {"geom", frame_geom->second},
                };
                actions.push_back(vf::JsonValue(vf::JsonValue::Object{
                    {"op", vf::JsonValue("retained_layer_patch")},
                    {"target", vf::JsonValue(frame_id)},
                    {"state", vf::JsonValue(std::move(state))},
                }));
            }
            if (actions.empty()) continue;
            rules.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"event", detail::field(arm, "event_type", "owner event loop arm")},
                {"widget_id", vf::JsonValue(component->second.id)},
                {"actions", vf::JsonValue(std::move(actions))},
            }));
        }
    }
    if (rules.empty()) return std::nullopt;
    return vf::JsonValue(vf::JsonValue::Object{
        {"schema", vf::JsonValue("vektor-flow/retained-event-program")},
        {"version", vf::JsonValue(1.0)},
        {"rules", vf::JsonValue(std::move(rules))},
    });
}

}  // namespace vkf::retained_scene
