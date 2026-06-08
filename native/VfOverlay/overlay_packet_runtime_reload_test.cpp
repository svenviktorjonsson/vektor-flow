#include "overlay_packet_runtime.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace {

int Fail(const char* message) {
    std::cerr << message << std::endl;
    return 1;
}

int FailString(const std::string& message) {
    std::cerr << message << std::endl;
    return 1;
}

bool Contains(const std::string& text, const std::string& needle) {
    return text.find(needle) != std::string::npos;
}

}  // namespace

int wmain() {
    const std::filesystem::path webRoot = std::filesystem::temp_directory_path() / "vf_overlay_reload_test";
    std::error_code ec;
    std::filesystem::create_directories(webRoot, ec);
    const std::filesystem::path packetPath = webRoot / "vf-runtime-packets.json";
    {
        std::ofstream out(packetPath, std::ios::binary);
        out << "[{\"seq\":7,\"kind\":\"widget.append_text\",\"payload\":{\"frame_id\":\"compiled_ui_bootstrap\",\"widget_id\":\"status_line\",\"text\":\"reload\",\"append_seq\":1}}]";
    }

    OverlayPacketRuntime runtime;
    std::string error;
    if (!runtime.InitializeForWebRoot(webRoot.wstring(), [](const std::string&) {}, &error)) {
        return Fail(error.empty() ? "InitializeForWebRoot failed" : error.c_str());
    }

    OverlayPacketRuntime::HttpResult reloadResult;
    if (!runtime.TryHandleHttpRequest("POST", "/api/runtime-packets/reload", "", webRoot.wstring(), &reloadResult)) {
        return Fail("POST /api/runtime-packets/reload failed");
    }
    if (!Contains(reloadResult.response_json, "\"source\":\"file\"")) {
        return FailString(std::string("reload snapshot source mismatch body=") + reloadResult.response_json);
    }
    if (!Contains(reloadResult.response_json, "\"packetCount\":1")) {
        return Fail("reload snapshot packetCount mismatch");
    }
    if (!Contains(reloadResult.response_json, "\"text\":\"reload\"")) {
        return Fail("reload snapshot payload mismatch");
    }
    if (!Contains(reloadResult.response_json, "\"path\":\"")) {
        return Fail("reload snapshot path missing");
    }

    std::filesystem::remove(packetPath, ec);

    OverlayPacketRuntime::HttpResult missingResult;
    if (!runtime.TryHandleHttpRequest("POST", "/api/runtime-packets/reload", "", webRoot.wstring(), &missingResult)) {
        return Fail("POST /api/runtime-packets/reload missing-file failed");
    }
    if (missingResult.status != 400) {
        return Fail("missing-file reload status mismatch");
    }
    if (!Contains(missingResult.response_json, "\"ok\":false")) {
        return Fail("missing-file reload ok flag mismatch");
    }
    if (!Contains(missingResult.response_json, "\"error\":\"runtime packet file missing or empty\"")) {
        return Fail("missing-file reload error mismatch");
    }

    std::filesystem::remove(webRoot, ec);

    std::wcout << L"overlay-packet-runtime-reload-test passed" << std::endl;
    return 0;
}
