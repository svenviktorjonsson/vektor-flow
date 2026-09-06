// Test-only direct access to the existing emitter, with its normal public emit
// method. No production hook, private-access override, or emitted-code execution.
#define VKF_X64_BACKEND_LIBRARY
#include "compiler/native/vkf_x64_artifact.cpp"

void print_bytes(const std::vector<unsigned char>& bytes) {
    std::cout << '[';
    for (std::size_t index = 0; index < bytes.size(); ++index) {
        if (index) std::cout << ',';
        std::cout << static_cast<unsigned>(bytes[index]);
    }
    std::cout << "]\n";
}

int main(int argc, char** argv) {
    try {
        if (argc != 4) throw std::runtime_error("expected locals, max stack, value");
        if (std::string(argv[1]) == "--function") {
            const auto lowered = vkf::machine_ir::lower(vf::parse_json(read_text(argv[2])));
            const auto found = std::find_if(lowered.functions.begin(), lowered.functions.end(),
                [&](const auto& function) { return function.name == argv[3]; });
            if (found == lowered.functions.end()) throw std::runtime_error("native function not found");
            vkf::machine_ir::Module isolated;
            isolated.entry.name = "$entry";
            isolated.entry.max_stack = 1;
            isolated.entry.instructions = {{vkf::machine_ir::Opcode::PushF64}, {vkf::machine_ir::Opcode::ReturnF64}};
            MachineX64Emitter entry_only(isolated, vkf::adaptive_optimizer::policy("mask-0"));
            const auto entry = entry_only.emit();
            isolated.functions.push_back(*found);
            MachineX64Emitter combined(isolated, vkf::adaptive_optimizer::policy("mask-0"));
            const auto code = combined.emit();
            if (code.size() <= entry.size() || !std::equal(entry.begin(), entry.end(), code.begin())) {
                throw std::runtime_error("independent native entry prefix changed");
            }
            std::cout << vf::json_stringify(vkf::machine_ir::function_json(*found), -1) << '\n';
            print_bytes(std::vector<unsigned char>(code.begin() + entry.size(), code.end()));
            return 0;
        }
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
            print_bytes(bytes);
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
