#pragma once

#include "vf/ast.hpp"
#include "vf/token.hpp"

#include <stdexcept>
#include <string>
#include <vector>

namespace vf {

class ParseError final : public std::runtime_error {
public:
    ParseError(std::string message, SourceLocation location);

    [[nodiscard]] const SourceLocation& location() const noexcept { return location_; }

private:
    SourceLocation location_;
};

Module parse_tokens(const std::vector<Token>& tokens);

}  // namespace vf
