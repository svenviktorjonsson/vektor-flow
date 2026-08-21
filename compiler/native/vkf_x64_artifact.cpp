#include "native/VfOverlay/vf/json.hpp"
#include "compiler/native/vkf_x64_backend.hpp"
#include "compiler/native/vkf_elf_writer.hpp"
#include "compiler/native/vkf_pe_writer.hpp"
#include "compiler/native/vkf_machine_ir.hpp"
#include "compiler/native/vkf_machine_ir_lowering.hpp"
#include "compiler/native/vkf_machine_ir_json.hpp"
#include "compiler/native/vkf_target.hpp"
#include "compiler/native/vkf_capture_pattern.hpp"

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

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
    explicit MachineX64Emitter(const vkf::machine_ir::Module& module) : module_(module) {}

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
    struct Frame {
        unsigned local_count = 0;
        unsigned temp_base = 0;
        unsigned max_stack = 0;
        unsigned context_slot = 0;
        unsigned scratch_slot = 0;
        unsigned scratch_slots = 0;
        unsigned error_pointer_slot = 0;
        unsigned error_length_slot = 0;
        unsigned error_type_slot = 0;
        unsigned frame_bytes = 0;

        std::int32_t displacement(unsigned index) const {
            return -static_cast<std::int32_t>((index + 1) * 8);
        }
    };

    const vkf::machine_ir::Module& module_;
    std::map<std::string, std::size_t> offsets_;
    std::vector<CallPatch> calls_;
    Code code_;

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
        const bool needs_capture_scratch = std::any_of(
            function.instructions.begin(), function.instructions.end(), [](const auto& instruction) {
                return instruction.opcode == vkf::machine_ir::Opcode::CaptureRegex;
            });
        const bool needs_line_scratch = std::any_of(
            function.instructions.begin(), function.instructions.end(), [](const auto& instruction) {
                return instruction.opcode == vkf::machine_ir::Opcode::ReadLineString;
            });
        frame.scratch_slots = needs_process_scratch ? 9u
            : (needs_capture_scratch || needs_line_scratch) ? 4u
            : static_cast<unsigned>(needs_scratch);
        frame.error_pointer_slot = frame.scratch_slot + frame.scratch_slots;
        frame.error_length_slot = frame.error_pointer_slot + 1u;
        frame.error_type_slot = frame.error_length_slot + 1u;
        const unsigned value_slots = frame.local_count + frame.max_stack + 1u +
            frame.scratch_slots + (function.may_error ? 3u : 0u);
        const unsigned used = value_slots * 8 + target.caller_shadow_bytes;
        frame.frame_bytes = (used + target.stack_alignment - 1) & ~(target.stack_alignment - 1u);
        return frame;
    }

    void prologue(const Frame& frame) {
        code_.raw({0x55, 0x48, 0x89, 0xe5});
        emit_stack_allocation(code_, frame.frame_bytes);
    }

    void epilogue() { code_.raw({0xc9, 0xc3}); }

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
        const Frame& frame,
        unsigned first,
        const vkf::machine_ir::Instruction& instruction
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
        std::vector<std::size_t> failures;

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
            failures.push_back(code_.rel32_placeholder());
        }
        if (pattern.anchor_end) {
            code_.raw({0x4c, 0x39, 0xca, 0x0f, 0x85});
            failures.push_back(code_.rel32_placeholder());
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

        const auto failed = code_.position();
        for (const auto patch : failures) code_.patch_rel32(patch, failed);
        if (pattern.anchor_start) {
            emit_abort();
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
            emit_abort();
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

    void emit_function(const vkf::machine_ir::Function& function, bool entry) {
        const Frame frame = make_frame(function, entry);
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
        for (std::size_t index = 0; index < function.parameters.size(); ++index) {
            if (entry) store_xmm(static_cast<unsigned>(index), frame.displacement(static_cast<unsigned>(index)));
            else {
                load_argument_from_r10(static_cast<std::uint32_t>(index));
                store_xmm(0, frame.displacement(static_cast<unsigned>(index)));
            }
        }

        unsigned stack_depth = 0;
        std::map<std::uint32_t, std::size_t> labels;
        std::vector<MachineBranchPatch> branches;
        for (const auto& instruction : function.instructions) {
            using vkf::machine_ir::Opcode;
            const auto opcode = instruction.opcode;
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
                load_xmm(0, frame.displacement(instruction.index));
                store_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::StoreLocal) {
                require_stack(stack_depth, 1);
                --stack_depth;
                load_xmm(0, frame.displacement(frame.temp_base + stack_depth));
                store_xmm(0, frame.displacement(instruction.index));
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
                emit_capture_regex(frame, first, instruction);
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
                code_.raw({0x48, 0x8d, 0x85});
                code_.i32(frame.displacement(instruction.index));
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
                        code_.raw({0x49, 0x83, 0xf8,
                                   static_cast<std::uint8_t>(
                                       (opcode == Opcode::VarianceF64List ||
                                        opcode == Opcode::StdDevF64List)
                                           ? instruction.degrees_of_freedom
                                           : 0u),
                                   0x0f, 0x87});
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
                            code_.raw({0x49, 0x83, 0xe8,
                                       static_cast<std::uint8_t>(instruction.degrees_of_freedom)});
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
                load_xmm(0, frame.displacement(frame.temp_base + first));
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8,
                           0xf2, 0x48, 0x0f, 0x2a, 0xc9,
                           0x66, 0x0f, 0x2e, 0xc8});
                std::vector<std::size_t> invalid;
                invalid.push_back(emit_jump(0x85));
                invalid.push_back(emit_jump(0x8a));
                code_.raw({0x48, 0x85, 0xc9});
                invalid.push_back(emit_jump(0x88));
                code_.raw({0x48, 0x81, 0xf9});
                code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                invalid.push_back(emit_jump(0x83));
                code_.raw({0x48, 0x8d, 0x85});
                code_.i32(frame.displacement(instruction.index));
                code_.raw({0x48, 0xf7, 0xd9,
                           0xf2, 0x0f, 0x10, 0x04, 0xc8});
                store_xmm(0, frame.displacement(frame.temp_base + first));
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
            } else if (opcode == Opcode::StoreF64LocalsIndex) {
                require_stack(stack_depth, 2);
                if (instruction.index > frame.local_count ||
                    instruction.argument_count > frame.local_count - instruction.index) {
                    throw BackendFailure("invalid x64 fixed-vector update range");
                }
                const unsigned first = stack_depth - 2;
                load_xmm(0, frame.displacement(frame.temp_base + first));
                code_.raw({0xf2, 0x48, 0x0f, 0x2c, 0xc8,
                           0xf2, 0x48, 0x0f, 0x2a, 0xc9,
                           0x66, 0x0f, 0x2e, 0xc8});
                std::vector<std::size_t> invalid;
                invalid.push_back(emit_jump(0x85));
                invalid.push_back(emit_jump(0x8a));
                code_.raw({0x48, 0x85, 0xc9});
                invalid.push_back(emit_jump(0x88));
                code_.raw({0x48, 0x81, 0xf9});
                code_.i32(static_cast<std::int32_t>(instruction.argument_count));
                invalid.push_back(emit_jump(0x83));
                code_.raw({0x48, 0x8d, 0x85});
                code_.i32(frame.displacement(instruction.index));
                code_.raw({0x48, 0xf7, 0xd9});
                load_xmm(0, frame.displacement(frame.temp_base + first + 1));
                code_.raw({0xf2, 0x0f, 0x11, 0x04, 0xc8});
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
                code_.raw({0x4c, 0x8d, 0x95});
                code_.i32(frame.displacement(frame.temp_base + first));
                code_.raw({0x4d, 0x89, 0xd3});
                if (instruction.uses_parameter_mask) {
                    code_.raw({0x41, 0xb9});
                    code_.i32(static_cast<std::int32_t>(instruction.provided_parameter_mask));
                }
                code_.byte(0xe8);
                calls_.push_back({code_.rel32_placeholder(), instruction.symbol});
                stack_depth = first;
                stack_depth += instruction.result_count;
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
            } else if (opcode == Opcode::Label) {
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
    const std::string& cache_fingerprint
) {
    constexpr auto target = vkf::target::host_x64_contract();
    std::vector<unsigned char> code;
    vkf::machine_ir::Module machine_ir;
    try {
        machine_ir = vkf::machine_ir::lower(typed_ir);
        if (!cache_fingerprint.empty()) {
            const std::string marker = "VKF-CACHE-V1:" + cache_fingerprint;
            machine_ir.string_data.insert(
                machine_ir.string_data.end(), marker.begin(), marker.end());
        }
        code = MachineX64Emitter(machine_ir).emit();
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
        auto artifact = vkf::elf::executable_x64(
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

    const std::string stem = source.stem().string().empty() ? "program" : source.stem().string();
    const auto build_root = std::filesystem::absolute(source).parent_path() / ".vkfbuild";
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
