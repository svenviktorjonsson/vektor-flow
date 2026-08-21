#include "compiler/native/vkf_native_frontend.hpp"
#include "compiler/native/vkf_x64_backend.hpp"
#include "native/VfOverlay/vf/json.hpp"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace {

struct TestFunction {
    std::string name;
    std::string parameters;
    std::string source;
};

std::string read_text(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot read " + path.string());
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

void write_text(const std::filesystem::path& path, const std::string& text) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write " + path.string());
    output << text;
}

std::string trim(std::string text) {
    while (!text.empty() && std::isspace(static_cast<unsigned char>(text.front()))) {
        text.erase(text.begin());
    }
    while (!text.empty() && std::isspace(static_cast<unsigned char>(text.back()))) {
        text.pop_back();
    }
    return text;
}

bool identifier_start(char ch) {
    return std::isalpha(static_cast<unsigned char>(ch)) || ch == '_';
}

bool identifier_continue(char ch) {
    return std::isalnum(static_cast<unsigned char>(ch)) || ch == '_';
}

bool all_parameters_have_defaults(const std::string& parameters) {
    if (parameters.empty()) return true;
    unsigned depth = 0;
    bool quoted = false;
    bool escaped = false;
    bool has_default = false;
    for (std::size_t index = 0; index <= parameters.size(); ++index) {
        const char ch = index < parameters.size() ? parameters[index] : ',';
        if (quoted) {
            if (escaped) escaped = false;
            else if (ch == '\\') escaped = true;
            else if (ch == '"') quoted = false;
            continue;
        }
        if (ch == '"') {
            quoted = true;
        } else if (ch == '(' || ch == '[' || ch == '{' || ch == '<') {
            ++depth;
        } else if (ch == ')' || ch == ']' || ch == '}' || ch == '>') {
            if (depth > 0) --depth;
        } else if (ch == '=' && depth == 0) {
            has_default = true;
        } else if (ch == ',' && depth == 0) {
            if (!has_default) return false;
            has_default = false;
        }
    }
    return true;
}

std::vector<TestFunction> discover_functions(const std::string& original) {
    std::string text;
    text.reserve(original.size());
    for (char ch : original) if (ch != '\r') text.push_back(ch);
    if (text.empty() || text.back() != '\n') text.push_back('\n');

    std::vector<std::size_t> lines{0};
    for (std::size_t index = 0; index < text.size(); ++index) {
        if (text[index] == '\n' && index + 1 < text.size()) lines.push_back(index + 1);
    }
    std::vector<TestFunction> tests;
    for (std::size_t line_index = 0; line_index < lines.size(); ++line_index) {
        const std::size_t start = lines[line_index];
        const std::size_t finish = text.find('\n', start);
        const std::string line = text.substr(start, finish - start);
        if (line.empty() || std::isspace(static_cast<unsigned char>(line.front())) ||
            line.front() == '#' || !identifier_start(line.front())) {
            continue;
        }
        std::size_t name_end = 1;
        while (name_end < line.size() && identifier_continue(line[name_end])) ++name_end;
        std::size_t open = name_end;
        while (open < line.size() && std::isspace(static_cast<unsigned char>(line[open]))) ++open;
        if (open >= line.size() || line[open] != '(') continue;
        const std::size_t close = line.find(')', open + 1);
        if (close == std::string::npos || line.find(':', close + 1) == std::string::npos) continue;

        std::size_t source_end = text.size();
        for (std::size_t next = line_index + 1; next < lines.size(); ++next) {
            const std::size_t next_start = lines[next];
            const std::size_t next_finish = text.find('\n', next_start);
            const std::string next_line = text.substr(next_start, next_finish - next_start);
            if (!next_line.empty() && !std::isspace(static_cast<unsigned char>(next_line.front())) &&
                next_line.front() != '#') {
                source_end = next_start;
                break;
            }
        }
        tests.push_back({
            line.substr(0, name_end),
            trim(line.substr(open + 1, close - open - 1)),
            trim(text.substr(start, source_end - start)),
        });
    }
    return tests;
}

std::uint64_t stable_key(const std::string& text) {
    std::uint64_t hash = 1469598103934665603ull;
    for (char ch : text) {
        hash ^= static_cast<unsigned char>(ch);
        hash *= 1099511628211ull;
    }
    return hash;
}

std::filesystem::path sibling(const std::filesystem::path& self, const std::string& name) {
    auto directory = std::filesystem::absolute(self).parent_path();
#ifdef _WIN32
    return directory / (name + ".exe");
#else
    return directory / name;
#endif
}

int run_silently(const std::filesystem::path& executable) {
#ifdef _WIN32
    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.bInheritHandle = TRUE;
    HANDLE null_handle = CreateFileW(
        L"NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &security,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (null_handle == INVALID_HANDLE_VALUE) return 127;
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = null_handle;
    startup.hStdOutput = null_handle;
    startup.hStdError = null_handle;
    PROCESS_INFORMATION process{};
    std::wstring command = L"\"" + std::filesystem::absolute(executable).wstring() + L"\"";
    const BOOL created = CreateProcessW(
        nullptr, command.data(), nullptr, nullptr, TRUE, 0, nullptr,
        executable.parent_path().wstring().c_str(), &startup, &process);
    CloseHandle(null_handle);
    if (!created) return 127;
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit_code = 127;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return static_cast<int>(exit_code);
#else
    const pid_t child = fork();
    if (child < 0) return 127;
    if (child == 0) {
        const int null_fd = open("/dev/null", O_WRONLY);
        if (null_fd >= 0) {
            dup2(null_fd, STDOUT_FILENO);
            dup2(null_fd, STDERR_FILENO);
            close(null_fd);
        }
        const std::string path = std::filesystem::absolute(executable).string();
        execl(path.c_str(), path.c_str(), static_cast<char*>(nullptr));
        _exit(127);
    }
    int status = 0;
    if (waitpid(child, &status, 0) < 0) return 127;
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return 127;
#endif
}

int run_compiler_silently(
    const std::filesystem::path& compiler,
    const std::filesystem::path& source
) {
#ifdef _WIN32
    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.bInheritHandle = TRUE;
    HANDLE null_handle = CreateFileW(
        L"NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &security,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (null_handle == INVALID_HANDLE_VALUE) return 127;
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = null_handle;
    startup.hStdOutput = null_handle;
    startup.hStdError = null_handle;
    PROCESS_INFORMATION process{};
    std::wstring command = L"\"" + std::filesystem::absolute(compiler).wstring() +
        L"\" --source \"" + std::filesystem::absolute(source).wstring() + L"\" --aot";
    const BOOL created = CreateProcessW(
        nullptr, command.data(), nullptr, nullptr, TRUE, 0, nullptr,
        nullptr, &startup, &process);
    CloseHandle(null_handle);
    if (!created) return 127;
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit_code = 127;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return static_cast<int>(exit_code);
#else
    const pid_t child = fork();
    if (child < 0) return 127;
    if (child == 0) {
        const int null_fd = open("/dev/null", O_WRONLY);
        if (null_fd >= 0) {
            dup2(null_fd, STDOUT_FILENO);
            dup2(null_fd, STDERR_FILENO);
            close(null_fd);
        }
        const std::string compiler_path = std::filesystem::absolute(compiler).string();
        const std::string source_path = std::filesystem::absolute(source).string();
        execl(
            compiler_path.c_str(), compiler_path.c_str(),
            "--source", source_path.c_str(), "--aot", static_cast<char*>(nullptr));
        _exit(127);
    }
    int status = 0;
    if (waitpid(child, &status, 0) < 0) return 127;
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return 127;
#endif
}

std::vector<std::filesystem::path> source_files(const std::filesystem::path& target) {
    std::vector<std::filesystem::path> files;
    if (std::filesystem::is_regular_file(target)) {
        if (target.extension() != ".vkf") throw std::runtime_error("test file must end in .vkf");
        files.push_back(target);
    } else if (std::filesystem::is_directory(target)) {
        for (const auto& entry : std::filesystem::recursive_directory_iterator(target)) {
            if (!entry.is_regular_file() || entry.path().extension() != ".vkf") continue;
            bool generated = false;
            for (const auto& component : entry.path()) {
                if (component == ".vkfbuild") generated = true;
            }
            if (!generated) files.push_back(entry.path());
        }
    } else {
        throw std::runtime_error("test path does not exist: " + target.string());
    }
    std::sort(files.begin(), files.end());
    return files;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2 || argc > 4) {
        std::cerr << "usage: vkftest <file-or-folder> [--function] [name]\n";
        return 2;
    }
    try {
        const std::filesystem::path target = argv[1];
        std::string selected;
        if (argc == 3) selected = argv[2];
        if (argc == 4) {
            if (std::string(argv[2]) != "--function") {
                throw std::runtime_error("expected --function before test name");
            }
            selected = argv[3];
        }

        unsigned passed = 0;
        unsigned failed = 0;
        bool selected_found = selected.empty();
        const std::filesystem::path build_root =
            std::filesystem::current_path() / ".vkftest";
        const std::filesystem::path compiler = sibling(argv[0], "vkf");
        if (!std::filesystem::is_regular_file(compiler)) {
            throw std::runtime_error("missing sibling VKF compiler: " + compiler.string());
        }

        for (const auto& file : source_files(target)) {
            const std::string source = read_text(file);
            for (const auto& test : discover_functions(source)) {
                if (!selected.empty() && test.name != selected) continue;
                if (selected.empty() && !test.name.empty() && test.name.front() == '_') continue;
                const std::string label = file.generic_string() + "::" + test.name;
                if (!all_parameters_have_defaults(test.parameters)) {
                    if (!selected.empty()) {
                        selected_found = true;
                        ++failed;
                        std::cout << "FAIL " << label << '\n' << test.source
                                  << "\nfixture parameters require .testing\n";
                    }
                    continue;
                }
                selected_found = true;
                try {
                    std::string generated = source;
                    if (generated.empty() || generated.back() != '\n') generated.push_back('\n');
                    generated += ":: " + test.name + "()\n";
                    const auto key = stable_key(file.generic_string() + "\n" + test.name + "\n" + generated);
                    const auto unit = build_root / std::to_string(key) / "test.vkf";
                    write_text(unit, generated);
                    const auto artifact = unit.parent_path() / ".vkfbuild" /
#ifdef _WIN32
                        (unit.stem().string() + ".exe");
#else
                        (unit.stem().string() + ".native");
#endif
                    const int compile_status = run_compiler_silently(compiler, unit);
                    const int run_status = compile_status == 0 ? run_silently(artifact) : 127;
                    if (compile_status == 0 && run_status == 0) {
                        ++passed;
                        std::cout << "PASS " << label << '\n';
                    } else {
                        ++failed;
                        std::cout << "FAIL " << label << '\n' << test.source
                                  << (compile_status != 0
                                          ? "\ncompile failed (exit " + std::to_string(compile_status) + ")\n"
                                          : "\nassertion failed (exit " + std::to_string(run_status) + ")\n");
                    }
                } catch (const std::exception& error) {
                    ++failed;
                    std::cout << "FAIL " << label << '\n' << test.source
                              << "\n" << error.what() << '\n';
                }
            }
        }
        if (!selected_found) throw std::runtime_error("test function not found: " + selected);
        std::cout << passed << " passed, " << failed << " failed\n";
        return failed == 0 ? 0 : 1;
    } catch (const std::exception& error) {
        std::cerr << "vkftest: " << error.what() << '\n';
        return 2;
    }
}
