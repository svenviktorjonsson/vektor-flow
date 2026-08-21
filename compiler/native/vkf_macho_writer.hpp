#pragma once

#include "compiler/native/vkf_machine_ir.hpp"

#include "compiler/native/vkf_sha256.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace vkf::macho {

class WriterFailure : public std::runtime_error {
public:
    explicit WriterFailure(const std::string& message) : std::runtime_error(message) {}
};

struct Result {
    std::vector<std::uint8_t> bytes;
    std::uint32_t entry_offset = 0;
    std::uint32_t generated_code_offset = 0;
    std::uint32_t signature_offset = 0;
};

namespace detail {

inline std::uint32_t align_up(std::uint32_t value, std::uint32_t alignment) {
    return (value + alignment - 1) & ~(alignment - 1);
}

inline std::uint32_t arm64_adrp(unsigned reg, std::uint32_t instruction_offset,
                               std::uint32_t target_offset) {
    if (reg > 30) throw WriterFailure("invalid Mach-O ADRP register");
    const std::int64_t source_page = static_cast<std::int64_t>(instruction_offset >> 12);
    const std::int64_t target_page = static_cast<std::int64_t>(target_offset >> 12);
    const std::int64_t delta = target_page - source_page;
    if (delta < -(1ll << 20) || delta >= (1ll << 20)) {
        throw WriterFailure("Mach-O ADRP target exceeds arm64 range");
    }
    const auto encoded = static_cast<std::uint64_t>(delta) & 0x1fffffu;
    return 0x90000000u
        | (static_cast<std::uint32_t>(encoded & 3u) << 29)
        | (static_cast<std::uint32_t>((encoded >> 2) & 0x7ffffu) << 5)
        | reg;
}

inline std::uint32_t arm64_add_imm(unsigned reg, std::uint32_t target_offset) {
    if (reg > 30) throw WriterFailure("invalid Mach-O ADD register");
    return 0x91000000u | ((target_offset & 0xfffu) << 10) | (reg << 5) | reg;
}

class Bytes {
public:
    std::vector<std::uint8_t> values;

    void le32(std::uint32_t value) {
        for (unsigned shift = 0; shift < 32; shift += 8) values.push_back(static_cast<std::uint8_t>(value >> shift));
    }
    void le64(std::uint64_t value) {
        for (unsigned shift = 0; shift < 64; shift += 8) values.push_back(static_cast<std::uint8_t>(value >> shift));
    }
    void be32(std::uint32_t value) {
        for (int shift = 24; shift >= 0; shift -= 8) values.push_back(static_cast<std::uint8_t>(value >> shift));
    }
    void be64(std::uint64_t value) {
        for (int shift = 56; shift >= 0; shift -= 8) values.push_back(static_cast<std::uint8_t>(value >> shift));
    }
    void fixed(const std::string& text, std::size_t size) {
        if (text.size() >= size) throw WriterFailure("Mach-O fixed string too long");
        values.insert(values.end(), text.begin(), text.end());
        values.resize(values.size() + size - text.size(), 0);
    }
    void zeros(std::size_t count) { values.resize(values.size() + count, 0); }
    void set_le32(std::size_t offset, std::uint32_t value) {
        if (offset + 4 > values.size()) throw WriterFailure("Mach-O patch outside image");
        for (unsigned shift = 0; shift < 32; shift += 8) {
            values[offset + shift / 8] = static_cast<std::uint8_t>(value >> shift);
        }
    }
};

inline void segment(Bytes& out, const std::string& name, std::uint64_t vmaddr, std::uint64_t vmsize,
                    std::uint64_t fileoff, std::uint64_t filesize, std::uint32_t maxprot,
                    std::uint32_t initprot, std::uint32_t sections) {
    out.le32(0x19); out.le32(72 + sections * 80); out.fixed(name, 16);
    out.le64(vmaddr); out.le64(vmsize); out.le64(fileoff); out.le64(filesize);
    out.le32(maxprot); out.le32(initprot); out.le32(sections); out.le32(0);
}

inline std::uint32_t code_signature_size(std::uint32_t signed_size, const std::string& identifier) {
    constexpr std::uint32_t page_size = 4096;
    constexpr std::uint32_t cd_header_size = 88;
    const auto slots = (signed_size + page_size - 1) / page_size;
    const auto ident_storage = align_up(static_cast<std::uint32_t>(identifier.size() + 1), 16);
    return 24u + cd_header_size + ident_storage + slots * 32u;
}

inline std::vector<std::uint8_t> code_signature(const std::vector<std::uint8_t>& signed_bytes,
                                                 const std::string& identifier) {
    constexpr std::uint32_t page_size = 4096;
    constexpr std::uint32_t cd_header_size = 88;
    const auto slots = static_cast<std::uint32_t>((signed_bytes.size() + page_size - 1) / page_size);
    const auto ident_storage = align_up(static_cast<std::uint32_t>(identifier.size() + 1), 16);
    const auto hash_offset = cd_header_size + ident_storage;
    const auto cd_size = hash_offset + slots * 32;
    const auto total_size = 24u + cd_size;

    Bytes out;
    out.be32(0xfade0cc0u); out.be32(total_size); out.be32(1);
    out.be32(0); out.be32(24);
    out.be32(0);
    out.be32(0xfade0c02u); out.be32(cd_size);
    out.be32(0x20400); out.be32(0x20002);
    out.be32(hash_offset); out.be32(cd_header_size);
    out.be32(0); out.be32(slots); out.be32(static_cast<std::uint32_t>(signed_bytes.size()));
    out.values.push_back(32); out.values.push_back(2); out.values.push_back(0); out.values.push_back(12);
    out.be32(0); out.be32(0); out.be32(0); out.be32(0); out.be64(0);
    out.be64(0); out.be64(0x4000); out.be64(1);
    out.values.insert(out.values.end(), identifier.begin(), identifier.end());
    out.values.push_back(0);
    out.zeros(ident_storage - identifier.size() - 1);
    for (std::uint32_t slot = 0; slot < slots; ++slot) {
        const auto begin = static_cast<std::size_t>(slot) * page_size;
        const auto count = std::min<std::size_t>(page_size, signed_bytes.size() - begin);
        const auto digest = crypto::sha256(signed_bytes.data() + begin, count);
        out.values.insert(out.values.end(), digest.begin(), digest.end());
    }
    if (out.values.size() != total_size) throw WriterFailure("invalid Mach-O code signature size");
    return out.values;
}

}  // namespace detail

inline Result executable_arm64(const std::vector<std::uint8_t>& generated_code,
                               const std::string& identifier,
                               const std::vector<std::uint8_t>& string_data = {},
                               bool string_output = false,
                               bool suppress_output = false,
                               std::uint32_t numeric_output_count = 0,
                               const std::vector<vkf::machine_ir::OutputKind>& sequence_outputs = {},
                               const std::vector<vkf::machine_ir::OutputToken>& output_tokens = {}) {
    constexpr std::uint64_t image_base = 0x100000000ull;
    constexpr std::uint32_t page_size = 0x4000;
    constexpr std::uint32_t commands_size = 728;
    constexpr std::uint32_t header_size = 32;
    constexpr std::uint32_t entry_offset = header_size + commands_size;
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
    const std::uint32_t wrapper_size = 704u + sequence_count * 96u;
    const std::uint32_t generated_offset = entry_offset + wrapper_size;
    const std::string numeric_format = "%g\n";
    const std::string string_format = "%.*s\n";
    const std::string token_numeric_format = "%g";
    const std::string token_string_format = "%.*s";
    const auto numeric_format_offset = detail::align_up(
        generated_offset + static_cast<std::uint32_t>(generated_code.size()), 4);
    const auto string_format_offset = numeric_format_offset +
        static_cast<std::uint32_t>(numeric_format.size() + 1);
    const auto token_numeric_format_offset = string_format_offset +
        static_cast<std::uint32_t>(string_format.size() + 1);
    const auto token_string_format_offset = token_numeric_format_offset +
        static_cast<std::uint32_t>(token_numeric_format.size() + 1);
    const auto string_offset = detail::align_up(
        token_string_format_offset + static_cast<std::uint32_t>(token_string_format.size() + 1), 8);
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
    const auto display_data_offset = string_offset + static_cast<std::uint32_t>(string_data.size());
    const auto string_end = display_data_offset + static_cast<std::uint32_t>(display_data.size());
    const auto data_offset = detail::align_up(string_end, page_size);
    const auto linkedit_offset = data_offset + page_size;

    std::vector<std::uint8_t> binding = {
        0x11, 0x51, 0x72, 0x00,
        0x40, '_', 'p', 'r', 'i', 'n', 't', 'f', 0x00, 0x90,
        0x40, '_', 'p', 'o', 'w', 0x00, 0x90,
        0x40, '_', 'f', 'm', 'o', 'd', 0x00, 0x90,
        0x40, '_', 'f', 'l', 'o', 'o', 'r', 0x00, 0x90,
        0x40, '_', 'l', 'o', 'g', 0x00, 0x90,
        0x40, '_', 's', 'i', 'n', 0x00, 0x90,
        0x40, '_', 'c', 'o', 's', 0x00, 0x90,
        0x40, '_', 'e', 'x', 'p', 0x00, 0x90,
        0x40, '_', 'm', 'a', 'l', 'l', 'o', 'c', 0x00, 0x90,
        0x40, '_', 'f', 'r', 'e', 'e', 0x00, 0x90,
        0x40, '_', 'a', 'b', 'o', 'r', 't', 0x00, 0x90,
        0x40, '_', 's', 'n', 'p', 'r', 'i', 'n', 't', 'f', 0x00, 0x90,
        0x40, '_', 'w', 'r', 'i', 't', 'e', 0x00, 0x90,
        0x40, '_', 'e', 'x', 'i', 't', 0x00, 0x90,
        0x40, '_', 'c', 'l', 'o', 'c', 'k', '_', 'g', 'e', 't', 't', 'i', 'm', 'e', 0x00, 0x90,
        0x40, '_', 'n', 'a', 'n', 'o', 's', 'l', 'e', 'e', 'p', 0x00, 0x90,
        0x40, '_', 'l', 'o', 'c', 'a', 'l', 't', 'i', 'm', 'e', '_', 'r', 0x00, 0x90,
        0x40, '_', 'o', 'p', 'e', 'n', 0x00, 0x90,
        0x40, '_', 'r', 'e', 'a', 'd', 0x00, 0x90,
        0x40, '_', 'c', 'l', 'o', 's', 'e', 0x00, 0x90,
        0x40, '_', 'l', 's', 'e', 'e', 'k', 0x00, 0x90,
        0x40, '_', 's', 'y', 's', 'c', 'o', 'n', 'f', 0x00, 0x90,
        0x40, '_', 'g', 'e', 't', 'c', 'w', 'd', 0x00, 0x90,
        0x40, '_', 'g', 'e', 't', 'e', 'n', 'v', 0x00, 0x90,
        0x40, '_', 's', 't', 'r', 'l', 'e', 'n', 0x00, 0x90,
        0x40, '_', 'm', 'e', 'm', 'c', 'p', 'y', 0x00, 0x90,
        0x40, '_', 't', 'm', 'p', 'f', 'i', 'l', 'e', 0x00, 0x90,
        0x40, '_', 'f', 'i', 'l', 'e', 'n', 'o', 0x00, 0x90,
        0x40, '_', 'f', 'c', 'l', 'o', 's', 'e', 0x00, 0x90,
        0x40, '_', 'd', 'u', 'p', '2', 0x00, 0x90,
        0x40, '_', 'f', 'o', 'r', 'k', 0x00, 0x90,
        0x40, '_', 'e', 'x', 'e', 'c', 'v', 'p', 0x00, 0x90,
        0x40, '_', 'w', 'a', 'i', 't', 'p', 'i', 'd', 0x00, 0x90,
        0x40, '_', '_', 'e', 'x', 'i', 't', 0x00, 0x90,
        0x00,
    };
    binding.resize(detail::align_up(static_cast<std::uint32_t>(binding.size()), 16), 0);
    const auto signature_offset = linkedit_offset + static_cast<std::uint32_t>(binding.size());
    const auto signature_size = detail::code_signature_size(signature_offset, identifier);
    const auto linkedit_size = static_cast<std::uint32_t>(binding.size()) + signature_size;
    const auto linkedit_vm_size = detail::align_up(linkedit_size, page_size);

    detail::Bytes out;
    out.le32(0xfeedfacfu); out.le32(0x0100000cu); out.le32(0); out.le32(2);
    out.le32(10); out.le32(commands_size); out.le32(0x00200085u); out.le32(0);
    detail::segment(out, "__PAGEZERO", 0, image_base, 0, 0, 0, 0, 0);
    detail::segment(out, "__TEXT", image_base, data_offset, 0, data_offset, 5, 5, 2);
    out.fixed("__text", 16); out.fixed("__TEXT", 16);
    out.le64(image_base + entry_offset); out.le64(wrapper_size + generated_code.size());
    out.le32(entry_offset); out.le32(2); out.le32(0); out.le32(0);
    out.le32(0x80000400u); out.le32(0); out.le32(0); out.le32(0);
    out.fixed("__cstring", 16); out.fixed("__TEXT", 16);
    out.le64(image_base + numeric_format_offset); out.le64(string_end - numeric_format_offset);
    out.le32(numeric_format_offset); out.le32(0); out.le32(0); out.le32(0);
    out.le32(0x02u); out.le32(0); out.le32(0); out.le32(0);

    detail::segment(out, "__DATA_CONST", image_base + data_offset, page_size,
                    data_offset, page_size, 3, 3, 1);
    out.fixed("__got", 16); out.fixed("__DATA_CONST", 16);
    out.le64(image_base + data_offset); out.le64(272);
    out.le32(data_offset); out.le32(3); out.le32(0); out.le32(0);
    out.le32(0x06u); out.le32(0); out.le32(0); out.le32(0);
    detail::segment(out, "__LINKEDIT", image_base + linkedit_offset, linkedit_vm_size,
                    linkedit_offset, linkedit_size, 1, 1, 0);
    out.le32(0x80000022u); out.le32(48);
    out.le32(0); out.le32(0);
    out.le32(linkedit_offset); out.le32(static_cast<std::uint32_t>(binding.size()));
    out.zeros(24);
    out.le32(0x0eu); out.le32(32); out.le32(12); out.fixed("/usr/lib/dyld", 20);
    out.le32(0x0cu); out.le32(56); out.le32(24); out.le32(0); out.le32(0); out.le32(0);
    out.fixed("/usr/lib/libSystem.B.dylib", 32);
    out.le32(0x32u); out.le32(24); out.le32(1); out.le32(0x000b0000u); out.le32(0x000b0000u); out.le32(0);
    out.le32(0x80000028u); out.le32(24); out.le64(entry_offset); out.le64(0);
    out.le32(0x1du); out.le32(16); out.le32(signature_offset); out.le32(signature_size);
    if (out.values.size() != entry_offset) throw WriterFailure("invalid Mach-O load command size");

    const auto wrapper_start = out.values.size();
    const std::uint32_t wrapper_frame_bytes = sequence_output
        ? detail::align_up(std::max(
            304u, vkf::machine_ir::runtime_output_base + output_components * 8u), 16u)
        : 304u;
    if (wrapper_frame_bytes > 4095u) throw WriterFailure("Mach-O output frame exceeds immediate range");
    out.le32(0xd10003ffu | (wrapper_frame_bytes << 10));
    out.le32(0xa9087bfdu); out.le32(0x910203fdu);
    out.le32(detail::arm64_adrp(9, static_cast<std::uint32_t>(out.values.size()), data_offset));
    out.le32(0xf940052au); out.le32(0xf90003eau);
    out.le32(0xf940092au); out.le32(0xf90007eau);
    out.le32(0xf9400d2au); out.le32(0xf9000beau);
    out.le32(0xf940112au); out.le32(0xf9000feau);
    out.le32(0xf940152au); out.le32(0xf90013eau);
    out.le32(0xf940192au); out.le32(0xf90017eau);
    out.le32(0xf9401d2au); out.le32(0xf9001beau);
    out.le32(detail::arm64_adrp(10, static_cast<std::uint32_t>(out.values.size()), string_offset));
    out.le32(detail::arm64_add_imm(10, string_offset)); out.le32(0xf9001feau);
    out.le32(0xf940212au); out.le32(0xf90023eau);
    out.le32(0xf940252au); out.le32(0xf90027eau);
    out.le32(0xf940292au); out.le32(0xf9002beau);
    out.le32(0xf9402d2au); out.le32(0xf9002feau); out.le32(0xf90033eau);
    out.le32(0xf940312au); out.le32(0xf90037eau);
    out.le32(0xf940352au); out.le32(0xf9003beau);
    out.le32(0xf940392au); out.le32(0xf9003feau); out.le32(0xf90043eau); out.le32(0xf90047eau);
    out.le32(0xf9403d2au); out.le32(0xf9004beau);
    out.le32(0xf940412au); out.le32(0xf9004feau);
    out.le32(0xf940452au); out.le32(0xf90053eau);
    out.le32(0xf940492au); out.le32(0xf90057eau);
    out.le32(0xf9404d2au); out.le32(0xf9005beau);
    out.le32(0xf940512au); out.le32(0xf9005feau);
    out.le32(0xf940552au); out.le32(0xf90063eau);
    out.le32(0xf940592au); out.le32(0xf90067eau);
    out.le32(0xf9405d2au); out.le32(0xf9006beau);
    out.le32(0xf940612au); out.le32(0xf9006feau);
    out.le32(0xf940652au); out.le32(0xf90073eau);
    out.le32(0xf940692au); out.le32(0xf90077eau);
    out.le32(0xf9406d2au); out.le32(0xf9007beau);
    out.le32(0xf940712au); out.le32(0xf9007feau);
    out.le32(0xf940752au); out.le32(0xf90083eau);
    out.le32(0xf940792au); out.le32(0xf90087eau);
    out.le32(0xf9407d2au); out.le32(0xf9008beau);
    out.le32(0xf940812au); out.le32(0xf9008feau);
    out.le32(0xf940852au); out.le32(0xf90093eau);
    out.le32(0x910003e0u);
    const auto branch_offset = out.values.size(); out.le32(0x94000000u);
    if (display_plan) {
        std::uint32_t component = 0;
        const auto emit_text_value = [&](std::uint32_t text_offset, std::uint32_t length) {
            out.le32(0xd2800009u | (length << 5));
            out.le32(0xf90003e9u);
            out.le32(detail::arm64_adrp(10, static_cast<std::uint32_t>(out.values.size()), text_offset));
            out.le32(detail::arm64_add_imm(10, text_offset));
            out.le32(0xf90007eau);
            out.le32(detail::arm64_adrp(9, static_cast<std::uint32_t>(out.values.size()), data_offset));
            out.le32(0xf9400129u);
            out.le32(detail::arm64_adrp(0, static_cast<std::uint32_t>(out.values.size()), token_string_format_offset));
            out.le32(detail::arm64_add_imm(0, token_string_format_offset));
            out.le32(0xd63f0120u);
        };
        for (std::size_t index = 0; index < output_tokens.size(); ++index) {
            const auto& token = output_tokens[index];
            if (token.kind == vkf::machine_ir::OutputTokenKind::Text) {
                emit_text_value(display_data_offset + display_text_offsets[index],
                                static_cast<std::uint32_t>(token.text.size()));
                continue;
            }
            if (token.kind == vkf::machine_ir::OutputTokenKind::Null) {
                emit_text_value(display_data_offset + null_text_offset, 4);
                ++component;
                continue;
            }
            const std::uint32_t offset = vkf::machine_ir::runtime_output_base + component * 8u;
            if (token.kind == vkf::machine_ir::OutputTokenKind::Bit) {
                out.le32(0xfd4003e0u | ((offset / 8u) << 10));
                out.le32(0x9e78000bu);
                out.le32(detail::arm64_adrp(10, static_cast<std::uint32_t>(out.values.size()),
                                            display_data_offset + true_text_offset));
                out.le32(detail::arm64_add_imm(10, display_data_offset + true_text_offset));
                out.le32(0xd2800089u);
                out.le32(0xf100017fu);
                out.le32(0x54000081u);
                out.le32(detail::arm64_adrp(10, static_cast<std::uint32_t>(out.values.size()),
                                            display_data_offset + false_text_offset));
                out.le32(detail::arm64_add_imm(10, display_data_offset + false_text_offset));
                out.le32(0xd28000a9u);
                out.le32(0xf90003e9u); out.le32(0xf90007eau);
                out.le32(detail::arm64_adrp(9, static_cast<std::uint32_t>(out.values.size()), data_offset));
                out.le32(0xf9400129u);
                out.le32(detail::arm64_adrp(0, static_cast<std::uint32_t>(out.values.size()), token_string_format_offset));
                out.le32(detail::arm64_add_imm(0, token_string_format_offset)); out.le32(0xd63f0120u);
                ++component;
                continue;
            }
            if (token.kind == vkf::machine_ir::OutputTokenKind::String) {
                out.le32(0xfd4003e0u | ((offset / 8u) << 10));
                out.le32(0xfd4003e1u | (((offset + 8u) / 8u) << 10));
                out.le32(0x9e78002bu); out.le32(0x9e66000au);
                out.le32(0xf9002feau); out.le32(0xf90033ebu);
                out.le32(0xaa0b03e9u); out.le32(0xf100013fu); out.le32(0x5400006au);
                out.le32(0xcb0903e9u); out.le32(0xd1000529u);
                out.le32(0xf90003e9u); out.le32(0xf90007eau);
                out.le32(detail::arm64_adrp(9, static_cast<std::uint32_t>(out.values.size()), data_offset));
                out.le32(0xf9400129u);
                out.le32(detail::arm64_adrp(0, static_cast<std::uint32_t>(out.values.size()), token_string_format_offset));
                out.le32(detail::arm64_add_imm(0, token_string_format_offset)); out.le32(0xd63f0120u);
                out.le32(0xf94033ebu); out.le32(0xf100017fu); out.le32(0x540000aau);
                out.le32(0xf9402fe0u); out.le32(0xd1002000u);
                out.le32(0xf94027e9u); out.le32(0xd63f0120u);
                component += 2;
                continue;
            }
            out.le32(0xfd4003e0u | ((offset / 8u) << 10));
            out.le32(0xfd0003e0u);
            out.le32(detail::arm64_adrp(9, static_cast<std::uint32_t>(out.values.size()), data_offset));
            out.le32(0xf9400129u);
            out.le32(detail::arm64_adrp(0, static_cast<std::uint32_t>(out.values.size()), token_numeric_format_offset));
            out.le32(detail::arm64_add_imm(0, token_numeric_format_offset));
            out.le32(0xd63f0120u);
            ++component;
        }
    } else if (sequence_output) {
        std::uint32_t component = 0;
        for (std::uint32_t index = 0; index < sequence_count; ++index) {
            const auto kind = sequence_outputs.empty()
                ? vkf::machine_ir::OutputKind::F64 : sequence_outputs[index];
            const std::uint32_t offset = vkf::machine_ir::runtime_output_base + component * 8u;
            if (kind == vkf::machine_ir::OutputKind::String) {
                out.le32(0xfd4003e0u | ((offset / 8u) << 10));
                out.le32(0xfd4003e1u | (((offset + 8u) / 8u) << 10));
                out.le32(0x9e78002bu); out.le32(0x9e66000au);
                out.le32(0xf9002feau); out.le32(0xf90033ebu);
                out.le32(0xaa0b03e9u); out.le32(0xf100013fu); out.le32(0x5400006au);
                out.le32(0xcb0903e9u); out.le32(0xd1000529u);
                out.le32(0xf90003e9u); out.le32(0xf90007eau);
                out.le32(detail::arm64_adrp(9, static_cast<std::uint32_t>(out.values.size()), data_offset));
                out.le32(0xf9400129u);
                out.le32(detail::arm64_adrp(0, static_cast<std::uint32_t>(out.values.size()), string_format_offset));
                out.le32(detail::arm64_add_imm(0, string_format_offset)); out.le32(0xd63f0120u);
                out.le32(0xf94033ebu); out.le32(0xf100017fu); out.le32(0x540000aau);
                out.le32(0xf9402fe0u); out.le32(0xd1002000u);
                out.le32(0xf94027e9u); out.le32(0xd63f0120u);
                component += 2;
                continue;
            }
            out.le32(0xfd4003e0u | ((offset / 8u) << 10));
            out.le32(0xfd0003e0u);
            out.le32(detail::arm64_adrp(9, static_cast<std::uint32_t>(out.values.size()), data_offset));
            out.le32(0xf9400129u);
            out.le32(detail::arm64_adrp(0, static_cast<std::uint32_t>(out.values.size()), numeric_format_offset));
            out.le32(detail::arm64_add_imm(0, numeric_format_offset));
            out.le32(0xd63f0120u);
            ++component;
        }
    } else if (!suppress_output && string_output) {
        out.le32(0x9e78002bu); out.le32(0x9e66000au);
        out.le32(0xf9002feau); out.le32(0xf90033ebu);
        out.le32(0xaa0b03e9u); out.le32(0xf100013fu); out.le32(0x5400006au);
        out.le32(0xcb0903e9u); out.le32(0xd1000529u);
        out.le32(0xf90003e9u); out.le32(0xf90007eau);
    } else if (!suppress_output) {
        out.le32(0xfd0003e0u);
    }
    if (!suppress_output && !sequence_output) {
        out.le32(detail::arm64_adrp(9, static_cast<std::uint32_t>(out.values.size()), data_offset));
        out.le32(0xf9400129u);
        const auto selected_format = string_output ? string_format_offset : numeric_format_offset;
        out.le32(detail::arm64_adrp(0, static_cast<std::uint32_t>(out.values.size()), selected_format));
        out.le32(detail::arm64_add_imm(0, selected_format)); out.le32(0xd63f0120u);
    }
    if (!suppress_output && string_output) {
        out.le32(0xf94033ebu); out.le32(0xf100017fu); out.le32(0x540000aau);
        out.le32(0xf9402fe0u); out.le32(0xd1002000u);
        out.le32(0xf94027e9u); out.le32(0xd63f0120u);
    }
    out.le32(0x52800000u); out.le32(0xa9487bfdu);
    out.le32(0x910003ffu | (wrapper_frame_bytes << 10)); out.le32(0xd65f03c0u);
    while (out.values.size() - wrapper_start < wrapper_size) out.le32(0xd503201fu);
    if (out.values.size() - wrapper_start != wrapper_size) throw WriterFailure("invalid Mach-O wrapper size");
    const std::int64_t branch_delta = static_cast<std::int64_t>(generated_offset) -
        static_cast<std::int64_t>(branch_offset);
    const std::uint32_t branch = 0x94000000u |
        (static_cast<std::uint32_t>(branch_delta / 4) & 0x03ffffffu);
    out.set_le32(branch_offset, branch);
    out.values.insert(out.values.end(), generated_code.begin(), generated_code.end());
    out.values.resize(numeric_format_offset, 0);
    out.values.insert(out.values.end(), numeric_format.begin(), numeric_format.end());
    out.values.push_back(0);
    out.values.resize(string_format_offset, 0);
    out.values.insert(out.values.end(), string_format.begin(), string_format.end());
    out.values.push_back(0);
    out.values.resize(token_numeric_format_offset, 0);
    out.values.insert(out.values.end(), token_numeric_format.begin(), token_numeric_format.end());
    out.values.push_back(0);
    out.values.resize(token_string_format_offset, 0);
    out.values.insert(out.values.end(), token_string_format.begin(), token_string_format.end());
    out.values.push_back(0);
    out.values.resize(string_offset, 0);
    out.values.insert(out.values.end(), string_data.begin(), string_data.end());
    out.values.resize(display_data_offset, 0);
    out.values.insert(out.values.end(), display_data.begin(), display_data.end());
    out.values.resize(linkedit_offset, 0);
    out.values.insert(out.values.end(), binding.begin(), binding.end());
    const auto signature = detail::code_signature(out.values, identifier);
    if (signature.size() != signature_size) throw WriterFailure("Mach-O signature estimate mismatch");
    out.values.insert(out.values.end(), signature.begin(), signature.end());
    return {std::move(out.values), entry_offset, generated_offset, signature_offset};
}

}  // namespace vkf::macho
