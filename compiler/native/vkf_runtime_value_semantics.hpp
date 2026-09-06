#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace vkf::runtime_value_semantics {

enum class DisplayFamily {
    Text,
    Boolean,
    Number,
    Record,
    Unsupported,
};

struct RecordField {
    std::string name;
    std::string type;
};

inline std::string trim(std::string_view value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos) return {};
    const auto last = value.find_last_not_of(" \t\r\n");
    return std::string(value.substr(first, last - first + 1));
}

inline std::size_t top_level_delimiter(std::string_view value, char delimiter) {
    std::size_t depth = 0;
    for (std::size_t index = 0; index < value.size(); ++index) {
        const char ch = value[index];
        if (ch == '(' || ch == '[' || ch == '{' || ch == '<') ++depth;
        else if (ch == ')' || ch == ']' || ch == '}' || ch == '>') --depth;
        else if (ch == delimiter && depth == 0) return index;
    }
    return std::string_view::npos;
}

inline DisplayFamily display_family(std::string_view type) {
    if (type == "str" || type == "chr") return DisplayFamily::Text;
    if (type == "bit") return DisplayFamily::Boolean;
    if (type == "int" || type == "num" || type == "byte") {
        return DisplayFamily::Number;
    }
    if (type.size() > 8 && type.substr(0, 7) == "record{" && type.back() == '}') {
        return DisplayFamily::Record;
    }
    return DisplayFamily::Unsupported;
}

inline std::optional<unsigned> fixed_precision(std::string_view format) {
    if (format.empty()) return 0;
    if (format == "2f") return 2;
    return std::nullopt;
}

inline std::optional<std::vector<RecordField>> record_fields(std::string_view type) {
    if (display_family(type) != DisplayFamily::Record) return std::nullopt;
    type.remove_prefix(7);
    type.remove_suffix(1);
    std::vector<RecordField> fields;
    while (!type.empty()) {
        const auto comma = top_level_delimiter(type, ',');
        const auto field = type.substr(0, comma);
        const auto colon = top_level_delimiter(field, ':');
        if (colon == std::string_view::npos) return std::nullopt;
        fields.push_back({trim(field.substr(0, colon)), trim(field.substr(colon + 1))});
        if (comma == std::string_view::npos) break;
        type.remove_prefix(comma + 1);
    }
    return fields;
}

} // namespace vkf::runtime_value_semantics
