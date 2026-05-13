#pragma once

#include "vf/lexer.hpp"

#include <string>
#include <unordered_map>
#include <vector>

namespace vf {

inline constexpr int kTabWidth = 8;

inline const std::unordered_map<std::string, std::string> kKeywords = {
    {"true", "TRUE"},
    {"false", "FALSE"},
    {"null", "NULL"},
};

inline const std::unordered_map<char, std::string> kSingleCharTokens = {
    {'+', "PLUS"},
    {'*', "STAR"},
    {'^', "CARET"},
    {'%', "PERCENT"},
    {'&', "AMPERSAND"},
    {',', "COMMA"},
    {';', "SEMICOLON"},
    {'?', "QUESTION"},
    {'$', "DOLLAR"},
    {'~', "NOT"},
};

class LexerState {
public:
    LexerState(std::string source, std::string origin);

    std::vector<Token> tokenize();

    [[nodiscard]] SourceLocation loc() const;
    [[nodiscard]] char peek(int offset = 0) const;
    char advance();
    void emit(const std::string& kind, TokenValue value, const SourceLocation& location);

    int leading_indent_column();
    void handle_line_start();
    void lex_token();
    void lex_at_family(const SourceLocation& token_loc);
    void lex_dot(const SourceLocation& token_loc);
    void lex_arrow(const SourceLocation& token_loc);
    void lex_number(const SourceLocation& token_loc);
    void lex_string(const SourceLocation& token_loc);
    void lex_raw_string(const SourceLocation& token_loc);
    void lex_ident(const SourceLocation& token_loc, bool field_name);
    [[nodiscard]] std::string decode_escape(char esc, const SourceLocation& token_loc) const;

private:
    std::string source_;
    std::string origin_;
    std::size_t pos_ = 0;
    int line_ = 1;
    int column_ = 1;
    std::vector<Token> tokens_;
    std::vector<int> indent_stack_ = {0};
    int bracket_depth_ = 0;
    bool at_line_start_ = true;
    bool field_name_next_ = false;
};

}  // namespace vf
