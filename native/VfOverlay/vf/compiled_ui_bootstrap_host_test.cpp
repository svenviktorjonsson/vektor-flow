#include "vf/compiled_ui_bootstrap_host.hpp"

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
        return Fail("usage: vf-compiled-ui-bootstrap-host-test <module-dir> <builtin-name>");
    }

    vf::CompiledUiBootstrapHost host;
    std::string error;
    if (!host.Initialize(L"C:\\compiled-ui-test", std::filesystem::path(argv[1]), argv[2], &error)) {
        return Fail(error.empty() ? "host initialize failed" : error.c_str());
    }
    if (!host.Active()) {
        return Fail("host inactive after initialize");
    }
    if (std::wstring(vf::CompiledUiBootstrapHost::DefaultPage()) != vf::CompiledUiBootstrapRuntime::DefaultPage()) {
        return Fail("default page mismatch");
    }

    OverlayPacketRuntime packets;
    if (!host.Publish(packets)) {
        return Fail("host publish failed");
    }
    const std::string before = packets.BuildSnapshotResponseJson(OverlayPacketRuntime::Channel::Runtime);
    OverlayPacketRuntime::HttpResult httpBefore;
    if (!packets.TryHandleHttpRequest("GET", "/api/runtime-packets", "", L"C:\\compiled-ui-test", &httpBefore)) {
        return Fail("http GET /api/runtime-packets failed");
    }
    OverlayPacketRuntime::HttpResult sinkResult;
    bool sinkCalled = false;
    if (!packets.TryHandleHttpRequestAndRespond(
            "GET",
            "/api/runtime-packets",
            "",
            L"C:\\compiled-ui-test",
            [&sinkResult, &sinkCalled](const OverlayPacketRuntime::HttpResult& result) {
                sinkResult = result;
                sinkCalled = true;
            })) {
        return Fail("http GET/respond /api/runtime-packets failed");
    }
    SOCKET socketSeen = INVALID_SOCKET;
    int socketStatus = 0;
    std::string socketStatusText;
    std::string socketBody;
    if (!packets.TryHandleSocketHttpRequest(
            "GET",
            "/api/runtime-packets",
            "",
            L"C:\\compiled-ui-test",
            static_cast<SOCKET>(42),
            [&socketSeen, &socketStatus, &socketStatusText, &socketBody](
                SOCKET socket, int status, const char* statusText, const std::string& body) {
                socketSeen = socket;
                socketStatus = status;
                socketStatusText = statusText ? statusText : "";
                socketBody = body;
            })) {
        return Fail("socket GET /api/runtime-packets failed");
    }
    SOCKET servedSocketSeen = INVALID_SOCKET;
    int servedSocketStatus = 0;
    std::string servedSocketBody;
    packets.SetSocketHttpResponseSink(
        [&servedSocketSeen, &servedSocketStatus, &servedSocketBody](
            SOCKET socket, int status, const char*, const std::string& body) {
            servedSocketSeen = socket;
            servedSocketStatus = status;
            servedSocketBody = body;
        });
    if (!packets.TryServeSocketHttpRequest(
            "GET",
            "/api/runtime-packets",
            "",
            L"C:\\compiled-ui-test",
            static_cast<SOCKET>(43))) {
        return Fail("serve socket GET /api/runtime-packets failed");
    }
    const std::string expectedSource =
        std::string("\"source\":\"") + vf::CompiledUiBootstrapRuntime::RuntimeSource() + "\"";
    const std::string expectedPacketCount =
        std::string("\"packetCount\":") + std::to_string(vf::CompiledUiBootstrapRuntime::RuntimePacketCount());
    const std::string expectedPath =
        "\"path\":\"C:\\\\compiled-ui-test\\\\vf-runtime-packets.json\"";
    if (!Contains(before, expectedSource)) {
        return Fail("missing compiled_ui_bootstrap source");
    }
    if (!Contains(before, expectedPath)) {
        return Fail("missing runtime packet path");
    }
    if (!Contains(httpBefore.response_json, expectedSource)) {
        return Fail("http snapshot missing source");
    }
    if (!Contains(httpBefore.response_json, expectedPacketCount)) {
        return Fail("http snapshot missing packetCount");
    }
    if (!Contains(httpBefore.response_json, expectedPath)) {
        return Fail("http snapshot missing path");
    }
    if (!sinkCalled) {
        return Fail("http response sink not called");
    }
    if (!Contains(sinkResult.response_json, expectedSource)) {
        return Fail("http sink snapshot missing source");
    }
    if (!Contains(sinkResult.response_json, expectedPacketCount)) {
        return Fail("http sink snapshot missing packetCount");
    }
    if (socketSeen != static_cast<SOCKET>(42)) {
        return Fail("socket response sink socket mismatch");
    }
    if (socketStatus != 200 || socketStatusText != "OK") {
        return Fail("socket response sink status mismatch");
    }
    if (!Contains(socketBody, expectedSource)) {
        return Fail("socket snapshot missing source");
    }
    if (servedSocketSeen != static_cast<SOCKET>(43)) {
        return Fail("stored socket response sink socket mismatch");
    }
    if (servedSocketStatus != 200) {
        return Fail("stored socket response sink status mismatch");
    }
    if (!Contains(servedSocketBody, expectedSource)) {
        return Fail("stored socket snapshot missing source");
    }
    if (!Contains(before, "\"type\":\"box\"")) {
        return Fail("missing box geom");
    }
    bool inputDispatchCalled = false;
    std::string dispatchedEventJson;
    if (!packets.TryHandleInputEventWebMessageAndDispatch(
            "{\"type\":\"vf_event\",\"event\":\"pointermove\",\"data\":{\"frame\":\"compiled_ui_bootstrap\",\"x\":240,\"y\":165}}",
            "compiled-ui-test",
            [&inputDispatchCalled, &dispatchedEventJson](const std::string& eventJson) {
                inputDispatchCalled = true;
                dispatchedEventJson = eventJson;
            })) {
        return Fail("input event dispatch failed");
    }
    OverlayPacketRuntime::HttpResult inputSnapshot;
    if (!packets.TryHandleHttpRequest("GET", "/api/runtime-packets/input", "", L"C:\\compiled-ui-test", &inputSnapshot)) {
        return Fail("http GET /api/runtime-packets/input failed");
    }
    if (!inputDispatchCalled) {
        return Fail("input dispatch sink not called");
    }
    if (!Contains(dispatchedEventJson, "\"event\":\"pointermove\"")) {
        return Fail("input dispatch payload mismatch");
    }
    if (!Contains(inputSnapshot.response_json, "\"source\":\"compiled-ui-test\"")) {
        return Fail("input snapshot missing source");
    }
    if (!Contains(inputSnapshot.response_json, "\"packetCount\":1")) {
        return Fail("input snapshot missing packetCount");
    }

    if (!host.UpdateFromPointer(packets, 240.0, 165.0)) {
        return Fail("host pointer update failed");
    }
    const std::string after = packets.BuildSnapshotResponseJson(OverlayPacketRuntime::Channel::Runtime);
    OverlayPacketRuntime::HttpResult httpAfter;
    if (!packets.TryHandleHttpRequest("GET", "/api/runtime-packets", "", L"C:\\compiled-ui-test", &httpAfter)) {
        return Fail("http GET /api/runtime-packets after update failed");
    }
    if (!Contains(after, expectedPacketCount)) {
        return Fail("packetCount drift after update");
    }
    if (!Contains(after, expectedPath)) {
        return Fail("runtime packet path drift after update");
    }
    if (!Contains(httpAfter.response_json, expectedSource)) {
        return Fail("http snapshot source drift after update");
    }
    if (!Contains(httpAfter.response_json, expectedPacketCount)) {
        return Fail("http snapshot packetCount drift after update");
    }

    bool boundInputCalled = false;
    std::string boundEventJson;
    SOCKET boundSocketSeen = INVALID_SOCKET;
    int boundSocketStatus = 0;
    std::string boundSocketBody;
    OverlayPacketRuntime boundPackets;
    std::string bindError;
    if (!boundPackets.InitializeHostBindingsForWebRoot(
            L"C:\\compiled-ui-test",
            [](const std::string&) {},
            [&boundInputCalled, &boundEventJson](const std::string& eventJson) {
                boundInputCalled = true;
                boundEventJson = eventJson;
            },
            [&boundSocketSeen, &boundSocketStatus, &boundSocketBody](
                SOCKET socket, int status, const char*, const std::string& body) {
                boundSocketSeen = socket;
                boundSocketStatus = status;
                boundSocketBody = body;
            },
            &bindError)) {
        return Fail(bindError.empty() ? "InitializeHostBindingsForWebRoot failed" : bindError.c_str());
    }
    if (!boundPackets.TryHandleInputEventWebMessageAndDispatch(
            "{\"type\":\"vf_event\",\"event\":\"pointermove\",\"data\":{\"frame\":\"compiled_ui_bootstrap\",\"x\":250,\"y\":170}}")) {
        return Fail("bound input event dispatch failed");
    }
    if (!boundPackets.TryServeSocketHttpRequest(
            "GET",
            "/api/runtime-packets/input",
            "",
            L"C:\\compiled-ui-test",
            static_cast<SOCKET>(44))) {
        return Fail("bound socket serve input snapshot failed");
    }
    if (!boundInputCalled) {
        return Fail("bound input sink not called");
    }
    if (!Contains(boundEventJson, "\"event\":\"pointermove\"")) {
        return Fail("bound input payload mismatch");
    }
    if (boundSocketSeen != static_cast<SOCKET>(44) || boundSocketStatus != 200) {
        return Fail("bound socket response mismatch");
    }
    if (!Contains(boundSocketBody, "\"source\":\"webmessage\"")) {
        return Fail("bound input snapshot source mismatch");
    }
    if (!Contains(boundSocketBody, "\"packetCount\":1")) {
        return Fail("bound input snapshot packetCount mismatch");
    }

    std::wcout << L"vf-compiled-ui-bootstrap-host-test passed" << std::endl;
    return 0;
}
