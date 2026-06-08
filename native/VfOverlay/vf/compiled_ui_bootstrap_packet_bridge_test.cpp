#include "vf/compiled_ui_bootstrap_packet_bridge.hpp"

#include <filesystem>
#include <iostream>
#include <string>

namespace {

int Fail(const char* message) {
    std::cerr << message << std::endl;
    return 1;
}

bool Contains(const std::string& text, const std::string& needle) {
    return text.find(needle) != std::string::npos;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc < 3) {
        return Fail("usage: vf-compiled-ui-bootstrap-packet-bridge-test <module-dir> <builtin-name>");
    }

    vf::CompiledUiBootstrapRuntime runtime;
    std::string error;
    if (!runtime.Initialize(std::filesystem::path(argv[1]), argv[2], &error)) {
        return Fail(error.empty() ? "bootstrap initialize failed" : error.c_str());
    }

    OverlayPacketRuntime packets;
    vf::CompiledUiBootstrapPacketBridge bridge(L"C:\\compiled-ui-test");
    if (!bridge.Sync(runtime, packets)) {
        return Fail("bridge sync failed");
    }
    const std::string before = packets.BuildSnapshotResponseJson(OverlayPacketRuntime::Channel::Runtime);
    const std::string expectedSource =
        std::string("\"source\":\"") + vf::CompiledUiBootstrapRuntime::RuntimeSource() + "\"";
    const std::string expectedPacketCount =
        std::string("\"packetCount\":") + std::to_string(vf::CompiledUiBootstrapRuntime::RuntimePacketCount());
    const std::string expectedPath =
        "\"path\":\"C:\\\\compiled-ui-test\\\\vf-runtime-packets.json\"";
    if (!Contains(before, expectedSource)) {
        return Fail("missing compiled_ui_bootstrap source");
    }
    if (!Contains(before, expectedPacketCount)) {
        return Fail("missing packetCount 3");
    }
    if (!Contains(before, expectedPath)) {
        return Fail("missing runtime packet path");
    }
    if (!Contains(before, "\"type\":\"box\"")) {
        return Fail("missing box geom");
    }

    if (!bridge.UpdateFromPointer(runtime, packets, 260.0, 180.0)) {
        return Fail("bridge update failed");
    }
    const std::string after = packets.BuildSnapshotResponseJson(OverlayPacketRuntime::Channel::Runtime);
    if (!Contains(after, expectedSource)) {
        return Fail("source drift after pointer update");
    }
    if (!Contains(after, expectedPacketCount)) {
        return Fail("packetCount drift after pointer update");
    }
    if (!Contains(after, expectedPath)) {
        return Fail("runtime packet path drift after pointer update");
    }

    std::wcout << L"vf-compiled-ui-bootstrap-packet-bridge-test passed" << std::endl;
    return 0;
}
