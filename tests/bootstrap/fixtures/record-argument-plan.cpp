#include "compiler/native/vkf_wasm_record_argument_plan.hpp"
#include <iostream>
using namespace vkf::machine_ir::detail;
vf::JsonValue encode(const vkf::wasm::record_arguments::Plan& plan) {
    vf::JsonValue::Object result;
    result["kind"] = plan.kind == vkf::wasm::record_arguments::PlanKind::Record ? "record" :
        plan.kind == vkf::wasm::record_arguments::PlanKind::Array ? "array" : "leaf";
    vf::JsonValue::Array path;
    for (const auto index : plan.source_indices) path.emplace_back(static_cast<double>(index));
    result["path"] = std::move(path);
    vf::JsonValue::Array children;
    for (const auto& [name, child] : plan.children) {
        vf::JsonValue::Object field;
        field["name"] = name;
        field["value"] = encode(child);
        children.emplace_back(std::move(field));
    }
    result["children"] = std::move(children);
    return vf::JsonValue(std::move(result));
}
int main(int argc, char** argv) {
 try {
    if (argc != 3) return 2;
    const auto source = layout_from_type(argv[1]);
    const auto target = layout_from_type(argv[2]);
    const auto plan = vkf::wasm::record_arguments::make_plan(source, target, "f", "value");
    std::cout << (plan ? vf::json_stringify(encode(*plan), -1) : "null");
 } catch(const std::exception& e) { std::cerr << e.what(); return 1; }
}
