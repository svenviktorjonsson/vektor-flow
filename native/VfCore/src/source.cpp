#include "vf/source.hpp"

#include <fstream>
#include <iterator>
#include <sstream>
#include <stdexcept>

namespace vf {

std::string normalize_newlines(const std::string& text) {
    std::string normalized;
    normalized.reserve(text.size());
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch == '\r') {
            if (index + 1 < text.size() && text[index + 1] == '\n') {
                continue;
            }
            normalized.push_back('\n');
            continue;
        }
        normalized.push_back(ch);
    }
    return normalized;
}

std::string read_source_file(const std::string& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw std::runtime_error("cannot read source file: " + path);
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return normalize_newlines(buffer.str());
}

std::string read_source_stream(std::istream& input) {
    return normalize_newlines(std::string(
        std::istreambuf_iterator<char>(input),
        std::istreambuf_iterator<char>()));
}

}  // namespace vf
