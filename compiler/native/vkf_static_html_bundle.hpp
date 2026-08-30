#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vf::static_html {

struct Resource {
    std::string name;
    std::string bytes;
};

struct Bundle {
    std::string frame_id;
    std::string entry;
    std::vector<Resource> resources;
};

class Error : public std::runtime_error {
public:
    explicit Error(const std::string& message) : std::runtime_error(message) {}
};

inline std::string lower_ascii(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

inline std::string read(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw Error("Frame.load static resource not found: " + path.string());
    std::ostringstream bytes;
    bytes << input.rdbuf();
    return bytes.str();
}

inline bool escapes(const std::filesystem::path& relative) {
    if (relative.empty() || relative.is_absolute()) return true;
    for (const auto& part : relative) {
        if (part == "..") return true;
    }
    return false;
}

inline std::string hash(const std::string& bytes) {
    std::uint64_t value = 1469598103934665603ull;
    for (const unsigned char byte : bytes) {
        value ^= byte;
        value *= 1099511628211ull;
    }
    std::ostringstream out;
    out << std::hex << std::setfill('0') << std::setw(16) << value;
    return out.str();
}

inline std::string attribute(const std::string& tag, const std::string& name) {
    const std::regex expression(
        "(?:^|\\s)" + name + R"vf(\s*=\s*(?:"([^"]*)"|'([^']*)'))vf",
        std::regex::icase);
    std::smatch match;
    if (!std::regex_search(tag, match, expression)) return "";
    return match[1].matched ? match[1].str() : match[2].str();
}

inline std::vector<std::string> stylesheet_references(const std::string& html) {
    if (std::regex_search(html, std::regex(R"(<\s*script\b)", std::regex::icase)) ||
        std::regex_search(html, std::regex(R"(\son[a-z0-9_-]+\s*=)", std::regex::icase)) ||
        std::regex_search(html, std::regex(R"(javascript\s*:)", std::regex::icase))) {
        throw Error("Frame.load static HTML must be JavaScript-free");
    }
    std::vector<std::string> references;
    const std::regex link(R"(<\s*link\b[^>]*>)", std::regex::icase);
    for (auto it = std::sregex_iterator(html.begin(), html.end(), link);
         it != std::sregex_iterator(); ++it) {
        const std::string tag = it->str();
        const std::string rel = lower_ascii(attribute(tag, "rel"));
        std::istringstream rel_tokens(rel);
        std::string rel_token;
        bool stylesheet = false;
        while (rel_tokens >> rel_token) {
            if (rel_token == "stylesheet") stylesheet = true;
        }
        if (!stylesheet) continue;
        const std::string href = attribute(tag, "href");
        if (href.empty()) throw Error("Frame.load stylesheet link requires href");
        if (href.front() == '/' || href.find(':') != std::string::npos ||
            href.front() == '#') {
            throw Error("Frame.load stylesheet must be source-relative: " + href);
        }
        const std::size_t suffix = href.find_first_of("?#");
        references.push_back(href.substr(0, suffix));
    }
    return references;
}

inline Bundle collect(
    const std::filesystem::path& source_path,
    const std::filesystem::path& html_path,
    const std::string& frame_id
) {
    const std::filesystem::path source_root = std::filesystem::weakly_canonical(
        source_path.parent_path());
    const std::filesystem::path absolute_html = std::filesystem::weakly_canonical(html_path);
    std::error_code relative_error;
    const std::filesystem::path html_relative = std::filesystem::relative(
        absolute_html, source_root, relative_error);
    if (relative_error || escapes(html_relative)) {
        throw Error("Frame.load static resource escapes its VKF source directory: " +
                    absolute_html.string());
    }
    if (!std::filesystem::is_regular_file(absolute_html)) {
        throw Error("Frame.load static resource not found: " + absolute_html.string());
    }

    std::vector<std::pair<std::string, std::string>> files;
    const std::string html = read(absolute_html);
    files.push_back({html_relative.generic_string(), html});
    for (const std::string& reference : stylesheet_references(html)) {
        const std::filesystem::path stylesheet = std::filesystem::weakly_canonical(
            absolute_html.parent_path() / std::filesystem::path(reference));
        const std::filesystem::path relative = std::filesystem::relative(
            stylesheet, source_root, relative_error);
        if (relative_error || escapes(relative)) {
            throw Error("Frame.load static resource escapes its VKF source directory: " +
                        stylesheet.string());
        }
        if (!std::filesystem::is_regular_file(stylesheet)) {
            throw Error("Frame.load static resource not found: " + stylesheet.string());
        }
        files.push_back({relative.generic_string(), read(stylesheet)});
    }
    std::sort(files.begin(), files.end(), [](const auto& left, const auto& right) {
        return left.first < right.first;
    });
    files.erase(std::unique(files.begin(), files.end(), [](const auto& left, const auto& right) {
        return lower_ascii(left.first) == lower_ascii(right.first);
    }), files.end());

    std::string fingerprint;
    for (const auto& [name, bytes] : files) {
        fingerprint += name;
        fingerprint.push_back('\0');
        fingerprint += bytes;
        fingerprint.push_back('\0');
    }
    const std::string directory = "vf-static-ui-" + hash(fingerprint);
    Bundle bundle;
    bundle.frame_id = frame_id;
    bundle.entry = directory + "/" + html_relative.generic_string();
    for (auto& [name, bytes] : files) {
        bundle.resources.push_back(Resource{directory + "/" + name, std::move(bytes)});
    }
    return bundle;
}

}  // namespace vf::static_html
