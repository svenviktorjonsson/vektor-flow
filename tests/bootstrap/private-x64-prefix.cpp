// Test-only direct access to the existing emitter, with its normal public emit
// method. No production hook, private-access override, or emitted-code execution.
#define VKF_X64_BACKEND_LIBRARY
#include "compiler/native/vkf_x64_artifact.cpp"

int main(int argc, char** argv) {
    try {
        if (argc != 4) throw std::runtime_error("expected locals, max stack, value");
        vkf::machine_ir::Module module;
        module.entry.name = "$entry";
        const auto locals = static_cast<unsigned>(std::stoul(argv[1]));
        module.entry.max_stack = static_cast<unsigned>(std::stoul(argv[2]));
        for (unsigned index = 0; index < locals; ++index) {
            module.entry.locals.push_back("local" + std::to_string(index));
            module.entry.local_classes.push_back(vkf::machine_ir::ValueClass::F64);
        }
        vkf::machine_ir::Instruction literal;
        literal.opcode = vkf::machine_ir::Opcode::PushF64;
        literal.f64 = std::stod(argv[3]);
        module.entry.instructions = {literal, {vkf::machine_ir::Opcode::ReturnF64}};
        MachineX64Emitter emitter(module, vkf::adaptive_optimizer::policy("mask-0"));
        const auto complete = emitter.emit();
        // Drop balances the stack without emitting bytes. With no return this
        // deliberately partial module ends exactly after the first store.
        module.entry.instructions.back().opcode = vkf::machine_ir::Opcode::Drop;
        MachineX64Emitter partial(module, vkf::adaptive_optimizer::policy("mask-0"));
        const auto prefix = partial.emit();
        for (const auto& bytes : {prefix, complete}) {
            std::cout << '[';
            for (std::size_t index = 0; index < bytes.size(); ++index) {
                if (index) std::cout << ',';
                std::cout << static_cast<unsigned>(bytes[index]);
            }
            std::cout << "]\n";
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
