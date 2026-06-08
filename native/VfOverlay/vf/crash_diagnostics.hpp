#pragma once

#include <functional>
#include <string>

namespace vf {

using CrashExtraStateProvider = std::function<std::string()>;

void InstallCrashDiagnostics(const wchar_t* appName, CrashExtraStateProvider extraStateProvider);
void SetCrashBreadcrumb(const char* key, const std::string& value);
void ClearCrashBreadcrumb(const char* key);

} // namespace vf
