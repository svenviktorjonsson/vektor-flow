#pragma once

#include "compiler/native/vkf_retained_scene_arena.hpp"
#include <algorithm>
#include <array>
#include <iomanip>
#include <sstream>

namespace vkf::compiled_geometry {

struct CurvePacket {
    native_scene::PackedScene packed;
    vf::JsonValue layout;
};

namespace detail {

// Linear/default branch of vf-axis2d-ticks.js, moved to compiled ownership.
inline double tick_step(double data_scale, double target = 72, double minimum = 48, double maximum = 96) {
    if (!(maximum > minimum)) maximum = target * 1.45;
    const auto exponent = static_cast<int>(std::floor(std::log(data_scale * target) / std::log(10.0)));
    double best = std::pow(10.0, exponent), best_score = std::numeric_limits<double>::infinity();
    for (int power = exponent - 1; power <= exponent + 1; ++power) {
        for (double hint : {1.0, 2.0, 5.0}) {
            const double candidate = hint * std::pow(10.0, power);
            const double pixels = candidate / data_scale;
            const double score = pixels < minimum ? std::log(minimum / pixels)
                : pixels > maximum ? std::log(pixels / maximum)
                : std::abs(std::log(pixels / std::sqrt(minimum * maximum))) * 0.01;
            if (score < best_score) { best_score = score; best = candidate; }
        }
    }
    return best;
}

inline std::vector<double> tick_values(double minimum, double maximum, double step, bool include_zero) {
    std::vector<double> result;
    for (double value = std::ceil((minimum - step * 1e-9) / step) * step;
         value <= maximum + step * 1e-9 && result.size() < 1000; value += step) {
        const double normalized = std::abs(value) < step * 1e-10 ? 0 : value;
        if (include_zero || std::abs(normalized) >= step * 1e-10) result.push_back(normalized);
    }
    return result;
}

inline double tick_offset(const std::vector<double>& values, double minimum, double maximum) {
    if (values.size() < 2 || !(maximum > minimum)) return 0;
    double delta = std::numeric_limits<double>::infinity();
    for (std::size_t index = 1; index < values.size(); ++index) {
        const double difference = std::abs(values[index] - values[index - 1]);
        if (difference > 0 && difference < delta) delta = difference;
    }
    if (!std::isfinite(delta) || std::abs((minimum + maximum) * 0.5) / delta < 1e5) return 0;
    const double offset = std::floor(minimum / delta) * delta;
    return std::isfinite(offset) ? offset : 0;
}

inline std::string significant(double value, int precision) {
    std::ostringstream text;
    text.imbue(std::locale::classic());
    text << std::setprecision(precision) << value;
    return text.str();
}

inline std::string scientific_body(double value) {
    if (value == 0) return "0";
    const std::string sign = value < 0 ? "-" : "";
    value = std::abs(value);
    if (value >= 0.01 && value < 1e4) return sign + significant(value, 6);
    int exponent = static_cast<int>(std::floor(std::log(value) / std::log(10.0)));
    double mantissa = std::stod(significant(value / std::pow(10.0, exponent), 6));
    if (std::abs(mantissa - 10) < 1e-8) { mantissa = 1; ++exponent; }
    const std::string power = "10^{" + std::to_string(exponent) + "}";
    return sign + (std::abs(mantissa - 1) < 1e-8 ? power : significant(mantissa, 6) + " \\cdot " + power);
}

inline std::string tick_label(double value, double step, double offset) {
    if (offset != 0) {
        const double original = value;
        value -= offset;
        if (std::abs(value) < std::abs(original) * 1e-12) value = 0;
    }
    const std::string step_text = significant(std::abs(step), 12);
    const auto exponent = step_text.find('e');
    const auto dot = step_text.find('.');
    const int decimals = exponent != std::string::npos ? std::max(0, -std::stoi(step_text.substr(exponent + 1)))
        : dot != std::string::npos ? std::min(12, static_cast<int>(step_text.size() - dot - 1)) : 0;
    value = std::floor(value / step + 0.5) * step;
    if (std::abs(value) < step * 1e-10) value = 0;
    if (value != 0 && (std::abs(value) < 0.01 || std::abs(value) >= 1e4)) return "$" + scientific_body(value) + "$";
    std::ostringstream text;
    text.imbue(std::locale::classic());
    text << std::fixed << std::setprecision(decimals) << value;
    std::string result = text.str();
    if (result.find('.') != std::string::npos) {
        while (!result.empty() && result.back() == '0') result.pop_back();
        if (!result.empty() && result.back() == '.') result.pop_back();
    }
    if (!result.empty() && result.front() == '-') result.replace(0, 1, "\xE2\x88\x92");
    return result;
}

inline double label_width(std::string text) {
    for (std::size_t position; (position = text.find("\\cdot")) != std::string::npos;) text.replace(position, 5, "*");
    std::size_t count = 0;
    for (unsigned char character : text) {
        if (character != '$' && character != '{' && character != '}' && (character & 0xc0) != 0x80) ++count;
    }
    return static_cast<double>(std::max<std::size_t>(1, count)) * 11 * 0.58 + 8;
}

inline vf::JsonValue axis_ticks(double minimum, double maximum, double pixels, bool readable) {
    const double scale = (maximum - minimum) / pixels;
    double step = tick_step(scale);
    if (readable) {
        for (int attempt = 0; attempt < 12; ++attempt) {
            const auto values = tick_values(minimum, maximum, step, true);
            if (values.size() < 2) break;
            const double offset = tick_offset(values, minimum, maximum);
            double widest = 0;
            for (double value : values) widest = std::max(widest, label_width(tick_label(value, step, offset)));
            const double label_distance = widest + 8;
            if (step / scale >= std::max(48.0, label_distance)) break;
            step = tick_step(scale, std::max(72.0, label_distance), std::max(48.0, label_distance), 96);
        }
    }
    const auto values = tick_values(minimum, maximum, step, false);
    vf::JsonValue::Array array;
    for (double value : values) array.emplace_back(value);
    return vf::JsonValue(vf::JsonValue::Object{
        {"step", vf::JsonValue(step)}, {"values", vf::JsonValue(std::move(array))},
        {"offset", vf::JsonValue(tick_offset(values, minimum, maximum))},
        {"visible_min", vf::JsonValue(minimum)}, {"visible_max", vf::JsonValue(maximum)},
    });
}

} // namespace detail

inline CurvePacket build_u_curve(const vf::JsonValue::Object& properties,
                                double width, double height, double line_width = 2.0) {
    const auto fail = [](const std::string& message) { throw native_scene::Error(message); };
    for (const auto& [name, value] : properties) {
        (void)value;
        if (name != "x_u" && name != "y_u" && name != "id" && name != "color") {
            fail("compiled u-curve does not support `" + name + "`");
        }
    }
    const auto vector = [&](const std::string& name) {
        const auto found = properties.find(name);
        if (found == properties.end() || !found->second.is_array()) {
            fail("compiled u-curve `" + name + "` requires a numeric vector");
        }
        std::vector<double> result;
        for (const auto& value : found->second.as_array()) {
            if (!value.is_number() || !std::isfinite(value.as_number())) {
                fail("compiled u-curve `" + name + "` requires finite numeric values");
            }
            result.push_back(value.as_number());
        }
        return result;
    };
    const auto x = vector("x_u");
    const auto y = vector("y_u");
    const auto color = vector("color");
    if (x.size() != y.size()) fail("retained Frame.add x and y lines must have the same length");
    if (x.size() < 2) fail("compiled u-curve requires at least two samples");
    if (color.size() != 3 && color.size() != 4) fail("retained Frame.add color must have three or four components");
    const auto id = properties.find("id");
    if (id == properties.end() || !id->second.is_string()) fail("Frame.add id must be a string");
    if (!std::isfinite(width) || !std::isfinite(height) || width <= 36 || height <= 36 ||
        !std::isfinite(line_width) || line_width <= 0) fail("compiled u-curve viewport and line width must be positive");

    const auto [x_min, x_max] = std::minmax_element(x.begin(), x.end());
    const auto [y_min, y_max] = std::minmax_element(y.begin(), y.end());
    const double span_x = std::max(*x_max - *x_min, 1e-9);
    const double span_y = std::max(*y_max - *y_min, 1e-9);
    std::vector<std::array<double, 2>> points;
    for (std::size_t index = 0; index < x.size(); ++index) {
        points.push_back({18 + (x[index] - *x_min) / span_x * (width - 36),
            height - 18 - (y[index] - *y_min) / span_y * (height - 36)});
    }
    std::vector<std::array<double, 2>> normals;
    for (std::size_t index = 1; index < points.size(); ++index) {
        const double dx = points[index][0] - points[index - 1][0];
        const double dy = points[index][1] - points[index - 1][1];
        const double length = std::hypot(dx, dy);
        normals.push_back(length > 0 ? std::array<double, 2>{-dy / length, dx / length}
            : (normals.empty() ? std::array<double, 2>{0, 1} : normals.back()));
    }
    vf::JsonValue::Array vertices, indices;
    for (std::size_t index = 0; index < points.size(); ++index) {
        auto normal = normals[index == points.size() - 1 ? index - 1 : index];
        double half_width = line_width * 0.5;
        if (index > 0 && index + 1 < points.size()) {
            const double nx = normals[index - 1][0] + normal[0];
            const double ny = normals[index - 1][1] + normal[1];
            const double length = std::hypot(nx, ny);
            if (length > 0) {
                const std::array<double, 2> miter{nx / length, ny / length};
                const double dot = miter[0] * normal[0] + miter[1] * normal[1];
                // Canvas's existing miter join uses a limit of ten half-widths.
                // Sharp joins outside this slice fail; they are never drawn with holes.
                if (dot < 0.1) fail("compiled u-curve miter join exceeds the supported limit");
                normal = miter;
                half_width /= dot;
            }
        }
        for (const double sign : {-1.0, 1.0}) {
            for (const double value : {points[index][0] + sign * normal[0] * half_width,
                    points[index][1] + sign * normal[1] * half_width, 0.0, 0.0, 0.0, 1.0,
                    color[0], color[1], color[2], color.size() == 4 ? color[3] : 1.0}) {
                vertices.emplace_back(value);
            }
        }
        if (index + 1 < points.size()) {
            const double first = static_cast<double>(index * 2);
            for (double offset : {0.0, 1.0, 2.0, 1.0, 3.0, 2.0}) indices.emplace_back(first + offset);
        }
    }
    vf::JsonValue scene(vf::JsonValue::Object{
        {"meshes", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(vf::JsonValue::Object{
            {"id", id->second}, {"layer_id", vf::JsonValue(0.0)},
            {"type", vf::JsonValue("field_mesh")}, {"topology", vf::JsonValue("triangle-list")},
            {"mode3d", vf::JsonValue(false)}, {"no_lighting", vf::JsonValue(true)},
            {"vertices", vf::JsonValue(std::move(vertices))}, {"indices", vf::JsonValue(std::move(indices))},
        })})},
    });
    vf::JsonValue::Object axes;
    vf::JsonValue::Array labels;
    if (*x_max > *x_min) axes["x"] = detail::axis_ticks(*x_min, *x_max, width, true);
    if (*y_max > *y_min) axes["y"] = detail::axis_ticks(*y_min, *y_max, height, false);
    const double axis_x = 18 + (std::clamp(0.0, *x_min, *x_max) - *x_min) / span_x * (width - 36);
    const double axis_y = height - 18 - (std::clamp(0.0, *y_min, *y_max) - *y_min) / span_y * (height - 36);
    vf::JsonValue::Array axis_vertices, axis_indices;
    const auto axis_stroke = [&](double x1, double y1, double x2, double y2) {
        const double length = std::hypot(x2 - x1, y2 - y1);
        if (length == 0) return;
        const double nx = -(y2 - y1) / length * 0.5;
        const double ny = (x2 - x1) / length * 0.5;
        const double first = static_cast<double>(axis_vertices.size() / 10);
        for (const auto& point : std::array<std::array<double, 2>, 4>{{
                 {x1 - nx, y1 - ny}, {x1 + nx, y1 + ny},
                 {x2 - nx, y2 - ny}, {x2 + nx, y2 + ny}}}) {
            for (double value : {point[0], point[1], 0.0, 0.0, 0.0, 1.0,
                    150.0 / 255, 163.0 / 255, 184.0 / 255, 0.72}) axis_vertices.emplace_back(value);
        }
        for (double offset : {0.0, 1.0, 2.0, 1.0, 3.0, 2.0}) axis_indices.emplace_back(first + offset);
    };
    axis_stroke(18, axis_y, width - 18, axis_y);
    axis_stroke(axis_x, height - 18, axis_x, 18);
    for (const auto& [name, raw] : axes) {
        const auto& axis = raw.as_object();
        for (const auto& value : axis.at("values").as_array()) {
            const double tick = value.as_number();
            const double pixel = name == "x" ? 18 + (tick - *x_min) / span_x * (width - 36)
                : height - 18 - (tick - *y_min) / span_y * (height - 36);
            if (name == "x") axis_stroke(pixel, axis_y - 4, pixel, axis_y + 4);
            else axis_stroke(axis_x - 4, pixel, axis_x + 4, pixel);
            labels.emplace_back(vf::JsonValue::Object{
                {"axis", vf::JsonValue(name)},
                {"text", vf::JsonValue(detail::tick_label(tick, axis.at("step").as_number(), axis.at("offset").as_number()))},
                {"x", vf::JsonValue(name == "x" ? 18 + (tick - *x_min) / span_x * (width - 36) : axis_x - 7)},
                {"y", vf::JsonValue(name == "x" ? axis_y + 6 : height - 18 - (tick - *y_min) / span_y * (height - 36))},
                {"font_size", vf::JsonValue(11.0)},
                {"font_family", vf::JsonValue("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace")},
                {"color", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(203.0 / 255),
                    vf::JsonValue(213.0 / 255), vf::JsonValue(225.0 / 255), vf::JsonValue(0.92)})},
                {"align", vf::JsonValue(name == "x" ? "center" : "right")},
                {"baseline", vf::JsonValue(name == "x" ? "top" : "middle")},
            });
        }
    }
    auto& meshes = scene.as_object().at("meshes").as_array();
    meshes.insert(meshes.begin(), vf::JsonValue(vf::JsonValue::Object{
        {"id", vf::JsonValue(id->second.as_string() + "$axes")},
        {"type", vf::JsonValue("field_mesh")}, {"topology", vf::JsonValue("triangle-list")},
        {"mode3d", vf::JsonValue(false)}, {"no_lighting", vf::JsonValue(true)},
        {"vertices", vf::JsonValue(std::move(axis_vertices))}, {"indices", vf::JsonValue(std::move(axis_indices))},
    }));
    return {native_scene::pack_scene_geometry(std::move(scene)), vf::JsonValue(vf::JsonValue::Object{
        {"dimension", vf::JsonValue(2.0)}, {"width", vf::JsonValue(width)}, {"height", vf::JsonValue(height)},
        {"coordinate_space", vf::JsonValue("pixel")},
        {"background", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(8.0 / 255),
            vf::JsonValue(13.0 / 255), vf::JsonValue(25.0 / 255), vf::JsonValue(1.0)})},
        {"bounds", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(*x_min), vf::JsonValue(*x_max),
            vf::JsonValue(*y_min), vf::JsonValue(*y_max)})},
        {"axes", vf::JsonValue(std::move(axes))}, {"labels", vf::JsonValue(std::move(labels))},
    })};
}

} // namespace vkf::compiled_geometry
