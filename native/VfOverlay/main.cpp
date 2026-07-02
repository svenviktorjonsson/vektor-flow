/*
  vf-overlay — Win32 + WebView2 (DirectComposition) + localhost HTTP (C++).
  Fullscreen transparent overlay: ICoreWebView2CompositionController + default background A=0.
*/

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <windowsx.h>
#include <shlobj.h>
#include <shellapi.h>
#include <commctrl.h>
#include <shlwapi.h>
#include <wrl.h>
#include <wrl/client.h>

#include <WebView2.h>
#include "WebView2EnvironmentOptions.h"
#include <d3d11.h>
#include <dxgi.h>
#include <dcomp.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <deque>
#include <filesystem>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <cJSON.h>

#include "overlay_geometry_ledger_runtime.hpp"
#include "overlay_packet_runtime.hpp"
#include "vf_overlay_host.hpp"
#include "vf/compiled_ui_bootstrap_host.hpp"
#include "vf/crash_diagnostics.hpp"
#include "vf/compiled_ui_runtime_loader.hpp"
#include "vf/geom_ledger_face_edge_vertex_layout.hpp"

#include <gdiplus.h>
#include <objidl.h>
#include <wincrypt.h>

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "Shlwapi.lib")
#pragma comment(lib, "Ws2_32.lib")
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "dcomp.lib")

#ifndef GET_KEYSTATE_WPARAM
#define GET_KEYSTATE_WPARAM(wp) (LOWORD(wp))
#endif
#if !defined(WM_POINTERUPDATE)
#define WM_POINTERUPDATE 0x0245
#define WM_POINTERDOWN 0x0246
#define WM_POINTERUP 0x0247
#endif
#if !defined(GET_POINTERID_WPARAM)
#define GET_POINTERID_WPARAM(wParam) ((UINT32)(LOWORD(wParam)))
#endif

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

/* Fixed path: errors and script ``vf_log`` (see web ``vf-log.js``). Separate mutex from in-namespace enqueue log. */
static std::mutex g_vfUserLogFileMutex;
static const wchar_t kVfUserErrorLogPathW[] = L"C:\\temp\\vektor-flow-log.txt";

static void VfUserLogEnsureParentDirW() { CreateDirectoryW(L"C:\\temp", nullptr); }

static void VfUserLogLineA(const char* level, const char* textUtf8) {
    if (!textUtf8)
        textUtf8 = "";
    VfUserLogEnsureParentDirW();
    std::lock_guard<std::mutex> lock(g_vfUserLogFileMutex);
    FILE* f = nullptr;
    if (_wfopen_s(&f, kVfUserErrorLogPathW, L"a") != 0 || !f)
        return;
    SYSTEMTIME st{};
    GetLocalTime(&st);
    fprintf(f, "[%04u-%02u-%02u %02u:%02u:%02u.%03u] [%s] %s\n", (unsigned)st.wYear, (unsigned)st.wMonth,
            (unsigned)st.wDay, (unsigned)st.wHour, (unsigned)st.wMinute, (unsigned)st.wSecond,
            (unsigned)st.wMilliseconds, level ? level : "?", textUtf8);
    fclose(f);
}

static void VfUserLogfA(const char* level, const char* fmt, ...) {
    char buf[16384];
    va_list ap;
    va_start(ap, fmt);
    _vsnprintf_s(buf, sizeof(buf), _TRUNCATE, fmt, ap);
    va_end(ap);
    VfUserLogLineA(level, buf);
}

namespace {

constexpr UINT WM_APP_PUSH = WM_APP + 1;
constexpr UINT WM_APP_LAYOUT = WM_APP + 2;
constexpr UINT WM_APP_AFTER_NAV = WM_APP + 3;
constexpr UINT WM_APP_YIELD_FOCUS = WM_APP + 4;
constexpr UINT WM_APP_SUBCLASS_WEBVIEW_CHILDREN = WM_APP + 5;
constexpr UINT_PTR kWebViewHitSubclassId = 1;
constexpr UINT_PTR kWebViewSubclassRetryTimer = 42;
constexpr UINT_PTR kWebViewControllerInitWatchdogTimer = 43;

HWND g_hwnd = nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2CompositionController> g_compController;
ComPtr<ICoreWebView2> g_webview;
ComPtr<ID3D11Device> g_d3dDevice;
ComPtr<IDCompositionDevice> g_dcompDevice;
ComPtr<IDCompositionTarget> g_dcompTarget;
ComPtr<IDCompositionVisual> g_dcompRootVisual;
ComPtr<IDCompositionVisual> g_dcompWebVisual;
RECT g_webviewBounds{};
bool g_trackMouseLeave = false;
bool g_captureMouse = false;

HCURSOR g_webviewCursorCached = nullptr;
bool g_webviewCursorCachedOwned = false;
bool g_cursorChangedHandlerRegistered = false;
EventRegistrationToken g_cursorChangedToken{};
HCURSOR g_hiddenCursor = nullptr;
bool g_forceHiddenCursor = false;
bool g_cursorClipActive = false;
POINT g_cursorLockCenterScreen{};
RECT g_cursorLockScreenRect{};

std::mutex g_queueMutex;
std::mutex g_enqueueLogMutex;
std::deque<std::string> g_userQueue;
constexpr std::size_t kMaxUserQueue = 256;
constexpr bool kHotPathDiagEnabled = false;
constexpr bool kCrashDiagHooksEnabled = true;
constexpr bool kCrashDiagLaunchBuiltinBreadcrumbEnabled = false;
constexpr bool kCrashDiagLaunchPageBreadcrumbEnabled = false;
constexpr bool kCrashDiagWebMessageBreadcrumbEnabled = false;
std::atomic<bool> g_uiInputReady{false};
std::atomic<bool> g_webViewControllerCallbackSeen{false};
std::atomic<unsigned long long> g_diagHttpRequests{0};
std::atomic<unsigned long long> g_diagQueuePushes{0};
std::atomic<unsigned long long> g_diagQueueCoalesces{0};
std::atomic<unsigned long long> g_diagQueuePops{0};
std::atomic<unsigned long long> g_diagPointerStreamEnqueues{0};
std::atomic<unsigned long long> g_diagQueueHighWater{0};

std::mutex g_layoutCoalesceMutex;
std::string g_layoutCoalescePending;
bool g_layoutCoalesceScheduled = false;

std::mutex g_lastLayoutSnapshotMutex;
std::string g_lastLayoutSnapshotUtf8;

double g_stageAlpha = 0.0;
bool g_stagePassThrough = false;
bool g_contentHidden = false;
bool g_frameDragActive = false;
int g_toolbarPx = 160;
std::vector<RECT> g_hitRegions;

/* Prefer a stable origin so WebView can reuse its HTTP cache between launches. */
int g_port = 0;
std::atomic<bool> g_httpStop{false};
std::atomic<bool> g_httpListenOk{false};
SOCKET g_listenSock = INVALID_SOCKET;
HANDLE g_httpReadyEvent = nullptr;
std::wstring g_webRootW;
std::wstring g_uiNavUri;
OverlayPacketRuntime g_overlayPacketRuntime;
OverlayGeometryLedgerRuntime g_overlayGeometryLedgerRuntime;
ComPtr<ICoreWebView2Environment12> g_webEnvironment12;
ComPtr<ICoreWebView2_17> g_webview17;
ComPtr<ICoreWebView2SharedBuffer> g_sceneGeomHeaderSharedBuffer;
ComPtr<ICoreWebView2SharedBuffer> g_sceneGeomStateSharedBuffer;
vf::CompiledUiBootstrapHost g_compiledUiBootstrapHost;

/* vf-dock / vf-undock: saved host rect (screen px) before shrinking to the minimized strip. */
static RECT g_preDockWindowRect{};
static bool g_hostDocked = false;

ULONG_PTR g_gdiplusToken = 0;

static void SyncPassThroughInputShape(HWND host);
static bool EffectiveStagePassThrough();
static void ViewerDiagLogPrintf(const char* fmt, ...);

void HttpSendAll(SOCKET s, const char* data, size_t len);

static std::string CrashBreadcrumbSummary(const std::string& text, size_t limit = 160) {
    std::string out = text;
    for (char& ch : out) {
        if (ch == '\r' || ch == '\n' || ch == '\t')
            ch = ' ';
    }
    if (out.size() > limit)
        out.resize(limit);
    return out;
}

std::wstring Utf8ToWide(const std::string& u8) {
    if (u8.empty()) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, u8.data(), (int)u8.size(), nullptr, 0);
    std::wstring w(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, u8.data(), (int)u8.size(), w.data(), n);
    return w;
}

std::string WideToUtf8(const wchar_t* w) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1)
        return {};
    std::string s(static_cast<size_t>(n), 0);
    WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    s.pop_back();
    return s;
}

static bool IsPointerStreamEventJson(const std::string& line) {
    return line.find("\"event\":\"hover\"") != std::string::npos ||
           line.find("\"event\":\"move\"") != std::string::npos ||
           line.find("\"event\":\"pointermove\"") != std::string::npos;
}

static void UpdateQueueHighWaterUnlocked() {
    unsigned long long current = static_cast<unsigned long long>(g_userQueue.size());
    unsigned long long prev = g_diagQueueHighWater.load();
    while (current > prev && !g_diagQueueHighWater.compare_exchange_weak(prev, current)) {
    }
}

static void EnqueueUserEventLine(const std::string& line) {
    std::lock_guard<std::mutex> lock(g_queueMutex);
    bool pointerStream = IsPointerStreamEventJson(line);
    if (IsPointerStreamEventJson(line) && !g_userQueue.empty() && IsPointerStreamEventJson(g_userQueue.back())) {
        g_userQueue.back() = line;
        if (kHotPathDiagEnabled) {
            g_diagQueueCoalesces.fetch_add(1);
            if (pointerStream)
                g_diagPointerStreamEnqueues.fetch_add(1);
            vf::SetCrashBreadcrumb("queue.mode", "coalesced");
            vf::SetCrashBreadcrumb("queue.last_event", CrashBreadcrumbSummary(line));
            vf::SetCrashBreadcrumb("queue.size", std::to_string(g_userQueue.size()));
        }
        return;
    }
    g_userQueue.emplace_back(line);
    while (g_userQueue.size() > kMaxUserQueue) {
        g_userQueue.pop_front();
    }
    if (kHotPathDiagEnabled) {
        g_diagQueuePushes.fetch_add(1);
        if (pointerStream)
            g_diagPointerStreamEnqueues.fetch_add(1);
        UpdateQueueHighWaterUnlocked();
        vf::SetCrashBreadcrumb("queue.mode", "push");
        vf::SetCrashBreadcrumb("queue.last_event", CrashBreadcrumbSummary(line));
        vf::SetCrashBreadcrumb("queue.size", std::to_string(g_userQueue.size()));
    }
}

static std::string BuildDiagStatsJson() {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "http_requests", static_cast<double>(g_diagHttpRequests.load()));
    cJSON_AddNumberToObject(root, "queue_pushes", static_cast<double>(g_diagQueuePushes.load()));
    cJSON_AddNumberToObject(root, "queue_coalesces", static_cast<double>(g_diagQueueCoalesces.load()));
    cJSON_AddNumberToObject(root, "queue_pops", static_cast<double>(g_diagQueuePops.load()));
    cJSON_AddNumberToObject(root, "pointer_stream_enqueues", static_cast<double>(g_diagPointerStreamEnqueues.load()));
    cJSON_AddNumberToObject(root, "queue_high_water", static_cast<double>(g_diagQueueHighWater.load()));
    {
        std::lock_guard<std::mutex> lock(g_queueMutex);
        cJSON_AddNumberToObject(root, "queue_size", static_cast<double>(g_userQueue.size()));
    }
    char* printed = cJSON_PrintUnformatted(root);
    std::string out = printed ? printed : "{}";
    if (printed)
        cJSON_free(printed);
    cJSON_Delete(root);
    return out;
}

static int ParseQueryInt(const char* path, const char* key, int fallback) {
    if (!path || !key)
        return fallback;
    const char* q = strchr(path, '?');
    if (!q)
        return fallback;
    std::string query = q + 1;
    std::string needle = std::string(key) + "=";
    size_t pos = query.find(needle);
    if (pos == std::string::npos)
        return fallback;
    pos += needle.size();
    size_t end = query.find('&', pos);
    std::string value = query.substr(pos, end == std::string::npos ? std::string::npos : (end - pos));
    return value.empty() ? fallback : atoi(value.c_str());
}

static std::string ParseQueryString(const char* path, const char* key, const char* fallback) {
    if (!path || !key)
        return fallback ? fallback : "";
    const char* q = strchr(path, '?');
    if (!q)
        return fallback ? fallback : "";
    std::string query = q + 1;
    std::string needle = std::string(key) + "=";
    size_t pos = query.find(needle);
    if (pos == std::string::npos)
        return fallback ? fallback : "";
    pos += needle.size();
    size_t end = query.find('&', pos);
    return query.substr(pos, end == std::string::npos ? std::string::npos : (end - pos));
}

struct LaunchOptions {
    bool serveOnly = false;
    int explicitPort = 0;
    std::wstring compiledUiBuiltin;
    std::wstring pageArg;
};

static LaunchOptions ParseLaunchOptions(const wchar_t* embeddedPageArg) {
    LaunchOptions options;
    if (embeddedPageArg && embeddedPageArg[0] != L'\0') {
        options.pageArg = embeddedPageArg;
        return options;
    }
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv) {
        return options;
    }
    for (int i = 1; i < argc; ++i) {
        std::wstring arg = argv[i] ? argv[i] : L"";
        if (arg == L"--serve-only") {
            options.serveOnly = true;
            continue;
        }
        if (arg == L"--port" && i + 1 < argc) {
            options.explicitPort = _wtoi(argv[++i]);
            continue;
        }
        if (arg == L"--compiled-ui-builtin" && i + 1 < argc) {
            options.compiledUiBuiltin = argv[++i] ? argv[i] : L"";
            continue;
        }
        if (!arg.empty() && arg[0] == L'-') {
            continue;
        }
        options.pageArg = arg;
    }
    LocalFree(argv);
    return options;
}

static std::wstring ResolveRelativePagePath(const std::wstring& webRoot, const std::wstring& rawArg) {
    std::wstring relPath = vf::CompiledUiBootstrapRuntime::DefaultPage();
    std::wstring s = rawArg;
    while (!s.empty() && (s.front() == L' ' || s.front() == L'\t' || s.front() == L'"')) {
        s.erase(0, 1);
    }
    while (!s.empty() && (s.back() == L' ' || s.back() == L'\t' || s.back() == L'"')) {
        s.pop_back();
    }
    if (s.empty()) {
        return relPath;
    }
    std::wstring absWebRoot = webRoot;
    for (auto& c : absWebRoot) {
        if (c == L'/')
            c = L'\\';
    }
    std::wstring absArg = s;
    for (auto& c : absArg) {
        if (c == L'/')
            c = L'\\';
    }
    bool handled = false;
    if (absArg.size() >= absWebRoot.size()) {
        bool prefixMatch = _wcsnicmp(absArg.c_str(), absWebRoot.c_str(), absWebRoot.size()) == 0;
        if (prefixMatch) {
            std::wstring tail = absArg.substr(absWebRoot.size());
            while (!tail.empty() && (tail.front() == L'\\' || tail.front() == L'/')) {
                tail.erase(0, 1);
            }
            for (auto& c : tail) {
                if (c == L'\\')
                    c = L'/';
            }
            if (!tail.empty() && tail.find(L"..") == std::wstring::npos) {
                relPath = tail;
                handled = true;
            }
        }
    }
    if (!handled && s.find(L"..") == std::wstring::npos) {
        for (auto& c : s) {
            if (c == L'\\') {
                c = L'/';
            }
        }
        while (!s.empty() && s.front() == L'/') {
            s.erase(0, 1);
        }
        if (!s.empty()) {
            relPath = s;
        }
    }
    return relPath;
}

std::string JsonEscapeForJsUtf8(const std::string& in) {
    std::string o;
    o.reserve(in.size() + 8);
    for (unsigned char c : in) {
        switch (c) {
        case '\\': o += "\\\\"; break;
        case '"': o += "\\\""; break;
        case '\n': o += "\\n"; break;
        case '\r': o += "\\r"; break;
        case '\t': o += "\\t"; break;
        default:
            if (c < 0x20)
                o += ' ';
            else
                o += (char)c;
        }
    }
    return o;
}

static std::string JsonEscapeForHostUtf8(const std::string& in) {
    std::string out;
    out.reserve(in.size() + 8);
    for (unsigned char c : in) {
        switch (c) {
        case '\\': out += "\\\\"; break;
        case '"': out += "\\\""; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20) {
                char buf[7];
                snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(c));
                out += buf;
            } else {
                out += static_cast<char>(c);
            }
        }
    }
    return out;
}

static void PostHostJsonMessageToWeb(const std::string& jsonUtf8) {
    if (!g_webview) {
        return;
    }
    std::wstring w = Utf8ToWide(jsonUtf8);
    if (!w.empty()) {
        g_webview->PostWebMessageAsJson(w.c_str());
    }
}

static void PostGeometryLedgerErrorToWeb(const std::string& channel, const std::string& name, const std::string& message) {
    const std::string json =
        std::string("{\"type\":\"vf_geom_ledger_error\",\"channel\":\"") + JsonEscapeForHostUtf8(channel) +
        "\",\"name\":\"" + JsonEscapeForHostUtf8(name) +
        "\",\"message\":\"" + JsonEscapeForHostUtf8(message) + "\"}";
    PostHostJsonMessageToWeb(json);
}

static bool CreateAndFillSharedBuffer(ICoreWebView2Environment12* env12,
                                      UINT64 sizeBytes,
                                      const std::uint8_t* source,
                                      ComPtr<ICoreWebView2SharedBuffer>* outBuffer,
                                      std::string* errorOut) {
    if (errorOut) {
        errorOut->clear();
    }
    if (!env12 || !outBuffer) {
        if (errorOut) {
            *errorOut = "CreateAndFillSharedBuffer requires environment and output buffer";
        }
        return false;
    }
    outBuffer->Reset();
    ComPtr<ICoreWebView2SharedBuffer> buffer;
    HRESULT hr = env12->CreateSharedBuffer(sizeBytes, &buffer);
    if (FAILED(hr) || !buffer) {
        if (errorOut) {
            char msg[160];
            snprintf(msg, sizeof(msg), "CreateSharedBuffer failed hr=0x%08X", static_cast<unsigned>(hr));
            *errorOut = msg;
        }
        return false;
    }
    BYTE* target = nullptr;
    hr = buffer->get_Buffer(&target);
    if (FAILED(hr) || !target) {
        if (errorOut) {
            char msg[160];
            snprintf(msg, sizeof(msg), "ICoreWebView2SharedBuffer::get_Buffer failed hr=0x%08X", static_cast<unsigned>(hr));
            *errorOut = msg;
        }
        return false;
    }
    if (source && sizeBytes > 0) {
        memcpy(target, source, static_cast<size_t>(sizeBytes));
    } else if (sizeBytes > 0) {
        memset(target, 0, static_cast<size_t>(sizeBytes));
    }
    *outBuffer = buffer;
    return true;
}

static bool PublishSceneGeometrySharedBuffersToWeb(const std::string& channel,
                                                   const std::string& name,
                                                   const std::string& stateFormatText) {
    if (!g_webEnvironment12) {
        PostGeometryLedgerErrorToWeb(channel, name, "WebView2 shared-buffer environment unavailable");
        return false;
    }
    if (!g_webview17) {
        PostGeometryLedgerErrorToWeb(channel, name, "WebView2 shared-buffer posting API unavailable");
        return false;
    }
    OverlayGeometryLedgerRuntime::SharedBufferSpec spec;
    std::string specError;
    if (!g_overlayGeometryLedgerRuntime.TryGetSceneSharedBufferSpec(&spec, &specError)) {
        PostGeometryLedgerErrorToWeb(channel, name, specError);
        return false;
    }
    if (spec.channel != channel || spec.name != name) {
        PostGeometryLedgerErrorToWeb(channel, name, "requested geometry ledger channel/name not loaded");
        return false;
    }
    if (spec.descriptor.header.state_format != static_cast<std::int32_t>(vf::GeomLedgerStateFormat::FaceEdgeVertexV1)) {
        PostGeometryLedgerErrorToWeb(channel, name, "unsupported geometry ledger state format");
        return false;
    }

    vf::GeomLedgerSharedBufferHeader header = spec.descriptor.header;
    header.state_byte_length = static_cast<std::int32_t>(spec.state_bytes.size());
    std::string fillError;
    if (!CreateAndFillSharedBuffer(
            g_webEnvironment12.Get(),
            sizeof(vf::GeomLedgerSharedBufferHeader),
            reinterpret_cast<const std::uint8_t*>(&header),
            &g_sceneGeomHeaderSharedBuffer,
            &fillError)) {
        PostGeometryLedgerErrorToWeb(channel, name, fillError);
        return false;
    }
    if (!CreateAndFillSharedBuffer(
            g_webEnvironment12.Get(),
            spec.state_bytes.size(),
            spec.state_bytes.data(),
            &g_sceneGeomStateSharedBuffer,
            &fillError)) {
        PostGeometryLedgerErrorToWeb(channel, name, fillError);
        return false;
    }

    const std::string commonJson =
        std::string("\"type\":\"vf_geom_ledger_shared_buffer\",\"channel\":\"") + JsonEscapeForHostUtf8(channel) +
        "\",\"name\":\"" + JsonEscapeForHostUtf8(name) +
        "\",\"stateFormat\":" + std::to_string(header.state_format) +
        ",\"stateFormatName\":\"" + JsonEscapeForHostUtf8(stateFormatText) + "\"";
    std::wstring headerMeta = Utf8ToWide(
        std::string("{") + commonJson +
        ",\"slot\":\"header\",\"byteLength\":" + std::to_string(sizeof(vf::GeomLedgerSharedBufferHeader)) + "}");
    std::wstring stateMeta = Utf8ToWide(
        std::string("{") + commonJson +
        ",\"slot\":\"state\",\"byteLength\":" + std::to_string(spec.state_bytes.size()) + "}");
    HRESULT hr = g_webview17->PostSharedBufferToScript(
        g_sceneGeomHeaderSharedBuffer.Get(),
        COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE,
        headerMeta.c_str());
    if (FAILED(hr)) {
        char msg[160];
        snprintf(msg, sizeof(msg), "PostSharedBufferToScript(header) failed hr=0x%08X", static_cast<unsigned>(hr));
        PostGeometryLedgerErrorToWeb(channel, name, msg);
        return false;
    }
    hr = g_webview17->PostSharedBufferToScript(
        g_sceneGeomStateSharedBuffer.Get(),
        COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE,
        stateMeta.c_str());
    if (FAILED(hr)) {
        char msg[160];
        snprintf(msg, sizeof(msg), "PostSharedBufferToScript(state) failed hr=0x%08X", static_cast<unsigned>(hr));
        PostGeometryLedgerErrorToWeb(channel, name, msg);
        return false;
    }
    return true;
}

// Standalone uses web\\ next to vf-overlay.exe. Embedded runners pass the
// packaged overlay web root explicitly because their module path is the program.
bool ResolveWebRoot(const wchar_t* embeddedWebRoot) {
    g_webRootW.clear();
    auto tryWebDir = [&](const std::wstring& dir) -> bool {
        std::wstring idx = dir + L"\\index.html";
        if (!PathFileExistsW(idx.c_str()))
            return false;
        g_webRootW = dir;
        return true;
    };

    if (embeddedWebRoot && embeddedWebRoot[0] != L'\0' && tryWebDir(embeddedWebRoot)) {
        return true;
    }

    std::vector<wchar_t> mod(32768);
    DWORD got = GetModuleFileNameW(nullptr, mod.data(), (DWORD)mod.size());
    if (got > 0 && got < mod.size()) {
        mod[got] = 0;
        PathRemoveFileSpecW(mod.data());
        std::wstring exeDir(mod.data());
        if (tryWebDir(exeDir + L"\\web"))
            return true;
    }
    return false;
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
    size_t r = fread(out.data(), 1, (size_t)sz, f);
    fclose(f);
    if (r != (size_t)sz)
        return {};
    return out;
}

static const char* ContentTypeForWebPath(const std::wstring& path) {
    size_t dot = path.find_last_of(L'.');
    if (dot == std::wstring::npos)
        return "application/octet-stream";
    std::wstring ext = path.substr(dot);
    if (_wcsicmp(ext.c_str(), L".html") == 0)
        return "text/html; charset=utf-8";
    if (_wcsicmp(ext.c_str(), L".css") == 0)
        return "text/css; charset=utf-8";
    if (_wcsicmp(ext.c_str(), L".js") == 0)
        return "application/javascript; charset=utf-8";
    if (_wcsicmp(ext.c_str(), L".json") == 0)
        return "application/json; charset=utf-8";
    if (_wcsicmp(ext.c_str(), L".svg") == 0)
        return "image/svg+xml";
    if (_wcsicmp(ext.c_str(), L".ico") == 0)
        return "image/x-icon";
    if (_wcsicmp(ext.c_str(), L".png") == 0)
        return "image/png";
    if (_wcsicmp(ext.c_str(), L".woff2") == 0)
        return "font/woff2";
    if (_wcsicmp(ext.c_str(), L".woff") == 0)
        return "font/woff";
    if (_wcsicmp(ext.c_str(), L".wasm") == 0)
        return "application/wasm";
    return "application/octet-stream";
}

const char* StaticCacheControlForRelativePath(const std::string& rel) {
    if (rel.size() >= 3 && _stricmp(rel.c_str() + rel.size() - 3, ".js") == 0) {
        return "no-store, no-cache, must-revalidate";
    }
    if (rel.size() >= 4 && _stricmp(rel.c_str() + rel.size() - 4, ".css") == 0) {
        return "no-store, no-cache, must-revalidate";
    }
    if (rel == "vf-runtime-packets.json" ||
        rel.find("\\vf-runtime-packets.json") != std::string::npos ||
        rel.find("\\vf-geom-ledger-transport.json") != std::string::npos ||
        rel.find("\\vf-geom-ledger-state.json") != std::string::npos ||
        rel.find("\\vf-event-program.json") != std::string::npos ||
        rel.find("\\vf-api-port.txt") != std::string::npos) {
        return "no-store, no-cache, must-revalidate";
    }
    if (rel.size() >= 4 && _stricmp(rel.c_str() + rel.size() - 4, ".bin") == 0) {
        return "public, max-age=31536000, immutable";
    }
    if (rel.find("\\vf-native-scene-configs-") != std::string::npos ||
        rel.find("\\vf-native-scene-arena-") != std::string::npos ||
        rel.find("\\geom\\") != std::string::npos ||
        rel.find("\\fonts\\") != std::string::npos) {
        return "public, max-age=31536000, immutable";
    }
    if (rel == "index.html" || rel.find("\\vkf-scene.html") != std::string::npos) {
        return "no-cache";
    }
    return "public, max-age=86400";
}

void HttpRespondStatic(SOCKET s, int status, const char* statusText, const char* contentType, const std::string& body, const char* cacheControl = "no-store, no-cache, must-revalidate") {
    char hdr[640];
    snprintf(hdr, sizeof(hdr),
        "HTTP/1.1 %d %s\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Cache-Control: %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %zu\r\n"
        "Connection: close\r\n"
        "\r\n",
        status, statusText, cacheControl, contentType, body.size());
    HttpSendAll(s, hdr, strlen(hdr));
    HttpSendAll(s, body.data(), body.size());
}

void HttpSignalReady(bool listenOk) {
    g_httpListenOk.store(listenOk);
    if (g_httpReadyEvent)
        SetEvent(g_httpReadyEvent);
}

/*
  Hit-test diagnostics (optional file log):

  Optional file log (env): hitdiag under %LOCALAPPDATA%\\vektor-flow\\
  Viewer diagnostics: vf-overlay.log in the same folder.
*/
std::recursive_mutex g_hitDiagMutex;
std::wstring g_hitDiagPathW;
bool g_hitDiagReady = false;
bool g_hitDiagVerbose = false;

static bool HitDiagSetDefaultLogPathLocked() {
    wchar_t local[MAX_PATH];
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, local)))
        return false;
    std::wstring dir = std::wstring(local) + L"\\vektor-flow";
    CreateDirectoryW(dir.c_str(), nullptr);
    g_hitDiagPathW = dir + L"\\hitdiag.log";
    return true;
}

static bool HitDiagResolvePathLocked() {
    char buf[4096];
    DWORD n = GetEnvironmentVariableA("VF_OVERLAY_HIT_LOG", buf, sizeof(buf));
    if (n > 0 && n < sizeof(buf) && buf[0] != '\0') {
        if (_stricmp(buf, "0") == 0 || _stricmp(buf, "off") == 0 || _stricmp(buf, "false") == 0) {
            g_hitDiagPathW.clear();
            return false;
        }
        if (strcmp(buf, "1") == 0)
            return HitDiagSetDefaultLogPathLocked();
        g_hitDiagPathW = Utf8ToWide(std::string(buf));
        return !g_hitDiagPathW.empty();
    }
    // Unset: hit-test file log off (avoid creating hitdiag.log unless explicitly enabled)
    g_hitDiagPathW.clear();
    return false;
}

static void HitDiagResolveVerboseLocked() {
    char vbuf[32];
    DWORD nv = GetEnvironmentVariableA("VF_OVERLAY_HIT_LOG_VERBOSE", vbuf, sizeof(vbuf));
    g_hitDiagVerbose = (nv > 0 && nv < sizeof(vbuf) && vbuf[0] == '1');
}

static bool HitDiagEnabled() {
    std::lock_guard<std::recursive_mutex> lock(g_hitDiagMutex);
    if (!g_hitDiagReady) {
        g_hitDiagReady = true;
        HitDiagResolvePathLocked();
        HitDiagResolveVerboseLocked();
    }
    return !g_hitDiagPathW.empty();
}

static void HitDiagLog(const char* fmt, ...) {
    std::lock_guard<std::recursive_mutex> lock(g_hitDiagMutex);
    if (!g_hitDiagReady) {
        g_hitDiagReady = true;
        HitDiagResolvePathLocked();
        HitDiagResolveVerboseLocked();
    }
    if (g_hitDiagPathW.empty())
        return;
    FILE* f = nullptr;
    if (_wfopen_s(&f, g_hitDiagPathW.c_str(), L"a") != 0 || !f)
        return;
    SYSTEMTIME st{};
    GetLocalTime(&st);
    fprintf(f, "[%04u-%02u-%02u %02u:%02u:%02u.%03u] ", (unsigned)st.wYear, (unsigned)st.wMonth,
            (unsigned)st.wDay, (unsigned)st.wHour, (unsigned)st.wMinute, (unsigned)st.wSecond,
            (unsigned)st.wMilliseconds);
    va_list ap;
    va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fputc('\n', f);
    fclose(f);
}

static bool ViewerDiagFileLogEnabled() {
    char buf[64];
    DWORD n = GetEnvironmentVariableA("VF_OVERLAY_VIEWER_LOG", buf, sizeof(buf));
    if (n > 0 && n < sizeof(buf) && buf[0] != '\0') {
        if (_stricmp(buf, "0") == 0 || _stricmp(buf, "off") == 0 || _stricmp(buf, "false") == 0)
            return false;
        return true;
    }
    char ebuf[64];
    DWORD ne = GetEnvironmentVariableA("VF_OVERLAY_ENQUEUE_LOG", ebuf, sizeof(ebuf));
    if (ne > 0 && ne < sizeof(ebuf) && ebuf[0] != '\0') {
        if (_stricmp(ebuf, "0") == 0 || _stricmp(ebuf, "off") == 0 || _stricmp(ebuf, "false") == 0)
            return false;
    }
    return true;
}

static std::wstring ViewerDiagLogFilePath() {
    wchar_t local[MAX_PATH];
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, local)))
        return {};
    std::wstring dir = std::wstring(local) + L"\\vektor-flow";
    CreateDirectoryW(dir.c_str(), nullptr);
    return dir + L"\\vf-overlay.log";
}

static void ViewerDiagLogPrintf(const char* fmt, ...) {
    if (!ViewerDiagFileLogEnabled())
        return;
    std::wstring path = ViewerDiagLogFilePath();
    if (path.empty())
        return;
    std::lock_guard<std::mutex> lock(g_enqueueLogMutex);
    FILE* f = nullptr;
    if (_wfopen_s(&f, path.c_str(), L"a") != 0 || !f)
        return;
    SYSTEMTIME st{};
    GetLocalTime(&st);
    fprintf(f, "[%04u-%02u-%02u %02u:%02u:%02u.%03u] ", (unsigned)st.wYear, (unsigned)st.wMonth,
            (unsigned)st.wDay, (unsigned)st.wHour, (unsigned)st.wMinute, (unsigned)st.wSecond,
            (unsigned)st.wMilliseconds);
    va_list ap;
    va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fputc('\n', f);
    fclose(f);
}

/** Always appends to vf-overlay.log (ignores env toggles) for startup / crash forensics. */
static void VfTraceLogA(const char* fmt, ...) {
    std::wstring path = ViewerDiagLogFilePath();
    if (path.empty())
        return;
    std::lock_guard<std::mutex> lock(g_enqueueLogMutex);
    FILE* f = nullptr;
    if (_wfopen_s(&f, path.c_str(), L"a") != 0 || !f)
        return;
    fprintf(f, "[trace] ");
    va_list ap;
    va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fputc('\n', f);
    fclose(f);
}

static void ViewerEnqueueDiagLog(const std::string& lineUtf8) {
    if (!ViewerDiagFileLogEnabled())
        return;
    std::wstring path = ViewerDiagLogFilePath();
    if (path.empty())
        return;

    std::string s = lineUtf8;
    const size_t origLen = s.size();
    if (s.size() > 800)
        s.resize(800);
    for (char& ch : s) {
        if (ch == '\n' || ch == '\r')
            ch = ' ';
    }

    std::lock_guard<std::mutex> lock(g_enqueueLogMutex);
    FILE* f = nullptr;
    if (_wfopen_s(&f, path.c_str(), L"a") != 0 || !f)
        return;
    SYSTEMTIME st{};
    GetLocalTime(&st);
    fprintf(f, "[%04u-%02u-%02u %02u:%02u:%02u.%03u] enqueued len=%zu ",
            (unsigned)st.wYear, (unsigned)st.wMonth, (unsigned)st.wDay, (unsigned)st.wHour,
            (unsigned)st.wMinute, (unsigned)st.wSecond, (unsigned)st.wMilliseconds, origLen);
    fwrite(s.data(), 1, s.size(), f);
    fputc('\n', f);
    fclose(f);
}

static bool HitDiagVerboseEnabled() {
    std::lock_guard<std::recursive_mutex> lock(g_hitDiagMutex);
    if (!g_hitDiagReady) {
        g_hitDiagReady = true;
        HitDiagResolvePathLocked();
        HitDiagResolveVerboseLocked();
    }
    return g_hitDiagVerbose && !g_hitDiagPathW.empty();
}

/*
  Visual hosting (ICoreWebView2CompositionController + DirectComposition).
  Click-through to apps behind: only when Stage backdrop α≈0 or content is hidden (same as web stagePassThrough).
  Then WM_NCHITTEST is HTTRANSPARENT outside g_hitRegions; when α>0 and content visible, gaps use DefWindowProc.

  hitRegions use getBoundingClientRect() (DIP); native maps each rect to physical client pixels for PtInRect.
*/

void ApplyLayoutJson(const std::string& jsonUtf8) {
    cJSON* root = cJSON_Parse(jsonUtf8.c_str());
    if (!root)
        return;
    // WebView2: postMessage(JSON.stringify(obj)) arrives as a JSON *string* value; unwrap like MessageJsonIndicatesClose.
    if (cJSON_IsString(root)) {
        cJSON* inner = cJSON_Parse(root->valuestring);
        cJSON_Delete(root);
        root = inner;
        if (!root)
            return;
    }
    cJSON* type = cJSON_GetObjectItem(root, "type");
    if (cJSON_IsString(type)) {
        if (_stricmp(type->valuestring, "layout") == 0) {
            cJSON* sa = cJSON_GetObjectItem(root, "stageAlpha");
            if (cJSON_IsNumber(sa)) {
                double a = sa->valuedouble;
                if (a < 0)
                    a = 0;
                if (a > 1)
                    a = 1;
                g_stageAlpha = a;
            }
            cJSON* ch = cJSON_GetObjectItem(root, "contentHidden");
            if (cJSON_IsBool(ch))
                g_contentHidden = cJSON_IsTrue(ch);
            cJSON* da = cJSON_GetObjectItem(root, "dragActive");
            g_frameDragActive = cJSON_IsBool(da) && cJSON_IsTrue(da);
            /* Same rule as web postLayout(): pass-through when stage is hidden or backdrop α≈0. */
            g_stagePassThrough = g_contentHidden || g_stageAlpha < 0.001;
            cJSON* tp = cJSON_GetObjectItem(root, "toolbarPx");
            if (cJSON_IsNumber(tp) && tp->valueint > 0)
                g_toolbarPx = tp->valueint;
            g_hitRegions.clear();
            cJSON* hitArr = cJSON_GetObjectItem(root, "hitRegions");
            if (cJSON_IsArray(hitArr)) {
                int hn = cJSON_GetArraySize(hitArr);
                for (int hi = 0; hi < hn; hi++) {
                    cJSON* o = cJSON_GetArrayItem(hitArr, hi);
                    if (!o)
                        continue;
                    cJSON* cl = cJSON_GetObjectItem(o, "left");
                    cJSON* ct = cJSON_GetObjectItem(o, "top");
                    cJSON* cr = cJSON_GetObjectItem(o, "right");
                    cJSON* cb = cJSON_GetObjectItem(o, "bottom");
                    if (!cJSON_IsNumber(cl) || !cJSON_IsNumber(ct) || !cJSON_IsNumber(cr) || !cJSON_IsNumber(cb))
                        continue;
                    RECT rc{};
                    rc.left = (LONG)cl->valuedouble;
                    rc.top = (LONG)ct->valuedouble;
                    rc.right = (LONG)cr->valuedouble;
                    rc.bottom = (LONG)cb->valuedouble;
                    if (rc.right > rc.left && rc.bottom > rc.top) {
                        g_hitRegions.push_back(rc);
                    }
                }
            }
            {
                std::lock_guard<std::mutex> snap(g_lastLayoutSnapshotMutex);
                g_lastLayoutSnapshotUtf8 = jsonUtf8;
            }
            VfTraceLogA("layout: stageAlpha=%.3f contentHidden=%d hitRegions=%zu contentReady=%d",
                        g_stageAlpha,
                        g_contentHidden ? 1 : 0,
                        g_hitRegions.size(),
                        cJSON_IsTrue(cJSON_GetObjectItem(root, "contentReady")) ? 1 : 0);
        } else if (_stricmp(type->valuestring, "stageAlpha") == 0) {
            cJSON* v = cJSON_GetObjectItem(root, "value");
            if (cJSON_IsNumber(v)) {
                double a = v->valuedouble;
                if (a < 0)
                    a = 0;
                if (a > 1)
                    a = 1;
                g_stageAlpha = a;
                g_stagePassThrough = g_contentHidden || g_stageAlpha < 0.001;
            }
        }
    }
    cJSON_Delete(root);
    /* WebView2 may create new HWNDs when layout/size changes; rediscover and subclass. */
    if (g_hwnd) {
        PostMessageW(g_hwnd, WM_APP_SUBCLASS_WEBVIEW_CHILDREN, 0, 0);
        SyncPassThroughInputShape(g_hwnd);
    }
}

static bool MessageJsonIndicatesClose(const std::string& u8) {
    cJSON* root = cJSON_Parse(u8.c_str());
    if (!root)
        return false;
    cJSON* obj = root;
    if (cJSON_IsString(root)) {
        cJSON* inner = cJSON_Parse(root->valuestring);
        cJSON_Delete(root);
        obj = inner;
        if (!obj)
            return false;
    }
    cJSON* typ = cJSON_GetObjectItem(obj, "type");
    bool ok = cJSON_IsString(typ) && _stricmp(typ->valuestring, "close") == 0;
    cJSON_Delete(obj);
    return ok;
}

static bool MessageJsonIndicatesYieldFocus(const std::string& u8) {
    cJSON* root = cJSON_Parse(u8.c_str());
    if (!root)
        return false;
    cJSON* obj = root;
    if (cJSON_IsString(root)) {
        cJSON* inner = cJSON_Parse(root->valuestring);
        cJSON_Delete(root);
        obj = inner;
        if (!obj)
            return false;
    }
    cJSON* typ = cJSON_GetObjectItem(obj, "type");
    bool ok = cJSON_IsString(typ) && _stricmp(typ->valuestring, "yieldFocus") == 0;
    cJSON_Delete(obj);
    return ok;
}

static bool MessageJsonIndicatesMinimize(const std::string& u8) {
    cJSON* root = cJSON_Parse(u8.c_str());
    if (!root)
        return false;
    cJSON* obj = root;
    if (cJSON_IsString(root)) {
        cJSON* inner = cJSON_Parse(root->valuestring);
        cJSON_Delete(root);
        obj = inner;
        if (!obj)
            return false;
    }
    cJSON* typ = cJSON_GetObjectItem(obj, "type");
    bool ok = cJSON_IsString(typ) && _stricmp(typ->valuestring, "minimize") == 0;
    cJSON_Delete(obj);
    return ok;
}

static bool MessageJsonIndicatesRestore(const std::string& u8) {
    cJSON* root = cJSON_Parse(u8.c_str());
    if (!root)
        return false;
    cJSON* obj = root;
    if (cJSON_IsString(root)) {
        cJSON* inner = cJSON_Parse(root->valuestring);
        cJSON_Delete(root);
        obj = inner;
        if (!obj)
            return false;
    }
    cJSON* typ = cJSON_GetObjectItem(obj, "type");
    bool ok = cJSON_IsString(typ) && _stricmp(typ->valuestring, "restore") == 0;
    cJSON_Delete(obj);
    return ok;
}

static cJSON* ParseWebViewPostMessageObject(const std::string& u8) {
    cJSON* root = cJSON_Parse(u8.c_str());
    if (!root)
        return nullptr;
    if (cJSON_IsString(root)) {
        cJSON* inner = cJSON_Parse(root->valuestring);
        cJSON_Delete(root);
        root = inner;
    }
    return root;
}

static POINT DipClientPointToScreen(HWND host, double xDip, double yDip);
static RECT DipClientRectToScreen(HWND host, double leftDip, double topDip, double rightDip, double bottomDip);
HRESULT ExecuteScriptUtf8(const std::string& jsUtf8);
static HCURSOR HiddenCursor();
static void ApplyOverlayCursor();

static bool TryHandleVfUserLogMessage(const std::string& u8) {
    /* Skip huge layout payloads. Do not match on "\"type\":\"vf_log\"" — postMessage(string) JSON is
     * escaped (\"…\") so that substring never appears; use "vf_log" or parse. */
    if (u8.size() > 256 * 1024) {
        return false;
    }
    if (u8.find("vf_log") == std::string::npos) {
        return false;
    }
    cJSON* root = ParseWebViewPostMessageObject(u8);
    if (!root)
        return false;
    cJSON* type = cJSON_GetObjectItem(root, "type");
    if (!cJSON_IsString(type) || _stricmp(type->valuestring, "vf_log") != 0) {
        cJSON_Delete(root);
        return false;
    }
    cJSON* level = cJSON_GetObjectItem(root, "level");
    cJSON* msg = cJSON_GetObjectItem(root, "message");
    const char* lev = (cJSON_IsString(level) && level->valuestring) ? level->valuestring : "log";
    if (!cJSON_IsString(msg) || !msg->valuestring) {
        cJSON_Delete(root);
        VfUserLogLineA(lev, "(vf_log: missing message)");
        return true;
    }
    std::string t = msg->valuestring;
    cJSON_Delete(root);
    if (t.size() > 12000)
        t.resize(12000);
    VfUserLogLineA(lev, t.c_str());
    return true;
}

static bool TryHandleVfEventMessage(const std::string& u8) {
    return g_overlayPacketRuntime.TryHandleInputEventWebMessageAndDispatch(u8);
}

static bool TryHandleVfSharedBufferRequestMessage(const std::string& u8) {
    if (u8.find("vf_request_shared_buffers") == std::string::npos) {
        return false;
    }
    cJSON* root = ParseWebViewPostMessageObject(u8);
    if (!root) {
        return false;
    }
    cJSON* type = cJSON_GetObjectItem(root, "type");
    if (!cJSON_IsString(type) || _stricmp(type->valuestring, "vf_request_shared_buffers") != 0) {
        cJSON_Delete(root);
        return false;
    }
    cJSON* channelItem = cJSON_GetObjectItem(root, "channel");
    cJSON* nameItem = cJSON_GetObjectItem(root, "name");
    std::string channel = cJSON_IsString(channelItem) && channelItem->valuestring ? channelItem->valuestring : "scene";
    std::string name = cJSON_IsString(nameItem) && nameItem->valuestring ? nameItem->valuestring : "geom_frame";
    cJSON_Delete(root);
    ViewerDiagLogPrintf("vf shared buffer request: channel=%s name=%s", channel.c_str(), name.c_str());
    if (!PublishSceneGeometrySharedBuffersToWeb(channel, name, vf::ToString(vf::GeomLedgerStateFormat::FaceEdgeVertexV1))) {
        ViewerDiagLogPrintf("vf shared buffer publish failed: channel=%s name=%s", channel.c_str(), name.c_str());
    } else {
        ViewerDiagLogPrintf("vf shared buffer publish ok: channel=%s name=%s", channel.c_str(), name.c_str());
    }
    return true;
}

static bool TryHandleVfHostChromeMessage(const std::string& u8, HWND host) {
    cJSON* root = ParseWebViewPostMessageObject(u8);
    if (!root)
        return false;
    cJSON* jtype = cJSON_GetObjectItem(root, "type");
    if (!cJSON_IsString(jtype) || !jtype->valuestring) {
        cJSON_Delete(root);
        return false;
    }
    const char* t = jtype->valuestring;
    if (_stricmp(t, "transparent-overlay.cursor") == 0) {
        cJSON* cursor = cJSON_GetObjectItem(root, "cursor");
        const char* cursorValue = cJSON_IsString(cursor) && cursor->valuestring ? cursor->valuestring : "";
        g_forceHiddenCursor = _stricmp(cursorValue, "none") == 0;
        cJSON* x = cJSON_GetObjectItem(root, "x");
        cJSON* y = cJSON_GetObjectItem(root, "y");
        cJSON* left = cJSON_GetObjectItem(root, "left");
        cJSON* top = cJSON_GetObjectItem(root, "top");
        cJSON* right = cJSON_GetObjectItem(root, "right");
        cJSON* bottom = cJSON_GetObjectItem(root, "bottom");
        if (g_cursorClipActive) {
            ClipCursor(nullptr);
            g_cursorClipActive = false;
        }
        if (cJSON_IsNumber(x) && cJSON_IsNumber(y)) {
            g_cursorLockCenterScreen = DipClientPointToScreen(host, x->valuedouble, y->valuedouble);
        }
        if (g_forceHiddenCursor && (g_cursorLockCenterScreen.x != 0 || g_cursorLockCenterScreen.y != 0)) {
            SetCursorPos(g_cursorLockCenterScreen.x, g_cursorLockCenterScreen.y);
        }
        cJSON_Delete(root);
        ApplyOverlayCursor();
        return true;
    }
    if (_stricmp(t, "vf-move") == 0) {
        cJSON* jdx = cJSON_GetObjectItem(root, "dx");
        cJSON* jdy = cJSON_GetObjectItem(root, "dy");
        long dx = cJSON_IsNumber(jdx) ? (long)std::lround(jdx->valuedouble) : 0L;
        long dy = cJSON_IsNumber(jdy) ? (long)std::lround(jdy->valuedouble) : 0L;
        cJSON_Delete(root);
        if (host && (dx != 0 || dy != 0)) {
            RECT r{};
            if (GetWindowRect(host, &r)) {
                SetWindowPos(host, nullptr, r.left + dx, r.top + dy, 0, 0,
                             SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            }
        }
        return true;
    }
    if (_stricmp(t, "vf-undock") == 0) {
        cJSON_Delete(root);
        if (g_hostDocked && host) {
            int ww = (int)(g_preDockWindowRect.right - g_preDockWindowRect.left);
            int wh = (int)(g_preDockWindowRect.bottom - g_preDockWindowRect.top);
            if (ww > 10 && wh > 10) {
                SetWindowPos(host, nullptr, (int)g_preDockWindowRect.left, (int)g_preDockWindowRect.top, ww, wh,
                             SWP_NOZORDER | SWP_NOACTIVATE);
                /* New client pixels after growing from a docked strip can render black until a full paint. */
                InvalidateRect(host, nullptr, FALSE);
                UpdateWindow(host);
            }
            g_hostDocked = false;
        }
        return true;
    }
    if (_stricmp(t, "vf-dock") == 0) {
        cJSON* jw = cJSON_GetObjectItem(root, "width");
        cJSON* jh = cJSON_GetObjectItem(root, "height");
        cJSON* jd = cJSON_GetObjectItem(root, "dock");
        int rw = cJSON_IsNumber(jw) ? (int)std::lround(jw->valuedouble) : 0;
        int rh = cJSON_IsNumber(jh) ? (int)std::lround(jh->valuedouble) : 0;
        std::string dockStr = "bl";
        if (cJSON_IsString(jd) && jd->valuestring)
            dockStr = jd->valuestring;
        cJSON_Delete(root);
        if (!host || rw < 1 || rh < 1)
            return true;
        if (!g_hostDocked) {
            if (GetWindowRect(host, &g_preDockWindowRect))
                g_hostDocked = true;
        }
        UINT dpi = GetDpiForWindow(host);
        if (dpi == 0)
            dpi = 96u;
        rw = MulDiv(rw, (int)dpi, 96);
        rh = MulDiv(rh, (int)dpi, 96);
        if (rw < 40)
            rw = 40;
        if (rh < 20)
            rh = 20;
        HMONITOR mon = MonitorFromWindow(host, MONITOR_DEFAULTTONEAREST);
        if (!mon) {
            SetWindowPos(host, nullptr, 0, 0, rw, rh, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
            return true;
        }
        MONITORINFO mi{};
        mi.cbSize = sizeof(MONITORINFO);
        if (!GetMonitorInfoW(mon, &mi)) {
            SetWindowPos(host, nullptr, 0, 0, rw, rh, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
            return true;
        }
        RECT wk = mi.rcWork;
        int sw = (int)(wk.right - wk.left);
        int sh = (int)(wk.bottom - wk.top);
        int x = wk.left;
        int y = wk.top;
        auto lower = [&dockStr]() {
            for (char& c : dockStr) {
                if (c >= 'A' && c <= 'Z')
                    c = (char)(c - 'A' + 'a');
            }
        };
        lower();
        /* Web posts two-letter: bl, bc, br, tl, tc, tr, cl, cr (and legacy top/bottom/left/right). */
        if (dockStr == "bottom" || dockStr == "bl") {
            x = wk.left;
            y = wk.bottom - rh;
        } else if (dockStr == "bc") {
            x = wk.left + (sw - rw) / 2;
            y = wk.bottom - rh;
        } else if (dockStr == "br") {
            x = wk.right - rw;
            y = wk.bottom - rh;
        } else if (dockStr == "top" || dockStr == "tl") {
            x = wk.left;
            y = wk.top;
        } else if (dockStr == "tc") {
            x = wk.left + (sw - rw) / 2;
            y = wk.top;
        } else if (dockStr == "tr") {
            x = wk.right - rw;
            y = wk.top;
        } else if (dockStr == "left" || dockStr == "cl") {
            x = wk.left;
            y = wk.top + (sh - rh) / 2;
        } else if (dockStr == "right" || dockStr == "cr") {
            x = wk.right - rw;
            y = wk.top + (sh - rh) / 2;
        } else {
            x = wk.left;
            y = wk.bottom - rh;
        }
        SetWindowPos(host, nullptr, x, y, rw, rh, SWP_NOZORDER | SWP_NOACTIVATE);
        return true;
    }
    cJSON_Delete(root);
    return false;
}

static bool InitGdiplusOnce() {
    if (g_gdiplusToken != 0)
        return true;
    Gdiplus::GdiplusStartupInput gin;
    Gdiplus::Status s = Gdiplus::GdiplusStartup(&g_gdiplusToken, &gin, nullptr);
    return s == Gdiplus::Ok;
}

static void ShutdownGdiplusIfNeeded() {
    if (g_gdiplusToken != 0) {
        Gdiplus::GdiplusShutdown(g_gdiplusToken);
        g_gdiplusToken = 0;
    }
}

static int GetPngEncoderClsid(CLSID* pClsid) {
    UINT num = 0;
    UINT size = 0;
    Gdiplus::GetImageEncodersSize(&num, &size);
    if (size == 0)
        return -1;
    std::vector<BYTE> buf(size);
    auto* pImageCodecInfo = reinterpret_cast<Gdiplus::ImageCodecInfo*>(buf.data());
    Gdiplus::GetImageEncoders(num, size, pImageCodecInfo);
    for (UINT j = 0; j < num; ++j) {
        if (wcscmp(pImageCodecInfo[j].MimeType, L"image/png") == 0) {
            *pClsid = pImageCodecInfo[j].Clsid;
            return (int)j;
        }
    }
    return -1;
}

static bool BytesToBase64(const std::vector<uint8_t>& raw, std::string* out) {
    if (raw.empty()) {
        *out = "";
        return true;
    }
    DWORD cb = 0;
    if (!CryptBinaryToStringA(raw.data(), (DWORD)raw.size(), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &cb))
        return false;
    out->resize(cb);
    if (!CryptBinaryToStringA(raw.data(), (DWORD)raw.size(), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, out->data(), &cb))
        return false;
    while (!out->empty() && (out->back() == '\0' || out->back() == '\n' || out->back() == '\r'))
        out->pop_back();
    return true;
}

static bool CaptureClientRectToPngDataUrl(HWND hwnd, double dipLeft, double dipTop, double dipW, double dipH, std::string* outDataUrl) {
    outDataUrl->clear();
    if (!hwnd || dipW < 1.0 || dipH < 1.0 || g_gdiplusToken == 0)
        return false;
    UINT dpi = GetDpiForWindow(hwnd);
    double scale = (double)dpi / 96.0;
    int physW = (int)std::lround(dipW * scale);
    int physH = (int)std::lround(dipH * scale);
    if (physW < 1)
        physW = 1;
    if (physH < 1)
        physH = 1;
    int physL = (int)std::lround(dipLeft * scale);
    int physT = (int)std::lround(dipTop * scale);
    POINT pt = { physL, physT };
    if (!ClientToScreen(hwnd, &pt))
        return false;
    HDC screenDC = GetDC(nullptr);
    if (!screenDC)
        return false;
    HDC memDC = CreateCompatibleDC(screenDC);
    HBITMAP hBmp = CreateCompatibleBitmap(screenDC, physW, physH);
    if (!memDC || !hBmp) {
        if (hBmp)
            DeleteObject(hBmp);
        if (memDC)
            DeleteDC(memDC);
        ReleaseDC(nullptr, screenDC);
        return false;
    }
    HGDIOBJ old = SelectObject(memDC, hBmp);
    BOOL blt = BitBlt(memDC, 0, 0, physW, physH, screenDC, pt.x, pt.y, SRCCOPY);
    SelectObject(memDC, old);
    ReleaseDC(nullptr, screenDC);
    if (!blt) {
        DeleteObject(hBmp);
        DeleteDC(memDC);
        return false;
    }
    CLSID pngClsid{};
    if (GetPngEncoderClsid(&pngClsid) < 0) {
        DeleteObject(hBmp);
        DeleteDC(memDC);
        return false;
    }
    IStream* pStream = nullptr;
    HRESULT hrSt = CreateStreamOnHGlobal(nullptr, TRUE, &pStream);
    if (FAILED(hrSt) || !pStream) {
        DeleteObject(hBmp);
        DeleteDC(memDC);
        return false;
    }
    {
        Gdiplus::Bitmap bmp(hBmp, nullptr);
        Gdiplus::Status st = bmp.Save(pStream, &pngClsid, nullptr);
        if (st != Gdiplus::Ok) {
            pStream->Release();
            DeleteObject(hBmp);
            DeleteDC(memDC);
            return false;
        }
    }
    DeleteObject(hBmp);
    DeleteDC(memDC);
    LARGE_INTEGER z{};
    pStream->Seek(z, STREAM_SEEK_SET, nullptr);
    std::vector<uint8_t> pngBytes;
    char readBuf[4096];
    for (;;) {
        ULONG r = 0;
        if (FAILED(pStream->Read(readBuf, sizeof(readBuf), &r)) || r == 0)
            break;
        pngBytes.insert(pngBytes.end(), readBuf, readBuf + r);
    }
    pStream->Release();
    std::string b64;
    if (!BytesToBase64(pngBytes, &b64))
        return false;
    *outDataUrl = "data:image/png;base64," + b64;
    return true;
}

static bool TryHandleCaptureScreenRectMessage(const std::string& u8) {
    cJSON* root = cJSON_Parse(u8.c_str());
    if (!root)
        return false;
    cJSON* obj = root;
    if (cJSON_IsString(root)) {
        cJSON* inner = cJSON_Parse(root->valuestring);
        cJSON_Delete(root);
        obj = inner;
        if (!obj)
            return false;
    }
    cJSON* typ = cJSON_GetObjectItem(obj, "type");
    if (!cJSON_IsString(typ) || _stricmp(typ->valuestring, "captureScreenRect") != 0) {
        cJSON_Delete(obj);
        return false;
    }
    cJSON* jid = cJSON_GetObjectItem(obj, "id");
    cJSON* jl = cJSON_GetObjectItem(obj, "left");
    cJSON* jt = cJSON_GetObjectItem(obj, "top");
    cJSON* jw = cJSON_GetObjectItem(obj, "width");
    cJSON* jh = cJSON_GetObjectItem(obj, "height");
    if (!cJSON_IsNumber(jid) || !cJSON_IsNumber(jl) || !cJSON_IsNumber(jt) || !cJSON_IsNumber(jw) || !cJSON_IsNumber(jh)) {
        cJSON_Delete(obj);
        return false;
    }
    int id = (int)jid->valuedouble;
    double left = jl->valuedouble;
    double top = jt->valuedouble;
    double w = jw->valuedouble;
    double h = jh->valuedouble;
    cJSON_Delete(obj);
    std::string dataUrl;
    if (!g_hwnd || !CaptureClientRectToPngDataUrl(g_hwnd, left, top, w, h, &dataUrl)) {
        dataUrl.clear();
    }
    cJSON* out = cJSON_CreateObject();
    cJSON_AddStringToObject(out, "type", "captureScreenRectResult");
    cJSON_AddNumberToObject(out, "id", id);
    cJSON_AddStringToObject(out, "dataUrl", dataUrl.c_str());
    char* printed = cJSON_PrintUnformatted(out);
    cJSON_Delete(out);
    if (!printed || !g_webview) {
        if (printed)
            free(printed);
        return true;
    }
    std::wstring wjson = Utf8ToWide(std::string(printed));
    free(printed);
    g_webview->PostWebMessageAsString(wjson.c_str());
    return true;
}

static void PostHostWindowMinimizedToWeb(bool minimized) {
    if (!g_webview)
        return;
    if (minimized)
        g_webview->PostWebMessageAsString(L"{\"type\":\"hostWindow\",\"minimized\":true}");
    else
        g_webview->PostWebMessageAsString(L"{\"type\":\"hostWindow\",\"minimized\":false}");
}

/*
  When Stage α=0 (pass-through), the WebView may still hold foreground keyboard focus.
  Move foreground to the next top-level window below us so games/IDEs receive typing.
*/
static void TryYieldForegroundToWindowBehind() {
    if (!g_hwnd)
        return;
    HWND fg = GetForegroundWindow();
    if (!fg)
        return;
    if (fg != g_hwnd && !IsChild(g_hwnd, fg))
        return;

    const DWORD pidSelf = GetCurrentProcessId();
    HWND candidate = nullptr;
    for (HWND w = GetWindow(g_hwnd, GW_HWNDNEXT); w; w = GetWindow(w, GW_HWNDNEXT)) {
        if (!IsWindowVisible(w))
            continue;
        LONG_PTR ex = GetWindowLongPtrW(w, GWL_EXSTYLE);
        if (ex & static_cast<LONG_PTR>(WS_EX_NOACTIVATE))
            continue;
        DWORD pid = 0;
        GetWindowThreadProcessId(w, &pid);
        if (!pid || pid == pidSelf)
            continue;
        candidate = w;
        break;
    }
    if (!candidate)
        return;

    AllowSetForegroundWindow(ASFW_ANY);

    DWORD tidThis = GetCurrentThreadId();
    DWORD tidFgThread = GetWindowThreadProcessId(fg, nullptr);
    BOOL attached = FALSE;
    if (tidFgThread && tidFgThread != tidThis)
        attached = AttachThreadInput(tidFgThread, tidThis, TRUE);

    SetForegroundWindow(candidate);

    if (attached)
        AttachThreadInput(tidFgThread, tidThis, FALSE);
}

/*
  Hit-testing (core model):
  - Outside g_hitRegions: HTTRANSPARENT only while EffectiveStagePassThrough() (α≈0 or Hide); otherwise
    DefWindowProc so α>0 can use WebView “gaps”.
  - Mouse is relayed with SendMouseInput only for interactive points (TryForwardMouseToWebView).

  hitRects use getBoundingClientRect() (DIP). Compare in physical client pixels (MulDiv per edge) so
  WM_NCHITTEST / TryForwardMouseToWebView agree with the OS cursor position.
*/
static void RectNormalize(RECT* r);

static void PhysicalClientToDIP(POINT ptPhys, LONG* outX, LONG* outY) {
    UINT dpi = g_hwnd ? GetDpiForWindow(g_hwnd) : 96u;
    if (dpi == 0)
        dpi = 96u;
    *outX = (LONG)MulDiv((int)ptPhys.x, USER_DEFAULT_SCREEN_DPI, (int)dpi);
    *outY = (LONG)MulDiv((int)ptPhys.y, USER_DEFAULT_SCREEN_DPI, (int)dpi);
}

static POINT DipClientPointToScreen(HWND host, double xDip, double yDip) {
    UINT dpi = host ? GetDpiForWindow(host) : 96u;
    if (dpi == 0)
        dpi = 96u;
    POINT pt{};
    pt.x = (LONG)std::lround(xDip * (double)dpi / (double)USER_DEFAULT_SCREEN_DPI);
    pt.y = (LONG)std::lround(yDip * (double)dpi / (double)USER_DEFAULT_SCREEN_DPI);
    if (host) {
        ClientToScreen(host, &pt);
    }
    return pt;
}

static RECT DipClientRectToScreen(HWND host, double leftDip, double topDip, double rightDip, double bottomDip) {
    POINT a = DipClientPointToScreen(host, leftDip, topDip);
    POINT b = DipClientPointToScreen(host, rightDip, bottomDip);
    RECT out{a.x, a.y, b.x, b.y};
    RectNormalize(&out);
    return out;
}

static bool EffectiveStagePassThrough() {
    return g_contentHidden || g_stageAlpha < 0.001;
}

static void PinHiddenCursorToLockCenter() {
    if (!g_forceHiddenCursor)
        return;
    if (g_cursorLockCenterScreen.x == 0 && g_cursorLockCenterScreen.y == 0)
        return;
    POINT pt{};
    GetCursorPos(&pt);
    if (std::abs(pt.x - g_cursorLockCenterScreen.x) > 1 || std::abs(pt.y - g_cursorLockCenterScreen.y) > 1) {
        SetCursorPos(g_cursorLockCenterScreen.x, g_cursorLockCenterScreen.y);
    }
    SetCursor(HiddenCursor());
}

static bool HandleHiddenCursorRelativeMouse() {
    if (!g_forceHiddenCursor)
        return false;
    if (g_cursorLockCenterScreen.x == 0 && g_cursorLockCenterScreen.y == 0)
        return true;
    POINT pt{};
    if (!GetCursorPos(&pt))
        return true;
    const LONG dx = pt.x - g_cursorLockCenterScreen.x;
    const LONG dy = pt.y - g_cursorLockCenterScreen.y;
    if (dx != 0 || dy != 0) {
        std::ostringstream json;
        json << "{\"type\":\"transparent-overlay.mouse-delta\",\"dx\":" << dx << ",\"dy\":" << dy << "}";
        PostHostJsonMessageToWeb(json.str());
        SetCursorPos(g_cursorLockCenterScreen.x, g_cursorLockCenterScreen.y);
    }
    SetCursor(HiddenCursor());
    return true;
}

static void DipRectToPhysicalClientRect(const RECT& dip, RECT* outPhys) {
    UINT dpi = g_hwnd ? GetDpiForWindow(g_hwnd) : 96u;
    if (dpi == 0)
        dpi = 96u;
    outPhys->left = MulDiv(dip.left, (int)dpi, USER_DEFAULT_SCREEN_DPI);
    outPhys->top = MulDiv(dip.top, (int)dpi, USER_DEFAULT_SCREEN_DPI);
    outPhys->right = MulDiv(dip.right, (int)dpi, USER_DEFAULT_SCREEN_DPI);
    outPhys->bottom = MulDiv(dip.bottom, (int)dpi, USER_DEFAULT_SCREEN_DPI);
}

static bool IsInteractiveHostClientPoint(POINT ptHostPhysical) {
    if (!g_hwnd)
        return true;

    /* Explicit regions from JS (DIP), tested in physical client space — primary path.
       When hitRegions are populated, ONLY those rects are interactive; everything else
       passes through to whatever window is behind the overlay. */
    if (!g_hitRegions.empty()) {
        RECT rcPhys{};
        for (const RECT& rc : g_hitRegions) {
            DipRectToPhysicalClientRect(rc, &rcPhys);
            if (PtInRect(&rcPhys, ptHostPhysical))
                return true;
        }
        return false;
    }

    /* No hitRegions yet (before first postNativeHostLayout): pass through if hidden,
       block if visible (safe default until JS reports its layout). */
    if (EffectiveStagePassThrough())
        return false;
    RECT cr{};
    GetClientRect(g_hwnd, &cr);
    return PtInRect(&cr, ptHostPhysical) == TRUE;
}

/*
  Edge/WebView2 may create child HWNDs that sit above the host client area. Those windows receive
  WM_NCHITTEST before our top-level WndProc — returning HTTRANSPARENT only on the parent then never
  runs for pixels covered by a child, so clicks/hover never reach apps behind the overlay. Subclass
  every descendant HWND and apply the same hit-test policy in client coordinates of the host.
*/
static LRESULT CALLBACK WebViewChildSubclass(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam,
                                             UINT_PTR uIdSubclass, DWORD_PTR dwRefData) {
    HWND parent = reinterpret_cast<HWND>(dwRefData);
    switch (msg) {
    case WM_SETCURSOR:
        if (g_forceHiddenCursor) {
            SetCursor(HiddenCursor());
            return (LRESULT)TRUE;
        }
        break;
    case WM_MOUSEMOVE:
        if (HandleHiddenCursorRelativeMouse()) {
            return 0;
        }
        break;
    case WM_NCHITTEST: {
        if (!parent)
            break;
        POINT pt = {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
        ScreenToClient(parent, &pt);
        if (IsInteractiveHostClientPoint(pt))
            return DefSubclassProc(hwnd, msg, wParam, lParam);
        /* Outside hit regions → always transparent to input, even when visible. */
        return (LRESULT)HTTRANSPARENT;
    }
    case WM_MOUSEACTIVATE: {
        if (!parent)
            break;
        POINT pt{};
        GetCursorPos(&pt);
        ScreenToClient(parent, &pt);
        if (!IsInteractiveHostClientPoint(pt))
            return MA_NOACTIVATE;
        return DefSubclassProc(hwnd, msg, wParam, lParam);
    }
    case WM_NCDESTROY:
        RemoveWindowSubclass(hwnd, WebViewChildSubclass, uIdSubclass);
        break;
    default:
        break;
    }
    return DefSubclassProc(hwnd, msg, wParam, lParam);
}

static void InstallHitTestSubclassOnSubtree(HWND hwnd, HWND parentRef) {
    SetWindowSubclass(hwnd, WebViewChildSubclass, kWebViewHitSubclassId,
                      reinterpret_cast<DWORD_PTR>(parentRef));
    EnumChildWindows(
        hwnd,
        [](HWND ch, LPARAM p) -> BOOL {
            InstallHitTestSubclassOnSubtree(ch, reinterpret_cast<HWND>(p));
            return TRUE;
        },
        reinterpret_cast<LPARAM>(parentRef));
}

static bool WebViewHitTestWindowLooksRelated(HWND hwnd, HWND host) {
    if (GetWindow(hwnd, GW_OWNER) == host)
        return true;
    wchar_t cls[280]{};
    if (GetClassNameW(hwnd, cls, (int)(sizeof(cls) / sizeof(cls[0]))) <= 0)
        return false;
    /* Edge/Chromium internal classes used by WebView2 (names vary by runtime). */
    if (wcsstr(cls, L"Chrome") || wcsstr(cls, L"Intermediate") || wcsstr(cls, L"Widget"))
        return true;
    return false;
}

struct WebViewSubclassThreadEnumCtx {
    HWND host{};
    RECT hostScr{};
};

struct WebViewSubclassAllWindowsCtx {
    DWORD pid{};
    HWND host{};
    RECT hostScr{};
};

static BOOL CALLBACK WebViewSubclassEnumAllTopLevel(HWND hwnd, LPARAM lp) {
    auto* c = reinterpret_cast<WebViewSubclassAllWindowsCtx*>(lp);
    DWORD wpid = 0;
    GetWindowThreadProcessId(hwnd, &wpid);
    if (wpid != c->pid || hwnd == c->host)
        return TRUE;
    if (!IsWindowVisible(hwnd))
        return TRUE;
    if (!WebViewHitTestWindowLooksRelated(hwnd, c->host))
        return TRUE;
    RECT wr{};
    GetWindowRect(hwnd, &wr);
    RECT inter{};
    if (!IntersectRect(&inter, &c->hostScr, &wr))
        return TRUE;
    InstallHitTestSubclassOnSubtree(hwnd, c->host);
    return TRUE;
}

static void InstallWebViewChildSubclassing(HWND host) {
    if (!host)
        return;
    /* Descendants of the host (parent chain). */
    EnumChildWindows(
        host,
        [](HWND ch, LPARAM p) -> BOOL {
            InstallHitTestSubclassOnSubtree(ch, reinterpret_cast<HWND>(p));
            return TRUE;
        },
        reinterpret_cast<LPARAM>(host));
    /*
      Owned popups are NOT enumerated by EnumChildWindows; they still receive hit-testing above the
      desktop apps we want to reach. Subclass any same-thread window owned by `host`, plus Chromium-
      class HWNDs in our thread that overlap the host (covers odd embedding modes).
    */
    WebViewSubclassThreadEnumCtx ctx{};
    ctx.host = host;
    GetClientRect(host, &ctx.hostScr);
    MapWindowPoints(host, nullptr, reinterpret_cast<LPPOINT>(&ctx.hostScr), 2);

    EnumThreadWindows(
        GetWindowThreadProcessId(host, nullptr),
        [](HWND hwnd, LPARAM p) -> BOOL {
            auto* c = reinterpret_cast<WebViewSubclassThreadEnumCtx*>(p);
            const HWND hHost = c->host;
            if (hwnd == hHost)
                return TRUE;
            if (!IsWindowVisible(hwnd))
                return TRUE;
            if (!WebViewHitTestWindowLooksRelated(hwnd, hHost))
                return TRUE;
            RECT wr{};
            GetWindowRect(hwnd, &wr);
            RECT inter{};
            if (!IntersectRect(&inter, &c->hostScr, &wr))
                return TRUE;
            InstallHitTestSubclassOnSubtree(hwnd, hHost);
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&ctx));
    /*
      Chromium may create HWNDs on worker threads; those never appear in EnumThreadWindows(hostTid).
      Catch same-process top-level windows that overlap our client (Chrome class / owner relationship).
    */
    WebViewSubclassAllWindowsCtx all{};
    all.pid = GetCurrentProcessId();
    all.host = host;
    all.hostScr = ctx.hostScr;
    EnumWindows(WebViewSubclassEnumAllTopLevel, reinterpret_cast<LPARAM>(&all));
    SyncPassThroughInputShape(host);
}

static void RectNormalize(RECT* r) {
    if (!r)
        return;
    if (r->left > r->right) {
        LONG t = r->left;
        r->left = r->right;
        r->right = t;
    }
    if (r->top > r->bottom) {
        LONG t = r->top;
        r->top = r->bottom;
        r->bottom = t;
    }
}

static RECT ClientRectMappedToHostClient(HWND child, HWND host) {
    RECT rc{};
    GetClientRect(child, &rc);
    MapWindowPoints(child, host, reinterpret_cast<LPPOINT>(&rc), 2);
    RectNormalize(&rc);
    return rc;
}

static void SetWindowRgnOrDelete(HWND w, HRGN rgn) {
    if (!w)
        return;
    if (!SetWindowRgn(w, rgn, TRUE)) {
        if (rgn)
            DeleteObject(rgn);
    }
}

/*
  WebView2's Chromium HWND often returns HTCLIENT for the full bounds, so WM_NCHITTEST/HTTRANSPARENT on
  the host alone may not pass input to windows behind. SetWindowRgn restricts which pixels belong to each
  HWND for hit-testing (see WebView2Feedback #446 — CompositionController still may use helper HWNDs).
*/
static HRGN BuildHostPassThroughRegion(HWND host) {
    if (g_hitRegions.empty())
        return CreateRectRgn(0, 0, 0, 0);
    RECT client{};
    GetClientRect(host, &client);
    HRGN acc = nullptr;
    for (const RECT& dip : g_hitRegions) {
        RECT phys{};
        DipRectToPhysicalClientRect(dip, &phys);
        RECT clipped{};
        if (!IntersectRect(&clipped, &phys, &client))
            continue;
        RectNormalize(&clipped);
        if (clipped.right <= clipped.left || clipped.bottom <= clipped.top)
            continue;
        HRGN piece = CreateRectRgnIndirect(&clipped);
        if (!piece)
            continue;
        if (!acc) {
            acc = piece;
            continue;
        }
        HRGN comb = CreateRectRgn(0, 0, 0, 0);
        const int kr = CombineRgn(comb, acc, piece, RGN_OR);
        DeleteObject(acc);
        DeleteObject(piece);
        if (kr == 0) {
            DeleteObject(comb);
            return CreateRectRgn(0, 0, 0, 0);
        }
        acc = comb;
    }
    if (!acc)
        return CreateRectRgn(0, 0, 0, 0);
    return acc;
}

static HRGN BuildChildPassThroughRegion(HWND host, HWND child) {
    if (g_hitRegions.empty())
        return CreateRectRgn(0, 0, 0, 0);
    RECT childInHost = ClientRectMappedToHostClient(child, host);
    HRGN acc = nullptr;
    for (const RECT& dip : g_hitRegions) {
        RECT phys{};
        DipRectToPhysicalClientRect(dip, &phys);
        RECT clipped{};
        if (!IntersectRect(&clipped, &phys, &childInHost))
            continue;
        RectNormalize(&clipped);
        if (clipped.right <= clipped.left || clipped.bottom <= clipped.top)
            continue;
        RECT inChild = clipped;
        OffsetRect(&inChild, -childInHost.left, -childInHost.top);
        HRGN piece = CreateRectRgnIndirect(&inChild);
        if (!piece)
            continue;
        if (!acc) {
            acc = piece;
            continue;
        }
        HRGN comb = CreateRectRgn(0, 0, 0, 0);
        const int kr = CombineRgn(comb, acc, piece, RGN_OR);
        DeleteObject(acc);
        DeleteObject(piece);
        if (kr == 0) {
            DeleteObject(comb);
            return CreateRectRgn(0, 0, 0, 0);
        }
        acc = comb;
    }
    if (!acc)
        return CreateRectRgn(0, 0, 0, 0);
    return acc;
}

static void ClearPassThroughShapeSubtree(HWND w) {
    if (!w)
        return;
    SetWindowRgn(w, nullptr, TRUE);
    EnumChildWindows(
        w,
        [](HWND ch, LPARAM) -> BOOL {
            ClearPassThroughShapeSubtree(ch);
            return TRUE;
        },
        0);
}

static void ApplyPassThroughShapeToSubtree(HWND w, HWND host) {
    if (!w)
        return;
    HRGN r = BuildChildPassThroughRegion(host, w);
    SetWindowRgnOrDelete(w, r);
    EnumChildWindows(
        w,
        [](HWND ch, LPARAM p) -> BOOL {
            ApplyPassThroughShapeToSubtree(ch, *reinterpret_cast<HWND*>(p));
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&host));
}

static void SyncPassThroughInputShape(HWND host) {
    if (!host)
        return;
    if (g_frameDragActive) {
        /*
          During in-WebView frame drag, DOM position changes synchronously with pointer events while
          HWND regions are applied asynchronously by the OS. If the region is used as a visual mask
          mid-drag, the frame can be clipped by the previous rect. Keep hit-testing policy in the
          subclass path during drag and restore the exact region from the final layout on pointerup.
        */
        SetWindowRgn(host, nullptr, TRUE);
        EnumChildWindows(
            host,
            [](HWND ch, LPARAM) -> BOOL {
                ClearPassThroughShapeSubtree(ch);
                return TRUE;
            },
            0);
        return;
    }
    if (!EffectiveStagePassThrough()) {
        SetWindowRgn(host, nullptr, TRUE);
        EnumChildWindows(
            host,
            [](HWND ch, LPARAM) -> BOOL {
                ClearPassThroughShapeSubtree(ch);
                return TRUE;
            },
            0);
        WebViewSubclassThreadEnumCtx ctx{};
        ctx.host = host;
        GetClientRect(host, &ctx.hostScr);
        MapWindowPoints(host, nullptr, reinterpret_cast<LPPOINT>(&ctx.hostScr), 2);
        EnumThreadWindows(
            GetWindowThreadProcessId(host, nullptr),
            [](HWND hwnd, LPARAM p) -> BOOL {
                auto* c = reinterpret_cast<WebViewSubclassThreadEnumCtx*>(p);
                const HWND hHost = c->host;
                if (hwnd == hHost)
                    return TRUE;
                if (!IsWindowVisible(hwnd))
                    return TRUE;
                if (!WebViewHitTestWindowLooksRelated(hwnd, hHost))
                    return TRUE;
                RECT wr{};
                GetWindowRect(hwnd, &wr);
                RECT inter{};
                if (!IntersectRect(&inter, &c->hostScr, &wr))
                    return TRUE;
                ClearPassThroughShapeSubtree(hwnd);
                return TRUE;
            },
            reinterpret_cast<LPARAM>(&ctx));
        WebViewSubclassAllWindowsCtx all{};
        all.pid = GetCurrentProcessId();
        all.host = host;
        all.hostScr = ctx.hostScr;
        EnumWindows(
            [](HWND hwnd, LPARAM lp) -> BOOL {
                auto* c = reinterpret_cast<WebViewSubclassAllWindowsCtx*>(lp);
                DWORD wpid = 0;
                GetWindowThreadProcessId(hwnd, &wpid);
                if (wpid != c->pid || hwnd == c->host)
                    return TRUE;
                if (!IsWindowVisible(hwnd))
                    return TRUE;
                if (!WebViewHitTestWindowLooksRelated(hwnd, c->host))
                    return TRUE;
                RECT wr{};
                GetWindowRect(hwnd, &wr);
                RECT inter{};
                if (!IntersectRect(&inter, &c->hostScr, &wr))
                    return TRUE;
                ClearPassThroughShapeSubtree(hwnd);
                return TRUE;
            },
            reinterpret_cast<LPARAM>(&all));
        return;
    }
    HRGN hr = BuildHostPassThroughRegion(host);
    SetWindowRgnOrDelete(host, hr);
    EnumChildWindows(
        host,
        [](HWND ch, LPARAM p) -> BOOL {
            ApplyPassThroughShapeToSubtree(ch, *reinterpret_cast<HWND*>(p));
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&host));
    WebViewSubclassThreadEnumCtx ctx2{};
    ctx2.host = host;
    GetClientRect(host, &ctx2.hostScr);
    MapWindowPoints(host, nullptr, reinterpret_cast<LPPOINT>(&ctx2.hostScr), 2);
    EnumThreadWindows(
        GetWindowThreadProcessId(host, nullptr),
        [](HWND hwnd, LPARAM p) -> BOOL {
            auto* c = reinterpret_cast<WebViewSubclassThreadEnumCtx*>(p);
            const HWND hHost = c->host;
            if (hwnd == hHost)
                return TRUE;
            if (!IsWindowVisible(hwnd))
                return TRUE;
            if (!WebViewHitTestWindowLooksRelated(hwnd, hHost))
                return TRUE;
            RECT wr{};
            GetWindowRect(hwnd, &wr);
            RECT inter{};
            if (!IntersectRect(&inter, &c->hostScr, &wr))
                return TRUE;
            ApplyPassThroughShapeToSubtree(hwnd, hHost);
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&ctx2));
    WebViewSubclassAllWindowsCtx all2{};
    all2.pid = GetCurrentProcessId();
    all2.host = host;
    all2.hostScr = ctx2.hostScr;
    EnumWindows(
        [](HWND hwnd, LPARAM lp) -> BOOL {
            auto* c = reinterpret_cast<WebViewSubclassAllWindowsCtx*>(lp);
            DWORD wpid = 0;
            GetWindowThreadProcessId(hwnd, &wpid);
            if (wpid != c->pid || hwnd == c->host)
                return TRUE;
            if (!IsWindowVisible(hwnd))
                return TRUE;
            if (!WebViewHitTestWindowLooksRelated(hwnd, c->host))
                return TRUE;
            RECT wr{};
            GetWindowRect(hwnd, &wr);
            RECT inter{};
            if (!IntersectRect(&inter, &c->hostScr, &wr))
                return TRUE;
            ApplyPassThroughShapeToSubtree(hwnd, c->host);
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&all2));
}

static HRESULT InitDComposition(HWND hwnd) {
    const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1};
    D3D_FEATURE_LEVEL fl = D3D_FEATURE_LEVEL_11_0;
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                                   levels, (UINT)(sizeof(levels) / sizeof(levels[0])), D3D11_SDK_VERSION,
                                   &g_d3dDevice, &fl, nullptr);
    if (FAILED(hr))
        return hr;
    ComPtr<IDXGIDevice> dxgi;
    hr = g_d3dDevice.As(&dxgi);
    if (FAILED(hr))
        return hr;
    hr = DCompositionCreateDevice(dxgi.Get(), __uuidof(IDCompositionDevice),
                                  reinterpret_cast<void**>(g_dcompDevice.GetAddressOf()));
    if (FAILED(hr))
        return hr;
    hr = g_dcompDevice->CreateTargetForHwnd(hwnd, TRUE, &g_dcompTarget);
    if (FAILED(hr))
        return hr;
    hr = g_dcompDevice->CreateVisual(&g_dcompRootVisual);
    if (FAILED(hr))
        return hr;
    hr = g_dcompTarget->SetRoot(g_dcompRootVisual.Get());
    if (FAILED(hr))
        return hr;
    hr = g_dcompDevice->CreateVisual(&g_dcompWebVisual);
    if (FAILED(hr))
        return hr;
    hr = g_dcompRootVisual->AddVisual(g_dcompWebVisual.Get(), TRUE, nullptr);
    if (FAILED(hr))
        return hr;
    return g_dcompDevice->Commit();
}

static bool IsWebViewMouseMessage(UINT msg) {
    switch (msg) {
    case WM_MOUSEMOVE:
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
    case WM_LBUTTONDBLCLK:
    case WM_RBUTTONDOWN:
    case WM_RBUTTONUP:
    case WM_RBUTTONDBLCLK:
    case WM_MBUTTONDOWN:
    case WM_MBUTTONUP:
    case WM_MBUTTONDBLCLK:
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL:
    case WM_XBUTTONDOWN:
    case WM_XBUTTONUP:
    case WM_XBUTTONDBLCLK:
    case WM_MOUSELEAVE:
        return true;
    default:
        return false;
    }
}

static bool TryForwardMouseToWebView(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (!g_compController || !g_hwnd)
        return false;

    POINT point{};
    if (msg == WM_MOUSELEAVE) {
        point = {0, 0};
    } else if (msg == WM_MOUSEWHEEL || msg == WM_MOUSEHWHEEL) {
        point.x = GET_X_LPARAM(lp);
        point.y = GET_Y_LPARAM(lp);
        ScreenToClient(hwnd, &point);
    } else {
        point.x = GET_X_LPARAM(lp);
        point.y = GET_Y_LPARAM(lp);
    }

    /*
      Critical: g_webviewBounds is the full client — do NOT use "point in bounds" as "should forward".
      That would forward every message over pass-through (HTTRANSPARENT) regions and block the OS from
      delivering input to apps behind the overlay. Only forward when the point is in a JS hit region,
      or during capture after a mousedown in an interactive region (drag outside bounds).
    */
    const bool inInteractive = (msg != WM_MOUSELEAVE) && IsInteractiveHostClientPoint(point);
    if (msg != WM_MOUSELEAVE && !inInteractive && !g_captureMouse) {
        if (msg == WM_MOUSEMOVE && g_trackMouseLeave) {
            g_trackMouseLeave = false;
            TRACKMOUSEEVENT tme = {sizeof(tme), TME_LEAVE | TME_CANCEL, hwnd, 0};
            TrackMouseEvent(&tme);
            return SUCCEEDED(g_compController->SendMouseInput(
                static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(WM_MOUSELEAVE),
                static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(0), 0, {0, 0}));
        }
        return false;
    }

    RECT wr = g_webviewBounds;
    bool inWeb = PtInRect(&wr, point);

    UINT32 mouseData = 0;
    switch (msg) {
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL:
        mouseData = (UINT32)(SHORT)GET_WHEEL_DELTA_WPARAM(wp);
        break;
    case WM_XBUTTONDBLCLK:
    case WM_XBUTTONDOWN:
    case WM_XBUTTONUP:
        mouseData = (UINT32)GET_XBUTTON_WPARAM(wp);
        break;
    default:
        break;
    }

    if (msg == WM_MOUSEMOVE) {
        if (!g_trackMouseLeave) {
            TRACKMOUSEEVENT tme = {sizeof(tme), TME_LEAVE, hwnd, 0};
            TrackMouseEvent(&tme);
            g_trackMouseLeave = true;
        }
    } else if (msg == WM_MOUSELEAVE) {
        g_trackMouseLeave = false;
    }

    if (msg == WM_LBUTTONDOWN || msg == WM_MBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_XBUTTONDOWN) {
        if (inInteractive && inWeb && GetCapture() != hwnd) {
            g_captureMouse = true;
            SetCapture(hwnd);
        }
    } else if (msg == WM_LBUTTONUP || msg == WM_MBUTTONUP || msg == WM_RBUTTONUP || msg == WM_XBUTTONUP) {
        if (GetCapture() == hwnd) {
            g_captureMouse = false;
            ReleaseCapture();
        }
    }

    if (msg != WM_MOUSELEAVE) {
        point.x -= wr.left;
        point.y -= wr.top;
    }

    return SUCCEEDED(g_compController->SendMouseInput(
        static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(msg),
        static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(GET_KEYSTATE_WPARAM(wp)), mouseData, point));
}

HRESULT ExecuteScriptUtf8(const std::string& jsUtf8) {
    if (!g_webview)
        return E_FAIL;
    std::wstring w = Utf8ToWide(jsUtf8);
    return g_webview->ExecuteScript(w.c_str(), nullptr);
}

void ApplyPushBody(const std::string& body) {
    if (!g_webview || body.empty())
        return;
    cJSON* root = cJSON_Parse(body.c_str());
    if (!root)
        return;
    cJSON* opj = cJSON_GetObjectItem(root, "op");
    const char* op = cJSON_IsString(opj) ? opj->valuestring : "";

    auto run = [&](const char* scriptFmt, const std::string& argEscaped) {
        char buf[65536];
        snprintf(buf, sizeof(buf), scriptFmt, argEscaped.c_str());
        ExecuteScriptUtf8(buf);
    };

    if (_stricmp(op, "clear") == 0) {
        ExecuteScriptUtf8("window.__agent && window.__agent.clear();");
    } else if (_stricmp(op, "html") == 0) {
        cJSON* h = cJSON_GetObjectItem(root, "html");
        std::string html = cJSON_IsString(h) ? h->valuestring : "";
        if (html.empty()) {
            cJSON_Delete(root);
            return;
        }
        std::string esc = JsonEscapeForJsUtf8(html);
        run("window.__agent && window.__agent.setHtml(\"%s\");", esc);
    } else if (_stricmp(op, "append_html") == 0) {
        cJSON* h = cJSON_GetObjectItem(root, "html");
        std::string html = cJSON_IsString(h) ? h->valuestring : "";
        if (html.empty()) {
            cJSON_Delete(root);
            return;
        }
        std::string esc = JsonEscapeForJsUtf8(html);
        run("window.__agent && window.__agent.appendHtml(\"%s\");", esc);
    } else if (_stricmp(op, "append_text") == 0) {
        cJSON* t = cJSON_GetObjectItem(root, "text");
        std::string text = cJSON_IsString(t) ? t->valuestring : "";
        std::string esc = JsonEscapeForJsUtf8(text);
        run("window.__agent && window.__agent.appendText(\"%s\");", esc);
    } else if (_stricmp(op, "navigate") == 0) {
        cJSON* u = cJSON_GetObjectItem(root, "url");
        std::string url = cJSON_IsString(u) ? u->valuestring : "";
        if (!url.empty()) {
            std::wstring wideUrl = Utf8ToWide(url);
            HRESULT navHr = g_webview->Navigate(wideUrl.c_str());
            VfTraceLogA("ApplyPushBody: navigate %s hr=0x%08X", url.c_str(), (unsigned int)navHr);
            if (FAILED(navHr)) {
                VfUserLogfA("error", "ApplyPushBody: navigate failed hr=0x%08X", (unsigned int)navHr);
            }
        }
    } else if (_stricmp(op, "response_layers") == 0) {
        cJSON* layers = cJSON_GetObjectItem(root, "layers");
        if (!layers) {
            cJSON_Delete(root);
            return;
        }
        char* printed = cJSON_PrintUnformatted(layers);
        if (!printed) {
            cJSON_Delete(root);
            return;
        }
        std::string esc = JsonEscapeForJsUtf8(std::string(printed));
        free(printed);
        std::string js = "window.__agent && window.__agent.setResponseLayers(JSON.parse(\"";
        js += esc;
        js += "\"));";
        ExecuteScriptUtf8(js);
    } else {
        std::string esc = JsonEscapeForJsUtf8(body);
        char buf[131072];
        snprintf(buf, sizeof(buf), "window.__agent && window.__agent.notify(\"%s\");", esc.c_str());
        ExecuteScriptUtf8(buf);
    }
    cJSON_Delete(root);
}

void ResizeWebView() {
    if (!g_controller || !g_hwnd)
        return;
    RECT r{};
    GetClientRect(g_hwnd, &r);
    g_webviewBounds = r;
    g_controller->put_Bounds(r);
    if (g_dcompDevice)
        g_dcompDevice->Commit();
    PostMessageW(g_hwnd, WM_APP_SUBCLASS_WEBVIEW_CHILDREN, 0, 0);
    SyncPassThroughInputShape(g_hwnd);
}

void HttpSendAll(SOCKET s, const char* data, size_t len) {
    size_t off = 0;
    while (off < len) {
        int r = send(s, data + off, (int)(len - off), 0);
        if (r <= 0)
            break;
        off += (size_t)r;
    }
}

void HttpRespondJson(SOCKET s, int status, const char* statusText, const std::string& json) {
    char hdr[512];
    snprintf(hdr, sizeof(hdr),
        "HTTP/1.1 %d %s\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: %zu\r\n"
        "Connection: close\r\n"
        "\r\n",
        status, statusText, json.size());
    HttpSendAll(s, hdr, strlen(hdr));
    HttpSendAll(s, json.data(), json.size());
}

void HttpRespondEmpty(SOCKET s, int status) {
    char hdr[256];
    snprintf(hdr, sizeof(hdr),
        "HTTP/1.1 %d No Content\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Content-Length: 0\r\n"
        "Connection: close\r\n"
        "\r\n",
        status);
    HttpSendAll(s, hdr, strlen(hdr));
}

void HttpThreadMain() {
    WSADATA wsa{};
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        ViewerDiagLogPrintf("HTTP listener failed: WSAStartup");
        HttpSignalReady(false);
        return;
    }

    const int preferredPort = g_port > 0 ? g_port : 58461;
    int bindAttempts[2] = {preferredPort, 0};
    bool bound = false;
    for (int attempt = 0; attempt < 2 && !bound; ++attempt) {
        g_port = bindAttempts[attempt];
        g_listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (g_listenSock == INVALID_SOCKET) {
            ViewerDiagLogPrintf("HTTP listener failed: socket()");
            WSACleanup();
            HttpSignalReady(false);
            return;
        }

        BOOL opt = TRUE;
        setsockopt(g_listenSock, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons((u_short)g_port);
        inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

        if (bind(g_listenSock, (sockaddr*)&addr, sizeof(addr)) == 0) {
            bound = true;
            break;
        }
        ViewerDiagLogPrintf("HTTP listener bind failed on 127.0.0.1:%d; trying fallback", g_port);
        closesocket(g_listenSock);
        g_listenSock = INVALID_SOCKET;
    }
    if (!bound) {
        ViewerDiagLogPrintf("HTTP listener failed: bind fallback");
        WSACleanup();
        HttpSignalReady(false);
        return;
    }
    {
        sockaddr_in bound{};
        int blen = sizeof(bound);
        if (getsockname(g_listenSock, reinterpret_cast<sockaddr*>(&bound), &blen) == 0)
            g_port = ntohs(bound.sin_port);
    }
    if (listen(g_listenSock, 8) != 0) {
        ViewerDiagLogPrintf("HTTP listener failed: listen(127.0.0.1:%d)", g_port);
        closesocket(g_listenSock);
        g_listenSock = INVALID_SOCKET;
        WSACleanup();
        HttpSignalReady(false);
        return;
    }

    HttpSignalReady(true);
    ViewerDiagLogPrintf(
        "HTTP listener ready on http://127.0.0.1:%d/ (enqueue /api/enqueue, pop /api/pop, runtime /api/runtime-packets, input /api/runtime-packets/input)",
        g_port);

    while (!g_httpStop.load()) {
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(g_listenSock, &fds);
        timeval tv{0, 200000};
        SOCKET ls = g_listenSock;
        if (ls == INVALID_SOCKET)
            break;
        int sel = select(0, &fds, nullptr, nullptr, &tv);
        if (sel <= 0)
            continue;
        SOCKET c = accept(g_listenSock, nullptr, nullptr);
        if (c == INVALID_SOCKET)
            continue;

        char buf[65536];
        int total = 0;
        while (total < (int)sizeof(buf) - 1) {
            int r = recv(c, buf + total, (int)sizeof(buf) - 1 - total, 0);
            if (r <= 0)
                break;
            total += r;
            buf[total] = 0;
            if (strstr(buf, "\r\n\r\n"))
                break;
        }

        char method[16] = {};
        char path[256] = {};
        sscanf_s(buf, "%15s %255s", method, (unsigned)sizeof(method), path, (unsigned)sizeof(path));
        if (kHotPathDiagEnabled)
            g_diagHttpRequests.fetch_add(1);
        std::string rawPath = path;
        {
            char* qq = strchr(path, '?');
            if (qq)
                *qq = 0;
        }
        if (kHotPathDiagEnabled)
            vf::SetCrashBreadcrumb("http.request", std::string(method) + " " + path);

        char* bodyStart = strstr(buf, "\r\n\r\n");
        std::string body;
        if (bodyStart) {
            bodyStart += 4;
            body.assign(bodyStart, buf + total - bodyStart);
        }

        int clen = 0;
        for (char* p = buf; *p; ++p) {
            if (_strnicmp(p, "Content-Length:", 15) == 0) {
                clen = atoi(p + 15);
                break;
            }
        }
        if (clen > 0 && (int)body.size() < clen) {
            std::string rest;
            rest.resize(clen - body.size());
            int need = (int)rest.size();
            int got = 0;
            while (got < need) {
                int r = recv(c, rest.data() + got, need - got, 0);
                if (r <= 0)
                    break;
                got += r;
            }
            body += rest;
        }

        if (_stricmp(method, "OPTIONS") == 0) {
            HttpRespondEmpty(c, 204);
            closesocket(c);
            continue;
        }

        if (_stricmp(method, "GET") == 0 && g_webRootW.size() > 0) {
            std::string pathStr(path);
            // Do not serve /api/* from the web root — those routes are handled below. Otherwise GET /api/pop
            // looks for a file "api/pop", returns 404, and the host never drains the overlay queue.
            const bool isApiPath = pathStr.size() >= 5 && _strnicmp(pathStr.c_str(), "/api/", 5) == 0;
            if (!isApiPath && !pathStr.empty() && pathStr[0] == '/') {
                std::string rel;
                if (pathStr == "/" || _stricmp(pathStr.c_str(), "/index.html") == 0)
                    rel = "index.html";
                else
                    rel = pathStr.substr(1);
                if (rel.empty())
                    rel = "index.html";
                if (rel.find("..") != std::string::npos || rel.find('\\') != std::string::npos) {
                    HttpRespondStatic(c, 400, "Bad Request", "text/plain; charset=utf-8", "invalid path");
                    closesocket(c);
                    continue;
                }
                for (char& ch : rel) {
                    if (ch == '/')
                        ch = '\\';
                }
                std::wstring relW;
                {
                    int n = MultiByteToWideChar(CP_UTF8, 0, rel.c_str(), -1, nullptr, 0);
                    if (n <= 0) {
                        HttpRespondStatic(c, 400, "Bad Request", "text/plain; charset=utf-8", "invalid path");
                        closesocket(c);
                        continue;
                    }
                    relW.resize(static_cast<size_t>(n), 0);
                    MultiByteToWideChar(CP_UTF8, 0, rel.c_str(), -1, relW.data(), n);
                    relW.pop_back();
                }
                std::wstring fpath = g_webRootW + L"\\" + relW;
                std::string body = ReadFileBinary(fpath);
                if (!body.empty()) {
                    const char* ct = ContentTypeForWebPath(fpath);
                    HttpRespondStatic(c, 200, "OK", ct, body, StaticCacheControlForRelativePath(rel));
                } else {
                    HttpRespondStatic(c, 404, "Not Found", "text/plain; charset=utf-8", "not found");
                }
                closesocket(c);
                continue;
            }
        }

        if (_stricmp(method, "GET") == 0 && strcmp(path, "/api/health") == 0) {
            char j[128];
            snprintf(j, sizeof(j), "{\"ok\":true,\"port\":%d}", g_port);
            HttpRespondJson(c, 200, "OK", j);
            closesocket(c);
            continue;
        }

        if (_stricmp(method, "GET") == 0 && strcmp(path, "/api/layout") == 0) {
            std::string body = "{}";
            {
                std::lock_guard<std::mutex> lock(g_lastLayoutSnapshotMutex);
                if (!g_lastLayoutSnapshotUtf8.empty())
                    body = g_lastLayoutSnapshotUtf8;
            }
            HttpRespondJson(c, 200, "OK", body);
            closesocket(c);
            continue;
        }

        if (_stricmp(method, "GET") == 0 && strcmp(path, "/api/diag/stats") == 0) {
            HttpRespondJson(c, 200, "OK", BuildDiagStatsJson());
            closesocket(c);
            continue;
        }

        if (_stricmp(method, "POST") == 0 && strcmp(path, "/api/ui-ready") == 0) {
            g_uiInputReady.store(true);
            HttpRespondJson(c, 200, "OK", "{\"ok\":true,\"input_ready\":true}");
            closesocket(c);
            continue;
        }

        if (g_overlayPacketRuntime.TryServeSocketHttpRequest(method, path, body, g_webRootW, c)) {
            continue;
        }

        if (_stricmp(method, "GET") == 0 && strcmp(path, "/api/pop") == 0) {
            std::string lineJson = "{\"line\":null}";
            {
                std::lock_guard<std::mutex> lock(g_queueMutex);
                if (!g_userQueue.empty()) {
                    std::string line = g_userQueue.front();
                    g_userQueue.pop_front();
                    if (kHotPathDiagEnabled)
                        g_diagQueuePops.fetch_add(1);
                    cJSON* o = cJSON_CreateObject();
                    cJSON_AddStringToObject(o, "line", line.c_str());
                    char* p = cJSON_PrintUnformatted(o);
                    if (p) {
                        lineJson = p;
                        cJSON_free(p);
                    }
                    cJSON_Delete(o);
                }
                if (kHotPathDiagEnabled)
                    vf::SetCrashBreadcrumb("queue.size", std::to_string(g_userQueue.size()));
            }
            HttpRespondJson(c, 200, "OK", lineJson);
            closesocket(c);
            continue;
        }

        if (_stricmp(method, "POST") == 0 && strcmp(path, "/api/diag/stress-hover") == 0) {
            int count = ParseQueryInt(rawPath.c_str(), "count", 500);
            int x = ParseQueryInt(rawPath.c_str(), "x", 400);
            int y = ParseQueryInt(rawPath.c_str(), "y", 300);
            std::string frameId = ParseQueryString(rawPath.c_str(), "frame_id", "axis_panel_2d_crosshair");
            if (count < 1)
                count = 1;
            if (count > 20000)
                count = 20000;
            for (int i = 0; i < count; ++i) {
                char line[768];
                _snprintf_s(
                    line, _TRUNCATE,
                    "{\"type\":\"vf_event\",\"event\":\"hover\",\"x\":%d,\"y\":%d,\"frame_id\":\"%s\",\"object_id\":0,\"simplex_id\":0,\"pick_id\":0,\"pick_mask_representation\":0,\"pick_mask_carrier\":0,\"pick_mask_content\":0,\"pick_mask_exact\":0,\"ctrl\":false,\"shift\":false,\"alt\":false,\"meta\":false,\"buttons\":0}",
                    x + (i % 7), y + (i % 5), frameId.c_str());
                EnqueueUserEventLine(line);
            }
            cJSON* root = cJSON_CreateObject();
            cJSON_AddBoolToObject(root, "ok", 1);
            cJSON_AddNumberToObject(root, "count", count);
            char* printed = cJSON_PrintUnformatted(root);
            std::string out = printed ? printed : "{\"ok\":true}";
            if (printed)
                cJSON_free(printed);
            cJSON_Delete(root);
            HttpRespondJson(c, 200, "OK", out);
            closesocket(c);
            continue;
        }

        if (_stricmp(method, "POST") == 0 && strcmp(path, "/api/push") == 0) {
            std::string* copy = new std::string(body);
            PostMessageW(g_hwnd, WM_APP_PUSH, 0, (LPARAM)copy);
            HttpRespondJson(c, 200, "OK", "{\"ok\":true}");
            closesocket(c);
            continue;
        }

        if (_stricmp(method, "POST") == 0 && strcmp(path, "/api/enqueue") == 0) {
            std::string loggedLine;
            if (kHotPathDiagEnabled)
                vf::SetCrashBreadcrumb("http.enqueue.body", CrashBreadcrumbSummary(body, 200));
            cJSON* root = cJSON_Parse(body.c_str());
            if (root) {
                cJSON* line = cJSON_GetObjectItem(root, "line");
                if (cJSON_IsString(line) && line->valuestring) {
                    loggedLine = line->valuestring;
                    if (g_uiInputReady.load()) {
                        EnqueueUserEventLine(line->valuestring);
                    }
                } else {
                    loggedLine = "[enqueue] JSON missing string \"line\"";
                    if (body.size() > 200)
                        loggedLine += " body=" + body.substr(0, 200) + "...";
                    else if (!body.empty())
                        loggedLine += " body=" + body;
                }
                cJSON_Delete(root);
            } else if (!body.empty()) {
                loggedLine = body.size() > 1500 ? body.substr(0, 1500) + "..." : body;
                if (g_uiInputReady.load()) {
                    EnqueueUserEventLine(body);
                }
            } else {
                loggedLine = "[enqueue] empty body";
            }
            if (!loggedLine.empty())
                ViewerEnqueueDiagLog(loggedLine);
            HttpRespondJson(c, 200, "OK", "{\"ok\":true}");
            closesocket(c);
            continue;
        }

        HttpRespondJson(c, 404, "Not Found", "{\"error\":\"not found\"}");
        closesocket(c);
    }

    ViewerDiagLogPrintf("HTTP listener stopped");
    if (g_listenSock != INVALID_SOCKET) {
        closesocket(g_listenSock);
        g_listenSock = INVALID_SOCKET;
    }
    WSACleanup();
}

static void ReplaceWebViewCursorCache(HCURSOR cursor, bool owned) {
    if (g_webviewCursorCachedOwned && g_webviewCursorCached)
        DestroyCursor(g_webviewCursorCached);
    g_webviewCursorCached = cursor;
    g_webviewCursorCachedOwned = owned;
}

static HCURSOR HiddenCursor() {
    if (g_hiddenCursor)
        return g_hiddenCursor;
    BYTE andMask[1] = {0xFF};
    BYTE xorMask[1] = {0x00};
    g_hiddenCursor = CreateCursor(GetModuleHandleW(nullptr), 0, 0, 1, 1, andMask, xorMask);
    return g_hiddenCursor ? g_hiddenCursor : LoadCursor(nullptr, IDC_ARROW);
}

static void ApplyOverlayCursor() {
    SetCursor(g_forceHiddenCursor ? HiddenCursor() : (g_webviewCursorCached ? g_webviewCursorCached : LoadCursor(nullptr, IDC_ARROW)));
}

static HRESULT OnCompositionCursorChanged(ICoreWebView2CompositionController* sender) {
    if (!sender)
        return E_POINTER;
    if (g_forceHiddenCursor) {
        SetCursor(HiddenCursor());
        return S_OK;
    }

    HCURSOR cur = nullptr;
    if (SUCCEEDED(sender->get_Cursor(&cur)) && cur != nullptr) {
        HCURSOR copy = CopyCursor(cur);
        if (copy) {
            ReplaceWebViewCursorCache(copy, true);
            SetCursor(copy);
            return S_OK;
        }
    }

    UINT32 sysId = 0;
    if (SUCCEEDED(sender->get_SystemCursorId(&sysId)) && sysId != 0) {
        HCURSOR loaded = LoadCursorW(nullptr, MAKEINTRESOURCEW(sysId));
        if (loaded) {
            ReplaceWebViewCursorCache(loaded, false);
            SetCursor(loaded);
            return S_OK;
        }
    }

    ReplaceWebViewCursorCache(nullptr, false);
    SetCursor(LoadCursor(nullptr, IDC_ARROW));
    return S_OK;
}

LRESULT CALLBACK WndProc(HWND h, UINT msg, WPARAM w, LPARAM l) {
    switch (msg) {
    case WM_NCHITTEST: {
        POINT pt = {GET_X_LPARAM(l), GET_Y_LPARAM(l)};
        ScreenToClient(h, &pt);
        if (IsInteractiveHostClientPoint(pt))
            return DefWindowProcW(h, msg, w, l);
        /* Outside hit regions → always transparent to input, even when visible. */
        return (LRESULT)HTTRANSPARENT;
    }
    case WM_MOUSEACTIVATE: {
        POINT pt{};
        GetCursorPos(&pt);
        ScreenToClient(h, &pt);
        if (!IsInteractiveHostClientPoint(pt))
            return MA_NOACTIVATE;
        return DefWindowProcW(h, msg, w, l);
    }
    case WM_CLOSE:
        ViewerDiagLogPrintf("WM_CLOSE — destroying window (exit)");
        DestroyWindow(h);
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_SETCURSOR:
        if (g_compController && LOWORD(l) == HTCLIENT) {
        if (g_forceHiddenCursor) {
                SetCursor(HiddenCursor());
                return (LRESULT)TRUE;
            }
            HCURSOR use = g_webviewCursorCached ? g_webviewCursorCached : LoadCursor(nullptr, IDC_ARROW);
            SetCursor(use);
            return (LRESULT)TRUE;
        }
        return DefWindowProcW(h, msg, w, l);
    case WM_SIZE:
        ResizeWebView();
        if (g_webview) {
            if (w == SIZE_MINIMIZED)
                PostHostWindowMinimizedToWeb(true);
            else if (w == SIZE_RESTORED || w == SIZE_MAXIMIZED)
                PostHostWindowMinimizedToWeb(false);
        }
        return 0;
    case WM_APP_PUSH: {
        std::string* ps = reinterpret_cast<std::string*>(l);
        if (ps) {
            ApplyPushBody(*ps);
            delete ps;
        }
        return 0;
    }
    case WM_APP_LAYOUT: {
        std::string json;
        {
            std::lock_guard<std::mutex> lock(g_layoutCoalesceMutex);
            g_layoutCoalesceScheduled = false;
            json.swap(g_layoutCoalescePending);
        }
        if (!json.empty())
            ApplyLayoutJson(json);
        {
            std::lock_guard<std::mutex> lock(g_layoutCoalesceMutex);
            if (!g_layoutCoalescePending.empty() && !g_layoutCoalesceScheduled) {
                g_layoutCoalesceScheduled = true;
                PostMessageW(h, WM_APP_LAYOUT, 0, 0);
            }
        }
        return 0;
    }
    case WM_APP_YIELD_FOCUS:
        TryYieldForegroundToWindowBehind();
        return 0;
    case WM_APP_AFTER_NAV: {
        VfTraceLogA("WM_APP_AFTER_NAV: port=%d", g_port);
        VfUserLogfA("info", "WM_APP_AFTER_NAV: injecting vf-log.js loader (port=%d)", g_port);
        if (g_webview) {
            std::wstring s = L"(function(){var p=";
            s += std::to_wstring(g_port);
            s += L";window.__agentPort=p;var e=document.createElement('script');e.src='http://127.0.0.1:'+p+'/vf-log.js';(document.head||document.documentElement).appendChild(e);})();";
            g_webview->ExecuteScript(s.c_str(), nullptr);
        }
        /* Temporarily skip the startup WebView child subclass/pass-through install.
           That path is currently crashing the host after launch, and a stable window
           is more important than input-shape refinement while we debug the native bug. */
        return 0;
    }
    case WM_APP_SUBCLASS_WEBVIEW_CHILDREN:
        InstallWebViewChildSubclassing(h);
        return 0;
    case WM_TIMER:
        if (w == kWebViewSubclassRetryTimer) {
            KillTimer(h, kWebViewSubclassRetryTimer);
            InstallWebViewChildSubclassing(h);
        } else if (w == kWebViewControllerInitWatchdogTimer) {
            KillTimer(h, kWebViewControllerInitWatchdogTimer);
            if (!g_webViewControllerCallbackSeen.load()) {
                VfTraceLogA("InitWebView watchdog: composition controller callback did not arrive");
                VfUserLogLineA("error", "InitWebView watchdog: WebView2 composition controller callback did not arrive");
                MessageBoxW(
                    h,
                    L"WebView2 composition controller callback did not arrive. Check %LOCALAPPDATA%\\vektor-flow\\vf-overlay.log.",
                    L"vf-overlay",
                    MB_OK | MB_ICONERROR);
            }
        }
        return 0;
    case WM_CAPTURECHANGED:
        if ((HWND)l != h)
            g_captureMouse = false;
        return DefWindowProcW(h, msg, w, l);
#if (WINVER >= 0x0602)
    case WM_POINTERDOWN:
    case WM_POINTERUPDATE:
    case WM_POINTERUP: {
        UINT32 pid = GET_POINTERID_WPARAM(w);
        POINTER_INFO pi{};
        pi.pointerId = pid;
        if (!GetPointerInfo(pid, &pi))
            return DefWindowProcW(h, msg, w, l);
        POINT pt = {(LONG)pi.ptPixelLocation.x, (LONG)pi.ptPixelLocation.y};
        ScreenToClient(h, &pt);
        if (g_compiledUiBootstrapHost.Active()) {
            g_compiledUiBootstrapHost.UpdateFromPointer(
                g_overlayPacketRuntime,
                static_cast<double>(pt.x),
                static_cast<double>(pt.y));
        }
        if (EffectiveStagePassThrough() && !IsInteractiveHostClientPoint(pt))
            return (LRESULT)FALSE;
        return DefWindowProcW(h, msg, w, l);
    }
#endif
    case WM_DESTROY:
        VfTraceLogA("WM_DESTROY: teardown (http stop, PostQuit)");
        if (g_cursorClipActive) {
            ClipCursor(nullptr);
            g_cursorClipActive = false;
        }
        g_forceHiddenCursor = false;
        if (g_hiddenCursor) {
            DestroyCursor(g_hiddenCursor);
            g_hiddenCursor = nullptr;
        }
        KillTimer(h, kWebViewSubclassRetryTimer);
        if (g_compController && g_cursorChangedHandlerRegistered) {
            g_compController->remove_CursorChanged(g_cursorChangedToken);
            g_cursorChangedHandlerRegistered = false;
            g_cursorChangedToken.value = 0;
        }
        ReplaceWebViewCursorCache(nullptr, false);
        g_httpStop = true;
        if (g_listenSock != INVALID_SOCKET) {
            closesocket(g_listenSock);
            g_listenSock = INVALID_SOCKET;
        }
        PostQuitMessage(0);
        return 0;
    default:
        if (msg == WM_MOUSEMOVE && HandleHiddenCursorRelativeMouse()) {
            return 0;
        }
        if (msg == WM_MOUSEMOVE && g_compiledUiBootstrapHost.Active()) {
            g_compiledUiBootstrapHost.UpdateFromPointer(
                g_overlayPacketRuntime,
                static_cast<double>(GET_X_LPARAM(l)),
                static_cast<double>(GET_Y_LPARAM(l)));
        }
        if (g_compController && IsWebViewMouseMessage(msg) && TryForwardMouseToWebView(h, msg, w, l))
            return 0;
        return DefWindowProcW(h, msg, w, l);
    }
}

void InitWebView(HWND h) {
    VfTraceLogA("InitWebView: CreateCoreWebView2EnvironmentWithOptions…");
    Microsoft::WRL::ComPtr<CoreWebView2EnvironmentOptions> webEnvOptions;
    webEnvOptions = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    if (webEnvOptions) {
        /* navigator.gpu in WebView2: allow WebGPU in the Edge/Chromium content process. */
        webEnvOptions->put_AdditionalBrowserArguments(L"--enable-unsafe-webgpu");
    }
    CreateCoreWebView2EnvironmentWithOptions(
        nullptr, nullptr, webEnvOptions ? webEnvOptions.Get() : nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [h](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                VfTraceLogA("WebView2 environment callback: hr=0x%08X env=%p", (unsigned)(HRESULT)result,
                            (void*)env);
                if (FAILED(result) || !env) {
                    wchar_t msg[192];
                    swprintf_s(msg, L"WebView2 environment failed (HRESULT 0x%08X). Install Edge WebView2 Runtime.",
                               (unsigned int)(HRESULT)result);
                    MessageBoxW(h, msg, L"vf-overlay", MB_OK | MB_ICONERROR);
                    return result;
                }
                ComPtr<ICoreWebView2Environment3> env3;
                if (FAILED(env->QueryInterface(IID_PPV_ARGS(&env3))) || !env3) {
                    MessageBoxW(h, L"WebView2 ICoreWebView2Environment3 not available (update WebView2 Runtime).",
                                L"vf-overlay", MB_OK | MB_ICONERROR);
                    return E_FAIL;
                }
                env->QueryInterface(IID_PPV_ARGS(&g_webEnvironment12));
                g_webViewControllerCallbackSeen.store(false);
                SetTimer(h, kWebViewControllerInitWatchdogTimer, 15000, nullptr);
                HRESULT createControllerHr = env3->CreateCoreWebView2CompositionController(
                    h,
                    Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
                        [h](HRESULT result, ICoreWebView2CompositionController* comp) -> HRESULT {
                            g_webViewControllerCallbackSeen.store(true);
                            KillTimer(h, kWebViewControllerInitWatchdogTimer);
                            VfTraceLogA("WebView2 composition controller callback: hr=0x%08X comp=%p",
                                        (unsigned)(HRESULT)result, (void*)comp);
                            if (FAILED(result) || !comp) {
                                VfUserLogfA("error", "WebView2 composition controller failed hr=0x%08X",
                                            (unsigned int)(HRESULT)result);
                                wchar_t msg[192];
                                swprintf_s(msg, L"WebView2 composition controller failed (HRESULT 0x%08X).",
                                           (unsigned int)(HRESULT)result);
                                MessageBoxW(h, msg, L"vf-overlay", MB_OK | MB_ICONERROR);
                                return result;
                            }
                            g_compController = comp;
                            HRESULT hr = comp->put_RootVisualTarget(g_dcompWebVisual.Get());
                            VfTraceLogA("InitWebView: put_RootVisualTarget hr=0x%08X", (unsigned int)hr);
                            if (FAILED(hr)) {
                                VfUserLogfA("error", "put_RootVisualTarget failed hr=0x%08X", (unsigned int)hr);
                                wchar_t msg[192];
                                swprintf_s(msg, L"put_RootVisualTarget failed (HRESULT 0x%08X).",
                                           (unsigned int)hr);
                                MessageBoxW(h, msg, L"vf-overlay", MB_OK | MB_ICONERROR);
                                return hr;
                            }
                            hr = g_dcompDevice->Commit();
                            VfTraceLogA("InitWebView: DirectComposition Commit hr=0x%08X", (unsigned int)hr);
                            if (FAILED(hr)) {
                                VfUserLogfA("error", "DirectComposition Commit failed hr=0x%08X", (unsigned int)hr);
                                wchar_t msg[192];
                                swprintf_s(msg, L"DirectComposition Commit failed (HRESULT 0x%08X).",
                                           (unsigned int)hr);
                                MessageBoxW(h, msg, L"vf-overlay", MB_OK | MB_ICONERROR);
                                return hr;
                            }

                            ComPtr<ICoreWebView2Controller> controller;
                            hr = comp->QueryInterface(IID_PPV_ARGS(&controller));
                            VfTraceLogA("InitWebView: QueryInterface(ICoreWebView2Controller) hr=0x%08X controller=%p",
                                        (unsigned int)hr, (void*)controller.Get());
                            if (FAILED(hr) || !controller) {
                                VfUserLogfA("error", "QueryInterface ICoreWebView2Controller failed hr=0x%08X",
                                            (unsigned int)hr);
                                MessageBoxW(h, L"QueryInterface ICoreWebView2Controller failed.", L"vf-overlay",
                                            MB_OK | MB_ICONERROR);
                                return hr;
                            }
                            g_controller = controller;

                            ComPtr<ICoreWebView2> web;
                            hr = controller->get_CoreWebView2(&web);
                            VfTraceLogA("InitWebView: get_CoreWebView2 hr=0x%08X web=%p",
                                        (unsigned int)hr, (void*)web.Get());
                            if (FAILED(hr) || !web) {
                                VfUserLogfA("error", "get_CoreWebView2 failed hr=0x%08X", (unsigned int)hr);
                                wchar_t msg[192];
                                swprintf_s(msg, L"get_CoreWebView2 failed (HRESULT 0x%08X).", (unsigned int)hr);
                                MessageBoxW(h, msg, L"vf-overlay", MB_OK | MB_ICONERROR);
                                return hr;
                            }
                            g_webview = web;
                            web.As(&g_webview17);

                            ComPtr<ICoreWebView2Controller2> c2;
                            if (SUCCEEDED(controller->QueryInterface(IID_PPV_ARGS(&c2)))) {
                                COREWEBVIEW2_COLOR col = {0, 0, 0, 0};
                                c2->put_DefaultBackgroundColor(col);
                            }

                            ComPtr<ICoreWebView2Settings> settings;
                            if (SUCCEEDED(g_webview->get_Settings(&settings))) {
                                settings->put_IsStatusBarEnabled(FALSE);
                                settings->put_AreDefaultContextMenusEnabled(TRUE);
                                settings->put_IsZoomControlEnabled(FALSE);
                            }

                            ResizeWebView();

                            HRESULT curHr = g_compController->add_CursorChanged(
                                Callback<ICoreWebView2CursorChangedEventHandler>(
                                    [](ICoreWebView2CompositionController* sender, IUnknown* /*args*/) -> HRESULT {
                                        return OnCompositionCursorChanged(sender);
                                    })
                                    .Get(),
                                &g_cursorChangedToken);
                            if (SUCCEEDED(curHr))
                                g_cursorChangedHandlerRegistered = true;

                            g_webview->add_WebMessageReceived(
                                   Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                       [h](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                           LPWSTR json = nullptr;
                                           if (FAILED(args->get_WebMessageAsJson(&json)) || !json)
                                               return S_OK;
                                           std::string u8 = WideToUtf8(json);
                                           if (kCrashDiagWebMessageBreadcrumbEnabled)
                                               vf::SetCrashBreadcrumb("webmessage.last", CrashBreadcrumbSummary(u8, 200));
                                           CoTaskMemFree(json);
                                           if (MessageJsonIndicatesClose(u8)) {
                                               ViewerDiagLogPrintf("WebMessageReceived: type=close — posting WM_CLOSE");
                                               PostMessageW(h, WM_CLOSE, 0, 0);
                                               return S_OK;
                                           }
                                           if (MessageJsonIndicatesMinimize(u8)) {
                                               ShowWindow(h, SW_MINIMIZE);
                                               return S_OK;
                                           }
                                           if (MessageJsonIndicatesRestore(u8)) {
                                               ShowWindow(h, SW_RESTORE);
                                               return S_OK;
                                           }
                                           if (MessageJsonIndicatesYieldFocus(u8)) {
                                               PostMessageW(h, WM_APP_YIELD_FOCUS, 0, 0);
                                               return S_OK;
                                           }
                                            if (TryHandleCaptureScreenRectMessage(u8)) {
                                                return S_OK;
                                            }
                                            if (TryHandleVfHostChromeMessage(u8, h)) {
                                                return S_OK;
                                            }
                                           if (TryHandleVfUserLogMessage(u8)) {
                                               return S_OK;
                                           }
                                            if (TryHandleVfEventMessage(u8)) {
                                                return S_OK;
                                            }
                                            if (TryHandleVfSharedBufferRequestMessage(u8)) {
                                                return S_OK;
                                            }
                                           {
                                               std::lock_guard<std::mutex> lock(g_layoutCoalesceMutex);
                                               g_layoutCoalescePending = std::move(u8);
                                               if (!g_layoutCoalesceScheduled) {
                                                   g_layoutCoalesceScheduled = true;
                                                   PostMessageW(h, WM_APP_LAYOUT, 0, 0);
                                               }
                                           }
                                           return S_OK;
                                       })
                                       .Get(),
                                   nullptr);

                               g_webview->add_NavigationCompleted(
                                   Callback<ICoreWebView2NavigationCompletedEventHandler>(
                                       [h](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                                           BOOL ok = FALSE;
                                           args->get_IsSuccess(&ok);
                                           g_uiInputReady.store(false);
                                           VfTraceLogA("NavigationCompleted: isSuccess=%d", (int)ok);
                                           if (!ok) {
                                               {
                                                   std::string navU8 =
                                                       g_uiNavUri.empty() ? std::string("(empty)") : WideToUtf8(g_uiNavUri.c_str());
                                                   VfUserLogfA("error",
                                                              "NavigationCompleted failed (isSuccess=0). URL=%s — check web/ next to "
                                                              "vf-overlay.exe and run CMake so POST_BUILD copies web/vf-ui.",
                                                              navU8.c_str());
                                               }
                                               MessageBoxW(
                                                   h,
                                                   L"Could not open the UI. Ensure web\\ is next to vf-overlay.exe.",
                                                   L"vf-overlay",
                                                   MB_OK | MB_ICONWARNING);
                                               return S_OK;
                                           }
                                           VfUserLogfA("info", "NavigationCompleted success, posting WM_APP_AFTER_NAV (vf-log.js inject)");
                                           PostMessageW(h, WM_APP_AFTER_NAV, 0, 0);
                                           return S_OK;
                                       })
                                       .Get(),
                                   nullptr);

                               if (g_uiNavUri.empty()) {
                                   VfUserLogLineA("error", "InitWebView: g_uiNavUri empty, skip Navigate (HTTP not ready).");
                                   VfTraceLogA("InitWebView: g_uiNavUri empty, skip Navigate");
                                   MessageBoxW(
                                       h,
                                       L"UI URL not set (HTTP server did not start).",
                                       L"vf-overlay",
                                       MB_OK | MB_ICONERROR);
                                   return S_OK;
                               }
                               VfTraceLogA("InitWebView: Navigate() → %s",
                                           WideToUtf8(g_uiNavUri.c_str()).c_str());
                               HRESULT navHr = g_webview->Navigate(g_uiNavUri.c_str());
                               VfTraceLogA("InitWebView: Navigate hr=0x%08X", (unsigned int)navHr);
                               if (FAILED(navHr)) {
                                   VfUserLogfA("error", "InitWebView: Navigate failed hr=0x%08X", (unsigned int)navHr);
                                   wchar_t msg[192];
                                   swprintf_s(msg, L"WebView2 Navigate failed (HRESULT 0x%08X).", (unsigned int)navHr);
                                   MessageBoxW(h, msg, L"vf-overlay", MB_OK | MB_ICONERROR);
                                   return navHr;
                               }
                               return S_OK;
                           })
                           .Get());
                VfTraceLogA("InitWebView: CreateCoreWebView2CompositionController returned hr=0x%08X",
                            (unsigned int)createControllerHr);
                if (FAILED(createControllerHr)) {
                    KillTimer(h, kWebViewControllerInitWatchdogTimer);
                    g_webViewControllerCallbackSeen.store(true);
                    VfUserLogfA("error", "CreateCoreWebView2CompositionController failed to start hr=0x%08X",
                                (unsigned int)createControllerHr);
                    wchar_t msg[224];
                    swprintf_s(msg, L"CreateCoreWebView2CompositionController failed to start (HRESULT 0x%08X).",
                               (unsigned int)createControllerHr);
                    MessageBoxW(h, msg, L"vf-overlay", MB_OK | MB_ICONERROR);
                    return createControllerHr;
                }
                return createControllerHr;
            })
            .Get());
}

} // namespace

int VfOverlayRun(HINSTANCE hi, const VfOverlayHostLaunch& launch, int show) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    if (kCrashDiagHooksEnabled) {
        vf::InstallCrashDiagnostics(L"vf-overlay", []() {
            std::ostringstream out;
            out << "nav_uri=" << (g_uiNavUri.empty() ? "(empty)" : WideToUtf8(g_uiNavUri.c_str())) << "\n";
            out << "web_root=" << (g_webRootW.empty() ? "(empty)" : WideToUtf8(g_webRootW.c_str())) << "\n";
            out << "http_listen_ok=" << (g_httpListenOk.load() ? "1" : "0") << "\n";
            out << "port=" << g_port << "\n";
            {
                std::lock_guard<std::mutex> lock(g_queueMutex);
                out << "queue_size=" << g_userQueue.size() << "\n";
                if (!g_userQueue.empty()) {
                    out << "queue_front=" << CrashBreadcrumbSummary(g_userQueue.front(), 200) << "\n";
                    out << "queue_back=" << CrashBreadcrumbSummary(g_userQueue.back(), 200) << "\n";
                }
            }
            return out.str();
        });
    }
    VfUserLogfA("info", "vf-overlay: wWinMain entry (show=%d)", (int)show);
    VfTraceLogA("wWinMain: entry (show=%d)", (int)show);
    const LaunchOptions launchOptions = ParseLaunchOptions(launch.pageArg);
    g_uiInputReady.store(false);
    if (kCrashDiagLaunchBuiltinBreadcrumbEnabled) {
        vf::SetCrashBreadcrumb("launch.compiled_ui_builtin", WideToUtf8(launchOptions.compiledUiBuiltin.c_str()));
    }
    if (kCrashDiagLaunchPageBreadcrumbEnabled) {
        vf::SetCrashBreadcrumb("launch.page_arg", WideToUtf8(launchOptions.pageArg.c_str()));
    }

    INITCOMMONCONTROLSEX icc = {sizeof(icc), ICC_STANDARD_CLASSES | ICC_TAB_CLASSES};
    InitCommonControlsEx(&icc);

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) {
        VfUserLogfA("error", "CoInitializeEx failed hr=0x%08X", (unsigned int)(HRESULT)hr);
        VfTraceLogA("wWinMain: CoInitializeEx failed hr=0x%08X", (unsigned int)(HRESULT)hr);
        return 1;
    }

    InitGdiplusOnce();

    g_httpReadyEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!g_httpReadyEvent) {
        VfTraceLogA("wWinMain: CreateEvent(httpReady) failed");
        ShutdownGdiplusIfNeeded();
        CoUninitialize();
        return 1;
    }
    if (!ResolveWebRoot(launch.webRoot)) {
        VfUserLogfA("error", "ResolveWebRoot failed: no index.html in configured or executable web root");
        VfTraceLogA("wWinMain: ResolveWebRoot failed (no index.html in configured web root or exe\\web)");
        MessageBoxW(
            nullptr,
            L"Could not find overlay web\\index.html.\n\n"
            L"Build with CMake so web/vf-ui is packaged as web/ next to the overlay host.",
            L"vf-overlay",
            MB_OK | MB_ICONERROR);
        CloseHandle(g_httpReadyEvent);
        g_httpReadyEvent = nullptr;
        ShutdownGdiplusIfNeeded();
        CoUninitialize();
        return 1;
    }
    {
        std::string rootUtf8 = WideToUtf8(g_webRootW.c_str());
        VfTraceLogA("wWinMain: web root: %s", rootUtf8.c_str());
    }
    std::wstring relPath = ResolveRelativePagePath(g_webRootW, launchOptions.pageArg);
    if (!launchOptions.compiledUiBuiltin.empty()) {
        std::filesystem::path moduleDir(g_webRootW);
        moduleDir = moduleDir.parent_path();
        std::string bootstrapError;
        if (!g_compiledUiBootstrapHost.Initialize(
                g_webRootW,
                moduleDir,
                launchOptions.compiledUiBuiltin,
                &bootstrapError)) {
            std::string detail = bootstrapError.empty() ? "compiled UI builtin bootstrap failed" : bootstrapError;
            VfUserLogfA("error", "%s: %s", detail.c_str(),
                        WideToUtf8(launchOptions.compiledUiBuiltin.c_str()).c_str());
        } else {
            if (launchOptions.pageArg.empty()) {
                relPath = vf::CompiledUiBootstrapHost::DefaultPage();
            }
            g_compiledUiBootstrapHost.Publish(g_overlayPacketRuntime);
            VfUserLogfA("info", "compiled UI builtin bootstrap ok: %s",
                        WideToUtf8(launchOptions.compiledUiBuiltin.c_str()).c_str());
        }
    }
    {
        std::string runtimePacketError;
        if (!g_overlayPacketRuntime.InitializeHostBindingsForWebRoot(
                g_webRootW, [](const std::string& msg) { ViewerDiagLogPrintf("%s", msg.c_str()); },
                [](const std::string& compact) {
                    ViewerEnqueueDiagLog(std::string("[webmessage vf_event] ") + compact);
                    EnqueueUserEventLine(compact);
                }, HttpRespondJson,
                &runtimePacketError)) {
            VfTraceLogA("wWinMain: runtime packet preload skipped: %s", runtimePacketError.c_str());
        }
    }

    if (launchOptions.explicitPort > 0) {
        g_port = launchOptions.explicitPort;
    }

    if (!launchOptions.serveOnly) {
        HICON hAppIconLg = nullptr;
        HICON hAppIconSm = nullptr;
        WNDCLASSEXW wc = {sizeof(wc)};
        wc.lpfnWndProc = WndProc;
        wc.hInstance = hi;
        wc.lpszClassName = L"VfOverlayHost";
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
        wc.hbrBackground = nullptr;
        {
            const int cxSm = GetSystemMetrics(SM_CXSMICON);
            const int cySm = GetSystemMetrics(SM_CYSMICON);
            const int cxLg = GetSystemMetrics(SM_CXICON);
            const int cyLg = GetSystemMetrics(SM_CYICON);
            hAppIconSm = (HICON)LoadImageW(hi, MAKEINTRESOURCEW(1), IMAGE_ICON, cxSm, cySm, 0);
            hAppIconLg = (HICON)LoadImageW(hi, MAKEINTRESOURCEW(1), IMAGE_ICON, cxLg, cyLg, 0);
            if (!hAppIconSm && !hAppIconLg) {
                HICON hFallback = LoadIconW(hi, MAKEINTRESOURCEW(1));
                hAppIconSm = hFallback;
                hAppIconLg = hFallback;
            }
            if (!hAppIconLg)
                hAppIconLg = LoadIconW(nullptr, IDI_APPLICATION);
            if (!hAppIconSm)
                hAppIconSm = hAppIconLg;
            wc.hIcon = hAppIconLg;
            wc.hIconSm = hAppIconSm;
        }
        RegisterClassExW(&wc);

        int sw = GetSystemMetrics(SM_CXSCREEN);
        int sh = GetSystemMetrics(SM_CYSCREEN);
        DWORD exStyle = WS_EX_TOPMOST;
        /* Window title (taskbar / Alt+Tab); icon from embedded app.ico (transparent). */
        g_hwnd = CreateWindowExW(exStyle, L"VfOverlayHost", L"Vektor Flow", WS_POPUP, 0, 0, sw, sh,
                                 nullptr, nullptr, hi, nullptr);
        if (!g_hwnd) {
            ShutdownGdiplusIfNeeded();
            CoUninitialize();
            return 1;
        }
        if (hAppIconLg)
            SendMessageW(g_hwnd, WM_SETICON, ICON_BIG, (LPARAM)hAppIconLg);
        if (hAppIconSm)
            SendMessageW(g_hwnd, WM_SETICON, ICON_SMALL, (LPARAM)hAppIconSm);

        ShowWindow(g_hwnd, show);
        UpdateWindow(g_hwnd);
    }

    std::thread th(HttpThreadMain);
    th.detach();

    if (WaitForSingleObject(g_httpReadyEvent, 15000) != WAIT_OBJECT_0 || !g_httpListenOk.load()) {
        VfUserLogfA("error", "HTTP server did not become ready (g_httpListenOk=%d)",
                    g_httpListenOk.load() ? 1 : 0);
        VfTraceLogA("wWinMain: HTTP server did not become ready (g_httpListenOk=%d)",
                    g_httpListenOk.load() ? 1 : 0);
        MessageBoxW(g_hwnd,
                    L"Localhost HTTP server did not start (port may be in use).",
                    L"vf-overlay",
                    MB_OK | MB_ICONERROR);
        DestroyWindow(g_hwnd);
        CloseHandle(g_httpReadyEvent);
        g_httpReadyEvent = nullptr;
        ShutdownGdiplusIfNeeded();
        CoUninitialize();
        return 1;
    }
    VfTraceLogA("wWinMain: HTTP ready on port %d", g_port);

    {
        /* Python / VKF: read `web/vf-api-port.txt` next to vf-overlay.exe (ASCII port). */
        std::wstring pathW = g_webRootW + L"\\vf-api-port.txt";
        FILE* fp = nullptr;
        if (_wfopen_s(&fp, pathW.c_str(), L"wb") == 0 && fp) {
            std::string s = std::to_string(g_port);
            fwrite(s.c_str(), 1, s.size(), fp);
            fclose(fp);
        }
    }

    {
        {
            std::wstring packetPath;
            std::wstring geomTransportPath;
            std::wstring geomStatePath;
            std::wstring relDir = relPath;
            size_t slash = relDir.find_last_of(L'/');
            if (slash != std::wstring::npos) {
                relDir = relDir.substr(0, slash);
            } else {
                relDir.clear();
            }
            if (!relDir.empty()) {
                packetPath = OverlayPacketRuntime::RuntimePacketDefaultPath(g_webRootW + L"\\" + relDir);
                geomTransportPath = g_webRootW + L"\\" + relDir + L"\\vf-geom-ledger-transport.json";
                geomStatePath = g_webRootW + L"\\" + relDir + L"\\vf-geom-ledger-state.json";
            } else {
                packetPath = OverlayPacketRuntime::RuntimePacketDefaultPath(g_webRootW);
                geomTransportPath = g_webRootW + L"\\vf-geom-ledger-transport.json";
                geomStatePath = g_webRootW + L"\\vf-geom-ledger-state.json";
            }
            std::string packetLoadError;
            if (!g_overlayPacketRuntime.LoadRuntimePacketFileIntoSnapshot(packetPath, &packetLoadError)) {
                VfTraceLogA("wWinMain: session runtime packet preload skipped: %s",
                            packetLoadError.c_str());
            } else {
                VfTraceLogA("wWinMain: session runtime packet preload: %s",
                            WideToUtf8(packetPath.c_str()).c_str());
            }
            std::string geomLoadError;
            if (!g_overlayGeometryLedgerRuntime.LoadSceneSharedBufferSpec(geomTransportPath, geomStatePath, &geomLoadError)) {
                VfTraceLogA("wWinMain: geometry ledger shared-buffer preload skipped: %s", geomLoadError.c_str());
            } else {
                VfTraceLogA("wWinMain: geometry ledger shared-buffer preload: %s | %s",
                            WideToUtf8(geomTransportPath.c_str()).c_str(),
                            WideToUtf8(geomStatePath.c_str()).c_str());
            }
        }
        if (g_compiledUiBootstrapHost.Active()) {
            g_compiledUiBootstrapHost.Publish(g_overlayPacketRuntime);
        }
        if (launchOptions.serveOnly) {
            VfTraceLogA("wWinMain: serve-only mode ready on port %d", g_port);
            VfUserLogfA("info", "serve-only ready on port %d", g_port);
            while (true) {
                Sleep(1000);
            }
        }
        wchar_t prefix[64];
        swprintf_s(prefix, L"http://127.0.0.1:%d/", g_port);
        g_uiNavUri.assign(prefix);
        g_uiNavUri += relPath;
    }
    {
        std::string navU8 = WideToUtf8(g_uiNavUri.c_str());
        VfTraceLogA("wWinMain: UI navigate URI: %s", navU8.c_str());
        VfUserLogfA("info", "HTTP ready, navigate URI: %s", navU8.c_str());
    }
    CloseHandle(g_httpReadyEvent);
    g_httpReadyEvent = nullptr;

    HRESULT dchr = InitDComposition(g_hwnd);
    if (FAILED(dchr)) {
        VfUserLogfA("error", "InitDComposition failed hr=0x%08X", (unsigned int)dchr);
        VfTraceLogA("wWinMain: InitDComposition failed hr=0x%08X", (unsigned int)dchr);
        wchar_t msg[192];
        swprintf_s(msg, L"DirectComposition / D3D11 init failed (HRESULT 0x%08X).", (unsigned int)dchr);
        MessageBoxW(g_hwnd, msg, L"vf-overlay", MB_OK | MB_ICONERROR);
        DestroyWindow(g_hwnd);
        ShutdownGdiplusIfNeeded();
        CoUninitialize();
        return 1;
    }
    VfTraceLogA("wWinMain: InitDComposition OK, calling InitWebView");

    InitWebView(g_hwnd);
    VfTraceLogA("wWinMain: InitWebView() returned (async WebView2 setup continues)");

    MSG m{};
    while (GetMessageW(&m, nullptr, 0, 0)) {
        TranslateMessage(&m);
        DispatchMessageW(&m);
    }

    g_httpStop = true;
    ShutdownGdiplusIfNeeded();
    CoUninitialize();
    return 0;
}

int VfOverlayRun(HINSTANCE hi, const wchar_t* pageArg, int show) {
    VfOverlayHostLaunch launch{pageArg, nullptr};
    return VfOverlayRun(hi, launch, show);
}

VF_OVERLAY_API int VfOverlayRunDll(HINSTANCE hi, const wchar_t* pageArg, const wchar_t* webRoot, int show) {
    VfOverlayHostLaunch launch{pageArg, webRoot};
    return VfOverlayRun(hi, launch, show);
}

#ifndef VF_OVERLAY_NO_STANDALONE_MAIN
int WINAPI wWinMain(HINSTANCE hi, HINSTANCE, PWSTR lpCmdLine, int show) {
    (void)lpCmdLine;
    return VfOverlayRun(hi, nullptr, show);
}
#endif
