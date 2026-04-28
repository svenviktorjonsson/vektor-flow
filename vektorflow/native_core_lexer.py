"""Native lexer prototype for the current native-core subset.

This is the first real replacement step after the seam-hardening phase:
the lexer logic below runs in a compiled C++ executable and emits the same
versioned token-stream JSON contract as the Python lexer for the constrained
``examples/native_core`` slice.

It is intentionally narrow. The goal is to replace something real without
pretending we already have a full native frontend.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import subprocess
import tempfile

from .cpp_backend import CppEmitError, compile_cpp_source


def _native_core_lexer_cpp_source() -> str:
    return r"""
#include <cctype>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

struct Token {
    std::string kind;
    enum class ValueKind { Null, String, Number, Dot } value_kind = ValueKind::Null;
    std::string string_value;
    double number_value = 0.0;
    bool dot_left_tight = true;
    bool dot_right_tight = true;
    int line = 1;
    int column = 1;
    std::string file;
};

static std::string json_escape(const std::string& s) {
    std::ostringstream out;
    for (unsigned char ch : s) {
        switch (ch) {
        case '\\\\': out << "\\\\\\\\"; break;
        case '"': out << "\\\\\""; break;
        case '\n': out << "\\\\n"; break;
        case '\r': out << "\\\\r"; break;
        case '\t': out << "\\\\t"; break;
        default:
            if (ch < 0x20) {
                out << "\\\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(ch)
                    << std::dec << std::setfill(' ');
            } else {
                out << static_cast<char>(ch);
            }
        }
    }
    return out.str();
}

static std::string json_number(double value) {
    if (std::floor(value) == value) {
        std::ostringstream out;
        out << static_cast<long long>(value);
        return out.str();
    }
    std::ostringstream out;
    out << std::setprecision(15) << value;
    return out.str();
}

class Lexer {
public:
    Lexer(std::string source, std::string filename)
        : src_(std::move(source)), filename_(std::move(filename)) {}

    std::vector<Token> tokenize() {
        while (pos_ < src_.size()) {
            if (at_line_start_ && bracket_depth_ == 0) {
                handle_line_start();
                if (pos_ >= src_.size()) {
                    break;
                }
            }

            char ch = peek();
            if (ch == '\n') {
                advance();
                if (bracket_depth_ == 0) {
                    if (tokens_.empty() || tokens_.back().kind != "NEWLINE") {
                        emit("NEWLINE");
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
                while (pos_ < src_.size() && peek() != '\n') {
                    advance();
                }
                continue;
            }

            lex_token();
        }

        if (!tokens_.empty()) {
            const std::string& last = tokens_.back().kind;
            if (last != "NEWLINE" && last != "DEDENT" && last != "INDENT") {
                emit("NEWLINE");
            }
        }
        while (indent_stack_.size() > 1) {
            indent_stack_.pop_back();
            emit("DEDENT");
        }
        emit("EOF");
        return tokens_;
    }

private:
    std::string src_;
    std::string filename_;
    std::size_t pos_ = 0;
    int line_ = 1;
    int col_ = 1;
    std::vector<Token> tokens_;
    std::vector<int> indent_stack_ = {0};
    int bracket_depth_ = 0;
    bool at_line_start_ = true;

    char peek(std::size_t offset = 0) const {
        std::size_t p = pos_ + offset;
        return p < src_.size() ? src_[p] : '\0';
    }

    char advance() {
        char ch = src_[pos_++];
        if (ch == '\n') {
            line_ += 1;
            col_ = 1;
        } else {
            col_ += 1;
        }
        return ch;
    }

    void emit(const std::string& kind) {
        Token tok;
        tok.kind = kind;
        tok.line = line_;
        tok.column = col_;
        tok.file = filename_;
        tokens_.push_back(tok);
    }

    void emit_at(const std::string& kind, int line, int column) {
        Token tok;
        tok.kind = kind;
        tok.line = line;
        tok.column = column;
        tok.file = filename_;
        tokens_.push_back(tok);
    }

    void emit_string(const std::string& kind, const std::string& value, int line, int column) {
        Token tok;
        tok.kind = kind;
        tok.value_kind = Token::ValueKind::String;
        tok.string_value = value;
        tok.line = line;
        tok.column = column;
        tok.file = filename_;
        tokens_.push_back(tok);
    }

    void emit_number(double value, int line, int column) {
        Token tok;
        tok.kind = "NUMBER";
        tok.value_kind = Token::ValueKind::Number;
        tok.number_value = value;
        tok.line = line;
        tok.column = column;
        tok.file = filename_;
        tokens_.push_back(tok);
    }

    void emit_dot(bool left_tight, bool right_tight, int line, int column) {
        Token tok;
        tok.kind = "DOT";
        tok.value_kind = Token::ValueKind::Dot;
        tok.dot_left_tight = left_tight;
        tok.dot_right_tight = right_tight;
        tok.line = line;
        tok.column = column;
        tok.file = filename_;
        tokens_.push_back(tok);
    }

    int leading_indent_column() {
        int col = 0;
        while (pos_ < src_.size()) {
            char ch = peek();
            if (ch == '\t') {
                col = ((col / 8) + 1) * 8;
                advance();
            } else if (ch == ' ') {
                col += 1;
                advance();
            } else {
                break;
            }
        }
        return col;
    }

    void handle_line_start() {
        int col = leading_indent_column();
        std::size_t scan = pos_;
        bool has_content = false;
        while (scan < src_.size()) {
            char c = src_[scan];
            if (c == '\n' || c == '#') {
                break;
            }
            if (!std::isspace(static_cast<unsigned char>(c))) {
                has_content = true;
                break;
            }
            scan += 1;
        }
        if (!has_content) {
            while (pos_ < src_.size() && peek() != '\n') {
                advance();
            }
            at_line_start_ = true;
            return;
        }

        int current = indent_stack_.back();
        if (col > current) {
            indent_stack_.push_back(col);
            emit("INDENT");
        } else if (col < current) {
            while (col < indent_stack_.back()) {
                indent_stack_.pop_back();
                emit("DEDENT");
            }
            if (col != indent_stack_.back()) {
                throw std::runtime_error("Inconsistent indentation");
            }
        }
        at_line_start_ = false;
    }

    void lex_token() {
        char ch = peek();
        int tok_line = line_;
        int tok_col = col_;

        if (std::isdigit(static_cast<unsigned char>(ch))) {
            lex_number(tok_line, tok_col);
            return;
        }
        if (std::isalpha(static_cast<unsigned char>(ch)) || ch == '_') {
            lex_ident(tok_line, tok_col);
            return;
        }
        if (ch == '"') {
            lex_string(tok_line, tok_col);
            return;
        }

        switch (ch) {
        case '(':
            advance(); emit_at("LPAREN", tok_line, tok_col); bracket_depth_ += 1; return;
        case ')':
            advance(); emit_at("RPAREN", tok_line, tok_col); bracket_depth_ -= 1; return;
        case '[':
            advance(); emit_at("LBRACKET", tok_line, tok_col); bracket_depth_ += 1; return;
        case ']':
            advance(); emit_at("RBRACKET", tok_line, tok_col); bracket_depth_ -= 1; return;
        case '{':
            advance(); emit_at("LBRACE", tok_line, tok_col); bracket_depth_ += 1; return;
        case '}':
            advance(); emit_at("RBRACE", tok_line, tok_col); bracket_depth_ -= 1; return;
        case '+':
            advance(); emit_at("PLUS", tok_line, tok_col); return;
        case '*':
            advance(); emit_at("STAR", tok_line, tok_col); return;
        case '/':
            advance(); emit_at("SLASH", tok_line, tok_col); return;
        case '&':
            advance(); emit_at("AMPERSAND", tok_line, tok_col); return;
        case ',':
            advance(); emit_at("COMMA", tok_line, tok_col); return;
        case '?':
            advance(); emit_at("QUESTION", tok_line, tok_col); return;
        case ':':
            advance();
            if (peek() == ':') {
                advance();
                emit_at("EMIT", tok_line, tok_col);
            } else {
                emit_at("COLON", tok_line, tok_col);
            }
            return;
        case '@':
            advance();
            if (peek() == ':') {
                advance();
                emit_at("AT_COLON", tok_line, tok_col);
                return;
            }
            throw std::runtime_error("Unsupported '@' form in native-core lexer subset");
        case '<':
            advance();
            emit_at("LT", tok_line, tok_col);
            return;
        case '>':
            advance();
            emit_at("GT", tok_line, tok_col);
            return;
        case '=':
            advance();
            if (peek() == '>') {
                advance();
                emit_at("FAT_ARROW", tok_line, tok_col);
                return;
            }
            emit_at("EQ", tok_line, tok_col);
            return;
        case '-':
            advance();
            if (peek() == '>') {
                advance();
                emit_at("ARROW", tok_line, tok_col);
                return;
            }
            throw std::runtime_error("Unsupported '-' in native-core lexer subset");
        case '.': {
            bool left_tight = pos_ > 0 && src_[pos_ - 1] != ' ' && src_[pos_ - 1] != '\t' && src_[pos_ - 1] != '\r';
            advance();
            bool right_tight = peek() != '\0' && !std::isspace(static_cast<unsigned char>(peek()));
            emit_dot(left_tight, right_tight, tok_line, tok_col);
            return;
        }
        default:
            throw std::runtime_error(std::string("Unsupported character in native-core lexer subset: ") + ch);
        }
    }

    void lex_ident(int tok_line, int tok_col) {
        std::string value;
        while (pos_ < src_.size()) {
            char ch = peek();
            if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_') {
                value.push_back(advance());
            } else {
                break;
            }
        }
        if (value == "true") {
            emit_at("TRUE", tok_line, tok_col);
            return;
        }
        if (value == "false") {
            emit_at("FALSE", tok_line, tok_col);
            return;
        }
        if (value == "null") {
            emit_at("NULL", tok_line, tok_col);
            return;
        }
        emit_string("IDENT", value, tok_line, tok_col);
    }

    void lex_string(int tok_line, int tok_col) {
        advance();  // opening quote
        std::string value;
        while (pos_ < src_.size()) {
            char ch = advance();
            if (ch == '"') {
                emit_string("STRING", value, tok_line, tok_col);
                return;
            }
            if (ch == '\\') {
                if (pos_ >= src_.size()) {
                    throw std::runtime_error("Unterminated string escape in native-core lexer subset");
                }
                char esc = advance();
                switch (esc) {
                case 'n': value.push_back('\n'); break;
                case 'r': value.push_back('\r'); break;
                case 't': value.push_back('\t'); break;
                case '\\': value.push_back('\\'); break;
                case '"': value.push_back('"'); break;
                case '$': value.push_back('$'); break;
                default:
                    throw std::runtime_error("Unsupported string escape in native-core lexer subset");
                }
                continue;
            }
            if (ch == '\n') {
                throw std::runtime_error("Unterminated string literal in native-core lexer subset");
            }
            value.push_back(ch);
        }
        throw std::runtime_error("Unterminated string literal in native-core lexer subset");
    }

    void lex_number(int tok_line, int tok_col) {
        std::size_t start = pos_;
        while (std::isdigit(static_cast<unsigned char>(peek()))) {
            advance();
        }
        if (peek() == '.' && std::isdigit(static_cast<unsigned char>(peek(1)))) {
            advance();
            while (std::isdigit(static_cast<unsigned char>(peek()))) {
                advance();
            }
        }
        if ((peek() == 'e' || peek() == 'E')) {
            std::size_t exp_pos = pos_;
            std::size_t cursor = pos_ + 1;
            if (cursor < src_.size() && (src_[cursor] == '+' || src_[cursor] == '-')) {
                cursor += 1;
            }
            if (cursor < src_.size() && std::isdigit(static_cast<unsigned char>(src_[cursor]))) {
                advance();
                if (peek() == '+' || peek() == '-') {
                    advance();
                }
                while (std::isdigit(static_cast<unsigned char>(peek()))) {
                    advance();
                }
            } else {
                pos_ = exp_pos;
                col_ -= static_cast<int>(pos_ - exp_pos);
            }
        }
        std::string text = src_.substr(start, pos_ - start);
        emit_number(std::stod(text), tok_line, tok_col);
    }
};

static std::string tokens_to_json(const std::vector<Token>& tokens) {
    std::ostringstream out;
    out << "{\n  \"schema\": \"vektorflow.token_stream\",\n  \"version\": 1,\n  \"tokens\": [\n";
    for (std::size_t i = 0; i < tokens.size(); ++i) {
        const Token& tok = tokens[i];
        out << "    {\"kind\": \"" << tok.kind << "\", \"value\": ";
        switch (tok.value_kind) {
        case Token::ValueKind::Null:
            out << "null";
            break;
        case Token::ValueKind::String:
            out << "\"" << json_escape(tok.string_value) << "\"";
            break;
        case Token::ValueKind::Number:
            out << json_number(tok.number_value);
            break;
        case Token::ValueKind::Dot:
            out << "[" << (tok.dot_left_tight ? "true" : "false") << ", "
                << (tok.dot_right_tight ? "true" : "false") << "]";
            break;
        }
        out << ", \"location\": {\"file\": \"" << json_escape(tok.file)
            << "\", \"line\": " << tok.line
            << ", \"column\": " << tok.column << "}}";
        if (i + 1 < tokens.size()) {
            out << ",";
        }
        out << "\n";
    }
    out << "  ]\n}\n";
    return out.str();
}

int main(int argc, char** argv) {
    try {
        if (argc < 2) {
            throw std::runtime_error("usage: vf_native_core_lexer <source-or-> [filename-label]");
        }
        std::string source;
        std::string filename;
        if (std::string(argv[1]) == "-") {
            std::ostringstream in;
            in << std::cin.rdbuf();
            source = in.str();
            filename = argc >= 3 ? argv[2] : "<stdin>";
        } else {
            std::ifstream file(argv[1], std::ios::binary);
            if (!file) {
                throw std::runtime_error("cannot open source file");
            }
            std::ostringstream in;
            in << file.rdbuf();
            source = in.str();
            filename = argc >= 3 ? argv[2] : argv[1];
        }
        std::string normalized;
        normalized.reserve(source.size());
        for (std::size_t i = 0; i < source.size(); ++i) {
            char ch = source[i];
            if (ch == '\r') {
                if (i + 1 < source.size() && source[i + 1] == '\n') {
                    continue;
                }
                normalized.push_back('\n');
                continue;
            }
            normalized.push_back(ch);
        }
        source = std::move(normalized);
        Lexer lexer(source, filename);
        std::cout << tokens_to_json(lexer.tokenize());
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << exc.what() << "\n";
        return 1;
    }
}
"""


def _native_core_lexer_cache_dir() -> Path:
    return Path(tempfile.gettempdir()) / "vektorflow-native-core-lexer"


def build_native_core_lexer() -> Path:
    source = _native_core_lexer_cpp_source()
    digest = hashlib.sha1(source.encode("utf-8")).hexdigest()[:12]
    out_dir = _native_core_lexer_cache_dir()
    exe_name = f"vf_native_core_lexer_{digest}"
    compiler_output = out_dir / f"{exe_name}.cpp"
    exe_path = out_dir / exe_name
    if compiler_output.is_file() and exe_path.is_file():
        return exe_path
    return compile_cpp_source(source, out_dir, exe_name=exe_name)


def lex_native_core_file_to_json(path: Path, *, filename_label: str | None = None) -> str:
    exe = build_native_core_lexer()
    cmd = [str(exe), str(path)]
    if filename_label is not None:
        cmd.append(filename_label)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise CppEmitError(proc.stderr.strip() or proc.stdout.strip() or "native core lexer failed")
    return proc.stdout


def lex_native_core_stdin_to_json(source: str, *, filename_label: str = "<stdin>") -> str:
    exe = build_native_core_lexer()
    proc = subprocess.run(
        [str(exe), "-", filename_label],
        input=source,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise CppEmitError(proc.stderr.strip() or proc.stdout.strip() or "native core lexer failed")
    return proc.stdout
