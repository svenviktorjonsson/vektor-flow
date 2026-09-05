#pragma once

#include "native/VfOverlay/vf/json.hpp"
#include "compiler/native/vkf_physical_dimensions.hpp"

#include <algorithm>
#include <cctype>
#include <functional>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vkf::module_linker {

// Source identities are opaque to linking. Native owns filesystem lookup/cache;
// the browser supplies packaged sources without granting source code host access.
struct SourceProvider {
    std::function<std::optional<std::string>(const std::string&, const std::string&)> resolve;
    std::function<vf::JsonValue(const std::string&)> parse;
    std::function<std::string(const std::string&)> canonical;
};

class ModuleLinkError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

inline std::optional<std::string> dot_module_name(const vf::JsonValue& path_value) {
    if (!path_value.is_object()) return std::nullopt;
    const auto& path = path_value.as_object();
    const auto kind = path.find("kind");
    const auto segments = path.find("segments");
    if (kind == path.end() || !kind->second.is_string()
        || kind->second.as_string() != "dot_module_path"
        || segments == path.end() || !segments->second.is_array()
        || segments->second.as_array().empty()) {
        return std::nullopt;
    }
    std::string name;
    for (const auto& segment : segments->second.as_array()) {
        if (!segment.is_string() || segment.as_string().empty()) return std::nullopt;
        if (!name.empty()) name += '.';
        name += segment.as_string();
    }
    return name;
}

class Linker {
    const SourceProvider& provider_;
public:
    explicit Linker(const SourceProvider& provider) : provider_(provider) {}

private:
std::optional<std::string> spilled_module_path(
    const vf::JsonValue& statement_value,
    const std::string& importing_source
) {
    if (!statement_value.is_object()) return std::nullopt;
    const auto& statement = statement_value.as_object();
    const auto kind = statement.find("kind");
    if (kind == statement.end() || !kind->second.is_string() || kind->second.as_string() != "spill_import") {
        return std::nullopt;
    }
    const auto alias = statement.find("alias");
    if (alias != statement.end() && !alias->second.is_null()) return std::nullopt;
    const auto path = statement.find("path");
    if (path == statement.end() || !path->second.is_object()) return std::nullopt;
    const auto name = dot_module_name(path->second);
    if (!name) return std::nullopt;
    return provider_.resolve(importing_source, *name);
}

struct AliasedModule {
    std::string alias;
    std::string path;
};

std::optional<AliasedModule> aliased_module_path(
    const vf::JsonValue& statement_value,
    const std::string& importing_source
) {
    if (!statement_value.is_object()) return std::nullopt;
    const auto& statement = statement_value.as_object();
    const auto kind = statement.find("kind");
    const auto alias = statement.find("alias");
    const auto path = statement.find("path");
    if (kind == statement.end() || !kind->second.is_string() || kind->second.as_string() != "spill_import"
        || alias == statement.end() || !alias->second.is_string()
        || path == statement.end() || !path->second.is_object()) {
        return std::nullopt;
    }
    const auto name = dot_module_name(path->second);
    if (!name) return std::nullopt;
    const auto resolved = provider_.resolve(importing_source, *name);
    if (!resolved) return std::nullopt;
    return AliasedModule{alias->second.as_string(), *resolved};
}

void collect_linked_aliased_modules(
    const vf::JsonValue& module_value,
    const std::string& module_source,
    std::vector<AliasedModule>& linked_aliases,
    std::set<std::string>& visited_sources,
    std::set<std::string>& visited_aliases
) {
    const auto normalized_source = provider_.canonical(module_source);
    if (!visited_sources.insert(normalized_source).second) return;
    if (!module_value.is_object()) throw ModuleLinkError("linked module AST is not an object");
    const auto& module = module_value.as_object();
    const auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) {
        throw ModuleLinkError("linked module AST has no body");
    }
    for (const auto& statement : body->second.as_array()) {
        const auto imported = aliased_module_path(statement, module_source);
        if (imported) {
            const std::string key = imported->alias + "\n" +
                provider_.canonical(imported->path);
            const bool first_alias_visit = visited_aliases.insert(key).second;
            const auto ast = provider_.parse(imported->path);
            collect_linked_aliased_modules(
                ast, imported->path, linked_aliases,
                visited_sources, visited_aliases);
            // Lower dependencies before their importers. Forward registration
            // intentionally contains only signatures; complete default-argument
            // metadata is installed when the dependency body is lowered.
            if (first_alias_visit) linked_aliases.push_back(*imported);
            continue;
        }
        if (statement.is_object()) {
            const auto& object = statement.as_object();
            const auto kind = object.find("kind");
            const auto alias = object.find("alias");
            if (kind != object.end() && kind->second.is_string() &&
                kind->second.as_string() == "spill_import" &&
                alias != object.end() && alias->second.is_string()) {
                throw ModuleLinkError(
                    "could not resolve linked module import " + alias->second.as_string());
            }
        }
        const auto dependency = spilled_module_path(statement, module_source);
        if (!dependency) continue;
        const auto ast = provider_.parse(*dependency);
        collect_linked_aliased_modules(
            ast, *dependency, linked_aliases,
            visited_sources, visited_aliases);
    }
}

std::string rewrite_module_type_surface(
    const std::string& surface,
    const std::map<std::string, std::string>& symbols
) {
    std::string rewritten;
    rewritten.reserve(surface.size());
    for (std::size_t index = 0; index < surface.size();) {
        const unsigned char first = static_cast<unsigned char>(surface[index]);
        if (!(std::isalpha(first) || surface[index] == '_')) {
            rewritten.push_back(surface[index++]);
            continue;
        }
        std::size_t stop = index + 1;
        while (stop < surface.size()) {
            const unsigned char next = static_cast<unsigned char>(surface[stop]);
            if (!(std::isalnum(next) || surface[stop] == '_')) break;
            ++stop;
        }
        const std::string identifier = surface.substr(index, stop - index);
        const auto replacement = std::isupper(first) ? symbols.find(identifier) : symbols.end();
        rewritten += replacement == symbols.end() ? identifier : replacement->second;
        index = stop;
    }
    return rewritten;
}

std::optional<std::string> plain_identifier_name(const vf::JsonValue& value) {
    if (!value.is_object()) return std::nullopt;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    const auto name = object.find("name");
    if (kind == object.end() || !kind->second.is_string() ||
        kind->second.as_string() != "identifier" ||
        name == object.end() || !name->second.is_string()) {
        return std::nullopt;
    }
    return name->second.as_string();
}

vf::JsonValue rewrite_module_symbols_scoped(
    const vf::JsonValue& value,
    const std::map<std::string, std::string>& symbols,
    const std::set<std::string>& shadowed,
    bool local_scope
) {
    if (value.is_array()) {
        vf::JsonValue::Array rewritten;
        for (const auto& item : value.as_array()) {
            rewritten.push_back(rewrite_module_symbols_scoped(
                item, symbols, shadowed, local_scope));
        }
        return vf::JsonValue(std::move(rewritten));
    }
    if (!value.is_object()) return value;
    const auto& source = value.as_object();
    const auto source_kind = source.find("kind");
    const std::string kind_name = source_kind != source.end() && source_kind->second.is_string()
        ? source_kind->second.as_string() : "";
    vf::JsonValue::Object rewritten;
    if (kind_name == "function_definition") {
        auto function_scope = shadowed;
        const auto params = source.find("params");
        if (params != source.end() && params->second.is_array()) {
            for (const auto& param : params->second.as_array()) {
                if (!param.is_object()) continue;
                const auto name = param.as_object().find("name");
                if (name != param.as_object().end() && name->second.is_string()) {
                    function_scope.insert(name->second.as_string());
                }
            }
        }
        for (const auto& [key, child] : source) {
            rewritten[key] = rewrite_module_symbols_scoped(
                child, symbols, key == "body" ? function_scope : shadowed,
                key == "body");
        }
    } else if (kind_name == "block") {
        for (const auto& [key, child] : source) {
            if (key != "statements" || !child.is_array()) {
                rewritten[key] = rewrite_module_symbols_scoped(
                    child, symbols, shadowed, local_scope);
                continue;
            }
            auto block_scope = shadowed;
            vf::JsonValue::Array statements;
            for (const auto& statement : child.as_array()) {
                statements.push_back(rewrite_module_symbols_scoped(
                    statement, symbols, block_scope, true));
                if (!statement.is_object()) continue;
                const auto target = statement.as_object().find("target");
                if (target == statement.as_object().end()) continue;
                const auto bound = plain_identifier_name(target->second);
                if (bound) block_scope.insert(*bound);
            }
            rewritten[key] = vf::JsonValue(std::move(statements));
        }
    } else if (local_scope && kind_name == "bind") {
        for (const auto& [key, child] : source) {
            const auto bound = key == "target" ? plain_identifier_name(child) : std::nullopt;
            if (bound) {
                rewritten[key] = child;
            } else {
                rewritten[key] = rewrite_module_symbols_scoped(
                    child, symbols, shadowed, local_scope);
            }
        }
    } else {
        for (const auto& [key, child] : source) {
            rewritten[key] = rewrite_module_symbols_scoped(
                child, symbols, shadowed, local_scope);
        }
    }
    const auto kind = rewritten.find("kind");
    const auto name = rewritten.find("name");
    if (kind != rewritten.end() && kind->second.is_string() &&
        name != rewritten.end() && name->second.is_string()) {
        if (kind->second.as_string() == "type_annotation") {
            name->second = vf::JsonValue(
                rewrite_module_type_surface(name->second.as_string(), symbols));
        } else if (kind->second.as_string() == "identifier" ||
                   kind->second.as_string() == "function_definition" ||
                   kind->second.as_string() == "type_alias") {
            const auto replacement = shadowed.find(name->second.as_string()) != shadowed.end()
                ? symbols.end() : symbols.find(name->second.as_string());
            if (replacement != symbols.end()) name->second = replacement->second;
        }
    }
    return vf::JsonValue(std::move(rewritten));
}

vf::JsonValue rewrite_module_symbols(
    const vf::JsonValue& value,
    const std::map<std::string, std::string>& symbols
) {
    return rewrite_module_symbols_scoped(value, symbols, {}, false);
}

vf::JsonValue rewrite_aliased_module_calls(
    const vf::JsonValue& value,
    const std::map<std::string, std::map<std::string, std::string>>& exports
) {
    if (value.is_array()) {
        vf::JsonValue::Array rewritten;
        for (const auto& item : value.as_array()) rewritten.push_back(rewrite_aliased_module_calls(item, exports));
        return vf::JsonValue(std::move(rewritten));
    }
    if (!value.is_object()) return value;
    vf::JsonValue::Object rewritten;
    for (const auto& [key, child] : value.as_object()) {
        rewritten[key] = rewrite_aliased_module_calls(child, exports);
    }
    const auto kind = rewritten.find("kind");
    if (kind != rewritten.end() && kind->second.is_string() &&
        kind->second.as_string() == "attribute") {
        const auto field = rewritten.find("name");
        const auto object = rewritten.find("object");
        if (field != rewritten.end() && field->second.is_string() &&
            object != rewritten.end() && object->second.is_object()) {
            const auto& base = object->second.as_object();
            const auto base_kind = base.find("kind");
            const auto base_name = base.find("name");
            if (base_kind != base.end() && base_kind->second.is_string() &&
                base_kind->second.as_string() == "identifier" &&
                base_name != base.end() && base_name->second.is_string()) {
                const auto module = exports.find(base_name->second.as_string());
                if (module != exports.end()) {
                    const auto exported = module->second.find(field->second.as_string());
                    if (exported != module->second.end()) {
                        vf::JsonValue::Object direct;
                        direct["kind"] = "identifier";
                        direct["name"] = exported->second;
                        return vf::JsonValue(std::move(direct));
                    }
                }
            }
        }
    }
    const auto callee = rewritten.find("callee");
    if (kind == rewritten.end() || !kind->second.is_string() || kind->second.as_string() != "call"
        || callee == rewritten.end() || !callee->second.is_object()) {
        return vf::JsonValue(std::move(rewritten));
    }
    const auto& callee_object = callee->second.as_object();
    const auto callee_kind = callee_object.find("kind");
    const auto field = callee_object.find("name");
    const auto object = callee_object.find("object");
    if (callee_kind == callee_object.end() || !callee_kind->second.is_string()
        || callee_kind->second.as_string() != "attribute"
        || field == callee_object.end() || !field->second.is_string()
        || object == callee_object.end() || !object->second.is_object()) {
        return vf::JsonValue(std::move(rewritten));
    }
    const auto& base = object->second.as_object();
    const auto base_kind = base.find("kind");
    const auto base_name = base.find("name");
    if (base_kind == base.end() || !base_kind->second.is_string() || base_kind->second.as_string() != "identifier"
        || base_name == base.end() || !base_name->second.is_string()) {
        return vf::JsonValue(std::move(rewritten));
    }
    const auto module = exports.find(base_name->second.as_string());
    if (module == exports.end()) return vf::JsonValue(std::move(rewritten));
    const auto exported = module->second.find(field->second.as_string());
    // Source modules may deliberately retain compiler/runtime primitives under
    // the same namespace (for example stat.sum and math.sqrt). Leave those
    // calls qualified so normal typed-IR validation owns the diagnostic.
    if (exported == module->second.end()) return vf::JsonValue(std::move(rewritten));
    vf::JsonValue::Object direct;
    direct["kind"] = "identifier";
    direct["name"] = exported->second;
    rewritten["callee"] = vf::JsonValue(std::move(direct));
    return vf::JsonValue(std::move(rewritten));
}

void collect_linked_identifier_references(
    const vf::JsonValue& value,
    std::set<std::string>& references
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            collect_linked_identifier_references(item, references);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "identifier") {
        const auto name = object.find("name");
        if (name != object.end() && name->second.is_string()) {
            references.insert(name->second.as_string());
        }
        return;
    }
    const bool binding = kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "bind";
    for (const auto& [key, child] : object) {
        if (binding && key == "target") continue;
        collect_linked_identifier_references(child, references);
    }
}

static bool is_elidable_linked_literal(const vf::JsonValue& value) {
    if (!value.is_object()) return false;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind == object.end() || !kind->second.is_string()) return false;
    const auto& name = kind->second.as_string();
    if (name == "number_literal" || name == "string_literal" ||
        name == "bool_literal" || name == "null_literal") {
        return true;
    }
    if (name == "list_literal") {
        const auto items = object.find("items");
        return items != object.end() && items->second.is_array() &&
            std::all_of(
                items->second.as_array().begin(), items->second.as_array().end(),
                [](const auto& item) { return is_elidable_linked_literal(item); });
    }
    if (name == "record_literal") {
        const auto fields = object.find("fields");
        if (fields == object.end() || !fields->second.is_array()) return false;
        return std::all_of(
            fields->second.as_array().begin(), fields->second.as_array().end(),
            [](const auto& field_value) {
                if (!field_value.is_object()) return false;
                const auto& field = field_value.as_object();
                const auto field_kind = field.find("kind");
                const auto field_value_it = field.find("value");
                return field_kind != field.end() && field_kind->second.is_string() &&
                    field_kind->second.as_string() == "record_field" &&
                    field_value_it != field.end() &&
                    is_elidable_linked_literal(field_value_it->second);
            });
    }
    if (name == "block") {
        const auto statements = object.find("statements");
        if (statements == object.end() || !statements->second.is_array()) return false;
        return std::all_of(
            statements->second.as_array().begin(), statements->second.as_array().end(),
            [](const auto& statement_value) {
                if (!statement_value.is_object()) return false;
                const auto& statement = statement_value.as_object();
                const auto statement_kind = statement.find("kind");
                if (statement_kind == statement.end() ||
                    !statement_kind->second.is_string()) {
                    return false;
                }
                if (statement_kind->second.as_string() == "struct_identity") return true;
                if (statement_kind->second.as_string() != "bind") return false;
                const auto value = statement.find("value");
                return value != statement.end() &&
                    is_elidable_linked_literal(value->second);
            });
    }
    return false;
}

std::optional<std::string> linked_binding_name(const vf::JsonValue& statement_value) {
    if (!statement_value.is_object()) return std::nullopt;
    const auto& statement = statement_value.as_object();
    const auto kind = statement.find("kind");
    const auto target = statement.find("target");
    if (kind == statement.end() || !kind->second.is_string() ||
        kind->second.as_string() != "bind" || target == statement.end() ||
        !target->second.is_object()) {
        return std::nullopt;
    }
    const auto& target_object = target->second.as_object();
    const auto target_kind = target_object.find("kind");
    const auto target_name = target_object.find("name");
    if (target_kind == target_object.end() || !target_kind->second.is_string() ||
        target_kind->second.as_string() != "identifier" ||
        target_name == target_object.end() || !target_name->second.is_string()) {
        return std::nullopt;
    }
    return target_name->second.as_string();
}

vf::JsonValue::Array prune_unused_pure_linked_bindings(
    vf::JsonValue::Array body,
    const std::size_t namespaced_statement_count
) {
    std::set<std::string> references;
    for (const auto& statement : body) {
        collect_linked_identifier_references(statement, references);
    }
    vf::JsonValue::Array pruned;
    pruned.reserve(body.size());
    for (std::size_t index = 0; index < body.size(); ++index) {
        auto& statement = body[index];
        const auto name = linked_binding_name(statement);
        const bool namespaced = index < namespaced_statement_count && name &&
            name->rfind("__vkf_module_", 0) == 0;
        if (namespaced && !references.count(*name)) {
            const auto& object = statement.as_object();
            const auto value = object.find("value");
            if (value != object.end() && is_elidable_linked_literal(value->second)) {
                continue;
            }
        }
        pruned.push_back(std::move(statement));
    }
    return pruned;
}

const vf::JsonValue* resolve_static_record(
    const vf::JsonValue& expression,
    const std::map<std::string, const vf::JsonValue*>& bindings,
    std::set<std::string>& resolving
) {
    if (!expression.is_object()) return nullptr;
    const auto& object = expression.as_object();
    const auto kind = object.find("kind");
    if (kind == object.end() || !kind->second.is_string()) return nullptr;
    if (kind->second.as_string() == "record_literal") return &expression;
    if (kind->second.as_string() == "identifier") {
        const auto name = object.find("name");
        if (name == object.end() || !name->second.is_string()) return nullptr;
        const std::string binding_name = name->second.as_string();
        const auto binding = bindings.find(binding_name);
        if (binding == bindings.end() || !resolving.insert(binding_name).second) return nullptr;
        const auto* result = resolve_static_record(*binding->second, bindings, resolving);
        resolving.erase(binding_name);
        return result;
    }
    if (kind->second.as_string() != "attribute") return nullptr;
    const auto base = object.find("object");
    const auto name = object.find("name");
    if (base == object.end() || name == object.end() || !name->second.is_string()) return nullptr;
    const auto* record = resolve_static_record(base->second, bindings, resolving);
    if (!record) return nullptr;
    const auto& record_object = record->as_object();
    const auto fields = record_object.find("fields");
    if (fields == record_object.end() || !fields->second.is_array()) return nullptr;
    for (const auto& field_value : fields->second.as_array()) {
        if (!field_value.is_object()) continue;
        const auto& field = field_value.as_object();
        const auto field_name = field.find("name");
        const auto value = field.find("value");
        if (field_name != field.end() && field_name->second.is_string()
            && field_name->second.as_string() == name->second.as_string()
            && value != field.end()) {
            return resolve_static_record(value->second, bindings, resolving);
        }
    }
    return nullptr;
}

vf::JsonValue::Array expand_top_level_record_spills(vf::JsonValue::Array body) {
    std::map<std::string, const vf::JsonValue*> bindings;
    for (const auto& statement_value : body) {
        if (!statement_value.is_object()) continue;
        const auto& statement = statement_value.as_object();
        const auto kind = statement.find("kind");
        const auto target = statement.find("target");
        const auto value = statement.find("value");
        if (kind == statement.end() || !kind->second.is_string()
            || kind->second.as_string() != "bind"
            || target == statement.end() || !target->second.is_object()
            || value == statement.end()) continue;
        const auto& target_object = target->second.as_object();
        const auto target_kind = target_object.find("kind");
        const auto target_name = target_object.find("name");
        if (target_kind != target_object.end() && target_kind->second.is_string()
            && target_kind->second.as_string() == "identifier"
            && target_name != target_object.end() && target_name->second.is_string()) {
            bindings[target_name->second.as_string()] = &value->second;
        }
    }

    vf::JsonValue::Array expanded;
    for (const auto& statement_value : body) {
        if (!statement_value.is_object()) {
            expanded.push_back(statement_value);
            continue;
        }
        const auto& statement = statement_value.as_object();
        const auto kind = statement.find("kind");
        const auto value = statement.find("value");
        if (kind == statement.end() || !kind->second.is_string()
            || kind->second.as_string() != "spill_value" || value == statement.end()) {
            expanded.push_back(statement_value);
            continue;
        }
        std::set<std::string> resolving;
        const auto* record = resolve_static_record(value->second, bindings, resolving);
        if (!record) {
            expanded.push_back(statement_value);
            continue;
        }
        const auto& fields = record->as_object().at("fields").as_array();
        const bool si_catalog = [&]() {
            if (!value->second.is_object()) return false;
            const auto& expression = value->second.as_object();
            const auto expression_kind = expression.find("kind");
            const auto expression_name = expression.find("name");
            if (expression_kind == expression.end() || !expression_kind->second.is_string()
                || expression_name == expression.end() || !expression_name->second.is_string()) {
                return false;
            }
            const auto& kind_name = expression_kind->second.as_string();
            return (kind_name == "identifier" || kind_name == "attribute")
                && expression_name->second.as_string() == "si";
        }();
        const auto append_binding = [&](const std::string& name,
                                        const vf::JsonValue& binding_value,
                                        const std::optional<vkf::physical::Dimension>& dimension) {
            vf::JsonValue::Object target;
            target["kind"] = "identifier";
            target["name"] = name;
            vf::JsonValue::Object bind;
            bind["kind"] = "bind";
            bind["target"] = vf::JsonValue(std::move(target));
            bind["value"] = binding_value;
            if (dimension) {
                vf::JsonValue::Object type;
                type["kind"] = "type_annotation";
                type["name"] = vkf::physical::unit_type(*dimension);
                bind["type"] = vf::JsonValue(std::move(type));
            }
            expanded.emplace_back(std::move(bind));
        };
        if (si_catalog) {
            for (const auto& unit : vkf::physical::catalog_units("physics.units.si")) {
                vf::JsonValue::Object number;
                number["kind"] = "number_literal";
                number["value"] = unit.scale;
                append_binding(
                    unit.symbol, vf::JsonValue(std::move(number)), unit.dimension);
            }
            continue;
        }
        for (const auto& field_value : fields) {
            const auto& field = field_value.as_object();
            append_binding(
                field.at("name").as_string(), field.at("value"), std::nullopt);
        }
    }
    return expanded;
}

void append_linked_spilled_module_body(
    vf::JsonValue::Array& linked_body,
    const vf::JsonValue& module_value,
    const std::string& module_source,
    std::set<std::string>& linked_sources
) {
    if (!module_value.is_object()) throw ModuleLinkError("linked module AST is not an object");
    const auto& module = module_value.as_object();
    const auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) {
        throw ModuleLinkError("linked module AST has no body");
    }
    for (const auto& statement : body->second.as_array()) {
        const auto dependency = spilled_module_path(statement, module_source);
        if (!dependency || !linked_sources.insert(*dependency).second) continue;
        const auto ast = provider_.parse(*dependency);
        append_linked_spilled_module_body(
            linked_body, ast, *dependency, linked_sources);
    }
    for (const auto& statement : body->second.as_array()) linked_body.push_back(statement);
}

public:
vf::JsonValue link(
    const vf::JsonValue& root_module,
    const std::string& root_source
) {
    vf::JsonValue::Array linked_body;
    std::set<std::string> linked_sources;
    append_linked_spilled_module_body(
        linked_body, root_module, root_source, linked_sources);
    vf::JsonValue::Array namespaced_modules;
    std::map<std::string, std::map<std::string, std::string>> exports;
    std::vector<AliasedModule> linked_aliases;
    std::set<std::string> visited_alias_sources;
    std::set<std::string> visited_aliases;
    collect_linked_aliased_modules(
        root_module, root_source, linked_aliases,
        visited_alias_sources, visited_aliases);
    for (const auto& imported : linked_aliases) {
        const auto dependency_ast = provider_.parse(imported.path);
        vf::JsonValue::Array dependency_body;
        std::set<std::string> dependency_sources;
        append_linked_spilled_module_body(
            dependency_body, dependency_ast, imported.path,
            dependency_sources);
        std::map<std::string, std::string> symbols;
        for (const auto& dependency_statement : dependency_body) {
            if (!dependency_statement.is_object()) continue;
            const auto& object = dependency_statement.as_object();
            const auto kind = object.find("kind");
            const auto name = object.find("name");
            if (kind != object.end() && kind->second.is_string()
                && kind->second.as_string() == "function_definition"
                && name != object.end() && name->second.is_string()) {
                const std::string mangled = "__vkf_module_" + imported.alias + "__" + name->second.as_string();
                symbols[name->second.as_string()] = mangled;
                exports[imported.alias][name->second.as_string()] = mangled;
            }
            if (kind != object.end() && kind->second.is_string() &&
                kind->second.as_string() == "type_alias" &&
                name != object.end() && name->second.is_string()) {
                const std::string mangled = "__vkf_module_" + imported.alias + "__" +
                    name->second.as_string();
                symbols[name->second.as_string()] = mangled;
            }
            if (kind != object.end() && kind->second.is_string() &&
                kind->second.as_string() == "bind") {
                const auto target = object.find("target");
                if (target != object.end() && target->second.is_object()) {
                    const auto& target_object = target->second.as_object();
                    const auto target_kind = target_object.find("kind");
                    const auto target_name = target_object.find("name");
                    if (target_kind != target_object.end() && target_kind->second.is_string() &&
                        target_kind->second.as_string() == "identifier" &&
                        target_name != target_object.end() && target_name->second.is_string()) {
                        const std::string mangled = "__vkf_module_" + imported.alias + "__" +
                            target_name->second.as_string();
                        symbols[target_name->second.as_string()] = mangled;
                        exports[imported.alias][target_name->second.as_string()] = mangled;
                    }
                }
            }
        }
        for (const auto& dependency_statement : dependency_body) {
            namespaced_modules.push_back(rewrite_module_symbols(dependency_statement, symbols));
        }
    }
    vf::JsonValue::Array rewritten_body;
    for (auto& statement : namespaced_modules) {
        rewritten_body.push_back(rewrite_aliased_module_calls(statement, exports));
    }
    const auto namespaced_statement_count = rewritten_body.size();
    for (const auto& statement : linked_body) {
        rewritten_body.push_back(rewrite_aliased_module_calls(statement, exports));
    }
    vf::JsonValue::Object linked_module;
    linked_module["kind"] = "module";
    linked_module["body"] = vf::JsonValue(
        expand_top_level_record_spills(prune_unused_pure_linked_bindings(
            std::move(rewritten_body), namespaced_statement_count)));
    return vf::JsonValue(std::move(linked_module));
}
};

} // namespace vkf::module_linker
