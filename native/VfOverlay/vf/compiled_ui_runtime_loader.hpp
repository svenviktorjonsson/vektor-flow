#pragma once

#include <windows.h>

#include <optional>
#include <string>

#include "vf/compiled_ui_runtime_abi.hpp"

namespace vf {

class CompiledUiRuntimeModule {
public:
    CompiledUiRuntimeModule() = default;
    CompiledUiRuntimeModule(const CompiledUiRuntimeModule&) = delete;
    CompiledUiRuntimeModule& operator=(const CompiledUiRuntimeModule&) = delete;

    CompiledUiRuntimeModule(CompiledUiRuntimeModule&& other) noexcept;
    CompiledUiRuntimeModule& operator=(CompiledUiRuntimeModule&& other) noexcept;

    ~CompiledUiRuntimeModule();

    static CompiledUiRuntimeModule LoadFromPath(const std::wstring& path);
    static std::optional<CompiledUiRuntimeModule> LoadBuiltinFromDirectory(const std::wstring& directory,
                                                                           const std::wstring& name);

    explicit operator bool() const noexcept { return module_ != nullptr && exports_.init != nullptr && exports_.update != nullptr; }

    const VfCompiledUiExports& exports() const noexcept { return exports_; }
    HMODULE handle() const noexcept { return module_; }
    std::int32_t RunBootstrapOnce(VfRuntimeApi* api, const VfInputSnapshot* input = nullptr) const;

private:
    explicit CompiledUiRuntimeModule(HMODULE module, VfCompiledUiExports exports) noexcept;

    void Reset() noexcept;

    HMODULE module_ = nullptr;
    VfCompiledUiExports exports_{};
};

std::optional<CompiledUiRuntimeModule> BootstrapBuiltinCompiledUiModule(const std::wstring& directory,
                                                                        const std::wstring& name,
                                                                        VfRuntimeApi* api,
                                                                        const VfInputSnapshot* input = nullptr);

}  // namespace vf
