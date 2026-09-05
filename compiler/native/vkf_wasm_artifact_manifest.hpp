#pragma once

#include "compiler/native/vkf_wasm_bytecode_lowering.hpp"
#include "compiler/native/vkf_wasm_vm_emitter.hpp"

namespace vkf::wasm {

inline vf::JsonValue manifest_value(
    const vkf::wasm::TypedModule& typed_module,
    const vkf::wasm::bytecode::Module& bytecode,
    const vkf::wasm::vm::EmittedModule& emitted,
    const std::string& wasm_name
) {
    vf::JsonValue::Object functions;
    for (std::size_t index = 0; index < typed_module.functions.size(); ++index) {
        const auto& declaration = typed_module.functions[index];
        const auto& function = bytecode.functions[index];
        vf::JsonValue::Object item;
        item["index"] = vf::JsonValue(static_cast<double>(index));
        item["parameters"] = vf::JsonValue(
            static_cast<double>(function.parameter_count)
        );
        item["resultType"] = vf::JsonValue(
            static_cast<double>(static_cast<std::uint8_t>(
                function.return_type
            ))
        );
        functions[declaration.name] = vf::JsonValue(std::move(item));
    }

    vf::JsonValue::Object memory;
    memory["bytecodePointer"] = vf::JsonValue(
        static_cast<double>(emitted.layout.bytecode_ptr)
    );
    memory["bytecodeLength"] = vf::JsonValue(
        static_cast<double>(emitted.layout.bytecode_len)
    );
    memory["argumentsPointer"] = vf::JsonValue(
        static_cast<double>(emitted.layout.arguments_ptr)
    );
    memory["argumentsCapacity"] = vf::JsonValue(
        static_cast<double>(emitted.layout.arguments_capacity)
    );
    memory["resultsPointer"] = vf::JsonValue(
        static_cast<double>(emitted.layout.results_ptr)
    );
    memory["resultsCapacity"] = vf::JsonValue(
        static_cast<double>(emitted.layout.results_capacity)
    );

    vf::JsonValue::Object manifest;
    manifest["schema"] = vf::JsonValue("vektor-flow.symbolic-kernel");
    manifest["version"] = vf::JsonValue(1.0);
    manifest["wasm"] = vf::JsonValue(wasm_name);
    manifest["functions"] = vf::JsonValue(std::move(functions));
    manifest["memory"] = vf::JsonValue(std::move(memory));
    return vf::JsonValue(std::move(manifest));
}

} // namespace vkf::wasm
