#pragma once

#include <functional>
#include <mutex>
#include <string>
#include <vector>

#include <winsock2.h>

#include "vf/ui_runtime_contract.hpp"

class OverlayPacketRuntime {
public:
    enum class Channel {
        Runtime,
        Input,
    };

    struct HttpResult {
        int status = 200;
        std::string status_text = "OK";
        std::string response_json;
    };

    using LogSink = std::function<void(const std::string&)>;
    using HttpResponseSink = std::function<void(const HttpResult&)>;
    using SocketHttpResponseSink = std::function<void(SOCKET, int, const char*, const std::string&)>;
    using InputEventSink = std::function<void(const std::string&)>;

    void SetInputEventSink(InputEventSink inputEventSink);
    void SetSocketHttpResponseSink(SocketHttpResponseSink responseSink);
    void SetLogSink(LogSink logSink);
    std::wstring RuntimePacketDefaultPath(const std::wstring& webRootW) const;

    static bool NormalizeRuntimePacketContractJson(const std::string& jsonUtf8, std::string* packetsJsonOut,
                                                   int* packetCountOut, std::string* errorOut);
    static bool TryExtractRuntimePacketPathOverride(const std::string& bodyUtf8, std::wstring* pathOut);

    void SetRuntimePacketSnapshot(const std::string& packetsJsonUtf8, int packetCount, const char* sourceUtf8,
                                  const std::wstring& pathW, const std::string& errorUtf8);
    bool InitializeHostBindingsForWebRoot(const std::wstring& webRootW, LogSink logSink, InputEventSink inputEventSink,
                                          SocketHttpResponseSink socketHttpResponseSink, std::string* errorOut);
    bool InitializeForWebRoot(const std::wstring& webRootW, LogSink logSink, std::string* errorOut);
    bool InitializeRuntimePacketSnapshot(const std::wstring& webRootW, std::string* errorOut);
    bool LoadRuntimePacketFileIntoSnapshot(const std::wstring& pathW, std::string* errorOut);
    bool AppendRuntimePacketsJson(const std::string& jsonUtf8, const char* sourceUtf8, std::string* errorOut = nullptr);

    bool AppendInputRuntimePacketFromEventJson(const std::string& eventJsonUtf8, const char* sourceUtf8,
                                               std::string* errorOut = nullptr);
    bool CaptureInputRuntimePacketFromEventJson(const std::string& eventJsonUtf8, const char* sourceUtf8);
    bool TryHandleInputEventWebMessageAndDispatch(const std::string& webMessageJsonUtf8);
    bool TryHandleInputEventWebMessageAndDispatch(const std::string& webMessageJsonUtf8, const InputEventSink& inputEventSink);
    bool TryHandleInputEventWebMessage(const std::string& webMessageJsonUtf8, const char* sourceUtf8,
                                       std::string* eventJsonUtf8Out = nullptr);
    bool TryHandleInputEventWebMessageAndDispatch(const std::string& webMessageJsonUtf8, const char* sourceUtf8,
                                                  const InputEventSink& inputEventSink);

    std::string BuildSnapshotResponseJson(Channel channel) const;
    bool TryHandleHttpRequest(const std::string& method, const std::string& path, const std::string& bodyUtf8,
                              const std::wstring& webRootW, HttpResult* resultOut);
    bool TryHandleHttpRequestAndRespond(const std::string& method, const std::string& path, const std::string& bodyUtf8,
                                        const std::wstring& webRootW, const HttpResponseSink& responseSink);
    bool TryHandleSocketHttpRequest(const std::string& method, const std::string& path, const std::string& bodyUtf8,
                                    const std::wstring& webRootW, SOCKET socket,
                                    const SocketHttpResponseSink& responseSink);
    bool TryServeSocketHttpRequest(const std::string& method, const std::string& path, const std::string& bodyUtf8,
                                   const std::wstring& webRootW, SOCKET socket);

private:
    struct SnapshotState {
        mutable std::mutex mutex;
        std::string packets_json_utf8 = "[]";
        std::string source_utf8 = "empty";
        std::wstring path_w;
        std::string error_utf8;
        unsigned long long revision = 0;
        int packet_count = 0;
        unsigned long long next_seq = 1;
    };

    static std::string BuildUiRuntimePacketSnapshotResponseJson(const SnapshotState& state, bool includePath);
    static std::string BuildErrorResponseJson(const std::string& errorUtf8, const std::wstring* pathW = nullptr);
    static std::vector<vf::UiRuntimePacket> ParseRuntimePackets(const std::string& jsonUtf8);

    SnapshotState& MutableState(Channel channel);
    const SnapshotState& ReadOnlyState(Channel channel) const;
    void Log(const std::string& message) const;
    void SetSnapshotState(Channel channel, const std::string& packetsJsonUtf8, int packetCount, const char* sourceUtf8,
                          const std::wstring& pathW, const std::string& errorUtf8);
    void SetInputRuntimePacketError(const char* sourceUtf8, const std::string& errorUtf8);

    mutable std::mutex log_sink_mutex_;
    LogSink log_sink_;
    mutable std::mutex input_event_sink_mutex_;
    InputEventSink input_event_sink_;
    mutable std::mutex socket_response_sink_mutex_;
    SocketHttpResponseSink socket_http_response_sink_;
    SnapshotState runtime_state_;
    SnapshotState input_state_;
};
