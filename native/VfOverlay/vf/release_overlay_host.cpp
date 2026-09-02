#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <windowsx.h>
#include <d3d11.h>
#include <dcomp.h>
#include <dxgi.h>

#include <wrl.h>
#include <wrl/client.h>
#include <WebView2.h>
#include "WebView2EnvironmentOptions.h"

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <string>

#include "../vf_overlay_host.hpp"
#include "crash_diagnostics.hpp"
#include "release_host_adapter.hpp"

namespace {

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

constexpr wchar_t kWindowClass[] = L"VfReleaseOverlayHost";
constexpr wchar_t kResourceHost[] = L"vkf.local";

HWND g_window = nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2CompositionController> g_composition_controller;
ComPtr<ICoreWebView2> g_webview;
ComPtr<ICoreWebView2Environment12> g_environment12;
ComPtr<ICoreWebView2_17> g_webview17;
ComPtr<ICoreWebView2SharedBuffer> g_event_shared_buffer;
ComPtr<ID3D11Device> g_d3d_device;
ComPtr<IDCompositionDevice> g_composition_device;
ComPtr<IDCompositionTarget> g_composition_target;
ComPtr<IDCompositionVisual> g_composition_root_visual;
ComPtr<IDCompositionVisual> g_webview_visual;
std::wstring g_web_root;
std::wstring g_page;
std::atomic<int> g_exit_code{0};
vf::ReleaseHostAdapter g_adapter;
bool g_mouse_captured = false;
bool g_tracking_mouse_leave = false;

void FailStartup(HWND window) {
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

bool IsInteractivePhysicalPoint(POINT point) {
    UINT dpi = g_window == nullptr ? USER_DEFAULT_SCREEN_DPI : GetDpiForWindow(g_window);
    if (dpi == 0u) dpi = USER_DEFAULT_SCREEN_DPI;
    const auto x = static_cast<std::int32_t>(
        MulDiv(point.x, USER_DEFAULT_SCREEN_DPI, static_cast<int>(dpi)));
    const auto y = static_cast<std::int32_t>(
        MulDiv(point.y, USER_DEFAULT_SCREEN_DPI, static_cast<int>(dpi)));
    return g_adapter.IsInteractivePoint(x, y);
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

void SyncHostInputRegion() {
    if (g_window == nullptr || g_mouse_captured) return;
    HRGN region = BuildHostInputRegion();
    if (region != nullptr && !SetWindowRgn(g_window, region, TRUE)) {
        DeleteObject(region);
    }
}

void ClearHostInputRegionForDrag() {
    if (g_window != nullptr) SetWindowRgn(g_window, nullptr, TRUE);
}

HRESULT InitializeComposition(HWND window) {
    constexpr D3D_FEATURE_LEVEL levels[] = {
        D3D_FEATURE_LEVEL_11_0,
        D3D_FEATURE_LEVEL_10_1,
    };
    D3D_FEATURE_LEVEL selected = D3D_FEATURE_LEVEL_11_0;
    HRESULT result = D3D11CreateDevice(
        nullptr,
        D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        levels,
        static_cast<UINT>(std::size(levels)),
        D3D11_SDK_VERSION,
        &g_d3d_device,
        &selected,
        nullptr);
    if (FAILED(result)) return result;

    ComPtr<IDXGIDevice> dxgi_device;
    result = g_d3d_device.As(&dxgi_device);
    if (FAILED(result)) return result;
    result = DCompositionCreateDevice(
        dxgi_device.Get(),
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
    result = g_composition_root_visual->AddVisual(
        g_webview_visual.Get(), TRUE, nullptr);
    if (FAILED(result)) return result;
    return g_composition_device->Commit();
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
    case WM_SIZE:
        ResizeController();
        SyncHostInputRegion();
        return 0;
    case WM_NCHITTEST: {
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
        if (g_mouse_captured && GetCapture() == window) ReleaseCapture();
        g_mouse_captured = false;
        g_tracking_mouse_leave = false;
        if (g_controller) {
            g_controller->Close();
            g_controller.Reset();
        }
        g_webview.Reset();
        g_webview17.Reset();
        g_event_shared_buffer.Reset();
        g_environment12.Reset();
        g_composition_controller.Reset();
        g_webview_visual.Reset();
        g_composition_root_visual.Reset();
        g_composition_target.Reset();
        g_composition_device.Reset();
        g_d3d_device.Reset();
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

    const HRESULT environment_result = CreateCoreWebView2EnvironmentWithOptions(
        nullptr,
        nullptr,
        options.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [window](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(result) || environment == nullptr) {
                    FailStartup(window);
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
                    FailStartup(window);
                    return E_FAIL;
                }
                return environment3->CreateCoreWebView2CompositionController(
                    window,
                    Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
                        [window](HRESULT controller_result,
                                 ICoreWebView2CompositionController* composition_controller) -> HRESULT {
                            if (FAILED(controller_result) || composition_controller == nullptr) {
                                FailStartup(window);
                                return FAILED(controller_result) ? controller_result : E_FAIL;
                            }
                            g_composition_controller = composition_controller;
                            if (FAILED(composition_controller->put_RootVisualTarget(g_webview_visual.Get())) ||
                                !g_composition_device || FAILED(g_composition_device->Commit())) {
                                FailStartup(window);
                                return E_FAIL;
                            }
                            ComPtr<ICoreWebView2Controller> controller;
                            if (FAILED(composition_controller->QueryInterface(IID_PPV_ARGS(&controller))) ||
                                !controller) {
                                FailStartup(window);
                                return E_FAIL;
                            }
                            g_controller = controller;
                            if (FAILED(controller->get_CoreWebView2(&g_webview)) || !g_webview) {
                                FailStartup(window);
                                return E_FAIL;
                            }
                            g_webview.As(&g_webview17);

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
                                FailStartup(window);
                                return E_FAIL;
                            }

                            g_webview->add_WebMessageReceived(
                                Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                    [window](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                        const std::wstring message = ReadWebMessage(args);
                                        bool always_on_top = false;
                                        if (vf::ReleaseHostMessageTryWindowTopmost(
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
                                        } else if (
                                            vf::ReleaseHostMessageContainsType(
                                                message,
                                                L"close")) {
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
                                        PublishEventSharedBuffer();
                                        SyncHostInputRegion();
                                        return S_OK;
                                    }).Get(),
                                nullptr);

                            ResizeController();
                            const std::wstring uri = std::wstring(L"https://") + kResourceHost + L"/" + g_page;
                            const HRESULT navigate_result = g_webview->Navigate(uri.c_str());
                            if (FAILED(navigate_result)) {
                                FailStartup(window);
                            }
                            return navigate_result;
                        }).Get());
            }).Get());
    if (FAILED(environment_result)) {
        FailStartup(window);
    }
}

} // namespace

int VfOverlayRun(HINSTANCE instance, const VfOverlayHostLaunch& launch, int show) {
    g_exit_code.store(0);
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

    const int width = GetSystemMetrics(SM_CXSCREEN);
    const int height = GetSystemMetrics(SM_CYSCREEN);
    g_window = CreateWindowExW(
        WS_EX_APPWINDOW,
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

    const int effective_show = EffectiveShow(show);
    ShowWindow(g_window, effective_show);
    UpdateWindow(g_window);
    if (FAILED(InitializeComposition(g_window))) {
        DestroyWindow(g_window);
        if (SUCCEEDED(com_result)) CoUninitialize();
        return 1;
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
