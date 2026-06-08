#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>

#include <algorithm>
#include <cwctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "embedded_vf_ui_assets.hpp"
#include "transparent_overlay/overlay.h"

namespace fs = std::filesystem;

namespace {

std::string ReadFileBytes(const fs::path& path);

std::wstring Quote(const std::wstring& value) {
    std::wstring out = L"\"";
    for (wchar_t ch : value) {
        if (ch == L'"') {
            out += L"\\\"";
        } else {
            out += ch;
        }
    }
    out += L"\"";
    return out;
}

std::string WideToUtf8(const std::wstring& text) {
    if (text.empty()) {
        return {};
    }
    const int required = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
    if (required <= 0) {
        return {};
    }
    std::string out(static_cast<size_t>(required), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), required, nullptr, nullptr);
    return out;
}

std::wstring Utf8ToWide(const std::string& text) {
    if (text.empty()) {
        return {};
    }
    const int required = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (required <= 0) {
        return {};
    }
    std::wstring out(static_cast<size_t>(required), L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), out.data(), required);
    return out;
}

std::wstring ToLowerAscii(std::wstring value) {
    for (wchar_t& ch : value) {
        if (ch >= L'A' && ch <= L'Z') {
            ch = static_cast<wchar_t>(ch - L'A' + L'a');
        }
    }
    return value;
}

std::wstring Slugify(const std::wstring& stem) {
    std::wstring out;
    bool lastWasDash = false;
    for (wchar_t ch : ToLowerAscii(stem)) {
        const bool asciiAlpha = (ch >= L'a' && ch <= L'z');
        const bool asciiDigit = (ch >= L'0' && ch <= L'9');
        if (asciiAlpha || asciiDigit) {
            out += ch;
            lastWasDash = false;
        } else if (!lastWasDash && !out.empty()) {
            out += L'-';
            lastWasDash = true;
        }
    }
    while (!out.empty() && out.back() == L'-') {
        out.pop_back();
    }
    return out.empty() ? L"scene" : out;
}

fs::path CurrentExePath() {
    std::wstring buffer(MAX_PATH, L'\0');
    DWORD written = 0;
    while (true) {
        written = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (written == 0) {
            return {};
        }
        if (written < buffer.size() - 1) {
            buffer.resize(written);
            return fs::path(buffer);
        }
        buffer.resize(buffer.size() * 2);
    }
}

fs::path LocalAppDataPath() {
    DWORD required = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
    if (required == 0) {
        return {};
    }
    std::wstring value(static_cast<size_t>(required), L'\0');
    DWORD written = GetEnvironmentVariableW(L"LOCALAPPDATA", value.data(), required);
    if (written == 0 || written >= required) {
        return {};
    }
    value.resize(written);
    return fs::path(value);
}

bool SafeRelativeAssetPath(const char* relativePath, fs::path* out) {
    if (!relativePath || !*relativePath || !out) {
        return false;
    }
    std::string relUtf8(relativePath);
    if (relUtf8.find('\\') != std::string::npos) {
        return false;
    }
    fs::path result;
    size_t start = 0;
    while (start <= relUtf8.size()) {
        const size_t slash = relUtf8.find('/', start);
        const std::string part = relUtf8.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
        if (part.empty() || part == "." || part == ".." || part.find(':') != std::string::npos) {
            return false;
        }
        const std::wstring wide = Utf8ToWide(part);
        if (wide.empty()) {
            return false;
        }
        result /= wide;
        if (slash == std::string::npos) {
            break;
        }
        start = slash + 1;
    }
    *out = result;
    return true;
}

bool WriteEmbeddedResourceToFile(int resourceId, unsigned long long expectedSize, const fs::path& target, std::wstring* error) {
    HMODULE module = GetModuleHandleW(nullptr);
    HRSRC resource = FindResourceW(module, MAKEINTRESOURCEW(resourceId), RT_RCDATA);
    if (!resource) {
        if (error) { *error = L"embedded vf-ui resource missing: " + std::to_wstring(resourceId); }
        return false;
    }
    HGLOBAL loaded = LoadResource(module, resource);
    if (!loaded) {
        if (error) { *error = L"failed to load embedded vf-ui resource: " + std::to_wstring(resourceId); }
        return false;
    }
    const DWORD size = SizeofResource(module, resource);
    if (static_cast<unsigned long long>(size) != expectedSize) {
        if (error) { *error = L"embedded vf-ui resource size mismatch: " + std::to_wstring(resourceId); }
        return false;
    }
    const void* data = LockResource(loaded);
    if (!data && size > 0) {
        if (error) { *error = L"failed to lock embedded vf-ui resource: " + std::to_wstring(resourceId); }
        return false;
    }
    std::error_code ec;
    fs::create_directories(target.parent_path(), ec);
    if (ec) {
        if (error) {
            const std::string detail = ec.message();
            *error = L"failed to create embedded vf-ui directory " + target.parent_path().wstring() + L": " +
                     std::wstring(detail.begin(), detail.end());
        }
        return false;
    }
    std::ofstream out(target, std::ios::binary | std::ios::trunc);
    if (!out) {
        if (error) { *error = L"failed to open embedded vf-ui output: " + target.wstring(); }
        return false;
    }
    out.write(static_cast<const char*>(data), static_cast<std::streamsize>(size));
    if (!out) {
        if (error) { *error = L"failed to write embedded vf-ui output: " + target.wstring(); }
        return false;
    }
    return true;
}

fs::path EnsureEmbeddedVfUiWebRoot(std::wstring* error) {
    if (kVfEmbeddedVfUiAssetCount == 0 || !kVfEmbeddedVfUiVersion || !*kVfEmbeddedVfUiVersion) {
        if (error) { *error = L"vkf was built without embedded vf-ui assets"; }
        return {};
    }
    const fs::path appData = LocalAppDataPath();
    if (appData.empty()) {
        if (error) { *error = L"LOCALAPPDATA is not set; cannot create private vkf runtime asset cache"; }
        return {};
    }
    const std::wstring version = Utf8ToWide(kVfEmbeddedVfUiVersion);
    if (version.empty()) {
        if (error) { *error = L"embedded vf-ui asset version is not valid UTF-8"; }
        return {};
    }
    const fs::path webRoot = appData / L"vektor-flow" / L"vkf" / L"web" / version;
    const fs::path marker = webRoot / L".vf-ui-version";
    std::error_code ec;
    if (fs::exists(marker, ec) && fs::exists(webRoot / L"index.html", ec)) {
        const std::string markerText = ReadFileBytes(marker);
        if (markerText == std::string(kVfEmbeddedVfUiVersion)) {
            return webRoot;
        }
    }
    fs::remove(marker, ec);
    for (std::size_t i = 0; i < kVfEmbeddedVfUiAssetCount; i += 1) {
        const VfEmbeddedAsset& asset = kVfEmbeddedVfUiAssets[i];
        fs::path relative;
        if (!SafeRelativeAssetPath(asset.relative_path, &relative)) {
            if (error) { *error = L"embedded vf-ui asset has unsafe path"; }
            return {};
        }
        if (!WriteEmbeddedResourceToFile(asset.resource_id, asset.size, webRoot / relative, error)) {
            return {};
        }
    }
    std::ofstream markerOut(marker, std::ios::binary | std::ios::trunc);
    if (!markerOut) {
        if (error) { *error = L"failed to write embedded vf-ui version marker: " + marker.wstring(); }
        return {};
    }
    markerOut << kVfEmbeddedVfUiVersion;
    return webRoot;
}

bool IsVfOverlayExe(const fs::path& path) {
    std::error_code ec;
    return fs::exists(path, ec) && fs::is_regular_file(path, ec);
}

fs::path FindRepoRootFrom(const fs::path& start) {
    std::error_code ec;
    fs::path current = fs::absolute(start, ec);
    if (ec) {
        current = start;
    }
    if (fs::is_regular_file(current, ec)) {
        current = current.parent_path();
    }
    while (!current.empty()) {
        if (fs::exists(current / L"pyproject.toml", ec) &&
            fs::exists(current / L"native" / L"VfOverlay", ec) &&
            fs::exists(current / L"web" / L"vf-ui", ec)) {
            return current;
        }
        fs::path parent = current.parent_path();
        if (parent == current) {
            break;
        }
        current = parent;
    }
    return {};
}

fs::path FindOverlayExe(const fs::path& repoRoot, const fs::path& self) {
    std::vector<fs::path> candidates = {
        self.parent_path() / L"vf-overlay.exe",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Release" / L"vf-overlay.exe",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Debug" / L"vf-overlay.exe",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"vf-overlay.exe",
    };
    for (const fs::path& candidate : candidates) {
        if (IsVfOverlayExe(candidate)) {
            return fs::absolute(candidate);
        }
    }
    return {};
}

fs::path FindNativeSceneStager(const fs::path& repoRoot, const fs::path& self) {
    std::vector<fs::path> candidates = {
        self.parent_path() / L"vkf-native-scene-artifact-stager.exe",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Release" / L"vkf-native-scene-artifact-stager.exe",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Debug" / L"vkf-native-scene-artifact-stager.exe",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"vkf-native-scene-artifact-stager.exe",
    };
    std::error_code ec;
    for (const fs::path& candidate : candidates) {
        if (fs::exists(candidate, ec) && fs::is_regular_file(candidate, ec)) {
            return fs::absolute(candidate);
        }
    }
    return {};
}

fs::path FindRuntimeWebRoot(const fs::path& repoRoot, const fs::path& self) {
    std::wstring embeddedError;
    const fs::path embeddedRoot = EnsureEmbeddedVfUiWebRoot(&embeddedError);
    if (!embeddedRoot.empty()) {
        return fs::absolute(embeddedRoot);
    }
    if (kVfEmbeddedVfUiAssetCount > 0) {
        if (!embeddedError.empty()) {
            std::wcerr << L"vkf: " << embeddedError << std::endl;
        }
        return {};
    }
    std::vector<fs::path> candidates = {
        self.parent_path() / L"web",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Release" / L"web",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Debug" / L"web",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"web",
    };
    std::error_code ec;
    for (const fs::path& candidate : candidates) {
        if (fs::exists(candidate / L"index.html", ec) && fs::is_regular_file(candidate / L"index.html", ec)) {
            return fs::absolute(candidate);
        }
    }
    return {};
}

fs::path FindTransparentOverlayDll(const fs::path& repoRoot, const fs::path& self) {
    std::vector<fs::path> candidates = {
        self.parent_path() / L"TransparentOverlay.dll",
        repoRoot / L"native" / L"transparent-overlay-runtime" / L"windows" / L"x64" / L"TransparentOverlay.dll",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Release" / L"TransparentOverlay.dll",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Debug" / L"TransparentOverlay.dll",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"TransparentOverlay.dll",
    };
    std::error_code ec;
    for (const fs::path& candidate : candidates) {
        if (fs::exists(candidate, ec) && fs::is_regular_file(candidate, ec)) {
            return fs::absolute(candidate);
        }
    }
    return {};
}

fs::path FindTransparentOverlayHost(const fs::path& repoRoot, const fs::path& self) {
    std::vector<fs::path> candidates = {
        self.parent_path() / L"transparent-overlay-host.exe",
        repoRoot / L"native" / L"transparent-overlay-runtime" / L"windows" / L"x64" / L"transparent-overlay-host.exe",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Release" / L"transparent-overlay-host.exe",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"Debug" / L"transparent-overlay-host.exe",
        repoRoot / L"native" / L"VfOverlay" / L"build" / L"transparent-overlay-host.exe",
    };
    std::error_code ec;
    for (const fs::path& candidate : candidates) {
        if (fs::exists(candidate, ec) && fs::is_regular_file(candidate, ec)) {
            return fs::absolute(candidate);
        }
    }
    return {};
}

bool NewerThan(const fs::path& left, const fs::path& right) {
    std::error_code ecLeft;
    std::error_code ecRight;
    const auto leftTime = fs::last_write_time(left, ecLeft);
    const auto rightTime = fs::last_write_time(right, ecRight);
    if (ecLeft || ecRight) {
        return false;
    }
    return leftTime > rightTime;
}

int Fail(const std::wstring& message) {
    std::wcerr << L"vkf: " << message << std::endl;
    return 1;
}

fs::path SourceFromRunnerExe(const fs::path& self) {
    return self.parent_path() / (self.stem().wstring() + L".vkf");
}

fs::path TargetExeForSource(const fs::path& source) {
    return source.parent_path() / (source.stem().wstring() + L".exe");
}

fs::path SessionPageForSource(const fs::path& overlayExe, const fs::path& source) {
    const std::wstring slug = Slugify(source.stem().wstring());
    return overlayExe.parent_path() / L"web" / L"sessions" / slug / L"vkf-scene.html";
}

fs::path SessionPageForWebRoot(const fs::path& webRoot, const fs::path& source) {
    const std::wstring slug = Slugify(source.stem().wstring());
    return webRoot / L"sessions" / slug / L"vkf-scene.html";
}

std::wstring SessionPageArgForSource(const fs::path& source) {
    const std::wstring slug = Slugify(source.stem().wstring());
    return L"sessions/" + slug + L"/vkf-scene.html";
}

fs::path ManifestPathForSource(const fs::path& source) {
    return source.parent_path() / L".vkfbuild" / (source.stem().wstring() + L".manifest.json");
}

std::string ReadFileBytes(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return {};
    }
    std::ostringstream out;
    out << in.rdbuf();
    return out.str();
}

std::string Fnv1a64Hex(const std::string& bytes) {
    std::uint64_t hash = 14695981039346656037ull;
    for (unsigned char byte : bytes) {
        hash ^= static_cast<std::uint64_t>(byte);
        hash *= 1099511628211ull;
    }
    std::ostringstream out;
    out << std::hex << std::setw(16) << std::setfill('0') << hash;
    return out.str();
}

std::string NativeSceneSourceTreeBytes(const fs::path& source) {
    std::error_code ec;
    const fs::path absoluteSource = fs::absolute(source, ec);
    const fs::path sourceForHash = ec ? source : absoluteSource;
    std::string bytes;
    bytes.append("source\0", 7);
    bytes += sourceForHash.generic_string();
    bytes.push_back('\0');
    bytes += ReadFileBytes(sourceForHash);

    const fs::path libDir = sourceForHash.parent_path() / L"lib";
    if (!fs::exists(libDir, ec)) {
        return bytes;
    }
    std::vector<fs::path> dependencies;
    for (fs::recursive_directory_iterator it(libDir, ec), end; !ec && it != end; it.increment(ec)) {
        if (ec || !it->is_regular_file(ec)) {
            continue;
        }
        const fs::path path = it->path();
        if (ToLowerAscii(path.extension().wstring()) == L".vkf") {
            dependencies.push_back(fs::absolute(path, ec));
            ec.clear();
        }
    }
    std::sort(dependencies.begin(), dependencies.end(), [](const fs::path& a, const fs::path& b) {
        return a.generic_string() < b.generic_string();
    });
    for (const fs::path& dependency : dependencies) {
        bytes.append("\ndependency\0", 12);
        bytes += dependency.generic_string();
        bytes.push_back('\0');
        bytes += ReadFileBytes(dependency);
    }
    return bytes;
}

bool ManifestContainsSourceHash(const fs::path& manifest, const std::string& sourceHash) {
    std::error_code ec;
    if (!fs::exists(manifest, ec)) {
        return false;
    }
    const std::string text = ReadFileBytes(manifest);
    if (text.empty()) {
        return false;
    }
    return text.find("\"source_hash\":\"" + sourceHash + "\"") != std::string::npos ||
           text.find("\"source_hash\": \"" + sourceHash + "\"") != std::string::npos;
}

bool SessionBundleCurrent(const fs::path& source, const fs::path& page, const fs::path& stager) {
    std::error_code ec;
    if (!fs::exists(page, ec)) {
        return false;
    }
    if (NewerThan(source, page)) {
        return false;
    }
    (void)stager;
    const fs::path webRoot = page.parent_path().parent_path().parent_path();
    if (NewerThan(webRoot / L"vf-runtime-shell.js", page) ||
        NewerThan(webRoot / L"vf-native-scene.js", page)) {
        return false;
    }
    const std::string html = ReadFileBytes(page);
    std::string configText;
    const std::string configMarker = "window.__vfNativeSceneConfigsUrl=\"";
    const size_t configStart = html.find(configMarker);
    if (configStart != std::string::npos) {
        const size_t valueStart = configStart + configMarker.size();
        const size_t valueEnd = html.find('"', valueStart);
        if (valueEnd == std::string::npos || valueEnd == valueStart) {
            return false;
        }
        const std::string configName = html.substr(valueStart, valueEnd - valueStart);
        if (configName.find('/') != std::string::npos || configName.find('\\') != std::string::npos) {
            return false;
        }
        const fs::path configPath = page.parent_path() / fs::path(std::wstring(configName.begin(), configName.end()));
        if (!fs::exists(configPath, ec) || !fs::is_regular_file(configPath, ec)) {
            return false;
        }
        configText = ReadFileBytes(configPath);
    }
    const std::string arenaMarker = "window.__vfNativeSceneArenaUrl=\"";
    const size_t arenaStart = html.find(arenaMarker);
    if (arenaStart != std::string::npos) {
        const size_t valueStart = arenaStart + arenaMarker.size();
        const size_t valueEnd = html.find('"', valueStart);
        if (valueEnd == std::string::npos) {
            return false;
        }
        const std::string arenaName = html.substr(valueStart, valueEnd - valueStart);
        if (arenaName.empty()) {
            return true;
        }
        if (arenaName.find('/') != std::string::npos || arenaName.find('\\') != std::string::npos) {
            return false;
        }
        const fs::path arenaPath = page.parent_path() / fs::path(std::wstring(arenaName.begin(), arenaName.end()));
        if (!fs::exists(arenaPath, ec) || !fs::is_regular_file(arenaPath, ec)) {
            return false;
        }
    }
    return true;
}

int LaunchProcess(const fs::path& exe, const std::wstring& args, const fs::path& workingDir, bool wait) {
    std::wstring commandLine = Quote(exe.wstring());
    if (!args.empty()) {
        commandLine += L" ";
        commandLine += args;
    }

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    std::wstring mutableCommandLine = commandLine;
    std::wstring cwd = workingDir.wstring();

    if (!CreateProcessW(
            exe.c_str(),
            mutableCommandLine.data(),
            nullptr,
            nullptr,
            FALSE,
            0,
            nullptr,
            cwd.empty() ? nullptr : cwd.c_str(),
            &startup,
            &process)) {
        std::wcerr << L"vkf: failed to launch " << exe << L" (GetLastError=" << GetLastError() << L")" << std::endl;
        return 1;
    }

    DWORD exitCode = 0;
    if (wait) {
        WaitForSingleObject(process.hProcess, INFINITE);
        GetExitCodeProcess(process.hProcess, &exitCode);
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return static_cast<int>(exitCode);
}

int StageNativeSceneArtifacts(const fs::path& source, const fs::path& self) {
    std::error_code ec;
    fs::path repoRoot = FindRepoRootFrom(source);
    if (repoRoot.empty()) {
        repoRoot = FindRepoRootFrom(self);
    }
    if (repoRoot.empty()) {
        return Fail(L"could not locate repository root for native scene staging");
    }
    const fs::path overlayWeb = FindRuntimeWebRoot(repoRoot, self);
    if (overlayWeb.empty()) {
        return Fail(L"overlay web assets not found; build native/VfOverlay first");
    }
    const fs::path stager = FindNativeSceneStager(repoRoot, self);
    if (stager.empty()) {
        return Fail(L"native scene artifact stager not found; build vkf-native-scene-artifact-stager first");
    }
    const std::wstring args =
        L"--source " + Quote(fs::absolute(source, ec).wstring()) +
        L" --overlay-web " + Quote(overlayWeb.wstring());
    return LaunchProcess(stager, args, stager.parent_path(), true);
}

int EnsureExampleExeCurrent(const fs::path& self, const fs::path& source, const fs::path& target) {
    std::error_code ec;
    const bool targetMissing = !fs::exists(target, ec);
    const bool targetStale = targetMissing || NewerThan(source, target) || NewerThan(self, target);
    if (!targetStale) {
        return 0;
    }

    fs::copy_file(self, target, fs::copy_options::overwrite_existing, ec);
    if (ec) {
        const std::string detail = ec.message();
        return Fail(
            std::wstring(L"native compile failed while writing ") +
            target.wstring() +
            L": " +
            std::wstring(detail.begin(), detail.end()));
    }
    std::wcout << L"vkf: compiled native runner " << target << std::endl;
    return 0;
}

int EnsureOverlayRuntimeDependency(const fs::path& self, const fs::path& source, const fs::path& target) {
    fs::path repoRoot = FindRepoRootFrom(source);
    if (repoRoot.empty()) {
        repoRoot = FindRepoRootFrom(self);
    }
    const fs::path dll = FindTransparentOverlayDll(repoRoot, self);
    if (dll.empty()) {
        return Fail(L"TransparentOverlay.dll not found next to vkf.exe; rebuild native/VfOverlay");
    }
    const fs::path host = FindTransparentOverlayHost(repoRoot, self);
    if (host.empty()) {
        return Fail(L"transparent-overlay-host.exe not found next to vkf.exe; rebuild native/VfOverlay");
    }
    std::error_code ec;
    const fs::path destination = target.parent_path() / L"TransparentOverlay.dll";
    fs::copy_file(dll, destination, fs::copy_options::overwrite_existing, ec);
    if (ec) {
        const std::string detail = ec.message();
        return Fail(
            std::wstring(L"failed to copy TransparentOverlay.dll to ") +
            destination.wstring() +
            L": " +
            std::wstring(detail.begin(), detail.end()));
    }
    const fs::path hostDestination = target.parent_path() / L"transparent-overlay-host.exe";
    fs::copy_file(host, hostDestination, fs::copy_options::overwrite_existing, ec);
    if (ec) {
        const std::string detail = ec.message();
        return Fail(
            std::wstring(L"failed to copy transparent-overlay-host.exe to ") +
            hostDestination.wstring() +
            L": " +
            std::wstring(detail.begin(), detail.end()));
    }
    return 0;
}

struct NativeSceneBundle {
    fs::path source;
    fs::path repoRoot;
    fs::path webRoot;
    fs::path page;
};

bool TryResolveCurrentSceneBundle(const fs::path& source, const fs::path& self, NativeSceneBundle* bundle) {
    std::error_code ec;
    const fs::path absoluteSource = fs::absolute(source, ec);
    if (ec || !fs::exists(absoluteSource, ec)) {
        Fail(L"source not found: " + source.wstring());
        return false;
    }

    fs::path repoRoot = FindRepoRootFrom(absoluteSource);
    if (repoRoot.empty()) {
        repoRoot = FindRepoRootFrom(self);
    }
    if (repoRoot.empty()) {
        Fail(L"could not locate repository root for native runtime assets");
        return false;
    }

    const fs::path webRoot = FindRuntimeWebRoot(repoRoot, self);
    if (webRoot.empty()) {
        Fail(L"overlay web assets not found; build native/VfOverlay first");
        return false;
    }

    const fs::path page = SessionPageForWebRoot(webRoot, absoluteSource);
    const fs::path manifest = ManifestPathForSource(absoluteSource);
    const std::string sourceHash = Fnv1a64Hex(NativeSceneSourceTreeBytes(absoluteSource));
    if (!ManifestContainsSourceHash(manifest, sourceHash)) {
        Fail(
            L"compiled artifact manifest missing or stale: " + manifest.wstring() +
            L"\n     Native staleness check did not start Python. Compile with the native VKF compiler, then run again.");
        return false;
    }
    const fs::path stager = FindNativeSceneStager(repoRoot, self);
    if (!SessionBundleCurrent(absoluteSource, page, stager)) {
        Fail(
            L"compiled scene bundle missing or stale: " + page.wstring() +
            L"\n     Native staleness check did not start Python. Build the VKF scene with the native compiler/stager, then run again.");
        return false;
    }

    if (bundle) {
        bundle->source = absoluteSource;
        bundle->repoRoot = repoRoot;
        bundle->webRoot = webRoot;
        bundle->page = page;
    }
    return true;
}

int RunCompiledScene(const fs::path& source) {
    NativeSceneBundle bundle{};
    if (!TryResolveCurrentSceneBundle(source, CurrentExePath(), &bundle)) {
        return 1;
    }
    const std::string webRootUtf8 = bundle.webRoot.string();
    const std::string slugUtf8 = WideToUtf8(Slugify(bundle.source.stem().wstring()));
    const std::string entryUtf8 = "/sessions/" + slugUtf8 + "/vkf-scene.html";
    TransparentOverlayRunOptions options = TransparentOverlayDefaultRunOptions();
    options.web_root_utf8 = webRootUtf8.c_str();
    options.entry_url_utf8 = entryUtf8.c_str();
    const int validation = TransparentOverlayValidateRunOptions(&options);
    if (validation != TRANSPARENT_OVERLAY_OK) {
        return Fail(L"TransparentOverlay options invalid: " + std::to_wstring(validation));
    }
    const int result = TransparentOverlayRun(&options);
    if (result != TRANSPARENT_OVERLAY_OK) {
        return Fail(L"TransparentOverlayRun failed: " + std::to_wstring(result));
    }
    return 0;
}

int BuildOrRun(const fs::path& source) {
    std::error_code ec;
    const fs::path absoluteSource = fs::absolute(source, ec);
    if (ec || !fs::exists(absoluteSource, ec)) {
        return Fail(L"source not found: " + source.wstring());
    }
    const fs::path self = CurrentExePath();
    const fs::path target = TargetExeForSource(absoluteSource);

    NativeSceneBundle bundle{};
    if (!TryResolveCurrentSceneBundle(absoluteSource, self, &bundle)) {
        const int stageResult = StageNativeSceneArtifacts(absoluteSource, self);
        if (stageResult != 0) {
            return stageResult;
        }
        if (!TryResolveCurrentSceneBundle(absoluteSource, self, &bundle)) {
            return 1;
        }
    }

    int compileResult = EnsureExampleExeCurrent(self, absoluteSource, target);
    if (compileResult != 0) {
        return compileResult;
    }
    compileResult = EnsureOverlayRuntimeDependency(self, absoluteSource, target);
    if (compileResult != 0) {
        return compileResult;
    }

    return LaunchProcess(target, L"", target.parent_path(), false);
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc >= 2) {
        const std::wstring first = argv[1] ? argv[1] : L"";
        if (first == L"--help" || first == L"-h") {
            std::wcout << L"usage: vkf <example.vkf>\n"
                       << L"       .\\example.exe\n\n"
                       << L"Native runtime only. No Python fallback." << std::endl;
            return 0;
        }
        return BuildOrRun(fs::path(first));
    }

    const fs::path self = CurrentExePath();
    const std::wstring stem = ToLowerAscii(self.stem().wstring());
    if (stem == L"vkf") {
        return Fail(L"missing source file. usage: vkf <example.vkf>");
    }
    return RunCompiledScene(SourceFromRunnerExe(self));
}
