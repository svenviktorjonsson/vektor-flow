#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <windowsx.h>
#include <dcomp.h>
#include <dxgi.h>

#include <wrl.h>
#include <wrl/client.h>
#include <WebView2.h>
#include "WebView2EnvironmentOptions.h"

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdio>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>
#include <string_view>

#include "../vf_overlay_host.hpp"
#include "crash_diagnostics.hpp"
#include "release_host_adapter.hpp"

namespace {

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

constexpr wchar_t kWindowClass[] = L"VfReleaseOverlayHost";
constexpr wchar_t kResourceHost[] = L"app.vektorflow.invalid";
constexpr double kInteractiveStartupBudgetMs = 500.0;
constexpr UINT kActivatePooledHostMessage = WM_APP + 0x41u;
constexpr UINT_PTR kPrewarmTtlTimerId = 1u;
constexpr UINT kPrewarmHostTtlMs = 60000u;

HWND g_window = nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2CompositionController> g_composition_controller;
ComPtr<ICoreWebView2> g_webview;
ComPtr<ICoreWebView2Environment12> g_environment12;
ComPtr<ICoreWebView2_17> g_webview17;
ComPtr<ICoreWebView2SharedBuffer> g_event_shared_buffer;
ComPtr<IDCompositionDevice> g_composition_device;
ComPtr<IDCompositionTarget> g_composition_target;
ComPtr<IDCompositionVisual> g_composition_root_visual;
ComPtr<IDCompositionVisual> g_webview_visual;
ComPtr<IDCompositionEffectGroup> g_startup_effect_group;
std::wstring g_web_root;
std::wstring g_page;
std::wstring g_webview_user_data_folder;
std::atomic<int> g_exit_code{0};
vf::ReleaseHostAdapter g_adapter;
bool g_mouse_captured = false;
bool g_tracking_mouse_leave = false;
bool g_content_revealed = false;
bool g_prewarm_probe = false;
bool g_prewarm_content_ready = false;
bool g_prewarm_launch_requested = false;
bool g_offscreen_camera_benchmark = false;
std::filesystem::path g_offscreen_camera_benchmark_path;
std::uint32_t g_offscreen_camera_benchmark_samples = 30u;
bool g_native_frame_capture = false;
std::filesystem::path g_native_frame_capture_path;
std::uint32_t g_native_frame_capture_time_samples = 0u;
std::uint32_t g_native_frame_capture_frames_written = 0u;
std::atomic<bool> g_prewarm_shutting_down{false};
HANDLE g_prewarm_launch_event = nullptr;
HANDLE g_prewarm_ready_event = nullptr;
HANDLE g_prewarm_wait_thread = nullptr;
LARGE_INTEGER g_startup_counter{};
LARGE_INTEGER g_startup_frequency{};
std::filesystem::path g_startup_trace_path;
std::filesystem::path g_error_log_path;
std::mutex g_error_log_mutex;

double StartupElapsedMs() {
    LARGE_INTEGER now{};
    if (g_startup_frequency.QuadPart <= 0 || !QueryPerformanceCounter(&now)) return 0.0;
    return 1000.0 * static_cast<double>(now.QuadPart - g_startup_counter.QuadPart) /
           static_cast<double>(g_startup_frequency.QuadPart);
}

void TraceStartupStage(const char* stage, bool reset_file = false) {
    if (stage == nullptr || *stage == '\0') return;
    const double elapsed_ms = StartupElapsedMs();
    char debug_line[256]{};
    std::snprintf(
        debug_line,
        sizeof(debug_line),
        "[vkf-startup] stage=%s elapsed_ms=%.3f budget_ms=%.0f\n",
        stage,
        elapsed_ms,
        kInteractiveStartupBudgetMs);
    OutputDebugStringA(debug_line);
    if (g_startup_trace_path.empty()) return;
    std::ofstream trace(
        g_startup_trace_path,
        std::ios::out | (reset_file ? std::ios::trunc : std::ios::app));
    if (!trace) return;
    trace << "{\"schema\":\"vektor-flow/startup-trace-v1\",\"stage\":\""
          << stage << "\",\"elapsed_ms\":" << std::fixed << std::setprecision(3)
          << elapsed_ms << ",\"budget_ms\":" << std::setprecision(0)
          << kInteractiveStartupBudgetMs << "}\n";
}

void InitializeStartupTrace() {
    QueryPerformanceFrequency(&g_startup_frequency);
    QueryPerformanceCounter(&g_startup_counter);
    wchar_t path[32768]{};
    const DWORD length = GetEnvironmentVariableW(
        L"VKF_STARTUP_TRACE_PATH", path, static_cast<DWORD>(std::size(path)));
    if (length > 0 && length < std::size(path)) {
        g_startup_trace_path = std::filesystem::path(path);
    } else {
        g_startup_trace_path.clear();
    }
    TraceStartupStage("process_start", true);
}

std::wstring ResolveSharedWebViewUserDataFolder() {
    wchar_t local_app_data[32768]{};
    const DWORD length = GetEnvironmentVariableW(
        L"LOCALAPPDATA", local_app_data, static_cast<DWORD>(std::size(local_app_data)));
    if (length == 0 || length >= std::size(local_app_data)) return {};
    const std::filesystem::path folder =
        std::filesystem::path(local_app_data) / L"vektor-flow" / L"webview2" / L"runtime-v1";
    std::error_code error;
    std::filesystem::create_directories(folder, error);
    if (error) return {};
    return folder.wstring();
}

std::wstring EnvironmentValue(const wchar_t* name) {
    wchar_t value[32768]{};
    const DWORD length = GetEnvironmentVariableW(
        name, value, static_cast<DWORD>(std::size(value)));
    return length > 0 && length < std::size(value) ? std::wstring(value, length) : std::wstring{};
}

std::string WideToUtf8(std::wstring_view text);
void AppendHostError(std::string_view stage, HRESULT error);

std::uint32_t BoundedEnvironmentCount(
    const wchar_t* name, std::uint32_t fallback, std::uint32_t maximum) {
    const std::wstring value = EnvironmentValue(name);
    if (value.empty()) return fallback;
    try {
        const unsigned long parsed = std::stoul(value);
        return static_cast<std::uint32_t>(std::max<unsigned long>(
            1ul, std::min<unsigned long>(parsed, maximum)));
    } catch (...) {
        return fallback;
    }
}

bool WriteAtomicToolingEvidence(
    const std::filesystem::path& destination,
    std::wstring_view message
) {
    if (destination.empty() || message.empty()) return false;
    const std::string utf8 = WideToUtf8(message);
    if (utf8.empty()) return false;
    std::error_code error;
    const std::filesystem::path parent = destination.parent_path();
    if (!parent.empty()) {
        std::filesystem::create_directories(parent, error);
        if (error) return false;
    }
    std::filesystem::path temporary = destination;
    temporary += L".tmp-" + std::to_wstring(GetCurrentProcessId());
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output) return false;
        output.write(utf8.data(), static_cast<std::streamsize>(utf8.size()));
        output.put('\n');
        output.flush();
        if (!output) {
            output.close();
            std::filesystem::remove(temporary, error);
            return false;
        }
    }
    if (!MoveFileExW(
            temporary.c_str(),
            destination.c_str(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        std::filesystem::remove(temporary, error);
        return false;
    }
    return true;
}

bool WriteOffscreenBenchmarkEvidence(std::wstring_view message) {
    return WriteAtomicToolingEvidence(g_offscreen_camera_benchmark_path, message);
}

bool WriteNativeFrameCaptureEvidence(std::wstring_view message) {
    return WriteAtomicToolingEvidence(g_native_frame_capture_path, message);
}

bool WriteNativeFrameCaptureFrameEvidence(std::wstring_view message) {
    std::filesystem::path frame_directory =
        g_native_frame_capture_path.parent_path() /
        (g_native_frame_capture_path.stem().wstring() + L"-frames");
    std::wostringstream file_name;
    file_name << std::setw(3) << std::setfill(L'0')
              << g_native_frame_capture_frames_written << L".json";
    if (!WriteAtomicToolingEvidence(frame_directory / file_name.str(), message)) {
        return false;
    }
    ++g_native_frame_capture_frames_written;
    return true;
}

void FailStartup(HWND window, std::string_view stage, HRESULT error) {
    AppendHostError(stage, error);
    g_exit_code.store(1);
    if (window != nullptr) {
        PostMessageW(window, WM_CLOSE, 0, 0);
    } else {
        PostQuitMessage(1);
    }
}

std::wstring NormalizePage(const wchar_t* page) {
    std::wstring value = page == nullptr || *page == L'\0' ? L"index.html" : page;
    std::replace(value.begin(), value.end(), L'\\', L'/');
    while (!value.empty() && value.front() == L'/') {
        value.erase(value.begin());
    }
    if (value.empty() || value.find(L':') != std::wstring::npos ||
        value.find(L"../") != std::wstring::npos || value == L"..") {
        return {};
    }
    return value;
}

void ResizeController() {
    if (!g_controller || g_window == nullptr) {
        return;
    }
    RECT bounds{};
    GetClientRect(g_window, &bounds);
    g_controller->put_Bounds(bounds);
}

std::wstring ReadWebMessage(ICoreWebView2WebMessageReceivedEventArgs* args) {
    LPWSTR text = nullptr;
    if (args == nullptr || FAILED(args->get_WebMessageAsJson(&text)) || text == nullptr) {
        return {};
    }
    std::wstring json(text);
    CoTaskMemFree(text);
    return json;
}

std::string WideToUtf8(std::wstring_view text) {
    if (text.empty()) return {};
    const int required = WideCharToMultiByte(
        CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
    if (required <= 0) return {};
    std::string result(static_cast<std::size_t>(required), '\0');
    if (WideCharToMultiByte(
            CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()),
            result.data(), required, nullptr, nullptr) != required) {
        return {};
    }
    return result;
}

std::string JsonEscape(std::string_view text) {
    std::string escaped;
    escaped.reserve(text.size() + 16u);
    for (const unsigned char character : text) {
        switch (character) {
        case '\"': escaped += "\\\""; break;
        case '\\': escaped += "\\\\"; break;
        case '\b': escaped += "\\b"; break;
        case '\f': escaped += "\\f"; break;
        case '\n': escaped += "\\n"; break;
        case '\r': escaped += "\\r"; break;
        case '\t': escaped += "\\t"; break;
        default:
            if (character < 0x20u) {
                char encoded[7]{};
                std::snprintf(encoded, sizeof(encoded), "\\u%04x", character);
                escaped += encoded;
            } else {
                escaped.push_back(static_cast<char>(character));
            }
            break;
        }
    }
    return escaped;
}

void AppendErrorLogRecord(
    std::string_view severity,
    std::string_view source,
    std::string_view message,
    std::string_view payload = {}
) {
    if (g_error_log_path.empty()) return;
    std::lock_guard<std::mutex> lock(g_error_log_mutex);
    std::ofstream log(g_error_log_path, std::ios::out | std::ios::app);
    if (!log) return;
    log << "{\"schema\":\"vektor-flow/error-log-v1\",\"severity\":\""
        << JsonEscape(severity) << "\",\"source\":\"" << JsonEscape(source)
        << "\",\"elapsed_ms\":" << std::fixed << std::setprecision(3)
        << StartupElapsedMs() << ",\"message\":\"" << JsonEscape(message) << "\"";
    if (!payload.empty()) log << ",\"payload\":" << payload;
    log << "}\n";
}

void InitializeErrorLog() {
    const std::wstring configured = EnvironmentValue(L"VKF_ERROR_LOG_PATH");
    if (!configured.empty()) {
        g_error_log_path = std::filesystem::path(configured);
    } else {
        wchar_t module_name[32768]{};
        const DWORD length = GetModuleFileNameW(
            nullptr, module_name, static_cast<DWORD>(std::size(module_name)));
        g_error_log_path = length > 0 && length < std::size(module_name)
            ? std::filesystem::path(std::wstring_view(module_name, length))
            : std::filesystem::path(L"vkf.errors.jsonl");
        g_error_log_path.replace_extension(L".errors.jsonl");
    }
    std::error_code error;
    const std::filesystem::path parent = g_error_log_path.parent_path();
    if (!parent.empty()) std::filesystem::create_directories(parent, error);
    {
        std::lock_guard<std::mutex> lock(g_error_log_mutex);
        std::ofstream reset(g_error_log_path, std::ios::out | std::ios::trunc);
    }
    AppendErrorLogRecord("info", "host", "VKF error capture started");
}

void AppendRuntimeLogMessage(std::wstring_view message) {
    if (message.empty()) return;
    const std::string payload = WideToUtf8(message);
    if (payload.empty()) return;
    const bool is_error =
        message.find(L"\"level\":\"error\"") != std::wstring::npos ||
        message.find(L"\"status\":\"error\"") != std::wstring::npos ||
        message.find(L"\"fatal\":true") != std::wstring::npos;
    const bool is_warning = message.find(L"\"level\":\"warn") != std::wstring::npos;
    AppendErrorLogRecord(
        is_error ? "error" : (is_warning ? "warning" : "info"),
        "runtime",
        is_error ? "VKF runtime reported an error" : "VKF runtime message",
        payload);
}

void AppendHostError(std::string_view stage, HRESULT error) {
    char message[96]{};
    std::snprintf(
        message,
        sizeof(message),
        "native host failure HRESULT=0x%08lx",
        static_cast<unsigned long>(error));
    AppendErrorLogRecord("error", stage, message);
}

bool IsInteractivePhysicalPoint(POINT point) {
    UINT dpi = g_window == nullptr ? USER_DEFAULT_SCREEN_DPI : GetDpiForWindow(g_window);
    if (dpi == 0u) dpi = USER_DEFAULT_SCREEN_DPI;
    const auto x = static_cast<std::int32_t>(
        MulDiv(point.x, USER_DEFAULT_SCREEN_DPI, static_cast<int>(dpi)));
    const auto y = static_cast<std::int32_t>(
        MulDiv(point.y, USER_DEFAULT_SCREEN_DPI, static_cast<int>(dpi)));
    return g_adapter.IsInteractivePoint(x, y);
}

void TraceRuntimeWebMessage(std::wstring_view message) {
    if (g_startup_trace_path.empty() || message.empty()) return;
    const std::string payload = WideToUtf8(message);
    if (payload.empty()) return;
    std::ofstream trace(g_startup_trace_path, std::ios::out | std::ios::app);
    if (!trace) return;
    trace << "{\"schema\":\"vektor-flow/startup-trace-v1\","
          << "\"stage\":\"runtime_log\",\"elapsed_ms\":"
          << std::fixed << std::setprecision(3) << StartupElapsedMs()
          << ",\"payload\":" << payload << "}\n";
}

const wchar_t* RuntimeErrorCaptureScript() {
    return LR"JS((function(){
if(globalThis.__vkfErrorCaptureInstalled)return;
globalThis.__vkfErrorCaptureInstalled=true;
function report(source,value){var text=String(value&&value.stack||value&&value.message||value||'unknown error');try{if(globalThis.chrome&&chrome.webview&&chrome.webview.postMessage){chrome.webview.postMessage({type:'vf_log',level:'error',source:source,message:text,t:Date.now()});}}catch(_){}}
globalThis.addEventListener('error',function(event){report('javascript-error',event&&event.error||event&&event.message);},true);
globalThis.addEventListener('unhandledrejection',function(event){report('unhandled-rejection',event&&event.reason);},true);
})();)JS";
}

HRGN BuildHostInputRegion() {
    RECT client{};
    GetClientRect(g_window, &client);
    UINT dpi = GetDpiForWindow(g_window);
    if (dpi == 0u) dpi = USER_DEFAULT_SCREEN_DPI;

    HRGN combined = CreateRectRgn(0, 0, 0, 0);
    if (combined == nullptr) return nullptr;
    for (const auto& hit : g_adapter.HitRegions()) {
        RECT physical{
            MulDiv(hit.left, static_cast<int>(dpi), USER_DEFAULT_SCREEN_DPI),
            MulDiv(hit.top, static_cast<int>(dpi), USER_DEFAULT_SCREEN_DPI),
            MulDiv(hit.right, static_cast<int>(dpi), USER_DEFAULT_SCREEN_DPI),
            MulDiv(hit.bottom, static_cast<int>(dpi), USER_DEFAULT_SCREEN_DPI),
        };
        RECT clipped{};
        if (!IntersectRect(&clipped, &physical, &client)) continue;
        HRGN piece = CreateRectRgnIndirect(&clipped);
        if (piece == nullptr) continue;
        CombineRgn(combined, combined, piece, RGN_OR);
        DeleteObject(piece);
    }
    return combined;
}

void SyncHostInputRegion(bool reveal_ready = false) {
    if (g_window == nullptr || g_mouse_captured) return;
    if (!g_content_revealed && !reveal_ready) {
        HRGN empty = CreateRectRgn(0, 0, 0, 0);
        if (empty != nullptr && !SetWindowRgn(g_window, empty, TRUE)) {
            DeleteObject(empty);
        }
        return;
    }
    HRGN region = BuildHostInputRegion();
    if (region != nullptr && !SetWindowRgn(g_window, region, TRUE)) {
        DeleteObject(region);
    }
}

void RevealHostContent() {
    if (g_content_revealed || !g_startup_effect_group || !g_composition_device) return;
    // Input is committed before visual opacity. The first visible composition
    // can therefore already be hovered, dragged, and clicked.
    SyncHostInputRegion(true);
    if (FAILED(g_startup_effect_group->SetOpacity(1.0f)) ||
        FAILED(g_composition_device->Commit())) {
        FailStartup(g_window, "composition_reveal", E_FAIL);
        return;
    }
    g_content_revealed = true;
    TraceStartupStage("content_revealed");
}

void ActivatePooledHost() {
    if (!g_prewarm_probe || !g_prewarm_content_ready || !g_prewarm_launch_requested ||
        g_window == nullptr || g_content_revealed) {
        return;
    }
    KillTimer(g_window, kPrewarmTtlTimerId);
    LONG_PTR style = GetWindowLongPtrW(g_window, GWL_EXSTYLE);
    style &= ~(static_cast<LONG_PTR>(WS_EX_TOOLWINDOW) | static_cast<LONG_PTR>(WS_EX_NOACTIVATE));
    style |= WS_EX_APPWINDOW;
    SetWindowLongPtrW(g_window, GWL_EXSTYLE, style);
    SetWindowPos(
        g_window,
        (GetWindowLongPtrW(g_window, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0
            ? HWND_TOPMOST
            : HWND_NOTOPMOST,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    RevealHostContent();
}

DWORD WINAPI WaitForPooledLaunchSignal(void* context) {
    const HWND window = static_cast<HWND>(context);
    if (g_prewarm_launch_event != nullptr &&
        WaitForSingleObject(g_prewarm_launch_event, INFINITE) == WAIT_OBJECT_0 &&
        !g_prewarm_shutting_down.load(std::memory_order_acquire)) {
        PostMessageW(window, kActivatePooledHostMessage, 0, 0);
    }
    return 0;
}

void MarkContentReady() {
    if (g_offscreen_camera_benchmark || g_native_frame_capture) {
        TraceStartupStage(g_native_frame_capture
            ? "native_frame_capture_ready"
            : "offscreen_camera_benchmark_ready");
        return;
    }
    if (!g_prewarm_probe) {
        RevealHostContent();
        return;
    }
    if (!g_prewarm_content_ready) {
        g_prewarm_content_ready = true;
        TraceStartupStage("pool_ready");
        if (g_prewarm_ready_event != nullptr) {
            SetEvent(g_prewarm_ready_event);
        }
    }
    ActivatePooledHost();
}

void ClearHostInputRegionForDrag() {
    if (g_window != nullptr) SetWindowRgn(g_window, nullptr, TRUE);
}

HRESULT InitializeComposition(HWND window) {
    HRESULT result = DCompositionCreateDevice(
        nullptr,
        __uuidof(IDCompositionDevice),
        reinterpret_cast<void**>(g_composition_device.GetAddressOf()));
    if (FAILED(result)) return result;
    result = g_composition_device->CreateTargetForHwnd(
        window, TRUE, &g_composition_target);
    if (FAILED(result)) return result;
    result = g_composition_device->CreateVisual(&g_composition_root_visual);
    if (FAILED(result)) return result;
    result = g_composition_target->SetRoot(g_composition_root_visual.Get());
    if (FAILED(result)) return result;
    result = g_composition_device->CreateVisual(&g_webview_visual);
    if (FAILED(result)) return result;
    result = g_composition_device->CreateEffectGroup(&g_startup_effect_group);
    if (FAILED(result)) return result;
    result = g_startup_effect_group->SetOpacity(0.0f);
    if (FAILED(result)) return result;
    result = g_composition_root_visual->SetEffect(g_startup_effect_group.Get());
    if (FAILED(result)) return result;
    result = g_composition_root_visual->AddVisual(
        g_webview_visual.Get(), TRUE, nullptr);
    if (FAILED(result)) return result;
    result = g_composition_device->Commit();
    if (SUCCEEDED(result)) TraceStartupStage("composition_ready");
    return result;
}

bool IsWebViewMouseMessage(UINT message) {
    switch (message) {
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

void FocusHostOnInteractiveHover(HWND window) {
    if (window == nullptr) return;
    if (GetForegroundWindow() != window) {
        SetForegroundWindow(window);
    }
    if (GetFocus() != window) {
        SetFocus(window);
        if (g_controller) {
            g_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        }
    }
}

bool ForwardMouseToWebView(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (!g_composition_controller) return false;

    POINT point{};
    if (message == WM_MOUSELEAVE) {
        point = {0, 0};
    } else if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL) {
        point = {GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
        ScreenToClient(window, &point);
    } else {
        point = {GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
    }

    const bool interactive = message != WM_MOUSELEAVE && IsInteractivePhysicalPoint(point);
    if (message != WM_MOUSELEAVE && !interactive && !g_mouse_captured) {
        if (message == WM_MOUSEMOVE && g_tracking_mouse_leave) {
            g_tracking_mouse_leave = false;
            TRACKMOUSEEVENT cancel{sizeof(cancel), TME_LEAVE | TME_CANCEL, window, 0};
            TrackMouseEvent(&cancel);
            return SUCCEEDED(g_composition_controller->SendMouseInput(
                static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(WM_MOUSELEAVE),
                static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(0),
                0,
                {0, 0}));
        }
        return false;
    }
    if (message == WM_MOUSEMOVE && interactive && !g_mouse_captured) {
        FocusHostOnInteractiveHover(window);
    }

    UINT32 mouse_data = 0;
    if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL) {
        mouse_data = static_cast<UINT32>(static_cast<SHORT>(GET_WHEEL_DELTA_WPARAM(wparam)));
    } else if (message == WM_XBUTTONDOWN || message == WM_XBUTTONUP ||
               message == WM_XBUTTONDBLCLK) {
        mouse_data = static_cast<UINT32>(GET_XBUTTON_WPARAM(wparam));
    }

    if (message == WM_MOUSEMOVE && !g_tracking_mouse_leave) {
        TRACKMOUSEEVENT tracking{sizeof(tracking), TME_LEAVE, window, 0};
        TrackMouseEvent(&tracking);
        g_tracking_mouse_leave = true;
    } else if (message == WM_MOUSELEAVE) {
        g_tracking_mouse_leave = false;
    }

    const bool button_down =
        message == WM_LBUTTONDOWN || message == WM_MBUTTONDOWN ||
        message == WM_RBUTTONDOWN || message == WM_XBUTTONDOWN;
    const bool button_up =
        message == WM_LBUTTONUP || message == WM_MBUTTONUP ||
        message == WM_RBUTTONUP || message == WM_XBUTTONUP;
    if (button_down && interactive) {
        ClearHostInputRegionForDrag();
        g_mouse_captured = true;
        SetCapture(window);
        SetFocus(window);
        if (g_controller) {
            g_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        }
    } else if (button_up && GetCapture() == window) {
        g_mouse_captured = false;
        ReleaseCapture();
        SyncHostInputRegion();
    }

    return SUCCEEDED(g_composition_controller->SendMouseInput(
        static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(message),
        static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(GET_KEYSTATE_WPARAM(wparam)),
        mouse_data,
        point));
}

void PublishEventSharedBuffer() {
    if (!g_webview17 || !g_event_shared_buffer) return;
    constexpr wchar_t metadata[] =
        L"{\"type\":\"vf_host_event_arena_v1\",\"version\":1,\"access\":\"read-write\"}";
    g_webview17->PostSharedBufferToScript(
        g_event_shared_buffer.Get(), COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE, metadata);
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    switch (message) {
    case WM_TIMER:
        if (wparam == kPrewarmTtlTimerId && g_prewarm_probe &&
            !g_content_revealed) {
            TraceStartupStage("pool_expired");
            PostMessageW(window, WM_CLOSE, 0, 0);
            return 0;
        }
        return DefWindowProcW(window, message, wparam, lparam);
    case kActivatePooledHostMessage:
        g_prewarm_launch_requested = true;
        TraceStartupStage("pool_launch_signal");
        ActivatePooledHost();
        return 0;
    case WM_SIZE:
        ResizeController();
        SyncHostInputRegion();
        return 0;
    case WM_NCHITTEST: {
        if (!g_content_revealed) return HTTRANSPARENT;
        POINT point{GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
        ScreenToClient(window, &point);
        return IsInteractivePhysicalPoint(point) ? HTCLIENT : HTTRANSPARENT;
    }
    case WM_MOUSEACTIVATE: {
        POINT point{};
        GetCursorPos(&point);
        ScreenToClient(window, &point);
        return IsInteractivePhysicalPoint(point)
            ? DefWindowProcW(window, message, wparam, lparam)
            : MA_NOACTIVATE;
    }
    case WM_SETCURSOR:
        if (g_composition_controller && LOWORD(lparam) == HTCLIENT) {
            HCURSOR cursor = nullptr;
            if (SUCCEEDED(g_composition_controller->get_Cursor(&cursor)) && cursor != nullptr) {
                SetCursor(cursor);
                return TRUE;
            }
        }
        return DefWindowProcW(window, message, wparam, lparam);
    case WM_CAPTURECHANGED:
        if (reinterpret_cast<HWND>(lparam) != window) {
            g_mouse_captured = false;
            SyncHostInputRegion();
        }
        return DefWindowProcW(window, message, wparam, lparam);
    case WM_ERASEBKGND:
        return 1;
    case WM_SYSKEYDOWN:
        if (wparam == VK_F4 && (GetKeyState(VK_MENU) & 0x8000) != 0) {
            PostMessageW(window, WM_CLOSE, 0, 0);
            return 0;
        }
        return DefWindowProcW(window, message, wparam, lparam);
    case WM_CLOSE:
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        KillTimer(window, kPrewarmTtlTimerId);
        if (g_mouse_captured && GetCapture() == window) ReleaseCapture();
        g_mouse_captured = false;
        g_tracking_mouse_leave = false;
        g_prewarm_shutting_down.store(true, std::memory_order_release);
        if (g_prewarm_launch_event != nullptr) {
            SetEvent(g_prewarm_launch_event);
        }
        if (g_prewarm_wait_thread != nullptr) {
            WaitForSingleObject(g_prewarm_wait_thread, 1000);
            CloseHandle(g_prewarm_wait_thread);
            g_prewarm_wait_thread = nullptr;
        }
        if (g_prewarm_launch_event != nullptr) {
            CloseHandle(g_prewarm_launch_event);
            g_prewarm_launch_event = nullptr;
        }
        if (g_prewarm_ready_event != nullptr) {
            CloseHandle(g_prewarm_ready_event);
            g_prewarm_ready_event = nullptr;
        }
        if (g_controller) {
            g_controller->Close();
            g_controller.Reset();
        }
        g_webview.Reset();
        g_webview17.Reset();
        g_event_shared_buffer.Reset();
        g_environment12.Reset();
        g_composition_controller.Reset();
        g_startup_effect_group.Reset();
        g_webview_visual.Reset();
        g_composition_root_visual.Reset();
        g_composition_target.Reset();
        g_composition_device.Reset();
        g_window = nullptr;
        PostQuitMessage(g_exit_code.load());
        return 0;
    default:
        if (g_composition_controller && IsWebViewMouseMessage(message) &&
            ForwardMouseToWebView(window, message, wparam, lparam)) {
            return 0;
        }
        return DefWindowProcW(window, message, wparam, lparam);
    }
}

int EffectiveShow(int requested) {
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    GetStartupInfoW(&startup);
    if ((startup.dwFlags & STARTF_USESHOWWINDOW) != 0 && startup.wShowWindow == SW_HIDE) {
        return SW_HIDE;
    }
    return requested;
}

void StartWebView(HWND window) {
    ComPtr<CoreWebView2EnvironmentOptions> options =
        Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    if (options) {
        options->put_AdditionalBrowserArguments(L"--enable-unsafe-webgpu");
    }

    g_webview_user_data_folder = ResolveSharedWebViewUserDataFolder();
    TraceStartupStage("webview_profile_ready");
    const wchar_t* user_data_folder = g_webview_user_data_folder.empty()
        ? nullptr
        : g_webview_user_data_folder.c_str();
    const HRESULT environment_result = CreateCoreWebView2EnvironmentWithOptions(
        nullptr,
        user_data_folder,
        options.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [window](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(result) || environment == nullptr) {
                    FailStartup(window, "webview_environment_create", FAILED(result) ? result : E_FAIL);
                    return FAILED(result) ? result : E_FAIL;
                }
                environment->QueryInterface(IID_PPV_ARGS(&g_environment12));
                if (g_environment12) {
                    constexpr UINT64 kEventArenaBytes = 64u * 1024u;
                    if (SUCCEEDED(g_environment12->CreateSharedBuffer(kEventArenaBytes, &g_event_shared_buffer)) &&
                        g_event_shared_buffer) {
                        BYTE* bytes = nullptr;
                        if (SUCCEEDED(g_event_shared_buffer->get_Buffer(&bytes)) && bytes != nullptr) {
                            g_adapter.BindEventArena(reinterpret_cast<std::byte*>(bytes), kEventArenaBytes);
                        }
                    }
                }
                ComPtr<ICoreWebView2Environment3> environment3;
                if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment3))) || !environment3) {
                    FailStartup(window, "webview_environment_interface", E_FAIL);
                    return E_FAIL;
                }
                TraceStartupStage("webview_environment_ready");
                return environment3->CreateCoreWebView2CompositionController(
                    window,
                    Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
                        [window](HRESULT controller_result,
                                 ICoreWebView2CompositionController* composition_controller) -> HRESULT {
                            if (FAILED(controller_result) || composition_controller == nullptr) {
                                FailStartup(window, "webview_controller_create", FAILED(controller_result) ? controller_result : E_FAIL);
                                return FAILED(controller_result) ? controller_result : E_FAIL;
                            }
                            g_composition_controller = composition_controller;
                            if (FAILED(composition_controller->put_RootVisualTarget(g_webview_visual.Get())) ||
                                !g_composition_device || FAILED(g_composition_device->Commit())) {
                                FailStartup(window, "composition_root_commit", E_FAIL);
                                return E_FAIL;
                            }
                            ComPtr<ICoreWebView2Controller> controller;
                            if (FAILED(composition_controller->QueryInterface(IID_PPV_ARGS(&controller))) ||
                                !controller) {
                                FailStartup(window, "webview_controller_interface", E_FAIL);
                                return E_FAIL;
                            }
                            g_controller = controller;
                            if (FAILED(controller->get_CoreWebView2(&g_webview)) || !g_webview) {
                                FailStartup(window, "webview_controller_get", E_FAIL);
                                return E_FAIL;
                            }
                            g_webview.As(&g_webview17);
                            TraceStartupStage("webview_controller_ready");

                            ComPtr<ICoreWebView2Controller2> controller2;
                            if (SUCCEEDED(controller->QueryInterface(IID_PPV_ARGS(&controller2))) && controller2) {
                                const COREWEBVIEW2_COLOR transparent{0, 0, 0, 0};
                                controller2->put_DefaultBackgroundColor(transparent);
                            }
                            ComPtr<ICoreWebView2Settings> settings;
                            if (SUCCEEDED(g_webview->get_Settings(&settings)) && settings) {
                                settings->put_IsStatusBarEnabled(FALSE);
                                settings->put_IsZoomControlEnabled(FALSE);
                            }

                            ComPtr<ICoreWebView2_3> webview3;
                            if (FAILED(g_webview->QueryInterface(IID_PPV_ARGS(&webview3))) || !webview3 ||
                                FAILED(webview3->SetVirtualHostNameToFolderMapping(
                                    kResourceHost,
                                    g_web_root.c_str(),
                                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW))) {
                                FailStartup(window, "virtual_host_mapping", E_FAIL);
                                return E_FAIL;
                            }

                            g_webview->add_WebMessageReceived(
                                Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                    [window](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                        const std::wstring message = ReadWebMessage(args);
                                        if (g_offscreen_camera_benchmark &&
                                            vf::ReleaseHostMessageContainsType(
                                                message, L"vf_offscreen_camera_benchmark_v1")) {
                                            const bool written = WriteOffscreenBenchmarkEvidence(message);
                                            const bool succeeded =
                                                message.find(L"\"status\":\"ok\"") != std::wstring::npos;
                                            if (!written || !succeeded) {
                                                AppendErrorLogRecord(
                                                    "error",
                                                    "camera_benchmark",
                                                    written ? "camera benchmark reported an error" : "camera benchmark evidence could not be written",
                                                    WideToUtf8(message));
                                            }
                                            g_exit_code.store(written && succeeded ? 0 : 1);
                                            PostMessageW(window, WM_CLOSE, 0, 0);
                                            return S_OK;
                                        }
                                        if (g_native_frame_capture &&
                                            vf::ReleaseHostMessageContainsType(
                                                message, L"vf_native_frame_media_capture_frame_v1")) {
                                            if (!WriteNativeFrameCaptureFrameEvidence(message)) {
                                                AppendErrorLogRecord(
                                                    "error",
                                                    "frame_capture",
                                                    "streamed frame evidence could not be written",
                                                    WideToUtf8(message));
                                                g_exit_code.store(1);
                                                PostMessageW(window, WM_CLOSE, 0, 0);
                                            }
                                            return S_OK;
                                        }
                                        if (g_native_frame_capture &&
                                            vf::ReleaseHostMessageContainsType(
                                                message, L"vf_native_frame_media_capture_v1")) {
                                            const bool written =
                                                WriteNativeFrameCaptureEvidence(message);
                                            const bool reported_success =
                                                message.find(L"\"status\":\"ok\"") !=
                                                std::wstring::npos;
                                            const bool frame_count_matches =
                                                g_native_frame_capture_time_samples == 0u ||
                                                g_native_frame_capture_frames_written ==
                                                    g_native_frame_capture_time_samples;
                                            const bool succeeded = reported_success && frame_count_matches;
                                            if (!written || !succeeded) {
                                                AppendErrorLogRecord(
                                                    "error",
                                                    "frame_capture",
                                                    !written
                                                        ? "frame capture evidence could not be written"
                                                        : !frame_count_matches
                                                            ? "frame capture count did not match requested samples"
                                                            : "frame capture reported an error",
                                                    WideToUtf8(message));
                                            }
                                            g_exit_code.store(written && succeeded ? 0 : 1);
                                            PostMessageW(window, WM_CLOSE, 0, 0);
                                            return S_OK;
                                        }
                                        if (vf::ReleaseHostMessageContainsType(message, L"vf_startup_stage_v1")) {
                                            if (message.find(L"web_interactive_ready") != std::wstring::npos) {
                                                TraceStartupStage("web_interactive_ready");
                                            } else if (message.find(L"wasm_scene_ready") != std::wstring::npos) {
                                                TraceStartupStage("wasm_scene_ready");
                                            } else if (message.find(L"first_gpu_frame_ready") != std::wstring::npos) {
                                                TraceStartupStage("first_gpu_frame_ready");
                                            }
                                        }
                                        if (vf::ReleaseHostMessageContainsType(message, L"vf_log")) {
                                            TraceRuntimeWebMessage(message);
                                            AppendRuntimeLogMessage(message);
                                        }
                                        if (vf::ReleaseHostMessageContainsType(message, L"vf-ui-ready")) {
                                            TraceRuntimeWebMessage(message);
                                        }
                                        bool always_on_top = false;
                                        if (vf::ReleaseHostMessageIndicatesContentReady(message)) {
                                            MarkContentReady();
                                        } else if (
                                            vf::ReleaseHostMessageTryWindowTopmost(
                                                message,
                                                &always_on_top)) {
                                            SetWindowPos(
                                                window,
                                                always_on_top
                                                    ? HWND_TOPMOST
                                                    : HWND_NOTOPMOST,
                                                0,
                                                0,
                                                0,
                                                0,
                                                SWP_NOMOVE | SWP_NOSIZE |
                                                    SWP_NOACTIVATE);
                                        } else if (vf::ReleaseHostMessageContainsType(message, L"close")) {
                                            PostMessageW(window, WM_CLOSE, 0, 0);
                                        } else if (vf::ReleaseHostMessageContainsType(message, L"minimize")) {
                                            ShowWindow(window, SW_MINIMIZE);
                                        } else if (vf::ReleaseHostMessageContainsType(message, L"restore")) {
                                            ShowWindow(window, SW_RESTORE);
                                        } else if (g_adapter.ApplyHitRegionAdapterMessage(message)) {
                                            SyncHostInputRegion();
                                        } else if (vf::ReleaseHostMessageContainsType(message, L"vf_event")) {
                                            const std::string bytes = WideToUtf8(message);
                                            if (!bytes.empty()) g_adapter.PushOpaqueEvent(bytes);
                                        }
                                        return S_OK;
                                    }).Get(),
                                nullptr);

                            g_webview->add_NavigationCompleted(
                                Callback<ICoreWebView2NavigationCompletedEventHandler>(
                                    [](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs*) -> HRESULT {
                                        TraceStartupStage("navigation_completed");
                                        PublishEventSharedBuffer();
                                        SyncHostInputRegion();
                                        return S_OK;
                                    }).Get(),
                                nullptr);

                            ResizeController();
                            const std::wstring uri = std::wstring(L"https://") + kResourceHost + L"/" + g_page;
                            if (g_offscreen_camera_benchmark || g_native_frame_capture) {
                                std::wstring script = RuntimeErrorCaptureScript();
                                if (g_native_frame_capture) {
                                    script += g_native_frame_capture_time_samples > 1u
                                        ? L"globalThis.__vfNativeFrameMediaCapture=Object.freeze({mode:\"time\",frameCount:" +
                                            std::to_wstring(g_native_frame_capture_time_samples) + L"});"
                                        : L"globalThis.__vfNativeFrameMediaCapture=Object.freeze({states:[\"camera-default\",\"camera-wheel-detail\"]});";
                                } else {
                                    script += L"globalThis.__vfOffscreenCameraBenchmark=Object.freeze({sampleCount:" +
                                        std::to_wstring(g_offscreen_camera_benchmark_samples) +
                                        L",warmupCount:3});";
                                }
                                const HRESULT script_result =
                                    g_webview->AddScriptToExecuteOnDocumentCreated(
                                        script.c_str(),
                                        Callback<
                                            ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                                            [window, uri](HRESULT error, LPCWSTR) -> HRESULT {
                                                if (FAILED(error)) {
                                                    FailStartup(window, "document_start_script", error);
                                                    return error;
                                                }
                                                TraceStartupStage("navigation_started");
                                                const HRESULT navigate_result =
                                                    g_webview->Navigate(uri.c_str());
                                                if (FAILED(navigate_result)) {
                                                    FailStartup(window, "webview_navigate", navigate_result);
                                                }
                                                return navigate_result;
                                            }).Get());
                                if (FAILED(script_result)) {
                                    FailStartup(window, "document_start_script", script_result);
                                }
                                return script_result;
                            }
                            const HRESULT script_result =
                                g_webview->AddScriptToExecuteOnDocumentCreated(
                                    RuntimeErrorCaptureScript(),
                                    Callback<
                                        ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                                        [window, uri](HRESULT error, LPCWSTR) -> HRESULT {
                                            if (FAILED(error)) {
                                                FailStartup(window, "document_start_script", error);
                                                return error;
                                            }
                                            TraceStartupStage("navigation_started");
                                            const HRESULT navigate_result = g_webview->Navigate(uri.c_str());
                                            if (FAILED(navigate_result)) {
                                                FailStartup(window, "webview_navigate", navigate_result);
                                            }
                                            return navigate_result;
                                        }).Get());
                            if (FAILED(script_result)) {
                                FailStartup(window, "document_start_script", script_result);
                            }
                            return script_result;
                        }).Get());
            }).Get());
    if (FAILED(environment_result)) {
        FailStartup(window, "webview_environment_request", environment_result);
    }
}

} // namespace

int VfOverlayRun(HINSTANCE instance, const VfOverlayHostLaunch& launch, int show) {
    InitializeStartupTrace();
    InitializeErrorLog();
    g_exit_code.store(0);
    g_content_revealed = false;
    g_prewarm_content_ready = false;
    g_prewarm_launch_requested = false;
    g_prewarm_shutting_down.store(false, std::memory_order_release);
    const std::wstring prewarm_event_name = EnvironmentValue(L"VKF_PREWARM_LAUNCH_EVENT");
    const std::wstring prewarm_ready_event_name = EnvironmentValue(L"VKF_PREWARM_READY_EVENT");
    g_prewarm_launch_event = prewarm_event_name.empty()
        ? nullptr
        : CreateEventW(nullptr, FALSE, FALSE, prewarm_event_name.c_str());
    g_prewarm_ready_event = prewarm_ready_event_name.empty()
        ? nullptr
        : CreateEventW(nullptr, TRUE, FALSE, prewarm_ready_event_name.c_str());
    g_prewarm_probe = g_prewarm_launch_event != nullptr;
    const std::wstring offscreen_benchmark_path =
        EnvironmentValue(L"VKF_OFFSCREEN_CAMERA_BENCHMARK_PATH");
    g_offscreen_camera_benchmark_path = std::filesystem::path(offscreen_benchmark_path);
    g_offscreen_camera_benchmark = !g_offscreen_camera_benchmark_path.empty();
    g_offscreen_camera_benchmark_samples = BoundedEnvironmentCount(
        L"VKF_OFFSCREEN_CAMERA_BENCHMARK_SAMPLES", 30u, 240u);
    const std::wstring native_frame_capture_path =
        EnvironmentValue(L"VKF_NATIVE_FRAME_CAPTURE_PATH");
    g_native_frame_capture_path = std::filesystem::path(native_frame_capture_path);
    g_native_frame_capture = !g_native_frame_capture_path.empty();
    g_native_frame_capture_time_samples = g_native_frame_capture
        ? BoundedEnvironmentCount(L"VKF_NATIVE_FRAME_CAPTURE_TIME_SAMPLES", 0u, 360u)
        : 0u;
    g_native_frame_capture_frames_written = 0u;
    g_web_root = launch.webRoot == nullptr ? std::wstring{} : launch.webRoot;
    g_page = NormalizePage(launch.pageArg);
    if (g_web_root.empty() || g_page.empty() ||
        !std::filesystem::is_directory(std::filesystem::path(g_web_root))) {
        return 1;
    }

    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    vf::InstallCrashDiagnostics(L"vf-release-overlay", []() {
        return std::string("adapter=resource-only\n");
    });

    const HRESULT com_result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(com_result) && com_result != RPC_E_CHANGED_MODE) {
        return 1;
    }

    WNDCLASSEXW window_class{};
    window_class.cbSize = sizeof(window_class);
    window_class.hInstance = instance;
    window_class.lpfnWndProc = WindowProc;
    window_class.lpszClassName = kWindowClass;
    window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    window_class.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
    if (window_class.hIcon == nullptr) {
        window_class.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    }
    window_class.hIconSm = window_class.hIcon;
    RegisterClassExW(&window_class);

    const std::uint32_t screen_width =
        static_cast<std::uint32_t>(GetSystemMetrics(SM_CXSCREEN));
    const std::uint32_t screen_height =
        static_cast<std::uint32_t>(GetSystemMetrics(SM_CYSCREEN));
    const int width = static_cast<int>(g_native_frame_capture
        ? BoundedEnvironmentCount(L"VKF_NATIVE_FRAME_CAPTURE_WIDTH", screen_width, screen_width)
        : screen_width);
    const int height = static_cast<int>(g_native_frame_capture
        ? BoundedEnvironmentCount(L"VKF_NATIVE_FRAME_CAPTURE_HEIGHT", screen_height, screen_height)
        : screen_height);
    const DWORD extended_style = g_prewarm_probe
        ? (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST)
        : WS_EX_APPWINDOW;
    const DWORD effective_extended_style =
        (g_offscreen_camera_benchmark || g_native_frame_capture)
        ? (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)
        : extended_style;
    g_window = CreateWindowExW(
        effective_extended_style,
        kWindowClass,
        L"Vektor Flow",
        WS_POPUP,
        0,
        0,
        width,
        height,
        nullptr,
        nullptr,
        instance,
        nullptr);
    if (g_window == nullptr) {
        if (SUCCEEDED(com_result)) {
            CoUninitialize();
        }
        return 1;
    }
    TraceStartupStage("window_created");

    if (FAILED(InitializeComposition(g_window))) {
        DestroyWindow(g_window);
        if (SUCCEEDED(com_result)) CoUninitialize();
        return 1;
    }
    // The host must stay active so WebView and WebGPU can complete startup, but
    // the DirectComposition tree remains atomically transparent until the web
    // runtime publishes contentReady with already-installed input regions.
    const int effective_show = g_prewarm_probe ||
        g_offscreen_camera_benchmark || g_native_frame_capture
        ? SW_SHOWNOACTIVATE
        : EffectiveShow(show);
    SyncHostInputRegion();
    ShowWindow(g_window, effective_show);
    UpdateWindow(g_window);
    if (g_prewarm_probe && !g_native_frame_capture) {
        SetTimer(g_window, kPrewarmTtlTimerId, kPrewarmHostTtlMs, nullptr);
        g_prewarm_wait_thread = CreateThread(
            nullptr, 0, WaitForPooledLaunchSignal, g_window, 0, nullptr);
    }
    SendMessageW(g_window, WM_SETICON, ICON_BIG,
                 reinterpret_cast<LPARAM>(window_class.hIcon));
    SendMessageW(g_window, WM_SETICON, ICON_SMALL,
                 reinterpret_cast<LPARAM>(window_class.hIconSm));
    StartWebView(g_window);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    if (SUCCEEDED(com_result)) {
        CoUninitialize();
    }
    return static_cast<int>(message.wParam);
}

int VfOverlayRun(HINSTANCE instance, const wchar_t* page, int show) {
    const VfOverlayHostLaunch launch{page, nullptr};
    return VfOverlayRun(instance, launch, show);
}

VF_OVERLAY_API int VfOverlayRunDll(HINSTANCE instance, const wchar_t* page, const wchar_t* web_root, int show) {
    const VfOverlayHostLaunch launch{page, web_root};
    return VfOverlayRun(instance, launch, show);
}

#ifndef VF_OVERLAY_NO_STANDALONE_MAIN
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR command_line, int show) {
    std::wstring web_root;
    wchar_t executable[MAX_PATH]{};
    const DWORD length = GetModuleFileNameW(nullptr, executable, MAX_PATH);
    if (length > 0 && length < MAX_PATH) {
        web_root = (std::filesystem::path(executable).parent_path() / L"web").wstring();
    }
    const VfOverlayHostLaunch launch{command_line, web_root.c_str()};
    return VfOverlayRun(instance, launch, show);
}
#endif
