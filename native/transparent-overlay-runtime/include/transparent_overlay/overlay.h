#pragma once

#include <cstdint>
#include <vector>

#if defined(_WIN32) && defined(TRANSPARENT_OVERLAY_BUILD_DLL)
#define TRANSPARENT_OVERLAY_API extern "C" __declspec(dllexport)
#elif defined(_WIN32) && defined(TRANSPARENT_OVERLAY_USE_DLL)
#define TRANSPARENT_OVERLAY_API extern "C" __declspec(dllimport)
#else
#define TRANSPARENT_OVERLAY_API extern "C"
#endif

namespace transparent_overlay {

enum class Platform {
    Windows,
    MacOS,
    Linux,
    Unknown,
};

enum class Capability {
    TransparentWindow,
    AlwaysOnTop,
    ClickThrough,
    ScreenBounds,
    SharedVisualLayer,
};

enum class WindowMode : std::uint32_t {
    Regular = 0,
    AlwaysOnTop = 1,
};

struct Color {
    float red = 0.0f;
    float green = 0.0f;
    float blue = 0.0f;
    float alpha = 0.0f;
};

struct OverlayVisualSpec {
    Color clearColor{};
    bool transparent = true;
    bool clickThroughByDefault = true;
    WindowMode windowMode = WindowMode::AlwaysOnTop;
};

struct OverlayAdapterContract {
    Platform platform = Platform::Unknown;
    std::vector<Capability> capabilities{};
    OverlayVisualSpec visualSpec{};
};

const char* PlatformName(Platform platform);
OverlayVisualSpec DefaultVisualSpec();
OverlayAdapterContract CurrentPlatformContract();

}  // namespace transparent_overlay

enum TransparentOverlayWindowMode : std::uint32_t {
    TRANSPARENT_OVERLAY_WINDOW_REGULAR = 0,
    TRANSPARENT_OVERLAY_WINDOW_ALWAYS_ON_TOP = 1,
};

enum TransparentOverlayResult : std::int32_t {
    TRANSPARENT_OVERLAY_OK = 0,
    TRANSPARENT_OVERLAY_ERROR_NULL_OPTIONS = 1,
    TRANSPARENT_OVERLAY_ERROR_BAD_SIZE = 2,
    TRANSPARENT_OVERLAY_ERROR_BAD_WINDOW_MODE = 3,
    TRANSPARENT_OVERLAY_ERROR_NO_CONTENT = 4,
    TRANSPARENT_OVERLAY_ERROR_UNSUPPORTED_PLATFORM = 5,
};

struct TransparentOverlayRunOptions {
    std::uint32_t size;
    std::uint32_t window_mode;
    const char* entry_url_utf8;
    const char* web_root_utf8;
    const char* user_data_dir_utf8;
};

TRANSPARENT_OVERLAY_API std::uint32_t TransparentOverlayApiVersion();
TRANSPARENT_OVERLAY_API const char* TransparentOverlayPlatformName();
TRANSPARENT_OVERLAY_API TransparentOverlayRunOptions TransparentOverlayDefaultRunOptions();
TRANSPARENT_OVERLAY_API int TransparentOverlayValidateRunOptions(const TransparentOverlayRunOptions* options);
TRANSPARENT_OVERLAY_API int TransparentOverlayRun(const TransparentOverlayRunOptions* options);

