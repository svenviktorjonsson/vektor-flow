#include "compiler/native/vkf_value_layout.hpp"
#include <iostream>
#include <iterator>
vf::JsonValue shape(const vkf::machine_ir::detail::ValueLayout& value) {
    vf::JsonValue::Object result;
    result["width"] = static_cast<double>(value.width);
    result["kind"] = static_cast<double>(value.kind);
    vf::JsonValue::Array fields;
    for (const auto& [name, slice] : value.selectors) {
        vf::JsonValue::Object field;
        field["name"] = name;
        field["offset"] = static_cast<double>(slice.offset);
        field["width"] = static_cast<double>(slice.width);
        field["kind"] = static_cast<double>(slice.kind);
        if (slice.dynamic_element) field["dynamic"] = shape(*slice.dynamic_element);
        fields.emplace_back(std::move(field));
    }
    result["selectors"] = std::move(fields);
    if (value.dynamic_element) result["dynamic"] = shape(*value.dynamic_element);
    return vf::JsonValue(std::move(result));
}
int main() {
 try {
    const std::string input(std::istreambuf_iterator<char>(std::cin), {});
    const auto ir = vf::parse_json(input);
    const auto signatures = vkf::value_layout::infer_module_layouts(ir).signatures;
    vf::JsonValue::Object result;
    for (const auto& [name, signature] : signatures) {
        vf::JsonValue::Object function;
        vf::JsonValue::Array parameters;
        for (const auto& layout : signature.parameters) parameters.push_back(shape(layout));
        function["parameters"] = std::move(parameters);
        function["result"] = shape(signature.result);
        result[name] = std::move(function);
    }
    std::cout << vf::json_stringify(vf::JsonValue(std::move(result)), -1);
 } catch(const std::exception& error) { std::cerr << error.what(); return 1; }
}
