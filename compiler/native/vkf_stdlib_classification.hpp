#pragma once

#include <string_view>

namespace vkf::stdlib {

enum class CallFamily {
    MathUnary,
    Statistics,
    Output,
    Collection,
    BrowserCapability,
    Unsupported,
};

inline CallFamily classify_call(std::string_view name) {
    const auto starts_with = [name](std::string_view prefix) {
        return name.size() >= prefix.size() && name.substr(0, prefix.size()) == prefix;
    };
    if (name == "math.sin" || name == "math.cos" || name == "math.tan"
        || name == "math.sqrt" || name == "math.abs"
        || name == "math.ln" || name == "math.log" || name == "math.exp") {
        return CallFamily::MathUnary;
    }
    if (name == "stat.sum" || name == "stat.mean" || name == "stat.variance"
        || name == "stat.std" || name == "stat.range" || name == "stat.count") {
        return CallFamily::Statistics;
    }
    if (name == "io.print") return CallFamily::Output;
    if (name == "collections.list") return CallFamily::Collection;
    if (starts_with("time.") || starts_with("io.")
        || starts_with("system.") || starts_with("process.")) {
        return CallFamily::BrowserCapability;
    }
    return CallFamily::Unsupported;
}

} // namespace vkf::stdlib
