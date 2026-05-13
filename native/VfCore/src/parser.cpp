#include "vf/parser.hpp"

#include "parser_state.hpp"

namespace vf {

ParseError::ParseError(std::string message, SourceLocation location)
    : std::runtime_error(std::move(message)), location_(std::move(location)) {}

Module parse_tokens(const std::vector<Token>& tokens) {
    return ParserState(tokens).parse_module();
}

}  // namespace vf
