#include "parser_state.hpp"

#include <iomanip>
#include <memory>
#include <sstream>
#include <utility>

namespace vf {

namespace {

std::string token_string_value(const Token& token, const char* context) {
    if (const auto* value = std::get_if<std::string>(&token.value)) {
        return *value;
    }
    throw ParseError(std::string("expected string token payload for ") + context, token.location);
}

int token_int_value(const Token& token, const char* context) {
    if (const auto* value = std::get_if<std::int64_t>(&token.value)) {
        return static_cast<int>(*value);
    }
    throw ParseError(std::string("expected integer token payload for ") + context, token.location);
}

std::string token_number_text(const Token& token, const char* context) {
    if (const auto* integer_value = std::get_if<std::int64_t>(&token.value)) {
        return std::to_string(*integer_value);
    }
    if (const auto* float_value = std::get_if<double>(&token.value)) {
        std::ostringstream out;
        out << std::setprecision(17) << *float_value;
        return out.str();
    }
    throw ParseError(std::string("expected number token payload for ") + context, token.location);
}

}  // namespace

Expr ParserState::parse_expr() {
    return parse_postfix_expr();
}

Expr ParserState::parse_postfix_expr() {
    Expr expr = parse_primary_expr();
    while (true) {
        skip_newlines();
        if (peek_raw() == "LPAREN") {
            expect("LPAREN");
            std::vector<Expr> args;
            if (peek_raw() != "RPAREN") {
                args = parse_arg_list();
            }
            expect("RPAREN");
            expr = std::make_shared<Call>(Call{expr, std::move(args)});
            continue;
        }
        if (peek_raw() == "DOT") {
            advance();
            if (peek_raw() == "IDENT") {
                Token attr = advance();
                expr = std::make_shared<Attribute>(
                    Attribute{expr, token_string_value(attr, "attribute name")});
                continue;
            }
            if (peek_raw() == "NUMBER") {
                Token index = advance();
                expr = std::make_shared<DottedIndex>(
                    DottedIndex{expr, token_int_value(index, "dotted index")});
                continue;
            }
            expr = std::make_shared<LooseDot>(LooseDot{expr});
            break;
        }
        break;
    }
    return expr;
}

Expr ParserState::parse_primary_expr() {
    skip_newlines();
    if (peek_raw() == "NUMBER") {
        Token token = advance();
        return NumberLit{token_number_text(token, "number literal")};
    }
    if (peek_raw() == "IDENT") {
        Token token = advance();
        return Ident{token_string_value(token, "identifier")};
    }
    if (peek_raw() == "LBRACKET") {
        expect("LBRACKET");
        std::vector<Expr> elements;
        if (peek_raw() != "RBRACKET") {
            elements = parse_vector_elements();
        }
        expect("RBRACKET");
        return std::make_shared<VectorLit>(VectorLit{std::move(elements)});
    }
    throw ParseError("unsupported expression in native parser subset", loc_here());
}

std::vector<Expr> ParserState::parse_arg_list() {
    std::vector<Expr> args;
    while (true) {
        args.push_back(parse_expr());
        skip_newlines();
        if (peek_raw() != "COMMA") {
            break;
        }
        advance();
    }
    return args;
}

std::vector<Expr> ParserState::parse_vector_elements() {
    std::vector<Expr> elements;
    while (true) {
        elements.push_back(parse_expr());
        skip_newlines();
        if (peek_raw() != "COMMA") {
            break;
        }
        advance();
    }
    return elements;
}

TypeExpr ParserState::parse_type_expr() {
    expect("LBRACKET");
    Token element_type = expect("IDENT");
    expect("COLON");
    Token size = expect("NUMBER");
    expect("RBRACKET");
    return std::make_shared<FixedVectorType>(FixedVectorType{
        PrimitiveTypeRef{token_string_value(element_type, "vector element type")},
        token_int_value(size, "vector size"),
    });
}

}  // namespace vf
