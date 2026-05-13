#include "lexer_state.hpp"

#include <cctype>
#include <cstdlib>

namespace vf {

void LexerState::lex_number(const SourceLocation& token_loc) {
    const std::size_t start = pos_;
    while (std::isdigit(static_cast<unsigned char>(peek()))) {
        advance();
    }

    bool is_float = false;
    if (peek() == '.' && std::isdigit(static_cast<unsigned char>(peek(1)))) {
        is_float = true;
        advance();
        while (std::isdigit(static_cast<unsigned char>(peek()))) {
            advance();
        }
    }

    if (peek() == 'e' || peek() == 'E') {
        std::size_t exp_pos = pos_ + 1;
        if (source_.size() > exp_pos && (source_[exp_pos] == '+' || source_[exp_pos] == '-')) {
            ++exp_pos;
        }
        if (source_.size() > exp_pos &&
            std::isdigit(static_cast<unsigned char>(source_[exp_pos]))) {
            is_float = true;
            advance();
            if (peek() == '+' || peek() == '-') {
                advance();
            }
            while (std::isdigit(static_cast<unsigned char>(peek()))) {
                advance();
            }
        }
    }

    const std::string text = source_.substr(start, pos_ - start);
    if (is_float) {
        emit("NUMBER", std::strtod(text.c_str(), nullptr), token_loc);
    } else {
        emit("NUMBER", static_cast<std::int64_t>(std::stoll(text)), token_loc);
    }
}

void LexerState::lex_string(const SourceLocation& token_loc) {
    advance();
    std::string out;
    bool windows_path_mode = false;
    while (pos_ < source_.size()) {
        const char ch = peek();
        if (ch == '"') {
            advance();
            emit("STRING", out, token_loc);
            return;
        }
        if (ch == '\n') {
            throw LexError("Unterminated string literal", token_loc);
        }
        if (ch == '\\') {
            advance();
            const char esc = peek();
            if (esc == '\0') {
                throw LexError("Unterminated string literal", token_loc);
            }
            advance();
            if (!windows_path_mode && out.size() == 2 && std::isalpha(static_cast<unsigned char>(out[0])) &&
                out[1] == ':') {
                windows_path_mode = true;
            }
            if (windows_path_mode) {
                out.push_back('\\');
                out.push_back(esc);
                continue;
            }
            out += decode_escape(esc, token_loc);
            continue;
        }
        out.push_back(ch);
        advance();
    }
    throw LexError("Unterminated string literal", token_loc);
}

void LexerState::lex_raw_string(const SourceLocation& token_loc) {
    advance();
    std::string out;
    while (pos_ < source_.size()) {
        const char ch = peek();
        if (ch == '\'') {
            advance();
            if (peek() == '\'') {
                advance();
                out.push_back('\'');
                continue;
            }
            emit("STRING_RAW", out, token_loc);
            return;
        }
        out.push_back(ch);
        advance();
    }
    throw LexError("Unterminated single-quoted string literal", token_loc);
}

void LexerState::lex_ident(const SourceLocation& token_loc, bool field_name) {
    const std::size_t start = pos_;
    while (true) {
        const char ch = peek();
        if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_') {
            advance();
        } else {
            break;
        }
    }
    const std::string name = source_.substr(start, pos_ - start);
    if (field_name) {
        emit("IDENT", name, token_loc);
        return;
    }
    const auto it = kKeywords.find(name);
    if (it != kKeywords.end()) {
        emit(it->second, std::monostate{}, token_loc);
        return;
    }
    emit("IDENT", name, token_loc);
}

std::string LexerState::decode_escape(char esc, const SourceLocation& token_loc) const {
    switch (esc) {
        case 'n':
            return "\n";
        case 't':
            return "\t";
        case 'r':
            return "\r";
        case '\\':
            return "\\";
        case '"':
            return "\"";
        case '$':
            return "\\$";
        default:
            throw LexError(std::string("Unknown escape sequence \\") + esc, token_loc);
    }
}

}  // namespace vf
