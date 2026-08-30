#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <functional>
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

inline std::string source_relative_reference(
    std::string reference,
    const std::string& context
) {
    const auto first = reference.find_first_not_of(" \t\r\n");
    const auto last = reference.find_last_not_of(" \t\r\n");
    reference = first == std::string::npos ? "" : reference.substr(first, last - first + 1);
    if (reference.empty()) throw Error(context + " requires a resource path");
    const std::size_t suffix = reference.find_first_of("?#");
    if (suffix != std::string::npos) reference.resize(suffix);
    if (reference.empty()) throw Error(context + " requires a resource path");
    if (reference.front() == '/' || reference.front() == '#' ||
        reference.find(':') != std::string::npos) {
        throw Error(context + " must be source-relative: " + reference);
    }
    return reference;
}

struct HtmlReferences {
    std::vector<std::string> stylesheets;
    std::vector<std::string> assets;
};

inline HtmlReferences html_references(const std::string& html) {
    if (std::regex_search(html, std::regex(R"(<\s*script\b)", std::regex::icase)) ||
        std::regex_search(html, std::regex(R"(\son[a-z0-9_-]+\s*=)", std::regex::icase)) ||
        std::regex_search(html, std::regex(R"(javascript\s*:)", std::regex::icase))) {
        throw Error("Frame.load static HTML must be JavaScript-free");
    }
    HtmlReferences references;
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
        references.stylesheets.push_back(source_relative_reference(
            href, "Frame.load stylesheet"));
    }
    const std::regex image(R"(<\s*(?:img|source)\b[^>]*>)", std::regex::icase);
    for (auto it = std::sregex_iterator(html.begin(), html.end(), image);
         it != std::sregex_iterator(); ++it) {
        const std::string src = attribute(it->str(), "src");
        if (!src.empty()) {
            references.assets.push_back(source_relative_reference(
                src, "Frame.load image"));
        }
    }
    return references;
}

struct CssReferences {
    std::vector<std::string> imports;
    std::vector<std::string> assets;
};

inline std::string matched_reference(const std::smatch& match) {
    for (std::size_t index = 1; index < match.size(); ++index) {
        if (match[index].matched) return match[index].str();
    }
    return "";
}

inline CssReferences css_references(const std::string& css) {
    CssReferences references;
    const std::regex import_expression(
        R"vf(@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^'"\s;)]+))\s*\)?)vf",
        std::regex::icase);
    for (auto it = std::sregex_iterator(css.begin(), css.end(), import_expression);
         it != std::sregex_iterator(); ++it) {
        references.imports.push_back(source_relative_reference(
            matched_reference(*it), "Frame.load CSS import"));
    }
    const std::regex url_expression(
        R"vf(url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"\s)]+))\s*\))vf",
        std::regex::icase);
    for (auto it = std::sregex_iterator(css.begin(), css.end(), url_expression);
         it != std::sregex_iterator(); ++it) {
        const std::string raw = matched_reference(*it);
        if (lower_ascii(raw).rfind("data:", 0) == 0) continue;
        references.assets.push_back(source_relative_reference(
            raw, "Frame.load CSS URL"));
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

    constexpr std::size_t kMaximumResources = 256;
    constexpr std::size_t kMaximumCssDepth = 64;
    std::vector<std::pair<std::string, std::string>> files;
    std::set<std::string> seen;
    std::set<std::string> visiting_css;
    std::set<std::string> visited_css;
    const auto resolve = [&](const std::filesystem::path& owner,
                             const std::string& reference) {
        const std::filesystem::path candidate = std::filesystem::weakly_canonical(
            owner.parent_path() / std::filesystem::path(reference));
        std::error_code error;
        const std::filesystem::path relative = std::filesystem::relative(
            candidate, source_root, error);
        if (error || escapes(relative)) {
            throw Error("Frame.load static resource escapes its VKF source directory: " +
                        candidate.string());
        }
        return candidate;
    };
    const auto add_resource = [&](const std::filesystem::path& resource) {
        std::error_code error;
        const std::filesystem::path relative = std::filesystem::relative(
            resource, source_root, error);
        if (error || escapes(relative)) {
            throw Error("Frame.load static resource escapes its VKF source directory: " +
                        resource.string());
        }
        const std::string name = relative.generic_string();
        if (!seen.insert(lower_ascii(name)).second) return;
        if (files.size() >= kMaximumResources) {
            throw Error("Frame.load static resource graph exceeds 256 files");
        }
        if (!std::filesystem::is_regular_file(resource)) {
            throw Error("Frame.load static resource not found: " + resource.string());
        }
        files.push_back({name, read(resource)});
    };
    const std::string html = read(absolute_html);
    add_resource(absolute_html);
    std::function<void(const std::filesystem::path&, std::size_t)> visit_css;
    visit_css = [&](const std::filesystem::path& stylesheet, std::size_t depth) {
        if (depth > kMaximumCssDepth) {
            throw Error("Frame.load CSS import graph exceeds depth 64");
        }
        std::error_code error;
        const std::string key = lower_ascii(std::filesystem::relative(
            stylesheet, source_root, error).generic_string());
        if (error || escapes(std::filesystem::path(key))) {
            throw Error("Frame.load static resource escapes its VKF source directory: " +
                        stylesheet.string());
        }
        if (visiting_css.find(key) != visiting_css.end()) {
            throw Error("Frame.load CSS import cycle: " + stylesheet.string());
        }
        if (visited_css.find(key) != visited_css.end()) return;
        visiting_css.insert(key);
        add_resource(stylesheet);
        const std::string bytes = read(stylesheet);
        const CssReferences nested = css_references(bytes);
        for (const std::string& reference : nested.imports) {
            visit_css(resolve(stylesheet, reference), depth + 1);
        }
        for (const std::string& reference : nested.assets) {
            add_resource(resolve(stylesheet, reference));
        }
        visiting_css.erase(key);
        visited_css.insert(key);
    };
    const HtmlReferences references = html_references(html);
    for (const std::string& reference : references.stylesheets) {
        visit_css(resolve(absolute_html, reference), 0);
    }
    for (const std::string& reference : references.assets) {
        add_resource(resolve(absolute_html, reference));
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
