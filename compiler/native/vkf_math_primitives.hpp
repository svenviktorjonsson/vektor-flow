#pragma once
#include <cstddef>
#include <string>

namespace vkf::math_primitives {
enum class Kind { None, Absolute, SquareRoot, Sine, Cosine, Exponential, NaturalLog };

inline Kind classify(const std::string& name) {
    if (name == "abs") return Kind::Absolute;
    if (name == "sqrt") return Kind::SquareRoot;
    if (name == "sin") return Kind::Sine;
    if (name == "cos") return Kind::Cosine;
    if (name == "exp") return Kind::Exponential;
    if (name == "ln") return Kind::NaturalLog;
    return Kind::None;
}

template<class Failure>
void validate_builtin(const std::string& name, std::size_t positional,
                      std::size_t named, std::size_t spread) {
    if (positional != 1 || named || spread) {
        throw Failure("machine IR math builtin " + name + " requires one argument");
    }
}
} // namespace vkf::math_primitives
