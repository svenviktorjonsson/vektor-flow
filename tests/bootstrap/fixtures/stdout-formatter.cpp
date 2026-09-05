#include "compiler/native/vkf_stdout_format.hpp"
#ifndef __EMSCRIPTEN__
#include <iostream>
#include <iterator>
#endif
std::string output;
extern "C" int format_buffer(const unsigned char* memory, unsigned size, unsigned pointer, unsigned ordered) {
    try {
        output = vkf::stdout_format::format_console(memory, size, pointer, ordered != 0);
        return 0;
    } catch (const std::exception& error) {
        output = error.what();
        return 1;
    }
}
extern "C" const char* result_pointer() { return output.data(); }
extern "C" unsigned result_length() { return output.size(); }
#ifndef __EMSCRIPTEN__
int main(int argc, char**) {
    const std::string input(std::istreambuf_iterator<char>(std::cin), {});
    const int status = format_buffer(reinterpret_cast<const unsigned char*>(input.data()), input.size(), 0, argc > 1);
    std::cout << output;
    return status;
}
#endif
