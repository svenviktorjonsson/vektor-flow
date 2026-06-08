#include "overlay_packet_runtime.hpp"

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
    OverlayPacketRuntime runtime;
    std::string error;
    if (!runtime.InitializeForWebRoot(L"C:\\compiled-ui-test", [](const std::string&) {}, &error)) {
        return Fail(error.empty() ? "InitializeForWebRoot failed" : error.c_str());
    }

    OverlayPacketRuntime::HttpResult postResult;
    const std::string replaceJson =
        "["
        "{\"seq\":1,\"kind\":\"scene.replace\",\"payload\":{\"commands\":[{\"op\":\"replace\",\"target\":\"root\"}]}}"
        ","
        "{\"seq\":2,\"kind\":\"display.replace\",\"payload\":{\"display\":{\"frames\":{},\"geom\":{\"rect-demo\":{\"type\":\"box\"}},\"screen\":[]}}}"
        "]";
    if (!runtime.TryHandleHttpRequest("POST", "/api/runtime-packets", replaceJson, L"C:\\compiled-ui-test", &postResult)) {
        return Fail("POST /api/runtime-packets failed");
    }
    if (postResult.status != 200) {
        return FailString(std::string("POST status mismatch: ") + std::to_string(postResult.status) + " body=" + postResult.response_json);
    }
    if (!Contains(postResult.response_json, "\"source\":\"direct\"")) {
        return FailString(std::string("POST snapshot source mismatch body=") + postResult.response_json);
    }
    if (!Contains(postResult.response_json, "\"packetCount\":2")) {
        return FailString(std::string("POST snapshot packetCount mismatch body=") + postResult.response_json);
    }

    OverlayPacketRuntime::HttpResult appendResult;
    const std::string appendJson =
        "[{\"seq\":3,\"kind\":\"widget.append_text\",\"payload\":{\"frame_id\":\"compiled_ui_bootstrap\",\"widget_id\":\"status_line\",\"text\":\"hello\",\"append_seq\":1}}]";
    if (!runtime.TryHandleHttpRequest("POST", "/api/runtime-packets/append", appendJson, L"C:\\compiled-ui-test", &appendResult)) {
        return Fail("POST /api/runtime-packets/append failed");
    }
    if (!Contains(appendResult.response_json, "\"packetCount\":3")) {
        return Fail("append snapshot packetCount mismatch");
    }

    OverlayPacketRuntime::HttpResult getResult;
    if (!runtime.TryHandleHttpRequest("GET", "/api/runtime-packets", "", L"C:\\compiled-ui-test", &getResult)) {
        return Fail("GET /api/runtime-packets failed");
    }
    if (!Contains(getResult.response_json, "\"packetCount\":3")) {
        return Fail("GET snapshot packetCount mismatch");
    }
    if (!Contains(getResult.response_json, "\"source\":\"direct\"")) {
        return Fail("GET snapshot source mismatch");
    }
    if (!Contains(getResult.response_json, "\"path\":null")) {
        return FailString(std::string("GET snapshot path mismatch body=") + getResult.response_json);
    }

    std::wcout << L"overlay-packet-runtime-http-test passed" << std::endl;
    return 0;
}
