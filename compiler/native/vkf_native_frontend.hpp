#pragma once

#include "native/VfOverlay/vf/json.hpp"

#include <string>

namespace vkf::native_frontend {

vf::JsonValue lex_value(const std::string& source, const std::string& filename);
std::string lex(const std::string& source, const std::string& filename);
vf::JsonValue parse_value(const vf::JsonValue& token_stream);
vf::JsonValue parse_value(const std::string& token_stream_json);
std::string parse(const std::string& token_stream_json);
vf::JsonValue lower_value(const vf::JsonValue& ast);
std::string lower(const std::string& ast_json);

}  // namespace vkf::native_frontend
