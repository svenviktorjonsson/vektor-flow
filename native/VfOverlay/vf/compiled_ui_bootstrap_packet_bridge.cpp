#include "vf/compiled_ui_bootstrap_packet_bridge.hpp"

namespace vf {

CompiledUiBootstrapPacketBridge::CompiledUiBootstrapPacketBridge(std::wstring webRoot)
    : webRoot_(std::move(webRoot)) {}

bool CompiledUiBootstrapPacketBridge::Sync(const CompiledUiBootstrapRuntime& runtime,
                                           OverlayPacketRuntime& packets) const {
    if (!runtime.Active()) {
        return false;
    }
    const std::wstring packetPath = OverlayPacketRuntime::RuntimePacketDefaultPath(webRoot_);
    const std::string packetsJson = runtime.BuildRuntimePacketsJson();
    packets.SetRuntimePacketSnapshot(
        packetsJson,
        CompiledUiBootstrapRuntime::RuntimePacketCount(),
        CompiledUiBootstrapRuntime::RuntimeSource(),
        packetPath,
        "");
    return true;
}

bool CompiledUiBootstrapPacketBridge::UpdateFromPointer(CompiledUiBootstrapRuntime& runtime,
                                                        OverlayPacketRuntime& packets,
                                                        double pointerX,
                                                        double pointerY) const {
    if (!runtime.Active()) {
        return false;
    }
    runtime.UpdateFromPointer(pointerX, pointerY);
    return Sync(runtime, packets);
}

}  // namespace vf
