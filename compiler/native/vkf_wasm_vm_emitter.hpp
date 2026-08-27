#pragma once

#include "vkf_wasm_bytecode.hpp"
#include "vkf_wasm_value_layout.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vkf::wasm::vm {

class VmEmitterError : public std::runtime_error {
public:
    explicit VmEmitterError(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct EmitterOptions {
    std::uint32_t slot_capacity = 16;
    std::uint32_t arena_capacity = 1024U * 1024U;
};

struct ModuleLayout {
    std::uint32_t bytecode_ptr = 0;
    std::uint32_t bytecode_len = 0;
    std::uint32_t arguments_ptr = 0;
    std::uint32_t arguments_capacity = 0;
    std::uint32_t results_ptr = 0;
    std::uint32_t results_capacity = 1;
    std::uint32_t value_slot_size = values::slot_size;
    std::uint32_t heap_base = 0;
    std::uint32_t heap_limit = 0;
};

struct EmittedModule {
    std::vector<std::uint8_t> wasm;
    ModuleLayout layout;
};

namespace detail {

inline constexpr std::uint8_t wasm_i32 = 0x7f;
inline constexpr std::uint8_t wasm_f64 = 0x7c;
inline constexpr std::uint32_t wasm_page_size = 65536;

class Writer {
public:
    void u8(std::uint8_t value) {
        bytes_.push_back(value);
    }

    void raw(const std::vector<std::uint8_t>& bytes) {
        bytes_.insert(bytes_.end(), bytes.begin(), bytes.end());
    }

    void raw(const std::uint8_t* data, std::size_t size) {
        bytes_.insert(bytes_.end(), data, data + size);
    }

    void u32_leb(std::uint32_t value) {
        do {
            std::uint8_t byte = static_cast<std::uint8_t>(value & 0x7fU);
            value >>= 7U;
            if (value != 0) {
                byte |= 0x80U;
            }
            u8(byte);
        } while (value != 0);
    }

    void i32_leb(std::int32_t value) {
        bool more = true;
        while (more) {
            std::uint8_t byte = static_cast<std::uint8_t>(value & 0x7f);
            value >>= 7;
            const bool sign = (byte & 0x40U) != 0;
            more = !((value == 0 && !sign) || (value == -1 && sign));
            if (more) {
                byte |= 0x80U;
            }
            u8(byte);
        }
    }

    void f64(double value) {
        std::uint64_t bits = 0;
        static_assert(sizeof(bits) == sizeof(value), "f64 width mismatch");
        std::memcpy(&bits, &value, sizeof(bits));
        for (unsigned shift = 0; shift < 64; shift += 8) {
            u8(static_cast<std::uint8_t>((bits >> shift) & 0xffU));
        }
    }

    void name(const std::string& value) {
        u32_leb(static_cast<std::uint32_t>(value.size()));
        raw(reinterpret_cast<const std::uint8_t*>(value.data()), value.size());
    }

    std::vector<std::uint8_t> take() {
        return std::move(bytes_);
    }

private:
    std::vector<std::uint8_t> bytes_;
};

inline void append_section(
    Writer& module,
    std::uint8_t id,
    std::vector<std::uint8_t> payload
) {
    module.u8(id);
    module.u32_leb(static_cast<std::uint32_t>(payload.size()));
    module.raw(payload);
}

inline std::uint32_t align_up(std::uint32_t value, std::uint32_t alignment) {
    const std::uint32_t remainder = value % alignment;
    if (remainder == 0) {
        return value;
    }
    const std::uint32_t increment = alignment - remainder;
    if (value > std::numeric_limits<std::uint32_t>::max() - increment) {
        throw VmEmitterError("WASM VM memory layout exceeds 32-bit address space");
    }
    return value + increment;
}

struct StackEffect {
    std::uint32_t operands = 0;
    std::uint32_t results = 0;
};

inline StackEffect stack_effect(const bytecode::Instruction& instruction) {
    using bytecode::Opcode;
    switch (instruction.opcode) {
        case Opcode::Nop:
        case Opcode::Jump:
        case Opcode::Trap:
            return {};
        case Opcode::PushConstant:
        case Opcode::PushNull:
        case Opcode::LoadLocal:
            return {0, 1};
        case Opcode::StoreLocal:
        case Opcode::Pop:
        case Opcode::Return:
            return {1, 0};
        case Opcode::Duplicate:
            return {1, 2};
        case Opcode::Negate:
        case Opcode::LogicalNot:
        case Opcode::SquareRoot:
        case Opcode::Utf8Length:
        case Opcode::DecimalParse:
        case Opcode::NumberToString:
        case Opcode::Utf8IsIdentifierStart:
        case Opcode::Utf8IsIdentifierContinue:
        case Opcode::Sine:
        case Opcode::Cosine:
        case Opcode::Tangent:
        case Opcode::Absolute:
        case Opcode::NaturalLog:
        case Opcode::Exponential:
        case Opcode::IdentifierScan:
        case Opcode::OperatorScan:
        case Opcode::ArrayLength:
        case Opcode::AllocateArray:
        case Opcode::OperatorKind:
        case Opcode::PlotBuilderFinish:
            return {1, 1};
        case Opcode::Add:
        case Opcode::Subtract:
        case Opcode::Multiply:
        case Opcode::Divide:
        case Opcode::Remainder:
        case Opcode::FloorDivide:
        case Opcode::Equal:
        case Opcode::NotEqual:
        case Opcode::Less:
        case Opcode::LessEqual:
        case Opcode::Greater:
        case Opcode::GreaterEqual:
        case Opcode::LogicalAnd:
        case Opcode::LogicalOr:
        case Opcode::Power:
        case Opcode::Atan2:
        case Opcode::PlotPack:
        case Opcode::PlotBuilderCreate:
        case Opcode::PlotBuilderPush:
        case Opcode::ArrayGet:
        case Opcode::ArrayConcat:
        case Opcode::ObjectSet:
        case Opcode::Utf8Eof:
        case Opcode::Utf8PeekScalar:
        case Opcode::Utf8Advance:
        case Opcode::Concatenate:
        case Opcode::DecimalScanEnd:
        case Opcode::IdentifierScanEnd:
        case Opcode::OperatorWidth:
            return {2, 1};
        case Opcode::Utf8Slice:
            return {3, 1};
        case Opcode::JumpIfFalse:
            return {1, 0};
        case Opcode::Call:
            return {instruction.second, 1};
        case Opcode::MakeArray:
            return {instruction.first, 1};
        case Opcode::ArraySet:
            return {3, 1};
        case Opcode::MakeObject:
            return {instruction.first * 2U, 1};
        case Opcode::ObjectGet:
            return {1, 1};
    }
    throw VmEmitterError("unknown bytecode opcode");
}

inline std::uint32_t validate_function_stack(
    const bytecode::Function& function,
    std::size_t function_index
) {
    if (function.instructions.empty()) {
        throw VmEmitterError(
            "function " + std::to_string(function_index) + " is empty"
        );
    }
    const std::size_t count = function.instructions.size();
    const std::int64_t unseen = -1;
    std::vector<std::int64_t> depths(count, unseen);
    std::vector<std::size_t> pending = {0};
    depths[0] = 0;
    std::uint32_t maximum = 0;
    while (!pending.empty()) {
        const std::size_t index = pending.back();
        pending.pop_back();
        const auto effect = stack_effect(function.instructions[index]);
        const std::int64_t depth = depths[index];
        if (depth < static_cast<std::int64_t>(effect.operands)) {
            throw VmEmitterError(
                "function " + std::to_string(function_index)
                + " instruction " + std::to_string(index)
                + " underflows the tagged operand stack"
            );
        }
        const std::int64_t next_depth =
            depth - effect.operands + effect.results;
        maximum = std::max(
            maximum,
            static_cast<std::uint32_t>(next_depth)
        );
        const auto opcode = function.instructions[index].opcode;
        if (opcode == bytecode::Opcode::Return
            || opcode == bytecode::Opcode::Trap) {
            if (next_depth != 0) {
                throw VmEmitterError(
                    "function " + std::to_string(function_index)
                    + " Return leaves tagged values on the operand stack"
                );
            }
            continue;
        }
        std::vector<std::size_t> successors;
        if (opcode == bytecode::Opcode::Jump
            || opcode == bytecode::Opcode::JumpIfFalse) {
            successors.push_back(function.instructions[index].first);
        }
        if (opcode != bytecode::Opcode::Jump && index + 1 < count) {
            successors.push_back(index + 1);
        }
        if (successors.empty()) {
            throw VmEmitterError(
                "function " + std::to_string(function_index)
                + " has a path without Return"
            );
        }
        for (const auto successor : successors) {
            if (depths[successor] == unseen) {
                depths[successor] = next_depth;
                pending.push_back(successor);
            } else if (depths[successor] != next_depth) {
                throw VmEmitterError(
                    "function " + std::to_string(function_index)
                    + " has inconsistent stack depth at instruction "
                    + std::to_string(successor)
                );
            }
        }
    }
    return std::max<std::uint32_t>(maximum, 1);
}

inline void local_get(Writer& body, std::uint32_t index) {
    body.u8(0x20);
    body.u32_leb(index);
}

inline void local_set(Writer& body, std::uint32_t index) {
    body.u8(0x21);
    body.u32_leb(index);
}

inline void local_tee(Writer& body, std::uint32_t index) {
    body.u8(0x22);
    body.u32_leb(index);
}

inline void i32_const(Writer& body, std::uint32_t value) {
    body.u8(0x41);
    body.i32_leb(static_cast<std::int32_t>(value));
}

inline void i32_load(Writer& body, std::uint32_t offset = 0) {
    body.u8(0x28);
    body.u32_leb(2);
    body.u32_leb(offset);
}

inline void i32_store(Writer& body, std::uint32_t offset = 0) {
    body.u8(0x36);
    body.u32_leb(2);
    body.u32_leb(offset);
}

inline void f64_load(Writer& body, std::uint32_t offset = values::payload_offset) {
    body.u8(0x2b);
    body.u32_leb(3);
    body.u32_leb(offset);
}

inline void f64_store(Writer& body, std::uint32_t offset = values::payload_offset) {
    body.u8(0x39);
    body.u32_leb(3);
    body.u32_leb(offset);
}

inline std::vector<std::uint8_t> encoded_body(Writer body) {
    Writer encoded;
    auto bytes = body.take();
    encoded.u32_leb(static_cast<std::uint32_t>(bytes.size()));
    encoded.raw(bytes);
    return encoded.take();
}

struct StaticImage {
    std::vector<std::uint8_t> bytes;
    std::vector<std::uint32_t> number_constants;
    std::vector<std::uint32_t> string_constants;
    std::uint32_t null_value = 0;
    std::uint32_t false_value = 0;
    std::uint32_t true_value = 0;
    std::uint32_t key_source = 0;
    std::uint32_t key_offset = 0;
    std::uint32_t key_column = 0;
    std::uint32_t key_text = 0;
    std::uint32_t key_next = 0;
    std::uint32_t key_kind = 0;
    std::vector<std::uint32_t> operator_kinds;
    std::vector<std::uint32_t> operator_texts;
};

inline void resize_to(std::vector<std::uint8_t>& bytes, std::uint32_t size) {
    bytes.resize(size, 0);
}

inline void write_u32(
    std::vector<std::uint8_t>& bytes,
    std::uint32_t offset,
    std::uint32_t value
) {
    for (unsigned shift = 0; shift < 32; shift += 8) {
        bytes[offset + shift / 8U] =
            static_cast<std::uint8_t>((value >> shift) & 0xffU);
    }
}

inline void write_f64(
    std::vector<std::uint8_t>& bytes,
    std::uint32_t offset,
    double value
) {
    std::uint64_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    for (unsigned shift = 0; shift < 64; shift += 8) {
        bytes[offset + shift / 8U] =
            static_cast<std::uint8_t>((bits >> shift) & 0xffU);
    }
}

inline std::uint32_t append_slot(
    std::vector<std::uint8_t>& bytes,
    values::Tag tag,
    std::uint32_t length = 0,
    std::uint32_t payload = 0
) {
    const auto offset = values::align_up(
        static_cast<std::uint32_t>(bytes.size())
    );
    resize_to(bytes, offset + values::slot_size);
    write_u32(bytes, offset + values::tag_offset,
        static_cast<std::uint32_t>(tag));
    write_u32(bytes, offset + values::length_offset, length);
    write_u32(bytes, offset + values::payload_offset, payload);
    return offset;
}

inline std::uint32_t append_utf8_static(
    std::vector<std::uint8_t>& bytes,
    const std::string& text
) {
    const auto slot = append_slot(bytes, values::Tag::Utf8String);
    const auto payload = static_cast<std::uint32_t>(bytes.size());
    bytes.insert(bytes.end(), text.begin(), text.end());
    write_u32(bytes, slot + values::length_offset,
        static_cast<std::uint32_t>(text.size()));
    write_u32(bytes, slot + values::payload_offset, payload);
    return slot;
}

inline StaticImage build_static_image(
    const bytecode::Module& module,
    const std::vector<std::uint8_t>& bytecode_bytes,
    ModuleLayout& layout
) {
    StaticImage image;
    image.bytes = bytecode_bytes;
    layout.bytecode_len = static_cast<std::uint32_t>(bytecode_bytes.size());
    layout.arguments_ptr = values::align_up(layout.bytecode_len);
    resize_to(
        image.bytes,
        layout.arguments_ptr
            + layout.arguments_capacity * values::slot_size
    );
    layout.results_ptr = values::align_up(
        static_cast<std::uint32_t>(image.bytes.size())
    );
    resize_to(image.bytes, layout.results_ptr + values::slot_size);
    image.null_value = append_slot(image.bytes, values::Tag::Null);
    image.false_value = append_slot(image.bytes, values::Tag::Boolean);
    image.true_value = append_slot(image.bytes, values::Tag::Boolean);
    write_u32(
        image.bytes,
        image.true_value + values::payload_offset,
        1
    );
    image.number_constants.resize(module.constants.size(), image.null_value);
    image.string_constants.resize(module.constants.size(), image.null_value);
    for (std::size_t index = 0; index < module.constants.size(); ++index) {
        const auto& constant = module.constants[index];
        if (constant.kind == bytecode::ConstantKind::Number) {
            const auto ptr = append_slot(image.bytes, values::Tag::Number);
            write_f64(image.bytes, ptr + values::payload_offset, constant.number);
            image.number_constants[index] = ptr;
            continue;
        }
        const auto slot = append_slot(image.bytes, values::Tag::Utf8String);
        const auto payload = values::align_up(
            static_cast<std::uint32_t>(image.bytes.size()),
            1
        );
        image.bytes.insert(
            image.bytes.end(),
            constant.string.begin(),
            constant.string.end()
        );
        write_u32(
            image.bytes,
            slot + values::length_offset,
            static_cast<std::uint32_t>(constant.string.size())
        );
        write_u32(image.bytes, slot + values::payload_offset, payload);
        image.string_constants[index] = slot;
    }
    image.key_source = append_utf8_static(image.bytes, "source");
    image.key_offset = append_utf8_static(image.bytes, "offset");
    image.key_column = append_utf8_static(image.bytes, "column");
    image.key_text = append_utf8_static(image.bytes, "text");
    image.key_next = append_utf8_static(image.bytes, "next");
    image.key_kind = append_utf8_static(image.bytes, "kind");
    const char* operator_kinds[] = {
        "PLUS", "MINUS", "STAR", "SLASH", "CARET", "LPAREN", "RPAREN",
        "LBRACKET", "RBRACKET", "LBRACE", "RBRACE", "COMMA", "RANGE",
        "EQ", "LT", "GT", "LE", "GE", "INVALID",
    };
    const char* operator_texts[] = {
        "+", "-", "*", "/", "^", "(", ")", "[", "]", "{", "}", ",",
        "..", "=", "<", ">", "<=", ">=", "",
    };
    for (const auto* kind : operator_kinds) {
        image.operator_kinds.push_back(
            append_utf8_static(image.bytes, kind)
        );
    }
    for (const auto* text : operator_texts) {
        image.operator_texts.push_back(
            append_utf8_static(image.bytes, text)
        );
    }
    layout.heap_base = values::align_up(
        static_cast<std::uint32_t>(image.bytes.size())
    );
    resize_to(image.bytes, layout.heap_base);
    return image;
}

struct RuntimeIndexes {
    std::uint32_t allocate = 0;
    std::uint32_t make_boolean = 0;
    std::uint32_t make_number = 0;
    std::uint32_t truthy = 0;
    std::uint32_t equal = 0;
    std::uint32_t string_concat = 0;
    std::uint32_t utf8_length = 0;
    std::uint32_t utf8_eof = 0;
    std::uint32_t utf8_peek = 0;
    std::uint32_t utf8_advance = 0;
    std::uint32_t decimal_scan = 0;
    std::uint32_t number_to_string = 0;
    std::uint32_t power = 0;
    std::uint32_t square_root = 0;
    std::uint32_t atan2 = 0;
    std::uint32_t record_get = 0;
    std::uint32_t record_set = 0;
    std::uint32_t identifier_start = 0;
    std::uint32_t identifier_continue = 0;
    std::uint32_t sine = 0;
    std::uint32_t cosine = 0;
    std::uint32_t tangent = 0;
    std::uint32_t absolute = 0;
    std::uint32_t natural_log = 0;
    std::uint32_t exponential = 0;
    std::uint32_t array_length = 0;
    std::uint32_t utf8_slice = 0;
    std::uint32_t decimal_scan_end = 0;
    std::uint32_t identifier_scan_end = 0;
    std::uint32_t operator_width = 0;
    std::uint32_t operator_kind = 0;
    std::uint32_t plot_pack = 0;
    std::uint32_t plot_builder_create = 0;
    std::uint32_t plot_builder_push = 0;
    std::uint32_t plot_builder_finish = 0;
};

inline void emit_stack_address(
    Writer& body,
    std::uint32_t frame_local,
    std::uint32_t sp_local,
    std::uint32_t local_count,
    std::int32_t relative = 0
) {
    local_get(body, frame_local);
    i32_const(body, local_count * 4U);
    body.u8(0x6a);
    local_get(body, sp_local);
    if (relative != 0) {
        i32_const(body, static_cast<std::uint32_t>(relative));
        body.u8(0x6a);
    }
    i32_const(body, 4);
    body.u8(0x6c);
    body.u8(0x6a);
}

inline void emit_push_from_stack(
    Writer& body,
    std::uint32_t frame_local,
    std::uint32_t sp_local,
    std::uint32_t local_count
) {
    emit_stack_address(body, frame_local, sp_local, local_count);
}

inline void emit_finish_push(Writer& body, std::uint32_t sp_local) {
    i32_store(body);
    local_get(body, sp_local);
    i32_const(body, 1);
    body.u8(0x6a);
    local_set(body, sp_local);
}

inline void emit_pop_to(
    Writer& body,
    std::uint32_t frame_local,
    std::uint32_t sp_local,
    std::uint32_t local_count,
    std::uint32_t target_local
) {
    local_get(body, sp_local);
    i32_const(body, 1);
    body.u8(0x6b);
    local_tee(body, sp_local);
    body.u8(0x1a);
    emit_stack_address(body, frame_local, sp_local, local_count);
    i32_load(body);
    local_set(body, target_local);
}

inline void emit_set_pc_and_continue(
    Writer& body,
    std::uint32_t pc_local,
    std::uint32_t pc
) {
    i32_const(body, pc);
    local_set(body, pc_local);
    body.u8(0x0c);
    body.u32_leb(1);
}

inline void emit_call_unary_value(
    Writer& body,
    const RuntimeIndexes& runtime,
    std::uint32_t helper,
    std::uint32_t frame_local,
    std::uint32_t sp_local,
    std::uint32_t local_count,
    std::uint32_t temp0
) {
    emit_pop_to(body, frame_local, sp_local, local_count, temp0);
    emit_push_from_stack(body, frame_local, sp_local, local_count);
    local_get(body, temp0);
    body.u8(0x10);
    body.u32_leb(helper);
    emit_finish_push(body, sp_local);
    (void)runtime;
}

inline void emit_call_binary_value(
    Writer& body,
    std::uint32_t helper,
    std::uint32_t frame_local,
    std::uint32_t sp_local,
    std::uint32_t local_count,
    std::uint32_t temp0,
    std::uint32_t temp1
) {
    emit_pop_to(body, frame_local, sp_local, local_count, temp1);
    emit_pop_to(body, frame_local, sp_local, local_count, temp0);
    emit_push_from_stack(body, frame_local, sp_local, local_count);
    local_get(body, temp0);
    local_get(body, temp1);
    body.u8(0x10);
    body.u32_leb(helper);
    emit_finish_push(body, sp_local);
}

inline void emit_call_ternary_value(
    Writer& body,
    std::uint32_t helper,
    std::uint32_t frame_local,
    std::uint32_t sp_local,
    std::uint32_t local_count,
    std::uint32_t temp0,
    std::uint32_t temp1,
    std::uint32_t temp2
) {
    emit_pop_to(body, frame_local, sp_local, local_count, temp2);
    emit_pop_to(body, frame_local, sp_local, local_count, temp1);
    emit_pop_to(body, frame_local, sp_local, local_count, temp0);
    emit_push_from_stack(body, frame_local, sp_local, local_count);
    local_get(body, temp0);
    local_get(body, temp1);
    local_get(body, temp2);
    body.u8(0x10);
    body.u32_leb(helper);
    emit_finish_push(body, sp_local);
}

inline std::vector<std::uint8_t> emit_tagged_function(
    const bytecode::Module& module,
    std::uint32_t function_index,
    std::uint32_t maximum_stack,
    const StaticImage& image,
    const RuntimeIndexes& runtime
) {
    const auto& function = module.functions[function_index];
    Writer body;
    body.u32_leb(1);
    body.u32_leb(6);
    body.u8(wasm_i32);
    const std::uint32_t frame_local = function.parameter_count;
    const std::uint32_t sp_local = frame_local + 1;
    const std::uint32_t pc_local = frame_local + 2;
    const std::uint32_t temp0 = frame_local + 3;
    const std::uint32_t temp1 = frame_local + 4;
    const std::uint32_t temp2 = frame_local + 5;
    const std::uint32_t local_count =
        static_cast<std::uint32_t>(function.local_types.size());
    i32_const(body, (local_count + maximum_stack) * 4U);
    body.u8(0x10);
    body.u32_leb(runtime.allocate);
    local_set(body, frame_local);
    for (std::uint32_t index = 0; index < function.parameter_count; ++index) {
        local_get(body, frame_local);
        local_get(body, index);
        i32_store(body, index * 4U);
    }
    i32_const(body, 0);
    local_set(body, sp_local);
    i32_const(body, 0);
    local_set(body, pc_local);
    body.u8(0x03);
    body.u8(0x40);
    for (std::uint32_t pc = 0; pc < function.instructions.size(); ++pc) {
        const auto& instruction = function.instructions[pc];
        local_get(body, pc_local);
        i32_const(body, pc);
        body.u8(0x46);
        body.u8(0x04);
        body.u8(0x40);
        using bytecode::Opcode;
        switch (instruction.opcode) {
            case Opcode::Nop:
                break;
            case Opcode::PushConstant: {
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                const auto& constant = module.constants[instruction.first];
                std::uint32_t pointer = image.null_value;
                if (constant.kind == bytecode::ConstantKind::Utf8String) {
                    pointer = image.string_constants[instruction.first];
                } else if (instruction.result_type
                    == bytecode::ValueType::Boolean) {
                    pointer = constant.number == 0.0
                        ? image.false_value : image.true_value;
                } else {
                    pointer = image.number_constants[instruction.first];
                }
                i32_const(body, pointer);
                emit_finish_push(body, sp_local);
                break;
            }
            case Opcode::PushNull:
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                i32_const(body, image.null_value);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::LoadLocal:
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, frame_local);
                i32_load(body, instruction.first * 4U);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::StoreLocal:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                local_get(body, frame_local);
                local_get(body, temp0);
                i32_store(body, instruction.first * 4U);
                break;
            case Opcode::Pop:
                local_get(body, sp_local);
                i32_const(body, 1);
                body.u8(0x6b);
                local_set(body, sp_local);
                break;
            case Opcode::Duplicate:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                for (int copy = 0; copy < 2; ++copy) {
                    emit_push_from_stack(
                        body, frame_local, sp_local, local_count
                    );
                    local_get(body, temp0);
                    emit_finish_push(body, sp_local);
                }
                break;
            case Opcode::Add:
            case Opcode::Subtract:
            case Opcode::Multiply:
            case Opcode::Divide:
            case Opcode::Remainder:
            case Opcode::FloorDivide:
            case Opcode::Less:
            case Opcode::LessEqual:
            case Opcode::Greater:
            case Opcode::GreaterEqual: {
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp1
                );
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                f64_load(body);
                local_get(body, temp1);
                f64_load(body);
                const bool comparison =
                    instruction.opcode == Opcode::Less
                    || instruction.opcode == Opcode::LessEqual
                    || instruction.opcode == Opcode::Greater
                    || instruction.opcode == Opcode::GreaterEqual;
                if (comparison) {
                    const std::uint8_t op =
                        instruction.opcode == Opcode::Less ? 0x63
                        : instruction.opcode == Opcode::Greater ? 0x64
                        : instruction.opcode == Opcode::LessEqual ? 0x65
                        : 0x66;
                    body.u8(op);
                    body.u8(0x10);
                    body.u32_leb(runtime.make_boolean);
                } else if (instruction.opcode == Opcode::Remainder) {
                    body.u8(0xa3);
                    body.u8(0x9d);
                    local_get(body, temp1);
                    f64_load(body);
                    body.u8(0xa2);
                    local_get(body, temp0);
                    f64_load(body);
                    body.u8(0xa1);
                    body.u8(0x9a);
                    body.u8(0x10);
                    body.u32_leb(runtime.make_number);
                } else if (instruction.opcode == Opcode::FloorDivide) {
                    body.u8(0xa3);
                    body.u8(0x9c);
                    body.u8(0x10);
                    body.u32_leb(runtime.make_number);
                } else {
                    body.u8(
                        instruction.opcode == Opcode::Add ? 0xa0
                        : instruction.opcode == Opcode::Subtract ? 0xa1
                        : instruction.opcode == Opcode::Multiply ? 0xa2
                        : 0xa3
                    );
                    body.u8(0x10);
                    body.u32_leb(runtime.make_number);
                }
                emit_finish_push(body, sp_local);
                break;
            }
            case Opcode::Negate:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                f64_load(body);
                body.u8(0x9a);
                body.u8(0x10);
                body.u32_leb(runtime.make_number);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::Equal:
            case Opcode::NotEqual:
                emit_call_binary_value(
                    body, runtime.equal, frame_local, sp_local, local_count,
                    temp0, temp1
                );
                if (instruction.opcode == Opcode::NotEqual) {
                    emit_pop_to(
                        body, frame_local, sp_local, local_count, temp0
                    );
                    emit_push_from_stack(
                        body, frame_local, sp_local, local_count
                    );
                    local_get(body, temp0);
                    body.u8(0x10);
                    body.u32_leb(runtime.truthy);
                    body.u8(0x45);
                    body.u8(0x10);
                    body.u32_leb(runtime.make_boolean);
                    emit_finish_push(body, sp_local);
                }
                break;
            case Opcode::LogicalNot:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                body.u8(0x10);
                body.u32_leb(runtime.truthy);
                body.u8(0x45);
                body.u8(0x10);
                body.u32_leb(runtime.make_boolean);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::LogicalAnd:
            case Opcode::LogicalOr:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp1
                );
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                body.u8(0x10);
                body.u32_leb(runtime.truthy);
                local_get(body, temp1);
                body.u8(0x10);
                body.u32_leb(runtime.truthy);
                body.u8(
                    instruction.opcode == Opcode::LogicalAnd ? 0x71 : 0x72
                );
                body.u8(0x10);
                body.u32_leb(runtime.make_boolean);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::Jump:
                emit_set_pc_and_continue(body, pc_local, instruction.first);
                break;
            case Opcode::JumpIfFalse:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                local_get(body, temp0);
                body.u8(0x10);
                body.u32_leb(runtime.truthy);
                body.u8(0x04);
                body.u8(0x40);
                i32_const(body, pc + 1);
                local_set(body, pc_local);
                body.u8(0x05);
                i32_const(body, instruction.first);
                local_set(body, pc_local);
                body.u8(0x0b);
                body.u8(0x0c);
                body.u32_leb(1);
                break;
            case Opcode::Call: {
                for (std::uint32_t argument = 0;
                     argument < instruction.second;
                     ++argument) {
                    emit_stack_address(
                        body, frame_local, sp_local, local_count,
                        -static_cast<std::int32_t>(instruction.second)
                            + static_cast<std::int32_t>(argument)
                    );
                    i32_load(body);
                }
                body.u8(0x10);
                body.u32_leb(instruction.first);
                local_set(body, temp0);
                local_get(body, sp_local);
                i32_const(body, instruction.second);
                body.u8(0x6b);
                local_set(body, sp_local);
                emit_push_from_stack(
                    body, frame_local, sp_local, local_count
                );
                local_get(body, temp0);
                emit_finish_push(body, sp_local);
                break;
            }
            case Opcode::Return:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                local_get(body, temp0);
                body.u8(0x0f);
                break;
            case Opcode::Trap:
                body.u8(0x00);
                break;
            case Opcode::MakeArray: {
                i32_const(
                    body,
                    values::slot_size + instruction.first * values::pointer_size
                );
                body.u8(0x10);
                body.u32_leb(runtime.allocate);
                local_set(body, temp0);
                local_get(body, temp0);
                i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
                i32_store(body, values::tag_offset);
                local_get(body, temp0);
                i32_const(body, instruction.first);
                i32_store(body, values::length_offset);
                local_get(body, temp0);
                local_get(body, temp0);
                i32_const(body, values::slot_size);
                body.u8(0x6a);
                i32_store(body, values::payload_offset);
                for (std::uint32_t item = 0; item < instruction.first; ++item) {
                    local_get(body, temp0);
                    emit_stack_address(
                        body, frame_local, sp_local, local_count,
                        -static_cast<std::int32_t>(instruction.first)
                            + static_cast<std::int32_t>(item)
                    );
                    i32_load(body);
                    i32_store(
                        body,
                        values::slot_size + item * values::pointer_size
                    );
                }
                local_get(body, sp_local);
                i32_const(body, instruction.first);
                body.u8(0x6b);
                local_set(body, sp_local);
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                emit_finish_push(body, sp_local);
                break;
            }
            case Opcode::AllocateArray: {
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp1
                );
                local_get(body, temp1);
                f64_load(body);
                body.u8(0xaa);
                local_set(body, temp2);
                i32_const(body, values::slot_size);
                local_get(body, temp2);
                i32_const(body, values::pointer_size);
                body.u8(0x6c);
                body.u8(0x6a);
                body.u8(0x10);
                body.u32_leb(runtime.allocate);
                local_set(body, temp0);
                local_get(body, temp0);
                i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
                i32_store(body, values::tag_offset);
                local_get(body, temp0);
                local_get(body, temp2);
                i32_store(body, values::length_offset);
                local_get(body, temp0);
                local_get(body, temp0);
                i32_const(body, values::slot_size);
                body.u8(0x6a);
                i32_store(body, values::payload_offset);
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                emit_finish_push(body, sp_local);
                break;
            }
            case Opcode::ArrayGet:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp1
                );
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                i32_load(body, values::payload_offset);
                local_get(body, temp1);
                f64_load(body);
                body.u8(0xaa);
                i32_const(body, values::pointer_size);
                body.u8(0x6c);
                body.u8(0x6a);
                i32_load(body);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::ArraySet:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp2
                );
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp1
                );
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                local_get(body, temp0);
                i32_load(body, values::payload_offset);
                local_get(body, temp1);
                f64_load(body);
                body.u8(0xaa);
                i32_const(body, values::pointer_size);
                body.u8(0x6c);
                body.u8(0x6a);
                local_get(body, temp2);
                i32_store(body);
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::ArrayConcat:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp1
                );
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                i32_const(body, values::slot_size);
                local_get(body, temp0);
                i32_load(body, values::length_offset);
                local_get(body, temp1);
                i32_load(body, values::length_offset);
                body.u8(0x6a);
                i32_const(body, values::pointer_size);
                body.u8(0x6c);
                body.u8(0x6a);
                body.u8(0x10);
                body.u32_leb(runtime.allocate);
                local_set(body, temp2);
                local_get(body, temp2);
                i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
                i32_store(body, values::tag_offset);
                local_get(body, temp2);
                local_get(body, temp0);
                i32_load(body, values::length_offset);
                local_get(body, temp1);
                i32_load(body, values::length_offset);
                body.u8(0x6a);
                i32_store(body, values::length_offset);
                local_get(body, temp2);
                local_get(body, temp2);
                i32_const(body, values::slot_size);
                body.u8(0x6a);
                i32_store(body, values::payload_offset);
                local_get(body, temp2);
                i32_const(body, values::slot_size);
                body.u8(0x6a);
                local_get(body, temp0);
                i32_load(body, values::payload_offset);
                local_get(body, temp0);
                i32_load(body, values::length_offset);
                i32_const(body, values::pointer_size);
                body.u8(0x6c);
                body.u8(0xfc);
                body.u32_leb(10);
                body.u32_leb(0);
                body.u32_leb(0);
                local_get(body, temp2);
                i32_const(body, values::slot_size);
                body.u8(0x6a);
                local_get(body, temp0);
                i32_load(body, values::length_offset);
                i32_const(body, values::pointer_size);
                body.u8(0x6c);
                body.u8(0x6a);
                local_get(body, temp1);
                i32_load(body, values::payload_offset);
                local_get(body, temp1);
                i32_load(body, values::length_offset);
                i32_const(body, values::pointer_size);
                body.u8(0x6c);
                body.u8(0xfc);
                body.u32_leb(10);
                body.u32_leb(0);
                body.u32_leb(0);
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp2);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::MakeObject: {
                const std::uint32_t count = instruction.first;
                i32_const(
                    body,
                    values::slot_size + count * values::record_entry_size
                );
                body.u8(0x10);
                body.u32_leb(runtime.allocate);
                local_set(body, temp0);
                local_get(body, temp0);
                i32_const(body, static_cast<std::uint32_t>(values::Tag::Record));
                i32_store(body, values::tag_offset);
                local_get(body, temp0);
                i32_const(body, count);
                i32_store(body, values::length_offset);
                local_get(body, temp0);
                local_get(body, temp0);
                i32_const(body, values::slot_size);
                body.u8(0x6a);
                i32_store(body, values::payload_offset);
                for (std::uint32_t item = 0; item < count; ++item) {
                    local_get(body, temp0);
                    emit_stack_address(
                        body, frame_local, sp_local, local_count,
                        -static_cast<std::int32_t>(count * 2U)
                            + static_cast<std::int32_t>(item * 2U)
                    );
                    i32_load(body);
                    i32_store(
                        body,
                        values::slot_size
                            + item * values::record_entry_size
                            + values::record_key_offset
                    );
                    local_get(body, temp0);
                    emit_stack_address(
                        body, frame_local, sp_local, local_count,
                        -static_cast<std::int32_t>(count * 2U)
                            + static_cast<std::int32_t>(item * 2U + 1U)
                    );
                    i32_load(body);
                    i32_store(
                        body,
                        values::slot_size
                            + item * values::record_entry_size
                            + values::record_value_offset
                    );
                }
                local_get(body, sp_local);
                i32_const(body, count * 2U);
                body.u8(0x6b);
                local_set(body, sp_local);
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                emit_finish_push(body, sp_local);
                break;
            }
            case Opcode::ObjectGet:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                i32_const(body, image.string_constants[instruction.first]);
                body.u8(0x10);
                body.u32_leb(runtime.record_get);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::ObjectSet:
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp1
                );
                emit_pop_to(
                    body, frame_local, sp_local, local_count, temp0
                );
                emit_push_from_stack(body, frame_local, sp_local, local_count);
                local_get(body, temp0);
                i32_const(body, image.string_constants[instruction.first]);
                local_get(body, temp1);
                body.u8(0x10);
                body.u32_leb(runtime.record_set);
                emit_finish_push(body, sp_local);
                break;
            case Opcode::Concatenate:
                emit_call_binary_value(
                    body, runtime.string_concat, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::Utf8Length:
                emit_call_unary_value(
                    body, runtime, runtime.utf8_length, frame_local, sp_local,
                    local_count, temp0
                );
                break;
            case Opcode::Utf8Eof:
                emit_call_binary_value(
                    body, runtime.utf8_eof, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::Utf8PeekScalar:
                emit_call_binary_value(
                    body, runtime.utf8_peek, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::Utf8Advance:
                emit_call_binary_value(
                    body, runtime.utf8_advance, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::DecimalParse:
                emit_call_unary_value(
                    body, runtime, runtime.decimal_scan, frame_local, sp_local,
                    local_count, temp0
                );
                break;
            case Opcode::NumberToString:
                emit_call_unary_value(
                    body, runtime, runtime.number_to_string, frame_local,
                    sp_local, local_count, temp0
                );
                break;
            case Opcode::Power:
                emit_call_binary_value(
                    body, runtime.power, frame_local, sp_local, local_count,
                    temp0, temp1
                );
                break;
            case Opcode::SquareRoot:
                emit_call_unary_value(
                    body, runtime, runtime.square_root, frame_local, sp_local,
                    local_count, temp0
                );
                break;
            case Opcode::Atan2:
                emit_call_binary_value(
                    body, runtime.atan2, frame_local, sp_local, local_count,
                    temp0, temp1
                );
                break;
            case Opcode::Utf8IsIdentifierStart:
                emit_call_unary_value(
                    body, runtime, runtime.identifier_start, frame_local,
                    sp_local, local_count, temp0
                );
                break;
            case Opcode::Utf8IsIdentifierContinue:
                emit_call_unary_value(
                    body, runtime, runtime.identifier_continue, frame_local,
                    sp_local, local_count, temp0
                );
                break;
            case Opcode::Sine:
                emit_call_unary_value(
                    body, runtime, runtime.sine, frame_local, sp_local,
                    local_count, temp0
                );
                break;
            case Opcode::Cosine:
                emit_call_unary_value(
                    body, runtime, runtime.cosine, frame_local, sp_local,
                    local_count, temp0
                );
                break;
            case Opcode::Tangent:
                emit_call_unary_value(
                    body, runtime, runtime.tangent, frame_local, sp_local,
                    local_count, temp0
                );
                break;
            case Opcode::Absolute:
                emit_call_unary_value(
                    body, runtime, runtime.absolute, frame_local, sp_local,
                    local_count, temp0
                );
                break;
            case Opcode::NaturalLog:
                emit_call_unary_value(
                    body, runtime, runtime.natural_log, frame_local, sp_local,
                    local_count, temp0
                );
                break;
            case Opcode::Exponential:
                emit_call_unary_value(
                    body, runtime, runtime.exponential, frame_local, sp_local,
                    local_count, temp0
                );
                break;
            case Opcode::ArrayLength:
                emit_call_unary_value(
                    body, runtime, runtime.array_length, frame_local,
                    sp_local, local_count, temp0
                );
                break;
            case Opcode::Utf8Slice:
                emit_call_ternary_value(
                    body, runtime.utf8_slice, frame_local, sp_local,
                    local_count, temp0, temp1, temp2
                );
                break;
            case Opcode::DecimalScanEnd:
                emit_call_binary_value(
                    body, runtime.decimal_scan_end, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::IdentifierScanEnd:
                emit_call_binary_value(
                    body, runtime.identifier_scan_end, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::OperatorWidth:
                emit_call_binary_value(
                    body, runtime.operator_width, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::OperatorKind:
                emit_call_unary_value(
                    body, runtime, runtime.operator_kind, frame_local,
                    sp_local, local_count, temp0
                );
                break;
            case Opcode::PlotPack:
                emit_call_binary_value(
                    body, runtime.plot_pack, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::PlotBuilderCreate:
                emit_call_binary_value(
                    body, runtime.plot_builder_create, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::PlotBuilderPush:
                emit_call_binary_value(
                    body, runtime.plot_builder_push, frame_local, sp_local,
                    local_count, temp0, temp1
                );
                break;
            case Opcode::PlotBuilderFinish:
                emit_call_unary_value(
                    body, runtime, runtime.plot_builder_finish, frame_local,
                    sp_local, local_count, temp0
                );
                break;
            case Opcode::IdentifierScan:
            case Opcode::OperatorScan:
                throw VmEmitterError(
                    "scanner opcode requires the cursor-record runtime"
                );
        }
        if (instruction.opcode != Opcode::Jump
            && instruction.opcode != Opcode::JumpIfFalse
            && instruction.opcode != Opcode::Return) {
            emit_set_pc_and_continue(body, pc_local, pc + 1);
        }
        body.u8(0x0b);
    }
    body.u8(0x00);
    body.u8(0x0b);
    body.u8(0x00);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_allocate_function(
    std::uint32_t heap_limit
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(3);
    body.u8(wasm_i32);
    body.u8(0x23);
    body.u32_leb(0);
    local_set(body, 1);
    local_get(body, 0);
    i32_const(body, values::slot_alignment - 1U);
    body.u8(0x6a);
    i32_const(body, ~(values::slot_alignment - 1U));
    body.u8(0x71);
    local_set(body, 2);
    local_get(body, 1);
    local_get(body, 2);
    body.u8(0x6a);
    local_tee(body, 3);
    local_get(body, 1);
    body.u8(0x49);
    local_get(body, 3);
    i32_const(body, heap_limit);
    body.u8(0x4b);
    body.u8(0x72);
    body.u8(0x04);
    body.u8(0x40);
    body.u8(0x00);
    body.u8(0x0b);
    local_get(body, 3);
    body.u8(0x24);
    body.u32_leb(0);
    local_get(body, 1);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_make_boolean_function(
    std::uint32_t allocate_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(1);
    body.u8(wasm_i32);
    i32_const(body, values::slot_size);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_tee(body, 1);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Boolean));
    i32_store(body, values::tag_offset);
    local_get(body, 1);
    i32_const(body, 0);
    i32_store(body, values::length_offset);
    local_get(body, 1);
    local_get(body, 0);
    i32_store(body, values::payload_offset);
    local_get(body, 1);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_make_number_function(
    std::uint32_t allocate_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(1);
    body.u8(wasm_i32);
    i32_const(body, values::slot_size);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_tee(body, 1);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Number));
    i32_store(body, values::tag_offset);
    local_get(body, 1);
    i32_const(body, 0);
    i32_store(body, values::length_offset);
    local_get(body, 1);
    local_get(body, 0);
    f64_store(body);
    local_get(body, 1);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_truthy_function() {
    Writer body;
    body.u32_leb(0);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Null));
    body.u8(0x46);
    body.u8(0x04);
    body.u8(wasm_i32);
    i32_const(body, 0);
    body.u8(0x05);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Boolean));
    body.u8(0x46);
    body.u8(0x04);
    body.u8(wasm_i32);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    body.u8(0x05);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Number));
    body.u8(0x46);
    body.u8(0x04);
    body.u8(wasm_i32);
    local_get(body, 0);
    f64_load(body);
    body.u8(0x44);
    body.f64(0.0);
    body.u8(0x62);
    body.u8(0x05);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    i32_const(body, 0);
    body.u8(0x47);
    body.u8(0x0b);
    body.u8(0x0b);
    body.u8(0x0b);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_equal_function(
    std::uint32_t make_boolean_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(2);
    body.u8(wasm_i32);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    local_get(body, 1);
    i32_load(body, values::tag_offset);
    body.u8(0x47);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, 0);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0f);
    body.u8(0x0b);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Utf8String));
    body.u8(0x46);
    body.u8(0x04);
    body.u8(0x40);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    local_tee(body, 3);
    local_get(body, 1);
    i32_load(body, values::length_offset);
    body.u8(0x47);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, 0);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0f);
    body.u8(0x0b);
    i32_const(body, 0);
    local_set(body, 2);
    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 2);
    local_get(body, 3);
    body.u8(0x4f);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 2);
    body.u8(0x6a);
    body.u8(0x2d);
    body.u32_leb(0);
    body.u32_leb(0);
    local_get(body, 1);
    i32_load(body, values::payload_offset);
    local_get(body, 2);
    body.u8(0x6a);
    body.u8(0x2d);
    body.u32_leb(0);
    body.u32_leb(0);
    body.u8(0x47);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, 0);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0f);
    body.u8(0x0b);
    local_get(body, 2);
    i32_const(body, 1);
    body.u8(0x6a);
    local_set(body, 2);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);
    i32_const(body, 1);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0f);
    body.u8(0x0b);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Null));
    body.u8(0x46);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, 1);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0f);
    body.u8(0x0b);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Number));
    body.u8(0x46);
    body.u8(0x04);
    body.u8(0x40);
    local_get(body, 0);
    f64_load(body);
    local_get(body, 1);
    f64_load(body);
    body.u8(0x61);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0f);
    body.u8(0x0b);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Boolean));
    body.u8(0x46);
    body.u8(0x04);
    body.u8(0x40);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 1);
    i32_load(body, values::payload_offset);
    body.u8(0x46);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0f);
    body.u8(0x0b);
    local_get(body, 0);
    local_get(body, 1);
    body.u8(0x46);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_string_concat_function(
    std::uint32_t allocate_index,
    std::uint32_t null_value
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(3);
    body.u8(wasm_i32);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
    body.u8(0x46);
    local_get(body, 1);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
    body.u8(0x46);
    body.u8(0x71);
    body.u8(0x04);
    body.u8(0x40);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    local_set(body, 3);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    local_get(body, 1);
    i32_load(body, values::length_offset);
    body.u8(0x6a);
    local_set(body, 4);
    local_get(body, 4);
    i32_const(body, values::pointer_size);
    body.u8(0x6c);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 2);
    local_get(body, 2);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
    i32_store(body, values::tag_offset);
    local_get(body, 2);
    local_get(body, 4);
    i32_store(body, values::length_offset);
    local_get(body, 2);
    local_get(body, 2);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    i32_store(body, values::payload_offset);
    local_get(body, 2);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 3);
    i32_const(body, values::pointer_size);
    body.u8(0x6c);
    body.u8(0xfc);
    body.u32_leb(10);
    body.u32_leb(0);
    body.u32_leb(0);
    local_get(body, 2);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 3);
    i32_const(body, values::pointer_size);
    body.u8(0x6c);
    body.u8(0x6a);
    local_get(body, 1);
    i32_load(body, values::payload_offset);
    local_get(body, 1);
    i32_load(body, values::length_offset);
    i32_const(body, values::pointer_size);
    body.u8(0x6c);
    body.u8(0xfc);
    body.u32_leb(10);
    body.u32_leb(0);
    body.u32_leb(0);
    local_get(body, 2);
    body.u8(0x0f);
    body.u8(0x0b);
    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Utf8String));
    body.u8(0x47);
    local_get(body, 1);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Utf8String));
    body.u8(0x47);
    body.u8(0x72);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, null_value);
    body.u8(0x0f);
    body.u8(0x0b);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    local_set(body, 3);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    local_get(body, 1);
    i32_load(body, values::length_offset);
    body.u8(0x6a);
    local_set(body, 4);
    local_get(body, 4);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 2);
    local_get(body, 2);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Utf8String));
    i32_store(body, values::tag_offset);
    local_get(body, 2);
    local_get(body, 4);
    i32_store(body, values::length_offset);
    local_get(body, 2);
    local_get(body, 2);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    i32_store(body, values::payload_offset);
    local_get(body, 2);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 3);
    body.u8(0xfc);
    body.u32_leb(10);
    body.u32_leb(0);
    body.u32_leb(0);
    local_get(body, 2);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 3);
    body.u8(0x6a);
    local_get(body, 1);
    i32_load(body, values::payload_offset);
    local_get(body, 1);
    i32_load(body, values::length_offset);
    body.u8(0xfc);
    body.u32_leb(10);
    body.u32_leb(0);
    body.u32_leb(0);
    local_get(body, 2);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_utf8_length_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(0);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    body.u8(0xb7);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_utf8_eof_function(
    std::uint32_t make_boolean_index
) {
    Writer body;
    body.u32_leb(0);
    local_get(body, 1);
    f64_load(body);
    body.u8(0xaa);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    body.u8(0x4f);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline void emit_utf8_lead_byte(Writer& body) {
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 1);
    f64_load(body);
    body.u8(0xaa);
    body.u8(0x6a);
    body.u8(0x2d);
    body.u32_leb(0);
    body.u32_leb(0);
}

inline std::vector<std::uint8_t> emit_utf8_peek_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(0);
    emit_utf8_lead_byte(body);
    body.u8(0xb7);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_utf8_advance_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(1);
    body.u8(wasm_i32);
    emit_utf8_lead_byte(body);
    local_set(body, 2);
    local_get(body, 1);
    f64_load(body);
    local_get(body, 2);
    i32_const(body, 0x80);
    body.u8(0x49);
    body.u8(0x04);
    body.u8(wasm_f64);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0x05);
    local_get(body, 2);
    i32_const(body, 0xe0);
    body.u8(0x71);
    i32_const(body, 0xc0);
    body.u8(0x46);
    body.u8(0x04);
    body.u8(wasm_f64);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0x05);
    local_get(body, 2);
    i32_const(body, 0xf0);
    body.u8(0x71);
    i32_const(body, 0xe0);
    body.u8(0x46);
    body.u8(0x04);
    body.u8(wasm_f64);
    body.u8(0x44);
    body.f64(3.0);
    body.u8(0x05);
    body.u8(0x44);
    body.f64(4.0);
    body.u8(0x0b);
    body.u8(0x0b);
    body.u8(0x0b);
    body.u8(0xa0);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_decimal_scan_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(2);
    body.u32_leb(4);
    body.u8(wasm_i32);
    body.u32_leb(2);
    body.u8(wasm_f64);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_tee(body, 1);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    body.u8(0x6a);
    local_set(body, 2);
    body.u8(0x44);
    body.f64(0.0);
    local_set(body, 5);
    body.u8(0x44);
    body.f64(0.1);
    local_set(body, 6);
    i32_const(body, 0);
    local_set(body, 4);
    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 1);
    local_get(body, 2);
    body.u8(0x4f);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 1);
    body.u8(0x2d);
    body.u32_leb(0);
    body.u32_leb(0);
    local_tee(body, 3);
    i32_const(body, static_cast<std::uint32_t>('.'));
    body.u8(0x46);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, 1);
    local_set(body, 4);
    local_get(body, 1);
    i32_const(body, 1);
    body.u8(0x6a);
    local_set(body, 1);
    body.u8(0x0c);
    body.u32_leb(1);
    body.u8(0x0b);
    local_get(body, 3);
    i32_const(body, static_cast<std::uint32_t>('0'));
    body.u8(0x6b);
    local_tee(body, 3);
    i32_const(body, 9);
    body.u8(0x4b);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 4);
    body.u8(0x45);
    body.u8(0x04);
    body.u8(wasm_f64);
    local_get(body, 5);
    body.u8(0x44);
    body.f64(10.0);
    body.u8(0xa2);
    local_get(body, 3);
    body.u8(0xb7);
    body.u8(0xa0);
    body.u8(0x05);
    local_get(body, 5);
    local_get(body, 3);
    body.u8(0xb7);
    local_get(body, 6);
    body.u8(0xa2);
    body.u8(0xa0);
    local_set(body, 5);
    local_get(body, 6);
    body.u8(0x44);
    body.f64(0.1);
    body.u8(0xa2);
    local_set(body, 6);
    local_get(body, 5);
    body.u8(0x0b);
    local_set(body, 5);
    local_get(body, 1);
    i32_const(body, 1);
    body.u8(0x6a);
    local_set(body, 1);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);
    local_get(body, 5);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_utf8_slice_function(
    std::uint32_t allocate_index,
    std::uint32_t null_value
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(4);
    body.u8(wasm_i32);
    local_get(body, 1);
    f64_load(body);
    body.u8(0xaa);
    local_set(body, 3);
    local_get(body, 2);
    f64_load(body);
    body.u8(0xaa);
    local_set(body, 4);
    local_get(body, 4);
    local_get(body, 3);
    body.u8(0x49);
    local_get(body, 4);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    body.u8(0x4b);
    body.u8(0x72);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, null_value);
    body.u8(0x0f);
    body.u8(0x0b);
    local_get(body, 4);
    local_get(body, 3);
    body.u8(0x6b);
    local_set(body, 5);
    i32_const(body, values::slot_size);
    local_get(body, 5);
    body.u8(0x6a);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 6);
    local_get(body, 6);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Utf8String));
    i32_store(body, values::tag_offset);
    local_get(body, 6);
    local_get(body, 5);
    i32_store(body, values::length_offset);
    local_get(body, 6);
    local_get(body, 6);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    i32_store(body, values::payload_offset);
    local_get(body, 6);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 3);
    body.u8(0x6a);
    local_get(body, 5);
    body.u8(0xfc);
    body.u32_leb(10);
    body.u32_leb(0);
    body.u32_leb(0);
    local_get(body, 6);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline void emit_ascii_identifier_continue_test(
    Writer& body,
    std::uint32_t character_local
) {
    local_get(body, character_local);
    i32_const(body, static_cast<std::uint32_t>('_'));
    body.u8(0x46);
    local_get(body, character_local);
    i32_const(body, static_cast<std::uint32_t>('A'));
    body.u8(0x4f);
    local_get(body, character_local);
    i32_const(body, static_cast<std::uint32_t>('Z'));
    body.u8(0x4d);
    body.u8(0x71);
    body.u8(0x72);
    local_get(body, character_local);
    i32_const(body, static_cast<std::uint32_t>('a'));
    body.u8(0x4f);
    local_get(body, character_local);
    i32_const(body, static_cast<std::uint32_t>('z'));
    body.u8(0x4d);
    body.u8(0x71);
    body.u8(0x72);
    local_get(body, character_local);
    i32_const(body, static_cast<std::uint32_t>('0'));
    body.u8(0x4f);
    local_get(body, character_local);
    i32_const(body, static_cast<std::uint32_t>('9'));
    body.u8(0x4d);
    body.u8(0x71);
    body.u8(0x72);
}

inline std::vector<std::uint8_t> emit_scan_end_function(
    std::uint32_t make_number_index,
    bool decimal
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(4);
    body.u8(wasm_i32);
    local_get(body, 1);
    f64_load(body);
    body.u8(0xaa);
    local_set(body, 2);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    local_set(body, 3);
    i32_const(body, 0);
    local_set(body, 5);
    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 2);
    local_get(body, 3);
    body.u8(0x4f);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 2);
    body.u8(0x6a);
    body.u8(0x2d);
    body.u32_leb(0);
    body.u32_leb(0);
    local_set(body, 4);
    if (decimal) {
        local_get(body, 4);
        i32_const(body, static_cast<std::uint32_t>('0'));
        body.u8(0x4f);
        local_get(body, 4);
        i32_const(body, static_cast<std::uint32_t>('9'));
        body.u8(0x4d);
        body.u8(0x71);
        body.u8(0x04);
        body.u8(0x40);
        local_get(body, 2);
        i32_const(body, 1);
        body.u8(0x6a);
        local_set(body, 2);
        body.u8(0x0c);
        body.u32_leb(1);
        body.u8(0x0b);
        local_get(body, 4);
        i32_const(body, static_cast<std::uint32_t>('.'));
        body.u8(0x46);
        local_get(body, 5);
        body.u8(0x45);
        body.u8(0x71);
        body.u8(0x04);
        body.u8(0x40);
        i32_const(body, 1);
        local_set(body, 5);
        local_get(body, 2);
        i32_const(body, 1);
        body.u8(0x6a);
        local_set(body, 2);
        body.u8(0x0c);
        body.u32_leb(1);
        body.u8(0x0b);
    } else {
        emit_ascii_identifier_continue_test(body, 4);
        body.u8(0x04);
        body.u8(0x40);
        local_get(body, 2);
        i32_const(body, 1);
        body.u8(0x6a);
        local_set(body, 2);
        body.u8(0x0c);
        body.u32_leb(1);
        body.u8(0x0b);
    }
    body.u8(0x0c);
    body.u32_leb(1);
    body.u8(0x0b);
    body.u8(0x0b);
    local_get(body, 2);
    body.u8(0xb7);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_operator_width_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(2);
    body.u8(wasm_i32);
    local_get(body, 1);
    f64_load(body);
    body.u8(0xaa);
    local_set(body, 2);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 2);
    body.u8(0x6a);
    body.u8(0x2d);
    body.u32_leb(0);
    body.u32_leb(0);
    local_set(body, 3);
    local_get(body, 3);
    i32_const(body, static_cast<std::uint32_t>('<'));
    body.u8(0x46);
    local_get(body, 3);
    i32_const(body, static_cast<std::uint32_t>('>'));
    body.u8(0x46);
    body.u8(0x72);
    local_get(body, 3);
    i32_const(body, static_cast<std::uint32_t>('.'));
    body.u8(0x46);
    body.u8(0x72);
    local_get(body, 2);
    i32_const(body, 1);
    body.u8(0x6a);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    body.u8(0x49);
    body.u8(0x71);
    body.u8(0x04);
    body.u8(wasm_f64);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 2);
    i32_const(body, 1);
    body.u8(0x6a);
    body.u8(0x6a);
    body.u8(0x2d);
    body.u32_leb(0);
    body.u32_leb(0);
    local_tee(body, 3);
    i32_const(body, static_cast<std::uint32_t>('='));
    body.u8(0x46);
    local_get(body, 3);
    i32_const(body, static_cast<std::uint32_t>('.'));
    body.u8(0x46);
    body.u8(0x72);
    body.u8(0x04);
    body.u8(wasm_f64);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0x05);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0x0b);
    body.u8(0x05);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0x0b);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_operator_kind_function(
    std::uint32_t equal_index,
    std::uint32_t truthy_index,
    const StaticImage& image
) {
    Writer body;
    body.u32_leb(0);
    for (std::size_t index = 0; index + 1 < image.operator_texts.size(); ++index) {
        local_get(body, 0);
        i32_const(body, image.operator_texts[index]);
        body.u8(0x10);
        body.u32_leb(equal_index);
        body.u8(0x10);
        body.u32_leb(truthy_index);
        body.u8(0x04);
        body.u8(0x40);
        i32_const(body, image.operator_kinds[index]);
        body.u8(0x0f);
        body.u8(0x0b);
    }
    i32_const(body, image.operator_kinds.back());
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_number_to_string_function(
    std::uint32_t allocate_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(4);
    body.u8(wasm_i32);
    local_get(body, 0);
    f64_load(body);
    body.u8(0xaa);
    local_set(body, 3);
    i32_const(body, values::slot_size + 32U);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 1);
    i32_const(body, 32);
    local_set(body, 2);
    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 2);
    i32_const(body, 1);
    body.u8(0x6b);
    local_tee(body, 2);
    body.u8(0x1a);
    local_get(body, 1);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 2);
    body.u8(0x6a);
    local_get(body, 3);
    i32_const(body, 10);
    body.u8(0x70);
    i32_const(body, static_cast<std::uint32_t>('0'));
    body.u8(0x6a);
    body.u8(0x3a);
    body.u32_leb(0);
    body.u32_leb(0);
    local_get(body, 3);
    i32_const(body, 10);
    body.u8(0x6d);
    local_tee(body, 3);
    body.u8(0x0d);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);
    local_get(body, 1);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Utf8String));
    i32_store(body, values::tag_offset);
    local_get(body, 1);
    i32_const(body, 32);
    local_get(body, 2);
    body.u8(0x6b);
    i32_store(body, values::length_offset);
    local_get(body, 1);
    local_get(body, 1);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 2);
    body.u8(0x6a);
    i32_store(body, values::payload_offset);
    local_get(body, 1);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_power_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(2);
    body.u32_leb(1);
    body.u8(wasm_i32);
    body.u32_leb(2);
    body.u8(wasm_f64);
    local_get(body, 0);
    f64_load(body);
    local_set(body, 3);
    local_get(body, 1);
    f64_load(body);
    body.u8(0xaa);
    local_set(body, 2);
    body.u8(0x44);
    body.f64(1.0);
    local_set(body, 4);
    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 2);
    body.u8(0x45);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 4);
    local_get(body, 3);
    body.u8(0xa2);
    local_set(body, 4);
    local_get(body, 2);
    i32_const(body, 1);
    body.u8(0x6b);
    local_set(body, 2);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);
    local_get(body, 4);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_square_root_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(0);
    local_get(body, 0);
    f64_load(body);
    body.u8(0x9f);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_atan2_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(1);
    body.u8(wasm_f64);
    local_get(body, 0);
    f64_load(body);
    local_get(body, 1);
    f64_load(body);
    body.u8(0xa3);
    local_tee(body, 2);
    local_get(body, 2);
    local_get(body, 2);
    body.u8(0xa2);
    body.u8(0x44);
    body.f64(0.28);
    body.u8(0xa2);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0xa0);
    body.u8(0xa3);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_record_get_function(
    std::uint32_t equal_index,
    std::uint32_t truthy_index,
    std::uint32_t null_value
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(2);
    body.u8(wasm_i32);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    local_set(body, 2);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_set(body, 3);
    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 2);
    body.u8(0x45);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 2);
    i32_const(body, 1);
    body.u8(0x6b);
    local_set(body, 2);
    local_get(body, 3);
    local_get(body, 2);
    i32_const(body, values::record_entry_size);
    body.u8(0x6c);
    body.u8(0x6a);
    i32_load(body, values::record_key_offset);
    local_get(body, 1);
    body.u8(0x10);
    body.u32_leb(equal_index);
    body.u8(0x10);
    body.u32_leb(truthy_index);
    body.u8(0x04);
    body.u8(0x40);
    local_get(body, 3);
    local_get(body, 2);
    i32_const(body, values::record_entry_size);
    body.u8(0x6c);
    body.u8(0x6a);
    i32_load(body, values::record_value_offset);
    body.u8(0x0f);
    body.u8(0x0b);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);
    i32_const(body, null_value);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_record_set_function(
    std::uint32_t allocate_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(3);
    body.u8(wasm_i32);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    local_set(body, 4);
    i32_const(body, values::slot_size);
    local_get(body, 4);
    i32_const(body, 1);
    body.u8(0x6a);
    i32_const(body, values::record_entry_size);
    body.u8(0x6c);
    body.u8(0x6a);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 3);
    local_get(body, 3);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Record));
    i32_store(body, values::tag_offset);
    local_get(body, 3);
    local_get(body, 4);
    i32_const(body, 1);
    body.u8(0x6a);
    i32_store(body, values::length_offset);
    local_get(body, 3);
    local_get(body, 3);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    i32_store(body, values::payload_offset);
    local_get(body, 3);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_get(body, 4);
    i32_const(body, values::record_entry_size);
    body.u8(0x6c);
    body.u8(0xfc);
    body.u32_leb(10);
    body.u32_leb(0);
    body.u32_leb(0);
    local_get(body, 3);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 4);
    i32_const(body, values::record_entry_size);
    body.u8(0x6c);
    body.u8(0x6a);
    local_get(body, 1);
    i32_store(body, values::record_key_offset);
    local_get(body, 3);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_get(body, 4);
    i32_const(body, values::record_entry_size);
    body.u8(0x6c);
    body.u8(0x6a);
    local_get(body, 2);
    i32_store(body, values::record_value_offset);
    local_get(body, 3);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline void emit_ascii_identifier_start_test(Writer& body) {
    local_get(body, 0);
    f64_load(body);
    body.u8(0xaa);
    local_tee(body, 1);
    i32_const(body, static_cast<std::uint32_t>('_'));
    body.u8(0x46);
    local_get(body, 1);
    i32_const(body, static_cast<std::uint32_t>('A'));
    body.u8(0x4f);
    local_get(body, 1);
    i32_const(body, static_cast<std::uint32_t>('Z'));
    body.u8(0x4d);
    body.u8(0x71);
    body.u8(0x72);
    local_get(body, 1);
    i32_const(body, static_cast<std::uint32_t>('a'));
    body.u8(0x4f);
    local_get(body, 1);
    i32_const(body, static_cast<std::uint32_t>('z'));
    body.u8(0x4d);
    body.u8(0x71);
    body.u8(0x72);
}

inline std::vector<std::uint8_t> emit_identifier_start_function(
    std::uint32_t make_boolean_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(1);
    body.u8(wasm_i32);
    emit_ascii_identifier_start_test(body);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_identifier_continue_function(
    std::uint32_t make_boolean_index
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(1);
    body.u8(wasm_i32);
    emit_ascii_identifier_start_test(body);
    local_get(body, 1);
    i32_const(body, static_cast<std::uint32_t>('0'));
    body.u8(0x4f);
    local_get(body, 1);
    i32_const(body, static_cast<std::uint32_t>('9'));
    body.u8(0x4d);
    body.u8(0x71);
    body.u8(0x72);
    body.u8(0x10);
    body.u32_leb(make_boolean_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_sine_function(
    std::uint32_t make_number_index,
    double phase
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(3);
    body.u8(wasm_f64);
    local_get(body, 0);
    f64_load(body);
    body.u8(0x44);
    body.f64(phase);
    body.u8(0xa0);
    local_tee(body, 1);
    local_get(body, 1);
    body.u8(0x44);
    body.f64(6.2831853071795864769);
    body.u8(0xa3);
    body.u8(0x9e);
    body.u8(0x44);
    body.f64(6.2831853071795864769);
    body.u8(0xa2);
    body.u8(0xa1);
    local_tee(body, 1);
    local_get(body, 1);
    body.u8(0xa2);
    local_set(body, 2);

    const auto emit_term = [&body](
        std::uint32_t squared_factors,
        double scale,
        std::uint8_t combine_opcode
    ) {
        local_get(body, 1);
        for (std::uint32_t index = 0; index < squared_factors; ++index) {
            local_get(body, 2);
            body.u8(0xa2);
        }
        body.u8(0x44);
        body.f64(scale);
        body.u8(0xa2);
        body.u8(combine_opcode);
    };

    local_get(body, 1);
    emit_term(1, 1.0 / 6.0, 0xa1);
    emit_term(2, 1.0 / 120.0, 0xa0);
    emit_term(3, 1.0 / 5040.0, 0xa1);
    emit_term(4, 1.0 / 362880.0, 0xa0);
    emit_term(5, 1.0 / 39916800.0, 0xa1);
    emit_term(6, 1.0 / 6227020800.0, 0xa0);
    emit_term(7, 1.0 / 1307674368000.0, 0xa1);
    emit_term(8, 1.0 / 355687428096000.0, 0xa0);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_tangent_function(
    std::uint32_t sine_index,
    std::uint32_t cosine_index,
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(0);
    local_get(body, 0);
    body.u8(0x10);
    body.u32_leb(sine_index);
    f64_load(body);
    local_get(body, 0);
    body.u8(0x10);
    body.u32_leb(cosine_index);
    f64_load(body);
    body.u8(0xa3);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_absolute_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(0);
    local_get(body, 0);
    f64_load(body);
    body.u8(0x99);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_exponential_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(2);
    body.u32_leb(1);
    body.u8(wasm_i32);
    body.u32_leb(3);
    body.u8(wasm_f64);

    local_get(body, 0);
    f64_load(body);
    body.u8(0x44);
    body.f64(0.69314718055994530942);
    body.u8(0xa3);
    body.u8(0x9c);
    body.u8(0xaa);
    local_set(body, 1);

    local_get(body, 0);
    f64_load(body);
    local_get(body, 1);
    body.u8(0xb7);
    body.u8(0x44);
    body.f64(0.69314718055994530942);
    body.u8(0xa2);
    body.u8(0xa1);
    local_set(body, 2);
    body.u8(0x44);
    body.f64(1.0);
    local_set(body, 3);
    body.u8(0x44);
    body.f64(1.0);
    local_set(body, 4);
    for (std::uint32_t degree = 1; degree <= 16; ++degree) {
        local_get(body, 3);
        local_get(body, 2);
        body.u8(0xa2);
        body.u8(0x44);
        body.f64(static_cast<double>(degree));
        body.u8(0xa3);
        local_tee(body, 3);
        local_get(body, 4);
        body.u8(0xa0);
        local_set(body, 4);
    }

    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 1);
    i32_const(body, 0);
    body.u8(0x4c);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 4);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0xa2);
    local_set(body, 4);
    local_get(body, 1);
    i32_const(body, 1);
    body.u8(0x6b);
    local_set(body, 1);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);

    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 1);
    i32_const(body, 0);
    body.u8(0x4e);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 4);
    body.u8(0x44);
    body.f64(0.5);
    body.u8(0xa2);
    local_set(body, 4);
    local_get(body, 1);
    i32_const(body, 1);
    body.u8(0x6a);
    local_set(body, 1);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);

    local_get(body, 4);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_natural_log_function(
    std::uint32_t make_number_index
) {
    Writer body;
    body.u32_leb(2);
    body.u32_leb(1);
    body.u8(wasm_i32);
    body.u32_leb(5);
    body.u8(wasm_f64);

    local_get(body, 0);
    f64_load(body);
    body.u8(0x44);
    body.f64(0.0);
    body.u8(0x65);
    body.u8(0x04);
    body.u8(0x40);
    body.u8(0x44);
    body.f64(std::numeric_limits<double>::quiet_NaN());
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0f);
    body.u8(0x0b);

    i32_const(body, 0);
    local_set(body, 1);
    local_get(body, 0);
    f64_load(body);
    local_set(body, 2);

    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 2);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0x63);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 2);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0xa3);
    local_set(body, 2);
    local_get(body, 1);
    i32_const(body, 1);
    body.u8(0x6a);
    local_set(body, 1);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);

    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 2);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0x66);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 2);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0xa2);
    local_set(body, 2);
    local_get(body, 1);
    i32_const(body, 1);
    body.u8(0x6b);
    local_set(body, 1);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);

    local_get(body, 2);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0xa1);
    local_get(body, 2);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0xa0);
    body.u8(0xa3);
    local_tee(body, 3);
    local_get(body, 3);
    body.u8(0xa2);
    local_set(body, 4);
    local_get(body, 3);
    local_set(body, 5);
    local_get(body, 3);
    local_set(body, 6);
    for (std::uint32_t divisor = 3; divisor <= 21; divisor += 2) {
        local_get(body, 5);
        local_get(body, 4);
        body.u8(0xa2);
        local_tee(body, 5);
        body.u8(0x44);
        body.f64(static_cast<double>(divisor));
        body.u8(0xa3);
        local_get(body, 6);
        body.u8(0xa0);
        local_set(body, 6);
    }
    local_get(body, 6);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0xa2);
    local_get(body, 1);
    body.u8(0xb7);
    body.u8(0x44);
    body.f64(0.69314718055994530942);
    body.u8(0xa2);
    body.u8(0xa0);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_plot_pack_function(
    std::uint32_t allocate_index,
    std::uint32_t make_number_index,
    std::uint32_t null_value
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(8);
    body.u8(wasm_i32);

    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
    body.u8(0x47);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, null_value);
    body.u8(0x0f);
    body.u8(0x0b);

    local_get(body, 0);
    i32_load(body, values::length_offset);
    local_tee(body, 4);
    i32_const(body, 6);
    body.u8(0x70);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, null_value);
    body.u8(0x0f);
    body.u8(0x0b);

    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_set(body, 6);
    local_get(body, 4);
    i32_const(body, 4);
    body.u8(0x6c);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 3);

    i32_const(body, 0);
    local_set(body, 5);
    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 5);
    local_get(body, 4);
    body.u8(0x4f);
    body.u8(0x0d);
    body.u32_leb(1);

    local_get(body, 3);
    local_get(body, 5);
    i32_const(body, 4);
    body.u8(0x6c);
    body.u8(0x6a);
    local_get(body, 6);
    local_get(body, 5);
    i32_const(body, values::pointer_size);
    body.u8(0x6c);
    body.u8(0x6a);
    i32_load(body);
    f64_load(body);
    body.u8(0xb6);
    body.u8(0x38);
    body.u32_leb(2);
    body.u32_leb(0);

    local_get(body, 5);
    i32_const(body, 1);
    body.u8(0x6a);
    local_set(body, 5);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);

    i32_const(body, values::slot_size + 4U * values::pointer_size);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 2);
    local_get(body, 2);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
    i32_store(body, values::tag_offset);
    local_get(body, 2);
    i32_const(body, 4);
    i32_store(body, values::length_offset);
    local_get(body, 2);
    local_get(body, 2);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_tee(body, 8);
    i32_store(body, values::payload_offset);

    local_get(body, 3);
    body.u8(0xb7);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    local_set(body, 7);
    local_get(body, 8);
    local_get(body, 7);
    i32_store(body);

    local_get(body, 4);
    i32_const(body, 6);
    body.u8(0x6e);
    body.u8(0xb7);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    local_set(body, 7);
    local_get(body, 8);
    i32_const(body, values::pointer_size);
    body.u8(0x6a);
    local_get(body, 7);
    i32_store(body);

    body.u8(0x44);
    body.f64(24.0);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    local_set(body, 7);
    local_get(body, 8);
    i32_const(body, 2U * values::pointer_size);
    body.u8(0x6a);
    local_get(body, 7);
    i32_store(body);

    local_get(body, 1);
    f64_load(body);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    local_set(body, 7);
    local_get(body, 8);
    i32_const(body, 3U * values::pointer_size);
    body.u8(0x6a);
    local_get(body, 7);
    i32_store(body);

    local_get(body, 2);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_plot_builder_create_function(
    std::uint32_t allocate_index,
    std::uint32_t make_number_index,
    std::uint32_t null_value
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(7);
    body.u8(wasm_i32);

    for (std::uint32_t parameter = 0; parameter < 2; ++parameter) {
        local_get(body, parameter);
        i32_load(body, values::tag_offset);
        i32_const(body, static_cast<std::uint32_t>(values::Tag::Number));
        body.u8(0x47);
        body.u8(0x04);
        body.u8(0x40);
        i32_const(body, null_value);
        body.u8(0x0f);
        body.u8(0x0b);
    }

    local_get(body, 0);
    f64_load(body);
    body.u8(0xaa);
    local_tee(body, 2);
    i32_const(body, 0);
    body.u8(0x48);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, null_value);
    body.u8(0x0f);
    body.u8(0x0b);

    local_get(body, 2);
    i32_const(body, 24);
    body.u8(0x6c);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 3);

    i32_const(body, values::slot_size + 5U * values::pointer_size);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 4);
    local_get(body, 4);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
    i32_store(body, values::tag_offset);
    local_get(body, 4);
    i32_const(body, 5);
    i32_store(body, values::length_offset);
    local_get(body, 4);
    local_get(body, 4);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_tee(body, 5);
    i32_store(body, values::payload_offset);

    local_get(body, 3);
    body.u8(0xb7);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    local_set(body, 6);
    local_get(body, 5);
    local_get(body, 6);
    i32_store(body);

    local_get(body, 5);
    i32_const(body, values::pointer_size);
    body.u8(0x6a);
    local_get(body, 0);
    i32_store(body);

    body.u8(0x44);
    body.f64(0.0);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    local_set(body, 7);
    local_get(body, 5);
    i32_const(body, 2U * values::pointer_size);
    body.u8(0x6a);
    local_get(body, 7);
    i32_store(body);

    body.u8(0x44);
    body.f64(24.0);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    local_set(body, 8);
    local_get(body, 5);
    i32_const(body, 3U * values::pointer_size);
    body.u8(0x6a);
    local_get(body, 8);
    i32_store(body);

    local_get(body, 5);
    i32_const(body, 4U * values::pointer_size);
    body.u8(0x6a);
    local_get(body, 1);
    i32_store(body);

    local_get(body, 4);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_plot_builder_push_function(
    std::uint32_t null_value
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(6);
    body.u8(wasm_i32);

    for (std::uint32_t parameter = 0; parameter < 2; ++parameter) {
        local_get(body, parameter);
        i32_load(body, values::tag_offset);
        i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
        body.u8(0x47);
        body.u8(0x04);
        body.u8(0x40);
        i32_const(body, null_value);
        body.u8(0x0f);
        body.u8(0x0b);
    }
    local_get(body, 0);
    i32_load(body, values::length_offset);
    i32_const(body, 5);
    body.u8(0x47);
    local_get(body, 1);
    i32_load(body, values::length_offset);
    i32_const(body, 6);
    body.u8(0x47);
    body.u8(0x72);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, null_value);
    body.u8(0x0f);
    body.u8(0x0b);

    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_set(body, 2);
    local_get(body, 2);
    i32_const(body, 2U * values::pointer_size);
    body.u8(0x6a);
    i32_load(body);
    local_set(body, 3);
    local_get(body, 3);
    f64_load(body);
    body.u8(0xaa);
    local_set(body, 4);
    local_get(body, 4);
    local_get(body, 2);
    i32_const(body, values::pointer_size);
    body.u8(0x6a);
    i32_load(body);
    f64_load(body);
    body.u8(0xaa);
    body.u8(0x4e);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, null_value);
    body.u8(0x0f);
    body.u8(0x0b);

    local_get(body, 2);
    i32_load(body);
    f64_load(body);
    body.u8(0xaa);
    local_set(body, 5);
    local_get(body, 1);
    i32_load(body, values::payload_offset);
    local_set(body, 6);
    i32_const(body, 0);
    local_set(body, 7);
    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    local_get(body, 7);
    i32_const(body, 6);
    body.u8(0x4f);
    body.u8(0x0d);
    body.u32_leb(1);
    local_get(body, 5);
    local_get(body, 4);
    i32_const(body, 24);
    body.u8(0x6c);
    body.u8(0x6a);
    local_get(body, 7);
    i32_const(body, 4);
    body.u8(0x6c);
    body.u8(0x6a);
    local_get(body, 6);
    local_get(body, 7);
    i32_const(body, values::pointer_size);
    body.u8(0x6c);
    body.u8(0x6a);
    i32_load(body);
    f64_load(body);
    body.u8(0xb6);
    body.u8(0x38);
    body.u32_leb(2);
    body.u32_leb(0);
    local_get(body, 7);
    i32_const(body, 1);
    body.u8(0x6a);
    local_set(body, 7);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);

    local_get(body, 3);
    local_get(body, 4);
    i32_const(body, 1);
    body.u8(0x6a);
    body.u8(0xb7);
    f64_store(body);
    local_get(body, 0);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_plot_builder_finish_function(
    std::uint32_t allocate_index,
    std::uint32_t null_value
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(4);
    body.u8(wasm_i32);

    local_get(body, 0);
    i32_load(body, values::tag_offset);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
    body.u8(0x47);
    local_get(body, 0);
    i32_load(body, values::length_offset);
    i32_const(body, 5);
    body.u8(0x47);
    body.u8(0x72);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, null_value);
    body.u8(0x0f);
    body.u8(0x0b);

    local_get(body, 0);
    i32_load(body, values::payload_offset);
    local_set(body, 2);
    i32_const(body, values::slot_size + 4U * values::pointer_size);
    body.u8(0x10);
    body.u32_leb(allocate_index);
    local_set(body, 3);
    local_get(body, 3);
    i32_const(body, static_cast<std::uint32_t>(values::Tag::Array));
    i32_store(body, values::tag_offset);
    local_get(body, 3);
    i32_const(body, 4);
    i32_store(body, values::length_offset);
    local_get(body, 3);
    local_get(body, 3);
    i32_const(body, values::slot_size);
    body.u8(0x6a);
    local_tee(body, 4);
    i32_store(body, values::payload_offset);

    const std::uint32_t source_slots[] = {0, 2, 3, 4};
    for (std::uint32_t target = 0; target < 4; ++target) {
        local_get(body, 4);
        i32_const(body, target * values::pointer_size);
        body.u8(0x6a);
        local_get(body, 2);
        i32_const(body, source_slots[target] * values::pointer_size);
        body.u8(0x6a);
        i32_load(body);
        i32_store(body);
    }
    local_get(body, 3);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_i32_constant_function(
    std::uint32_t value
) {
    Writer body;
    body.u32_leb(0);
    body.u8(0x41);
    body.i32_leb(static_cast<std::int32_t>(value));
    body.u8(0x0b);
    Writer encoded;
    auto bytes = body.take();
    encoded.u32_leb(static_cast<std::uint32_t>(bytes.size()));
    encoded.raw(bytes);
    return encoded.take();
}

inline std::vector<std::uint8_t> emit_invoke_function(
    const bytecode::Module& module,
    const ModuleLayout& layout
) {
    Writer body;
    body.u32_leb(1);
    body.u32_leb(1);
    body.u8(wasm_i32);
    for (std::uint32_t index = 0; index < module.functions.size(); ++index) {
        const auto& function = module.functions[index];
        body.u8(0x20);
        body.u32_leb(0);
        body.u8(0x41);
        body.i32_leb(static_cast<std::int32_t>(index));
        body.u8(0x46);
        body.u8(0x04);
        body.u8(0x40);

        body.u8(0x20);
        body.u32_leb(1);
        body.u8(0x41);
        body.i32_leb(static_cast<std::int32_t>(function.parameter_count));
        body.u8(0x47);
        body.u8(0x04);
        body.u8(0x40);
        body.u8(0x41);
        body.i32_leb(2);
        body.u8(0x0f);
        body.u8(0x0b);

        for (std::uint32_t argument = 0;
             argument < function.parameter_count;
             ++argument) {
            i32_const(
                body,
                layout.arguments_ptr + argument * values::slot_size
            );
        }
        body.u8(0x10);
        body.u32_leb(index);
        local_set(body, 2);
        i32_const(body, layout.results_ptr);
        local_get(body, 2);
        body.u8(0x29);
        body.u32_leb(3);
        body.u32_leb(0);
        body.u8(0x37);
        body.u32_leb(3);
        body.u32_leb(0);
        i32_const(body, layout.results_ptr + 8U);
        local_get(body, 2);
        body.u8(0x29);
        body.u32_leb(3);
        body.u32_leb(8);
        body.u8(0x37);
        body.u32_leb(3);
        body.u32_leb(0);
        i32_const(body, 0);
        body.u8(0x0f);
        body.u8(0x0b);
    }
    i32_const(body, 1);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_evaluate_function(
    std::uint32_t entry_function,
    std::uint32_t invoke_function_index
) {
    Writer body;
    body.u32_leb(0);
    if (entry_function == bytecode::no_entry_function) {
        body.u8(0x41);
        body.i32_leb(3);
    } else {
        body.u8(0x41);
        body.i32_leb(static_cast<std::int32_t>(entry_function));
        body.u8(0x20);
        body.u32_leb(0);
        body.u8(0x10);
        body.u32_leb(invoke_function_index);
    }
    body.u8(0x0b);

    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_heap_pointer_function() {
    Writer body;
    body.u32_leb(0);
    body.u8(0x23);
    body.u32_leb(0);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_reset_function(
    std::uint32_t heap_base
) {
    Writer body;
    body.u32_leb(0);
    i32_const(body, heap_base);
    body.u8(0x24);
    body.u32_leb(0);
    i32_const(body, heap_base);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

inline std::vector<std::uint8_t> emit_rewind_function(
    std::uint32_t heap_base
) {
    Writer body;
    body.u32_leb(0);

    local_get(body, 0);
    i32_const(body, heap_base);
    body.u8(0x49);
    local_get(body, 0);
    body.u8(0x23);
    body.u32_leb(0);
    body.u8(0x4b);
    body.u8(0x72);
    local_get(body, 0);
    i32_const(body, values::slot_alignment - 1U);
    body.u8(0x71);
    body.u8(0x45);
    body.u8(0x45);
    body.u8(0x72);
    body.u8(0x04);
    body.u8(0x40);
    i32_const(body, 0);
    body.u8(0x0f);
    body.u8(0x0b);

    local_get(body, 0);
    body.u8(0x24);
    body.u32_leb(0);
    local_get(body, 0);
    body.u8(0x0b);
    return encoded_body(std::move(body));
}

}  // namespace detail

inline EmittedModule emit(
    const bytecode::Module& module,
    const EmitterOptions& options = {}
) {
    if (options.slot_capacity == 0) {
        throw VmEmitterError("WASM VM requires at least one argument slot");
    }
    if (options.arena_capacity < values::slot_size) {
        throw VmEmitterError("WASM VM arena is smaller than one value slot");
    }
    bytecode::validate(module);
    const auto bytecode_bytes = bytecode::serialize(module);
    std::vector<std::uint32_t> maximum_stacks;
    maximum_stacks.reserve(module.functions.size());
    for (std::size_t index = 0; index < module.functions.size(); ++index) {
        maximum_stacks.push_back(
            detail::validate_function_stack(module.functions[index], index)
        );
        if (module.functions[index].parameter_count > options.slot_capacity) {
            throw VmEmitterError(
                "function " + std::to_string(index)
                + " exceeds the configured argument slot capacity"
            );
        }
    }

    EmittedModule emitted;
    emitted.layout.arguments_capacity = options.slot_capacity;
    auto image = detail::build_static_image(
        module,
        bytecode_bytes,
        emitted.layout
    );
    const std::uint64_t heap_limit =
        static_cast<std::uint64_t>(emitted.layout.heap_base)
        + options.arena_capacity;
    if (heap_limit > std::numeric_limits<std::uint32_t>::max()) {
        throw VmEmitterError("WASM VM arena exceeds 32-bit linear memory");
    }
    emitted.layout.heap_limit = static_cast<std::uint32_t>(heap_limit);
    const std::uint32_t memory_pages = static_cast<std::uint32_t>(
        std::max<std::uint64_t>(
            1,
            (heap_limit + detail::wasm_page_size - 1)
                / detail::wasm_page_size
        )
    );

    const std::uint32_t function_count =
        static_cast<std::uint32_t>(module.functions.size());
    detail::RuntimeIndexes runtime;
    runtime.allocate = function_count;
    runtime.make_boolean = runtime.allocate + 1;
    runtime.make_number = runtime.make_boolean + 1;
    runtime.truthy = runtime.make_number + 1;
    runtime.equal = runtime.truthy + 1;
    runtime.string_concat = runtime.equal + 1;
    runtime.utf8_length = runtime.string_concat + 1;
    runtime.utf8_eof = runtime.utf8_length + 1;
    runtime.utf8_peek = runtime.utf8_eof + 1;
    runtime.utf8_advance = runtime.utf8_peek + 1;
    runtime.decimal_scan = runtime.utf8_advance + 1;
    runtime.number_to_string = runtime.decimal_scan + 1;
    runtime.power = runtime.number_to_string + 1;
    runtime.square_root = runtime.power + 1;
    runtime.atan2 = runtime.square_root + 1;
    runtime.record_get = runtime.atan2 + 1;
    runtime.record_set = runtime.record_get + 1;
    runtime.identifier_start = runtime.record_set + 1;
    runtime.identifier_continue = runtime.identifier_start + 1;
    runtime.sine = runtime.identifier_continue + 1;
    runtime.cosine = runtime.sine + 1;
    runtime.tangent = runtime.cosine + 1;
    runtime.absolute = runtime.tangent + 1;
    runtime.natural_log = runtime.absolute + 1;
    runtime.exponential = runtime.natural_log + 1;
    runtime.array_length = runtime.exponential + 1;
    runtime.utf8_slice = runtime.array_length + 1;
    runtime.decimal_scan_end = runtime.utf8_slice + 1;
    runtime.identifier_scan_end = runtime.decimal_scan_end + 1;
    runtime.operator_width = runtime.identifier_scan_end + 1;
    runtime.operator_kind = runtime.operator_width + 1;
    runtime.plot_pack = runtime.operator_kind + 1;
    runtime.plot_builder_create = runtime.plot_pack + 1;
    runtime.plot_builder_push = runtime.plot_builder_create + 1;
    runtime.plot_builder_finish = runtime.plot_builder_push + 1;
    const std::uint32_t runtime_count = 35;
    const std::uint32_t getter_count = 9;
    const std::uint32_t getter_base = function_count + runtime_count;
    const std::uint32_t heap_pointer_index = getter_base + getter_count;
    const std::uint32_t reset_index = heap_pointer_index + 1;
    const std::uint32_t rewind_index = reset_index + 1;
    const std::uint32_t invoke_index = rewind_index + 1;
    const std::uint32_t evaluate_index = invoke_index + 1;
    const std::uint32_t emitted_function_count = evaluate_index + 1;

    detail::Writer wasm;
    const std::uint8_t preamble[] = {
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    };
    wasm.raw(preamble, sizeof(preamble));

    detail::Writer types;
    types.u32_leb(emitted_function_count);
    const auto emit_type = [&types](
        const std::vector<std::uint8_t>& parameters,
        const std::vector<std::uint8_t>& results
    ) {
        types.u8(0x60);
        types.u32_leb(static_cast<std::uint32_t>(parameters.size()));
        for (const auto type : parameters) {
            types.u8(type);
        }
        types.u32_leb(static_cast<std::uint32_t>(results.size()));
        for (const auto type : results) {
            types.u8(type);
        }
    };
    for (const auto& function : module.functions) {
        emit_type(
            std::vector<std::uint8_t>(
                function.parameter_count,
                detail::wasm_i32
            ),
            {detail::wasm_i32}
        );
    }
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type({detail::wasm_f64}, {detail::wasm_i32});
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type(
        {detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type(
        {detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    for (std::uint32_t index = 0; index < 3; ++index) {
        emit_type(
            {detail::wasm_i32, detail::wasm_i32},
            {detail::wasm_i32}
        );
    }
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type(
        {detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type(
        {detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type(
        {detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type(
        {detail::wasm_i32, detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    for (std::uint32_t index = 0; index < 6; ++index) {
        emit_type({detail::wasm_i32}, {detail::wasm_i32});
    }
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type(
        {detail::wasm_i32, detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    for (std::uint32_t index = 0; index < 3; ++index) {
        emit_type(
            {detail::wasm_i32, detail::wasm_i32},
            {detail::wasm_i32}
        );
    }
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type(
        {detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type(
        {detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type(
        {detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    for (std::uint32_t index = 0; index < getter_count + 2; ++index) {
        emit_type({}, {detail::wasm_i32});
    }
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    emit_type(
        {detail::wasm_i32, detail::wasm_i32},
        {detail::wasm_i32}
    );
    emit_type({detail::wasm_i32}, {detail::wasm_i32});
    detail::append_section(wasm, 1, types.take());

    detail::Writer functions;
    functions.u32_leb(emitted_function_count);
    for (std::uint32_t index = 0; index < emitted_function_count; ++index) {
        functions.u32_leb(index);
    }
    detail::append_section(wasm, 3, functions.take());

    detail::Writer memories;
    memories.u32_leb(1);
    memories.u8(0x00);
    memories.u32_leb(memory_pages);
    detail::append_section(wasm, 5, memories.take());

    detail::Writer globals;
    globals.u32_leb(1);
    globals.u8(detail::wasm_i32);
    globals.u8(0x01);
    globals.u8(0x41);
    globals.i32_leb(static_cast<std::int32_t>(emitted.layout.heap_base));
    globals.u8(0x0b);
    detail::append_section(wasm, 6, globals.take());

    detail::Writer exports;
    exports.u32_leb(16);
    exports.name("memory");
    exports.u8(0x02);
    exports.u32_leb(0);
    const std::pair<const char*, std::uint32_t> getter_exports[] = {
        {"vkf_vm_bytecode_ptr", getter_base},
        {"vkf_vm_bytecode_len", getter_base + 1},
        {"vkf_vm_arguments_ptr", getter_base + 2},
        {"vkf_vm_arguments_capacity", getter_base + 3},
        {"vkf_vm_results_ptr", getter_base + 4},
        {"vkf_vm_results_capacity", getter_base + 5},
        {"vkf_vm_value_slot_size", getter_base + 6},
        {"vkf_vm_heap_base", getter_base + 7},
        {"vkf_vm_heap_limit", getter_base + 8},
    };
    for (const auto& item : getter_exports) {
        exports.name(item.first);
        exports.u8(0x00);
        exports.u32_leb(item.second);
    }
    exports.name("vkf_vm_invoke");
    exports.u8(0x00);
    exports.u32_leb(invoke_index);
    exports.name("vkf_vm_evaluate");
    exports.u8(0x00);
    exports.u32_leb(evaluate_index);
    exports.name("vkf_vm_heap_ptr");
    exports.u8(0x00);
    exports.u32_leb(heap_pointer_index);
    exports.name("vkf_vm_alloc");
    exports.u8(0x00);
    exports.u32_leb(runtime.allocate);
    exports.name("vkf_vm_reset");
    exports.u8(0x00);
    exports.u32_leb(reset_index);
    exports.name("vkf_vm_rewind");
    exports.u8(0x00);
    exports.u32_leb(rewind_index);
    detail::append_section(wasm, 7, exports.take());

    detail::Writer code;
    code.u32_leb(emitted_function_count);
    for (std::uint32_t index = 0; index < function_count; ++index) {
        code.raw(detail::emit_tagged_function(
            module,
            index,
            maximum_stacks[index],
            image,
            runtime
        ));
    }
    code.raw(detail::emit_allocate_function(emitted.layout.heap_limit));
    code.raw(detail::emit_make_boolean_function(runtime.allocate));
    code.raw(detail::emit_make_number_function(runtime.allocate));
    code.raw(detail::emit_truthy_function());
    code.raw(detail::emit_equal_function(runtime.make_boolean));
    code.raw(detail::emit_string_concat_function(
        runtime.allocate,
        image.null_value
    ));
    code.raw(detail::emit_utf8_length_function(runtime.make_number));
    code.raw(detail::emit_utf8_eof_function(runtime.make_boolean));
    code.raw(detail::emit_utf8_peek_function(runtime.make_number));
    code.raw(detail::emit_utf8_advance_function(runtime.make_number));
    code.raw(detail::emit_decimal_scan_function(runtime.make_number));
    code.raw(detail::emit_number_to_string_function(runtime.allocate));
    code.raw(detail::emit_power_function(runtime.make_number));
    code.raw(detail::emit_square_root_function(runtime.make_number));
    code.raw(detail::emit_atan2_function(runtime.make_number));
    code.raw(detail::emit_record_get_function(
        runtime.equal,
        runtime.truthy,
        image.null_value
    ));
    code.raw(detail::emit_record_set_function(runtime.allocate));
    code.raw(detail::emit_identifier_start_function(runtime.make_boolean));
    code.raw(detail::emit_identifier_continue_function(runtime.make_boolean));
    code.raw(detail::emit_sine_function(runtime.make_number, 0.0));
    code.raw(detail::emit_sine_function(
        runtime.make_number,
        1.5707963267948966192
    ));
    code.raw(detail::emit_tangent_function(
        runtime.sine,
        runtime.cosine,
        runtime.make_number
    ));
    code.raw(detail::emit_absolute_function(runtime.make_number));
    code.raw(detail::emit_natural_log_function(runtime.make_number));
    code.raw(detail::emit_exponential_function(runtime.make_number));
    code.raw(detail::emit_utf8_length_function(runtime.make_number));
    code.raw(detail::emit_utf8_slice_function(
        runtime.allocate,
        image.null_value
    ));
    code.raw(detail::emit_scan_end_function(runtime.make_number, true));
    code.raw(detail::emit_scan_end_function(runtime.make_number, false));
    code.raw(detail::emit_operator_width_function(runtime.make_number));
    code.raw(detail::emit_operator_kind_function(
        runtime.equal,
        runtime.truthy,
        image
    ));
    code.raw(detail::emit_plot_pack_function(
        runtime.allocate,
        runtime.make_number,
        image.null_value
    ));
    code.raw(detail::emit_plot_builder_create_function(
        runtime.allocate,
        runtime.make_number,
        image.null_value
    ));
    code.raw(detail::emit_plot_builder_push_function(image.null_value));
    code.raw(detail::emit_plot_builder_finish_function(
        runtime.allocate,
        image.null_value
    ));
    const std::uint32_t getter_values[] = {
        emitted.layout.bytecode_ptr,
        emitted.layout.bytecode_len,
        emitted.layout.arguments_ptr,
        emitted.layout.arguments_capacity,
        emitted.layout.results_ptr,
        emitted.layout.results_capacity,
        emitted.layout.value_slot_size,
        emitted.layout.heap_base,
        emitted.layout.heap_limit,
    };
    for (const std::uint32_t value : getter_values) {
        code.raw(detail::emit_i32_constant_function(value));
    }
    code.raw(detail::emit_heap_pointer_function());
    code.raw(detail::emit_reset_function(emitted.layout.heap_base));
    code.raw(detail::emit_rewind_function(emitted.layout.heap_base));
    code.raw(detail::emit_invoke_function(module, emitted.layout));
    code.raw(detail::emit_evaluate_function(
        module.entry_function,
        invoke_index
    ));
    detail::append_section(wasm, 10, code.take());

    detail::Writer data;
    data.u32_leb(1);
    data.u8(0x00);
    data.u8(0x41);
    data.i32_leb(static_cast<std::int32_t>(emitted.layout.bytecode_ptr));
    data.u8(0x0b);
    data.u32_leb(static_cast<std::uint32_t>(image.bytes.size()));
    data.raw(image.bytes);
    detail::append_section(wasm, 11, data.take());

    emitted.wasm = wasm.take();
    return emitted;
}

}  // namespace vkf::wasm::vm
