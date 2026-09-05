#pragma once

#include "runtime/vkf_trig_wasm.generated.hpp"

namespace vkf::wasm::trig_package {

inline constexpr std::uint32_t function_count =
    sizeof(generated::functions) / sizeof(generated::functions[0]);
// Match the independently audited standalone candidate's private stack reserve.
// This is not the VKF value arena and must not change its configured capacity.
inline constexpr std::uint32_t stack_bytes = 65536;
inline constexpr std::uint32_t data_bytes = sizeof(generated::static_data);

template<class Writer>
void append_types(Writer& output) {
    for (const auto& function : generated::functions) {
        output.raw(function.type, function.type_size);
    }
}

template<class Writer>
void append_code(Writer& output, std::uint32_t function_base,
                 std::uint32_t stack_global, std::uint32_t memory_base_global) {
    for (const auto& function : generated::functions) {
        Writer body;
        std::size_t cursor = 0;
        for (std::size_t index = 0; index < function.relocation_count; ++index) {
            const auto& relocation = function.relocations[index];
            body.raw(function.body + cursor, relocation.offset - cursor);
            body.u32_leb(relocation.kind == 0 ? function_base + relocation.value
                : relocation.kind == 1 ? stack_global : memory_base_global);
            cursor = relocation.offset + relocation.width;
        }
        body.raw(function.body + cursor, function.body_size - cursor);
        const auto bytes = body.take();
        output.u32_leb(static_cast<std::uint32_t>(bytes.size()));
        output.raw(bytes);
    }
}

} // namespace vkf::wasm::trig_package
