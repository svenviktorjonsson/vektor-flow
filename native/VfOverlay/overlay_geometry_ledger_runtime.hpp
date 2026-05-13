#pragma once

#include <functional>
#include <mutex>
#include <string>
#include <vector>

#include "vf/geom_ledger_contract.hpp"

class OverlayGeometryLedgerRuntime {
public:
    using LogSink = std::function<void(const std::string&)>;

    struct HttpResult {
        int status = 200;
        std::string status_text = "OK";
        std::string response_json;
    };

    struct SharedBufferSpec {
        std::string channel = "scene";
        std::string name;
        vf::GeomLedgerTransportDescriptor descriptor;
        std::vector<std::uint8_t> state_bytes;
    };

    void SetLogSink(LogSink logSink);
    std::wstring GeometryLedgerDefaultPath(const std::wstring& webRootW) const;
    std::wstring GeometryLedgerStateDefaultPath(const std::wstring& webRootW) const;

    static bool NormalizeGeometryLedgerTransportJson(
        const std::string& jsonUtf8,
        std::string* descriptorJsonOut,
        std::string* errorOut);

    void SetSceneTransportDescriptor(
        const std::string& descriptorJsonUtf8,
        const char* sourceUtf8,
        const std::wstring& pathW,
        const std::string& errorUtf8);
    bool InitializeForWebRoot(const std::wstring& webRootW, LogSink logSink, std::string* errorOut);
    bool InitializeSceneTransportDescriptor(const std::wstring& webRootW, std::string* errorOut);
    bool LoadGeometryLedgerFileIntoSnapshot(const std::wstring& pathW, std::string* errorOut);
    bool LoadSceneSharedBufferSpec(
        const std::wstring& transportPathW,
        const std::wstring& statePathW,
        std::string* errorOut);
    bool TryGetSceneSharedBufferSpec(SharedBufferSpec* specOut, std::string* errorOut) const;

    std::string BuildSnapshotResponseJson() const;

private:
    struct SnapshotState {
        mutable std::mutex mutex;
        std::string descriptor_json_utf8;
        std::string source_utf8 = "empty";
        std::wstring path_w;
        std::string error_utf8;
        unsigned long long revision = 0;
    };

    static std::string BuildGeometryLedgerSnapshotResponseJson(const SnapshotState& state, bool includePath);
    static std::string WideToUtf8(const wchar_t* w);
    static std::string ReadFileBinary(const std::wstring& path);

    void Log(const std::string& message) const;

    mutable std::mutex log_sink_mutex_;
    LogSink log_sink_;
    SnapshotState scene_state_;
    mutable std::mutex shared_buffer_mutex_;
    SharedBufferSpec scene_shared_buffer_spec_;
    bool scene_shared_buffer_ready_ = false;
};
