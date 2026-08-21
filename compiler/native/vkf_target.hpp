#pragma once

#include <cstdint>

namespace vkf::target {

enum class OperatingSystem : std::uint8_t { Windows, Linux, MacOS };
enum class Architecture : std::uint8_t { X64, Arm64 };
enum class ObjectFormat : std::uint8_t { PE, ELF, MachO };
enum class CallingConvention : std::uint8_t { WindowsX64, SysVX64, AppleArm64 };

struct Contract {
    OperatingSystem operating_system;
    Architecture architecture;
    ObjectFormat object_format;
    CallingConvention calling_convention;
    std::uint8_t f64_argument_registers;
    std::uint8_t stack_alignment;
    std::uint8_t caller_shadow_bytes;
};

constexpr Contract host_x64_contract() {
#if defined(_WIN32)
    return {OperatingSystem::Windows, Architecture::X64, ObjectFormat::PE,
            CallingConvention::WindowsX64, 4, 16, 32};
#elif defined(__APPLE__)
    return {OperatingSystem::MacOS, Architecture::X64, ObjectFormat::MachO,
            CallingConvention::SysVX64, 8, 16, 0};
#else
    return {OperatingSystem::Linux, Architecture::X64, ObjectFormat::ELF,
            CallingConvention::SysVX64, 8, 16, 0};
#endif
}

constexpr Contract macos_arm64_contract() {
    return {OperatingSystem::MacOS, Architecture::Arm64, ObjectFormat::MachO,
            CallingConvention::AppleArm64, 8, 16, 0};
}

constexpr const char* name(OperatingSystem value) {
    return value == OperatingSystem::Windows ? "windows"
        : value == OperatingSystem::Linux ? "linux" : "macos";
}

constexpr const char* name(Architecture value) {
    return value == Architecture::X64 ? "x64" : "arm64";
}

constexpr const char* name(ObjectFormat value) {
    return value == ObjectFormat::PE ? "pe"
        : value == ObjectFormat::ELF ? "elf" : "macho";
}

constexpr const char* name(CallingConvention value) {
    return value == CallingConvention::WindowsX64 ? "windows-x64"
        : value == CallingConvention::SysVX64 ? "sysv-x64" : "apple-arm64";
}

}  // namespace vkf::target
