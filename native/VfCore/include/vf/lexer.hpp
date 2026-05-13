#pragma once

#include "vf/token.hpp"

#include <stdexcept>
#include <string>
#include <vector>

namespace vf {

class LexError final : public std::runtime_error {
public:
    LexError(std::string message, SourceLocation location);

    [[nodiscard]] const SourceLocation& location() const noexcept { return location_; }

private:
    SourceLocation location_;
};

std::vector<Token> tokenize_source(const std::string& source, const std::string& origin);

}  // namespace vf
