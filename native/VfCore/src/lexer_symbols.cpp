#include "lexer_state.hpp"

#include <cctype>

namespace vf {

void LexerState::lex_token() {
    const SourceLocation token_loc = loc();
    const char ch = peek();

    if (std::isdigit(static_cast<unsigned char>(ch))) {
        lex_number(token_loc);
        return;
    }
    if (ch == '"') {
        lex_string(token_loc);
        return;
    }
    if (ch == '\'') {
        lex_raw_string(token_loc);
        return;
    }
    if (std::isalpha(static_cast<unsigned char>(ch)) || ch == '_') {
        lex_ident(token_loc, field_name_next_);
        field_name_next_ = false;
        return;
    }
    if (ch == '(' || ch == '[' || ch == '{') {
        advance();
        emit(ch == '(' ? "LPAREN" : ch == '[' ? "LBRACKET" : "LBRACE", std::monostate{}, token_loc);
        ++bracket_depth_;
        return;
    }
    if (ch == ')' || ch == ']' || ch == '}') {
        advance();
        emit(ch == ')' ? "RPAREN" : ch == ']' ? "RBRACKET" : "RBRACE", std::monostate{}, token_loc);
        --bracket_depth_;
        if (bracket_depth_ < 0) {
            throw LexError(std::string("Unmatched closing '") + ch + "'", token_loc);
        }
        return;
    }
    if (ch == '-') {
        lex_arrow(token_loc);
        return;
    }
    if (ch == '@') {
        lex_at_family(token_loc);
        return;
    }
    if (ch == ':') {
        advance();
        if (peek() == ':') {
            advance();
            emit("EMIT", std::monostate{}, token_loc);
        } else {
            emit("COLON", std::monostate{}, token_loc);
        }
        return;
    }
    if (ch == '=') {
        advance();
        if (peek() == '>') {
            advance();
            emit("FAT_ARROW", std::monostate{}, token_loc);
        } else {
            emit("EQ", std::monostate{}, token_loc);
        }
        return;
    }
    if (ch == '!') {
        advance();
        if (peek() == '?') {
            advance();
            emit("BANG_QUESTION", std::monostate{}, token_loc);
            return;
        }
        if (peek() == '=') {
            advance();
            emit("NEQ", std::monostate{}, token_loc);
            return;
        }
        throw LexError("Unexpected '!'; did you mean '!=', '!?'?", token_loc);
    }
    if (ch == '<') {
        advance();
        if (peek() == '=') {
            advance();
            emit("LE", std::monostate{}, token_loc);
        } else {
            emit("LT", std::monostate{}, token_loc);
        }
        return;
    }
    if (ch == '>') {
        advance();
        if (peek() == '=') {
            advance();
            emit("GE", std::monostate{}, token_loc);
        } else if (peek() == '>') {
            advance();
            emit("PIPE", std::monostate{}, token_loc);
        } else if (peek() == '<') {
            advance();
            emit("XOR", std::monostate{}, token_loc);
        } else {
            emit("GT", std::monostate{}, token_loc);
        }
        return;
    }
    if (ch == '/') {
        advance();
        if (peek() == '\\') {
            advance();
            emit("AND", std::monostate{}, token_loc);
        } else {
            emit("SLASH", std::monostate{}, token_loc);
        }
        return;
    }
    if (ch == '\\') {
        advance();
        if (peek() == '/') {
            advance();
            emit("OR", std::monostate{}, token_loc);
            return;
        }
        throw LexError(
            "Unexpected backslash outside a string (use \\/ for logical or)",
            token_loc);
    }
    if (ch == '|') {
        advance();
        emit("BAR", std::monostate{}, token_loc);
        return;
    }
    if (ch == '.') {
        lex_dot(token_loc);
        return;
    }

    const auto it = kSingleCharTokens.find(ch);
    if (it != kSingleCharTokens.end()) {
        advance();
        emit(it->second, std::monostate{}, token_loc);
        return;
    }

    throw LexError(std::string("Unexpected character '") + ch + "'", token_loc);
}

void LexerState::lex_at_family(const SourceLocation& token_loc) {
    advance();
    while (peek() == ' ' || peek() == '\t') {
        advance();
    }
    const char next = peek();
    if (next == '>') {
        advance();
        emit("AT_GT", std::monostate{}, token_loc);
    } else if (next == '|') {
        advance();
        emit("AT_BAR", std::monostate{}, token_loc);
    } else if (next == '!') {
        advance();
        emit("AT_BANG", std::monostate{}, token_loc);
    } else if (next == ':') {
        advance();
        if (peek() == ':') {
            advance();
            emit("AT_EMIT", std::monostate{}, token_loc);
        } else {
            emit("AT_COLON", std::monostate{}, token_loc);
        }
    } else {
        emit("AT", std::monostate{}, token_loc);
    }
}

void LexerState::lex_arrow(const SourceLocation& token_loc) {
    const std::size_t minus_pos = pos_;
    const bool left_adjacent =
        minus_pos > 0 && source_[minus_pos - 1] != ' ' && source_[minus_pos - 1] != '\t' &&
        source_[minus_pos - 1] != '\r';
    advance();
    if (peek() != '>') {
        emit("MINUS", std::monostate{}, token_loc);
        return;
    }
    advance();
    const bool right_adjacent =
        pos_ < source_.size() && peek() != ' ' && peek() != '\t' && peek() != '\n' && peek() != '\r';
    emit("ARROW", DotTightness{left_adjacent, right_adjacent}, token_loc);
}

void LexerState::lex_dot(const SourceLocation& token_loc) {
    const std::size_t dot_pos = pos_;
    const bool left_adjacent =
        dot_pos > 0 && source_[dot_pos - 1] != ' ' && source_[dot_pos - 1] != '\t' &&
        source_[dot_pos - 1] != '\r';
    if (dot_pos + 2 < source_.size() && source_[dot_pos + 1] == '.' && source_[dot_pos + 2] == '.') {
        advance();
        advance();
        advance();
        emit("ELLIPSIS", std::monostate{}, token_loc);
        return;
    }
    advance();
    if (peek() == '.') {
        advance();
        emit("RANGE", std::monostate{}, token_loc);
        return;
    }
    const bool right_adjacent =
        pos_ < source_.size() && peek() != ' ' && peek() != '\t' && peek() != '\n' && peek() != '\r';
    emit("DOT", DotTightness{left_adjacent, right_adjacent}, token_loc);
    field_name_next_ = right_adjacent;
}

}  // namespace vf
