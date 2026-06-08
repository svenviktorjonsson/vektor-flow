#include "vf/compiled_ui_runtime_registry.hpp"

#include <filesystem>
#include <iostream>

namespace {

int Fail(const char* message) {
    std::cerr << message << std::endl;
    return 1;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) {
        return Fail("usage: vf-compiled-ui-runtime-registry-test <module-dir>");
    }

    const auto& modules = vf::BuiltinCompiledUiRuntimeModules();
    if (modules.size() != 1) {
        return Fail("unexpected builtin module count");
    }
    if (modules[0].name != vf::BuiltinRectDemoName()) {
        return Fail("builtin rect demo name mismatch");
    }
    if (modules[0].file_name != vf::BuiltinRectDemoLibrary()) {
        return Fail("builtin rect demo library mismatch");
    }

    const auto resolved = vf::ResolveBuiltinCompiledUiRuntimeModulePath(argv[1], vf::BuiltinRectDemoName());
    if (!resolved.has_value()) {
        return Fail("failed to resolve builtin rect demo path");
    }

    const auto expected = (std::filesystem::path(argv[1]) / vf::BuiltinRectDemoLibrary()).wstring();
    if (*resolved != expected) {
        return Fail("resolved builtin path mismatch");
    }

    std::wcout << L"vf-compiled-ui-runtime-registry-test passed" << std::endl;
    return 0;
}
