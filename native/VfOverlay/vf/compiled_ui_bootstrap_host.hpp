#pragma once

#include "overlay_packet_runtime.hpp"
#include "vf/compiled_ui_bootstrap_packet_bridge.hpp"
#include "vf/compiled_ui_bootstrap_runtime.hpp"

#include <filesystem>
#include <string>

namespace vf {

class CompiledUiBootstrapHost {
public:
    bool Initialize(const std::wstring& webRoot,
                    const std::filesystem::path& moduleDirectory,
                    const std::wstring& builtinName,
                    std::string* errorMessage);
    bool Active() const noexcept;
    static const wchar_t* DefaultPage() noexcept;
    bool Publish(OverlayPacketRuntime& packets) const;
    bool UpdateFromPointer(OverlayPacketRuntime& packets, double pointerX, double pointerY);

private:
    CompiledUiBootstrapRuntime runtime_;
    CompiledUiBootstrapPacketBridge bridge_{L""};
};

}  // namespace vf
