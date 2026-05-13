#include "parser_state.hpp"

#include <utility>

namespace vf {

namespace {

std::string token_string_value(const Token& token, const char* context) {
    if (const auto* value = std::get_if<std::string>(&token.value)) {
        return *value;
    }
    throw ParseError(std::string("expected string token payload for ") + context, token.location);
}

}  // namespace

ParserState::ParserState(std::vector<Token> tokens)
    : tokens_(std::move(tokens)) {}

Module ParserState::parse_module() {
    Module module;
    skip_newlines();
    while (!at_end() && peek_raw() != "EOF") {
        module.statements.push_back(parse_stmt());
        skip_newlines();
    }
    expect("EOF");
    return module;
}

std::string ParserState::peek() const {
    std::size_t scan = index_;
    while (scan < tokens_.size() && tokens_[scan].kind == "NEWLINE") {
        ++scan;
    }
    if (scan >= tokens_.size()) {
        return "EOF";
    }
    return tokens_[scan].kind;
}

std::string ParserState::peek_raw() const {
    if (index_ >= tokens_.size()) {
        return "EOF";
    }
    return tokens_[index_].kind;
}

bool ParserState::at_end() const {
    return index_ >= tokens_.size();
}

void ParserState::skip_newlines() {
    while (index_ < tokens_.size() && tokens_[index_].kind == "NEWLINE") {
        ++index_;
    }
}

Token ParserState::advance() {
    skip_newlines();
    if (index_ >= tokens_.size()) {
        throw ParseError("unexpected end of input", loc_here());
    }
    return tokens_[index_++];
}

Token ParserState::expect(const std::string& kind) {
    skip_newlines();
    if (peek_raw() != kind) {
        throw ParseError("expected " + kind + ", got " + peek_raw(), loc_here());
    }
    return advance();
}

SourceLocation ParserState::loc_here() const {
    if (index_ >= tokens_.size()) {
        return tokens_.back().location;
    }
    return tokens_[index_].location;
}

Stmt ParserState::parse_stmt() {
    skip_newlines();
    if (peek_raw() == "EMIT") {
        return parse_emit_stmt();
    }
    return parse_bind_stmt();
}

BindStmt ParserState::parse_bind_stmt() {
    std::optional<TypeExpr> type_expr;
    if (peek_raw() == "LBRACKET") {
        type_expr = parse_type_expr();
    }
    Expr target = parse_bind_target();
    expect("COLON");
    return BindStmt{std::move(target), std::move(type_expr), parse_expr()};
}

EmitStmt ParserState::parse_emit_stmt() {
    expect("EMIT");
    return EmitStmt{parse_expr()};
}

Expr ParserState::parse_bind_target() {
    Token name = expect("IDENT");
    Expr target = Ident{token_string_value(name, "binding target")};
    while (true) {
        skip_newlines();
        if (peek_raw() != "DOT") {
            break;
        }
        advance();
        Token attr = expect("IDENT");
        target = std::make_shared<Attribute>(
            Attribute{target, token_string_value(attr, "binding attribute")});
    }
    return target;
}

}  // namespace vf
