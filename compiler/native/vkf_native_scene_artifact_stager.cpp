#include <cstdint>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>

namespace {

struct Args {
    std::filesystem::path source;
    std::filesystem::path overlay_web;
    std::string scene_config_json = "{}";
    std::string runtime_packets_json = "{\"frames\":[]}";
    std::string geom_transport_json = "{}";
    std::string geom_state_json = "{}";
    std::string event_program_json = "{}";
    bool scene_config_supplied = false;
    bool runtime_packets_supplied = false;
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

void write_file(const std::filesystem::path& path, const std::string& text) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw StagerError("could not write " + path.string());
    }
    output << text;
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

std::string slash_path(const std::filesystem::path& path) {
    return path.generic_string();
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
    throw StagerError("native_scene_config_json contains HTML but no window.__vfNativeSceneConfig assignment");
}

std::string manifest_text(
    const std::filesystem::path& source,
    const std::string& source_hash,
    const std::string& page_rel
) {
    std::ostringstream out;
    out << "{\n"
        << "  \"schema\": \"vektor-flow/native-scene-artifact\",\n"
        << "  \"compiler\": \"vkf-native-scene-artifact-stager-0.1\",\n"
        << "  \"source_path\": \"" << json_escape(slash_path(std::filesystem::absolute(source))) << "\",\n"
        << "  \"source_hash\": \"" << source_hash << "\",\n"
        << "  \"page_rel\": \"" << json_escape(page_rel) << "\",\n"
        << "  \"status\": \"compiled\"\n"
        << "}\n";
    return out.str();
}

std::string html_text(const std::string& scene_config_json) {
    if (is_json_array_text(scene_config_json)) {
        return std::string("<!DOCTYPE html>\n")
            + "<html><head><meta charset=\"utf-8\"><title>VKF Native Scene</title></head>"
            + "<body data-vf-runtime-shell=\"scene\" data-vf-runtime-strict-packet-only=\"true\">"
            + "<script src=\"../../vf-runtime-shell.js\"></script>"
            + "<script>window.__vfNativeSceneConfigs=" + scene_config_json + ";</script>"
            + "<script>(function(global){"
            + "var configs=Array.isArray(global.__vfNativeSceneConfigs)?global.__vfNativeSceneConfigs.slice():[];"
            + "function visible(c){return !(c&&c.scene_ir&&c.scene_ir.frame&&c.scene_ir.frame.visible===false);}"
            + "configs.sort(function(a,b){return (visible(b)?1:0)-(visible(a)?1:0);});"
            + "function fail(err){throw err;}"
            + "function loadAt(index){if(index>=configs.length){return;}"
            + "global.__vfNativeSceneConfig=configs[index];"
            + "var s=document.createElement('script');s.src='../../vf-native-scene.js?view='+String(index);"
            + "s.onload=function(){var delay=index===0?200:0;global.setTimeout(function(){loadAt(index+1);},delay);};"
            + "s.onerror=function(){fail(new Error('failed to load vf-native-scene.js for view '+String(index)));};"
            + "document.body.appendChild(s);}"
            + "function load(){loadAt(0);}"
            + "if(window.VfRuntimeShell&&window.VfRuntimeShell.ensureSceneDependencies){"
            + "window.VfRuntimeShell.ensureSceneDependencies().then(load).catch(fail);"
            + "}else{load();}"
            + "})(window);</script>"
            + "</body></html>\n";
    }
    return std::string("<!DOCTYPE html>\n")
        + "<html><head><meta charset=\"utf-8\"><title>VKF Native Scene</title></head>"
        + "<body data-vf-runtime-shell=\"scene\" data-vf-runtime-strict-packet-only=\"true\">"
        + "<script src=\"../../vf-runtime-shell.js\"></script>"
        + "<script>window.__vfNativeSceneConfig=" + scene_config_json + ";</script>"
        + "<script>(function(){"
        + "function fail(err){throw err;}"
        + "function load(){var s=document.createElement('script');s.src='../../vf-native-scene.js';"
        + "s.onerror=function(){fail(new Error('failed to load vf-native-scene.js'));};"
        + "document.body.appendChild(s);}"
        + "if(window.VfRuntimeShell&&window.VfRuntimeShell.ensureSceneDependencies){"
        + "window.VfRuntimeShell.ensureSceneDependencies().then(load).catch(fail);"
        + "}else{load();}"
        + "})();</script>"
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
    Args effective = args;
    if (!effective.scene_config_supplied) {
        auto extracted = extract_vkf_string_binding(source_text, "native_scene_config_json");
        if (!extracted.has_value()) {
            throw StagerError("source does not expose native_scene_config_json and --scene-config was not supplied");
        }
        effective.scene_config_json = *extracted;
    }
    effective.scene_config_json = normalize_scene_config_json(effective.scene_config_json);
    if (!effective.runtime_packets_supplied) {
        auto extracted = extract_vkf_string_binding(source_text, "native_scene_runtime_packets_json");
        if (extracted.has_value()) {
            effective.runtime_packets_json = *extracted;
        }
    }

    const std::string stem = absolute_source.stem().string().empty() ? "main" : absolute_source.stem().string();
    const std::string page_rel = "sessions/" + stem + "/vkf-scene.html";
    const std::filesystem::path manifest_path = absolute_source.parent_path() / ".vkfbuild" / (stem + ".manifest.json");
    const std::filesystem::path session_dir = std::filesystem::absolute(args.overlay_web) / "sessions" / stem;

    const std::string source_hash = fnv1a64_hex(source_text);
    write_file(manifest_path, manifest_text(absolute_source, source_hash, page_rel));
    write_file(session_dir / "vkf-scene.html", html_text(effective.scene_config_json));
    write_file(session_dir / "vf-runtime-packets.json", effective.runtime_packets_json);
    write_file(session_dir / "vf-geom-ledger-transport.json", effective.geom_transport_json);
    write_file(session_dir / "vf-geom-ledger-state.json", effective.geom_state_json);
    write_file(session_dir / "vf-event-program.json", effective.event_program_json);

    std::cout << "{"
              << "\"status\":\"compiled\","
              << "\"manifest_path\":\"" << json_escape(slash_path(manifest_path)) << "\","
              << "\"page_rel\":\"" << json_escape(page_rel) << "\","
              << "\"source_hash\":\"" << source_hash << "\""
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
