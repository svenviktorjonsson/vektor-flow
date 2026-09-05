// Test-only exact operand transport. Never encode or execute the lowered module.
#include "compiler/native/vkf_machine_ir_lowering.hpp"
#include "compiler/native/vkf_machine_ir_json.hpp"
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>

int main(int argc, char** argv) {
    try {
        if (argc != 3) throw std::runtime_error("expected typed IR path and function name");
        std::ifstream input(argv[1], std::ios::binary);
        if (!input) throw std::runtime_error("could not read typed IR");
        std::ostringstream text;
        text << input.rdbuf();
        const auto module = vkf::machine_ir::lower(vf::parse_json(text.str()));
        std::cout << std::setprecision(std::numeric_limits<double>::max_digits10);
        for (const auto& function : module.functions) {
            if (function.name != argv[2]) continue;
            std::cout << vf::json_stringify(vkf::machine_ir::function_json(function), -1) << '\n';
            for (const auto& instruction : function.instructions) {
                if (instruction.opcode == vkf::machine_ir::Opcode::ReturnF64) continue;
                if (instruction.opcode == vkf::machine_ir::Opcode::PushF64) std::cout << instruction.f64;
                else if (instruction.opcode == vkf::machine_ir::Opcode::LoadLocal) std::cout << instruction.index;
                else std::cout << 0;
                std::cout << '\n';
            }
            return 0;
        }
        throw std::runtime_error("function not found");
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
