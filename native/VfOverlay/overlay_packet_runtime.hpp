#pragma once

#include <functional>
#include <map>
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
    static std::wstring RuntimePacketDefaultPath(const std::wstring& webRootW);

    static bool NormalizeRuntimePacketContractJson(const std::string& jsonUtf8, std::string* packetsJsonOut,
                                                   int* packetCountOut, std::string* errorOut);
    static bool TryExtractRuntimePacketPathOverride(const std::string& bodyUtf8, std::wstring* pathOut);

    void SetRuntimePacketSnapshot(const std::string& packetsJsonUtf8, int packetCount, const char* sourceUtf8,
                                  const std::wstring& pathW, const std::string& errorUtf8);
    bool InitializeHostBindingsForWebRoot(const std::wstring& webRootW, LogSink logSink, InputEventSink inputEventSink,
                                          SocketHttpResponseSink socketHttpResponseSink, std::string* errorOut);
    bool InitializeForWebRoot(const std::wstring& webRootW, LogSink logSink, std::string* errorOut);
    bool InitializeRuntimePacketSnapshot(const std::wstring& webRootW, std::string* errorOut);
    bool LoadEventProgramFile(const std::wstring& pathW, std::string* errorOut = nullptr);
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
        std::vector<vf::UiRuntimePacket> packets_cache;
        std::string source_utf8 = "empty";
        std::wstring path_w;
        std::string error_utf8;
        bool auto_refresh_from_file = false;
        unsigned long long revision = 0;
        int packet_count = 0;
        unsigned long long next_seq = 1;
    };

    static std::string BuildUiRuntimePacketSnapshotResponseJson(const SnapshotState& state, bool includePath);
    static std::string BuildErrorResponseJson(const std::string& errorUtf8, const std::wstring* pathW = nullptr);
    static std::vector<vf::UiRuntimePacket> ParseRuntimePackets(const std::string& jsonUtf8);
    struct EventAction;

    SnapshotState& MutableState(Channel channel);
    const SnapshotState& ReadOnlyState(Channel channel) const;
    bool RefreshRuntimePacketFileSnapshotIfConfigured(std::string* errorOut = nullptr);
    void Log(const std::string& message) const;
    void SetSnapshotState(Channel channel, const std::string& packetsJsonUtf8, int packetCount, const char* sourceUtf8,
                          const std::wstring& pathW, const std::string& errorUtf8);
    void SetInputRuntimePacketError(const char* sourceUtf8, const std::string& errorUtf8);
    bool AppendRuntimePacket(vf::UiRuntimePacket packet, const char* sourceUtf8, std::string* errorOut = nullptr);
    void SchedulePlotBuild(EventAction action, std::string frameId, std::string expr, double minValue, double maxValue,
                           int countValue, double yMinValue, double yMaxValue, int yCountValue,
                           double tMinValue, double tMaxValue, int tCountValue, double tValue,
                           std::string faceMode, std::string edgeMode, std::string vertexMode, double edgeScale,
                           double vertexScale, std::string faceColormap, std::string edgeColormap,
                           std::string vertexColormap, long long requestId, std::string sourceUtf8);
    bool ExecuteEventProgramForInputEvent(const std::string& eventJsonUtf8, const char* sourceUtf8);

    struct EventAction {
        std::string op;
        std::string name;
        std::string target;
        std::string panel_widget = "plot_panel";
        std::string plot_space = "auto";
        std::string text;
        vf::JsonValue::Array ops;
        vf::JsonValue::Object state;
        std::string expr_widget;
        std::string min_widget;
        std::string max_widget;
        std::string count_widget;
        std::string y_min_widget;
        std::string y_max_widget;
        std::string y_count_widget;
        std::string t_min_widget;
        std::string t_max_widget;
        std::string t_count_widget;
        std::string t_value_widget;
        std::string face_widget;
        std::string edge_widget;
        std::string vertex_widget;
        std::string edge_scale_widget;
        std::string vertex_scale_widget;
        std::string face_colormap_widget;
        std::string edge_colormap_widget;
        std::string vertex_colormap_widget;
        std::string face_mode = "None";
        std::string edge_mode = "Constant";
        std::string vertex_mode = "Constant";
        std::string face_colormap = "rgb";
        std::string edge_colormap = "rgb";
        std::string vertex_colormap = "rgb";
        bool commit_plot = false;
        double min_value = -1.0;
        double max_value = 1.0;
        int count_value = 61;
        double y_min_value = -1.0;
        double y_max_value = 1.0;
        int y_count_value = 41;
        double t_min_value = 0.0;
        double t_max_value = 6.283185307179586;
        int t_count_value = 90;
        double line_width = 0.002;
        double vertex_radius = 0.0025;
    };

    struct EventRule {
        std::string event;
        std::string frame_id;
        std::string widget_id;
        std::string when_text;
        std::vector<EventAction> actions;
    };

    mutable std::mutex event_program_mutex_;
    std::vector<EventRule> event_rules_;
    std::map<std::string, long long> event_counters_;
    std::map<std::string, std::string> event_values_;
    std::map<std::string, vf::JsonValue::Array> plot_committed_meshes_;

    mutable std::mutex log_sink_mutex_;
    LogSink log_sink_;
    mutable std::mutex input_event_sink_mutex_;
    InputEventSink input_event_sink_;
    mutable std::mutex socket_response_sink_mutex_;
    SocketHttpResponseSink socket_http_response_sink_;
    SnapshotState runtime_state_;
    SnapshotState input_state_;
};
