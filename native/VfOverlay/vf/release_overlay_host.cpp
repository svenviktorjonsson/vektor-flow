#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <wrl.h>
#include <wrl/client.h>
#include <WebView2.h>
#include "WebView2EnvironmentOptions.h"

#include <algorithm>
#include <atomic>
#include <filesystem>
#include <string>

#include "../vf_overlay_host.hpp"
#include "crash_diagnostics.hpp"

namespace {

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

constexpr wchar_t kWindowClass[] = L"VfReleaseOverlayHost";
constexpr wchar_t kResourceHost[] = L"vkf.local";

HWND g_window = nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;
std::wstring g_web_root;
std::wstring g_page;
std::atomic<int> g_exit_code{0};

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

bool MessageContainsType(ICoreWebView2WebMessageReceivedEventArgs* args, const wchar_t* type) {
    LPWSTR text = nullptr;
    if (args == nullptr || FAILED(args->get_WebMessageAsJson(&text)) || text == nullptr) {
        return false;
    }
    const std::wstring json(text);
    CoTaskMemFree(text);
    const std::wstring compact = std::wstring(L"\"type\":\"") + type + L"\"";
    const std::wstring spaced = std::wstring(L"\"type\": \"") + type + L"\"";
    return json.find(compact) != std::wstring::npos || json.find(spaced) != std::wstring::npos;
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    switch (message) {
    case WM_SIZE:
        ResizeController();
        return 0;
    case WM_CLOSE:
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        g_webview.Reset();
        if (g_controller) {
            g_controller->Close();
            g_controller.Reset();
        }
        g_window = nullptr;
        PostQuitMessage(g_exit_code.load());
        return 0;
    default:
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
                return environment->CreateCoreWebView2Controller(
                    window,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [window](HRESULT controller_result, ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(controller_result) || controller == nullptr) {
                                FailStartup(window);
                                return FAILED(controller_result) ? controller_result : E_FAIL;
                            }
                            g_controller = controller;
                            if (FAILED(controller->get_CoreWebView2(&g_webview)) || !g_webview) {
                                FailStartup(window);
                                return E_FAIL;
                            }

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
                                        if (MessageContainsType(args, L"close")) {
                                            PostMessageW(window, WM_CLOSE, 0, 0);
                                        } else if (MessageContainsType(args, L"minimize")) {
                                            ShowWindow(window, SW_MINIMIZE);
                                        } else if (MessageContainsType(args, L"restore")) {
                                            ShowWindow(window, SW_RESTORE);
                                        }
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
    RegisterClassExW(&window_class);

    const int width = GetSystemMetrics(SM_CXSCREEN);
    const int height = GetSystemMetrics(SM_CYSCREEN);
    g_window = CreateWindowExW(
        WS_EX_TOOLWINDOW,
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
