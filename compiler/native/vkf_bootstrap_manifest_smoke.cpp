#include "native/VfOverlay/vf/json.hpp"

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr std::string_view bootstrap_schema = "vektor-flow/compiler-bootstrap";
constexpr int bootstrap_version = 1;

class BootstrapFailure : public std::runtime_error {
public:
    explicit BootstrapFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Args {
    std::filesystem::path manifest_path;
    bool emit_bundle = false;
};

struct SourceEntry {
    std::string path;
    bool parsed_with_native_parser = false;
};

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw BootstrapFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

std::string normalize_source_text(std::string text) {
    std::string out;
    out.reserve(text.size());
    for (char ch : text) {
        if (ch != '\r') {
            out.push_back(ch);
        }
    }
    return out;
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw BootstrapFailure("missing field " + name + " in " + context);
    }
    return found->second;
}

std::string require_string(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_string()) {
        throw BootstrapFailure("expected string for " + context);
    }
    return value.as_string();
}

int require_int(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_number()) {
        throw BootstrapFailure("expected integer for " + context);
    }
    const double number = value.as_number();
    if (!std::isfinite(number) || std::floor(number) != number) {
        throw BootstrapFailure("expected integer for " + context);
    }
    return static_cast<int>(number);
}

bool require_bool(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_boolean()) {
        throw BootstrapFailure("expected boolean for " + context);
    }
    return value.as_boolean();
}

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw BootstrapFailure("expected object for " + context);
    }
    return value.as_object();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) {
        throw BootstrapFailure("expected array for " + context);
    }
    return value.as_array();
}

Args parse_args(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--emit-bundle") {
            args.emit_bundle = true;
            continue;
        }
        if (!arg.empty() && arg[0] == '-') {
            throw BootstrapFailure("usage: vkf_bootstrap_manifest_smoke [--emit-bundle] <vf-compiler-bootstrap.json>");
        }
        if (!args.manifest_path.empty()) {
            throw BootstrapFailure("usage: vkf_bootstrap_manifest_smoke [--emit-bundle] <vf-compiler-bootstrap.json>");
        }
        args.manifest_path = arg;
    }
    if (args.manifest_path.empty()) {
        throw BootstrapFailure("usage: vkf_bootstrap_manifest_smoke [--emit-bundle] <vf-compiler-bootstrap.json>");
    }
    return args;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
        const std::filesystem::path manifest_path = args.manifest_path;
        const std::filesystem::path repo_root = std::filesystem::absolute(manifest_path).parent_path().parent_path().parent_path();
        const vf::JsonValue root = vf::parse_json(read_file(manifest_path));
        const auto& manifest = object_of(root, "bootstrap manifest");

        const std::string schema = require_string(field(manifest, "schema", "bootstrap manifest"), "bootstrap manifest.schema");
        if (schema != bootstrap_schema) {
            throw BootstrapFailure("unsupported schema");
        }
        const int version = require_int(field(manifest, "version", "bootstrap manifest"), "bootstrap manifest.version");
        if (version != bootstrap_version) {
            throw BootstrapFailure("unsupported version");
        }

        const auto& boundary = object_of(field(manifest, "bootstrap_boundary", "bootstrap manifest"), "bootstrap_boundary");
        const std::string parser = require_string(field(boundary, "parser", "bootstrap_boundary"), "bootstrap_boundary.parser");
        const std::string handoff_goal = require_string(field(boundary, "handoff_goal", "bootstrap_boundary"), "bootstrap_boundary.handoff_goal");
        if (parser != "native-bootstrap") {
            throw BootstrapFailure("unsupported bootstrap parser boundary");
        }

        const auto& sources = array_of(field(manifest, "sources", "bootstrap manifest"), "sources");
        const auto& source_order = array_of(field(manifest, "source_order", "bootstrap manifest"), "source_order");
        const int source_count = require_int(field(manifest, "source_count", "bootstrap manifest"), "bootstrap manifest.source_count");
        const std::string bundle_sha256 = require_string(field(manifest, "bundle_sha256", "bootstrap manifest"), "bootstrap manifest.bundle_sha256");
        if (static_cast<int>(sources.size()) != source_count || static_cast<int>(source_order.size()) != source_count) {
            throw BootstrapFailure("source_count does not match declared sources");
        }
        if (bundle_sha256.size() != 64) {
            throw BootstrapFailure("bundle_sha256 must be 64 hex chars");
        }

        std::vector<SourceEntry> source_entries;
        vf::JsonValue::Array validated_sources;
        for (std::size_t i = 0; i < sources.size(); ++i) {
            const auto& source = object_of(sources[i], "source entry");
            const std::string path = require_string(field(source, "path", "source entry"), "source entry.path");
            const std::string ordered_path = require_string(source_order[i], "source_order item");
            if (path != ordered_path) {
                throw BootstrapFailure("source_order does not match sources");
            }
            const std::string source_sha256 = require_string(field(source, "source_sha256", "source entry"), "source entry.source_sha256");
            const bool parsed = require_bool(field(source, "parsed_with_native_parser", "source entry"), "source entry.parsed_with_native_parser");
            if (!parsed) {
                throw BootstrapFailure("source entry is not native-parser proven");
            }
            if (source_sha256.size() != 64) {
                throw BootstrapFailure("source entry hashes must be 64 hex chars");
            }
            if (!std::filesystem::exists(repo_root / path)) {
                throw BootstrapFailure("missing compiler source " + path);
            }
            source_entries.push_back({path, parsed});

            vf::JsonValue::Object validated;
            validated["path"] = vf::JsonValue(path);
            validated["parsed_with_native_parser"] = vf::JsonValue(parsed);
            validated_sources.push_back(vf::JsonValue(std::move(validated)));
        }

        vf::JsonValue::Object out;
        out["schema"] = vf::JsonValue(std::string(bootstrap_schema));
        out["version"] = vf::JsonValue(static_cast<double>(bootstrap_version));
        out["bootstrap_parser"] = vf::JsonValue(parser);
        out["handoff_goal"] = vf::JsonValue(handoff_goal);
        out["source_count"] = vf::JsonValue(static_cast<double>(source_count));
        out["bundle_sha256"] = vf::JsonValue(bundle_sha256);
        out["sources"] = vf::JsonValue(std::move(validated_sources));
        if (args.emit_bundle) {
            vf::JsonValue::Array bundle_units;
            for (const auto& entry : source_entries) {
                vf::JsonValue::Object unit;
                unit["path"] = vf::JsonValue(entry.path);
                unit["source_text"] = vf::JsonValue(normalize_source_text(read_file(repo_root / entry.path)));
                bundle_units.push_back(vf::JsonValue(std::move(unit)));
            }
            out["bundle_units"] = vf::JsonValue(std::move(bundle_units));
        }
        std::cout << vf::json_stringify(vf::JsonValue(std::move(out)), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<bootstrap-manifest-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
