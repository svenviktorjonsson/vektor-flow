#include "native/VfOverlay/vf/json.hpp"

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace {

constexpr std::string_view bootstrap_schema = "vektor-flow/compiler-bootstrap";
constexpr int bootstrap_version = 1;

class BundleLexerFailure : public std::runtime_error {
public:
    explicit BundleLexerFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Args {
    std::filesystem::path self;
    std::filesystem::path manifest;
    std::filesystem::path lexer;
};

struct ProcessResult {
    int exit_code = 1;
    std::string stdout_text;
    std::string stderr_text;
};

struct BundleUnit {
    std::string path;
    std::filesystem::path absolute_path;
    std::filesystem::path token_path;
};

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw BundleLexerFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_file(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw BundleLexerFailure("could not write " + path.string());
    }
    output << text;
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

Args parse_args(int argc, char** argv) {
    Args args;
    if (argc > 0) {
        args.self = argv[0];
    }
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--manifest" && i + 1 < argc) {
            args.manifest = argv[++i];
            continue;
        }
        if (arg == "--lexer" && i + 1 < argc) {
            args.lexer = argv[++i];
            continue;
        }
        throw BundleLexerFailure("usage: vkf_bootstrap_bundle_lexer_smoke --manifest <vf-compiler-bootstrap.json> [--lexer <vkf_lexer_cursor_smoke.exe>]");
    }
    if (args.manifest.empty()) {
        throw BundleLexerFailure("usage: vkf_bootstrap_bundle_lexer_smoke --manifest <vf-compiler-bootstrap.json> [--lexer <vkf_lexer_cursor_smoke.exe>]");
    }
    if (args.lexer.empty()) {
        args.lexer = sibling_tool_path(args.self, "vkf_lexer_cursor_smoke");
    }
    return args;
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw BundleLexerFailure("missing field " + name + " in " + context);
    }
    return found->second;
}

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw BundleLexerFailure("expected object for " + context);
    }
    return value.as_object();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) {
        throw BundleLexerFailure("expected array for " + context);
    }
    return value.as_array();
}

std::string require_string(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_string()) {
        throw BundleLexerFailure("expected string for " + context);
    }
    return value.as_string();
}

int require_int(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_number()) {
        throw BundleLexerFailure("expected integer for " + context);
    }
    return static_cast<int>(value.as_number());
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
        throw BundleLexerFailure("could not create process pipes");
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
        throw BundleLexerFailure("could not start process " + args.front());
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
    throw BundleLexerFailure("vkf_bootstrap_bundle_lexer_smoke process orchestration is only implemented for Windows smoke tests");
#endif
}

ProcessResult run_checked(const std::vector<std::string>& args, const std::string& phase) {
    ProcessResult result = run_process(args);
    if (result.exit_code != 0) {
        throw BundleLexerFailure(phase + " failed: " + result.stderr_text);
    }
    return result;
}

std::vector<BundleUnit> load_bundle_units(const std::filesystem::path& manifest_path) {
    const std::filesystem::path repo_root = std::filesystem::absolute(manifest_path).parent_path().parent_path().parent_path();
    const vf::JsonValue root = vf::parse_json(read_file(manifest_path));
    const auto& manifest = object_of(root, "bootstrap manifest");

    const std::string schema = require_string(field(manifest, "schema", "bootstrap manifest"), "bootstrap manifest.schema");
    if (schema != bootstrap_schema) {
        throw BundleLexerFailure("unsupported schema");
    }
    const int version = require_int(field(manifest, "version", "bootstrap manifest"), "bootstrap manifest.version");
    if (version != bootstrap_version) {
        throw BundleLexerFailure("unsupported version");
    }

    const auto& sources = array_of(field(manifest, "sources", "bootstrap manifest"), "sources");
    const auto& source_order = array_of(field(manifest, "source_order", "bootstrap manifest"), "source_order");
    const int source_count = require_int(field(manifest, "source_count", "bootstrap manifest"), "bootstrap manifest.source_count");
    if (static_cast<int>(sources.size()) != source_count || static_cast<int>(source_order.size()) != source_count) {
        throw BundleLexerFailure("source_count does not match declared sources");
    }

    const std::filesystem::path build_root = manifest_path.parent_path() / ".vkfbuild" / "bootstrap_bundle";
    std::filesystem::create_directories(build_root);

    std::vector<BundleUnit> units;
    for (std::size_t i = 0; i < sources.size(); ++i) {
        const auto& source = object_of(sources[i], "source entry");
        const std::string rel_path = require_string(field(source, "path", "source entry"), "source entry.path");
        const std::string ordered_path = require_string(source_order[i], "source_order item");
        if (rel_path != ordered_path) {
            throw BundleLexerFailure("source_order does not match sources");
        }
        const bool parsed_with_native_parser =
            field(source, "parsed_with_native_parser", "source entry").is_boolean()
            && field(source, "parsed_with_native_parser", "source entry").as_boolean();
        if (!parsed_with_native_parser) {
            throw BundleLexerFailure("source entry is not native-parser proven");
        }
        const std::filesystem::path absolute_path = repo_root / rel_path;
        if (!std::filesystem::exists(absolute_path)) {
            throw BundleLexerFailure("missing compiler source " + rel_path);
        }

        std::ostringstream dir_name;
        dir_name << std::setw(2) << std::setfill('0') << i << "_" << absolute_path.stem().string();
        const std::filesystem::path unit_dir = build_root / dir_name.str();
        std::filesystem::create_directories(unit_dir);
        units.push_back({rel_path, absolute_path, unit_dir / "tokens.json"});
    }
    return units;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
        if (!std::filesystem::exists(args.lexer)) {
            throw BundleLexerFailure("missing native sibling tool lexer at " + args.lexer.string());
        }

        const std::vector<BundleUnit> units = load_bundle_units(args.manifest);
        vf::JsonValue::Array summary_units;

        for (const auto& unit : units) {
            const ProcessResult tokens = run_checked(
                {args.lexer.string(), "--file", unit.absolute_path.string(), unit.absolute_path.string()},
                "lexer"
            );
            write_file(unit.token_path, tokens.stdout_text);
            vf::JsonValue::Object out_unit;
            out_unit["path"] = vf::JsonValue(unit.path);
            out_unit["token_path"] = vf::JsonValue(unit.token_path.string());
            summary_units.push_back(vf::JsonValue(std::move(out_unit)));
        }

        vf::JsonValue::Object out;
        out["schema"] = vf::JsonValue(std::string(bootstrap_schema));
        out["version"] = vf::JsonValue(static_cast<double>(bootstrap_version));
        out["source_count"] = vf::JsonValue(static_cast<double>(units.size()));
        out["units"] = vf::JsonValue(std::move(summary_units));
        std::cout << vf::json_stringify(vf::JsonValue(std::move(out)), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<bootstrap-bundle-lexer-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
