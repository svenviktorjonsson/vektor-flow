#pragma once

#include "overlay_packet_runtime.hpp"
#include "vf/compiled_ui_bootstrap_runtime.hpp"

#include <string>

namespace vf {

class CompiledUiBootstrapPacketBridge {
public:
    explicit CompiledUiBootstrapPacketBridge(std::wstring webRoot);
    bool Sync(const CompiledUiBootstrapRuntime& runtime, OverlayPacketRuntime& packets) const;
    bool UpdateFromPointer(CompiledUiBootstrapRuntime& runtime,
                           OverlayPacketRuntime& packets,
                           double pointerX,
                           double pointerY) const;

private:
    std::wstring webRoot_;
};

}  // namespace vf
