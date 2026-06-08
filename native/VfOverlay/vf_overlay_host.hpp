#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#if defined(VF_OVERLAY_BUILD_DLL)
#define VF_OVERLAY_API extern "C" __declspec(dllexport)
#elif defined(VF_OVERLAY_USE_DLL)
#define VF_OVERLAY_API extern "C" __declspec(dllimport)
#else
#define VF_OVERLAY_API
#endif

/*
  Deep overlay-host seam.

  Standalone vf-overlay.exe and embedded VKF runner adapters call this same
  language-neutral host interface. VKF source/lowering stays outside the host;
  the host receives only already-packaged UI artifacts.
*/
struct VfOverlayHostLaunch {
    const wchar_t* pageArg;
    const wchar_t* webRoot;
};

int VfOverlayRun(HINSTANCE instance, const VfOverlayHostLaunch& launch, int show);
int VfOverlayRun(HINSTANCE instance, const wchar_t* pageArg, int show);

VF_OVERLAY_API int VfOverlayRunDll(HINSTANCE instance, const wchar_t* pageArg, const wchar_t* webRoot, int show);
