#include "vf/compiled_ui_bootstrap_host.hpp"

namespace vf {

bool CompiledUiBootstrapHost::Initialize(const std::wstring& webRoot,
                                         const std::filesystem::path& moduleDirectory,
                                         const std::wstring& builtinName,
                                         std::string* errorMessage) {
    bridge_ = CompiledUiBootstrapPacketBridge(webRoot);
    return runtime_.Initialize(moduleDirectory, builtinName, errorMessage);
}

bool CompiledUiBootstrapHost::Active() const noexcept {
    return runtime_.Active();
}

const wchar_t* CompiledUiBootstrapHost::DefaultPage() noexcept {
    return CompiledUiBootstrapRuntime::DefaultPage();
}

bool CompiledUiBootstrapHost::Publish(OverlayPacketRuntime& packets) const {
    return bridge_.Sync(runtime_, packets);
}

bool CompiledUiBootstrapHost::UpdateFromPointer(OverlayPacketRuntime& packets,
                                                double pointerX,
                                                double pointerY) {
    return bridge_.UpdateFromPointer(runtime_, packets, pointerX, pointerY);
}

}  // namespace vf
