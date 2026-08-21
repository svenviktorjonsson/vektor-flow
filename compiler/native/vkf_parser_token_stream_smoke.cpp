#include "native/VfOverlay/vf/json.hpp"
#include "compiler/native/vkf_native_frontend.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr std::string_view token_stream_schema = "vektorflow.token_stream";
constexpr int token_stream_version = 1;

struct Location {
    std::string file;
    int line = 1;
    int column = 1;
};

struct Token {
    std::string kind;
    vf::JsonValue value;
    std::string raw;
    Location location;
    vf::JsonValue interpolations;
};

class ParseFailure : public std::runtime_error {
public:
    ParseFailure(std::string message, Location location)
        : std::runtime_error(std::move(message)), location_(std::move(location)) {}

    const Location& location() const {
        return location_;
    }

private:
    Location location_;
};

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const Location& location) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw ParseFailure("missing field " + name, location);
    }
    return found->second;
}

std::string require_string(const vf::JsonValue& value, const std::string& name, const Location& location) {
    if (!value.is_string()) {
        throw ParseFailure("expected string for " + name, location);
    }
    return value.as_string();
}

int require_int(const vf::JsonValue& value, const std::string& name, const Location& location) {
    if (!value.is_number()) {
        throw ParseFailure("expected integer for " + name, location);
    }
    const double number = value.as_number();
    if (!std::isfinite(number) || std::floor(number) != number) {
        throw ParseFailure("expected integer for " + name, location);
    }
    return static_cast<int>(number);
}

Location read_location(const vf::JsonValue& value) {
    const Location fallback{"<token-stream>", 1, 1};
    if (!value.is_object()) {
        throw ParseFailure("expected object for location", fallback);
    }
    const auto& object = value.as_object();
    Location location;
    location.file = require_string(field(object, "file", fallback), "location.file", fallback);
    location.line = require_int(field(object, "line", fallback), "location.line", fallback);
    location.column = require_int(field(object, "column", fallback), "location.column", fallback);
    return location;
}

Token read_token(const vf::JsonValue& value) {
    const Location fallback{"<token-stream>", 1, 1};
    if (!value.is_object()) {
        throw ParseFailure("expected object for token", fallback);
    }
    const auto& object = value.as_object();
    const Location location = read_location(field(object, "location", fallback));
    Token token;
    token.kind = require_string(field(object, "kind", location), "token.kind", location);
    const auto value_field = object.find("value");
    token.value = value_field == object.end() ? vf::JsonValue(nullptr) : value_field->second;
    const auto raw_field = object.find("raw");
    if (raw_field != object.end() && raw_field->second.is_string()) {
        token.raw = raw_field->second.as_string();
    }
    token.location = location;
    const auto interpolations_field = object.find("interpolations");
    if (interpolations_field != object.end()) token.interpolations = interpolations_field->second;
    return token;
}

std::vector<Token> read_envelope(const vf::JsonValue& root) {
    const Location fallback{"<token-stream>", 1, 1};
    if (!root.is_object()) {
        throw ParseFailure("expected token-stream object", fallback);
    }
    const auto& object = root.as_object();
    const std::string schema = require_string(field(object, "schema", fallback), "schema", fallback);
    if (schema != token_stream_schema) {
        throw ParseFailure("unsupported schema", fallback);
    }
    const int version = require_int(field(object, "version", fallback), "version", fallback);
    if (version != token_stream_version) {
        throw ParseFailure("unsupported version", fallback);
    }
    const vf::JsonValue& token_values = field(object, "tokens", fallback);
    if (!token_values.is_array()) {
        throw ParseFailure("expected array for tokens", fallback);
    }

    std::vector<Token> tokens;
    for (const auto& token_value : token_values.as_array()) {
        tokens.push_back(read_token(token_value));
    }
    if (tokens.empty()) {
        throw ParseFailure("missing EOF", fallback);
    }

    int eof_count = 0;
    for (const auto& token : tokens) {
        if (token.kind == "EOF") {
            eof_count += 1;
        }
    }
    if (eof_count != 1 || tokens.back().kind != "EOF") {
        throw ParseFailure("missing EOF at end of token stream", tokens.back().location);
    }
    return tokens;
}

std::vector<Token> read_envelope(const std::string& text) {
    return read_envelope(vf::parse_json(text));
}

vf::JsonValue::Object node(std::string kind) {
    vf::JsonValue::Object out;
    out["kind"] = vf::JsonValue(std::move(kind));
    return out;
}

vf::JsonValue number_value(double number) {
    if (std::floor(number) == number) {
        return vf::JsonValue(static_cast<double>(static_cast<long long>(number)));
    }
    return vf::JsonValue(number);
}

vf::JsonValue binary_node(std::string op, vf::JsonValue left, vf::JsonValue right) {
    auto out = node("binary_op");
    out["op"] = vf::JsonValue(std::move(op));
    out["left"] = std::move(left);
    out["right"] = std::move(right);
    return vf::JsonValue(std::move(out));
}

class Parser {
public:
    explicit Parser(std::vector<Token> tokens)
        : tokens_(std::move(tokens)) {}

    vf::JsonValue parse_module() {
        vf::JsonValue::Array body;
        skip_newlines();
        while (!is_at("EOF")) {
            body.push_back(parse_statement());
            if (is_at("SEMICOLON")) {
                while (is_at("SEMICOLON")) {
                    advance();
                }
                skip_newlines();
                continue;
            }
            if (is_at("NEWLINE")) {
                skip_newlines();
                continue;
            }
            if (starts_test_function_definition() || starts_function_definition() ||
                is_at("IDENT") || is_at("EMIT") ||
                is_at("DOT") || is_at("COLON") || is_at("AT_COLON") ||
                is_at("LBRACKET") || is_at("LPAREN")) {
                continue;
            }
            if (!is_at("EOF")) {
                fail_here("expected newline or EOF after statement");
            }
        }

        auto out = node("module");
        out["body"] = vf::JsonValue(std::move(body));
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_interpolation_expression() {
        skip_newlines();
        auto expression = parse_expression();
        skip_newlines();
        expect("EOF");
        return expression;
    }

private:
    static bool is_function_name_kind(const std::string& kind) {
        return kind == "IDENT"
            || kind == "PLUS"
            || kind == "MINUS"
            || kind == "STAR"
            || kind == "SLASH"
            || kind == "FLOORDIV"
            || kind == "PERCENT"
            || kind == "CARET"
            || kind == "AND"
            || kind == "OR"
            || kind == "XOR"
            || kind == "NOT"
            || kind == "EMIT"
            || kind == "DOT";
    }

    static std::string function_name_text(const Token& token) {
        if (token.kind == "IDENT") {
            return token.value.as_string();
        }
        if (token.kind == "PLUS") return "+";
        if (token.kind == "MINUS") return "-";
        if (token.kind == "STAR") return "*";
        if (token.kind == "SLASH") return "/";
        if (token.kind == "FLOORDIV") return "//";
        if (token.kind == "PERCENT") return "%";
        if (token.kind == "CARET") return "^";
        if (token.kind == "AND") return "/\\";
        if (token.kind == "OR") return "\\/";
        if (token.kind == "XOR") return "><";
        if (token.kind == "NOT") return "~";
        if (token.kind == "EMIT") return "::";
        if (token.kind == "DOT") return ".";
        throw ParseFailure("unsupported function name token", token.location);
    }

    static bool is_expression_node(const vf::JsonValue& value) {
        if (!value.is_object()) {
            return false;
        }
        const auto& object = value.as_object();
        const auto kind = object.find("kind");
        if (kind == object.end() || !kind->second.is_string()) {
            return false;
        }
        const std::string& name = kind->second.as_string();
        return name == "call"
            || name == "binary_op"
            || name == "identifier"
            || name == "number_literal"
            || name == "string_literal"
            || name == "bool_literal"
            || name == "null_literal"
            || name == "list_literal"
            || name == "multiset_literal"
            || name == "range_expr"
            || name == "pipe_chain"
            || name == "conditional_expr"
            || name == "assert_expr"
            || name == "record_literal"
            || name == "type_of"
            || name == "abs_expr";
    }

    static bool is_upper_ident_token(const Token& token) {
        if (token.kind != "IDENT" || !token.value.is_string()) {
            return false;
        }
        const std::string& text = token.value.as_string();
        return !text.empty() && std::isupper(static_cast<unsigned char>(text.front()));
    }

    static bool is_declared_bind_type_token(const Token& token) {
        if (is_upper_ident_token(token)) {
            return true;
        }
        if (token.kind != "IDENT" || !token.value.is_string()) {
            return false;
        }
        const std::string& text = token.value.as_string();
        return text == "bit" || text == "int" || text == "num" || text == "chr" || text == "str";
    }

    static bool is_node_kind(const vf::JsonValue& value, std::string_view expected) {
        if (!value.is_object()) return false;
        const auto kind = value.as_object().find("kind");
        return kind != value.as_object().end() && kind->second.is_string() &&
            kind->second.as_string() == expected;
    }

    bool starts_statement() const {
        return is_at("IDENT") || is_at("EMIT") || is_at("DOT") || is_at("COLON") ||
            is_at("AT_COLON") || is_at("LBRACKET") || is_at("LBRACE") ||
            is_at("LPAREN") || is_at("NUMBER") || is_at("STRING") ||
            is_at("STRING_RAW") || is_at("TRUE") || is_at("FALSE") ||
            is_at("NULL") || is_at("BAR") || is_at("DOLLAR") ||
            is_at("MINUS") || is_at("NOT") || is_at("RANGE");
    }

    const Token& peek() const {
        if (index_ >= tokens_.size()) {
            return tokens_.back();
        }
        return tokens_[index_];
    }

    bool is_at(std::string_view kind) const {
        return peek().kind == kind;
    }

    const Token& advance() {
        const Token& token = peek();
        if (index_ < tokens_.size()) {
            index_ += 1;
        }
        return token;
    }

    void skip_newlines() {
        while (is_at("NEWLINE")) {
            advance();
        }
    }

    void fail_here(const std::string& message) const {
        throw ParseFailure(message, peek().location);
    }

    const Token& expect(std::string_view kind) {
        if (!is_at(kind)) {
            fail_here("expected token " + std::string(kind));
        }
        return advance();
    }

    vf::JsonValue parse_declared_bind_type() {
        std::string name;
        int bracket_depth = 0;
        bool consumed = false;
        while (!is_at("EOF")) {
            const Token token = advance();
            name += type_token_text(token);
            consumed = true;
            if (token.kind == "LBRACKET") {
                bracket_depth += 1;
            } else if (token.kind == "RBRACKET") {
                bracket_depth -= 1;
                if (bracket_depth == 0) {
                    break;
                }
            }
        }
        if (!consumed || bracket_depth != 0) {
            fail_here("expected declared bind type annotation");
        }
        auto out = node("type_annotation");
        out["name"] = vf::JsonValue(name);
        return vf::JsonValue(std::move(out));
    }

    bool starts_simple_ident_declared_bind() const {
        return index_ + 2 < tokens_.size()
            && is_declared_bind_type_token(tokens_[index_])
            && tokens_[index_ + 1].kind == "IDENT"
            && tokens_[index_ + 2].kind == "COLON";
    }

    bool starts_bracket_declared_bind() const {
        if (!is_at("LBRACKET")) return false;
        int depth = 0;
        for (std::size_t cursor = index_; cursor < tokens_.size(); ++cursor) {
            if (tokens_[cursor].kind == "LBRACKET") depth += 1;
            else if (tokens_[cursor].kind == "RBRACKET") {
                depth -= 1;
                if (depth == 0) {
                    return cursor + 2 < tokens_.size()
                        && tokens_[cursor + 1].kind == "IDENT"
                        && tokens_[cursor + 2].kind == "COLON";
                }
            }
        }
        return false;
    }

    bool starts_type_alias_stmt() const {
        if (!is_upper_ident_token(peek()) || index_ + 2 >= tokens_.size() || tokens_[index_ + 1].kind != "COLON") {
            return false;
        }
        const std::string& rhs_kind = tokens_[index_ + 2].kind;
        return rhs_kind == "LPAREN" || rhs_kind == "LBRACKET" || rhs_kind == "LBRACE";
    }

    vf::JsonValue parse_statement() {
        if (starts_bracket_declared_bind()) {
            vf::JsonValue declared_type = parse_declared_bind_type();
            const Token& name = expect("IDENT");
            expect("COLON");
            vf::JsonValue value;
            if (is_at("NEWLINE")) {
                value = parse_indented_suite(true, true);
            } else {
                value = parse_expression();
            }
            auto out = node("bind");
            out["target"] = ident_node(name);
            out["value"] = std::move(value);
            out["type"] = std::move(declared_type);
            return vf::JsonValue(std::move(out));
        }
        if (starts_simple_ident_declared_bind()) {
            auto declared_type = node("type_annotation");
            declared_type["name"] = vf::JsonValue(expect("IDENT").value.as_string());
            const Token& name = expect("IDENT");
            expect("COLON");
            vf::JsonValue value;
            if (is_at("NEWLINE")) {
                value = parse_indented_suite(true, true);
            } else {
                value = parse_expression();
            }
            auto out = node("bind");
            out["target"] = ident_node(name);
            out["value"] = std::move(value);
            out["type"] = vf::JsonValue(std::move(declared_type));
            return vf::JsonValue(std::move(out));
        }
        if (starts_type_alias_stmt()) {
            const Token& name = expect("IDENT");
            expect("COLON");
            auto out = node("type_alias");
            out["name"] = vf::JsonValue(name.value.as_string());
            out["type"] = parse_type_annotation();
            return vf::JsonValue(std::move(out));
        }
        if (starts_test_function_definition()) {
            return parse_function_definition(true);
        }
        if (starts_function_definition()) {
            return parse_function_definition();
        }
        if (is_at("EMIT")) {
            advance();
            if (is_at("COLON")) {
                advance();
                auto out = node("label_emit");
                out["value"] = parse_expression();
                return vf::JsonValue(std::move(out));
            }
            auto out = node("emit");
            out["value"] = parse_expression();
            return vf::JsonValue(std::move(out));
        }
        if (is_at("COLON")) {
            advance();
            if (is_at("DOT")) {
                auto out = node("spill_import");
                out["path"] = parse_dot_module_path();
                out["alias"] = vf::JsonValue(nullptr);
                return vf::JsonValue(std::move(out));
            }
            if (is_at("NEWLINE") || is_at("EOF") || is_at("SEMICOLON") || is_at("DEDENT")) {
                return vf::JsonValue(node("struct_identity"));
            }
            auto out = node("spill_value");
            out["value"] = parse_expression();
            return vf::JsonValue(std::move(out));
        }
        if (is_at("AT_COLON")) {
            advance();
            auto out = node("return");
            out["value"] = parse_expression();
            return vf::JsonValue(std::move(out));
        }
        if (is_at("AT")) {
            advance();
            auto out = node("return");
            out["value"] = vf::JsonValue(node("null_literal"));
            return vf::JsonValue(std::move(out));
        }
        if (is_at("AT_GT")) {
            advance();
            return vf::JsonValue(node("continue"));
        }
        if (is_at("AT_BAR")) {
            advance();
            return vf::JsonValue(node("break"));
        }
        if (is_at("AT_BANG")) {
            advance();
            return vf::JsonValue(node("exit_program"));
        }
        if (is_at("IDENT")) {
            const std::size_t start_index = index_;
            const Token& name = advance();
            if ((is_at("PLUS") || is_at("MINUS") || is_at("STAR") || is_at("SLASH") ||
                 is_at("FLOORDIV") || is_at("PERCENT") || is_at("AND") ||
                 is_at("OR") || is_at("XOR")) &&
                index_ + 1 < tokens_.size() && tokens_[index_ + 1].kind == "COLON") {
                const Token& operation = advance();
                expect("COLON");
                vf::JsonValue right = is_at("NEWLINE")
                    ? parse_indented_suite(true, true)
                    : parse_expression();
                auto binary = node("binary_op");
                binary["op"] = vf::JsonValue(operation.kind);
                binary["left"] = ident_node(name);
                binary["right"] = std::move(right);
                auto out = node("bind");
                out["target"] = ident_node(name);
                out["value"] = vf::JsonValue(std::move(binary));
                out["update"] = vf::JsonValue(true);
                return vf::JsonValue(std::move(out));
            }
            if (is_at("COLON")) {
                advance();
                if (is_at("DOT")) {
                    auto out = node("spill_import");
                    out["path"] = parse_dot_module_path();
                    out["alias"] = vf::JsonValue(name.value.as_string());
                    return vf::JsonValue(std::move(out));
                }
                vf::JsonValue value;
                if (is_at("NEWLINE")) {
                    value = parse_indented_suite(true, true);
                } else {
                    value = parse_expression();
                }
                auto out = node("bind");
                out["target"] = ident_node(name);
                out["value"] = std::move(value);
                return vf::JsonValue(std::move(out));
            }
            index_ = start_index;
            vf::JsonValue bind_target;
            if (try_parse_bind_target(bind_target)) {
                if ((is_at("PLUS") || is_at("MINUS") || is_at("STAR") || is_at("SLASH") ||
                     is_at("FLOORDIV") || is_at("PERCENT") || is_at("AND") ||
                     is_at("OR") || is_at("XOR")) &&
                    index_ + 1 < tokens_.size() && tokens_[index_ + 1].kind == "COLON") {
                    const Token& operation = advance();
                    expect("COLON");
                    vf::JsonValue right = is_at("NEWLINE")
                        ? parse_indented_suite(true, true)
                        : parse_expression();
                    auto binary = node("binary_op");
                    binary["op"] = vf::JsonValue(operation.kind);
                    binary["left"] = bind_target;
                    binary["right"] = std::move(right);
                    auto out = node("bind");
                    out["target"] = std::move(bind_target);
                    out["value"] = vf::JsonValue(std::move(binary));
                    out["update"] = vf::JsonValue(true);
                    return vf::JsonValue(std::move(out));
                }
                expect("COLON");
                vf::JsonValue value;
                if (is_at("NEWLINE")) {
                    value = parse_indented_suite(true, true);
                } else {
                    value = parse_expression();
                }
                auto out = node("bind");
                out["target"] = std::move(bind_target);
                out["value"] = std::move(value);
                return vf::JsonValue(std::move(out));
            }
        }
        return parse_expression();
    }

    bool try_parse_bind_target(vf::JsonValue& out_target) {
        if (!is_at("IDENT")) {
            return false;
        }
        const std::size_t original_index = index_;
        const Token& first = advance();
        vf::JsonValue target = ident_node(first);
        bool saw_postfix = false;
        while (is_at("DOT")) {
            advance();
            saw_postfix = true;
            if (is_at("IDENT")) {
                const Token& name = expect("IDENT");
                auto out = node("attribute");
                out["object"] = std::move(target);
                out["name"] = vf::JsonValue(name.value.as_string());
                target = vf::JsonValue(std::move(out));
                continue;
            }
            if (is_at("NUMBER") || is_at("STRING") || is_at("STRING_RAW")) {
                vf::JsonValue::Array indices;
                indices.push_back(parse_atom());
                auto out = node("dotted_index");
                out["base"] = std::move(target);
                out["indices"] = vf::JsonValue(std::move(indices));
                target = vf::JsonValue(std::move(out));
                continue;
            }
            if (is_at("LPAREN")) {
                expect("LPAREN");
                vf::JsonValue::Array indices;
                if (!is_at("RPAREN")) {
                    while (true) {
                        indices.push_back(parse_expression());
                        if (is_at("COMMA")) {
                            advance();
                            continue;
                        }
                        break;
                    }
                }
                expect("RPAREN");
                auto out = node("dotted_index");
                out["base"] = std::move(target);
                out["indices"] = vf::JsonValue(std::move(indices));
                target = vf::JsonValue(std::move(out));
                continue;
            }
            index_ = original_index;
            return false;
        }
        const bool update = (is_at("PLUS") || is_at("MINUS") || is_at("STAR") ||
            is_at("SLASH") || is_at("FLOORDIV") || is_at("PERCENT") ||
            is_at("AND") || is_at("OR") || is_at("XOR")) &&
            index_ + 1 < tokens_.size() && tokens_[index_ + 1].kind == "COLON";
        if (!saw_postfix || (!is_at("COLON") && !update)) {
            index_ = original_index;
            return false;
        }
        out_target = std::move(target);
        return true;
    }

    vf::JsonValue parse_dot_module_path() {
        expect("DOT");
        vf::JsonValue::Array segments;
        if (is_at("STRING") || is_at("STRING_RAW")) {
            const Token& token = advance();
            segments.push_back(vf::JsonValue(token.value.as_string()));
        } else if (is_at("IDENT")) {
            segments.push_back(vf::JsonValue(expect("IDENT").value.as_string()));
            while (is_at("DOT")) {
                advance();
                segments.push_back(vf::JsonValue(expect("IDENT").value.as_string()));
            }
        } else {
            fail_here("expected string or identifier after dot-module prefix");
        }
        auto out = node("dot_module_path");
        out["segments"] = vf::JsonValue(std::move(segments));
        return vf::JsonValue(std::move(out));
    }

    bool starts_function_definition() const {
        if (!is_function_name_kind(peek().kind) || index_ + 1 >= tokens_.size() || tokens_[index_ + 1].kind != "LPAREN") {
            return false;
        }
        std::size_t depth = 0;
        for (std::size_t cursor = index_ + 1; cursor < tokens_.size(); ++cursor) {
            if (tokens_[cursor].kind == "LPAREN") {
                depth += 1;
                continue;
            }
            if (tokens_[cursor].kind == "RPAREN") {
                depth -= 1;
                if (depth == 0) {
                    const std::size_t after = cursor + 1;
                    return after < tokens_.size()
                        && (tokens_[after].kind == "COLON" || tokens_[after].kind == "ARROW");
                }
            }
        }
        return false;
    }

    bool starts_test_function_definition() const {
        return index_ + 2 < tokens_.size()
            && tokens_[index_].kind == "IDENT"
            && tokens_[index_].value.is_string()
            && tokens_[index_].value.as_string() == "test"
            && is_function_name_kind(tokens_[index_ + 1].kind)
            && tokens_[index_ + 2].kind == "LPAREN";
    }

    vf::JsonValue parse_function_definition(bool is_test = false) {
        if (is_test) advance();
        const Token& name = advance();
        expect("LPAREN");
        skip_newlines();
        vf::JsonValue::Array params;
        if (!is_at("RPAREN")) {
            while (true) {
                params.push_back(parse_param());
                if (is_at("COMMA")) {
                    advance();
                    skip_newlines();
                    continue;
                }
                break;
            }
        }
        skip_newlines();
        expect("RPAREN");

        vf::JsonValue return_type(nullptr);
        if (is_at("ARROW")) {
            advance();
            return_type = parse_type_annotation(true);
        }
        expect("COLON");
        vf::JsonValue body = parse_function_body();

        auto out = node("function_definition");
        out["body"] = std::move(body);
        out["name"] = vf::JsonValue(function_name_text(name));
        out["params"] = vf::JsonValue(std::move(params));
        out["return_type"] = std::move(return_type);
        if (is_test) out["test"] = vf::JsonValue(true);
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_param() {
        bool variadic_positional = false;
        bool variadic_named = false;
        if (is_at("ELLIPSIS")) {
            advance();
            variadic_positional = true;
        } else if (is_at("EMIT")) {
            advance();
            expect("COLON");
            variadic_named = true;
        }
        const Token& name = expect("IDENT");
        vf::JsonValue type(nullptr);
        vf::JsonValue default_value(nullptr);
        if (is_at("COLON")) {
            advance();
            type = parse_type_annotation();
        }
        if (is_at("EQ")) {
            advance();
            default_value = parse_expression();
        }
        auto out = node("param");
        out["name"] = vf::JsonValue(name.value.as_string());
        out["type"] = std::move(type);
        out["default"] = std::move(default_value);
        out["variadic_positional"] = vf::JsonValue(variadic_positional);
        out["variadic_named"] = vf::JsonValue(variadic_named);
        return vf::JsonValue(std::move(out));
    }

    bool colon_continues_type_annotation() const {
        if (!is_at("COLON")) {
            return false;
        }
        std::size_t cursor = index_ + 1;
        while (cursor < tokens_.size() && tokens_[cursor].kind == "NEWLINE") {
            cursor += 1;
        }
        if (cursor >= tokens_.size()) {
            return false;
        }
        const std::string& kind = tokens_[cursor].kind;
        return kind != "NEWLINE" && kind != "INDENT" && kind != "DEDENT" && kind != "EOF";
    }

    bool later_top_level_colon_on_line() const {
        int depth = 0;
        for (std::size_t cursor = index_ + 1; cursor < tokens_.size(); ++cursor) {
            const std::string& kind = tokens_[cursor].kind;
            if (kind == "NEWLINE" || kind == "INDENT" || kind == "DEDENT" || kind == "EOF") {
                return false;
            }
            if (kind == "LT" || kind == "LBRACKET" || kind == "LBRACE" || kind == "LPAREN") {
                ++depth;
            } else if (kind == "GT" || kind == "RBRACKET" || kind == "RBRACE" || kind == "RPAREN") {
                if (depth > 0) --depth;
            } else if (kind == "COLON" && depth == 0) {
                return true;
            }
        }
        return false;
    }

    static std::string type_token_text(const Token& token) {
        if (token.kind == "IDENT") {
            return token.value.as_string();
        }
        if (token.kind == "LT") return "<";
        if (token.kind == "GT") return ">";
        if (token.kind == "COMMA") return ",";
        if (token.kind == "COLON") return ":";
        if (token.kind == "LBRACKET") return "[";
        if (token.kind == "RBRACKET") return "]";
        if (token.kind == "LBRACE") return "{";
        if (token.kind == "RBRACE") return "}";
        if (token.kind == "LPAREN") return "(";
        if (token.kind == "RPAREN") return ")";
        if (token.kind == "BAR") return "|";
        if (token.kind == "AMPERSAND") return "&";
        if (token.kind == "PLUS") return "+";
        if (token.kind == "ARROW") return "->";
        if (token.kind == "NUMBER") {
            if (token.value.is_number()) {
                std::ostringstream out;
                out << token.value.as_number();
                return out.str();
            }
            return "0";
        }
        throw ParseFailure("unsupported token in type annotation", token.location);
    }

    vf::JsonValue parse_type_annotation(bool stop_at_colon = false) {
        std::string name;
        int angle_depth = 0;
        int bracket_depth = 0;
        int brace_depth = 0;
        int paren_depth = 0;
        bool consumed = false;
        while (!is_at("EOF")) {
            if (angle_depth == 0 && bracket_depth == 0 && brace_depth == 0 && paren_depth == 0) {
                if (is_at("EQ") || is_at("COMMA") || is_at("RPAREN") || is_at("NEWLINE") || is_at("INDENT") || is_at("DEDENT")) {
                    break;
                }
                if (is_at("COLON")) {
                    const bool terminates_return = stop_at_colon && !later_top_level_colon_on_line();
                    if (terminates_return || (!stop_at_colon && !colon_continues_type_annotation())) {
                        break;
                    }
                }
            }
            const Token token = advance();
            name += type_token_text(token);
            consumed = true;
            if (token.kind == "LT") angle_depth += 1;
            else if (token.kind == "GT") angle_depth -= 1;
            else if (token.kind == "LBRACKET") bracket_depth += 1;
            else if (token.kind == "RBRACKET") bracket_depth -= 1;
            else if (token.kind == "LBRACE") brace_depth += 1;
            else if (token.kind == "RBRACE") brace_depth -= 1;
            else if (token.kind == "LPAREN") paren_depth += 1;
            else if (token.kind == "RPAREN") paren_depth -= 1;
        }
        if (!consumed) {
            fail_here("expected type annotation");
        }
        auto out = node("type_annotation");
        out["name"] = vf::JsonValue(name);
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_function_body() {
        if (!is_at("NEWLINE")) {
            return parse_statement();
        }
        return parse_indented_suite(true, false);
    }

    vf::JsonValue parse_expression() {
        vf::JsonValue expr = parse_pipe_expr();
        while (is_at("QUESTION") || is_at("BANG_QUESTION")) {
            if (is_at("BANG_QUESTION")) {
                advance();
                expr = parse_match_stmt(std::move(expr), true);
                continue;
            }
            advance();
            if (is_at("QUESTION")) {
                advance();
                bool loop = false;
                if (is_at("GT")) {
                    advance();
                    loop = true;
                }
                expr = parse_match_stmt(std::move(expr), false, loop);
                continue;
            }
            if (is_at("BANG")) {
                advance();
                auto out = node("assert_expr");
                out["condition"] = std::move(expr);
                if (is_at("NEWLINE") || is_at("EOF") || is_at("SEMICOLON") ||
                    is_at("RPAREN") || is_at("DEDENT")) {
                    out["message"] = vf::JsonValue(nullptr);
                } else {
                    out["message"] = parse_expression();
                }
                expr = vf::JsonValue(std::move(out));
                continue;
            }
            bool loop = false;
            if (is_at("GT")) {
                advance();
                loop = true;
            }
            auto out = node("conditional_expr");
            out["condition"] = std::move(expr);
            out["body"] = parse_conditional_body();
            out["loop"] = vf::JsonValue(loop);
            expr = vf::JsonValue(std::move(out));
        }
        return expr;
    }

    vf::JsonValue parse_conditional_body() {
        if (is_at("NEWLINE")) {
            return parse_indented_suite(true, false);
        }
        return parse_statement();
    }

    vf::JsonValue parse_pipe_expr() {
        vf::JsonValue source = parse_range_expr();
        vf::JsonValue::Array segments;
        while (is_at("PIPE")) {
            advance();
            if (is_at("NEWLINE")) {
                segments.push_back(parse_indented_suite(false, false));
            } else if (is_at("EMIT")) {
                vf::JsonValue first = parse_statement();
                if (!is_at("SEMICOLON")) {
                    segments.push_back(std::move(first));
                } else {
                    vf::JsonValue::Array statements;
                    statements.push_back(std::move(first));
                    while (is_at("SEMICOLON")) {
                        advance();
                        if (is_at("NEWLINE") || is_at("DEDENT") || is_at("EOF") || is_at("PIPE")) break;
                        statements.push_back(parse_statement());
                    }
                    auto onward = node("identifier");
                    onward["name"] = vf::JsonValue("$");
                    statements.emplace_back(std::move(onward));
                    auto block = node("block");
                    block["statements"] = vf::JsonValue(std::move(statements));
                    segments.emplace_back(std::move(block));
                }
            } else {
                segments.push_back(parse_range_expr());
            }
        }
        if (segments.empty()) {
            return source;
        }
        auto out = node("pipe_chain");
        out["source"] = std::move(source);
        out["segments"] = vf::JsonValue(std::move(segments));
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_range_expr() {
        if (is_at("RANGE")) {
            advance();
            auto out = node("range_expr");
            out["start"] = vf::JsonValue(nullptr);
            if (is_at("COMMA") || is_at("RBRACKET") || is_at("RPAREN") || is_at("NEWLINE")
                || is_at("DEDENT") || is_at("EOF") || is_at("PIPE")) {
                out["end"] = vf::JsonValue(nullptr);
            } else {
                out["end"] = parse_or_expr();
            }
            return vf::JsonValue(std::move(out));
        }
        vf::JsonValue start = parse_or_expr();
        if (!is_at("RANGE")) {
            return start;
        }
        advance();
        auto out = node("range_expr");
        out["start"] = std::move(start);
        if (is_at("COMMA") || is_at("RBRACKET") || is_at("RPAREN") || is_at("NEWLINE")
            || is_at("DEDENT") || is_at("EOF") || is_at("PIPE")) {
            out["end"] = vf::JsonValue(nullptr);
        } else {
            out["end"] = parse_or_expr();
        }
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_indented_suite(bool unwrap_single_expression, bool allow_trailing_colon) {
        skip_newlines();
        expect("INDENT");
        vf::JsonValue::Array statements;
        bool trailing_identity = false;
        skip_newlines();
        while (!is_at("DEDENT") && !is_at("EOF")) {
            if (allow_trailing_colon && is_at("COLON")) {
                advance();
                trailing_identity = true;
                skip_newlines();
                break;
            }
            statements.push_back(parse_statement());
            if (is_at("SEMICOLON")) {
                while (is_at("SEMICOLON")) {
                    advance();
                }
                skip_newlines();
                continue;
            }
            if (is_at("NEWLINE")) {
                skip_newlines();
                continue;
            }
            if (allow_trailing_colon && is_at("COLON")) {
                advance();
                trailing_identity = true;
                skip_newlines();
                break;
            }
            if (starts_statement()) {
                continue;
            }
            if (!is_at("DEDENT")) {
                fail_here("expected newline or dedent after block statement");
            }
        }
        expect("DEDENT");

        if (trailing_identity) {
            statements.push_back(vf::JsonValue(node("struct_identity")));
        }

        if (unwrap_single_expression && statements.size() == 1 && is_expression_node(statements.front())) {
            return statements.front();
        }

        auto out = node("block");
        out["statements"] = vf::JsonValue(std::move(statements));
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_or_expr() {
        vf::JsonValue left = parse_and_expr();
        while (is_at("OR") || is_at("XOR")) {
            const Token& op = advance();
            skip_newlines();
            left = binary_node(op.kind, std::move(left), parse_and_expr());
        }
        return left;
    }

    bool line_has_fat_arrow() const {
        std::size_t cursor = index_;
        int depth = 0;
        while (cursor < tokens_.size()) {
            const std::string& kind = tokens_[cursor].kind;
            if (kind == "NEWLINE" || kind == "DEDENT" || kind == "EOF") {
                return false;
            }
            if (kind == "LPAREN" || kind == "LBRACKET" || kind == "LBRACE") {
                depth += 1;
            } else if (kind == "RPAREN" || kind == "RBRACKET" || kind == "RBRACE") {
                if (depth > 0) {
                    depth -= 1;
                }
            } else if (depth == 0 && kind == "FAT_ARROW") {
                return true;
            }
            cursor += 1;
        }
        return false;
    }

    bool implicit_mul_follows() const {
        if (is_at("NEWLINE")) {
            return false;
        }
        return is_at("NUMBER")
            || is_at("IDENT")
            || is_at("LPAREN")
            || is_at("LBRACKET")
            || is_at("LBRACE")
            || is_at("DOLLAR")
            || is_at("DOT")
            || is_at("STRING")
            || is_at("STRING_RAW");
    }

    static bool builtin_type_name(const std::string& name) {
        static const std::vector<std::string> builtin_types = {
            "any", "bit", "chr", "int", "num", "f32", "f64", "str",
            "list", "map", "multiset", "tuple", "struct", "vector"
        };
        return std::find(builtin_types.begin(), builtin_types.end(), name) != builtin_types.end();
    }

    bool match_arm_has_type_pattern() const {
        if (index_ < tokens_.size() && tokens_[index_].kind == "LPAREN") {
            std::size_t cursor = index_ + 1;
            bool saw_field = false;
            while (cursor + 2 < tokens_.size()) {
                if (tokens_[cursor].kind != "IDENT" || tokens_[cursor + 1].kind != "COLON" ||
                    tokens_[cursor + 2].kind != "IDENT" ||
                    !builtin_type_name(tokens_[cursor + 2].value.as_string())) {
                    break;
                }
                saw_field = true;
                cursor += 3;
                if (tokens_[cursor].kind == "COMMA") {
                    ++cursor;
                    continue;
                }
                if (tokens_[cursor].kind == "RPAREN" && cursor + 1 < tokens_.size() &&
                    tokens_[cursor + 1].kind == "FAT_ARROW") {
                    return saw_field;
                }
                break;
            }
            cursor = index_ + 1;
            bool saw_element = false;
            bool saw_comma = false;
            while (cursor < tokens_.size()) {
                if (tokens_[cursor].kind != "IDENT" ||
                    !builtin_type_name(tokens_[cursor].value.as_string())) {
                    break;
                }
                saw_element = true;
                ++cursor;
                if (tokens_[cursor].kind == "COMMA") {
                    saw_comma = true;
                    ++cursor;
                    continue;
                }
                if (tokens_[cursor].kind == "RPAREN" && cursor + 1 < tokens_.size() &&
                    tokens_[cursor + 1].kind == "FAT_ARROW") {
                    return saw_element && saw_comma;
                }
                break;
            }
        }
        if (index_ + 5 < tokens_.size() &&
            tokens_[index_].kind == "LBRACKET" &&
            tokens_[index_ + 1].kind == "IDENT" &&
            builtin_type_name(tokens_[index_ + 1].value.as_string()) &&
            tokens_[index_ + 2].kind == "COLON" &&
            tokens_[index_ + 3].kind == "NUMBER" &&
            tokens_[index_ + 4].kind == "RBRACKET" &&
            tokens_[index_ + 5].kind == "FAT_ARROW") {
            return true;
        }
        std::size_t cursor = index_;
        bool expect_type = true;
        bool saw_operator = false;
        while (cursor < tokens_.size()) {
            const Token& token = tokens_[cursor];
            if (token.kind == "FAT_ARROW") {
                return !expect_type && (saw_operator || cursor == index_ + 1);
            }
            if (expect_type) {
                if (token.kind != "IDENT" || !builtin_type_name(token.value.as_string())) return false;
                expect_type = false;
            } else {
                if (token.kind != "BAR" && token.kind != "AMPERSAND") return false;
                saw_operator = true;
                expect_type = true;
            }
            ++cursor;
        }
        return false;
    }

    vf::JsonValue parse_match_arm_type_pattern() {
        std::string name;
        while (!is_at("FAT_ARROW")) {
            name += type_token_text(advance());
        }
        auto type = node("type_annotation");
        type["name"] = vf::JsonValue(std::move(name));
        return vf::JsonValue(std::move(type));
    }

    vf::JsonValue parse_match_arm() {
        if (line_has_fat_arrow()) {
            vf::JsonValue condition;
            if (match_arm_has_type_pattern()) {
                condition = parse_match_arm_type_pattern();
            } else {
                condition = parse_expression();
            }
            expect("FAT_ARROW");
            vf::JsonValue body = is_at("NEWLINE")
                ? parse_indented_suite(true, false)
                : parse_statement();
            if (!is_expression_node(body) && !is_node_kind(body, "block")) {
                vf::JsonValue::Array statements;
                statements.push_back(std::move(body));
                auto block = node("block");
                block["statements"] = vf::JsonValue(std::move(statements));
                body = vf::JsonValue(std::move(block));
            }
            auto out = node("match_arm");
            out["condition"] = std::move(condition);
            out["body"] = std::move(body);
            return vf::JsonValue(std::move(out));
        }
        vf::JsonValue body = is_at("NEWLINE")
            ? parse_indented_suite(true, false)
            : parse_statement();
        if (!is_expression_node(body) && !is_node_kind(body, "block")) {
            vf::JsonValue::Array statements;
            statements.push_back(std::move(body));
            auto block = node("block");
            block["statements"] = vf::JsonValue(std::move(statements));
            body = vf::JsonValue(std::move(block));
        }
        auto out = node("match_arm");
        out["condition"] = vf::JsonValue(nullptr);
        out["body"] = std::move(body);
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_match_stmt(
        vf::JsonValue discriminant,
        bool catch_errors,
        bool loop = false
    ) {
        vf::JsonValue::Array arms;
        skip_newlines();
        if (is_at("LPAREN")) {
            advance();
            while (!is_at("RPAREN")) {
                arms.push_back(parse_match_arm());
                if (is_at("COMMA") || is_at("SEMICOLON")) {
                    advance();
                    continue;
                }
                break;
            }
            expect("RPAREN");
        } else if (is_at("INDENT")) {
            expect("INDENT");
            bool saw_default = false;
            skip_newlines();
            while (!is_at("DEDENT") && !is_at("EOF")) {
                const bool has_arrow = line_has_fat_arrow();
                if (has_arrow && saw_default) {
                    fail_here("default arm must be last in match");
                }
                if (!has_arrow && saw_default) {
                    fail_here("only one default arm is allowed in match");
                }
                if (!has_arrow) {
                    saw_default = true;
                }
                arms.push_back(parse_match_arm());
                if (is_at("NEWLINE")) {
                    skip_newlines();
                    continue;
                }
                if (line_has_fat_arrow()) {
                    continue;
                }
                if (!is_at("DEDENT")) {
                    fail_here("expected newline or dedent after match arm");
                }
            }
            expect("DEDENT");
        } else {
            arms.push_back(parse_match_arm());
        }
        if (arms.empty()) {
            fail_here("expected at least one switch arm after ??");
        }
        auto out = node("match_stmt");
        out["discriminant"] = std::move(discriminant);
        out["arms"] = vf::JsonValue(std::move(arms));
        out["loop"] = vf::JsonValue(loop);
        out["catch"] = vf::JsonValue(catch_errors);
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_and_expr() {
        vf::JsonValue left = parse_cmp_expr();
        while (is_at("AND")) {
            const Token& op = advance();
            skip_newlines();
            left = binary_node(op.kind, std::move(left), parse_cmp_expr());
        }
        return left;
    }

    vf::JsonValue parse_cmp_expr() {
        vf::JsonValue left = parse_add_expr();
        while (is_at("EQ") || is_at("EXACT_EQ") || is_at("NEQ") || is_at("STRUCT_NEQ")
            || is_at("LT") || is_at("LE") || is_at("GT") || is_at("GE")) {
            const Token& op = advance();
            skip_newlines();
            left = binary_node(op.kind, std::move(left), parse_add_expr());
        }
        return left;
    }

    vf::JsonValue parse_add_expr() {
        vf::JsonValue left = parse_mul_expr();
        while (is_at("PLUS") || is_at("MINUS") || is_at("AMPERSAND")) {
            const Token& op = advance();
            skip_newlines();
            left = binary_node(op.kind, std::move(left), parse_mul_expr());
        }
        return left;
    }

    vf::JsonValue parse_mul_expr() {
        vf::JsonValue left = parse_pow_expr();
        while (true) {
            if (is_at("STAR") || is_at("SLASH") || is_at("FLOORDIV") || is_at("PERCENT")) {
                const Token& op = advance();
                skip_newlines();
                left = binary_node(op.kind, std::move(left), parse_pow_expr());
                continue;
            }
            if (implicit_mul_follows()) {
                left = binary_node("STAR", std::move(left), parse_pow_expr());
                continue;
            }
            break;
        }
        return left;
    }

    vf::JsonValue parse_pow_expr() {
        vf::JsonValue left = parse_unary_expr();
        if (is_at("CARET")) {
            const Token& op = advance();
            skip_newlines();
            return binary_node(op.kind, std::move(left), parse_pow_expr());
        }
        return left;
    }

    vf::JsonValue parse_unary_expr() {
        if (is_at("MINUS") || is_at("NOT")) {
            const Token& op = advance();
            vf::JsonValue operand = parse_unary_expr();
            if (op.kind == "MINUS" && operand.is_object()) {
                const auto& object = operand.as_object();
                auto kind_it = object.find("kind");
                auto value_it = object.find("value");
                if (kind_it != object.end() && value_it != object.end() && kind_it->second.is_string()
                    && kind_it->second.as_string() == "number_literal" && value_it->second.is_number()) {
                    auto out = node("number_literal");
                    out["value"] = vf::JsonValue(-value_it->second.as_number());
                    const auto integer_it = object.find("is_integer_surface");
                    out["is_integer_surface"] = integer_it != object.end() ? integer_it->second : vf::JsonValue(false);
                    return vf::JsonValue(std::move(out));
                }
            }
            auto out = node("unary_op");
            out["op"] = vf::JsonValue(op.kind);
            out["operand"] = std::move(operand);
            return vf::JsonValue(std::move(out));
        }
        return parse_postfix_expr();
    }

    vf::JsonValue parse_postfix_expr() {
        vf::JsonValue expr = parse_atom();
        while (true) {
            if (is_at("IDENT") && expr_supports_axis_suffix(expr)) {
                const Token& label = peek();
                if (label.value.is_string()) {
                    const std::string suffix = label.value.as_string();
                    if (!suffix.empty() && suffix.front() == '_') {
                        advance();
                        auto out = node("axis_align");
                        out["value"] = std::move(expr);
                        if (suffix == "_") {
                            out["label"] = vf::JsonValue("i");
                        } else {
                            out["label"] = vf::JsonValue(suffix.substr(1));
                        }
                        out["indices"] = vf::JsonValue(nullptr);
                        expr = vf::JsonValue(std::move(out));
                        continue;
                    }
                }
            }
            if (is_at("LPAREN")) {
                expr = parse_call(std::move(expr));
                continue;
            }
            if (is_at("ARROW")) {
                advance();
                auto out = node("axis_align");
                out["value"] = std::move(expr);
                if (is_at("LPAREN")) {
                    expect("LPAREN");
                    vf::JsonValue::Array indices;
                    if (!is_at("RPAREN")) {
                        while (true) {
                            indices.push_back(parse_expression());
                            if (is_at("COMMA")) {
                                advance();
                                continue;
                            }
                            break;
                        }
                    }
                    expect("RPAREN");
                    out["label"] = vf::JsonValue(nullptr);
                    out["indices"] = vf::JsonValue(std::move(indices));
                    expr = vf::JsonValue(std::move(out));
                    continue;
                }
                if (is_at("IDENT")) {
                    const Token& label = advance();
                    out["label"] = vf::JsonValue(label.value.as_string());
                    out["indices"] = vf::JsonValue(nullptr);
                    expr = vf::JsonValue(std::move(out));
                    continue;
                }
                if (is_at("STRING") || is_at("STRING_RAW")) {
                    const Token& label = advance();
                    out["label"] = vf::JsonValue(label.value.as_string());
                    out["indices"] = vf::JsonValue(nullptr);
                    expr = vf::JsonValue(std::move(out));
                    continue;
                }
                if (is_at("NUMBER")) {
                    const Token& label = advance();
                    std::ostringstream text;
                    text << label.value.as_number();
                    out["label"] = vf::JsonValue(text.str());
                    out["indices"] = vf::JsonValue(nullptr);
                    expr = vf::JsonValue(std::move(out));
                    continue;
                }
                throw ParseFailure("unsupported token after ARROW", peek().location);
            }
            if (is_at("DOT")) {
                advance();
                if (is_at("LPAREN")) {
                    expect("LPAREN");
                    vf::JsonValue::Array indices;
                    if (!is_at("RPAREN")) {
                        while (true) {
                            indices.push_back(parse_expression());
                            if (is_at("COMMA")) {
                                advance();
                                continue;
                            }
                            break;
                        }
                    }
                    expect("RPAREN");
                    auto out = node("dotted_index");
                    out["base"] = std::move(expr);
                    out["indices"] = vf::JsonValue(std::move(indices));
                    expr = vf::JsonValue(std::move(out));
                    continue;
                }
                if (!is_at("IDENT")) {
                    if (is_at("NUMBER") || is_at("STRING") || is_at("STRING_RAW")) {
                        vf::JsonValue::Array indices;
                        indices.push_back(parse_atom());
                        auto out = node("dotted_index");
                        out["base"] = std::move(expr);
                        out["indices"] = vf::JsonValue(std::move(indices));
                        expr = vf::JsonValue(std::move(out));
                        continue;
                    }
                    auto out = node("type_of");
                    out["value"] = std::move(expr);
                    expr = vf::JsonValue(std::move(out));
                    continue;
                }
                const Token& name = expect("IDENT");
                auto out = node("attribute");
                out["object"] = std::move(expr);
                out["name"] = vf::JsonValue(name.value.as_string());
                expr = vf::JsonValue(std::move(out));
                continue;
            }
            if (is_at("QUESTION") && index_ + 1 < tokens_.size() &&
                tokens_[index_ + 1].kind == "BANG" && index_ > 0 &&
                tokens_[index_ - 1].kind == "RPAREN") {
                advance();
                advance();
                auto out = node("assert_expr");
                out["condition"] = std::move(expr);
                if (is_at("NEWLINE") || is_at("EOF") || is_at("SEMICOLON") ||
                    is_at("RPAREN") || is_at("DEDENT") || is_at("COMMA")) {
                    out["message"] = vf::JsonValue(nullptr);
                } else {
                    out["message"] = parse_expression();
                }
                expr = vf::JsonValue(std::move(out));
                continue;
            }
            if (is_at("BANG")) {
                advance();
                auto out = node("raise_expr");
                out["value"] = std::move(expr);
                expr = vf::JsonValue(std::move(out));
                continue;
            }
            break;
        }
        return expr;
    }

    vf::JsonValue parse_atom() {
        const Token& token = peek();
        if (is_function_name_kind(token.kind) && token.kind != "IDENT" &&
            index_ + 1 < tokens_.size() && tokens_[index_ + 1].kind == "LPAREN") {
            advance();
            auto out = node("identifier");
            out["name"] = vf::JsonValue(function_name_text(token));
            return vf::JsonValue(std::move(out));
        }
        if (token.kind == "MINUS") {
            advance();
            const Token& value = expect("NUMBER");
            if (!value.value.is_number()) {
                throw ParseFailure("NUMBER token requires numeric value", value.location);
            }
            auto out = node("number_literal");
            out["value"] = number_value(-value.value.as_number());
            out["is_integer_surface"] = vf::JsonValue(value.raw.find('.') == std::string::npos);
            return vf::JsonValue(std::move(out));
        }
        if (token.kind == "NUMBER") {
            advance();
            if (!token.value.is_number()) {
                throw ParseFailure("NUMBER token requires numeric value", token.location);
            }
            auto out = node("number_literal");
            out["value"] = number_value(token.value.as_number());
            out["is_integer_surface"] = vf::JsonValue(token.raw.find('.') == std::string::npos);
            return vf::JsonValue(std::move(out));
        }
        if (token.kind == "STRING" || token.kind == "STRING_RAW") {
            advance();
            if (!token.value.is_string()) {
                throw ParseFailure(token.kind + " token requires string value", token.location);
            }
            auto out = node("string_literal");
            out["value"] = vf::JsonValue(token.value.as_string());
            out["raw"] = vf::JsonValue(token.kind == "STRING_RAW");
            if (token.kind == "STRING" && token.interpolations.is_array()) {
                vf::JsonValue::Array interpolations;
                for (const auto& raw_interpolation : token.interpolations.as_array()) {
                    if (!raw_interpolation.is_object()) {
                        throw ParseFailure("expected interpolation object", token.location);
                    }
                    const auto& interpolation = raw_interpolation.as_object();
                    const auto& raw_tokens = field(interpolation, "tokens", token.location);
                    if (!raw_tokens.is_array()) {
                        throw ParseFailure("expected interpolation token array", token.location);
                    }
                    std::vector<Token> nested_tokens;
                    for (const auto& raw_nested : raw_tokens.as_array()) {
                        nested_tokens.push_back(read_token(raw_nested));
                    }
                    auto item = node("string_interpolation");
                    item["start"] = vf::JsonValue(static_cast<double>(require_int(
                        field(interpolation, "start", token.location),
                        "interpolation.start", token.location)));
                    item["end"] = vf::JsonValue(static_cast<double>(require_int(
                        field(interpolation, "end", token.location),
                        "interpolation.end", token.location)));
                    item["format"] = vf::JsonValue(require_string(
                        field(interpolation, "format", token.location),
                        "interpolation.format", token.location));
                    item["expression"] = Parser(std::move(nested_tokens)).parse_interpolation_expression();
                    interpolations.emplace_back(std::move(item));
                }
                out["interpolations"] = vf::JsonValue(std::move(interpolations));
            }
            return vf::JsonValue(std::move(out));
        }
        if (token.kind == "TRUE" || token.kind == "FALSE") {
            advance();
            auto out = node("bool_literal");
            out["value"] = vf::JsonValue(token.kind == "TRUE");
            return vf::JsonValue(std::move(out));
        }
        if (token.kind == "NULL") {
            advance();
            return vf::JsonValue(node("null_literal"));
        }
        if (token.kind == "LBRACKET") {
            return parse_list_literal();
        }
        if (token.kind == "LBRACE") {
            return parse_multiset_literal();
        }
        if (token.kind == "BAR") {
            advance();
            auto out = node("abs_expr");
            out["value"] = parse_expression();
            expect("BAR");
            return vf::JsonValue(std::move(out));
        }
        if (token.kind == "LPAREN") {
            if (starts_lambda_literal()) return parse_lambda_literal();
            return parse_record_literal();
        }
        if (token.kind == "IDENT") {
            advance();
            return ident_node(token);
        }
        if (token.kind == "DOLLAR") {
            advance();
            auto out = node("identifier");
            out["name"] = vf::JsonValue("$");
            return vf::JsonValue(std::move(out));
        }
        throw ParseFailure("unsupported token " + token.kind, token.location);
    }

    vf::JsonValue parse_list_literal() {
        expect("LBRACKET");
        vf::JsonValue::Array items;
        if (is_at("COLON")) {
            advance();
            vf::JsonValue spread = parse_expression();
            if (is_at("RBRACKET")) {
                advance();
                auto out = node("container_spill");
                out["container"] = vf::JsonValue("vector");
                out["value"] = std::move(spread);
                return vf::JsonValue(std::move(out));
            }
            auto item = node("spread_element");
            item["expr"] = std::move(spread);
            items.emplace_back(std::move(item));
            expect("COMMA");
        }
        if (!is_at("RBRACKET")) {
            while (true) {
                items.push_back(parse_literal_element());
                if (is_at("COMMA")) {
                    advance();
                    continue;
                }
                break;
            }
        }
        expect("RBRACKET");
        auto out = node("list_literal");
        out["items"] = vf::JsonValue(std::move(items));
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_literal_element() {
        if (is_at("COLON")) {
            advance();
            auto out = node("spread_element");
            out["expr"] = parse_expression();
            return vf::JsonValue(std::move(out));
        }
        vf::JsonValue value = parse_expression();
        if (!is_at("COLON")) return value;
        advance();
        auto out = node("repeat_element");
        out["value"] = std::move(value);
        out["count"] = parse_expression();
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_multiset_literal() {
        expect("LBRACE");
        if (is_at("COLON")) {
            advance();
            vf::JsonValue spread = parse_expression();
            expect("RBRACE");
            auto out = node("container_spill");
            out["container"] = vf::JsonValue("multiset");
            out["value"] = std::move(spread);
            return vf::JsonValue(std::move(out));
        }
        vf::JsonValue::Array pairs;
        if (!is_at("RBRACE")) {
            while (true) {
                vf::JsonValue key = parse_expression();
                vf::JsonValue count;
                if (is_at("COLON")) {
                    advance();
                    count = parse_expression();
                } else {
                    auto one = node("number_literal");
                    one["value"] = number_value(1);
                    count = vf::JsonValue(std::move(one));
                }
                auto pair = node("multiset_pair");
                pair["key"] = std::move(key);
                pair["count"] = std::move(count);
                pairs.push_back(vf::JsonValue(std::move(pair)));
                if (is_at("COMMA")) {
                    advance();
                    continue;
                }
                break;
            }
        }
        expect("RBRACE");
        auto out = node("multiset_literal");
        out["pairs"] = vf::JsonValue(std::move(pairs));
        return vf::JsonValue(std::move(out));
    }

    bool starts_lambda_literal() const {
        if (!is_at("LPAREN")) return false;
        std::size_t cursor = index_ + 1u;
        bool expect_name = true;
        while (cursor < tokens_.size() && tokens_[cursor].kind != "RPAREN") {
            if (expect_name) {
                if (tokens_[cursor].kind != "IDENT") return false;
            } else if (tokens_[cursor].kind != "COMMA") {
                return false;
            }
            expect_name = !expect_name;
            ++cursor;
        }
        return cursor < tokens_.size() && tokens_[cursor].kind == "RPAREN" &&
            cursor + 1u < tokens_.size() && tokens_[cursor + 1u].kind == "COLON" &&
            (cursor == index_ + 1u || !expect_name);
    }

    vf::JsonValue parse_lambda_literal() {
        expect("LPAREN");
        vf::JsonValue::Array params;
        if (!is_at("RPAREN")) {
            while (true) {
                params.emplace_back(expect("IDENT").value.as_string());
                if (!is_at("COMMA")) break;
                advance();
            }
        }
        expect("RPAREN");
        expect("COLON");
        auto out = node("lambda_expr");
        out["params"] = vf::JsonValue(std::move(params));
        out["body"] = parse_expression();
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_record_literal() {
        expect("LPAREN");
        if (is_at("RPAREN")) {
            advance();
            auto out = node("record_literal");
            out["fields"] = vf::JsonValue(vf::JsonValue::Array{});
            return vf::JsonValue(std::move(out));
        }
        if (is_at("COLON")) {
            advance();
            vf::JsonValue spread = parse_expression();
            if (is_at("RPAREN")) {
                advance();
                auto out = node("container_spill");
                out["container"] = vf::JsonValue("record");
                out["value"] = std::move(spread);
                return vf::JsonValue(std::move(out));
            }
            vf::JsonValue::Array elements;
            auto first = node("spread_element");
            first["expr"] = std::move(spread);
            elements.emplace_back(std::move(first));
            expect("COMMA");
            while (true) {
                elements.push_back(parse_literal_element());
                if (!is_at("COMMA")) break;
                advance();
            }
            expect("RPAREN");
            auto out = node("tuple_literal");
            out["elements"] = vf::JsonValue(std::move(elements));
            return vf::JsonValue(std::move(out));
        }

        const bool named_record = is_at("IDENT")
            && index_ + 1 < tokens_.size()
            && tokens_[index_ + 1].kind == "COLON";
        if (named_record) {
            vf::JsonValue::Array fields;
            bool saw_separator = false;
            while (true) {
                const Token& name = expect("IDENT");
                expect("COLON");
                auto field = node("record_field");
                field["name"] = vf::JsonValue(name.value.as_string());
                field["value"] = parse_expression();
                fields.push_back(vf::JsonValue(std::move(field)));
                if (is_at("COMMA")) {
                    advance();
                    saw_separator = true;
                    if (is_at("RPAREN")) break;
                    continue;
                }
                break;
            }
            expect("RPAREN");
            if (fields.size() == 1u && !saw_separator) {
                auto field = std::move(fields.front().as_object());
                auto out = node("bind_expr");
                out["name"] = std::move(field.at("name"));
                out["value"] = std::move(field.at("value"));
                return vf::JsonValue(std::move(out));
            }
            auto out = node("record_literal");
            out["fields"] = vf::JsonValue(std::move(fields));
            return vf::JsonValue(std::move(out));
        }

        vf::JsonValue::Array elements;
        while (true) {
            elements.push_back(parse_literal_element());
            if (is_at("COMMA")) {
                advance();
                continue;
            }
            break;
        }
        expect("RPAREN");
        if (elements.size() == 1) {
            return std::move(elements.front());
        }
        auto out = node("tuple_literal");
        out["elements"] = vf::JsonValue(std::move(elements));
        return vf::JsonValue(std::move(out));
    }

    vf::JsonValue parse_call_argument() {
        if (is_at("COLON")) {
            advance();
            auto out = node("spread_arg");
            out["expr"] = parse_expression();
            return vf::JsonValue(std::move(out));
        }
        if (is_at("IDENT") && index_ + 1 < tokens_.size() && tokens_[index_ + 1].kind == "COLON") {
            const Token& name = advance();
            expect("COLON");
            auto out = node("named_call_arg");
            out["name"] = vf::JsonValue(name.value.as_string());
            out["value"] = parse_expression();
            return vf::JsonValue(std::move(out));
        }
        return parse_expression();
    }

    vf::JsonValue parse_call(vf::JsonValue callee) {
        expect("LPAREN");
        vf::JsonValue::Array args;
        skip_newlines();
        if (!is_at("RPAREN")) {
            while (true) {
                args.push_back(parse_call_argument());
                if (is_at("COMMA")) {
                    advance();
                    skip_newlines();
                    continue;
                }
                break;
            }
        }
        expect("RPAREN");
        auto out = node("call");
        out["callee"] = std::move(callee);
        out["args"] = vf::JsonValue(std::move(args));
        return vf::JsonValue(std::move(out));
    }

    static vf::JsonValue ident_node(const Token& token) {
        if (!token.value.is_string()) {
            throw ParseFailure("IDENT token requires string value", token.location);
        }
        auto out = node("identifier");
        out["name"] = vf::JsonValue(token.value.as_string());
        return vf::JsonValue(std::move(out));
    }

    static bool expr_supports_axis_suffix(const vf::JsonValue& value) {
        if (!value.is_object()) {
            return false;
        }
        const auto& object = value.as_object();
        const auto found = object.find("kind");
        if (found == object.end() || !found->second.is_string()) {
            return false;
        }
        const std::string& kind = found->second.as_string();
        return kind == "list_literal" || kind == "axis_align";
    }

    std::vector<Token> tokens_;
    std::size_t index_ = 0;
};

std::string read_stdin() {
    std::ostringstream buffer;
    buffer << std::cin.rdbuf();
    return buffer.str();
}

std::string read_file(const std::string& path) {
    std::ifstream input(path);
    if (!input) {
        return "";
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

std::string input_text(int argc, char** argv) {
    if (argc <= 1) {
        return read_stdin();
    }
    const std::string file_text = read_file(argv[1]);
    if (!file_text.empty()) {
        return file_text;
    }
    return argv[1];
}

}  // namespace

vf::JsonValue vkf::native_frontend::parse_value(const vf::JsonValue& token_stream) {
    std::vector<Token> tokens = read_envelope(token_stream);
    Parser parser(std::move(tokens));
    return parser.parse_module();
}

vf::JsonValue vkf::native_frontend::parse_value(const std::string& token_stream_json) {
    return parse_value(vf::parse_json(token_stream_json));
}

std::string vkf::native_frontend::parse(const std::string& token_stream_json) {
    return vf::json_stringify(parse_value(token_stream_json), -1) + "\n";
}

#ifndef VKF_NATIVE_FRONTEND_LIBRARY
int main(int argc, char** argv) {
    try {
        std::cout << vkf::native_frontend::parse(input_text(argc, argv));
        return 0;
    } catch (const ParseFailure& failure) {
        const Location& location = failure.location();
        std::cerr << location.file << ":" << location.line << ":" << location.column
                  << ": " << failure.what() << "\n";
        return 1;
    } catch (const std::exception& exc) {
        std::cerr << "<token-stream>:1:1: " << exc.what() << "\n";
        return 1;
    }

}
#endif
