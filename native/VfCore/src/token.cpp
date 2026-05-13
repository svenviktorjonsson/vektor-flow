#include "vf/token.hpp"

#include "vf/json.hpp"

#include <iomanip>
#include <sstream>
#include <string>

namespace vf {

namespace {

std::string token_value_to_json(const TokenValue& value) {
    return std::visit(
        [](const auto& current) -> std::string {
            using Value = std::decay_t<decltype(current)>;
            if constexpr (std::is_same_v<Value, std::monostate>) {
                return "null";
            } else if constexpr (std::is_same_v<Value, std::int64_t>) {
                return std::to_string(current);
            } else if constexpr (std::is_same_v<Value, double>) {
                std::ostringstream out;
                out << std::setprecision(17) << current;
                return out.str();
            } else if constexpr (std::is_same_v<Value, std::string>) {
                return json_quote(current);
            } else {
                return std::string("[") + (current.first ? "true" : "false") + ", " +
                    (current.second ? "true" : "false") + "]";
            }
        },
        value);
}

}  // namespace

std::string token_stream_to_json(const std::vector<Token>& tokens) {
    std::ostringstream out;
    out << "{\n"
        << "  \"schema\": \"vektorflow.token_stream\",\n"
        << "  \"version\": 1,\n"
        << "  \"tokens\": [\n";

    for (std::size_t index = 0; index < tokens.size(); ++index) {
        const Token& token = tokens[index];
        out << "    {\n"
            << "      \"kind\": " << json_quote(token.kind) << ",\n"
            << "      \"value\": " << token_value_to_json(token.value) << ",\n"
            << "      \"location\": {\n"
            << "        \"file\": " << json_quote(token.location.file) << ",\n"
            << "        \"line\": " << token.location.line << ",\n"
            << "        \"column\": " << token.location.column << "\n"
            << "      }\n"
            << "    ";
        out << (index + 1 < tokens.size() ? "},\n" : "}\n");
    }

    out << "  ]\n"
        << "}";
    return out.str();
}

}  // namespace vf
