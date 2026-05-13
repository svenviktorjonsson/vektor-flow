#pragma once

#include <cstddef>
#include <map>
#include <string>
#include <vector>

namespace vf {

class JsonValue {
public:
    enum class Type {
        Null,
        Boolean,
        Number,
        String,
        Array,
        Object,
    };

    using Array = std::vector<JsonValue>;
    using Object = std::map<std::string, JsonValue>;

    JsonValue() = default;
    JsonValue(std::nullptr_t);
    JsonValue(bool value);
    JsonValue(double value);
    JsonValue(std::string value);
    JsonValue(const char* value);
    JsonValue(Array value);
    JsonValue(Object value);

    Type type() const noexcept;

    bool is_null() const noexcept;
    bool is_boolean() const noexcept;
    bool is_number() const noexcept;
    bool is_string() const noexcept;
    bool is_array() const noexcept;
    bool is_object() const noexcept;

    bool as_boolean() const;
    double as_number() const;
    const std::string& as_string() const;
    const Array& as_array() const;
    const Object& as_object() const;

    Array& as_array();
    Object& as_object();

private:
    Type type_ = Type::Null;
    bool boolean_value_ = false;
    double number_value_ = 0.0;
    std::string string_value_;
    Array array_value_;
    Object object_value_;
};

std::string json_quote(const std::string& value);
JsonValue parse_json(const std::string& text);
JsonValue parse_json(const char* text);
std::string json_stringify(const JsonValue& value, int indent = 2);

}  // namespace vf
