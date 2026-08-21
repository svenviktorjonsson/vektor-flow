#include "compiler/native/vkf_string_primitives.hpp"
#include "compiler/native/vkf_native_frontend.hpp"

#include <cctype>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

static constexpr std::size_t tab_width = 8;

struct SourceArgs {
    std::string source;
    std::string filename;
};

struct SmokeToken;

struct SmokeInterpolation {
    std::size_t start = 0;
    std::size_t end = 0;
    std::string format;
    std::vector<SmokeToken> tokens;
};

struct SmokeToken {
    std::string kind;
    std::string value;
    bool raw_value;
    std::string file;
    std::size_t line;
    std::size_t column;
    std::vector<SmokeInterpolation> interpolations;
};

static bool is_ascii_alpha_or_underscore(const std::string& scalar) {
    if (scalar.size() != 1) {
        return false;
    }
    const auto ch = static_cast<unsigned char>(scalar[0]);
    return std::isalpha(ch) != 0 || ch == '_';
}

static bool is_ascii_digit(const std::string& scalar) {
    return scalar.size() == 1 && std::isdigit(static_cast<unsigned char>(scalar[0])) != 0;
}

static std::string read_file(const std::string& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw std::runtime_error("could not read " + path);
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

static std::string normalize_source_text(std::string text) {
    std::string out;
    out.reserve(text.size());
    for (char ch : text) {
        if (ch != '\r') {
            out.push_back(ch);
        }
    }
    return out;
}

static SourceArgs parse_source_args(int argc, char** argv) {
    if (argc > 2 && std::string(argv[1]) == "--file") {
        const std::string path = argv[2];
        return {normalize_source_text(read_file(path)), argc > 3 ? argv[3] : path};
    }
    return {
        argc > 1 ? argv[1] : "alpha 123 beta45 6.7",
        argc > 2 ? argv[2] : "<cursor-smoke>",
    };
}

static bool is_identifier_continue(const std::string& scalar) {
    return is_ascii_alpha_or_underscore(scalar) || is_ascii_digit(scalar);
}

static bool is_ascii_space(const std::string& scalar) {
    return scalar == " " || scalar == "\t";
}

static bool last_token_is(const std::vector<SmokeToken>& tokens, std::string_view kind) {
    return !tokens.empty() && tokens.back().kind == kind;
}

static void emit_token(
    std::vector<SmokeToken>& tokens,
    std::string kind,
    std::string value,
    const VkfCursor& cursor
) {
    tokens.push_back({kind, value, false, std::string(cursor.file), cursor.line, cursor.column});
}

static void emit_raw_token(
    std::vector<SmokeToken>& tokens,
    std::string kind,
    std::string value,
    const VkfCursor& cursor
) {
    tokens.push_back({kind, value, true, std::string(cursor.file), cursor.line, cursor.column});
}

static std::string escaped_value(std::string_view value) {
    std::string out;
    for (char ch : value) {
        if (ch == '\\') {
            out += "\\\\";
        } else if (ch == '"') {
            out += "\\\"";
        } else if (ch == '\n') {
            out += "\\n";
        } else if (ch == '\t') {
            out += "\\t";
        } else if (ch == '\r') {
            out += "\\r";
        } else {
            out += ch;
        }
    }
    return out;
}

static bool token_has_string_payload(std::string_view kind) {
    return kind == "IDENT" || kind == "STRING" || kind == "STRING_RAW";
}

static bool token_has_raw_payload(std::string_view kind) {
    return kind == "NUMBER" || kind == "DOT" || kind == "ARROW";
}

static std::string normalize_number_json(std::string value) {
    if (!value.empty() && value.back() == '.') {
        value.push_back('0');
    }
    return value;
}

static bool peek_literal(const VkfCursor& cursor, std::string_view literal);
static void advance_bytes(VkfCursor& cursor, std::size_t byte_count);
static std::vector<SmokeInterpolation> scan_interpolations(
    const std::string& text,
    const std::string& file
);

static SmokeToken scan_identifier(VkfCursor& cursor) {
    const VkfCursor start = cursor;
    while (!vkf_string_eof(cursor.source, cursor.index)
        && is_identifier_continue(vkf_string_peek_scalar(cursor.source, cursor.index))) {
        cursor = vkf_cursor_advance_scalar(cursor);
    }
    const std::string value = vkf_string_slice_bytes(cursor.source, start.index, cursor.index);
    std::string kind = "IDENT";
    if (value == "true") {
        kind = "TRUE";
    } else if (value == "false") {
        kind = "FALSE";
    } else if (value == "null") {
        kind = "NULL";
    }
    return {
        kind,
        value,
        false,
        std::string(start.file),
        start.line,
        start.column,
        {},
    };
}

static SmokeToken scan_number(VkfCursor& cursor) {
    const VkfCursor start = cursor;
    bool saw_dot = false;
    while (!vkf_string_eof(cursor.source, cursor.index)) {
        const std::string scalar = vkf_string_peek_scalar(cursor.source, cursor.index);
        if (is_ascii_digit(scalar)) {
            cursor = vkf_cursor_advance_scalar(cursor);
            continue;
        }
        if (scalar == "." && !saw_dot) {
            VkfCursor after_dot = vkf_cursor_advance_scalar(cursor);
            if (peek_literal(cursor, "..")
                || vkf_string_eof(after_dot.source, after_dot.index)
                || !is_ascii_digit(vkf_string_peek_scalar(after_dot.source, after_dot.index))) {
                break;
            }
            saw_dot = true;
            cursor = after_dot;
            continue;
        }
        break;
    }
    return {
        "NUMBER",
        vkf_string_slice_bytes(cursor.source, start.index, cursor.index),
        false,
        std::string(start.file),
        start.line,
        start.column,
        {},
    };
}

static std::string decode_escape(const std::string& scalar) {
    if (scalar == "n") {
        return "\n";
    }
    if (scalar == "t") {
        return "\t";
    }
    if (scalar == "r") {
        return "\r";
    }
    if (scalar == "\\") {
        return "\\";
    }
    if (scalar == "\"") {
        return "\"";
    }
    if (scalar == "$") {
        return "\\$";
    }
    throw std::runtime_error("Unknown escape sequence \\" + scalar);
}

static SmokeToken scan_double_string(VkfCursor& cursor) {
    const VkfCursor start = cursor;
    const bool triple = peek_literal(cursor, "\"\"\"");
    advance_bytes(cursor, triple ? 3 : 1);

    std::string out;
    while (!vkf_string_eof(cursor.source, cursor.index)) {
        if (triple && peek_literal(cursor, "\"\"\"")) {
            advance_bytes(cursor, 3);
            return {"STRING", out, false, std::string(start.file), start.line, start.column};
        }
        const std::string scalar = vkf_string_peek_scalar(cursor.source, cursor.index);
        if (!triple && scalar == "\"") {
            cursor = vkf_cursor_advance_scalar(cursor);
            return {"STRING", out, false, std::string(start.file), start.line, start.column};
        }
        if (!triple && scalar == "\n") {
            throw std::runtime_error("Unterminated string literal");
        }
        if (scalar == "\\") {
            cursor = vkf_cursor_advance_scalar(cursor);
            if (vkf_string_eof(cursor.source, cursor.index)) {
                throw std::runtime_error(triple ? "Unterminated triple-quoted string literal" : "Unterminated string literal");
            }
            const std::string escape = vkf_string_peek_scalar(cursor.source, cursor.index);
            cursor = vkf_cursor_advance_scalar(cursor);
            out += decode_escape(escape);
            continue;
        }
        out += scalar;
        cursor = vkf_cursor_advance_scalar(cursor);
    }

    throw std::runtime_error(triple ? "Unterminated triple-quoted string literal" : "Unterminated string literal");
}

static SmokeToken scan_single_raw_string(VkfCursor& cursor) {
    const VkfCursor start = cursor;
    const bool triple = peek_literal(cursor, "'''");
    advance_bytes(cursor, triple ? 3 : 1);

    std::string out;
    while (!vkf_string_eof(cursor.source, cursor.index)) {
        if (triple && peek_literal(cursor, "'''")) {
            advance_bytes(cursor, 3);
            return {"STRING_RAW", out, false, std::string(start.file), start.line, start.column};
        }
        const std::string scalar = vkf_string_peek_scalar(cursor.source, cursor.index);
        if (!triple && scalar == "'") {
            cursor = vkf_cursor_advance_scalar(cursor);
            if (!vkf_string_eof(cursor.source, cursor.index)
                && vkf_string_peek_scalar(cursor.source, cursor.index) == "'") {
                cursor = vkf_cursor_advance_scalar(cursor);
                out += "'";
                continue;
            }
            return {"STRING_RAW", out, false, std::string(start.file), start.line, start.column};
        }
        out += scalar;
        cursor = vkf_cursor_advance_scalar(cursor);
    }

    throw std::runtime_error(triple ? "Unterminated triple single-quoted string literal" : "Unterminated single-quoted string literal");
}

static bool line_has_content(VkfCursor cursor) {
    while (!vkf_string_eof(cursor.source, cursor.index)) {
        const std::string scalar = vkf_string_peek_scalar(cursor.source, cursor.index);
        if (scalar == "\n" || scalar == "#") {
            return false;
        }
        if (!is_ascii_space(scalar)) {
            return true;
        }
        cursor = vkf_cursor_advance_scalar(cursor);
    }
    return false;
}

static std::size_t consume_leading_indent(VkfCursor& cursor) {
    std::size_t indent_column = 0;
    while (!vkf_string_eof(cursor.source, cursor.index)) {
        const std::string scalar = vkf_string_peek_scalar(cursor.source, cursor.index);
        if (scalar == " ") {
            indent_column += 1;
            cursor = vkf_cursor_advance_scalar(cursor);
            continue;
        }
        if (scalar == "\t") {
            indent_column = ((indent_column / tab_width) + 1) * tab_width;
            cursor = vkf_cursor_advance_scalar(cursor);
            continue;
        }
        break;
    }
    return indent_column;
}

static void handle_line_start(
    VkfCursor& cursor,
    std::vector<std::size_t>& indent_stack,
    std::vector<SmokeToken>& tokens,
    bool& at_line_start
) {
    const std::size_t indent_column = consume_leading_indent(cursor);
    if (!line_has_content(cursor)) {
        while (!vkf_string_eof(cursor.source, cursor.index)
            && vkf_string_peek_scalar(cursor.source, cursor.index) != "\n") {
            cursor = vkf_cursor_advance_scalar(cursor);
        }
        at_line_start = true;
        return;
    }

    const std::size_t current = indent_stack.back();
    if (indent_column > current) {
        indent_stack.push_back(indent_column);
        emit_token(tokens, "INDENT", "", cursor);
    } else if (indent_column < current) {
        while (indent_column < indent_stack.back()) {
            indent_stack.pop_back();
            emit_token(tokens, "DEDENT", "", cursor);
        }
        if (indent_column != indent_stack.back()) {
            throw std::runtime_error(
                "Inconsistent indentation: column " + std::to_string(indent_column)
            );
        }
    }
    at_line_start = false;
}

static bool is_tight_left(std::string_view source, std::size_t index) {
    if (index == 0) {
        return false;
    }
    const char ch = source[index - 1];
    return ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n';
}

static bool is_tight_right(std::string_view source, std::size_t index) {
    if (index >= source.size()) {
        return false;
    }
    const char ch = source[index];
    return ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n';
}

static std::string bool_pair_json(bool left, bool right) {
    return std::string("[") + (left ? "true" : "false") + "," + (right ? "true" : "false") + "]";
}

static bool peek_literal(const VkfCursor& cursor, std::string_view literal) {
    return cursor.index + literal.size() <= cursor.source.size()
        && cursor.source.substr(cursor.index, literal.size()) == literal;
}

static void advance_bytes(VkfCursor& cursor, std::size_t byte_count) {
    const std::size_t stop = cursor.index + byte_count;
    while (cursor.index < stop) {
        cursor = vkf_cursor_advance_scalar(cursor);
    }
}

static bool scan_operator_or_punctuation(
    VkfCursor& cursor,
    std::vector<SmokeToken>& tokens,
    int& bracket_depth
) {
    const VkfCursor loc = cursor;
    const std::string scalar = vkf_string_peek_scalar(cursor.source, cursor.index);

    if (scalar == "@") {
        cursor = vkf_cursor_advance_scalar(cursor);
        while (!vkf_string_eof(cursor.source, cursor.index)) {
            const std::string spacing = vkf_string_peek_scalar(cursor.source, cursor.index);
            if (spacing != " " && spacing != "\t") {
                break;
            }
            cursor = vkf_cursor_advance_scalar(cursor);
        }
        if (peek_literal(cursor, ">")) {
            advance_bytes(cursor, 1);
            emit_token(tokens, "AT_GT", "", loc);
        } else if (peek_literal(cursor, "|")) {
            advance_bytes(cursor, 1);
            emit_token(tokens, "AT_BAR", "", loc);
        } else if (peek_literal(cursor, "!")) {
            advance_bytes(cursor, 1);
            emit_token(tokens, "AT_BANG", "", loc);
        } else if (peek_literal(cursor, "::")) {
            advance_bytes(cursor, 2);
            emit_token(tokens, "AT_EMIT", "", loc);
        } else if (peek_literal(cursor, ":")) {
            advance_bytes(cursor, 1);
            emit_token(tokens, "AT_COLON", "", loc);
        } else {
            emit_token(tokens, "AT", "", loc);
        }
        return true;
    }

    if (peek_literal(cursor, "...")) {
        advance_bytes(cursor, 3);
        emit_token(tokens, "ELLIPSIS", "", loc);
        return true;
    }
    if (peek_literal(cursor, "::")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "EMIT", "", loc);
        return true;
    }
    if (peek_literal(cursor, "=>")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "FAT_ARROW", "", loc);
        return true;
    }
    if (peek_literal(cursor, "->")) {
        const bool left = is_tight_left(cursor.source, cursor.index);
        advance_bytes(cursor, 2);
        emit_raw_token(tokens, "ARROW", bool_pair_json(left, is_tight_right(cursor.source, cursor.index)), loc);
        return true;
    }
    if (peek_literal(cursor, "..")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "RANGE", "", loc);
        return true;
    }
    if (peek_literal(cursor, "==")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "EXACT_EQ", "", loc);
        return true;
    }
    if (peek_literal(cursor, "!=")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "NEQ", "", loc);
        return true;
    }
    if (peek_literal(cursor, "~=")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "STRUCT_NEQ", "", loc);
        return true;
    }
    if (peek_literal(cursor, "<=")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "LE", "", loc);
        return true;
    }
    if (peek_literal(cursor, ">=")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "GE", "", loc);
        return true;
    }
    if (peek_literal(cursor, ">>")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "PIPE", "", loc);
        return true;
    }
    if (peek_literal(cursor, "/\\")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "AND", "", loc);
        return true;
    }
    if (peek_literal(cursor, "\\/")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "OR", "", loc);
        return true;
    }
    if (peek_literal(cursor, "//")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "FLOORDIV", "", loc);
        return true;
    }
    if (peek_literal(cursor, "><")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "XOR", "", loc);
        return true;
    }
    if (peek_literal(cursor, "!?")) {
        advance_bytes(cursor, 2);
        emit_token(tokens, "BANG_QUESTION", "", loc);
        return true;
    }

    if (scalar == ".") {
        const bool left = is_tight_left(cursor.source, cursor.index);
        cursor = vkf_cursor_advance_scalar(cursor);
        emit_raw_token(tokens, "DOT", bool_pair_json(left, is_tight_right(cursor.source, cursor.index)), loc);
        return true;
    }

    struct SingleToken {
        const char* lexeme;
        const char* kind;
    };
    const SingleToken singles[] = {
        {"+", "PLUS"}, {"-", "MINUS"}, {"*", "STAR"}, {"/", "SLASH"},
        {"^", "CARET"}, {"%", "PERCENT"}, {"&", "AMPERSAND"}, {",", "COMMA"},
        {";", "SEMICOLON"}, {"?", "QUESTION"}, {"$", "DOLLAR"}, {"~", "NOT"},
        {"|", "BAR"}, {"(", "LPAREN"}, {")", "RPAREN"}, {"[", "LBRACKET"},
        {"]", "RBRACKET"}, {"{", "LBRACE"}, {"}", "RBRACE"}, {":", "COLON"},
        {"=", "EQ"}, {"<", "LT"}, {">", "GT"}, {"!", "BANG"},
    };

    for (const auto& token : singles) {
        if (scalar == token.lexeme) {
            cursor = vkf_cursor_advance_scalar(cursor);
            emit_token(tokens, token.kind, "", loc);
            if (scalar == "(" || scalar == "[" || scalar == "{") {
                bracket_depth += 1;
            } else if (scalar == ")" || scalar == "]" || scalar == "}") {
                bracket_depth -= 1;
                if (bracket_depth < 0) {
                    throw std::runtime_error("unmatched closing bracket");
                }
            }
            return true;
        }
    }

    return false;
}

static std::vector<SmokeToken> scan_tokens(std::string_view source, std::string_view file) {
    VkfCursor cursor{source, "<cursor-smoke>", 0, 1, 1};
    cursor.file = file;
    std::vector<SmokeToken> tokens;
    std::vector<std::size_t> indent_stack{0};
    bool at_line_start = true;
    int bracket_depth = 0;

    while (!vkf_string_eof(cursor.source, cursor.index)) {
        if (at_line_start && bracket_depth == 0) {
            handle_line_start(cursor, indent_stack, tokens, at_line_start);
            if (vkf_string_eof(cursor.source, cursor.index)) {
                break;
            }
        }

        const std::string scalar = vkf_string_peek_scalar(cursor.source, cursor.index);
        if (is_ascii_space(scalar)) {
            cursor = vkf_cursor_advance_scalar(cursor);
            continue;
        }
        if (scalar == "#") {
            while (!vkf_string_eof(cursor.source, cursor.index)
                && vkf_string_peek_scalar(cursor.source, cursor.index) != "\n") {
                cursor = vkf_cursor_advance_scalar(cursor);
            }
            continue;
        }
        if (scalar == "\n") {
            cursor = vkf_cursor_advance_scalar(cursor);
            if (bracket_depth == 0 && !last_token_is(tokens, "NEWLINE")) {
                emit_token(tokens, "NEWLINE", "", cursor);
                at_line_start = true;
            }
            continue;
        }
        if (is_ascii_alpha_or_underscore(scalar)) {
            tokens.push_back(scan_identifier(cursor));
            continue;
        }
        if (is_ascii_digit(scalar)) {
            tokens.push_back(scan_number(cursor));
            continue;
        }
        if (scalar == "\"") {
            auto token = scan_double_string(cursor);
            token.interpolations = scan_interpolations(token.value, token.file);
            tokens.push_back(std::move(token));
            continue;
        }
        if (scalar == "'") {
            tokens.push_back(scan_single_raw_string(cursor));
            continue;
        }
        if (scan_operator_or_punctuation(cursor, tokens, bracket_depth)) {
            continue;
        }
        throw std::runtime_error("unexpected scalar at byte " + std::to_string(cursor.index));
    }

    if (!tokens.empty() && !last_token_is(tokens, "NEWLINE") && !last_token_is(tokens, "DEDENT")
        && !last_token_is(tokens, "INDENT")) {
        emit_token(tokens, "NEWLINE", "", cursor);
    }
    while (indent_stack.size() > 1) {
        indent_stack.pop_back();
        emit_token(tokens, "DEDENT", "", cursor);
    }
    emit_token(tokens, "EOF", "", cursor);
    return tokens;
}

static std::vector<SmokeToken> scan_tokens(std::string_view source, std::string_view file);

static bool interpolation_identifier_start(char ch) {
    return std::isalpha(static_cast<unsigned char>(ch)) != 0 || ch == '_';
}

static bool interpolation_identifier_continue(char ch) {
    return std::isalnum(static_cast<unsigned char>(ch)) != 0 || ch == '_';
}

static std::string interpolation_format(
    const std::string& text,
    std::size_t& cursor,
    const std::string& context
) {
    if (cursor >= text.size() || text[cursor] != '.') return {};
    const std::size_t dot = cursor++;
    const std::size_t start = cursor;
    while (cursor < text.size() && std::isdigit(static_cast<unsigned char>(text[cursor]))) ++cursor;
    const std::size_t letters = cursor;
    while (cursor < text.size() && std::isalpha(static_cast<unsigned char>(text[cursor]))) ++cursor;
    if (cursor == letters) {
        throw std::runtime_error("expected format after " + context + ".");
    }
    return text.substr(start, cursor - start);
}

static std::vector<SmokeInterpolation> scan_interpolations(
    const std::string& text,
    const std::string& file
) {
    std::vector<SmokeInterpolation> result;
    std::size_t cursor = 0;
    while (cursor < text.size()) {
        if (text[cursor] == '\\' && cursor + 1 < text.size() && text[cursor + 1] == '$') {
            cursor += 2;
            continue;
        }
        if (text[cursor] != '$') {
            ++cursor;
            continue;
        }
        SmokeInterpolation interpolation;
        interpolation.start = cursor;
        std::string expression;
        if (cursor + 1 < text.size() && text[cursor + 1] == '(') {
            std::size_t scan = cursor + 2;
            const std::size_t expression_start = scan;
            unsigned depth = 1;
            char quote = '\0';
            bool escaped = false;
            while (scan < text.size() && depth != 0) {
                const char ch = text[scan];
                if (quote != '\0') {
                    if (escaped) escaped = false;
                    else if (ch == '\\') escaped = true;
                    else if (ch == quote) quote = '\0';
                } else if (ch == '\'' || ch == '"') {
                    quote = ch;
                } else if (ch == '(') {
                    ++depth;
                } else if (ch == ')') {
                    --depth;
                }
                ++scan;
            }
            if (depth != 0) throw std::runtime_error("unclosed $(...) in string");
            expression = text.substr(expression_start, scan - expression_start - 1);
            cursor = scan;
            interpolation.format = interpolation_format(text, cursor, "$(...)");
        } else {
            std::size_t scan = cursor + 1;
            if (scan >= text.size() || !interpolation_identifier_start(text[scan])) {
                throw std::runtime_error("invalid $ in string");
            }
            const std::size_t path_start = scan++;
            while (scan < text.size() && interpolation_identifier_continue(text[scan])) ++scan;
            while (scan < text.size() && text[scan] == '.') {
                const std::size_t segment = scan + 1;
                if (segment < text.size() && interpolation_identifier_start(text[segment])) {
                    scan = segment + 1;
                    while (scan < text.size() && interpolation_identifier_continue(text[scan])) ++scan;
                    continue;
                }
                break;
            }
            expression = text.substr(path_start, scan - path_start);
            cursor = scan;
            interpolation.format = interpolation_format(text, cursor, "$path");
        }
        const auto first = expression.find_first_not_of(" \t\r\n");
        const auto last = expression.find_last_not_of(" \t\r\n");
        if (first == std::string::npos) throw std::runtime_error("empty interpolation expression");
        expression = expression.substr(first, last - first + 1);
        interpolation.end = cursor;
        interpolation.tokens = scan_tokens(expression, file);
        result.push_back(std::move(interpolation));
    }
    return result;
}

#ifdef VKF_NATIVE_FRONTEND_LIBRARY
vf::JsonValue vkf::native_frontend::lex_value(
    const std::string& source,
    const std::string& filename
) {
    vf::JsonValue::Array values;
    const auto tokens = scan_tokens(source, filename);
    values.reserve(tokens.size());
    const auto token_value = [&](const auto& self, const SmokeToken& token) -> vf::JsonValue {
        vf::JsonValue::Object value;
        value["kind"] = vf::JsonValue(token.kind);
        if (token.kind == "NUMBER") {
            value["value"] = vf::JsonValue(std::stod(normalize_number_json(token.value)));
            value["raw"] = vf::JsonValue(token.value);
        } else if (token_has_string_payload(token.kind)) {
            value["value"] = vf::JsonValue(token.value);
        } else if (token.raw_value || token_has_raw_payload(token.kind)) {
            vf::JsonValue::Array pair;
            pair.push_back(vf::JsonValue(token.value.rfind("[true", 0) == 0));
            pair.push_back(vf::JsonValue(token.value.find(",true") != std::string::npos));
            value["value"] = vf::JsonValue(std::move(pair));
        } else {
            value["value"] = vf::JsonValue(nullptr);
        }
        vf::JsonValue::Object location;
        location["file"] = vf::JsonValue(token.file);
        location["line"] = vf::JsonValue(static_cast<double>(token.line));
        location["column"] = vf::JsonValue(static_cast<double>(token.column));
        value["location"] = vf::JsonValue(std::move(location));
        if (!token.interpolations.empty()) {
            vf::JsonValue::Array interpolations;
            for (const auto& interpolation : token.interpolations) {
                vf::JsonValue::Object item;
                item["start"] = vf::JsonValue(static_cast<double>(interpolation.start));
                item["end"] = vf::JsonValue(static_cast<double>(interpolation.end));
                item["format"] = vf::JsonValue(interpolation.format);
                vf::JsonValue::Array nested;
                for (const auto& child : interpolation.tokens) nested.push_back(self(self, child));
                item["tokens"] = vf::JsonValue(std::move(nested));
                interpolations.emplace_back(std::move(item));
            }
            value["interpolations"] = vf::JsonValue(std::move(interpolations));
        }
        return vf::JsonValue(std::move(value));
    };
    for (const auto& token : tokens) {
        values.push_back(token_value(token_value, token));
    }
    vf::JsonValue::Object envelope;
    envelope["schema"] = vf::JsonValue("vektorflow.token_stream");
    envelope["version"] = vf::JsonValue(1.0);
    envelope["tokens"] = vf::JsonValue(std::move(values));
    return vf::JsonValue(std::move(envelope));
}
#endif

std::string vkf::native_frontend::lex(const std::string& source, const std::string& filename) {
    const auto tokens = scan_tokens(source, filename);
    std::ostringstream output;
    output << "{\n  \"schema\": \"vektorflow.token_stream\",\n  \"version\": 1,\n  \"tokens\": [\n";
    const auto write_token = [&](const auto& self, const SmokeToken& token, unsigned indent) -> void {
        const std::string pad(indent, ' ');
        output << pad << "{\n"
               << pad << "  \"kind\": \"" << token.kind << "\",\n"
               << pad << "  \"value\": ";
        if (token.raw_value || token_has_raw_payload(token.kind)) {
            if (token.kind == "NUMBER") {
                output << normalize_number_json(token.value);
            } else {
                output << token.value;
            }
        } else if (token_has_string_payload(token.kind)) {
            output << "\"" << escaped_value(token.value) << "\"";
        } else {
            output << "null";
        }
        if (token.kind == "NUMBER") {
            output << ",\n" << pad << "  \"raw\": \"" << escaped_value(token.value) << "\"";
        }
        output << ",\n" << pad << "  \"location\": {\n"
               << pad << "    \"file\": \"" << escaped_value(token.file) << "\",\n"
               << pad << "    \"line\": " << token.line << ",\n"
               << pad << "    \"column\": " << token.column << "\n"
               << pad << "  }";
        if (!token.interpolations.empty()) {
            output << ",\n" << pad << "  \"interpolations\": [\n";
            for (std::size_t index = 0; index < token.interpolations.size(); ++index) {
                const auto& interpolation = token.interpolations[index];
                output << pad << "    {\n"
                       << pad << "      \"start\": " << interpolation.start << ",\n"
                       << pad << "      \"end\": " << interpolation.end << ",\n"
                       << pad << "      \"format\": \"" << escaped_value(interpolation.format) << "\",\n"
                       << pad << "      \"tokens\": [\n";
                for (std::size_t child = 0; child < interpolation.tokens.size(); ++child) {
                    self(self, interpolation.tokens[child], indent + 8);
                    if (child + 1 < interpolation.tokens.size()) output << ',';
                    output << '\n';
                }
                output << pad << "      ]\n" << pad << "    }";
                if (index + 1 < token.interpolations.size()) output << ',';
                output << '\n';
            }
            output << pad << "  ]";
        }
        output << '\n' << pad << '}';
    };
    for (std::size_t index = 0; index < tokens.size(); ++index) {
        write_token(write_token, tokens[index], 4);
        if (index + 1 < tokens.size()) {
            output << ",";
        }
        output << "\n";
    }
    output << "  ]\n}\n";
    return output.str();
}

#ifndef VKF_NATIVE_FRONTEND_LIBRARY
int main(int argc, char** argv) {
    const SourceArgs input = parse_source_args(argc, argv);
    try {
        std::cout << vkf::native_frontend::lex(input.source, input.filename);
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << exc.what() << "\n";
        return 1;
    }
}
#endif
