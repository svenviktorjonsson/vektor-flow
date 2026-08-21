#include "compiler/native/vkf_arm64_encoder.hpp"
#include "compiler/native/vkf_machine_ir_json.hpp"
#include "compiler/native/vkf_machine_ir_lowering.hpp"
#include "compiler/native/vkf_macho_writer.hpp"
#include "compiler/native/vkf_target.hpp"
#include "native/VfOverlay/vf/json.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>

namespace {

class ArtifactFailure : public std::runtime_error {
public:
    explicit ArtifactFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

std::string read_text(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw ArtifactFailure("could not read " + path.string());
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_text(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw ArtifactFailure("could not write " + path.string());
    output << text;
}

void write_bytes(const std::filesystem::path& path, const std::vector<std::uint8_t>& bytes) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw ArtifactFailure("could not write " + path.string());
    output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
}

struct Args {
    std::filesystem::path source;
    std::filesystem::path typed_ir;
};

Args parse_args(int argc, char** argv) {
    Args args;
    for (int index = 1; index < argc; ++index) {
        const std::string arg = argv[index];
        if (arg == "--source" && index + 1 < argc) args.source = argv[++index];
        else if (arg == "--typed-ir" && index + 1 < argc) args.typed_ir = argv[++index];
        else throw ArtifactFailure("usage: vkf_arm64_artifact --source file --typed-ir file");
    }
    if (args.source.empty() || args.typed_ir.empty()) {
        throw ArtifactFailure("source and typed IR are required");
    }
    return args;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        constexpr auto target = vkf::target::macos_arm64_contract();
        const Args args = parse_args(argc, argv);
        const auto typed_ir = vf::parse_json(read_text(args.typed_ir));
        const auto machine_ir = vkf::machine_ir::lower(typed_ir);
        const auto encoded = vkf::arm64::encode(machine_ir);

        const std::string stem = args.source.stem().string().empty()
            ? "program" : args.source.stem().string();
        const auto build_dir = std::filesystem::absolute(args.source).parent_path() / ".vkfbuild" / stem;
        const auto code_path = build_dir / "arm64-code.bin";
        const auto artifact_path = build_dir / (stem + "-arm64");
        const auto machine_ir_path = build_dir / "machine-ir.json";
        const auto manifest_path = build_dir / "arm64-manifest.json";
        std::filesystem::create_directories(build_dir);
        write_bytes(code_path, encoded.code);
        const auto executable = vkf::macho::executable_arm64(
            encoded.code, stem, machine_ir.string_data,
            machine_ir.output_kind == vkf::machine_ir::OutputKind::String,
            machine_ir.output_kind == vkf::machine_ir::OutputKind::None,
            machine_ir.output_kind == vkf::machine_ir::OutputKind::MultipleF64
                ? machine_ir.output_count : 0u,
            machine_ir.outputs, machine_ir.output_tokens);
        write_bytes(artifact_path, executable.bytes);
#ifndef _WIN32
        std::filesystem::permissions(
            artifact_path,
            std::filesystem::perms::owner_exec
                | std::filesystem::perms::group_exec
                | std::filesystem::perms::others_exec,
            std::filesystem::perm_options::add);
#endif
        write_text(machine_ir_path, vf::json_stringify(vkf::machine_ir::module_json(machine_ir), 2) + "\n");

        vf::JsonValue::Object function_offsets;
        for (const auto& [name, offset] : encoded.function_offsets) {
            function_offsets[name] = static_cast<double>(offset);
        }
        vf::JsonValue::Object manifest;
        manifest["artifact_bytes"] = static_cast<double>(executable.bytes.size());
        manifest["artifact_format"] = "macho-executable";
        manifest["artifact_path"] = std::filesystem::absolute(artifact_path).string();
        manifest["backend"] = "arm64-macho";
        manifest["code_bytes"] = static_cast<double>(encoded.code.size());
        manifest["code_path"] = std::filesystem::absolute(code_path).string();
        manifest["entry_offset"] = static_cast<double>(executable.entry_offset);
        manifest["function_offsets"] = vf::JsonValue(std::move(function_offsets));
        manifest["machine_ir"] = std::filesystem::absolute(machine_ir_path).string();
        manifest["machine_ir_version"] = static_cast<double>(vkf::machine_ir::schema_version);
        manifest["result_transport"] = machine_ir.output_kind == vkf::machine_ir::OutputKind::String
            ? "stdout-string"
            : machine_ir.output_kind == vkf::machine_ir::OutputKind::F64 ? "stdout-f64"
            : machine_ir.output_kind == vkf::machine_ir::OutputKind::MultipleF64
                ? "stdout-f64-sequence"
            : machine_ir.output_kind == vkf::machine_ir::OutputKind::MixedSequence
                ? "stdout-value-sequence"
            : machine_ir.output_kind == vkf::machine_ir::OutputKind::StructuredSequence
                ? "stdout-display-plan" : "none";
        manifest["output_count"] = static_cast<double>(machine_ir.output_count);
        manifest["signature_offset"] = static_cast<double>(executable.signature_offset);
        manifest["target_object_format"] = vkf::target::name(target.object_format);
        manifest["runtime_abi_version"] = 12.0;
        manifest["string_bytes"] = static_cast<double>(machine_ir.string_data.size());
        manifest["runtime_imports_complete"] = true;
        manifest["target_architecture"] = vkf::target::name(target.architecture);
        manifest["target_calling_convention"] = vkf::target::name(target.calling_convention);
        manifest["target_os"] = vkf::target::name(target.operating_system);
        write_text(manifest_path, vf::json_stringify(vf::JsonValue(manifest), 2) + "\n");

        vf::JsonValue::Object summary;
        summary["artifact_path"] = artifact_path.string();
        summary["raw_code_path"] = code_path.string();
        summary["machine_ir_path"] = machine_ir_path.string();
        summary["manifest_path"] = manifest_path.string();
        summary["status"] = "compiled";
        std::cout << vf::json_stringify(vf::JsonValue(summary)) << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "<arm64-backend>:1:1: " << error.what() << '\n';
        return 1;
    }
}
