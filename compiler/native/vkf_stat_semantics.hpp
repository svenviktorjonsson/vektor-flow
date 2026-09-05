#pragma once
#include "native/VfOverlay/vf/json.hpp"
#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <vector>

namespace vkf::stat_semantics {
// Exact native validation shared by native and WASM lowering. The failure
// type is supplied by the caller; diagnostic text and order stay native.
template<class LoweringFailure> struct Validation {
static const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) throw LoweringFailure("expected object in " + context);
    return value.as_object();
}

static const vf::JsonValue& field(
    const vf::JsonValue::Object& object,
    const std::string& name,
    const std::string& context
) {
    const auto found = object.find(name);
    if (found == object.end()) throw LoweringFailure("missing " + name + " in " + context);
    return found->second;
}

static std::string string_field(
    const vf::JsonValue::Object& object,
    const std::string& name,
    const std::string& context
) {
    const auto& value = field(object, name, context);
    if (!value.is_string()) throw LoweringFailure("expected string " + name + " in " + context);
    return value.as_string();
}

static const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) throw LoweringFailure("expected array in " + context);
    return value.as_array();
}

static std::string trim(std::string value) {
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) value.erase(value.begin());
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.pop_back();
    return value;
}

static std::vector<std::string> split_top_level(const std::string& text, char separator) {
    std::vector<std::string> parts;
    std::size_t start = 0;
    int depth = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch == '[' || ch == '<' || ch == '{' || ch == '(') ++depth;
        else if (ch == ']' || ch == '>' || ch == '}' || ch == ')') --depth;
        else if (ch == separator && depth == 0) {
            parts.push_back(trim(text.substr(start, index - start)));
            start = index + 1;
        }
    }
    parts.push_back(trim(text.substr(start)));
    return parts;
}

static std::size_t find_top_level(const std::string& text, char separator) {
    int depth = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch == '[' || ch == '<' || ch == '{' || ch == '(') ++depth;
        else if (ch == ']' || ch == '>' || ch == '}' || ch == ')') --depth;
        else if (ch == separator && depth == 0) return index;
    }
    return std::string::npos;
}

struct FixedNumericVectorShape {
    std::vector<std::size_t> dimensions;
};

static std::optional<FixedNumericVectorShape> fixed_numeric_vector_shape(std::string type) {
    FixedNumericVectorShape result;
    type = trim(type);
    while (type.size() >= 3 && type.front() == '[' && type.back() == ']') {
        const std::string inside = type.substr(1, type.size() - 2);
        const auto colon = find_top_level(inside, ':');
        if (colon == std::string::npos) return std::nullopt;
        const std::string count_text = trim(inside.substr(colon + 1));
        if (count_text.empty() ||
            !std::all_of(count_text.begin(), count_text.end(), [](unsigned char ch) {
                return std::isdigit(ch);
            })) {
            return std::nullopt;
        }
        result.dimensions.push_back(static_cast<std::size_t>(std::stoull(count_text)));
        type = trim(inside.substr(0, colon));
    }
    if (result.dimensions.empty() ||
        (type != "int" && type != "num" && type != "f32" && type != "f64")) {
        return std::nullopt;
    }
    return result;
}

static std::vector<std::size_t> constant_stat_sum_axes(
    const vf::JsonValue::Array& named_args,
    std::size_t rank
) {
    if (named_args.size() != 1) {
        throw LoweringFailure("stat.sum accepts only one named argument: axis");
    }
    const auto& named = object_of(named_args.front(), "stat.sum axis");
    if (string_field(named, "name", "stat.sum axis") != "axis") {
        throw LoweringFailure("unknown named argument for stat.sum");
    }
    const auto& value = object_of(field(named, "value", "stat.sum axis"), "stat.sum axis value");
    std::vector<std::int64_t> raw_axes;
    const auto append = [&](const vf::JsonValue::Object& axis) {
        const auto& raw = field(axis, "value", "stat.sum axis value");
        if (string_field(axis, "kind", "stat.sum axis value") != "const" ||
            !raw.is_number() || !std::isfinite(raw.as_number()) ||
            std::floor(raw.as_number()) != raw.as_number()) {
            throw LoweringFailure("stat.sum axis must be a constant integer or tuple of integers");
        }
        raw_axes.push_back(static_cast<std::int64_t>(raw.as_number()));
    };
    if (string_field(value, "kind", "stat.sum axis value") == "tuple") {
        const auto& items = array_of(field(value, "items", "stat.sum axis tuple"), "stat.sum axis tuple");
        if (items.empty()) throw LoweringFailure("stat.sum axis tuple must not be empty");
        for (const auto& item : items) append(object_of(item, "stat.sum axis tuple item"));
    } else {
        append(value);
    }

    std::vector<std::size_t> axes;
    for (auto axis : raw_axes) {
        if (axis < 0) axis += static_cast<std::int64_t>(rank);
        if (axis < 0 || axis >= static_cast<std::int64_t>(rank)) {
            throw LoweringFailure("stat.sum axis is out of range for rank " + std::to_string(rank));
        }
        const auto normalized = static_cast<std::size_t>(axis);
        if (std::find(axes.begin(), axes.end(), normalized) != axes.end()) {
            throw LoweringFailure("stat.sum axis tuple contains a duplicate axis");
        }
        axes.push_back(normalized);
    }
    std::sort(axes.begin(), axes.end());
    return axes;
}

static std::uint32_t degrees_of_freedom(const std::string& name, const vf::JsonValue::Array& named_args) {
            std::uint32_t degrees_of_freedom = 0;
            if (name == "variance" || name == "std") {
                bool saw_ddof = false;
                for (const auto& named_value : named_args) {
                    const auto& named = object_of(named_value, "stat.std named argument");
                    if (string_field(named, "name", "stat.std named argument") != "ddof") {
                        throw LoweringFailure("unknown named argument for stat." + name);
                    }
                    if (saw_ddof) {
                        throw LoweringFailure("multiple values for stat." + name + " ddof");
                    }
                    saw_ddof = true;
                    const auto& value = object_of(
                        field(named, "value", "stat.std ddof"), "stat.std ddof value");
                    const auto& raw = field(value, "value", "stat.std ddof value");
                    if (string_field(value, "kind", "stat.std ddof value") != "const" ||
                        !raw.is_number() || !std::isfinite(raw.as_number()) ||
                        std::floor(raw.as_number()) != raw.as_number() ||
                        raw.as_number() < 0 ||
                        raw.as_number() > static_cast<double>(std::numeric_limits<std::int32_t>::max())) {
                        throw LoweringFailure(
                            "stat." + name + " ddof must be a non-negative integer constant");
                    }
                    degrees_of_freedom = static_cast<std::uint32_t>(raw.as_number());
                }
            } else if (name != "sum" && !named_args.empty()) {
                throw LoweringFailure(
                    "direct machine IR stdlib call does not accept named arguments stat." + name);
            }

 return degrees_of_freedom;
}
};
}
