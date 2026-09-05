#pragma once

#include "compiler/native/vkf_native_frontend.hpp"

#include <algorithm>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace vkf::testing {

class TestSuiteFailure : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

struct TaggedTest {
    std::string name;
    bool compatible = false;
    std::string incompatibility;
};

namespace detail {
inline const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) throw TestSuiteFailure("expected object for " + context);
    return value.as_object();
}
inline std::string string_field(const vf::JsonValue::Object& object,
                                const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end() || !found->second.is_string()) {
        throw TestSuiteFailure("missing string field " + name + " in " + context);
    }
    return found->second.as_string();
}
inline std::vector<std::string> path_components(const std::string& path) {
    std::vector<std::string> parts;
    if (!path.empty() && (path.front() == '/' || path.front() == '\\')) parts.emplace_back("/");
    std::size_t cursor = 0;
    while (cursor < path.size()) {
        const auto start = path.find_first_not_of("/\\", cursor);
        if (start == std::string::npos) break;
        const auto end = path.find_first_of("/\\", start);
        parts.push_back(path.substr(start, end == std::string::npos ? end : end - start));
        if (end == std::string::npos) break;
        cursor = end + 1;
    }
    return parts;
}
} // namespace detail

inline std::string normalized_source(std::string source) {
    source.erase(std::remove(source.begin(), source.end(), '\r'), source.end());
    return source;
}

inline bool is_test_source_file(const std::string& file, bool recursive = true) {
    const auto separator = file.find_last_of("/\\");
    const auto begin = separator == std::string::npos ? 0 : separator + 1;
    const auto extension = file.find_last_of('.');
    if (extension == std::string::npos || extension <= begin || file.substr(extension) != ".vkf") return false;
    if (!recursive) return true;
    std::size_t component = 0;
    while (component < file.size()) {
        const auto end = file.find_first_of("/\\", component);
        if (file.substr(component, end == std::string::npos ? end : end - component) == ".vkfbuild") return false;
        if (end == std::string::npos) break;
        component = end + 1;
    }
    return true;
}

// The host supplies regular-file paths only; language/test filtering is shared.
inline std::vector<std::string> select_test_source_files(const std::vector<std::string>& regular_files) {
    std::vector<std::string> result;
    for (const auto& file : regular_files) if (is_test_source_file(file)) result.push_back(file);
    // std::filesystem::path sorting is component-wise, not raw string order.
    // Preserve it without introducing a filesystem dependency into WASM.
    std::sort(result.begin(), result.end(), [](const auto& left, const auto& right) {
        return detail::path_components(left) < detail::path_components(right);
    });
    return result;
}

inline std::optional<std::string> expected_compile_error(const std::string& raw_source) {
    const auto source = normalized_source(raw_source);
    constexpr std::string_view marker = "# expect-compile-error: ";
    if (source.rfind(marker, 0) != 0) return std::nullopt;
    const auto line_end = source.find('\n');
    return source.substr(marker.size(), line_end == std::string::npos ? line_end : line_end - marker.size());
}

inline bool matches_compile_error(const std::string& expected, const std::string& actual) {
    return !expected.empty() && actual.find(expected) != std::string::npos;
}

inline std::string test_entry_source(const std::string& source, const std::string& test_name) {
    auto generated = normalized_source(source);
    if (generated.empty() || generated.back() != '\n') generated.push_back('\n');
    generated += "(" + test_name + "())?!\n";
    return generated;
}

inline std::vector<TaggedTest> discover_tests(
    const std::string& source,
    const std::string& file
) {
    const auto tokens = vkf::native_frontend::lex_value(normalized_source(source), file);
    const auto ast = vkf::native_frontend::parse_value(tokens);
    const auto& module = detail::object_of(ast, "test module");
    const auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) {
        throw TestSuiteFailure("test module has no body");
    }

    bool has_explicit_tests = false;
    for (const auto& statement : body->second.as_array()) {
        if (!statement.is_object()) continue;
        const auto& function = statement.as_object();
        const auto kind = function.find("kind");
        const auto tag = function.find("test");
        if (kind != function.end() && kind->second.is_string() &&
            kind->second.as_string() == "function_definition" &&
            tag != function.end() && tag->second.is_boolean() && tag->second.as_boolean()) {
            has_explicit_tests = true;
            break;
        }
    }

    std::vector<TaggedTest> tests;
    for (const auto& statement : body->second.as_array()) {
        if (!statement.is_object()) continue;
        const auto& function = statement.as_object();
        const auto kind = function.find("kind");
        const auto tag = function.find("test");
        if (kind == function.end() || !kind->second.is_string() ||
            kind->second.as_string() != "function_definition") {
            continue;
        }

        const bool explicitly_tagged =
            tag != function.end() && tag->second.is_boolean() && tag->second.as_boolean();
        if (has_explicit_tests && !explicitly_tagged) continue;

        TaggedTest test;
        test.name = detail::string_field(function, "name", "tagged test");
        if (!has_explicit_tests && !test.name.empty() && test.name.front() == '_') continue;
        test.compatible = true;

        const auto params = function.find("params");
        if (params == function.end() || !params->second.is_array()) {
            test.compatible = false;
            test.incompatibility = "invalid parameter list";
        } else {
            for (const auto& param_value : params->second.as_array()) {
                const auto& param = detail::object_of(param_value, "test parameter");
                const auto default_value = param.find("default");
                if (default_value == param.end() || default_value->second.is_null()) {
                    if (!has_explicit_tests) {
                        test.compatible = false;
                        test.incompatibility.clear();
                        break;
                    }
                    test.compatible = false;
                    test.incompatibility = "required parameters need fixtures";
                    break;
                }
            }
        }

        if (!has_explicit_tests && !test.compatible && test.incompatibility.empty()) continue;

        const auto return_type = function.find("return_type");
        if (test.compatible &&
            (return_type == function.end() || !return_type->second.is_object())) {
            if (!has_explicit_tests) continue;
            test.compatible = false;
            test.incompatibility = "test must return bit";
        } else if (test.compatible) {
            const auto& type = return_type->second.as_object();
            const auto name = type.find("name");
            if (name == type.end() || !name->second.is_string() || name->second.as_string() != "bit") {
                if (!has_explicit_tests) continue;
                test.compatible = false;
                test.incompatibility = "test must return bit";
            }
        }
        tests.push_back(std::move(test));
    }
    return tests;
}

} // namespace vkf::testing
