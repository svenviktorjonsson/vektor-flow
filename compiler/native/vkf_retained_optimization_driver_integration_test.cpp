#include "compiler/native/vkf_machine_ir.hpp"
#include "compiler/native/vkf_x64_backend.hpp"
#include "native/VfOverlay/vf/json.hpp"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

namespace {

int failures = 0;

void expect(bool condition, const std::string& message) {
    if (condition) return;
    std::cerr << message << '\n';
    ++failures;
}

std::string read_text(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    return {
        std::istreambuf_iterator<char>(input),
        std::istreambuf_iterator<char>(),
    };
}

const vf::JsonValue& member(
    const vf::JsonValue& value,
    const std::string& name
) {
    return value.as_object().at(name);
}

void append_integer_loop(
    vkf::machine_ir::Function& function,
    double result
) {
    function.max_stack = 2;
    function.result_is_numeric_scalar = true;
    function.locals = {"counter"};
    function.local_classes = {vkf::machine_ir::ValueClass::I64};
    vkf::machine_ir::Instruction instruction;
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = 0.0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::StoreLocal;
    instruction.index = 0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::Label;
    instruction.label = 1;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::LoadLocal;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = 10000.0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::OrderedLessF64;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::JumpIfFalse;
    instruction.label = 2;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::LoadLocal;
    instruction.index = 0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = 1.0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::AddF64;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::StoreLocal;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::Jump;
    instruction.label = 1;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::Label;
    instruction.label = 2;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = result;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::ReturnF64;
    function.instructions.push_back(instruction);
}

}  // namespace

int main() {
    const auto unique = std::to_string(
        std::chrono::steady_clock::now().time_since_epoch().count()
    );
    const auto root = std::filesystem::temp_directory_path() /
        ("vkf-qopt04-integration-" + unique);
    std::filesystem::create_directories(root);
    const auto source = root / "answer.vkf";
    const auto typed_ir_path = root / "answer.typed.json";
#ifdef _WIN32
    const auto artifact = root / "answer.exe";
#else
    const auto artifact = root / "answer.native";
#endif
    {
        std::ofstream output(source);
        output << "40 + 2 ::\n";
    }

    vf::JsonValue::Object typed_module;
    typed_module["schema"] = "private-qopt04-test";
    const vf::JsonValue typed_ir(std::move(typed_module));

    vkf::machine_ir::Module machine;
    machine.output_kind = vkf::machine_ir::OutputKind::F64;
    machine.output_count = 1;
    machine.entry.name = "entry";
    append_integer_loop(machine.entry, 42.0);
    vkf::machine_ir::Function independent;
    independent.name = "independent";
    append_integer_loop(independent, 7.0);
    machine.functions.push_back(std::move(independent));

    const auto compiled = vkf_x64_backend::compile(
        typed_ir,
        source,
        typed_ir_path,
        {},
        true,
        artifact,
        "source-graph-v1",
        "auto",
        32,
        2000.0,
        0,
        &machine
    );
    const auto manifest = vf::parse_json(read_text(compiled.manifest_path));
    const auto& tuning = member(manifest, "empirical_tuning");
    const auto& candidates = member(tuning, "candidates").as_array();
    expect(candidates.size() == 4,
           "real auto compilation must measure two candidates for each independent leaf");
    expect(member(candidates[0], "policy").as_string() == "mask-0" &&
               member(candidates[1], "policy").as_string() == "mask-fc" &&
               member(candidates[2], "policy").as_string() == "mask-0" &&
               member(candidates[3], "policy").as_string() == "mask-fc",
           "each leaf must report baseline before its ABI-neutral guided candidate");
    bool exact_candidates = true;
    for (const auto& candidate : candidates) {
        exact_candidates = exact_candidates &&
            member(candidate, "tested").as_boolean() &&
            member(candidate, "correct").as_boolean();
    }
    expect(exact_candidates,
           "every real per-function candidate must be measured and preserve exact output parity");

    machine.functions[0].instructions[13].f64 = 8.0;
    const auto incrementally_compiled = vkf_x64_backend::compile(
        typed_ir,
        source,
        typed_ir_path,
        {},
        true,
        artifact,
        "source-graph-v2",
        "auto",
        32,
        2000.0,
        0,
        &machine
    );
    const auto incremental_manifest = vf::parse_json(
        read_text(incrementally_compiled.manifest_path)
    );
    const auto& incremental_candidates = member(
        member(incremental_manifest, "empirical_tuning"), "candidates"
    ).as_array();
    expect(incremental_candidates.size() == 2 &&
               member(incremental_candidates[0], "policy").as_string() ==
                   "mask-0" &&
               member(incremental_candidates[1], "policy").as_string() ==
                   "mask-fc",
           "surrounding code changes must reuse the unchanged entry proof and measure only the changed leaf");

    const auto stdout_path = root / "answer.stdout";
    const std::string command =
#ifdef _WIN32
        "\"\"" + compiled.artifact_path.string() + "\" > \"" +
            stdout_path.string() + "\"\"";
#else
        "\"" + compiled.artifact_path.string() + "\" > \"" +
            stdout_path.string() + "\"";
#endif
    const int run_status = std::system(command.c_str());
    const std::string expected_stdout =
#ifdef _WIN32
        "42\r\n";
#else
        "42\n";
#endif
    expect(run_status == 0 && read_text(stdout_path) == expected_stdout,
           "the selected real artifact must execute with the exact expected result");

    std::filesystem::remove_all(root);
    std::cout << "retained optimization driver integration: candidates="
              << candidates.size() << " incremental_candidates="
              << incremental_candidates.size() << " exact_output="
              << (run_status == 0)
              << '\n';
    return failures == 0 ? 0 : 1;
}
