#include "overlay_geometry_ledger_runtime.hpp"

#include <cstring>
#include <cstdio>
#include <stdexcept>

#include <windows.h>

#include <cJSON.h>

#include "vf/geom_ledger_face_edge_vertex_layout.hpp"
#include "vf/json.hpp"

std::string OverlayGeometryLedgerRuntime::WideToUtf8(const wchar_t* w) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1) {
        return {};
    }
    std::string s(static_cast<size_t>(n - 1), 0);
    WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    return s;
}

std::string OverlayGeometryLedgerRuntime::ReadFileBinary(const std::wstring& path) {
    FILE* f = nullptr;
    if (_wfopen_s(&f, path.c_str(), L"rb") != 0 || !f) {
        return {};
    }
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return {};
    }
    long sz = ftell(f);
    if (sz <= 0 || sz > 4 * 1024 * 1024) {
        fclose(f);
        return {};
    }
    if (fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return {};
    }
    std::string out(static_cast<size_t>(sz), '\0');
    size_t r = fread(out.data(), 1, static_cast<size_t>(sz), f);
    fclose(f);
    if (r != static_cast<size_t>(sz)) {
        return {};
    }
    return out;
}

namespace {

std::vector<std::uint8_t> BuildFaceEdgeVertexStateBytes(const std::string& jsonUtf8) {
    cJSON* root = cJSON_Parse(jsonUtf8.c_str());
    if (!root) {
        throw std::runtime_error("face-edge-vertex state json parse failed");
    }
    std::vector<std::uint8_t> bytes(vf::GeomLedgerFaceEdgeVertexLayout::kStateByteLength, 0);
    auto* pointsF32 = reinterpret_cast<float*>(bytes.data() + vf::GeomLedgerFaceEdgeVertexLayout::kOffF32Points);
    auto* edgesI32 = reinterpret_cast<std::int32_t*>(bytes.data() + vf::GeomLedgerFaceEdgeVertexLayout::kOffI32Edges);

    cJSON* points = cJSON_GetObjectItem(root, "points");
    cJSON* edgePairs = cJSON_GetObjectItem(root, "edgePairs");
    if (!cJSON_IsArray(points) || cJSON_GetArraySize(points) != 4) {
        cJSON_Delete(root);
        throw std::runtime_error("face-edge-vertex state requires 4 points");
    }
    if (!cJSON_IsArray(edgePairs) || cJSON_GetArraySize(edgePairs) != 4) {
        cJSON_Delete(root);
        throw std::runtime_error("face-edge-vertex state requires 4 edgePairs");
    }
    for (int i = 0; i < 4; ++i) {
        cJSON* point = cJSON_GetArrayItem(points, i);
        if (!cJSON_IsArray(point) || cJSON_GetArraySize(point) != 2) {
            cJSON_Delete(root);
            throw std::runtime_error("point must contain 2 numbers");
        }
        cJSON* px = cJSON_GetArrayItem(point, 0);
        cJSON* py = cJSON_GetArrayItem(point, 1);
        if (!cJSON_IsNumber(px) || !cJSON_IsNumber(py)) {
            cJSON_Delete(root);
            throw std::runtime_error("point coordinates must be numeric");
        }
        pointsF32[i * 2] = static_cast<float>(px->valuedouble);
        pointsF32[i * 2 + 1] = static_cast<float>(py->valuedouble);
    }
    for (int i = 0; i < 4; ++i) {
        cJSON* pair = cJSON_GetArrayItem(edgePairs, i);
        if (!cJSON_IsArray(pair) || cJSON_GetArraySize(pair) != 2) {
            cJSON_Delete(root);
            throw std::runtime_error("edge pair must contain 2 indices");
        }
        cJSON* a = cJSON_GetArrayItem(pair, 0);
        cJSON* b = cJSON_GetArrayItem(pair, 1);
        if (!cJSON_IsNumber(a) || !cJSON_IsNumber(b)) {
            cJSON_Delete(root);
            throw std::runtime_error("edge pair indices must be numeric");
        }
        edgesI32[i * 2] = static_cast<std::int32_t>(a->valueint);
        edgesI32[i * 2 + 1] = static_cast<std::int32_t>(b->valueint);
    }
    cJSON_Delete(root);
    return bytes;
}

}  // namespace

void OverlayGeometryLedgerRuntime::SetLogSink(LogSink logSink) {
    std::lock_guard<std::mutex> lock(log_sink_mutex_);
    log_sink_ = std::move(logSink);
}

std::wstring OverlayGeometryLedgerRuntime::GeometryLedgerDefaultPath(const std::wstring& webRootW) const {
    if (webRootW.empty()) {
        return {};
    }
    return webRootW + L"\\vf-geom-ledger-transport.json";
}

std::wstring OverlayGeometryLedgerRuntime::GeometryLedgerStateDefaultPath(const std::wstring& webRootW) const {
    if (webRootW.empty()) {
        return {};
    }
    return webRootW + L"\\vf-geom-ledger-state.json";
}

bool OverlayGeometryLedgerRuntime::NormalizeGeometryLedgerTransportJson(
    const std::string& jsonUtf8,
    std::string* descriptorJsonOut,
    std::string* errorOut) {
    if (descriptorJsonOut) {
        descriptorJsonOut->clear();
    }
    if (errorOut) {
        errorOut->clear();
    }
    if (jsonUtf8.empty()) {
        if (errorOut) {
            *errorOut = "empty body";
        }
        return false;
    }
    try {
        const vf::GeomLedgerTransportDescriptor descriptor =
            vf::ParseGeomLedgerTransportDescriptor(jsonUtf8);
        if (descriptorJsonOut) {
            *descriptorJsonOut = vf::SerializeGeomLedgerTransportDescriptor(descriptor, -1);
        }
        return true;
    } catch (const std::exception& ex) {
        if (errorOut) {
            *errorOut = ex.what();
        }
        return false;
    }
}

void OverlayGeometryLedgerRuntime::SetSceneTransportDescriptor(
    const std::string& descriptorJsonUtf8,
    const char* sourceUtf8,
    const std::wstring& pathW,
    const std::string& errorUtf8) {
    std::lock_guard<std::mutex> lock(scene_state_.mutex);
    scene_state_.descriptor_json_utf8 = descriptorJsonUtf8;
    scene_state_.source_utf8 = sourceUtf8 ? sourceUtf8 : "unknown";
    scene_state_.path_w = pathW;
    scene_state_.error_utf8 = errorUtf8;
    ++scene_state_.revision;
}

bool OverlayGeometryLedgerRuntime::InitializeForWebRoot(
    const std::wstring& webRootW,
    LogSink logSink,
    std::string* errorOut) {
    SetLogSink(std::move(logSink));
    return InitializeSceneTransportDescriptor(webRootW, errorOut);
}

bool OverlayGeometryLedgerRuntime::InitializeSceneTransportDescriptor(
    const std::wstring& webRootW,
    std::string* errorOut) {
    if (errorOut) {
        errorOut->clear();
    }
    const vf::GeomLedgerTransportDescriptor descriptor{};
    SetSceneTransportDescriptor(
        vf::SerializeGeomLedgerTransportDescriptor(descriptor, -1),
        "empty",
        GeometryLedgerDefaultPath(webRootW),
        "");
    return true;
}

bool OverlayGeometryLedgerRuntime::LoadGeometryLedgerFileIntoSnapshot(
    const std::wstring& pathW,
    std::string* errorOut) {
    if (errorOut) {
        errorOut->clear();
    }
    if (pathW.empty()) {
        if (errorOut) {
            *errorOut = "geometry ledger path is empty";
        }
        return false;
    }
    const std::string fileJson = ReadFileBinary(pathW);
    if (fileJson.empty()) {
        if (errorOut) {
            *errorOut = "geometry ledger file missing or empty";
        }
        return false;
    }

    std::string descriptorJson;
    std::string normalizeError;
    if (!NormalizeGeometryLedgerTransportJson(fileJson, &descriptorJson, &normalizeError)) {
        if (errorOut) {
            *errorOut = normalizeError;
        }
        return false;
    }

    SetSceneTransportDescriptor(descriptorJson, "file", pathW, "");
    Log("Geometry ledger transport loaded from file: path=" + WideToUtf8(pathW.c_str()));
    return true;
}

bool OverlayGeometryLedgerRuntime::LoadSceneSharedBufferSpec(
    const std::wstring& transportPathW,
    const std::wstring& statePathW,
    std::string* errorOut) {
    if (errorOut) {
        errorOut->clear();
    }
    if (transportPathW.empty()) {
        if (errorOut) {
            *errorOut = "geometry ledger transport path is empty";
        }
        return false;
    }
    if (statePathW.empty()) {
        if (errorOut) {
            *errorOut = "geometry ledger state path is empty";
        }
        return false;
    }
    const std::string transportJson = ReadFileBinary(transportPathW);
    if (transportJson.empty()) {
        if (errorOut) {
            *errorOut = "geometry ledger transport file missing or empty";
        }
        return false;
    }
    const std::string stateJson = ReadFileBinary(statePathW);
    if (stateJson.empty()) {
        if (errorOut) {
            *errorOut = "geometry ledger state file missing or empty";
        }
        return false;
    }

    try {
        SharedBufferSpec next;
        next.descriptor = vf::ParseGeomLedgerTransportDescriptor(transportJson);
        if (next.descriptor.kind != vf::GeomLedgerTransportKind::SharedBuffer) {
            throw std::runtime_error("geometry ledger transport kind must be shared-buffer");
        }
        if (next.descriptor.header.state_format != static_cast<std::int32_t>(vf::GeomLedgerStateFormat::FaceEdgeVertexV1)) {
            throw std::runtime_error("geometry ledger shared-buffer state format must be FaceEdgeVertexV1");
        }

        cJSON* root = cJSON_Parse(stateJson.c_str());
        if (!root) {
            throw std::runtime_error("geometry ledger state json parse failed");
        }
        cJSON* channel = cJSON_GetObjectItem(root, "channel");
        cJSON* name = cJSON_GetObjectItem(root, "name");
        next.channel = cJSON_IsString(channel) ? channel->valuestring : "scene";
        next.name = cJSON_IsString(name) ? name->valuestring : "geom_frame";
        cJSON_Delete(root);

        next.state_bytes = BuildFaceEdgeVertexStateBytes(stateJson);
        next.descriptor.header.state_byte_length = static_cast<std::int32_t>(next.state_bytes.size());
        {
          std::lock_guard<std::mutex> lock(shared_buffer_mutex_);
          scene_shared_buffer_spec_ = std::move(next);
          scene_shared_buffer_ready_ = true;
        }
        Log("Geometry ledger shared-buffer spec loaded: transport=" + WideToUtf8(transportPathW.c_str()) +
            " state=" + WideToUtf8(statePathW.c_str()));
        return true;
    } catch (const std::exception& ex) {
        if (errorOut) {
            *errorOut = ex.what();
        }
        return false;
    }
}

bool OverlayGeometryLedgerRuntime::TryGetSceneSharedBufferSpec(
    SharedBufferSpec* specOut,
    std::string* errorOut) const {
    if (errorOut) {
        errorOut->clear();
    }
    if (specOut == nullptr) {
        if (errorOut) {
            *errorOut = "scene shared buffer spec output is null";
        }
        return false;
    }
    std::lock_guard<std::mutex> lock(shared_buffer_mutex_);
    if (!scene_shared_buffer_ready_) {
        if (errorOut) {
            *errorOut = "scene shared buffer spec not loaded";
        }
        return false;
    }
    *specOut = scene_shared_buffer_spec_;
    return true;
}

std::string OverlayGeometryLedgerRuntime::BuildGeometryLedgerSnapshotResponseJson(
    const SnapshotState& state,
    bool includePath) {
    vf::JsonValue::Object object{
        {"ok", vf::JsonValue(true)},
        {"source", vf::JsonValue(state.source_utf8)},
        {"revision", vf::JsonValue(static_cast<double>(state.revision))},
    };
    if (includePath) {
        if (state.path_w.empty()) {
            object.emplace("path", vf::JsonValue(nullptr));
        } else {
            object.emplace("path", vf::JsonValue(WideToUtf8(state.path_w.c_str())));
        }
    }
    if (state.error_utf8.empty()) {
        object.emplace("error", vf::JsonValue(nullptr));
    } else {
        object.emplace("error", vf::JsonValue(state.error_utf8));
    }
    try {
        object.emplace(
            "transport",
            state.descriptor_json_utf8.empty()
                ? vf::JsonValue(vf::JsonValue::Object{})
                : vf::parse_json(state.descriptor_json_utf8));
    } catch (const std::exception&) {
        object.emplace("transport", vf::JsonValue(vf::JsonValue::Object{}));
    }
    return vf::json_stringify(vf::JsonValue(object), -1);
}

std::string OverlayGeometryLedgerRuntime::BuildSnapshotResponseJson() const {
    std::lock_guard<std::mutex> lock(scene_state_.mutex);
    return BuildGeometryLedgerSnapshotResponseJson(scene_state_, true);
}

void OverlayGeometryLedgerRuntime::Log(const std::string& message) const {
    std::lock_guard<std::mutex> lock(log_sink_mutex_);
    if (log_sink_) {
        log_sink_(message);
    }
}
