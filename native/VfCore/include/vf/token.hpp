#pragma once

#include <cstdint>
#include <string>
#include <variant>
#include <vector>

namespace vf {

struct SourceLocation {
    std::string file;
    int line = 1;
    int column = 1;
};

using DotTightness = std::pair<bool, bool>;
using TokenValue = std::variant<std::monostate, std::int64_t, double, std::string, DotTightness>;

struct Token {
    std::string kind;
    TokenValue value;
    SourceLocation location;
};

std::string token_stream_to_json(const std::vector<Token>& tokens);

}  // namespace vf
