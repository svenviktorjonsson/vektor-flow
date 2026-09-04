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

}  // namespace

int main() {
    const auto unique = std::to_string(
        std::chrono::steady_clock::now().time_since_epoch().count()
    );
    const auto root = std::filesystem::temp_directory_path() /
        ("vkf-qopt03-integration-" + unique);
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
    typed_module["schema"] = "private-qopt03-test";
    const vf::JsonValue typed_ir(std::move(typed_module));

    vkf::machine_ir::Module machine;
    machine.output_kind = vkf::machine_ir::OutputKind::F64;
    machine.output_count = 1;
    machine.entry.name = "entry";
    machine.entry.max_stack = 1;
    machine.entry.result_is_numeric_scalar = true;
    vkf::machine_ir::Instruction constant;
    constant.opcode = vkf::machine_ir::Opcode::PushF64;
    constant.f64 = 42.0;
    machine.entry.instructions.push_back(constant);
    vkf::machine_ir::Instruction finish;
    finish.opcode = vkf::machine_ir::Opcode::ReturnF64;
    machine.entry.instructions.push_back(finish);

    const auto compiled = vkf_x64_backend::compile(
        typed_ir,
        source,
        typed_ir_path,
        {},
        true,
        artifact,
        {},
        "auto",
        32,
        2000.0,
        0,
        &machine
    );
    const auto manifest = vf::parse_json(read_text(compiled.manifest_path));
    const auto& tuning = member(manifest, "empirical_tuning");
    const auto& candidates = member(tuning, "candidates").as_array();
    expect(candidates.size() == 2,
           "real auto compilation must measure only baseline and one guided candidate");
    expect(member(candidates[0], "policy").as_string() == "mask-0" &&
               member(candidates[1], "policy").as_string() == "mask-ff",
           "real auto compilation must report baseline before the guided candidate");
    expect(member(candidates[0], "correct").as_boolean() &&
               member(candidates[1], "correct").as_boolean(),
           "both real machine-code candidates must preserve exact output parity");

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
              << candidates.size() << " exact_output=" << (run_status == 0)
              << '\n';
    return failures == 0 ? 0 : 1;
}
