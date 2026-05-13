#include "lexer_state.hpp"

namespace vf {

LexError::LexError(std::string message, SourceLocation location)
    : std::runtime_error(std::move(message)), location_(std::move(location)) {}

LexerState::LexerState(std::string source, std::string origin)
    : source_(std::move(source)), origin_(std::move(origin)) {}

std::vector<Token> tokenize_source(const std::string& source, const std::string& origin) {
    return LexerState(source, origin).tokenize();
}

}  // namespace vf
