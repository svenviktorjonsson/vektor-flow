#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>
#include <tlhelp32.h>

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
#include "vf_overlay_host.hpp"

namespace fs = std::filesystem;

namespace {

std::string ReadFileBytes(const fs::path& path);
const char kSceneBundleHeader[] = "VKF_SCENE_BUNDLE_V1\n";
const char kSceneBundleFooter[] = "VKF_SCENE_BUNDLE_END_V1";
const char kNativeSceneCompilerVersion[] = "vkf-native-scene-compiler-0.1";

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
    if (kVfEmbeddedVfUiAssetCount > 0 && !embeddedError.empty()) {
        std::wcerr << L"vkf: " << embeddedError << std::endl;
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

bool SameExistingPath(const fs::path& left, const fs::path& right) {
    std::error_code ec;
    if (left.empty() || right.empty()) {
        return false;
    }
    if (fs::exists(left, ec) && fs::exists(right, ec)) {
        ec.clear();
        if (fs::equivalent(left, right, ec)) {
            return true;
        }
    }
    std::wstring a = ToLowerAscii(fs::absolute(left, ec).wstring());
    ec.clear();
    std::wstring b = ToLowerAscii(fs::absolute(right, ec).wstring());
    return !a.empty() && a == b;
}

bool ProcessImagePath(DWORD pid, fs::path* out) {
    if (!out || pid == 0 || pid == GetCurrentProcessId()) {
        return false;
    }
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) {
        return false;
    }
    std::wstring buffer(32768, L'\0');
    DWORD size = static_cast<DWORD>(buffer.size());
    const BOOL ok = QueryFullProcessImageNameW(process, 0, buffer.data(), &size);
    CloseHandle(process);
    if (!ok || size == 0) {
        return false;
    }
    buffer.resize(size);
    *out = fs::path(buffer);
    return true;
}

void StopRunningTargetExe(const fs::path& target) {
    if (target.empty()) {
        return;
    }
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) {
        return;
    }
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    for (BOOL ok = Process32FirstW(snapshot, &entry); ok; ok = Process32NextW(snapshot, &entry)) {
        if (entry.th32ProcessID == GetCurrentProcessId()) {
            continue;
        }
        fs::path image;
        if (!ProcessImagePath(entry.th32ProcessID, &image) || !SameExistingPath(image, target)) {
            continue;
        }
        HANDLE process = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, entry.th32ProcessID);
        if (!process) {
            continue;
        }
        TerminateProcess(process, 0);
        WaitForSingleObject(process, 3000);
        CloseHandle(process);
    }
    CloseHandle(snapshot);
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

bool WriteFileBytesIfChanged(const fs::path& path, const std::string& bytes) {
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    if (ec) {
        return false;
    }
    if (fs::exists(path, ec) && ReadFileBytes(path) == bytes) {
        fs::last_write_time(path, fs::file_time_type::clock::now(), ec);
        return true;
    }
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) {
        return false;
    }
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    return static_cast<bool>(out);
}

void AppendU32(std::string& out, std::uint32_t value) {
    out.push_back(static_cast<char>(value & 0xffu));
    out.push_back(static_cast<char>((value >> 8u) & 0xffu));
    out.push_back(static_cast<char>((value >> 16u) & 0xffu));
    out.push_back(static_cast<char>((value >> 24u) & 0xffu));
}

void AppendU64(std::string& out, std::uint64_t value) {
    for (int shift = 0; shift < 64; shift += 8) {
        out.push_back(static_cast<char>((value >> shift) & 0xffu));
    }
}

bool ReadU32(const std::string& bytes, size_t* pos, std::uint32_t* value) {
    if (!pos || !value || *pos + 4 > bytes.size()) { return false; }
    const unsigned char* p = reinterpret_cast<const unsigned char*>(bytes.data() + *pos);
    *value = static_cast<std::uint32_t>(p[0]) |
             (static_cast<std::uint32_t>(p[1]) << 8u) |
             (static_cast<std::uint32_t>(p[2]) << 16u) |
             (static_cast<std::uint32_t>(p[3]) << 24u);
    *pos += 4;
    return true;
}

bool ReadU64(const std::string& bytes, size_t* pos, std::uint64_t* value) {
    if (!pos || !value || *pos + 8 > bytes.size()) { return false; }
    const unsigned char* p = reinterpret_cast<const unsigned char*>(bytes.data() + *pos);
    std::uint64_t out = 0;
    for (int shift = 0; shift < 64; shift += 8) {
        out |= static_cast<std::uint64_t>(p[shift / 8]) << shift;
    }
    *value = out;
    *pos += 8;
    return true;
}

bool SafeBundleRelativePath(const std::string& relUtf8, fs::path* out) {
    if (relUtf8.empty() || relUtf8.find('\\') != std::string::npos || !out) {
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

std::string AppendedSceneBundlePayload(const std::string& exeBytes) {
    const std::string footerMagic(kSceneBundleFooter, sizeof(kSceneBundleFooter) - 1);
    if (exeBytes.size() < footerMagic.size() + 8) {
        return {};
    }
    if (exeBytes.compare(exeBytes.size() - footerMagic.size(), footerMagic.size(), footerMagic) != 0) {
        return {};
    }
    const size_t sizeOffset = exeBytes.size() - footerMagic.size() - 8;
    size_t pos = sizeOffset;
    std::uint64_t payloadSize = 0;
    if (!ReadU64(exeBytes, &pos, &payloadSize)) {
        return {};
    }
    if (payloadSize > sizeOffset) {
        return {};
    }
    const size_t payloadStart = sizeOffset - static_cast<size_t>(payloadSize);
    return exeBytes.substr(payloadStart, static_cast<size_t>(payloadSize));
}

bool HasAppendedSceneBundle(const fs::path& exe) {
    return !AppendedSceneBundlePayload(ReadFileBytes(exe)).empty();
}

std::string BuildCompiledSceneBundle(const fs::path& webRoot, const fs::path& source) {
    const std::wstring slug = Slugify(source.stem().wstring());
    const fs::path sessionDir = webRoot / L"sessions" / slug;
    std::error_code ec;
    if (!fs::exists(sessionDir, ec) || !fs::is_directory(sessionDir, ec)) {
        return {};
    }
    std::vector<fs::path> files;
    for (fs::recursive_directory_iterator it(sessionDir, ec), end; !ec && it != end; it.increment(ec)) {
        if (ec || !it->is_regular_file(ec)) { continue; }
        files.push_back(it->path());
    }
    const std::vector<fs::path> runtimeFiles = {
        L"index.html",
        L"vf-frame.css",
        L"vf-runtime-shell.js",
        L"vf-runtime-packet-contract.js",
        L"vf-runtime-source.js",
        L"vf-runtime-scene.js",
        L"vf-runtime-flow.js",
        L"vf-render-clock.js",
        L"vf-frame.js",
        L"vf-display.js",
        L"vf-native-scene.js",
        L"vf-axis3d-kernel.js",
        L"vf-axis3d-kernel-adapter.js",
        L"vf-axis3d-projection-kernel.js",
        L"vf-axis3d-projection-kernel-adapter.js",
        L"geom/vf-geom-math.js",
        L"geom/vf-geom-core.js",
        L"geom/vf-geom-material-arena.js",
        L"geom/vf-geom-ledger-layout.js",
        L"geom/vf-geom-ledger-transport.js",
        L"geom/vf-geom-ledger.js",
        L"geom/vf-geom-parametric-surface.js",
        L"geom/vf-geom-frame-adapter.js",
        L"geom/vf-geom-wgpu.js",
    };
    for (const fs::path& rel : runtimeFiles) {
        const fs::path file = webRoot / rel;
        if (!fs::exists(file, ec) || !fs::is_regular_file(file, ec)) {
            return {};
        }
        files.push_back(file);
    }
    if (files.empty()) {
        return {};
    }
    std::sort(files.begin(), files.end(), [](const fs::path& a, const fs::path& b) {
        return a.generic_string() < b.generic_string();
    });

    std::string payload(kSceneBundleHeader, sizeof(kSceneBundleHeader) - 1);
    AppendU32(payload, static_cast<std::uint32_t>(files.size()));
    for (const fs::path& file : files) {
        const fs::path rel = fs::relative(file, webRoot, ec);
        if (ec) { return {}; }
        const std::string relUtf8 = rel.generic_string();
        const std::string data = ReadFileBytes(file);
        AppendU32(payload, static_cast<std::uint32_t>(relUtf8.size()));
        AppendU64(payload, static_cast<std::uint64_t>(data.size()));
        payload += relUtf8;
        payload += data;
    }
    return payload;
}

int AppendCompiledSceneBundleToExe(const fs::path& exe, const fs::path& webRoot, const fs::path& source) {
    const std::string payload = BuildCompiledSceneBundle(webRoot, source);
    if (payload.empty()) {
        return Fail(L"native compile failed: staged scene bundle is empty and cannot be embedded");
    }
    std::ofstream out(exe, std::ios::binary | std::ios::app);
    if (!out) {
        return Fail(L"native compile failed while appending scene bundle to " + exe.wstring());
    }
    out.write(payload.data(), static_cast<std::streamsize>(payload.size()));
    std::string footer;
    AppendU64(footer, static_cast<std::uint64_t>(payload.size()));
    footer.append(kSceneBundleFooter, sizeof(kSceneBundleFooter) - 1);
    out.write(footer.data(), static_cast<std::streamsize>(footer.size()));
    if (!out) {
        return Fail(L"native compile failed while finalizing embedded scene bundle in " + exe.wstring());
    }
    return 0;
}

bool ExtractAppendedSceneBundle(const fs::path& exe, const fs::path& webRoot) {
    const std::string payload = AppendedSceneBundlePayload(ReadFileBytes(exe));
    if (payload.empty()) {
        return true;
    }
    const std::string header(kSceneBundleHeader, sizeof(kSceneBundleHeader) - 1);
    if (payload.compare(0, header.size(), header) != 0) {
        return false;
    }
    size_t pos = header.size();
    std::uint32_t count = 0;
    if (!ReadU32(payload, &pos, &count)) {
        return false;
    }
    for (std::uint32_t index = 0; index < count; index += 1) {
        std::uint32_t pathLen = 0;
        std::uint64_t dataLen = 0;
        if (!ReadU32(payload, &pos, &pathLen) || !ReadU64(payload, &pos, &dataLen)) {
            return false;
        }
        if (pos + pathLen > payload.size()) {
            return false;
        }
        const std::string relUtf8 = payload.substr(pos, pathLen);
        pos += pathLen;
        if (dataLen > payload.size() - pos) {
            return false;
        }
        const std::string data = payload.substr(pos, static_cast<size_t>(dataLen));
        pos += static_cast<size_t>(dataLen);
        fs::path rel;
        if (!SafeBundleRelativePath(relUtf8, &rel)) {
            return false;
        }
        if (!WriteFileBytesIfChanged(webRoot / rel, data)) {
            return false;
        }
    }
    return pos == payload.size();
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

bool ManifestCurrentForSource(const fs::path& manifest, const std::string& sourceHash) {
    std::error_code ec;
    if (!fs::exists(manifest, ec)) {
        return false;
    }
    const std::string text = ReadFileBytes(manifest);
    if (text.empty()) {
        return false;
    }
    const bool sourceMatches =
        text.find("\"source_hash\":\"" + sourceHash + "\"") != std::string::npos ||
        text.find("\"source_hash\": \"" + sourceHash + "\"") != std::string::npos;
    const bool contractMatches =
        text.find("\"compiler\":\"" + std::string(kNativeSceneCompilerVersion) + "\"") != std::string::npos ||
        text.find("\"compiler\": \"" + std::string(kNativeSceneCompilerVersion) + "\"") != std::string::npos;
    return sourceMatches && contractMatches;
}

bool SessionBundleCurrent(const fs::path& source, const fs::path& page, const fs::path& stager) {
    std::error_code ec;
    if (!fs::exists(page, ec)) {
        return false;
    }
    if (NewerThan(source, page)) {
        return false;
    }
    if (!stager.empty() && NewerThan(stager, page)) {
        return false;
    }
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

fs::path RunnerTemplateForCompiledScene(const fs::path& self) {
    std::error_code ec;
    const fs::path guiRunner = self.parent_path() / L"vkf-runner.exe";
    if (fs::exists(guiRunner, ec) && fs::is_regular_file(guiRunner, ec)) {
        return guiRunner;
    }
    return self;
}

int EnsureExampleExeCurrent(const fs::path& runnerTemplate, const fs::path& source, const fs::path& target) {
    std::error_code ec;
    (void)source;

    StopRunningTargetExe(target);
    fs::copy_file(runnerTemplate, target, fs::copy_options::overwrite_existing, ec);
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
#if defined(VF_TRANSPARENT_OVERLAY_STATIC)
    (void)self;
    (void)source;
    (void)target;
    return 0;
#else
    fs::path repoRoot = FindRepoRootFrom(source);
    if (repoRoot.empty()) {
        repoRoot = FindRepoRootFrom(self);
    }
    const fs::path dll = FindTransparentOverlayDll(repoRoot, self);
    if (dll.empty()) {
        return Fail(L"TransparentOverlay.dll not found next to vkf.exe; rebuild native/VfOverlay");
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
    return 0;
#endif
}

struct NativeSceneBundle {
    fs::path source;
    fs::path repoRoot;
    fs::path webRoot;
    fs::path page;
};

bool TryResolveCurrentSceneBundle(const fs::path& source, const fs::path& self, NativeSceneBundle* bundle, bool reportErrors = true) {
    auto report = [&](const std::wstring& message) {
        if (reportErrors) {
            Fail(message);
        }
    };
    std::error_code ec;
    const fs::path absoluteSource = fs::absolute(source, ec);
    if (ec || !fs::exists(absoluteSource, ec)) {
        report(L"source not found: " + source.wstring());
        return false;
    }

    fs::path repoRoot = FindRepoRootFrom(absoluteSource);
    if (repoRoot.empty()) {
        repoRoot = FindRepoRootFrom(self);
    }
    if (repoRoot.empty()) {
        report(L"could not locate repository root for native runtime assets");
        return false;
    }

    const fs::path webRoot = FindRuntimeWebRoot(repoRoot, self);
    if (webRoot.empty()) {
        report(L"overlay web assets not found; build native/VfOverlay first");
        return false;
    }
    const bool embeddedSceneBundle = HasAppendedSceneBundle(self);
    if (!ExtractAppendedSceneBundle(self, webRoot)) {
        report(L"embedded compiled scene bundle is invalid in " + self.wstring());
        return false;
    }

    const fs::path page = SessionPageForWebRoot(webRoot, absoluteSource);
    if (embeddedSceneBundle) {
        if (!fs::exists(page, ec) || !fs::is_regular_file(page, ec)) {
            report(L"embedded compiled scene bundle did not contain scene page: " + page.wstring());
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

    const fs::path manifest = ManifestPathForSource(absoluteSource);
    const std::string sourceHash = Fnv1a64Hex(NativeSceneSourceTreeBytes(absoluteSource));
    if (!ManifestCurrentForSource(manifest, sourceHash)) {
        report(
            L"compiled artifact manifest missing or stale: " + manifest.wstring() +
            L"\n     Native staleness check did not start Python. Compile with the native VKF compiler, then run again.");
        return false;
    }
    const fs::path stager = FindNativeSceneStager(repoRoot, self);
    if (!SessionBundleCurrent(absoluteSource, page, stager)) {
        report(
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
    const std::wstring pageArg = SessionPageArgForSource(bundle.source);
    const int result = VfOverlayRunDll(GetModuleHandleW(nullptr), pageArg.c_str(), bundle.webRoot.wstring().c_str(), SW_SHOW);
    if (result != 0) {
        return Fail(L"VKF overlay host failed: " + std::to_wstring(result));
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

    NativeSceneBundle bundle{};
    if (!TryResolveCurrentSceneBundle(absoluteSource, self, &bundle, false)) {
        const int stageResult = StageNativeSceneArtifacts(absoluteSource, self);
        if (stageResult != 0) {
            return stageResult;
        }
        if (!TryResolveCurrentSceneBundle(absoluteSource, self, &bundle)) {
            return 1;
        }
    }

    const fs::path target = TargetExeForSource(absoluteSource);
    const fs::path runnerTemplate = RunnerTemplateForCompiledScene(self);
    const int exeResult = EnsureExampleExeCurrent(runnerTemplate, absoluteSource, target);
    if (exeResult != 0) {
        return exeResult;
    }
    const int appendResult = AppendCompiledSceneBundleToExe(target, bundle.webRoot, absoluteSource);
    if (appendResult != 0) {
        return appendResult;
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
