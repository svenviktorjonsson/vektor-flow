#pragma once

#include <array>
#include <string_view>

namespace vkf::stdlib {

enum class ImplementationClass {
    VkfSource,
    Intrinsic,
    RuntimeAbi,
    Mixed,
};

struct ModuleDescriptor {
    std::string_view path;
    std::string_view source;
    ImplementationClass implementation;
    bool native_release;
};

inline constexpr std::array<ModuleDescriptor, 18> modules{{
    {"math", "math.vkf", ImplementationClass::Mixed, true},
    {"stat", "stat.vkf", ImplementationClass::Mixed, true},
    {"random", "random.vkf", ImplementationClass::Mixed, true},
    {"collections", "collections.vkf", ImplementationClass::Mixed, true},
    {"io", "io.vkf", ImplementationClass::Mixed, true},
    {"errors", "errors.vkf", ImplementationClass::Intrinsic, true},
    {"system", "system.vkf", ImplementationClass::Mixed, true},
    {"process", "process.vkf", ImplementationClass::Mixed, true},
    {"regex", "regex.vkf", ImplementationClass::Mixed, true},
    {"time", "time.vkf", ImplementationClass::Mixed, true},
    {"linalg", "linalg.vkf", ImplementationClass::VkfSource, true},
    {"physics", "physics.vkf", ImplementationClass::Mixed, true},
    {"physics.units", "physics/units.vkf", ImplementationClass::Mixed, true},
    {"physics.units.si", "physics/units/si.vkf", ImplementationClass::VkfSource, true},
    {"symbolic", "symbolic.vkf", ImplementationClass::Mixed, true},
    {"events", "events.vkf", ImplementationClass::Mixed, false},
    {"screen", "screen.vkf", ImplementationClass::Mixed, false},
    {"ui", "ui.vkf", ImplementationClass::Mixed, false},
}};

inline const ModuleDescriptor* find(std::string_view path) {
    for (const auto& module : modules) {
        if (module.path == path) return &module;
    }
    return nullptr;
}

inline bool known_but_unavailable(std::string_view path) {
    const auto* module = find(path);
    return module != nullptr && !module->native_release;
}

}  // namespace vkf::stdlib
