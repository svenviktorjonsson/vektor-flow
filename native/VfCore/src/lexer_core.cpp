#include "lexer_state.hpp"

#include <cctype>
#include <utility>

namespace vf {

std::vector<Token> LexerState::tokenize() {
    while (pos_ < source_.size()) {
        if (at_line_start_ && bracket_depth_ == 0) {
            handle_line_start();
            if (pos_ >= source_.size()) {
                break;
            }
        }

        const char ch = peek();
        if (ch == '\n') {
            advance();
            if (bracket_depth_ == 0) {
                if (!tokens_.empty() && tokens_.back().kind != "NEWLINE") {
                    emit("NEWLINE", std::monostate{}, loc());
                }
                at_line_start_ = true;
            }
            continue;
        }

        if (ch == ' ' || ch == '\t') {
            advance();
            continue;
        }

        if (ch == '#') {
            while (pos_ < source_.size() && peek() != '\n') {
                advance();
            }
            continue;
        }

        lex_token();
    }

    if (!tokens_.empty()) {
        const std::string& last = tokens_.back().kind;
        if (last != "NEWLINE" && last != "DEDENT" && last != "INDENT") {
            emit("NEWLINE", std::monostate{}, loc());
        }
    }
    while (indent_stack_.size() > 1) {
        indent_stack_.pop_back();
        emit("DEDENT", std::monostate{}, loc());
    }
    emit("EOF", std::monostate{}, loc());
    return tokens_;
}

SourceLocation LexerState::loc() const {
    return SourceLocation{origin_, line_, column_};
}

char LexerState::peek(int offset) const {
    const std::size_t pos = pos_ + static_cast<std::size_t>(offset);
    if (pos >= source_.size()) {
        return '\0';
    }
    return source_[pos];
}

char LexerState::advance() {
    const char ch = source_[pos_++];
    if (ch == '\n') {
        ++line_;
        column_ = 1;
    } else {
        ++column_;
    }
    return ch;
}

void LexerState::emit(const std::string& kind, TokenValue value, const SourceLocation& location) {
    tokens_.push_back(Token{kind, std::move(value), location});
}

int LexerState::leading_indent_column() {
    int column = 0;
    while (pos_ < source_.size()) {
        const char ch = peek();
        if (ch == '\t') {
            column = ((column / kTabWidth) + 1) * kTabWidth;
            advance();
        } else if (ch == ' ') {
            ++column;
            advance();
        } else {
            break;
        }
    }
    return column;
}

void LexerState::handle_line_start() {
    const int column = leading_indent_column();

    std::size_t scan = pos_;
    bool has_content = false;
    while (scan < source_.size()) {
        const char current = source_[scan];
        if (current == '\n' || current == '#') {
            break;
        }
        if (!std::isspace(static_cast<unsigned char>(current))) {
            has_content = true;
            break;
        }
        ++scan;
    }

    if (!has_content) {
        while (pos_ < source_.size() && peek() != '\n') {
            advance();
        }
        at_line_start_ = true;
        return;
    }

    const int current = indent_stack_.back();
    if (column > current) {
        indent_stack_.push_back(column);
        emit("INDENT", std::monostate{}, loc());
    } else if (column < current) {
        while (column < indent_stack_.back()) {
            indent_stack_.pop_back();
            emit("DEDENT", std::monostate{}, loc());
        }
        if (column != indent_stack_.back()) {
            throw LexError(
                "Inconsistent indentation: column " + std::to_string(column) +
                    " does not match any outer level",
                loc());
        }
    }

    at_line_start_ = false;
}

}  // namespace vf
