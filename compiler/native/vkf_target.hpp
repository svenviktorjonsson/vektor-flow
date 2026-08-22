#pragma once

#include <cstdint>
#include <string_view>

#if defined(_M_X64)
#include <intrin.h>
#endif

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

inline bool host_x64_supports_avx2() {
#if defined(_M_X64)
    int registers[4]{};
    __cpuid(registers, 0);
    if (registers[0] < 7) return false;
    __cpuid(registers, 1);
    constexpr int osxsave = 1 << 27;
    constexpr int avx = 1 << 28;
    if ((registers[2] & (osxsave | avx)) != (osxsave | avx) ||
        (_xgetbv(0) & 0x6) != 0x6) {
        return false;
    }
    __cpuidex(registers, 7, 0);
    return (registers[1] & (1 << 5)) != 0;
#elif defined(__x86_64__) && (defined(__GNUC__) || defined(__clang__))
    __builtin_cpu_init();
    return __builtin_cpu_supports("avx2");
#else
    return false;
#endif
}

inline bool host_x64_supports_fma() {
#if defined(_M_X64)
    int registers[4]{};
    __cpuid(registers, 1);
    constexpr int fma = 1 << 12;
    constexpr int osxsave = 1 << 27;
    constexpr int avx = 1 << 28;
    return (registers[2] & (fma | osxsave | avx)) == (fma | osxsave | avx) &&
        (_xgetbv(0) & 0x6) == 0x6;
#elif defined(__x86_64__) && (defined(__GNUC__) || defined(__clang__))
    __builtin_cpu_init();
    return __builtin_cpu_supports("fma");
#else
    return false;
#endif
}

inline std::string_view host_x64_feature_key() {
    return host_x64_supports_avx2() && host_x64_supports_fma()
        ? "x64-avx2-fma"
        : host_x64_supports_avx2() ? "x64-avx2" : "x64-sse2";
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
