#include "vf/crash_diagnostics.hpp"

#include <windows.h>
#include <DbgHelp.h>
#include <shlobj.h>

#include <atomic>
#include <csignal>
#include <cstdlib>
#include <cstdint>
#include <exception>
#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <sstream>
#include <string>

namespace vf {
namespace {

std::mutex g_crashDiagMutex;
std::map<std::string, std::string> g_breadcrumbs;
CrashExtraStateProvider g_extraStateProvider;
std::wstring g_appName = L"vf-overlay";
std::atomic_flag g_crashHandling = ATOMIC_FLAG_INIT;

std::wstring CrashDirectoryPath() {
    wchar_t local[MAX_PATH];
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, local))) {
        return L"C:\\temp";
    }
    std::wstring dir = std::wstring(local) + L"\\vektor-flow\\crashes";
    CreateDirectoryW((std::wstring(local) + L"\\vektor-flow").c_str(), nullptr);
    CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

std::wstring TimestampStem() {
    SYSTEMTIME st{};
    GetLocalTime(&st);
    wchar_t buf[128];
    _snwprintf_s(buf, _TRUNCATE, L"%ls-%04u%02u%02u-%02u%02u%02u-%03u", g_appName.c_str(), (unsigned)st.wYear,
                 (unsigned)st.wMonth, (unsigned)st.wDay, (unsigned)st.wHour, (unsigned)st.wMinute,
                 (unsigned)st.wSecond, (unsigned)st.wMilliseconds);
    return buf;
}

std::wstring BuildPath(const wchar_t* ext) {
    std::wstring dir = CrashDirectoryPath();
    std::wstring stem = TimestampStem();
    return dir + L"\\" + stem + ext;
}

std::string WideToUtf8(const wchar_t* text) {
    if (!text || !*text) {
        return {};
    }
    int needed = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    if (needed <= 1) {
        return {};
    }
    std::string out(static_cast<size_t>(needed - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, out.data(), needed, nullptr, nullptr);
    return out;
}

std::string ExceptionCodeString(DWORD code) {
    char buf[64];
    _snprintf_s(buf, _TRUNCATE, "0x%08lX", static_cast<unsigned long>(code));
    return buf;
}

void WriteCrashText(EXCEPTION_POINTERS* ep, const char* reason) {
    const std::wstring path = BuildPath(L".txt");
    FILE* f = nullptr;
    if (_wfopen_s(&f, path.c_str(), L"w") != 0 || !f) {
        return;
    }
    fprintf(f, "reason=%s\n", reason ? reason : "unknown");
    fprintf(f, "pid=%lu\n", static_cast<unsigned long>(GetCurrentProcessId()));
    fprintf(f, "tid=%lu\n", static_cast<unsigned long>(GetCurrentThreadId()));
    if (ep && ep->ExceptionRecord) {
        fprintf(f, "exception_code=%s\n", ExceptionCodeString(ep->ExceptionRecord->ExceptionCode).c_str());
        fprintf(f, "exception_flags=0x%08lX\n", static_cast<unsigned long>(ep->ExceptionRecord->ExceptionFlags));
        fprintf(f, "exception_address=%p\n", ep->ExceptionRecord->ExceptionAddress);
    }
    {
        std::lock_guard<std::mutex> lock(g_crashDiagMutex);
        for (const auto& [key, value] : g_breadcrumbs) {
            fprintf(f, "breadcrumb.%s=%s\n", key.c_str(), value.c_str());
        }
    }
    if (g_extraStateProvider) {
        const std::string extra = g_extraStateProvider();
        if (!extra.empty()) {
            fprintf(f, "extra_state_begin\n%s\nextra_state_end\n", extra.c_str());
        }
    }
    fclose(f);
}

void WriteMiniDump(EXCEPTION_POINTERS* ep) {
    if (!ep) {
        return;
    }
    const std::wstring path = BuildPath(L".dmp");
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        return;
    }
    MINIDUMP_EXCEPTION_INFORMATION mei{};
    mei.ThreadId = GetCurrentThreadId();
    mei.ExceptionPointers = ep;
    mei.ClientPointers = FALSE;
    MiniDumpWriteDump(GetCurrentProcess(), GetCurrentProcessId(), file,
                      static_cast<MINIDUMP_TYPE>(MiniDumpWithThreadInfo | MiniDumpWithIndirectlyReferencedMemory |
                                                 MiniDumpScanMemory),
                      &mei, nullptr, nullptr);
    CloseHandle(file);
}

LONG WINAPI UnhandledExceptionFilterImpl(EXCEPTION_POINTERS* ep) {
    if (g_crashHandling.test_and_set()) {
        return EXCEPTION_EXECUTE_HANDLER;
    }
    WriteCrashText(ep, "unhandled_exception");
    WriteMiniDump(ep);
    return EXCEPTION_EXECUTE_HANDLER;
}

void TerminateHandlerImpl() {
    if (g_crashHandling.test_and_set()) {
        abort();
    }
    WriteCrashText(nullptr, "std_terminate");
    abort();
}

void WriteFatalAndExit(const char* reason, UINT exitCode) {
    if (!g_crashHandling.test_and_set()) {
        WriteCrashText(nullptr, reason);
    }
    TerminateProcess(GetCurrentProcess(), exitCode);
}

void InvalidParameterHandlerImpl(const wchar_t* expression,
                                 const wchar_t* function,
                                 const wchar_t* file,
                                 unsigned int line,
                                 uintptr_t) {
    {
        std::lock_guard<std::mutex> lock(g_crashDiagMutex);
        g_breadcrumbs["crt.invalid_parameter.expression"] = WideToUtf8(expression);
        g_breadcrumbs["crt.invalid_parameter.function"] = WideToUtf8(function);
        g_breadcrumbs["crt.invalid_parameter.file"] = WideToUtf8(file);
        g_breadcrumbs["crt.invalid_parameter.line"] = std::to_string(line);
    }
    WriteFatalAndExit("invalid_parameter", 0xC0000409u);
}

void PurecallHandlerImpl() {
    WriteFatalAndExit("pure_virtual_call", 0xC0000409u);
}

void SignalHandlerImpl(int signalValue) {
    {
        std::lock_guard<std::mutex> lock(g_crashDiagMutex);
        g_breadcrumbs["signal"] = std::to_string(signalValue);
    }
    WriteFatalAndExit("signal", 0xC0000409u);
}

} // namespace

void InstallCrashDiagnostics(const wchar_t* appName, CrashExtraStateProvider extraStateProvider) {
    if (appName && *appName) {
        g_appName = appName;
    }
    g_extraStateProvider = std::move(extraStateProvider);
    SetUnhandledExceptionFilter(UnhandledExceptionFilterImpl);
    std::set_terminate(TerminateHandlerImpl);
    _set_invalid_parameter_handler(InvalidParameterHandlerImpl);
    _set_purecall_handler(PurecallHandlerImpl);
    std::signal(SIGABRT, SignalHandlerImpl);
    std::signal(SIGFPE, SignalHandlerImpl);
    std::signal(SIGILL, SignalHandlerImpl);
    std::signal(SIGSEGV, SignalHandlerImpl);
    std::signal(SIGTERM, SignalHandlerImpl);
}

void SetCrashBreadcrumb(const char* key, const std::string& value) {
    if (!key || !*key) {
        return;
    }
    std::lock_guard<std::mutex> lock(g_crashDiagMutex);
    g_breadcrumbs[std::string(key)] = value;
}

void ClearCrashBreadcrumb(const char* key) {
    if (!key || !*key) {
        return;
    }
    std::lock_guard<std::mutex> lock(g_crashDiagMutex);
    g_breadcrumbs.erase(std::string(key));
}

} // namespace vf
