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

class BundleArtifactFailure : public std::runtime_error {
public:
    explicit BundleArtifactFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Args {
    std::filesystem::path self;
    std::filesystem::path manifest;
    std::filesystem::path lexer;
    std::filesystem::path parser;
    std::filesystem::path ir;
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
    std::filesystem::path typed_ir_path;
    std::filesystem::path artifact_path;
    std::filesystem::path manifest_path;
};

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw BundleArtifactFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_file(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw BundleArtifactFailure("could not write " + path.string());
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
        if (arg == "--ir" && i + 1 < argc) {
            args.ir = argv[++i];
            continue;
        }
        throw BundleArtifactFailure(
            "usage: vkf_bootstrap_bundle_artifact_smoke --manifest <vf-compiler-bootstrap.json> "
            "[--lexer <vkf_lexer_cursor_smoke.exe>] [--parser <vkf_parser_token_stream_smoke.exe>] "
            "[--ir <vkf_ast_to_ir_smoke.exe>]");
    }
    if (args.manifest.empty()) {
        throw BundleArtifactFailure(
            "usage: vkf_bootstrap_bundle_artifact_smoke --manifest <vf-compiler-bootstrap.json> "
            "[--lexer <vkf_lexer_cursor_smoke.exe>] [--parser <vkf_parser_token_stream_smoke.exe>] "
            "[--ir <vkf_ast_to_ir_smoke.exe>]");
    }
    if (args.lexer.empty()) {
        args.lexer = sibling_tool_path(args.self, "vkf_lexer_cursor_smoke");
    }
    if (args.parser.empty()) {
        args.parser = sibling_tool_path(args.self, "vkf_parser_token_stream_smoke");
    }
    if (args.ir.empty()) {
        args.ir = sibling_tool_path(args.self, "vkf_ast_to_ir_smoke");
    }
    return args;
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw BundleArtifactFailure("missing field " + name + " in " + context);
    }
    return found->second;
}

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw BundleArtifactFailure("expected object for " + context);
    }
    return value.as_object();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) {
        throw BundleArtifactFailure("expected array for " + context);
    }
    return value.as_array();
}

std::string require_string(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_string()) {
        throw BundleArtifactFailure("expected string for " + context);
    }
    return value.as_string();
}

int require_int(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_number()) {
        throw BundleArtifactFailure("expected integer for " + context);
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
        throw BundleArtifactFailure("could not create process pipes");
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

    BOOL ok = CreateProcessA(nullptr, mutable_cmd.data(), nullptr, nullptr, TRUE, 0, nullptr, nullptr, &startup, &process);

    CloseHandle(stdout_write);
    CloseHandle(stderr_write);

    if (!ok) {
        CloseHandle(stdout_read);
        CloseHandle(stderr_read);
        throw BundleArtifactFailure("could not start process " + args.front());
    }

    std::string captured_stdout;
    std::string captured_stderr;
    std::thread stdout_thread([&]() { captured_stdout = read_pipe_all(stdout_read); });
    std::thread stderr_thread([&]() { captured_stderr = read_pipe_all(stderr_read); });

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
    throw BundleArtifactFailure("vkf_bootstrap_bundle_artifact_smoke process orchestration is only implemented for Windows smoke tests");
#endif
}

std::string zero_padded_index(std::size_t index) {
    std::ostringstream out;
    out << std::setw(2) << std::setfill('0') << index;
    return out.str();
}

std::filesystem::path stage_root_for(const std::filesystem::path& manifest_path) {
    return manifest_path.parent_path() / ".vkfbuild" / "bootstrap_bundle_artifact";
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
        throw BundleArtifactFailure("unsupported schema");
    }
    const int version = require_int(field(object, "version", "bootstrap manifest"), "version");
    if (version != bootstrap_version) {
        throw BundleArtifactFailure("unsupported version");
    }
    const auto& sources = array_of(field(object, "sources", "bootstrap manifest"), "sources");
    const int source_count = require_int(field(object, "source_count", "bootstrap manifest"), "source_count");
    if (static_cast<int>(sources.size()) != source_count) {
        throw BundleArtifactFailure("source_count does not match declared sources");
    }
    const auto& source_order = array_of(field(object, "source_order", "bootstrap manifest"), "source_order");
    if (source_order.size() != sources.size()) {
        throw BundleArtifactFailure("source_order does not match sources");
    }

    const std::filesystem::path root_dir = manifest_path.parent_path().parent_path().parent_path();
    const std::filesystem::path stage_root = stage_root_for(manifest_path);
    std::filesystem::create_directories(stage_root);

    std::vector<BundleUnit> units;
    for (std::size_t index = 0; index < sources.size(); ++index) {
        const auto& source = object_of(sources[index], "sources[" + std::to_string(index) + "]");
        const std::string rel_path = require_string(field(source, "path", "source"), "source.path");
        const std::string order_path = require_string(source_order[index], "source_order[" + std::to_string(index) + "]");
        if (rel_path != order_path) {
            throw BundleArtifactFailure("source_order does not match sources");
        }
        const vf::JsonValue& parsed = field(source, "parsed_with_native_parser", "source");
        if (!parsed.is_boolean() || !parsed.as_boolean()) {
            throw BundleArtifactFailure("source entry is not native-parser proven");
        }
        const std::filesystem::path abs_path = root_dir / rel_path;
        if (!std::filesystem::is_regular_file(abs_path)) {
            throw BundleArtifactFailure("missing compiler source " + rel_path);
        }

        const std::string stage_name = zero_padded_index(index) + "_" + sanitize_name(rel_path);
        const std::filesystem::path unit_dir = stage_root / stage_name;
        std::filesystem::create_directories(unit_dir);

        BundleUnit unit;
        unit.path = rel_path;
        unit.absolute_path = abs_path;
        unit.token_path = unit_dir / "tokens.json";
        unit.ast_path = unit_dir / "ast.json";
        unit.typed_ir_path = unit_dir / "typed_ir.json";
        unit.artifact_path = unit_dir / "bundle.artifact.cmd";
        unit.manifest_path = unit_dir / "manifest.json";
        units.push_back(std::move(unit));
    }
    return units;
}

std::string render_value_summary(const vf::JsonValue& value);

std::string render_array_summary(const vf::JsonValue::Array& values) {
    std::string out = "[";
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i > 0) {
            out += ", ";
        }
        out += render_value_summary(values[i]);
    }
    out += "]";
    return out;
}

std::string render_value_summary(const vf::JsonValue& value) {
    const auto& object = object_of(value, "typed IR value");
    const std::string kind = require_string(field(object, "kind", "typed IR value"), "typed IR kind");
    if (kind == "const") {
        const vf::JsonValue& const_value = field(object, "value", "const");
        if (const_value.is_string()) {
            return "\"" + const_value.as_string() + "\"";
        }
        if (const_value.is_number()) {
            std::ostringstream out;
            out << const_value.as_number();
            return out.str();
        }
        if (const_value.is_boolean()) {
            return const_value.as_boolean() ? "true" : "false";
        }
        if (const_value.is_null()) {
            return "null";
        }
        return "<const>";
    }
    if (kind == "load") {
        return "$" + require_string(field(object, "name", "load"), "load.name");
    }
    if (kind == "stdlib_function") {
        return require_string(field(object, "full_name", "stdlib_function"), "stdlib_function.full_name");
    }
    if (kind == "list") {
        return render_array_summary(array_of(field(object, "items", "list"), "list.items"));
    }
    if (kind == "record") {
        const auto& fields = array_of(field(object, "fields", "record"), "record.fields");
        std::string out = "{";
        for (std::size_t i = 0; i < fields.size(); ++i) {
            const auto& field_value = object_of(fields[i], "record field");
            if (i > 0) {
                out += ", ";
            }
            out += require_string(field(field_value, "name", "record field"), "record field.name");
            out += ": ";
            out += render_value_summary(field(field_value, "value", "record field"));
        }
        out += "}";
        return out;
    }
    if (kind == "binary_op") {
        return "("
            + render_value_summary(field(object, "left", "binary_op"))
            + " " + require_string(field(object, "op", "binary_op"), "binary_op.op")
            + " " + render_value_summary(field(object, "right", "binary_op"))
            + ")";
    }
    if (kind == "field_access") {
        return render_value_summary(field(object, "object", "field_access"))
            + "." + require_string(field(object, "field", "field_access"), "field_access.field");
    }
    if (kind == "dotted_index") {
        return render_value_summary(field(object, "base", "dotted_index"))
            + ".(" + render_array_summary(array_of(field(object, "indices", "dotted_index"), "dotted_index.indices")) + ")";
    }
    if (kind == "call") {
        return render_value_summary(field(object, "callee", "call"))
            + "(" + render_array_summary(array_of(field(object, "args", "call"), "call.args")) + ")";
    }
    if (kind == "block_expr") {
        return "<block>";
    }
    if (kind == "match_stmt") {
        return "<match>";
    }
    return "<" + kind + ">";
}

std::string emit_placeholder_script(const vf::JsonValue& typed_ir) {
    const auto& root = object_of(typed_ir, "typed IR module");
    if (require_string(field(root, "kind", "typed IR module"), "typed IR module.kind") != "typed_module") {
        throw BundleArtifactFailure("unsupported typed IR root kind");
    }
    std::string script = "@echo off\r\n";
    script += "rem bootstrap compiler bundle artifact placeholder\r\n";
    for (const auto& stmt_value : array_of(field(root, "body", "typed_module"), "typed_module.body")) {
        const auto& stmt = object_of(stmt_value, "typed IR stmt");
        const std::string kind = require_string(field(stmt, "kind", "typed IR stmt"), "typed IR stmt.kind");
        if (kind == "store_binding") {
            const std::string name = require_string(field(stmt, "name", "store_binding"), "store_binding.name");
            script += "rem bind " + name + " = " + render_value_summary(field(stmt, "value", "store_binding")) + "\r\n";
            continue;
        }
        if (kind == "function") {
            const std::string name = require_string(field(stmt, "name", "function"), "function.name");
            script += "rem function " + name + "\r\n";
            continue;
        }
        if (kind == "type_alias") {
            const std::string name = require_string(field(stmt, "name", "type_alias"), "type_alias.name");
            script += "rem type alias " + name + "\r\n";
            continue;
        }
        if (kind == "expr_stmt") {
            script += "rem expr " + render_value_summary(field(stmt, "expr", "expr_stmt")) + "\r\n";
            continue;
        }
        if (kind == "return") {
            script += "rem return " + render_value_summary(field(stmt, "value", "return")) + "\r\n";
            continue;
        }
        throw BundleArtifactFailure("unsupported typed IR statement kind " + kind);
    }
    script += "exit /b 0\r\n";
    return script;
}

vf::JsonValue unit_manifest_json(const BundleUnit& unit, const vf::JsonValue& typed_ir) {
    vf::JsonValue::Object manifest;
    manifest["source_path"] = vf::JsonValue(unit.absolute_path.string());
    manifest["token_path"] = vf::JsonValue(unit.token_path.string());
    manifest["ast_path"] = vf::JsonValue(unit.ast_path.string());
    manifest["typed_ir_path"] = vf::JsonValue(unit.typed_ir_path.string());
    manifest["artifact_path"] = vf::JsonValue(unit.artifact_path.string());
    manifest["status"] = vf::JsonValue("compiled");
    manifest["kind"] = vf::JsonValue("bootstrap_bundle_artifact");
    const auto& root = object_of(typed_ir, "typed IR module");
    manifest["statement_count"] = vf::JsonValue(static_cast<double>(array_of(field(root, "body", "typed_module"), "typed_module.body").size()));
    return vf::JsonValue(std::move(manifest));
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
        if (!std::filesystem::is_regular_file(args.lexer)) {
            throw BundleArtifactFailure("missing native sibling tool lexer at " + args.lexer.string());
        }
        if (!std::filesystem::is_regular_file(args.parser)) {
            throw BundleArtifactFailure("missing native sibling tool parser at " + args.parser.string());
        }
        if (!std::filesystem::is_regular_file(args.ir)) {
            throw BundleArtifactFailure("missing native sibling tool ir at " + args.ir.string());
        }

        std::vector<BundleUnit> units = read_manifest_units(args.manifest);
        vf::JsonValue::Array emitted_units;
        for (const auto& unit : units) {
            const ProcessResult lexed = run_process({args.lexer.string(), "--file", unit.absolute_path.string(), unit.path});
            if (lexed.exit_code != 0) {
                throw BundleArtifactFailure("lexer failed for " + unit.path + ": " + lexed.stderr_text);
            }
            write_file(unit.token_path, lexed.stdout_text);

            const ProcessResult parsed = run_process({args.parser.string(), unit.token_path.string()});
            if (parsed.exit_code != 0) {
                throw BundleArtifactFailure("parser failed for " + unit.path + ": " + parsed.stderr_text);
            }
            write_file(unit.ast_path, parsed.stdout_text);

            const ProcessResult lowered = run_process({args.ir.string(), unit.ast_path.string()});
            if (lowered.exit_code != 0) {
                throw BundleArtifactFailure("ir failed for " + unit.path + ": " + lowered.stderr_text);
            }
            write_file(unit.typed_ir_path, lowered.stdout_text);
            const vf::JsonValue typed_ir = vf::parse_json(lowered.stdout_text);
            write_file(unit.artifact_path, emit_placeholder_script(typed_ir));
            write_file(unit.manifest_path, vf::json_stringify(unit_manifest_json(unit, typed_ir), 2) + "\n");

            vf::JsonValue::Object out_unit;
            out_unit["path"] = vf::JsonValue(unit.path);
            out_unit["token_path"] = vf::JsonValue(unit.token_path.string());
            out_unit["ast_path"] = vf::JsonValue(unit.ast_path.string());
            out_unit["typed_ir_path"] = vf::JsonValue(unit.typed_ir_path.string());
            out_unit["artifact_path"] = vf::JsonValue(unit.artifact_path.string());
            out_unit["manifest_path"] = vf::JsonValue(unit.manifest_path.string());
            emitted_units.push_back(vf::JsonValue(std::move(out_unit)));
        }

        vf::JsonValue::Object out;
        out["schema"] = vf::JsonValue(std::string(bootstrap_schema));
        out["version"] = vf::JsonValue(static_cast<double>(bootstrap_version));
        out["source_count"] = vf::JsonValue(static_cast<double>(units.size()));
        out["artifact_count"] = vf::JsonValue(static_cast<double>(emitted_units.size()));
        out["status"] = vf::JsonValue("ok");
        out["units"] = vf::JsonValue(std::move(emitted_units));
        std::cout << vf::json_stringify(vf::JsonValue(std::move(out)), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<bootstrap-bundle-artifact-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
