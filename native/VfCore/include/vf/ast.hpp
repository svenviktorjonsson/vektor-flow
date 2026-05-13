#pragma once

#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace vf {

struct PrimitiveTypeRef {
    std::string name;
};

struct FixedVectorType;
using TypeExpr = std::variant<PrimitiveTypeRef, std::shared_ptr<FixedVectorType>>;

struct FixedVectorType {
    TypeExpr element_type;
    int size = 0;
};

struct NumberLit {
    std::string text;
};

struct Ident {
    std::string name;
};

struct VectorLit;
struct Call;
struct Attribute;
struct DottedIndex;
struct LooseDot;

using Expr = std::variant<
    NumberLit,
    Ident,
    std::shared_ptr<VectorLit>,
    std::shared_ptr<Call>,
    std::shared_ptr<Attribute>,
    std::shared_ptr<DottedIndex>,
    std::shared_ptr<LooseDot>>;

struct VectorLit {
    std::vector<Expr> elements;
};

struct Call {
    Expr func;
    std::vector<Expr> args;
};

struct Attribute {
    Expr value;
    std::string name;
};

struct DottedIndex {
    Expr value;
    int index = 0;
};

struct LooseDot {
    Expr value;
};

struct BindStmt {
    Expr target;
    std::optional<TypeExpr> type_expr;
    Expr value;
};

struct EmitStmt {
    Expr value;
};

using Stmt = std::variant<BindStmt, EmitStmt>;

struct Module {
    std::vector<Stmt> statements;
};

std::string ast_to_json(const Module& module);

}  // namespace vf
