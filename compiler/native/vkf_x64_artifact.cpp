#include "native/VfOverlay/vf/json.hpp"
#include "compiler/native/vkf_x64_backend.hpp"
#include "compiler/native/vkf_elf_writer.hpp"
#include "compiler/native/vkf_pe_writer.hpp"
#include "compiler/native/vkf_machine_ir.hpp"
#include "compiler/native/vkf_machine_ir_lowering.hpp"
#include "compiler/native/vkf_machine_ir_json.hpp"
#include "compiler/native/vkf_target.hpp"
#include "compiler/native/vkf_capture_pattern.hpp"
#include "compiler/native/vkf_adaptive_optimizer.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <csetjmp>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <numeric>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <sys/mman.h>
#include <unistd.h>
#endif

namespace {

constexpr unsigned char kMarker[] = {
    0x56, 0x4b, 0x46, 0x58, 0x36, 0x34, 0x41, 0x4f,
    0x54, 0x43, 0x4f, 0x44, 0x45, 0x30, 0x30, 0x31,
};
constexpr std::size_t kCodeCapacity = 32768;

class BackendFailure : public std::runtime_error {
public:
    explicit BackendFailure(std::string message) : std::runtime_error(std::move(message)) {}
};

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) throw BackendFailure("expected object in " + context);
    return value.as_object();
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) throw BackendFailure("missing " + name + " in " + context);
    return found->second;
}

std::string string_field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto& value = field(object, name, context);
    if (!value.is_string()) throw BackendFailure("expected string " + name + " in " + context);
    return value.as_string();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) throw BackendFailure("expected array in " + context);
    return value.as_array();
}

std::vector<unsigned char> read_bytes(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw BackendFailure("could not read " + path.string());
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

std::string read_text(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw BackendFailure("could not read " + path.string());
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

void write_bytes(const std::filesystem::path& path, const std::vector<unsigned char>& bytes) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw BackendFailure("could not write " + path.string());
    output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
}

bool write_bytes_if_changed(const std::filesystem::path& path, const std::vector<unsigned char>& bytes) {
    std::error_code error;
    if (std::filesystem::is_regular_file(path, error) && !error &&
        std::filesystem::file_size(path, error) == bytes.size() && !error) {
        std::ifstream input(path, std::ios::binary);
        if (input) {
            std::vector<unsigned char> existing(bytes.size());
            input.read(reinterpret_cast<char*>(existing.data()), static_cast<std::streamsize>(existing.size()));
            if (input && existing == bytes) return false;
        }
    }
    write_bytes(path, bytes);
    return true;
}

std::uint16_t read_u16(const std::vector<unsigned char>& bytes, std::size_t offset) {
    if (offset + 2 > bytes.size()) throw BackendFailure("truncated PE u16 field");
    return static_cast<std::uint16_t>(bytes[offset])
        | static_cast<std::uint16_t>(bytes[offset + 1]) << 8;
}

std::uint32_t read_u32(const std::vector<unsigned char>& bytes, std::size_t offset) {
    if (offset + 4 > bytes.size()) throw BackendFailure("truncated PE u32 field");
    return static_cast<std::uint32_t>(bytes[offset])
        | static_cast<std::uint32_t>(bytes[offset + 1]) << 8
        | static_cast<std::uint32_t>(bytes[offset + 2]) << 16
        | static_cast<std::uint32_t>(bytes[offset + 3]) << 24;
}

void write_u32(std::vector<unsigned char>& bytes, std::size_t offset, std::uint32_t value) {
    if (offset + 4 > bytes.size()) throw BackendFailure("truncated PE u32 field");
    for (unsigned shift = 0; shift < 32; shift += 8) {
        bytes[offset + shift / 8] = static_cast<unsigned char>(value >> shift);
    }
}

std::uint32_t align_u32(std::uint32_t value, std::uint32_t alignment) {
    if (alignment == 0 || (alignment & (alignment - 1)) != 0) {
        throw BackendFailure("invalid PE alignment");
    }
    const std::uint64_t aligned =
        (static_cast<std::uint64_t>(value) + alignment - 1) & ~(static_cast<std::uint64_t>(alignment) - 1);
    if (aligned > UINT32_MAX) throw BackendFailure("PE section exceeds 32-bit size");
    return static_cast<std::uint32_t>(aligned);
}

bool compact_code_section(
    std::vector<unsigned char>& executable,
    std::size_t marker_offset,
    std::size_t code_size
) {
    if (executable.size() < 0x40 || executable[0] != 'M' || executable[1] != 'Z') {
        throw BackendFailure("runner template is not a PE image");
    }
    const std::size_t pe = read_u32(executable, 0x3c);
    if (pe + 24 > executable.size()
        || executable[pe] != 'P' || executable[pe + 1] != 'E'
        || executable[pe + 2] != 0 || executable[pe + 3] != 0) {
        throw BackendFailure("runner template has no PE signature");
    }
    const std::uint16_t section_count = read_u16(executable, pe + 6);
    const std::uint16_t optional_size = read_u16(executable, pe + 20);
    const std::size_t optional = pe + 24;
    if (read_u16(executable, optional) != 0x20b || optional_size < 60) {
        throw BackendFailure("runner template is not PE32+");
    }
    const std::uint32_t section_alignment = read_u32(executable, optional + 32);
    const std::uint32_t file_alignment = read_u32(executable, optional + 36);
    const std::size_t section_table = optional + optional_size;
    if (section_table + static_cast<std::size_t>(section_count) * 40 > executable.size()) {
        throw BackendFailure("runner template section table is truncated");
    }

    std::size_t code_section = executable.size();
    for (std::uint16_t index = 0; index < section_count; ++index) {
        const std::size_t section = section_table + static_cast<std::size_t>(index) * 40;
        const char expected[] = ".vkfcod";
        bool match = true;
        for (std::size_t name_index = 0; name_index < sizeof(expected) - 1; ++name_index) {
            if (executable[section + name_index] != static_cast<unsigned char>(expected[name_index])) {
                match = false;
                break;
            }
        }
        if (match) {
            code_section = section;
            break;
        }
    }
    if (code_section == executable.size()) throw BackendFailure("runner template has no .vkfcod section");

    const std::uint32_t virtual_address = read_u32(executable, code_section + 12);
    const std::uint32_t old_raw_size = read_u32(executable, code_section + 16);
    const std::uint32_t raw_offset = read_u32(executable, code_section + 20);
    if (marker_offset != raw_offset) throw BackendFailure("runner template marker is not at .vkfcod start");
    const std::uint64_t old_raw_end_64 = static_cast<std::uint64_t>(raw_offset) + old_raw_size;
    if (old_raw_end_64 > executable.size()) throw BackendFailure("runner template .vkfcod section is truncated");
    if (old_raw_end_64 != executable.size()) return false;
    if (code_size == 0 || code_size > UINT32_MAX) throw BackendFailure("invalid x64 code size");

    const std::uint32_t virtual_size = static_cast<std::uint32_t>(code_size);
    const std::uint32_t raw_size = align_u32(virtual_size, file_alignment);
    if (raw_size > old_raw_size) throw BackendFailure("x64 code exceeds runner section");
    write_u32(executable, code_section + 8, virtual_size);
    write_u32(executable, code_section + 16, raw_size);

    const std::uint32_t old_raw_end = static_cast<std::uint32_t>(old_raw_end_64);
    const std::uint32_t new_raw_end = raw_offset + raw_size;
    const std::uint32_t removed_bytes = old_raw_size - raw_size;
    std::uint32_t image_end = virtual_address + virtual_size;
    std::uint32_t code_bytes = 0;
    std::uint32_t initialized_bytes = 0;
    std::uint32_t uninitialized_bytes = 0;
    for (std::uint16_t index = 0; index < section_count; ++index) {
        const std::size_t section = section_table + static_cast<std::size_t>(index) * 40;
        const std::uint32_t section_virtual_size = read_u32(executable, section + 8);
        const std::uint32_t section_virtual_address = read_u32(executable, section + 12);
        const std::uint32_t section_raw_size = read_u32(executable, section + 16);
        const std::uint32_t section_raw_offset = read_u32(executable, section + 20);
        const std::uint32_t characteristics = read_u32(executable, section + 36);
        image_end = std::max(image_end, section_virtual_address + std::max(section_virtual_size, section_raw_size));
        if ((characteristics & 0x20) != 0) code_bytes += section_raw_size;
        if ((characteristics & 0x40) != 0) initialized_bytes += section_raw_size;
        if ((characteristics & 0x80) != 0) uninitialized_bytes += section_virtual_size;
        if (removed_bytes != 0 && section_raw_size != 0 && section_raw_offset >= old_raw_end) {
            write_u32(executable, section + 20, section_raw_offset - removed_bytes);
        } else if (section != code_section && section_raw_size != 0
            && section_raw_offset > raw_offset && section_raw_offset < old_raw_end) {
            throw BackendFailure("runner template has a raw section overlapping .vkfcod");
        }
    }
    write_u32(executable, optional + 4, code_bytes);
    write_u32(executable, optional + 8, initialized_bytes);
    write_u32(executable, optional + 12, uninitialized_bytes);
    write_u32(executable, optional + 56, align_u32(image_end, section_alignment));

    const std::uint32_t symbol_table = read_u32(executable, pe + 12);
    if (removed_bytes != 0 && symbol_table >= old_raw_end) {
        write_u32(executable, pe + 12, symbol_table - removed_bytes);
    }
    constexpr std::size_t pe32_plus_data_directories = 112;
    constexpr std::size_t certificate_directory = pe32_plus_data_directories + 4 * 8;
    if (optional_size >= certificate_directory + 8) {
        const std::uint32_t certificate_offset = read_u32(executable, optional + certificate_directory);
        if (removed_bytes != 0 && certificate_offset >= old_raw_end) {
            write_u32(executable, optional + certificate_directory, certificate_offset - removed_bytes);
        }
    }

    if (removed_bytes != 0) {
        executable.erase(
            executable.begin() + static_cast<std::ptrdiff_t>(new_raw_end),
            executable.begin() + static_cast<std::ptrdiff_t>(old_raw_end)
        );
    }
    return true;
}

void write_text(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw BackendFailure("could not write " + path.string());
    output << text;
}

class Code {
public:
    std::vector<unsigned char> bytes;

    std::size_t position() const { return bytes.size(); }
    void byte(unsigned value) { bytes.push_back(static_cast<unsigned char>(value)); }
    void raw(std::initializer_list<unsigned> values) { for (unsigned value : values) byte(value); }
    void align(std::size_t boundary) {
        if (boundary == 0 || (boundary & (boundary - 1u)) != 0u) {
            throw BackendFailure("x64 code alignment must be a power of two");
        }
        while ((position() & (boundary - 1u)) != 0u) byte(0x90);
    }
    void i32(std::int32_t value) {
        for (unsigned shift = 0; shift < 32; shift += 8) byte(static_cast<std::uint32_t>(value) >> shift);
    }
    void u64(std::uint64_t value) {
        for (unsigned shift = 0; shift < 64; shift += 8) byte(value >> shift);
    }
    std::size_t rel32_placeholder() {
        const std::size_t at = position();
        i32(0);
        return at;
    }
    void patch_rel32(std::size_t at, std::size_t target) {
        const auto delta = static_cast<std::int64_t>(target) - static_cast<std::int64_t>(at + 4);
        if (delta < INT32_MIN || delta > INT32_MAX) throw BackendFailure("x64 branch is out of range");
        const auto value = static_cast<std::uint32_t>(static_cast<std::int32_t>(delta));
        for (unsigned shift = 0; shift < 32; shift += 8) bytes[at + shift / 8] = static_cast<unsigned char>(value >> shift);
    }
};

void emit_stack_allocation(Code& code, unsigned frame_bytes) {
    constexpr unsigned page_bytes = 4096;
    if (frame_bytes <= page_bytes) {
        code.raw({0x48, 0x81, 0xec});
        code.i32(static_cast<std::int32_t>(frame_bytes));
        return;
    }
    const unsigned pages = frame_bytes / page_bytes;
    const unsigned remainder = frame_bytes % page_bytes;
    code.raw({0xb8});
    code.i32(static_cast<std::int32_t>(pages));
    const auto loop = code.position();
    code.raw({0x48, 0x81, 0xec});
    code.i32(page_bytes);
    code.raw({0xf6, 0x04, 0x24, 0x00, 0xff, 0xc8, 0x0f, 0x85});
    const auto branch = code.rel32_placeholder();
    code.patch_rel32(branch, loop);
    if (remainder != 0) {
        code.raw({0x48, 0x81, 0xec});
        code.i32(static_cast<std::int32_t>(remainder));
    }
}

struct CallPatch {
    std::size_t at;
    std::string function;
};

struct FunctionFrame {
    std::map<std::string, unsigned> slots;
    unsigned next_slot = 0;
    unsigned temp_base = 0;
    unsigned frame_bytes = 0;

    unsigned slot(const std::string& name) const {
        const auto found = slots.find(name);
        if (found == slots.end()) throw BackendFailure("unknown binding " + name);
        return found->second;
    }
    std::int32_t displacement(unsigned index) const {
        return -static_cast<std::int32_t>((index + 1) * 8);
    }
};

class X64Emitter {
public:
    explicit X64Emitter(const vf::JsonValue& root) : module_(object_of(root, "typed module")) {
        if (string_field(module_, "kind", "typed module") != "typed_module") {
            throw BackendFailure("unsupported typed IR root");
        }
        for (const auto& statement : array_of(field(module_, "body", "typed module"), "typed module body")) {
            const auto& object = object_of(statement, "top-level statement");
            const std::string kind = string_field(object, "kind", "top-level statement");
            if (kind == "function") functions_[string_field(object, "name", "function")] = &object;
            else if (kind == "store_binding" || kind == "expr_stmt") entry_statements_.push_back(&object);
            else if (kind != "type_alias") throw BackendFailure("x64 backend does not support top-level " + kind);
        }
        if (entry_statements_.empty()) throw BackendFailure("x64 artifact needs a top-level expression");
    }

    std::vector<unsigned char> emit() {
        emit_entry();
        for (const auto& [name, function] : functions_) {
            offsets_[name] = code_.position();
            emit_function(*function);
        }
        for (const auto& patch : calls_) {
            const auto found = offsets_.find(patch.function);
            if (found == offsets_.end()) throw BackendFailure("unknown function " + patch.function);
            code_.patch_rel32(patch.at, found->second);
        }
        return std::move(code_.bytes);
    }

private:
    const vf::JsonValue::Object& module_;
    std::map<std::string, const vf::JsonValue::Object*> functions_;
    std::vector<const vf::JsonValue::Object*> entry_statements_;
    std::map<std::string, std::size_t> offsets_;
    std::vector<CallPatch> calls_;
    Code code_;

    static void discover_bindings(const vf::JsonValue::Object& statement, FunctionFrame& frame) {
        const std::string kind = string_field(statement, "kind", "statement");
        if (kind == "store_binding") {
            const std::string name = string_field(statement, "name", "binding");
            if (!frame.slots.count(name)) frame.slots[name] = frame.next_slot++;
        } else if (kind == "if_stmt") {
            const auto& body = object_of(field(statement, "body", "if"), "if body");
            for (const auto& child : array_of(field(body, "body", "block"), "block body")) {
                discover_bindings(object_of(child, "statement"), frame);
            }
        }
    }

    static FunctionFrame make_frame(const vf::JsonValue::Object* function) {
        FunctionFrame frame;
        if (function) {
            const auto& params = array_of(field(*function, "params", "function"), "function params");
            if (params.size() > 4) throw BackendFailure("x64 backend currently supports at most four parameters");
            for (const auto& value : params) {
                const std::string name = string_field(object_of(value, "param"), "name", "param");
                frame.slots[name] = frame.next_slot++;
            }
            const auto& block = object_of(field(*function, "body", "function"), "function body");
            for (const auto& value : array_of(field(block, "body", "block"), "block body")) {
                discover_bindings(object_of(value, "statement"), frame);
            }
        }
        frame.temp_base = frame.next_slot;
        constexpr unsigned temporary_slots = 48;
        const unsigned used = (frame.temp_base + temporary_slots) * 8 + 32;
        frame.frame_bytes = (used + 15) & ~15u;
        return frame;
    }

    static FunctionFrame make_entry_frame(
        const std::vector<const vf::JsonValue::Object*>& statements
    ) {
        FunctionFrame frame;
        for (const auto* statement : statements) discover_bindings(*statement, frame);
        frame.temp_base = frame.next_slot;
        constexpr unsigned temporary_slots = 48;
        const unsigned used = (frame.temp_base + temporary_slots) * 8 + 32;
        frame.frame_bytes = (used + 15) & ~15u;
        return frame;
    }

    void prologue(const FunctionFrame& frame) {
        code_.raw({0x55, 0x48, 0x89, 0xe5});
        emit_stack_allocation(code_, frame.frame_bytes);
    }

    void epilogue() { code_.raw({0xc9, 0xc3}); }

    void store_xmm(unsigned xmm, std::int32_t displacement) {
        if (xmm > 3) throw BackendFailure("invalid x64 argument register");
        code_.raw({0xf2, 0x0f, 0x11, static_cast<unsigned>(0x85 + xmm * 8)});
        code_.i32(displacement);
    }

    void load_xmm(unsigned xmm, std::int32_t displacement) {
        if (xmm > 3) throw BackendFailure("invalid x64 argument register");
        code_.raw({0xf2, 0x0f, 0x10, static_cast<unsigned>(0x85 + xmm * 8)});
        code_.i32(displacement);
    }

    void emit_number(double value) {
        std::uint64_t bits = 0;
        std::memcpy(&bits, &value, sizeof(bits));
        code_.raw({0x48, 0xb8});
        code_.u64(bits);
        code_.raw({0x66, 0x48, 0x0f, 0x6e, 0xc0});
    }

    std::size_t emit_jump(unsigned opcode) {
        code_.raw({0x0f, opcode});
        return code_.rel32_placeholder();
    }

    void emit_truth_jump_false(std::size_t& patch) {
        code_.raw({0x66, 0x0f, 0x57, 0xc9});
        code_.raw({0x66, 0x0f, 0x2e, 0xc1});
        patch = emit_jump(0x84);
    }

    void expression(const vf::JsonValue::Object& expr, const FunctionFrame& frame, unsigned depth) {
        if (depth + 8 >= 48) throw BackendFailure("x64 expression needs too many temporaries");
        const std::string kind = string_field(expr, "kind", "expression");
        if (kind == "const") {
            const auto& value = field(expr, "value", "constant");
            if (value.is_number()) emit_number(value.as_number());
            else if (value.is_boolean()) emit_number(value.as_boolean() ? 1.0 : 0.0);
            else throw BackendFailure("x64 backend supports numeric constants only");
            return;
        }
        if (kind == "load") {
            load_xmm(0, frame.displacement(frame.slot(string_field(expr, "name", "load"))));
            return;
        }
        if (kind == "unary_op") {
            expression(object_of(field(expr, "operand", "unary expression"), "unary operand"), frame, depth + 1);
            const std::string op = string_field(expr, "op", "unary expression");
            const auto machine_op = vkf::machine_ir::scalar_unary_opcode(op);
            if (!machine_op) throw BackendFailure("unsupported x64 unary operator " + op);
            if (*machine_op == vkf::machine_ir::Opcode::IdentityF64) return;
            if (*machine_op == vkf::machine_ir::Opcode::NegateF64) {
                code_.raw({0x66, 0x0f, 0x57, 0xc9});
                code_.raw({0xf2, 0x0f, 0x5c, 0xc8});
                code_.raw({0x66, 0x0f, 0x28, 0xc1});
                return;
            }
            throw BackendFailure("unhandled x64 machine IR unary opcode");
        }
        if (kind == "binary_op") {
            expression(object_of(field(expr, "left", "binary expression"), "left expression"), frame, depth + 1);
            store_xmm(0, frame.displacement(frame.temp_base + depth));
            expression(object_of(field(expr, "right", "binary expression"), "right expression"), frame, depth + 2);
            load_xmm(1, frame.displacement(frame.temp_base + depth));
            const std::string op = string_field(expr, "op", "binary expression");
            const auto machine_op = vkf::machine_ir::scalar_binary_opcode(op);
            if (!machine_op) throw BackendFailure("unsupported x64 binary operator " + op);
            if (*machine_op == vkf::machine_ir::Opcode::AddF64 ||
                *machine_op == vkf::machine_ir::Opcode::SubtractF64 ||
                *machine_op == vkf::machine_ir::Opcode::MultiplyF64 ||
                *machine_op == vkf::machine_ir::Opcode::DivideF64) {
                const unsigned opcode = *machine_op == vkf::machine_ir::Opcode::AddF64 ? 0x58
                    : *machine_op == vkf::machine_ir::Opcode::SubtractF64 ? 0x5c
                    : *machine_op == vkf::machine_ir::Opcode::MultiplyF64 ? 0x59
                    : 0x5e;
                code_.raw({0xf2, 0x0f, opcode, 0xc8});
                code_.raw({0x66, 0x0f, 0x28, 0xc1});
                return;
            }
            const unsigned condition = *machine_op == vkf::machine_ir::Opcode::OrderedLessF64 ? 0x92
                : *machine_op == vkf::machine_ir::Opcode::OrderedLessEqualF64 ? 0x96
                : *machine_op == vkf::machine_ir::Opcode::OrderedGreaterF64 ? 0x97
                : *machine_op == vkf::machine_ir::Opcode::OrderedGreaterEqualF64 ? 0x93
                : *machine_op == vkf::machine_ir::Opcode::OrderedEqualF64 ? 0x94
                : *machine_op == vkf::machine_ir::Opcode::UnorderedNotEqualF64 ? 0x95
                : 0;
            if (condition == 0) throw BackendFailure("unhandled x64 machine IR binary opcode");
            code_.raw({0x66, 0x0f, 0x2e, 0xc8, 0x0f, condition, 0xc0});
            if (*machine_op == vkf::machine_ir::Opcode::OrderedLessF64 ||
                *machine_op == vkf::machine_ir::Opcode::OrderedLessEqualF64 ||
                *machine_op == vkf::machine_ir::Opcode::OrderedEqualF64) {
                // UCOMISD sets ZF/CF for unordered operands too. Require PF=0
                // so NaN is never ordered or equal.
                code_.raw({0x0f, 0x9b, 0xc2, 0x20, 0xd0});
            } else if (*machine_op == vkf::machine_ir::Opcode::UnorderedNotEqualF64) {
                // Unordered operands compare not-equal.
                code_.raw({0x0f, 0x9a, 0xc2, 0x08, 0xd0});
            }
            code_.raw({0x0f, 0xb6, 0xc0, 0xf2, 0x0f, 0x2a, 0xc0});
            return;
        }
        if (kind == "call") {
            const auto& callee = object_of(field(expr, "callee", "call"), "callee");
            if (string_field(callee, "kind", "callee") != "load") throw BackendFailure("x64 backend supports direct calls only");
            const auto& args = array_of(field(expr, "args", "call"), "call args");
            if (args.size() > 4) throw BackendFailure("x64 backend currently supports at most four arguments");
            for (std::size_t index = 0; index < args.size(); ++index) {
                expression(object_of(args[index], "call argument"), frame, depth + static_cast<unsigned>(args.size()) + 1);
                store_xmm(0, frame.displacement(frame.temp_base + depth + static_cast<unsigned>(index)));
            }
            for (std::size_t index = 0; index < args.size(); ++index) {
                load_xmm(static_cast<unsigned>(index), frame.displacement(frame.temp_base + depth + static_cast<unsigned>(index)));
            }
            code_.byte(0xe8);
            calls_.push_back({code_.rel32_placeholder(), string_field(callee, "name", "callee")});
            return;
        }
        throw BackendFailure("unsupported x64 expression " + kind);
    }

    bool statements(const vf::JsonValue::Array& body, const FunctionFrame& frame, bool function_tail) {
        bool returned = false;
        for (std::size_t index = 0; index < body.size(); ++index) {
            const auto& statement = object_of(body[index], "statement");
            const std::string kind = string_field(statement, "kind", "statement");
            if (kind == "store_binding") {
                expression(object_of(field(statement, "value", "binding"), "binding value"), frame, 0);
                store_xmm(0, frame.displacement(frame.slot(string_field(statement, "name", "binding"))));
            } else if (kind == "return") {
                expression(object_of(field(statement, "value", "return"), "return value"), frame, 0);
                epilogue();
                returned = true;
            } else if (kind == "expr_stmt") {
                expression(object_of(field(statement, "expr", "expression statement"), "expression"), frame, 0);
                if (function_tail && index + 1 == body.size()) {
                    epilogue();
                    returned = true;
                }
            } else if (kind == "if_stmt") {
                const bool loop = field(statement, "loop", "if statement").as_boolean();
                const std::size_t loop_start = code_.position();
                expression(object_of(field(statement, "condition", "if statement"), "condition"), frame, 0);
                std::size_t false_patch = 0;
                emit_truth_jump_false(false_patch);
                const auto& block = object_of(field(statement, "body", "if statement"), "if body");
                statements(array_of(field(block, "body", "block"), "block body"), frame, false);
                if (loop) {
                    code_.byte(0xe9);
                    const std::size_t back = code_.rel32_placeholder();
                    code_.patch_rel32(back, loop_start);
                }
                code_.patch_rel32(false_patch, code_.position());
            } else {
                throw BackendFailure("unsupported x64 statement " + kind);
            }
        }
        return returned;
    }

    void emit_entry() {
        FunctionFrame frame = make_entry_frame(entry_statements_);
        prologue(frame);
        const vf::JsonValue::Object* output = nullptr;
        for (const auto* statement : entry_statements_) {
            const std::string kind = string_field(*statement, "kind", "top-level statement");
            if (kind == "store_binding") {
                if (output) throw BackendFailure("x64 top-level binding cannot follow output");
                expression(object_of(field(*statement, "value", "top-level binding"), "binding value"), frame, 0);
                store_xmm(0, frame.displacement(frame.slot(string_field(*statement, "name", "top-level binding"))));
                continue;
            }
            if (output) throw BackendFailure("x64 artifact currently supports one top-level output");
            output = statement;
        }
        if (!output) throw BackendFailure("x64 artifact needs a top-level output");
        const auto& outer = object_of(field(*output, "expr", "top-level expression"), "top-level call");
        const auto& outer_callee = object_of(field(outer, "callee", "top-level call"), "top-level callee");
        if (string_field(outer, "kind", "top-level expression") != "call" ||
            string_field(outer_callee, "kind", "top-level callee") != "stdlib_function" ||
            string_field(outer_callee, "name", "top-level callee") != "print") {
            throw BackendFailure("x64 artifact currently requires one top-level print");
        }
        const auto& args = array_of(field(outer, "args", "top-level print"), "top-level print args");
        if (args.size() != 1) throw BackendFailure("x64 artifact print requires one argument");
        expression(object_of(args.front(), "printed expression"), frame, 0);
        epilogue();
    }

    void emit_function(const vf::JsonValue::Object& function) {
        FunctionFrame frame = make_frame(&function);
        prologue(frame);
        const auto& params = array_of(field(function, "params", "function"), "function params");
        for (std::size_t index = 0; index < params.size(); ++index) {
            const std::string name = string_field(object_of(params[index], "param"), "name", "param");
            store_xmm(static_cast<unsigned>(index), frame.displacement(frame.slot(name)));
        }
        const auto& block = object_of(field(function, "body", "function"), "function body");
        if (!statements(array_of(field(block, "body", "block"), "block body"), frame, true)) {
            emit_number(0.0);
            epilogue();
        }
    }
};

struct MachineBranchPatch {
    std::size_t at;
    std::uint32_t label;
};

class MachineX64Emitter {
public:
    MachineX64Emitter(
        const vkf::machine_ir::Module& module,
        vkf::adaptive_optimizer::Policy policy = {}
    ) : module_(module), policy_(std::move(policy)) {}

    std::vector<unsigned char> emit() {
        offsets_[module_.entry.name] = code_.position();
        emit_function(module_.entry, true);
        for (const auto& function : module_.functions) {
            offsets_[function.name] = code_.position();
            emit_function(function, false);
        }
        for (const auto& patch : calls_) {
            const auto found = offsets_.find(patch.function);
            if (found == offsets_.end()) throw BackendFailure("unknown function " + patch.function);
            code_.patch_rel32(patch.at, found->second);
        }
        return std::move(code_.bytes);
    }

private:
    vkf::adaptive_optimizer::Policy policy_;
    struct Frame {
        unsigned local_count = 0;
        unsigned temp_base = 0;
        unsigned max_stack = 0;
        unsigned context_slot = 0;
        unsigned scratch_slot = 0;
        unsigned scratch_slots = 0;
        unsigned saved_xmm_slot = 0;
        unsigned saved_xmm_slots = 0;
        unsigned saved_gpr_slot = 0;
        unsigned saved_gpr_slots = 6;
        unsigned error_pointer_slot = 0;
        unsigned error_length_slot = 0;
        unsigned error_type_slot = 0;
        unsigned frame_bytes = 0;

        std::int32_t displacement(unsigned index) const {
            return -static_cast<std::int32_t>((index + 1) * 8);
        }
    };

    struct AffineTerm {
        std::uint32_t local = 0;
        double coefficient = 1.0;
        std::size_t next = 0;
    };

    struct AffineExpression {
        AffineTerm first;
        AffineTerm second;
        std::size_t next = 0;
    };

    struct AvxAffineLoopPlan {
        std::size_t end_index = 0;
        std::uint32_t counter_local = 0;
        std::uint32_t bound_local = 0;
        std::array<std::uint32_t, 4> state_locals{};
        std::array<unsigned char, 4> source_a{};
        std::array<unsigned char, 4> source_b{};
        std::array<double, 4> coefficient_a{};
        std::array<double, 4> coefficient_b{};
    };

    struct ScalarRecurrenceLoopPlan {
        std::size_t end_index = 0;
        std::uint32_t counter_local = 0;
        std::uint32_t bound_local = 0;
        std::uint32_t state_local = 0;
        std::uint32_t next_local = 0;
        double state_coefficient = 1.0;
        double counter_coefficient = 0.0;
        double threshold = 0.0;
        double wrap = 0.0;
        double increment = 1.0;
    };

    struct DenseAffineMapLoopPlan {
        std::size_t end_index = 0;
        std::uint32_t base_local = 0;
        std::uint32_t counter_local = 0;
        std::uint32_t width = 0;
        double scale = 1.0;
        double offset = 0.0;
    };

    struct DenseNumericMapLoopPlan {
        std::size_t end_index = 0;
        std::uint32_t base_local = 0;
        std::uint32_t counter_local = 0;
        std::uint32_t parameter_local = 0;
        std::uint32_t width = 0;
        unsigned max_stack = 0;
        std::vector<vkf::machine_ir::Instruction> expression;
        std::vector<double> constants;
    };

    struct PackedMatrixReductionLoopPlan {
        std::size_t end_index = 0;
        std::uint32_t row_local = 0;
        std::uint32_t counter_local = 0;
        std::uint32_t total_local = 0;
        std::uint32_t diagonal_local = 0;
        std::uint32_t input_base = 0;
        std::uint32_t width = 0;
        bool column_offset = false;
    };

    struct PackedDotReductionLoopPlan {
        std::size_t end_index = 0;
        std::uint32_t counter_local = 0;
        std::uint32_t numerator_local = 0;
        std::uint32_t denominator_local = 0;
        std::uint32_t left_base = 0;
        std::uint32_t right_base = 0;
        std::uint32_t width = 0;
    };

    const vkf::machine_ir::Module& module_;
    std::map<std::string, std::size_t> offsets_;
    std::vector<CallPatch> calls_;
    Code code_;
    std::int32_t saved_xmm6_displacement_ = 0;
    std::int32_t saved_xmm7_displacement_ = 0;
    std::int32_t saved_rbx_displacement_ = 0;
    std::int32_t saved_rsi_displacement_ = 0;
    std::int32_t saved_rdi_displacement_ = 0;
    std::int32_t saved_r13_displacement_ = 0;
    std::int32_t saved_r14_displacement_ = 0;
    std::int32_t saved_r15_displacement_ = 0;

    static std::optional<AffineTerm> parse_affine_term(
        const std::vector<vkf::machine_ir::Instruction>& instructions,
        std::size_t start
    ) {
        using vkf::machine_ir::Opcode;
        if (start >= instructions.size()) return std::nullopt;
        if (instructions[start].opcode == Opcode::LoadLocal) {
            if (start + 2 < instructions.size() &&
                instructions[start + 1].opcode == Opcode::PushF64 &&
                instructions[start + 2].opcode == Opcode::MultiplyF64) {
                return AffineTerm{
                    instructions[start].index, instructions[start + 1].f64, start + 3};
            }
            return AffineTerm{instructions[start].index, 1.0, start + 1};
        }
        if (instructions[start].opcode == Opcode::PushF64 &&
            start + 2 < instructions.size() &&
            instructions[start + 1].opcode == Opcode::LoadLocal &&
            instructions[start + 2].opcode == Opcode::MultiplyF64) {
            return AffineTerm{
                instructions[start + 1].index, instructions[start].f64, start + 3};
        }
        return std::nullopt;
    }

    static std::optional<AffineExpression> parse_affine_expression(
        const std::vector<vkf::machine_ir::Instruction>& instructions,
        std::size_t start
    ) {
        using vkf::machine_ir::Opcode;
        const auto first = parse_affine_term(instructions, start);
        if (!first) return std::nullopt;
        const auto second = parse_affine_term(instructions, first->next);
        if (!second || second->next >= instructions.size()) return std::nullopt;
        const auto combine = instructions[second->next].opcode;
        if (combine != Opcode::AddF64 && combine != Opcode::SubtractF64) {
            return std::nullopt;
        }
        auto adjusted_second = *second;
        if (combine == Opcode::SubtractF64) adjusted_second.coefficient = -adjusted_second.coefficient;
        return AffineExpression{*first, adjusted_second, second->next + 1};
    }

    static std::optional<AvxAffineLoopPlan> detect_avx_affine_loop(
        const vkf::machine_ir::Function& function,
        std::size_t label_index
    ) {
        using vkf::machine_ir::Opcode;
        if (!vkf::target::host_x64_supports_avx2() ||
            !vkf::target::host_x64_supports_fma()) {
            return std::nullopt;
        }
        const auto& instructions = function.instructions;
        if (label_index >= instructions.size() ||
            instructions[label_index].opcode != Opcode::Label ||
            label_index + 4 >= instructions.size()) {
            return std::nullopt;
        }
        const auto loop_label = instructions[label_index].label;
        const auto& counter = instructions[label_index + 1];
        const auto& bound = instructions[label_index + 2];
        const auto& comparison = instructions[label_index + 3];
        const auto& exit = instructions[label_index + 4];
        if (counter.opcode != Opcode::LoadLocal || bound.opcode != Opcode::LoadLocal ||
            comparison.opcode != Opcode::OrderedLessF64 ||
            exit.opcode != Opcode::JumpIfFalse || counter.index == bound.index) {
            return std::nullopt;
        }

        std::array<AffineExpression, 4> expressions{};
        std::size_t cursor = label_index + 5;
        for (auto& expression : expressions) {
            const auto parsed = parse_affine_expression(instructions, cursor);
            if (!parsed) return std::nullopt;
            expression = *parsed;
            cursor = parsed->next;
        }
        if (cursor + 9 >= instructions.size()) return std::nullopt;

        std::array<std::uint32_t, 4> destinations{};
        for (std::size_t store = 0; store < 4; ++store) {
            const auto& instruction = instructions[cursor + store];
            if (instruction.opcode != Opcode::StoreLocal) return std::nullopt;
            destinations[3 - store] = instruction.index;
        }
        const auto state_base = destinations[0];
        for (std::size_t index = 0; index < destinations.size(); ++index) {
            if (destinations[index] != state_base + index ||
                destinations[index] >= function.locals.size()) {
                return std::nullopt;
            }
        }
        cursor += 4;
        if (instructions[cursor].opcode != Opcode::LoadLocal ||
            instructions[cursor].index != counter.index ||
            instructions[cursor + 1].opcode != Opcode::PushF64 ||
            instructions[cursor + 1].f64 != 1.0 ||
            instructions[cursor + 2].opcode != Opcode::AddF64 ||
            instructions[cursor + 3].opcode != Opcode::StoreLocal ||
            instructions[cursor + 3].index != counter.index ||
            instructions[cursor + 4].opcode != Opcode::Jump ||
            instructions[cursor + 4].label != loop_label) {
            return std::nullopt;
        }
        if (counter.index >= function.locals.size() || bound.index >= function.locals.size() ||
            (counter.index >= state_base && counter.index < state_base + 4) ||
            (bound.index >= state_base && bound.index < state_base + 4)) {
            return std::nullopt;
        }

        AvxAffineLoopPlan plan;
        plan.end_index = cursor + 4;
        plan.counter_local = counter.index;
        plan.bound_local = bound.index;
        for (std::size_t index = 0; index < 4; ++index) {
            plan.state_locals[index] = destinations[index];
            const auto assign_term = [&](const AffineTerm& term, bool first) {
                if (term.local < state_base || term.local >= state_base + 4) return false;
                const auto source = static_cast<unsigned char>(term.local - state_base);
                if (first) {
                    plan.source_a[index] = source;
                    plan.coefficient_a[index] = term.coefficient;
                } else {
                    plan.source_b[index] = source;
                    plan.coefficient_b[index] = term.coefficient;
                }
                return true;
            };
            if (!assign_term(expressions[index].first, true) ||
                !assign_term(expressions[index].second, false)) {
                return std::nullopt;
            }
        }
        return plan;
    }

    static std::optional<ScalarRecurrenceLoopPlan> detect_scalar_recurrence_loop(
        const vkf::machine_ir::Function& function,
        std::size_t label_index
    ) {
        using vkf::machine_ir::Opcode;
        const auto& code = function.instructions;
        if (label_index >= code.size() || code[label_index].opcode != Opcode::Label ||
            label_index + 31 >= code.size()) {
            return std::nullopt;
        }
        const auto at = [&](std::size_t offset) -> const vkf::machine_ir::Instruction& {
            return code[label_index + offset];
        };
        const auto loop_label = at(0).label;
        if (at(1).opcode != Opcode::LoadLocal || at(2).opcode != Opcode::LoadLocal ||
            at(3).opcode != Opcode::OrderedLessF64 || at(4).opcode != Opcode::JumpIfFalse ||
            at(5).opcode != Opcode::LoadLocal || at(6).opcode != Opcode::PushF64 ||
            at(7).opcode != Opcode::MultiplyF64 || at(8).opcode != Opcode::LoadLocal ||
            at(9).opcode != Opcode::PushF64 || at(10).opcode != Opcode::MultiplyF64 ||
            at(11).opcode != Opcode::AddF64 || at(12).opcode != Opcode::StoreLocal ||
            at(13).opcode != Opcode::LoadLocal || at(14).opcode != Opcode::PushF64 ||
            at(15).opcode != Opcode::OrderedGreaterF64 ||
            at(16).opcode != Opcode::JumpIfFalse || at(17).opcode != Opcode::LoadLocal ||
            at(18).opcode != Opcode::PushF64 || at(19).opcode != Opcode::SubtractF64 ||
            at(20).opcode != Opcode::StoreLocal || at(21).opcode != Opcode::Jump ||
            at(22).opcode != Opcode::Label || at(23).opcode != Opcode::LoadLocal ||
            at(24).opcode != Opcode::StoreLocal || at(25).opcode != Opcode::Jump ||
            at(26).opcode != Opcode::Label || at(27).opcode != Opcode::LoadLocal ||
            at(28).opcode != Opcode::PushF64 || at(29).opcode != Opcode::AddF64 ||
            at(30).opcode != Opcode::StoreLocal || at(31).opcode != Opcode::Jump) {
            return std::nullopt;
        }

        const auto counter = at(1).index;
        const auto bound = at(2).index;
        const auto state = at(5).index;
        const auto next = at(12).index;
        if (counter == bound || counter == state || bound == state || next == counter ||
            next == bound || next == state || at(8).index != counter ||
            at(13).index != next || at(17).index != next || at(20).index != state ||
            at(23).index != next || at(24).index != state || at(27).index != counter ||
            at(30).index != counter || at(16).label != at(22).label ||
            at(21).label != at(26).label || at(25).label != at(26).label ||
            at(31).label != loop_label || counter >= function.locals.size() ||
            bound >= function.locals.size() || state >= function.locals.size() ||
            next >= function.locals.size()) {
            return std::nullopt;
        }

        ScalarRecurrenceLoopPlan plan;
        plan.end_index = label_index + 31;
        plan.counter_local = counter;
        plan.bound_local = bound;
        plan.state_local = state;
        plan.next_local = next;
        plan.state_coefficient = at(6).f64;
        plan.counter_coefficient = at(9).f64;
        plan.threshold = at(14).f64;
        plan.wrap = at(18).f64;
        plan.increment = at(28).f64;
        return plan;
    }

    static std::optional<DenseAffineMapLoopPlan> detect_dense_affine_map_loop(
        const vkf::machine_ir::Function& function,
        std::size_t label_index
    ) {
        using vkf::machine_ir::Opcode;
        if (!vkf::target::host_x64_supports_avx2()) return std::nullopt;
        const auto& code = function.instructions;
        if (label_index + 20 >= code.size()) return std::nullopt;
        const auto at = [&](std::size_t offset) -> const vkf::machine_ir::Instruction& {
            return code[label_index + offset];
        };
        if (at(0).opcode != Opcode::Label ||
            at(1).opcode != Opcode::LoadLocal ||
            at(2).opcode != Opcode::PushF64 ||
            at(3).opcode != Opcode::OrderedLessF64 ||
            at(4).opcode != Opcode::JumpIfFalse ||
            at(5).opcode != Opcode::LoadLocal ||
            at(6).opcode != Opcode::LoadLocal ||
            at(7).opcode != Opcode::LoadF64LocalsIndex ||
            at(8).opcode != Opcode::StoreLocal ||
            at(9).opcode != Opcode::LoadLocal ||
            at(10).opcode != Opcode::PushF64 ||
            at(11).opcode != Opcode::MultiplyF64 ||
            at(12).opcode != Opcode::PushF64 ||
            at(13).opcode != Opcode::AddF64 ||
            at(14).opcode != Opcode::StoreF64LocalsIndex ||
            at(15).opcode != Opcode::LoadLocal ||
            at(16).opcode != Opcode::PushF64 ||
            at(17).opcode != Opcode::AddF64 ||
            at(18).opcode != Opcode::StoreLocal ||
            at(19).opcode != Opcode::Jump ||
            at(20).opcode != Opcode::Label) {
            return std::nullopt;
        }
        const auto counter = at(1).index;
        const auto width_value = at(2).f64;
        if (width_value < 8.0 || width_value != std::floor(width_value) ||
            width_value > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
            return std::nullopt;
        }
        const auto width = static_cast<std::uint32_t>(width_value);
        if (at(4).label != at(20).label || at(5).index != counter ||
            at(6).index != counter || !at(7).index_is_integral ||
            !at(7).index_local || *at(7).index_local != counter ||
            at(7).argument_count != width || at(8).index != at(9).index ||
            at(14).index != at(7).index || at(14).argument_count != width ||
            !at(14).index_is_integral || !at(14).index_local ||
            *at(14).index_local != counter || at(15).index != counter ||
            at(16).f64 != 1.0 || at(18).index != counter ||
            at(19).label != at(0).label ||
            at(7).index > function.locals.size() ||
            width > function.locals.size() - at(7).index) {
            return std::nullopt;
        }
        return DenseAffineMapLoopPlan{
            label_index + 19, at(7).index, counter, width, at(10).f64, at(12).f64
        };
    }

    static std::optional<DenseNumericMapLoopPlan> detect_dense_numeric_map_loop(
        const vkf::machine_ir::Function& function,
        std::size_t label_index
    ) {
        using vkf::machine_ir::Opcode;
        if (!vkf::target::host_x64_supports_avx2()) return std::nullopt;
        const auto& code = function.instructions;
        if (label_index + 16 >= code.size()) return std::nullopt;
        const auto at = [&](std::size_t offset) -> const vkf::machine_ir::Instruction& {
            return code[label_index + offset];
        };
        if (at(0).opcode != Opcode::Label || at(1).opcode != Opcode::LoadLocal ||
            at(2).opcode != Opcode::PushF64 || at(3).opcode != Opcode::OrderedLessF64 ||
            at(4).opcode != Opcode::JumpIfFalse || at(5).opcode != Opcode::LoadLocal ||
            at(6).opcode != Opcode::LoadLocal || at(7).opcode != Opcode::LoadF64LocalsIndex ||
            at(8).opcode != Opcode::StoreLocal) {
            return std::nullopt;
        }
        const auto counter = at(1).index;
        const auto width_value = at(2).f64;
        if (width_value < 8.0 || width_value != std::floor(width_value) ||
            width_value > static_cast<double>(std::numeric_limits<std::uint32_t>::max()) ||
            at(5).index != counter || at(6).index != counter ||
            !at(7).index_is_integral || !at(7).index_local ||
            *at(7).index_local != counter) {
            return std::nullopt;
        }
        const auto width = static_cast<std::uint32_t>(width_value);
        const auto base = at(7).index;
        const auto parameter = at(8).index;
        if (at(7).argument_count != width || base > function.locals.size() ||
            width > function.locals.size() - base) {
            return std::nullopt;
        }

        DenseNumericMapLoopPlan plan;
        plan.base_local = base;
        plan.counter_local = counter;
        plan.parameter_local = parameter;
        plan.width = width;
        unsigned depth = 0;
        std::size_t cursor = label_index + 9;
        for (; cursor < code.size(); ++cursor) {
            const auto& instruction = code[cursor];
            if (instruction.opcode == Opcode::StoreF64LocalsIndex) break;
            if (instruction.opcode == Opcode::LoadLocal && instruction.index == parameter) {
                ++depth;
            } else if (instruction.opcode == Opcode::PushF64) {
                ++depth;
                if (std::find(plan.constants.begin(), plan.constants.end(), instruction.f64) ==
                    plan.constants.end()) {
                    plan.constants.push_back(instruction.f64);
                }
            } else if (instruction.opcode == Opcode::SqrtF64) {
                if (depth < 1) return std::nullopt;
            } else if (instruction.opcode == Opcode::AddF64 ||
                       instruction.opcode == Opcode::SubtractF64 ||
                       instruction.opcode == Opcode::MultiplyF64 ||
                       instruction.opcode == Opcode::DivideF64) {
                if (depth < 2) return std::nullopt;
                --depth;
            } else {
                return std::nullopt;
            }
            plan.max_stack = std::max(plan.max_stack, depth);
            if (plan.max_stack > 4) return std::nullopt;
            plan.expression.push_back(instruction);
        }
        if (cursor + 6 >= code.size() || depth != 1 || plan.expression.empty() ||
            plan.constants.size() > 2) {
            return std::nullopt;
        }
        const auto& store = code[cursor];
        if (store.index != base || store.argument_count != width ||
            !store.index_is_integral || !store.index_local ||
            *store.index_local != counter ||
            code[cursor + 1].opcode != Opcode::LoadLocal ||
            code[cursor + 1].index != counter ||
            code[cursor + 2].opcode != Opcode::PushF64 || code[cursor + 2].f64 != 1.0 ||
            code[cursor + 3].opcode != Opcode::AddF64 ||
            code[cursor + 4].opcode != Opcode::StoreLocal ||
            code[cursor + 4].index != counter ||
            code[cursor + 5].opcode != Opcode::Jump ||
            code[cursor + 5].label != at(0).label ||
            code[cursor + 6].opcode != Opcode::Label ||
            code[cursor + 6].label != at(4).label) {
            return std::nullopt;
        }
        plan.end_index = cursor + 5;
        return plan;
    }

    static std::optional<PackedMatrixReductionLoopPlan>
    detect_packed_matrix_reduction_loop(
        const vkf::machine_ir::Function& function,
        std::size_t label_index
    ) {
        using vkf::machine_ir::Opcode;
        if (!vkf::target::host_x64_supports_avx2()) return std::nullopt;
        const auto& code = function.instructions;
        if (label_index + 33 >= code.size()) return std::nullopt;
        const auto at = [&](std::size_t offset) -> const vkf::machine_ir::Instruction& {
            return code[label_index + offset];
        };
        if (at(0).opcode != Opcode::Label || at(1).opcode != Opcode::LoadLocal ||
            at(2).opcode != Opcode::PushF64 || at(3).opcode != Opcode::OrderedLessF64 ||
            at(4).opcode != Opcode::JumpIfFalse || at(5).opcode != Opcode::LoadLocal ||
            at(6).opcode != Opcode::LoadLocal || at(7).opcode != Opcode::AddF64 ||
            at(8).opcode != Opcode::StoreLocal || at(9).opcode != Opcode::LoadLocal ||
            at(10).opcode != Opcode::PushF64 || at(10).f64 != 1.0 ||
            at(11).opcode != Opcode::LoadLocal || at(12).opcode != Opcode::LoadLocal ||
            at(13).opcode != Opcode::PushF64 || at(13).f64 != 1.0 ||
            at(14).opcode != Opcode::AddF64 || at(15).opcode != Opcode::MultiplyF64 ||
            at(16).opcode != Opcode::PushF64 || at(16).f64 != 2.0 ||
            at(17).opcode != Opcode::DivideF64 || at(18).opcode != Opcode::LoadLocal ||
            at(19).opcode != Opcode::AddF64 || at(20).opcode != Opcode::PushF64 ||
            at(20).f64 != 1.0 || at(21).opcode != Opcode::AddF64 ||
            at(22).opcode != Opcode::DivideF64 || at(23).opcode != Opcode::LoadLocal ||
            at(24).opcode != Opcode::LoadF64LocalsIndex ||
            at(25).opcode != Opcode::MultiplyF64 || at(26).opcode != Opcode::AddF64 ||
            at(27).opcode != Opcode::StoreLocal) {
            return std::nullopt;
        }
        // Pipe/range lowering may retain the body's continuation label between
        // the reduction and induction-variable increment.  It is semantically
        // empty here and must not disable the packed matrix reduction.
        const std::size_t tail = at(28).opcode == Opcode::Label ? 29u : 28u;
        if (label_index + tail + 5u >= code.size() ||
            at(tail).opcode != Opcode::LoadLocal ||
            at(tail + 1u).opcode != Opcode::PushF64 || at(tail + 1u).f64 != 1.0 ||
            at(tail + 2u).opcode != Opcode::AddF64 ||
            at(tail + 3u).opcode != Opcode::StoreLocal ||
            at(tail + 4u).opcode != Opcode::Jump ||
            at(tail + 5u).opcode != Opcode::Label) {
            return std::nullopt;
        }
        const auto width_value = at(2).f64;
        if (width_value < 8.0 || width_value != std::floor(width_value) ||
            width_value > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
            return std::nullopt;
        }
        const auto width = static_cast<std::uint32_t>(width_value);
        const auto counter = at(1).index;
        const auto row = at(5).index == counter ? at(6).index
            : at(6).index == counter ? at(5).index
            : std::numeric_limits<std::uint32_t>::max();
        const auto diagonal = at(8).index;
        const auto total = at(9).index;
        if (row == std::numeric_limits<std::uint32_t>::max() ||
            counter == row || counter >= function.locals.size() ||
            row >= function.locals.size() || total >= function.locals.size() ||
            diagonal >= function.locals.size() ||
            at(4).label != at(tail + 5u).label ||
            at(tail + 4u).label != at(0).label ||
            at(11).index != diagonal || at(12).index != diagonal ||
            (at(18).index != row && at(18).index != counter) ||
            at(23).index != counter || !at(24).index_is_integral ||
            !at(24).index_local || *at(24).index_local != counter ||
            at(24).argument_count < width || at(27).index != total ||
            at(tail).index != counter || at(tail + 3u).index != counter ||
            at(24).index > function.locals.size() ||
            width > function.locals.size() - at(24).index) {
            return std::nullopt;
        }
        return PackedMatrixReductionLoopPlan{
            label_index + tail + 4u, row, counter, total, diagonal,
            at(24).index, width, at(18).index == counter
        };
    }

    static std::optional<PackedDotReductionLoopPlan>
    detect_packed_dot_reduction_loop(
        const vkf::machine_ir::Function& function,
        std::size_t label_index
    ) {
        using vkf::machine_ir::Opcode;
        if (!vkf::target::host_x64_supports_avx2()) return std::nullopt;
        const auto& code = function.instructions;
        if (label_index + 26 >= code.size()) return std::nullopt;
        const auto at = [&](std::size_t offset) -> const vkf::machine_ir::Instruction& {
            return code[label_index + offset];
        };
        if (at(0).opcode != Opcode::Label || at(1).opcode != Opcode::LoadLocal ||
            at(2).opcode != Opcode::PushF64 || at(3).opcode != Opcode::OrderedLessF64 ||
            at(4).opcode != Opcode::JumpIfFalse || at(5).opcode != Opcode::LoadLocal ||
            at(6).opcode != Opcode::LoadLocal || at(7).opcode != Opcode::LoadF64LocalsIndex ||
            at(8).opcode != Opcode::LoadLocal || at(9).opcode != Opcode::LoadF64LocalsIndex ||
            at(10).opcode != Opcode::MultiplyF64 || at(11).opcode != Opcode::AddF64 ||
            at(12).opcode != Opcode::StoreLocal || at(13).opcode != Opcode::LoadLocal ||
            at(14).opcode != Opcode::LoadLocal || at(15).opcode != Opcode::LoadF64LocalsIndex ||
            at(16).opcode != Opcode::LoadLocal || at(17).opcode != Opcode::LoadF64LocalsIndex ||
            at(18).opcode != Opcode::MultiplyF64 || at(19).opcode != Opcode::AddF64 ||
            at(20).opcode != Opcode::StoreLocal || at(21).opcode != Opcode::LoadLocal ||
            at(22).opcode != Opcode::PushF64 || at(22).f64 != 1.0 ||
            at(23).opcode != Opcode::AddF64 || at(24).opcode != Opcode::StoreLocal ||
            at(25).opcode != Opcode::Jump || at(26).opcode != Opcode::Label) {
            return std::nullopt;
        }
        const auto width_value = at(2).f64;
        if (width_value < 8.0 || width_value != std::floor(width_value) ||
            width_value > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
            return std::nullopt;
        }
        const auto width = static_cast<std::uint32_t>(width_value);
        const auto counter = at(1).index;
        const auto valid_index = [&](std::size_t load, std::size_t indexed) {
            return at(load).index == counter && at(indexed).index_is_integral &&
                at(indexed).index_local && *at(indexed).index_local == counter &&
                at(indexed).argument_count >= width &&
                at(indexed).index <= function.locals.size() &&
                width <= function.locals.size() - at(indexed).index;
        };
        if (counter >= function.locals.size() ||
            at(4).label != at(26).label || at(25).label != at(0).label ||
            !valid_index(6, 7) || !valid_index(8, 9) ||
            !valid_index(14, 15) || !valid_index(16, 17) ||
            at(9).index != at(15).index || at(9).index != at(17).index ||
            at(12).index != at(5).index || at(20).index != at(13).index ||
            at(21).index != counter || at(24).index != counter) {
            return std::nullopt;
        }
        return PackedDotReductionLoopPlan{
            label_index + 25, counter, at(5).index, at(13).index,
            at(7).index, at(9).index, width
        };
    }

    void emit_dense_numeric_map_loop(
        const Frame& frame,
        const DenseNumericMapLoopPlan& plan
    ) {
        using vkf::machine_ir::Opcode;
        for (std::size_t index = 0; index < plan.constants.size(); ++index) {
            const unsigned reg = static_cast<unsigned>(4 + index);
            emit_number(plan.constants[index], reg);
            code_.raw({0xc4, 0xe2, 0x7d, 0x19,
                       static_cast<unsigned>(0xc0 + reg * 9)});
        }
        const auto constant_register = [&](double value) {
            const auto found = std::find(plan.constants.begin(), plan.constants.end(), value);
            if (found == plan.constants.end()) {
                throw BackendFailure("missing x64 vector-map constant");
            }
            return static_cast<unsigned>(4 + (found - plan.constants.begin()));
        };
        const auto emit_vector_expression = [&]() {
            std::vector<unsigned> stack;
            for (const auto& instruction : plan.expression) {
                if (instruction.opcode == Opcode::LoadLocal) {
                    const unsigned reg = static_cast<unsigned>(stack.size());
                    code_.raw({0xc5, 0xfd, 0x10, reg * 8u});
                    stack.push_back(reg);
                } else if (instruction.opcode == Opcode::PushF64) {
                    const unsigned reg = static_cast<unsigned>(stack.size());
                    const unsigned source = constant_register(instruction.f64);
                    code_.raw({0xc5, 0xfd, 0x28,
                               static_cast<unsigned>(0xc0 + reg * 8 + source)});
                    stack.push_back(reg);
                } else if (instruction.opcode == Opcode::SqrtF64) {
                    const unsigned reg = stack.back();
                    code_.raw({0xc5, 0xfd, 0x51,
                               static_cast<unsigned>(0xc0 + reg * 9)});
                } else {
                    const unsigned right = stack.back();
                    stack.pop_back();
                    const unsigned left = stack.back();
                    const unsigned vex = 0x85u | (((~left) & 0x0fu) << 3u);
                    const unsigned opcode = instruction.opcode == Opcode::AddF64 ? 0x58
                        : instruction.opcode == Opcode::SubtractF64 ? 0x5c
                        : instruction.opcode == Opcode::MultiplyF64 ? 0x59 : 0x5e;
                    code_.raw({0xc5, vex, opcode,
                               static_cast<unsigned>(0xc0 + left * 8 + right)});
                }
            }
            const unsigned result = stack.back();
            code_.raw({0xc5, 0xfd, 0x11, result * 8u});
        };

        const auto blocks = plan.width / 4u;
        if (blocks != 0) {
            code_.raw({0x48, 0x8d, 0x85});
            code_.i32(frame.displacement(plan.base_local + 3u));
            code_.raw({0xb9});
            code_.i32(static_cast<std::int32_t>(blocks));
            const auto loop = code_.position();
            emit_vector_expression();
            code_.raw({0x48, 0x83, 0xe8, 0x20,
                       0xff, 0xc9,
                       0x0f, 0x85});
            const auto repeat = code_.rel32_placeholder();
            code_.patch_rel32(repeat, loop);
        }
        code_.raw({0xc5, 0xf8, 0x77});

        for (std::uint32_t element = blocks * 4u; element < plan.width; ++element) {
            unsigned depth = 0;
            for (const auto& instruction : plan.expression) {
                if (instruction.opcode == Opcode::LoadLocal) {
                    load_xmm(depth, frame.displacement(plan.base_local + element));
                    ++depth;
                } else if (instruction.opcode == Opcode::PushF64) {
                    emit_number(instruction.f64, depth++);
                } else if (instruction.opcode == Opcode::SqrtF64) {
                    const unsigned reg = depth - 1;
                    code_.raw({0xf2, 0x0f, 0x51,
                               static_cast<unsigned>(0xc0 + reg * 9)});
                } else {
                    const unsigned right = --depth;
                    const unsigned left = depth - 1;
                    const unsigned opcode = instruction.opcode == Opcode::AddF64 ? 0x58
                        : instruction.opcode == Opcode::SubtractF64 ? 0x5c
                        : instruction.opcode == Opcode::MultiplyF64 ? 0x59 : 0x5e;
                    code_.raw({0xf2, 0x0f, opcode,
                               static_cast<unsigned>(0xc0 + left * 8 + right)});
                }
            }
            store_xmm(0, frame.displacement(plan.base_local + element));
        }
        emit_number(static_cast<double>(plan.width));
        store_xmm(0, frame.displacement(plan.counter_local));
    }

    void emit_dense_affine_map_loop(
        const Frame& frame,
        const DenseAffineMapLoopPlan& plan
    ) {
        const std::array<double, 4> scales{
            plan.scale, plan.scale, plan.scale, plan.scale};
        const std::array<double, 4> offsets{
            plan.offset, plan.offset, plan.offset, plan.offset};
        if (plan.scale != 1.0) emit_ymm_constant(1, scales);
        if (plan.offset != 0.0) emit_ymm_constant(2, offsets);

        const auto blocks = plan.width / 4u;
        if (blocks != 0) {
            code_.raw({0x48, 0x8d, 0x85});
            code_.i32(frame.displacement(plan.base_local + 3u));
            code_.raw({0xb9});
            code_.i32(static_cast<std::int32_t>(blocks));
            const auto loop = code_.position();
            code_.raw({0xc5, 0xfd, 0x10, 0x00});
            if (plan.scale != 1.0) code_.raw({0xc5, 0xfd, 0x59, 0xc1});
            if (plan.offset != 0.0) code_.raw({0xc5, 0xfd, 0x58, 0xc2});
            code_.raw({0xc5, 0xfd, 0x11, 0x00,
                       0x48, 0x83, 0xe8, 0x20,
                       0xff, 0xc9,
                       0x0f, 0x85});
            const auto repeat = code_.rel32_placeholder();
            code_.patch_rel32(repeat, loop);
        }
        code_.raw({0xc5, 0xf8, 0x77});
        for (std::uint32_t index = blocks * 4u; index < plan.width; ++index) {
            load_xmm(0, frame.displacement(plan.base_local + index));
            if (plan.scale != 1.0) {
                emit_number(plan.scale, 1);
                code_.raw({0xf2, 0x0f, 0x59, 0xc1});
            }
            if (plan.offset != 0.0) {
                emit_number(plan.offset, 1);
                code_.raw({0xf2, 0x0f, 0x58, 0xc1});
            }
            store_xmm(0, frame.displacement(plan.base_local + index));
        }
        emit_number(static_cast<double>(plan.width));
        store_xmm(0, frame.displacement(plan.counter_local));
    }

    static Frame make_frame(const vkf::machine_ir::Function& function, bool entry) {
        constexpr auto target = vkf::target::host_x64_contract();
        Frame frame;
        frame.local_count = static_cast<unsigned>(function.locals.size());
        frame.temp_base = frame.local_count;
        frame.max_stack = function.max_stack;
        frame.context_slot = frame.local_count + frame.max_stack;
        frame.scratch_slot = frame.context_slot + 1u;
        const bool needs_scratch = std::any_of(
            function.instructions.begin(), function.instructions.end(), [](const auto& instruction) {
                using vkf::machine_ir::Opcode;
                return instruction.opcode == Opcode::StringEqual ||
                    instruction.opcode == Opcode::StringNotEqual ||
                    instruction.opcode == Opcode::StringLess ||
                    instruction.opcode == Opcode::StringLessEqual ||
                    instruction.opcode == Opcode::StringGreater ||
                    instruction.opcode == Opcode::StringGreaterEqual ||
                    instruction.opcode == Opcode::FormatF64String ||
                    instruction.opcode == Opcode::FormatChrString ||
                    instruction.opcode == Opcode::ReadFileString ||
                    instruction.opcode == Opcode::WriteFileString ||
                    instruction.opcode == Opcode::SystemCwdString ||
                    instruction.opcode == Opcode::SystemEnvString;
            });
        const bool needs_process_scratch = std::any_of(
            function.instructions.begin(), function.instructions.end(), [](const auto& instruction) {
                return instruction.opcode == vkf::machine_ir::Opcode::ProcessRun;
            });
        unsigned capture_scratch_slots = 0;
        for (const auto& instruction : function.instructions) {
            if (instruction.opcode != vkf::machine_ir::Opcode::CaptureRegex) continue;
            const auto pattern = vkf::capture::parse(instruction.symbol);
            const auto atoms = static_cast<unsigned>(std::count_if(
                pattern.ops.begin(), pattern.ops.end(), [](const auto& op) {
                    return op.kind == vkf::capture::OpKind::Atom;
                }));
            capture_scratch_slots = std::max(capture_scratch_slots, 3u + atoms * 2u);
        }
        const bool needs_line_scratch = std::any_of(
            function.instructions.begin(), function.instructions.end(), [](const auto& instruction) {
                return instruction.opcode == vkf::machine_ir::Opcode::ReadLineString;
            });
        frame.scratch_slots = std::max({
            needs_process_scratch ? 9u : 0u,
            needs_line_scratch ? 4u : 0u,
            capture_scratch_slots,
            static_cast<unsigned>(needs_scratch),
        });
        frame.saved_xmm_slot = frame.scratch_slot + frame.scratch_slots;
#ifdef _WIN32
        frame.saved_xmm_slots = 4u;
#endif
        frame.saved_gpr_slot = frame.saved_xmm_slot + frame.saved_xmm_slots;
        frame.error_pointer_slot = frame.saved_gpr_slot + frame.saved_gpr_slots;
        frame.error_length_slot = frame.error_pointer_slot + 1u;
        frame.error_type_slot = frame.error_length_slot + 1u;
        const unsigned value_slots = frame.local_count + frame.max_stack + 1u +
            frame.scratch_slots + frame.saved_xmm_slots + frame.saved_gpr_slots +
            (function.may_error ? 3u : 0u);
        const unsigned used = value_slots * 8 + target.caller_shadow_bytes;
        frame.frame_bytes = (used + target.stack_alignment - 1) & ~(target.stack_alignment - 1u);
        return frame;
    }

    void prologue(const Frame& frame) {
        code_.raw({0x55, 0x48, 0x89, 0xe5});
        emit_stack_allocation(code_, frame.frame_bytes);
#ifdef _WIN32
        code_.raw({0xf3, 0x0f, 0x7f, 0xb5});
        code_.i32(frame.displacement(frame.saved_xmm_slot));
        code_.raw({0xf3, 0x0f, 0x7f, 0xbd});
        code_.i32(frame.displacement(frame.saved_xmm_slot + 2u));
        saved_xmm6_displacement_ = frame.displacement(frame.saved_xmm_slot);
        saved_xmm7_displacement_ = frame.displacement(frame.saved_xmm_slot + 2u);
#endif
        code_.raw({0x48, 0x89, 0x9d});
        code_.i32(frame.displacement(frame.saved_gpr_slot));
        code_.raw({0x48, 0x89, 0xb5});
        code_.i32(frame.displacement(frame.saved_gpr_slot + 1u));
        code_.raw({0x48, 0x89, 0xbd});
        code_.i32(frame.displacement(frame.saved_gpr_slot + 2u));
        code_.raw({0x4c, 0x89, 0xad});
        code_.i32(frame.displacement(frame.saved_gpr_slot + 3u));
        code_.raw({0x4c, 0x89, 0xb5});
        code_.i32(frame.displacement(frame.saved_gpr_slot + 4u));
        code_.raw({0x4c, 0x89, 0xbd});
        code_.i32(frame.displacement(frame.saved_gpr_slot + 5u));
        saved_rbx_displacement_ = frame.displacement(frame.saved_gpr_slot);
        saved_rsi_displacement_ = frame.displacement(frame.saved_gpr_slot + 1u);
        saved_rdi_displacement_ = frame.displacement(frame.saved_gpr_slot + 2u);
        saved_r13_displacement_ = frame.displacement(frame.saved_gpr_slot + 3u);
        saved_r14_displacement_ = frame.displacement(frame.saved_gpr_slot + 4u);
        saved_r15_displacement_ = frame.displacement(frame.saved_gpr_slot + 5u);
    }

    void epilogue() {
#ifdef _WIN32
        code_.raw({0xf3, 0x0f, 0x6f, 0xb5});
        code_.i32(saved_xmm6_displacement_);
        code_.raw({0xf3, 0x0f, 0x6f, 0xbd});
        code_.i32(saved_xmm7_displacement_);
#endif
        code_.raw({0x48, 0x8b, 0x9d});
        code_.i32(saved_rbx_displacement_);
        code_.raw({0x48, 0x8b, 0xb5});
        code_.i32(saved_rsi_displacement_);
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(saved_rdi_displacement_);
        code_.raw({0x4c, 0x8b, 0xad});
        code_.i32(saved_r13_displacement_);
        code_.raw({0x4c, 0x8b, 0xb5});
        code_.i32(saved_r14_displacement_);
        code_.raw({0x4c, 0x8b, 0xbd});
        code_.i32(saved_r15_displacement_);
        code_.raw({0xc9, 0xc3});
    }

    void save_runtime_context(const Frame& frame) {
        code_.raw({0x4c, 0x89, 0xa5});
        code_.i32(frame.displacement(frame.context_slot));
#ifdef _WIN32
        code_.raw({0x49, 0x89, 0xcc});
#else
        code_.raw({0x49, 0x89, 0xfc});
#endif
    }

    void restore_runtime_context(const Frame& frame) {
        code_.raw({0x4c, 0x8b, 0xa5});
        code_.i32(frame.displacement(frame.context_slot));
    }

    void save_result_context(const Frame& frame) {
        code_.raw({0x4c, 0x89, 0x9d});
        code_.i32(frame.displacement(frame.context_slot));
    }

    void restore_result_context(const Frame& frame) {
        code_.raw({0x4c, 0x8b, 0x9d});
        code_.i32(frame.displacement(frame.context_slot));
    }

    void load_argument_from_r10(std::uint32_t index) {
        code_.raw({0xf2, 0x41, 0x0f, 0x10, 0x82});
        code_.i32(-static_cast<std::int32_t>(index * 8));
    }

    void store_result_to_r11(std::uint32_t index) {
        code_.raw({0xf2, 0x41, 0x0f, 0x11, 0x83});
        code_.i32(-static_cast<std::int32_t>(index * 8));
    }

    static void require_stack(unsigned depth, unsigned count) {
        if (depth < count) throw BackendFailure("invalid x64 machine IR stack");
    }

    void store_xmm(unsigned xmm, std::int32_t displacement) {
        if (xmm > 7) throw BackendFailure("invalid x64 argument register");
        code_.raw({0xf2, 0x0f, 0x11, static_cast<unsigned>(0x85 + xmm * 8)});
        code_.i32(displacement);
    }

    void load_xmm(unsigned xmm, std::int32_t displacement) {
        if (xmm > 7) throw BackendFailure("invalid x64 argument register");
        code_.raw({0xf2, 0x0f, 0x10, static_cast<unsigned>(0x85 + xmm * 8)});
        code_.i32(displacement);
    }

    void emit_number(double value, unsigned xmm = 0) {
        if (xmm > 7) throw BackendFailure("invalid x64 number register");
        std::uint64_t bits = 0;
        std::memcpy(&bits, &value, sizeof(bits));
        code_.raw({0x48, 0xb8});
        code_.u64(bits);
        code_.raw({0x66, 0x48, 0x0f, 0x6e, static_cast<unsigned>(0xc0 + xmm * 8)});
    }

    void emit_ymm_constant(unsigned ymm, const std::array<double, 4>& values) {
        if (ymm == 0 || ymm > 4) throw BackendFailure("invalid x64 AVX constant register");
        emit_number(values[0], ymm);
        emit_number(values[1], 0);
        code_.raw({0x66, 0x0f, 0x14, static_cast<unsigned>(0xc0 + ymm * 8)});
        emit_number(values[2], 5);
        emit_number(values[3], 0);
        code_.raw({0x66, 0x0f, 0x14, 0xe8});
        const auto vex = static_cast<unsigned>(((~ymm) & 0x0f) << 3) | 0x05;
        code_.raw({0xc4, 0xe3, vex, 0x18,
                   static_cast<unsigned>(0xc0 + ymm * 8 + 5), 0x01});
    }

    void emit_scalar_recurrence_loop(
        const Frame& frame,
        const ScalarRecurrenceLoopPlan& plan
    ) {
        const std::array<double, 5> constants{
            plan.state_coefficient,
            plan.counter_coefficient,
            plan.threshold,
            plan.wrap,
            plan.increment,
        };
        std::array<std::size_t, constants.size()> literals{};
        code_.byte(0xe9);
        const auto skip_literals = code_.rel32_placeholder();
        for (std::size_t index = 0; index < constants.size(); ++index) {
            literals[index] = code_.position();
            std::uint64_t bits = 0;
            std::memcpy(&bits, &constants[index], sizeof(bits));
            code_.u64(bits);
        }
        code_.patch_rel32(skip_literals, code_.position());

        load_xmm(0, frame.displacement(plan.state_local));
        load_xmm(1, frame.displacement(plan.counter_local));
        load_xmm(2, frame.displacement(plan.bound_local));
        code_.raw({0xf2, 0x0f, 0x10, 0x1d});
        const auto state_coefficient = code_.rel32_placeholder();
        code_.patch_rel32(state_coefficient, literals[0]);
        code_.raw({0xf2, 0x0f, 0x10, 0x2d});
        const auto threshold = code_.rel32_placeholder();
        code_.patch_rel32(threshold, literals[2]);

        const auto loop = code_.position();
        code_.raw({0x66, 0x0f, 0x2e, 0xca});
        const auto finished_ordered = emit_jump(0x83);
        const auto finished_unordered = emit_jump(0x8a);

        code_.raw({0x66, 0x0f, 0x28, 0xe0});
        code_.raw({0xf2, 0x0f, 0x59, 0xe3});
        code_.raw({0x66, 0x0f, 0x28, 0xc1});
        code_.raw({0xf2, 0x0f, 0x59, 0x05});
        const auto counter_coefficient = code_.rel32_placeholder();
        code_.patch_rel32(counter_coefficient, literals[1]);
        code_.raw({0xf2, 0x0f, 0x58, 0xe0});
        code_.raw({0x66, 0x0f, 0x2e, 0xe5});
        const auto no_wrap = emit_jump(0x86);
        code_.raw({0xf2, 0x0f, 0x5c, 0x25});
        const auto wrap = code_.rel32_placeholder();
        code_.patch_rel32(wrap, literals[3]);
        code_.patch_rel32(no_wrap, code_.position());
        code_.raw({0x66, 0x0f, 0x28, 0xc4});
        code_.raw({0xf2, 0x0f, 0x58, 0x0d});
        const auto increment = code_.rel32_placeholder();
        code_.patch_rel32(increment, literals[4]);
        code_.byte(0xe9);
        const auto repeat = code_.rel32_placeholder();
        code_.patch_rel32(repeat, loop);

        const auto cleanup = code_.position();
        code_.patch_rel32(finished_ordered, cleanup);
        code_.patch_rel32(finished_unordered, cleanup);
        store_xmm(0, frame.displacement(plan.state_local));
        store_xmm(0, frame.displacement(plan.next_local));
        store_xmm(1, frame.displacement(plan.counter_local));
    }

    void emit_avx_affine_loop(const Frame& frame, const AvxAffineLoopPlan& plan) {
        code_.byte(0xe9);
        const auto skip_one = code_.rel32_placeholder();
        const auto one = code_.position();
        std::uint64_t one_bits = 0;
        const double one_value = 1.0;
        std::memcpy(&one_bits, &one_value, sizeof(one_bits));
        code_.u64(one_bits);
        code_.patch_rel32(skip_one, code_.position());

        emit_ymm_constant(1, plan.coefficient_a);
        emit_ymm_constant(2, plan.coefficient_b);
        load_xmm(3, frame.displacement(plan.counter_local));
        load_xmm(4, frame.displacement(plan.bound_local));

        code_.raw({0xc5, 0xfd, 0x10, 0x85});
        code_.i32(frame.displacement(plan.state_locals[3]));
        code_.raw({0xc4, 0xe3, 0xfd, 0x01, 0xc0, 0x1b});

        code_.raw({0xc5, 0xf9, 0x2e, 0xe3});
        const auto finished = emit_jump(0x86);
        const auto loop = code_.position();

        const auto selector = [](const std::array<unsigned char, 4>& sources) {
            return static_cast<unsigned>(sources[0] | (sources[1] << 2) |
                (sources[2] << 4) | (sources[3] << 6));
        };
        code_.raw({0xc4, 0xe3, 0xfd, 0x01, 0xe8, selector(plan.source_b)});
        code_.raw({0xc5, 0xd5, 0x59, 0xea});
        const auto source_a = selector(plan.source_a);
        if (source_a != 0xe4) {
            code_.raw({0xc4, 0xe3, 0xfd, 0x01, 0xc0, source_a});
        }
        code_.raw({0xc4, 0xe2, 0xd5, 0x98, 0xc1});
        code_.raw({0xc5, 0xe3, 0x58, 0x1d});
        const auto one_reference = code_.rel32_placeholder();
        code_.patch_rel32(one_reference, one);
        code_.raw({0xc5, 0xf9, 0x2e, 0xe3});
        const auto repeat = emit_jump(0x87);
        code_.patch_rel32(repeat, loop);

        const auto cleanup = code_.position();
        code_.patch_rel32(finished, cleanup);
        code_.raw({0xc4, 0xe3, 0xfd, 0x01, 0xc0, 0x1b});
        code_.raw({0xc5, 0xfd, 0x11, 0x85});
        code_.i32(frame.displacement(plan.state_locals[3]));
        code_.raw({0xc5, 0xf8, 0x77});
        store_xmm(3, frame.displacement(plan.counter_local));
    }

#ifndef _WIN32
    static bool is_second_order_affine_loop(const AvxAffineLoopPlan& plan) {
        constexpr std::array<unsigned char, 4> identity{0, 1, 2, 3};
        constexpr std::array<unsigned char, 4> velocity_links{2, 3, 1, 0};
        return plan.source_a == identity && plan.source_b == velocity_links &&
            plan.coefficient_a[0] == 1.0 && plan.coefficient_a[1] == 1.0 &&
            plan.coefficient_b[0] == 1.0 && plan.coefficient_b[1] == 1.0;
    }

    void emit_scalar_second_order_loop(const Frame& frame, const AvxAffineLoopPlan& plan) {
        const std::array<double, 5> constants{
            1.0,
            plan.coefficient_a[2], plan.coefficient_b[2],
            plan.coefficient_a[3], plan.coefficient_b[3],
        };
        std::array<std::size_t, 5> literals{};
        code_.byte(0xe9);
        const auto skip_literals = code_.rel32_placeholder();
        for (std::size_t index = 0; index < constants.size(); ++index) {
            literals[index] = code_.position();
            std::uint64_t bits = 0;
            std::memcpy(&bits, &constants[index], sizeof(bits));
            code_.u64(bits);
        }
        code_.patch_rel32(skip_literals, code_.position());

        for (unsigned index = 0; index < 4; ++index) {
            load_xmm(index, frame.displacement(plan.state_locals[index]));
        }
        load_xmm(6, frame.displacement(plan.counter_local));
        load_xmm(7, frame.displacement(plan.bound_local));
        code_.raw({0xc5, 0xf9, 0x2e, 0xfe});
        const auto finished = emit_jump(0x86);
        const auto loop = code_.position();

        code_.raw({0xc5, 0xf3, 0x59, 0x25});
        const auto b2_reference = code_.rel32_placeholder();
        code_.patch_rel32(b2_reference, literals[2]);
        code_.raw({0xc4, 0xe2, 0xe9, 0xb9, 0x25});
        const auto a2_reference = code_.rel32_placeholder();
        code_.patch_rel32(a2_reference, literals[1]);
        code_.raw({0xc5, 0xfb, 0x59, 0x2d});
        const auto b3_reference = code_.rel32_placeholder();
        code_.patch_rel32(b3_reference, literals[4]);
        code_.raw({0xc4, 0xe2, 0xe1, 0xb9, 0x2d});
        const auto a3_reference = code_.rel32_placeholder();
        code_.patch_rel32(a3_reference, literals[3]);

        code_.raw({0xc5, 0xfb, 0x58, 0xc2});
        code_.raw({0xc5, 0xf3, 0x58, 0xcb});
        code_.raw({0xc5, 0xf9, 0x28, 0xd4});
        code_.raw({0xc5, 0xf9, 0x28, 0xdd});
        code_.raw({0xc5, 0xcb, 0x58, 0x35});
        const auto one_reference = code_.rel32_placeholder();
        code_.patch_rel32(one_reference, literals[0]);
        code_.raw({0xc5, 0xf9, 0x2e, 0xfe});
        const auto repeat = emit_jump(0x87);
        code_.patch_rel32(repeat, loop);

        const auto cleanup = code_.position();
        code_.patch_rel32(finished, cleanup);
        for (unsigned index = 0; index < 4; ++index) {
            store_xmm(index, frame.displacement(plan.state_locals[index]));
        }
        store_xmm(6, frame.displacement(plan.counter_local));
    }
#endif

    void emit_affine_loop(const Frame& frame, const AvxAffineLoopPlan& plan) {
#ifndef _WIN32
        if (is_second_order_affine_loop(plan)) {
            emit_scalar_second_order_loop(frame, plan);
            return;
        }
#endif
        emit_avx_affine_loop(frame, plan);
    }

    void call_runtime_slot(unsigned slot) {
        if (slot > 36) throw BackendFailure("x64 runtime slot overflow");
        if (slot < 16) {
            code_.raw({0x41, 0xff, 0x54, 0x24, slot * 8});
        } else {
            code_.raw({0x41, 0xff, 0x94, 0x24});
            code_.i32(static_cast<std::int32_t>(slot * 8));
        }
    }

    void emit_abort() {
        call_runtime_slot(10);
        code_.byte(0xcc);
    }

    void move_pointer_argument_from_rax() {
#ifdef _WIN32
        code_.raw({0x48, 0x89, 0xc1});
#else
        code_.raw({0x48, 0x89, 0xc7});
#endif
    }

    void release_pointer_in_rax() {
        move_pointer_argument_from_rax();
        call_runtime_slot(9);
    }

    void release_owned_string(std::int32_t pointer_displacement, std::int32_t length_displacement) {
        load_xmm(0, length_displacement);
        code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc0, 0x48, 0x85, 0xc0, 0x0f, 0x89});
        const auto borrowed = code_.rel32_placeholder();
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(pointer_displacement);
        code_.raw({0x48, 0x83, 0xe8, 0x08});
        release_pointer_in_rax();
        code_.patch_rel32(borrowed, code_.position());
    }

    void emit_string_pointer_to_rax(std::uint32_t offset) {
        code_.raw({0x49, 0x8b, 0x44, 0x24, 0x38});
        if (offset != 0) {
            code_.raw({0x48, 0x05});
            code_.i32(static_cast<std::int32_t>(offset));
        }
    }

    void emit_string_address(std::uint32_t offset) {
        emit_string_pointer_to_rax(offset);
        code_.raw({0x66, 0x48, 0x0f, 0x6e, 0xc0});
    }

    void emit_owned_string_from_cstring(
        const Frame& frame,
        unsigned first,
        bool release_source
    ) {
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
#ifdef _WIN32
        code_.raw({0x48, 0x89, 0xc1});
#else
        code_.raw({0x48, 0x89, 0xc7});
#endif
        call_runtime_slot(27);
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x48, 0x83, 0xc0, 0x09, 0x0f, 0x83});
        const auto size_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(size_valid, code_.position());
        move_pointer_argument_from_rax();
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto allocated = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocated, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x48, 0x89, 0x08});
#ifdef _WIN32
        code_.raw({0x48, 0x8d, 0x48, 0x08, 0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
#else
        code_.raw({0x48, 0x8d, 0x78, 0x08, 0x48, 0x8b, 0xb5});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
#endif
        call_runtime_slot(28);
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0xc6, 0x44, 0x08, 0x08, 0x00, 0x48, 0x8d, 0x40, 0x08,
                   0x66, 0x48, 0x0f, 0x6e, 0xc0});
        store_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0xff, 0xc1, 0x48, 0xf7, 0xd9,
                   0xf2, 0x48, 0x0f, 0x2a, 0xc1});
        store_xmm(0, frame.displacement(frame.temp_base + first + 1));
        if (release_source) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.scratch_slot));
            release_pointer_in_rax();
        }
    }

    void emit_owned_substring(
        const Frame& frame,
        unsigned output,
        std::int32_t start_displacement,
        std::int32_t end_displacement
    ) {
        code_.raw({0x48, 0x8b, 0x95});
        code_.i32(end_displacement);
        code_.raw({0x48, 0x2b, 0x95});
        code_.i32(start_displacement);
        code_.raw({0x48, 0x89, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot + 3));
        code_.raw({0x48, 0x8d, 0x42, 0x09, 0x0f, 0x83});
        const auto size_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(size_valid, code_.position());
#ifdef _WIN32
        code_.raw({0x48, 0x89, 0xc1});
#else
        code_.raw({0x48, 0x89, 0xc7});
#endif
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto allocated = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocated, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.raw({0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot + 3));
        code_.raw({0x48, 0x89, 0x10});
#ifdef _WIN32
        code_.raw({0x48, 0x8d, 0x48, 0x08, 0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x4c, 0x03, 0x85});
        code_.i32(start_displacement);
        code_.raw({0x4c, 0x89, 0xc2, 0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 3));
#else
        code_.raw({0x48, 0x8d, 0x78, 0x08, 0x48, 0x8b, 0xb5});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x03, 0xb5});
        code_.i32(start_displacement);
        code_.raw({0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot + 3));
#endif
        call_runtime_slot(28);
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + 3));
        code_.raw({0xc6, 0x44, 0x08, 0x08, 0x00, 0x48, 0x8d, 0x50, 0x08,
                   0x48, 0x89, 0x95});
        code_.i32(frame.displacement(frame.temp_base + output));
        code_.raw({0x48, 0xff, 0xc1, 0x48, 0xf7, 0xd9,
                   0xf2, 0x48, 0x0f, 0x2a, 0xc1});
        store_xmm(0, frame.displacement(frame.temp_base + output + 1));
    }

    void emit_capture_regex(
        const vkf::machine_ir::Function& function,
        const Frame& frame,
        unsigned first,
        const vkf::machine_ir::Instruction& instruction,
        bool entry,
        std::vector<MachineBranchPatch>& branches
    ) {
        const auto pattern = vkf::capture::parse(instruction.symbol);
        if (pattern.group_names.size() != instruction.argument_count) {
            throw BackendFailure("capture group count changed after machine lowering");
        }
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        load_xmm(0, frame.displacement(frame.temp_base + first + 1));
        code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc0, 0x48, 0x85, 0xc0, 0x0f, 0x89});
        const auto decoded = code_.rel32_placeholder();
        code_.raw({0x48, 0xf7, 0xd8, 0x48, 0xff, 0xc8});
        code_.patch_rel32(decoded, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 1));
        code_.raw({0x48, 0xc7, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.i32(0);

        const auto search = code_.position();
        code_.raw({0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x4c, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + 1));
        code_.raw({0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        struct RegexFailurePatch {
            std::size_t branch = 0;
            unsigned processed_atoms = 0;
        };
        std::vector<RegexFailurePatch> failures;
        std::vector<std::size_t> resumes;
        std::vector<vkf::capture::Op> atoms;

        for (const auto& op : pattern.ops) {
            if (op.kind == vkf::capture::OpKind::BeginCapture ||
                op.kind == vkf::capture::OpKind::EndCapture) {
                if (op.capture >= instruction.argument_count) {
                    throw BackendFailure("invalid capture group id");
                }
                code_.raw({0x48, 0x89, 0x95});
                code_.i32(frame.displacement(
                    frame.temp_base + first + op.capture * 2u +
                    (op.kind == vkf::capture::OpKind::EndCapture ? 1u : 0u)));
                continue;
            }
            code_.raw({0x48, 0x31, 0xc9});
            const auto scan = code_.position();
            std::vector<std::size_t> scan_ends;
            code_.raw({0x4c, 0x39, 0xca, 0x0f, 0x83});
            scan_ends.push_back(code_.rel32_placeholder());
            if (op.maximum != std::numeric_limits<std::uint32_t>::max()) {
                code_.raw({0x48, 0x81, 0xf9});
                code_.i32(static_cast<std::int32_t>(op.maximum));
                code_.raw({0x0f, 0x83});
                scan_ends.push_back(code_.rel32_placeholder());
            }
            code_.raw({0x41, 0x8a, 0x04, 0x10});
            std::vector<std::size_t> matched;
            unsigned byte = 0;
            while (byte < 256) {
                while (byte < 256 && !op.bytes.contains(byte)) ++byte;
                if (byte == 256) break;
                const unsigned begin = byte;
                while (byte + 1 < 256 && op.bytes.contains(byte + 1)) ++byte;
                const unsigned end = byte++;
                if (begin == end) {
                    code_.raw({0x3c, begin, 0x0f, 0x84});
                    matched.push_back(code_.rel32_placeholder());
                } else {
                    code_.raw({0x3c, begin, 0x0f, 0x82});
                    const auto below = code_.rel32_placeholder();
                    code_.raw({0x3c, end, 0x0f, 0x86});
                    matched.push_back(code_.rel32_placeholder());
                    code_.patch_rel32(below, code_.position());
                }
            }
            code_.byte(0xe9);
            scan_ends.push_back(code_.rel32_placeholder());
            const auto consume = code_.position();
            for (const auto patch : matched) code_.patch_rel32(patch, consume);
            code_.raw({0x48, 0xff, 0xc2, 0x48, 0xff, 0xc1, 0xe9});
            const auto repeat = code_.rel32_placeholder();
            code_.patch_rel32(repeat, scan);
            const auto scan_end = code_.position();
            for (const auto patch : scan_ends) code_.patch_rel32(patch, scan_end);
            code_.raw({0x48, 0x81, 0xf9});
            code_.i32(static_cast<std::int32_t>(op.minimum));
            code_.raw({0x0f, 0x82});
            failures.push_back({code_.rel32_placeholder(), static_cast<unsigned>(atoms.size())});
            code_.raw({0x48, 0x89, 0x8d});
            code_.i32(frame.displacement(frame.scratch_slot + 3u + atoms.size() * 2u));
            code_.raw({0x48, 0x89, 0x95});
            code_.i32(frame.displacement(frame.scratch_slot + 4u + atoms.size() * 2u));
            atoms.push_back(op);
            resumes.push_back(code_.position());
        }
        if (pattern.anchor_end) {
            code_.raw({0x4c, 0x39, 0xca, 0x0f, 0x85});
            failures.push_back({code_.rel32_placeholder(), static_cast<unsigned>(atoms.size())});
        }
        if (pattern.synthetic_full_capture) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.scratch_slot + 2));
            code_.raw({0x48, 0x89, 0x85});
            code_.i32(frame.displacement(frame.temp_base + first));
            code_.raw({0x48, 0x89, 0x95});
            code_.i32(frame.displacement(frame.temp_base + first + 1));
        }
        for (unsigned group = 0; group < instruction.argument_count; ++group) {
            emit_owned_substring(
                frame,
                first + group * 2u,
                frame.displacement(frame.temp_base + first + group * 2u),
                frame.displacement(frame.temp_base + first + group * 2u + 1u));
        }
        if (instruction.owns_input) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.scratch_slot));
            code_.raw({0x48, 0x83, 0xe8, 0x08});
            release_pointer_in_rax();
        }
        code_.byte(0xe9);
        const auto done = code_.rel32_placeholder();

        std::vector<std::size_t> failure_labels(atoms.size() + 1u);
        std::vector<std::size_t> no_candidate_jumps;
        for (unsigned processed = 0; processed <= atoms.size(); ++processed) {
            failure_labels[processed] = code_.position();
            for (unsigned candidate = processed; candidate > 0; --candidate) {
                const unsigned index = candidate - 1u;
                const auto& atom = atoms[index];
                if (atom.maximum == atom.minimum) continue;
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 3u + index * 2u));
                code_.raw({0x48, 0x81, 0xf8});
                code_.i32(static_cast<std::int32_t>(atom.minimum));
                code_.raw({0x0f, 0x86});
                const auto exhausted = code_.rel32_placeholder();
                code_.raw({0x48, 0xff, 0xc8, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 3u + index * 2u));
                code_.raw({0x48, 0x8b, 0x95});
                code_.i32(frame.displacement(frame.scratch_slot + 4u + index * 2u));
                code_.raw({0x48, 0xff, 0xca, 0x48, 0x89, 0x95});
                code_.i32(frame.displacement(frame.scratch_slot + 4u + index * 2u));
                code_.raw({0x4c, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                code_.raw({0x4c, 0x8b, 0x8d});
                code_.i32(frame.displacement(frame.scratch_slot + 1));
                code_.byte(0xe9);
                const auto resume = code_.rel32_placeholder();
                code_.patch_rel32(resume, resumes[index]);
                code_.patch_rel32(exhausted, code_.position());
            }
            code_.byte(0xe9);
            no_candidate_jumps.push_back(code_.rel32_placeholder());
        }

        const auto failed = code_.position();
        for (const auto& failure : failures) {
            code_.patch_rel32(failure.branch, failure_labels[failure.processed_atoms]);
        }
        for (const auto patch : no_candidate_jumps) code_.patch_rel32(patch, failed);
        const auto emit_no_match = [&]() {
            if (instruction.owns_input) {
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                code_.raw({0x48, 0x83, 0xe8, 0x08});
                release_pointer_in_rax();
            }
            emit_instruction_error(
                function, frame, instruction,
                vkf::machine_ir::value_error_mask, entry, branches);
        };
        if (pattern.anchor_start) {
            emit_no_match();
        } else {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.scratch_slot + 2));
            code_.raw({0x48, 0xff, 0xc0, 0x48, 0x89, 0x85});
            code_.i32(frame.displacement(frame.scratch_slot + 2));
            code_.raw({0x48, 0x3b, 0x85});
            code_.i32(frame.displacement(frame.scratch_slot + 1));
            code_.raw({0x0f, 0x86});
            const auto retry = code_.rel32_placeholder();
            code_.patch_rel32(retry, search);
            emit_no_match();
        }
        code_.patch_rel32(done, code_.position());
    }

    void emit_read_descriptor_string(
        const Frame& frame,
        unsigned first,
        unsigned descriptor_scratch
    ) {
#ifdef _WIN32
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + descriptor_scratch));
        code_.raw({0x31, 0xd2, 0x41, 0xb8, 0x02, 0x00, 0x00, 0x00});
        call_runtime_slot(23);
        code_.raw({0x48, 0x98});
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.scratch_slot + descriptor_scratch));
        code_.raw({0x31, 0xf6, 0xba, 0x02, 0x00, 0x00, 0x00,
                   0xb8, 0x08, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x89});
        const auto size_ready = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(size_ready, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x48, 0x83, 0xc0, 0x09, 0x0f, 0x83});
        const auto allocation_size_ready = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocation_size_ready, code_.position());
        move_pointer_argument_from_rax();
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto allocated = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocated, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x48, 0x89, 0x08});
#ifdef _WIN32
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + descriptor_scratch));
        code_.raw({0x31, 0xd2, 0x45, 0x31, 0xc0});
        call_runtime_slot(23);
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + descriptor_scratch));
        code_.raw({0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x83, 0xc2, 0x08, 0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        call_runtime_slot(21);
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.scratch_slot + descriptor_scratch));
        code_.raw({0x31, 0xf6, 0x31, 0xd2, 0xb8, 0x08, 0x00, 0x00, 0x00, 0x0f, 0x05});
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.scratch_slot + descriptor_scratch));
        code_.raw({0x48, 0x8b, 0xb5});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x83, 0xc6, 0x08, 0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x31, 0xc0, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0xc6, 0x44, 0x08, 0x08, 0x00, 0x48, 0x8d, 0x40, 0x08,
                   0x66, 0x48, 0x0f, 0x6e, 0xc0});
        store_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0xff, 0xc1, 0x48, 0xf7, 0xd9,
                   0xf2, 0x48, 0x0f, 0x2a, 0xc1});
        store_xmm(0, frame.displacement(frame.temp_base + first + 1));
    }

    void emit_format_f64_string(
        const Frame& frame,
        unsigned first,
        const vkf::machine_ir::Instruction& instruction
    ) {
#ifdef _WIN32
        emit_string_pointer_to_rax(instruction.index);
        code_.raw({0x48, 0x89, 0xc1});
        load_xmm(1, frame.displacement(frame.temp_base + first));
        code_.raw({0x66, 0x48, 0x0f, 0x7e, 0xca});
        call_runtime_slot(11);
#else
        code_.raw({0x31, 0xff, 0x31, 0xf6});
        emit_string_pointer_to_rax(instruction.index);
        code_.raw({0x48, 0x89, 0xc2});
        load_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0xb8, 0x01, 0x00, 0x00, 0x00});
        call_runtime_slot(11);
#endif
        code_.raw({0x85, 0xc0, 0x0f, 0x89});
        const auto count_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(count_valid, code_.position());
        code_.raw({0x48, 0x98, 0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x83, 0xc0, 0x09, 0x0f, 0x83});
        const auto size_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(size_valid, code_.position());
        move_pointer_argument_from_rax();
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto allocated = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocated, code_.position());
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x89, 0x08, 0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
#ifdef _WIN32
        code_.raw({0x48, 0x8d, 0x48, 0x08});
        emit_string_pointer_to_rax(instruction.index);
        code_.raw({0x48, 0x89, 0xc2});
        load_xmm(2, frame.displacement(frame.temp_base + first));
        code_.raw({0x66, 0x49, 0x0f, 0x7e, 0xd0});
        call_runtime_slot(12);
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x8b, 0x37, 0x48, 0xff, 0xc6, 0x48, 0x83, 0xc7, 0x08});
        emit_string_pointer_to_rax(instruction.index);
        code_.raw({0x48, 0x89, 0xc2});
        load_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0xb8, 0x01, 0x00, 0x00, 0x00});
        call_runtime_slot(12);
#endif
        code_.raw({0x85, 0xc0, 0x0f, 0x89});
        const auto write_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(write_valid, code_.position());
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x8b, 0x08, 0x48, 0x83, 0xc0, 0x08,
                   0x66, 0x48, 0x0f, 0x6e, 0xc0});
        store_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0xff, 0xc1, 0x48, 0xf7, 0xd9,
                   0xf2, 0x48, 0x0f, 0x2a, 0xc1});
        store_xmm(0, frame.displacement(frame.temp_base + first + 1));
    }

    void emit_format_bit_string(
        const Frame& frame,
        unsigned first,
        const vkf::machine_ir::Instruction& instruction
    ) {
        load_xmm(0, frame.displacement(frame.temp_base + first));
        emit_truth_to_al(0);
        code_.raw({0x84, 0xc0, 0x0f, 0x84});
        const auto render_false = code_.rel32_placeholder();
        emit_string_address(instruction.error_message_offset);
        store_xmm(0, frame.displacement(frame.temp_base + first));
        emit_number(4.0);
        store_xmm(0, frame.displacement(frame.temp_base + first + 1));
        code_.raw({0xe9});
        const auto done = code_.rel32_placeholder();
        code_.patch_rel32(render_false, code_.position());
        emit_string_address(instruction.index);
        store_xmm(0, frame.displacement(frame.temp_base + first));
        emit_number(5.0);
        store_xmm(0, frame.displacement(frame.temp_base + first + 1));
        code_.patch_rel32(done, code_.position());
    }

    void emit_format_chr_string(const Frame& frame, unsigned first) {
        load_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xd0});
        code_.raw({0xb9, 0x01, 0x00, 0x00, 0x00});
        code_.raw({0x41, 0x81, 0xfa, 0x7f, 0x00, 0x00, 0x00, 0x0f, 0x8e});
        const auto length_ready_ascii = code_.rel32_placeholder();
        code_.raw({0xb9, 0x02, 0x00, 0x00, 0x00});
        code_.raw({0x41, 0x81, 0xfa, 0xff, 0x07, 0x00, 0x00, 0x0f, 0x8e});
        const auto length_ready_two = code_.rel32_placeholder();
        code_.raw({0xb9, 0x03, 0x00, 0x00, 0x00});
        code_.raw({0x41, 0x81, 0xfa, 0xff, 0xff, 0x00, 0x00, 0x0f, 0x8e});
        const auto length_ready_three = code_.rel32_placeholder();
        code_.raw({0xb9, 0x04, 0x00, 0x00, 0x00});
        const auto length_ready = code_.position();
        code_.patch_rel32(length_ready_ascii, length_ready);
        code_.patch_rel32(length_ready_two, length_ready);
        code_.patch_rel32(length_ready_three, length_ready);
        code_.raw({0x89, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x89, 0xc8, 0x48, 0x83, 0xc0, 0x09});
        move_pointer_argument_from_rax();
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto allocated = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocated, code_.position());
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x89, 0x08, 0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x4c, 0x8d, 0x58, 0x08});
        load_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xd0});
        code_.raw({0x41, 0x81, 0xfa, 0x7f, 0x00, 0x00, 0x00, 0x0f, 0x8f});
        const auto encode_two_or_more = code_.rel32_placeholder();
        code_.raw({0x45, 0x88, 0x13, 0xe9});
        const auto encoded_ascii = code_.rel32_placeholder();
        code_.patch_rel32(encode_two_or_more, code_.position());
        code_.raw({0x41, 0x81, 0xfa, 0xff, 0x07, 0x00, 0x00, 0x0f, 0x8f});
        const auto encode_three_or_more = code_.rel32_placeholder();
        code_.raw({0x44, 0x89, 0xd0, 0xc1, 0xe8, 0x06, 0x0c, 0xc0, 0x41, 0x88, 0x03,
                   0x44, 0x89, 0xd0, 0x24, 0x3f, 0x0c, 0x80, 0x41, 0x88, 0x43, 0x01, 0xe9});
        const auto encoded_two = code_.rel32_placeholder();
        code_.patch_rel32(encode_three_or_more, code_.position());
        code_.raw({0x41, 0x81, 0xfa, 0xff, 0xff, 0x00, 0x00, 0x0f, 0x8f});
        const auto encode_four = code_.rel32_placeholder();
        code_.raw({0x44, 0x89, 0xd0, 0xc1, 0xe8, 0x0c, 0x0c, 0xe0, 0x41, 0x88, 0x03,
                   0x44, 0x89, 0xd0, 0xc1, 0xe8, 0x06, 0x24, 0x3f, 0x0c, 0x80, 0x41, 0x88, 0x43, 0x01,
                   0x44, 0x89, 0xd0, 0x24, 0x3f, 0x0c, 0x80, 0x41, 0x88, 0x43, 0x02, 0xe9});
        const auto encoded_three = code_.rel32_placeholder();
        code_.patch_rel32(encode_four, code_.position());
        code_.raw({0x44, 0x89, 0xd0, 0xc1, 0xe8, 0x12, 0x0c, 0xf0, 0x41, 0x88, 0x03,
                   0x44, 0x89, 0xd0, 0xc1, 0xe8, 0x0c, 0x24, 0x3f, 0x0c, 0x80, 0x41, 0x88, 0x43, 0x01,
                   0x44, 0x89, 0xd0, 0xc1, 0xe8, 0x06, 0x24, 0x3f, 0x0c, 0x80, 0x41, 0x88, 0x43, 0x02,
                   0x44, 0x89, 0xd0, 0x24, 0x3f, 0x0c, 0x80, 0x41, 0x88, 0x43, 0x03});
        const auto encoded = code_.position();
        code_.patch_rel32(encoded_ascii, encoded);
        code_.patch_rel32(encoded_two, encoded);
        code_.patch_rel32(encoded_three, encoded);
        code_.raw({0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x8b, 0x0a, 0x4c, 0x8d, 0x5a, 0x08, 0x41, 0xc6, 0x04, 0x0b, 0x00,
                   0x66, 0x49, 0x0f, 0x6e, 0xc3});
        store_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0xff, 0xc1, 0x48, 0xf7, 0xd9, 0xf2, 0x48, 0x0f, 0x2a, 0xc1});
        store_xmm(0, frame.displacement(frame.temp_base + first + 1));
    }

    void emit_decode_utf8_at(const Frame& frame, unsigned first) {
        load_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0x66, 0x49, 0x0f, 0x7e, 0xc2});
        load_xmm(0, frame.displacement(frame.temp_base + first + 2));
        code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8});
        code_.raw({0x45, 0x0f, 0xb6, 0x1c, 0x0a, 0x41, 0x81, 0xfb, 0x80, 0x00, 0x00, 0x00,
                   0x0f, 0x8d});
        const auto decode_two_or_more = code_.rel32_placeholder();
        code_.raw({0x44, 0x89, 0xd8, 0x48, 0xff, 0xc1, 0xe9});
        const auto decoded_ascii = code_.rel32_placeholder();
        code_.patch_rel32(decode_two_or_more, code_.position());
        code_.raw({0x41, 0x81, 0xfb, 0xe0, 0x00, 0x00, 0x00, 0x0f, 0x8d});
        const auto decode_three_or_more = code_.rel32_placeholder();
        code_.raw({0x41, 0x83, 0xe3, 0x1f, 0x41, 0xc1, 0xe3, 0x06,
                   0x41, 0x0f, 0xb6, 0x44, 0x0a, 0x01, 0x83, 0xe0, 0x3f, 0x44, 0x09, 0xd8,
                   0x48, 0x83, 0xc1, 0x02, 0xe9});
        const auto decoded_two = code_.rel32_placeholder();
        code_.patch_rel32(decode_three_or_more, code_.position());
        code_.raw({0x41, 0x81, 0xfb, 0xf0, 0x00, 0x00, 0x00, 0x0f, 0x8d});
        const auto decode_four = code_.rel32_placeholder();
        code_.raw({0x41, 0x83, 0xe3, 0x0f, 0x41, 0xc1, 0xe3, 0x0c,
                   0x41, 0x0f, 0xb6, 0x44, 0x0a, 0x01, 0x83, 0xe0, 0x3f, 0xc1, 0xe0, 0x06,
                   0x44, 0x09, 0xd8, 0x45, 0x0f, 0xb6, 0x5c, 0x0a, 0x02,
                   0x41, 0x83, 0xe3, 0x3f, 0x44, 0x09, 0xd8, 0x48, 0x83, 0xc1, 0x03, 0xe9});
        const auto decoded_three = code_.rel32_placeholder();
        code_.patch_rel32(decode_four, code_.position());
        code_.raw({0x41, 0x83, 0xe3, 0x07, 0x41, 0xc1, 0xe3, 0x12,
                   0x41, 0x0f, 0xb6, 0x44, 0x0a, 0x01, 0x83, 0xe0, 0x3f, 0xc1, 0xe0, 0x0c,
                   0x44, 0x09, 0xd8, 0x45, 0x0f, 0xb6, 0x5c, 0x0a, 0x02,
                   0x41, 0x83, 0xe3, 0x3f, 0x41, 0xc1, 0xe3, 0x06, 0x44, 0x09, 0xd8,
                   0x45, 0x0f, 0xb6, 0x5c, 0x0a, 0x03, 0x41, 0x83, 0xe3, 0x3f, 0x44, 0x09, 0xd8,
                   0x48, 0x83, 0xc1, 0x04});
        const auto decoded = code_.position();
        code_.patch_rel32(decoded_ascii, decoded);
        code_.patch_rel32(decoded_two, decoded);
        code_.patch_rel32(decoded_three, decoded);
        code_.raw({0xf2, 0x0f, 0x2a, 0xc0});
        store_xmm(0, frame.displacement(frame.temp_base + first));
        code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc1});
        store_xmm(0, frame.displacement(frame.temp_base + first + 1));
    }

    void emit_error_message_registers(std::uint32_t offset, std::uint32_t byte_count) {
        code_.raw({0x4d, 0x8b, 0x44, 0x24, 0x38});
        if (offset != 0) {
            code_.raw({0x49, 0x81, 0xc0});
            code_.i32(static_cast<std::int32_t>(offset));
        }
        emit_number(static_cast<double>(byte_count), 2);
    }

    void store_error_message_local(const Frame& frame, std::uint32_t local) {
        if (local + 1 >= frame.local_count) throw BackendFailure("invalid x64 caught error local");
        code_.raw({0x4c, 0x89, 0x85});
        code_.i32(frame.displacement(local));
        store_xmm(2, frame.displacement(local + 1));
    }

    void store_error_type_local(const Frame& frame, std::uint32_t local) {
        if (local >= frame.local_count) throw BackendFailure("invalid x64 caught error type local");
        code_.raw({0x44, 0x89, 0xc8, 0xf2, 0x0f, 0x2a, 0xc0});
        store_xmm(0, frame.displacement(local));
    }

    void store_error_type_constant(const Frame& frame, std::uint32_t local, std::uint32_t mask) {
        if (local >= frame.local_count) throw BackendFailure("invalid x64 caught error type local");
        emit_number(static_cast<double>(mask));
        store_xmm(0, frame.displacement(local));
    }

    void load_error_payload_local(
        const Frame& frame, std::uint32_t value_local, std::uint32_t type_local
    ) {
        if (value_local + 1 >= frame.local_count || type_local >= frame.local_count) {
            throw BackendFailure("invalid x64 caught error payload local");
        }
        code_.raw({0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(value_local));
        load_xmm(2, frame.displacement(value_local + 1));
        load_xmm(0, frame.displacement(type_local));
        code_.raw({0xf2, 0x0f, 0x2c, 0xc0, 0x41, 0x89, 0xc1});
    }

    std::size_t emit_jump(unsigned opcode) {
        code_.raw({0x0f, opcode});
        return code_.rel32_placeholder();
    }

    void emit_comparison(vkf::machine_ir::Opcode opcode) {
        const unsigned condition = opcode == vkf::machine_ir::Opcode::OrderedLessF64 ? 0x92
            : opcode == vkf::machine_ir::Opcode::OrderedLessEqualF64 ? 0x96
            : opcode == vkf::machine_ir::Opcode::OrderedGreaterF64 ? 0x97
            : opcode == vkf::machine_ir::Opcode::OrderedGreaterEqualF64 ? 0x93
            : opcode == vkf::machine_ir::Opcode::OrderedEqualF64 ? 0x94
            : opcode == vkf::machine_ir::Opcode::UnorderedNotEqualF64 ? 0x95
            : 0;
        if (condition == 0) throw BackendFailure("unhandled x64 machine IR comparison");
        code_.raw({0x66, 0x0f, 0x2e, 0xc8, 0x0f, condition, 0xc0});
        if (opcode == vkf::machine_ir::Opcode::OrderedLessF64 ||
            opcode == vkf::machine_ir::Opcode::OrderedLessEqualF64 ||
            opcode == vkf::machine_ir::Opcode::OrderedEqualF64) {
            code_.raw({0x0f, 0x9b, 0xc2, 0x20, 0xd0});
        } else if (opcode == vkf::machine_ir::Opcode::UnorderedNotEqualF64) {
            code_.raw({0x0f, 0x9a, 0xc2, 0x08, 0xd0});
        }
        code_.raw({0x0f, 0xb6, 0xc0, 0xf2, 0x0f, 0x2a, 0xc0});
    }

    void emit_string_comparison(
        vkf::machine_ir::Opcode opcode,
        const Frame& frame,
        unsigned first,
        bool owns_left,
        bool owns_right
    ) {
        using vkf::machine_ir::Opcode;
        const unsigned condition = opcode == Opcode::StringLess ? 0x92
            : opcode == Opcode::StringLessEqual ? 0x96
            : opcode == Opcode::StringGreater ? 0x97
            : opcode == Opcode::StringGreaterEqual ? 0x93
            : opcode == Opcode::StringEqual ? 0x94
            : opcode == Opcode::StringNotEqual ? 0x95
            : 0;
        if (condition == 0) throw BackendFailure("unhandled x64 string comparison");

        load_xmm(0, frame.displacement(frame.temp_base + first + 1));
        code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xc0, 0x4d, 0x85, 0xc0, 0x0f, 0x89});
        const auto left_decoded = code_.rel32_placeholder();
        code_.raw({0x49, 0xf7, 0xd8, 0x49, 0xff, 0xc8});
        code_.patch_rel32(left_decoded, code_.position());
        load_xmm(0, frame.displacement(frame.temp_base + first + 3));
        code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xc8, 0x4d, 0x85, 0xc9, 0x0f, 0x89});
        const auto right_decoded = code_.rel32_placeholder();
        code_.raw({0x49, 0xf7, 0xd9, 0x49, 0xff, 0xc9});
        code_.patch_rel32(right_decoded, code_.position());
        code_.raw({0x4c, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x4c, 0x8b, 0x9d});
        code_.i32(frame.displacement(frame.temp_base + first + 2));

        const auto loop = code_.position();
        code_.raw({0x4d, 0x85, 0xc0, 0x0f, 0x84});
        const auto left_empty = code_.rel32_placeholder();
        code_.raw({0x4d, 0x85, 0xc9, 0x0f, 0x84});
        const auto right_empty = code_.rel32_placeholder();
        code_.raw({0x41, 0x0f, 0xb6, 0x02, 0x41, 0x0f, 0xb6, 0x0b,
                   0x39, 0xc8, 0x0f, 0x85});
        const auto different = code_.rel32_placeholder();
        code_.raw({0x49, 0xff, 0xc2, 0x49, 0xff, 0xc3,
                   0x49, 0xff, 0xc8, 0x49, 0xff, 0xc9, 0xe9});
        const auto repeat = code_.rel32_placeholder();
        code_.patch_rel32(repeat, loop);

        const auto compare_lengths = code_.position();
        code_.patch_rel32(left_empty, compare_lengths);
        code_.patch_rel32(right_empty, compare_lengths);
        code_.raw({0x4d, 0x39, 0xc8});
        const auto decision = code_.position();
        code_.patch_rel32(different, decision);
        code_.raw({0x0f, condition, 0xc0, 0x0f, 0xb6, 0xc0, 0xf2, 0x0f, 0x2a, 0xc0});
        store_xmm(0, frame.displacement(frame.scratch_slot));

        if (owns_left) {
            release_owned_string(
                frame.displacement(frame.temp_base + first),
                frame.displacement(frame.temp_base + first + 1));
        }
        if (owns_right) {
            release_owned_string(
                frame.displacement(frame.temp_base + first + 2),
                frame.displacement(frame.temp_base + first + 3));
        }
        load_xmm(0, frame.displacement(frame.scratch_slot));
        store_xmm(0, frame.displacement(frame.temp_base + first));
    }

    void emit_truth_to_al(unsigned xmm) {
        if (xmm > 7) throw BackendFailure("invalid x64 truth register");
        code_.raw({0x66, 0x0f, 0xef, 0xd2});
        code_.raw({0x66, 0x0f, 0x2e, static_cast<unsigned>(0xc2 + xmm * 8)});
        code_.raw({0x0f, 0x95, 0xc0, 0x0f, 0x9a, 0xc2, 0x08, 0xd0});
    }

    void emit_al_as_f64() {
        code_.raw({0x0f, 0xb6, 0xc0, 0xf2, 0x0f, 0x2a, 0xc0});
    }

    void emit_error_cleanup(
        const vkf::machine_ir::Function& function,
        const Frame& frame
    ) {
        for (const auto slot : function.owned_string_locals) {
            release_owned_string(frame.displacement(slot), frame.displacement(slot + 1));
        }
        for (const auto slot : function.owned_f64_list_locals) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(slot));
            code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x84});
            const auto empty = code_.rel32_placeholder();
            release_pointer_in_rax();
            code_.patch_rel32(empty, code_.position());
        }
    }

    void emit_instruction_error(
        const vkf::machine_ir::Function& function,
        const Frame& frame,
        const vkf::machine_ir::Instruction& instruction,
        std::uint32_t type_mask,
        bool entry,
        std::vector<MachineBranchPatch>& branches
    ) {
        emit_error_message_registers(
            instruction.error_message_offset, instruction.byte_count);
        if (instruction.has_error_handler) {
            store_error_message_local(frame, instruction.error_value_local);
            store_error_type_constant(frame, instruction.error_type_local, type_mask);
            code_.byte(0xe9);
            branches.push_back({code_.rel32_placeholder(), instruction.label});
            return;
        }
        if (entry) {
            emit_abort();
            return;
        }
        code_.raw({0x4c, 0x89, 0x85});
        code_.i32(frame.displacement(frame.error_pointer_slot));
        store_xmm(2, frame.displacement(frame.error_length_slot));
        emit_error_cleanup(function, frame);
        code_.raw({0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.error_pointer_slot));
        load_xmm(2, frame.displacement(frame.error_length_slot));
        code_.raw({0x41, 0xb9});
        code_.i32(static_cast<std::int32_t>(type_mask));
        epilogue();
    }

    [[gnu::noinline]] void emit_normalize_f64_multiset(const Frame& frame, unsigned first) {
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto pointer_present = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(pointer_present, code_.position());
        code_.raw({0x48, 0x8b, 0x08, 0xf6, 0xc1, 0x01, 0x0f, 0x84});
        const auto even_slots = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(even_slots, code_.position());
        code_.raw({0x48, 0xd1, 0xe9,
                   0x48, 0x8d, 0x50, 0x10,
                   0x49, 0x89, 0xd0,
                   0x45, 0x31, 0xc9,
                   0x48, 0x85, 0xc9, 0x0f, 0x84});
        const auto empty = code_.rel32_placeholder();
        const auto source_loop = code_.position();
        code_.raw({0xf2, 0x0f, 0x10, 0x02,
                   0xf2, 0x0f, 0x10, 0x4a, 0x08,
                   0x66, 0x0f, 0xef, 0xd2,
                   0x66, 0x0f, 0x2e, 0xca});
        std::vector<std::size_t> invalid;
        invalid.push_back(emit_jump(0x8a));
        invalid.push_back(emit_jump(0x82));
        code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xd9,
                   0xf2, 0x49, 0x0f, 0x2a, 0xd3,
                   0x66, 0x0f, 0x2e, 0xca});
        invalid.push_back(emit_jump(0x85));
        code_.raw({0x66, 0x0f, 0xef, 0xd2,
                   0x66, 0x0f, 0x2e, 0xca, 0x0f, 0x84});
        const auto skip_zero = code_.rel32_placeholder();
        code_.raw({0x4c, 0x8d, 0x50, 0x10,
                   0x4d, 0x89, 0xcb,
                   0x4d, 0x85, 0xdb, 0x0f, 0x84});
        const auto append_without_search = code_.rel32_placeholder();
        const auto search_loop = code_.position();
        code_.raw({0xf2, 0x41, 0x0f, 0x10, 0x12,
                   0x66, 0x0f, 0x2e, 0xc2, 0x0f, 0x8a});
        const auto unordered_key = code_.rel32_placeholder();
        code_.raw({0x0f, 0x84});
        const auto found_key = code_.rel32_placeholder();
        const auto next_search = code_.position();
        code_.patch_rel32(unordered_key, next_search);
        code_.raw({0x49, 0x83, 0xc2, 0x10,
                   0x49, 0xff, 0xcb, 0x0f, 0x85});
        const auto repeat_search = code_.rel32_placeholder();
        code_.patch_rel32(repeat_search, search_loop);
        const auto append = code_.position();
        code_.patch_rel32(append_without_search, append);
        code_.raw({0xf2, 0x41, 0x0f, 0x11, 0x00,
                   0xf2, 0x41, 0x0f, 0x11, 0x48, 0x08,
                   0x49, 0x83, 0xc0, 0x10,
                   0x49, 0xff, 0xc1, 0xe9});
        const auto appended = code_.rel32_placeholder();
        const auto found = code_.position();
        code_.patch_rel32(found_key, found);
        code_.raw({0xf2, 0x41, 0x0f, 0x58, 0x4a, 0x08,
                   0xf2, 0x41, 0x0f, 0x11, 0x4a, 0x08});
        const auto next_source = code_.position();
        code_.patch_rel32(appended, next_source);
        code_.patch_rel32(skip_zero, next_source);
        code_.raw({0x48, 0x83, 0xc2, 0x10,
                   0x48, 0xff, 0xc9, 0x0f, 0x85});
        const auto repeat_source = code_.rel32_placeholder();
        code_.patch_rel32(repeat_source, source_loop);
        const auto complete = code_.position();
        code_.patch_rel32(empty, complete);
        code_.raw({0x4c, 0x89, 0xc9,
                   0x48, 0xd1, 0xe1,
                   0x48, 0x89, 0x08,
                   0x48, 0x89, 0x48, 0x08,
                   0xe9});
        const auto done = code_.rel32_placeholder();
        const auto invalid_count = code_.position();
        for (const auto patch : invalid) code_.patch_rel32(patch, invalid_count);
        emit_abort();
        code_.patch_rel32(done, code_.position());
    }

    [[gnu::noinline]] void emit_binary_f64_multiset(
        const Frame& frame,
        unsigned first,
        vkf::machine_ir::Opcode opcode,
        bool owns_left,
        bool owns_right
    ) {
        using vkf::machine_ir::Opcode;
        const bool unite = opcode == Opcode::UnionF64Multisets;

        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto left_present = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(left_present, code_.position());
        code_.raw({0x4c, 0x8b, 0x9d});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x4d, 0x85, 0xdb, 0x0f, 0x85});
        const auto right_present = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(right_present, code_.position());
        code_.raw({0x48, 0x8b, 0x00});
        if (unite) {
            code_.raw({0x49, 0x03, 0x03, 0x0f, 0x83});
            const auto size_sum_valid = code_.rel32_placeholder();
            emit_abort();
            code_.patch_rel32(size_sum_valid, code_.position());
        }
        code_.raw({0x48, 0x89, 0xc1,
                   0x48, 0xc1, 0xe9, 0x3d,
                   0x48, 0x85, 0xc9, 0x0f, 0x84});
        const auto size_shift_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(size_shift_valid, code_.position());
        code_.raw({0x48, 0xc1, 0xe0, 0x03,
                   0x48, 0x83, 0xc0, 0x10, 0x0f, 0x83});
        const auto allocation_size_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocation_size_valid, code_.position());
        move_pointer_argument_from_rax();
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto allocated = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocated, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));

        code_.raw({0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x4c, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x49, 0x83, 0xc2, 0x10,
                   0x45, 0x31, 0xdb,
                   0x49, 0x8b, 0x08,
                   0x48, 0xd1, 0xe9,
                   0x49, 0x8d, 0x50, 0x10,
                   0x48, 0x85, 0xc9, 0x0f, 0x84});
        const auto left_empty = code_.rel32_placeholder();
        const auto left_loop = code_.position();
        code_.raw({0xf2, 0x0f, 0x10, 0x02,
                   0xf2, 0x0f, 0x10, 0x4a, 0x08});

        std::size_t missing_right = 0;
        std::size_t found_right = 0;
        if (!unite) {
            code_.raw({0x4c, 0x8b, 0x8d});
            code_.i32(frame.displacement(frame.temp_base + first + 1));
            code_.raw({0x49, 0x8b, 0x01,
                       0x48, 0xd1, 0xe8,
                       0x49, 0x83, 0xc1, 0x10,
                       0x48, 0x85, 0xc0, 0x0f, 0x84});
            missing_right = code_.rel32_placeholder();
            const auto search_loop = code_.position();
            code_.raw({0xf2, 0x41, 0x0f, 0x10, 0x11,
                       0x66, 0x0f, 0x2e, 0xc2, 0x0f, 0x8a});
            const auto unordered_key = code_.rel32_placeholder();
            code_.raw({0x0f, 0x84});
            found_right = code_.rel32_placeholder();
            const auto next_search = code_.position();
            code_.patch_rel32(unordered_key, next_search);
            code_.raw({0x49, 0x83, 0xc1, 0x10,
                       0x48, 0xff, 0xc8, 0x0f, 0x85});
            const auto repeat_search = code_.rel32_placeholder();
            code_.patch_rel32(repeat_search, search_loop);
            code_.raw({0xe9});
            const auto missing_after_search = code_.rel32_placeholder();
            const auto found = code_.position();
            code_.patch_rel32(found_right, found);
            code_.raw({0xf2, 0x41, 0x0f, 0x10, 0x51, 0x08});
            if (opcode == Opcode::DifferenceF64Multisets) {
                code_.raw({0xf2, 0x0f, 0x5c, 0xca});
            } else if (opcode == Opcode::FloorDivideF64Multisets) {
                code_.raw({0xf2, 0x0f, 0x5e, 0xca,
                           0x66, 0x0f, 0x3a, 0x0b, 0xc9, 0x01});
            } else if (opcode == Opcode::RemainderF64Multisets) {
                code_.raw({0x66, 0x0f, 0x28, 0xd9,
                           0xf2, 0x0f, 0x5e, 0xca,
                           0x66, 0x0f, 0x3a, 0x0b, 0xc9, 0x01,
                           0xf2, 0x0f, 0x59, 0xca,
                           0xf2, 0x0f, 0x5c, 0xd9,
                           0x66, 0x0f, 0x28, 0xcb});
            }
            code_.raw({0xe9});
            const auto computed = code_.rel32_placeholder();
            const auto missing = code_.position();
            code_.patch_rel32(missing_right, missing);
            code_.patch_rel32(missing_after_search, missing);
            if (opcode != Opcode::DifferenceF64Multisets) {
                code_.raw({0xe9});
                const auto skip_missing = code_.rel32_placeholder();
                const auto append_check = code_.position();
                code_.patch_rel32(computed, append_check);
                code_.raw({0x66, 0x0f, 0xef, 0xd2,
                           0x66, 0x0f, 0x2e, 0xca, 0x0f, 0x86});
                const auto skip_nonpositive = code_.rel32_placeholder();
                code_.raw({0xf2, 0x41, 0x0f, 0x11, 0x02,
                           0xf2, 0x41, 0x0f, 0x11, 0x4a, 0x08,
                           0x49, 0x83, 0xc2, 0x10,
                           0x49, 0xff, 0xc3});
                const auto next_left = code_.position();
                code_.patch_rel32(skip_missing, next_left);
                code_.patch_rel32(skip_nonpositive, next_left);
            } else {
                const auto append_check = code_.position();
                code_.patch_rel32(computed, append_check);
                code_.raw({0x66, 0x0f, 0xef, 0xd2,
                           0x66, 0x0f, 0x2e, 0xca, 0x0f, 0x86});
                const auto skip_nonpositive = code_.rel32_placeholder();
                code_.raw({0xf2, 0x41, 0x0f, 0x11, 0x02,
                           0xf2, 0x41, 0x0f, 0x11, 0x4a, 0x08,
                           0x49, 0x83, 0xc2, 0x10,
                           0x49, 0xff, 0xc3});
                code_.patch_rel32(skip_nonpositive, code_.position());
            }
        } else {
            code_.raw({0xf2, 0x41, 0x0f, 0x11, 0x02,
                       0xf2, 0x41, 0x0f, 0x11, 0x4a, 0x08,
                       0x49, 0x83, 0xc2, 0x10,
                       0x49, 0xff, 0xc3});
        }
        code_.raw({0x48, 0x83, 0xc2, 0x10,
                   0x48, 0xff, 0xc9, 0x0f, 0x85});
        const auto repeat_left = code_.rel32_placeholder();
        code_.patch_rel32(repeat_left, left_loop);
        const auto left_complete = code_.position();
        code_.patch_rel32(left_empty, left_complete);

        if (unite) {
            code_.raw({0x48, 0x8b, 0x95});
            code_.i32(frame.displacement(frame.temp_base + first + 1));
            code_.raw({0x48, 0x8b, 0x0a,
                       0x48, 0xd1, 0xe9,
                       0x48, 0x83, 0xc2, 0x10,
                       0x48, 0x85, 0xc9, 0x0f, 0x84});
            const auto right_empty = code_.rel32_placeholder();
            const auto right_loop = code_.position();
            code_.raw({0xf2, 0x0f, 0x10, 0x02,
                       0xf2, 0x0f, 0x10, 0x4a, 0x08,
                       0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.scratch_slot));
            code_.raw({0x48, 0x83, 0xc0, 0x10,
                       0x4d, 0x89, 0xd9,
                       0x4d, 0x85, 0xc9, 0x0f, 0x84});
            const auto append_new = code_.rel32_placeholder();
            const auto search_output = code_.position();
            code_.raw({0xf2, 0x0f, 0x10, 0x10,
                       0x66, 0x0f, 0x2e, 0xc2, 0x0f, 0x8a});
            const auto unordered_key = code_.rel32_placeholder();
            code_.raw({0x0f, 0x84});
            const auto found_key = code_.rel32_placeholder();
            const auto next_search = code_.position();
            code_.patch_rel32(unordered_key, next_search);
            code_.raw({0x48, 0x83, 0xc0, 0x10,
                       0x49, 0xff, 0xc9, 0x0f, 0x85});
            const auto repeat_search = code_.rel32_placeholder();
            code_.patch_rel32(repeat_search, search_output);
            const auto append = code_.position();
            code_.patch_rel32(append_new, append);
            code_.raw({0xf2, 0x41, 0x0f, 0x11, 0x02,
                       0xf2, 0x41, 0x0f, 0x11, 0x4a, 0x08,
                       0x49, 0x83, 0xc2, 0x10,
                       0x49, 0xff, 0xc3, 0xe9});
            const auto appended = code_.rel32_placeholder();
            const auto found = code_.position();
            code_.patch_rel32(found_key, found);
            code_.raw({0xf2, 0x0f, 0x58, 0x48, 0x08,
                       0xf2, 0x0f, 0x11, 0x48, 0x08});
            const auto next_right = code_.position();
            code_.patch_rel32(appended, next_right);
            code_.raw({0x48, 0x83, 0xc2, 0x10,
                       0x48, 0xff, 0xc9, 0x0f, 0x85});
            const auto repeat_right = code_.rel32_placeholder();
            code_.patch_rel32(repeat_right, right_loop);
            code_.patch_rel32(right_empty, code_.position());
        }

        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x4c, 0x89, 0xd9,
                   0x48, 0xd1, 0xe1,
                   0x48, 0x89, 0x08,
                   0x48, 0x89, 0x48, 0x08});
        if (owns_left) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.temp_base + first));
            release_pointer_in_rax();
        }
        if (owns_right) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.temp_base + first + 1));
            release_pointer_in_rax();
        }
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
    }

    [[gnu::noinline]] void emit_f64_multiset_scalar(
        const Frame& frame,
        unsigned first,
        vkf::machine_ir::Opcode opcode,
        bool owns_multiset
    ) {
        using vkf::machine_ir::Opcode;
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto pointer_present = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(pointer_present, code_.position());

        load_xmm(2, frame.displacement(frame.temp_base + first + 1));
        code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xca,
                   0xf2, 0x49, 0x0f, 0x2a, 0xd9,
                   0x66, 0x0f, 0x2e, 0xd3, 0x0f, 0x84});
        const auto integral_scalar = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(integral_scalar, code_.position());
        if (opcode == Opcode::FloorDivideF64MultisetScalar) {
            code_.raw({0x66, 0x0f, 0xef, 0xdb,
                       0x66, 0x0f, 0x2e, 0xd3, 0x0f, 0x85});
            const auto nonzero = code_.rel32_placeholder();
            emit_abort();
            code_.patch_rel32(nonzero, code_.position());
        }

        code_.raw({0x48, 0x8b, 0x00,
                   0x48, 0x89, 0xc1,
                   0x48, 0xc1, 0xe9, 0x3d,
                   0x48, 0x85, 0xc9, 0x0f, 0x84});
        const auto size_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(size_valid, code_.position());
        code_.raw({0x48, 0xc1, 0xe0, 0x03,
                   0x48, 0x83, 0xc0, 0x10, 0x0f, 0x83});
        const auto allocation_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocation_valid, code_.position());
        move_pointer_argument_from_rax();
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto allocated = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocated, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x4c, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x49, 0x83, 0xc2, 0x10,
                   0x45, 0x31, 0xdb,
                   0x49, 0x8b, 0x08,
                   0x48, 0xd1, 0xe9,
                   0x49, 0x8d, 0x50, 0x10,
                   0x48, 0x85, 0xc9, 0x0f, 0x84});
        const auto empty = code_.rel32_placeholder();
        const auto loop = code_.position();
        code_.raw({0xf2, 0x0f, 0x10, 0x02,
                   0xf2, 0x0f, 0x10, 0x4a, 0x08});
        load_xmm(2, frame.displacement(frame.temp_base + first + 1));
        if (opcode == Opcode::AddF64MultisetScalar) {
            code_.raw({0xf2, 0x0f, 0x58, 0xca});
        } else if (opcode == Opcode::SubtractF64MultisetScalar) {
            code_.raw({0xf2, 0x0f, 0x5c, 0xca});
        } else {
            code_.raw({0xf2, 0x0f, 0x5e, 0xca,
                       0x66, 0x0f, 0x3a, 0x0b, 0xc9, 0x01});
        }
        code_.raw({0x66, 0x0f, 0xef, 0xd2,
                   0x66, 0x0f, 0x2e, 0xca, 0x0f, 0x86});
        const auto skip_nonpositive = code_.rel32_placeholder();
        code_.raw({0xf2, 0x41, 0x0f, 0x11, 0x02,
                   0xf2, 0x41, 0x0f, 0x11, 0x4a, 0x08,
                   0x49, 0x83, 0xc2, 0x10,
                   0x49, 0xff, 0xc3});
        code_.patch_rel32(skip_nonpositive, code_.position());
        code_.raw({0x48, 0x83, 0xc2, 0x10,
                   0x48, 0xff, 0xc9, 0x0f, 0x85});
        const auto repeat = code_.rel32_placeholder();
        code_.patch_rel32(repeat, loop);
        code_.patch_rel32(empty, code_.position());
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x4c, 0x89, 0xd9,
                   0x48, 0xd1, 0xe1,
                   0x48, 0x89, 0x08,
                   0x48, 0x89, 0x48, 0x08});
        if (owns_multiset) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.temp_base + first));
            release_pointer_in_rax();
        }
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
    }

    void emit_read_line_string(const Frame& frame, unsigned first) {
        constexpr std::uint32_t initial_capacity = 256u;
        code_.raw({0x48, 0xc7, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 1));
        code_.i32(initial_capacity);
        code_.raw({0x48, 0xc7, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.i32(0);
#ifdef _WIN32
        code_.raw({0xb9}); code_.i32(initial_capacity + 9u);
#else
        code_.raw({0xbf}); code_.i32(initial_capacity + 9u);
#endif
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto allocated = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocated, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));

        const auto read_loop = code_.position();
#ifdef _WIN32
        code_.raw({0x31, 0xc9, 0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x83, 0xc2, 0x08, 0x48, 0x03, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.raw({0x41, 0xb8, 0x01, 0x00, 0x00, 0x00});
        call_runtime_slot(21);
        code_.raw({0x48, 0x98});
#else
        code_.raw({0x31, 0xff, 0x48, 0x8b, 0xb5});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x83, 0xc6, 0x08, 0x48, 0x03, 0xb5});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.raw({0xba, 0x01, 0x00, 0x00, 0x00, 0x31, 0xc0, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x84});
        const auto eof = code_.rel32_placeholder();
        code_.raw({0x0f, 0x89});
        const auto read_ok = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(read_ok, code_.position());

        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.raw({0x80, 0x7c, 0x08, 0x08, 0x0a, 0x0f, 0x84});
        const auto newline = code_.rel32_placeholder();
        code_.raw({0x48, 0xff, 0xc1, 0x48, 0x89, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.raw({0x48, 0x3b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + 1));
        code_.raw({0x0f, 0x85});
        const auto continue_reading = code_.rel32_placeholder();

        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 1));
        code_.raw({0x48, 0xd1, 0xe0, 0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 1));
        code_.raw({0x48, 0x83, 0xc0, 0x09, 0x0f, 0x83});
        const auto capacity_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(capacity_valid, code_.position());
        move_pointer_argument_from_rax();
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto grown = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(grown, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 3));
#ifdef _WIN32
        code_.raw({0x48, 0x8d, 0x48, 0x08, 0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x83, 0xc2, 0x08, 0x4c, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
#else
        code_.raw({0x48, 0x8d, 0x78, 0x08, 0x48, 0x8b, 0xb5});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x83, 0xc6, 0x08, 0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
#endif
        call_runtime_slot(28);
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        release_pointer_in_rax();
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot + 3));
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0xe9});
        const auto repeat_after_grow = code_.rel32_placeholder();

        const auto repeat = code_.position();
        code_.patch_rel32(continue_reading, repeat);
        code_.raw({0xe9});
        const auto repeat_without_grow = code_.rel32_placeholder();
        code_.patch_rel32(repeat_after_grow, read_loop);
        code_.patch_rel32(repeat_without_grow, read_loop);

        const auto complete = code_.position();
        code_.patch_rel32(eof, complete);
        code_.patch_rel32(newline, complete);
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.raw({0x48, 0x85, 0xc9, 0x0f, 0x84});
        const auto no_carriage_return = code_.rel32_placeholder();
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x80, 0x7c, 0x08, 0x07, 0x0d, 0x0f, 0x85});
        const auto keep_length = code_.rel32_placeholder();
        code_.raw({0x48, 0xff, 0xc9, 0x48, 0x89, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        const auto finalized_length = code_.position();
        code_.patch_rel32(no_carriage_return, finalized_length);
        code_.patch_rel32(keep_length, finalized_length);
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot + 2));
        code_.raw({0x48, 0x89, 0x08, 0xc6, 0x44, 0x08, 0x08, 0x00,
                   0x48, 0x8d, 0x50, 0x08, 0x48, 0x89, 0x95});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0xff, 0xc1, 0x48, 0xf7, 0xd9,
                   0xf2, 0x48, 0x0f, 0x2a, 0xc1});
        store_xmm(0, frame.displacement(frame.temp_base + first + 1));
    }

    void emit_read_file_string(
        const vkf::machine_ir::Function& function,
        const Frame& frame,
        unsigned first,
        const vkf::machine_ir::Instruction& instruction,
        bool entry,
        std::vector<MachineBranchPatch>& branches
    ) {
        const bool owns_path = instruction.owns_input;
#ifdef _WIN32
        // _open(path, _O_RDONLY | _O_BINARY)
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0xba, 0x00, 0x80, 0x00, 0x00, 0x45, 0x31, 0xc0});
        call_runtime_slot(20);
        code_.raw({0x48, 0x63, 0xc0});
#else
        // open(path, O_RDONLY)
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x31, 0xf6, 0x31, 0xd2, 0xb8, 0x02, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x89});
        const auto opened = code_.rel32_placeholder();
        if (owns_path) {
            release_owned_string(
                frame.displacement(frame.temp_base + first),
                frame.displacement(frame.temp_base + first + 1));
        }
        emit_instruction_error(
            function, frame, instruction,
            vkf::machine_ir::file_not_found_error_mask, entry, branches);
        code_.patch_rel32(opened, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        if (owns_path) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.temp_base + first));
            code_.raw({0x48, 0x83, 0xe8, 0x08});
            release_pointer_in_rax();
        }
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));

        // Seek to the end to determine the allocation size.
#ifdef _WIN32
        code_.raw({0x89, 0xc1, 0x31, 0xd2, 0x41, 0xb8, 0x02, 0x00, 0x00, 0x00});
        call_runtime_slot(23);
        code_.raw({0x48, 0x63, 0xc0});
#else
        code_.raw({0x48, 0x89, 0xc7, 0x31, 0xf6, 0xba, 0x02, 0x00, 0x00, 0x00,
                   0xb8, 0x08, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x89});
        const auto sized = code_.rel32_placeholder();
#ifdef _WIN32
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first));
        call_runtime_slot(22);
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0xb8, 0x03, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        emit_instruction_error(
            function, frame, instruction,
            vkf::machine_ir::runtime_error_mask, entry, branches);
        code_.patch_rel32(sized, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first + 1));

        // Rewind before reading.
#ifdef _WIN32
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x31, 0xd2, 0x45, 0x31, 0xc0});
        call_runtime_slot(23);
        code_.raw({0x48, 0x63, 0xc0});
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x31, 0xf6, 0x31, 0xd2, 0xb8, 0x08, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x89});
        const auto rewound = code_.rel32_placeholder();
#ifdef _WIN32
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first));
        call_runtime_slot(22);
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0xb8, 0x03, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        emit_instruction_error(
            function, frame, instruction,
            vkf::machine_ir::runtime_error_mask, entry, branches);
        code_.patch_rel32(rewound, code_.position());

        // Owned strings store their byte length in an eight-byte header.
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x48, 0x83, 0xc0, 0x09, 0x0f, 0x83});
        const auto allocation_size_valid = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocation_size_valid, code_.position());
        move_pointer_argument_from_rax();
        call_runtime_slot(8);
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
        const auto allocated = code_.rel32_placeholder();
        emit_abort();
        code_.patch_rel32(allocated, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x48, 0x89, 0x08, 0x48, 0x8d, 0x50, 0x08, 0xc6, 0x04, 0x0a, 0x00});

        // Read the complete file into the new string allocation.
#ifdef _WIN32
        code_.raw({0x44, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first));
        call_runtime_slot(21);
        code_.raw({0x48, 0x63, 0xc0});
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x8b, 0xb5});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x83, 0xc6, 0x08});
        code_.raw({0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.temp_base + first + 1));
        code_.raw({0x31, 0xc0, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x89});
        const auto read_ok = code_.rel32_placeholder();
#ifdef _WIN32
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first));
        call_runtime_slot(22);
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0xb8, 0x03, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        release_pointer_in_rax();
        emit_instruction_error(
            function, frame, instruction,
            vkf::machine_ir::runtime_error_mask, entry, branches);
        code_.patch_rel32(read_ok, code_.position());
#ifdef _WIN32
        code_.raw({0x4c, 0x63, 0xc0});
#else
        code_.raw({0x49, 0x89, 0xc0});
#endif
        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x4c, 0x89, 0x00, 0x48, 0x8d, 0x50, 0x08,
                   0x42, 0xc6, 0x04, 0x02, 0x00});

        // close(fd)
#ifdef _WIN32
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first));
        call_runtime_slot(22);
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0xb8, 0x03, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif

        code_.raw({0x48, 0x8b, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0x48, 0x83, 0xc0, 0x08, 0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0x48, 0x8b, 0x48, 0xf8, 0x48, 0xff, 0xc1, 0x48, 0xf7, 0xd9,
                   0xf2, 0x48, 0x0f, 0x2a, 0xc1});
        store_xmm(0, frame.displacement(frame.temp_base + first + 1));
    }

    void emit_write_file_string(
        const vkf::machine_ir::Function& function,
        const Frame& frame,
        unsigned first,
        const vkf::machine_ir::Instruction& instruction,
        bool entry,
        std::vector<MachineBranchPatch>& branches
    ) {
        const bool owns_path = instruction.owns_left;
        const bool owns_data = instruction.owns_right;
        const bool append = instruction.index != 0;
#ifdef _WIN32
        // _open(path, _O_WRONLY | _O_CREAT | (_O_APPEND or _O_TRUNC) | _O_BINARY, 0600)
        code_.raw({0x48, 0x8b, 0x8d});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0xba}); code_.i32(append ? 0x8109 : 0x8301);
        code_.raw({0x41, 0xb8, 0x80, 0x01, 0x00, 0x00});
        call_runtime_slot(20);
        code_.raw({0x48, 0x63, 0xc0});
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.temp_base + first));
        code_.raw({0xbe}); code_.i32(append ? 0x441 : 0x241);
        code_.raw({0xba, 0x80, 0x01, 0x00, 0x00,
                   0xb8, 0x02, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x89});
        const auto opened = code_.rel32_placeholder();
        if (owns_path) {
            release_owned_string(
                frame.displacement(frame.temp_base + first),
                frame.displacement(frame.temp_base + first + 1));
        }
        if (owns_data) {
            release_owned_string(
                frame.displacement(frame.temp_base + first + 2),
                frame.displacement(frame.temp_base + first + 3));
        }
        emit_instruction_error(
            function, frame, instruction,
            vkf::machine_ir::runtime_error_mask, entry, branches);
        code_.patch_rel32(opened, code_.position());
        code_.raw({0x48, 0x89, 0x85});
        code_.i32(frame.displacement(frame.scratch_slot));
        if (owns_path) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.temp_base + first));
            code_.raw({0x48, 0x83, 0xe8, 0x08});
            release_pointer_in_rax();
        }

        load_xmm(0, frame.displacement(frame.temp_base + first + 3));
#ifdef _WIN32
        code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xc0,
                   0x4d, 0x85, 0xc0, 0x0f, 0x89});
        const auto decoded = code_.rel32_placeholder();
        code_.raw({0x49, 0xf7, 0xd8, 0x49, 0xff, 0xc8});
        code_.patch_rel32(decoded, code_.position());
        code_.raw({0x48, 0x8b, 0x95});
        code_.i32(frame.displacement(frame.temp_base + first + 2));
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot));
        call_runtime_slot(13);
        code_.raw({0x48, 0x63, 0xc0});
#else
        code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xd0,
                   0x48, 0x85, 0xd2, 0x0f, 0x89});
        const auto decoded = code_.rel32_placeholder();
        code_.raw({0x48, 0xf7, 0xda, 0x48, 0xff, 0xca});
        code_.patch_rel32(decoded, code_.position());
        code_.raw({0x48, 0x8b, 0xb5});
        code_.i32(frame.displacement(frame.temp_base + first + 2));
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0xb8, 0x01, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x89});
        const auto wrote = code_.rel32_placeholder();
#ifdef _WIN32
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot));
        call_runtime_slot(22);
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0xb8, 0x03, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        if (owns_data) {
            release_owned_string(
                frame.displacement(frame.temp_base + first + 2),
                frame.displacement(frame.temp_base + first + 3));
        }
        emit_instruction_error(
            function, frame, instruction,
            vkf::machine_ir::runtime_error_mask, entry, branches);
        code_.patch_rel32(wrote, code_.position());

#ifdef _WIN32
        code_.raw({0x8b, 0x8d});
        code_.i32(frame.displacement(frame.scratch_slot));
        call_runtime_slot(22);
#else
        code_.raw({0x48, 0x8b, 0xbd});
        code_.i32(frame.displacement(frame.scratch_slot));
        code_.raw({0xb8, 0x03, 0x00, 0x00, 0x00, 0x0f, 0x05});
#endif
        if (owns_data) {
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(frame.temp_base + first + 2));
            code_.raw({0x48, 0x83, 0xe8, 0x08});
            release_pointer_in_rax();
        }
        emit_number(vkf::machine_ir::null_value());
        store_xmm(0, frame.displacement(frame.temp_base + first));
    }

    static bool is_integer_function_candidate(const vkf::machine_ir::Function& function) {
        using vkf::machine_ir::Opcode;
        const auto range_is_i64 = [&](std::uint32_t base, std::uint32_t width) {
            if (base > function.local_classes.size() ||
                width > function.local_classes.size() - base) return false;
            return std::all_of(
                function.local_classes.begin() + base,
                function.local_classes.begin() + base + width,
                [](auto value) { return value == vkf::machine_ir::ValueClass::I64; });
        };
        for (std::size_t instruction_index = 0;
             instruction_index < function.instructions.size(); ++instruction_index) {
            const auto& instruction = function.instructions[instruction_index];
            switch (instruction.opcode) {
                case Opcode::PushF64:
                    if (!std::isfinite(instruction.f64) ||
                        instruction.f64 != std::floor(instruction.f64)) return false;
                    break;
                case Opcode::LoadLocal:
                case Opcode::StoreLocal:
                    if (instruction.index >= function.local_classes.size() ||
                        function.local_classes[instruction.index] !=
                            vkf::machine_ir::ValueClass::I64) return false;
                    break;
                case Opcode::LoadF64LocalsIndex:
                case Opcode::StoreF64LocalsIndex:
                    if (!range_is_i64(instruction.index, instruction.argument_count)) return false;
                    break;
                case Opcode::Drop:
                case Opcode::Duplicate:
                case Opcode::IdentityF64:
                case Opcode::NegateF64:
                case Opcode::LogicalNotF64:
                case Opcode::BooleanizeF64:
                case Opcode::AddF64:
                case Opcode::SubtractF64:
                case Opcode::MultiplyF64:
                case Opcode::FloorDivideF64:
                case Opcode::RemainderF64:
                case Opcode::OrderedLessF64:
                case Opcode::OrderedLessEqualF64:
                case Opcode::OrderedGreaterF64:
                case Opcode::OrderedGreaterEqualF64:
                case Opcode::OrderedEqualF64:
                case Opcode::UnorderedNotEqualF64:
                case Opcode::EqualBits:
                case Opcode::NotEqualBits:
                case Opcode::Label:
                case Opcode::Jump:
                case Opcode::JumpIfFalse:
                case Opcode::JumpIfTrue:
                case Opcode::ReturnF64:
                    break;
                case Opcode::ReturnValues:
                    return false;
                default:
                    return false;
            }
        }
        return true;
    }

    void emit_integer_function(
        const vkf::machine_ir::Function& function,
        const Frame& frame
    ) {
        using vkf::machine_ir::Opcode;
        std::vector<int> cached_local_register(function.locals.size(), -1);
        std::map<std::uint32_t, std::size_t> label_positions;
        for (std::size_t position = 0; position < function.instructions.size(); ++position) {
            if (function.instructions[position].opcode == Opcode::Label) {
                label_positions.emplace(function.instructions[position].label, position);
            }
        }
        std::vector<std::pair<std::size_t, std::size_t>> loops;
        std::set<std::uint32_t> loop_header_labels;
        for (std::size_t position = 0; position < function.instructions.size(); ++position) {
            const auto& instruction = function.instructions[position];
            if (instruction.opcode != Opcode::Jump) continue;
            const auto target = label_positions.find(instruction.label);
            if (target != label_positions.end() && target->second < position) {
                loops.emplace_back(target->second, position);
                loop_header_labels.insert(instruction.label);
            }
        }
        std::vector<std::pair<unsigned, unsigned>> frequency;
        for (unsigned local = 0; local < function.locals.size(); ++local) {
            if (local < function.parameters.size() ||
                function.local_classes[local] != vkf::machine_ir::ValueClass::I64 ||
                function.locals[local].find('.') != std::string::npos) continue;
            unsigned score = 0;
            for (std::size_t position = 0; position < function.instructions.size(); ++position) {
                const auto& instruction = function.instructions[position];
                if ((instruction.opcode != Opcode::LoadLocal &&
                     instruction.opcode != Opcode::StoreLocal) || instruction.index != local) {
                    continue;
                }
                const auto depth = static_cast<unsigned>(std::count_if(
                    loops.begin(), loops.end(), [position](const auto& loop) {
                        return position >= loop.first && position <= loop.second;
                    }));
                score += 1u << std::min(depth * 3u, 15u);
            }
            if (score != 0) frequency.emplace_back(score, local);
        }
        std::sort(frequency.begin(), frequency.end(), [](const auto& left, const auto& right) {
            return left.first != right.first ? left.first > right.first : left.second < right.second;
        });
        constexpr std::array<unsigned, 6> available{3, 6, 7, 13, 14, 15};
        for (std::size_t index = 0;
             index < frequency.size() && index < available.size(); ++index) {
            cached_local_register[frequency[index].second] =
                static_cast<int>(available[index]);
        }
        prologue(frame);
        const auto align_loop_header = [&](std::uint32_t label) {
            if (loop_header_labels.find(label) != loop_header_labels.end()) {
                code_.align(16u);
            }
        };
        save_result_context(frame);
        for (std::size_t index = 0; index < function.parameters.size(); ++index) {
            if (function.local_classes[index] != vkf::machine_ir::ValueClass::I64) continue;
            load_argument_from_r10(static_cast<std::uint32_t>(index));
            code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc0,
                       0x48, 0x89, 0x85});
            code_.i32(frame.displacement(static_cast<unsigned>(index)));
        }
        unsigned stack_depth = 0;
        std::map<std::uint32_t, std::size_t> labels;
        std::vector<MachineBranchPatch> branches;
        std::vector<std::size_t> shared_index_error_patches;
        const vkf::machine_ir::Instruction* shared_index_error = nullptr;
        const auto stack_displacement = [&](unsigned slot) {
            return frame.displacement(frame.temp_base + slot);
        };
        constexpr std::array<unsigned, 5> stack_registers{0, 1, 2, 8, 9};
        const auto stack_register = [&](unsigned slot) -> std::optional<unsigned> {
            return slot < stack_registers.size()
                ? std::optional<unsigned>(stack_registers[slot]) : std::nullopt;
        };
        const auto move_register = [&](unsigned destination, unsigned source) {
            if (destination == source) return;
            code_.raw({static_cast<unsigned>(0x48u |
                           (destination >= 8 ? 0x04u : 0u) |
                           (source >= 8 ? 0x01u : 0u)),
                       0x8b,
                       static_cast<unsigned>(0xc0u + (destination & 7u) * 8u +
                                             (source & 7u))});
        };
        const auto load_stack = [&](unsigned slot, unsigned destination) {
            if (const auto source = stack_register(slot)) move_register(destination, *source);
            else {
                code_.raw({static_cast<unsigned>(0x48u |
                               (destination >= 8 ? 0x04u : 0u)),
                           0x8b,
                           static_cast<unsigned>(0x85u + (destination & 7u) * 8u)});
                code_.i32(stack_displacement(slot));
            }
        };
        const auto store_stack = [&](unsigned slot, unsigned source) {
            if (const auto destination = stack_register(slot)) move_register(*destination, source);
            else {
                code_.raw({static_cast<unsigned>(0x48u |
                               (source >= 8 ? 0x04u : 0u)),
                           0x89,
                           static_cast<unsigned>(0x85u + (source & 7u) * 8u)});
                code_.i32(stack_displacement(slot));
            }
        };
        const auto load_local_integer = [&](unsigned local, unsigned destination) {
            const int cached = cached_local_register.at(local);
            if (cached >= 0) {
                move_register(destination, static_cast<unsigned>(cached));
                return;
            }
            code_.raw({static_cast<unsigned>(0x48u |
                           (destination >= 8 ? 0x04u : 0u)),
                       0x8b,
                       static_cast<unsigned>(0x85u + (destination & 7u) * 8u)});
            code_.i32(frame.displacement(local));
        };
        const auto store_local_integer = [&](unsigned local, unsigned source) {
            const int cached = cached_local_register.at(local);
            if (cached >= 0) {
                move_register(static_cast<unsigned>(cached), source);
                return;
            }
            code_.raw({static_cast<unsigned>(0x48u |
                           (source >= 8 ? 0x04u : 0u)),
                       0x89,
                       static_cast<unsigned>(0x85u + (source & 7u) * 8u)});
            code_.i32(frame.displacement(local));
        };
        const auto push_rax = [&]() {
            code_.raw({0x48, 0x89, 0x85});
            code_.i32(stack_displacement(stack_depth++));
        };
        const auto pop_rax = [&]() {
            if (stack_depth == 0) throw BackendFailure("integer x64 stack underflow");
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(stack_displacement(--stack_depth));
        };
        const auto queue_index_error = [&](const auto& instruction,
                                           const std::vector<std::size_t>& invalid) {
            if (!shared_index_error) shared_index_error = &instruction;
            shared_index_error_patches.insert(
                shared_index_error_patches.end(), invalid.begin(), invalid.end());
        };
        struct GuardedIndexLoop {
            std::uint32_t bound_local = 0;
            std::uint32_t constant_bound = 0;
            bool bound_is_constant = false;
            std::uint32_t maximum_bound = 0;
            const vkf::machine_ir::Instruction* error = nullptr;
        };
        std::map<std::uint32_t, GuardedIndexLoop> guarded_index_loops;
        std::vector<bool> guarded_index_access(function.instructions.size(), false);
        for (std::size_t label = 0; label + 4 < function.instructions.size(); ++label) {
            const auto& header = function.instructions[label];
            const auto& index = function.instructions[label + 1];
            const auto& bound = function.instructions[label + 2];
            const auto& compare = function.instructions[label + 3];
            const auto& exit = function.instructions[label + 4];
            const bool local_bound = bound.opcode == Opcode::LoadLocal;
            const bool constant_bound = bound.opcode == Opcode::PushF64 &&
                bound.f64 >= 0.0 && bound.f64 == std::floor(bound.f64) &&
                bound.f64 <= static_cast<double>(
                    std::numeric_limits<std::uint32_t>::max());
            if (header.opcode != Opcode::Label || index.opcode != Opcode::LoadLocal ||
                (!local_bound && !constant_bound) ||
                compare.opcode != Opcode::OrderedLessF64 ||
                exit.opcode != Opcode::JumpIfFalse) continue;
            bool initialized_nonnegative = false;
            for (std::size_t cursor = label; cursor > 1; --cursor) {
                const auto& store = function.instructions[cursor - 1];
                if (store.opcode == Opcode::Label || store.opcode == Opcode::Jump) break;
                if (store.opcode == Opcode::StoreLocal && store.index == index.index) {
                    const auto& value = function.instructions[cursor - 2];
                    initialized_nonnegative = value.opcode == Opcode::PushF64 && value.f64 >= 0.0;
                    break;
                }
            }
            if (!initialized_nonnegative) continue;
            std::size_t end = label + 5;
            while (end < function.instructions.size() &&
                   !(function.instructions[end].opcode == Opcode::Jump &&
                     function.instructions[end].label == header.label)) ++end;
            if (end == function.instructions.size()) continue;
            const bool has_external_entry = std::any_of(
                function.instructions.begin(), function.instructions.end(),
                [&](const auto& branch) {
                    const auto position = static_cast<std::size_t>(&branch - function.instructions.data());
                    return position != end &&
                        (branch.opcode == Opcode::Jump ||
                         branch.opcode == Opcode::JumpIfFalse ||
                         branch.opcode == Opcode::JumpIfTrue) &&
                        branch.label == header.label;
                });
            if (has_external_entry) continue;
            const auto is_unit_step_store = [&](std::size_t position,
                                                std::uint32_t local,
                                                Opcode operation) {
                return position >= 3 &&
                    function.instructions[position].opcode == Opcode::StoreLocal &&
                    function.instructions[position].index == local &&
                    function.instructions[position - 3].opcode == Opcode::LoadLocal &&
                    function.instructions[position - 3].index == local &&
                    function.instructions[position - 2].opcode == Opcode::PushF64 &&
                    function.instructions[position - 2].f64 == 1.0 &&
                    function.instructions[position - 1].opcode == operation;
            };
            bool index_steps_up = true;
            bool bound_is_invariant_or_steps_down = true;
            for (std::size_t position = label + 5; position < end; ++position) {
                const auto& candidate = function.instructions[position];
                if (candidate.opcode != Opcode::StoreLocal) continue;
                if (candidate.index == index.index &&
                    !is_unit_step_store(position, index.index, Opcode::AddF64)) {
                    index_steps_up = false;
                }
                if (local_bound && candidate.index == bound.index &&
                    !is_unit_step_store(position, bound.index, Opcode::SubtractF64)) {
                    bound_is_invariant_or_steps_down = false;
                }
            }
            if (!index_steps_up || !bound_is_invariant_or_steps_down) continue;
            GuardedIndexLoop proof;
            proof.bound_local = local_bound ? bound.index : 0u;
            proof.bound_is_constant = constant_bound;
            proof.constant_bound = constant_bound
                ? static_cast<std::uint32_t>(bound.f64) : 0u;
            proof.maximum_bound = std::numeric_limits<std::uint32_t>::max();
            for (std::size_t position = label + 5; position < end; ++position) {
                const auto& candidate = function.instructions[position];
                if (candidate.opcode != Opcode::LoadF64LocalsIndex &&
                    candidate.opcode != Opcode::StoreF64LocalsIndex) continue;
                const bool direct_index = candidate.index_local &&
                    (*candidate.index_local == index.index ||
                     (local_bound && *candidate.index_local == bound.index));
                const bool unit_offset_index = !candidate.index_local && position >= 3 &&
                    function.instructions[position - 3].opcode == Opcode::LoadLocal &&
                    function.instructions[position - 3].index == index.index &&
                    function.instructions[position - 2].opcode == Opcode::PushF64 &&
                    function.instructions[position - 2].f64 == 1.0 &&
                    function.instructions[position - 1].opcode == Opcode::AddF64;
                if (!direct_index && !unit_offset_index) continue;
                const bool reassigned_before_access = std::any_of(
                    function.instructions.begin() + static_cast<std::ptrdiff_t>(label + 5),
                    function.instructions.begin() + static_cast<std::ptrdiff_t>(position),
                    [&](const auto& prior) {
                        return prior.opcode == Opcode::StoreLocal &&
                            (prior.index == index.index ||
                             (local_bound && prior.index == bound.index));
                    });
                if (reassigned_before_access) continue;
                const bool requires_strict_bound = unit_offset_index ||
                    (local_bound && candidate.index_local &&
                     *candidate.index_local == bound.index);
                if (requires_strict_bound && candidate.argument_count == 0) continue;
                const auto maximum_bound = candidate.argument_count -
                    static_cast<std::uint32_t>(requires_strict_bound);
                if (constant_bound && proof.constant_bound > maximum_bound) continue;
                guarded_index_access[position] = true;
                proof.maximum_bound = std::min(proof.maximum_bound, maximum_bound);
                if (!proof.error) proof.error = &candidate;
            }
            if (proof.error) guarded_index_loops.emplace(header.label, proof);
        }
        for (std::size_t first = 0; first < function.instructions.size(); ++first) {
            const auto& checked = function.instructions[first];
            if ((checked.opcode != Opcode::LoadF64LocalsIndex &&
                 checked.opcode != Opcode::StoreF64LocalsIndex) ||
                !checked.index_local || guarded_index_access[first]) continue;
            const auto local = *checked.index_local;
            for (std::size_t position = first + 1;
                 position < function.instructions.size(); ++position) {
                const auto& candidate = function.instructions[position];
                if (candidate.opcode == Opcode::StoreLocal && candidate.index == local) break;
                if (candidate.opcode == Opcode::Label) {
                    bool external_entry = false;
                    for (std::size_t source = 0; source < function.instructions.size(); ++source) {
                        const auto& branch = function.instructions[source];
                        if ((branch.opcode == Opcode::Jump ||
                             branch.opcode == Opcode::JumpIfFalse ||
                             branch.opcode == Opcode::JumpIfTrue) &&
                            branch.label == candidate.label && source < first) {
                            external_entry = true;
                            break;
                        }
                    }
                    if (external_entry) break;
                }
                if ((candidate.opcode == Opcode::LoadF64LocalsIndex ||
                     candidate.opcode == Opcode::StoreF64LocalsIndex) &&
                    candidate.index_local && *candidate.index_local == local &&
                    candidate.argument_count == checked.argument_count) {
                    guarded_index_access[position] = true;
                }
            }
        }
        for (std::size_t instruction_index = 0;
             instruction_index < function.instructions.size(); ++instruction_index) {
            const auto& instruction = function.instructions[instruction_index];
            if (stack_depth == 0 && instruction.opcode == Opcode::Label &&
                instruction_index + 24u < function.instructions.size()) {
                const auto at = [&](std::size_t offset) -> const auto& {
                    return function.instructions[instruction_index + offset];
                };
                const auto& left_load = at(6u);
                const auto& right_load = at(10u);
                const auto& left_store = at(11u);
                const auto& right_store = at(14u);
                const bool fixed_prefix_reverse =
                    at(1u).opcode == Opcode::LoadLocal &&
                    at(2u).opcode == Opcode::LoadLocal &&
                    at(3u).opcode == Opcode::OrderedLessF64 &&
                    at(4u).opcode == Opcode::JumpIfFalse &&
                    at(5u).opcode == Opcode::LoadLocal &&
                    left_load.opcode == Opcode::LoadF64LocalsIndex &&
                    at(7u).opcode == Opcode::StoreLocal &&
                    at(8u).opcode == Opcode::LoadLocal &&
                    at(9u).opcode == Opcode::LoadLocal &&
                    right_load.opcode == Opcode::LoadF64LocalsIndex &&
                    left_store.opcode == Opcode::StoreF64LocalsIndex &&
                    at(12u).opcode == Opcode::LoadLocal &&
                    at(13u).opcode == Opcode::LoadLocal &&
                    right_store.opcode == Opcode::StoreF64LocalsIndex &&
                    at(15u).opcode == Opcode::LoadLocal &&
                    at(16u).opcode == Opcode::PushF64 && at(16u).f64 == 1.0 &&
                    at(17u).opcode == Opcode::AddF64 &&
                    at(18u).opcode == Opcode::StoreLocal &&
                    at(19u).opcode == Opcode::LoadLocal &&
                    at(20u).opcode == Opcode::PushF64 && at(20u).f64 == 1.0 &&
                    at(21u).opcode == Opcode::SubtractF64 &&
                    at(22u).opcode == Opcode::StoreLocal &&
                    at(23u).opcode == Opcode::Jump && at(23u).label == instruction.label &&
                    at(24u).opcode == Opcode::Label && at(24u).label == at(4u).label &&
                    at(1u).index == at(5u).index && at(1u).index == at(8u).index &&
                    at(1u).index == at(15u).index && at(1u).index == at(18u).index &&
                    at(2u).index == at(9u).index && at(2u).index == at(12u).index &&
                    at(2u).index == at(19u).index && at(2u).index == at(22u).index &&
                    at(7u).index == at(13u).index &&
                    left_load.index == right_load.index &&
                    left_load.index == left_store.index &&
                    left_load.index == right_store.index &&
                    left_load.argument_count == right_load.argument_count &&
                    left_load.argument_count == left_store.argument_count &&
                    left_load.argument_count == right_store.argument_count &&
                    left_load.index_local && *left_load.index_local == at(5u).index &&
                    right_load.index_local && *right_load.index_local == at(9u).index &&
                    left_store.index_local && *left_store.index_local == at(8u).index &&
                    right_store.index_local && *right_store.index_local == at(12u).index &&
                    guarded_index_access[instruction_index + 6u] &&
                    guarded_index_access[instruction_index + 10u] &&
                    guarded_index_access[instruction_index + 11u] &&
                    guarded_index_access[instruction_index + 14u];
                if (fixed_prefix_reverse) {
                    code_.raw({0x48, 0x8d, 0x95});
                    code_.i32(frame.displacement(left_load.index));
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate integer x64 label");
                    }
                    load_local_integer(at(1u).index, 0u);
                    load_local_integer(at(2u).index, 1u);
                    code_.raw({0x48, 0x3b, 0xc1});
                    branches.push_back({emit_jump(0x8d), at(4u).label});
                    code_.raw({
                        0x48, 0xf7, 0xd8,
                        0x48, 0xf7, 0xd9,
                        0x4c, 0x8b, 0x14, 0xc2,
                        0x4c, 0x8b, 0x1c, 0xca,
                        0x4c, 0x89, 0x1c, 0xc2,
                        0x4c, 0x89, 0x14, 0xca,
                        0x48, 0xf7, 0xd8,
                        0x48, 0xf7, 0xd9,
                        0x48, 0xff, 0xc0,
                        0x48, 0xff, 0xc9
                    });
                    store_local_integer(at(7u).index, 10u);
                    store_local_integer(at(1u).index, 0u);
                    store_local_integer(at(2u).index, 1u);
                    code_.byte(0xe9);
                    branches.push_back({code_.rel32_placeholder(), instruction.label});
                    instruction_index += 23u;
                    continue;
                }
            }
            if (stack_depth == 0 && instruction_index + 9u < function.instructions.size()) {
                const auto& left_index = function.instructions[instruction_index];
                const auto& left_load = function.instructions[instruction_index + 1u];
                const auto& temporary_store = function.instructions[instruction_index + 2u];
                const auto& destination_index = function.instructions[instruction_index + 3u];
                const auto& right_index = function.instructions[instruction_index + 4u];
                const auto& right_load = function.instructions[instruction_index + 5u];
                const auto& left_store = function.instructions[instruction_index + 6u];
                const auto& final_right_index = function.instructions[instruction_index + 7u];
                const auto& temporary_load = function.instructions[instruction_index + 8u];
                const auto& right_store = function.instructions[instruction_index + 9u];
                const bool fixed_swap =
                    left_index.opcode == Opcode::LoadLocal &&
                    left_load.opcode == Opcode::LoadF64LocalsIndex &&
                    temporary_store.opcode == Opcode::StoreLocal &&
                    destination_index.opcode == Opcode::LoadLocal &&
                    right_index.opcode == Opcode::LoadLocal &&
                    right_load.opcode == Opcode::LoadF64LocalsIndex &&
                    left_store.opcode == Opcode::StoreF64LocalsIndex &&
                    final_right_index.opcode == Opcode::LoadLocal &&
                    temporary_load.opcode == Opcode::LoadLocal &&
                    right_store.opcode == Opcode::StoreF64LocalsIndex &&
                    left_load.index == right_load.index &&
                    left_load.index == left_store.index &&
                    left_load.index == right_store.index &&
                    left_load.argument_count == right_load.argument_count &&
                    left_load.argument_count == left_store.argument_count &&
                    left_load.argument_count == right_store.argument_count &&
                    left_load.index_local && *left_load.index_local == left_index.index &&
                    right_load.index_local && *right_load.index_local == right_index.index &&
                    left_store.index_local && *left_store.index_local == destination_index.index &&
                    right_store.index_local && *right_store.index_local == final_right_index.index &&
                    destination_index.index == left_index.index &&
                    final_right_index.index == right_index.index &&
                    temporary_load.index == temporary_store.index &&
                    guarded_index_access[instruction_index + 1u] &&
                    guarded_index_access[instruction_index + 5u] &&
                    guarded_index_access[instruction_index + 6u] &&
                    guarded_index_access[instruction_index + 9u];
                if (fixed_swap) {
                    load_local_integer(left_index.index, 0u);
                    load_local_integer(right_index.index, 1u);
                    code_.raw({0x48, 0x8d, 0x95});
                    code_.i32(frame.displacement(left_load.index));
                    code_.raw({
                        0x48, 0xf7, 0xd8,
                        0x48, 0xf7, 0xd9,
                        0x4c, 0x8b, 0x14, 0xc2,
                        0x4c, 0x8b, 0x1c, 0xca,
                        0x4c, 0x89, 0x1c, 0xc2,
                        0x4c, 0x89, 0x14, 0xca
                    });
                    store_local_integer(temporary_store.index, 10u);
                    instruction_index += 9u;
                    continue;
                }
            }
            if (instruction.opcode == Opcode::Label) {
                const auto proof = guarded_index_loops.find(instruction.label);
                if (proof != guarded_index_loops.end() &&
                    !proof->second.bound_is_constant) {
                    load_local_integer(proof->second.bound_local, 11);
                    std::vector<std::size_t> invalid;
                    code_.raw({0x49, 0x81, 0xfb});
                    code_.i32(static_cast<std::int32_t>(proof->second.maximum_bound));
                    invalid.push_back(emit_jump(0x8f));
                    queue_index_error(*proof->second.error, invalid);
                }
            }
            if (instruction.opcode == Opcode::Label &&
                instruction_index + 14 < function.instructions.size()) {
                const auto& guard_index = function.instructions[instruction_index + 1];
                const auto& bound = function.instructions[instruction_index + 2];
                const auto& less = function.instructions[instruction_index + 3];
                const auto& exit = function.instructions[instruction_index + 4];
                const auto& store_index = function.instructions[instruction_index + 5];
                const auto& source_index = function.instructions[instruction_index + 6];
                const auto& source_load = function.instructions[instruction_index + 7];
                const auto& destination_store = function.instructions[instruction_index + 8];
                const auto& increment_index = function.instructions[instruction_index + 9];
                const auto& one = function.instructions[instruction_index + 10];
                const auto& add = function.instructions[instruction_index + 11];
                const auto& increment_store = function.instructions[instruction_index + 12];
                const auto& repeat = function.instructions[instruction_index + 13];
                const auto& exit_label = function.instructions[instruction_index + 14];
                const bool fixed_copy = guard_index.opcode == Opcode::LoadLocal &&
                    bound.opcode == Opcode::PushF64 && bound.f64 >= 1.0 &&
                    bound.f64 <= 32.0 && bound.f64 == std::floor(bound.f64) &&
                    less.opcode == Opcode::OrderedLessF64 &&
                    exit.opcode == Opcode::JumpIfFalse &&
                    store_index.opcode == Opcode::LoadLocal &&
                    source_index.opcode == Opcode::LoadLocal &&
                    source_load.opcode == Opcode::LoadF64LocalsIndex &&
                    destination_store.opcode == Opcode::StoreF64LocalsIndex &&
                    increment_index.opcode == Opcode::LoadLocal &&
                    one.opcode == Opcode::PushF64 && one.f64 == 1.0 &&
                    add.opcode == Opcode::AddF64 &&
                    increment_store.opcode == Opcode::StoreLocal &&
                    repeat.opcode == Opcode::Jump && repeat.label == instruction.label &&
                    exit_label.opcode == Opcode::Label && exit_label.label == exit.label &&
                    guard_index.index == store_index.index &&
                    guard_index.index == source_index.index &&
                    guard_index.index == increment_index.index &&
                    guard_index.index == increment_store.index &&
                    source_load.index_local && *source_load.index_local == guard_index.index &&
                    destination_store.index_local &&
                    *destination_store.index_local == guard_index.index &&
                    static_cast<std::uint32_t>(bound.f64) <= source_load.argument_count &&
                    static_cast<std::uint32_t>(bound.f64) <= destination_store.argument_count;
                if (fixed_copy) {
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate integer x64 label");
                    }
                    const auto width = static_cast<std::uint32_t>(bound.f64);
                    for (std::uint32_t offset = 0; offset < width; ++offset) {
                        code_.raw({0x48, 0x8b, 0x85});
                        code_.i32(frame.displacement(source_load.index + offset));
                        code_.raw({0x48, 0x89, 0x85});
                        code_.i32(frame.displacement(destination_store.index + offset));
                    }
                    code_.raw({0x49, 0xba});
                    code_.u64(static_cast<std::uint64_t>(bound.f64));
                    store_local_integer(guard_index.index, 10);
                    instruction_index += 13;
                    continue;
                }
            }
            if (instruction.opcode == Opcode::Label &&
                instruction_index + 16 < function.instructions.size()) {
                const auto& guard_index = function.instructions[instruction_index + 1];
                const auto& bound = function.instructions[instruction_index + 2];
                const auto& less = function.instructions[instruction_index + 3];
                const auto& exit = function.instructions[instruction_index + 4];
                const auto& destination_index = function.instructions[instruction_index + 5];
                const auto& source_index = function.instructions[instruction_index + 6];
                const auto& source_offset = function.instructions[instruction_index + 7];
                const auto& source_add = function.instructions[instruction_index + 8];
                const auto& source_load = function.instructions[instruction_index + 9];
                const auto& destination_store = function.instructions[instruction_index + 10];
                const auto& increment_index = function.instructions[instruction_index + 11];
                const auto& increment_one = function.instructions[instruction_index + 12];
                const auto& increment_add = function.instructions[instruction_index + 13];
                const auto& increment_store = function.instructions[instruction_index + 14];
                const auto& repeat = function.instructions[instruction_index + 15];
                const auto& exit_label = function.instructions[instruction_index + 16];
                const auto proof = guarded_index_loops.find(instruction.label);
                const bool bounded_left_shift = stack_depth == 0 &&
                    proof != guarded_index_loops.end() &&
                    guard_index.opcode == Opcode::LoadLocal &&
                    bound.opcode == Opcode::LoadLocal &&
                    less.opcode == Opcode::OrderedLessF64 &&
                    exit.opcode == Opcode::JumpIfFalse &&
                    destination_index.opcode == Opcode::LoadLocal &&
                    source_index.opcode == Opcode::LoadLocal &&
                    source_offset.opcode == Opcode::PushF64 && source_offset.f64 == 1.0 &&
                    source_add.opcode == Opcode::AddF64 &&
                    source_load.opcode == Opcode::LoadF64LocalsIndex &&
                    destination_store.opcode == Opcode::StoreF64LocalsIndex &&
                    increment_index.opcode == Opcode::LoadLocal &&
                    increment_one.opcode == Opcode::PushF64 && increment_one.f64 == 1.0 &&
                    increment_add.opcode == Opcode::AddF64 &&
                    increment_store.opcode == Opcode::StoreLocal &&
                    repeat.opcode == Opcode::Jump && repeat.label == instruction.label &&
                    exit_label.opcode == Opcode::Label && exit_label.label == exit.label &&
                    guard_index.index == destination_index.index &&
                    guard_index.index == source_index.index &&
                    guard_index.index == increment_index.index &&
                    guard_index.index == increment_store.index &&
                    proof->second.bound_local == bound.index &&
                    source_load.argument_count > 0 &&
                    guarded_index_access[instruction_index + 9] &&
                    guarded_index_access[instruction_index + 10] &&
                    destination_store.index_local &&
                    *destination_store.index_local == guard_index.index &&
                    !source_load.index_local;
                if (bounded_left_shift) {
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate integer x64 label");
                    }
                    load_local_integer(bound.index, 11);
                    code_.raw({0x4d, 0x85, 0xdb});
                    branches.push_back({emit_jump(0x8e), exit.label});
                    store_local_integer(guard_index.index, 11);
                    const auto maximum_bound = proof->second.maximum_bound;
                    for (std::uint32_t offset = 0; offset < maximum_bound; ++offset) {
                        code_.raw({0x4c, 0x8b, 0x95});
                        code_.i32(frame.displacement(source_load.index + offset + 1));
                        code_.raw({0x4c, 0x89, 0x95});
                        code_.i32(frame.displacement(destination_store.index + offset));
                        code_.raw({0x49, 0x81, 0xfb});
                        code_.i32(static_cast<std::int32_t>(offset + 1));
                        branches.push_back({emit_jump(0x8e), exit.label});
                    }
                    instruction_index += 15;
                    continue;
                }
            }
            if (policy_.parity_specialization && stack_depth == 0 &&
                instruction_index + 5 < function.instructions.size()) {
                const auto& dividend = function.instructions[instruction_index];
                const auto& divisor = function.instructions[instruction_index + 1];
                const auto& remainder = function.instructions[instruction_index + 2];
                const auto& zero = function.instructions[instruction_index + 3];
                const auto& comparison = function.instructions[instruction_index + 4];
                const auto& branch = function.instructions[instruction_index + 5];
                const auto divisor_value = divisor.opcode == Opcode::PushF64
                    ? static_cast<std::int64_t>(divisor.f64) : 0;
                const auto absolute_divisor = divisor_value < 0
                    ? -divisor_value : divisor_value;
                const bool power_of_two = absolute_divisor > 0 &&
                    absolute_divisor <= 256 &&
                    (absolute_divisor & (absolute_divisor - 1)) == 0 &&
                    divisor.f64 == static_cast<double>(divisor_value);
                const bool supported_comparison =
                    comparison.opcode == Opcode::OrderedEqualF64 ||
                    comparison.opcode == Opcode::UnorderedNotEqualF64;
                const bool supported_branch = branch.opcode == Opcode::JumpIfFalse ||
                    branch.opcode == Opcode::JumpIfTrue;
                if (dividend.opcode == Opcode::LoadLocal &&
                    dividend.index < function.local_classes.size() &&
                    function.local_classes[dividend.index] ==
                        vkf::machine_ir::ValueClass::I64 &&
                    power_of_two && remainder.opcode == Opcode::RemainderF64 &&
                    zero.opcode == Opcode::PushF64 && zero.f64 == 0.0 &&
                    supported_comparison && supported_branch) {
                    load_local_integer(dividend.index, 10);
                    // test r10b, 2^n-1. Divisibility by a power of two depends
                    // only on these low bits, including for signed integers.
                    code_.raw({0x41, 0xf6, 0xc2,
                               static_cast<unsigned>(absolute_divisor - 1)});
                    const bool result_when_zero =
                        comparison.opcode == Opcode::OrderedEqualF64;
                    const bool branch_on_result = branch.opcode == Opcode::JumpIfTrue;
                    const bool branch_when_zero = result_when_zero == branch_on_result;
                    branches.push_back({
                        emit_jump(branch_when_zero ? 0x84 : 0x85), branch.label
                    });
                    instruction_index += 5;
                    continue;
                }
            }
            if (stack_depth == 0 && instruction_index + 3 <
                    function.instructions.size()) {
                const auto& left = function.instructions[instruction_index];
                const auto& right = function.instructions[instruction_index + 1];
                const auto& comparison = function.instructions[instruction_index + 2];
                const auto& branch = function.instructions[instruction_index + 3];
                const auto integral_operand = [&](
                    const vkf::machine_ir::Instruction& operand) {
                    if (operand.opcode == Opcode::LoadLocal) {
                        return operand.index < function.local_classes.size() &&
                            function.local_classes[operand.index] ==
                                vkf::machine_ir::ValueClass::I64;
                    }
                    if (operand.opcode != Opcode::PushF64 ||
                        !std::isfinite(operand.f64) ||
                        operand.f64 != std::floor(operand.f64)) {
                        return false;
                    }
                    constexpr double minimum = -9223372036854775808.0;
                    constexpr double maximum_exclusive = 9223372036854775808.0;
                    return operand.f64 >= minimum && operand.f64 < maximum_exclusive;
                };
                const bool supported_comparison =
                    comparison.opcode == Opcode::OrderedLessF64 ||
                    comparison.opcode == Opcode::OrderedLessEqualF64 ||
                    comparison.opcode == Opcode::OrderedGreaterF64 ||
                    comparison.opcode == Opcode::OrderedGreaterEqualF64 ||
                    comparison.opcode == Opcode::OrderedEqualF64 ||
                    comparison.opcode == Opcode::UnorderedNotEqualF64 ||
                    comparison.opcode == Opcode::EqualBits ||
                    comparison.opcode == Opcode::NotEqualBits;
                const bool supported_branch = branch.opcode == Opcode::JumpIfFalse ||
                    branch.opcode == Opcode::JumpIfTrue;
                if (integral_operand(left) && integral_operand(right) &&
                    supported_comparison && supported_branch) {
                    const auto load_operand = [&](
                        const vkf::machine_ir::Instruction& operand,
                        unsigned destination) {
                        if (operand.opcode == Opcode::LoadLocal) {
                            load_local_integer(operand.index, destination);
                        } else {
                            code_.raw({static_cast<unsigned>(0x48u |
                                           (destination >= 8u ? 0x01u : 0u)),
                                       static_cast<unsigned>(0xb8u + (destination & 7u))});
                            code_.u64(static_cast<std::uint64_t>(
                                static_cast<std::int64_t>(operand.f64)));
                        }
                    };
                    load_operand(left, 10);
                    load_operand(right, 11);
                    code_.raw({0x4d, 0x3b, 0xd3});  // cmp r10, r11
                    unsigned condition = comparison.opcode == Opcode::OrderedLessF64 ? 0x8c
                        : comparison.opcode == Opcode::OrderedLessEqualF64 ? 0x8e
                        : comparison.opcode == Opcode::OrderedGreaterF64 ? 0x8f
                        : comparison.opcode == Opcode::OrderedGreaterEqualF64 ? 0x8d
                        : comparison.opcode == Opcode::OrderedEqualF64 ||
                            comparison.opcode == Opcode::EqualBits ? 0x84 : 0x85;
                    if (branch.opcode == Opcode::JumpIfFalse) {
                        condition = condition == 0x8c ? 0x8d
                            : condition == 0x8e ? 0x8f
                            : condition == 0x8f ? 0x8e
                            : condition == 0x8d ? 0x8c
                            : condition == 0x84 ? 0x85 : 0x84;
                    }
                    branches.push_back({emit_jump(condition), branch.label});
                    instruction_index += 3;
                    continue;
                }
            }
            switch (instruction.opcode) {
                case Opcode::PushF64:
                    {
                    const auto destination = stack_register(stack_depth).value_or(10u);
                    code_.raw({static_cast<unsigned>(0x48u |
                                   (destination >= 8 ? 0x01u : 0u)),
                               static_cast<unsigned>(0xb8u + (destination & 7u))});
                    code_.u64(static_cast<std::uint64_t>(
                        static_cast<std::int64_t>(instruction.f64)));
                    store_stack(stack_depth++, destination);
                    break;
                    }
                case Opcode::LoadLocal:
                    {
                    const auto destination = stack_register(stack_depth).value_or(10u);
                    load_local_integer(instruction.index, destination);
                    store_stack(stack_depth++, destination);
                    break;
                    }
                case Opcode::StoreLocal:
                    if (stack_depth == 0) throw BackendFailure("integer x64 stack underflow");
                    {
                    const unsigned slot = --stack_depth;
                    const auto source = stack_register(slot).value_or(10u);
                    load_stack(slot, source);
                    store_local_integer(instruction.index, source);
                    break;
                    }
                case Opcode::Duplicate:
                    if (stack_depth == 0) throw BackendFailure("integer x64 stack underflow");
                    {
                    const auto destination = stack_register(stack_depth).value_or(10u);
                    load_stack(stack_depth - 1, destination);
                    store_stack(stack_depth++, destination);
                    break;
                    }
                case Opcode::Drop:
                    if (stack_depth == 0) throw BackendFailure("integer x64 stack underflow");
                    --stack_depth;
                    break;
                case Opcode::IdentityF64:
                    break;
                case Opcode::NegateF64:
                    if (stack_depth == 0) throw BackendFailure("integer x64 stack underflow");
                    {
                    const auto target = stack_register(stack_depth - 1).value_or(10u);
                    load_stack(stack_depth - 1, target);
                    code_.raw({static_cast<unsigned>(0x48u | (target >= 8 ? 1u : 0u)),
                               0xf7, static_cast<unsigned>(0xd8u + (target & 7u))});
                    store_stack(stack_depth - 1, target);
                    break;
                    }
                case Opcode::LogicalNotF64:
                case Opcode::BooleanizeF64:
                    if (stack_depth == 0) throw BackendFailure("integer x64 stack underflow");
                    {
                    const auto target = stack_register(stack_depth - 1).value_or(10u);
                    load_stack(stack_depth - 1, target);
                    const unsigned rex = 0x48u | (target >= 8 ? 5u : 0u);
                    code_.raw({rex, 0x85,
                               static_cast<unsigned>(0xc0u + (target & 7u) * 9u),
                               static_cast<unsigned>(target >= 8 ? 0x41u : 0u)});
                    if (target < 8) code_.bytes.pop_back();
                    code_.raw({0x0f,
                               instruction.opcode == Opcode::LogicalNotF64 ? 0x94u : 0x95u,
                               static_cast<unsigned>(0xc0u + (target & 7u))});
                    if (target >= 8) code_.byte(0x45);
                    code_.raw({0x0f, 0xb6,
                               static_cast<unsigned>(0xc0u + (target & 7u) * 9u)});
                    store_stack(stack_depth - 1, target);
                    break;
                    }
                case Opcode::AddF64:
                case Opcode::SubtractF64:
                case Opcode::MultiplyF64:
                case Opcode::FloorDivideF64:
                case Opcode::RemainderF64: {
                    if (stack_depth < 2) throw BackendFailure("integer x64 stack underflow");
                    const unsigned right_slot = --stack_depth;
                    const unsigned left_slot = stack_depth - 1;
                    const auto left = stack_register(left_slot).value_or(10u);
                    const auto right = stack_register(right_slot).value_or(11u);
                    load_stack(left_slot, left);
                    load_stack(right_slot, right);
                    const unsigned rex = 0x48u | (left >= 8 ? 4u : 0u) |
                        (right >= 8 ? 1u : 0u);
                    if (instruction.opcode == Opcode::AddF64) {
                        code_.raw({rex, 0x03,
                                   static_cast<unsigned>(0xc0u + (left & 7u) * 8u + (right & 7u))});
                    } else if (instruction.opcode == Opcode::SubtractF64) {
                        code_.raw({rex, 0x2b,
                                   static_cast<unsigned>(0xc0u + (left & 7u) * 8u + (right & 7u))});
                    } else if (instruction.opcode == Opcode::MultiplyF64) {
                        code_.raw({rex, 0x0f, 0xaf,
                                   static_cast<unsigned>(0xc0u + (left & 7u) * 8u + (right & 7u))});
                    }
                    else {
                        move_register(0, left);
                        move_register(1, right);
                        code_.raw({0x48, 0x99, 0x48, 0xf7, 0xf9});
                        move_register(left, instruction.opcode == Opcode::RemainderF64 ? 2u : 0u);
                    }
                    store_stack(left_slot, left);
                    break;
                }
                case Opcode::OrderedLessF64:
                case Opcode::OrderedLessEqualF64:
                case Opcode::OrderedGreaterF64:
                case Opcode::OrderedGreaterEqualF64:
                case Opcode::OrderedEqualF64:
                case Opcode::UnorderedNotEqualF64:
                case Opcode::EqualBits:
                case Opcode::NotEqualBits: {
                    if (stack_depth < 2) throw BackendFailure("integer x64 stack underflow");
                    const unsigned right_slot = --stack_depth;
                    const unsigned left_slot = stack_depth - 1;
                    const auto left = stack_register(left_slot).value_or(10u);
                    const auto right = stack_register(right_slot).value_or(11u);
                    load_stack(left_slot, left);
                    load_stack(right_slot, right);
                    code_.raw({static_cast<unsigned>(0x48u | (left >= 8 ? 4u : 0u) |
                                                   (right >= 8 ? 1u : 0u)),
                               0x3b,
                               static_cast<unsigned>(0xc0u + (left & 7u) * 8u + (right & 7u))});
                    const unsigned condition = instruction.opcode == Opcode::OrderedLessF64 ? 0x9c
                        : instruction.opcode == Opcode::OrderedLessEqualF64 ? 0x9e
                        : instruction.opcode == Opcode::OrderedGreaterF64 ? 0x9f
                        : instruction.opcode == Opcode::OrderedGreaterEqualF64 ? 0x9d
                        : instruction.opcode == Opcode::OrderedEqualF64 ||
                            instruction.opcode == Opcode::EqualBits ? 0x94 : 0x95;
                    if (left >= 8) code_.byte(0x41);
                    code_.raw({0x0f, condition,
                               static_cast<unsigned>(0xc0u + (left & 7u))});
                    if (left >= 8) code_.byte(0x45);
                    code_.raw({0x0f, 0xb6,
                               static_cast<unsigned>(0xc0u + (left & 7u) * 9u)});
                    store_stack(left_slot, left);
                    break;
                }
                case Opcode::LoadF64LocalsIndex: {
                    if (stack_depth == 0) throw BackendFailure("integer x64 stack underflow");
                    const unsigned slot = stack_depth - 1;
                    const auto destination = stack_register(slot).value_or(10u);
                    load_stack(slot, destination);
                    move_register(11, destination);
                    std::vector<std::size_t> invalid;
                    if (!guarded_index_access[instruction_index]) {
                        code_.raw({0x4d, 0x85, 0xdb});
                        invalid.push_back(emit_jump(0x88));
                        code_.raw({0x49, 0x81, 0xfb});
                        code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                        invalid.push_back(emit_jump(0x83));
                    }
                    code_.raw({0x4c, 0x8d, 0x95});
                    code_.i32(frame.displacement(instruction.index));
                    code_.raw({0x49, 0xf7, 0xdb,
                               static_cast<unsigned>(0x4bu | (destination >= 8 ? 4u : 0u)),
                               0x8b,
                               static_cast<unsigned>(0x04u + (destination & 7u) * 8u),
                               0xda});
                    store_stack(slot, destination);
                    if (!invalid.empty()) queue_index_error(instruction, invalid);
                    break;
                }
                case Opcode::StoreF64LocalsIndex: {
                    if (stack_depth < 2) throw BackendFailure("integer x64 stack underflow");
                    const unsigned value_slot = --stack_depth;
                    const unsigned index_slot = --stack_depth;
                    const auto value = stack_register(value_slot).value_or(10u);
                    const auto index = stack_register(index_slot).value_or(11u);
                    load_stack(value_slot, value);
                    load_stack(index_slot, index);
                    move_register(11, index);
                    std::vector<std::size_t> invalid;
                    if (!guarded_index_access[instruction_index]) {
                        code_.raw({0x4d, 0x85, 0xdb});
                        invalid.push_back(emit_jump(0x88));
                        code_.raw({0x49, 0x81, 0xfb});
                        code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                        invalid.push_back(emit_jump(0x83));
                    }
                    code_.raw({0x4c, 0x8d, 0x95});
                    code_.i32(frame.displacement(instruction.index));
                    code_.raw({0x49, 0xf7, 0xdb,
                               static_cast<unsigned>(0x4bu | (value >= 8 ? 4u : 0u)),
                               0x89,
                               static_cast<unsigned>(0x04u + (value & 7u) * 8u),
                               0xda});
                    if (!invalid.empty()) queue_index_error(instruction, invalid);
                    break;
                }
                case Opcode::Label:
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate integer x64 label");
                    }
                    break;
                case Opcode::Jump:
                    code_.byte(0xe9);
                    branches.push_back({code_.rel32_placeholder(), instruction.label});
                    break;
                case Opcode::JumpIfFalse:
                case Opcode::JumpIfTrue:
                    if (stack_depth == 0) throw BackendFailure("integer x64 stack underflow");
                    {
                    const unsigned slot = --stack_depth;
                    const auto condition = stack_register(slot).value_or(10u);
                    load_stack(slot, condition);
                    code_.raw({static_cast<unsigned>(0x48u | (condition >= 8 ? 5u : 0u)),
                               0x85,
                               static_cast<unsigned>(0xc0u + (condition & 7u) * 9u)});
                    branches.push_back({
                        emit_jump(instruction.opcode == Opcode::JumpIfTrue ? 0x85 : 0x84),
                        instruction.label
                    });
                    break;
                    }
                case Opcode::ReturnF64:
                    if (stack_depth == 0) throw BackendFailure("integer x64 stack underflow");
                    {
                    const unsigned slot = --stack_depth;
                    const auto source = stack_register(slot).value_or(10u);
                    load_stack(slot, source);
                    code_.raw({0xf2,
                               static_cast<unsigned>(0x48u | (source >= 8 ? 1u : 0u)),
                               0x0f, 0x2a,
                               static_cast<unsigned>(0xc0u + (source & 7u))});
                    restore_result_context(frame);
                    store_result_to_r11(0);
                    if (function.may_error) code_.raw({0x45, 0x31, 0xc9});
                    epilogue();
                    break;
                    }
                case Opcode::ReturnValues:
                    throw BackendFailure("integer x64 aggregate return is unsupported");
                default:
                    throw BackendFailure("unhandled integer x64 opcode");
            }
            if (stack_depth > frame.max_stack) {
                throw BackendFailure("integer x64 stack exceeds frame");
            }
        }
        for (const auto& branch : branches) {
            const auto found = labels.find(branch.label);
            if (found == labels.end()) throw BackendFailure("unknown integer x64 label");
            code_.patch_rel32(branch.at, found->second);
        }
        if (shared_index_error) {
            const auto abort = code_.position();
            for (const auto patch : shared_index_error_patches) {
                code_.patch_rel32(patch, abort);
            }
            emit_error_cleanup(function, frame);
            emit_error_message_registers(
                shared_index_error->error_message_offset,
                shared_index_error->byte_count);
            code_.raw({0x41, 0xb9});
            code_.i32(vkf::machine_ir::index_error_mask);
            epilogue();
        }
        if (stack_depth != 0) throw BackendFailure("unbalanced integer x64 stack");
    }

    void emit_function(const vkf::machine_ir::Function& function, bool entry) {
        const Frame frame = make_frame(function, entry);
        if (!entry && policy_.integer_function_tier &&
            is_integer_function_candidate(function)) {
            emit_integer_function(function, frame);
            return;
        }
        std::map<std::uint32_t, std::size_t> label_positions;
        for (std::size_t position = 0; position < function.instructions.size(); ++position) {
            if (function.instructions[position].opcode ==
                vkf::machine_ir::Opcode::Label) {
                label_positions.emplace(function.instructions[position].label, position);
            }
        }
        std::set<std::uint32_t> loop_header_labels;
        for (std::size_t position = 0; position < function.instructions.size(); ++position) {
            const auto& candidate = function.instructions[position];
            if (candidate.opcode != vkf::machine_ir::Opcode::Jump &&
                candidate.opcode != vkf::machine_ir::Opcode::JumpIfFalse &&
                candidate.opcode != vkf::machine_ir::Opcode::JumpIfTrue) continue;
            const auto target = label_positions.find(candidate.label);
            if (target != label_positions.end() && target->second < position) {
                loop_header_labels.insert(candidate.label);
            }
        }
        const auto align_loop_header = [&](std::uint32_t label) {
            if (loop_header_labels.find(label) != loop_header_labels.end()) {
                code_.align(16u);
            }
        };
        const auto parameter_count = static_cast<unsigned>(function.parameters.size());
        const auto borrowing_safe_opcode = [](vkf::machine_ir::Opcode opcode) {
            using vkf::machine_ir::Opcode;
            switch (opcode) {
                case Opcode::PushF64:
                case Opcode::LoadLocal:
                case Opcode::StoreLocal:
                case Opcode::Drop:
                case Opcode::Duplicate:
                case Opcode::IdentityF64:
                case Opcode::NegateF64:
                case Opcode::LogicalNotF64:
                case Opcode::BooleanizeF64:
                case Opcode::AddF64:
                case Opcode::SubtractF64:
                case Opcode::MultiplyF64:
                case Opcode::DivideF64:
                case Opcode::AbsF64:
                case Opcode::SqrtF64:
                case Opcode::LogicalXorF64:
                case Opcode::OrderedLessF64:
                case Opcode::OrderedLessEqualF64:
                case Opcode::OrderedGreaterF64:
                case Opcode::OrderedGreaterEqualF64:
                case Opcode::OrderedEqualF64:
                case Opcode::UnorderedNotEqualF64:
                case Opcode::EqualBits:
                case Opcode::NotEqualBits:
                case Opcode::SumF64Values:
                case Opcode::MeanF64Values:
                case Opcode::VarianceF64Values:
                case Opcode::StdDevF64Values:
                case Opcode::RangeF64Values:
                case Opcode::CountValues:
                case Opcode::SumF64Locals:
                case Opcode::MeanF64Locals:
                case Opcode::VarianceF64Locals:
                case Opcode::StdDevF64Locals:
                case Opcode::RangeF64Locals:
                case Opcode::CountLocalValues:
                case Opcode::LoadF64LocalsIndex:
                case Opcode::StoreF64LocalsIndex:
                case Opcode::Label:
                case Opcode::Jump:
                case Opcode::JumpIfFalse:
                case Opcode::JumpIfTrue:
                case Opcode::JumpIfParameterProvided:
                case Opcode::ReturnF64:
                case Opcode::ReturnValues:
                    return true;
                default:
                    return false;
            }
        };
        const bool borrow_aggregate_parameters =
            policy_.borrowed_aggregate_parameters && !entry && !function.may_error &&
            parameter_count >= 8u &&
            parameter_count <= function.local_classes.size() &&
            std::all_of(
                function.local_classes.begin(),
                function.local_classes.begin() + static_cast<std::ptrdiff_t>(parameter_count),
                [](const auto value_class) {
                    return value_class == vkf::machine_ir::ValueClass::F64;
                }) &&
            std::none_of(
                function.instructions.begin(), function.instructions.end(),
                [parameter_count, &borrowing_safe_opcode](const auto& instruction) {
                    using vkf::machine_ir::Opcode;
                    if (!borrowing_safe_opcode(instruction.opcode)) return true;
                    if (instruction.opcode == Opcode::Call) return true;
                    if (instruction.opcode == Opcode::StoreLocal) {
                        return instruction.index < parameter_count;
                    }
                    return instruction.opcode == Opcode::StoreF64LocalsIndex &&
                        instruction.index < parameter_count;
                });
        const bool has_avx_affine_loop = policy_.avx_affine_loops && [&]() {
            for (std::size_t index = 0; index < function.instructions.size(); ++index) {
                if (detect_avx_affine_loop(function, index)) return true;
            }
            return false;
        }();
        const bool has_scalar_recurrence_loop = [&]() {
            for (std::size_t index = 0; index < function.instructions.size(); ++index) {
                if (detect_scalar_recurrence_loop(function, index)) return true;
            }
            return false;
        }();
        const bool has_packed_reduction_loop = [&]() {
            for (std::size_t index = 0; index < function.instructions.size(); ++index) {
                if (detect_packed_matrix_reduction_loop(function, index) ||
                    detect_packed_dot_reduction_loop(function, index)) return true;
            }
            return false;
        }();
        const bool terminal_error_only = function.may_error &&
            function.owned_f64_list_locals.empty() &&
            function.owned_string_locals.empty() &&
            std::none_of(
                function.instructions.begin(), function.instructions.end(),
                [](const auto& instruction) {
                    return instruction.has_error_handler;
                });
        const auto register_cache_safe = [&]() {
            if (!policy_.register_cache || entry ||
                (function.may_error && !terminal_error_only) ||
                function.locals.empty() || has_avx_affine_loop ||
                has_scalar_recurrence_loop || has_packed_reduction_loop) {
                return false;
            }
            using vkf::machine_ir::Opcode;
            return std::all_of(
                function.instructions.begin(), function.instructions.end(),
                [](const auto& instruction) {
                    switch (instruction.opcode) {
                        case Opcode::PushF64:
                        case Opcode::LoadLocal:
                        case Opcode::StoreLocal:
                        case Opcode::Drop:
                        case Opcode::Duplicate:
                        case Opcode::IdentityF64:
                        case Opcode::NegateF64:
                        case Opcode::LogicalNotF64:
                        case Opcode::BooleanizeF64:
                        case Opcode::AddF64:
                        case Opcode::SubtractF64:
                        case Opcode::MultiplyF64:
                        case Opcode::DivideF64:
                        case Opcode::RemainderF64:
                        case Opcode::SqrtF64:
                        case Opcode::OrderedLessF64:
                        case Opcode::OrderedLessEqualF64:
                        case Opcode::OrderedGreaterF64:
                        case Opcode::OrderedGreaterEqualF64:
                        case Opcode::OrderedEqualF64:
                        case Opcode::UnorderedNotEqualF64:
                        case Opcode::EqualBits:
                        case Opcode::NotEqualBits:
                        case Opcode::LoadF64LocalsIndex:
                        case Opcode::StoreF64LocalsIndex:
                        case Opcode::Label:
                        case Opcode::Jump:
                        case Opcode::JumpIfFalse:
                        case Opcode::JumpIfTrue:
                        case Opcode::Call:
                        case Opcode::ReturnF64:
                        case Opcode::ReturnValues:
                            return true;
                        default:
                            return false;
                    }
                });
        }();
        std::vector<int> local_register(frame.local_count, -1);
        std::vector<int> integer_register(frame.local_count, -1);
        if (function.local_classes.size() != function.locals.size()) {
            throw BackendFailure("x64 machine IR local class table mismatch");
        }
        const auto semantically_i64 = [&](unsigned local) {
            return local < function.local_classes.size() &&
                function.local_classes[local] == vkf::machine_ir::ValueClass::I64;
        };
        std::vector<bool> native_i64_local(frame.local_count, false);
        for (unsigned local = 0; local < frame.local_count; ++local) {
            native_i64_local[local] = policy_.native_integer_locals && semantically_i64(local);
        }
        const auto local_is_i64 = [&](unsigned local) {
            return local < native_i64_local.size() && native_i64_local[local];
        };
        const auto fixed_range_is_i64 = [&](unsigned base, unsigned width) {
            if (base > native_i64_local.size() ||
                width > native_i64_local.size() - base) return false;
            return std::all_of(
                native_i64_local.begin() + base,
                native_i64_local.begin() + base + width,
                [](bool value) { return value; });
        };
        if (register_cache_safe) {
            const bool has_implicit_runtime_call = std::any_of(
                function.instructions.begin(), function.instructions.end(),
                [](const auto& instruction) {
                    return instruction.opcode == vkf::machine_ir::Opcode::RemainderF64;
                });
            std::vector<bool> indexed_storage(frame.local_count, false);
            std::vector<bool> indexed_address_local(frame.local_count, false);
            for (const auto& instruction : function.instructions) {
                if (instruction.opcode != vkf::machine_ir::Opcode::LoadF64LocalsIndex &&
                    instruction.opcode != vkf::machine_ir::Opcode::StoreF64LocalsIndex) {
                    continue;
                }
                if (instruction.index_local &&
                    *instruction.index_local < indexed_address_local.size()) {
                    indexed_address_local[*instruction.index_local] = true;
                }
                const auto end = std::min<std::size_t>(
                    frame.local_count,
                    static_cast<std::size_t>(instruction.index) + instruction.argument_count);
                for (std::size_t local = instruction.index; local < end; ++local) {
                    indexed_storage[local] = true;
                }
            }
            std::vector<std::pair<unsigned, unsigned>> frequency;
            frequency.reserve(frame.local_count);
            const auto local_crosses_call = [&](unsigned local) {
                std::size_t first = function.instructions.size();
                std::size_t last = 0;
                for (std::size_t position = 0;
                     position < function.instructions.size(); ++position) {
                    const auto& instruction = function.instructions[position];
                    const bool direct =
                        (instruction.opcode == vkf::machine_ir::Opcode::LoadLocal ||
                         instruction.opcode == vkf::machine_ir::Opcode::StoreLocal) &&
                        instruction.index == local;
                    const bool indexed = instruction.index_local &&
                        *instruction.index_local == local;
                    if (!direct && !indexed) continue;
                    first = std::min(first, position);
                    last = std::max(last, position);
                }
                if (first == function.instructions.size()) return false;
                return std::any_of(
                    function.instructions.begin() + static_cast<std::ptrdiff_t>(first),
                    function.instructions.begin() + static_cast<std::ptrdiff_t>(last + 1u),
                    [](const auto& instruction) {
                        return instruction.opcode == vkf::machine_ir::Opcode::Call;
                    });
            };
            std::map<std::uint32_t, std::size_t> cache_label_positions;
            for (std::size_t position = 0; position < function.instructions.size(); ++position) {
                if (function.instructions[position].opcode ==
                    vkf::machine_ir::Opcode::Label) {
                    cache_label_positions.emplace(
                        function.instructions[position].label, position);
                }
            }
            std::vector<std::pair<std::size_t, std::size_t>> cache_loops;
            for (std::size_t position = 0; position < function.instructions.size(); ++position) {
                const auto& instruction = function.instructions[position];
                if (instruction.opcode != vkf::machine_ir::Opcode::Jump) continue;
                const auto target = cache_label_positions.find(instruction.label);
                if (target != cache_label_positions.end() && target->second < position) {
                    cache_loops.emplace_back(target->second, position);
                }
            }
            for (unsigned local = 0; local < frame.local_count; ++local) {
                if (has_implicit_runtime_call || local_is_i64(local) ||
                    indexed_storage[local] || indexed_address_local[local] ||
                    local_crosses_call(local)) {
                    continue;
                }
                unsigned count = 0;
                for (std::size_t position = 0;
                     position < function.instructions.size(); ++position) {
                    const auto& instruction = function.instructions[position];
                    if ((instruction.opcode != vkf::machine_ir::Opcode::LoadLocal &&
                         instruction.opcode != vkf::machine_ir::Opcode::StoreLocal) ||
                        instruction.index != local) {
                        continue;
                    }
                    const auto depth = static_cast<unsigned>(std::count_if(
                        cache_loops.begin(), cache_loops.end(),
                        [position](const auto& loop) {
                            return position >= loop.first && position <= loop.second;
                        }));
                    count += 1u << std::min(depth * 3u, 15u);
                }
                if (count != 0) frequency.emplace_back(count, local);
            }
            std::sort(frequency.begin(), frequency.end(), [](const auto& left, const auto& right) {
                return left.first != right.first ? left.first > right.first : left.second < right.second;
            });
            // Windows preserves xmm6/xmm7 in the emitted frame. SysV lowering
            // reserves xmm0..xmm7 for expressions and scratch; cache call-free
            // numeric locals in its eight remaining caller-saved registers.
#ifdef _WIN32
            constexpr unsigned available[] = {6, 7};
#else
            constexpr unsigned available[] = {8, 9, 10, 11, 12, 13, 14, 15};
#endif
            for (unsigned index = 0;
                 index < frequency.size() && index < std::size(available); ++index) {
                local_register[frequency[index].second] = static_cast<int>(available[index]);
            }
            frequency.clear();
            for (unsigned local = 0; local < frame.local_count; ++local) {
                if (has_implicit_runtime_call || !local_is_i64(local) ||
                    indexed_storage[local] || local_crosses_call(local)) continue;
                unsigned count = 0;
                for (std::size_t position = 0;
                     position < function.instructions.size(); ++position) {
                    const auto& instruction = function.instructions[position];
                    if ((instruction.opcode != vkf::machine_ir::Opcode::LoadLocal &&
                         instruction.opcode != vkf::machine_ir::Opcode::StoreLocal) ||
                        instruction.index != local) {
                        continue;
                    }
                    const auto depth = static_cast<unsigned>(std::count_if(
                        cache_loops.begin(), cache_loops.end(),
                        [position](const auto& loop) {
                            return position >= loop.first && position <= loop.second;
                        }));
                    count += 1u << std::min(depth * 3u, 15u);
                }
                if (count != 0) frequency.emplace_back(count, local);
            }
            std::sort(frequency.begin(), frequency.end(), [](const auto& left, const auto& right) {
                return left.first != right.first ? left.first > right.first : left.second < right.second;
            });
            constexpr unsigned integer_available[] = {13, 14, 15};
            for (unsigned index = 0;
                 index < frequency.size() && index < std::size(integer_available); ++index) {
                integer_register[frequency[index].second] =
                    static_cast<int>(integer_available[index]);
            }
        }
        const auto move_xmm = [&](unsigned destination, unsigned source) {
            if (destination > 15 || source > 15) {
                throw BackendFailure("invalid cached x64 xmm move");
            }
            code_.byte(0x66);
            if (destination >= 8 || source >= 8) {
                code_.byte(static_cast<unsigned>(
                    0x40u | (destination >= 8 ? 0x04u : 0u) |
                    (source >= 8 ? 0x01u : 0u)));
            }
            code_.raw({
                0x0f, 0x28,
                static_cast<unsigned>(
                    0xc0u + (destination & 7u) * 8u + (source & 7u))
            });
        };
        const auto load_local = [&](unsigned local, unsigned destination) {
            if (local >= frame.local_count || destination > 7) {
                throw BackendFailure("invalid cached x64 local load");
            }
            if (local_is_i64(local)) {
                const int cached = integer_register[local];
                if (cached < 0) {
                    code_.raw({0x48, 0x8b, 0x85});
                    code_.i32(frame.displacement(local));
                    code_.raw({0xf2, 0x48, 0x0f, 0x2a,
                               static_cast<unsigned>(0xc0 + destination * 8)});
                } else {
                    code_.raw({0xf2, 0x49, 0x0f, 0x2a,
                               static_cast<unsigned>(
                                   0xc0 + destination * 8 + (cached & 7))});
                }
                return;
            }
            if (borrow_aggregate_parameters && local < parameter_count) {
                code_.raw({0xf2, 0x41, 0x0f, 0x10,
                           static_cast<unsigned>(0x82 + destination * 8)});
                code_.i32(-static_cast<std::int32_t>(local * 8u));
                return;
            }
            const int source = local_register[local];
            if (source < 0) load_xmm(destination, frame.displacement(local));
            else if (static_cast<unsigned>(source) != destination) {
                move_xmm(destination, static_cast<unsigned>(source));
            }
        };
        const auto store_local = [&](unsigned local, unsigned source) {
            if (local >= frame.local_count || source > 7) {
                throw BackendFailure("invalid cached x64 local store");
            }
            if (local_is_i64(local)) {
                const int cached = integer_register[local];
                if (cached < 0) {
                    code_.raw({0xf2, 0x48, 0x0f, 0x2c,
                               static_cast<unsigned>(0xc0 + source)});
                    code_.raw({0x48, 0x89, 0x85});
                    code_.i32(frame.displacement(local));
                } else {
                    code_.raw({0xf2, 0x4c, 0x0f, 0x2c,
                               static_cast<unsigned>(
                                   0xc0 + (cached & 7) * 8 + source)});
                }
                return;
            }
            const int destination = local_register[local];
            if (destination < 0) store_xmm(source, frame.displacement(local));
            else if (static_cast<unsigned>(destination) != source) {
                move_xmm(static_cast<unsigned>(destination), source);
            }
        };
        const auto load_i64_to_rax = [&](unsigned local) {
            const int cached = integer_register.at(local);
            if (cached < 0) {
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(local));
            } else {
                code_.raw({0x49, 0x8b,
                           static_cast<unsigned>(0xc0 + (cached & 7))});
            }
        };
        const auto load_i64_to_rcx = [&](unsigned local) {
            const int cached = integer_register.at(local);
            if (cached < 0) {
                code_.raw({0x48, 0x8b, 0x8d});
                code_.i32(frame.displacement(local));
            } else {
                code_.raw({0x49, 0x8b,
                           static_cast<unsigned>(0xc8 + (cached & 7))});
            }
        };
        const auto load_i64_to_rdx = [&](unsigned local) {
            const int cached = integer_register.at(local);
            if (cached < 0) {
                code_.raw({0x48, 0x8b, 0x95});
                code_.i32(frame.displacement(local));
            } else {
                code_.raw({0x49, 0x8b,
                           static_cast<unsigned>(0xd0 + (cached & 7))});
            }
        };
        const auto store_rax_to_i64 = [&](unsigned local) {
            const int cached = integer_register.at(local);
            if (cached < 0) {
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(local));
            } else {
                code_.raw({0x49, 0x89,
                           static_cast<unsigned>(0xc0 + (cached & 7))});
            }
        };
        const auto emit_fixed_base_address = [&](std::uint32_t base, std::uint32_t width) {
            if (borrow_aggregate_parameters && base < parameter_count &&
                width <= parameter_count - base) {
                code_.raw({0x49, 0x8d, 0x82});
                code_.i32(-static_cast<std::int32_t>(base * 8u));
            } else {
                code_.raw({0x48, 0x8d, 0x85});
                code_.i32(frame.displacement(base));
            }
        };
        const auto fixed_base_is_borrowed =
            [&](std::uint32_t base, std::uint32_t width) {
                return borrow_aggregate_parameters && base < parameter_count &&
                    width <= parameter_count - base;
            };
        const auto direct_frame_sib = [](unsigned rax_sib) {
            return rax_sib == 0xd0u ? 0xd5u : 0xcdu;
        };
        const auto emit_fixed_indexed_f64_load =
            [&](std::uint32_t base, std::uint32_t width,
                unsigned destination, unsigned rax_sib) {
                if (fixed_base_is_borrowed(base, width)) {
                    emit_fixed_base_address(base, width);
                    code_.raw({0xf2, 0x0f, 0x10,
                               static_cast<unsigned>(0x04u + destination * 8u),
                               rax_sib});
                    return;
                }
                code_.raw({0xf2, 0x0f, 0x10,
                           static_cast<unsigned>(0x84u + destination * 8u),
                           direct_frame_sib(rax_sib)});
                code_.i32(frame.displacement(base));
            };
        const auto emit_fixed_indexed_f64_store =
            [&](std::uint32_t base, std::uint32_t width,
                unsigned source, unsigned rax_sib, bool high) {
                if (fixed_base_is_borrowed(base, width)) {
                    emit_fixed_base_address(base, width);
                    code_.raw({high ? 0x66u : 0xf2u, 0x0f,
                               high ? 0x17u : 0x11u,
                               static_cast<unsigned>(0x04u + source * 8u),
                               rax_sib});
                    return;
                }
                code_.raw({high ? 0x66u : 0xf2u, 0x0f,
                           high ? 0x17u : 0x11u,
                           static_cast<unsigned>(0x84u + source * 8u),
                           direct_frame_sib(rax_sib)});
                code_.i32(frame.displacement(base));
            };
        const auto emit_horizontal_ymm_sum = [&](unsigned ymm, unsigned temporary_xmm) {
            if (ymm > 7 || temporary_xmm > 7) {
                throw BackendFailure("invalid packed reduction register");
            }
            code_.raw({
                0xc4, 0xe3, 0x7d, 0x19,
                static_cast<unsigned>(0xc0 + ymm * 8 + temporary_xmm), 0x01
            });
            const unsigned vex = 0x81u | (((~ymm) & 0x0fu) << 3u);
            code_.raw({
                0xc5, vex, 0x58,
                static_cast<unsigned>(0xc0 + ymm * 8 + temporary_xmm),
                0xc5, vex, 0x7c,
                static_cast<unsigned>(0xc0 + ymm * 9)
            });
        };
        const auto emit_packed_matrix_reduction = [&](const PackedMatrixReductionLoopPlan& plan) {
            if (!local_is_i64(plan.row_local) || !local_is_i64(plan.counter_local) ||
                !local_is_i64(plan.diagonal_local)) {
                throw BackendFailure("packed matrix reduction requires native integer locals");
            }
            const std::array<double, 4> columns{3.0, 2.0, 1.0, 0.0};
            code_.byte(0xe9);
            const auto skip_constants = code_.rel32_placeholder();
            const auto emit_packed_literal = [&](double value) {
                const auto position = code_.position();
                for (unsigned lane = 0; lane < 4; ++lane) {
                    std::uint64_t bits = 0;
                    std::memcpy(&bits, &value, sizeof(bits));
                    code_.u64(bits);
                }
                return position;
            };
            const auto packed_one = emit_packed_literal(1.0);
            const auto packed_half = emit_packed_literal(0.5);
            const auto packed_four = emit_packed_literal(4.0);
            code_.patch_rel32(skip_constants, code_.position());
            emit_ymm_constant(1, columns);
            load_local(plan.row_local, 2);
            code_.raw({0xc4, 0xe2, 0x7d, 0x19, 0xd2});
            code_.raw({0xc5, 0xfd, 0x57, 0xc0,
                       0xc5, 0xd5, 0x57, 0xed});

            emit_fixed_base_address(plan.input_base, plan.width);
            code_.raw({0x48, 0x83, 0xe8, 0x18, 0xb9});
            code_.i32(static_cast<std::int32_t>(plan.width / 8u));
            const auto loop = code_.position();
            const auto emit_block = [&](unsigned accumulator) {
                // diagonal = row + column;
                // denominator = diagonal*(diagonal+1)/2 + offset + 1.
                code_.raw({0xc5, 0xf5, 0x58, 0xda,
                           0xc5, 0xe5, 0x58, 0x25});
                const auto one_for_diagonal = code_.rel32_placeholder();
                code_.patch_rel32(one_for_diagonal, packed_one);
                code_.raw({0xc5, 0xe5, 0x59, 0xdc,
                           0xc5, 0xe5, 0x59, 0x1d});
                const auto half_for_denominator = code_.rel32_placeholder();
                code_.patch_rel32(half_for_denominator, packed_half);
                if (plan.column_offset) code_.raw({0xc5, 0xe5, 0x58, 0xd9});
                else code_.raw({0xc5, 0xe5, 0x58, 0xda});
                code_.raw({0xc5, 0xe5, 0x58, 0x1d});
                const auto one_for_denominator = code_.rel32_placeholder();
                code_.patch_rel32(one_for_denominator, packed_one);
                code_.raw({0xc5, 0xfd, 0x10, 0x20,
                           0xc5, 0xdd, 0x5e, 0xe3});
                const unsigned vex = 0x85u | (((~accumulator) & 0x0fu) << 3u);
                code_.raw({0xc5, vex, 0x58,
                           static_cast<unsigned>(0xc0 + accumulator * 8 + 4),
                           0xc5, 0xf5, 0x58, 0x0d});
                const auto four_reference = code_.rel32_placeholder();
                code_.patch_rel32(four_reference, packed_four);
                code_.raw({0x48, 0x83, 0xe8, 0x20});
            };
            emit_block(0);
            emit_block(5);
            code_.raw({0xff, 0xc9,
                       0x0f, 0x85});
            const auto repeat = code_.rel32_placeholder();
            code_.patch_rel32(repeat, loop);
            code_.raw({0xc5, 0xfd, 0x58, 0xc5});
            emit_horizontal_ymm_sum(0, 4);
            code_.raw({0xc5, 0xf8, 0x77});

            emit_fixed_base_address(plan.input_base, plan.width);
            code_.raw({0x48, 0x89, 0xc2});
            for (std::uint32_t column = (plan.width / 8u) * 8u;
                 column < plan.width; ++column) {
                load_local(plan.row_local, 1);
                emit_number(static_cast<double>(column), 2);
                code_.raw({0xf2, 0x0f, 0x58, 0xd1,
                           0x66, 0x0f, 0x28, 0xda});
                emit_number(1.0, 4);
                code_.raw({0xf2, 0x0f, 0x58, 0xdc,
                           0xf2, 0x0f, 0x59, 0xd3});
                emit_number(0.5, 3);
                code_.raw({0xf2, 0x0f, 0x59, 0xd3});
                if (plan.column_offset) emit_number(static_cast<double>(column), 3);
                else code_.raw({0x66, 0x0f, 0x28, 0xd9});
                code_.raw({0xf2, 0x0f, 0x58, 0xd3});
                emit_number(1.0, 3);
                code_.raw({0xf2, 0x0f, 0x58, 0xd3,
                           0xf2, 0x0f, 0x10, 0x9a});
                code_.i32(-static_cast<std::int32_t>(column * 8u));
                code_.raw({0xf2, 0x0f, 0x5e, 0xda,
                           0xf2, 0x0f, 0x58, 0xc3});
            }
            store_local(plan.total_local, 0);
            code_.raw({0x48, 0xc7, 0x85});
            code_.i32(frame.displacement(plan.counter_local));
            code_.i32(static_cast<std::int32_t>(plan.width));
            code_.raw({0x48, 0x8b, 0x85});
            code_.i32(frame.displacement(plan.row_local));
            code_.raw({0x48, 0x05});
            code_.i32(static_cast<std::int32_t>(plan.width - 1u));
            code_.raw({0x48, 0x89, 0x85});
            code_.i32(frame.displacement(plan.diagonal_local));
        };
        const auto emit_packed_dot_reduction = [&](const PackedDotReductionLoopPlan& plan) {
            if (!local_is_i64(plan.counter_local)) {
                throw BackendFailure("packed dot reduction requires a native integer counter");
            }
            code_.raw({0xc5, 0xfd, 0x57, 0xc0,
                       0xc5, 0xf5, 0x57, 0xc9});
            emit_fixed_base_address(plan.left_base, plan.width);
            code_.raw({0x48, 0x89, 0xc2});
            emit_fixed_base_address(plan.right_base, plan.width);
            code_.raw({0x48, 0x83, 0xea, 0x18,
                       0x48, 0x83, 0xe8, 0x18,
                       0xb9});
            code_.i32(static_cast<std::int32_t>(plan.width / 4u));
            const auto loop = code_.position();
            code_.raw({0xc5, 0xfd, 0x10, 0x12,
                       0xc5, 0xfd, 0x10, 0x18,
                       0xc5, 0xed, 0x59, 0xe3,
                       0xc5, 0xfd, 0x58, 0xc4,
                       0xc5, 0xe5, 0x59, 0xe3,
                       0xc5, 0xf5, 0x58, 0xcc,
                       0x48, 0x83, 0xea, 0x20,
                       0x48, 0x83, 0xe8, 0x20,
                       0xff, 0xc9,
                       0x0f, 0x85});
            const auto repeat = code_.rel32_placeholder();
            code_.patch_rel32(repeat, loop);
            emit_horizontal_ymm_sum(0, 4);
            emit_horizontal_ymm_sum(1, 4);
            code_.raw({0xc5, 0xf8, 0x77});

            emit_fixed_base_address(plan.left_base, plan.width);
            code_.raw({0x48, 0x89, 0xc2});
            emit_fixed_base_address(plan.right_base, plan.width);
            for (std::uint32_t index = (plan.width / 4u) * 4u;
                 index < plan.width; ++index) {
                code_.raw({0xf2, 0x0f, 0x10, 0x92});
                code_.i32(-static_cast<std::int32_t>(index * 8u));
                code_.raw({0xf2, 0x0f, 0x10, 0x98});
                code_.i32(-static_cast<std::int32_t>(index * 8u));
                code_.raw({0x66, 0x0f, 0x28, 0xe2,
                           0xf2, 0x0f, 0x59, 0xe3,
                           0xf2, 0x0f, 0x58, 0xc4,
                           0x66, 0x0f, 0x28, 0xe3,
                           0xf2, 0x0f, 0x59, 0xe3,
                           0xf2, 0x0f, 0x58, 0xcc});
            }
            store_local(plan.numerator_local, 0);
            store_local(plan.denominator_local, 1);
            code_.raw({0x48, 0xc7, 0x85});
            code_.i32(frame.displacement(plan.counter_local));
            code_.i32(static_cast<std::int32_t>(plan.width));
        };
        std::vector<bool> index_upper_bound_proven(function.instructions.size(), false);
        std::vector<bool> index_lower_bound_proven(function.instructions.size(), false);
        for (std::size_t position = 0;
             position < function.instructions.size(); ++position) {
            const auto& instruction = function.instructions[position];
            if ((instruction.opcode == vkf::machine_ir::Opcode::LoadF64LocalsIndex ||
                 instruction.opcode == vkf::machine_ir::Opcode::StoreF64LocalsIndex) &&
                !instruction.may_error) {
                index_lower_bound_proven[position] = true;
                index_upper_bound_proven[position] = true;
            }
        }
        {
            struct GuardFact {
                std::size_t guard = 0;
                std::size_t body = 0;
                std::size_t end = 0;
                std::uint32_t local = 0;
                double bound = 0.0;
                bool nonnegative = false;
            };
            std::map<std::uint32_t, std::size_t> label_positions;
            for (std::size_t position = 0; position < function.instructions.size(); ++position) {
                const auto& candidate = function.instructions[position];
                if (candidate.opcode == vkf::machine_ir::Opcode::Label) {
                    label_positions.emplace(candidate.label, position);
                }
            }
            std::vector<GuardFact> guards;
            for (std::size_t guard = 0; guard + 3 < function.instructions.size(); ++guard) {
                const auto& index_operand = function.instructions[guard];
                const auto& bound_operand = function.instructions[guard + 1];
                const auto& comparison = function.instructions[guard + 2];
                const auto& exit = function.instructions[guard + 3];
                const bool strict_less = comparison.opcode ==
                    vkf::machine_ir::Opcode::OrderedLessF64;
                const bool less_equal = comparison.opcode ==
                    vkf::machine_ir::Opcode::OrderedLessEqualF64;
                if (index_operand.opcode != vkf::machine_ir::Opcode::LoadLocal ||
                    bound_operand.opcode != vkf::machine_ir::Opcode::PushF64 ||
                    (!strict_less && !less_equal) ||
                    exit.opcode != vkf::machine_ir::Opcode::JumpIfFalse ||
                    bound_operand.f64 < 0.0 ||
                    bound_operand.f64 != std::floor(bound_operand.f64)) {
                    continue;
                }
                const auto target = label_positions.find(exit.label);
                if (target == label_positions.end() || target->second <= guard + 3) continue;
                guards.push_back({
                    guard, guard + 4, target->second, index_operand.index,
                    bound_operand.f64 + (less_equal ? 1.0 : 0.0), false
                });
            }
            for (auto& fact : guards) {
                const auto source_is_nonnegative = [&](std::uint32_t local, std::size_t at) {
                    for (const auto& outer : guards) {
                        if (!outer.nonnegative || outer.local != local ||
                            at < outer.body || at >= outer.end) {
                            continue;
                        }
                        bool overwritten = false;
                        for (std::size_t position = outer.body; position < at; ++position) {
                            const auto& candidate = function.instructions[position];
                            if (candidate.opcode == vkf::machine_ir::Opcode::StoreLocal &&
                                candidate.index == local) {
                                overwritten = true;
                                break;
                            }
                        }
                        if (!overwritten) return true;
                    }
                    return false;
                };
                if (fact.guard > 1 &&
                    function.instructions[fact.guard - 1].opcode ==
                        vkf::machine_ir::Opcode::Label) {
                    // A loop initializer need not be adjacent to its header. Other
                    // loop-carried values are commonly reset between the induction
                    // variable and the label. Walk the straight-line preheader back
                    // to the nearest definition instead of requiring an exact
                    // `value; store; label` spelling.
                    for (std::size_t cursor = fact.guard - 1; cursor > 0;) {
                        --cursor;
                        const auto& store = function.instructions[cursor];
                        if (store.opcode == vkf::machine_ir::Opcode::Label ||
                            store.opcode == vkf::machine_ir::Opcode::Jump) {
                            break;
                        }
                        if (store.opcode != vkf::machine_ir::Opcode::StoreLocal ||
                            store.index != fact.local) {
                            continue;
                        }
                        if (cursor >= 1) {
                            const auto& value = function.instructions[cursor - 1];
                            fact.nonnegative = value.opcode == vkf::machine_ir::Opcode::PushF64 &&
                                value.f64 >= 0.0;
                        }
                        if (!fact.nonnegative && cursor >= 3) {
                            const auto& left = function.instructions[cursor - 3];
                            const auto& right = function.instructions[cursor - 2];
                            const auto& add = function.instructions[cursor - 1];
                            fact.nonnegative = left.opcode == vkf::machine_ir::Opcode::LoadLocal &&
                                right.opcode == vkf::machine_ir::Opcode::PushF64 &&
                                right.f64 >= 0.0 &&
                                add.opcode == vkf::machine_ir::Opcode::AddF64 &&
                                source_is_nonnegative(left.index, cursor - 3);
                        }
                        break;
                    }
                }
                for (std::size_t position = fact.body; position < fact.end; ++position) {
                    const auto& candidate = function.instructions[position];
                    if (candidate.opcode == vkf::machine_ir::Opcode::StoreLocal &&
                        candidate.index == fact.local) {
                        break;
                    }
                    if ((candidate.opcode == vkf::machine_ir::Opcode::LoadF64LocalsIndex ||
                         candidate.opcode == vkf::machine_ir::Opcode::StoreF64LocalsIndex) &&
                        candidate.index_local && *candidate.index_local == fact.local &&
                        fact.bound <= static_cast<double>(candidate.argument_count)) {
                        index_upper_bound_proven[position] = true;
                        if (fact.nonnegative) index_lower_bound_proven[position] = true;
                    }
                }
            }
        }
        prologue(frame);
        if (entry) save_runtime_context(frame);
        else save_result_context(frame);
        if (function.parameter_mask_local) {
            code_.raw({0x4c, 0x89, 0x8d});
            code_.i32(frame.displacement(*function.parameter_mask_local));
        }
        for (const auto slot : function.owned_f64_list_locals) {
            if (slot >= frame.local_count) throw BackendFailure("invalid owned x64 list local");
            code_.raw({0x48, 0xc7, 0x85});
            code_.i32(frame.displacement(slot));
            code_.i32(0);
        }
        for (const auto slot : function.owned_string_locals) {
            if (slot + 1 >= frame.local_count) throw BackendFailure("invalid owned x64 string local");
            for (unsigned component = 0; component < 2; ++component) {
                code_.raw({0x48, 0xc7, 0x85});
                code_.i32(frame.displacement(slot + component));
                code_.i32(0);
            }
        }
        for (std::size_t index = 0;
             !borrow_aggregate_parameters && index < function.parameters.size(); ++index) {
            if (entry) store_local(static_cast<unsigned>(index), static_cast<unsigned>(index));
            else {
                load_argument_from_r10(static_cast<std::uint32_t>(index));
                store_local(static_cast<unsigned>(index), 0);
            }
        }

        unsigned stack_depth = 0;
        std::map<std::uint32_t, std::size_t> labels;
        std::vector<MachineBranchPatch> branches;
        const auto static_fixed_index = [](
            const vkf::machine_ir::Instruction& value,
            const vkf::machine_ir::Instruction& access
        ) -> std::optional<std::uint32_t> {
            if (value.opcode != vkf::machine_ir::Opcode::PushF64 ||
                !access.index_is_integral || access.may_error ||
                !std::isfinite(value.f64) || value.f64 < 0.0 ||
                value.f64 != std::floor(value.f64) ||
                value.f64 >= static_cast<double>(access.argument_count)) {
                return std::nullopt;
            }
            return static_cast<std::uint32_t>(value.f64);
        };
        struct FusedOperand {
            enum class Kind { Local, Constant, ProvenFixedIndex, StaticFixedIndex } kind = Kind::Local;
            const vkf::machine_ir::Instruction* value = nullptr;
            const vkf::machine_ir::Instruction* index = nullptr;
            std::size_t next = 0;
        };
        const auto fused_operand_at = [&](std::size_t position) -> std::optional<FusedOperand> {
            using vkf::machine_ir::Opcode;
            if (position >= function.instructions.size()) return std::nullopt;
            const auto& first = function.instructions[position];
            if (first.opcode == Opcode::LoadLocal && position + 1 < function.instructions.size()) {
                const auto& indexed = function.instructions[position + 1];
                if (indexed.opcode == Opcode::LoadF64LocalsIndex && indexed.index_is_integral &&
                    indexed.index_local && *indexed.index_local == first.index &&
                    index_lower_bound_proven[position + 1] &&
                    index_upper_bound_proven[position + 1]) {
                    return FusedOperand{
                        FusedOperand::Kind::ProvenFixedIndex, &first, &indexed, position + 2
                    };
                }
            }
            if (first.opcode == Opcode::PushF64 && position + 1 < function.instructions.size()) {
                const auto& indexed = function.instructions[position + 1];
                if (indexed.opcode == Opcode::LoadF64LocalsIndex &&
                    static_fixed_index(first, indexed)) {
                    return FusedOperand{
                        FusedOperand::Kind::StaticFixedIndex, &first, &indexed, position + 2
                    };
                }
            }
            if (first.opcode == Opcode::LoadLocal) {
                return FusedOperand{FusedOperand::Kind::Local, &first, nullptr, position + 1};
            }
            if (first.opcode == Opcode::PushF64) {
                return FusedOperand{FusedOperand::Kind::Constant, &first, nullptr, position + 1};
            }
            return std::nullopt;
        };
        const auto emit_fused_operand = [&](const FusedOperand& operand, unsigned destination) {
            if (operand.kind == FusedOperand::Kind::Constant) {
                emit_number(operand.value->f64, destination);
                return;
            }
            if (operand.kind == FusedOperand::Kind::StaticFixedIndex) {
                const auto index = static_fixed_index(*operand.value, *operand.index);
                if (!index || operand.index->index + *index >= frame.local_count) {
                    throw BackendFailure("invalid static x64 fixed-vector index");
                }
                load_local(operand.index->index + *index, destination);
                return;
            }
            if (operand.value->index >= frame.local_count) {
                throw BackendFailure("invalid fused x64 local slot");
            }
            if (operand.kind != FusedOperand::Kind::ProvenFixedIndex) {
                load_local(operand.value->index, destination);
                return;
            }
            if (operand.index->index > frame.local_count ||
                operand.index->argument_count > frame.local_count - operand.index->index) {
                throw BackendFailure("invalid fused x64 fixed-vector index range");
            }
            if (local_is_i64(operand.value->index)) {
                load_i64_to_rcx(operand.value->index);
            } else {
                load_local(operand.value->index, destination);
                code_.raw({0xf2, 0x48, 0x0f, 0x2c,
                           static_cast<unsigned>(0xc8 + destination)});
            }
            code_.raw({0x48, 0xf7, 0xd9,
            });
            if (fixed_range_is_i64(
                    operand.index->index, operand.index->argument_count)) {
                emit_fixed_base_address(
                    operand.index->index, operand.index->argument_count);
                code_.raw({0x48, 0x8b, 0x14, 0xc8,
                           0xf2, 0x48, 0x0f, 0x2a,
                           static_cast<unsigned>(0xc2 + destination * 8)});
            } else {
                emit_fixed_indexed_f64_load(
                    operand.index->index, operand.index->argument_count,
                    destination, 0xc8u);
            }
        };
        struct ExpressionNode {
            enum class Kind { Local, Constant, ProvenFixedIndex, StaticFixedIndex, Binary, Sqrt } kind = Kind::Local;
            vkf::machine_ir::Opcode opcode = vkf::machine_ir::Opcode::Drop;
            const vkf::machine_ir::Instruction* value = nullptr;
            const vkf::machine_ir::Instruction* index = nullptr;
            std::size_t left = 0;
            std::size_t right = 0;
        };
        struct ExpressionPlan {
            std::vector<ExpressionNode> nodes;
            std::size_t root = 0;
            std::size_t store_position = 0;
            std::uint32_t store_local = 0;
            const vkf::machine_ir::Instruction* indexed_store = nullptr;
            std::size_t indexed_store_local_node = 0;
            unsigned register_height = 0;
        };
        const auto expression_plan_at = [&](std::size_t start) -> std::optional<ExpressionPlan> {
            using vkf::machine_ir::Opcode;
            ExpressionPlan plan;
            std::vector<std::size_t> values;
            for (std::size_t position = start; position < function.instructions.size();) {
                const auto& instruction = function.instructions[position];
                if (instruction.opcode == Opcode::LoadLocal &&
                    position + 1 < function.instructions.size()) {
                    const auto& indexed = function.instructions[position + 1];
                    if (indexed.opcode == Opcode::LoadF64LocalsIndex && indexed.index_is_integral &&
                        indexed.index_local && *indexed.index_local == instruction.index &&
                        index_lower_bound_proven[position + 1] &&
                        index_upper_bound_proven[position + 1]) {
                        plan.nodes.push_back({
                            ExpressionNode::Kind::ProvenFixedIndex, Opcode::LoadF64LocalsIndex,
                            &instruction, &indexed, 0, 0
                        });
                        values.push_back(plan.nodes.size() - 1);
                        position += 2;
                        continue;
                    }
                }
                if (instruction.opcode == Opcode::PushF64 &&
                    position + 1 < function.instructions.size()) {
                    const auto& indexed = function.instructions[position + 1];
                    if (indexed.opcode == Opcode::LoadF64LocalsIndex &&
                        static_fixed_index(instruction, indexed)) {
                        plan.nodes.push_back({
                            ExpressionNode::Kind::StaticFixedIndex,
                            Opcode::LoadF64LocalsIndex,
                            &instruction, &indexed, 0, 0
                        });
                        values.push_back(plan.nodes.size() - 1);
                        position += 2;
                        continue;
                    }
                }
                if (instruction.opcode == Opcode::LoadLocal ||
                    instruction.opcode == Opcode::PushF64) {
                    plan.nodes.push_back({
                        instruction.opcode == Opcode::LoadLocal
                            ? ExpressionNode::Kind::Local : ExpressionNode::Kind::Constant,
                        instruction.opcode, &instruction, nullptr, 0, 0
                    });
                    values.push_back(plan.nodes.size() - 1);
                    ++position;
                    continue;
                }
                if (instruction.opcode == Opcode::SqrtF64 && !values.empty()) {
                    const auto operand = values.back();
                    values.pop_back();
                    plan.nodes.push_back({
                        ExpressionNode::Kind::Sqrt, instruction.opcode, nullptr, nullptr,
                        operand, 0
                    });
                    values.push_back(plan.nodes.size() - 1);
                    ++position;
                    continue;
                }
                const bool binary = instruction.opcode == Opcode::AddF64 ||
                    instruction.opcode == Opcode::SubtractF64 ||
                    instruction.opcode == Opcode::MultiplyF64 ||
                    instruction.opcode == Opcode::DivideF64;
                if (binary && values.size() >= 2) {
                    const auto right = values.back();
                    values.pop_back();
                    const auto left = values.back();
                    values.pop_back();
                    plan.nodes.push_back({
                        ExpressionNode::Kind::Binary, instruction.opcode, nullptr, nullptr,
                        left, right
                    });
                    values.push_back(plan.nodes.size() - 1);
                    ++position;
                    continue;
                }
                if (instruction.opcode == Opcode::StoreLocal && values.size() == 1 &&
                    position >= start + 2) {
                    plan.root = values.back();
                    plan.store_position = position;
                    plan.store_local = instruction.index;
                    std::function<unsigned(std::size_t)> height = [&](std::size_t node_index) {
                        const auto& node = plan.nodes[node_index];
                        if (node.kind == ExpressionNode::Kind::Binary) {
                            return std::max(height(node.left), 1u + height(node.right));
                        }
                        if (node.kind == ExpressionNode::Kind::Sqrt) return height(node.left);
                        return 1u;
                    };
                    plan.register_height = height(plan.root);
                    if (plan.register_height <= 5) return plan;
                }
                if (instruction.opcode == Opcode::StoreF64LocalsIndex && values.size() == 2 &&
                    instruction.index_is_integral && instruction.index_local &&
                    index_lower_bound_proven[position] && index_upper_bound_proven[position] &&
                    ((plan.nodes[values.front()].kind == ExpressionNode::Kind::Local &&
                      plan.nodes[values.front()].value->index == *instruction.index_local) ||
                     (plan.nodes[values.front()].kind == ExpressionNode::Kind::Constant &&
                      static_fixed_index(
                          *plan.nodes[values.front()].value, instruction)))) {
                    plan.root = values.back();
                    plan.store_position = position;
                    plan.indexed_store = &instruction;
                    plan.indexed_store_local_node = values.front();
                    std::function<unsigned(std::size_t)> height = [&](std::size_t node_index) {
                        const auto& node = plan.nodes[node_index];
                        if (node.kind == ExpressionNode::Kind::Binary) {
                            return std::max(height(node.left), 1u + height(node.right));
                        }
                        if (node.kind == ExpressionNode::Kind::Sqrt) return height(node.left);
                        return 1u;
                    };
                    plan.register_height = height(plan.root);
                    if (plan.register_height <= 6) return plan;
                }
                return std::nullopt;
            }
            return std::nullopt;
        };
        std::array<std::optional<std::uint32_t>, 2> expression_index_cache;
        const auto emit_expression_plan = [&](const ExpressionPlan& plan) {
            std::vector<std::uint32_t> needed_indices;
            const auto add_needed_index = [&](std::uint32_t local) {
                if (std::find(needed_indices.begin(), needed_indices.end(), local) ==
                    needed_indices.end()) {
                    needed_indices.push_back(local);
                }
            };
            for (const auto& node : plan.nodes) {
                if (node.kind == ExpressionNode::Kind::ProvenFixedIndex) {
                    add_needed_index(node.value->index);
                }
            }
            if (plan.indexed_store) {
                const auto& index_node = plan.nodes[plan.indexed_store_local_node];
                if (index_node.kind == ExpressionNode::Kind::Local) {
                    add_needed_index(index_node.value->index);
                }
            }
            if (needed_indices.size() > expression_index_cache.size()) {
                expression_index_cache = {};
            }
            if (needed_indices.size() <= expression_index_cache.size()) for (const auto local : needed_indices) {
                if (std::find(expression_index_cache.begin(), expression_index_cache.end(), local) !=
                    expression_index_cache.end()) {
                    continue;
                }
                std::size_t slot = expression_index_cache.size();
                for (std::size_t candidate = 0; candidate < expression_index_cache.size(); ++candidate) {
                    if (!expression_index_cache[candidate] ||
                        std::find(needed_indices.begin(), needed_indices.end(),
                                  *expression_index_cache[candidate]) == needed_indices.end()) {
                        slot = candidate;
                        break;
                    }
                }
                if (slot == expression_index_cache.size()) continue;
                expression_index_cache[slot] = local;
                if (local_is_i64(local)) {
                    if (slot == 0) load_i64_to_rcx(local);
                    else load_i64_to_rdx(local);
                } else {
                    code_.raw({0xf2, 0x48, 0x0f, 0x2c,
                               static_cast<unsigned>(slot == 0 ? 0x8d : 0x95)});
                    code_.i32(frame.displacement(local));
                }
                if (slot == 0) code_.raw({0x48, 0xf7, 0xd9});
                else code_.raw({0x48, 0xf7, 0xda});
            }
            const auto cached_slot = [&](std::uint32_t local) -> std::optional<std::size_t> {
                for (std::size_t slot = 0; slot < expression_index_cache.size(); ++slot) {
                    if (expression_index_cache[slot] == local) return slot;
                }
                return std::nullopt;
            };
            std::function<void(std::size_t, unsigned)> emit_node =
                [&](std::size_t node_index, unsigned destination) {
                    const auto& node = plan.nodes[node_index];
                    if (destination > 5) throw BackendFailure("x64 expression register overflow");
                    if (node.kind == ExpressionNode::Kind::Constant) {
                        emit_number(node.value->f64, destination);
                        return;
                    }
                    if (node.kind == ExpressionNode::Kind::Local ||
                        node.kind == ExpressionNode::Kind::ProvenFixedIndex ||
                        node.kind == ExpressionNode::Kind::StaticFixedIndex) {
                        if (node.kind == ExpressionNode::Kind::StaticFixedIndex) {
                            const auto index = static_fixed_index(*node.value, *node.index);
                            if (!index || node.index->index + *index >= frame.local_count) {
                                throw BackendFailure(
                                    "invalid static expression x64 fixed-vector index");
                            }
                            load_local(node.index->index + *index, destination);
                            return;
                        }
                        if (node.value->index >= frame.local_count) {
                            throw BackendFailure("invalid expression x64 local slot");
                        }
                        if (node.kind == ExpressionNode::Kind::Local) {
                            load_local(node.value->index, destination);
                            return;
                        }
                        const auto cached = cached_slot(node.value->index);
                        if (!cached) {
                            if (local_is_i64(node.value->index)) {
                                load_i64_to_rcx(node.value->index);
                                code_.raw({0x48, 0xf7, 0xd9});
                            } else {
                                load_local(node.value->index, destination);
                                code_.raw({0xf2, 0x48, 0x0f, 0x2c,
                                           static_cast<unsigned>(0xc8 + destination),
                                           0x48, 0xf7, 0xd9});
                            }
                        }
                        const unsigned sib = !cached || *cached == 0 ? 0xc8 : 0xd0;
                        if (fixed_range_is_i64(
                                node.index->index, node.index->argument_count)) {
                            emit_fixed_base_address(
                                node.index->index, node.index->argument_count);
                            code_.raw({0x48, 0x8b, 0x14, sib,
                                       0xf2, 0x48, 0x0f, 0x2a,
                                       static_cast<unsigned>(0xc2 + destination * 8)});
                        } else {
                            emit_fixed_indexed_f64_load(
                                node.index->index, node.index->argument_count,
                                destination, sib);
                        }
                        return;
                    }
                    if (node.kind == ExpressionNode::Kind::Sqrt) {
                        emit_node(node.left, destination);
                        code_.raw({0xf2, 0x0f, 0x51,
                                   static_cast<unsigned>(0xc0 + destination * 9)});
                        return;
                    }
                    const auto& left = plan.nodes[node.left];
                    const auto& right = plan.nodes[node.right];
                    const bool fused_product =
                        policy_.fused_multiply_add && vkf::target::host_x64_supports_fma() &&
                        (node.opcode == vkf::machine_ir::Opcode::AddF64 ||
                         node.opcode == vkf::machine_ir::Opcode::SubtractF64) &&
                        right.kind == ExpressionNode::Kind::Binary &&
                        right.opcode == vkf::machine_ir::Opcode::MultiplyF64;
                    if (fused_product) {
                        emit_node(node.left, destination);
                        emit_node(right.left, destination + 1);
                        emit_node(right.right, destination + 2);
                        const unsigned vex = 0x81u |
                            (((~(destination + 1u)) & 0x0fu) << 3u);
                        const unsigned modrm = 0xc0u + destination * 8u + destination + 2u;
                        code_.raw({
                            0xc4, 0xe2, vex,
                            node.opcode == vkf::machine_ir::Opcode::AddF64 ? 0xb9u : 0xbdu,
                            modrm
                        });
                        return;
                    }
                    emit_node(node.left, destination);
                    const bool halve = node.opcode == vkf::machine_ir::Opcode::DivideF64 &&
                        right.kind == ExpressionNode::Kind::Constant &&
                        right.value->f64 == 2.0;
                    if (halve) emit_number(0.5, destination + 1);
                    else emit_node(node.right, destination + 1);
                    const unsigned machine = node.opcode == vkf::machine_ir::Opcode::AddF64 ? 0x58
                        : node.opcode == vkf::machine_ir::Opcode::SubtractF64 ? 0x5c
                        : node.opcode == vkf::machine_ir::Opcode::MultiplyF64 || halve ? 0x59 : 0x5e;
                    code_.raw({0xf2, 0x0f, machine,
                               static_cast<unsigned>(0xc0 + destination * 8 + destination + 1)});
                };
            emit_node(plan.root, 0);
            if (!plan.indexed_store) {
                store_local(plan.store_local, 0);
                for (auto& cached : expression_index_cache) {
                    if (cached == plan.store_local) cached.reset();
                }
                return;
            }
            const auto& index_node = plan.nodes[plan.indexed_store_local_node];
            if (index_node.kind == ExpressionNode::Kind::Constant) {
                const auto index = static_fixed_index(
                    *index_node.value, *plan.indexed_store);
                if (!index || plan.indexed_store->index + *index >= frame.local_count) {
                    throw BackendFailure("invalid static x64 fixed-vector store index");
                }
                const auto local = plan.indexed_store->index + *index;
                store_local(local, 0);
                for (auto& cached : expression_index_cache) {
                    if (cached == local) cached.reset();
                }
                return;
            }
            const auto cached = cached_slot(index_node.value->index);
            if (!cached) {
                if (local_is_i64(index_node.value->index)) {
                    code_.raw({0x48, 0x8b, 0x8d});
                    code_.i32(frame.displacement(index_node.value->index));
                    code_.raw({0x48, 0xf7, 0xd9});
                } else {
                    load_local(index_node.value->index, 1);
                    code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc9,
                               0x48, 0xf7, 0xd9});
                }
            }
            const unsigned sib = !cached || *cached == 0 ? 0xc8 : 0xd0;
            if (fixed_range_is_i64(
                    plan.indexed_store->index, plan.indexed_store->argument_count)) {
                emit_fixed_base_address(
                    plan.indexed_store->index, plan.indexed_store->argument_count);
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xd0,
                           0x48, 0x89, 0x14, sib});
            } else {
                emit_fixed_indexed_f64_store(
                    plan.indexed_store->index,
                    plan.indexed_store->argument_count, 0u, sib, false);
            }
        };
        const auto emit_vector3_pair_interaction =
            [&](std::size_t start) -> std::optional<std::size_t> {
                using vkf::machine_ir::Opcode;
                if (!policy_.packed_dot_reductions ||
                    start + 112u >= function.instructions.size()) {
                    return std::nullopt;
                }
                const auto& at = function.instructions;
                const auto difference_lane = [&](std::size_t position,
                                                 std::uint32_t base) {
                    return at[position].opcode == Opcode::LoadLocal &&
                        local_is_i64(at[position].index) &&
                        at[position + 1u].opcode == Opcode::LoadF64LocalsIndex &&
                        at[position + 1u].index == base &&
                        at[position + 1u].index_is_integral &&
                        !at[position + 1u].may_error &&
                        at[position + 1u].index_local &&
                        *at[position + 1u].index_local == at[position].index &&
                        at[position + 2u].opcode == Opcode::LoadLocal &&
                        local_is_i64(at[position + 2u].index) &&
                        at[position + 3u].opcode == Opcode::LoadF64LocalsIndex &&
                        at[position + 3u].index == base &&
                        at[position + 3u].argument_count ==
                            at[position + 1u].argument_count &&
                        at[position + 3u].index_is_integral &&
                        !at[position + 3u].may_error &&
                        at[position + 3u].index_local &&
                        *at[position + 3u].index_local == at[position + 2u].index &&
                        at[position + 4u].opcode == Opcode::SubtractF64 &&
                        at[position + 5u].opcode == Opcode::StoreLocal;
                };
                const auto first_index = at[start].index;
                const auto second_index = at[start + 2u].index;
                const auto position_x = at[start + 1u].index;
                const auto displacement_x = at[start + 5u].index;
                const auto displacement_y = at[start + 11u].index;
                const auto displacement_z = at[start + 17u].index;
                if (!difference_lane(start, position_x) ||
                    !difference_lane(start + 6u, position_x + 1u) ||
                    !difference_lane(start + 12u, position_x + 2u) ||
                    at[start + 6u].index != first_index ||
                    at[start + 8u].index != second_index ||
                    at[start + 12u].index != first_index ||
                    at[start + 14u].index != second_index ||
                    displacement_y != displacement_x + 1u ||
                    displacement_z != displacement_y + 1u) {
                    return std::nullopt;
                }
                const auto squared = at[start + 29u].index;
                const auto magnitude = at[start + 36u].index;
                if (at[start + 18u].opcode != Opcode::LoadLocal ||
                    at[start + 18u].index != displacement_x ||
                    at[start + 19u].opcode != Opcode::LoadLocal ||
                    at[start + 19u].index != displacement_x ||
                    at[start + 20u].opcode != Opcode::MultiplyF64 ||
                    at[start + 21u].opcode != Opcode::LoadLocal ||
                    at[start + 21u].index != displacement_y ||
                    at[start + 22u].opcode != Opcode::LoadLocal ||
                    at[start + 22u].index != displacement_y ||
                    at[start + 23u].opcode != Opcode::MultiplyF64 ||
                    at[start + 24u].opcode != Opcode::AddF64 ||
                    at[start + 25u].opcode != Opcode::LoadLocal ||
                    at[start + 25u].index != displacement_z ||
                    at[start + 26u].opcode != Opcode::LoadLocal ||
                    at[start + 26u].index != displacement_z ||
                    at[start + 27u].opcode != Opcode::MultiplyF64 ||
                    at[start + 28u].opcode != Opcode::AddF64 ||
                    at[start + 29u].opcode != Opcode::StoreLocal ||
                    at[start + 30u].opcode != Opcode::PushF64 ||
                    at[start + 31u].opcode != Opcode::LoadLocal ||
                    at[start + 31u].index != squared ||
                    at[start + 32u].opcode != Opcode::LoadLocal ||
                    at[start + 32u].index != squared ||
                    at[start + 33u].opcode != Opcode::SqrtF64 ||
                    at[start + 34u].opcode != Opcode::MultiplyF64 ||
                    at[start + 35u].opcode != Opcode::DivideF64 ||
                    at[start + 36u].opcode != Opcode::StoreLocal) {
                    return std::nullopt;
                }
                const auto mass_load = [&](std::size_t position) {
                    return at[position].opcode == Opcode::PushF64 &&
                        at[position + 1u].opcode == Opcode::LoadF64LocalsIndex &&
                        at[position + 1u].index_is_integral &&
                        !at[position + 1u].may_error &&
                        at[position + 1u].index_local &&
                        local_is_i64(*at[position + 1u].index_local) &&
                        at[position + 2u].opcode == Opcode::StoreLocal &&
                        at[position + 3u].opcode == Opcode::LoadLocal &&
                        at[position + 3u].index == at[position + 2u].index &&
                        at[position + 4u].opcode == Opcode::Drop;
                };
                const auto affine_lane = [&](std::size_t position,
                                             Opcode arithmetic) {
                    return at[position].opcode == Opcode::LoadLocal &&
                        at[position + 1u].opcode == Opcode::LoadLocal &&
                        at[position + 1u].index == at[position].index &&
                        local_is_i64(at[position].index) &&
                        at[position + 2u].opcode == Opcode::LoadF64LocalsIndex &&
                        at[position + 2u].index_is_integral &&
                        !at[position + 2u].may_error &&
                        at[position + 2u].index_local &&
                        *at[position + 2u].index_local == at[position].index &&
                        at[position + 3u].opcode == Opcode::LoadLocal &&
                        at[position + 4u].opcode == Opcode::LoadLocal &&
                        at[position + 5u].opcode == Opcode::MultiplyF64 &&
                        at[position + 6u].opcode == Opcode::LoadLocal &&
                        at[position + 7u].opcode == Opcode::MultiplyF64 &&
                        at[position + 8u].opcode == arithmetic &&
                        at[position + 9u].opcode == Opcode::StoreF64LocalsIndex &&
                        at[position + 9u].index_is_integral &&
                        !at[position + 9u].may_error &&
                        at[position + 9u].index_local &&
                        *at[position + 9u].index_local == at[position].index;
                };
                if (at[start + 37u].opcode != Opcode::LoadLocal ||
                    at[start + 37u].index != first_index ||
                    at[start + 38u].opcode != Opcode::LoadF64LocalsIndex ||
                    at[start + 39u].opcode != Opcode::Drop ||
                    !mass_load(start + 40u) ||
                    !affine_lane(start + 45u, Opcode::SubtractF64) ||
                    !affine_lane(start + 55u, Opcode::SubtractF64) ||
                    !affine_lane(start + 65u, Opcode::SubtractF64) ||
                    at[start + 75u].opcode != Opcode::LoadLocal ||
                    at[start + 75u].index != second_index ||
                    at[start + 76u].opcode != Opcode::LoadF64LocalsIndex ||
                    at[start + 77u].opcode != Opcode::Drop ||
                    !mass_load(start + 78u) ||
                    !affine_lane(start + 83u, Opcode::AddF64) ||
                    !affine_lane(start + 93u, Opcode::AddF64) ||
                    !affine_lane(start + 103u, Opcode::AddF64)) {
                    return std::nullopt;
                }
                const auto velocity_x = at[start + 47u].index;
                if (at[start + 45u].index != first_index ||
                    at[start + 55u].index != first_index ||
                    at[start + 65u].index != first_index ||
                    at[start + 48u].index != displacement_x ||
                    at[start + 58u].index != displacement_y ||
                    at[start + 68u].index != displacement_z ||
                    at[start + 49u].index != at[start + 42u].index ||
                    at[start + 59u].index != at[start + 42u].index ||
                    at[start + 69u].index != at[start + 42u].index ||
                    at[start + 51u].index != magnitude ||
                    at[start + 61u].index != magnitude ||
                    at[start + 71u].index != magnitude ||
                    at[start + 57u].index != velocity_x + 1u ||
                    at[start + 67u].index != velocity_x + 2u ||
                    at[start + 83u].index != second_index ||
                    at[start + 93u].index != second_index ||
                    at[start + 103u].index != second_index ||
                    at[start + 85u].index != velocity_x ||
                    at[start + 95u].index != velocity_x + 1u ||
                    at[start + 105u].index != velocity_x + 2u ||
                    at[start + 87u].index != at[start + 80u].index ||
                    at[start + 97u].index != at[start + 80u].index ||
                    at[start + 107u].index != at[start + 80u].index ||
                    at[start + 89u].index != magnitude ||
                    at[start + 99u].index != magnitude ||
                    at[start + 109u].index != magnitude) {
                    return std::nullopt;
                }

                expression_index_cache = {};
                load_i64_to_rcx(first_index);
                load_i64_to_rdx(second_index);
                code_.raw({0x48, 0xf7, 0xd9, 0x48, 0xf7, 0xda});
                emit_fixed_indexed_f64_load(
                    position_x, at[start + 1u].argument_count, 0u, 0xc8u);
                emit_fixed_indexed_f64_load(
                    position_x, at[start + 3u].argument_count, 3u, 0xd0u);
                code_.raw({0xf2, 0x0f, 0x5c, 0xc3});
                emit_fixed_indexed_f64_load(
                    position_x + 1u, at[start + 7u].argument_count, 1u, 0xc8u);
                emit_fixed_indexed_f64_load(
                    position_x + 1u, at[start + 9u].argument_count, 3u, 0xd0u);
                code_.raw({0xf2, 0x0f, 0x5c, 0xcb});
                emit_fixed_indexed_f64_load(
                    position_x + 2u, at[start + 13u].argument_count, 2u, 0xc8u);
                emit_fixed_indexed_f64_load(
                    position_x + 2u, at[start + 15u].argument_count, 3u, 0xd0u);
                code_.raw({0xf2, 0x0f, 0x5c, 0xd3,
                           0x66, 0x0f, 0x28, 0xd8,
                           0xf2, 0x0f, 0x59, 0xd8});
                if (policy_.fused_multiply_add &&
                    vkf::target::host_x64_supports_fma()) {
                    code_.raw({0xc4, 0xe2, 0xf1, 0xb9, 0xd9,
                               0xc4, 0xe2, 0xe9, 0xb9, 0xda});
                } else {
                    code_.raw({0x66, 0x0f, 0x28, 0xe1,
                               0xf2, 0x0f, 0x59, 0xe1,
                               0xf2, 0x0f, 0x58, 0xdc,
                               0x66, 0x0f, 0x28, 0xe2,
                               0xf2, 0x0f, 0x59, 0xe2,
                               0xf2, 0x0f, 0x58, 0xdc});
                }
                code_.raw({0x66, 0x0f, 0x28, 0xe3,
                           0xf2, 0x0f, 0x51, 0xe4,
                           0xf2, 0x0f, 0x59, 0xdc});
                emit_number(at[start + 30u].f64, 4u);
                code_.raw({0xf2, 0x0f, 0x5e, 0xe3});

                const auto emit_update =
                    [&](std::size_t mass_position, std::size_t affine_position,
                        std::uint32_t vector_index, bool add) {
                        const auto& indexed_mass = at[mass_position + 1u];
                        load_i64_to_rcx(*indexed_mass.index_local);
                        code_.raw({0x48, 0xf7, 0xd9});
                        emit_fixed_indexed_f64_load(
                            indexed_mass.index, indexed_mass.argument_count,
                            6u, 0xc8u);
                        load_i64_to_rcx(vector_index);
                        code_.raw({0x48, 0xf7, 0xd9});
                        emit_fixed_indexed_f64_load(
                            at[affine_position + 2u].index,
                            at[affine_position + 2u].argument_count, 3u, 0xc8u);
                        emit_fixed_indexed_f64_load(
                            at[affine_position + 12u].index,
                            at[affine_position + 12u].argument_count, 5u, 0xc8u);
                        code_.raw({0x66, 0x0f, 0x14, 0xdd,
                                   0x66, 0x0f, 0x28, 0xe8,
                                   0x66, 0x0f, 0x14, 0xe9,
                                   0x66, 0x0f, 0x28, 0xfe,
                                   0x66, 0x0f, 0x14, 0xff,
                                   0x66, 0x0f, 0x59, 0xef,
                                   0x66, 0x0f, 0x28, 0xfc,
                                   0x66, 0x0f, 0x14, 0xff});
                        if (policy_.fused_multiply_add &&
                            vkf::target::host_x64_supports_fma()) {
                            code_.raw({0xc4, 0xe2, 0xd1,
                                       add ? 0xb8u : 0xbcu, 0xdf});
                        } else {
                            code_.raw({0x66, 0x0f, 0x59, 0xef,
                                       0x66, 0x0f,
                                       add ? 0x58u : 0x5cu, 0xdd});
                        }
                        emit_fixed_indexed_f64_store(
                            at[affine_position + 2u].index,
                            at[affine_position + 2u].argument_count,
                            3u, 0xc8u, false);
                        emit_fixed_indexed_f64_store(
                            at[affine_position + 12u].index,
                            at[affine_position + 12u].argument_count,
                            3u, 0xc8u, true);
                        emit_fixed_indexed_f64_load(
                            at[affine_position + 22u].index,
                            at[affine_position + 22u].argument_count, 3u, 0xc8u);
                        code_.raw({0x66, 0x0f, 0x28, 0xfa,
                                   0xf2, 0x0f, 0x59, 0xfe});
                        if (policy_.fused_multiply_add &&
                            vkf::target::host_x64_supports_fma()) {
                            code_.raw({0xc4, 0xe2, 0xc1,
                                       add ? 0xb9u : 0xbdu, 0xdc});
                        } else {
                            code_.raw({0xf2, 0x0f, 0x59, 0xfc,
                                       0xf2, 0x0f,
                                       add ? 0x58u : 0x5cu, 0xdf});
                        }
                        emit_fixed_indexed_f64_store(
                            at[affine_position + 22u].index,
                            at[affine_position + 22u].argument_count,
                            3u, 0xc8u, false);
                    };
                emit_update(start + 40u, start + 45u, first_index, false);
                emit_update(start + 78u, start + 83u, second_index, true);
                expression_index_cache = {};
                return start + 112u;
            };
        const auto emit_packed_scaled_vector3_update =
            [&](std::size_t start) -> std::optional<std::size_t> {
                using vkf::machine_ir::Opcode;
                if (!policy_.packed_dot_reductions ||
                    start + 26u >= function.instructions.size()) {
                    return std::nullopt;
                }
                const auto& at = function.instructions;
                const auto lane_matches = [&](std::size_t position) {
                    return at[position].opcode == Opcode::LoadLocal &&
                        local_is_i64(at[position].index) &&
                        at[position + 1u].opcode == Opcode::LoadLocal &&
                        at[position + 1u].index == at[position].index &&
                        at[position + 2u].opcode == Opcode::LoadF64LocalsIndex &&
                        at[position + 2u].index_is_integral &&
                        !at[position + 2u].may_error &&
                        at[position + 2u].index_local &&
                        *at[position + 2u].index_local == at[position].index &&
                        at[position + 3u].opcode == Opcode::LoadLocal &&
                        at[position + 3u].index == at[position].index &&
                        at[position + 4u].opcode == Opcode::LoadF64LocalsIndex &&
                        at[position + 4u].index_is_integral &&
                        !at[position + 4u].may_error &&
                        at[position + 4u].index_local &&
                        *at[position + 4u].index_local == at[position].index &&
                        at[position + 5u].opcode == Opcode::PushF64 &&
                        at[position + 6u].opcode == Opcode::MultiplyF64 &&
                        (at[position + 7u].opcode == Opcode::AddF64 ||
                         at[position + 7u].opcode == Opcode::SubtractF64) &&
                        at[position + 8u].opcode == Opcode::StoreF64LocalsIndex &&
                        at[position + 8u].index_is_integral &&
                        !at[position + 8u].may_error &&
                        at[position + 8u].index_local &&
                        *at[position + 8u].index_local == at[position].index;
                };
                if (!lane_matches(start) || !lane_matches(start + 9u) ||
                    !lane_matches(start + 18u)) {
                    return std::nullopt;
                }
                const auto& first_current = at[start + 2u];
                const auto& first_component = at[start + 4u];
                const auto arithmetic = at[start + 7u].opcode;
                const auto& first_store = at[start + 8u];
                if (at[start + 9u].index != at[start].index ||
                    at[start + 18u].index != at[start].index ||
                    at[start + 11u].index != first_current.index + 1u ||
                    at[start + 20u].index != first_current.index + 2u ||
                    at[start + 13u].index != first_component.index + 1u ||
                    at[start + 22u].index != first_component.index + 2u ||
                    at[start + 14u].f64 != at[start + 5u].f64 ||
                    at[start + 23u].f64 != at[start + 5u].f64 ||
                    at[start + 16u].opcode != arithmetic ||
                    at[start + 25u].opcode != arithmetic ||
                    at[start + 17u].index != first_store.index + 1u ||
                    at[start + 26u].index != first_store.index + 2u) {
                    return std::nullopt;
                }

                expression_index_cache = {};
                load_i64_to_rcx(at[start].index);
                code_.raw({0x48, 0xf7, 0xd9});
                emit_fixed_indexed_f64_load(
                    first_current.index, first_current.argument_count, 0u, 0xc8u);
                emit_fixed_indexed_f64_load(
                    at[start + 11u].index, at[start + 11u].argument_count,
                    1u, 0xc8u);
                code_.raw({0x66, 0x0f, 0x14, 0xc1});
                emit_fixed_indexed_f64_load(
                    first_component.index, first_component.argument_count, 1u, 0xc8u);
                emit_fixed_indexed_f64_load(
                    at[start + 13u].index, at[start + 13u].argument_count,
                    2u, 0xc8u);
                code_.raw({0x66, 0x0f, 0x14, 0xca});
                emit_number(at[start + 5u].f64, 2u);
                code_.raw({0x66, 0x0f, 0x14, 0xd2,
                           0x66, 0x0f, 0x59, 0xca,
                           0x66, 0x0f,
                           arithmetic == Opcode::AddF64 ? 0x58u : 0x5cu,
                           0xc1});

                emit_fixed_indexed_f64_load(
                    at[start + 20u].index, at[start + 20u].argument_count,
                    3u, 0xc8u);
                emit_fixed_indexed_f64_load(
                    at[start + 22u].index, at[start + 22u].argument_count,
                    4u, 0xc8u);
                emit_number(at[start + 5u].f64, 5u);
                if (policy_.fused_multiply_add &&
                    vkf::target::host_x64_supports_fma()) {
                    code_.raw({0xc4, 0xe2, 0xd9,
                               arithmetic == Opcode::AddF64 ? 0xb9u : 0xbdu,
                               0xdd});
                } else {
                    code_.raw({0xf2, 0x0f, 0x59, 0xe5,
                               0xf2, 0x0f,
                               arithmetic == Opcode::AddF64 ? 0x58u : 0x5cu,
                               0xdc});
                }
                emit_fixed_indexed_f64_store(
                    first_store.index, first_store.argument_count,
                    0u, 0xc8u, false);
                emit_fixed_indexed_f64_store(
                    at[start + 17u].index, at[start + 17u].argument_count,
                    0u, 0xc8u, true);
                emit_fixed_indexed_f64_store(
                    at[start + 26u].index, at[start + 26u].argument_count,
                    3u, 0xc8u, false);
                expression_index_cache = {};
                return start + 26u;
            };
        const auto emit_packed_affine_indexed_pair =
            [&](std::size_t start) -> std::optional<std::size_t> {
                using vkf::machine_ir::Opcode;
                if (!policy_.packed_dot_reductions ||
                    start + 19u >= function.instructions.size()) {
                    return std::nullopt;
                }
                const auto lane_matches = [&](std::size_t position) {
                    const auto& store_index = function.instructions[position];
                    const auto& load_index = function.instructions[position + 1u];
                    const auto& current = function.instructions[position + 2u];
                    const auto& component = function.instructions[position + 3u];
                    const auto& scale_a = function.instructions[position + 4u];
                    const auto multiply_a = function.instructions[position + 5u].opcode;
                    const auto& scale_b = function.instructions[position + 6u];
                    const auto multiply_b = function.instructions[position + 7u].opcode;
                    const auto arithmetic = function.instructions[position + 8u].opcode;
                    const auto& store = function.instructions[position + 9u];
                    return store_index.opcode == Opcode::LoadLocal &&
                        load_index.opcode == Opcode::LoadLocal &&
                        load_index.index == store_index.index &&
                        local_is_i64(store_index.index) &&
                        current.opcode == Opcode::LoadF64LocalsIndex &&
                        current.index_is_integral && !current.may_error &&
                        current.index_local &&
                        *current.index_local == store_index.index &&
                        component.opcode == Opcode::LoadLocal &&
                        scale_a.opcode == Opcode::LoadLocal &&
                        multiply_a == Opcode::MultiplyF64 &&
                        scale_b.opcode == Opcode::LoadLocal &&
                        multiply_b == Opcode::MultiplyF64 &&
                        (arithmetic == Opcode::AddF64 ||
                         arithmetic == Opcode::SubtractF64) &&
                        store.opcode == Opcode::StoreF64LocalsIndex &&
                        store.index_is_integral && !store.may_error &&
                        store.index_local &&
                        *store.index_local == store_index.index;
                };
                if (!lane_matches(start) || !lane_matches(start + 10u)) {
                    return std::nullopt;
                }
                const auto& first_index = function.instructions[start];
                const auto& second_index = function.instructions[start + 10u];
                const auto& first_current = function.instructions[start + 2u];
                const auto& second_current = function.instructions[start + 12u];
                const auto& first_component = function.instructions[start + 3u];
                const auto& second_component = function.instructions[start + 13u];
                const auto& first_scale_a = function.instructions[start + 4u];
                const auto& second_scale_a = function.instructions[start + 14u];
                const auto& first_scale_b = function.instructions[start + 6u];
                const auto& second_scale_b = function.instructions[start + 16u];
                const auto first_arithmetic = function.instructions[start + 8u].opcode;
                const auto second_arithmetic = function.instructions[start + 18u].opcode;
                const auto& first_store = function.instructions[start + 9u];
                const auto& second_store = function.instructions[start + 19u];
                if (second_index.index != first_index.index ||
                    second_current.index != first_current.index + 1u ||
                    second_current.argument_count + 1u != first_current.argument_count ||
                    second_component.index != first_component.index + 1u ||
                    second_scale_a.index != first_scale_a.index ||
                    second_scale_b.index != first_scale_b.index ||
                    second_arithmetic != first_arithmetic ||
                    second_store.index != first_store.index + 1u ||
                    second_store.argument_count + 1u != first_store.argument_count) {
                    return std::nullopt;
                }
                const bool triple = start + 29u < function.instructions.size() &&
                    lane_matches(start + 20u) &&
                    function.instructions[start + 20u].index == first_index.index &&
                    function.instructions[start + 22u].index == first_current.index + 2u &&
                    function.instructions[start + 23u].index == first_component.index + 2u &&
                    function.instructions[start + 24u].index == first_scale_a.index &&
                    function.instructions[start + 26u].index == first_scale_b.index &&
                    function.instructions[start + 28u].opcode == first_arithmetic &&
                    function.instructions[start + 29u].index == first_store.index + 2u;
                expression_index_cache = {};
                load_i64_to_rcx(first_index.index);
                code_.raw({0x48, 0xf7, 0xd9});
                emit_fixed_indexed_f64_load(
                    first_current.index, first_current.argument_count,
                    0u, 0xc8u);
                emit_fixed_indexed_f64_load(
                    second_current.index, second_current.argument_count,
                    1u, 0xc8u);
                code_.raw({0x66, 0x0f, 0x14, 0xc1});
                if (triple) {
                    const auto& third_current = function.instructions[start + 22u];
                    emit_fixed_indexed_f64_load(
                        third_current.index, third_current.argument_count,
                        3u, 0xc8u);
                }
                load_local(first_component.index, 1u);
                load_local(second_component.index, 2u);
                code_.raw({0x66, 0x0f, 0x14, 0xca});
                if (triple) {
                    load_local(function.instructions[start + 23u].index, 4u);
                }
                load_local(first_scale_a.index, 2u);
                if (triple) {
                    code_.raw({0x66, 0x0f, 0x28, 0xea,
                               0x66, 0x0f, 0x14, 0xed,
                               0x66, 0x0f, 0x59, 0xcd,
                               0xf2, 0x0f, 0x59, 0xe2});
                } else {
                    code_.raw({0x66, 0x0f, 0x14, 0xd2,
                               0x66, 0x0f, 0x59, 0xca});
                }
                load_local(first_scale_b.index, 2u);
                if (triple) {
                    code_.raw({0x66, 0x0f, 0x28, 0xea,
                               0x66, 0x0f, 0x14, 0xed,
                               0x66, 0x0f, 0x59, 0xcd});
                    if (policy_.fused_multiply_add &&
                        vkf::target::host_x64_supports_fma()) {
                        code_.raw({0xc4, 0xe2, 0xd9,
                                   first_arithmetic == Opcode::AddF64 ? 0xb9u : 0xbdu,
                                   0xda});
                    } else {
                        code_.raw({0xf2, 0x0f, 0x59, 0xe2,
                                   0xf2, 0x0f,
                                   first_arithmetic == Opcode::AddF64 ? 0x58u : 0x5cu,
                                   0xdc});
                    }
                    code_.raw({0x66, 0x0f,
                               first_arithmetic == Opcode::AddF64 ? 0x58u : 0x5cu,
                               0xc1});
                } else {
                    code_.raw({0x66, 0x0f, 0x14, 0xd2,
                               0x66, 0x0f, 0x59, 0xca,
                               0x66, 0x0f,
                               first_arithmetic == Opcode::AddF64 ? 0x58u : 0x5cu,
                               0xc1});
                }
                emit_fixed_indexed_f64_store(
                    first_store.index, first_store.argument_count,
                    0u, 0xc8u, false);
                emit_fixed_indexed_f64_store(
                    second_store.index, second_store.argument_count,
                    0u, 0xc8u, true);
                if (triple) {
                    const auto& third_store = function.instructions[start + 29u];
                    emit_fixed_indexed_f64_store(
                        third_store.index, third_store.argument_count,
                        3u, 0xc8u, false);
                }
                expression_index_cache = {};
                return start + (triple ? 29u : 19u);
            };
        for (std::size_t instruction_index = 0;
             instruction_index < function.instructions.size(); ++instruction_index) {
            const auto& instruction = function.instructions[instruction_index];
            using vkf::machine_ir::Opcode;
            const auto opcode = instruction.opcode;
            if (stack_depth == 0 && opcode == Opcode::LoadLocal &&
                instruction_index + 2 < function.instructions.size()) {
                const auto& validation = function.instructions[instruction_index + 1];
                const auto& discard = function.instructions[instruction_index + 2];
                if (validation.opcode == Opcode::LoadF64LocalsIndex &&
                    validation.index_local && *validation.index_local == instruction.index &&
                    index_lower_bound_proven[instruction_index + 1] &&
                    index_upper_bound_proven[instruction_index + 1] &&
                    discard.opcode == Opcode::Drop) {
                    instruction_index += 2;
                    continue;
                }
            }
            if (stack_depth == 0) {
                const auto pair_interaction =
                    emit_vector3_pair_interaction(instruction_index);
                if (pair_interaction) {
                    instruction_index = *pair_interaction;
                    continue;
                }
                const auto packed_scaled_vector3 =
                    emit_packed_scaled_vector3_update(instruction_index);
                if (packed_scaled_vector3) {
                    instruction_index = *packed_scaled_vector3;
                    continue;
                }
                const auto packed_affine =
                    emit_packed_affine_indexed_pair(instruction_index);
                if (packed_affine) {
                    instruction_index = *packed_affine;
                    continue;
                }
            }
            if (opcode == Opcode::Label) {
                expression_index_cache = {};
                const auto packed_matrix = policy_.packed_matrix_reductions &&
                        policy_.native_integer_locals
                    ? detect_packed_matrix_reduction_loop(function, instruction_index)
                    : std::nullopt;
                if (packed_matrix) {
                    if (stack_depth != 0) {
                        throw BackendFailure("packed matrix reduction requires empty x64 machine stack");
                    }
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate x64 machine IR label");
                    }
                    emit_packed_matrix_reduction(*packed_matrix);
                    instruction_index = packed_matrix->end_index;
                    continue;
                }
                const auto packed_dot = policy_.packed_dot_reductions &&
                        policy_.native_integer_locals
                    ? detect_packed_dot_reduction_loop(function, instruction_index)
                    : std::nullopt;
                if (packed_dot) {
                    if (stack_depth != 0) {
                        throw BackendFailure("packed dot reduction requires empty x64 machine stack");
                    }
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate x64 machine IR label");
                    }
                    emit_packed_dot_reduction(*packed_dot);
                    instruction_index = packed_dot->end_index;
                    continue;
                }
                const auto numeric_map = policy_.dense_numeric_maps
                    ? detect_dense_numeric_map_loop(function, instruction_index)
                    : std::nullopt;
                if (numeric_map) {
                    if (stack_depth != 0) {
                        throw BackendFailure("dense numeric map loop requires empty x64 machine stack");
                    }
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate x64 machine IR label");
                    }
                    emit_dense_numeric_map_loop(frame, *numeric_map);
                    instruction_index = numeric_map->end_index;
                    continue;
                }
                const auto dense_map = policy_.dense_affine_maps
                    ? detect_dense_affine_map_loop(function, instruction_index)
                    : std::nullopt;
                if (dense_map) {
                    if (stack_depth != 0) {
                        throw BackendFailure("dense affine map loop requires empty x64 machine stack");
                    }
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate x64 machine IR label");
                    }
                    emit_dense_affine_map_loop(frame, *dense_map);
                    instruction_index = dense_map->end_index;
                    continue;
                }
                const auto scalar_loop = detect_scalar_recurrence_loop(function, instruction_index);
                if (scalar_loop) {
                    if (stack_depth != 0) {
                        throw BackendFailure("scalar recurrence loop requires empty x64 machine stack");
                    }
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate x64 machine IR label");
                    }
                    emit_scalar_recurrence_loop(frame, *scalar_loop);
                    instruction_index = scalar_loop->end_index;
                    continue;
                }
                const auto avx_loop = policy_.avx_affine_loops
                    ? detect_avx_affine_loop(function, instruction_index)
                    : std::nullopt;
                if (avx_loop) {
                    if (stack_depth != 0) {
                        throw BackendFailure("AVX affine loop requires empty x64 machine stack");
                    }
                    align_loop_header(instruction.label);
                    if (!labels.emplace(instruction.label, code_.position()).second) {
                        throw BackendFailure("duplicate x64 machine IR label");
                    }
                    emit_affine_loop(frame, *avx_loop);
                    instruction_index = avx_loop->end_index;
                    continue;
                }
            }
            {
                if (stack_depth == 0 &&
                    instruction.opcode == Opcode::LoadLocal &&
                    instruction_index + 1 < function.instructions.size() &&
                    function.instructions[instruction_index + 1].opcode == Opcode::Drop) {
                    ++instruction_index;
                    continue;
                }
                if (instruction_index + 1 < function.instructions.size()) {
                    const auto& value = function.instructions[instruction_index];
                    const auto& store = function.instructions[instruction_index + 1];
                    if (value.opcode == Opcode::PushF64 &&
                        value.f64 == std::floor(value.f64) &&
                        value.f64 >= static_cast<double>(
                            std::numeric_limits<std::int32_t>::min()) &&
                        value.f64 <= static_cast<double>(
                            std::numeric_limits<std::int32_t>::max()) &&
                        store.opcode == Opcode::StoreLocal &&
                        local_is_i64(store.index)) {
                        code_.raw({0x48, 0xb8});
                        code_.u64(static_cast<std::uint64_t>(
                            static_cast<std::int64_t>(value.f64)));
                        store_rax_to_i64(store.index);
                        ++instruction_index;
                        continue;
                    }
                }
                if (instruction_index + 3 < function.instructions.size()) {
                    const auto& left = function.instructions[instruction_index];
                    const auto& right = function.instructions[instruction_index + 1];
                    const auto arithmetic = function.instructions[instruction_index + 2].opcode;
                    const auto& store = function.instructions[instruction_index + 3];
                    const auto integral_constant = [&](const auto& operand) {
                        return operand.opcode == Opcode::PushF64 &&
                            operand.f64 == std::floor(operand.f64) &&
                            operand.f64 >= static_cast<double>(
                                std::numeric_limits<std::int32_t>::min()) &&
                            operand.f64 <= static_cast<double>(
                                std::numeric_limits<std::int32_t>::max());
                    };
                    const auto integral_operand = [&](const auto& operand) {
                        return (operand.opcode == Opcode::LoadLocal &&
                                local_is_i64(operand.index)) ||
                            integral_constant(operand);
                    };
                    if (integral_operand(left) && integral_operand(right) &&
                        (arithmetic == Opcode::AddF64 ||
                         arithmetic == Opcode::SubtractF64 ||
                         arithmetic == Opcode::MultiplyF64) &&
                        store.opcode == Opcode::StoreLocal && local_is_i64(store.index)) {
                        if (left.opcode == Opcode::LoadLocal) {
                            load_i64_to_rax(left.index);
                        } else {
                            code_.raw({0x48, 0xb8});
                            code_.u64(static_cast<std::uint64_t>(
                                static_cast<std::int64_t>(left.f64)));
                        }
                        if (right.opcode == Opcode::LoadLocal) {
                            const int cached = integer_register[right.index];
                            if (cached >= 0) {
                                if (arithmetic == Opcode::MultiplyF64) {
                                    code_.raw({0x49, 0x0f, 0xaf,
                                               static_cast<unsigned>(0xc0 + (cached & 7))});
                                } else {
                                    code_.raw({0x49,
                                               arithmetic == Opcode::AddF64 ? 0x03u : 0x2bu,
                                               static_cast<unsigned>(0xc0 + (cached & 7))});
                                }
                            } else if (arithmetic == Opcode::MultiplyF64) {
                                code_.raw({0x48, 0x0f, 0xaf, 0x85});
                                code_.i32(frame.displacement(right.index));
                            } else {
                                code_.raw({0x48,
                                           arithmetic == Opcode::AddF64 ? 0x03u : 0x2bu,
                                           0x85});
                                code_.i32(frame.displacement(right.index));
                            }
                        } else if (arithmetic == Opcode::MultiplyF64) {
                            code_.raw({0x48, 0x69, 0xc0});
                            code_.i32(static_cast<std::int32_t>(right.f64));
                        } else {
                            code_.raw({0x48,
                                       arithmetic == Opcode::AddF64 ? 0x05u : 0x2du});
                            code_.i32(static_cast<std::int32_t>(right.f64));
                        }
                        store_rax_to_i64(store.index);
                        instruction_index += 3;
                        continue;
                    }
                }
                if (stack_depth == 0) {
                    const auto expression = expression_plan_at(instruction_index);
                    if (expression) {
                        emit_expression_plan(*expression);
                        instruction_index = expression->store_position;
                        continue;
                    }
                }
            }
            expression_index_cache = {};
            if (instruction_index + 5 < function.instructions.size()) {
                const auto& dividend = function.instructions[instruction_index];
                const auto& divisor = function.instructions[instruction_index + 1];
                const auto remainder = function.instructions[instruction_index + 2].opcode;
                const auto& zero = function.instructions[instruction_index + 3];
                const auto compare = function.instructions[instruction_index + 4].opcode;
                const auto& jump = function.instructions[instruction_index + 5];
                const bool supported_compare = compare == Opcode::OrderedEqualF64 ||
                    compare == Opcode::UnorderedNotEqualF64;
                const bool supported_jump = jump.opcode == Opcode::JumpIfFalse ||
                    jump.opcode == Opcode::JumpIfTrue;
                const auto divisor_value = divisor.opcode == Opcode::PushF64
                    ? static_cast<std::int64_t>(divisor.f64) : 0;
                const auto absolute_divisor = divisor_value < 0 ? -divisor_value : divisor_value;
                const bool power_of_two = absolute_divisor > 0 && absolute_divisor <= 256 &&
                    (absolute_divisor & (absolute_divisor - 1)) == 0 &&
                    divisor.f64 == static_cast<double>(divisor_value);
                if (policy_.parity_specialization &&
                    dividend.opcode == Opcode::LoadLocal && local_is_i64(dividend.index) &&
                    power_of_two && remainder == Opcode::RemainderF64 &&
                    zero.opcode == Opcode::PushF64 && zero.f64 == 0.0 &&
                    supported_compare && supported_jump) {
                    // For signed integers, divisibility by 2^n is exactly a test
                    // of the low n bits. This removes both floating conversions
                    // and the division used by the generic remainder path.
                    const int cached = integer_register[dividend.index];
                    if (cached < 0) {
                        code_.raw({0xf6, 0x85});
                        code_.i32(frame.displacement(dividend.index));
                        code_.raw({static_cast<unsigned>(absolute_divisor - 1)});
                    } else {
                        code_.raw({0x41, 0xf6,
                                   static_cast<unsigned>(0xc0 + (cached & 7)),
                                   static_cast<unsigned>(absolute_divisor - 1)});
                    }
                    const bool result_when_zero = compare == Opcode::OrderedEqualF64;
                    const bool branch_on_result = jump.opcode == Opcode::JumpIfTrue;
                    const bool branch_when_zero = result_when_zero == branch_on_result;
                    branches.push_back({
                        emit_jump(branch_when_zero ? 0x84 : 0x85), jump.label
                    });
                    instruction_index += 5;
                    continue;
                }
            }
            {
                const auto left = fused_operand_at(instruction_index);
                const auto right = left ? fused_operand_at(left->next) : std::nullopt;
                if (left && right && right->next < function.instructions.size()) {
                    const auto arithmetic = function.instructions[right->next].opcode;
                    const bool supported = arithmetic == Opcode::AddF64 ||
                        arithmetic == Opcode::SubtractF64 ||
                        arithmetic == Opcode::MultiplyF64 ||
                        arithmetic == Opcode::DivideF64;
                    const bool has_index = left->kind == FusedOperand::Kind::ProvenFixedIndex ||
                        right->kind == FusedOperand::Kind::ProvenFixedIndex;
                    if (supported && has_index) {
                        emit_fused_operand(*left, 1);
                        emit_fused_operand(*right, 0);
                        const unsigned machine = arithmetic == Opcode::AddF64 ? 0x58
                            : arithmetic == Opcode::SubtractF64 ? 0x5c
                            : arithmetic == Opcode::MultiplyF64 ? 0x59 : 0x5e;
                        code_.raw({0xf2, 0x0f, machine, 0xc8,
                                   0x66, 0x0f, 0x28, 0xc1});
                        const auto after_arithmetic = right->next + 1;
                        if (after_arithmetic < function.instructions.size() &&
                            function.instructions[after_arithmetic].opcode == Opcode::StoreLocal) {
                            store_local(function.instructions[after_arithmetic].index, 0);
                            instruction_index = after_arithmetic;
                        } else {
                            store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                            ++stack_depth;
                            instruction_index = right->next;
                            if (stack_depth > frame.max_stack) {
                                throw BackendFailure("x64 machine IR stack exceeds frame");
                            }
                        }
                        continue;
                    }
                }
            }
            if (instruction_index + 3 < function.instructions.size()) {
                const auto& left = function.instructions[instruction_index];
                const auto& right = function.instructions[instruction_index + 1];
                const auto compare = function.instructions[instruction_index + 2].opcode;
                const auto& jump = function.instructions[instruction_index + 3];
                const auto is_operand = [](const vkf::machine_ir::Instruction& operand) {
                    return operand.opcode == Opcode::LoadLocal ||
                        operand.opcode == Opcode::PushF64;
                };
                const bool comparison = compare == Opcode::OrderedLessF64 ||
                    compare == Opcode::OrderedLessEqualF64 ||
                    compare == Opcode::OrderedGreaterF64 ||
                    compare == Opcode::OrderedGreaterEqualF64 ||
                    compare == Opcode::OrderedEqualF64 ||
                    compare == Opcode::UnorderedNotEqualF64;
                if (is_operand(left) && is_operand(right) && comparison &&
                    (jump.opcode == Opcode::JumpIfFalse || jump.opcode == Opcode::JumpIfTrue)) {
                    const bool integer_left = left.opcode == Opcode::LoadLocal &&
                        local_is_i64(left.index);
                    const bool integer_constant_right = right.opcode == Opcode::PushF64 &&
                        right.f64 == std::floor(right.f64) &&
                        right.f64 >= static_cast<double>(std::numeric_limits<std::int32_t>::min()) &&
                        right.f64 <= static_cast<double>(std::numeric_limits<std::int32_t>::max());
                    const bool integer_local_right = right.opcode == Opcode::LoadLocal &&
                        local_is_i64(right.index);
                    if (integer_left && (integer_constant_right || integer_local_right)) {
                        load_i64_to_rax(left.index);
                        if (integer_constant_right) {
                            code_.raw({0x48, 0x3d});
                            code_.i32(static_cast<std::int32_t>(right.f64));
                        } else {
                            const int cached = integer_register[right.index];
                            if (cached < 0) {
                                code_.raw({0x48, 0x3b, 0x85});
                                code_.i32(frame.displacement(right.index));
                            } else {
                                code_.raw({0x49, 0x3b,
                                           static_cast<unsigned>(0xc0 + (cached & 7))});
                            }
                        }
                        const unsigned true_condition = compare == Opcode::OrderedLessF64 ? 0x8c
                            : compare == Opcode::OrderedLessEqualF64 ? 0x8e
                            : compare == Opcode::OrderedGreaterF64 ? 0x8f
                            : compare == Opcode::OrderedGreaterEqualF64 ? 0x8d
                            : compare == Opcode::OrderedEqualF64 ? 0x84 : 0x85;
                        const unsigned false_condition = compare == Opcode::OrderedLessF64 ? 0x8d
                            : compare == Opcode::OrderedLessEqualF64 ? 0x8f
                            : compare == Opcode::OrderedGreaterF64 ? 0x8e
                            : compare == Opcode::OrderedGreaterEqualF64 ? 0x8c
                            : compare == Opcode::OrderedEqualF64 ? 0x85 : 0x84;
                        branches.push_back({
                            emit_jump(jump.opcode == Opcode::JumpIfTrue
                                ? true_condition : false_condition),
                            jump.label
                        });
                        instruction_index += 3;
                        continue;
                    }
                    const auto load_operand = [&](
                        const vkf::machine_ir::Instruction& operand, unsigned reg) {
                        if (operand.opcode == Opcode::PushF64) emit_number(operand.f64, reg);
                        else {
                            if (operand.index >= frame.local_count) {
                                throw BackendFailure("invalid branch-fusion x64 local slot");
                            }
                            load_local(operand.index, reg);
                        }
                    };
                    load_operand(left, 1);
                    load_operand(right, 0);
                    code_.raw({0x66, 0x0f, 0x2e, 0xc8});
                    const auto to_label = [&](unsigned condition) {
                        branches.push_back({emit_jump(condition), jump.label});
                    };
                    const auto around = [&](unsigned condition) {
                        const auto skip = emit_jump(condition);
                        return skip;
                    };
                    if (jump.opcode == Opcode::JumpIfFalse) {
                        if (compare == Opcode::OrderedLessF64) {
                            to_label(0x83); to_label(0x8a);
                        } else if (compare == Opcode::OrderedLessEqualF64) {
                            to_label(0x87); to_label(0x8a);
                        } else if (compare == Opcode::OrderedGreaterF64) to_label(0x86);
                        else if (compare == Opcode::OrderedGreaterEqualF64) to_label(0x82);
                        else if (compare == Opcode::OrderedEqualF64) {
                            to_label(0x85); to_label(0x8a);
                        } else {
                            const auto unordered = around(0x8a);
                            to_label(0x84);
                            code_.patch_rel32(unordered, code_.position());
                        }
                    } else {
                        if (compare == Opcode::OrderedLessF64 ||
                            compare == Opcode::OrderedLessEqualF64 ||
                            compare == Opcode::OrderedEqualF64) {
                            const auto unordered = around(0x8a);
                            to_label(compare == Opcode::OrderedLessF64 ? 0x82
                                : compare == Opcode::OrderedLessEqualF64 ? 0x86 : 0x84);
                            code_.patch_rel32(unordered, code_.position());
                        } else if (compare == Opcode::OrderedGreaterF64) to_label(0x87);
                        else if (compare == Opcode::OrderedGreaterEqualF64) to_label(0x83);
                        else {
                            to_label(0x85); to_label(0x8a);
                        }
                    }
                    instruction_index += 3;
                    continue;
                }
            }
            if (instruction_index + 3 < function.instructions.size()) {
                const auto& left = function.instructions[instruction_index];
                const auto& right = function.instructions[instruction_index + 1];
                const auto arithmetic = function.instructions[instruction_index + 2].opcode;
                const auto& store = function.instructions[instruction_index + 3];
                const auto is_operand = [](const vkf::machine_ir::Instruction& operand) {
                    return operand.opcode == Opcode::LoadLocal ||
                        operand.opcode == Opcode::PushF64;
                };
                if (is_operand(left) && is_operand(right) &&
                    (arithmetic == Opcode::AddF64 || arithmetic == Opcode::SubtractF64 ||
                     arithmetic == Opcode::MultiplyF64 || arithmetic == Opcode::DivideF64) &&
                    store.opcode == Opcode::StoreLocal) {
                    const auto load_operand = [&](
                        const vkf::machine_ir::Instruction& operand, unsigned reg) {
                        if (operand.opcode == Opcode::PushF64) emit_number(operand.f64, reg);
                        else {
                            if (operand.index >= frame.local_count) {
                                throw BackendFailure("invalid store-fusion x64 local slot");
                            }
                            load_local(operand.index, reg);
                        }
                    };
                    if (store.index >= frame.local_count) {
                        throw BackendFailure("invalid fused x64 store slot");
                    }
                    load_operand(left, 1);
                    load_operand(right, 0);
                    const unsigned machine = arithmetic == Opcode::AddF64 ? 0x58
                        : arithmetic == Opcode::SubtractF64 ? 0x5c
                        : arithmetic == Opcode::MultiplyF64 ? 0x59 : 0x5e;
                    code_.raw({0xf2, 0x0f, machine, 0xc8,
                               0x66, 0x0f, 0x28, 0xc1});
                    store_local(store.index, 0);
                    instruction_index += 3;
                    continue;
                }
            }
            if (instruction_index + 6 < function.instructions.size()) {
                const auto& left_a = function.instructions[instruction_index];
                const auto& right_a = function.instructions[instruction_index + 1];
                const auto& multiply_a = function.instructions[instruction_index + 2];
                const auto& left_b = function.instructions[instruction_index + 3];
                const auto& right_b = function.instructions[instruction_index + 4];
                const auto& multiply_b = function.instructions[instruction_index + 5];
                const auto combine = function.instructions[instruction_index + 6].opcode;
                const auto is_operand = [](const vkf::machine_ir::Instruction& operand) {
                    return operand.opcode == Opcode::LoadLocal ||
                        operand.opcode == Opcode::PushF64;
                };
                if (is_operand(left_a) && is_operand(right_a) &&
                    multiply_a.opcode == Opcode::MultiplyF64 &&
                    is_operand(left_b) && is_operand(right_b) &&
                    multiply_b.opcode == Opcode::MultiplyF64 &&
                    (combine == Opcode::AddF64 || combine == Opcode::SubtractF64)) {
                    const auto load_operand = [&](
                        const vkf::machine_ir::Instruction& operand, unsigned reg) {
                        if (operand.opcode == Opcode::PushF64) emit_number(operand.f64, reg);
                        else {
                            if (operand.index >= frame.local_count) {
                                throw BackendFailure("invalid product-sum x64 local slot");
                            }
                            load_local(operand.index, reg);
                        }
                    };
                    load_operand(left_a, 1);
                    load_operand(right_a, 0);
                    code_.raw({0xf2, 0x0f, 0x59, 0xc8});
                    load_operand(left_b, 2);
                    load_operand(right_b, 0);
                    code_.raw({0xf2, 0x0f, 0x59, 0xd0});
                    code_.raw({0xf2, 0x0f,
                               combine == Opcode::AddF64 ? 0x58u : 0x5cu, 0xca,
                               0x66, 0x0f, 0x28, 0xc1});
                    store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                    ++stack_depth;
                    instruction_index += 6;
                    if (stack_depth > frame.max_stack) {
                        throw BackendFailure("x64 machine IR stack exceeds frame");
                    }
                    continue;
                }
            }
            if (instruction_index + 2 < function.instructions.size()) {
                const auto& left = function.instructions[instruction_index];
                const auto& right = function.instructions[instruction_index + 1];
                const auto fused_opcode = function.instructions[instruction_index + 2].opcode;
                const bool left_operand = left.opcode == Opcode::LoadLocal || left.opcode == Opcode::PushF64;
                const bool right_operand = right.opcode == Opcode::LoadLocal || right.opcode == Opcode::PushF64;
                const bool fused_arithmetic = fused_opcode == Opcode::AddF64 ||
                    fused_opcode == Opcode::SubtractF64 || fused_opcode == Opcode::MultiplyF64 ||
                    fused_opcode == Opcode::DivideF64;
                const bool fused_comparison = fused_opcode == Opcode::OrderedLessF64 ||
                    fused_opcode == Opcode::OrderedLessEqualF64 ||
                    fused_opcode == Opcode::OrderedGreaterF64 ||
                    fused_opcode == Opcode::OrderedGreaterEqualF64 ||
                    fused_opcode == Opcode::OrderedEqualF64 ||
                    fused_opcode == Opcode::UnorderedNotEqualF64;
                if (left_operand && right_operand && (fused_arithmetic || fused_comparison)) {
                    const auto load_operand = [&](const vkf::machine_ir::Instruction& operand, unsigned reg) {
                        if (operand.opcode == Opcode::PushF64) {
                            emit_number(operand.f64, reg);
                        } else {
                            if (operand.index >= frame.local_count) {
                                throw BackendFailure("invalid fused x64 local slot");
                            }
                            load_local(operand.index, reg);
                        }
                    };
                    load_operand(left, 1);
                    load_operand(right, 0);
                    if (fused_arithmetic) {
                        const unsigned machine = fused_opcode == Opcode::AddF64 ? 0x58
                            : fused_opcode == Opcode::SubtractF64 ? 0x5c
                            : fused_opcode == Opcode::MultiplyF64 ? 0x59 : 0x5e;
                        code_.raw({0xf2, 0x0f, machine, 0xc8,
                                   0x66, 0x0f, 0x28, 0xc1});
                    } else {
                        emit_comparison(fused_opcode);
                    }
                    store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                    ++stack_depth;
                    instruction_index += 2;
                    if (stack_depth > frame.max_stack) {
                        throw BackendFailure("x64 machine IR stack exceeds frame");
                    }
                    continue;
                }
            }
            if (opcode == Opcode::PushF64) {
                emit_number(instruction.f64);
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::PushNull) {
                emit_number(vkf::machine_ir::null_value());
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::PushString) {
                emit_string_address(instruction.index);
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                emit_number(static_cast<double>(instruction.byte_count));
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth + 1));
                stack_depth += 2;
            } else if (opcode == Opcode::FormatF64String) {
                require_stack(stack_depth, 1);
                const unsigned first = stack_depth - 1;
                emit_format_f64_string(frame, first, instruction);
                stack_depth = first + 2;
            } else if (opcode == Opcode::FormatBitString) {
                require_stack(stack_depth, 1);
                const unsigned first = stack_depth - 1;
                emit_format_bit_string(frame, first, instruction);
                stack_depth = first + 2;
            } else if (opcode == Opcode::FormatChrString) {
                require_stack(stack_depth, 1);
                const unsigned first = stack_depth - 1;
                emit_format_chr_string(frame, first);
                stack_depth = first + 2;
            } else if (opcode == Opcode::DecodeUtf8At) {
                require_stack(stack_depth, 3);
                const unsigned first = stack_depth - 3;
                emit_decode_utf8_at(frame, first);
                stack_depth = first + 2;
            } else if (opcode == Opcode::CloneString) {
                require_stack(stack_depth, 2);
                const unsigned first = stack_depth - 2;
                load_xmm(0, frame.displacement(frame.temp_base + first + 1));
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8, 0x48, 0x85, 0xc9, 0x0f, 0x89});
                const auto decoded = code_.rel32_placeholder();
                code_.raw({0x48, 0xf7, 0xd9, 0x48, 0xff, 0xc9});
                code_.patch_rel32(decoded, code_.position());
                code_.raw({0x48, 0x89, 0xc8, 0x48, 0x83, 0xc0, 0x09, 0x0f, 0x83});
                const auto size_valid = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(size_valid, code_.position());
                move_pointer_argument_from_rax();
                call_runtime_slot(8);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto allocated = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(allocated, code_.position());
                load_xmm(0, frame.displacement(frame.temp_base + first + 1));
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8, 0x48, 0x85, 0xc9, 0x0f, 0x89});
                const auto length_decoded = code_.rel32_placeholder();
                code_.raw({0x48, 0xf7, 0xd9, 0x48, 0xff, 0xc9});
                code_.patch_rel32(length_decoded, code_.position());
                code_.raw({0x48, 0x89, 0x08, 0x4c, 0x8d, 0x58, 0x08, 0x4c, 0x8b, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x49, 0x89, 0xc8, 0x48, 0x85, 0xc9, 0x0f, 0x84});
                const auto empty = code_.rel32_placeholder();
                const auto copy = code_.position();
                code_.raw({0x41, 0x8a, 0x12, 0x41, 0x88, 0x13, 0x49, 0xff, 0xc2,
                           0x49, 0xff, 0xc3, 0x48, 0xff, 0xc9, 0x0f, 0x85});
                const auto repeat = code_.rel32_placeholder();
                code_.patch_rel32(repeat, copy);
                code_.patch_rel32(empty, code_.position());
                code_.raw({0x41, 0xc6, 0x03, 0x00, 0x48, 0x83, 0xc0, 0x08, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x49, 0x8d, 0x48, 0x01, 0x48, 0xf7, 0xd9,
                           0xf2, 0x48, 0x0f, 0x2a, 0xc1});
                store_xmm(0, frame.displacement(frame.temp_base + first + 1));
            } else if (opcode == Opcode::ConcatStrings) {
                require_stack(stack_depth, 4);
                const unsigned first = stack_depth - 4;
                load_xmm(0, frame.displacement(frame.temp_base + first + 1));
                code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xc0, 0x4d, 0x85, 0xc0, 0x0f, 0x89});
                const auto left_decoded = code_.rel32_placeholder();
                code_.raw({0x49, 0xf7, 0xd8, 0x49, 0xff, 0xc8});
                code_.patch_rel32(left_decoded, code_.position());
                load_xmm(0, frame.displacement(frame.temp_base + first + 3));
                code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xc8, 0x4d, 0x85, 0xc9, 0x0f, 0x89});
                const auto right_decoded = code_.rel32_placeholder();
                code_.raw({0x49, 0xf7, 0xd9, 0x49, 0xff, 0xc9});
                code_.patch_rel32(right_decoded, code_.position());
                code_.raw({0x4c, 0x89, 0xc0, 0x4c, 0x01, 0xc8, 0x0f, 0x83});
                const auto length_valid = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(length_valid, code_.position());
                code_.raw({0x48, 0x83, 0xc0, 0x09, 0x0f, 0x83});
                const auto size_valid = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(size_valid, code_.position());
                move_pointer_argument_from_rax();
                call_runtime_slot(8);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto allocated = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(allocated, code_.position());
                load_xmm(0, frame.displacement(frame.temp_base + first + 1));
                code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xc0, 0x4d, 0x85, 0xc0, 0x0f, 0x89});
                const auto left_length_decoded = code_.rel32_placeholder();
                code_.raw({0x49, 0xf7, 0xd8, 0x49, 0xff, 0xc8});
                code_.patch_rel32(left_length_decoded, code_.position());
                load_xmm(0, frame.displacement(frame.temp_base + first + 3));
                code_.raw({0xf2, 0x4c, 0x0f, 0x2c, 0xc8, 0x4d, 0x85, 0xc9, 0x0f, 0x89});
                const auto right_length_decoded = code_.rel32_placeholder();
                code_.raw({0x49, 0xf7, 0xd9, 0x49, 0xff, 0xc9});
                code_.patch_rel32(right_length_decoded, code_.position());
                code_.raw({0x4c, 0x89, 0xc1, 0x4c, 0x01, 0xc9, 0x48, 0x89, 0x08,
                           0x4c, 0x8d, 0x58, 0x08, 0x4c, 0x8b, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x48, 0x8b, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first + 2));
                code_.raw({0x4d, 0x85, 0xc0, 0x0f, 0x84});
                const auto left_empty = code_.rel32_placeholder();
                const auto copy_left = code_.position();
                code_.raw({0x41, 0x8a, 0x0a, 0x41, 0x88, 0x0b, 0x49, 0xff, 0xc2,
                           0x49, 0xff, 0xc3, 0x49, 0xff, 0xc8, 0x0f, 0x85});
                const auto repeat_left = code_.rel32_placeholder();
                code_.patch_rel32(repeat_left, copy_left);
                code_.patch_rel32(left_empty, code_.position());
                code_.raw({0x4d, 0x85, 0xc9, 0x0f, 0x84});
                const auto right_empty = code_.rel32_placeholder();
                const auto copy_right = code_.position();
                code_.raw({0x8a, 0x0a, 0x41, 0x88, 0x0b, 0x48, 0xff, 0xc2,
                           0x49, 0xff, 0xc3, 0x49, 0xff, 0xc9, 0x0f, 0x85});
                const auto repeat_right = code_.rel32_placeholder();
                code_.patch_rel32(repeat_right, copy_right);
                code_.patch_rel32(right_empty, code_.position());
                code_.raw({0x41, 0xc6, 0x03, 0x00, 0x4c, 0x8b, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x48, 0x83, 0xc0, 0x08, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                if (instruction.owns_left) {
                    load_xmm(0, frame.displacement(frame.temp_base + first + 1));
                    code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8, 0x48, 0x85, 0xc9, 0x0f, 0x89});
                    const auto borrowed = code_.rel32_placeholder();
#ifdef _WIN32
                    code_.raw({0x49, 0x8d, 0x4a, 0xf8});
#else
                    code_.raw({0x49, 0x8d, 0x7a, 0xf8});
#endif
                    call_runtime_slot(9);
                    code_.patch_rel32(borrowed, code_.position());
                }
                if (instruction.owns_right) {
                    release_owned_string(
                        frame.displacement(frame.temp_base + first + 2),
                        frame.displacement(frame.temp_base + first + 3));
                }
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x48, 0x8b, 0x48, 0xf8, 0x48, 0xff, 0xc1, 0x48, 0xf7, 0xd9,
                           0xf2, 0x48, 0x0f, 0x2a, 0xc1});
                store_xmm(0, frame.displacement(frame.temp_base + first + 1));
                stack_depth = first + 2;
            } else if (opcode == Opcode::WriteString) {
                require_stack(stack_depth, 2);
                const unsigned first = stack_depth - 2;
                load_xmm(0, frame.displacement(frame.temp_base + first + 1));
#ifdef _WIN32
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc0,
                           0x49, 0x89, 0xc0,
                           0x4d, 0x85, 0xc0, 0x0f, 0x89});
                const auto decoded = code_.rel32_placeholder();
                code_.raw({0x49, 0xf7, 0xd8, 0x49, 0xff, 0xc8});
                code_.patch_rel32(decoded, code_.position());
                code_.raw({0x48, 0x8b, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0xb9}); code_.i32(static_cast<std::int32_t>(instruction.index));
                call_runtime_slot(13);
#else
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc0,
                           0x48, 0x89, 0xc2,
                           0x48, 0x85, 0xd2, 0x0f, 0x89});
                const auto decoded = code_.rel32_placeholder();
                code_.raw({0x48, 0xf7, 0xda, 0x48, 0xff, 0xca});
                code_.patch_rel32(decoded, code_.position());
                code_.raw({0x48, 0x8b, 0xb5});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0xbf}); code_.i32(static_cast<std::int32_t>(instruction.index));
                code_.raw({
                           0xb8, 0x01, 0x00, 0x00, 0x00,
                           0x0f, 0x05});
#endif
                if (instruction.owns_input) {
                    code_.raw({0x48, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.temp_base + first));
                    code_.raw({0x48, 0x83, 0xe8, 0x08});
                    release_pointer_in_rax();
                }
                stack_depth = first;
            } else if (opcode == Opcode::ReadLineString) {
                const unsigned first = stack_depth;
                emit_read_line_string(frame, first);
                stack_depth = first + 2;
            } else if (opcode == Opcode::ReadFileString) {
                require_stack(stack_depth, 2);
                const unsigned first = stack_depth - 2;
                emit_read_file_string(
                    function, frame, first, instruction, entry, branches);
                stack_depth = first + 2;
            } else if (opcode == Opcode::WriteFileString) {
                require_stack(stack_depth, 4);
                const unsigned first = stack_depth - 4;
                emit_write_file_string(
                    function, frame, first, instruction, entry, branches);
                stack_depth = first + 1;
            } else if (opcode == Opcode::StringEqual || opcode == Opcode::StringNotEqual ||
                       opcode == Opcode::StringLess || opcode == Opcode::StringLessEqual ||
                       opcode == Opcode::StringGreater || opcode == Opcode::StringGreaterEqual) {
                require_stack(stack_depth, 4);
                const unsigned first = stack_depth - 4;
                emit_string_comparison(
                    opcode, frame, first, instruction.owns_left, instruction.owns_right);
                stack_depth = first + 1;
            } else if (opcode == Opcode::LoadLocal) {
                if (instruction.index >= frame.local_count) throw BackendFailure("invalid x64 local slot");
                load_local(instruction.index, 0);
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::StoreLocal) {
                require_stack(stack_depth, 1);
                --stack_depth;
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                store_local(instruction.index, 0);
            } else if (opcode == Opcode::Drop) {
                require_stack(stack_depth, 1);
                --stack_depth;
            } else if (opcode == Opcode::Duplicate) {
                require_stack(stack_depth, 1);
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::IdentityF64 || opcode == Opcode::NegateF64 ||
                       opcode == Opcode::LogicalNotF64 || opcode == Opcode::BooleanizeF64) {
                require_stack(stack_depth, 1);
                if (opcode == Opcode::NegateF64) {
                    load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                    code_.raw({0x66, 0x0f, 0x57, 0xc9});
                    code_.raw({0xf2, 0x0f, 0x5c, 0xc8});
                    code_.raw({0x66, 0x0f, 0x28, 0xc1});
                    store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                } else if (opcode == Opcode::LogicalNotF64) {
                    load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                    emit_truth_to_al(0);
                    code_.raw({0x34, 0x01});
                    emit_al_as_f64();
                    store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                } else if (opcode == Opcode::BooleanizeF64) {
                    load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                    emit_truth_to_al(0);
                    emit_al_as_f64();
                    store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                }
            } else if (opcode == Opcode::AbsF64) {
                require_stack(stack_depth, 1);
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                code_.raw({0x48, 0xb8});
                code_.u64(0x7fffffffffffffffull);
                code_.raw({0x66, 0x48, 0x0f, 0x6e, 0xc8, 0x66, 0x0f, 0x54, 0xc1});
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::SqrtF64) {
                require_stack(stack_depth, 1);
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                code_.raw({0xf2, 0x0f, 0x51, 0xc0});
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::SinF64 || opcode == Opcode::CosF64 ||
                       opcode == Opcode::ExpF64 || opcode == Opcode::LnF64) {
                require_stack(stack_depth, 1);
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                const unsigned offset = opcode == Opcode::LnF64 ? 0x18
                    : opcode == Opcode::SinF64 ? 0x20
                    : opcode == Opcode::CosF64 ? 0x28 : 0x30;
                code_.raw({0x41, 0xff, 0x54, 0x24, offset});
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::MonotonicF64 || opcode == Opcode::WallTimeF64) {
                constexpr std::uint32_t scratch = 176;
#ifdef _WIN32
                code_.raw({0x49, 0x8d, 0x8c, 0x24}); code_.i32(scratch);
                call_runtime_slot(opcode == Opcode::MonotonicF64 ? 15 : 17);
                if (opcode == Opcode::MonotonicF64) {
                    code_.raw({0x49, 0x8d, 0x8c, 0x24}); code_.i32(scratch + 8);
                    call_runtime_slot(16);
                    code_.raw({0x49, 0x8b, 0x84, 0x24}); code_.i32(scratch);
                    code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc0});
                    code_.raw({0x49, 0x8b, 0x84, 0x24}); code_.i32(scratch + 8);
                    code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc8, 0xf2, 0x0f, 0x5e, 0xc1});
                } else {
                    code_.raw({0x49, 0x8b, 0x84, 0x24}); code_.i32(scratch);
                    code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc0});
                    emit_number(10000000.0, 1);
                    code_.raw({0xf2, 0x0f, 0x5e, 0xc1});
                    emit_number(11644473600.0, 1);
                    code_.raw({0xf2, 0x0f, 0x5c, 0xc1});
                }
#else
                code_.raw({0xbf}); code_.i32(opcode == Opcode::MonotonicF64 ? 1 : 0);
                code_.raw({0x49, 0x8d, 0xb4, 0x24}); code_.i32(scratch);
                call_runtime_slot(opcode == Opcode::MonotonicF64 ? 15 : 17);
                code_.raw({0x49, 0x8b, 0x84, 0x24}); code_.i32(scratch);
                code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc0});
                code_.raw({0x49, 0x8b, 0x84, 0x24}); code_.i32(scratch + 8);
                code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc8});
                emit_number(1000000000.0, 2);
                code_.raw({0xf2, 0x0f, 0x5e, 0xca, 0xf2, 0x0f, 0x58, 0xc1});
#endif
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::SleepF64) {
                require_stack(stack_depth, 1);
                constexpr std::uint32_t scratch = 176;
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
#ifdef _WIN32
                emit_number(1000.0, 1);
                code_.raw({0xf2, 0x0f, 0x59, 0xc1, 0xf2, 0x48, 0x0f, 0x2c, 0xc8});
                call_runtime_slot(18);
#else
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc0});
                code_.raw({0x49, 0x89, 0x84, 0x24}); code_.i32(scratch);
                code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc8, 0xf2, 0x0f, 0x5c, 0xc1});
                emit_number(1000000000.0, 1);
                code_.raw({0xf2, 0x0f, 0x59, 0xc1, 0xf2, 0x48, 0x0f, 0x2c, 0xc0});
                code_.raw({0x49, 0x89, 0x84, 0x24}); code_.i32(scratch + 8);
                code_.raw({0x49, 0x8d, 0xbc, 0x24}); code_.i32(scratch);
                code_.raw({0x31, 0xf6});
                call_runtime_slot(18);
#endif
                emit_number(vkf::machine_ir::null_value());
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::LocalTimeParts) {
                require_stack(stack_depth, 1);
                const unsigned first = stack_depth - 1;
                constexpr std::uint32_t time_scratch = 176;
#ifdef _WIN32
                code_.raw({0xb9}); code_.i32(64);
#else
                code_.raw({0xbf}); code_.i32(64);
#endif
                call_runtime_slot(8);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto allocated = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(allocated, code_.position());
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                load_xmm(0, frame.displacement(frame.temp_base + first));
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc0,
                           0x49, 0x89, 0x84, 0x24});
                code_.i32(time_scratch);
#ifdef _WIN32
                code_.raw({0x48, 0x8b, 0x8d});
                code_.i32(frame.displacement(frame.scratch_slot));
                code_.raw({0x49, 0x8d, 0x94, 0x24}); code_.i32(time_scratch);
#else
                code_.raw({0x49, 0x8d, 0xbc, 0x24}); code_.i32(time_scratch);
                code_.raw({0x48, 0x8b, 0xb5});
                code_.i32(frame.displacement(frame.scratch_slot));
#endif
                call_runtime_slot(19);
                for (unsigned index = 0; index < 9; ++index) {
                    code_.raw({0x48, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.scratch_slot));
                    code_.raw({0xf2, 0x0f, 0x2a, 0x40, index * 4});
                    if (index == 4 || index == 5) {
                        emit_number(index == 4 ? 1.0 : 1900.0, 1);
                        code_.raw({0xf2, 0x0f, 0x58, 0xc1});
                    }
                    store_xmm(0, frame.displacement(frame.temp_base + first + index));
                }
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                release_pointer_in_rax();
                stack_depth = first + 9;
            } else if (opcode == Opcode::SystemCpuCount) {
#ifdef _WIN32
                code_.raw({0xb9, 0xff, 0xff, 0x00, 0x00});
#else
                code_.raw({0xbf});
#if defined(__APPLE__)
                code_.i32(58);
#else
                code_.i32(84);
#endif
#endif
                call_runtime_slot(24);
                code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc0});
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::SystemCwdString) {
                const unsigned first = stack_depth;
#ifdef _WIN32
                code_.raw({0x31, 0xc9, 0x31, 0xd2});
#else
                code_.raw({0x31, 0xff, 0x31, 0xf6});
#endif
                call_runtime_slot(25);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto cwd_ready = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(cwd_ready, code_.position());
                emit_owned_string_from_cstring(frame, first, true);
                stack_depth = first + 2;
            } else if (opcode == Opcode::SystemEnvString) {
                require_stack(stack_depth, 2);
                const unsigned first = stack_depth - 2;
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
#ifdef _WIN32
                code_.raw({0x48, 0x89, 0xc1});
#else
                code_.raw({0x48, 0x89, 0xc7});
#endif
                call_runtime_slot(26);
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                if (instruction.owns_input) {
                    release_owned_string(
                        frame.displacement(frame.temp_base + first),
                        frame.displacement(frame.temp_base + first + 1));
                }
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x84});
                const auto missing = code_.rel32_placeholder();
                emit_number(1.0);
                store_xmm(0, frame.displacement(frame.temp_base + first));
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                emit_owned_string_from_cstring(frame, first + 1, false);
                code_.raw({0xe9});
                const auto done = code_.rel32_placeholder();
                code_.patch_rel32(missing, code_.position());
                emit_number(0.0);
                store_xmm(0, frame.displacement(frame.temp_base + first));
                emit_string_address(instruction.index);
                store_xmm(0, frame.displacement(frame.temp_base + first + 1));
                emit_number(0.0);
                store_xmm(0, frame.displacement(frame.temp_base + first + 2));
                code_.patch_rel32(done, code_.position());
                stack_depth = first + 3;
            } else if (opcode == Opcode::ProcessRun) {
                require_stack(stack_depth, 2 + instruction.argument_count * 2);
                const unsigned first = stack_depth - 2 - instruction.argument_count * 2;
                const std::uint64_t argv_bytes =
                    static_cast<std::uint64_t>(instruction.argument_count + 2u) * 8u;
#ifdef _WIN32
                code_.raw({0x48, 0xb9}); code_.u64(argv_bytes);
#else
                code_.raw({0x48, 0xbf}); code_.u64(argv_bytes);
#endif
                call_runtime_slot(8);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto argv_allocated = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(argv_allocated, code_.position());
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                for (unsigned index = 0; index <= instruction.argument_count; ++index) {
                    code_.raw({0x48, 0x8b, 0x8d});
                    code_.i32(frame.displacement(frame.temp_base + first + index * 2u));
                    code_.raw({0x48, 0x89, 0x88});
                    code_.i32(static_cast<std::int32_t>(index * 8u));
                }
                code_.raw({0x48, 0xc7, 0x80});
                code_.i32(static_cast<std::int32_t>((instruction.argument_count + 1u) * 8u));
                code_.i32(0);
#ifdef _WIN32
                emit_string_pointer_to_rax(instruction.index);
                code_.raw({0x48, 0x89, 0xc2, 0x31, 0xc9});
                call_runtime_slot(29);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto stdout_file_ready = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(stdout_file_ready, code_.position());
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 1));
                code_.raw({0x48, 0x89, 0xc1, 0xba, 0x02, 0x83, 0x00, 0x00,
                           0x41, 0xb8, 0x80, 0x01, 0x00, 0x00});
                call_runtime_slot(20);
                code_.raw({0x48, 0x98, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 3));
                emit_string_pointer_to_rax(instruction.index);
                code_.raw({0x48, 0x89, 0xc2, 0x31, 0xc9});
                call_runtime_slot(29);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto stderr_file_ready = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(stderr_file_ready, code_.position());
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 2));
                code_.raw({0x48, 0x89, 0xc1, 0xba, 0x02, 0x83, 0x00, 0x00,
                           0x41, 0xb8, 0x80, 0x01, 0x00, 0x00});
                call_runtime_slot(20);
                code_.raw({0x48, 0x98, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 4));
#else
                call_runtime_slot(29);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto stdout_file_ready = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(stdout_file_ready, code_.position());
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 1));
                call_runtime_slot(29);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto stderr_file_ready = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(stderr_file_ready, code_.position());
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 2));
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 1));
                code_.raw({0x48, 0x89, 0xc7});
                call_runtime_slot(30);
                code_.raw({0x48, 0x98, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 3));
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 2));
                code_.raw({0x48, 0x89, 0xc7});
                call_runtime_slot(30);
                code_.raw({0x48, 0x98, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 4));
#endif
#ifdef _WIN32
                code_.raw({0xb9, 0x01, 0x00, 0x00, 0x00});
                call_runtime_slot(33);
                code_.raw({0x48, 0x98, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 5));
                code_.raw({0xb9, 0x02, 0x00, 0x00, 0x00});
                call_runtime_slot(33);
                code_.raw({0x48, 0x98, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 6));
                code_.raw({0x48, 0x8b, 0x8d});
                code_.i32(frame.displacement(frame.scratch_slot + 3));
                code_.raw({0xba, 0x01, 0x00, 0x00, 0x00});
                call_runtime_slot(32);
                code_.raw({0x48, 0x8b, 0x8d});
                code_.i32(frame.displacement(frame.scratch_slot + 4));
                code_.raw({0xba, 0x02, 0x00, 0x00, 0x00});
                call_runtime_slot(32);
                code_.raw({0x31, 0xc9, 0x48, 0x8b, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x4c, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                call_runtime_slot(34);
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 7));
                code_.raw({0x48, 0x8b, 0x8d});
                code_.i32(frame.displacement(frame.scratch_slot + 5));
                code_.raw({0xba, 0x01, 0x00, 0x00, 0x00});
                call_runtime_slot(32);
                code_.raw({0x48, 0x8b, 0x8d});
                code_.i32(frame.displacement(frame.scratch_slot + 6));
                code_.raw({0xba, 0x02, 0x00, 0x00, 0x00});
                call_runtime_slot(32);
                for (unsigned saved = 5; saved <= 6; ++saved) {
                    code_.raw({0x48, 0x8b, 0x8d});
                    code_.i32(frame.displacement(frame.scratch_slot + saved));
                    call_runtime_slot(22);
                }
#else
                call_runtime_slot(33);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto parent = code_.rel32_placeholder();
                code_.raw({0x48, 0x8b, 0xbd});
                code_.i32(frame.displacement(frame.scratch_slot + 3));
                code_.raw({0xbe, 0x01, 0x00, 0x00, 0x00});
                call_runtime_slot(32);
                code_.raw({0x48, 0x8b, 0xbd});
                code_.i32(frame.displacement(frame.scratch_slot + 4));
                code_.raw({0xbe, 0x02, 0x00, 0x00, 0x00});
                call_runtime_slot(32);
                code_.raw({0x48, 0x8b, 0xbd});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x48, 0x8b, 0xb5});
                code_.i32(frame.displacement(frame.scratch_slot));
                call_runtime_slot(34);
                code_.raw({0xbf, 0x7f, 0x00, 0x00, 0x00});
                call_runtime_slot(36);
                code_.byte(0xcc);
                code_.patch_rel32(parent, code_.position());
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 5));
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x89});
                const auto fork_succeeded = code_.rel32_placeholder();
                code_.raw({0x48, 0xc7, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 7));
                code_.i32(-1);
                code_.raw({0xe9});
                const auto child_done = code_.rel32_placeholder();
                code_.patch_rel32(fork_succeeded, code_.position());
                code_.raw({0x48, 0x8b, 0xbd});
                code_.i32(frame.displacement(frame.scratch_slot + 5));
                code_.raw({0x48, 0x8d, 0xb5});
                code_.i32(frame.displacement(frame.scratch_slot + 6));
                code_.raw({0x31, 0xd2});
                call_runtime_slot(35);
                code_.raw({0x85, 0xc0, 0x0f, 0x89});
                const auto wait_succeeded = code_.rel32_placeholder();
                code_.raw({0x48, 0xc7, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 7));
                code_.i32(-1);
                code_.raw({0xe9});
                const auto status_done = code_.rel32_placeholder();
                code_.patch_rel32(wait_succeeded, code_.position());
                code_.raw({0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 6));
                code_.raw({0x89, 0xc1, 0x83, 0xe1, 0x7f, 0x0f, 0x85});
                const auto signaled = code_.rel32_placeholder();
                code_.raw({0xc1, 0xe8, 0x08, 0x25, 0xff, 0x00, 0x00, 0x00, 0xe9});
                const auto decoded = code_.rel32_placeholder();
                code_.patch_rel32(signaled, code_.position());
                code_.raw({0x8d, 0x81, 0x80, 0x00, 0x00, 0x00});
                code_.patch_rel32(decoded, code_.position());
                code_.raw({0x48, 0x98, 0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 7));
                code_.patch_rel32(status_done, code_.position());
                code_.patch_rel32(child_done, code_.position());
#endif
                for (unsigned index = 0; index <= instruction.argument_count; ++index) {
                    release_owned_string(
                        frame.displacement(frame.temp_base + first + index * 2u),
                        frame.displacement(frame.temp_base + first + index * 2u + 1u));
                }
                emit_read_descriptor_string(frame, first + 1, 3);
                emit_read_descriptor_string(frame, first + 3, 4);
#ifdef _WIN32
                for (unsigned descriptor = 3; descriptor <= 4; ++descriptor) {
                    code_.raw({0x48, 0x8b, 0x8d});
                    code_.i32(frame.displacement(frame.scratch_slot + descriptor));
                    call_runtime_slot(22);
                }
                for (unsigned path = 1; path <= 2; ++path) {
                    code_.raw({0x48, 0x8b, 0x8d});
                    code_.i32(frame.displacement(frame.scratch_slot + path));
                    call_runtime_slot(30);
                    code_.raw({0x48, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.scratch_slot + path));
                    release_pointer_in_rax();
                }
#else
                for (unsigned file = 1; file <= 2; ++file) {
                    code_.raw({0x48, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.scratch_slot + file));
                    code_.raw({0x48, 0x89, 0xc7});
                    call_runtime_slot(31);
                }
#endif
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot));
                release_pointer_in_rax();
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.scratch_slot + 7));
                code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc0});
                store_xmm(0, frame.displacement(frame.temp_base + first));
                stack_depth = first + 5;
            } else if (opcode == Opcode::CaptureRegex) {
                require_stack(stack_depth, 2);
                const unsigned first = stack_depth - 2;
                emit_capture_regex(function, frame, first, instruction, entry, branches);
                stack_depth = first + instruction.argument_count * 2u;
            } else if (opcode == Opcode::RangeF64Values) {
                require_stack(stack_depth, instruction.argument_count);
                if (instruction.argument_count == 0) {
                    throw BackendFailure("x64 stat.range requires a non-empty input");
                }
                const unsigned first = stack_depth - instruction.argument_count;
                load_xmm(0, frame.displacement(frame.temp_base + first));
                code_.raw({0x66, 0x0f, 0x28, 0xc8});
                for (unsigned index = 1; index < instruction.argument_count; ++index) {
                    load_xmm(2, frame.displacement(frame.temp_base + first + index));
                    code_.raw({0xf2, 0x0f, 0x5d, 0xc2,
                               0xf2, 0x0f, 0x5f, 0xca});
                }
                code_.raw({0xf2, 0x0f, 0x5c, 0xc8,
                           0x66, 0x0f, 0x28, 0xc1});
                store_xmm(0, frame.displacement(frame.temp_base + first));
                stack_depth = first + 1;
            } else if (opcode == Opcode::SumF64Values || opcode == Opcode::MeanF64Values ||
                       opcode == Opcode::VarianceF64Values ||
                       opcode == Opcode::StdDevF64Values ||
                       opcode == Opcode::CountValues) {
                require_stack(stack_depth, instruction.argument_count);
                const unsigned first = stack_depth - instruction.argument_count;
                if (instruction.argument_count == 0) {
                    throw BackendFailure("x64 numeric reduction requires a non-empty input");
                }
                if (opcode == Opcode::CountValues) {
                    emit_number(static_cast<double>(instruction.argument_count));
                } else {
                    load_xmm(0, frame.displacement(frame.temp_base + first));
                    for (unsigned index = 1; index < instruction.argument_count; ++index) {
                        load_xmm(1, frame.displacement(frame.temp_base + first + index));
                        code_.raw({0xf2, 0x0f, 0x58, 0xc1});
                    }
                    if (opcode == Opcode::MeanF64Values || opcode == Opcode::VarianceF64Values ||
                        opcode == Opcode::StdDevF64Values) {
                        emit_number(static_cast<double>(instruction.argument_count), 1);
                        code_.raw({0xf2, 0x0f, 0x5e, 0xc1});
                    }
                    if (opcode == Opcode::VarianceF64Values || opcode == Opcode::StdDevF64Values) {
                        if (instruction.argument_count <= instruction.degrees_of_freedom) {
                            throw BackendFailure("x64 stat.std input is too small for ddof");
                        }
                        code_.raw({0x66, 0x0f, 0xef, 0xc9});
                        for (unsigned index = 0; index < instruction.argument_count; ++index) {
                            load_xmm(2, frame.displacement(frame.temp_base + first + index));
                            code_.raw({0xf2, 0x0f, 0x5c, 0xd0,
                                       0xf2, 0x0f, 0x59, 0xd2,
                                       0xf2, 0x0f, 0x58, 0xca});
                        }
                        emit_number(static_cast<double>(
                            instruction.argument_count - instruction.degrees_of_freedom), 2);
                        code_.raw({0xf2, 0x0f, 0x5e, 0xca});
                        if (opcode == Opcode::StdDevF64Values) {
                            code_.raw({0xf2, 0x0f, 0x51, 0xc1});
                        } else {
                            code_.raw({0x66, 0x0f, 0x28, 0xc1});
                        }
                    }
                }
                store_xmm(0, frame.displacement(frame.temp_base + first));
                stack_depth = first + 1;
            } else if (opcode == Opcode::RangeF64Locals) {
                if (instruction.argument_count == 0 || instruction.index > frame.local_count ||
                    instruction.argument_count > frame.local_count - instruction.index) {
                    throw BackendFailure("invalid x64 stat.range local reduction range");
                }
                emit_fixed_base_address(
                    instruction.index, instruction.argument_count);
                code_.raw({0xf2, 0x0f, 0x10, 0x00,
                           0x66, 0x0f, 0x28, 0xc8,
                           0x48, 0x83, 0xe8, 0x08,
                           0xb9});
                code_.i32(static_cast<std::int32_t>(instruction.argument_count - 1));
                if (instruction.argument_count > 1) {
                    const auto range_loop = code_.position();
                    code_.raw({0xf2, 0x0f, 0x10, 0x10,
                               0xf2, 0x0f, 0x5d, 0xc2,
                               0xf2, 0x0f, 0x5f, 0xca,
                               0x48, 0x83, 0xe8, 0x08,
                               0xff, 0xc9, 0x0f, 0x85});
                    const auto range_repeat = code_.rel32_placeholder();
                    code_.patch_rel32(range_repeat, range_loop);
                }
                code_.raw({0xf2, 0x0f, 0x5c, 0xc8,
                           0x66, 0x0f, 0x28, 0xc1});
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::SumF64Locals || opcode == Opcode::MeanF64Locals ||
                       opcode == Opcode::VarianceF64Locals ||
                       opcode == Opcode::StdDevF64Locals ||
                       opcode == Opcode::CountLocalValues) {
                if (instruction.argument_count == 0 || instruction.index > frame.local_count ||
                    instruction.argument_count > frame.local_count - instruction.index) {
                    throw BackendFailure("invalid x64 local reduction range");
                }
                if (opcode == Opcode::CountLocalValues) {
                    emit_number(static_cast<double>(instruction.argument_count));
                } else {
                    code_.raw({0x66, 0x0f, 0xef, 0xc0});
                    code_.raw({0x48, 0x8d, 0x85});
                    code_.i32(frame.displacement(instruction.index));
                    code_.raw({0xb9});
                    code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                    const auto loop = code_.position();
                    code_.raw({0xf2, 0x0f, 0x58, 0x00, 0x48, 0x83, 0xe8, 0x08,
                               0xff, 0xc9, 0x0f, 0x85});
                    const auto branch = code_.rel32_placeholder();
                    code_.patch_rel32(branch, loop);
                    if (opcode == Opcode::MeanF64Locals || opcode == Opcode::VarianceF64Locals ||
                        opcode == Opcode::StdDevF64Locals) {
                        emit_number(static_cast<double>(instruction.argument_count), 1);
                        code_.raw({0xf2, 0x0f, 0x5e, 0xc1});
                    }
                    if (opcode == Opcode::VarianceF64Locals || opcode == Opcode::StdDevF64Locals) {
                        if (instruction.argument_count <= instruction.degrees_of_freedom) {
                            throw BackendFailure("x64 stat.std input is too small for ddof");
                        }
                        code_.raw({0x66, 0x0f, 0xef, 0xc9,
                                   0x48, 0x8d, 0x85});
                        code_.i32(frame.displacement(instruction.index));
                        code_.raw({0xb9});
                        code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                        const auto variance_loop = code_.position();
                        code_.raw({0xf2, 0x0f, 0x10, 0x10,
                                   0xf2, 0x0f, 0x5c, 0xd0,
                                   0xf2, 0x0f, 0x59, 0xd2,
                                   0xf2, 0x0f, 0x58, 0xca,
                                   0x48, 0x83, 0xe8, 0x08,
                                   0xff, 0xc9, 0x0f, 0x85});
                        const auto variance_branch = code_.rel32_placeholder();
                        code_.patch_rel32(variance_branch, variance_loop);
                        emit_number(static_cast<double>(
                            instruction.argument_count - instruction.degrees_of_freedom), 2);
                        code_.raw({0xf2, 0x0f, 0x5e, 0xca});
                        if (opcode == Opcode::StdDevF64Locals) {
                            code_.raw({0xf2, 0x0f, 0x51, 0xc1});
                        } else {
                            code_.raw({0x66, 0x0f, 0x28, 0xc1});
                        }
                    }
                }
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::MakeOwnedF64List) {
                require_stack(stack_depth, instruction.argument_count);
                const unsigned first = stack_depth - instruction.argument_count;
                const std::uint64_t allocation_bytes = 16ull +
                    static_cast<std::uint64_t>(instruction.argument_count) * 8ull;
                if (allocation_bytes > UINT32_MAX) throw BackendFailure("x64 list allocation is too large");
#ifdef _WIN32
                code_.byte(0xb9);
#else
                code_.byte(0xbf);
#endif
                code_.i32(static_cast<std::int32_t>(allocation_bytes));
                call_runtime_slot(8);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto allocated = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(allocated, code_.position());
                code_.raw({0x48, 0xc7, 0xc1});
                code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                code_.raw({0x48, 0x89, 0x08, 0x48, 0x89, 0x48, 0x08});
                for (unsigned index = 0; index < instruction.argument_count; ++index) {
                    load_xmm(0, frame.displacement(frame.temp_base + first + index));
                    code_.raw({0xf2, 0x0f, 0x11, 0x80});
                    code_.i32(static_cast<std::int32_t>(16u + index * 8u));
                }
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                stack_depth = first + 1;
            } else if (opcode == Opcode::MakeOwnedF64ListLiteral) {
                const std::uint64_t payload_bytes =
                    static_cast<std::uint64_t>(instruction.argument_count) * 8ull;
                const std::uint64_t allocation_bytes = 16ull + payload_bytes;
                if (allocation_bytes > UINT32_MAX ||
                    static_cast<std::uint64_t>(instruction.index) + payload_bytes >
                        module_.string_data.size()) {
                    throw BackendFailure("invalid x64 numeric-list literal range");
                }
#ifdef _WIN32
                code_.byte(0xb9);
#else
                code_.byte(0xbf);
#endif
                code_.i32(static_cast<std::int32_t>(allocation_bytes));
                call_runtime_slot(8);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto allocated = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(allocated, code_.position());
                code_.raw({0x48, 0xc7, 0xc1});
                code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                code_.raw({0x48, 0x89, 0x08, 0x48, 0x89, 0x48, 0x08});
                code_.raw({0x49, 0x8b, 0x54, 0x24, 0x38});
                if (instruction.index != 0) {
                    code_.raw({0x48, 0x81, 0xc2});
                    code_.i32(static_cast<std::int32_t>(instruction.index));
                }
                code_.raw({0x4c, 0x8d, 0x40, 0x10, 0xb9});
                code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                const auto copy = code_.position();
                code_.raw({0x4c, 0x8b, 0x0a, 0x4d, 0x89, 0x08,
                           0x48, 0x83, 0xc2, 0x08, 0x49, 0x83, 0xc0, 0x08,
                           0x48, 0xff, 0xc9, 0x0f, 0x85});
                const auto repeat = code_.rel32_placeholder();
                code_.patch_rel32(repeat, copy);
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::UnionF64Multisets ||
                       opcode == Opcode::DifferenceF64Multisets ||
                       opcode == Opcode::FloorDivideF64Multisets ||
                       opcode == Opcode::RemainderF64Multisets) {
                require_stack(stack_depth, 2);
                const unsigned first = stack_depth - 2;
                emit_binary_f64_multiset(
                    frame, first, opcode, instruction.owns_left, instruction.owns_right);
                stack_depth = first + 1;
            } else if (opcode == Opcode::AddF64MultisetScalar ||
                       opcode == Opcode::SubtractF64MultisetScalar ||
                       opcode == Opcode::FloorDivideF64MultisetScalar) {
                require_stack(stack_depth, 2);
                const unsigned first = stack_depth - 2;
                emit_f64_multiset_scalar(frame, first, opcode, instruction.owns_left);
                stack_depth = first + 1;
            } else if (opcode == Opcode::NormalizeF64Multiset) {
                require_stack(stack_depth, 1);
                emit_normalize_f64_multiset(frame, stack_depth - 1);
            } else if (opcode == Opcode::RangeF64List) {
                require_stack(stack_depth, 1);
                const unsigned first = stack_depth - 1;
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x48, 0x8b, 0x08,
                           0x48, 0x85, 0xc9, 0x0f, 0x85});
                const auto nonempty = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(nonempty, code_.position());
                code_.raw({0x48, 0x8d, 0x50, 0x10,
                           0xf2, 0x0f, 0x10, 0x02,
                           0x66, 0x0f, 0x28, 0xc8,
                           0x48, 0x83, 0xc2, 0x08,
                           0x48, 0xff, 0xc9,
                           0x0f, 0x84});
                const auto complete = code_.rel32_placeholder();
                const auto range_loop = code_.position();
                code_.raw({0xf2, 0x0f, 0x10, 0x12,
                           0xf2, 0x0f, 0x5d, 0xc2,
                           0xf2, 0x0f, 0x5f, 0xca,
                           0x48, 0x83, 0xc2, 0x08,
                           0x48, 0xff, 0xc9, 0x0f, 0x85});
                const auto range_repeat = code_.rel32_placeholder();
                code_.patch_rel32(range_repeat, range_loop);
                code_.patch_rel32(complete, code_.position());
                code_.raw({0xf2, 0x0f, 0x5c, 0xc8,
                           0x66, 0x0f, 0x28, 0xc1});
                store_xmm(0, frame.displacement(frame.temp_base + first));
                if (instruction.owns_input) {
                    move_pointer_argument_from_rax();
                    call_runtime_slot(9);
                }
            } else if (opcode == Opcode::SumF64List || opcode == Opcode::MeanF64List ||
                       opcode == Opcode::VarianceF64List ||
                       opcode == Opcode::StdDevF64List ||
                       opcode == Opcode::CountF64List) {
                require_stack(stack_depth, 1);
                const unsigned first = stack_depth - 1;
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x48, 0x8b, 0x08});
                if (opcode == Opcode::CountF64List) {
                    code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc1});
                } else {
                    if (opcode == Opcode::MeanF64List || opcode == Opcode::VarianceF64List ||
                        opcode == Opcode::StdDevF64List) {
                        code_.raw({0x49, 0x89, 0xc8});
                        code_.raw({0x49, 0x81, 0xf8});
                        code_.i32(static_cast<std::int32_t>(
                            (opcode == Opcode::VarianceF64List ||
                             opcode == Opcode::StdDevF64List)
                                ? instruction.degrees_of_freedom
                                : 0u));
                        code_.raw({0x0f, 0x87});
                        const auto enough_values = code_.rel32_placeholder();
                        emit_abort();
                        code_.patch_rel32(enough_values, code_.position());
                    }
                    code_.raw({0x66, 0x0f, 0xef, 0xc0, 0x48, 0x8d, 0x50, 0x10});
                    code_.raw({0x48, 0x85, 0xc9, 0x0f, 0x84});
                    const auto empty = code_.rel32_placeholder();
                    const auto loop = code_.position();
                    code_.raw({0xf2, 0x0f, 0x58, 0x02, 0x48, 0x83, 0xc2, 0x08,
                               0x48, 0xff, 0xc9, 0x0f, 0x85});
                    const auto repeat = code_.rel32_placeholder();
                    code_.patch_rel32(repeat, loop);
                    if (opcode == Opcode::MeanF64List || opcode == Opcode::VarianceF64List ||
                        opcode == Opcode::StdDevF64List) {
                        code_.raw({0xf2, 0x49, 0x0f, 0x2a, 0xc8, 0xf2, 0x0f, 0x5e, 0xc1});
                    }
                    if (opcode == Opcode::VarianceF64List || opcode == Opcode::StdDevF64List) {
                        code_.raw({0x66, 0x0f, 0xef, 0xc9,
                                   0x48, 0x8d, 0x50, 0x10,
                                   0x4c, 0x89, 0xc1});
                        const auto variance_loop = code_.position();
                        code_.raw({0xf2, 0x0f, 0x10, 0x12,
                                   0xf2, 0x0f, 0x5c, 0xd0,
                                   0xf2, 0x0f, 0x59, 0xd2,
                                   0xf2, 0x0f, 0x58, 0xca,
                                   0x48, 0x83, 0xc2, 0x08,
                                   0x48, 0xff, 0xc9, 0x0f, 0x85});
                        const auto variance_repeat = code_.rel32_placeholder();
                        code_.patch_rel32(variance_repeat, variance_loop);
                        if (instruction.degrees_of_freedom != 0) {
                            code_.raw({0x49, 0x81, 0xe8});
                            code_.i32(static_cast<std::int32_t>(
                                instruction.degrees_of_freedom));
                        }
                        code_.raw({0xf2, 0x49, 0x0f, 0x2a, 0xd0,
                                   0xf2, 0x0f, 0x5e, 0xca});
                        if (opcode == Opcode::StdDevF64List) {
                            code_.raw({0xf2, 0x0f, 0x51, 0xc1});
                        } else {
                            code_.raw({0x66, 0x0f, 0x28, 0xc1});
                        }
                    }
                    const auto complete = code_.position();
                    code_.patch_rel32(empty, complete);
                }
                if (instruction.owns_input) {
                    move_pointer_argument_from_rax();
                    store_xmm(0, frame.displacement(frame.temp_base + first));
                    call_runtime_slot(9);
                } else {
                    store_xmm(0, frame.displacement(frame.temp_base + first));
                }
            } else if (opcode == Opcode::LoadF64LocalsIndex) {
                require_stack(stack_depth, 1);
                if (instruction.index > frame.local_count ||
                    instruction.argument_count > frame.local_count - instruction.index) {
                    throw BackendFailure("invalid x64 fixed-vector index range");
                }
                const unsigned first = stack_depth - 1;
                const bool native_index_local = policy_.native_index_addressing &&
                    instruction.index_local &&
                    local_is_i64(*instruction.index_local);
                if (native_index_local) {
                    load_i64_to_rcx(*instruction.index_local);
                } else {
                    load_xmm(0, frame.displacement(frame.temp_base + first));
                    code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8});
                }
                std::vector<std::size_t> invalid;
                if (instruction.may_error &&
                    !instruction.index_is_integral && !native_index_local) {
                    code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc9,
                               0x66, 0x0f, 0x2e, 0xc8});
                    invalid.push_back(emit_jump(0x85));
                    invalid.push_back(emit_jump(0x8a));
                }
                if (instruction.may_error &&
                    !index_lower_bound_proven[instruction_index]) {
                    code_.raw({0x48, 0x85, 0xc9});
                    invalid.push_back(emit_jump(0x88));
                }
                if (instruction.may_error &&
                    !index_upper_bound_proven[instruction_index]) {
                    code_.raw({0x48, 0x81, 0xf9});
                    code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                    invalid.push_back(emit_jump(0x83));
                }
                code_.raw({0x48, 0xf7, 0xd9});
                if (fixed_range_is_i64(instruction.index, instruction.argument_count)) {
                    emit_fixed_base_address(
                        instruction.index, instruction.argument_count);
                    code_.raw({0x48, 0x8b, 0x14, 0xc8,
                               0xf2, 0x48, 0x0f, 0x2a, 0xc2});
                } else {
                    emit_fixed_indexed_f64_load(
                        instruction.index, instruction.argument_count,
                        0u, 0xc8u);
                }
                store_xmm(0, frame.displacement(frame.temp_base + first));
                if (!invalid.empty()) {
                    code_.byte(0xe9);
                    const auto done = code_.rel32_placeholder();
                    const auto abort = code_.position();
                    for (const auto patch : invalid) code_.patch_rel32(patch, abort);
                    if (instruction.has_error_handler) {
                        emit_error_message_registers(
                            instruction.error_message_offset, instruction.byte_count);
                        store_error_message_local(frame, instruction.error_value_local);
                        store_error_type_constant(
                            frame, instruction.error_type_local, vkf::machine_ir::index_error_mask);
                        code_.byte(0xe9);
                        branches.push_back({code_.rel32_placeholder(), instruction.label});
                    } else if (entry) {
                        emit_abort();
                    } else {
                        emit_error_cleanup(function, frame);
                        emit_error_message_registers(
                            instruction.error_message_offset, instruction.byte_count);
                        code_.raw({0x41, 0xb9});
                        code_.i32(vkf::machine_ir::index_error_mask);
                        epilogue();
                    }
                    code_.patch_rel32(done, code_.position());
                }
            } else if (opcode == Opcode::StoreF64LocalsIndex) {
                require_stack(stack_depth, 2);
                if (instruction.index > frame.local_count ||
                    instruction.argument_count > frame.local_count - instruction.index) {
                    throw BackendFailure("invalid x64 fixed-vector update range");
                }
                const unsigned first = stack_depth - 2;
                const bool native_index_local = policy_.native_index_addressing &&
                    instruction.index_local &&
                    local_is_i64(*instruction.index_local);
                if (native_index_local) {
                    load_i64_to_rcx(*instruction.index_local);
                } else {
                    load_xmm(0, frame.displacement(frame.temp_base + first));
                    code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8});
                }
                std::vector<std::size_t> invalid;
                if (instruction.may_error &&
                    !instruction.index_is_integral && !native_index_local) {
                    code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc9,
                               0x66, 0x0f, 0x2e, 0xc8});
                    invalid.push_back(emit_jump(0x85));
                    invalid.push_back(emit_jump(0x8a));
                }
                if (instruction.may_error &&
                    !index_lower_bound_proven[instruction_index]) {
                    code_.raw({0x48, 0x85, 0xc9});
                    invalid.push_back(emit_jump(0x88));
                }
                if (instruction.may_error &&
                    !index_upper_bound_proven[instruction_index]) {
                    code_.raw({0x48, 0x81, 0xf9});
                    code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                    invalid.push_back(emit_jump(0x83));
                }
                code_.raw({0x48, 0xf7, 0xd9});
                load_xmm(0, frame.displacement(frame.temp_base + first + 1));
                if (fixed_range_is_i64(instruction.index, instruction.argument_count)) {
                    emit_fixed_base_address(
                        instruction.index, instruction.argument_count);
                    code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xd0,
                               0x48, 0x89, 0x14, 0xc8});
                } else {
                    emit_fixed_indexed_f64_store(
                        instruction.index, instruction.argument_count,
                        0u, 0xc8u, false);
                }
                if (!invalid.empty()) {
                    code_.byte(0xe9);
                    const auto done = code_.rel32_placeholder();
                    const auto abort = code_.position();
                    for (const auto patch : invalid) code_.patch_rel32(patch, abort);
                    if (instruction.has_error_handler) {
                        emit_error_message_registers(
                            instruction.error_message_offset, instruction.byte_count);
                        store_error_message_local(frame, instruction.error_value_local);
                        store_error_type_constant(
                            frame, instruction.error_type_local, vkf::machine_ir::index_error_mask);
                        code_.byte(0xe9);
                        branches.push_back({code_.rel32_placeholder(), instruction.label});
                    } else if (entry) {
                        emit_abort();
                    } else {
                        emit_error_cleanup(function, frame);
                        emit_error_message_registers(
                            instruction.error_message_offset, instruction.byte_count);
                        code_.raw({0x41, 0xb9});
                        code_.i32(vkf::machine_ir::index_error_mask);
                        epilogue();
                    }
                    code_.patch_rel32(done, code_.position());
                }
                stack_depth = first;
            } else if (opcode == Opcode::LoadF64ListIndex) {
                require_stack(stack_depth, 2);
                const unsigned first = stack_depth - 2;
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                load_xmm(0, frame.displacement(frame.temp_base + first + 1));
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8});
                code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc9, 0x66, 0x0f, 0x2e, 0xc8});
                std::vector<std::size_t> invalid;
                invalid.push_back(emit_jump(0x85));
                invalid.push_back(emit_jump(0x8a));
                code_.raw({0x48, 0x85, 0xc9});
                invalid.push_back(emit_jump(0x88));
                code_.raw({0x48, 0x3b, 0x08});
                invalid.push_back(emit_jump(0x83));
                code_.raw({0xf2, 0x0f, 0x10, 0x44, 0xc8, 0x10});
                if (instruction.owns_input) {
                    move_pointer_argument_from_rax();
                    store_xmm(0, frame.displacement(frame.temp_base + first));
                    call_runtime_slot(9);
                } else {
                    store_xmm(0, frame.displacement(frame.temp_base + first));
                }
                code_.byte(0xe9);
                const auto done = code_.rel32_placeholder();
                const auto abort = code_.position();
                for (const auto patch : invalid) code_.patch_rel32(patch, abort);
                if (instruction.owns_input) release_pointer_in_rax();
                if (instruction.has_error_handler) {
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_constant(
                        frame, instruction.error_type_local, vkf::machine_ir::index_error_mask);
                    code_.byte(0xe9);
                    branches.push_back({code_.rel32_placeholder(), instruction.label});
                } else if (entry) {
                    emit_abort();
                } else {
                    emit_error_cleanup(function, frame);
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    code_.raw({0x41, 0xb9});
                    code_.i32(vkf::machine_ir::index_error_mask);
                    epilogue();
                }
                code_.patch_rel32(done, code_.position());
                stack_depth = first + 1;
            } else if (opcode == Opcode::StoreF64ListIndex) {
                require_stack(stack_depth, 2);
                if (instruction.index >= frame.local_count) {
                    throw BackendFailure("invalid x64 list update local");
                }
                const unsigned first = stack_depth - 2;
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(instruction.index));
                code_.raw({0x48, 0x85, 0xc0});
                std::vector<std::size_t> invalid;
                invalid.push_back(emit_jump(0x84));
                load_xmm(0, frame.displacement(frame.temp_base + first));
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8});
                code_.raw({0xf2, 0x48, 0x0f, 0x2a, 0xc9, 0x66, 0x0f, 0x2e, 0xc8});
                invalid.push_back(emit_jump(0x85));
                invalid.push_back(emit_jump(0x8a));
                code_.raw({0x48, 0x85, 0xc9});
                invalid.push_back(emit_jump(0x88));
                code_.raw({0x48, 0x3b, 0x08});
                invalid.push_back(emit_jump(0x83));
                load_xmm(0, frame.displacement(frame.temp_base + first + 1));
                code_.raw({0xf2, 0x0f, 0x11, 0x44, 0xc8, 0x10});
                code_.byte(0xe9);
                const auto done = code_.rel32_placeholder();
                const auto abort = code_.position();
                for (const auto patch : invalid) code_.patch_rel32(patch, abort);
                if (instruction.has_error_handler) {
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_constant(
                        frame, instruction.error_type_local, vkf::machine_ir::index_error_mask);
                    code_.byte(0xe9);
                    branches.push_back({code_.rel32_placeholder(), instruction.label});
                } else if (entry) {
                    emit_abort();
                } else {
                    emit_error_cleanup(function, frame);
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    code_.raw({0x41, 0xb9});
                    code_.i32(vkf::machine_ir::index_error_mask);
                    epilogue();
                }
                code_.patch_rel32(done, code_.position());
                stack_depth = first;
            } else if (opcode == Opcode::CloneF64List) {
                require_stack(stack_depth, 1);
                const unsigned first = stack_depth - 1;
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto source_present = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(source_present, code_.position());
                code_.raw({0x48, 0x8b, 0x00, 0x48, 0xc1, 0xe0, 0x03, 0x48, 0x83, 0xc0, 0x10});
                move_pointer_argument_from_rax();
                call_runtime_slot(8);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto allocated = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(allocated, code_.position());
                code_.raw({0x49, 0x89, 0xc3, 0x4c, 0x8b, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x49, 0x8b, 0x0a, 0x49, 0x89, 0x0b, 0x49, 0x89, 0x4b, 0x08,
                           0x48, 0x85, 0xc9, 0x0f, 0x84});
                const auto empty = code_.rel32_placeholder();
                code_.raw({0x49, 0x83, 0xc2, 0x10, 0x49, 0x83, 0xc3, 0x10});
                const auto copy = code_.position();
                code_.raw({0xf2, 0x41, 0x0f, 0x10, 0x02, 0xf2, 0x41, 0x0f, 0x11, 0x03,
                           0x49, 0x83, 0xc2, 0x08, 0x49, 0x83, 0xc3, 0x08,
                           0x48, 0xff, 0xc9, 0x0f, 0x85});
                const auto repeat = code_.rel32_placeholder();
                code_.patch_rel32(repeat, copy);
                code_.patch_rel32(empty, code_.position());
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
            } else if (opcode == Opcode::ConcatF64Lists) {
                require_stack(stack_depth, 2);
                const unsigned first = stack_depth - 2;
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto left_present = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(left_present, code_.position());
                code_.raw({0x4c, 0x8b, 0x9d});
                code_.i32(frame.displacement(frame.temp_base + first + 1));
                code_.raw({0x4d, 0x85, 0xdb, 0x0f, 0x85});
                const auto right_present = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(right_present, code_.position());
                code_.raw({0x48, 0x8b, 0x00, 0x49, 0x8b, 0x0b, 0x48, 0x01, 0xc8, 0x0f, 0x83});
                const auto length_valid = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(length_valid, code_.position());
                code_.raw({0x48, 0x89, 0xc2, 0x48, 0xc1, 0xea, 0x3d, 0x48, 0x85, 0xd2, 0x0f, 0x84});
                const auto size_valid = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(size_valid, code_.position());
                code_.raw({0x48, 0xc1, 0xe0, 0x03, 0x48, 0x83, 0xc0, 0x10});
                move_pointer_argument_from_rax();
                call_runtime_slot(8);
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x85});
                const auto allocated = code_.rel32_placeholder();
                emit_abort();
                code_.patch_rel32(allocated, code_.position());
                code_.raw({0x4c, 0x8b, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x4c, 0x8b, 0x9d});
                code_.i32(frame.displacement(frame.temp_base + first + 1));
                code_.raw({0x49, 0x8b, 0x0a, 0x49, 0x8b, 0x13, 0x49, 0x89, 0xc8,
                           0x49, 0x01, 0xd0, 0x4c, 0x89, 0x00, 0x4c, 0x89, 0x40, 0x08,
                           0x4c, 0x8d, 0x48, 0x10, 0x48, 0x85, 0xc9, 0x0f, 0x84});
                const auto left_empty = code_.rel32_placeholder();
                code_.raw({0x49, 0x83, 0xc2, 0x10});
                const auto copy_left = code_.position();
                code_.raw({0xf2, 0x41, 0x0f, 0x10, 0x02, 0xf2, 0x41, 0x0f, 0x11, 0x01,
                           0x49, 0x83, 0xc2, 0x08, 0x49, 0x83, 0xc1, 0x08,
                           0x48, 0xff, 0xc9, 0x0f, 0x85});
                const auto repeat_left = code_.rel32_placeholder();
                code_.patch_rel32(repeat_left, copy_left);
                code_.patch_rel32(left_empty, code_.position());
                code_.raw({0x48, 0x85, 0xd2, 0x0f, 0x84});
                const auto right_empty = code_.rel32_placeholder();
                code_.raw({0x49, 0x83, 0xc3, 0x10});
                const auto copy_right = code_.position();
                code_.raw({0xf2, 0x41, 0x0f, 0x10, 0x03, 0xf2, 0x41, 0x0f, 0x11, 0x01,
                           0x49, 0x83, 0xc3, 0x08, 0x49, 0x83, 0xc1, 0x08,
                           0x48, 0xff, 0xca, 0x0f, 0x85});
                const auto repeat_right = code_.rel32_placeholder();
                code_.patch_rel32(repeat_right, copy_right);
                code_.patch_rel32(right_empty, code_.position());
                if (instruction.owns_left) {
#ifdef _WIN32
                    code_.raw({0x48, 0x8b, 0x8d});
#else
                    code_.raw({0x48, 0x8b, 0xbd});
#endif
                    code_.i32(frame.displacement(frame.temp_base + first));
                }
                code_.raw({0x48, 0x89, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                if (instruction.owns_left) call_runtime_slot(9);
                if (instruction.owns_right) {
                    code_.raw({0x48, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.temp_base + first + 1));
                    release_pointer_in_rax();
                }
                stack_depth = first + 1;
            } else if (opcode == Opcode::ReleaseStringValue) {
                require_stack(stack_depth, 2);
                stack_depth -= 2;
                release_owned_string(
                    frame.displacement(frame.temp_base + stack_depth),
                    frame.displacement(frame.temp_base + stack_depth + 1));
            } else if (opcode == Opcode::ReleaseStringLocal) {
                if (instruction.index + 1 >= frame.local_count) {
                    throw BackendFailure("invalid x64 string local");
                }
                release_owned_string(
                    frame.displacement(instruction.index),
                    frame.displacement(instruction.index + 1));
                code_.raw({0x48, 0xc7, 0x85});
                code_.i32(frame.displacement(instruction.index + 1));
                code_.i32(0);
            } else if (opcode == Opcode::ReleaseF64ListValue) {
                require_stack(stack_depth, 1);
                --stack_depth;
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + stack_depth));
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x84});
                const auto empty = code_.rel32_placeholder();
                release_pointer_in_rax();
                code_.patch_rel32(empty, code_.position());
            } else if (opcode == Opcode::ReleaseF64ListLocal) {
                if (instruction.index >= frame.local_count) throw BackendFailure("invalid x64 list local");
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(instruction.index));
                code_.raw({0x48, 0x85, 0xc0, 0x0f, 0x84});
                const auto empty = code_.rel32_placeholder();
                release_pointer_in_rax();
                code_.raw({0x48, 0xc7, 0x85});
                code_.i32(frame.displacement(instruction.index));
                code_.i32(0);
                code_.patch_rel32(empty, code_.position());
            } else if (opcode == Opcode::EqualBits || opcode == Opcode::NotEqualBits) {
                require_stack(stack_depth, 2);
                code_.raw({0x48, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + stack_depth - 2));
                code_.raw({0x48, 0x3b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + stack_depth - 1));
                code_.raw({0x0f, opcode == Opcode::EqualBits ? 0x94u : 0x95u, 0xc0,
                           0x0f, 0xb6, 0xc0, 0xf2, 0x48, 0x0f, 0x2a, 0xc0});
                --stack_depth;
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::AddF64 || opcode == Opcode::SubtractF64 ||
                       opcode == Opcode::MultiplyF64 || opcode == Opcode::DivideF64 ||
                       opcode == Opcode::FloorDivideF64 || opcode == Opcode::PowerF64 ||
                       opcode == Opcode::RemainderF64 ||
                       opcode == Opcode::LogicalXorF64 ||
                       opcode == Opcode::OrderedLessF64 || opcode == Opcode::OrderedLessEqualF64 ||
                       opcode == Opcode::OrderedGreaterF64 || opcode == Opcode::OrderedGreaterEqualF64 ||
                       opcode == Opcode::OrderedEqualF64 || opcode == Opcode::UnorderedNotEqualF64) {
                require_stack(stack_depth, 2);
                if (opcode == Opcode::PowerF64 || opcode == Opcode::RemainderF64 ||
                    opcode == Opcode::FloorDivideF64) {
                    load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 2));
                    load_xmm(1, frame.displacement(frame.temp_base + stack_depth - 1));
                    if (opcode == Opcode::PowerF64) code_.raw({0x41, 0xff, 0x14, 0x24});
                    else if (opcode == Opcode::RemainderF64) code_.raw({0x41, 0xff, 0x54, 0x24, 0x08});
                    else {
                        code_.raw({0xf2, 0x0f, 0x5e, 0xc1});
                        code_.raw({0x41, 0xff, 0x54, 0x24, 0x10});
                    }
                } else if (opcode == Opcode::LogicalXorF64) {
                    load_xmm(1, frame.displacement(frame.temp_base + stack_depth - 2));
                    emit_truth_to_al(1);
                    code_.raw({0x88, 0xc1});
                    load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                    emit_truth_to_al(0);
                    code_.raw({0x30, 0xc8});
                    emit_al_as_f64();
                } else {
                    load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                    load_xmm(1, frame.displacement(frame.temp_base + stack_depth - 2));
                }
                if (opcode == Opcode::AddF64 || opcode == Opcode::SubtractF64 ||
                    opcode == Opcode::MultiplyF64 || opcode == Opcode::DivideF64) {
                    const unsigned machine = opcode == Opcode::AddF64 ? 0x58
                        : opcode == Opcode::SubtractF64 ? 0x5c
                        : opcode == Opcode::MultiplyF64 ? 0x59 : 0x5e;
                    code_.raw({0xf2, 0x0f, machine, 0xc8});
                    code_.raw({0x66, 0x0f, 0x28, 0xc1});
                } else if (opcode != Opcode::PowerF64 && opcode != Opcode::RemainderF64 &&
                           opcode != Opcode::FloorDivideF64 &&
                           opcode != Opcode::LogicalXorF64) {
                    emit_comparison(opcode);
                }
                --stack_depth;
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::Call) {
                require_stack(stack_depth, instruction.argument_count);
                const unsigned first = stack_depth - instruction.argument_count;
                std::optional<std::uint32_t> direct_result_base;
                if (policy_.direct_aggregate_results && instruction.result_count >= 8u &&
                    instruction.result_count <= function.instructions.size() - instruction_index - 1u) {
                    const auto& first_store = function.instructions[instruction_index + 1u];
                    if (first_store.opcode == Opcode::StoreLocal &&
                        first_store.index + 1u >= instruction.result_count) {
                        const auto base = first_store.index + 1u - instruction.result_count;
                        bool contiguous = base <= frame.local_count &&
                            instruction.result_count <= frame.local_count - base;
                        for (std::uint32_t result_index = 0;
                             contiguous && result_index < instruction.result_count; ++result_index) {
                            const auto& store =
                                function.instructions[instruction_index + 1u + result_index];
                            const auto destination = base + instruction.result_count - 1u - result_index;
                            contiguous = store.opcode == Opcode::StoreLocal &&
                                store.index == destination &&
                                destination < function.local_classes.size() &&
                                function.local_classes[destination] ==
                                    vkf::machine_ir::ValueClass::F64;
                        }
                        if (contiguous) direct_result_base = base;
                    }
                }
                const bool forward_tail_results = policy_.direct_aggregate_results && !entry &&
                    instruction.result_count >= 8u && !direct_result_base &&
                    instruction_index + 1u < function.instructions.size() &&
                    function.instructions[instruction_index + 1u].opcode == Opcode::ReturnValues &&
                    function.instructions[instruction_index + 1u].result_count ==
                        instruction.result_count;
                code_.raw({0x4c, 0x8d, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first));
                if (direct_result_base) {
                    code_.raw({0x4c, 0x8d, 0x9d});
                    code_.i32(frame.displacement(*direct_result_base));
                } else if (forward_tail_results) {
                    restore_result_context(frame);
                } else {
                    code_.raw({0x4d, 0x89, 0xd3});
                }
                if (instruction.uses_parameter_mask) {
                    code_.raw({0x41, 0xb9});
                    code_.i32(static_cast<std::int32_t>(instruction.provided_parameter_mask));
                }
                code_.byte(0xe8);
                calls_.push_back({code_.rel32_placeholder(), instruction.symbol});
                stack_depth = first;
                if (!direct_result_base && !forward_tail_results) {
                    stack_depth += instruction.result_count;
                }
                if (instruction.may_error) {
                    if (instruction.has_error_handler) {
                        store_error_message_local(frame, instruction.error_value_local);
                        store_error_type_local(frame, instruction.error_type_local);
                        code_.raw({0x45, 0x85, 0xc9});
                        branches.push_back({emit_jump(0x85), instruction.label});
                    } else {
                        code_.raw({0x45, 0x85, 0xc9});
                        const auto succeeded = emit_jump(0x84);
                        if (entry) {
                            emit_abort();
                        } else {
                            code_.raw({0x4c, 0x89, 0x85});
                            code_.i32(frame.displacement(frame.error_pointer_slot));
                            store_xmm(2, frame.displacement(frame.error_length_slot));
                            code_.raw({0x44, 0x89, 0xc8, 0xf2, 0x0f, 0x2a, 0xc0});
                            store_xmm(0, frame.displacement(frame.error_type_slot));
                            emit_error_cleanup(function, frame);
                            code_.raw({0x4c, 0x8b, 0x85});
                            code_.i32(frame.displacement(frame.error_pointer_slot));
                            load_xmm(2, frame.displacement(frame.error_length_slot));
                            load_xmm(0, frame.displacement(frame.error_type_slot));
                            code_.raw({0xf2, 0x0f, 0x2c, 0xc0, 0x41, 0x89, 0xc1});
                            epilogue();
                        }
                        code_.patch_rel32(succeeded, code_.position());
                    }
                }
                if (direct_result_base) {
                    instruction_index += instruction.result_count;
                } else if (forward_tail_results) {
                    epilogue();
                    ++instruction_index;
                }
            } else if (opcode == Opcode::Label) {
                align_loop_header(instruction.label);
                if (!labels.emplace(instruction.label, code_.position()).second) {
                    throw BackendFailure("duplicate x64 machine IR label");
                }
            } else if (opcode == Opcode::Jump) {
                code_.byte(0xe9);
                branches.push_back({code_.rel32_placeholder(), instruction.label});
            } else if (opcode == Opcode::JumpIfFalse) {
                require_stack(stack_depth, 1);
                --stack_depth;
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                emit_truth_to_al(0);
                code_.raw({0x84, 0xc0});
                branches.push_back({emit_jump(0x84), instruction.label});
            } else if (opcode == Opcode::JumpIfTrue) {
                require_stack(stack_depth, 1);
                --stack_depth;
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                emit_truth_to_al(0);
                code_.raw({0x84, 0xc0});
                branches.push_back({emit_jump(0x85), instruction.label});
            } else if (opcode == Opcode::JumpIfParameterProvided) {
                if (!function.parameter_mask_local || instruction.index >= 32) {
                    throw BackendFailure("invalid x64 parameter-mask branch");
                }
                code_.raw({0x8b, 0x85});
                code_.i32(frame.displacement(*function.parameter_mask_local));
                code_.byte(0xa9);
                code_.i32(static_cast<std::int32_t>(1u << instruction.index));
                branches.push_back({emit_jump(0x85), instruction.label});
            } else if (opcode == Opcode::ErrorTypeMatches) {
                require_stack(stack_depth, 1);
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                code_.raw({0xf2, 0x0f, 0x2c, 0xc0, 0x25});
                code_.i32(static_cast<std::int32_t>(instruction.index));
                code_.byte(0x3d);
                code_.i32(static_cast<std::int32_t>(instruction.index));
                code_.raw({0x0f, 0x94, 0xc0});
                emit_al_as_f64();
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::RethrowError) {
                load_error_payload_local(
                    frame, instruction.error_value_local, instruction.error_type_local);
                if (instruction.has_error_handler) {
                    store_error_message_local(frame, instruction.handler_error_value_local);
                    store_error_type_local(frame, instruction.handler_error_type_local);
                    code_.byte(0xe9);
                    branches.push_back({code_.rel32_placeholder(), instruction.label});
                } else if (entry) {
                    emit_abort();
                } else {
                    code_.raw({0x4c, 0x89, 0x85});
                    code_.i32(frame.displacement(frame.error_pointer_slot));
                    store_xmm(2, frame.displacement(frame.error_length_slot));
                    store_xmm(0, frame.displacement(frame.error_type_slot));
                    emit_error_cleanup(function, frame);
                    code_.raw({0x4c, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.error_pointer_slot));
                    load_xmm(2, frame.displacement(frame.error_length_slot));
                    load_xmm(0, frame.displacement(frame.error_type_slot));
                    code_.raw({0xf2, 0x0f, 0x2c, 0xc0, 0x41, 0x89, 0xc1});
                    epilogue();
                }
            } else if (opcode == Opcode::RaiseErrorValue) {
                require_stack(stack_depth, 5);
                const unsigned first = stack_depth - 5;
                if (instruction.owns_input) {
                    release_owned_string(
                        frame.displacement(frame.temp_base + first + 2),
                        frame.displacement(frame.temp_base + first + 3));
                }
                code_.raw({0x4c, 0x8b, 0x85});
                code_.i32(frame.displacement(frame.temp_base + first));
                load_xmm(2, frame.displacement(frame.temp_base + first + 1));
                load_xmm(0, frame.displacement(frame.temp_base + first + 4));
                code_.raw({0xf2, 0x0f, 0x2c, 0xc0, 0x41, 0x89, 0xc1});
                if (instruction.has_error_handler) {
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_local(frame, instruction.error_type_local);
                    code_.byte(0xe9);
                    branches.push_back({code_.rel32_placeholder(), instruction.label});
                } else if (entry) {
                    emit_abort();
                } else {
                    code_.raw({0x4c, 0x89, 0x85});
                    code_.i32(frame.displacement(frame.error_pointer_slot));
                    store_xmm(2, frame.displacement(frame.error_length_slot));
                    load_xmm(0, frame.displacement(frame.temp_base + first + 4));
                    store_xmm(0, frame.displacement(frame.error_type_slot));
                    emit_error_cleanup(function, frame);
                    code_.raw({0x4c, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.error_pointer_slot));
                    load_xmm(2, frame.displacement(frame.error_length_slot));
                    load_xmm(0, frame.displacement(frame.error_type_slot));
                    code_.raw({0xf2, 0x0f, 0x2c, 0xc0, 0x41, 0x89, 0xc1});
                    epilogue();
                }
                emit_number(vkf::machine_ir::null_value());
                store_xmm(0, frame.displacement(frame.temp_base + first));
                stack_depth = first + 1;
            } else if (opcode == Opcode::AssertTruthyString) {
                require_stack(stack_depth, 3);
                const unsigned first = stack_depth - 3;
                load_xmm(0, frame.displacement(frame.temp_base + first));
                emit_truth_to_al(0);
                code_.raw({0x84, 0xc0});
                const auto passed = emit_jump(0x85);
                if (instruction.has_error_handler) {
                    code_.raw({0x4c, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.temp_base + first + 1));
                    load_xmm(2, frame.displacement(frame.temp_base + first + 2));
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_constant(
                        frame, instruction.error_type_local,
                        instruction.error_type_mask);
                    code_.byte(0xe9);
                    branches.push_back({code_.rel32_placeholder(), instruction.label});
                } else if (entry) {
                    emit_abort();
                } else {
                    code_.raw({0x4c, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.temp_base + first + 1));
                    load_xmm(2, frame.displacement(frame.temp_base + first + 2));
                    code_.raw({0x4c, 0x89, 0x85});
                    code_.i32(frame.displacement(frame.error_pointer_slot));
                    store_xmm(2, frame.displacement(frame.error_length_slot));
                    emit_error_cleanup(function, frame);
                    code_.raw({0x4c, 0x8b, 0x85});
                    code_.i32(frame.displacement(frame.error_pointer_slot));
                    load_xmm(2, frame.displacement(frame.error_length_slot));
                    code_.raw({0x41, 0xb9});
                    code_.i32(static_cast<std::int32_t>(instruction.error_type_mask));
                    epilogue();
                }
                code_.patch_rel32(passed, code_.position());
                release_owned_string(
                    frame.displacement(frame.temp_base + first + 1),
                    frame.displacement(frame.temp_base + first + 2));
                stack_depth -= 2;
            } else if (opcode == Opcode::AssertTruthy) {
                require_stack(stack_depth, 1);
                if (instruction.has_error_handler) {
                    emit_error_message_registers(instruction.index, instruction.byte_count);
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_constant(
                        frame, instruction.error_type_local,
                        instruction.error_type_mask);
                }
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth - 1));
                emit_truth_to_al(0);
                code_.raw({0x84, 0xc0});
                if (instruction.has_error_handler) {
                    branches.push_back({emit_jump(0x84), instruction.label});
                } else {
                    const auto passed = emit_jump(0x85);
                    if (entry) {
                        emit_abort();
                    } else {
                        emit_error_cleanup(function, frame);
                        emit_error_message_registers(instruction.index, instruction.byte_count);
                        code_.raw({0x41, 0xb9});
                        code_.i32(static_cast<std::int32_t>(instruction.error_type_mask));
                        epilogue();
                    }
                    code_.patch_rel32(passed, code_.position());
                }
            } else if (opcode == Opcode::ExitProgram) {
#ifdef _WIN32
                code_.raw({0x31, 0xc9});
#else
                code_.raw({0x31, 0xff});
#endif
                call_runtime_slot(14);
                code_.byte(0xcc);
            } else if (opcode == Opcode::ReturnF64) {
                require_stack(stack_depth, 1);
                --stack_depth;
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                if (entry) restore_runtime_context(frame);
                else {
                    restore_result_context(frame);
                    store_result_to_r11(0);
                    if (function.may_error) code_.raw({0x45, 0x31, 0xc9});
                }
                epilogue();
            } else if (opcode == Opcode::ReturnValues) {
                require_stack(stack_depth, instruction.result_count);
                stack_depth -= instruction.result_count;
                if (!entry) restore_result_context(frame);
                for (unsigned index = 0; index < instruction.result_count; ++index) {
                    if (entry && (module_.output_kind == vkf::machine_ir::OutputKind::MultipleF64 ||
                                  module_.output_kind == vkf::machine_ir::OutputKind::MixedSequence ||
                                  module_.output_kind == vkf::machine_ir::OutputKind::StructuredSequence)) {
                        load_xmm(0, frame.displacement(frame.temp_base + stack_depth + index));
                        code_.raw({0xf2, 0x41, 0x0f, 0x11, 0x84, 0x24});
                        code_.i32(static_cast<std::int32_t>(
                            vkf::machine_ir::runtime_output_base + index * 8u));
                    } else if (entry) {
                        if (index > 7) throw BackendFailure("too many x64 entry return registers");
                        load_xmm(index, frame.displacement(frame.temp_base + stack_depth + index));
                    } else {
                        load_xmm(0, frame.displacement(frame.temp_base + stack_depth + index));
                        store_result_to_r11(index);
                    }
                }
                if (!entry && function.may_error) code_.raw({0x45, 0x31, 0xc9});
                if (entry) restore_runtime_context(frame);
                epilogue();
            } else {
                throw BackendFailure("unhandled x64 machine IR opcode");
            }
            if (stack_depth > frame.max_stack) throw BackendFailure("x64 machine IR stack exceeds frame");
        }
        for (const auto& branch : branches) {
            const auto found = labels.find(branch.label);
            if (found == labels.end()) throw BackendFailure("unknown x64 machine IR label");
            code_.patch_rel32(branch.at, found->second);
        }
        if (stack_depth != 0) {
            throw BackendFailure(
                "unbalanced x64 machine IR function stack in " + function.name +
                ": " + std::to_string(stack_depth));
        }
    }
};

vf::JsonValue adaptive_optimizer_json(
    const std::vector<vkf::adaptive_optimizer::FunctionDecision>& decisions,
    const vkf::adaptive_optimizer::Policy& policy
) {
    vf::JsonValue::Array functions;
    std::string module_material;
    for (const auto& decision : decisions) {
        vf::JsonValue::Object function;
        function["name"] = decision.name;
        function["fingerprint"] = decision.fingerprint;
        function["target_features"] = decision.target_features;
        function["pure"] = decision.pure;
        function["deterministic"] = decision.deterministic;
        function["instruction_count"] = static_cast<double>(decision.instruction_count);
        function["local_count"] = static_cast<double>(decision.local_count);
        function["loop_count"] = static_cast<double>(decision.loop_count);
        function["integer_local_count"] = static_cast<double>(decision.integer_local_count);
        vf::JsonValue::Array strategies;
        for (const auto& strategy : decision.strategies) strategies.emplace_back(strategy);
        function["strategies"] = std::move(strategies);
        vf::JsonValue::Array regions;
        for (const auto& decision_region : decision.regions) {
            vf::JsonValue::Object region;
            region["label"] = static_cast<double>(decision_region.label);
            region["width"] = static_cast<double>(decision_region.width);
            region["kind"] = decision_region.kind;
            region["strategy"] = decision_region.strategy;
            regions.emplace_back(std::move(region));
        }
        function["regions"] = std::move(regions);
        functions.emplace_back(std::move(function));
        module_material += decision.fingerprint;
        module_material.push_back('|');
    }
    vf::JsonValue::Object report;
    report["schema"] = "vkf.adaptive-optimizer";
    report["version"] = static_cast<double>(vkf::adaptive_optimizer::schema_version);
    report["tier"] = "tier0";
    report["policy"] = policy.name;
    vf::JsonValue::Array switches;
    const auto add_switch = [&](bool enabled, const char* name) {
        if (enabled) switches.emplace_back(name);
    };
    add_switch(policy.borrowed_aggregate_parameters, "borrowed-aggregate-parameters");
    add_switch(policy.direct_aggregate_results, "direct-aggregate-results");
    add_switch(policy.packed_matrix_reductions, "packed-matrix-reductions");
    add_switch(policy.native_integer_locals, "native-integer-locals");
    add_switch(policy.native_index_addressing, "native-index-addressing");
    add_switch(policy.parity_specialization, "parity-specialization");
    add_switch(policy.fused_multiply_add, "fused-multiply-add");
    add_switch(policy.packed_dot_reductions, "packed-dot-reductions");
    report["switches"] = std::move(switches);
    report["dense_numeric_maps"] = policy.dense_numeric_maps;
    report["dense_affine_maps"] = policy.dense_affine_maps;
    report["avx_affine_loops"] = policy.avx_affine_loops;
    report["register_cache"] = policy.register_cache;
    report["fingerprint"] = vkf::adaptive_optimizer::hexadecimal(
        vkf::adaptive_optimizer::fnv1a(module_material));
    report["functions"] = std::move(functions);
    return vf::JsonValue(std::move(report));
}

bool can_use_minimal_numeric_elf(const vkf::machine_ir::Module& module) {
    using vkf::machine_ir::Opcode;
    if (module.output_kind != vkf::machine_ir::OutputKind::F64) return false;
    const auto function_is_pure_numeric = [](const vkf::machine_ir::Function& function) {
        if (function.may_error || !function.owned_f64_list_locals.empty() ||
            !function.owned_string_locals.empty()) {
            return false;
        }
        return std::all_of(
            function.instructions.begin(), function.instructions.end(),
            [](const auto& instruction) {
                switch (instruction.opcode) {
                    case Opcode::PushF64:
                    case Opcode::LoadLocal:
                    case Opcode::StoreLocal:
                    case Opcode::Drop:
                    case Opcode::Duplicate:
                    case Opcode::IdentityF64:
                    case Opcode::NegateF64:
                    case Opcode::LogicalNotF64:
                    case Opcode::BooleanizeF64:
                    case Opcode::AddF64:
                    case Opcode::SubtractF64:
                    case Opcode::MultiplyF64:
                    case Opcode::DivideF64:
                    case Opcode::AbsF64:
                    case Opcode::SqrtF64:
                    case Opcode::LogicalXorF64:
                    case Opcode::OrderedLessF64:
                    case Opcode::OrderedLessEqualF64:
                    case Opcode::OrderedGreaterF64:
                    case Opcode::OrderedGreaterEqualF64:
                    case Opcode::OrderedEqualF64:
                    case Opcode::UnorderedNotEqualF64:
                    case Opcode::EqualBits:
                    case Opcode::NotEqualBits:
                    case Opcode::Call:
                    case Opcode::Label:
                    case Opcode::Jump:
                    case Opcode::JumpIfFalse:
                    case Opcode::JumpIfTrue:
                    case Opcode::JumpIfParameterProvided:
                    case Opcode::ReturnF64:
                    case Opcode::ReturnValues:
                        return true;
                    default:
                        return false;
                }
            });
    };
    return function_is_pure_numeric(module.entry) && std::all_of(
        module.functions.begin(), module.functions.end(), function_is_pure_numeric);
}

bool can_tune_machine_code(const vkf::machine_ir::Module& module) {
    if (module.output_kind != vkf::machine_ir::OutputKind::F64) return false;
    const auto safe_function = [](const vkf::machine_ir::Function& function) {
        if (!function.owned_f64_list_locals.empty() || !function.owned_string_locals.empty()) {
            return false;
        }
        return std::all_of(
            function.instructions.begin(), function.instructions.end(),
            [](const auto& instruction) {
                return !vkf::adaptive_optimizer::is_effectful(instruction.opcode) &&
                    !vkf::adaptive_optimizer::is_nondeterministic(instruction.opcode);
            });
    };
    return safe_function(module.entry) && std::all_of(
        module.functions.begin(), module.functions.end(), safe_function);
}

struct TuningCandidateReport {
    std::string policy;
    std::string code_hash;
    std::size_t code_bytes = 0;
    std::uint32_t runs = 0;
    double median_ns = 0.0;
    double mean_ns = 0.0;
    double stddev_ns = 0.0;
    bool tested = false;
    bool correct = true;
};

std::string machine_code_hash(const std::vector<unsigned char>& code) {
    return vkf::adaptive_optimizer::hexadecimal(vkf::adaptive_optimizer::fnv1a(
        std::string_view(
            reinterpret_cast<const char*>(code.data()), code.size())));
}

struct TuningResult {
    vkf::adaptive_optimizer::Policy policy;
    std::vector<unsigned char> code;
    std::vector<TuningCandidateReport> candidates;
    std::uint32_t total_runs = 0;
    double elapsed_ms = 0.0;
    bool eligible = false;
    bool tuned = false;
    bool cache_hit = false;
    std::string fingerprint;
    std::uint32_t landscape_runs = 0;
};

class ExecutableCode {
public:
    ExecutableCode(const std::vector<unsigned char>& code, const unsigned char* string_data)
        : size_(code.size()) {
        if (code.empty()) throw BackendFailure("cannot benchmark empty x64 code");
#ifdef _WIN32
        memory_ = VirtualAlloc(nullptr, size_, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if (!memory_) throw BackendFailure("could not allocate optimizer executable memory");
#else
        memory_ = mmap(nullptr, size_, PROT_READ | PROT_WRITE,
                       MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
        if (memory_ == MAP_FAILED) {
            memory_ = nullptr;
            throw BackendFailure("could not allocate optimizer executable memory");
        }
#endif
        std::memcpy(memory_, code.data(), size_);
#ifdef _WIN32
        DWORD previous = 0;
        if (!VirtualProtect(memory_, size_, PAGE_EXECUTE_READ, &previous)) {
            VirtualFree(memory_, 0, MEM_RELEASE);
            memory_ = nullptr;
            throw BackendFailure("could not protect optimizer executable memory");
        }
        FlushInstructionCache(GetCurrentProcess(), memory_, size_);
#else
        if (mprotect(memory_, size_, PROT_READ | PROT_EXEC) != 0) {
            munmap(memory_, size_);
            memory_ = nullptr;
            throw BackendFailure("could not protect optimizer executable memory");
        }
#endif
        runtime_.fill(0);
        runtime_[0] = function_address(static_cast<double (*)(double, double)>(std::pow));
        runtime_[1] = function_address(static_cast<double (*)(double, double)>(std::fmod));
        runtime_[2] = function_address(static_cast<double (*)(double)>(std::floor));
        runtime_[3] = function_address(static_cast<double (*)(double)>(std::log));
        runtime_[4] = function_address(static_cast<double (*)(double)>(std::sin));
        runtime_[5] = function_address(static_cast<double (*)(double)>(std::cos));
        runtime_[6] = function_address(static_cast<double (*)(double)>(std::exp));
        runtime_[7] = reinterpret_cast<std::uintptr_t>(string_data);
        runtime_[8] = function_address(static_cast<void* (*)(std::size_t)>(std::malloc));
        runtime_[9] = function_address(static_cast<void (*)(void*)>(std::free));
        runtime_[10] = function_address(&tuning_abort);
    }

    ~ExecutableCode() {
        if (!memory_) return;
#ifdef _WIN32
        VirtualFree(memory_, 0, MEM_RELEASE);
#else
        munmap(memory_, size_);
#endif
    }

    ExecutableCode(const ExecutableCode&) = delete;
    ExecutableCode& operator=(const ExecutableCode&) = delete;

    double run() const {
        using Entry = double (*)(const std::uintptr_t*);
        std::jmp_buf escape;
        active_escape_ = &escape;
        if (setjmp(escape) != 0) {
            active_escape_ = nullptr;
            throw BackendFailure("optimizer candidate raised a runtime error");
        }
        const double result = reinterpret_cast<Entry>(memory_)(runtime_.data());
        active_escape_ = nullptr;
        return result;
    }

private:
    [[noreturn]] static void tuning_abort() {
        if (active_escape_) std::longjmp(*active_escape_, 1);
        std::abort();
    }

    template <typename Function>
    static std::uintptr_t function_address(Function function) {
        return reinterpret_cast<std::uintptr_t>(function);
    }

    void* memory_ = nullptr;
    std::size_t size_ = 0;
    std::array<std::uintptr_t, 37> runtime_{};
    inline static thread_local std::jmp_buf* active_escape_ = nullptr;
};

double median(std::vector<double> samples) {
    if (samples.empty()) return 0.0;
    const auto middle = samples.begin() + static_cast<std::ptrdiff_t>(samples.size() / 2u);
    std::nth_element(samples.begin(), middle, samples.end());
    if ((samples.size() & 1u) != 0) return *middle;
    const auto lower = std::max_element(samples.begin(), middle);
    return (*lower + *middle) * 0.5;
}

double mean(const std::vector<double>& samples) {
    if (samples.empty()) return 0.0;
    return std::accumulate(samples.begin(), samples.end(), 0.0) /
        static_cast<double>(samples.size());
}

double sample_stddev(const std::vector<double>& samples) {
    if (samples.size() < 2) return 0.0;
    const double average = mean(samples);
    double squared = 0.0;
    for (const double sample : samples) {
        const double delta = sample - average;
        squared += delta * delta;
    }
    return std::sqrt(squared / static_cast<double>(samples.size() - 1u));
}

bool equivalent_result(double expected, double actual) {
    if (std::isnan(expected)) return std::isnan(actual);
    if (std::isinf(expected) || std::isinf(actual)) return expected == actual;
    const double scale = std::max({1.0, std::abs(expected), std::abs(actual)});
    return std::abs(expected - actual) <= scale * 1e-12;
}

TuningResult tune_machine_code(
    const vkf::machine_ir::Module& module,
    std::uint32_t run_budget,
    double time_budget_ms,
    std::uint32_t landscape_runs
) {
    using Clock = std::chrono::steady_clock;
    const auto started = Clock::now();
    TuningResult result;
    result.landscape_runs = landscape_runs;
    result.policy = vkf::adaptive_optimizer::policy("auto");
    result.eligible = can_tune_machine_code(module);
    if (!result.eligible ||
        (landscape_runs == 0 && (run_budget == 0 || !(time_budget_ms > 0.0)))) {
        result.code = MachineX64Emitter(module, result.policy).emit();
        return result;
    }
    const auto deadline = landscape_runs == 0
        ? started + std::chrono::duration_cast<Clock::duration>(
            std::chrono::duration<double, std::milli>(time_budget_ms))
        : Clock::time_point::max();
    struct Candidate {
        vkf::adaptive_optimizer::Policy policy;
        std::vector<unsigned char> code;
        std::unique_ptr<ExecutableCode> executable;
        std::vector<double> samples_ns;
        std::size_t representative = 0;
        bool correct = true;
        bool tested = false;
    };
    std::vector<Candidate> candidates;
    std::vector<std::uint32_t> policy_order{
        vkf::adaptive_optimizer::policy_mask,
        0u,
    };
    for (std::uint32_t bit = 1;
         bit <= vkf::adaptive_optimizer::packed_dot_reduction_bit; bit <<= 1u) {
        policy_order.push_back(vkf::adaptive_optimizer::policy_mask ^ bit);
        policy_order.push_back(bit);
    }
    for (std::uint32_t mask = 0; mask <= vkf::adaptive_optimizer::policy_mask; ++mask) {
        if (std::find(policy_order.begin(), policy_order.end(), mask) == policy_order.end()) {
            policy_order.push_back(mask);
        }
    }
    for (const auto mask : policy_order) {
        // Auto selection always compares the fully enabled policy with the
        // scalar-safe reference.  The deadline may prune only the additional
        // policy landscape; otherwise a large reference kernel can consume
        // the budget before the primary optimized candidate is even checked.
        if (landscape_runs == 0 && Clock::now() >= deadline && candidates.size() >= 2u) break;
        auto selected = vkf::adaptive_optimizer::policy_from_mask(mask);
        auto code = MachineX64Emitter(module, selected).emit();
        std::size_t representative = candidates.size();
        for (std::size_t index = 0; index < candidates.size(); ++index) {
            if (candidates[index].code == code) {
                representative = candidates[index].representative;
                break;
            }
        }
        std::unique_ptr<ExecutableCode> executable;
        if (representative == candidates.size()) {
            executable = std::make_unique<ExecutableCode>(code, module.string_data.data());
        }
        candidates.push_back({
            std::move(selected), std::move(code), std::move(executable), {},
            representative, false, false});
    }
    if (candidates.empty()) {
        result.code = MachineX64Emitter(module, result.policy).emit();
        return result;
    }

    // Correctness executions count against the same shared budget as timing.
    const auto reference_found = std::find_if(
        candidates.begin(), candidates.end(), [](const Candidate& candidate) {
            return vkf::adaptive_optimizer::mask(candidate.policy) == 0u;
        });
    const auto requested_reference = reference_found == candidates.end()
        ? std::size_t{0}
        : static_cast<std::size_t>(reference_found - candidates.begin());
    const auto reference_index = candidates[requested_reference].representative;
    const auto primary_index = candidates.front().representative;
    Candidate& reference = candidates[reference_index];
    double expected = 0.0;
    try {
        const auto run_started = Clock::now();
        expected = reference.executable->run();
        const auto run_finished = Clock::now();
        if (landscape_runs == 0) {
            reference.samples_ns.push_back(std::chrono::duration<double, std::nano>(
                run_finished - run_started).count());
        }
        reference.correct = true;
        reference.tested = true;
        ++result.total_runs;
    } catch (const BackendFailure&) {
        result.eligible = false;
        result.policy = reference.policy;
        result.code = reference.code;
        result.elapsed_ms = std::chrono::duration<double, std::milli>(
            Clock::now() - started).count();
        return result;
    }
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        auto& candidate = candidates[index];
        if (index != candidate.representative || &candidate == &reference) continue;
        if (landscape_runs == 0 && index != primary_index &&
            (result.total_runs >= run_budget || Clock::now() >= deadline)) break;
        try {
            const auto run_started = Clock::now();
            const double actual = candidate.executable->run();
            const auto run_finished = Clock::now();
            candidate.correct = equivalent_result(expected, actual);
            if (candidate.correct && landscape_runs == 0) {
                candidate.samples_ns.push_back(std::chrono::duration<double, std::nano>(
                    run_finished - run_started).count());
            }
        } catch (const BackendFailure&) {
            candidate.correct = false;
        }
        candidate.tested = true;
        ++result.total_runs;
    }

    std::vector<std::size_t> active;
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        if (index == candidates[index].representative &&
            candidates[index].tested && candidates[index].correct) {
            active.push_back(index);
        }
    }
    if (landscape_runs != 0) {
        for (const auto index : active) {
            volatile double value = candidates[index].executable->run();
            (void)value;
            ++result.total_runs;
        }
        std::vector<std::size_t> order = active;
        for (std::uint32_t round = 0; round < landscape_runs; ++round) {
            if (!order.empty()) {
                const auto offset = static_cast<std::size_t>(
                    (static_cast<std::uint64_t>(round) * 97u) % order.size());
                std::rotate(order.begin(), order.begin() + offset, order.end());
                if ((round & 1u) != 0) std::reverse(order.begin(), order.end());
            }
            for (const auto index : order) {
                auto& candidate = candidates[index];
                const auto sample_started = Clock::now();
                volatile double value = candidate.executable->run();
                (void)value;
                const auto sample_finished = Clock::now();
                candidate.samples_ns.push_back(
                    std::chrono::duration<double, std::nano>(sample_finished - sample_started).count());
                ++result.total_runs;
            }
        }
        std::stable_sort(active.begin(), active.end(), [&](std::size_t left, std::size_t right) {
            return mean(candidates[left].samples_ns) < mean(candidates[right].samples_ns);
        });
    } else {
        std::uint32_t target_samples = 3;
        while (!active.empty() && result.total_runs < run_budget && Clock::now() < deadline) {
            bool sampled = false;
            for (const auto index : active) {
                auto& candidate = candidates[index];
                while (candidate.samples_ns.size() < target_samples &&
                       result.total_runs < run_budget && Clock::now() < deadline) {
                    const auto sample_started = Clock::now();
                    volatile double value = candidate.executable->run();
                    (void)value;
                    const auto sample_finished = Clock::now();
                    candidate.samples_ns.push_back(
                        std::chrono::duration<double, std::nano>(sample_finished - sample_started).count());
                    ++result.total_runs;
                    sampled = true;
                }
            }
            if (!sampled) break;
            std::stable_sort(active.begin(), active.end(), [&](std::size_t left, std::size_t right) {
                return median(candidates[left].samples_ns) < median(candidates[right].samples_ns);
            });
            if (active.size() > 1) active.resize((active.size() + 1u) / 2u);
            target_samples = std::min<std::uint32_t>(
                run_budget, std::max<std::uint32_t>(target_samples + 1u, target_samples * 2u));
        }
        std::stable_sort(active.begin(), active.end(), [&](std::size_t left, std::size_t right) {
            return median(candidates[left].samples_ns) < median(candidates[right].samples_ns);
        });
    }

    std::size_t winner = reference_index;
    if (!active.empty() && !candidates[active.front()].samples_ns.empty()) winner = active.front();
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        if (index == candidates[index].representative) continue;
        const auto& representative = candidates[candidates[index].representative];
        candidates[index].samples_ns = representative.samples_ns;
        candidates[index].correct = representative.correct;
        candidates[index].tested = representative.tested;
    }
    const auto enabled_switch_count = [](std::uint32_t value) {
        std::uint32_t count = 0;
        while (value != 0) {
            value &= value - 1u;
            ++count;
        }
        return count;
    };
    std::size_t selected_alias = winner;
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        if (candidates[index].representative != winner) continue;
        const auto candidate_mask = vkf::adaptive_optimizer::mask(candidates[index].policy);
        const auto selected_mask = vkf::adaptive_optimizer::mask(candidates[selected_alias].policy);
        if (enabled_switch_count(candidate_mask) < enabled_switch_count(selected_mask) ||
            (enabled_switch_count(candidate_mask) == enabled_switch_count(selected_mask) &&
             candidate_mask < selected_mask)) {
            selected_alias = index;
        }
    }
    result.policy = candidates[selected_alias].policy;
    result.code = candidates[winner].code;
    result.tuned = !candidates[winner].samples_ns.empty();
    for (const auto& candidate : candidates) {
        result.candidates.push_back({
            candidate.policy.name,
            machine_code_hash(candidate.code),
            candidate.code.size(),
            static_cast<std::uint32_t>(candidate.samples_ns.size()),
            median(candidate.samples_ns),
            mean(candidate.samples_ns),
            sample_stddev(candidate.samples_ns),
            candidate.tested,
            candidate.correct,
        });
    }
    result.elapsed_ms = std::chrono::duration<double, std::milli>(Clock::now() - started).count();
    return result;
}

vf::JsonValue tuning_json(const TuningResult& tuning, std::string requested_policy) {
    vf::JsonValue::Object report;
    report["requested_policy"] = std::move(requested_policy);
    report["selected_policy"] = tuning.policy.name;
    report["eligible"] = tuning.eligible;
    report["tuned"] = tuning.tuned;
    report["cache_hit"] = tuning.cache_hit;
    report["fingerprint"] = tuning.fingerprint;
    report["total_runs"] = static_cast<double>(tuning.total_runs);
    report["elapsed_ms"] = tuning.elapsed_ms;
    report["landscape_runs"] = static_cast<double>(tuning.landscape_runs);
    vf::JsonValue::Array candidates;
    for (const auto& item : tuning.candidates) {
        vf::JsonValue::Object candidate;
        candidate["policy"] = item.policy;
        candidate["code_hash"] = item.code_hash;
        candidate["code_bytes"] = static_cast<double>(item.code_bytes);
        candidate["runs"] = static_cast<double>(item.runs);
        candidate["median_ns"] = item.median_ns;
        candidate["mean_ns"] = item.mean_ns;
        candidate["stddev_ns"] = item.stddev_ns;
        candidate["tested"] = item.tested;
        candidate["correct"] = item.correct;
        candidates.emplace_back(std::move(candidate));
    }
    report["candidates"] = std::move(candidates);
    return vf::JsonValue(std::move(report));
}

std::string tuning_fingerprint(const vf::JsonValue& typed_ir) {
    std::string material = "vkf-empirical-tuner-v2\n" __DATE__ "\n" __TIME__ "\n";
    material += vkf::target::host_x64_feature_key();
    material.push_back('\n');
    material += vf::json_stringify(typed_ir, -1);
    return vkf::adaptive_optimizer::hexadecimal(
        vkf::adaptive_optimizer::fnv1a(material));
}

std::optional<vkf::adaptive_optimizer::Policy> load_tuning_profile(
    const std::filesystem::path& path,
    const std::string& fingerprint
) {
    try {
        if (!std::filesystem::is_regular_file(path)) return std::nullopt;
        const auto parsed = vf::parse_json(read_text(path));
        const auto& profile = object_of(parsed, "optimizer profile");
        const auto stored_fingerprint = string_field(
            profile, "fingerprint", "optimizer profile");
        if (stored_fingerprint != fingerprint) return std::nullopt;
        return vkf::adaptive_optimizer::policy(
            string_field(profile, "selected_policy", "optimizer profile"));
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

std::filesystem::path optimizer_cache_root() {
    const auto environment_path = [](const char* name) -> std::optional<std::filesystem::path> {
#ifdef _WIN32
        const DWORD required = GetEnvironmentVariableA(name, nullptr, 0);
        if (required == 0) return std::nullopt;
        std::string value(required, '\0');
        const DWORD written = GetEnvironmentVariableA(name, value.data(), required);
        if (written == 0 || written >= required) return std::nullopt;
        value.resize(written);
        return std::filesystem::path(value);
#else
        const char* value = std::getenv(name);
        if (!value || !*value) return std::nullopt;
        return std::filesystem::path(value);
#endif
    };
#ifdef _WIN32
    if (const auto local = environment_path("LOCALAPPDATA")) {
        return *local / "VektorFlow" / "optimizer";
    }
#elif defined(__APPLE__)
    if (const auto home = environment_path("HOME")) {
        return *home / "Library" / "Caches" / "VektorFlow" / "optimizer";
    }
#else
    if (const auto xdg = environment_path("XDG_CACHE_HOME")) {
        return *xdg / "vektor-flow" / "optimizer";
    }
    if (const auto home = environment_path("HOME")) {
        return *home / ".cache" / "vektor-flow" / "optimizer";
    }
#endif
    return std::filesystem::temp_directory_path() / "vektor-flow-optimizer-cache";
}

void write_tuning_profile(const std::filesystem::path& path, const TuningResult& tuning) {
    if (!tuning.tuned || tuning.fingerprint.empty()) return;
    vf::JsonValue::Object profile;
    profile["schema"] = "vkf.optimizer-profile";
    profile["version"] = 1.0;
    profile["fingerprint"] = tuning.fingerprint;
    profile["target_features"] = std::string(vkf::target::host_x64_feature_key());
    profile["selected_policy"] = tuning.policy.name;
    profile["total_runs"] = static_cast<double>(tuning.total_runs);
    profile["elapsed_ms"] = tuning.elapsed_ms;
    try {
        std::filesystem::create_directories(path.parent_path());
        write_text(path, vf::json_stringify(vf::JsonValue(std::move(profile)), 2) + "\n");
    } catch (const std::exception&) {
        // Optimization profiles are best-effort cache data. Compilation must
        // still succeed when a locked-down host has no writable cache root.
    }
}

struct Args {
    std::filesystem::path self;
    std::filesystem::path source;
    std::filesystem::path typed_ir;
    std::filesystem::path runner_template;
};

Args parse_args(int argc, char** argv) {
    Args args;
    args.self = std::filesystem::absolute(argv[0]);
    for (int index = 1; index < argc; ++index) {
        const std::string arg = argv[index];
        if (arg == "--source" && index + 1 < argc) args.source = argv[++index];
        else if (arg == "--typed-ir" && index + 1 < argc) args.typed_ir = argv[++index];
        else if (arg == "--template" && index + 1 < argc) args.runner_template = argv[++index];
        else if (arg == "--dependency" && index + 1 < argc) ++index;
        else if (arg == "--deferred") {}
        else throw BackendFailure("usage: vkf_x64_artifact --source file --typed-ir file [--template runner.exe]");
    }
    if (args.source.empty() || args.typed_ir.empty()) throw BackendFailure("source and typed IR are required");
    if (args.runner_template.empty()) args.runner_template = args.self.parent_path() / "vkf_x64_runner_template.exe";
    return args;
}

}  // namespace

vkf_x64_backend::SupportResult vkf_x64_backend::inspect(const vf::JsonValue& typed_ir) noexcept {
    try {
        const auto machine_ir = vkf::machine_ir::lower(typed_ir);
        (void)MachineX64Emitter(machine_ir).emit();
        return {true, ""};
    } catch (const vkf::machine_ir::LoweringFailure& error) {
        return {false, error.what()};
    } catch (const BackendFailure& error) {
        return {false, error.what()};
    } catch (const std::exception& error) {
        return {false, std::string("backend analysis failed: ") + error.what()};
    }
}

bool vkf_x64_backend::supports(const vf::JsonValue& typed_ir) noexcept {
    return inspect(typed_ir).supported;
}

vkf_x64_backend::ArtifactResult vkf_x64_backend::compile(
    const vf::JsonValue& typed_ir,
    const std::filesystem::path& source,
    const std::filesystem::path& typed_ir_path,
    const std::filesystem::path& runner_template,
    bool emit_debug_files,
    const std::filesystem::path& requested_artifact,
    const std::string& cache_fingerprint,
    const std::string& optimization_policy,
    std::uint32_t optimization_run_budget,
    double optimization_time_budget_ms,
    std::uint32_t optimization_landscape_runs
) {
    constexpr auto target = vkf::target::host_x64_contract();
    const std::string stem = source.stem().string().empty() ? "program" : source.stem().string();
    const auto build_root = std::filesystem::absolute(source).parent_path() / ".vkfbuild";
    const std::string optimizer_fingerprint = tuning_fingerprint(typed_ir);
    const auto optimizer_profile_path = emit_debug_files
        ? build_root / (stem + "-optimizer-profile.json")
        : optimizer_cache_root() / (optimizer_fingerprint + ".json");
    std::vector<unsigned char> code;
    vkf::machine_ir::Module machine_ir;
    std::vector<vkf::adaptive_optimizer::FunctionDecision> optimization_decisions;
    vkf::adaptive_optimizer::Policy selected_policy;
    TuningResult tuning;
    try {
        machine_ir = vkf::machine_ir::lower(typed_ir);
        const bool supports_simd = vkf::target::host_x64_supports_avx2();
        optimization_decisions = vkf::adaptive_optimizer::decide_module(
            machine_ir, std::string(vkf::target::host_x64_feature_key()), supports_simd);
        if (!cache_fingerprint.empty()) {
            const std::string marker = "VKF-CACHE-V1:" + cache_fingerprint;
            machine_ir.string_data.insert(
                machine_ir.string_data.end(), marker.begin(), marker.end());
        }
        const auto cached_policy = optimization_policy == "auto"
            ? load_tuning_profile(optimizer_profile_path, optimizer_fingerprint)
            : std::nullopt;
        if (cached_policy) {
            selected_policy = *cached_policy;
            tuning.policy = selected_policy;
            tuning.eligible = can_tune_machine_code(machine_ir);
            tuning.cache_hit = true;
            code = MachineX64Emitter(machine_ir, selected_policy).emit();
        } else if (optimization_policy == "tune" || optimization_policy == "auto") {
            tuning = tune_machine_code(
                machine_ir, optimization_run_budget, optimization_time_budget_ms,
                optimization_landscape_runs);
            selected_policy = tuning.policy;
            code = std::move(tuning.code);
        } else {
            selected_policy = vkf::adaptive_optimizer::policy(optimization_policy);
            tuning.policy = selected_policy;
            tuning.eligible = can_tune_machine_code(machine_ir);
            code = MachineX64Emitter(machine_ir, selected_policy).emit();
        }
        tuning.fingerprint = optimizer_fingerprint;
    } catch (const vkf::machine_ir::LoweringFailure& error) {
        throw vkf_x64_backend::Unsupported(error.what());
    } catch (const BackendFailure& error) {
        throw vkf_x64_backend::Unsupported(error.what());
    }
    std::vector<unsigned char> executable;
    std::size_t template_bytes = 0;
    bool is_pe = false;
    bool is_elf = false;
    bool compacted = false;
#if defined(_WIN32)
    try {
        auto artifact = vkf::pe::executable_x64(
            code, machine_ir.string_data,
            machine_ir.output_kind == vkf::machine_ir::OutputKind::String,
            machine_ir.output_kind == vkf::machine_ir::OutputKind::None,
            machine_ir.output_kind == vkf::machine_ir::OutputKind::MultipleF64
                ? machine_ir.output_count : 0u,
            vkf::pe::math_imports_for(machine_ir), machine_ir.outputs, machine_ir.output_tokens);
        executable = std::move(artifact.bytes);
        is_pe = true;
    } catch (const vkf::pe::WriterFailure& error) {
        throw BackendFailure(error.what());
    }
#elif defined(__linux__)
    try {
        auto artifact = can_use_minimal_numeric_elf(machine_ir)
            ? vkf::elf::minimal_numeric_executable_x64(code)
            : vkf::elf::executable_x64(
                code, machine_ir.string_data,
                machine_ir.output_kind == vkf::machine_ir::OutputKind::String,
                machine_ir.output_kind == vkf::machine_ir::OutputKind::None,
                machine_ir.output_kind == vkf::machine_ir::OutputKind::MultipleF64
                    ? machine_ir.output_count : 0u,
                machine_ir.outputs, machine_ir.output_tokens);
        executable = std::move(artifact.bytes);
        is_elf = true;
    } catch (const vkf::elf::WriterFailure& error) {
        throw BackendFailure(error.what());
    }
#else
    if (code.size() > kCodeCapacity) throw BackendFailure("x64 code exceeds stage0 template slot");
    executable = read_bytes(runner_template);
    template_bytes = executable.size();
    const auto marker = std::search(executable.begin(), executable.end(), std::begin(kMarker), std::end(kMarker));
    if (marker == executable.end()) throw BackendFailure("runner template has no x64 code slot");
    const std::size_t offset = static_cast<std::size_t>(marker - executable.begin());
    if (offset + kCodeCapacity > executable.size()) throw BackendFailure("runner template code slot is truncated");
    std::fill(executable.begin() + static_cast<std::ptrdiff_t>(offset), executable.begin() + static_cast<std::ptrdiff_t>(offset + kCodeCapacity), 0xcc);
    std::copy(code.begin(), code.end(), executable.begin() + static_cast<std::ptrdiff_t>(offset));
    is_pe = executable.size() >= 2 && executable[0] == 'M' && executable[1] == 'Z';
    is_elf = executable.size() >= 4
        && executable[0] == 0x7f && executable[1] == 'E'
        && executable[2] == 'L' && executable[3] == 'F';
    if (!is_pe && !is_elf) throw BackendFailure("runner template is neither PE nor ELF");
    compacted = is_pe && compact_code_section(executable, offset, code.size());
#endif

    const bool eval_source = source.parent_path().filename() == ".vkf-eval";
    const auto build_dir = emit_debug_files && !eval_source ? build_root / stem : build_root;
#ifdef _WIN32
    const auto artifact_name = stem + ".exe";
#else
    const auto artifact_name = emit_debug_files ? stem : stem + ".native";
#endif
    ArtifactResult result{
        requested_artifact.empty() ? build_dir / artifact_name : std::filesystem::absolute(requested_artifact),
        build_dir / (emit_debug_files ? "x64-manifest.json" : stem + "-x64-manifest.json"),
        build_dir / "machine-ir.json",
        code.size(),
    };
    std::filesystem::create_directories(result.artifact_path.parent_path());
    write_tuning_profile(optimizer_profile_path, tuning);
    if (emit_debug_files) std::filesystem::create_directories(build_dir);
    const auto code_path = build_dir / "x64-code.bin";
    const auto data_path = build_dir / "x64-data.bin";
    if (emit_debug_files) {
        write_text(result.machine_ir_path, vf::json_stringify(vkf::machine_ir::module_json(machine_ir), 2) + "\n");
        write_bytes(code_path, code);
        write_bytes(data_path, machine_ir.string_data);
    }
    const bool artifact_written = write_bytes_if_changed(result.artifact_path, executable);
#ifndef _WIN32
    std::filesystem::permissions(
        result.artifact_path,
        std::filesystem::perms::owner_exec
            | std::filesystem::perms::group_exec
            | std::filesystem::perms::others_exec,
        std::filesystem::perm_options::add
    );
#endif

    if (emit_debug_files) {
        vf::JsonValue::Object manifest;
        manifest["backend"] = is_pe ? "x64-pe" : "x64-elf";
        manifest["adaptive_optimizer"] = adaptive_optimizer_json(
            optimization_decisions, selected_policy);
        manifest["empirical_tuning"] = tuning_json(tuning, optimization_policy);
        manifest["artifact_bytes"] = static_cast<double>(executable.size());
        manifest["artifact_compacted"] = compacted;
        manifest["artifact_writer"] = template_bytes == 0 ? "compiler-owned" : "stage0-template";
        manifest["artifact_written"] = artifact_written;
        manifest["code_bytes"] = static_cast<double>(code.size());
        manifest["diagnostic_sidecars"] = true;
        manifest["code_path"] = std::filesystem::absolute(code_path).string();
        manifest["data_path"] = std::filesystem::absolute(data_path).string();
        manifest["machine_ir_version"] = static_cast<double>(vkf::machine_ir::schema_version);
        manifest["runtime_abi_version"] = 12.0;
        manifest["result_transport"] = machine_ir.output_kind == vkf::machine_ir::OutputKind::String
            ? "stdout-string"
            : machine_ir.output_kind == vkf::machine_ir::OutputKind::F64 ? "stdout-f64"
            : machine_ir.output_kind == vkf::machine_ir::OutputKind::MultipleF64
                ? "stdout-f64-sequence"
            : machine_ir.output_kind == vkf::machine_ir::OutputKind::MixedSequence
                ? "stdout-value-sequence"
            : machine_ir.output_kind == vkf::machine_ir::OutputKind::StructuredSequence
                ? "stdout-display-plan" : "none";
        manifest["output_count"] = static_cast<double>(machine_ir.output_count);
        manifest["string_bytes"] = static_cast<double>(machine_ir.string_data.size());
        manifest["machine_ir"] = std::filesystem::absolute(result.machine_ir_path).string();
        manifest["target_architecture"] = vkf::target::name(target.architecture);
        manifest["target_calling_convention"] = vkf::target::name(target.calling_convention);
        manifest["target_object_format"] = vkf::target::name(target.object_format);
        manifest["target_os"] = vkf::target::name(target.operating_system);
        manifest["source"] = std::filesystem::absolute(source).string();
        manifest["template_bytes"] = static_cast<double>(template_bytes);
        manifest["typed_ir"] = std::filesystem::absolute(typed_ir_path).string();
        write_text(result.manifest_path, vf::json_stringify(vf::JsonValue(manifest)) + "\n");
    }
    return result;
}

#ifndef VKF_X64_BACKEND_LIBRARY
int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
        const vf::JsonValue ir = vf::parse_json(read_text(args.typed_ir));
        const auto result = vkf_x64_backend::compile(ir, args.source, args.typed_ir, args.runner_template);

        vf::JsonValue::Object summary;
        summary["artifact_path"] = result.artifact_path.string();
        summary["manifest_path"] = result.manifest_path.string();
        summary["machine_ir_path"] = result.machine_ir_path.string();
        summary["status"] = "compiled";
        std::cout << vf::json_stringify(vf::JsonValue(summary)) << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "<x64-backend>:1:1: " << error.what() << '\n';
        return 1;
    }
}
#endif
