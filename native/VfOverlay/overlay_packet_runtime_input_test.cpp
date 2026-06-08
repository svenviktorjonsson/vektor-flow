#include "overlay_packet_runtime.hpp"

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

int wmain() {
    OverlayPacketRuntime runtime;
    std::string error;
    if (!runtime.InitializeHostBindingsForWebRoot(
            L"C:\\compiled-ui-test",
            [](const std::string&) {},
            [](const std::string&) {},
            {},
            &error)) {
        return Fail(error.empty() ? "InitializeHostBindingsForWebRoot failed" : error.c_str());
    }

    if (!runtime.AppendInputRuntimePacketFromEventJson(
            "{\"event\":\"pointerdown\",\"data\":{\"frame\":\"compiled_ui_bootstrap\",\"widget\":\"plot_panel\",\"x\":10,\"y\":20}}",
            "direct-input",
            &error)) {
        return Fail(error.empty() ? "AppendInputRuntimePacketFromEventJson failed" : error.c_str());
    }

    bool dispatchCalled = false;
    std::string dispatchJson;
    if (!runtime.TryHandleInputEventWebMessageAndDispatch(
            "{\"type\":\"vf_event\",\"event\":\"pointermove\",\"data\":{\"frame\":\"compiled_ui_bootstrap\",\"widget\":\"plot_panel\",\"x\":30,\"y\":40}}",
            "webmessage-test",
            [&dispatchCalled, &dispatchJson](const std::string& eventJson) {
                dispatchCalled = true;
                dispatchJson = eventJson;
            })) {
        return Fail("TryHandleInputEventWebMessageAndDispatch failed");
    }
    if (!dispatchCalled) {
        return Fail("dispatch sink not called");
    }
    if (!Contains(dispatchJson, "\"event\":\"pointermove\"")) {
        return Fail("dispatch payload mismatch");
    }

    OverlayPacketRuntime::HttpResult inputResult;
    if (!runtime.TryHandleHttpRequest("GET", "/api/runtime-packets/input", "", L"C:\\compiled-ui-test", &inputResult)) {
        return Fail("GET /api/runtime-packets/input failed");
    }
    if (!Contains(inputResult.response_json, "\"packetCount\":2")) {
        return Fail("input snapshot packetCount mismatch");
    }
    if (!Contains(inputResult.response_json, "\"source\":\"webmessage-test\"")) {
        return Fail("input snapshot source mismatch");
    }
    if (!Contains(inputResult.response_json, "\"event\":\"pointerdown\"")) {
        return Fail("input snapshot missing direct input event");
    }
    if (!Contains(inputResult.response_json, "\"event\":\"pointermove\"")) {
        return Fail("input snapshot missing webmessage input event");
    }

    std::wcout << L"overlay-packet-runtime-input-test passed" << std::endl;
    return 0;
}
