#include "compiler/native/vkf_x64_dce.hpp"

#include <iostream>

int main() {
    vkf::machine_ir::Instruction handled_error;
    handled_error.has_error_handler = true;
    if (vkf::x64::static_cursor_dce_may_scan(handled_error)) {
        std::cerr << "static cursor DCE crossed a handled-error edge with a live cursor\n";
        return 1;
    }
    return 0;
}
