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
import json
from pathlib import Path
import subprocess

from .cpp_backend import CppEmitError, cpp_compile_flags, discover_cpp_compiler


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

static std::string decode_string_escapes(const std::string& raw) {
    std::string value;
    for (std::size_t i = 0; i < raw.size(); ++i) {
        char ch = raw[i];
        if (ch != '\\') {
            value.push_back(ch);
            continue;
        }
        if (i + 1 >= raw.size()) {
            throw std::runtime_error("Unterminated string escape in native-core lexer subset");
        }
        char esc = raw[++i];
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
    }
    return value;
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
                    if (line_has_code_token_ && (tokens_.empty() || tokens_.back().kind != "NEWLINE")) {
                        emit("NEWLINE");
                    }
                    at_line_start_ = true;
                    line_has_code_token_ = false;
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
    bool line_has_code_token_ = false;

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
            unsigned char uch = static_cast<unsigned char>(ch);
            if ((uch & 0xC0) != 0x80) {
                col_ += 1;
            }
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
        line_has_code_token_ = true;
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
        line_has_code_token_ = true;
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
        line_has_code_token_ = true;
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
        line_has_code_token_ = true;
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
        line_has_code_token_ = false;
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
        case '^':
            advance(); emit_at("CARET", tok_line, tok_col); return;
        case '/':
            advance();
            if (peek() == '/') { advance(); emit_at("FLOOR_DIV", tok_line, tok_col); return; }
            emit_at("SLASH", tok_line, tok_col); return;
        case '&':
            advance(); emit_at("AMPERSAND", tok_line, tok_col); return;
        case ',':
            advance(); emit_at("COMMA", tok_line, tok_col); return;
        case '%':
            advance(); emit_at("PERCENT", tok_line, tok_col); return;
        case '?':
            advance(); emit_at("QUESTION", tok_line, tok_col); return;
        case '$':
            advance(); emit_at("DOLLAR", tok_line, tok_col); return;
        case ';':
            advance(); emit_at("SEMICOLON", tok_line, tok_col); return;
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
            if (peek() == '|') {
                advance();
                emit_at("AT_BAR", tok_line, tok_col);
                return;
            }
            throw std::runtime_error("Unsupported '@' form in native-core lexer subset");
        case '<':
            advance();
            if (peek() == '=') {
                advance();
                emit_at("LE", tok_line, tok_col);
                return;
            }
            emit_at("LT", tok_line, tok_col);
            return;
        case '>':
            advance();
            if (peek() == '>') {
                advance();
                emit_at("PIPE", tok_line, tok_col);
                return;
            }
            if (peek() == '=') {
                advance();
                emit_at("GE", tok_line, tok_col);
                return;
            }
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
        case '!':
            advance();
            if (peek() == '=') {
                advance();
                emit_at("NEQ", tok_line, tok_col);
                return;
            }
            throw std::runtime_error(std::string("Unsupported character in native-core lexer subset: ") + ch);
        case '-':
            advance();
            if (peek() == '>') {
                advance();
                emit_at("ARROW", tok_line, tok_col);
                return;
            }
            emit_at("MINUS", tok_line, tok_col);
            return;
        case '.': {
            bool left_tight = pos_ > 0 && src_[pos_ - 1] != ' ' && src_[pos_ - 1] != '\t' && src_[pos_ - 1] != '\r';
            advance();
            if (peek() == '.') {
                advance();
                emit_at("RANGE", tok_line, tok_col);
                return;
            }
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
        std::string raw;
        while (pos_ < src_.size()) {
            char ch = advance();
            if (ch == '"') {
                emit_string("STRING", decode_string_escapes(raw), tok_line, tok_col);
                return;
            }
            if (ch == '\n') {
                throw std::runtime_error("Unterminated string literal in native-core lexer subset");
            }
            raw.push_back(ch);
            if (ch == '\\') {
                if (pos_ >= src_.size()) {
                    throw std::runtime_error("Unterminated string escape in native-core lexer subset");
                }
                raw.push_back(advance());
            }
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
    return Path("C:/vf_ncl")


def build_native_core_lexer() -> Path:
    source = _native_core_lexer_cpp_source()
    digest = hashlib.sha1(source.encode("utf-8")).hexdigest()[:12]
    out_dir = _native_core_lexer_cache_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    exe_name = f"vf_native_core_lexer_{digest}"
    compiler_output = out_dir / f"{exe_name}.cpp"
    exe_path = out_dir / exe_name
    if compiler_output.is_file() and exe_path.is_file():
        return exe_path
    compiler = discover_cpp_compiler()
    if compiler is None:
        raise CppEmitError("no C++ compiler found on PATH")
    with compiler_output.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(source)
    cmd = [compiler.path, *cpp_compile_flags(compiler), str(compiler_output), "-o", str(exe_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise CppEmitError(proc.stderr.strip() or proc.stdout.strip() or "native core lexer compilation failed")
    return exe_path


def _decode_native_core_lexer_output(data: bytes) -> str:
    return data.decode("utf-8")


def _decode_python_style_string_escapes(raw: str) -> str:
    value_chars: list[str] = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch != "\\":
            value_chars.append(ch)
            i += 1
            continue
        if i + 1 >= len(raw):
            raise CppEmitError("unterminated string escape in native core lexer output repair")
        esc = raw[i + 1]
        if esc == "n":
            value_chars.append("\n")
        elif esc == "r":
            value_chars.append("\r")
        elif esc == "t":
            value_chars.append("\t")
        elif esc == "\\":
            value_chars.append("\\")
        elif esc == '"':
            value_chars.append('"')
        elif esc == "$":
            value_chars.append("$")
        else:
            raise CppEmitError(f"unsupported string escape in native core lexer output repair: \\{esc}")
        i += 2
    return "".join(value_chars)


def _extract_string_literal_raw(source: str, line: int, column: int) -> str:
    source_lines = source.splitlines()
    if line < 1 or line > len(source_lines):
        raise CppEmitError("string token location out of bounds in native core lexer output repair")
    text = source_lines[line - 1]
    idx = column - 1
    if idx < 0 or idx >= len(text) or text[idx] != '"':
        raise CppEmitError("string token does not point at opening quote in native core lexer output repair")
    idx += 1
    raw_chars: list[str] = []
    while idx < len(text):
        ch = text[idx]
        if ch == '"':
            return "".join(raw_chars)
        raw_chars.append(ch)
        idx += 1
        if ch == "\\":
            if idx >= len(text):
                raise CppEmitError("unterminated string escape in native core lexer output repair")
            raw_chars.append(text[idx])
            idx += 1
    raise CppEmitError("unterminated string literal in native core lexer output repair")


def _repair_string_tokens_from_source(json_text: str, source: str) -> str:
    payload = json.loads(json_text)
    for token in payload.get("tokens", []):
        if token.get("kind") != "STRING":
            continue
        location = token.get("location", {})
        raw = _extract_string_literal_raw(source, location["line"], location["column"])
        token["value"] = _decode_python_style_string_escapes(raw)
    return json.dumps(payload, ensure_ascii=False, indent=2)


def lex_native_core_file_to_json(path: Path, *, filename_label: str | None = None) -> str:
    exe = build_native_core_lexer()
    cmd = [str(exe), str(path)]
    if filename_label is not None:
        cmd.append(filename_label)
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise CppEmitError(
            _decode_native_core_lexer_output(proc.stderr).strip()
            or _decode_native_core_lexer_output(proc.stdout).strip()
            or "native core lexer failed"
        )
    source = path.read_text(encoding="utf-8")
    return _repair_string_tokens_from_source(_decode_native_core_lexer_output(proc.stdout), source)


def lex_native_core_stdin_to_json(source: str, *, filename_label: str = "<stdin>") -> str:
    exe = build_native_core_lexer()
    proc = subprocess.run(
        [str(exe), "-", filename_label],
        input=source.encode("utf-8"),
        capture_output=True,
    )
    if proc.returncode != 0:
        raise CppEmitError(
            _decode_native_core_lexer_output(proc.stderr).strip()
            or _decode_native_core_lexer_output(proc.stdout).strip()
            or "native core lexer failed"
        )
    return _repair_string_tokens_from_source(_decode_native_core_lexer_output(proc.stdout), source)
