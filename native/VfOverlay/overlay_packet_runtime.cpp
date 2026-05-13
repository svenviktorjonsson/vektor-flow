#include "overlay_packet_runtime.hpp"

#include <cstdio>
#include <stdexcept>

#include <windows.h>

#include "vf/json.hpp"

namespace {

constexpr const char* kWebMessageInputSource = "webmessage";

std::string WideToUtf8(const wchar_t* w) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1)
        return {};
    std::string s(static_cast<size_t>(n - 1), 0);
    WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    return s;
}

std::wstring Utf8ToWide(const std::string& u8) {
    if (u8.empty())
        return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, u8.data(), static_cast<int>(u8.size()), nullptr, 0);
    std::wstring w(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, u8.data(), static_cast<int>(u8.size()), w.data(), n);
    return w;
}

std::string ReadFileBinary(const std::wstring& path) {
    FILE* f = nullptr;
    if (_wfopen_s(&f, path.c_str(), L"rb") != 0 || !f)
        return {};
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return {};
    }
    long sz = ftell(f);
    if (sz <= 0 || sz > 32 * 1024 * 1024) {
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
    if (r != static_cast<size_t>(sz))
        return {};
    return out;
}

bool TryParseWebMessageObject(const std::string& messageJsonUtf8, vf::JsonValue* rootOut) {
    if (rootOut)
        *rootOut = vf::JsonValue(nullptr);
    if (messageJsonUtf8.empty())
        return false;

    vf::JsonValue root = vf::parse_json(messageJsonUtf8);
    if (root.is_string())
        root = vf::parse_json(root.as_string());
    if (!root.is_object())
        return false;

    if (rootOut)
        *rootOut = std::move(root);
    return true;
}

}  // namespace

std::wstring OverlayPacketRuntime::RuntimePacketDefaultPath(const std::wstring& webRootW) const {
    if (webRootW.empty())
        return {};
    return webRootW + L"\\vf-runtime-packets.json";
}

void OverlayPacketRuntime::SetInputEventSink(InputEventSink inputEventSink) {
    std::lock_guard<std::mutex> lock(input_event_sink_mutex_);
    input_event_sink_ = std::move(inputEventSink);
}

void OverlayPacketRuntime::SetSocketHttpResponseSink(SocketHttpResponseSink responseSink) {
    std::lock_guard<std::mutex> lock(socket_response_sink_mutex_);
    socket_http_response_sink_ = std::move(responseSink);
}

void OverlayPacketRuntime::SetLogSink(LogSink logSink) {
    std::lock_guard<std::mutex> lock(log_sink_mutex_);
    log_sink_ = std::move(logSink);
}

std::vector<vf::UiRuntimePacket> OverlayPacketRuntime::ParseRuntimePackets(const std::string& jsonUtf8) {
    const vf::JsonValue root = vf::parse_json(jsonUtf8);
    if (root.is_array()) {
        return vf::ParseUiRuntimePackets(root);
    }
    if (root.is_object()) {
        const auto& object = root.as_object();
        const auto explicitPackets = object.find("packets");
        if (explicitPackets != object.end() && explicitPackets->second.is_array()) {
            return vf::ParseUiRuntimePackets(explicitPackets->second);
        }
        const auto kind = object.find("kind");
        if (kind != object.end() && kind->second.is_string()) {
            return {vf::ParseUiRuntimePacket(root)};
        }
    }
    throw std::runtime_error("expected packet array, object with packets[], or single packet object");
}

bool OverlayPacketRuntime::NormalizeRuntimePacketContractJson(const std::string& jsonUtf8, std::string* packetsJsonOut,
                                                              int* packetCountOut, std::string* errorOut) {
    if (packetsJsonOut)
        packetsJsonOut->clear();
    if (packetCountOut)
        *packetCountOut = 0;
    if (errorOut)
        errorOut->clear();
    if (jsonUtf8.empty()) {
        if (errorOut)
            *errorOut = "empty body";
        return false;
    }

    try {
        const std::vector<vf::UiRuntimePacket> packets = ParseRuntimePackets(jsonUtf8);
        if (packetsJsonOut)
            *packetsJsonOut = vf::SerializeUiRuntimePackets(packets, -1);
        if (packetCountOut)
            *packetCountOut = static_cast<int>(packets.size());
        return true;
    } catch (const std::exception& ex) {
        if (errorOut)
            *errorOut = ex.what();
        return false;
    }
}

bool OverlayPacketRuntime::TryExtractRuntimePacketPathOverride(const std::string& bodyUtf8, std::wstring* pathOut) {
    if (pathOut)
        pathOut->clear();
    if (bodyUtf8.empty())
        return false;
    try {
        const vf::JsonValue root = vf::parse_json(bodyUtf8);
        if (!root.is_object())
            return false;
        const auto& object = root.as_object();
        const auto it = object.find("path");
        if (it == object.end() || !it->second.is_string() || it->second.as_string().empty())
            return false;
        if (pathOut)
            *pathOut = Utf8ToWide(it->second.as_string());
        return true;
    } catch (const std::exception&) {
        return false;
    }
}

OverlayPacketRuntime::SnapshotState& OverlayPacketRuntime::MutableState(Channel channel) {
    return channel == Channel::Runtime ? runtime_state_ : input_state_;
}

const OverlayPacketRuntime::SnapshotState& OverlayPacketRuntime::ReadOnlyState(Channel channel) const {
    return channel == Channel::Runtime ? runtime_state_ : input_state_;
}

void OverlayPacketRuntime::SetSnapshotState(Channel channel, const std::string& packetsJsonUtf8, int packetCount,
                                            const char* sourceUtf8, const std::wstring& pathW,
                                            const std::string& errorUtf8) {
    SnapshotState& state = MutableState(channel);
    std::lock_guard<std::mutex> lock(state.mutex);
    state.packets_json_utf8 = packetsJsonUtf8;
    state.packet_count = packetCount;
    state.source_utf8 = sourceUtf8 ? sourceUtf8 : "unknown";
    state.path_w = pathW;
    state.error_utf8 = errorUtf8;
    ++state.revision;
}

void OverlayPacketRuntime::SetRuntimePacketSnapshot(const std::string& packetsJsonUtf8, int packetCount,
                                                    const char* sourceUtf8, const std::wstring& pathW,
                                                    const std::string& errorUtf8) {
    SetSnapshotState(Channel::Runtime, packetsJsonUtf8, packetCount, sourceUtf8, pathW, errorUtf8);
}

bool OverlayPacketRuntime::InitializeHostBindingsForWebRoot(const std::wstring& webRootW, LogSink logSink,
                                                            InputEventSink inputEventSink,
                                                            SocketHttpResponseSink socketHttpResponseSink,
                                                            std::string* errorOut) {
    SetLogSink(std::move(logSink));
    SetInputEventSink(std::move(inputEventSink));
    SetSocketHttpResponseSink(std::move(socketHttpResponseSink));
    return InitializeRuntimePacketSnapshot(webRootW, errorOut);
}

bool OverlayPacketRuntime::InitializeForWebRoot(const std::wstring& webRootW, LogSink logSink, std::string* errorOut) {
    SetLogSink(std::move(logSink));
    return InitializeRuntimePacketSnapshot(webRootW, errorOut);
}

bool OverlayPacketRuntime::InitializeRuntimePacketSnapshot(const std::wstring& webRootW, std::string* errorOut) {
    const std::wstring pathW = RuntimePacketDefaultPath(webRootW);
    SetRuntimePacketSnapshot("[]", 0, "empty", pathW, "");
    if (errorOut)
        errorOut->clear();
    return true;
}

std::string OverlayPacketRuntime::BuildUiRuntimePacketSnapshotResponseJson(const SnapshotState& state, bool includePath) {
    vf::JsonValue::Object object{
        {"ok", vf::JsonValue(true)},
        {"source", vf::JsonValue(state.source_utf8)},
        {"revision", vf::JsonValue(static_cast<double>(state.revision))},
        {"packetCount", vf::JsonValue(static_cast<double>(state.packet_count))},
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
        object.emplace("packets",
                       state.packets_json_utf8.empty() ? vf::JsonValue(vf::JsonValue::Array{})
                                                       : vf::parse_json(state.packets_json_utf8));
    } catch (const std::exception&) {
        object.emplace("packets", vf::JsonValue(vf::JsonValue::Array{}));
    }
    return vf::json_stringify(vf::JsonValue(object), -1);
}

std::string OverlayPacketRuntime::BuildErrorResponseJson(const std::string& errorUtf8, const std::wstring* pathW) {
    vf::JsonValue::Object object{
        {"ok", vf::JsonValue(false)},
        {"error", vf::JsonValue(errorUtf8)},
    };
    if (pathW) {
        if (pathW->empty()) {
            object.emplace("path", vf::JsonValue(nullptr));
        } else {
            object.emplace("path", vf::JsonValue(WideToUtf8(pathW->c_str())));
        }
    }
    return vf::json_stringify(vf::JsonValue(object), -1);
}

bool OverlayPacketRuntime::LoadRuntimePacketFileIntoSnapshot(const std::wstring& pathW, std::string* errorOut) {
    if (errorOut)
        errorOut->clear();
    if (pathW.empty()) {
        if (errorOut)
            *errorOut = "runtime packet path is empty";
        return false;
    }
    std::string fileJson = ReadFileBinary(pathW);
    if (fileJson.empty()) {
        if (errorOut)
            *errorOut = "runtime packet file missing or empty";
        return false;
    }

    std::string packetsJson;
    std::string normalizeError;
    int packetCount = 0;
    if (!NormalizeRuntimePacketContractJson(fileJson, &packetsJson, &packetCount, &normalizeError)) {
        if (errorOut)
            *errorOut = normalizeError;
        return false;
    }

    SetSnapshotState(Channel::Runtime, packetsJson, packetCount, "file", pathW, "");
    Log("Runtime packets loaded from file: count=" + std::to_string(packetCount) + " path=" + WideToUtf8(pathW.c_str()));
    return true;
}

bool OverlayPacketRuntime::AppendRuntimePacketsJson(const std::string& jsonUtf8, const char* sourceUtf8,
                                                    std::string* errorOut) {
    if (errorOut)
        errorOut->clear();

    std::string packetsJson;
    std::string normalizeError;
    int packetCount = 0;
    if (!NormalizeRuntimePacketContractJson(jsonUtf8, &packetsJson, &packetCount, &normalizeError)) {
        if (errorOut)
            *errorOut = normalizeError;
        return false;
    }

    try {
        std::vector<vf::UiRuntimePacket> appended = ParseRuntimePackets(packetsJson);
        SnapshotState& state = MutableState(Channel::Runtime);
        std::lock_guard<std::mutex> lock(state.mutex);
        std::vector<vf::UiRuntimePacket> packets;
        if (!state.packets_json_utf8.empty() && state.packets_json_utf8 != "[]")
            packets = ParseRuntimePackets(state.packets_json_utf8);
        packets.insert(packets.end(), appended.begin(), appended.end());
        state.packets_json_utf8 = vf::SerializeUiRuntimePackets(packets, -1);
        state.packet_count = static_cast<int>(packets.size());
        state.source_utf8 = sourceUtf8 ? sourceUtf8 : "unknown";
        state.error_utf8.clear();
        ++state.revision;
        return true;
    } catch (const std::exception& ex) {
        if (errorOut)
            *errorOut = ex.what();
        return false;
    }
}

void OverlayPacketRuntime::SetInputRuntimePacketError(const char* sourceUtf8, const std::string& errorUtf8) {
    SnapshotState& state = MutableState(Channel::Input);
    std::lock_guard<std::mutex> lock(state.mutex);
    state.source_utf8 = sourceUtf8 ? sourceUtf8 : "unknown";
    state.error_utf8 = errorUtf8;
    ++state.revision;
}

bool OverlayPacketRuntime::AppendInputRuntimePacketFromEventJson(const std::string& eventJsonUtf8, const char* sourceUtf8,
                                                                 std::string* errorOut) {
    if (errorOut)
        errorOut->clear();
    try {
        const vf::JsonValue root = vf::parse_json(eventJsonUtf8);
        if (!root.is_object())
            throw std::runtime_error("input event must be a JSON object");

        vf::UiRuntimePacket packet;
        packet.kind = vf::UiRuntimePacketKind::InputEvent;
        packet.payload = vf::InputEventPacketPayload{root.as_object()};

        SnapshotState& state = MutableState(Channel::Input);
        std::lock_guard<std::mutex> lock(state.mutex);
        packet.seq = state.next_seq++;
        std::vector<vf::UiRuntimePacket> packets;
        if (!state.packets_json_utf8.empty() && state.packets_json_utf8 != "[]")
            packets = ParseRuntimePackets(state.packets_json_utf8);
        packets.push_back(packet);
        state.packets_json_utf8 = vf::SerializeUiRuntimePackets(packets, -1);
        state.packet_count = static_cast<int>(packets.size());
        state.source_utf8 = sourceUtf8 ? sourceUtf8 : "unknown";
        state.error_utf8.clear();
        ++state.revision;
        return true;
    } catch (const std::exception& ex) {
        if (errorOut)
            *errorOut = ex.what();
        SetInputRuntimePacketError(sourceUtf8, ex.what());
        return false;
    }
}

bool OverlayPacketRuntime::CaptureInputRuntimePacketFromEventJson(const std::string& eventJsonUtf8,
                                                                  const char* sourceUtf8) {
    std::string error;
    if (AppendInputRuntimePacketFromEventJson(eventJsonUtf8, sourceUtf8, &error))
        return true;
    if (!error.empty())
        Log("Input runtime packet packaging failed: " + error);
    return false;
}

bool OverlayPacketRuntime::TryHandleInputEventWebMessageAndDispatch(const std::string& webMessageJsonUtf8) {
    InputEventSink inputEventSink;
    {
        std::lock_guard<std::mutex> lock(input_event_sink_mutex_);
        inputEventSink = input_event_sink_;
    }
    if (!inputEventSink)
        return false;
    return TryHandleInputEventWebMessageAndDispatch(webMessageJsonUtf8, inputEventSink);
}

bool OverlayPacketRuntime::TryHandleInputEventWebMessageAndDispatch(const std::string& webMessageJsonUtf8,
                                                                    const InputEventSink& inputEventSink) {
    return TryHandleInputEventWebMessageAndDispatch(webMessageJsonUtf8, kWebMessageInputSource, inputEventSink);
}

bool OverlayPacketRuntime::TryHandleInputEventWebMessage(const std::string& webMessageJsonUtf8, const char* sourceUtf8,
                                                         std::string* eventJsonUtf8Out) {
    if (eventJsonUtf8Out)
        eventJsonUtf8Out->clear();

    try {
        vf::JsonValue root;
        if (!TryParseWebMessageObject(webMessageJsonUtf8, &root))
            return false;

        const auto& object = root.as_object();
        const auto typeIt = object.find("type");
        if (typeIt == object.end() || !typeIt->second.is_string() || typeIt->second.as_string() != "vf_event")
            return false;

        const std::string eventJsonUtf8 = vf::json_stringify(root, -1);
        CaptureInputRuntimePacketFromEventJson(eventJsonUtf8, sourceUtf8);
        if (eventJsonUtf8Out)
            *eventJsonUtf8Out = eventJsonUtf8;
        return true;
    } catch (const std::exception& ex) {
        Log("Input webmessage decode failed: " + std::string(ex.what()));
        return false;
    }
}

bool OverlayPacketRuntime::TryHandleInputEventWebMessageAndDispatch(const std::string& webMessageJsonUtf8,
                                                                    const char* sourceUtf8,
                                                                    const InputEventSink& inputEventSink) {
    std::string eventJsonUtf8;
    if (!TryHandleInputEventWebMessage(webMessageJsonUtf8, sourceUtf8, &eventJsonUtf8))
        return false;
    if (!eventJsonUtf8.empty() && inputEventSink)
        inputEventSink(eventJsonUtf8);
    return true;
}

std::string OverlayPacketRuntime::BuildSnapshotResponseJson(Channel channel) const {
    const SnapshotState& state = ReadOnlyState(channel);
    std::lock_guard<std::mutex> lock(state.mutex);
    return BuildUiRuntimePacketSnapshotResponseJson(state, channel == Channel::Runtime);
}

void OverlayPacketRuntime::Log(const std::string& message) const {
    std::lock_guard<std::mutex> lock(log_sink_mutex_);
    if (log_sink_)
        log_sink_(message);
}

bool OverlayPacketRuntime::TryHandleHttpRequest(const std::string& method, const std::string& path,
                                                const std::string& bodyUtf8, const std::wstring& webRootW,
                                                HttpResult* resultOut) {
    if (!resultOut)
        return false;

    if (method == "GET") {
        if (path == "/api/runtime-packets") {
            resultOut->status = 200;
            resultOut->status_text = "OK";
            resultOut->response_json = BuildSnapshotResponseJson(Channel::Runtime);
            return true;
        }
        if (path == "/api/runtime-packets/input") {
            resultOut->status = 200;
            resultOut->status_text = "OK";
            resultOut->response_json = BuildSnapshotResponseJson(Channel::Input);
            return true;
        }
        return false;
    }

    if (method != "POST")
        return false;

    if (path == "/api/runtime-packets") {
        std::string packetsJson;
        std::string error;
        int packetCount = 0;
        if (!NormalizeRuntimePacketContractJson(bodyUtf8, &packetsJson, &packetCount, &error)) {
            resultOut->status = 400;
            resultOut->status_text = "Bad Request";
            resultOut->response_json = BuildErrorResponseJson(error);
            return true;
        }
        SetRuntimePacketSnapshot(packetsJson, packetCount, "direct", L"", "");
        Log("Runtime packets accepted via HTTP: count=" + std::to_string(packetCount));
        resultOut->status = 200;
        resultOut->status_text = "OK";
        resultOut->response_json = BuildSnapshotResponseJson(Channel::Runtime);
        return true;
    }

    if (path == "/api/runtime-packets/append") {
        std::string error;
        if (!AppendRuntimePacketsJson(bodyUtf8, "direct", &error)) {
            resultOut->status = 400;
            resultOut->status_text = "Bad Request";
            resultOut->response_json = BuildErrorResponseJson(error);
            return true;
        }
        resultOut->status = 200;
        resultOut->status_text = "OK";
        resultOut->response_json = BuildSnapshotResponseJson(Channel::Runtime);
        return true;
    }

    if (path == "/api/runtime-packets/reload") {
        std::wstring pathOverride;
        const std::wstring pathW =
            TryExtractRuntimePacketPathOverride(bodyUtf8, &pathOverride) ? pathOverride : RuntimePacketDefaultPath(webRootW);
        std::string error;
        if (!LoadRuntimePacketFileIntoSnapshot(pathW, &error)) {
            resultOut->status = 400;
            resultOut->status_text = "Bad Request";
            resultOut->response_json = BuildErrorResponseJson(error, &pathW);
            return true;
        }
        resultOut->status = 200;
        resultOut->status_text = "OK";
        resultOut->response_json = BuildSnapshotResponseJson(Channel::Runtime);
        return true;
    }

    return false;
}

bool OverlayPacketRuntime::TryHandleHttpRequestAndRespond(const std::string& method, const std::string& path,
                                                          const std::string& bodyUtf8, const std::wstring& webRootW,
                                                          const HttpResponseSink& responseSink) {
    if (!responseSink)
        return false;

    HttpResult result;
    if (!TryHandleHttpRequest(method, path, bodyUtf8, webRootW, &result))
        return false;

    responseSink(result);
    return true;
}

bool OverlayPacketRuntime::TryHandleSocketHttpRequest(const std::string& method, const std::string& path,
                                                      const std::string& bodyUtf8, const std::wstring& webRootW,
                                                      SOCKET socket, const SocketHttpResponseSink& responseSink) {
    if (!responseSink)
        return false;

    return TryHandleHttpRequestAndRespond(
        method, path, bodyUtf8, webRootW,
        [socket, &responseSink](const HttpResult& result) {
            responseSink(socket, result.status, result.status_text.c_str(), result.response_json);
        });
}

bool OverlayPacketRuntime::TryServeSocketHttpRequest(const std::string& method, const std::string& path,
                                                     const std::string& bodyUtf8, const std::wstring& webRootW, SOCKET socket) {
    SocketHttpResponseSink responseSink;
    {
        std::lock_guard<std::mutex> lock(socket_response_sink_mutex_);
        responseSink = socket_http_response_sink_;
    }
    if (!responseSink)
        return false;
    if (!TryHandleSocketHttpRequest(method, path, bodyUtf8, webRootW, socket, responseSink))
        return false;
    closesocket(socket);
    return true;
}
