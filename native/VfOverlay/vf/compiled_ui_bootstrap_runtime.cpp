#include "vf/compiled_ui_bootstrap_runtime.hpp"

#include <windows.h>

#include <cstdio>

namespace vf {

namespace {

constexpr double kRectWidth = 96.0;
constexpr double kRectHeight = 64.0;

std::string WideToUtf8Local(const wchar_t* w) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1) {
        return {};
    }
    std::string s(static_cast<size_t>(n), 0);
    WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    s.pop_back();
    return s;
}

std::string BuildRuntimePacketsJson(const std::wstring& builtinName,
                                    const VfRuntimeApi& api) {
    auto vertexX = [&](std::size_t index) -> double {
        if (api.geometry.xyz == nullptr || index >= api.geometry.vertex_capacity) return 0.0;
        return api.geometry.xyz[index * kVfGeometryVertexF64 + 0];
    };
    auto vertexY = [&](std::size_t index) -> double {
        if (api.geometry.xyz == nullptr || index >= api.geometry.vertex_capacity) return 0.0;
        return api.geometry.xyz[index * kVfGeometryVertexF64 + 1];
    };
    const double minX = (std::min)((std::min)(vertexX(0), vertexX(1)), (std::min)(vertexX(2), vertexX(3)));
    const double maxX = (std::max)((std::max)(vertexX(0), vertexX(1)), (std::max)(vertexX(2), vertexX(3)));
    const double minY = (std::min)((std::min)(vertexY(0), vertexY(1)), (std::min)(vertexY(2), vertexY(3)));
    const double maxY = (std::max)((std::max)(vertexY(0), vertexY(1)), (std::max)(vertexY(2), vertexY(3)));
    const double centerX = (minX + maxX) * 0.5;
    const double centerY = (minY + maxY) * 0.5;
    const double width = (std::max)(1.0, maxX - minX);
    const double height = (std::max)(1.0, maxY - minY);
    const std::string title = WideToUtf8Local(builtinName.c_str());
    char json[8192];
    snprintf(
        json,
        sizeof(json),
        "[\n"
        "  {\n"
        "    \"seq\": 1,\n"
        "    \"kind\": \"scene.replace\",\n"
        "    \"payload\": {\n"
        "      \"commands\": [\n"
        "        {\n"
        "          \"kind\": \"frame_upsert\",\n"
        "          \"id\": \"%s\",\n"
        "          \"payload\": {\n"
        "            \"spec\": {\n"
        "              \"id\": \"%s\",\n"
        "              \"title\": \"Compiled UI: %s\",\n"
        "              \"title_align\": \"left\",\n"
        "              \"rect\": {\"x\": 24, \"y\": 24, \"w\": 360, \"h\": 280},\n"
        "              \"flags\": {\n"
        "                \"draggable\": true,\n"
        "                \"dockable\": true,\n"
        "                \"resizable\": true,\n"
        "                \"closable\": true,\n"
        "                \"use_browser\": true\n"
        "              },\n"
        "              \"alpha\": 1.0,\n"
        "              \"master\": true,\n"
        "              \"exit_counted\": true,\n"
        "              \"dock_location\": \"bl\",\n"
        "              \"anchor\": \"tl\",\n"
        "              \"body\": [],\n"
        "              \"parent_id\": null\n"
        "            }\n"
        "          }\n"
        "        }\n"
      "      ]\n"
        "    }\n"
        "  },\n"
        "  {\n"
        "    \"seq\": 2,\n"
        "    \"kind\": \"ui_state.replace\",\n"
        "    \"payload\": {\"state\": {}}\n"
        "  },\n"
        "  {\n"
        "    \"seq\": 3,\n"
        "    \"kind\": \"display.replace\",\n"
        "    \"payload\": {\n"
        "      \"display\": {\n"
        "        \"screen\": [],\n"
        "        \"frames\": {},\n"
        "        \"geom\": {\n"
        "          \"%s\": {\n"
        "            \"meshes\": [\n"
        "              {\n"
        "                \"type\": \"box\",\n"
        "                \"center\": [%g, %g, 0.0],\n"
        "                \"scale\": [%g, %g, 2.0],\n"
        "                \"color\": \"#34d399\"\n"
        "              }\n"
        "            ],\n"
        "            \"camera\": {\n"
        "              \"projection\": \"orthographic\",\n"
        "              \"ortho_scale\": 140.0,\n"
        "              \"pos\": [%g, %g, 220.0],\n"
        "              \"target\": [%g, %g, 0.0],\n"
        "              \"up\": [0.0, 1.0, 0.0]\n"
        "            },\n"
        "            \"lights\": []\n"
        "          }\n"
        "        }\n"
        "      }\n"
        "    }\n"
        "  }\n"
        "]\n",
        vf::CompiledUiBootstrapRuntime::FrameId(),
        vf::CompiledUiBootstrapRuntime::FrameId(),
        title.c_str(),
        vf::CompiledUiBootstrapRuntime::FrameId(),
        centerX, centerY,
        width, height,
        centerX, centerY,
        centerX, centerY);
    return std::string(json);
}

}  // namespace

const char* CompiledUiBootstrapRuntime::FrameId() noexcept {
    return "compiled_ui_bootstrap";
}

const wchar_t* CompiledUiBootstrapRuntime::DefaultPage() noexcept {
    return L"vkf-scene.html";
}

const char* CompiledUiBootstrapRuntime::RuntimeSource() noexcept {
    return "compiled_ui_bootstrap";
}

int CompiledUiBootstrapRuntime::RuntimePacketCount() noexcept {
    return 3;
}

bool CompiledUiBootstrapRuntime::Active() const noexcept {
    return module_.has_value() && !builtinName_.empty();
}

const std::wstring& CompiledUiBootstrapRuntime::BuiltinName() const noexcept {
    return builtinName_;
}

bool CompiledUiBootstrapRuntime::Initialize(const std::filesystem::path& moduleDirectory,
                                            const std::wstring& builtinName,
                                            std::string* errorMessage) {
    auto module = CompiledUiRuntimeModule::LoadBuiltinFromDirectory(moduleDirectory.wstring(), builtinName);
    if (!module.has_value()) {
        if (errorMessage) {
            *errorMessage = "compiled UI builtin not found";
        }
        return false;
    }
    mat4_.assign(kVfTransformMat4F32, 0.0F);
    geometry_.assign(4 * kVfGeometryVertexF64, 0.0);
    transformDirty_ = {};
    geometryDirty_ = {};
    api_ = {};
    api_.transforms.mat4 = mat4_.data();
    api_.transforms.slot_count = 1;
    api_.transforms.dirty = &transformDirty_;
    api_.geometry.xyz = geometry_.data();
    api_.geometry.vertex_capacity = 4;
    api_.geometry.dirty = &geometryDirty_;

    VfInputSnapshot initInput{};
    module->RunBootstrapOnce(&api_, &initInput);

    VfInputSnapshot previewInput{};
    previewInput.sequence = 1U;
    previewInput.pointer_x = 220.0;
    previewInput.pointer_y = 160.0;
    previewInput.pointer_anchor_x = 80.0;
    previewInput.pointer_anchor_y = 70.0;
    if (module->exports().update != nullptr) {
        module->exports().update(&previewInput, &api_);
    }

    sequence_ = previewInput.sequence;
    builtinName_ = builtinName;
    module_ = std::move(*module);
    if (errorMessage) {
        errorMessage->clear();
    }
    return true;
}

void CompiledUiBootstrapRuntime::UpdateFromPointer(double pointerX, double pointerY) {
    if (!Active() || module_->exports().update == nullptr) {
        return;
    }
    VfInputSnapshot input{};
    input.sequence = ++sequence_;
    input.pointer_x = pointerX;
    input.pointer_y = pointerY;
    input.pointer_anchor_x = 80.0;
    input.pointer_anchor_y = 70.0;
    module_->exports().update(&input, &api_);
}

std::string CompiledUiBootstrapRuntime::BuildRuntimePacketsJson() const {
    return ::vf::BuildRuntimePacketsJson(builtinName_, api_);
}

}  // namespace vf
