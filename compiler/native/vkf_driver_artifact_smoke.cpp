#include "native/VfOverlay/vf/json.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <cstdlib>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace {

using Clock = std::chrono::steady_clock;

class DriverFailure : public std::runtime_error {
public:
    explicit DriverFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct ProcessResult {
    int exit_code = 1;
    std::string stdout_text;
    std::string stderr_text;
};

struct Args {
    std::filesystem::path self;
    std::filesystem::path source;
    std::filesystem::path lexer;
    std::filesystem::path parser;
    std::filesystem::path ir;
    std::filesystem::path artifact;
    std::filesystem::path wasm_artifact;
    std::filesystem::path webgpu_artifact;
    std::string eval_source;
    bool run = false;
    bool emit_wasm = false;
    bool emit_webgpu = false;
};

struct Dependency {
    std::string name;
    std::filesystem::path path;
};

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw DriverFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

std::string normalize_source_for_lexer(std::string text) {
    std::string out;
    out.reserve(text.size());
    for (char ch : text) {
        if (ch != '\r') {
            out.push_back(ch);
        }
    }
    return out;
}

std::string normalize_eval_source(std::string text) {
    std::size_t index = 0;
    while (index < text.size() && (text[index] == ' ' || text[index] == '\t' || text[index] == '\r' || text[index] == '\n')) {
        ++index;
    }
    if (index + 1 < text.size() && text[index] == ':' && text[index + 1] == ':') {
        std::string expr = text.substr(index + 2);
        while (!expr.empty() && (expr.front() == ' ' || expr.front() == '\t')) {
            expr.erase(expr.begin());
        }
        while (!expr.empty() && (expr.back() == '\r' || expr.back() == '\n' || expr.back() == ' ' || expr.back() == '\t')) {
            expr.pop_back();
        }
        return "print(" + expr + ")\n";
    }
    return text;
}

void write_file(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw DriverFailure("could not write " + path.string());
    }
    output << text;
}

std::string stem_of(const std::filesystem::path& source) {
    const std::string stem = source.stem().string();
    return stem.empty() ? "stdin" : stem;
}

std::filesystem::path build_dir_for(const std::filesystem::path& source) {
    return std::filesystem::absolute(source).parent_path() / ".vkfbuild" / stem_of(source);
}

std::filesystem::path sibling_tool_path(const std::filesystem::path& self, const std::string& stem) {
    std::filesystem::path dir = std::filesystem::absolute(self).parent_path();
    if (dir.empty()) {
        dir = std::filesystem::current_path();
    }
#ifdef _WIN32
    return dir / (stem + ".exe");
#else
    return dir / stem;
#endif
}

void fill_default_tool_paths(Args& args) {
    if (args.lexer.empty()) {
        args.lexer = sibling_tool_path(args.self, "vkf_lexer_cursor_smoke");
    }
    if (args.parser.empty()) {
        args.parser = sibling_tool_path(args.self, "vkf_parser_token_stream_smoke");
    }
    if (args.ir.empty()) {
        args.ir = sibling_tool_path(args.self, "vkf_ast_to_ir_smoke");
    }
    if (args.artifact.empty()) {
        args.artifact = sibling_tool_path(args.self, "vkf_compiler_artifact_smoke");
    }
    if (args.wasm_artifact.empty()) {
        args.wasm_artifact = sibling_tool_path(args.self, "vkf_wasm_artifact_smoke");
    }
    if (args.webgpu_artifact.empty()) {
        args.webgpu_artifact = sibling_tool_path(args.self, "vkf_webgpu_artifact_smoke");
    }
}

void require_tool_exists(const std::filesystem::path& path, const std::string& name) {
    if (!std::filesystem::exists(path)) {
        throw DriverFailure("missing native sibling tool " + name + " at " + path.string());
    }
}

void validate_tool_paths(const Args& args) {
    require_tool_exists(args.lexer, "lexer");
    require_tool_exists(args.parser, "parser");
    require_tool_exists(args.ir, "typed-ir");
    require_tool_exists(args.artifact, "artifact");
    if (args.emit_wasm) {
        require_tool_exists(args.wasm_artifact, "wasm-artifact");
    }
    if (args.emit_webgpu) {
        require_tool_exists(args.webgpu_artifact, "webgpu-artifact");
    }
}

std::vector<Dependency> resolve_stdlib_dependencies(const std::string& source_text) {
    std::vector<Dependency> deps;
    auto add_dep = [&](const std::string& name, const std::filesystem::path& path) {
        for (const auto& dep : deps) {
            if (dep.name == name) {
                return;
            }
        }
        if (!std::filesystem::exists(path)) {
            throw DriverFailure("missing stdlib dependency " + name + " at " + path.string());
        }
        deps.push_back({name, path});
    };
    if (source_text.find("math.") != std::string::npos) {
        add_dep("math", std::filesystem::current_path() / "compiler" / "self_hosted" / "stdlib" / "math.vkf");
    }
    if (source_text.find("io.") != std::string::npos || source_text.find("print(") != std::string::npos) {
        add_dep("io", std::filesystem::current_path() / "compiler" / "self_hosted" / "stdlib" / "io.vkf");
    }
    if (source_text.find("stat.") != std::string::npos || source_text.find("collections.") != std::string::npos) {
        add_dep("stdlib", std::filesystem::current_path() / "compiler" / "self_hosted" / "stdlib.vkf");
    }
    return deps;
}

std::string quote_arg(const std::string& arg) {
    std::string out = "\"";
    for (char ch : arg) {
        if (ch == '"') {
            out += "\\\"";
        } else {
            out.push_back(ch);
        }
    }
    out += "\"";
    return out;
}

std::string command_line(const std::vector<std::string>& args) {
    std::string out;
    for (std::size_t i = 0; i < args.size(); ++i) {
        if (i > 0) {
            out += " ";
        }
        out += quote_arg(args[i]);
    }
    return out;
}

std::string read_pipe_all(
#ifdef _WIN32
    HANDLE pipe
#else
    int pipe
#endif
) {
    std::string out;
#ifdef _WIN32
    char buffer[4096];
    DWORD read = 0;
    while (ReadFile(pipe, buffer, sizeof(buffer), &read, nullptr) && read > 0) {
        out.append(buffer, buffer + read);
    }
#else
    (void)pipe;
#endif
    return out;
}

ProcessResult run_process(const std::vector<std::string>& args) {
#ifdef _WIN32
    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(SECURITY_ATTRIBUTES);
    sa.bInheritHandle = TRUE;
    sa.lpSecurityDescriptor = nullptr;

    HANDLE stdout_read = nullptr;
    HANDLE stdout_write = nullptr;
    HANDLE stderr_read = nullptr;
    HANDLE stderr_write = nullptr;
    if (!CreatePipe(&stdout_read, &stdout_write, &sa, 0) || !CreatePipe(&stderr_read, &stderr_write, &sa, 0)) {
        throw DriverFailure("could not create process pipes");
    }
    SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOA startup;
    ZeroMemory(&startup, sizeof(startup));
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = stdout_write;
    startup.hStdError = stderr_write;

    PROCESS_INFORMATION process;
    ZeroMemory(&process, sizeof(process));
    std::string cmd = command_line(args);
    std::vector<char> mutable_cmd(cmd.begin(), cmd.end());
    mutable_cmd.push_back('\0');

    BOOL ok = CreateProcessA(
        nullptr,
        mutable_cmd.data(),
        nullptr,
        nullptr,
        TRUE,
        0,
        nullptr,
        nullptr,
        &startup,
        &process
    );

    CloseHandle(stdout_write);
    CloseHandle(stderr_write);

    if (!ok) {
        CloseHandle(stdout_read);
        CloseHandle(stderr_read);
        throw DriverFailure("could not start process " + args.front());
    }

    std::string captured_stdout;
    std::string captured_stderr;
    std::thread stdout_thread([&]() {
        captured_stdout = read_pipe_all(stdout_read);
    });
    std::thread stderr_thread([&]() {
        captured_stderr = read_pipe_all(stderr_read);
    });

    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit_code = 1;
    GetExitCodeProcess(process.hProcess, &exit_code);
    stdout_thread.join();
    stderr_thread.join();
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);

    ProcessResult result;
    result.exit_code = static_cast<int>(exit_code);
    result.stdout_text = std::move(captured_stdout);
    result.stderr_text = std::move(captured_stderr);
    CloseHandle(stdout_read);
    CloseHandle(stderr_read);
    return result;
#else
    (void)args;
    throw DriverFailure("vkf_driver_artifact_smoke process orchestration is only implemented for Windows smoke tests");
#endif
}

ProcessResult run_checked(const std::vector<std::string>& args, const std::string& phase) {
    ProcessResult result = run_process(args);
    if (result.exit_code != 0) {
        throw DriverFailure(phase + " failed: " + result.stderr_text);
    }
    return result;
}

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw DriverFailure("expected object for " + context);
    }
    return value.as_object();
}

std::string string_field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end() || !found->second.is_string()) {
        throw DriverFailure("missing string field " + name + " in " + context);
    }
    return found->second.as_string();
}

Args parse_args(int argc, char** argv) {
    Args args;
    if (argc > 0) {
        args.self = argv[0];
    }
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--source" && i + 1 < argc) {
            args.source = argv[++i];
            continue;
        }
        if (arg == "--lexer" && i + 1 < argc) {
            args.lexer = argv[++i];
            continue;
        }
        if (arg == "--parser" && i + 1 < argc) {
            args.parser = argv[++i];
            continue;
        }
        if (arg == "--ir" && i + 1 < argc) {
            args.ir = argv[++i];
            continue;
        }
        if (arg == "--artifact" && i + 1 < argc) {
            args.artifact = argv[++i];
            continue;
        }
        if (arg == "--wasm-artifact" && i + 1 < argc) {
            args.wasm_artifact = argv[++i];
            continue;
        }
        if (arg == "--webgpu-artifact" && i + 1 < argc) {
            args.webgpu_artifact = argv[++i];
            continue;
        }
        if ((arg == "-e" || arg == "--eval") && i + 1 < argc) {
            args.eval_source = argv[++i];
            args.run = true;
            continue;
        }
        if (arg == "--emit-wasm") {
            args.emit_wasm = true;
            continue;
        }
        if (arg == "--emit-webgpu") {
            args.emit_webgpu = true;
            continue;
        }
        if (arg == "--run") {
            args.run = true;
            continue;
        }
        if (!arg.empty() && arg.front() != '-' && args.source.empty()) {
            args.source = arg;
            args.run = true;
            continue;
        }
        throw DriverFailure("usage: vkf_driver_artifact_smoke --source file.vkf [--lexer exe --parser exe --ir exe --artifact exe --wasm-artifact exe --webgpu-artifact exe --emit-wasm --emit-webgpu] [--run]");
    }
    if (args.source.empty() && args.eval_source.empty()) {
        throw DriverFailure("usage: vkf_driver_artifact_smoke [file.vkf | --source file.vkf | -e snippet] [--lexer exe --parser exe --ir exe --artifact exe --wasm-artifact exe --webgpu-artifact exe --emit-wasm --emit-webgpu] [--run]");
    }
    fill_default_tool_paths(args);
    return args;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const auto total_started = Clock::now();
        Args args = parse_args(argc, argv);
        validate_tool_paths(args);
        std::filesystem::path temp_eval_source;
        if (!args.eval_source.empty()) {
            const auto unique = std::to_string(
                static_cast<long long>(std::chrono::duration_cast<std::chrono::microseconds>(
                    Clock::now().time_since_epoch()
                ).count())
            );
            temp_eval_source = std::filesystem::temp_directory_path() / ("vkf_eval_" + unique + ".vkf");
            write_file(temp_eval_source, normalize_eval_source(args.eval_source));
            args.source = temp_eval_source;
        }

        const std::string source_text = read_file(args.source);
        const std::string lexer_source_text = normalize_source_for_lexer(source_text);
        const std::vector<Dependency> dependencies = resolve_stdlib_dependencies(lexer_source_text);
        const auto build_dir = build_dir_for(args.source);
        std::filesystem::create_directories(build_dir);

        const auto token_path = build_dir / "tokens.json";
        const auto ast_path = build_dir / "ast.json";
        const auto typed_ir_path = build_dir / "typed-ir.json";

        const auto lexer_started = Clock::now();
        const std::string source_label = args.eval_source.empty()
            ? std::filesystem::absolute(args.source).string()
            : std::string("<cli>");
        const ProcessResult tokens = run_checked(
            {args.lexer.string(), lexer_source_text, source_label},
            "lexer"
        );
        const auto lexer_finished = Clock::now();
        write_file(token_path, tokens.stdout_text);

        const auto parser_started = Clock::now();
        const ProcessResult ast = run_checked({args.parser.string(), token_path.string()}, "parser");
        const auto parser_finished = Clock::now();
        write_file(ast_path, ast.stdout_text);

        const auto ir_started = Clock::now();
        const ProcessResult typed_ir = run_checked({args.ir.string(), ast_path.string()}, "typed-ir");
        const auto ir_finished = Clock::now();
        write_file(typed_ir_path, typed_ir.stdout_text);

        std::vector<std::string> artifact_args{
            args.artifact.string(),
            "--source",
            args.source.string(),
            "--typed-ir",
            typed_ir_path.string(),
        };
        for (const auto& dependency : dependencies) {
            artifact_args.push_back("--dependency");
            artifact_args.push_back(dependency.name + "=" + dependency.path.string());
        }
        const auto artifact_started = Clock::now();
        const ProcessResult artifact = run_checked(artifact_args, "artifact");
        const auto artifact_finished = Clock::now();
        const auto artifact_summary = object_of(vf::parse_json(artifact.stdout_text), "artifact summary");
        const std::string status = string_field(artifact_summary, "status", "artifact summary");
        const std::string manifest_path = string_field(artifact_summary, "manifest_path", "artifact summary");
        const std::string artifact_path = string_field(artifact_summary, "artifact_path", "artifact summary");
        std::string wasm_status;
        std::string wasm_manifest_path;
        std::string wasm_artifact_path;
        double wasm_ms = 0.0;
        std::string webgpu_status;
        std::string webgpu_manifest_path;
        std::string webgpu_artifact_path;
        double webgpu_ms = 0.0;
        if (args.emit_wasm) {
            std::vector<std::string> wasm_artifact_args{
                args.wasm_artifact.string(),
                "--source",
                args.source.string(),
                "--typed-ir",
                typed_ir_path.string(),
            };
            for (const auto& dependency : dependencies) {
                wasm_artifact_args.push_back("--dependency");
                wasm_artifact_args.push_back(dependency.name + "=" + dependency.path.string());
            }
            const auto wasm_started = Clock::now();
            const ProcessResult wasm_artifact = run_checked(wasm_artifact_args, "wasm-artifact");
            const auto wasm_finished = Clock::now();
            const auto wasm_summary = object_of(vf::parse_json(wasm_artifact.stdout_text), "wasm artifact summary");
            wasm_status = string_field(wasm_summary, "status", "wasm artifact summary");
            wasm_manifest_path = string_field(wasm_summary, "manifest_path", "wasm artifact summary");
            wasm_artifact_path = string_field(wasm_summary, "artifact_path", "wasm artifact summary");
            wasm_ms = std::chrono::duration<double, std::milli>(wasm_finished - wasm_started).count();
        }
        if (args.emit_webgpu) {
            std::vector<std::string> webgpu_artifact_args{
                args.webgpu_artifact.string(),
                "--source",
                args.source.string(),
                "--typed-ir",
                typed_ir_path.string(),
            };
            for (const auto& dependency : dependencies) {
                webgpu_artifact_args.push_back("--dependency");
                webgpu_artifact_args.push_back(dependency.name + "=" + dependency.path.string());
            }
            const auto webgpu_started = Clock::now();
            const ProcessResult webgpu_artifact = run_checked(webgpu_artifact_args, "webgpu-artifact");
            const auto webgpu_finished = Clock::now();
            const auto webgpu_summary = object_of(vf::parse_json(webgpu_artifact.stdout_text), "webgpu artifact summary");
            webgpu_status = string_field(webgpu_summary, "status", "webgpu artifact summary");
            webgpu_manifest_path = string_field(webgpu_summary, "manifest_path", "webgpu artifact summary");
            webgpu_artifact_path = string_field(webgpu_summary, "artifact_path", "webgpu artifact summary");
            webgpu_ms = std::chrono::duration<double, std::milli>(webgpu_finished - webgpu_started).count();
        }

        bool ran = false;
        std::string run_stdout;
        double run_ms = 0.0;
        if (args.run) {
            const auto run_started = Clock::now();
            const ProcessResult run_result = run_checked({"cmd", "/c", artifact_path}, "run");
            const auto run_finished = Clock::now();
            ran = true;
            run_stdout = run_result.stdout_text;
            run_ms = std::chrono::duration<double, std::milli>(run_finished - run_started).count();
        }
        const auto total_finished = Clock::now();

        vf::JsonValue::Object summary;
        summary["artifact_path"] = vf::JsonValue(artifact_path);
        summary["ast_path"] = vf::JsonValue(ast_path.string());
        summary["artifact_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(artifact_finished - artifact_started).count());
        summary["ir_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(ir_finished - ir_started).count());
        summary["lexer_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(lexer_finished - lexer_started).count());
        summary["manifest_path"] = vf::JsonValue(manifest_path);
        summary["parser_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(parser_finished - parser_started).count());
        summary["ran"] = vf::JsonValue(ran);
        summary["run_ms"] = vf::JsonValue(run_ms);
        summary["status"] = vf::JsonValue(status);
        summary["stdout"] = vf::JsonValue(run_stdout);
        summary["token_path"] = vf::JsonValue(token_path.string());
        summary["total_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(total_finished - total_started).count());
        summary["typed_ir_path"] = vf::JsonValue(typed_ir_path.string());
        if (args.emit_wasm) {
            summary["wasm_status"] = vf::JsonValue(wasm_status);
            summary["wasm_manifest_path"] = vf::JsonValue(wasm_manifest_path);
            summary["wasm_artifact_path"] = vf::JsonValue(wasm_artifact_path);
            summary["wasm_ms"] = vf::JsonValue(wasm_ms);
        }
        if (args.emit_webgpu) {
            summary["webgpu_status"] = vf::JsonValue(webgpu_status);
            summary["webgpu_manifest_path"] = vf::JsonValue(webgpu_manifest_path);
            summary["webgpu_artifact_path"] = vf::JsonValue(webgpu_artifact_path);
            summary["webgpu_ms"] = vf::JsonValue(webgpu_ms);
        }
        std::cout << vf::json_stringify(vf::JsonValue(std::move(summary)), -1) << "\n";
        if (!temp_eval_source.empty()) {
            std::error_code ignore;
            std::filesystem::remove(temp_eval_source, ignore);
        }
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<driver-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
