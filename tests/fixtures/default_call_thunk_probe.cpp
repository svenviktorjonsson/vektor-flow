#include "compiler/native/vkf_wasm_default_call_thunk.hpp"

#include <iostream>
#include <iterator>

int main() {
    try {
        const std::string input(std::istreambuf_iterator<char>(std::cin), {});
        const auto request = vf::parse_json(input).as_object();
        const auto module = vkf::wasm::parse_typed_module(request.at("typed_ir"));
        const auto& original = module.functions.at(0);
        const auto before = vf::json_stringify(original.declaration, -1);
        std::vector<vkf::call_binding::Parameter> parameters;
        for (const auto& value : original.declaration.as_object().at("params").as_array()) {
            const auto& parameter = value.as_object();
            parameters.push_back({parameter.at("name").as_string(), !parameter.at("default").is_null()});
        }
        std::vector<std::string> names;
        for (const auto& name : request.at("names").as_array()) names.push_back(name.as_string());
        const auto plan = vkf::call_binding::plan_fixed_call(parameters,
            static_cast<std::size_t>(request.at("positional").as_number()), names, original.name);
        const auto thunk = vkf::wasm::make_default_call_thunk(original, plan, "$vkf_default_probe");
        std::cout << vf::json_stringify(vf::JsonValue::Object{{"ok", true}, {"thunk", thunk.declaration},
            {"original_unchanged", before == vf::json_stringify(original.declaration, -1)}}, -1);
    } catch (const std::exception& error) {
        std::cout << vf::json_stringify(vf::JsonValue::Object{{"ok", false}, {"message", error.what()}}, -1);
    }
}
