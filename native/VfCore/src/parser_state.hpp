#pragma once

#include "vf/parser.hpp"

#include <vector>

namespace vf {

class ParserState {
public:
    explicit ParserState(std::vector<Token> tokens);

    Module parse_module();

    [[nodiscard]] std::string peek() const;
    [[nodiscard]] std::string peek_raw() const;
    [[nodiscard]] bool at_end() const;
    void skip_newlines();
    Token advance();
    Token expect(const std::string& kind);
    [[nodiscard]] SourceLocation loc_here() const;

    Stmt parse_stmt();
    BindStmt parse_bind_stmt();
    EmitStmt parse_emit_stmt();
    Expr parse_bind_target();

    Expr parse_expr();
    Expr parse_postfix_expr();
    Expr parse_primary_expr();
    std::vector<Expr> parse_arg_list();
    std::vector<Expr> parse_vector_elements();
    TypeExpr parse_type_expr();

private:
    std::vector<Token> tokens_;
    std::size_t index_ = 0;
};

}  // namespace vf
