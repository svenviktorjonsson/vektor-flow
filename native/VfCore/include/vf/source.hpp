#pragma once

#include <istream>
#include <string>

namespace vf {

std::string normalize_newlines(const std::string& text);
std::string read_source_file(const std::string& path);
std::string read_source_stream(std::istream& input);

}  // namespace vf
