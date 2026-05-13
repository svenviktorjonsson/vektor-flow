#include "vf/ast.hpp"

#include "vf/json.hpp"

#include <sstream>
#include <type_traits>

namespace vf {

namespace {

std::string type_to_json(const TypeExpr& type_expr);
std::string expr_to_json(const Expr& expr);
std::string stmt_to_json(const Stmt& stmt);

std::string type_to_json(const TypeExpr& type_expr) {
    return std::visit(
        [](const auto& current) -> std::string {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, PrimitiveTypeRef>) {
                return std::string("{\"kind\":\"PrimitiveTypeRef\",\"name\":") +
                    json_quote(current.name) + "}";
            } else {
                return std::string("{\"kind\":\"FixedVectorType\",\"element_type\":") +
                    type_to_json(current->element_type) + ",\"size\":" +
                    std::to_string(current->size) + "}";
            }
        },
        type_expr);
}

std::string expr_to_json(const Expr& expr) {
    return std::visit(
        [](const auto& current) -> std::string {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, NumberLit>) {
                return std::string("{\"kind\":\"NumberLit\",\"text\":") +
                    json_quote(current.text) + "}";
            } else if constexpr (std::is_same_v<Value, Ident>) {
                return std::string("{\"kind\":\"Ident\",\"name\":") +
                    json_quote(current.name) + "}";
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<VectorLit>>) {
                std::ostringstream out;
                out << "{\"kind\":\"VectorLit\",\"elements\":[";
                for (std::size_t index = 0; index < current->elements.size(); ++index) {
                    if (index > 0) {
                        out << ",";
                    }
                    out << expr_to_json(current->elements[index]);
                }
                out << "]}";
                return out.str();
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<Call>>) {
                std::ostringstream out;
                out << "{\"kind\":\"Call\",\"func\":" << expr_to_json(current->func) << ",\"args\":[";
                for (std::size_t index = 0; index < current->args.size(); ++index) {
                    if (index > 0) {
                        out << ",";
                    }
                    out << expr_to_json(current->args[index]);
                }
                out << "]}";
                return out.str();
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<Attribute>>) {
                return std::string("{\"kind\":\"Attribute\",\"value\":") +
                    expr_to_json(current->value) + ",\"name\":" + json_quote(current->name) + "}";
            } else if constexpr (std::is_same_v<Value, std::shared_ptr<DottedIndex>>) {
                return std::string("{\"kind\":\"DottedIndex\",\"value\":") +
                    expr_to_json(current->value) + ",\"index\":" + std::to_string(current->index) + "}";
            } else {
                return std::string("{\"kind\":\"LooseDot\",\"value\":") +
                    expr_to_json(current->value) + "}";
            }
        },
        expr);
}

std::string stmt_to_json(const Stmt& stmt) {
    return std::visit(
        [](const auto& current) -> std::string {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, BindStmt>) {
                std::ostringstream out;
                out << "{\"kind\":\"BindStmt\",\"target\":" << expr_to_json(current.target) << ",\"type_expr\":";
                if (current.type_expr.has_value()) {
                    out << type_to_json(*current.type_expr);
                } else {
                    out << "null";
                }
                out << ",\"value\":" << expr_to_json(current.value) << "}";
                return out.str();
            } else {
                return std::string("{\"kind\":\"EmitStmt\",\"value\":") +
                    expr_to_json(current.value) + "}";
            }
        },
        stmt);
}

}  // namespace

std::string ast_to_json(const Module& module) {
    std::ostringstream out;
    out << "{"
        << "\"schema\":\"vektorflow.native_ast\","
        << "\"version\":1,"
        << "\"module\":{\"kind\":\"Module\",\"statements\":[";
    for (std::size_t index = 0; index < module.statements.size(); ++index) {
        if (index > 0) {
            out << ",";
        }
        out << stmt_to_json(module.statements[index]);
    }
    out << "]}}";
    return out.str();
}

}  // namespace vf
