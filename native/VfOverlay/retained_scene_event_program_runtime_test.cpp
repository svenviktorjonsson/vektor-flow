#include "overlay_packet_runtime.hpp"

#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>

namespace {

int Fail(const std::string& message) {
    std::cerr << message << std::endl;
    return 1;
}

bool Contains(const std::string& text, const std::string& needle) {
    return text.find(needle) != std::string::npos;
}

}  // namespace

int wmain() {
    const std::wstring program_path = L"vf-retained-event-program-test.json";
    const char* program =
        "{\"schema\":\"vektor-flow/retained-event-program\",\"version\":1,\"rules\":["
        "{\"event\":\"ButtonClicked\",\"widget_id\":\"show-glass\",\"actions\":["
        "{\"op\":\"retained_layer_patch\",\"target\":\"frame_0\",\"state\":{"
        "\"layer_id\":0,\"mesh_id\":\"glass\",\"property\":\"visible\","
        "\"value\":{\"kind\":\"const\",\"value\":true},"
        "\"geom\":{\"frame\":\"frame_0\",\"meshes\":[{\"id\":\"glass\",\"layer_id\":0,\"visible\":false,\"alpha\":0.5}],\"lights\":[]}}}]},"
        "{\"event\":\"SliderValueChanged\",\"widget_id\":\"opacity\",\"actions\":["
        "{\"op\":\"retained_layer_patch\",\"target\":\"frame_0\",\"state\":{"
        "\"layer_id\":0,\"mesh_id\":\"glass\",\"property\":\"alpha\","
        "\"value\":{\"kind\":\"event_field\",\"field\":\"value\"},"
        "\"geom\":{\"frame\":\"frame_0\",\"meshes\":[{\"id\":\"glass\",\"layer_id\":0,\"visible\":false,\"alpha\":0.5}],\"lights\":[]}}}]}]}";
    {
        std::ofstream output("vf-retained-event-program-test.json", std::ios::binary);
        if (!output) return Fail("could not create retained event program fixture");
        output << program;
    }

    OverlayPacketRuntime runtime;
    std::string error;
    const auto cleanup = [&]() { std::remove("vf-retained-event-program-test.json"); };
    if (!runtime.InitializeForWebRoot(L"", [](const std::string&) {}, &error)) {
        cleanup();
        return Fail(error.empty() ? "runtime initialization failed" : error);
    }
    if (!runtime.LoadEventProgramFile(program_path, &error)) {
        cleanup();
        return Fail(error.empty() ? "retained event program load failed" : error);
    }
    const auto dispatch = [&](const std::string& event) {
        return runtime.TryHandleInputEventWebMessageAndDispatch(
            event, [](const std::string&) {});
    };
    if (!dispatch("{\"type\":\"vf_event\",\"event\":\"ButtonClicked\",\"widget_id\":\"show-glass\",\"frame_id\":\"frame_1\"}")) {
        cleanup();
        return Fail("ButtonClicked dispatch failed");
    }
    OverlayPacketRuntime::HttpResult first;
    runtime.TryHandleHttpRequest("GET", "/api/runtime-packets", "", L"", &first);
    if (!Contains(first.response_json, "\"visible\":true")) {
        cleanup();
        return Fail("ButtonClicked did not patch retained visibility: " + first.response_json);
    }
    if (!dispatch("{\"type\":\"vf_event\",\"event\":\"SliderValueChanged\",\"widget_id\":\"opacity\",\"frame_id\":\"frame_1\",\"value\":0.72}")) {
        cleanup();
        return Fail("SliderValueChanged dispatch failed");
    }
    OverlayPacketRuntime::HttpResult second;
    runtime.TryHandleHttpRequest("GET", "/api/runtime-packets", "", L"", &second);
    cleanup();
    if (!Contains(second.response_json, "\"alpha\":0.72") ||
        !Contains(second.response_json, "\"visible\":true")) {
        return Fail("SliderValueChanged did not preserve and patch retained geometry: " + second.response_json);
    }
    std::wcout << L"retained-scene-event-program-runtime-test passed" << std::endl;
    return 0;
}
