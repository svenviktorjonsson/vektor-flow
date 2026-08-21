#include "native/VfOverlay/vf/json.hpp"
#include "compiler/native/vkf_sha256.hpp"
#ifdef VKF_X64_BACKEND_LIBRARY
#include "compiler/native/vkf_x64_backend.hpp"
#endif
#ifdef VKF_NATIVE_FRONTEND_LIBRARY
#include "compiler/native/vkf_native_frontend.hpp"
#endif

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iomanip>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <cstdlib>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#else
#include <cerrno>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
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
    std::filesystem::path fallback_artifact;
    std::filesystem::path x64_template;
    std::filesystem::path wasm_artifact;
    std::filesystem::path webgpu_artifact;
    std::string eval_source;
    bool aot = false;
    bool run = false;
    bool emit_wasm = false;
    bool emit_webgpu = false;
    bool external_frontend = false;
    bool diagnostics = false;
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

void normalize_source_for_lexer(std::string& text) {
    text.erase(std::remove(text.begin(), text.end(), '\r'), text.end());
}

std::string normalize_eval_source(std::string text) {
    if (text.empty() || text.back() != '\n') text.push_back('\n');
    return text;
}

std::uint64_t stable_source_key(const std::string& text) {
    std::uint64_t hash = 1469598103934665603ull;
    for (const auto ch : text) {
        hash ^= static_cast<unsigned char>(ch);
        hash *= 1099511628211ull;
    }
    return hash;
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
#ifndef VKF_NATIVE_FRONTEND_LIBRARY
    if (args.lexer.empty()) {
        args.lexer = sibling_tool_path(args.self, "vkf_lexer_cursor_smoke");
    }
    if (args.parser.empty()) {
        args.parser = sibling_tool_path(args.self, "vkf_parser_token_stream_smoke");
    }
    if (args.ir.empty()) {
        args.ir = sibling_tool_path(args.self, "vkf_ast_to_ir_smoke");
    }
#else
    if (args.external_frontend) {
        if (args.lexer.empty()) args.lexer = sibling_tool_path(args.self, "vkf_lexer_cursor_smoke");
        if (args.parser.empty()) args.parser = sibling_tool_path(args.self, "vkf_parser_token_stream_smoke");
        if (args.ir.empty()) args.ir = sibling_tool_path(args.self, "vkf_ast_to_ir_smoke");
    }
#endif
    if (args.artifact.empty()) {
        args.artifact = sibling_tool_path(args.self, args.aot ? "vkf_x64_artifact" : "vkf_compiler_artifact_smoke");
    }
    if (args.aot) {
#if defined(__APPLE__)
        if (args.x64_template.empty()) args.x64_template = sibling_tool_path(args.self, "vkf_x64_runner_template");
#endif
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
#ifdef VKF_NATIVE_FRONTEND_LIBRARY
    if (args.external_frontend) {
#endif
    require_tool_exists(args.lexer, "lexer");
    require_tool_exists(args.parser, "parser");
    require_tool_exists(args.ir, "typed-ir");
#ifdef VKF_NATIVE_FRONTEND_LIBRARY
    }
#endif
#if defined(VKF_X64_BACKEND_LIBRARY)
    if (!args.aot) require_tool_exists(args.artifact, "artifact");
#else
    require_tool_exists(args.artifact, "artifact");
#endif
    if (!args.fallback_artifact.empty()) {
        require_tool_exists(args.fallback_artifact, "fallback-artifact");
    }
    if (!args.x64_template.empty()) {
        require_tool_exists(args.x64_template, "x64-template");
    }
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
    if (source_text.find(".random") != std::string::npos || source_text.find("random.") != std::string::npos) {
        add_dep("random", std::filesystem::current_path() / "compiler" / "self_hosted" / "stdlib" / "random.vkf");
    }
    if (source_text.find(".errors") != std::string::npos || source_text.find("errors.") != std::string::npos) {
        add_dep("errors", std::filesystem::current_path() / "compiler" / "self_hosted" / "stdlib" / "errors.vkf");
    }
    if (source_text.find(".collections") != std::string::npos || source_text.find("collections.") != std::string::npos) {
        add_dep("collections", std::filesystem::current_path() / "compiler" / "self_hosted" / "stdlib" / "collections.vkf");
    }
    if (source_text.find(".physics") != std::string::npos || source_text.find("physics.") != std::string::npos ||
        source_text.find(".rigid_body") != std::string::npos || source_text.find("rigid_body.") != std::string::npos) {
        add_dep("physics", std::filesystem::current_path() / "compiler" / "self_hosted" / "stdlib" / "physics.vkf");
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
    char buffer[4096];
    for (;;) {
        const ssize_t count = read(pipe, buffer, sizeof(buffer));
        if (count > 0) {
            out.append(buffer, buffer + count);
            continue;
        }
        if (count < 0 && errno == EINTR) continue;
        break;
    }
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
    if (args.empty()) throw DriverFailure("cannot run an empty process command");
    int stdout_pipe[2];
    int stderr_pipe[2];
    if (pipe(stdout_pipe) != 0 || pipe(stderr_pipe) != 0) {
        throw DriverFailure("could not create process pipes");
    }
    const pid_t child = fork();
    if (child < 0) {
        close(stdout_pipe[0]); close(stdout_pipe[1]);
        close(stderr_pipe[0]); close(stderr_pipe[1]);
        throw DriverFailure("could not fork process " + args.front());
    }
    if (child == 0) {
        close(stdout_pipe[0]);
        close(stderr_pipe[0]);
        if (dup2(stdout_pipe[1], STDOUT_FILENO) < 0 || dup2(stderr_pipe[1], STDERR_FILENO) < 0) _exit(126);
        close(stdout_pipe[1]);
        close(stderr_pipe[1]);
        std::vector<char*> child_args;
        child_args.reserve(args.size() + 1);
        for (const auto& arg : args) child_args.push_back(const_cast<char*>(arg.c_str()));
        child_args.push_back(nullptr);
        execv(child_args.front(), child_args.data());
        _exit(127);
    }

    close(stdout_pipe[1]);
    close(stderr_pipe[1]);
    std::string captured_stdout;
    std::string captured_stderr;
    std::thread stdout_thread([&]() { captured_stdout = read_pipe_all(stdout_pipe[0]); });
    std::thread stderr_thread([&]() { captured_stderr = read_pipe_all(stderr_pipe[0]); });
    int status = 0;
    while (waitpid(child, &status, 0) < 0) {
        if (errno != EINTR) {
            stdout_thread.join();
            stderr_thread.join();
            close(stdout_pipe[0]);
            close(stderr_pipe[0]);
            throw DriverFailure("could not wait for process " + args.front());
        }
    }
    stdout_thread.join();
    stderr_thread.join();
    close(stdout_pipe[0]);
    close(stderr_pipe[0]);

    ProcessResult result;
    result.exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
    result.stdout_text = std::move(captured_stdout);
    result.stderr_text = std::move(captured_stderr);
    return result;
#endif
}

#ifdef VKF_NATIVE_FRONTEND_LIBRARY
struct StdlibCacheStats {
    std::uint64_t ast_hits = 0;
    std::uint64_t ast_misses = 0;
};

std::string sha256_hex(const std::string& text) {
    const auto digest = vkf::crypto::sha256(
        reinterpret_cast<const std::uint8_t*>(text.data()), text.size());
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (const auto byte : digest) output << std::setw(2) << static_cast<unsigned>(byte);
    return output.str();
}

std::optional<std::filesystem::path> builtin_stdlib_cache_path(
    const std::filesystem::path& source,
    const std::string& normalized_source,
    const std::string& schema,
    const std::string& suffix
) {
    const auto module = std::filesystem::weakly_canonical(source);
    const auto stdlib = module.parent_path();
    const auto self_hosted = stdlib.parent_path();
    const auto compiler = self_hosted.parent_path();
    if (stdlib.filename() != "stdlib" || self_hosted.filename() != "self_hosted" ||
        compiler.filename() != "compiler") return std::nullopt;
    const std::string digest = sha256_hex(schema + '\0' + normalized_source);
    return compiler.parent_path() / ".vkfbuild" / "stdlib-cache" /
        (module.stem().string() + "-" + digest + suffix);
}

void write_cache_file(
    const std::filesystem::path& path,
    const std::string& text
) {
    std::error_code error;
    std::filesystem::create_directories(path.parent_path(), error);
    if (error) return;
    const auto process_id =
#ifdef _WIN32
        static_cast<std::uint64_t>(GetCurrentProcessId());
#else
        static_cast<std::uint64_t>(getpid());
#endif
    const auto temporary = path.string() + ".tmp." + std::to_string(process_id);
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output) return;
        output << text;
    }
#ifdef _WIN32
    if (!MoveFileExW(
            std::filesystem::path(temporary).c_str(), path.c_str(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        error = std::error_code(static_cast<int>(GetLastError()), std::system_category());
    }
#else
    std::filesystem::rename(temporary, path, error);
#endif
    if (error) {
        std::error_code ignore;
        std::filesystem::remove(temporary, ignore);
    }
}

vf::JsonValue parse_linked_module(
    const std::filesystem::path& source,
    StdlibCacheStats& cache_stats
) {
    std::string source_text = read_file(source);
    normalize_source_for_lexer(source_text);
    const std::string cache_schema = "vkf-stdlib-ast-v1";
    const auto cache_path = builtin_stdlib_cache_path(
        source, source_text, cache_schema, ".ast.json");
    const std::string source_digest = sha256_hex(source_text);
    if (cache_path) {
        try {
            if (std::filesystem::is_regular_file(*cache_path)) {
                const auto cached = vf::parse_json(read_file(*cache_path));
                const auto& object = cached.as_object();
                const auto schema = object.find("schema");
                const auto digest = object.find("source_sha256");
                const auto ast = object.find("ast");
                if (schema != object.end() && schema->second.is_string() &&
                    schema->second.as_string() == cache_schema &&
                    digest != object.end() && digest->second.is_string() &&
                    digest->second.as_string() == source_digest && ast != object.end()) {
                    ++cache_stats.ast_hits;
                    return ast->second;
                }
            }
        } catch (const std::exception&) {
            // Invalid cache entries are ignored and replaced from authoritative source.
        }
        ++cache_stats.ast_misses;
    }
    const auto tokens = vkf::native_frontend::lex_value(source_text, source.string());
    const auto ast = vkf::native_frontend::parse_value(tokens);
    if (cache_path) {
        vf::JsonValue::Object cached;
        cached["schema"] = cache_schema;
        cached["source_sha256"] = source_digest;
        cached["ast"] = ast;
        write_cache_file(
            *cache_path, vf::json_stringify(vf::JsonValue(std::move(cached)), -1) + "\n");
    }
    return ast;
}

std::optional<std::filesystem::path> resolve_dot_module(
    const std::filesystem::path& importing_source,
    const std::string& segment
) {
    std::filesystem::path relative(segment);
    if (relative.extension().empty()) relative += ".vkf";
    const auto local = std::filesystem::absolute(importing_source).parent_path() / relative;
    if (std::filesystem::is_regular_file(local)) return std::filesystem::weakly_canonical(local);

    auto directory = std::filesystem::absolute(importing_source).parent_path();
    while (!directory.empty()) {
        const auto builtin = directory / "compiler" / "self_hosted" / "stdlib" / relative;
        if (std::filesystem::is_regular_file(builtin)) return std::filesystem::weakly_canonical(builtin);
        const auto parent = directory.parent_path();
        if (parent == directory) break;
        directory = parent;
    }
    // Eval files and API callers commonly place source in a temporary directory.
    // The compiler still runs from the repository/install root, so resolve its
    // bundled stdlib independently of the user's source location.
    const auto bundled = std::filesystem::current_path() /
        "compiler" / "self_hosted" / "stdlib" / relative;
    if (std::filesystem::is_regular_file(bundled)) {
        return std::filesystem::weakly_canonical(bundled);
    }
    return std::nullopt;
}

std::optional<std::filesystem::path> spilled_module_path(
    const vf::JsonValue& statement_value,
    const std::filesystem::path& importing_source
) {
    if (!statement_value.is_object()) return std::nullopt;
    const auto& statement = statement_value.as_object();
    const auto kind = statement.find("kind");
    if (kind == statement.end() || !kind->second.is_string() || kind->second.as_string() != "spill_import") {
        return std::nullopt;
    }
    const auto alias = statement.find("alias");
    if (alias != statement.end() && !alias->second.is_null()) return std::nullopt;
    const auto path = statement.find("path");
    if (path == statement.end() || !path->second.is_object()) return std::nullopt;
    const auto& path_object = path->second.as_object();
    const auto path_kind = path_object.find("kind");
    const auto segments = path_object.find("segments");
    if (path_kind == path_object.end() || !path_kind->second.is_string()
        || path_kind->second.as_string() != "dot_module_path"
        || segments == path_object.end() || !segments->second.is_array()
        || segments->second.as_array().size() != 1
        || !segments->second.as_array().front().is_string()) {
        return std::nullopt;
    }
    return resolve_dot_module(importing_source, segments->second.as_array().front().as_string());
}

struct AliasedModule {
    std::string alias;
    std::filesystem::path path;
};

std::optional<AliasedModule> aliased_module_path(
    const vf::JsonValue& statement_value,
    const std::filesystem::path& importing_source
) {
    if (!statement_value.is_object()) return std::nullopt;
    const auto& statement = statement_value.as_object();
    const auto kind = statement.find("kind");
    const auto alias = statement.find("alias");
    const auto path = statement.find("path");
    if (kind == statement.end() || !kind->second.is_string() || kind->second.as_string() != "spill_import"
        || alias == statement.end() || !alias->second.is_string()
        || path == statement.end() || !path->second.is_object()) {
        return std::nullopt;
    }
    const auto& path_object = path->second.as_object();
    const auto path_kind = path_object.find("kind");
    const auto segments = path_object.find("segments");
    if (path_kind == path_object.end() || !path_kind->second.is_string()
        || path_kind->second.as_string() != "dot_module_path"
        || segments == path_object.end() || !segments->second.is_array()
        || segments->second.as_array().size() != 1
        || !segments->second.as_array().front().is_string()) {
        return std::nullopt;
    }
    const auto resolved = resolve_dot_module(importing_source, segments->second.as_array().front().as_string());
    if (!resolved) return std::nullopt;
    return AliasedModule{alias->second.as_string(), *resolved};
}

vf::JsonValue rewrite_module_symbols(
    const vf::JsonValue& value,
    const std::map<std::string, std::string>& symbols
) {
    if (value.is_array()) {
        vf::JsonValue::Array rewritten;
        for (const auto& item : value.as_array()) rewritten.push_back(rewrite_module_symbols(item, symbols));
        return vf::JsonValue(std::move(rewritten));
    }
    if (!value.is_object()) return value;
    vf::JsonValue::Object rewritten;
    for (const auto& [key, child] : value.as_object()) {
        rewritten[key] = rewrite_module_symbols(child, symbols);
    }
    const auto kind = rewritten.find("kind");
    const auto name = rewritten.find("name");
    if (kind != rewritten.end() && kind->second.is_string() && name != rewritten.end() && name->second.is_string()
        && (kind->second.as_string() == "identifier" || kind->second.as_string() == "function_definition")) {
        const auto replacement = symbols.find(name->second.as_string());
        if (replacement != symbols.end()) name->second = replacement->second;
    }
    return vf::JsonValue(std::move(rewritten));
}

vf::JsonValue rewrite_aliased_module_calls(
    const vf::JsonValue& value,
    const std::map<std::string, std::map<std::string, std::string>>& exports
) {
    if (value.is_array()) {
        vf::JsonValue::Array rewritten;
        for (const auto& item : value.as_array()) rewritten.push_back(rewrite_aliased_module_calls(item, exports));
        return vf::JsonValue(std::move(rewritten));
    }
    if (!value.is_object()) return value;
    vf::JsonValue::Object rewritten;
    for (const auto& [key, child] : value.as_object()) {
        rewritten[key] = rewrite_aliased_module_calls(child, exports);
    }
    const auto kind = rewritten.find("kind");
    if (kind != rewritten.end() && kind->second.is_string() &&
        kind->second.as_string() == "attribute") {
        const auto field = rewritten.find("name");
        const auto object = rewritten.find("object");
        if (field != rewritten.end() && field->second.is_string() &&
            object != rewritten.end() && object->second.is_object()) {
            const auto& base = object->second.as_object();
            const auto base_kind = base.find("kind");
            const auto base_name = base.find("name");
            if (base_kind != base.end() && base_kind->second.is_string() &&
                base_kind->second.as_string() == "identifier" &&
                base_name != base.end() && base_name->second.is_string()) {
                const auto module = exports.find(base_name->second.as_string());
                if (module != exports.end()) {
                    const auto exported = module->second.find(field->second.as_string());
                    if (exported != module->second.end()) {
                        vf::JsonValue::Object direct;
                        direct["kind"] = "identifier";
                        direct["name"] = exported->second;
                        return vf::JsonValue(std::move(direct));
                    }
                }
            }
        }
    }
    const auto callee = rewritten.find("callee");
    if (kind == rewritten.end() || !kind->second.is_string() || kind->second.as_string() != "call"
        || callee == rewritten.end() || !callee->second.is_object()) {
        return vf::JsonValue(std::move(rewritten));
    }
    const auto& callee_object = callee->second.as_object();
    const auto callee_kind = callee_object.find("kind");
    const auto field = callee_object.find("name");
    const auto object = callee_object.find("object");
    if (callee_kind == callee_object.end() || !callee_kind->second.is_string()
        || callee_kind->second.as_string() != "attribute"
        || field == callee_object.end() || !field->second.is_string()
        || object == callee_object.end() || !object->second.is_object()) {
        return vf::JsonValue(std::move(rewritten));
    }
    const auto& base = object->second.as_object();
    const auto base_kind = base.find("kind");
    const auto base_name = base.find("name");
    if (base_kind == base.end() || !base_kind->second.is_string() || base_kind->second.as_string() != "identifier"
        || base_name == base.end() || !base_name->second.is_string()) {
        return vf::JsonValue(std::move(rewritten));
    }
    const auto module = exports.find(base_name->second.as_string());
    if (module == exports.end()) return vf::JsonValue(std::move(rewritten));
    const auto exported = module->second.find(field->second.as_string());
    // Source modules may deliberately retain compiler/runtime primitives under
    // the same namespace (for example stat.sum and math.sqrt). Leave those
    // calls qualified so normal typed-IR validation owns the diagnostic.
    if (exported == module->second.end()) return vf::JsonValue(std::move(rewritten));
    vf::JsonValue::Object direct;
    direct["kind"] = "identifier";
    direct["name"] = exported->second;
    rewritten["callee"] = vf::JsonValue(std::move(direct));
    return vf::JsonValue(std::move(rewritten));
}

void append_linked_spilled_module_body(
    vf::JsonValue::Array& linked_body,
    const vf::JsonValue& module_value,
    const std::filesystem::path& module_source,
    std::set<std::filesystem::path>& linked_sources,
    StdlibCacheStats& cache_stats
) {
    if (!module_value.is_object()) throw DriverFailure("linked module AST is not an object");
    const auto& module = module_value.as_object();
    const auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) {
        throw DriverFailure("linked module AST has no body");
    }
    for (const auto& statement : body->second.as_array()) {
        const auto dependency = spilled_module_path(statement, module_source);
        if (!dependency || !linked_sources.insert(*dependency).second) continue;
        const auto ast = parse_linked_module(*dependency, cache_stats);
        append_linked_spilled_module_body(
            linked_body, ast, *dependency, linked_sources, cache_stats);
    }
    for (const auto& statement : body->second.as_array()) linked_body.push_back(statement);
}

vf::JsonValue link_spilled_file_modules(
    const vf::JsonValue& root_module,
    const std::filesystem::path& root_source,
    StdlibCacheStats& cache_stats
) {
    vf::JsonValue::Array linked_body;
    std::set<std::filesystem::path> linked_sources;
    append_linked_spilled_module_body(
        linked_body, root_module, root_source, linked_sources, cache_stats);
    vf::JsonValue::Array namespaced_modules;
    std::map<std::string, std::map<std::string, std::string>> exports;
    const auto& root_body = root_module.as_object().at("body").as_array();
    for (const auto& statement : root_body) {
        const auto imported = aliased_module_path(statement, root_source);
        if (!imported) continue;
        const auto dependency_ast = parse_linked_module(imported->path, cache_stats);
        const auto& dependency_body = dependency_ast.as_object().at("body").as_array();
        std::map<std::string, std::string> symbols;
        for (const auto& dependency_statement : dependency_body) {
            if (!dependency_statement.is_object()) continue;
            const auto& object = dependency_statement.as_object();
            const auto kind = object.find("kind");
            const auto name = object.find("name");
            if (kind != object.end() && kind->second.is_string()
                && kind->second.as_string() == "function_definition"
                && name != object.end() && name->second.is_string()) {
                const std::string mangled = "__vkf_module_" + imported->alias + "__" + name->second.as_string();
                symbols[name->second.as_string()] = mangled;
                exports[imported->alias][name->second.as_string()] = mangled;
            }
            if (kind != object.end() && kind->second.is_string() &&
                kind->second.as_string() == "bind") {
                const auto target = object.find("target");
                if (target != object.end() && target->second.is_object()) {
                    const auto& target_object = target->second.as_object();
                    const auto target_kind = target_object.find("kind");
                    const auto target_name = target_object.find("name");
                    if (target_kind != target_object.end() && target_kind->second.is_string() &&
                        target_kind->second.as_string() == "identifier" &&
                        target_name != target_object.end() && target_name->second.is_string()) {
                        const std::string mangled = "__vkf_module_" + imported->alias + "__" +
                            target_name->second.as_string();
                        symbols[target_name->second.as_string()] = mangled;
                        exports[imported->alias][target_name->second.as_string()] = mangled;
                    }
                }
            }
        }
        for (const auto& dependency_statement : dependency_body) {
            namespaced_modules.push_back(rewrite_module_symbols(dependency_statement, symbols));
        }
    }
    vf::JsonValue::Array rewritten_body;
    for (auto& statement : namespaced_modules) rewritten_body.push_back(std::move(statement));
    for (const auto& statement : linked_body) {
        rewritten_body.push_back(rewrite_aliased_module_calls(statement, exports));
    }
    vf::JsonValue::Object linked_module;
    linked_module["kind"] = "module";
    linked_module["body"] = vf::JsonValue(std::move(rewritten_body));
    return vf::JsonValue(std::move(linked_module));
}
#endif

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
            args.external_frontend = true;
            continue;
        }
        if (arg == "--parser" && i + 1 < argc) {
            args.parser = argv[++i];
            args.external_frontend = true;
            continue;
        }
        if (arg == "--ir" && i + 1 < argc) {
            args.ir = argv[++i];
            args.external_frontend = true;
            continue;
        }
        if (arg == "--artifact" && i + 1 < argc) {
            args.artifact = argv[++i];
            continue;
        }
        if (arg == "--fallback-artifact" && i + 1 < argc) {
            args.fallback_artifact = argv[++i];
            continue;
        }
        if (arg == "--x64-template" && i + 1 < argc) {
            args.x64_template = argv[++i];
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
        if (arg == "--aot") {
            args.aot = true;
            continue;
        }
        if (arg == "--diagnostics") {
            args.diagnostics = true;
            continue;
        }
        if (!arg.empty() && arg.front() != '-' && args.source.empty()) {
            args.source = arg;
            args.run = true;
            continue;
        }
        throw DriverFailure("usage: vkf_driver_artifact_smoke --source file.vkf [--aot] [--lexer exe --parser exe --ir exe --artifact exe --wasm-artifact exe --webgpu-artifact exe --emit-wasm --emit-webgpu] [--run]");
    }
    if (args.source.empty() && args.eval_source.empty()) {
        throw DriverFailure("usage: vkf_driver_artifact_smoke [file.vkf | --source file.vkf | -e snippet] [--aot] [--lexer exe --parser exe --ir exe --artifact exe --wasm-artifact exe --webgpu-artifact exe --emit-wasm --emit-webgpu] [--run]");
    }
    fill_default_tool_paths(args);
    return args;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const auto compile_one = [](Args args) -> std::string {
        const auto total_started = Clock::now();
        validate_tool_paths(args);
        std::filesystem::path temp_eval_source;
        std::string eval_source_text;
        if (!args.eval_source.empty()) {
            eval_source_text = normalize_eval_source(args.eval_source);
            const auto eval_dir = std::filesystem::current_path() / ".vkf-eval";
            std::filesystem::create_directories(eval_dir);
            temp_eval_source = eval_dir /
                ("vkf_eval_" + std::to_string(stable_source_key(eval_source_text)) + ".vkf");
            if (args.external_frontend) write_file(temp_eval_source, eval_source_text);
            args.source = temp_eval_source;
        }

        std::string source_text = args.eval_source.empty() ? read_file(args.source) : eval_source_text;
        normalize_source_for_lexer(source_text);
        const std::string& lexer_source_text = source_text;
        const std::string& dependency_source_text = args.eval_source.empty()
            ? lexer_source_text
            : args.eval_source;
        const bool needs_dependency_artifacts = !args.aot || !args.fallback_artifact.empty() ||
            args.emit_wasm || args.emit_webgpu;
        const std::vector<Dependency> dependencies = needs_dependency_artifacts
            ? resolve_stdlib_dependencies(dependency_source_text)
            : std::vector<Dependency>{};
        const bool materialize_frontend = args.diagnostics || args.external_frontend || !args.aot ||
            !args.fallback_artifact.empty() || args.emit_wasm || args.emit_webgpu;
        const auto build_dir = materialize_frontend
            ? build_dir_for(args.source)
            : std::filesystem::absolute(args.source).parent_path() / ".vkfbuild";
        if (materialize_frontend) std::filesystem::create_directories(build_dir);

        const auto token_path = build_dir / "tokens.json";
        const auto ast_path = build_dir / "ast.json";
        const auto typed_ir_path = build_dir / "typed-ir.json";
#ifdef VKF_NATIVE_FRONTEND_LIBRARY
        StdlibCacheStats stdlib_cache_stats;
#endif

        const auto lexer_started = Clock::now();
        const std::string source_label = args.eval_source.empty()
            ? std::filesystem::absolute(args.source).string()
            : std::string("<cli>");
        ProcessResult tokens;
        std::optional<vf::JsonValue> integrated_tokens;
#ifdef VKF_NATIVE_FRONTEND_LIBRARY
        if (!args.external_frontend) {
            integrated_tokens = vkf::native_frontend::lex_value(lexer_source_text, source_label);
            tokens = {
                0,
                materialize_frontend
                    ? vf::json_stringify(*integrated_tokens, -1) + "\n"
                    : std::string{},
                ""
            };
        } else
#endif
        {
            tokens = run_checked(
                {args.lexer.string(), "--file", args.source.string(), source_label},
                "lexer"
            );
        }
        const auto lexer_finished = Clock::now();
        if (materialize_frontend) write_file(token_path, tokens.stdout_text);

        const auto parser_started = Clock::now();
        ProcessResult ast;
        std::optional<vf::JsonValue> integrated_ast;
        std::optional<vf::JsonValue> linked_integrated_ast;
#ifdef VKF_NATIVE_FRONTEND_LIBRARY
        if (!args.external_frontend) {
            integrated_ast = vkf::native_frontend::parse_value(*integrated_tokens);
            linked_integrated_ast = link_spilled_file_modules(
                *integrated_ast, args.source, stdlib_cache_stats);
            ast = {
                0,
                materialize_frontend
                    ? vf::json_stringify(*integrated_ast, -1) + "\n"
                    : std::string{},
                ""
            };
        } else
#endif
        {
            ast = run_checked({args.parser.string(), token_path.string()}, "parser");
        }
        const auto parser_finished = Clock::now();
        if (materialize_frontend) write_file(ast_path, ast.stdout_text);

        const auto ir_started = Clock::now();
        ProcessResult typed_ir;
        std::optional<vf::JsonValue> integrated_typed_ir;
#ifdef VKF_NATIVE_FRONTEND_LIBRARY
        if (!args.external_frontend) {
            integrated_typed_ir = vkf::native_frontend::lower_value(*linked_integrated_ast);
            typed_ir = {
                0,
                materialize_frontend
                    ? vf::json_stringify(*integrated_typed_ir, -1) + "\n"
                    : std::string{},
                ""
            };
        } else
#endif
        {
            typed_ir = run_checked({args.ir.string(), ast_path.string()}, "typed-ir");
        }
        const auto ir_finished = Clock::now();
        if (materialize_frontend) write_file(typed_ir_path, typed_ir.stdout_text);

        std::vector<std::string> artifact_args;
        if (!args.aot || !args.fallback_artifact.empty()) {
            artifact_args = {
                args.artifact.string(),
                "--source",
                args.source.string(),
                "--typed-ir",
                typed_ir_path.string(),
                "--deferred",
            };
            for (const auto& dependency : dependencies) {
                artifact_args.push_back("--dependency");
                artifact_args.push_back(dependency.name + "=" + dependency.path.string());
            }
        }
        const auto artifact_started = Clock::now();
        bool used_fallback_artifact = false;
        std::string fallback_reason;
        std::string status;
        std::string manifest_path;
        std::string artifact_path;
        if (args.aot) {
#ifdef VKF_X64_BACKEND_LIBRARY
            std::optional<vf::JsonValue> parsed_direct_ir;
            if (!integrated_typed_ir) parsed_direct_ir = vf::parse_json(typed_ir.stdout_text);
            const vf::JsonValue& direct_ir = integrated_typed_ir
                ? *integrated_typed_ir
                : *parsed_direct_ir;
            try {
                const auto direct = vkf_x64_backend::compile(
                    direct_ir, args.source, typed_ir_path, args.x64_template,
                    materialize_frontend
                );
                status = "compiled";
                manifest_path = direct.manifest_path.string();
                artifact_path = direct.artifact_path.string();
            } catch (const vkf_x64_backend::Unsupported& unsupported) {
                fallback_reason = unsupported.what();
                if (args.fallback_artifact.empty()) {
                    throw DriverFailure("direct x64 backend unsupported: " + fallback_reason);
                }
                artifact_args.front() = args.fallback_artifact.string();
                const ProcessResult fallback = run_checked(artifact_args, "fallback-artifact");
                const auto fallback_summary = object_of(vf::parse_json(fallback.stdout_text), "fallback artifact summary");
                status = string_field(fallback_summary, "status", "fallback artifact summary");
                manifest_path = string_field(fallback_summary, "manifest_path", "fallback artifact summary");
                artifact_path = string_field(fallback_summary, "artifact_path", "fallback artifact summary");
                used_fallback_artifact = true;
            }
#else
            throw DriverFailure("driver was built without the integrated x64 backend");
#endif
        } else {
            ProcessResult artifact = run_process(artifact_args);
            if (artifact.exit_code != 0 && !args.fallback_artifact.empty()) {
                artifact_args.front() = args.fallback_artifact.string();
                artifact = run_checked(artifact_args, "fallback-artifact");
                used_fallback_artifact = true;
            } else if (artifact.exit_code != 0) {
                throw DriverFailure("artifact failed: " + artifact.stderr_text);
            }
            const auto artifact_summary = object_of(vf::parse_json(artifact.stdout_text), "artifact summary");
            status = string_field(artifact_summary, "status", "artifact summary");
            manifest_path = string_field(artifact_summary, "manifest_path", "artifact summary");
            artifact_path = string_field(artifact_summary, "artifact_path", "artifact summary");
        }
        const auto artifact_finished = Clock::now();
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
            const std::filesystem::path runnable(artifact_path);
            const ProcessResult run_result = runnable.extension() == ".cmd"
                ? run_checked({"cmd", "/c", artifact_path}, "run")
                : run_checked({artifact_path}, "run");
            const auto run_finished = Clock::now();
            ran = true;
            run_stdout = run_result.stdout_text;
            run_ms = std::chrono::duration<double, std::milli>(run_finished - run_started).count();
        }
        const auto total_finished = Clock::now();

        vf::JsonValue::Object summary;
        summary["artifact_path"] = vf::JsonValue(artifact_path);
        summary["artifact_fallback"] = vf::JsonValue(used_fallback_artifact);
        if (used_fallback_artifact) summary["artifact_fallback_reason"] = vf::JsonValue(fallback_reason);
        summary["diagnostics_emitted"] = vf::JsonValue(materialize_frontend);
        if (materialize_frontend) summary["ast_path"] = vf::JsonValue(ast_path.string());
        summary["artifact_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(artifact_finished - artifact_started).count());
#ifdef VKF_NATIVE_FRONTEND_LIBRARY
        summary["frontend_mode"] = vf::JsonValue(args.external_frontend ? "external-tools" : "integrated");
        summary["stdlib_ast_cache_hits"] = static_cast<double>(stdlib_cache_stats.ast_hits);
        summary["stdlib_ast_cache_misses"] = static_cast<double>(stdlib_cache_stats.ast_misses);
#else
        summary["frontend_mode"] = vf::JsonValue("external-tools");
#endif
        summary["ir_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(ir_finished - ir_started).count());
        summary["lexer_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(lexer_finished - lexer_started).count());
        if (materialize_frontend) summary["manifest_path"] = vf::JsonValue(manifest_path);
        summary["parser_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(parser_finished - parser_started).count());
        summary["ran"] = vf::JsonValue(ran);
        summary["run_ms"] = vf::JsonValue(run_ms);
        summary["status"] = vf::JsonValue(status);
        summary["stdout"] = vf::JsonValue(run_stdout);
        if (materialize_frontend) summary["token_path"] = vf::JsonValue(token_path.string());
        summary["total_ms"] = vf::JsonValue(std::chrono::duration<double, std::milli>(total_finished - total_started).count());
        if (materialize_frontend) summary["typed_ir_path"] = vf::JsonValue(typed_ir_path.string());
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
        const std::string rendered = vf::json_stringify(vf::JsonValue(std::move(summary)), -1);
        if (!temp_eval_source.empty()) {
            std::error_code ignore;
            std::filesystem::remove(temp_eval_source, ignore);
        }
        return rendered;
        };

        if (argc == 3 && std::string(argv[1]) == "--batch-sources") {
            std::ifstream sources(argv[2], std::ios::binary);
            if (!sources) throw DriverFailure("could not read batch source list " + std::string(argv[2]));
            std::string source;
            while (std::getline(sources, source)) {
                if (!source.empty() && source.back() == '\r') source.pop_back();
                if (source.empty()) continue;
                Args args;
                args.source = source;
                args.aot = true;
                fill_default_tool_paths(args);
                const auto started = Clock::now();
                auto summary = object_of(vf::parse_json(compile_one(std::move(args))), "batch summary");
                const auto finished = Clock::now();
                summary["batch_ms"] = std::chrono::duration<double, std::milli>(finished - started).count();
                std::cout << vf::json_stringify(vf::JsonValue(std::move(summary)), -1) << "\n";
            }
            return 0;
        }

        const std::string rendered = compile_one(parse_args(argc, argv));
        std::cout << rendered << "\n";
#ifdef _WIN32
        // The compiler process is intentionally one-shot. Reclaiming the large
        // token/AST/IR trees during normal C++ stack teardown adds tens of
        // milliseconds to Windows source-to-artifact latency even though the OS
        // is about to reclaim the whole address space. Flush the public result,
        // then let the process boundary release compiler-owned memory at once.
        std::cout.flush();
        std::cerr.flush();
        TerminateProcess(GetCurrentProcess(), 0);
#endif
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<driver-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
