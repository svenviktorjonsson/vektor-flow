#include "compiler/native/vkf_private_compilation_form.hpp"
#include "compiler/native/vkf_native_frontend.hpp"
#include "compiler/native/vkf_packaged_module_sources.hpp"

#include <iostream>
#include <iterator>

int main() {
    try {
        const std::string source{std::istreambuf_iterator<char>(std::cin), {}};
        const auto ast = vkf::native_frontend::parse_value(
            vkf::native_frontend::lex_value(source, "<browser>"));
        const auto linked = vkf::module_linker::link_packaged_modules(ast, "<browser>");
        const auto original = vkf::native_frontend::lower_value(linked);
        const auto form = vkf::native_frontend::private_compilation::lower_module(linked);
        std::cout << vf::json_stringify(vf::JsonValue::Object{
            {"canonical", form.canonical_ir}, {"execution", form.execution_ir},
            {"original", original}}, -1);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what();
        return 1;
    }
}
