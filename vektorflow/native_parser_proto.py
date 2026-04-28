"""Tiny native parser/codegen prototype for the first hello-native slice.

This module is intentionally narrow: it embeds a compiled C++ tool that parses
the exact grammar shape used by ``examples/native_core/hello_native.vkf`` and
emits standalone C++ for that slice.

The goal is not to pretend we have a full native parser already. The goal is to
replace one real frontend step with a genuinely native-backed parser/codegen
path we can grow from.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import subprocess
import tempfile

from .cpp_backend import CppEmitError, compile_cpp_source


def _native_parser_proto_cpp_source() -> str:
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
    std::string text;
};

struct Program {
    std::string function_name;
    std::string param_name;
    double multiplier = 0.0;
    double call_arg = 0.0;
};

static std::string trim(const std::string& s) {
    std::size_t start = 0;
    while (start < s.size() && std::isspace(static_cast<unsigned char>(s[start]))) {
        start += 1;
    }
    std::size_t end = s.size();
    while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) {
        end -= 1;
    }
    return s.substr(start, end - start);
}

static std::string normalize_newlines(const std::string& source) {
    std::string out;
    out.reserve(source.size());
    for (std::size_t i = 0; i < source.size(); ++i) {
        char ch = source[i];
        if (ch == '\r') {
            if (i + 1 < source.size() && source[i + 1] == '\n') {
                continue;
            }
            out.push_back('\n');
            continue;
        }
        out.push_back(ch);
    }
    return out;
}

static std::vector<std::string> logical_lines(const std::string& source) {
    std::vector<std::string> lines;
    std::istringstream in(source);
    std::string line;
    while (std::getline(in, line)) {
        std::string stripped = trim(line);
        if (stripped.empty()) {
            continue;
        }
        if (!stripped.empty() && stripped[0] == '#') {
            continue;
        }
        lines.push_back(line);
    }
    return lines;
}

static bool is_ident_start(char ch) {
    return std::isalpha(static_cast<unsigned char>(ch)) || ch == '_';
}

static bool is_ident_continue(char ch) {
    return std::isalnum(static_cast<unsigned char>(ch)) || ch == '_';
}

static std::vector<Token> lex_line(const std::string& line) {
    std::vector<Token> out;
    std::size_t pos = 0;
    while (pos < line.size()) {
        char ch = line[pos];
        if (std::isspace(static_cast<unsigned char>(ch))) {
            pos += 1;
            continue;
        }
        if (std::isdigit(static_cast<unsigned char>(ch))) {
            std::size_t start = pos;
            while (pos < line.size() && std::isdigit(static_cast<unsigned char>(line[pos]))) {
                pos += 1;
            }
            if (pos < line.size() && line[pos] == '.') {
                pos += 1;
                while (pos < line.size() && std::isdigit(static_cast<unsigned char>(line[pos]))) {
                    pos += 1;
                }
            }
            if (pos < line.size() && (line[pos] == 'e' || line[pos] == 'E')) {
                std::size_t exp = pos + 1;
                if (exp < line.size() && (line[exp] == '+' || line[exp] == '-')) {
                    exp += 1;
                }
                if (exp < line.size() && std::isdigit(static_cast<unsigned char>(line[exp]))) {
                    pos = exp + 1;
                    while (pos < line.size() && std::isdigit(static_cast<unsigned char>(line[pos]))) {
                        pos += 1;
                    }
                }
            }
            out.push_back({"NUMBER", line.substr(start, pos - start)});
            continue;
        }
        if (is_ident_start(ch)) {
            std::size_t start = pos;
            pos += 1;
            while (pos < line.size() && is_ident_continue(line[pos])) {
                pos += 1;
            }
            out.push_back({"IDENT", line.substr(start, pos - start)});
            continue;
        }
        if (ch == ':' && pos + 1 < line.size() && line[pos + 1] == ':') {
            out.push_back({"EMIT", "::"});
            pos += 2;
            continue;
        }
        if (ch == '-' && pos + 1 < line.size() && line[pos + 1] == '>') {
            out.push_back({"ARROW", "->"});
            pos += 2;
            continue;
        }
        switch (ch) {
        case '(':
            out.push_back({"LPAREN", "("});
            break;
        case ')':
            out.push_back({"RPAREN", ")"});
            break;
        case ':':
            out.push_back({"COLON", ":"});
            break;
        case '*':
            out.push_back({"STAR", "*"});
            break;
        default:
            throw std::runtime_error(std::string("Unsupported character in native parser prototype: ") + ch);
        }
        pos += 1;
    }
    return out;
}

class Parser {
public:
    explicit Parser(std::string source)
        : lines_(logical_lines(normalize_newlines(source))) {}

    Program parse() {
        if (lines_.size() != 3) {
            throw std::runtime_error("native parser prototype expects exactly three logical lines");
        }

        auto header = lex_line(lines_[0]);
        auto body = lex_line(lines_[1]);
        auto emit = lex_line(lines_[2]);

        Program program;
        parse_header(header, program);
        parse_body(body, program);
        parse_emit(emit, program);
        return program;
    }

private:
    std::vector<std::string> lines_;

    static void expect_kind(const std::vector<Token>& tokens, std::size_t index, const char* kind) {
        if (index >= tokens.size() || tokens[index].kind != kind) {
            throw std::runtime_error(std::string("native parser prototype expected token kind ") + kind);
        }
    }

    static double parse_number(const std::string& text) {
        return std::stod(text);
    }

    static void parse_header(const std::vector<Token>& tokens, Program& program) {
        if (tokens.size() != 9) {
            throw std::runtime_error("native parser prototype expected hello-native function header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "RPAREN");
        expect_kind(tokens, 6, "ARROW");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COLON");
        if (tokens[4].text != "num" || tokens[7].text != "num") {
            throw std::runtime_error("native parser prototype only supports num -> num hello-native signatures");
        }
        program.function_name = tokens[0].text;
        program.param_name = tokens[2].text;
    }

    static void parse_body(const std::vector<Token>& tokens, Program& program) {
        if (tokens.size() != 3) {
            throw std::runtime_error("native parser prototype expected body shape 'x * 2'");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "STAR");
        expect_kind(tokens, 2, "NUMBER");
        if (tokens[0].text != program.param_name) {
            throw std::runtime_error("native parser prototype body must multiply the declared parameter");
        }
        program.multiplier = parse_number(tokens[2].text);
    }

    static void parse_emit(const std::vector<Token>& tokens, Program& program) {
        if (tokens.size() != 5) {
            throw std::runtime_error("native parser prototype expected emit-call shape ':: twice(21)'");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "NUMBER");
        expect_kind(tokens, 4, "RPAREN");
        if (tokens[1].text != program.function_name) {
            throw std::runtime_error("native parser prototype emit call must target the declared function");
        }
        program.call_arg = parse_number(tokens[3].text);
    }
};

static std::string format_number_literal(double value) {
    std::ostringstream out;
    out << std::setprecision(15) << value;
    return out.str();
}

static std::string emit_cpp(const Program& program) {
    std::ostringstream out;
    out
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "double " << program.function_name << "(double " << program.param_name << ") {\n"
        << "    return " << program.param_name << " * " << format_number_literal(program.multiplier) << ";\n"
        << "}\n\n"
        << "int main() {\n"
        << "    std::cout << vf_format_num(" << program.function_name << "("
        << format_number_literal(program.call_arg) << ")) << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

int main(int argc, char** argv) {
    try {
        if (argc < 2) {
            throw std::runtime_error("usage: vf_native_parser_proto <source-or->");
        }
        std::string source;
        if (std::string(argv[1]) == "-") {
            std::ostringstream in;
            in << std::cin.rdbuf();
            source = in.str();
        } else {
            std::ifstream file(argv[1], std::ios::binary);
            if (!file) {
                throw std::runtime_error("cannot open source file");
            }
            std::ostringstream in;
            in << file.rdbuf();
            source = in.str();
        }
        Parser parser(source);
        Program program = parser.parse();
        std::cout << emit_cpp(program);
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << exc.what() << "\n";
        return 1;
    }
}
"""


def _native_parser_proto_cache_dir() -> Path:
    return Path(tempfile.gettempdir()) / "vektorflow-native-parser-proto"


def build_native_parser_proto() -> Path:
    source = _native_parser_proto_cpp_source()
    digest = hashlib.sha1(source.encode("utf-8")).hexdigest()[:12]
    out_dir = _native_parser_proto_cache_dir()
    exe_name = f"vf_native_parser_proto_{digest}"
    compiler_output = out_dir / f"{exe_name}.cpp"
    exe_path = out_dir / exe_name
    if compiler_output.is_file() and exe_path.is_file():
        return exe_path
    return compile_cpp_source(source, out_dir, exe_name=exe_name)


def emit_cpp_for_hello_native_file(path: Path) -> str:
    exe = build_native_parser_proto()
    proc = subprocess.run([str(exe), str(path)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise CppEmitError(proc.stderr.strip() or proc.stdout.strip() or "native parser prototype failed")
    return proc.stdout


def emit_cpp_for_hello_native_source(source: str) -> str:
    exe = build_native_parser_proto()
    proc = subprocess.run([str(exe), "-"], input=source, capture_output=True, text=True)
    if proc.returncode != 0:
        raise CppEmitError(proc.stderr.strip() or proc.stdout.strip() or "native parser prototype failed")
    return proc.stdout
