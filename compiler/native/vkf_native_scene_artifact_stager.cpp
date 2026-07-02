#include <cstdint>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <optional>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr const char* kNativeSceneCompilerVersion = "vkf-native-scene-compiler-0.1";

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

struct CompiledUiSceneBundle {
    std::string scene_config_json;
    std::string runtime_packets_json;
    std::string provenance;
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

bool source_has(const std::string& source_text, const std::string& needle) {
    return source_text.find(needle) != std::string::npos;
}

enum class VkfLiteralKind {
    Null,
    Bool,
    Number,
    String,
    Array,
    Object
};

struct VkfLiteralValue {
    VkfLiteralKind kind = VkfLiteralKind::Null;
    bool bool_value = false;
    std::string text;
    std::vector<VkfLiteralValue> array;
    std::vector<std::pair<std::string, VkfLiteralValue>> object;
};

class VkfLiteralParser {
public:
    VkfLiteralParser(const std::string& source, std::size_t pos)
        : source_(source), pos_(pos) {}

    VkfLiteralValue parse_value() {
        skip_ws_and_comments();
        if (pos_ >= source_.size()) {
            throw StagerError("native_scene literal ended unexpectedly");
        }
        const char ch = source_[pos_];
        if (ch == '(') {
            return parse_object(')');
        }
        if (ch == '[') {
            return parse_array();
        }
        if (ch == '"') {
            VkfLiteralValue value;
            value.kind = VkfLiteralKind::String;
            value.text = parse_string();
            return value;
        }
        if (ch == '-' || ch == '+' || ch == '.' || std::isdigit(static_cast<unsigned char>(ch))) {
            VkfLiteralValue value;
            value.kind = VkfLiteralKind::Number;
            value.text = parse_number();
            return value;
        }
        if (is_identifier_start(ch)) {
            const std::string ident = parse_identifier();
            if (ident == "true" || ident == "false") {
                VkfLiteralValue value;
                value.kind = VkfLiteralKind::Bool;
                value.bool_value = ident == "true";
                return value;
            }
            if (ident == "null") {
                return {};
            }
            VkfLiteralValue value;
            value.kind = VkfLiteralKind::String;
            value.text = ident;
            return value;
        }
        throw StagerError(std::string("unexpected character in native_scene literal: ") + ch);
    }

    std::size_t pos() const {
        return pos_;
    }

private:
    const std::string& source_;
    std::size_t pos_ = 0;

    static bool is_identifier_start(char ch) {
        return std::isalpha(static_cast<unsigned char>(ch)) || ch == '_';
    }

    static bool is_identifier_char(char ch) {
        return std::isalnum(static_cast<unsigned char>(ch)) || ch == '_' || ch == '-';
    }

    void skip_ws_and_comments() {
        while (pos_ < source_.size()) {
            const char ch = source_[pos_];
            if (std::isspace(static_cast<unsigned char>(ch))) {
                ++pos_;
                continue;
            }
            if (ch == '#') {
                while (pos_ < source_.size() && source_[pos_] != '\n') {
                    ++pos_;
                }
                continue;
            }
            break;
        }
    }

    std::string parse_identifier() {
        if (pos_ >= source_.size() || !is_identifier_start(source_[pos_])) {
            throw StagerError("expected identifier in native_scene literal");
        }
        const std::size_t start = pos_;
        ++pos_;
        while (pos_ < source_.size() && is_identifier_char(source_[pos_])) {
            ++pos_;
        }
        return source_.substr(start, pos_ - start);
    }

    std::string parse_string() {
        if (source_[pos_] != '"') {
            throw StagerError("expected string in native_scene literal");
        }
        ++pos_;
        std::string out;
        while (pos_ < source_.size()) {
            const char ch = source_[pos_++];
            if (ch == '"') {
                return out;
            }
            if (ch == '\\') {
                if (pos_ >= source_.size()) {
                    throw StagerError("unterminated string escape in native_scene literal");
                }
                const char esc = source_[pos_++];
                switch (esc) {
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case 'n': out.push_back('\n'); break;
                    case 'r': out.push_back('\r'); break;
                    case 't': out.push_back('\t'); break;
                    default: out.push_back(esc); break;
                }
                continue;
            }
            out.push_back(ch);
        }
        throw StagerError("unterminated string in native_scene literal");
    }

    std::string parse_number() {
        const std::size_t start = pos_;
        if (pos_ < source_.size() && (source_[pos_] == '-' || source_[pos_] == '+')) {
            ++pos_;
        }
        bool saw_digit = false;
        while (pos_ < source_.size() && std::isdigit(static_cast<unsigned char>(source_[pos_]))) {
            saw_digit = true;
            ++pos_;
        }
        if (pos_ < source_.size() && source_[pos_] == '.') {
            ++pos_;
            while (pos_ < source_.size() && std::isdigit(static_cast<unsigned char>(source_[pos_]))) {
                saw_digit = true;
                ++pos_;
            }
        }
        if (pos_ < source_.size() && (source_[pos_] == 'e' || source_[pos_] == 'E')) {
            ++pos_;
            if (pos_ < source_.size() && (source_[pos_] == '-' || source_[pos_] == '+')) {
                ++pos_;
            }
            bool saw_exp_digit = false;
            while (pos_ < source_.size() && std::isdigit(static_cast<unsigned char>(source_[pos_]))) {
                saw_exp_digit = true;
                ++pos_;
            }
            if (!saw_exp_digit) {
                throw StagerError("invalid exponent in native_scene number");
            }
        }
        if (!saw_digit) {
            throw StagerError("invalid native_scene number");
        }
        return source_.substr(start, pos_ - start);
    }

    VkfLiteralValue parse_array() {
        VkfLiteralValue value;
        value.kind = VkfLiteralKind::Array;
        ++pos_;
        skip_ws_and_comments();
        while (pos_ < source_.size() && source_[pos_] != ']') {
            value.array.push_back(parse_value());
            skip_ws_and_comments();
            if (pos_ < source_.size() && source_[pos_] == ',') {
                ++pos_;
                skip_ws_and_comments();
            } else if (pos_ < source_.size() && source_[pos_] != ']') {
                throw StagerError("expected comma or ] in native_scene array");
            }
        }
        if (pos_ >= source_.size() || source_[pos_] != ']') {
            throw StagerError("unterminated native_scene array");
        }
        ++pos_;
        return value;
    }

    VkfLiteralValue parse_object(char close_ch) {
        VkfLiteralValue value;
        value.kind = VkfLiteralKind::Object;
        ++pos_;
        skip_ws_and_comments();
        while (pos_ < source_.size() && source_[pos_] != close_ch) {
            std::string key;
            if (source_[pos_] == '"') {
                key = parse_string();
            } else {
                key = parse_identifier();
            }
            skip_ws_and_comments();
            if (pos_ >= source_.size() || source_[pos_] != ':') {
                throw StagerError("expected : after native_scene field " + key);
            }
            ++pos_;
            value.object.push_back({key, parse_value()});
            skip_ws_and_comments();
            if (pos_ < source_.size() && source_[pos_] == ',') {
                ++pos_;
                skip_ws_and_comments();
            } else if (pos_ < source_.size() && source_[pos_] != close_ch) {
                throw StagerError("expected comma or closing paren in native_scene object");
            }
        }
        if (pos_ >= source_.size() || source_[pos_] != close_ch) {
            throw StagerError("unterminated native_scene object");
        }
        ++pos_;
        return value;
    }
};

std::string vkf_literal_to_json(const VkfLiteralValue& value) {
    switch (value.kind) {
        case VkfLiteralKind::Null:
            return "null";
        case VkfLiteralKind::Bool:
            return value.bool_value ? "true" : "false";
        case VkfLiteralKind::Number:
            return value.text;
        case VkfLiteralKind::String:
            return "\"" + json_escape(value.text) + "\"";
        case VkfLiteralKind::Array: {
            std::ostringstream out;
            out << "[";
            for (std::size_t i = 0; i < value.array.size(); ++i) {
                if (i > 0) {
                    out << ",";
                }
                out << vkf_literal_to_json(value.array[i]);
            }
            out << "]";
            return out.str();
        }
        case VkfLiteralKind::Object: {
            std::ostringstream out;
            out << "{";
            for (std::size_t i = 0; i < value.object.size(); ++i) {
                if (i > 0) {
                    out << ",";
                }
                out << "\"" << json_escape(value.object[i].first) << "\":"
                    << vkf_literal_to_json(value.object[i].second);
            }
            out << "}";
            return out.str();
        }
    }
    return "null";
}

const VkfLiteralValue* object_field(const VkfLiteralValue& value, const std::string& key) {
    if (value.kind != VkfLiteralKind::Object) {
        return nullptr;
    }
    for (const auto& item : value.object) {
        if (item.first == key) {
            return &item.second;
        }
    }
    return nullptr;
}

std::string literal_json_or(const VkfLiteralValue& value, const std::string& key, const std::string& fallback) {
    if (const VkfLiteralValue* field = object_field(value, key)) {
        return vkf_literal_to_json(*field);
    }
    return fallback;
}

std::string literal_string_or(const VkfLiteralValue& value, const std::string& key, const std::string& fallback) {
    if (const VkfLiteralValue* field = object_field(value, key)) {
        if (field->kind == VkfLiteralKind::String) {
            return field->text;
        }
    }
    return fallback;
}

std::string literal_number_at_or(const VkfLiteralValue* value, std::size_t index, const std::string& fallback) {
    if (!value || value->kind != VkfLiteralKind::Array || index >= value->array.size()) {
        return fallback;
    }
    const VkfLiteralValue& item = value->array[index];
    if (item.kind == VkfLiteralKind::Number) {
        return item.text;
    }
    return fallback;
}

std::optional<VkfLiteralValue> try_parse_native_scene_literal(const std::string& source_text) {
    const std::size_t marker = source_text.find("native_scene:");
    if (marker == std::string::npos) {
        return std::nullopt;
    }
    VkfLiteralParser parser(source_text, marker + std::string("native_scene:").size());
    VkfLiteralValue root = parser.parse_value();
    if (root.kind != VkfLiteralKind::Object) {
        throw StagerError("native_scene must be a field object wrapped in parens");
    }
    return root;
}

std::string native_scene_embedding_json(const std::vector<std::pair<std::string, std::string>>& pairs) {
    std::ostringstream out;
    out << "{";
    for (std::size_t i = 0; i < pairs.size(); ++i) {
        if (i > 0) {
            out << ",";
        }
        out << "\"" << json_escape(pairs[i].first) << "\":\"" << json_escape(pairs[i].second) << "\"";
    }
    out << "}";
    return out.str();
}

std::string runtime_asset_version_for(const std::filesystem::path& overlay_web) {
    std::string bytes;
    const std::vector<std::string> rels = {
        "vf-runtime-shell.js",
        "vf-native-scene.js",
        "vf-display.js"
    };
    for (const std::string& rel : rels) {
        const std::filesystem::path path = overlay_web / rel;
        if (!std::filesystem::exists(path)) {
            throw StagerError("runtime asset required for versioning is missing: " + path.string());
        }
        bytes += rel;
        bytes.push_back('\0');
        bytes += read_file_bytes(path);
        bytes.push_back('\0');
    }
    return fnv1a64_hex(bytes);
}

std::string native_scene_mesh_embedding_json(const std::string& kind) {
    if (kind == "quad") {
        return native_scene_embedding_json({
            {"id", "id"}, {"center", "center"}, {"size", "size"}, {"z", "z"}, {"color", "color"},
            {"visible", "visible"}, {"surface_system", "surface_system"}, {"casts_shadow", "casts_shadow"},
            {"receives_shadow", "receives_shadow"}
        });
    }
    return native_scene_embedding_json({
        {"id", "id"}, {"center", "center"}, {"size", "size"}, {"rotation", "rotation"},
        {"transform", "transform"}, {"face_color", "face_color"}, {"color", "color"},
        {"texture", "texture"}, {"surface_system", "surface_system"},
        {"specular_strength", "specular_strength"}, {"roughness", "roughness"},
        {"no_backface_specular", "no_backface_specular"}, {"casts_shadow", "casts_shadow"},
        {"receives_shadow", "receives_shadow"}
    });
}

std::string native_scene_camera_embedding_json() {
    return native_scene_embedding_json({
        {"pos", "pos"}, {"target", "target"}, {"fov", "fov"}, {"up", "up"},
        {"controls_mode", "controls_mode"}, {"speed", "speed"}, {"sensitivity", "sensitivity"},
        {"min_distance", "min_distance"}, {"radius", "radius"}, {"height", "height"},
        {"theta", "theta"}, {"turns_per_cycle", "turns_per_cycle"}
    });
}

std::string native_scene_light_embedding_json() {
    return native_scene_embedding_json({
        {"id", "id"}, {"kind", "kind"}, {"pos", "pos"}, {"target", "target"},
        {"motion", "motion"}, {"radius", "radius"}, {"height", "height"}, {"theta", "theta"},
        {"theta_amplitude", "theta_amplitude"}, {"turns_per_cycle", "turns_per_cycle"},
        {"angular_velocity", "angular_velocity"}, {"direction", "direction"}, {"intensity", "intensity"},
        {"power", "power"}, {"inner_cone_deg", "inner_cone_deg"}, {"outer_cone_deg", "outer_cone_deg"},
        {"range", "range"}, {"model", "model"}, {"color", "color"}, {"casts_shadow", "casts_shadow"},
        {"show_marker", "show_marker"}, {"source_radius", "source_radius"}, {"spread", "spread"},
        {"aperture_face_id", "aperture_face_id"}, {"aperture_mesh_id", "aperture_mesh_id"},
        {"reflect_of_light_id", "reflect_of_light_id"}, {"reflect_mirror_mesh_id", "reflect_mirror_mesh_id"},
        {"clip_epsilon_ratio", "clip_epsilon_ratio"}
    });
}

std::string native_scene_frame_command_json(const VkfLiteralValue& root) {
    const std::string frame_id = literal_string_or(root, "frame_id", "native_scene_frame");
    const std::string title = literal_string_or(root, "title", frame_id);
    const VkfLiteralValue* rect = object_field(root, "rect");
    std::ostringstream out;
    out << "{"
        << "\"kind\":\"frame_upsert\","
        << "\"id\":\"" << json_escape(frame_id) << "\","
        << "\"payload\":{\"spec\":{"
        << "\"id\":\"" << json_escape(frame_id) << "\","
        << "\"title\":\"" << json_escape(title) << "\","
        << "\"title_align\":\"left\","
        << "\"rect\":{\"x\":" << literal_number_at_or(rect, 0, "0.08")
        << ",\"y\":" << literal_number_at_or(rect, 1, "0.08")
        << ",\"w\":" << literal_number_at_or(rect, 2, "0.78")
        << ",\"h\":" << literal_number_at_or(rect, 3, "0.80") << "},"
        << "\"flags\":{\"draggable\":true,\"dockable\":true,\"resizable\":true,\"closable\":true,\"use_browser\":true},"
        << "\"alpha\":1.0,"
        << "\"master\":true,"
        << "\"exit_counted\":true,"
        << "\"dock_location\":\"bl\","
        << "\"anchor\":\"tl\","
        << "\"body\":null,"
        << "\"body_layout\":null,"
        << "\"parent_id\":null,"
        << "\"aspect\":null"
        << "}}}";
    return out.str();
}

std::string native_scene_runtime_packets_json(const VkfLiteralValue& root) {
    const std::string frame_id = literal_string_or(root, "frame_id", "native_scene_frame");
    return "[{\"seq\":1,\"kind\":\"scene.replace\",\"payload\":{\"commands\":[" +
        native_scene_frame_command_json(root) +
        "]}},{\"seq\":2,\"kind\":\"ui_state.replace\",\"payload\":{\"state\":{}}},"
        "{\"seq\":3,\"kind\":\"display.replace\",\"payload\":{\"display\":{\"screen\":[],\"frames\":{},\"geom\":{}}}}]";
}

std::string native_scene_scene_ir_json(const VkfLiteralValue& root) {
    const std::string frame_id = literal_string_or(root, "frame_id", "native_scene_frame");
    const std::string title = literal_string_or(root, "title", frame_id);
    const VkfLiteralValue* rect = object_field(root, "rect");
    std::vector<std::string> mesh_jsons;
    std::vector<std::string> occluder_ids;

    if (const VkfLiteralValue* plane = object_field(root, "plane")) {
        mesh_jsons.push_back("{\"id\":\"plane_0\",\"kind\":\"quad\",\"properties\":" +
            vkf_literal_to_json(*plane) + ",\"embedding\":" + native_scene_mesh_embedding_json("quad") + "}");
    }
    if (const VkfLiteralValue* cubes = object_field(root, "cubes")) {
        if (cubes->kind == VkfLiteralKind::Array) {
            for (std::size_t i = 0; i < cubes->array.size(); ++i) {
                const VkfLiteralValue& cube = cubes->array[i];
                const std::string id = literal_string_or(cube, "id", "cube_" + std::to_string(i));
                mesh_jsons.push_back("{\"id\":\"" + json_escape(id) + "\",\"kind\":\"cube\",\"properties\":" +
                    vkf_literal_to_json(cube) + ",\"embedding\":" + native_scene_mesh_embedding_json("cube") + "}");
                occluder_ids.push_back(id);
            }
        }
    }
    if (const VkfLiteralValue* meshes = object_field(root, "meshes")) {
        if (meshes->kind == VkfLiteralKind::Array) {
            for (std::size_t i = 0; i < meshes->array.size(); ++i) {
                const VkfLiteralValue& mesh = meshes->array[i];
                const std::string id = literal_string_or(mesh, "id", "mesh_" + std::to_string(i));
                const std::string kind = literal_string_or(mesh, "kind", "mesh");
                mesh_jsons.push_back("{\"id\":\"" + json_escape(id) + "\",\"kind\":\"" + json_escape(kind) + "\",\"properties\":" +
                    vkf_literal_to_json(mesh) + ",\"embedding\":" + native_scene_mesh_embedding_json(kind) + "}");
                occluder_ids.push_back(id);
            }
        }
    }

    std::vector<std::string> light_jsons;
    std::vector<std::string> light_ids;
    if (const VkfLiteralValue* lights = object_field(root, "lights")) {
        if (lights->kind == VkfLiteralKind::Array) {
            for (std::size_t i = 0; i < lights->array.size(); ++i) {
                const VkfLiteralValue& light = lights->array[i];
                const std::string id = literal_string_or(light, "id", "light_" + std::to_string(i));
                light_jsons.push_back("{\"id\":\"" + json_escape(id) + "\",\"properties\":" +
                    vkf_literal_to_json(light) + ",\"embedding\":" + native_scene_light_embedding_json() + "}");
                light_ids.push_back(id);
            }
        }
    }

    std::ostringstream out;
    out << "{\"scene_ir\":{"
        << "\"frame\":{\"frame_id\":\"" << json_escape(frame_id) << "\","
        << "\"title\":\"" << json_escape(title) << "\","
        << "\"rect\":[" << literal_number_at_or(rect, 0, "0.08") << ","
        << literal_number_at_or(rect, 1, "0.08") << ","
        << literal_number_at_or(rect, 2, "0.78") << ","
        << literal_number_at_or(rect, 3, "0.80") << "],"
        << "\"aspect\":null,\"visible\":true},"
        << "\"background\":" << literal_json_or(root, "background", "[0,0,0,0]") << ","
        << "\"camera\":{\"properties\":" << literal_json_or(root, "camera", "{}")
        << ",\"embedding\":" << native_scene_camera_embedding_json() << "},"
        << "\"meshes\":[";
    for (std::size_t i = 0; i < mesh_jsons.size(); ++i) {
        if (i > 0) {
            out << ",";
        }
        out << mesh_jsons[i];
    }
    out << "],\"lights\":[";
    for (std::size_t i = 0; i < light_jsons.size(); ++i) {
        if (i > 0) {
            out << ",";
        }
        out << light_jsons[i];
    }
    out << "],\"timing\":" << literal_json_or(root, "timing", "{\"fps\":60,\"duration_seconds\":8.0,\"boundary\":\"repeat\"")
        << ",\"render_options\":{"
        << "\"show_light_markers\":" << literal_json_or(root, "show_light_markers", "false") << ","
        << "\"light_flares\":" << literal_json_or(root, "light_flares", "false") << ","
        << "\"light_marker_size\":" << literal_json_or(root, "light_marker_size", "0.18")
        << "},\"shadow\":" << literal_json_or(root, "shadow", "{}")
        << ",\"surface_worlds\":" << literal_json_or(root, "surface_worlds", "{}")
        << ",\"surface_cameras\":" << literal_json_or(root, "surface_cameras", "{}");

    if (const VkfLiteralValue* receivers = object_field(root, "shadow_receivers")) {
        out << ",\"shadow_receivers\":" << vkf_literal_to_json(*receivers);
    } else if (!occluder_ids.empty() && !light_ids.empty() && object_field(root, "shadow")) {
        out << ",\"shadow_receivers\":[{\"properties\":{\"receiver_mesh\":\"plane_0\",\"occluders\":[";
        for (std::size_t i = 0; i < occluder_ids.size(); ++i) {
            if (i > 0) {
                out << ",";
            }
            out << "\"" << json_escape(occluder_ids[i]) << "\"";
        }
        out << "],\"lights\":[";
        for (std::size_t i = 0; i < light_ids.size(); ++i) {
            if (i > 0) {
                out << ",";
            }
            out << "\"" << json_escape(light_ids[i]) << "\"";
        }
        out << "],\"policy_kind\":\"light_camera_depth_map\",\"policy_softness\":\"shadow_map_bias\"},"
            << "\"embedding\":" << native_scene_embedding_json({
                {"receiver_mesh", "receiver_mesh"}, {"occluders", "occluders"}, {"lights", "lights"},
                {"policy_kind", "policy_kind"}, {"policy_softness", "policy_softness"}
            }) << "}]";
    } else {
        out << ",\"shadow_receivers\":[]";
    }
    out << "}}";
    return out.str();
}

std::optional<CompiledUiSceneBundle> try_compile_native_scene_from_source(const std::string& source_text) {
    auto root = try_parse_native_scene_literal(source_text);
    if (!root.has_value()) {
        return std::nullopt;
    }
    CompiledUiSceneBundle bundle;
    bundle.scene_config_json = native_scene_scene_ir_json(*root);
    bundle.runtime_packets_json = native_scene_runtime_packets_json(*root);
    bundle.provenance = "vkf-native-scene-source-lowering";
    return bundle;
}

std::string axis_deck_frame_command_json(
    const std::string& id,
    const std::string& title,
    double x,
    double y,
    double w,
    double h,
    const std::string& body_json = "[]",
    const std::string& body_layout_json = ""
) {
    std::ostringstream out;
    out << "{"
        << "\"kind\":\"frame_upsert\","
        << "\"id\":\"" << json_escape(id) << "\","
        << "\"payload\":{\"spec\":{"
        << "\"id\":\"" << json_escape(id) << "\","
        << "\"title\":\"" << json_escape(title) << "\","
        << "\"title_align\":\"" << (title.empty() ? "left" : "center") << "\","
        << "\"rect\":{\"x\":" << x << ",\"y\":" << y << ",\"w\":" << w << ",\"h\":" << h << "},"
        << "\"flags\":{\"draggable\":" << (title.empty() ? "false" : "true")
        << ",\"dockable\":" << (title.empty() ? "false" : "true")
        << ",\"resizable\":" << (title.empty() ? "false" : "true")
        << ",\"closable\":" << (title.empty() ? "false" : "true")
        << ",\"use_browser\":true},"
        << "\"alpha\":" << (title.empty() ? "1.0" : "0.92") << ","
        << "\"master\":" << (title.empty() ? "false" : "true") << ","
        << "\"dock_location\":\"" << (title.empty() ? "tl" : "bl") << "\","
        << "\"anchor\":\"tl\",";
    if (!body_layout_json.empty()) {
        out << "\"body_layout\":" << body_layout_json << ",";
    }
    out << "\"body\":" << body_json
        << "}}}";
    return out.str();
}

std::string axis2d_controller_mesh_json(
    const std::string& id,
    const std::string& prefix,
    const std::string& variant,
    double x_min,
    double x_max,
    double y_min,
    double y_max,
    double grid_alpha,
    int margin_px
) {
    const bool box = variant == "box" || variant == "polar";
    const bool polar = variant == "polar";
    std::ostringstream out;
    out << "{"
        << "\"id\":\"" << json_escape(id) << "\","
        << "\"type\":\"field_mesh\","
        << "\"vertices\":[-1,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,1,1,1,1,0,-1,0,0,0,1,1,1,1,1,0,1,0,0,0,1,1,1,1,1],"
        << "\"indices\":[0,1,2,3],"
        << "\"topology\":\"line-list\","
        << "\"render_mode\":\"marker_impostor\","
        << "\"marker_space\":\"pixel\","
        << "\"edge_width\":1.2,"
        << "\"color\":\"white\","
        << "\"aspect\":\"equal\","
        << "\"axis_margin_px\":" << margin_px << ","
        << "\"axis_full_frame\":" << (box ? "false" : "true") << ","
        << "\"axis_box\":" << (box ? "true" : "false") << ","
        << "\"axis_polar\":" << (polar ? "true" : "false") << ","
        << "\"axis_bind_id\":\"" << json_escape(prefix) << "__axis2d_bind\","
        << "\"axis_ticks\":{"
        << "\"enabled\":true,"
        << "\"x_min\":" << x_min << ","
        << "\"x_max\":" << x_max << ","
        << "\"y_min\":" << y_min << ","
        << "\"y_max\":" << y_max << ","
        << "\"x_label\":\"x\","
        << "\"y_label\":\"y\","
        << "\"x_tick_label_placement\":\"below\","
        << "\"y_tick_label_placement\":\"left\","
        << "\"x_label_placement\":\"below\","
        << "\"y_label_placement\":\"left\","
        << "\"tick_label_font_size\":11,"
        << "\"label_font_size\":13,"
        << "\"hints\":[1,2,5],"
        << "\"dist\":120,"
        << "\"min_dist\":72,"
        << "\"max_dist\":180,"
        << "\"len\":7,"
        << "\"x_alignment\":\"center\","
        << "\"y_alignment\":\"center\","
        << "\"grid\":true,"
        << "\"grid_alpha\":" << grid_alpha;
    if (polar) {
        out << ",\"polar\":true,\"rings\":5,\"spokes\":16,\"r_max\":1,\"theta_label_step_deg\":45";
    }
    out << "},"
        << "\"axis_plot2d\":null,"
        << "\"mode3d\":false"
        << "}";
    return out.str();
}

std::string axis2d_plot_mesh_json(
    const std::string& id,
    const std::string& bind_id,
    const std::string& x_values,
    const std::string& y_values,
    const std::string& indices,
    const std::string& color,
    const std::string& r_values = "",
    const std::string& phi_values = ""
) {
    std::string plot_meta = "\"axis_plot2d\":{\"x_values\":" + x_values + ",\"y_values\":" + y_values;
    if (!r_values.empty() && !phi_values.empty()) {
        plot_meta += ",\"r_values\":" + r_values + ",\"phi_values\":" + phi_values;
    }
    plot_meta += "},";
    return "{"
        "\"id\":\"" + json_escape(id) + "\","
        "\"type\":\"field_mesh\","
        "\"vertices\":[-1,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,1,1,1,1],"
        "\"indices\":" + indices + ","
        "\"topology\":\"line-list\","
        "\"render_mode\":\"marker_impostor\","
        "\"marker_space\":\"pixel\","
        "\"edge_width\":2.2,"
        "\"color\":" + color + ","
        "\"aspect\":\"equal\","
        "\"axis_full_frame\":false,"
        "\"axis_box\":false,"
        "\"axis_polar\":false,"
        "\"axis_bind_id\":\"" + json_escape(bind_id) + "\","
        + "\"axis_ticks\":null,"
        + plot_meta +
        "\"mode3d\":false"
        "}";
}

std::string trim_numeric_json_token(std::string value) {
    if (value.find('.') == std::string::npos) {
        return value;
    }
    while (!value.empty() && value.back() == '0') {
        value.pop_back();
    }
    if (!value.empty() && value.back() == '.') {
        value.pop_back();
    }
    return value.empty() || value == "-0" ? "0" : value;
}

std::string numeric_array_json(const std::vector<double>& values, int precision = 6) {
    std::ostringstream out;
    out << "[";
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i > 0) {
            out << ",";
        }
        std::ostringstream value;
        value << std::fixed << std::setprecision(precision) << values[i];
        out << trim_numeric_json_token(value.str());
    }
    out << "]";
    return out.str();
}

std::vector<double> linear_values(std::size_t count, double start, double step) {
    std::vector<double> values;
    values.reserve(count);
    for (std::size_t i = 0; i < count; ++i) {
        values.push_back(start + step * static_cast<double>(i));
    }
    return values;
}

std::string axis3d_controller_mesh_json(
    const std::string& id,
    const std::string& prefix,
    const std::string& variant,
    double grid_alpha
) {
    const bool box = variant == "box";
    std::ostringstream out;
    out << "{"
        << "\"id\":\"" << json_escape(id) << "\","
        << "\"type\":\"field_mesh\","
        << "\"vertices\":[-1,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,1,1,1,1,0,-1,0,0,0,1,1,1,1,1,0,1,0,0,0,1,1,1,1,1,0,0,-1,0,0,1,1,1,1,1,0,0,1,0,0,1,1,1,1,1],"
        << "\"indices\":[0,1,2,3,4,5],"
        << "\"topology\":\"line-list\","
        << "\"render_mode\":\"line\","
        << "\"marker_space\":\"pixel\","
        << "\"edge_width\":1.2,"
        << "\"color\":\"white\","
        << "\"axis_bind_id\":\"" << json_escape(prefix) << "__axis3d_bind\","
        << "\"axis_plot3d\":null,"
        << "\"axis3d_helper_lines\":true,"
        << "\"axis_box\":" << (box ? "true" : "false") << ","
        << "\"axis_screen_extend\":false,"
        << "\"axis_grid\":true,"
        << "\"axis_grid_alpha\":" << grid_alpha << ","
        << "\"mode3d\":true,"
        << "\"manifold_dim_count\":1,"
        << "\"depth_write\":true,"
        << "\"receives_lighting\":false"
        << "}";
    return out.str();
}

std::string axis_graph_formula_texts_json(const std::string& kind) {
    std::string text;
    std::string color = "white";
    if (kind == "axis2d_crosshair") {
        text = "$y=\\sin(x)$";
        color = "[1,0.58,0.1,1]";
    } else if (kind == "axis2d_box") {
        text = "$y=0.65\\cos(x)e^{-x^{2}}-0.25$";
        color = "[0.34,0.92,0.78,1]";
    } else if (kind == "axis2d_polar") {
        text = "$r=0.08+0.13\\phi$";
        color = "[1,0.58,0.1,1]";
    } else if (kind == "axis3d_crosshair") {
        text = "$z=u^{2}-v^{2}$";
        color = "[0.98,0.72,0.24,1]";
    } else if (kind == "axis3d_box") {
        text = "$z=\\sin(u)\\cos(v)$";
        color = "[0.18,0.86,1,1]";
    }
    if (text.empty()) {
        return "[]";
    }
    return "[{\"pixel\":true,\"x\":18,\"y\":22,\"text\":\"" + json_escape(text) +
        "\",\"font_size\":16,\"ha\":\"left\",\"va\":\"top\",\"color\":" + color + "}]";
}

std::optional<CompiledUiSceneBundle> try_compile_axis_mode_deck_from_source(const std::string& source_text) {
    if (!source_has(source_text, "Axis Mode Test Deck") ||
        !source_has(source_text, "ui.axis_2d") ||
        !source_has(source_text, "ui.axis_3d")) {
        return std::nullopt;
    }

    struct Mode {
        const char* label;
        const char* value;
        const char* frame_id;
        const char* prefix;
        const char* kind;
    };
    const std::vector<Mode> modes = {
        {"2D crosshair", "2d_crosshair", "axis_panel_2d_crosshair", "panel_2d_crosshair", "axis2d_crosshair"},
        {"2D box", "2d_box", "axis_panel_2d_box", "panel_2d_box", "axis2d_box"},
        {"2D polar", "2d_polar_crosshair", "axis_panel_2d_polar_crosshair", "panel_2d_polar_crosshair", "axis2d_polar"},
        {"3D crosshair", "3d_crosshair", "axis_panel_3d_crosshair", "panel_3d_crosshair", "axis3d_crosshair"},
        {"3D box", "3d_box", "axis_panel_3d_box", "panel_3d_box", "axis3d_box"},
    };

    std::ostringstream options;
    bool first_option = true;
    for (const Mode& mode : modes) {
        if (!source_has(source_text, mode.frame_id)) {
            continue;
        }
        if (!first_option) {
            options << ",";
        }
        first_option = false;
        options << "{\"label\":\"" << mode.label
                << "\",\"value\":\"" << mode.value
                << "\",\"geom_frame\":\"axis_deck:axis_plot\"}";
    }

    const std::string deck_body =
        "["
        "{\"id\":\"axis_mode_group\",\"type\":\"button_group\",\"active\":\"2d_crosshair\","
        "\"grid\":[0,0,1,7],\"align\":\"left\",\"options\":[" + options.str() + "]},"
        "{\"id\":\"axis_log_x\",\"type\":\"checkbox\",\"label\":\"log x\",\"grid\":[0,7,1,1],\"align\":\"left\","
        "\"axis\":\"x\",\"axis_log_target_frames\":[\"axis_deck:axis_plot\"]},"
        "{\"id\":\"axis_log_y\",\"type\":\"checkbox\",\"label\":\"log y\",\"grid\":[0,8,1,1],\"align\":\"left\","
        "\"axis\":\"y\",\"axis_log_target_frames\":[\"axis_deck:axis_plot\"]},"
        "{\"id\":\"axis_log_z\",\"type\":\"checkbox\",\"label\":\"log z\",\"grid\":[0,9,1,1],\"align\":\"left\","
        "\"axis\":\"z\",\"axis_log_target_frames\":[\"axis_deck:axis_plot\"]},"
        "{\"id\":\"mode_status\",\"type\":\"label\",\"text\":\"Active: 2D crosshair\",\"grid\":[0,10,1,2],\"align\":\"left\"},"
        "{\"id\":\"axis_plot\",\"type\":\"plot_panel\",\"grid\":[1,0,1,12],\"align\":\"stretch\"}"
        "]";

    std::vector<std::string> commands;
    commands.push_back(axis_deck_frame_command_json(
        "axis_deck",
        "Axis Mode Test Deck",
        0.05,
        0.06,
        0.9,
        0.84,
        deck_body,
        "{\"type\":\"grid\",\"rows\":2,\"cols\":12,\"row_heights\":\"max-content minmax(0, 1fr)\"}"
    ));

    std::ostringstream scene;
    scene << "[";
    for (std::size_t i = 0; i < commands.size(); ++i) {
        if (i > 0) {
            scene << ",";
        }
        scene << commands[i];
    }
    scene << "]";

    auto mode_geom_body_json = [&](const Mode& mode) {
        std::ostringstream mode_geom;
        const std::string kind(mode.kind);
        mode_geom << "\"meshes\":[";
        if (kind == "axis2d_crosshair") {
            mode_geom << axis2d_controller_mesh_json("panel_2d_crosshair_crosshair", mode.prefix, "crosshair", -1.0, 1.0, -1.0, 1.0, 0.16, 42)
                 << ","
                 << axis2d_plot_mesh_json(
                        "panel_2d_crosshair_sin_curve",
                        "panel_2d_crosshair__axis2d_bind",
                        "[-1,-0.875,-0.75,-0.625,-0.5,-0.375,-0.25,-0.125,0,0.125,0.25,0.375,0.5,0.625,0.75,0.875,1]",
                        "[-0.84147,-0.76754,-0.68164,-0.5851,-0.47943,-0.36627,-0.2474,-0.12467,0,0.12467,0.2474,0.36627,0.47943,0.5851,0.68164,0.76754,0.84147]",
                        "[0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,14,14,15,15,16]",
                        "[1,0.58,0.1,1]"
                    );
        } else if (kind == "axis2d_box") {
            mode_geom << axis2d_controller_mesh_json("panel_2d_box_box", mode.prefix, "box", -1.0, 1.0, -1.0, 1.0, 0.14, 64)
                 << ","
                 << axis2d_plot_mesh_json(
                        "panel_2d_box_cos_bell_curve",
                        "panel_2d_box__axis2d_bind",
                        "[-1,-0.96875,-0.9375,-0.90625,-0.875,-0.84375,-0.8125,-0.78125,-0.75,-0.71875,-0.6875,-0.65625,-0.625,-0.59375,-0.5625,-0.53125,-0.5,-0.46875,-0.4375,-0.40625,-0.375,-0.34375,-0.3125,-0.28125,-0.25,-0.21875,-0.1875,-0.15625,-0.125,-0.09375,-0.0625,-0.03125,0,0.03125,0.0625,0.09375,0.125,0.15625,0.1875,0.21875,0.25,0.28125,0.3125,0.34375,0.375,0.40625,0.4375,0.46875,0.5,0.53125,0.5625,0.59375,0.625,0.65625,0.6875,0.71875,0.75,0.78125,0.8125,0.84375,0.875,0.90625,0.9375,0.96875,1]",
                        "[-0.1208,-0.10598,-0.09027,-0.07368,-0.05624,-0.038,-0.01901,0.00068,0.02099,0.04183,0.06313,0.08478,0.10667,0.12869,0.15071,0.17261,0.19425,0.2155,0.23621,0.25625,0.27549,0.29377,0.31097,0.32697,0.34164,0.35486,0.36655,0.3766,0.38493,0.39148,0.3962,0.39905,0.4,0.39905,0.3962,0.39148,0.38493,0.3766,0.36655,0.35486,0.34164,0.32697,0.31097,0.29377,0.27549,0.25625,0.23621,0.2155,0.19425,0.17261,0.15071,0.12869,0.10667,0.08478,0.06313,0.04183,0.02099,0.00068,-0.01901,-0.038,-0.05624,-0.07368,-0.09027,-0.10598,-0.1208]",
                        "[0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,14,14,15,15,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,30,30,31,31,32,32,33,33,34,34,35,35,36,36,37,37,38,38,39,39,40,40,41,41,42,42,43,43,44,44,45,45,46,46,47,47,48,48,49,49,50,50,51,51,52,52,53,53,54,54,55,55,56,56,57,57,58,58,59,59,60,60,61,61,62,62,63,63,64]",
                        "[0.34,0.92,0.78,1]"
                    );
        } else if (kind == "axis2d_polar") {
            constexpr double pi = 3.14159265358979323846;
            const std::vector<double> polar_phi_values = linear_values(129, 0.0, (2.0 * pi) / 128.0);
            std::vector<double> polar_r_values;
            polar_r_values.reserve(polar_phi_values.size());
            for (double phi : polar_phi_values) {
                polar_r_values.push_back(0.08 + 0.13 * phi);
            }
            mode_geom << axis2d_controller_mesh_json("panel_2d_polar_crosshair_polar_crosshair", mode.prefix, "polar", -1.05, 1.05, -1.05, 1.05, 0.18, 42)
                 << ","
                 << axis2d_plot_mesh_json(
                        "panel_2d_polar_crosshair_spiral_curve",
                        "panel_2d_polar_crosshair__axis2d_bind",
                        "[0.08,0.08628,0.09232,0.09807,0.1035,0.10855,0.11319,0.11738,0.12108,0.12424,0.12683,0.12883,0.13019,0.13089,0.1309,0.1302,0.12877,0.12658,0.12362,0.11988,0.11535,0.11002,0.10389,0.09696,0.08922,0.0807,0.07139,0.0613,0.05047,0.03889,0.02661,0.01363,0,-0.01426,-0.02911,-0.04451,-0.06043,-0.07681,-0.09361,-0.11079,-0.1283,-0.14607,-0.16405,-0.1822,-0.20044,-0.21872,-0.23697,-0.25514,-0.27316,-0.29096,-0.30848,-0.32566,-0.34242,-0.35871,-0.37446,-0.3896,-0.40406,-0.4178,-0.43074,-0.44282,-0.45399,-0.46418,-0.47335,-0.48145,-0.48841,-0.49419,-0.49876,-0.50206,-0.50406,-0.50472,-0.50402,-0.50192,-0.49839,-0.49343,-0.48702,-0.47913,-0.46977,-0.45892,-0.4466,-0.43281,-0.41755,-0.40085,-0.38271,-0.36317,-0.34225,-0.31999,-0.29641,-0.27157,-0.24551,-0.21828,-0.18994,-0.16054,-0.13014,-0.09882,-0.06664,-0.03367,0,0.0343,0.06914,0.10444,0.1401,0.17604,0.21217,0.24838,0.28459,0.32068,0.35658,0.39216,0.42734,0.46201,0.49606,0.52941,0.56195,0.59357,0.62419,0.6537,0.682,0.70901,0.73464,0.75879,0.78138,0.80233,0.82156,0.83899,0.85455,0.86817,0.87979,0.88936,0.89681]",
                        "[0,0.00424,0.00909,0.01455,0.02059,0.02719,0.03434,0.042,0.05015,0.05876,0.06779,0.07722,0.08699,0.09707,0.10743,0.11801,0.12877,0.13966,0.15063,0.16164,0.17264,0.18356,0.19437,0.205,0.2154,0.22553,0.23533,0.24474,0.25371,0.26219,0.27013,0.27749,0.2842,0.29023,0.29554,0.30006,0.30378,0.30664,0.30861,0.30965,0.30973,0.30884,0.30692,0.30398,0.29998,0.29491,0.28875,0.28151,0.27316,0.26371,0.25317,0.24153,0.2288,0.215,0.20015,0.18427,0.16737,0.14949,0.13066,0.11092,0.0903,0.06886,0.04662,0.02365,0,-0.02428,-0.04912,-0.07447,-0.10026,-0.12643,-0.15289,-0.17959,-0.20644,-0.23338,-0.26032,-0.28718,-0.31389,-0.34036,-0.36652,-0.39228,-0.41755,-0.44227,-0.46634,-0.48968,-0.51221,-0.53386,-0.55455,-0.57419,-0.59272,-0.61007,-0.62615,-0.6409,-0.65427,-0.66618,-0.67657,-0.6854,-0.69261,-0.69815,-0.70198,-0.70405,-0.70434,-0.7028,-0.69943,-0.69418,-0.68705,-0.67803,-0.66711,-0.65428,-0.63956,-0.62294,-0.60446,-0.58411,-0.56195,-0.53798,-0.51226,-0.48481,-0.4557,-0.42497,-0.39267,-0.35888,-0.32366,-0.28708,-0.24922,-0.21016,-0.16998,-0.12878,-0.08665,-0.04369,0]",
                        "[0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,14,14,15,15,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,30,30,31,31,32,32,33,33,34,34,35,35,36,36,37,37,38,38,39,39,40,40,41,41,42,42,43,43,44,44,45,45,46,46,47,47,48,48,49,49,50,50,51,51,52,52,53,53,54,54,55,55,56,56,57,57,58,58,59,59,60,60,61,61,62,62,63,63,64,64,65,65,66,66,67,67,68,68,69,69,70,70,71,71,72,72,73,73,74,74,75,75,76,76,77,77,78,78,79,79,80,80,81,81,82,82,83,83,84,84,85,85,86,86,87,87,88,88,89,89,90,90,91,91,92,92,93,93,94,94,95,95,96,96,97,97,98,98,99,99,100,100,101,101,102,102,103,103,104,104,105,105,106,106,107,107,108,108,109,109,110,110,111,111,112,112,113,113,114,114,115,115,116,116,117,117,118,118,119,119,120,120,121,121,122,122,123,123,124,124,125,125,126,126,127,127,128]",
                        "[1,0.58,0.1,1]",
                        numeric_array_json(polar_r_values, 6),
                        numeric_array_json(polar_phi_values, 12)
                    );
        } else if (kind == "axis3d_crosshair") {
            mode_geom << axis3d_controller_mesh_json("panel_3d_crosshair_crosshair", mode.prefix, "crosshair", 0.12);
        } else if (kind == "axis3d_box") {
            mode_geom << axis3d_controller_mesh_json("panel_3d_box_box", mode.prefix, "box", 0.14);
        }
        mode_geom << "],"
             << "\"texts\":" << axis_graph_formula_texts_json(kind) << ",\"frame\":\"axis_deck:axis_plot\"";
        if (kind.rfind("axis3d", 0) == 0) {
            const bool is_box3d = kind == "axis3d_box";
            mode_geom << ",\"axis3d_controls\":true,"
                 << "\"camera\":{\"pos\":[4,4,5.657],\"position\":[4,4,5.657],\"target\":[0,0,0],\"up\":[0,0,1],\"fov\":42,\"projection\":\"orthographic\",\"ortho_scale\":"
                 << (is_box3d ? "3.9" : "3.2") << "},"
                 << "\"axis3d_runtime\":{\"mode\":\"" << (is_box3d ? "box" : "crosshair")
                 << "\",\"x_min\":" << (is_box3d ? "-3" : "-2")
                 << ",\"x_max\":" << (is_box3d ? "3" : "2")
                 << ",\"y_min\":-2,\"y_max\":2,"
                 << "\"z_min\":" << (is_box3d ? "-1" : "-2")
                 << ",\"z_max\":" << (is_box3d ? "1" : "2")
                 << ",\"x_label\":\"x\",\"y_label\":\"y\",\"z_label\":\"z\","
                 << "\"ticks\":true,\"grid\":true,\"grid_alpha\":" << (is_box3d ? "0.14" : "0.12")
                 << ",\"grid_width\":1,\"tick_len_px\":7,\"tick_label_font_size\":11,\"label_font_size\":13}";
        }
        return mode_geom.str();
    };

    std::vector<std::pair<std::string, std::string>> mode_geoms;
    std::string default_mode_body;
    for (const Mode& mode : modes) {
        if (!source_has(source_text, mode.frame_id)) {
            continue;
        }
        const std::string body = mode_geom_body_json(mode);
        mode_geoms.push_back({mode.value, body});
        if (std::string(mode.value) == "2d_crosshair") {
            default_mode_body = body;
        }
    }
    if (default_mode_body.empty() && !mode_geoms.empty()) {
        default_mode_body = mode_geoms.front().second;
    }

    std::ostringstream geom;
    geom << "{\"axis_deck:axis_plot\":{"
         << "\"geom_variants\":{";
    for (std::size_t i = 0; i < mode_geoms.size(); ++i) {
        if (i > 0) {
            geom << ",";
        }
        geom << "\"" << json_escape(mode_geoms[i].first) << "\":{"
             << mode_geoms[i].second
             << "}";
    }
    geom << "},\"active_geom_variant\":\"2d_crosshair\"";
    if (!default_mode_body.empty()) {
        geom << "," << default_mode_body;
    } else {
        geom << ",\"meshes\":[],\"texts\":[],\"frame\":\"axis_deck\"";
    }
    geom << "}}";

    CompiledUiSceneBundle bundle;
    bundle.scene_config_json = scene.str();
    bundle.runtime_packets_json =
        "[{\"seq\":1,\"kind\":\"scene.replace\",\"payload\":{\"commands\":" + scene.str() + "}},"
        "{\"seq\":2,\"kind\":\"display.replace\",\"payload\":{\"display\":{\"screen\":[],\"geom\":" + geom.str() + "}}}]";
    bundle.provenance = "vkf-ui-source-lowering";
    return bundle;
}

std::optional<CompiledUiSceneBundle> try_load_current_native_scene_cache(
    const std::filesystem::path& absolute_source,
    const std::filesystem::path& overlay_web,
    const std::string& expected_source_hash
) {
    const std::string raw_stem = absolute_source.stem().string().empty() ? "main" : absolute_source.stem().string();
    const std::filesystem::path manifest_path = absolute_source.parent_path() / ".vkfbuild" / (raw_stem + ".manifest.json");
    if (!std::filesystem::exists(manifest_path)) {
        return std::nullopt;
    }
    const std::string manifest = read_file_bytes(manifest_path);
    const std::string session_slug = slugify_stem(raw_stem);
    std::vector<std::filesystem::path> session_dirs;
    std::error_code ec;
    auto append_session_dir = [&](const std::filesystem::path& dir) {
        std::error_code abs_ec;
        const std::filesystem::path absolute_dir = std::filesystem::absolute(dir, abs_ec);
        const std::filesystem::path normalized = abs_ec ? dir : absolute_dir;
        for (const std::filesystem::path& existing : session_dirs) {
            if (existing == normalized) {
                return;
            }
        }
        session_dirs.push_back(normalized);
    };
    append_session_dir(std::filesystem::absolute(overlay_web, ec) / "sessions" / session_slug);
    ec.clear();

    std::filesystem::path cursor = absolute_source.parent_path();
    while (!cursor.empty()) {
        append_session_dir(cursor / "native" / "VfOverlay" / "build" / "Release" / "web" / "sessions" / session_slug);
        append_session_dir(cursor / "native" / "VfOverlay" / "build" / "Debug" / "web" / "sessions" / session_slug);
        append_session_dir(cursor / "native" / "VfOverlay" / "build" / "web" / "sessions" / session_slug);
        const std::filesystem::path parent = cursor.parent_path();
        if (parent == cursor) {
            break;
        }
        cursor = parent;
    }

    for (const std::filesystem::path& session_dir : session_dirs) {
        if (!std::filesystem::exists(session_dir)) {
            continue;
        }
        std::vector<std::filesystem::path> config_candidates;
        std::error_code iter_ec;
        for (std::filesystem::directory_iterator it(session_dir, iter_ec), end; !iter_ec && it != end; it.increment(iter_ec)) {
            if (iter_ec || !it->is_regular_file(iter_ec)) {
                continue;
            }
            const std::string name = it->path().filename().string();
            if (name.rfind("vf-native-scene-configs-", 0) == 0 && it->path().extension() == ".json") {
                config_candidates.push_back(it->path());
            }
        }
        std::sort(config_candidates.begin(), config_candidates.end(), [](const auto& a, const auto& b) {
            std::error_code a_ec;
            std::error_code b_ec;
            const auto a_time = std::filesystem::last_write_time(a, a_ec);
            const auto b_time = std::filesystem::last_write_time(b, b_ec);
            if (!a_ec && !b_ec && a_time != b_time) {
                return a_time > b_time;
            }
            return a.generic_string() < b.generic_string();
        });
        for (const std::filesystem::path& config_candidate : config_candidates) {
            const std::filesystem::path source_hash_path = std::filesystem::path(config_candidate.string() + ".source_hash");
            if (std::filesystem::exists(source_hash_path)) {
                std::string cached_source_hash = read_file_bytes(source_hash_path);
                while (!cached_source_hash.empty() && std::isspace(static_cast<unsigned char>(cached_source_hash.back()))) {
                    cached_source_hash.pop_back();
                }
                if (cached_source_hash != expected_source_hash) {
                    continue;
                }
            } else if (newer_than(absolute_source, config_candidate)) {
                continue;
            }
            const std::filesystem::path runtime_packets_path = session_dir / "vf-runtime-packets.json";
            CompiledUiSceneBundle bundle;
            bundle.scene_config_json = read_file_bytes(config_candidate);
            bundle.runtime_packets_json = std::filesystem::exists(runtime_packets_path) ? read_file_bytes(runtime_packets_path) : "[]";
            bundle.provenance = "vkf-native-scene-cache";
            return bundle;
        }
    }
    return std::nullopt;
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
    const std::string& runtime_asset_version,
    const std::string& page_rel,
    const ArtifactInputProvenance& scene_config_provenance,
    const ArtifactInputProvenance& runtime_packets_provenance
) {
    std::ostringstream out;
    out << "{\n"
        << "  \"schema\": \"vektor-flow/native-scene-artifact\",\n"
        << "  \"compiler\": \"" << kNativeSceneCompilerVersion << "\",\n"
        << "  \"source_path\": \"" << json_escape(slash_path(std::filesystem::absolute(source))) << "\",\n"
        << "  \"source_hash\": \"" << source_hash << "\",\n"
        << "  \"runtime_asset_version\": \"" << json_escape(runtime_asset_version) << "\",\n"
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
    const std::string& arena_filename = "",
    const std::string& runtime_asset_version = ""
) {
    const std::string asset_query = runtime_asset_version.empty() ? "" : ("?v=" + json_escape(runtime_asset_version));
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
            + "<body data-vf-runtime-shell=\"scene\" data-vf-runtime-packet-only=\"true\" data-vf-runtime-file-packets=\"vf-runtime-packets.json\" data-vf-runtime-prefer-file-packets=\"true\">"
            + native_scene_runtime_config
            + "<script src=\"../../vf-runtime-shell.js" + asset_query + "\"></script>"
            + "</body></html>\n";
    }
    if (is_json_array_text(scene_config_json) && scene_config_json.find("\"kind\":\"frame_upsert\"") != std::string::npos) {
        return std::string("<!DOCTYPE html>\n")
            + "<html><head><meta charset=\"utf-8\"><title>VKF UI Scene</title></head>"
            + "<body data-vf-runtime-shell=\"scene\" data-vf-runtime-packet-only=\"true\" data-vf-runtime-file-packets=\"vf-runtime-packets.json\" data-vf-runtime-prefer-file-packets=\"true\">"
            + "<script src=\"../../vf-runtime-shell.js" + asset_query + "\"></script>"
            + "<script>(function(){"
            + "function log(m){try{if(window.chrome&&window.chrome.webview&&window.chrome.webview.postMessage){window.chrome.webview.postMessage({type:'vf_log',level:'info',message:'[vkf-ui-bootstrap] '+m,t:Date.now()});}}catch(_){}}"
            + "function ready(){return window.VfRuntimeShell&&typeof window.VfRuntimeShell.applyRuntimePacket==='function';}"
            + "function apply(){if(document.querySelector('.vf-frame')){return;}if(!ready()){return false;}fetch('vf-runtime-packets.json?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.json():[];}).then(function(packets){if(!Array.isArray(packets)){return;}log('fallback applying packets='+packets.length);for(var i=0;i<packets.length;i++){window.VfRuntimeShell.applyRuntimePacket(packets[i]);}}).catch(function(e){log('fallback failed: '+(e&&e.message?e.message:String(e)));});return true;}"
            + "function publish(){try{var layer=document.getElementById('layer');if(document.documentElement){document.documentElement.style.width='100vw';document.documentElement.style.height='100vh';}if(document.body){document.body.style.width='100vw';document.body.style.height='100vh';}if(layer){layer.style.position='fixed';layer.style.inset='0';layer.style.width='100vw';layer.style.height='100vh';}"
            + "var frame=document.querySelector('.vf-frame');if(frame){var r=frame.getBoundingClientRect();if(!r||r.width<1||r.height<1){frame.style.display='flex';frame.style.position='fixed';frame.style.left='64px';frame.style.top='64px';frame.style.width='960px';frame.style.height='640px';frame.style.zIndex='2000';r=frame.getBoundingClientRect();log('forced frame rect '+Math.round(r.width)+'x'+Math.round(r.height));}}"
            + "if(window.VfFrame&&layer&&typeof window.VfFrame.postNativeHostLayout==='function'){var extra=[];if(frame){var rr=frame.getBoundingClientRect();if(rr&&rr.width>=1&&rr.height>=1){extra.push({left:rr.left,top:rr.top,right:rr.right,bottom:rr.bottom});}}window.VfFrame.postNativeHostLayout(layer,{stageAlpha:0,contentReady:true,hitRegions:extra});}}catch(e){log('layout publish failed: '+(e&&e.message?e.message:String(e)));}}"
            + "var tries=0;function tick(){tries++;if(document.querySelector('.vf-frame')){publish();log('frame visible after tries='+tries);setTimeout(publish,80);setTimeout(publish,240);return;}if(!apply()&&tries<20){setTimeout(tick,150);return;}if(tries<20){setTimeout(tick,150);}}setTimeout(tick,600);"
            + "})();</script>"
            + "</body></html>\n";
    }
    if (is_json_array_text(scene_config_json)) {
        const bool external_config = !scene_config_filename.empty();
        const bool external_arena = !arena_filename.empty();
        return std::string("<!DOCTYPE html>\n")
            + "<html><head><meta charset=\"utf-8\"><title>VKF Native Scene</title></head>"
            + "<body data-vf-runtime-shell=\"scene\" data-vf-runtime-autoboot=\"false\" data-vf-runtime-packet-only=\"true\" data-vf-runtime-file-packets=\"vf-runtime-packets.json\" data-vf-runtime-prefer-file-packets=\"true\">"
            + native_scene_runtime_config
            + "<script src=\"../../vf-runtime-shell.js" + asset_query + "\"></script>"
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
            + "function fail(err){var msg=err&&err.message?err.message:String(err);global.__vfLastError=msg;if(global.document&&document.body){document.body.setAttribute('data-vf-native-scene-error','1');var box=document.getElementById('vf-native-scene-shell-error');if(!box){box=document.createElement('div');box.id='vf-native-scene-shell-error';box.style.cssText='position:fixed;right:16px;bottom:16px;z-index:9999;max-width:min(560px,calc(100vw - 32px));max-height:min(260px,calc(100vh - 32px));overflow:auto;padding:12px;border:1px solid rgba(255,215,223,.28);border-radius:8px;background:rgba(20,12,16,.94);color:#ffd7df;font:600 14px/1.45 Consolas,Menlo,monospace;white-space:pre-wrap;pointer-events:auto';var copy=document.createElement('button');copy.textContent='Copy';copy.style.cssText='float:right;margin:0 0 8px 8px';copy.onclick=function(){try{navigator.clipboard.writeText('VKF native scene error: '+msg).catch(function(){});}catch(_){}};var close=document.createElement('button');close.textContent='Close';close.style.cssText='float:right;margin:0 0 8px 12px';close.onclick=function(){if(box&&box.parentNode){box.parentNode.removeChild(box);}};box.appendChild(close);box.appendChild(copy);document.body.appendChild(box);}var text=document.createElement('div');text.textContent='VKF native scene error: '+msg;box.appendChild(text);}throw err;}"
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
            + "var s=document.createElement('script');s.src='../../vf-native-scene.js" + (asset_query.empty() ? "?" : asset_query + "&") + "view='+String(index);"
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
        + "<script src=\"../../vf-runtime-shell.js" + asset_query + "\"></script>"
        + "<script>window.__vfNativeSceneConfig=" + scene_config_json + ";"
        + (external_arena
            ? std::string("window.__vfNativeSceneArenaUrl=\"") + json_escape(arena_filename) + "\";"
            : std::string("window.__vfNativeSceneArenaUrl=\"\";"))
        + "</script>"
        + "<script>(function(global){"
        + "function fail(err){var msg=err&&err.message?err.message:String(err);window.__vfLastError=msg;if(document&&document.body){document.body.setAttribute('data-vf-native-scene-error','1');var box=document.getElementById('vf-native-scene-shell-error');if(!box){box=document.createElement('div');box.id='vf-native-scene-shell-error';box.style.cssText='position:fixed;right:16px;bottom:16px;z-index:9999;max-width:min(560px,calc(100vw - 32px));max-height:min(260px,calc(100vh - 32px));overflow:auto;padding:12px;border:1px solid rgba(255,215,223,.28);border-radius:8px;background:rgba(20,12,16,.94);color:#ffd7df;font:600 14px/1.45 Consolas,Menlo,monospace;white-space:pre-wrap;pointer-events:auto';var copy=document.createElement('button');copy.textContent='Copy';copy.style.cssText='float:right;margin:0 0 8px 8px';copy.onclick=function(){try{navigator.clipboard.writeText('VKF native scene error: '+msg).catch(function(){});}catch(_){}};var close=document.createElement('button');close.textContent='Close';close.style.cssText='float:right;margin:0 0 8px 12px';close.onclick=function(){if(box&&box.parentNode){box.parentNode.removeChild(box);}};box.appendChild(close);box.appendChild(copy);document.body.appendChild(box);}var text=document.createElement('div');text.textContent='VKF native scene error: '+msg;box.appendChild(text);}throw err;}"
        + "function arenaRef(value){return value&&typeof value==='object'&&value.__vf_mesh_arena===true;}"
        + "function nowMs(){return global.performance&&typeof global.performance.now==='function'?global.performance.now():Date.now();}"
        + "function assignArenaRef(holder,key,value,arena){var off=Number(value.byteOffset||0);var len=Number(value.length||0);var type=String(value.type||'');if(type==='float32'){holder[key]=new Float32Array(arena,off,len);return;}if(type==='uint32'){holder[key]=new Uint32Array(arena,off,len);return;}throw new Error('unknown mesh arena type '+type);}"
        + "function hydrateConfig(config){var arenaUrl=String(global.__vfNativeSceneArenaUrl||'');if(!arenaUrl){return Promise.resolve(config);}return fetch(arenaUrl,{cache:'force-cache'}).then(function(r){if(!r.ok){throw new Error('failed to load native scene arena '+arenaUrl+' ('+String(r.status)+')');}return r.arrayBuffer();}).then(function(arena){return new Promise(function(resolve,reject){var stack=[[{root:config},'root',config]];function step(){try{var start=nowMs();while(stack.length&&(nowMs()-start)<6.0){var item=stack.pop();var holder=item[0];var key=item[1];var value=item[2];if(arenaRef(value)){assignArenaRef(holder,key,value,arena);continue;}if(typeof ArrayBuffer!=='undefined'&&ArrayBuffer.isView&&ArrayBuffer.isView(value)){continue;}if(Array.isArray(value)){for(var ai=value.length-1;ai>=0;ai-=1){stack.push([value,ai,value[ai]]);}continue;}if(value&&typeof value==='object'){Object.keys(value).forEach(function(k){stack.push([value,k,value[k]]);});}}if(stack.length){global.setTimeout(step,0);}else{resolve(config);}}catch(err){reject(err);}}step();});});}"
        + "function load(){var s=document.createElement('script');s.src='../../vf-native-scene.js" + asset_query + "';"
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
            auto compiled_ui_scene = try_compile_native_scene_from_source(source_text);
            if (!compiled_ui_scene.has_value()) {
                compiled_ui_scene = try_compile_axis_mode_deck_from_source(source_text);
            }
            if (!compiled_ui_scene.has_value()) {
                compiled_ui_scene = try_load_current_native_scene_cache(absolute_source, effective.overlay_web, source_hash);
            }
            if (!compiled_ui_scene.has_value()) {
                throw StagerError(
                    "source does not expose a VKF compiler-produced native_scene_config_path and --scene-config was not supplied; "
                    "compile the UI scene through compiler/self_hosted/native_scene_compiler.vkf before staging");
            }
            effective.scene_config_json = compiled_ui_scene->scene_config_json;
            scene_config_provenance.source = compiled_ui_scene->provenance;
            scene_config_provenance.source_hash_checked = true;
            if (!effective.runtime_packets_supplied) {
                effective.runtime_packets_json = compiled_ui_scene->runtime_packets_json;
                runtime_packets_provenance.source = compiled_ui_scene->provenance;
                runtime_packets_provenance.source_hash_checked = true;
            }
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
    const std::string runtime_asset_version = runtime_asset_version_for(std::filesystem::absolute(args.overlay_web));

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
    write_file(manifest_path, manifest_text(
        absolute_source,
        source_hash,
        runtime_asset_version,
        page_rel,
        scene_config_provenance,
        runtime_packets_provenance));
    write_file(session_dir / "vkf-scene.html", html_text(effective.scene_config_json, config_filename, arena_filename, runtime_asset_version), true);
    write_file(session_dir / "vf-launch-manifest.json", native_scene_launch_manifest_json(effective.scene_config_json), true);
    if (multi_view_scene) {
        write_file(session_dir / config_filename, effective.scene_config_json + "\n");
    }
    if (!arena_filename.empty()) {
        write_file(session_dir / arena_filename, arena.arena_bytes);
    }
    write_file(session_dir / "vf-runtime-packets.json", effective.runtime_packets_json, true);
    write_file(session_dir / "vf-geom-ledger-transport.json", effective.geom_transport_json, true);
    write_file(session_dir / "vf-geom-ledger-state.json", effective.geom_state_json, true);
    write_file(session_dir / "vf-event-program.json", effective.event_program_json, true);

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
