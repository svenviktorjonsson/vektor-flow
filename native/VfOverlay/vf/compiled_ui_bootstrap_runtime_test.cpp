#include "vf/compiled_ui_bootstrap_runtime.hpp"

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
        return Fail("usage: vf-compiled-ui-bootstrap-runtime-test <module-dir> <builtin-name>");
    }

    if (std::wstring(vf::CompiledUiBootstrapRuntime::DefaultPage()) != L"vkf-scene.html") {
        return Fail("default page mismatch");
    }

    vf::CompiledUiBootstrapRuntime runtime;
    std::string error;
    if (!runtime.Initialize(std::filesystem::path(argv[1]), argv[2], &error)) {
        return Fail(error.empty() ? "bootstrap initialize failed" : error.c_str());
    }
    const std::string packets = runtime.BuildRuntimePacketsJson();
    if (!Contains(packets, "\"kind\": \"scene.replace\"")) {
        return Fail("missing scene.replace");
    }
    if (!Contains(packets, "\"kind\": \"ui_state.replace\"")) {
        return Fail("missing ui_state.replace");
    }
    if (!Contains(packets, "\"kind\": \"display.replace\"")) {
        return Fail("missing display.replace");
    }
    const std::string expectedFrameId =
        std::string("\"id\": \"") + vf::CompiledUiBootstrapRuntime::FrameId() + "\"";
    if (!Contains(packets, expectedFrameId)) {
        return Fail("missing compiled_ui_bootstrap frame id");
    }
    if (!Contains(packets, "\"type\": \"box\"")) {
        return Fail("missing box geom payload");
    }
    if (!Contains(packets, "\"projection\": \"orthographic\"")) {
        return Fail("missing orthographic camera");
    }
    std::wcout << L"vf-compiled-ui-bootstrap-runtime-test passed" << std::endl;
    return 0;
}
