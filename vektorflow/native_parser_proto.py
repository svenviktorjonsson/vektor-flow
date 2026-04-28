"""Tiny native parser/codegen prototype for the first native-core slices.

This module is intentionally narrow: it embeds a compiled C++ tool that parses
the exact grammar shapes used by ``examples/native_core/hello_native.vkf``,
``examples/native_core/vectors_native.vkf``, ``examples/native_core/numeric_native.vkf``,
and ``examples/native_core/named_record_native.vkf`` and emits standalone C++
for those slices.

The goal is not to pretend we have a full native parser already. The goal is to
replace one real frontend step with a genuinely native-backed parser/codegen
path we can grow from.
"""

from __future__ import annotations

import hashlib
import os
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

struct HelloProgram {
    std::string function_name;
    std::string param_name;
    double multiplier = 0.0;
    double call_arg = 0.0;
};

struct VectorBinding {
    std::string name;
    std::vector<double> values;
};

struct VectorProgram {
    VectorBinding left_binding;
    VectorBinding right_binding;
    std::string function_name;
    std::string left_param_name;
    std::string right_param_name;
    std::size_t extent = 0;
    double scale = 0.0;
    std::string emit_left_name;
    std::string emit_right_name;
};

struct NumericBinding {
    std::string name;
    std::vector<double> values;
};

struct NumericProgram {
    NumericBinding xs_binding;
    NumericBinding ys_binding;
};

struct NamedRecordProgram {
    std::string type_name;
    std::string first_field_name;
    std::string second_field_name;
    std::string move_function_name;
    std::string param_name;
    std::string delta_x_name;
    std::string delta_y_name;
    std::string base_name;
    double base_first_value = 0.0;
    double base_second_value = 0.0;
    std::string shifted_name;
    double shift_x_value = 0.0;
    double shift_y_value = 0.0;
};

static std::string emit_hello_cpp(const HelloProgram& program);
static std::string emit_vector_cpp(const VectorProgram& program);
static std::string emit_numeric_cpp(const NumericProgram& program);
static std::string emit_named_record_cpp(const NamedRecordProgram& program);

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
        case '[':
            out.push_back({"LBRACKET", "["});
            break;
        case ']':
            out.push_back({"RBRACKET", "]"});
            break;
        case ',':
            out.push_back({"COMMA", ","});
            break;
        case '+':
            out.push_back({"PLUS", "+"});
            break;
        case '.':
            out.push_back({"DOT", "."});
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

    std::string emit_cpp() {
        std::vector<std::vector<Token>> token_lines;
        token_lines.reserve(lines_.size());
        for (const auto& line : lines_) {
            token_lines.push_back(lex_line(line));
        }
        if (token_lines.size() == 3) {
            HelloProgram program;
            parse_hello_header(token_lines[0], program);
            parse_hello_body(token_lines[1], program);
            parse_hello_emit(token_lines[2], program);
            return emit_hello_cpp(program);
        }
        if (token_lines.size() == 5) {
            VectorProgram program;
            parse_vector_binding(token_lines[0], program.left_binding);
            parse_vector_binding(token_lines[1], program.right_binding);
            parse_vector_header(token_lines[2], program);
            parse_vector_body(token_lines[3], program);
            parse_vector_emit(token_lines[4], program);
            validate_vector_program(program);
            return emit_vector_cpp(program);
        }
        if (token_lines.size() == 7) {
            if (
                token_lines[0].size() >= 3 &&
                token_lines[0][0].kind == "IDENT" &&
                token_lines[0][1].kind == "COLON" &&
                token_lines[0][2].kind == "LBRACKET"
            ) {
                NumericProgram program;
                parse_numeric_binding(token_lines[0], program.xs_binding);
                parse_numeric_binding(token_lines[1], program.ys_binding);
                parse_numeric_emit_sin(token_lines[2]);
                parse_numeric_emit_pi(token_lines[3]);
                parse_numeric_emit_mean(token_lines[4], program);
                parse_numeric_emit_normalize(token_lines[5], program);
                parse_numeric_emit_correlation(token_lines[6], program);
                validate_numeric_program(program);
                return emit_numeric_cpp(program);
            }
            if (
                token_lines[0].size() >= 3 &&
                token_lines[0][0].kind == "IDENT" &&
                token_lines[0][1].kind == "COLON" &&
                token_lines[0][2].kind == "LPAREN"
            ) {
                NamedRecordProgram program;
                parse_named_record_typedef(token_lines[0], program);
                parse_named_record_header(token_lines[1], program);
                parse_named_record_body(token_lines[2], program);
                parse_named_record_base_binding(token_lines[3], program);
                parse_named_record_shifted_binding(token_lines[4], program);
                parse_named_record_emit_first_field(token_lines[5], program);
                parse_named_record_emit_record(token_lines[6], program);
                validate_named_record_program(program);
                return emit_named_record_cpp(program);
            }
        }
        throw std::runtime_error("native parser prototype expects hello-native, vectors-native, numeric-native, or named-record-native logical shape");
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

    static void parse_hello_header(const std::vector<Token>& tokens, HelloProgram& program) {
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

    static void parse_hello_body(const std::vector<Token>& tokens, HelloProgram& program) {
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

    static void parse_hello_emit(const std::vector<Token>& tokens, HelloProgram& program) {
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

    static std::vector<double> parse_number_list(const std::vector<Token>& tokens, std::size_t start, std::size_t end) {
        std::vector<double> out;
        std::size_t pos = start;
        while (pos < end) {
            expect_kind(tokens, pos, "NUMBER");
            out.push_back(parse_number(tokens[pos].text));
            pos += 1;
            if (pos == end) {
                break;
            }
            expect_kind(tokens, pos, "COMMA");
            pos += 1;
        }
        return out;
    }

    static void parse_vector_binding(const std::vector<Token>& tokens, VectorBinding& binding) {
        if (tokens.size() < 10) {
            throw std::runtime_error("native parser prototype expected fixed vector binding shape");
        }
        expect_kind(tokens, 0, "LBRACKET");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "NUMBER");
        expect_kind(tokens, 4, "RBRACKET");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COLON");
        expect_kind(tokens, 7, "LBRACKET");
        expect_kind(tokens, tokens.size() - 1, "RBRACKET");
        if (tokens[1].text != "num") {
            throw std::runtime_error("native parser prototype only supports [num:N] vector bindings");
        }
        binding.name = tokens[5].text;
        binding.values = parse_number_list(tokens, 8, tokens.size() - 1);
        std::size_t declared_extent = static_cast<std::size_t>(parse_number(tokens[3].text));
        if (declared_extent != binding.values.size()) {
            throw std::runtime_error("native parser prototype vector binding extent does not match literal length");
        }
    }

    static void parse_vector_header(const std::vector<Token>& tokens, VectorProgram& program) {
        if (tokens.size() != 25) {
            throw std::runtime_error("native parser prototype expected vectors-native function header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "LBRACKET");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COLON");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "RBRACKET");
        expect_kind(tokens, 9, "COMMA");
        expect_kind(tokens, 10, "IDENT");
        expect_kind(tokens, 11, "COLON");
        expect_kind(tokens, 12, "LBRACKET");
        expect_kind(tokens, 13, "IDENT");
        expect_kind(tokens, 14, "COLON");
        expect_kind(tokens, 15, "IDENT");
        expect_kind(tokens, 16, "RBRACKET");
        expect_kind(tokens, 17, "RPAREN");
        expect_kind(tokens, 18, "ARROW");
        expect_kind(tokens, 19, "LBRACKET");
        expect_kind(tokens, 20, "IDENT");
        expect_kind(tokens, 21, "COLON");
        expect_kind(tokens, 22, "IDENT");
        expect_kind(tokens, 23, "RBRACKET");
        expect_kind(tokens, 24, "COLON");
        if (tokens[5].text != "num" || tokens[13].text != "num" || tokens[20].text != "num") {
            throw std::runtime_error("native parser prototype only supports num vectors in vectors-native signatures");
        }
        if (tokens[7].text != "n" || tokens[15].text != "n" || tokens[22].text != "n") {
            throw std::runtime_error("native parser prototype only supports shared extent symbol n");
        }
        program.function_name = tokens[0].text;
    }

    static void parse_vector_body(const std::vector<Token>& tokens, VectorProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected vectors-native body shape '(x + y) * 0.5'");
        }
        expect_kind(tokens, 0, "LPAREN");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "PLUS");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "RPAREN");
        expect_kind(tokens, 5, "STAR");
        expect_kind(tokens, 6, "NUMBER");
        program.left_param_name = tokens[1].text;
        program.right_param_name = tokens[3].text;
        program.scale = parse_number(tokens[6].text);
    }

    static void parse_vector_emit(const std::vector<Token>& tokens, VectorProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected vectors-native emit-call shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COMMA");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "RPAREN");
        program.function_name = tokens[1].text;
        program.emit_left_name = tokens[3].text;
        program.emit_right_name = tokens[5].text;
    }

    static void validate_vector_program(VectorProgram& program) {
        if (program.left_binding.values.size() != program.right_binding.values.size()) {
            throw std::runtime_error("native parser prototype requires same-length fixed vectors");
        }
        program.extent = program.left_binding.values.size();
        if (program.left_param_name.empty() || program.right_param_name.empty()) {
            throw std::runtime_error("native parser prototype expected vectors-native parameter names");
        }
        if (program.emit_left_name != program.left_binding.name || program.emit_right_name != program.right_binding.name) {
            throw std::runtime_error("native parser prototype emit call must target the declared fixed vectors");
        }
    }

    static void parse_numeric_binding(const std::vector<Token>& tokens, NumericBinding& binding) {
        if (tokens.size() < 5) {
            throw std::runtime_error("native parser prototype expected numeric-native binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LBRACKET");
        expect_kind(tokens, tokens.size() - 1, "RBRACKET");
        binding.name = tokens[0].text;
        binding.values = parse_number_list(tokens, 3, tokens.size() - 1);
        if (binding.values.empty()) {
            throw std::runtime_error("native parser prototype numeric-native bindings must be non-empty");
        }
    }

    static void parse_numeric_emit_sin(const std::vector<Token>& tokens) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected ':: math.sin(0)' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "NUMBER");
        expect_kind(tokens, 6, "RPAREN");
        if (tokens[1].text != "math" || tokens[3].text != "sin" || parse_number(tokens[5].text) != 0.0) {
            throw std::runtime_error("native parser prototype only supports ':: math.sin(0)' in numeric-native");
        }
    }

    static void parse_numeric_emit_pi(const std::vector<Token>& tokens) {
        if (tokens.size() != 4) {
            throw std::runtime_error("native parser prototype expected ':: math.pi' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        if (tokens[1].text != "math" || tokens[3].text != "pi") {
            throw std::runtime_error("native parser prototype only supports ':: math.pi' in numeric-native");
        }
    }

    static void parse_numeric_emit_mean(const std::vector<Token>& tokens, const NumericProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected ':: stat.mean(xs)' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "RPAREN");
        if (tokens[1].text != "stat" || tokens[3].text != "mean" || tokens[5].text != program.xs_binding.name) {
            throw std::runtime_error("native parser prototype only supports ':: stat.mean(xs)' in numeric-native");
        }
    }

    static void parse_numeric_emit_normalize(const std::vector<Token>& tokens, const NumericProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected ':: stat.normalize(xs)' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "RPAREN");
        if (tokens[1].text != "stat" || tokens[3].text != "normalize" || tokens[5].text != program.xs_binding.name) {
            throw std::runtime_error("native parser prototype only supports ':: stat.normalize(xs)' in numeric-native");
        }
    }

    static void parse_numeric_emit_correlation(const std::vector<Token>& tokens, const NumericProgram& program) {
        if (tokens.size() != 9) {
            throw std::runtime_error("native parser prototype expected ':: stat.correlation(xs, ys)' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "RPAREN");
        if (
            tokens[1].text != "stat" ||
            tokens[3].text != "correlation" ||
            tokens[5].text != program.xs_binding.name ||
            tokens[7].text != program.ys_binding.name
        ) {
            throw std::runtime_error("native parser prototype only supports ':: stat.correlation(xs, ys)' in numeric-native");
        }
    }

    static void validate_numeric_program(const NumericProgram& program) {
        if (program.xs_binding.values.size() != program.ys_binding.values.size()) {
            throw std::runtime_error("native parser prototype numeric-native bindings must have matching extents");
        }
    }

    static void parse_named_record_typedef(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected named-record typedef shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COLON");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "RPAREN");
        if (tokens[5].text != "num" || tokens[9].text != "num") {
            throw std::runtime_error("native parser prototype only supports named Point:num,num records");
        }
        program.type_name = tokens[0].text;
        program.first_field_name = tokens[3].text;
        program.second_field_name = tokens[7].text;
    }

    static void parse_named_record_header(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 17) {
            throw std::runtime_error("native parser prototype expected named-record function header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COMMA");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "COLON");
        expect_kind(tokens, 8, "IDENT");
        expect_kind(tokens, 9, "COMMA");
        expect_kind(tokens, 10, "IDENT");
        expect_kind(tokens, 11, "COLON");
        expect_kind(tokens, 12, "IDENT");
        expect_kind(tokens, 13, "RPAREN");
        expect_kind(tokens, 14, "ARROW");
        expect_kind(tokens, 15, "IDENT");
        expect_kind(tokens, 16, "COLON");
        if (tokens[4].text != program.type_name || tokens[8].text != "num" || tokens[12].text != "num" || tokens[15].text != program.type_name) {
            throw std::runtime_error("native parser prototype only supports move(Point, num, num) -> Point");
        }
        program.move_function_name = tokens[0].text;
        program.param_name = tokens[2].text;
        program.delta_x_name = tokens[6].text;
        program.delta_y_name = tokens[10].text;
    }

    static void parse_named_record_body(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 17) {
            throw std::runtime_error("native parser prototype expected named-record body shape");
        }
        expect_kind(tokens, 0, "LPAREN");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "DOT");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "PLUS");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COMMA");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "COLON");
        expect_kind(tokens, 11, "IDENT");
        expect_kind(tokens, 12, "DOT");
        expect_kind(tokens, 13, "IDENT");
        expect_kind(tokens, 14, "PLUS");
        expect_kind(tokens, 15, "IDENT");
        expect_kind(tokens, 16, "RPAREN");
        if (
            tokens[1].text != program.first_field_name ||
            tokens[3].text != program.param_name ||
            tokens[5].text != program.first_field_name ||
            tokens[7].text != program.delta_x_name ||
            tokens[9].text != program.second_field_name ||
            tokens[11].text != program.param_name ||
            tokens[13].text != program.second_field_name ||
            tokens[15].text != program.delta_y_name
        ) {
            throw std::runtime_error("native parser prototype only supports named-record body '(x:p.x + dx, y:p.y + dy)'");
        }
    }

    static void parse_named_record_base_binding(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 12) {
            throw std::runtime_error("native parser prototype expected named-record base binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "LPAREN");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COLON");
        expect_kind(tokens, 6, "NUMBER");
        expect_kind(tokens, 7, "COMMA");
        expect_kind(tokens, 8, "IDENT");
        expect_kind(tokens, 9, "COLON");
        expect_kind(tokens, 10, "NUMBER");
        expect_kind(tokens, 11, "RPAREN");
        if (tokens[0].text != program.type_name || tokens[4].text != program.first_field_name || tokens[8].text != program.second_field_name) {
            throw std::runtime_error("native parser prototype only supports typed Point base literal binding");
        }
        program.base_name = tokens[1].text;
        program.base_first_value = parse_number(tokens[6].text);
        program.base_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_shifted_binding(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected named-record shifted binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "NUMBER");
        expect_kind(tokens, 8, "COMMA");
        expect_kind(tokens, 9, "NUMBER");
        expect_kind(tokens, 10, "RPAREN");
        if (tokens[0].text != program.type_name || tokens[3].text != program.move_function_name || tokens[5].text != program.base_name) {
            throw std::runtime_error("native parser prototype only supports Point shifted: move(base, 3, 4)");
        }
        program.shifted_name = tokens[1].text;
        program.shift_x_value = parse_number(tokens[7].text);
        program.shift_y_value = parse_number(tokens[9].text);
    }

    static void parse_named_record_emit_first_field(const std::vector<Token>& tokens, const NamedRecordProgram& program) {
        if (tokens.size() != 4) {
            throw std::runtime_error("native parser prototype expected named-record emit field shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        if (tokens[1].text != program.shifted_name || tokens[3].text != program.first_field_name) {
            throw std::runtime_error("native parser prototype only supports ':: shifted.x'");
        }
    }

    static void parse_named_record_emit_record(const std::vector<Token>& tokens, const NamedRecordProgram& program) {
        if (tokens.size() != 2) {
            throw std::runtime_error("native parser prototype expected named-record emit record shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        if (tokens[1].text != program.shifted_name) {
            throw std::runtime_error("native parser prototype only supports ':: shifted'");
        }
    }

    static void validate_named_record_program(const NamedRecordProgram& program) {
        if (program.type_name.empty() || program.move_function_name.empty() || program.base_name.empty() || program.shifted_name.empty()) {
            throw std::runtime_error("native parser prototype expected named-record program identifiers");
        }
    }
};

static std::string format_number_literal(double value) {
    std::ostringstream out;
    out << std::setprecision(15) << value;
    return out.str();
}

static std::string emit_hello_cpp(const HelloProgram& program) {
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

static std::string format_vector_literal(const std::vector<double>& values) {
    std::ostringstream out;
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i) {
            out << ", ";
        }
        out << format_number_literal(values[i]);
    }
    return out.str();
}

static std::string emit_vector_cpp(const VectorProgram& program) {
    std::ostringstream out;
    out
        << "#include <array>\n"
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
        << "template <typename T>\n"
        << "static std::string vf_format_value(const T& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <>\n"
        << "inline std::string vf_format_value<double>(const double& value) {\n"
        << "    return vf_format_num(value);\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_value(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <std::size_t N>\n"
        << "std::array<double, N> " << program.function_name
        << "(const std::array<double, N>& " << program.left_param_name
        << ", const std::array<double, N>& " << program.right_param_name << ") {\n"
        << "    std::array<double, N> out{};\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        out[i] = (" << program.left_param_name << "[i] + " << program.right_param_name
        << "[i]) * " << format_number_literal(program.scale) << ";\n"
        << "    }\n"
        << "    return out;\n"
        << "}\n\n"
        << "int main() {\n"
        << "    std::array<double, " << program.extent << "> " << program.left_binding.name
        << " = std::array<double, " << program.extent << ">{" << format_vector_literal(program.left_binding.values) << "};\n"
        << "    std::array<double, " << program.extent << "> " << program.right_binding.name
        << " = std::array<double, " << program.extent << ">{" << format_vector_literal(program.right_binding.values) << "};\n"
        << "    std::cout << vf_format_value(" << program.function_name << "("
        << program.emit_left_name << ", " << program.emit_right_name << ")) << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_numeric_cpp(const NumericProgram& program) {
    const std::size_t extent = program.xs_binding.values.size();
    std::ostringstream out;
    out
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double v) {\n"
        << "    if (std::floor(v) == v) {\n"
        << "        std::ostringstream oss;\n"
        << "        oss << static_cast<long long>(v);\n"
        << "        return oss.str();\n"
        << "    }\n"
        << "    std::ostringstream oss;\n"
        << "    oss << std::setprecision(15) << v;\n"
        << "    return oss.str();\n"
        << "}\n"
        << "template <typename T>\n"
        << "static std::string vf_format_value(const T& v) {\n"
        << "    std::ostringstream oss;\n"
        << "    oss << v;\n"
        << "    return oss.str();\n"
        << "}\n"
        << "template <>\n"
        << "inline std::string vf_format_value<double>(const double& v) {\n"
        << "    return vf_format_num(v);\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& v) {\n"
        << "    std::ostringstream oss;\n"
        << "    oss << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) oss << \", \";\n"
        << "        oss << vf_format_value(v[i]);\n"
        << "    }\n"
        << "    oss << \"]\";\n"
        << "    return oss.str();\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static T vf_array_sum(const std::array<T, N>& arr) {\n"
        << "    T out{};\n"
        << "    for (std::size_t i = 0; i < N; ++i) out += arr[i];\n"
        << "    return out;\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static T vf_array_min(const std::array<T, N>& arr) {\n"
        << "    T out = arr[0];\n"
        << "    for (std::size_t i = 1; i < N; ++i) if (arr[i] < out) out = arr[i];\n"
        << "    return out;\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static T vf_array_max(const std::array<T, N>& arr) {\n"
        << "    T out = arr[0];\n"
        << "    for (std::size_t i = 1; i < N; ++i) if (arr[i] > out) out = arr[i];\n"
        << "    return out;\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static double vf_array_variance(const std::array<T, N>& arr) {\n"
        << "    double mu = static_cast<double>(vf_array_sum(arr)) / static_cast<double>(N);\n"
        << "    double out = 0.0;\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        double d = static_cast<double>(arr[i]) - mu;\n"
        << "        out += d * d;\n"
        << "    }\n"
        << "    return out / static_cast<double>(N);\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static double vf_array_std(const std::array<T, N>& arr) {\n"
        << "    return std::sqrt(vf_array_variance(arr));\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::array<double, N> vf_array_normalize(const std::array<T, N>& arr) {\n"
        << "    std::array<double, N> out{};\n"
        << "    double lo = static_cast<double>(vf_array_min(arr));\n"
        << "    double hi = static_cast<double>(vf_array_max(arr));\n"
        << "    if (hi == lo) return out;\n"
        << "    double span = hi - lo;\n"
        << "    for (std::size_t i = 0; i < N; ++i) out[i] = (static_cast<double>(arr[i]) - lo) / span;\n"
        << "    return out;\n"
        << "}\n"
        << "template <typename TX, typename TY, std::size_t N>\n"
        << "static double vf_array_covariance(const std::array<TX, N>& xs, const std::array<TY, N>& ys) {\n"
        << "    double mu_x = static_cast<double>(vf_array_sum(xs)) / static_cast<double>(N);\n"
        << "    double mu_y = static_cast<double>(vf_array_sum(ys)) / static_cast<double>(N);\n"
        << "    double out = 0.0;\n"
        << "    for (std::size_t i = 0; i < N; ++i) out += (static_cast<double>(xs[i]) - mu_x) * (static_cast<double>(ys[i]) - mu_y);\n"
        << "    return out / static_cast<double>(N);\n"
        << "}\n"
        << "template <typename TX, typename TY, std::size_t N>\n"
        << "static double vf_array_correlation(const std::array<TX, N>& xs, const std::array<TY, N>& ys) {\n"
        << "    double sx = vf_array_std(xs);\n"
        << "    double sy = vf_array_std(ys);\n"
        << "    if (sx == 0.0 || sy == 0.0) return 0.0;\n"
        << "    return vf_array_covariance(xs, ys) / (sx * sy);\n"
        << "}\n\n"
        << "int main() {\n"
        << "    std::array<double, " << extent << "> " << program.xs_binding.name
        << " = std::array<double, " << extent << ">{" << format_vector_literal(program.xs_binding.values) << "};\n"
        << "    std::array<double, " << extent << "> " << program.ys_binding.name
        << " = std::array<double, " << extent << ">{" << format_vector_literal(program.ys_binding.values) << "};\n"
        << "    std::cout << vf_format_num(std::sin(0.0)) << \"\\n\";\n"
        << "    std::cout << vf_format_num(3.14159265358979323846) << \"\\n\";\n"
        << "    std::cout << vf_format_num((static_cast<double>(vf_array_sum(" << program.xs_binding.name << ")) / static_cast<double>(" << extent << "))) << \"\\n\";\n"
        << "    std::cout << vf_format_value(vf_array_normalize(" << program.xs_binding.name << ")) << \"\\n\";\n"
        << "    std::cout << vf_format_num(vf_array_correlation(" << program.xs_binding.name << ", " << program.ys_binding.name << ")) << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_cpp(const NamedRecordProgram& program) {
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
        << "struct " << program.type_name << " {\n"
        << "    double " << program.first_field_name << ";\n"
        << "    double " << program.second_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.first_field_name << ":\" << vf_format_num(value." << program.first_field_name << ")\n"
        << "        << \", " << program.second_field_name << ":\" << vf_format_num(value." << program.second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << program.type_name << " " << program.move_function_name << "(" << program.type_name << " " << program.param_name
        << ", double " << program.delta_x_name << ", double " << program.delta_y_name << ") {\n"
        << "    return " << program.type_name << "{"
        << program.param_name << "." << program.first_field_name << " + " << program.delta_x_name << ", "
        << program.param_name << "." << program.second_field_name << " + " << program.delta_y_name << "};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.type_name << " " << program.base_name << "{"
        << format_number_literal(program.base_first_value) << ", "
        << format_number_literal(program.base_second_value) << "};\n"
        << "    " << program.type_name << " " << program.shifted_name << " = " << program.move_function_name << "("
        << program.base_name << ", " << format_number_literal(program.shift_x_value) << ", "
        << format_number_literal(program.shift_y_value) << ");\n"
        << "    std::cout << vf_format_num(" << program.shifted_name << "." << program.first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.shifted_name << ") << \"\\n\";\n"
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
        std::cout << parser.emit_cpp();
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << exc.what() << "\n";
        return 1;
    }
}
"""


def _native_parser_proto_cache_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "vektorflow-native-parser-proto"
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


def emit_cpp_for_native_core_file(path: Path) -> str:
    exe = build_native_parser_proto()
    proc = subprocess.run([str(exe), str(path)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise CppEmitError(proc.stderr.strip() or proc.stdout.strip() or "native parser prototype failed")
    return proc.stdout


def emit_cpp_for_native_core_source(source: str) -> str:
    exe = build_native_parser_proto()
    proc = subprocess.run([str(exe), "-"], input=source, capture_output=True, text=True)
    if proc.returncode != 0:
        raise CppEmitError(proc.stderr.strip() or proc.stdout.strip() or "native parser prototype failed")
    return proc.stdout


def emit_cpp_for_hello_native_file(path: Path) -> str:
    return emit_cpp_for_native_core_file(path)


def emit_cpp_for_hello_native_source(source: str) -> str:
    return emit_cpp_for_native_core_source(source)
