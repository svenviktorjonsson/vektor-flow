#pragma once

#include "compiler/native/vkf_module_linker.hpp"
#include "compiler/native/vkf_native_frontend.hpp"
#include "compiler/native/vkf_stdlib_registry.hpp"
#include "vkf_packaged_stdlib.generated.hpp"

#include <algorithm>
#include <string>
#include <string_view>

namespace vkf::module_linker {

namespace detail {

inline constexpr std::string_view packaged_source_root = "/vkf/stdlib/";

inline const packaged::SourceRecord* packaged_source(std::string_view path) {
    for (const auto& source : packaged::sources) {
        if (source.path == path) return &source;
    }
    return nullptr;
}

inline std::optional<std::string> resolve_packaged_source(
    const std::string& importing_source,
    const std::string& module
) {
    std::string relative = module;
    std::replace(relative.begin(), relative.end(), '.', '/');
    relative += ".vkf";
    // Preserve native's local-before-bundled resolution order. Only canonical
    // packaged identities exist here: lookup never opens a host path.
    if (importing_source.compare(0, packaged_source_root.size(), packaged_source_root) == 0) {
        const std::string importer = importing_source.substr(packaged_source_root.size());
        const auto slash = importer.find_last_of('/');
        const std::string local = (slash == std::string::npos ? "" : importer.substr(0, slash + 1)) + relative;
        if (const auto* source = packaged_source(local)) {
            return std::string(packaged_source_root) + std::string(source->path);
        }
    }
    const auto* registered = vkf::stdlib::find(module);
    if (!registered) return std::nullopt;
    const auto* source = packaged_source(registered->source);
    if (!source) return std::nullopt;
    return std::string(packaged_source_root) + std::string(source->path);
}

} // namespace detail

inline vf::JsonValue link_packaged_modules(
    const vf::JsonValue& ast,
    const std::string& source_identity
) {
    SourceProvider provider;
    provider.resolve = detail::resolve_packaged_source;
    provider.parse = [](const std::string& identity) {
        const auto prefix = detail::packaged_source_root;
        const auto* source = identity.compare(0, prefix.size(), prefix) == 0
            ? detail::packaged_source(std::string_view(identity).substr(prefix.size())) : nullptr;
        if (!source) throw ModuleLinkError("could not read " + identity);
        const auto tokens = vkf::native_frontend::lex_value(std::string(source->source), identity);
        return vkf::native_frontend::parse_value(tokens);
    };
    provider.canonical = [](const std::string& identity) { return identity; };
    return Linker(provider).link(ast, source_identity);
}

} // namespace vkf::module_linker
