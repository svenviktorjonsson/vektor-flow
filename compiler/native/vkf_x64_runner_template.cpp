#ifdef _WIN32
#pragma section(".vkfcod", read, execute)
#pragma comment(linker, "/SECTION:.vkfcod,ER")
#pragma comment(linker, "/ENTRY:mainCRTStartup")
#pragma comment(linker, "/SUBSYSTEM:CONSOLE")
#pragma comment(lib, "kernel32.lib")
#pragma comment(lib, "msvcrt.lib")
extern "C" int __cdecl printf(const char*, ...);
extern "C" __declspec(dllimport) __declspec(noreturn) void __stdcall ExitProcess(unsigned long);
extern "C" int _fltused = 0;
extern "C" __declspec(allocate(".vkfcod")) unsigned char vkf_entry_blob[32768] = {
    0x56, 0x4b, 0x46, 0x58, 0x36, 0x34, 0x41, 0x4f,
    0x54, 0x43, 0x4f, 0x44, 0x45, 0x30, 0x30, 0x31,
};
#else
#include <cmath>
#include <cstdio>
extern "C" unsigned char vkf_entry_blob[];
asm(
    ".section .vkfcod,\"ax\",@progbits\n"
    ".balign 16\n"
    ".global vkf_entry_blob\n"
    ".type vkf_entry_blob,@object\n"
    "vkf_entry_blob:\n"
    ".byte 0x56,0x4b,0x46,0x58,0x36,0x34,0x41,0x4f\n"
    ".byte 0x54,0x43,0x4f,0x44,0x45,0x30,0x30,0x31\n"
    ".zero 32752,0\n"
    ".size vkf_entry_blob,.-vkf_entry_blob\n"
    ".previous\n"
);
#endif

#ifdef _WIN32
extern "C" double __cdecl pow(double, double);
extern "C" double __cdecl fmod(double, double);
extern "C" double __cdecl floor(double);
extern "C" double __cdecl log(double);
extern "C" double __cdecl sin(double);
extern "C" double __cdecl cos(double);
extern "C" double __cdecl exp(double);
#endif

struct VkfRuntimeV4 {
    double (*power_f64)(double, double);
    double (*remainder_f64)(double, double);
    double (*floor_f64)(double);
    double (*ln_f64)(double);
    double (*sin_f64)(double);
    double (*cos_f64)(double);
    double (*exp_f64)(double);
};

static double vkf_power_f64(double base, double exponent) {
#ifdef _WIN32
    return pow(base, exponent);
#else
    return std::pow(base, exponent);
#endif
}

static double vkf_floor_f64(double value) {
#ifdef _WIN32
    return floor(value);
#else
    return std::floor(value);
#endif
}

static double vkf_ln_f64(double value) {
#ifdef _WIN32
    return log(value);
#else
    return std::log(value);
#endif
}

static double vkf_sin_f64(double value) {
#ifdef _WIN32
    return sin(value);
#else
    return std::sin(value);
#endif
}

static double vkf_cos_f64(double value) {
#ifdef _WIN32
    return cos(value);
#else
    return std::cos(value);
#endif
}

static double vkf_exp_f64(double value) {
#ifdef _WIN32
    return exp(value);
#else
    return std::exp(value);
#endif
}

static double vkf_remainder_f64(double left, double right) {
#ifdef _WIN32
    return fmod(left, right);
#else
    return std::fmod(left, right);
#endif
}

#ifdef _WIN32
extern "C" void mainCRTStartup() {
#else
int main() {
#endif
    VkfRuntimeV4 runtime;
    runtime.power_f64 = vkf_power_f64;
    runtime.remainder_f64 = vkf_remainder_f64;
    runtime.floor_f64 = vkf_floor_f64;
    runtime.ln_f64 = vkf_ln_f64;
    runtime.sin_f64 = vkf_sin_f64;
    runtime.cos_f64 = vkf_cos_f64;
    runtime.exp_f64 = vkf_exp_f64;
    using Entry = double (*)(const VkfRuntimeV4*);
    const auto address = reinterpret_cast<unsigned long long>(vkf_entry_blob);
    const double value = reinterpret_cast<Entry>(address)(&runtime);
    printf("%.17g\n", value);
#ifdef _WIN32
    ExitProcess(0);
#else
    return 0;
#endif
}
