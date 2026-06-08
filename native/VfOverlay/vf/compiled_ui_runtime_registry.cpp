#include "vf/compiled_ui_runtime_registry.hpp"

#include <filesystem>

namespace vf {

const wchar_t* BuiltinRectDemoName() noexcept {
    return L"rect-demo";
}

const wchar_t* BuiltinRectDemoLibrary() noexcept {
    return L"vf-compiled-ui-demo.dll";
}

const std::vector<CompiledUiRuntimeModuleDescriptor>& BuiltinCompiledUiRuntimeModules() {
    static const std::vector<CompiledUiRuntimeModuleDescriptor> modules = {
        {BuiltinRectDemoName(), BuiltinRectDemoLibrary()},
    };
    return modules;
}

std::optional<std::wstring> ResolveBuiltinCompiledUiRuntimeModulePath(const std::wstring& directory,
                                                                     const std::wstring& name) {
    const auto& modules = BuiltinCompiledUiRuntimeModules();
    for (const auto& module : modules) {
        if (module.name != name) {
            continue;
        }
        std::filesystem::path path = std::filesystem::path(directory) / module.file_name;
        if (std::filesystem::exists(path)) {
            return path.wstring();
        }
        return std::nullopt;
    }
    return std::nullopt;
}

}  // namespace vf
