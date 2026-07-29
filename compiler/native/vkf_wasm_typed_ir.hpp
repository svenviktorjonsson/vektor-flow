#pragma once

#include "native/VfOverlay/vf/json.hpp"

#include <cstddef>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vkf::wasm {

class TypedIrModelError : public std::runtime_error {
public:
    explicit TypedIrModelError(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct TypeAliasDeclaration {
    std::string name;
    vf::JsonValue type_annotation;
    vf::JsonValue declaration;
    std::size_t source_index = 0;
};

struct FunctionDeclaration {
    std::string name;
    std::string type;
    vf::JsonValue declaration;
    std::size_t source_index = 0;
};

struct RuntimeBinding {
    std::string name;
    std::string type;
    vf::JsonValue value;
    vf::JsonValue declaration;
    std::size_t source_index = 0;
};

struct ExpressionStatement {
    vf::JsonValue expression;
    vf::JsonValue declaration;
    std::size_t source_index = 0;
};

enum class ModuleItemKind {
    TypeAlias,
    Function,
    RuntimeBinding,
    ExpressionStatement,
};

struct ModuleItem {
    ModuleItemKind kind = ModuleItemKind::TypeAlias;
    std::size_t category_index = 0;
    std::size_t source_index = 0;
};

struct TypedModule {
    std::vector<TypeAliasDeclaration> type_aliases;
    std::vector<FunctionDeclaration> functions;
    std::vector<RuntimeBinding> runtime_bindings;
    std::vector<ExpressionStatement> expression_statements;
    std::vector<ModuleItem> items;
};

namespace detail {

inline const vf::JsonValue::Object& require_object(
    const vf::JsonValue& value,
    const std::string& context
) {
    if (!value.is_object()) {
        throw TypedIrModelError("expected object for " + context);
    }
    return value.as_object();
}

inline const vf::JsonValue::Array& require_array(
    const vf::JsonValue& value,
    const std::string& context
) {
    if (!value.is_array()) {
        throw TypedIrModelError("expected array for " + context);
    }
    return value.as_array();
}

inline const vf::JsonValue& require_field(
    const vf::JsonValue::Object& object,
    const std::string& field_name,
    const std::string& context
) {
    const auto found = object.find(field_name);
    if (found == object.end()) {
        throw TypedIrModelError("missing field " + field_name + " in " + context);
    }
    return found->second;
}

inline std::string require_non_empty_string(
    const vf::JsonValue::Object& object,
    const std::string& field_name,
    const std::string& context
) {
    const auto& value = require_field(object, field_name, context);
    if (!value.is_string() || value.as_string().empty()) {
        throw TypedIrModelError(
            "expected non-empty string field " + field_name + " in " + context
        );
    }
    return value.as_string();
}

inline void reserve_unique_name(
    std::map<std::string, std::size_t>& namespace_entries,
    const std::string& name,
    std::size_t source_index,
    const std::string& namespace_name
) {
    const auto [found, inserted] = namespace_entries.emplace(name, source_index);
    if (!inserted) {
        throw TypedIrModelError(
            "duplicate " + namespace_name + " name " + name
            + " at typed_module.body[" + std::to_string(source_index)
            + "]; first declared at typed_module.body["
            + std::to_string(found->second) + "]"
        );
    }
}

}  // namespace detail

inline TypedModule parse_typed_module(const vf::JsonValue& typed_ir) {
    const auto& root = detail::require_object(typed_ir, "typed IR root");
    const std::string root_kind =
        detail::require_non_empty_string(root, "kind", "typed IR root");
    if (root_kind != "typed_module") {
        throw TypedIrModelError("expected typed_module root, got " + root_kind);
    }

    const auto& body = detail::require_array(
        detail::require_field(root, "body", "typed_module"),
        "typed_module.body"
    );

    TypedModule module;
    module.type_aliases.reserve(body.size());
    module.functions.reserve(body.size());
    module.runtime_bindings.reserve(body.size());
    module.expression_statements.reserve(body.size());
    module.items.reserve(body.size());

    std::map<std::string, std::size_t> type_namespace;
    std::map<std::string, std::size_t> runtime_namespace;

    for (std::size_t index = 0; index < body.size(); ++index) {
        const std::string context =
            "typed_module.body[" + std::to_string(index) + "]";
        const auto& declaration = detail::require_object(body[index], context);
        const std::string kind =
            detail::require_non_empty_string(declaration, "kind", context);

        if (kind == "type_alias") {
            const std::string name =
                detail::require_non_empty_string(declaration, "name", context);
            detail::reserve_unique_name(type_namespace, name, index, "type alias");
            const std::size_t category_index = module.type_aliases.size();
            module.type_aliases.push_back({
                name,
                detail::require_field(declaration, "type_annotation", context),
                body[index],
                index,
            });
            module.items.push_back({
                ModuleItemKind::TypeAlias,
                category_index,
                index,
            });
            continue;
        }

        if (kind == "function") {
            const std::string name =
                detail::require_non_empty_string(declaration, "name", context);
            detail::reserve_unique_name(runtime_namespace, name, index, "runtime");
            const std::size_t category_index = module.functions.size();
            module.functions.push_back({
                name,
                detail::require_non_empty_string(declaration, "type", context),
                body[index],
                index,
            });
            module.items.push_back({
                ModuleItemKind::Function,
                category_index,
                index,
            });
            continue;
        }

        if (kind == "store_binding") {
            const std::string name =
                detail::require_non_empty_string(declaration, "name", context);
            detail::reserve_unique_name(runtime_namespace, name, index, "runtime");
            const std::size_t category_index = module.runtime_bindings.size();
            module.runtime_bindings.push_back({
                name,
                detail::require_non_empty_string(declaration, "type", context),
                detail::require_field(declaration, "value", context),
                body[index],
                index,
            });
            module.items.push_back({
                ModuleItemKind::RuntimeBinding,
                category_index,
                index,
            });
            continue;
        }

        if (kind == "expr_stmt") {
            const std::size_t category_index =
                module.expression_statements.size();
            module.expression_statements.push_back({
                detail::require_field(declaration, "expr", context),
                body[index],
                index,
            });
            module.items.push_back({
                ModuleItemKind::ExpressionStatement,
                category_index,
                index,
            });
            continue;
        }

        throw TypedIrModelError(
            "unsupported top-level typed IR declaration kind " + kind
            + " in " + context
        );
    }

    return module;
}

}  // namespace vkf::wasm
