#pragma once

#include "compiler/native/vkf_machine_ir.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

namespace vkf::elf {

class WriterFailure : public std::runtime_error {
public:
    explicit WriterFailure(const std::string& message) : std::runtime_error(message) {}
};

struct Result {
    std::vector<std::uint8_t> bytes;
    std::uint64_t entry_address = 0;
    std::uint32_t generated_code_offset = 0;
    std::uint32_t dynamic_offset = 0;
};

namespace detail {

inline std::uint32_t align_up(std::uint32_t value, std::uint32_t alignment) {
    return (value + alignment - 1) & ~(alignment - 1);
}

class Bytes {
public:
    std::vector<std::uint8_t> values;

    void u8(std::uint8_t value) { values.push_back(value); }
    void u16(std::uint16_t value) {
        u8(static_cast<std::uint8_t>(value)); u8(static_cast<std::uint8_t>(value >> 8));
    }
    void u32(std::uint32_t value) {
        for (unsigned shift = 0; shift < 32; shift += 8) u8(static_cast<std::uint8_t>(value >> shift));
    }
    void u64(std::uint64_t value) {
        for (unsigned shift = 0; shift < 64; shift += 8) u8(static_cast<std::uint8_t>(value >> shift));
    }
    void raw(std::initializer_list<std::uint8_t> bytes) { values.insert(values.end(), bytes); }
    void append(const std::vector<std::uint8_t>& bytes) { values.insert(values.end(), bytes.begin(), bytes.end()); }
    void text(const std::string& value) { values.insert(values.end(), value.begin(), value.end()); }
    void pad_to(std::size_t offset) {
        if (values.size() > offset) throw WriterFailure("ELF layout overlap");
        values.resize(offset, 0);
    }
    void set_u32(std::size_t offset, std::uint32_t value) {
        if (offset + 4 > values.size()) throw WriterFailure("ELF patch outside image");
        for (unsigned shift = 0; shift < 32; shift += 8) values[offset + shift / 8] = static_cast<std::uint8_t>(value >> shift);
    }
    void set_u64(std::size_t offset, std::uint64_t value) {
        if (offset + 8 > values.size()) throw WriterFailure("ELF patch outside image");
        for (unsigned shift = 0; shift < 64; shift += 8) values[offset + shift / 8] = static_cast<std::uint8_t>(value >> shift);
    }
};

inline void program_header(Bytes& out, std::uint32_t type, std::uint32_t flags,
                           std::uint64_t offset, std::uint64_t address,
                           std::uint64_t file_size, std::uint64_t memory_size,
                           std::uint64_t alignment) {
    out.u32(type); out.u32(flags); out.u64(offset); out.u64(address);
    out.u64(address); out.u64(file_size); out.u64(memory_size); out.u64(alignment);
}

inline void dynamic_entry(Bytes& out, std::uint64_t tag, std::uint64_t value) {
    out.u64(tag); out.u64(value);
}

inline void symbol(Bytes& out, std::uint32_t name) {
    out.u32(name); out.u8(0x12); out.u8(0); out.u16(0); out.u64(0); out.u64(0);
}

inline void relocation(Bytes& out, std::uint64_t address, std::uint32_t symbol_index) {
    out.u64(address); out.u64((static_cast<std::uint64_t>(symbol_index) << 32) | 6u); out.u64(0);
}

}  // namespace detail

inline Result minimal_numeric_executable_x64(
    const std::vector<std::uint8_t>& generated_code
) {
    constexpr std::uint64_t base = 0x400000;
    constexpr std::uint32_t elf_header_size = 64;
    constexpr std::uint32_t program_header_size = 56;
    constexpr std::uint16_t program_header_count = 6;
    constexpr std::uint32_t headers_end =
        elf_header_size + program_header_size * program_header_count;
    constexpr std::uint32_t wrapper_size = 256;
    const std::string interpreter = "/lib64/ld-linux-x86-64.so.2";
    const auto interpreter_offset = headers_end;
    const auto wrapper_offset = detail::align_up(
        interpreter_offset + static_cast<std::uint32_t>(interpreter.size() + 1), 16);
    const auto generated_offset = detail::align_up(wrapper_offset + wrapper_size, 16);
    const std::string numeric_format = "%.17g\n";
    const auto numeric_format_offset = detail::align_up(
        generated_offset + static_cast<std::uint32_t>(generated_code.size()), 8);
    const auto text_end = numeric_format_offset +
        static_cast<std::uint32_t>(numeric_format.size() + 1);
    const auto data_offset = detail::align_up(text_end, 4096);

    static constexpr char string_bytes[] = "\0libc.so.6\0sprintf\0";
    const std::string strings(string_bytes, sizeof(string_bytes) - 1);
    constexpr std::uint32_t libc_name = 1;
    constexpr std::uint32_t sprintf_name = 11;
    const auto dynstr_offset = data_offset;
    const auto dynsym_offset = detail::align_up(
        dynstr_offset + static_cast<std::uint32_t>(strings.size()), 8);
    const auto hash_offset = detail::align_up(dynsym_offset + 2u * 24u, 4);
    const auto rela_offset = detail::align_up(hash_offset + 5u * 4u, 8);
    const auto got_offset = detail::align_up(rela_offset + 24u, 8);
    const auto dynamic_offset = detail::align_up(got_offset + 8u, 8);
    constexpr std::uint32_t dynamic_entries = 12;
    const auto data_end = dynamic_offset + dynamic_entries * 16u;
    const auto address = [=](std::uint32_t offset) { return base + offset; };
    const auto sprintf_got = address(got_offset);

    detail::Bytes out;
    out.raw({0x7f, 'E', 'L', 'F', 2, 1, 1, 0});
    out.values.resize(16, 0);
    out.u16(2); out.u16(62); out.u32(1); out.u64(address(wrapper_offset));
    out.u64(elf_header_size); out.u64(0); out.u32(0);
    out.u16(elf_header_size); out.u16(program_header_size); out.u16(program_header_count);
    out.u16(64); out.u16(0); out.u16(0);

    detail::program_header(out, 6, 4, elf_header_size, address(elf_header_size),
                           program_header_size * program_header_count,
                           program_header_size * program_header_count, 8);
    detail::program_header(out, 3, 4, interpreter_offset, address(interpreter_offset),
                           interpreter.size() + 1, interpreter.size() + 1, 1);
    detail::program_header(out, 1, 5, 0, base, text_end, text_end, 4096);
    detail::program_header(out, 1, 6, data_offset, address(data_offset),
                           data_end - data_offset, data_end - data_offset, 4096);
    detail::program_header(out, 2, 6, dynamic_offset, address(dynamic_offset),
                           dynamic_entries * 16u, dynamic_entries * 16u, 8);
    detail::program_header(out, 0x6474e551u, 6, 0, 0, 0, 0, 16);

    out.pad_to(interpreter_offset); out.text(interpreter); out.u8(0);
    out.pad_to(wrapper_offset);
    const auto wrapper_start = out.values.size();
    out.raw({0x48, 0x81, 0xec}); out.u32(0x90);
    out.raw({0x48, 0x89, 0xe7, 0xe8});
    const auto call_patch = out.values.size(); out.u32(0);
    out.raw({0x48, 0x8d, 0x7c, 0x24, 0x10, 0x48, 0xbe});
    out.u64(address(numeric_format_offset));
    out.raw({0xb8, 0x01, 0x00, 0x00, 0x00});
    out.raw({0x49, 0xbb}); out.u64(sprintf_got);
    out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
    out.raw({0x89, 0xc2, 0x48, 0x8d, 0x74, 0x24, 0x10});
    out.raw({0xbf, 0x01, 0x00, 0x00, 0x00, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
    out.raw({0xb8, 0x3c, 0x00, 0x00, 0x00, 0x31, 0xff, 0x0f, 0x05});
    if (out.values.size() - wrapper_start > wrapper_size) {
        throw WriterFailure("minimal numeric ELF wrapper overflow");
    }
    out.values.resize(wrapper_start + wrapper_size, 0x90);
    const auto return_address = call_patch + 4;
    out.set_u32(call_patch, static_cast<std::uint32_t>(generated_offset - return_address));
    out.pad_to(generated_offset); out.append(generated_code);
    out.pad_to(numeric_format_offset); out.text(numeric_format); out.u8(0);

    out.pad_to(dynstr_offset); out.text(strings);
    out.pad_to(dynsym_offset); out.values.resize(out.values.size() + 24, 0);
    detail::symbol(out, sprintf_name);
    out.pad_to(hash_offset);
    out.u32(1); out.u32(2); out.u32(1); out.u32(0); out.u32(0);
    out.pad_to(rela_offset); detail::relocation(out, sprintf_got, 1);
    out.pad_to(got_offset); out.u64(0);
    out.pad_to(dynamic_offset);
    detail::dynamic_entry(out, 1, libc_name);
    detail::dynamic_entry(out, 4, address(hash_offset));
    detail::dynamic_entry(out, 5, address(dynstr_offset));
    detail::dynamic_entry(out, 6, address(dynsym_offset));
    detail::dynamic_entry(out, 7, address(rela_offset));
    detail::dynamic_entry(out, 8, 24);
    detail::dynamic_entry(out, 9, 24);
    detail::dynamic_entry(out, 10, strings.size());
    detail::dynamic_entry(out, 11, 24);
    detail::dynamic_entry(out, 0x6ffffffbu, 1);
    detail::dynamic_entry(out, 21, 0);
    detail::dynamic_entry(out, 0, 0);
    if (out.values.size() != data_end) throw WriterFailure("invalid minimal numeric ELF size");
    return {std::move(out.values), address(wrapper_offset), generated_offset, dynamic_offset};
}

inline Result executable_x64(const std::vector<std::uint8_t>& generated_code,
                             const std::vector<std::uint8_t>& string_data = {},
                             bool string_output = false,
                             bool suppress_output = false,
                             std::uint32_t numeric_output_count = 0,
                             const std::vector<vkf::machine_ir::OutputKind>& sequence_outputs = {},
                             const std::vector<vkf::machine_ir::OutputToken>& output_tokens = {}) {
    constexpr std::uint64_t base = 0x400000;
    constexpr std::uint32_t elf_header_size = 64;
    constexpr std::uint32_t program_header_size = 56;
    constexpr std::uint16_t program_header_count = 6;
    constexpr std::uint32_t headers_end = elf_header_size + program_header_size * program_header_count;
    constexpr std::uint32_t interpreter_offset = headers_end;
    const std::string interpreter = "/lib64/ld-linux-x86-64.so.2";
    const auto wrapper_offset = detail::align_up(
        interpreter_offset + static_cast<std::uint32_t>(interpreter.size() + 1), 16);
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
    const std::uint32_t wrapper_size = 768u + sequence_count * 128u;
    const auto generated_offset = detail::align_up(wrapper_offset + wrapper_size, 16);
    const std::string numeric_format = "%.17g\n";
    const std::string token_numeric_format = "%.17g";
    const std::string newline = "\n";
    const auto numeric_format_offset = detail::align_up(
        generated_offset + static_cast<std::uint32_t>(generated_code.size()), 8);
    const auto newline_offset = numeric_format_offset +
        static_cast<std::uint32_t>(numeric_format.size() + 1);
    const auto token_numeric_format_offset = newline_offset +
        static_cast<std::uint32_t>(newline.size() + 1);
    const auto string_offset = detail::align_up(
        token_numeric_format_offset + static_cast<std::uint32_t>(token_numeric_format.size() + 1), 8);
    std::vector<std::uint32_t> display_text_offsets(output_tokens.size(), 0);
    std::vector<std::uint8_t> display_data;
    for (std::size_t index = 0; index < output_tokens.size(); ++index) {
        if (output_tokens[index].kind != vkf::machine_ir::OutputTokenKind::Text) continue;
        display_text_offsets[index] = static_cast<std::uint32_t>(display_data.size());
        display_data.insert(display_data.end(), output_tokens[index].text.begin(), output_tokens[index].text.end());
    }
    const auto true_text_offset = static_cast<std::uint32_t>(display_data.size());
    display_data.insert(display_data.end(), {'t', 'r', 'u', 'e'});
    const auto false_text_offset = static_cast<std::uint32_t>(display_data.size());
    display_data.insert(display_data.end(), {'f', 'a', 'l', 's', 'e'});
    const auto null_text_offset = static_cast<std::uint32_t>(display_data.size());
    display_data.insert(display_data.end(), {'n', 'u', 'l', 'l'});
    const auto display_data_offset =
        string_offset + static_cast<std::uint32_t>(string_data.size());
    const auto text_end = display_data_offset + static_cast<std::uint32_t>(display_data.size());
    const auto data_offset = detail::align_up(text_end, 4096);

    static constexpr char string_bytes[] =
        "\0libc.so.6\0libm.so.6\0snprintf\0pow\0fmod\0floor\0log\0\0sin\0cos\0exp\0malloc\0free\0abort\0exit\0clock_gettime\0nanosleep\0localtime_r\0sysconf\0getcwd\0getenv\0strlen\0memcpy\0tmpfile\0fileno\0fclose\0dup2\0fork\0execvp\0waitpid\0_exit\0";
    const std::string strings(string_bytes, sizeof(string_bytes) - 1);
    constexpr std::uint32_t libc_name = 1;
    constexpr std::uint32_t libm_name = 11;
    constexpr std::uint32_t snprintf_name = 21;
    constexpr std::uint32_t pow_name = 30;
    constexpr std::uint32_t fmod_name = 34;
    constexpr std::uint32_t floor_name = 39;
    constexpr std::uint32_t log_name = 45;
    constexpr std::uint32_t sin_name = 50;
    constexpr std::uint32_t cos_name = 54;
    constexpr std::uint32_t exp_name = 58;
    constexpr std::uint32_t malloc_name = 62;
    constexpr std::uint32_t free_name = 69;
    constexpr std::uint32_t abort_name = 74;
    constexpr std::uint32_t exit_name = 80;
    constexpr std::uint32_t clock_gettime_name = 85;
    constexpr std::uint32_t nanosleep_name = 99;
    constexpr std::uint32_t localtime_name = 109;
    constexpr std::uint32_t sysconf_name = 121;
    constexpr std::uint32_t getcwd_name = 129;
    constexpr std::uint32_t getenv_name = 136;
    constexpr std::uint32_t strlen_name = 143;
    constexpr std::uint32_t memcpy_name = 150;
    constexpr std::uint32_t tmpfile_name = 157;
    constexpr std::uint32_t fileno_name = 165;
    constexpr std::uint32_t fclose_name = 172;
    constexpr std::uint32_t dup2_name = 179;
    constexpr std::uint32_t fork_name = 184;
    constexpr std::uint32_t execvp_name = 189;
    constexpr std::uint32_t waitpid_name = 196;
    constexpr std::uint32_t child_exit_name = 204;
    const auto dynstr_offset = data_offset;
    const auto dynsym_offset = detail::align_up(dynstr_offset + static_cast<std::uint32_t>(strings.size()), 8);
    const auto hash_offset = detail::align_up(dynsym_offset + 29u * 24u, 4);
    const auto rela_offset = detail::align_up(hash_offset + 32u * 4u, 8);
    const auto got_offset = detail::align_up(rela_offset + 28u * 24u, 8);
    const auto dynamic_offset = detail::align_up(got_offset + 224u, 8);
    constexpr std::uint32_t dynamic_entries = 13;
    const auto data_end = dynamic_offset + dynamic_entries * 16u;

    const auto address = [=](std::uint32_t offset) { return base + offset; };
    const auto snprintf_got = address(got_offset);
    const auto pow_got = address(got_offset + 8);
    const auto fmod_got = address(got_offset + 16);
    const auto floor_got = address(got_offset + 24);
    const auto log_got = address(got_offset + 32);
    const auto sin_got = address(got_offset + 40);
    const auto cos_got = address(got_offset + 48);
    const auto exp_got = address(got_offset + 56);
    const auto malloc_got = address(got_offset + 64);
    const auto free_got = address(got_offset + 72);
    const auto abort_got = address(got_offset + 80);
    const auto exit_got = address(got_offset + 88);
    const auto clock_gettime_got = address(got_offset + 96);
    const auto nanosleep_got = address(got_offset + 104);
    const auto localtime_got = address(got_offset + 112);
    const auto sysconf_got = address(got_offset + 120);
    const auto getcwd_got = address(got_offset + 128);
    const auto getenv_got = address(got_offset + 136);
    const auto strlen_got = address(got_offset + 144);
    const auto memcpy_got = address(got_offset + 152);
    const auto tmpfile_got = address(got_offset + 160);
    const auto fileno_got = address(got_offset + 168);
    const auto fclose_got = address(got_offset + 176);
    const auto dup2_got = address(got_offset + 184);
    const auto fork_got = address(got_offset + 192);
    const auto execvp_got = address(got_offset + 200);
    const auto waitpid_got = address(got_offset + 208);
    const auto child_exit_got = address(got_offset + 216);

    detail::Bytes out;
    out.raw({0x7f, 'E', 'L', 'F', 2, 1, 1, 0});
    out.values.resize(16, 0);
    out.u16(2); out.u16(62); out.u32(1); out.u64(address(wrapper_offset));
    out.u64(elf_header_size); out.u64(0); out.u32(0);
    out.u16(elf_header_size); out.u16(program_header_size); out.u16(program_header_count);
    out.u16(64); out.u16(0); out.u16(0);

    detail::program_header(out, 6, 4, elf_header_size, address(elf_header_size),
                           program_header_size * program_header_count,
                           program_header_size * program_header_count, 8);
    detail::program_header(out, 3, 4, interpreter_offset, address(interpreter_offset),
                           interpreter.size() + 1, interpreter.size() + 1, 1);
    detail::program_header(out, 1, 5, 0, base, text_end, text_end, 4096);
    detail::program_header(out, 1, 6, data_offset, address(data_offset),
                           data_end - data_offset, data_end - data_offset, 4096);
    detail::program_header(out, 2, 6, dynamic_offset, address(dynamic_offset),
                           dynamic_entries * 16u, dynamic_entries * 16u, 8);
    detail::program_header(out, 0x6474e551u, 6, 0, 0, 0, 0, 16);

    out.pad_to(interpreter_offset); out.text(interpreter); out.u8(0);
    out.pad_to(wrapper_offset);
    const auto wrapper_start = out.values.size();
    const std::uint32_t frame_bytes = detail::align_up(
        sequence_output
            ? std::max(0x128u, vkf::machine_ir::runtime_output_base + output_components * 8u)
            : 0x128u,
        16u);
    out.raw({0x48, 0x81, 0xec}); out.u32(frame_bytes);
    out.raw({0x48, 0xb8}); out.u64(pow_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x04, 0x24});
    out.raw({0x48, 0xb8}); out.u64(fmod_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x08});
    out.raw({0x48, 0xb8}); out.u64(floor_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x10});
    out.raw({0x48, 0xb8}); out.u64(log_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x18});
    out.raw({0x48, 0xb8}); out.u64(sin_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x20});
    out.raw({0x48, 0xb8}); out.u64(cos_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x28});
    out.raw({0x48, 0xb8}); out.u64(exp_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x30});
    out.raw({0x48, 0xb8}); out.u64(address(string_offset));
    out.raw({0x48, 0x89, 0x44, 0x24, 0x38});
    out.raw({0x48, 0xb8}); out.u64(malloc_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x40});
    out.raw({0x48, 0xb8}); out.u64(free_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x48});
    out.raw({0x48, 0xb8}); out.u64(abort_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x50});
    out.raw({0x48, 0xb8}); out.u64(snprintf_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x58, 0x48, 0x89, 0x44, 0x24, 0x60});
    out.raw({0x48, 0xb8}); out.u64(exit_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x70});
    out.raw({0x48, 0xb8}); out.u64(clock_gettime_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x44, 0x24, 0x78, 0x48, 0x89, 0x84, 0x24}); out.u32(0x80);
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0x88);
    out.raw({0x48, 0xb8}); out.u64(nanosleep_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0x90);
    out.raw({0x48, 0xb8}); out.u64(localtime_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0x98);
    out.raw({0x48, 0xb8}); out.u64(sysconf_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0xc0);
    out.raw({0x48, 0xb8}); out.u64(getcwd_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0xc8);
    out.raw({0x48, 0xb8}); out.u64(getenv_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0xd0);
    out.raw({0x48, 0xb8}); out.u64(strlen_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0xd8);
    out.raw({0x48, 0xb8}); out.u64(memcpy_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0xe0);
    out.raw({0x48, 0xb8}); out.u64(tmpfile_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0xe8);
    out.raw({0x48, 0xb8}); out.u64(fileno_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0xf0);
    out.raw({0x48, 0xb8}); out.u64(fclose_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0xf8);
    out.raw({0x48, 0xb8}); out.u64(dup2_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0x100);
    out.raw({0x48, 0xb8}); out.u64(fork_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0x108);
    out.raw({0x48, 0xb8}); out.u64(execvp_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0x110);
    out.raw({0x48, 0xb8}); out.u64(waitpid_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0x118);
    out.raw({0x48, 0xb8}); out.u64(child_exit_got); out.raw({0x48, 0x8b, 0x00});
    out.raw({0x48, 0x89, 0x84, 0x24}); out.u32(0x120);
    const auto emit_display_plan = [&]() {
        std::uint32_t component = 0;
        const auto emit_write = [&](std::uint64_t pointer, std::uint32_t length) {
            out.raw({0xbf, 0x01, 0x00, 0x00, 0x00, 0x48, 0xbe}); out.u64(pointer);
            out.raw({0xba}); out.u32(length);
            out.raw({0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
        };
        for (std::size_t index = 0; index < output_tokens.size(); ++index) {
            const auto& token = output_tokens[index];
            if (token.kind == vkf::machine_ir::OutputTokenKind::Text) {
                emit_write(address(display_data_offset + display_text_offsets[index]),
                           static_cast<std::uint32_t>(token.text.size()));
                continue;
            }
            if (token.kind == vkf::machine_ir::OutputTokenKind::Null) {
                emit_write(address(display_data_offset + null_text_offset), 4);
                ++component;
                continue;
            }
            if (token.kind == vkf::machine_ir::OutputTokenKind::Bit) {
                out.raw({0xf2, 0x41, 0x0f, 0x10, 0x84, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
                out.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc0});
                out.raw({0x48, 0xbe}); out.u64(address(display_data_offset + true_text_offset));
                out.raw({0xba}); out.u32(4);
                out.raw({0x48, 0x85, 0xc0, 0x75, 0x0f});
                out.raw({0x48, 0xbe}); out.u64(address(display_data_offset + false_text_offset));
                out.raw({0xba}); out.u32(5);
                out.raw({0xbf, 0x01, 0x00, 0x00, 0x00, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
                ++component;
                continue;
            }
            if (token.kind == vkf::machine_ir::OutputTokenKind::String) {
                out.raw({0x49, 0x8b, 0xb4, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
                out.raw({0xf2, 0x41, 0x0f, 0x10, 0x8c, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + (component + 1u) * 8u);
                out.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xe9, 0x4c, 0x89, 0xea,
                         0x48, 0x85, 0xd2, 0x79, 0x06, 0x48, 0xf7, 0xda,
                         0x48, 0xff, 0xca, 0xbf, 0x01, 0x00, 0x00, 0x00,
                         0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
                out.raw({0x4d, 0x85, 0xed, 0x79, 0x17, 0x48, 0x89, 0xf7,
                         0x48, 0x83, 0xef, 0x08, 0x49, 0xbb});
                out.u64(free_got);
                out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
                component += 2;
                continue;
            }
            out.raw({0xf2, 0x41, 0x0f, 0x10, 0x84, 0x24});
            out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
            out.raw({0x48, 0x8d, 0x7c, 0x24, 0x10, 0xbe, 0x80, 0x00, 0x00, 0x00});
            out.raw({0x48, 0xba}); out.u64(address(token_numeric_format_offset));
            out.raw({0xb8, 0x01, 0x00, 0x00, 0x00});
            out.raw({0x49, 0xbb}); out.u64(snprintf_got);
            out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
            out.raw({0x89, 0xc2, 0x48, 0x8d, 0x74, 0x24, 0x10});
            out.raw({0xbf, 0x01, 0x00, 0x00, 0x00, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
            ++component;
        }
    };
    if (sequence_output) {
        out.raw({0x49, 0x89, 0xe4, 0x4c, 0x89, 0xe7, 0xe8});
    } else {
        out.raw({0x48, 0x89, 0xe7, 0xe8});
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
                out.raw({0x49, 0x8b, 0xb4, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
                out.raw({0xf2, 0x41, 0x0f, 0x10, 0x8c, 0x24});
                out.u32(vkf::machine_ir::runtime_output_base + (component + 1u) * 8u);
                out.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xe9, 0x4c, 0x89, 0xea,
                         0x48, 0x85, 0xd2, 0x79, 0x06, 0x48, 0xf7, 0xda,
                         0x48, 0xff, 0xca, 0xbf, 0x01, 0x00, 0x00, 0x00,
                         0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
                out.raw({0x4d, 0x85, 0xed, 0x79, 0x17, 0x48, 0x89, 0xf7,
                         0x48, 0x83, 0xef, 0x08, 0x49, 0xbb});
                out.u64(free_got);
                out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
                out.raw({0xbf, 0x01, 0x00, 0x00, 0x00, 0x48, 0xbe});
                out.u64(address(newline_offset));
                out.raw({0xba, 0x01, 0x00, 0x00, 0x00, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
                component += 2;
                continue;
            }
            out.raw({0xf2, 0x41, 0x0f, 0x10, 0x84, 0x24});
            out.u32(vkf::machine_ir::runtime_output_base + component * 8u);
            out.raw({0x48, 0x8d, 0x7c, 0x24, 0x10, 0xbe, 0x80, 0x00, 0x00, 0x00});
            out.raw({0x48, 0xba}); out.u64(address(numeric_format_offset));
            out.raw({0xb8, 0x01, 0x00, 0x00, 0x00});
            out.raw({0x49, 0xbb}); out.u64(snprintf_got);
            out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
            out.raw({0x89, 0xc2, 0x48, 0x8d, 0x74, 0x24, 0x10});
            out.raw({0xbf, 0x01, 0x00, 0x00, 0x00, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
            ++component;
        }
    } else if (!suppress_output && string_output) {
        out.raw({0x66, 0x48, 0x0f, 0x7e, 0xc6, 0xf2, 0x48, 0x0f, 0x2c, 0xd1,
                 0x49, 0x89, 0xd5, 0x48, 0x85, 0xd2, 0x79, 0x06,
                 0x48, 0xf7, 0xda, 0x48, 0xff, 0xca});
        out.raw({0xbf, 0x01, 0x00, 0x00, 0x00, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
        out.raw({0x4d, 0x85, 0xed, 0x79, 0x17, 0x48, 0x89, 0xf7, 0x48, 0x83, 0xef, 0x08, 0x49, 0xbb});
        out.u64(free_got);
        out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
        out.raw({0xbf, 0x01, 0x00, 0x00, 0x00, 0x48, 0xbe}); out.u64(address(newline_offset));
        out.raw({0xba, 0x01, 0x00, 0x00, 0x00, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
    } else if (!suppress_output) {
        out.raw({0x48, 0x8d, 0x7c, 0x24, 0x10, 0xbe, 0x80, 0x00, 0x00, 0x00});
        out.raw({0x48, 0xba}); out.u64(address(numeric_format_offset));
        out.raw({0xb8, 0x01, 0x00, 0x00, 0x00});
        out.raw({0x49, 0xbb}); out.u64(snprintf_got); out.raw({0x4d, 0x8b, 0x1b, 0x41, 0xff, 0xd3});
        out.raw({0x89, 0xc2, 0x48, 0x8d, 0x74, 0x24, 0x10});
        out.raw({0xbf, 0x01, 0x00, 0x00, 0x00, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
    }
    out.raw({0xb8, 0x3c, 0x00, 0x00, 0x00, 0x31, 0xff, 0x0f, 0x05});
    if (out.values.size() - wrapper_start > wrapper_size) throw WriterFailure("invalid ELF wrapper size");
    out.values.resize(wrapper_start + wrapper_size, 0x90);
    const auto return_address = call_patch + 4;
    out.set_u32(call_patch, static_cast<std::uint32_t>(generated_offset - return_address));
    out.pad_to(generated_offset); out.append(generated_code);
    out.pad_to(numeric_format_offset); out.text(numeric_format); out.u8(0);
    out.pad_to(newline_offset); out.text(newline); out.u8(0);
    out.pad_to(token_numeric_format_offset); out.text(token_numeric_format); out.u8(0);
    out.pad_to(string_offset); out.append(string_data);
    out.pad_to(display_data_offset); out.append(display_data);

    out.pad_to(dynstr_offset); out.text(strings);
    out.pad_to(dynsym_offset); out.values.resize(out.values.size() + 24, 0);
    detail::symbol(out, snprintf_name); detail::symbol(out, pow_name); detail::symbol(out, fmod_name);
    detail::symbol(out, floor_name); detail::symbol(out, log_name); detail::symbol(out, sin_name);
    detail::symbol(out, cos_name); detail::symbol(out, exp_name); detail::symbol(out, malloc_name);
    detail::symbol(out, free_name); detail::symbol(out, abort_name); detail::symbol(out, exit_name);
    detail::symbol(out, clock_gettime_name); detail::symbol(out, nanosleep_name);
    detail::symbol(out, localtime_name);
    detail::symbol(out, sysconf_name); detail::symbol(out, getcwd_name);
    detail::symbol(out, getenv_name); detail::symbol(out, strlen_name);
    detail::symbol(out, memcpy_name);
    detail::symbol(out, tmpfile_name); detail::symbol(out, fileno_name);
    detail::symbol(out, fclose_name); detail::symbol(out, dup2_name);
    detail::symbol(out, fork_name); detail::symbol(out, execvp_name);
    detail::symbol(out, waitpid_name); detail::symbol(out, child_exit_name);
    out.pad_to(hash_offset);
    out.u32(1); out.u32(29); out.u32(1); out.u32(0); out.u32(2); out.u32(3);
    out.u32(4); out.u32(5); out.u32(6); out.u32(7); out.u32(8); out.u32(9);
    out.u32(10); out.u32(11); out.u32(12); out.u32(13); out.u32(14); out.u32(15);
    out.u32(16); out.u32(17); out.u32(18); out.u32(19); out.u32(20);
    out.u32(21); out.u32(22); out.u32(23); out.u32(24); out.u32(25);
    out.u32(26); out.u32(27); out.u32(28); out.u32(0);
    out.pad_to(rela_offset);
    detail::relocation(out, snprintf_got, 1); detail::relocation(out, pow_got, 2);
    detail::relocation(out, fmod_got, 3);
    detail::relocation(out, floor_got, 4);
    detail::relocation(out, log_got, 5); detail::relocation(out, sin_got, 6);
    detail::relocation(out, cos_got, 7); detail::relocation(out, exp_got, 8);
    detail::relocation(out, malloc_got, 9); detail::relocation(out, free_got, 10);
    detail::relocation(out, abort_got, 11); detail::relocation(out, exit_got, 12);
    detail::relocation(out, clock_gettime_got, 13); detail::relocation(out, nanosleep_got, 14);
    detail::relocation(out, localtime_got, 15);
    detail::relocation(out, sysconf_got, 16); detail::relocation(out, getcwd_got, 17);
    detail::relocation(out, getenv_got, 18); detail::relocation(out, strlen_got, 19);
    detail::relocation(out, memcpy_got, 20);
    detail::relocation(out, tmpfile_got, 21); detail::relocation(out, fileno_got, 22);
    detail::relocation(out, fclose_got, 23); detail::relocation(out, dup2_got, 24);
    detail::relocation(out, fork_got, 25); detail::relocation(out, execvp_got, 26);
    detail::relocation(out, waitpid_got, 27); detail::relocation(out, child_exit_got, 28);
    out.pad_to(got_offset); for (unsigned index = 0; index < 28; ++index) out.u64(0);
    out.pad_to(dynamic_offset);
    detail::dynamic_entry(out, 1, libc_name); detail::dynamic_entry(out, 1, libm_name);
    detail::dynamic_entry(out, 4, address(hash_offset));
    detail::dynamic_entry(out, 5, address(dynstr_offset));
    detail::dynamic_entry(out, 6, address(dynsym_offset));
    detail::dynamic_entry(out, 7, address(rela_offset));
    detail::dynamic_entry(out, 8, 28u * 24u);
    detail::dynamic_entry(out, 9, 24);
    detail::dynamic_entry(out, 10, strings.size());
    detail::dynamic_entry(out, 11, 24);
    detail::dynamic_entry(out, 0x6ffffffbu, 1);
    detail::dynamic_entry(out, 21, 0);
    detail::dynamic_entry(out, 0, 0);
    if (out.values.size() != data_end) throw WriterFailure("invalid ELF image size");
    return {std::move(out.values), address(wrapper_offset), generated_offset, dynamic_offset};
}

}  // namespace vkf::elf
