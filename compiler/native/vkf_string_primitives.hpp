#pragma once

#include <cstddef>
#include <stdexcept>
#include <string>
#include <string_view>

struct VkfCursor {
    std::string_view source;
    std::string_view file;
    std::size_t index;
    std::size_t line;
    std::size_t column;
};

namespace vkf_string_detail {

inline bool is_continuation(unsigned char byte) {
    return (byte & 0xC0u) == 0x80u;
}

inline std::size_t utf8_width_from_lead(unsigned char lead) {
    if (lead <= 0x7Fu) {
        return 1;
    }
    if (lead >= 0xC2u && lead <= 0xDFu) {
        return 2;
    }
    if (lead >= 0xE0u && lead <= 0xEFu) {
        return 3;
    }
    if (lead >= 0xF0u && lead <= 0xF4u) {
        return 4;
    }
    throw std::runtime_error("invalid UTF-8 lead byte");
}

inline std::size_t scalar_width(std::string_view source, std::size_t byte_index) {
    if (byte_index >= source.size()) {
        throw std::runtime_error("UTF-8 scalar index past EOF");
    }

    const auto lead = static_cast<unsigned char>(source[byte_index]);
    if (is_continuation(lead)) {
        throw std::runtime_error("UTF-8 scalar index points into continuation byte");
    }

    const std::size_t width = utf8_width_from_lead(lead);
    if (byte_index + width > source.size()) {
        throw std::runtime_error("truncated UTF-8 scalar");
    }

    for (std::size_t offset = 1; offset < width; ++offset) {
        const auto byte = static_cast<unsigned char>(source[byte_index + offset]);
        if (!is_continuation(byte)) {
            throw std::runtime_error("invalid UTF-8 continuation byte");
        }
    }

    return width;
}

inline bool is_scalar_boundary(std::string_view source, std::size_t byte_index) {
    return byte_index <= source.size()
        && (byte_index == source.size()
            || !is_continuation(static_cast<unsigned char>(source[byte_index])));
}

inline void validate_scalar_range(std::string_view source, std::size_t start_byte, std::size_t stop_byte) {
    std::size_t index = start_byte;
    while (index < stop_byte) {
        index += scalar_width(source, index);
    }
    if (index != stop_byte) {
        throw std::runtime_error("UTF-8 slice boundary splits scalar");
    }
}

} // namespace vkf_string_detail

inline std::size_t vkf_string_byte_len(std::string_view source) {
    return source.size();
}

inline bool vkf_string_eof(std::string_view source, std::size_t byte_index) {
    return byte_index >= source.size();
}

inline std::string vkf_string_peek_scalar(std::string_view source, std::size_t byte_index) {
    const std::size_t width = vkf_string_detail::scalar_width(source, byte_index);
    return std::string(source.substr(byte_index, width));
}

inline std::size_t vkf_string_scalar_width(std::string_view source, std::size_t byte_index) {
    return vkf_string_detail::scalar_width(source, byte_index);
}

inline std::string vkf_string_slice_bytes(
    std::string_view source,
    std::size_t start_byte,
    std::size_t stop_byte
) {
    if (start_byte > stop_byte || stop_byte > source.size()) {
        throw std::runtime_error("invalid UTF-8 slice range");
    }
    if (!vkf_string_detail::is_scalar_boundary(source, start_byte)
        || !vkf_string_detail::is_scalar_boundary(source, stop_byte)) {
        throw std::runtime_error("UTF-8 slice boundary splits scalar");
    }
    vkf_string_detail::validate_scalar_range(source, start_byte, stop_byte);
    return std::string(source.substr(start_byte, stop_byte - start_byte));
}

inline VkfCursor vkf_cursor_advance_scalar(VkfCursor cursor) {
    const std::string scalar = vkf_string_peek_scalar(cursor.source, cursor.index);
    cursor.index += scalar.size();
    if (scalar == "\n") {
        cursor.line += 1;
        cursor.column = 1;
    } else {
        cursor.column += 1;
    }
    return cursor;
}
