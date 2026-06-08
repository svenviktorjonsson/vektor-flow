#include "vf/json.hpp"

#include <cctype>
#include <cstdint>
#include <iomanip>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace vf {

namespace {

class JsonParser {
public:
    explicit JsonParser(const std::string& text)
        : text_(text) {}

    JsonValue parse() {
        skip_whitespace();
        JsonValue value = parse_value();
        skip_whitespace();
        if (!is_at_end()) {
            throw error("unexpected trailing characters");
        }
        return value;
    }

private:
    JsonValue parse_value() {
        if (is_at_end()) {
            throw error("unexpected end of input");
        }

        switch (peek()) {
        case 'n':
            consume_literal("null");
            return JsonValue(nullptr);
        case 't':
            consume_literal("true");
            return JsonValue(true);
        case 'f':
            consume_literal("false");
            return JsonValue(false);
        case '"':
            return JsonValue(parse_string());
        case '[':
            return JsonValue(parse_array());
        case '{':
            return JsonValue(parse_object());
        default:
            if (peek() == '-' || std::isdigit(static_cast<unsigned char>(peek()))) {
                return JsonValue(parse_number());
            }
            throw error("unexpected token");
        }
    }

    JsonValue::Array parse_array() {
        expect('[');
        skip_whitespace();

        JsonValue::Array array;
        if (consume_if(']')) {
            return array;
        }

        while (true) {
            skip_whitespace();
            array.push_back(parse_value());
            skip_whitespace();
            if (consume_if(']')) {
                return array;
            }
            expect(',');
            skip_whitespace();
        }
    }

    JsonValue::Object parse_object() {
        expect('{');
        skip_whitespace();

        JsonValue::Object object;
        if (consume_if('}')) {
            return object;
        }

        while (true) {
            skip_whitespace();
            if (peek() != '"') {
                throw error("expected string key");
            }
            std::string key = parse_string();
            skip_whitespace();
            expect(':');
            skip_whitespace();
            object.emplace(std::move(key), parse_value());
            skip_whitespace();
            if (consume_if('}')) {
                return object;
            }
            expect(',');
            skip_whitespace();
        }
    }

    std::string parse_string() {
        expect('"');
        std::string out;
        while (!is_at_end()) {
            const char ch = advance();
            if (ch == '"') {
                return out;
            }
            if (ch == '\\') {
                if (is_at_end()) {
                    throw error("unterminated escape sequence");
                }
                const char esc = advance();
                switch (esc) {
                case '"':
                case '\\':
                case '/':
                    out.push_back(esc);
                    break;
                case 'b':
                    out.push_back('\b');
                    break;
                case 'f':
                    out.push_back('\f');
                    break;
                case 'n':
                    out.push_back('\n');
                    break;
                case 'r':
                    out.push_back('\r');
                    break;
                case 't':
                    out.push_back('\t');
                    break;
                case 'u':
                    append_utf8(parse_hex_codepoint(), out);
                    break;
                default:
                    throw error("invalid escape sequence");
                }
                continue;
            }
            if (static_cast<unsigned char>(ch) < 0x20) {
                throw error("control characters must be escaped");
            }
            out.push_back(ch);
        }
        throw error("unterminated string");
    }

    double parse_number() {
        const std::size_t start = index_;

        consume_if('-');
        if (consume_if('0')) {
            // Single leading zero is allowed.
        } else {
            consume_digits();
        }

        if (consume_if('.')) {
            consume_digits();
        }

        if (peek() == 'e' || peek() == 'E') {
            advance();
            if (peek() == '+' || peek() == '-') {
                advance();
            }
            consume_digits();
        }

        const std::string slice = text_.substr(start, index_ - start);
        try {
            return std::stod(slice);
        } catch (const std::exception&) {
            throw error("invalid number");
        }
    }

    void consume_digits() {
        if (is_at_end() || !std::isdigit(static_cast<unsigned char>(peek()))) {
            throw error("expected digit");
        }
        while (!is_at_end() && std::isdigit(static_cast<unsigned char>(peek()))) {
            advance();
        }
    }

    void consume_literal(const char* literal) {
        while (*literal != '\0') {
            expect(*literal);
            ++literal;
        }
    }

    std::uint32_t parse_hex_codepoint() {
        std::uint32_t value = 0;
        for (int i = 0; i < 4; ++i) {
            if (is_at_end()) {
                throw error("unterminated unicode escape");
            }
            value <<= 4;
            const char ch = advance();
            if (ch >= '0' && ch <= '9') {
                value |= static_cast<std::uint32_t>(ch - '0');
            } else if (ch >= 'a' && ch <= 'f') {
                value |= static_cast<std::uint32_t>(10 + ch - 'a');
            } else if (ch >= 'A' && ch <= 'F') {
                value |= static_cast<std::uint32_t>(10 + ch - 'A');
            } else {
                throw error("invalid unicode escape");
            }
        }
        return value;
    }

    static void append_utf8(std::uint32_t codepoint, std::string& out) {
        if (codepoint <= 0x7F) {
            out.push_back(static_cast<char>(codepoint));
            return;
        }
        if (codepoint <= 0x7FF) {
            out.push_back(static_cast<char>(0xC0 | ((codepoint >> 6) & 0x1F)));
            out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
            return;
        }
        if (codepoint <= 0xFFFF) {
            out.push_back(static_cast<char>(0xE0 | ((codepoint >> 12) & 0x0F)));
            out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
            return;
        }
        out.push_back(static_cast<char>(0xF0 | ((codepoint >> 18) & 0x07)));
        out.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
    }

    void skip_whitespace() {
        while (!is_at_end() && std::isspace(static_cast<unsigned char>(peek()))) {
            ++index_;
        }
    }

    bool consume_if(char expected) {
        if (peek() != expected) {
            return false;
        }
        ++index_;
        return true;
    }

    void expect(char expected) {
        if (is_at_end() || advance() != expected) {
            std::string message = "expected '";
            message.push_back(expected);
            message.push_back('\'');
            throw error(message);
        }
    }

    char advance() {
        return text_[index_++];
    }

    char peek() const {
        return is_at_end() ? '\0' : text_[index_];
    }

    bool is_at_end() const {
        return index_ >= text_.size();
    }

    std::runtime_error error(const std::string& message) const {
        std::ostringstream out;
        out << "json parse error at offset " << index_ << ": " << message;
        return std::runtime_error(out.str());
    }

    const std::string& text_;
    std::size_t index_ = 0;
};

void stringify_json_impl(const JsonValue& value, std::ostringstream& out, int indent, int depth) {
    switch (value.type()) {
    case JsonValue::Type::Null:
        out << "null";
        return;
    case JsonValue::Type::Boolean:
        out << (value.as_boolean() ? "true" : "false");
        return;
    case JsonValue::Type::Number: {
        const double number = value.as_number();
        if (!std::isfinite(number)) {
            throw std::runtime_error("cannot stringify non-finite json number");
        }
        std::ostringstream number_out;
        number_out << std::setprecision(std::numeric_limits<double>::digits10 + 1) << number;
        out << number_out.str();
        return;
    }
    case JsonValue::Type::String:
        out << json_quote(value.as_string());
        return;
    case JsonValue::Type::Array: {
        const auto& array = value.as_array();
        out << "[";
        if (!array.empty()) {
            const bool pretty = indent >= 0;
            for (std::size_t i = 0; i < array.size(); ++i) {
                if (pretty) {
                    out << "\n" << std::string(static_cast<std::size_t>((depth + 1) * indent), ' ');
                } else if (i > 0) {
                    out << " ";
                }
                stringify_json_impl(array[i], out, indent, depth + 1);
                if (i + 1 < array.size()) {
                    out << ",";
                }
            }
            if (pretty) {
                out << "\n" << std::string(static_cast<std::size_t>(depth * indent), ' ');
            }
        }
        out << "]";
        return;
    }
    case JsonValue::Type::Object: {
        const auto& object = value.as_object();
        out << "{";
        if (!object.empty()) {
            const bool pretty = indent >= 0;
            std::size_t i = 0;
            for (const auto& entry : object) {
                if (pretty) {
                    out << "\n" << std::string(static_cast<std::size_t>((depth + 1) * indent), ' ');
                } else if (i > 0) {
                    out << " ";
                }
                out << json_quote(entry.first) << (pretty ? ": " : ":");
                stringify_json_impl(entry.second, out, indent, depth + 1);
                if (i + 1 < object.size()) {
                    out << ",";
                }
                ++i;
            }
            if (pretty) {
                out << "\n" << std::string(static_cast<std::size_t>(depth * indent), ' ');
            }
        }
        out << "}";
        return;
    }
    }
}

template <typename T>
const T& expect_type(const T& value) {
    return value;
}

}  // namespace

JsonValue::JsonValue(std::nullptr_t) {}

JsonValue::JsonValue(bool value)
    : type_(Type::Boolean), boolean_value_(value) {}

JsonValue::JsonValue(double value)
    : type_(Type::Number), number_value_(value) {}

JsonValue::JsonValue(std::string value)
    : type_(Type::String), string_value_(std::move(value)) {}

JsonValue::JsonValue(const char* value)
    : JsonValue(std::string(value == nullptr ? "" : value)) {}

JsonValue::JsonValue(Array value)
    : type_(Type::Array), array_value_(std::move(value)) {}

JsonValue::JsonValue(Object value)
    : type_(Type::Object), object_value_(std::move(value)) {}

JsonValue::Type JsonValue::type() const noexcept {
    return type_;
}

bool JsonValue::is_null() const noexcept {
    return type_ == Type::Null;
}

bool JsonValue::is_boolean() const noexcept {
    return type_ == Type::Boolean;
}

bool JsonValue::is_number() const noexcept {
    return type_ == Type::Number;
}

bool JsonValue::is_string() const noexcept {
    return type_ == Type::String;
}

bool JsonValue::is_array() const noexcept {
    return type_ == Type::Array;
}

bool JsonValue::is_object() const noexcept {
    return type_ == Type::Object;
}

bool JsonValue::as_boolean() const {
    if (!is_boolean()) {
        throw std::runtime_error("json value is not a boolean");
    }
    return boolean_value_;
}

double JsonValue::as_number() const {
    if (!is_number()) {
        throw std::runtime_error("json value is not a number");
    }
    return number_value_;
}

const std::string& JsonValue::as_string() const {
    if (!is_string()) {
        throw std::runtime_error("json value is not a string");
    }
    return string_value_;
}

const JsonValue::Array& JsonValue::as_array() const {
    if (!is_array()) {
        throw std::runtime_error("json value is not an array");
    }
    return array_value_;
}

const JsonValue::Object& JsonValue::as_object() const {
    if (!is_object()) {
        throw std::runtime_error("json value is not an object");
    }
    return object_value_;
}

JsonValue::Array& JsonValue::as_array() {
    if (!is_array()) {
        throw std::runtime_error("json value is not an array");
    }
    return array_value_;
}

JsonValue::Object& JsonValue::as_object() {
    if (!is_object()) {
        throw std::runtime_error("json value is not an object");
    }
    return object_value_;
}

std::string json_quote(const std::string& value) {
    std::ostringstream out;
    out << '"';
    for (unsigned char ch : value) {
        switch (ch) {
        case '"':
            out << "\\\"";
            break;
        case '\\':
            out << "\\\\";
            break;
        case '\b':
            out << "\\b";
            break;
        case '\f':
            out << "\\f";
            break;
        case '\n':
            out << "\\n";
            break;
        case '\r':
            out << "\\r";
            break;
        case '\t':
            out << "\\t";
            break;
        default:
            if (ch < 0x20) {
                out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                    << static_cast<int>(ch) << std::dec << std::setfill(' ');
            } else {
                out << static_cast<char>(ch);
            }
            break;
        }
    }
    out << '"';
    return out.str();
}

JsonValue parse_json(const std::string& text) {
    return JsonParser(text).parse();
}

JsonValue parse_json(const char* text) {
    return parse_json(std::string(text == nullptr ? "" : text));
}

std::string json_stringify(const JsonValue& value, int indent) {
    std::ostringstream out;
    stringify_json_impl(value, out, indent, 0);
    return out.str();
}

}  // namespace vf
