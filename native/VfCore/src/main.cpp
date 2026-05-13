#include "vf/frontend.hpp"
#include "vf/runtime.hpp"
#include "vf/source.hpp"

#include <filesystem>
#include <iostream>
#include <string>

namespace {

std::string artifact_path_for_executable(const std::string& executable_path) {
    std::filesystem::path path(executable_path);
    path.replace_extension(".vfprog.json");
    return path.string();
}

void print_usage() {
    std::cerr
        << "usage: vf-core <lex|parse|artifact|run|run-artifact> <file|->\n"
        << "       vf-core with no args executes sibling .vfprog.json artifact\n"
        << "       use '-' to read source from stdin\n";
}

}  // namespace

int main(int argc, char** argv) {
    if (argc == 1) {
        try {
            const std::string artifact_path = artifact_path_for_executable(argv[0] == nullptr ? "" : argv[0]);
            const std::string payload = vf::read_source_file(artifact_path);
            const vf::RuntimeProgramArtifact artifact = vf::parse_runtime_program(payload);
            const std::string output = vf::execute_runtime_program(artifact);
            if (!output.empty()) {
                std::cout << output;
            }
            return 0;
        } catch (const std::exception& ex) {
            std::cerr << "error: " << ex.what() << "\n";
            return 1;
        }
    }

    if (argc != 3) {
        print_usage();
        return 1;
    }

    const std::string command = argv[1];
    const std::string input_arg = argv[2];
    const bool from_stdin = input_arg == "-";
    const std::string origin = from_stdin ? "<stdin>" : input_arg;

    std::string source;
    try {
        source = from_stdin ? vf::read_source_stream(std::cin) : vf::read_source_file(input_arg);
    } catch (const std::exception& ex) {
        std::cerr << "error: " << ex.what() << "\n";
        return 1;
    }

    vf::FrontendResult result;
    if (command == "lex") {
        result = vf::lex_source(source, origin);
    } else if (command == "parse") {
        result = vf::parse_source(source, origin);
    } else if (command == "artifact") {
        result = vf::artifact_source(source, origin);
    } else if (command == "run") {
        result = vf::run_source(source, origin);
    } else if (command == "run-artifact") {
        try {
            const vf::RuntimeProgramArtifact artifact = vf::parse_runtime_program(source);
            result.ok = true;
            result.payload = vf::execute_runtime_program(artifact);
        } catch (const std::exception& ex) {
            result.ok = false;
            result.diagnostics.push_back(vf::Diagnostic{"run-artifact", ex.what()});
        }
    } else {
        print_usage();
        return 1;
    }

    if (!result.payload.empty()) {
        std::cout << result.payload;
        if (result.payload.back() != '\n') {
            std::cout << "\n";
        }
    }

    for (const auto& diagnostic : result.diagnostics) {
        std::cerr << diagnostic.stage << ": " << diagnostic.message << "\n";
    }

    return result.ok ? 0 : 2;
}
