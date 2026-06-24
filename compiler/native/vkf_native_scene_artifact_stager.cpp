#include <cstdint>
#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <optional>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr const char* kNativeSceneStagerContractVersion = "vkf-native-scene-artifact-stager-0.2-launch-manifest";

struct Args {
    std::filesystem::path source;
    std::filesystem::path overlay_web;
    std::string scene_config_json = "{}";
    std::string runtime_packets_json = "[]";
    std::string geom_transport_json = "{}";
    std::string geom_state_json = "{}";
    std::string event_program_json = "{}";
    bool scene_config_supplied = false;
    bool runtime_packets_supplied = false;
};

struct ArenaExternalization {
    std::string scene_config_json;
    std::string arena_bytes;
};

struct ArtifactInputProvenance {
    std::string source = "default";
    std::string path;
    bool source_hash_checked = false;
};

class StagerError : public std::runtime_error {
public:
    explicit StagerError(const std::string& message)
        : std::runtime_error(message) {}
};

std::string read_file_bytes(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw StagerError("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_file(const std::filesystem::path& path, const std::string& text, bool refresh_unchanged = false) {
    std::filesystem::create_directories(path.parent_path());
    std::error_code ec;
    if (std::filesystem::exists(path, ec) && read_file_bytes(path) == text) {
        if (refresh_unchanged) {
            std::filesystem::last_write_time(path, std::filesystem::file_time_type::clock::now(), ec);
        }
        return;
    }
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw StagerError("could not write " + path.string());
    }
    output << text;
}

void remove_prior_generated_scene_artifacts(const std::filesystem::path& session_dir, const std::vector<std::string>& keep_names) {
    std::error_code ec;
    if (!std::filesystem::exists(session_dir, ec)) {
        return;
    }
    for (std::filesystem::directory_iterator it(session_dir, ec), end; !ec && it != end; it.increment(ec)) {
        if (ec || !it->is_regular_file(ec)) {
            continue;
        }
        const std::string name = it->path().filename().string();
        if (name.rfind("vf-native-scene-configs-", 0) == 0 ||
            name.rfind("vf-native-scene-arena-", 0) == 0) {
            if (std::find(keep_names.begin(), keep_names.end(), name) != keep_names.end()) {
                continue;
            }
            std::filesystem::remove(it->path(), ec);
            if (ec) {
                throw StagerError("could not remove stale generated scene artifact: " + it->path().string());
            }
        }
    }
}

std::string fnv1a64_hex(const std::string& bytes) {
    std::uint64_t hash = 14695981039346656037ull;
    for (unsigned char byte : bytes) {
        hash ^= static_cast<std::uint64_t>(byte);
        hash *= 1099511628211ull;
    }
    std::ostringstream out;
    out << std::hex << std::setw(16) << std::setfill('0') << hash;
    return out.str();
}

void append_u32_le(std::string& out, std::uint32_t value) {
    out.push_back(static_cast<char>(value & 0xffu));
    out.push_back(static_cast<char>((value >> 8u) & 0xffu));
    out.push_back(static_cast<char>((value >> 16u) & 0xffu));
    out.push_back(static_cast<char>((value >> 24u) & 0xffu));
}

void append_f32_le(std::string& out, float value) {
    static_assert(sizeof(float) == sizeof(std::uint32_t), "float must be 32-bit");
    std::uint32_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    append_u32_le(out, bits);
}

std::string lower_ascii(std::string text) {
    for (char& ch : text) {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return text;
}

std::string slugify_stem(std::string text) {
    std::string out;
    bool last_dash = false;
    for (char ch : text) {
        const unsigned char uch = static_cast<unsigned char>(ch);
        if (std::isalnum(uch)) {
            out.push_back(static_cast<char>(std::tolower(uch)));
            last_dash = false;
        } else if (!last_dash && !out.empty()) {
            out.push_back('-');
            last_dash = true;
        }
    }
    while (!out.empty() && out.back() == '-') {
        out.pop_back();
    }
    return out.empty() ? "main" : out;
}

std::string native_scene_source_tree_bytes(const std::filesystem::path& source, const std::string& source_text) {
    const std::filesystem::path absolute_source = std::filesystem::absolute(source);
    std::string bytes;
    bytes.append("source\0", 7);
    bytes += absolute_source.generic_string();
    bytes.push_back('\0');
    bytes += source_text;

    std::error_code ec;
    const std::filesystem::path lib_dir = absolute_source.parent_path() / "lib";
    if (!std::filesystem::exists(lib_dir, ec)) {
        return bytes;
    }
    std::vector<std::filesystem::path> dependencies;
    for (std::filesystem::recursive_directory_iterator it(lib_dir, ec), end; !ec && it != end; it.increment(ec)) {
        if (ec || !it->is_regular_file(ec)) {
            continue;
        }
        const std::filesystem::path path = it->path();
        if (lower_ascii(path.extension().string()) == ".vkf") {
            dependencies.push_back(std::filesystem::absolute(path, ec));
            ec.clear();
        }
    }
    std::sort(dependencies.begin(), dependencies.end(), [](const auto& a, const auto& b) {
        return a.generic_string() < b.generic_string();
    });
    for (const std::filesystem::path& dependency : dependencies) {
        bytes.append("\ndependency\0", 12);
        bytes += dependency.generic_string();
        bytes.push_back('\0');
        bytes += read_file_bytes(dependency);
    }
    return bytes;
}

bool newer_than(const std::filesystem::path& left, const std::filesystem::path& right) {
    std::error_code left_ec;
    std::error_code right_ec;
    const auto left_time = std::filesystem::last_write_time(left, left_ec);
    const auto right_time = std::filesystem::last_write_time(right, right_ec);
    if (left_ec || right_ec) {
        return false;
    }
    return left_time > right_time;
}

std::vector<std::filesystem::path> vkf_lib_dependencies(const std::filesystem::path& source) {
    std::vector<std::filesystem::path> dependencies;
    std::error_code ec;
    const std::filesystem::path lib_dir = source.parent_path() / "lib";
    if (!std::filesystem::exists(lib_dir, ec)) {
        return dependencies;
    }
    for (std::filesystem::recursive_directory_iterator it(lib_dir, ec), end; !ec && it != end; it.increment(ec)) {
        if (ec || !it->is_regular_file(ec)) {
            continue;
        }
        const std::filesystem::path path = it->path();
        if (lower_ascii(path.extension().string()) == ".vkf") {
            dependencies.push_back(std::filesystem::absolute(path, ec));
            ec.clear();
        }
    }
    std::sort(dependencies.begin(), dependencies.end(), [](const auto& a, const auto& b) {
        return a.generic_string() < b.generic_string();
    });
    return dependencies;
}

void require_generated_scene_config_current(
    const std::filesystem::path& source,
    const std::filesystem::path& config_path,
    const std::string& expected_source_hash
) {
    const std::filesystem::path hash_path = std::filesystem::path(config_path.string() + ".source_hash");
    if (!std::filesystem::exists(hash_path)) {
        throw StagerError(
            "native_scene_config_path has no source fingerprint: " + hash_path.string() +
            "; rebuild the VKF scene config before staging");
    }
    std::string actual_source_hash = read_file_bytes(hash_path);
    while (!actual_source_hash.empty() && (actual_source_hash.back() == '\n' || actual_source_hash.back() == '\r' || actual_source_hash.back() == ' ' || actual_source_hash.back() == '\t')) {
        actual_source_hash.pop_back();
    }
    if (actual_source_hash != expected_source_hash) {
        throw StagerError(
            "native_scene_config_path source fingerprint mismatch: " + config_path.string() +
            " was built for " + actual_source_hash +
            " but current source tree is " + expected_source_hash +
            "; rebuild the VKF scene config before staging");
    }
    for (const std::filesystem::path& dependency : vkf_lib_dependencies(source)) {
        if (newer_than(dependency, config_path)) {
            throw StagerError(
                "native_scene_config_path is stale: " + config_path.string() +
                " is older than " + dependency.string() +
                "; rebuild the VKF scene config before staging");
        }
    }
}

bool try_require_generated_artifact_current(
    const std::filesystem::path& source,
    const std::filesystem::path& artifact_path,
    const std::string& expected_source_hash,
    const std::string& label
) {
    const std::filesystem::path hash_path = std::filesystem::path(artifact_path.string() + ".source_hash");
    if (!std::filesystem::exists(hash_path)) {
        return false;
    }
    std::string actual_source_hash = read_file_bytes(hash_path);
    while (!actual_source_hash.empty() && (actual_source_hash.back() == '\n' || actual_source_hash.back() == '\r' || actual_source_hash.back() == ' ' || actual_source_hash.back() == '\t')) {
        actual_source_hash.pop_back();
    }
    if (actual_source_hash != expected_source_hash) {
        throw StagerError(
            label + " source fingerprint mismatch: " + artifact_path.string() +
            " was built for " + actual_source_hash +
            " but current source tree is " + expected_source_hash +
            "; rebuild the VKF runtime packets before staging");
    }
    for (const std::filesystem::path& dependency : vkf_lib_dependencies(source)) {
        if (newer_than(dependency, artifact_path)) {
            throw StagerError(
                label + " is stale: " + artifact_path.string() +
                " is older than " + dependency.string() +
                "; rebuild the VKF runtime packets before staging");
        }
    }
    return true;
}

std::string slash_path(const std::filesystem::path& path) {
    return path.generic_string();
}

std::filesystem::path resolve_source_relative_path(
    const std::filesystem::path& source,
    const std::string& raw_path
) {
    std::filesystem::path path(raw_path);
    if (path.is_relative()) {
        path = source.parent_path() / path;
    }
    return std::filesystem::absolute(path);
}

std::string json_escape(const std::string& text) {
    std::string out;
    out.reserve(text.size() + 8);
    for (char ch : text) {
        switch (ch) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out.push_back(ch); break;
        }
    }
    return out;
}

bool is_json_array_text(const std::string& text) {
    for (unsigned char ch : text) {
        if (std::isspace(ch)) {
            continue;
        }
        return ch == '[';
    }
    return false;
}

std::string trim_left_copy(const std::string& text) {
    std::size_t pos = 0;
    while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) {
        ++pos;
    }
    return text.substr(pos);
}

std::optional<std::string> regex_first_group(const std::string& text, const std::string& pattern) {
    try {
        std::smatch match;
        if (std::regex_search(text, match, std::regex(pattern)) && match.size() > 1) {
            return match[1].str();
        }
    } catch (const std::regex_error&) {
    }
    return std::nullopt;
}

std::string native_scene_launch_manifest_json(const std::string& scene_config_json) {
    std::vector<std::string> frames;
    try {
        std::regex frame_regex("\\\"frame\\\"\\s*:\\s*\\{([^{}]*)\\}");
        for (std::sregex_iterator it(scene_config_json.begin(), scene_config_json.end(), frame_regex), end; it != end; ++it) {
            const std::string candidate = (*it)[1].str();
            if (candidate.find("\"visible\":false") != std::string::npos ||
                candidate.find("\"visible\": false") != std::string::npos) {
                continue;
            }
            const auto frame_id = regex_first_group(candidate, "\\\"frame_id\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
            if (!frame_id.has_value() || frame_id->empty()) {
                continue;
            }
            const auto title = regex_first_group(candidate, "\\\"title\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
            const auto rect = regex_first_group(candidate, "\\\"rect\\\"\\s*:\\s*\\[([^\\]]+)\\]");
            const auto aspect = regex_first_group(candidate, "\\\"aspect\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
            std::ostringstream frame;
            frame << "{"
                  << "\"id\":\"" << json_escape(*frame_id) << "\","
                  << "\"title\":\"" << json_escape(title.value_or("")) << "\","
                  << "\"rect\":[" << rect.value_or("0.04,0.06,0.72,0.84") << "],"
                  << "\"aspect\":\"" << json_escape(aspect.value_or("")) << "\","
                  << "\"visible\":true"
                  << "}";
            frames.push_back(frame.str());
        }
    } catch (const std::regex_error&) {
    }
    std::ostringstream out;
    out << "{\n"
        << "  \"schema\": \"vektor-flow/launch-manifest\",\n"
        << "  \"frames\": [";
    for (size_t i = 0; i < frames.size(); ++i) {
        if (i != 0) {
            out << ",";
        }
        out << frames[i];
    }
    out << "]\n"
        << "}\n";
    return out.str();
}

std::optional<std::string> extract_js_json_assignment(const std::string& text, const std::string& marker) {
    const std::size_t marker_pos = text.find(marker);
    if (marker_pos == std::string::npos) {
        return std::nullopt;
    }
    std::size_t pos = text.find('=', marker_pos + marker.size());
    if (pos == std::string::npos) {
        return std::nullopt;
    }
    ++pos;
    while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) {
        ++pos;
    }
    if (pos >= text.size() || (text[pos] != '[' && text[pos] != '{')) {
        return std::nullopt;
    }

    const std::size_t start = pos;
    int depth = 0;
    bool in_string = false;
    bool escaped = false;
    for (; pos < text.size(); ++pos) {
        const char ch = text[pos];
        if (in_string) {
            if (escaped) {
                escaped = false;
            } else if (ch == '\\') {
                escaped = true;
            } else if (ch == '"') {
                in_string = false;
            }
            continue;
        }
        if (ch == '"') {
            in_string = true;
            continue;
        }
        if (ch == '[' || ch == '{') {
            ++depth;
            continue;
        }
        if (ch == ']' || ch == '}') {
            --depth;
            if (depth == 0) {
                return text.substr(start, pos - start + 1);
            }
        }
    }
    return std::nullopt;
}

std::string normalize_scene_config_json(const std::string& scene_config_json) {
    const std::string trimmed = trim_left_copy(scene_config_json);
    if (trimmed.empty() || trimmed[0] != '<') {
        return scene_config_json;
    }
    if (auto configs = extract_js_json_assignment(trimmed, "window.__vfNativeSceneConfigs")) {
        return *configs;
    }
    if (auto config = extract_js_json_assignment(trimmed, "window.__vfNativeSceneConfig")) {
        return *config;
    }
    throw StagerError("scene config contains HTML but no window.__vfNativeSceneConfig assignment");
}

bool is_array_number_char(char ch) {
    return std::isdigit(static_cast<unsigned char>(ch)) ||
           ch == '-' || ch == '+' || ch == '.' || ch == 'e' || ch == 'E' ||
           ch == ',' || std::isspace(static_cast<unsigned char>(ch));
}

std::optional<size_t> find_numeric_array_end(const std::string& text, size_t array_start) {
    if (array_start >= text.size() || text[array_start] != '[') {
        return std::nullopt;
    }
    for (size_t pos = array_start + 1; pos < text.size(); ++pos) {
        const char ch = text[pos];
        if (ch == ']') {
            return pos;
        }
        if (!is_array_number_char(ch)) {
            return std::nullopt;
        }
    }
    return std::nullopt;
}

std::vector<double> parse_numeric_json_array(const std::string& text, size_t array_start, size_t array_end) {
    std::vector<double> values;
    const char* begin = text.data() + array_start + 1;
    const char* end = text.data() + array_end;
    const char* cursor = begin;
    while (cursor < end) {
        while (cursor < end && (std::isspace(static_cast<unsigned char>(*cursor)) || *cursor == ',')) {
            ++cursor;
        }
        if (cursor >= end) {
            break;
        }
        char* parsed_end = nullptr;
        const double value = std::strtod(cursor, &parsed_end);
        if (parsed_end == cursor) {
            throw StagerError("failed to parse numeric mesh arena array");
        }
        values.push_back(value);
        cursor = parsed_end;
        while (cursor < end && std::isspace(static_cast<unsigned char>(*cursor))) {
            ++cursor;
        }
        if (cursor < end && *cursor == ',') {
            ++cursor;
        }
    }
    return values;
}

void append_alignment(std::string& bytes, size_t alignment) {
    while ((bytes.size() % alignment) != 0) {
        bytes.push_back('\0');
    }
}

ArenaExternalization externalize_mesh_arenas(const std::string& scene_config_json) {
    ArenaExternalization out{scene_config_json, ""};
    std::string rewritten;
    rewritten.reserve(scene_config_json.size());
    size_t pos = 0;
    while (pos < scene_config_json.size()) {
        const size_t vertices_pos = scene_config_json.find("\"vertices\"", pos);
        const size_t indices_pos = scene_config_json.find("\"indices\"", pos);
        size_t key_pos = std::string::npos;
        std::string type;
        if (vertices_pos != std::string::npos && (indices_pos == std::string::npos || vertices_pos < indices_pos)) {
            key_pos = vertices_pos;
            type = "float32";
        } else if (indices_pos != std::string::npos) {
            key_pos = indices_pos;
            type = "uint32";
        }
        if (key_pos == std::string::npos) {
            rewritten.append(scene_config_json, pos, std::string::npos);
            break;
        }
        size_t colon = scene_config_json.find(':', key_pos);
        if (colon == std::string::npos) {
            rewritten.append(scene_config_json, pos, std::string::npos);
            break;
        }
        size_t array_start = colon + 1;
        while (array_start < scene_config_json.size() && std::isspace(static_cast<unsigned char>(scene_config_json[array_start]))) {
            ++array_start;
        }
        auto array_end = find_numeric_array_end(scene_config_json, array_start);
        if (!array_end.has_value()) {
            rewritten.append(scene_config_json, pos, colon + 1 - pos);
            pos = colon + 1;
            continue;
        }
        const std::vector<double> values = parse_numeric_json_array(scene_config_json, array_start, *array_end);
        if (values.empty()) {
            rewritten.append(scene_config_json, pos, *array_end + 1 - pos);
            pos = *array_end + 1;
            continue;
        }
        append_alignment(out.arena_bytes, 4);
        const size_t byte_offset = out.arena_bytes.size();
        if (type == "float32") {
            for (double value : values) {
                append_f32_le(out.arena_bytes, static_cast<float>(value));
            }
        } else {
            for (double value : values) {
                if (value < 0.0) {
                    throw StagerError("mesh arena indices must be non-negative");
                }
                append_u32_le(out.arena_bytes, static_cast<std::uint32_t>(value));
            }
        }
        rewritten.append(scene_config_json, pos, array_start - pos);
        std::ostringstream ref;
        ref << "{\"__vf_mesh_arena\":true,\"type\":\"" << type << "\",\"byteOffset\":" << byte_offset << ",\"length\":" << values.size() << "}";
        rewritten += ref.str();
        pos = *array_end + 1;
    }
    out.scene_config_json = std::move(rewritten);
    return out;
}

std::string manifest_text(
    const std::filesystem::path& source,
    const std::string& source_hash,
    const std::string& page_rel,
    const ArtifactInputProvenance& scene_config_provenance,
    const ArtifactInputProvenance& runtime_packets_provenance
) {
    std::ostringstream out;
    out << "{\n"
        << "  \"schema\": \"vektor-flow/native-scene-artifact\",\n"
        << "  \"compiler\": \"" << kNativeSceneStagerContractVersion << "\",\n"
        << "  \"source_path\": \"" << json_escape(slash_path(std::filesystem::absolute(source))) << "\",\n"
        << "  \"source_hash\": \"" << source_hash << "\",\n"
        << "  \"page_rel\": \"" << json_escape(page_rel) << "\",\n"
        << "  \"scene_config_source\": \"" << json_escape(scene_config_provenance.source) << "\",\n"
        << "  \"scene_config_path\": \"" << json_escape(scene_config_provenance.path) << "\",\n"
        << "  \"scene_config_source_hash_checked\": " << (scene_config_provenance.source_hash_checked ? "true" : "false") << ",\n"
        << "  \"runtime_packets_source\": \"" << json_escape(runtime_packets_provenance.source) << "\",\n"
        << "  \"runtime_packets_path\": \"" << json_escape(runtime_packets_provenance.path) << "\",\n"
        << "  \"runtime_packets_source_hash_checked\": " << (runtime_packets_provenance.source_hash_checked ? "true" : "false") << ",\n"
        << "  \"status\": \"compiled\"\n"
        << "}\n";
    return out.str();
}

std::string html_text(
    const std::string& scene_config_json,
    const std::string& scene_config_filename = "",
    const std::string& arena_filename = ""
) {
    const std::string native_scene_runtime_config =
        "<script>window.__vfRuntimeShellConfig={"
        "launchManifestUrl:\"vf-launch-manifest.json\","
        "sceneStyleDeps:[{href:\"vf-frame.css\"},{href:\"vf-chess.css\"}],"
        "sceneScriptDeps:["
        "\"vf-runtime-packet-contract.js\","
        "\"vf-runtime-source.js\","
        "\"vf-runtime-scene.js\","
        "\"vf-runtime-flow.js\","
        "\"vf-render-clock.js\","
        "\"vf-frame.js\","
        "\"vf-axis3d-kernel.js\","
        "\"vf-axis3d-kernel-adapter.js\","
        "\"vf-axis3d-projection-kernel.js\","
        "\"vf-axis3d-projection-kernel-adapter.js\","
        "\"geom/vf-geom-math.js\","
        "\"geom/vf-geom-core.js\","
        "\"geom/vf-geom-material-arena.js\","
        "\"geom/vf-geom-ledger-layout.js\","
        "\"geom/vf-geom-ledger-transport.js\","
        "\"geom/vf-geom-ledger.js\","
        "\"geom/vf-geom-parametric-surface.js\","
        "\"geom/vf-geom-frame-adapter.js\","
        "\"geom/vf-geom-wgpu.js\","
        "\"vf-display.js\""
        "]};</script>";
    if (trim_left_copy(scene_config_json) == "[]") {
        return std::string("<!DOCTYPE html>\n")
            + "<html><head><meta charset=\"utf-8\"><title>VKF Native Scene</title></head>"
            + "<body data-vf-runtime-shell=\"scene\" data-vf-runtime-autoboot=\"false\" data-vf-runtime-packet-only=\"true\" data-vf-runtime-file-packets=\"vf-runtime-packets.json\" data-vf-runtime-prefer-file-packets=\"true\">"
            + native_scene_runtime_config
            + "<script src=\"../../vf-runtime-shell.js\"></script>"
            + "</body></html>\n";
    }
    if (is_json_array_text(scene_config_json)) {
        const bool external_config = !scene_config_filename.empty();
        const bool external_arena = !arena_filename.empty();
        return std::string("<!DOCTYPE html>\n")
            + "<html><head><meta charset=\"utf-8\"><title>VKF Native Scene</title></head>"
            + "<body data-vf-runtime-shell=\"scene\" data-vf-runtime-autoboot=\"false\" data-vf-runtime-packet-only=\"true\" data-vf-runtime-file-packets=\"vf-runtime-packets.json\" data-vf-runtime-prefer-file-packets=\"true\">"
            + native_scene_runtime_config
            + "<script src=\"../../vf-runtime-shell.js\"></script>"
            + "<script>"
            + (external_config
                ? std::string("window.__vfNativeSceneConfigs=null;window.__vfNativeSceneConfigsUrl=\"") + json_escape(scene_config_filename) + "\";"
                : std::string("window.__vfNativeSceneConfigs=") + scene_config_json + ";")
            + (external_arena
                ? std::string("window.__vfNativeSceneArenaUrl=\"") + json_escape(arena_filename) + "\";"
                : std::string("window.__vfNativeSceneArenaUrl=\"\";"))
            + "</script>"
            + "<script>(function(global){"
            + "function visible(c){return !(c&&c.scene_ir&&c.scene_ir.frame&&c.scene_ir.frame.visible===false);}"
            + "function fail(err){var msg=err&&err.message?err.message:String(err);global.__vfLastError=msg;if(global.document&&document.body){document.body.setAttribute('data-vf-native-scene-error','1');document.body.textContent='VKF native scene error: '+msg;}throw err;}"
            + "function fetchConfig(url){return fetch(url,{cache:'force-cache'}).then(function(r){if(!r.ok){throw new Error('failed to load native scene configs '+url+' ('+String(r.status)+')');}return r.text();}).then(function(text){var configs=JSON.parse(text);if(!Array.isArray(configs)){throw new Error('native scene configs must be a JSON array');}return configs;});}"
            + "function arenaRef(value){return value&&typeof value==='object'&&value.__vf_mesh_arena===true;}"
            + "function nowMs(){return global.performance&&typeof global.performance.now==='function'?global.performance.now():Date.now();}"
            + "function assignArenaRef(holder,key,value,arena){var off=Number(value.byteOffset||0);var len=Number(value.length||0);var type=String(value.type||'');if(type==='float32'){holder[key]=new Float32Array(arena,off,len);return;}if(type==='uint32'){holder[key]=new Uint32Array(arena,off,len);return;}throw new Error('unknown mesh arena type '+type);}"
            + "function hydrateConfigs(configs){var arenaUrl=String(global.__vfNativeSceneArenaUrl||'');if(!arenaUrl){return Promise.resolve(configs);}return fetch(arenaUrl,{cache:'force-cache'}).then(function(r){if(!r.ok){throw new Error('failed to load native scene arena '+arenaUrl+' ('+String(r.status)+')');}return r.arrayBuffer();}).then(function(arena){return new Promise(function(resolve,reject){var stack=[];for(var i=configs.length-1;i>=0;i-=1){stack.push([configs,i,configs[i]]);}function step(){try{var start=nowMs();while(stack.length&&(nowMs()-start)<6.0){var item=stack.pop();var holder=item[0];var key=item[1];var value=item[2];if(arenaRef(value)){assignArenaRef(holder,key,value,arena);continue;}if(typeof ArrayBuffer!=='undefined'&&ArrayBuffer.isView&&ArrayBuffer.isView(value)){continue;}if(Array.isArray(value)){for(var ai=value.length-1;ai>=0;ai-=1){stack.push([value,ai,value[ai]]);}continue;}if(value&&typeof value==='object'){Object.keys(value).forEach(function(k){stack.push([value,k,value[k]]);});}}if(stack.length){global.setTimeout(step,0);}else{resolve(configs);}}catch(err){reject(err);}}step();});});}"
            + "function configList(){if(Array.isArray(global.__vfNativeSceneConfigs)){return Promise.resolve(global.__vfNativeSceneConfigs.slice());}"
            + "var url=String(global.__vfNativeSceneConfigsUrl||'');if(!url){return Promise.reject(new Error('missing native scene configs'));}"
            + "return fetchConfig(url).then(function(configs){global.__vfNativeSceneConfigs=configs;return configs.slice();});}"
            + "function loadAt(index){if(index>=configs.length){return;}"
            + "global.__vfNativeSceneConfig=configs[index];"
            + "var s=document.createElement('script');s.src='../../vf-native-scene.js?view='+String(index);"
            + "s.onload=function(){var delay=index===0?200:0;global.setTimeout(function(){loadAt(index+1);},delay);};"
            + "s.onerror=function(){fail(new Error('failed to load vf-native-scene.js for view '+String(index)));};"
            + "document.body.appendChild(s);}"
            + "var configs=[];function load(){configList().then(hydrateConfigs).then(function(list){configs=list;configs.sort(function(a,b){return (visible(b)?1:0)-(visible(a)?1:0);});loadAt(0);}).catch(fail);}"
            + "if(window.VfRuntimeShell&&window.VfRuntimeShell.ensureSceneDependencies){"
            + "window.VfRuntimeShell.mountLaunchFramesFromUrl(window.VfRuntimeShell.config.launchManifestUrl).then(function(){return window.VfRuntimeShell.ensureSceneDependencies();}).then(load).catch(fail);"
            + "}else{load();}"
            + "})(window);</script>"
            + "</body></html>\n";
    }
    const bool external_arena = !arena_filename.empty();
    return std::string("<!DOCTYPE html>\n")
        + "<html><head><meta charset=\"utf-8\"><title>VKF Native Scene</title></head>"
        + "<body data-vf-runtime-shell=\"scene\" data-vf-runtime-autoboot=\"false\" data-vf-runtime-packet-only=\"true\" data-vf-runtime-file-packets=\"vf-runtime-packets.json\" data-vf-runtime-prefer-file-packets=\"true\">"
        + native_scene_runtime_config
        + "<script src=\"../../vf-runtime-shell.js\"></script>"
        + "<script>window.__vfNativeSceneConfig=" + scene_config_json + ";"
        + (external_arena
            ? std::string("window.__vfNativeSceneArenaUrl=\"") + json_escape(arena_filename) + "\";"
            : std::string("window.__vfNativeSceneArenaUrl=\"\";"))
        + "</script>"
        + "<script>(function(global){"
        + "function fail(err){var msg=err&&err.message?err.message:String(err);window.__vfLastError=msg;if(document&&document.body){document.body.setAttribute('data-vf-native-scene-error','1');document.body.textContent='VKF native scene error: '+msg;}throw err;}"
        + "function arenaRef(value){return value&&typeof value==='object'&&value.__vf_mesh_arena===true;}"
        + "function nowMs(){return global.performance&&typeof global.performance.now==='function'?global.performance.now():Date.now();}"
        + "function assignArenaRef(holder,key,value,arena){var off=Number(value.byteOffset||0);var len=Number(value.length||0);var type=String(value.type||'');if(type==='float32'){holder[key]=new Float32Array(arena,off,len);return;}if(type==='uint32'){holder[key]=new Uint32Array(arena,off,len);return;}throw new Error('unknown mesh arena type '+type);}"
        + "function hydrateConfig(config){var arenaUrl=String(global.__vfNativeSceneArenaUrl||'');if(!arenaUrl){return Promise.resolve(config);}return fetch(arenaUrl,{cache:'force-cache'}).then(function(r){if(!r.ok){throw new Error('failed to load native scene arena '+arenaUrl+' ('+String(r.status)+')');}return r.arrayBuffer();}).then(function(arena){return new Promise(function(resolve,reject){var stack=[[{root:config},'root',config]];function step(){try{var start=nowMs();while(stack.length&&(nowMs()-start)<6.0){var item=stack.pop();var holder=item[0];var key=item[1];var value=item[2];if(arenaRef(value)){assignArenaRef(holder,key,value,arena);continue;}if(typeof ArrayBuffer!=='undefined'&&ArrayBuffer.isView&&ArrayBuffer.isView(value)){continue;}if(Array.isArray(value)){for(var ai=value.length-1;ai>=0;ai-=1){stack.push([value,ai,value[ai]]);}continue;}if(value&&typeof value==='object'){Object.keys(value).forEach(function(k){stack.push([value,k,value[k]]);});}}if(stack.length){global.setTimeout(step,0);}else{resolve(config);}}catch(err){reject(err);}}step();});});}"
        + "function load(){var s=document.createElement('script');s.src='../../vf-native-scene.js';"
        + "s.onerror=function(){fail(new Error('failed to load vf-native-scene.js'));};"
        + "document.body.appendChild(s);}"
        + "if(window.VfRuntimeShell&&window.VfRuntimeShell.ensureSceneDependencies){"
        + "window.VfRuntimeShell.mountLaunchFramesFromUrl(window.VfRuntimeShell.config.launchManifestUrl).then(function(){return window.VfRuntimeShell.ensureSceneDependencies();}).then(function(){return hydrateConfig(global.__vfNativeSceneConfig);}).then(load).catch(fail);"
        + "}else{hydrateConfig(global.__vfNativeSceneConfig).then(load).catch(fail);}"
        + "})(window);</script>"
        + "</body></html>\n";
}

std::optional<std::string> extract_vkf_string_binding(const std::string& source, const std::string& name) {
    const std::string marker = name + ":";
    std::size_t pos = source.find(marker);
    while (pos != std::string::npos) {
        const bool starts_at_boundary = pos == 0 || source[pos - 1] == '\n' || source[pos - 1] == '\r';
        if (starts_at_boundary) {
            std::size_t value = pos + marker.size();
            while (value < source.size() && (source[value] == ' ' || source[value] == '\t')) {
                ++value;
            }
            if (value >= source.size() || (source[value] != '\'' && source[value] != '"')) {
                return std::nullopt;
            }
            const char quote = source[value];
            ++value;
            std::string out;
            for (std::size_t i = value; i < source.size(); ++i) {
                const char ch = source[i];
                if (quote == '"' && ch == '\\' && i + 1 < source.size()) {
                    const char next = source[++i];
                    switch (next) {
                        case 'n': out.push_back('\n'); break;
                        case 'r': out.push_back('\r'); break;
                        case 't': out.push_back('\t'); break;
                        default: out.push_back(next); break;
                    }
                    continue;
                }
                if (ch == quote) {
                    return out;
                }
                out.push_back(ch);
            }
            return std::nullopt;
        }
        pos = source.find(marker, pos + marker.size());
    }
    return std::nullopt;
}

Args parse_args(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i] ? argv[i] : "";
        auto require_value = [&](const std::string& name) -> std::string {
            if (i + 1 >= argc) {
                throw StagerError("missing value for " + name);
            }
            ++i;
            return argv[i] ? argv[i] : "";
        };
        if (arg == "--source") {
            args.source = require_value(arg);
        } else if (arg == "--overlay-web") {
            args.overlay_web = require_value(arg);
        } else if (arg == "--scene-config") {
            args.scene_config_json = require_value(arg);
            args.scene_config_supplied = true;
        } else if (arg == "--runtime-packets") {
            args.runtime_packets_json = require_value(arg);
            args.runtime_packets_supplied = true;
        } else if (arg == "--geom-transport") {
            args.geom_transport_json = require_value(arg);
        } else if (arg == "--geom-state") {
            args.geom_state_json = require_value(arg);
        } else if (arg == "--event-program") {
            args.event_program_json = require_value(arg);
        } else if (arg == "--help" || arg == "-h") {
            throw StagerError(
                "usage: vkf_native_scene_artifact_stager --source file.vkf --overlay-web webdir "
                "--scene-config json [--runtime-packets json]");
        } else {
            throw StagerError("unknown argument " + arg);
        }
    }
    if (args.source.empty() || args.overlay_web.empty()) {
        throw StagerError("usage: vkf_native_scene_artifact_stager --source file.vkf --overlay-web webdir [--scene-config json]");
    }
    return args;
}

int run(int argc, char** argv) {
    const Args args = parse_args(argc, argv);
    const std::filesystem::path absolute_source = std::filesystem::absolute(args.source);
    if (!std::filesystem::exists(absolute_source)) {
        throw StagerError("source not found: " + absolute_source.string());
    }

    const std::string source_text = read_file_bytes(absolute_source);
    const std::string source_hash = fnv1a64_hex(native_scene_source_tree_bytes(absolute_source, source_text));
    Args effective = args;
    ArtifactInputProvenance scene_config_provenance;
    ArtifactInputProvenance runtime_packets_provenance;
    if (!effective.scene_config_supplied) {
        auto extracted_inline = extract_vkf_string_binding(source_text, "native_scene_config_json");
        auto extracted_path = extract_vkf_string_binding(source_text, "native_scene_config_path");
        if (extracted_inline.has_value()) {
            throw StagerError(
                "native_scene_config_json is not allowed in VKF source; "
                "use native_scene syntax or a fingerprinted native_scene_config_path artifact");
        }
        if (extracted_path.has_value()) {
            const std::filesystem::path config_path = resolve_source_relative_path(absolute_source, *extracted_path);
            if (!std::filesystem::exists(config_path)) {
                throw StagerError("native_scene_config_path not found: " + config_path.string());
            }
            require_generated_scene_config_current(absolute_source, config_path, source_hash);
            effective.scene_config_json = read_file_bytes(config_path);
            scene_config_provenance.source = "path";
            scene_config_provenance.path = slash_path(config_path);
            scene_config_provenance.source_hash_checked = true;
        } else {
            throw StagerError("source does not expose native_scene_config_path and --scene-config was not supplied");
        }
    } else {
        scene_config_provenance.source = "argument";
    }
    effective.scene_config_json = normalize_scene_config_json(effective.scene_config_json);
    ArenaExternalization arena = externalize_mesh_arenas(effective.scene_config_json);
    effective.scene_config_json = std::move(arena.scene_config_json);
    if (!effective.runtime_packets_supplied) {
        auto extracted_inline = extract_vkf_string_binding(source_text, "native_scene_runtime_packets_json");
        auto extracted_path = extract_vkf_string_binding(source_text, "native_scene_runtime_packets_path");
        if (extracted_inline.has_value() && extracted_path.has_value()) {
            throw StagerError("source defines both native_scene_runtime_packets_json and native_scene_runtime_packets_path; choose one");
        }
        if (extracted_path.has_value()) {
            const std::filesystem::path packets_path = resolve_source_relative_path(absolute_source, *extracted_path);
            if (!std::filesystem::exists(packets_path)) {
                throw StagerError("native_scene_runtime_packets_path not found: " + packets_path.string());
            }
            runtime_packets_provenance.source_hash_checked = try_require_generated_artifact_current(
                absolute_source,
                packets_path,
                source_hash,
                "native_scene_runtime_packets_path");
            effective.runtime_packets_json = read_file_bytes(packets_path);
            runtime_packets_provenance.source = "path";
            runtime_packets_provenance.path = slash_path(packets_path);
        } else if (extracted_inline.has_value()) {
            effective.runtime_packets_json = *extracted_inline;
            runtime_packets_provenance.source = "inline";
        }
    } else {
        runtime_packets_provenance.source = "argument";
    }

    const std::string raw_stem = absolute_source.stem().string().empty() ? "main" : absolute_source.stem().string();
    const std::string stem = slugify_stem(raw_stem);
    const std::string page_rel = "sessions/" + stem + "/vkf-scene.html";
    const std::filesystem::path manifest_path = absolute_source.parent_path() / ".vkfbuild" / (raw_stem + ".manifest.json");
    const std::filesystem::path session_dir = std::filesystem::absolute(args.overlay_web) / "sessions" / stem;

    const bool multi_view_scene = is_json_array_text(effective.scene_config_json);
    const std::string config_filename = multi_view_scene
        ? "vf-native-scene-configs-" + fnv1a64_hex(effective.scene_config_json) + ".json"
        : "";
    const std::string arena_filename = !arena.arena_bytes.empty()
        ? "vf-native-scene-arena-" + fnv1a64_hex(arena.arena_bytes) + ".bin"
        : "";
    std::vector<std::string> generated_keep_names;
    if (!config_filename.empty()) {
        generated_keep_names.push_back(config_filename);
    }
    if (!arena_filename.empty()) {
        generated_keep_names.push_back(arena_filename);
    }
    remove_prior_generated_scene_artifacts(session_dir, generated_keep_names);
    bool source_hash_changed = true;
    if (std::filesystem::exists(manifest_path)) {
        const std::string prior_manifest = read_file_bytes(manifest_path);
        const std::string expected_source_hash_field = std::string("\"source_hash\": \"") + source_hash + "\"";
        source_hash_changed = prior_manifest.find(expected_source_hash_field) == std::string::npos;
    }
    write_file(manifest_path, manifest_text(
        absolute_source,
        source_hash,
        page_rel,
        scene_config_provenance,
        runtime_packets_provenance));
    write_file(session_dir / "vkf-scene.html", html_text(effective.scene_config_json, config_filename, arena_filename), source_hash_changed);
    write_file(session_dir / "vf-launch-manifest.json", native_scene_launch_manifest_json(effective.scene_config_json), source_hash_changed);
    if (multi_view_scene) {
        write_file(session_dir / config_filename, effective.scene_config_json + "\n");
    }
    if (!arena_filename.empty()) {
        write_file(session_dir / arena_filename, arena.arena_bytes);
    }
    write_file(session_dir / "vf-runtime-packets.json", effective.runtime_packets_json, source_hash_changed);
    write_file(session_dir / "vf-geom-ledger-transport.json", effective.geom_transport_json, source_hash_changed);
    write_file(session_dir / "vf-geom-ledger-state.json", effective.geom_state_json, source_hash_changed);
    write_file(session_dir / "vf-event-program.json", effective.event_program_json, source_hash_changed);

    std::cout << "{"
              << "\"status\":\"compiled\","
              << "\"manifest_path\":\"" << json_escape(slash_path(manifest_path)) << "\","
              << "\"page_rel\":\"" << json_escape(page_rel) << "\","
              << "\"source_hash\":\"" << source_hash << "\","
              << "\"scene_config_source\":\"" << json_escape(scene_config_provenance.source) << "\","
              << "\"runtime_packets_source\":\"" << json_escape(runtime_packets_provenance.source) << "\""
              << "}\n";
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        return run(argc, argv);
    } catch (const StagerError& error) {
        std::cerr << "vkf_native_scene_artifact_stager: " << error.what() << "\n";
        return 1;
    }
}
