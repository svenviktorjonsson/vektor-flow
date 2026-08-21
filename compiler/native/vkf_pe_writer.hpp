#pragma once

#include "compiler/native/vkf_machine_ir.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace vkf::pe {

class WriterFailure : public std::runtime_error {
public:
    explicit WriterFailure(const std::string& message) : std::runtime_error(message) {}
};

struct Result {
    std::vector<std::uint8_t> bytes;
    std::uint32_t entry_rva = 0;
    std::uint32_t generated_code_rva = 0;
    std::uint32_t import_rva = 0;
};

struct MathImports {
    bool power = false;
    bool remainder = false;
    bool floor = false;
    bool sin = false;
    bool cos = false;
    bool exp = false;
    bool ln = false;
    bool write = false;
    bool files = false;

    static MathImports all() { return {true, true, true, true, true, true, true, true, true}; }
};

inline MathImports math_imports_for(const vkf::machine_ir::Module& module) {
    MathImports imports;
    const auto inspect = [&](const vkf::machine_ir::Function& function) {
        for (const auto& instruction : function.instructions) {
            using vkf::machine_ir::Opcode;
            imports.power = imports.power || instruction.opcode == Opcode::PowerF64;
            imports.remainder = imports.remainder || instruction.opcode == Opcode::RemainderF64;
            imports.floor = imports.floor || instruction.opcode == Opcode::FloorDivideF64;
            imports.sin = imports.sin || instruction.opcode == Opcode::SinF64;
            imports.cos = imports.cos || instruction.opcode == Opcode::CosF64;
            imports.exp = imports.exp || instruction.opcode == Opcode::ExpF64;
            imports.ln = imports.ln || instruction.opcode == Opcode::LnF64;
            imports.write = imports.write || instruction.opcode == Opcode::WriteString;
            imports.files = imports.files || instruction.opcode == Opcode::ReadFileString ||
                instruction.opcode == Opcode::WriteFileString ||
                instruction.opcode == Opcode::ProcessRun;
        }
    };
    inspect(module.entry);
    for (const auto& function : module.functions) inspect(function);
    return imports;
}

namespace detail {

inline std::uint32_t align_up(std::uint32_t value, std::uint32_t alignment) {
    return (value + alignment - 1) & ~(alignment - 1);
}

class Bytes {
public:
    std::vector<std::uint8_t> values;

    void u8(std::uint8_t value) { values.push_back(value); }
    void u16(std::uint16_t value) { u8(static_cast<std::uint8_t>(value)); u8(static_cast<std::uint8_t>(value >> 8)); }
    void u32(std::uint32_t value) {
        for (unsigned shift = 0; shift < 32; shift += 8) u8(static_cast<std::uint8_t>(value >> shift));
    }
    void u64(std::uint64_t value) {
        for (unsigned shift = 0; shift < 64; shift += 8) u8(static_cast<std::uint8_t>(value >> shift));
    }
    void raw(std::initializer_list<std::uint8_t> bytes) { values.insert(values.end(), bytes); }
    void append(const std::vector<std::uint8_t>& bytes) { values.insert(values.end(), bytes.begin(), bytes.end()); }
    void text(const std::string& value) { values.insert(values.end(), value.begin(), value.end()); }
    void fixed(const std::string& value, std::size_t size) {
        if (value.size() > size) throw WriterFailure("PE fixed string too long");
        text(value); values.resize(values.size() + size - value.size(), 0);
    }
    void pad_to(std::size_t size) {
        if (values.size() > size) throw WriterFailure("PE layout overlap");
        values.resize(size, 0);
    }
    void set_u32(std::size_t offset, std::uint32_t value) {
        if (offset + 4 > values.size()) throw WriterFailure("PE patch outside image");
        for (unsigned shift = 0; shift < 32; shift += 8) values[offset + shift / 8] = static_cast<std::uint8_t>(value >> shift);
    }
};

inline void section_header(Bytes& out, const std::string& name, std::uint32_t virtual_size,
                           std::uint32_t virtual_address, std::uint32_t raw_size,
                           std::uint32_t raw_offset, std::uint32_t characteristics) {
    out.fixed(name, 8); out.u32(virtual_size); out.u32(virtual_address);
    out.u32(raw_size); out.u32(raw_offset); out.u32(0); out.u32(0);
    out.u16(0); out.u16(0); out.u32(characteristics);
}

inline void import_by_name(Bytes& out, const std::string& name) {
    out.u16(0); out.text(name); out.u8(0);
}

}  // namespace detail

inline Result executable_x64(const std::vector<std::uint8_t>& generated_code,
                             const std::vector<std::uint8_t>& string_data = {},
                             bool string_output = false,
                             bool suppress_output = false,
                             std::uint32_t numeric_output_count = 0,
                             MathImports math_imports = MathImports::all(),
                             const std::vector<vkf::machine_ir::OutputKind>& sequence_outputs = {},
                             const std::vector<vkf::machine_ir::OutputToken>& output_tokens = {}) {
    constexpr std::uint64_t image_base = 0x140000000ull;
    constexpr std::uint32_t file_alignment = 0x200;
    constexpr std::uint32_t section_alignment = 0x1000;
    constexpr std::uint32_t headers_size = 0x200;
    constexpr std::uint32_t text_rva = 0x1000;
    const bool display_plan = !output_tokens.empty();
    const bool sequence_output = numeric_output_count > 1 || !sequence_outputs.empty() || display_plan;
    std::uint32_t output_components = numeric_output_count;
    if (display_plan) {
        output_components = 0;
        for (const auto& token : output_tokens) {
            output_components += vkf::machine_ir::output_token_width(token.kind);
        }
    } else if (!sequence_outputs.empty()) {
        output_components = 0;
        for (const auto kind : sequence_outputs) {
            output_components += kind == vkf::machine_ir::OutputKind::String ? 2u : 1u;
        }
    }
    const std::uint32_t sequence_count = display_plan
        ? static_cast<std::uint32_t>(output_tokens.size()) : sequence_outputs.empty()
        ? numeric_output_count : static_cast<std::uint32_t>(sequence_outputs.size());
    const std::uint32_t wrapper_size = 768u + sequence_count * 96u;
    const auto generated_offset = detail::align_up(wrapper_size, 16);
    const std::string numeric_format = "%.17g\n";
    const std::string string_format = "%.*s\n";
    const std::string token_numeric_format = "%.17g";
    const std::string token_string_format = "%.*s";
    const auto numeric_format_offset = detail::align_up(
        generated_offset + static_cast<std::uint32_t>(generated_code.size()), 8);
    const auto string_format_offset = numeric_format_offset +
        static_cast<std::uint32_t>(numeric_format.size() + 1);
    const auto token_numeric_format_offset = string_format_offset +
        static_cast<std::uint32_t>(string_format.size() + 1);
    const auto token_string_format_offset = token_numeric_format_offset +
        static_cast<std::uint32_t>(token_numeric_format.size() + 1);
    const auto text_size = token_string_format_offset +
        static_cast<std::uint32_t>(token_string_format.size() + 1);
    const auto text_raw_size = detail::align_up(text_size, file_alignment);
    const auto rdata_rva = detail::align_up(text_rva + text_size, section_alignment);

    detail::Bytes rdata;
    rdata.values.resize(60, 0);
    const auto msvcrt_lookup = detail::align_up(static_cast<std::uint32_t>(rdata.values.size()), 8);
    struct ImportEntry {
        std::string name;
        std::uint32_t name_offset = 0;
    };
    std::vector<ImportEntry> msvcrt_imports{
        {"printf", 0}, {"_scprintf", 0}, {"sprintf", 0}, {"_localtime64_s", 0}
    };
    if (math_imports.power) msvcrt_imports.push_back({"pow", 0});
    if (math_imports.remainder) msvcrt_imports.push_back({"fmod", 0});
    if (math_imports.floor) msvcrt_imports.push_back({"floor", 0});
    if (math_imports.sin) msvcrt_imports.push_back({"sin", 0});
    if (math_imports.cos) msvcrt_imports.push_back({"cos", 0});
    if (math_imports.exp) msvcrt_imports.push_back({"exp", 0});
    if (math_imports.ln) msvcrt_imports.push_back({"log", 0});
    if (math_imports.write || math_imports.files) msvcrt_imports.push_back({"_write", 0});
    if (math_imports.files) {
        msvcrt_imports.push_back({"_open", 0});
        msvcrt_imports.push_back({"_read", 0});
        msvcrt_imports.push_back({"_close", 0});
        msvcrt_imports.push_back({"_lseek", 0});
    }
    msvcrt_imports.push_back({"_getcwd", 0});
    msvcrt_imports.push_back({"getenv", 0});
    msvcrt_imports.push_back({"strlen", 0});
    msvcrt_imports.push_back({"memcpy", 0});
    msvcrt_imports.push_back({"_tempnam", 0});
    msvcrt_imports.push_back({"_unlink", 0});
    msvcrt_imports.push_back({"fclose", 0});
    msvcrt_imports.push_back({"_dup2", 0});
    msvcrt_imports.push_back({"_dup", 0});
    msvcrt_imports.push_back({"_spawnvp", 0});
    msvcrt_imports.push_back({"malloc", 0});
    msvcrt_imports.push_back({"free", 0});
    msvcrt_imports.push_back({"abort", 0});
    rdata.pad_to(msvcrt_lookup); const auto msvcrt_lookup_patch = rdata.values.size();
    for (std::size_t index = 0; index <= msvcrt_imports.size(); ++index) rdata.u64(0);
    const auto kernel_lookup = static_cast<std::uint32_t>(rdata.values.size());
    std::vector<ImportEntry> kernel_imports{
        {"ExitProcess", 0},
        {"QueryPerformanceCounter", 0},
        {"QueryPerformanceFrequency", 0},
        {"GetSystemTimePreciseAsFileTime", 0},
        {"Sleep", 0},
        {"GetActiveProcessorCount", 0},
    };
    const auto kernel_lookup_patch = rdata.values.size();
    for (std::size_t index = 0; index <= kernel_imports.size(); ++index) rdata.u64(0);
    for (auto& imported : msvcrt_imports) {
        imported.name_offset = detail::align_up(static_cast<std::uint32_t>(rdata.values.size()), 2);
        rdata.pad_to(imported.name_offset);
        detail::import_by_name(rdata, imported.name);
    }
    for (auto& imported : kernel_imports) {
        imported.name_offset = detail::align_up(static_cast<std::uint32_t>(rdata.values.size()), 2);
        rdata.pad_to(imported.name_offset);
        detail::import_by_name(rdata, imported.name);
    }
    const auto msvcrt_name = static_cast<std::uint32_t>(rdata.values.size());
    rdata.text("msvcrt.dll"); rdata.u8(0);
    const auto kernel_name = static_cast<std::uint32_t>(rdata.values.size());
    rdata.text("kernel32.dll"); rdata.u8(0);
    const auto string_offset = detail::align_up(static_cast<std::uint32_t>(rdata.values.size()), 8);
    rdata.pad_to(string_offset); rdata.append(string_data);
    std::vector<std::uint32_t> display_text_offsets(output_tokens.size(), 0);
    for (std::size_t index = 0; index < output_tokens.size(); ++index) {
        if (output_tokens[index].kind != vkf::machine_ir::OutputTokenKind::Text) continue;
        display_text_offsets[index] = static_cast<std::uint32_t>(rdata.values.size());
        rdata.text(output_tokens[index].text);
    }
    const auto true_text_offset = static_cast<std::uint32_t>(rdata.values.size());
    rdata.text("true");
    const auto false_text_offset = static_cast<std::uint32_t>(rdata.values.size());
    rdata.text("false");
    const auto null_text_offset = static_cast<std::uint32_t>(rdata.values.size());
    rdata.text("null");
    const auto idata_rva = detail::align_up(
        rdata_rva + static_cast<std::uint32_t>(rdata.values.size()), section_alignment);
    for (std::size_t index = 0; index < msvcrt_imports.size(); ++index) {
        rdata.set_u32(msvcrt_lookup_patch + index * 8,
                      rdata_rva + msvcrt_imports[index].name_offset);
    }
    for (std::size_t index = 0; index < kernel_imports.size(); ++index) {
        rdata.set_u32(kernel_lookup_patch + index * 8,
                      rdata_rva + kernel_imports[index].name_offset);
    }
    rdata.set_u32(0, rdata_rva + msvcrt_lookup);
    rdata.set_u32(12, rdata_rva + msvcrt_name);
    rdata.set_u32(16, idata_rva);
    rdata.set_u32(20, rdata_rva + kernel_lookup);
    rdata.set_u32(32, rdata_rva + kernel_name);
    const auto kernel_iat_offset = static_cast<std::uint32_t>((msvcrt_imports.size() + 1) * 8);
    rdata.set_u32(36, idata_rva + kernel_iat_offset);

    detail::Bytes idata;
    for (const auto& imported : msvcrt_imports) idata.u64(rdata_rva + imported.name_offset);
    idata.u64(0);
    for (const auto& imported : kernel_imports) idata.u64(rdata_rva + imported.name_offset);
    idata.u64(0);
    const auto rdata_raw_size = detail::align_up(static_cast<std::uint32_t>(rdata.values.size()), file_alignment);
    const auto idata_raw_size = detail::align_up(static_cast<std::uint32_t>(idata.values.size()), file_alignment);
    const auto text_raw_offset = headers_size;
    const auto rdata_raw_offset = text_raw_offset + text_raw_size;
    const auto idata_raw_offset = rdata_raw_offset + rdata_raw_size;
    const auto image_size = detail::align_up(idata_rva + idata_raw_size, section_alignment);

    detail::Bytes out;
    out.u16(0x5a4d); out.values.resize(0x40, 0); out.set_u32(0x3c, 0x80); out.pad_to(0x80);
    out.u32(0x00004550); out.u16(0x8664); out.u16(3); out.u32(0); out.u32(0); out.u32(0);
    out.u16(240); out.u16(0x22);
    out.u16(0x20b); out.u8(0); out.u8(0);
    out.u32(text_raw_size); out.u32(rdata_raw_size + idata_raw_size); out.u32(0);
    out.u32(text_rva); out.u32(text_rva); out.u64(image_base);
    out.u32(section_alignment); out.u32(file_alignment);
    out.u16(6); out.u16(0); out.u16(0); out.u16(0); out.u16(6); out.u16(0);
    out.u32(0); out.u32(image_size); out.u32(headers_size); out.u32(0);
    out.u16(3); out.u16(0x100);
    out.u64(0x100000); out.u64(0x1000); out.u64(0x100000); out.u64(0x1000);
    out.u32(0); out.u32(16);
    for (unsigned index = 0; index < 16; ++index) {
        if (index == 1) { out.u32(rdata_rva); out.u32(60); }
        else if (index == 12) {
            out.u32(idata_rva);
            out.u32(static_cast<std::uint32_t>(idata.values.size()));
        }
        else { out.u32(0); out.u32(0); }
    }
    detail::section_header(out, ".text", text_size, text_rva, text_raw_size,
                           text_raw_offset, 0x60000020u);
    detail::section_header(out, ".rdata", static_cast<std::uint32_t>(rdata.values.size()), rdata_rva,
                           rdata_raw_size, rdata_raw_offset, 0x40000040u);
    detail::section_header(out, ".idata", static_cast<std::uint32_t>(idata.values.size()), idata_rva,
                           idata_raw_size, idata_raw_offset, 0xc0000040u);
    if (out.values.size() != headers_size) throw WriterFailure("invalid PE header size");

    const auto imported_iat = [&](const std::string& name) -> std::uint64_t {
        for (std::size_t index = 0; index < msvcrt_imports.size(); ++index) {
            if (msvcrt_imports[index].name == name) return image_base + idata_rva + index * 8;
        }
        return 0;
    };
    const auto printf_iat = imported_iat("printf");
    const auto scprintf_iat = imported_iat("_scprintf");
    const auto sprintf_iat = imported_iat("sprintf");
    const auto pow_iat = imported_iat("pow");
    const auto fmod_iat = imported_iat("fmod");
    const auto floor_iat = imported_iat("floor");
    const auto sin_iat = imported_iat("sin");
    const auto cos_iat = imported_iat("cos");
    const auto exp_iat = imported_iat("exp");
    const auto ln_iat = imported_iat("log");
    const auto write_iat = imported_iat("_write");
    const auto open_iat = imported_iat("_open");
    const auto read_iat = imported_iat("_read");
    const auto close_iat = imported_iat("_close");
    const auto lseek_iat = imported_iat("_lseek");
    const auto malloc_iat = imported_iat("malloc");
    const auto free_iat = imported_iat("free");
    const auto abort_iat = imported_iat("abort");
    const auto localtime_iat = imported_iat("_localtime64_s");
    const auto getcwd_iat = imported_iat("_getcwd");
    const auto getenv_iat = imported_iat("getenv");
    const auto strlen_iat = imported_iat("strlen");
    const auto memcpy_iat = imported_iat("memcpy");
    const auto tempnam_iat = imported_iat("_tempnam");
    const auto unlink_iat = imported_iat("_unlink");
    const auto fclose_iat = imported_iat("fclose");
    const auto dup2_iat = imported_iat("_dup2");
    const auto dup_iat = imported_iat("_dup");
    const auto spawnvp_iat = imported_iat("_spawnvp");
    const auto imported_kernel_iat = [&](const std::string& name) -> std::uint64_t {
        for (std::size_t index = 0; index < kernel_imports.size(); ++index) {
            if (kernel_imports[index].name == name) {
                return image_base + idata_rva + kernel_iat_offset + index * 8;
            }
        }
        return 0;
    };
    const auto exit_iat = imported_kernel_iat("ExitProcess");
    const auto performance_counter_iat = imported_kernel_iat("QueryPerformanceCounter");
    const auto performance_frequency_iat = imported_kernel_iat("QueryPerformanceFrequency");
    const auto wall_time_iat = imported_kernel_iat("GetSystemTimePreciseAsFileTime");
    const auto sleep_iat = imported_kernel_iat("Sleep");
    const auto cpu_count_iat = imported_kernel_iat("GetActiveProcessorCount");
    const auto wrapper_start = out.values.size();
    const auto emit_display_plan = [&]() {
        std::uint32_t component = 0;
        const auto emit_text_value = [&](std::uint64_t address, std::uint32_t length) {
            out.raw({0x49, 0xb8}); out.u64(address);
            out.raw({0xba}); out.u32(length);
            out.raw({0x48, 0xb9}); out.u64(image_base + text_rva + token_string_format_offset);
            out.raw({0x49, 0xbb}); out.u64(printf_iat);
            out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
        };
        for (std::size_t index = 0; index < output_tokens.size(); ++index) {
            const auto& token = output_tokens[index];
            if (token.kind == vkf::machine_ir::OutputTokenKind::Text) {
                emit_text_value(
                    image_base + rdata_rva + display_text_offsets[index],
                    static_cast<std::uint32_t>(token.text.size()));
                continue;
            }
            if (token.kind == vkf::machine_ir::OutputTokenKind::Null) {
                emit_text_value(image_base + rdata_rva + null_text_offset, 4);
                ++component;
                continue;
            }
            if (token.kind == vkf::machine_ir::OutputTokenKind::Bit) {
                out.raw({0xf2, 0x41, 0x0f, 0x10, 0x8c, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
                out.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc1});
                out.raw({0x49, 0xb8}); out.u64(image_base + rdata_rva + true_text_offset);
                out.raw({0xba}); out.u32(4);
                out.raw({0x48, 0x85, 0xc0, 0x75, 0x0f});
                out.raw({0x49, 0xb8}); out.u64(image_base + rdata_rva + false_text_offset);
                out.raw({0xba}); out.u32(5);
                out.raw({0x48, 0xb9}); out.u64(image_base + text_rva + token_string_format_offset);
                out.raw({0x49, 0xbb}); out.u64(printf_iat);
                out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
                ++component;
                continue;
            }
            if (token.kind == vkf::machine_ir::OutputTokenKind::String) {
                out.raw({0xf2, 0x41, 0x0f, 0x10, 0x84, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
                out.raw({0xf2, 0x41, 0x0f, 0x10, 0x8c, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + (component + 1u) * 8u);
                out.raw({0x66, 0x48, 0x0f, 0x7e, 0xc6, 0xf2, 0x48, 0x0f, 0x2c, 0xf9,
                         0x49, 0x89, 0xf0, 0x48, 0x89, 0xfa, 0x48, 0x85, 0xd2, 0x79, 0x06,
                         0x48, 0xf7, 0xda, 0x48, 0xff, 0xca, 0x48, 0xb9});
                out.u64(image_base + text_rva + token_string_format_offset);
                out.raw({0x49, 0xbb}); out.u64(printf_iat);
                out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
                out.raw({0x48, 0x85, 0xff, 0x79, 0x17, 0x48, 0x89, 0xf1, 0x48, 0x83, 0xe9, 0x08, 0x49, 0xbb});
                out.u64(free_iat);
                out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
                component += 2;
                continue;
            }
            out.raw({0xf2, 0x41, 0x0f, 0x10, 0x8c, 0x24});
            out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
            out.raw({0x66, 0x48, 0x0f, 0x7e, 0xca, 0x48, 0xb9});
            out.u64(image_base + text_rva + token_numeric_format_offset);
            out.raw({0x49, 0xbb}); out.u64(printf_iat);
            out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
            ++component;
        }
    };
    if (sequence_output) {
        const std::uint32_t required = std::max(
            0x138u,
            0x20u + vkf::machine_ir::runtime_output_base + output_components * 8u);
        std::uint32_t frame_bytes = detail::align_up(required, 16u);
        if ((frame_bytes & 15u) == 0) frame_bytes += 8u;
        out.raw({0x48, 0x81, 0xec}); out.u32(frame_bytes);
    } else {
        out.raw({0x48, 0x81, 0xec}); out.u32(0x138);
    }
    const auto emit_runtime_import = [&](std::uint64_t iat, std::uint32_t offset) {
        if (iat != 0) {
            out.raw({0x48, 0xb8}); out.u64(iat);
            out.raw({0x48, 0x8b, 0x00});
        } else {
            out.raw({0x31, 0xc0});
        }
        if (offset <= 0x7f) {
            out.raw({0x48, 0x89, 0x44, 0x24, static_cast<std::uint8_t>(offset)});
        }
        else { out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(offset); }
    };
    emit_runtime_import(pow_iat, 0x20);
    emit_runtime_import(fmod_iat, 0x28);
    emit_runtime_import(floor_iat, 0x30);
    emit_runtime_import(ln_iat, 0x38);
    emit_runtime_import(sin_iat, 0x40);
    emit_runtime_import(cos_iat, 0x48);
    emit_runtime_import(exp_iat, 0x50);
    out.raw({0x48, 0xb8}); out.u64(image_base + rdata_rva + string_offset);
    out.raw({0x48, 0x89, 0x44, 0x24, 0x58});
    out.raw({0x48, 0xb8}); out.u64(malloc_iat);
    out.raw({0x48, 0x8b, 0x00, 0x48, 0x89, 0x44, 0x24, 0x60});
    out.raw({0x48, 0xb8}); out.u64(free_iat);
    out.raw({0x48, 0x8b, 0x00, 0x48, 0x89, 0x44, 0x24, 0x68});
    out.raw({0x48, 0xb8}); out.u64(abort_iat);
    out.raw({0x48, 0x8b, 0x00, 0x48, 0x89, 0x44, 0x24, 0x70});
    emit_runtime_import(scprintf_iat, 0x78);
    emit_runtime_import(sprintf_iat, 0x80);
    emit_runtime_import(write_iat, 0x88);
    emit_runtime_import(exit_iat, 0x90);
    emit_runtime_import(performance_counter_iat, 0x98);
    emit_runtime_import(performance_frequency_iat, 0xa0);
    emit_runtime_import(wall_time_iat, 0xa8);
    emit_runtime_import(sleep_iat, 0xb0);
    emit_runtime_import(localtime_iat, 0xb8);
    emit_runtime_import(open_iat, 0xc0);
    emit_runtime_import(read_iat, 0xc8);
    emit_runtime_import(close_iat, 0xd0);
    emit_runtime_import(lseek_iat, 0xd8);
    emit_runtime_import(cpu_count_iat, 0xe0);
    emit_runtime_import(getcwd_iat, 0xe8);
    emit_runtime_import(getenv_iat, 0xf0);
    emit_runtime_import(strlen_iat, 0xf8);
    emit_runtime_import(memcpy_iat, 0x100);
    emit_runtime_import(tempnam_iat, 0x108);
    emit_runtime_import(unlink_iat, 0x110);
    emit_runtime_import(fclose_iat, 0x118);
    emit_runtime_import(dup2_iat, 0x120);
    emit_runtime_import(dup_iat, 0x128);
    emit_runtime_import(spawnvp_iat, 0x130);
    if (sequence_output) {
        out.raw({0x4c, 0x8d, 0x64, 0x24, 0x20, 0x4c, 0x89, 0xe1, 0xe8});
    } else {
        out.raw({0x48, 0x8d, 0x4c, 0x24, 0x20, 0xe8});
    }
    const auto call_patch = out.values.size(); out.u32(0);
    if (display_plan) {
        emit_display_plan();
    } else if (sequence_output) {
        std::uint32_t component = 0;
        for (std::uint32_t index = 0; index < sequence_count; ++index) {
            const auto kind = sequence_outputs.empty()
                ? vkf::machine_ir::OutputKind::F64 : sequence_outputs[index];
            if (kind == vkf::machine_ir::OutputKind::String) {
                out.raw({0xf2, 0x41, 0x0f, 0x10, 0x84, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
                out.raw({0xf2, 0x41, 0x0f, 0x10, 0x8c, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + (component + 1u) * 8u);
                out.raw({0x66, 0x48, 0x0f, 0x7e, 0xc6, 0xf2, 0x48, 0x0f, 0x2c, 0xf9,
                         0x49, 0x89, 0xf0, 0x48, 0x89, 0xfa, 0x48, 0x85, 0xd2, 0x79, 0x06,
                         0x48, 0xf7, 0xda, 0x48, 0xff, 0xca, 0x48, 0xb9});
                out.u64(image_base + text_rva + string_format_offset);
                out.raw({0x49, 0xbb}); out.u64(printf_iat);
                out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
                out.raw({0x48, 0x85, 0xff, 0x79, 0x17, 0x48, 0x89, 0xf1, 0x48, 0x83, 0xe9, 0x08, 0x49, 0xbb});
                out.u64(free_iat);
                out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
                component += 2;
                continue;
            }
            out.raw({0xf2, 0x41, 0x0f, 0x10, 0x8c, 0x24});
            out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
            out.raw({0x66, 0x48, 0x0f, 0x7e, 0xca, 0x48, 0xb9});
            out.u64(image_base + text_rva + numeric_format_offset);
            out.raw({0x49, 0xbb}); out.u64(printf_iat);
            out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
            ++component;
        }
    } else if (!suppress_output && string_output) {
        out.raw({0x66, 0x48, 0x0f, 0x7e, 0xc6, 0xf2, 0x48, 0x0f, 0x2c, 0xf9,
                 0x49, 0x89, 0xf0, 0x48, 0x89, 0xfa, 0x48, 0x85, 0xd2, 0x79, 0x06,
                 0x48, 0xf7, 0xda, 0x48, 0xff, 0xca});
    } else if (!suppress_output) {
        out.raw({0x66, 0x0f, 0x28, 0xc8, 0x66, 0x48, 0x0f, 0x7e, 0xc2});
    }
    if (!suppress_output && !sequence_output) {
        out.raw({0x48, 0xb9}); out.u64(image_base + text_rva +
            (string_output ? string_format_offset : numeric_format_offset));
        out.raw({0x49, 0xbb}); out.u64(printf_iat); out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
    }
    if (!suppress_output && string_output) {
        out.raw({0x48, 0x85, 0xff, 0x79, 0x17, 0x48, 0x89, 0xf1, 0x48, 0x83, 0xe9, 0x08, 0x49, 0xbb});
        out.u64(free_iat);
        out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
    }
    out.raw({0x31, 0xc9, 0x49, 0xbb}); out.u64(exit_iat);
    out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3, 0xcc});
    if (out.values.size() - wrapper_start > wrapper_size) throw WriterFailure("invalid PE wrapper size");
    out.values.resize(wrapper_start + wrapper_size, 0x90);
    const auto call_return = call_patch + 4 - text_raw_offset;
    out.set_u32(call_patch, generated_offset - call_return);
    out.pad_to(text_raw_offset + generated_offset); out.append(generated_code);
    out.pad_to(text_raw_offset + numeric_format_offset); out.text(numeric_format); out.u8(0);
    out.pad_to(text_raw_offset + string_format_offset); out.text(string_format); out.u8(0);
    out.pad_to(text_raw_offset + token_numeric_format_offset); out.text(token_numeric_format); out.u8(0);
    out.pad_to(text_raw_offset + token_string_format_offset); out.text(token_string_format); out.u8(0);
    out.pad_to(text_raw_offset + text_raw_size);
    out.append(rdata.values); out.pad_to(rdata_raw_offset + rdata_raw_size);
    out.append(idata.values); out.pad_to(idata_raw_offset + idata_raw_size);
    return {std::move(out.values), text_rva, text_rva + generated_offset, rdata_rva};
}

}  // namespace vkf::pe
