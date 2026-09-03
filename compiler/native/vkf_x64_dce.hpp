#pragma once

#include "compiler/native/vkf_machine_ir.hpp"

namespace vkf::x64 {

inline bool static_cursor_dce_may_scan(
    const vkf::machine_ir::Instruction& instruction
) {
    return !instruction.has_error_handler;
}

}  // namespace vkf::x64
