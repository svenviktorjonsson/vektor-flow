#pragma once

#include "vf/compiled_ui_runtime_loader.hpp"

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace vf {

class CompiledUiBootstrapRuntime {
public:
    static const char* FrameId() noexcept;
    static const wchar_t* DefaultPage() noexcept;
    static const char* RuntimeSource() noexcept;
    static int RuntimePacketCount() noexcept;

    bool Active() const noexcept;
    const std::wstring& BuiltinName() const noexcept;

    bool Initialize(const std::filesystem::path& moduleDirectory,
                    const std::wstring& builtinName,
                    std::string* errorMessage);

    void UpdateFromPointer(double pointerX, double pointerY);
    std::string BuildRuntimePacketsJson() const;

private:
    std::optional<CompiledUiRuntimeModule> module_;
    std::wstring builtinName_;
    std::vector<float> mat4_;
    std::vector<double> geometry_;
    VfDirtyRange transformDirty_{};
    VfDirtyRange geometryDirty_{};
    VfRuntimeApi api_{};
    std::uint32_t sequence_ = 0U;
};

}  // namespace vf
