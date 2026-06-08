#pragma once

#include <optional>
#include <string>
#include <vector>

namespace vf {

struct CompiledUiRuntimeModuleDescriptor {
    std::wstring name;
    std::wstring file_name;
};

const wchar_t* BuiltinRectDemoName() noexcept;
const wchar_t* BuiltinRectDemoLibrary() noexcept;
const std::vector<CompiledUiRuntimeModuleDescriptor>& BuiltinCompiledUiRuntimeModules();
std::optional<std::wstring> ResolveBuiltinCompiledUiRuntimeModulePath(const std::wstring& directory,
                                                                     const std::wstring& name);

}  // namespace vf
