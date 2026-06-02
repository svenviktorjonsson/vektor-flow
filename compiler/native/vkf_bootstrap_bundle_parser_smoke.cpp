#include "native/VfOverlay/vf/json.hpp"

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <regex>
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

class BundleParserFailure : public std::runtime_error {
public:
    explicit BundleParserFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Args {
    std::filesystem::path self;
    std::filesystem::path manifest;
    std::filesystem::path lexer;
    std::filesystem::path parser;
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
    std::filesystem::path ast_path;
};

struct ParsedDiagnostic {
    std::string file;
    int line = 1;
    int column = 1;
    std::string message;
};

struct FailureInfo {
    std::string phase;
    std::string path;
    std::string stderr_text;
    std::filesystem::path token_path;
    ParsedDiagnostic diagnostic;
};

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw BundleParserFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_file(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw BundleParserFailure("could not write " + path.string());
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
        if (arg == "--parser" && i + 1 < argc) {
            args.parser = argv[++i];
            continue;
        }
        throw BundleParserFailure(
            "usage: vkf_bootstrap_bundle_parser_smoke --manifest <vf-compiler-bootstrap.json> "
            "[--lexer <vkf_lexer_cursor_smoke.exe>] [--parser <vkf_parser_token_stream_smoke.exe>]");
    }
    if (args.manifest.empty()) {
        throw BundleParserFailure(
            "usage: vkf_bootstrap_bundle_parser_smoke --manifest <vf-compiler-bootstrap.json> "
            "[--lexer <vkf_lexer_cursor_smoke.exe>] [--parser <vkf_parser_token_stream_smoke.exe>]");
    }
    if (args.lexer.empty()) {
        args.lexer = sibling_tool_path(args.self, "vkf_lexer_cursor_smoke");
    }
    if (args.parser.empty()) {
        args.parser = sibling_tool_path(args.self, "vkf_parser_token_stream_smoke");
    }
    return args;
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw BundleParserFailure("missing field " + name + " in " + context);
    }
    return found->second;
}

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw BundleParserFailure("expected object for " + context);
    }
    return value.as_object();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) {
        throw BundleParserFailure("expected array for " + context);
    }
    return value.as_array();
}

std::string require_string(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_string()) {
        throw BundleParserFailure("expected string for " + context);
    }
    return value.as_string();
}

int require_int(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_number()) {
        throw BundleParserFailure("expected integer for " + context);
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
        throw BundleParserFailure("could not create process pipes");
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
        throw BundleParserFailure("could not start process " + args.front());
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
    return result;
#else
    (void)args;
    throw BundleParserFailure("vkf_bootstrap_bundle_parser_smoke process orchestration is only implemented for Windows smoke tests");
#endif
}

std::string zero_padded_index(std::size_t index) {
    std::ostringstream out;
    out << std::setw(2) << std::setfill('0') << index;
    return out.str();
}

std::filesystem::path stage_root_for(const std::filesystem::path& manifest_path) {
    return manifest_path.parent_path() / ".vkfbuild" / "bootstrap_bundle_parser";
}

std::string sanitize_name(std::string path) {
    for (char& ch : path) {
        if (ch == '/' || ch == '\\' || ch == ':' || ch == '.') {
            ch = '_';
        }
    }
    return path;
}

std::vector<BundleUnit> read_manifest_units(const std::filesystem::path& manifest_path) {
    const vf::JsonValue root = vf::parse_json(read_file(manifest_path));
    const auto& object = object_of(root, "bootstrap manifest");

    const std::string schema = require_string(field(object, "schema", "bootstrap manifest"), "schema");
    if (schema != bootstrap_schema) {
        throw BundleParserFailure("unsupported schema");
    }
    const int version = require_int(field(object, "version", "bootstrap manifest"), "version");
    if (version != bootstrap_version) {
        throw BundleParserFailure("unsupported version");
    }

    const auto& sources = array_of(field(object, "sources", "bootstrap manifest"), "sources");
    const int source_count = require_int(field(object, "source_count", "bootstrap manifest"), "source_count");
    if (static_cast<int>(sources.size()) != source_count) {
        throw BundleParserFailure("source_count does not match declared sources");
    }

    const auto& source_order = array_of(field(object, "source_order", "bootstrap manifest"), "source_order");
    if (source_order.size() != sources.size()) {
        throw BundleParserFailure("source_order does not match sources");
    }

    const std::filesystem::path root_dir = manifest_path.parent_path().parent_path().parent_path();
    const std::filesystem::path stage_root = stage_root_for(manifest_path);
    std::filesystem::create_directories(stage_root);

    std::vector<BundleUnit> units;
    units.reserve(sources.size());
    for (std::size_t index = 0; index < sources.size(); ++index) {
        const auto& source = object_of(sources[index], "sources[" + std::to_string(index) + "]");
        const std::string rel_path = require_string(field(source, "path", "source"), "source.path");
        const std::string order_path = require_string(source_order[index], "source_order[" + std::to_string(index) + "]");
        if (rel_path != order_path) {
            throw BundleParserFailure("source_order does not match sources");
        }
        const vf::JsonValue& parsed = field(source, "parsed_with_native_parser", "source");
        if (!parsed.is_boolean() || !parsed.as_boolean()) {
            throw BundleParserFailure("source entry is not native-parser proven");
        }
        const std::filesystem::path abs_path = root_dir / rel_path;
        if (!std::filesystem::is_regular_file(abs_path)) {
            throw BundleParserFailure("missing compiler source " + rel_path);
        }

        const std::string stage_name = zero_padded_index(index) + "_" + sanitize_name(rel_path);
        const std::filesystem::path unit_dir = stage_root / stage_name;
        std::filesystem::create_directories(unit_dir);

        BundleUnit unit;
        unit.path = rel_path;
        unit.absolute_path = abs_path;
        unit.token_path = unit_dir / "tokens.json";
        unit.ast_path = unit_dir / "ast.json";
        units.push_back(std::move(unit));
    }
    return units;
}

ParsedDiagnostic parse_diagnostic_text(const std::string& text) {
    ParsedDiagnostic diagnostic;
    std::string first_line = text;
    const std::size_t newline = first_line.find('\n');
    if (newline != std::string::npos) {
        first_line = first_line.substr(0, newline);
    }
    while (!first_line.empty() && (first_line.back() == '\r' || first_line.back() == '\n')) {
        first_line.pop_back();
    }

    const std::regex pattern(R"(^(.*):([0-9]+):([0-9]+): (.*)$)");
    std::smatch match;
    if (std::regex_match(first_line, match, pattern)) {
        diagnostic.file = match[1].str();
        diagnostic.line = std::stoi(match[2].str());
        diagnostic.column = std::stoi(match[3].str());
        diagnostic.message = match[4].str();
        return diagnostic;
    }

    diagnostic.file = "<unknown>";
    diagnostic.line = 1;
    diagnostic.column = 1;
    diagnostic.message = first_line.empty() ? text : first_line;
    return diagnostic;
}

vf::JsonValue failure_json(const FailureInfo& failure) {
    vf::JsonValue::Object out;
    out["phase"] = vf::JsonValue(failure.phase);
    out["path"] = vf::JsonValue(failure.path);
    out["stderr"] = vf::JsonValue(failure.stderr_text);
    if (!failure.token_path.empty()) {
        out["token_path"] = vf::JsonValue(failure.token_path.string());
    }
    out["file"] = vf::JsonValue(failure.diagnostic.file);
    out["line"] = vf::JsonValue(static_cast<double>(failure.diagnostic.line));
    out["column"] = vf::JsonValue(static_cast<double>(failure.diagnostic.column));
    out["message"] = vf::JsonValue(failure.diagnostic.message);
    return vf::JsonValue(std::move(out));
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
        if (!std::filesystem::is_regular_file(args.lexer)) {
            throw BundleParserFailure("missing native sibling tool lexer at " + args.lexer.string());
        }
        if (!std::filesystem::is_regular_file(args.parser)) {
            throw BundleParserFailure("missing native sibling tool parser at " + args.parser.string());
        }

        std::vector<BundleUnit> units = read_manifest_units(args.manifest);

        vf::JsonValue::Array parsed_units;
        FailureInfo failure;
        bool has_failure = false;

        for (const auto& unit : units) {
            const ProcessResult lexed = run_process({
                args.lexer.string(),
                "--file",
                unit.absolute_path.string(),
                unit.path,
            });
            if (lexed.exit_code != 0) {
                has_failure = true;
                failure.phase = "lexer";
                failure.path = unit.path;
                failure.stderr_text = lexed.stderr_text;
                failure.diagnostic = parse_diagnostic_text(lexed.stderr_text);
                break;
            }
            write_file(unit.token_path, lexed.stdout_text);

            const ProcessResult parsed = run_process({
                args.parser.string(),
                unit.token_path.string(),
            });
            if (parsed.exit_code != 0) {
                has_failure = true;
                failure.phase = "parser";
                failure.path = unit.path;
                failure.stderr_text = parsed.stderr_text;
                failure.token_path = unit.token_path;
                failure.diagnostic = parse_diagnostic_text(parsed.stderr_text);
                break;
            }
            write_file(unit.ast_path, parsed.stdout_text);

            vf::JsonValue::Object parsed_unit;
            parsed_unit["path"] = vf::JsonValue(unit.path);
            parsed_unit["token_path"] = vf::JsonValue(unit.token_path.string());
            parsed_unit["ast_path"] = vf::JsonValue(unit.ast_path.string());
            parsed_units.push_back(vf::JsonValue(std::move(parsed_unit)));
        }

        vf::JsonValue::Object out;
        out["schema"] = vf::JsonValue(std::string(bootstrap_schema));
        out["version"] = vf::JsonValue(static_cast<double>(bootstrap_version));
        out["source_count"] = vf::JsonValue(static_cast<double>(units.size()));
        out["parsed_count"] = vf::JsonValue(static_cast<double>(parsed_units.size()));
        out["status"] = vf::JsonValue(has_failure ? "unsupported" : "ok");
        out["units"] = vf::JsonValue(std::move(parsed_units));
        if (has_failure) {
            out["failure"] = failure_json(failure);
        }

        std::cout << vf::json_stringify(vf::JsonValue(std::move(out)), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<bootstrap-bundle-parser-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
