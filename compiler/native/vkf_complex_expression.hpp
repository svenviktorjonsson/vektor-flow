#pragma once

#include "native/VfOverlay/vf/json.hpp"

namespace vkf::complex_expression {

inline bool try_components(
    const vf::JsonValue::Object& expression,
    vf::JsonValue& real,
    vf::JsonValue& imaginary
) {
    const auto kind = expression.find("kind");
    if (kind == expression.end() || !kind->second.is_string()) return false;
    if (kind->second.as_string() == "complex_const") {
        const auto real_value = expression.find("real");
        const auto imaginary_value = expression.find("imag");
        if (real_value == expression.end() || !real_value->second.is_number() ||
            imaginary_value == expression.end() || !imaginary_value->second.is_number()) {
            return false;
        }
        real = vf::JsonValue(vf::JsonValue::Object{
            {"kind", vf::JsonValue("const")},
            {"type", vf::JsonValue("num")},
            {"value", real_value->second},
        });
        imaginary = vf::JsonValue(vf::JsonValue::Object{
            {"kind", vf::JsonValue("const")},
            {"type", vf::JsonValue("num")},
            {"value", imaginary_value->second},
        });
        return true;
    }
    if (kind->second.as_string() != "call") return false;
    const auto callee = expression.find("callee");
    const auto args = expression.find("args");
    if (callee == expression.end() || !callee->second.is_object() ||
        args == expression.end() || !args->second.is_array() ||
        args->second.as_array().size() != 2) {
        return false;
    }
    const auto& callee_object = callee->second.as_object();
    const auto callee_kind = callee_object.find("kind");
    const auto callee_name = callee_object.find("name");
    if (callee_kind == callee_object.end() || !callee_kind->second.is_string() ||
        callee_kind->second.as_string() != "load" ||
        callee_name == callee_object.end() || !callee_name->second.is_string() ||
        callee_name->second.as_string() != "num") {
        return false;
    }
    real = args->second.as_array()[0];
    imaginary = args->second.as_array()[1];
    return true;
}

inline bool is_complex(const vf::JsonValue::Object& expression) {
    vf::JsonValue real;
    vf::JsonValue imaginary;
    return try_components(expression, real, imaginary);
}

}  // namespace vkf::complex_expression
