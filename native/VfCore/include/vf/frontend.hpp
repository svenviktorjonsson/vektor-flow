#pragma once

#include "vf/token.hpp"

#include <string>
#include <vector>

namespace vf {

struct Diagnostic {
    std::string stage;
    std::string message;
};

struct FrontendResult {
    bool ok = false;
    std::vector<Diagnostic> diagnostics;
    std::string payload;
};

FrontendResult lex_source(const std::string& source, const std::string& origin);
FrontendResult parse_source(const std::string& source, const std::string& origin);
FrontendResult artifact_source(const std::string& source, const std::string& origin);
FrontendResult run_source(const std::string& source, const std::string& origin);

}  // namespace vf
