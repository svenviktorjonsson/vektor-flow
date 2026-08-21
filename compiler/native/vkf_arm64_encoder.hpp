#pragma once

#include "compiler/native/vkf_machine_ir.hpp"
#include "compiler/native/vkf_target.hpp"
#include "compiler/native/vkf_capture_pattern.hpp"

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vkf::arm64 {

class EncodingFailure : public std::runtime_error {
public:
    explicit EncodingFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Result {
    std::vector<std::uint8_t> code;
    std::map<std::string, std::uint32_t> function_offsets;
};

namespace detail {

class Words {
public:
    std::vector<std::uint32_t> values;

    std::uint32_t offset() const { return static_cast<std::uint32_t>(values.size() * 4); }
    std::size_t emit(std::uint32_t value) {
        values.push_back(value);
        return values.size() - 1;
    }

    void patch_branch26(std::size_t index, std::uint32_t target) {
        const std::int64_t source = static_cast<std::int64_t>(index * 4);
        const std::int64_t delta = static_cast<std::int64_t>(target) - source;
        if ((delta & 3) != 0 || delta < -(1ll << 27) || delta >= (1ll << 27)) {
            throw EncodingFailure("arm64 branch26 target out of range");
        }
        values[index] = (values[index] & 0xfc000000u)
            | (static_cast<std::uint32_t>(delta / 4) & 0x03ffffffu);
    }

    void patch_compare_branch19(std::size_t index, std::uint32_t target) {
        const std::int64_t source = static_cast<std::int64_t>(index * 4);
        const std::int64_t delta = static_cast<std::int64_t>(target) - source;
        if ((delta & 3) != 0 || delta < -(1ll << 20) || delta >= (1ll << 20)) {
            throw EncodingFailure("arm64 compare-branch target out of range");
        }
        values[index] = (values[index] & 0xff00001fu)
            | ((static_cast<std::uint32_t>(delta / 4) & 0x7ffffu) << 5);
    }

    std::vector<std::uint8_t> bytes() const {
        std::vector<std::uint8_t> out;
        out.reserve(values.size() * 4);
        for (const auto value : values) {
            out.push_back(static_cast<std::uint8_t>(value));
            out.push_back(static_cast<std::uint8_t>(value >> 8));
            out.push_back(static_cast<std::uint8_t>(value >> 16));
            out.push_back(static_cast<std::uint8_t>(value >> 24));
        }
        return out;
    }
};

struct CallPatch {
    std::size_t instruction;
    std::string symbol;
};

struct BranchPatch {
    std::size_t instruction;
    std::uint32_t label;
    bool compare_branch;
};

struct Frame {
    std::uint32_t data_base = 16;
    std::uint32_t local_count = 0;
    std::uint32_t temp_base = 0;
        std::uint32_t max_stack = 0;
        std::uint32_t scratch_slot = 0;
        std::uint32_t scratch_slots = 0;
    std::uint32_t error_pointer_slot = 0;
    std::uint32_t error_length_slot = 0;
    std::uint32_t error_type_slot = 0;
    std::uint32_t frame_bytes = 16;

    std::uint32_t offset(std::uint32_t slot) const {
        return data_base + slot * 8;
    }
};

class Encoder {
public:
    explicit Encoder(const machine_ir::Module& module) : module_(module) {}

    Result encode() {
        offsets_[module_.entry.name] = words_.offset();
        emit_function(module_.entry, true);
        for (const auto& function : module_.functions) {
            offsets_[function.name] = words_.offset();
            emit_function(function, false);
        }
        for (const auto& patch : calls_) {
            const auto found = offsets_.find(patch.symbol);
            if (found == offsets_.end()) throw EncodingFailure("unknown arm64 function " + patch.symbol);
            words_.patch_branch26(patch.instruction, found->second);
        }
        return {words_.bytes(), offsets_};
    }

private:
    const machine_ir::Module& module_;
    Words words_;
    std::map<std::string, std::uint32_t> offsets_;
    std::vector<CallPatch> calls_;

    static Frame make_frame(const machine_ir::Function& function, bool entry) {
        Frame frame;
        frame.data_base = 24u;
        frame.local_count = static_cast<std::uint32_t>(function.locals.size());
        frame.temp_base = frame.local_count;
        frame.max_stack = function.max_stack;
        frame.scratch_slot = frame.local_count + frame.max_stack;
        const bool needs_scratch = std::any_of(
            function.instructions.begin(), function.instructions.end(), [](const auto& instruction) {
                using machine_ir::Opcode;
                return instruction.opcode == Opcode::StringEqual ||
                    instruction.opcode == Opcode::StringNotEqual ||
                    instruction.opcode == Opcode::StringLess ||
                    instruction.opcode == Opcode::StringLessEqual ||
                    instruction.opcode == Opcode::StringGreater ||
                    instruction.opcode == Opcode::StringGreaterEqual ||
                    instruction.opcode == Opcode::FormatF64String ||
                    instruction.opcode == Opcode::FormatChrString ||
                    instruction.opcode == Opcode::UnionF64Multisets ||
                    instruction.opcode == Opcode::DifferenceF64Multisets ||
                    instruction.opcode == Opcode::FloorDivideF64Multisets ||
                    instruction.opcode == Opcode::RemainderF64Multisets ||
                    instruction.opcode == Opcode::AddF64MultisetScalar ||
                    instruction.opcode == Opcode::SubtractF64MultisetScalar ||
                    instruction.opcode == Opcode::FloorDivideF64MultisetScalar ||
                    instruction.opcode == Opcode::ReadFileString ||
                    instruction.opcode == Opcode::WriteFileString ||
                    instruction.opcode == Opcode::SystemCwdString ||
                    instruction.opcode == Opcode::SystemEnvString;
            });
        const bool needs_process_scratch = std::any_of(
            function.instructions.begin(), function.instructions.end(), [](const auto& instruction) {
                return instruction.opcode == machine_ir::Opcode::ProcessRun;
            });
        const bool needs_capture_scratch = std::any_of(
            function.instructions.begin(), function.instructions.end(), [](const auto& instruction) {
                return instruction.opcode == machine_ir::Opcode::CaptureRegex;
            });
        const bool needs_line_scratch = std::any_of(
            function.instructions.begin(), function.instructions.end(), [](const auto& instruction) {
                return instruction.opcode == machine_ir::Opcode::ReadLineString;
            });
        frame.scratch_slots = needs_process_scratch ? 9u
            : (needs_capture_scratch || needs_line_scratch) ? 4u
            : static_cast<std::uint32_t>(needs_scratch);
        frame.error_pointer_slot = frame.scratch_slot + frame.scratch_slots;
        frame.error_length_slot = frame.error_pointer_slot + 1u;
        frame.error_type_slot = frame.error_length_slot + 1u;
        const std::uint32_t used = frame.data_base +
            (frame.local_count + frame.max_stack + frame.scratch_slots +
             (function.may_error ? 3u : 0u)) * 8;
        frame.frame_bytes = std::max(16u, (used + 15u) & ~15u);
        return frame;
    }

    static void require_stack(std::uint32_t depth, std::uint32_t count) {
        if (depth < count) throw EncodingFailure("invalid arm64 machine IR stack");
    }

    void adjust_stack_pointer(std::uint32_t bytes, bool add) {
        const std::uint32_t pages = bytes >> 12;
        const std::uint32_t remainder = bytes & 0xfffu;
        if (pages > 0xfffu) throw EncodingFailure("arm64 stack adjustment overflow");
        const std::uint32_t base = add ? 0x910003ffu : 0xd10003ffu;
        if (pages) words_.emit(base | 0x00400000u | (pages << 10));
        if (remainder) words_.emit(base | (remainder << 10));
    }

    void emit_prologue(const Frame& frame, bool entry) {
        adjust_stack_pointer(frame.frame_bytes, false);
        words_.emit(0xa9007bfdu);
        words_.emit(0x910003fdu);
        if (entry) {
            words_.emit(0xf9000bb3u);
            words_.emit(0xaa0003f3u);
        } else words_.emit(0xf9000beau);
    }

    void emit_epilogue(const Frame& frame, bool entry) {
        if (entry) words_.emit(0xf9400bb3u);
        words_.emit(0xa9407bfdu);
        adjust_stack_pointer(frame.frame_bytes, true);
        words_.emit(0xd65f03c0u);
    }

    void store_d(unsigned reg, std::uint32_t offset) {
        if (reg > 7 || (offset & 7) != 0) {
            throw EncodingFailure("invalid arm64 f64 store");
        }
        if (offset <= 32760) {
            words_.emit(0xfd0003a0u | ((offset / 8) << 10) | reg);
            return;
        }
        emit_frame_address(15, offset);
        words_.emit(0xfd000000u | (15u << 5) | reg);
    }

    void load_d(unsigned reg, std::uint32_t offset) {
        if (reg > 7 || (offset & 7) != 0) {
            throw EncodingFailure("invalid arm64 f64 load");
        }
        if (offset <= 32760) {
            words_.emit(0xfd4003a0u | ((offset / 8) << 10) | reg);
            return;
        }
        emit_frame_address(15, offset);
        words_.emit(0xfd400000u | (15u << 5) | reg);
    }

    void load_argument_from_x9(std::uint32_t index) {
        if (index > 4095) throw EncodingFailure("arm64 private ABI argument overflow");
        words_.emit(0xfd400120u | (index << 10));
    }

    void store_result_to_x10(std::uint32_t index) {
        if (index > 4095) throw EncodingFailure("arm64 private ABI result overflow");
        words_.emit(0xfd000140u | (index << 10));
    }

    void store_entry_output(unsigned dreg, std::uint32_t index) {
        const std::uint32_t offset = machine_ir::runtime_output_base + index * 8u;
        if (dreg > 7 || (offset & 7u) != 0 || offset > 32760) {
            throw EncodingFailure("invalid arm64 entry output store");
        }
        words_.emit(0xfd000260u | ((offset / 8u) << 10) | dreg);
    }

    void store_x(unsigned reg, std::uint32_t offset) {
        if (reg > 31 || (offset & 7) != 0) {
            throw EncodingFailure("invalid arm64 integer store");
        }
        if (offset <= 32760) {
            words_.emit(0xf90003a0u | ((offset / 8) << 10) | reg);
            return;
        }
        const unsigned address = reg == 15 ? 14 : 15;
        emit_frame_address(address, offset);
        words_.emit(0xf9000000u | (address << 5) | reg);
    }

    void load_x(unsigned reg, std::uint32_t offset) {
        if (reg > 30 || (offset & 7) != 0) {
            throw EncodingFailure("invalid arm64 integer load");
        }
        if (offset <= 32760) {
            words_.emit(0xf94003a0u | ((offset / 8) << 10) | reg);
            return;
        }
        const unsigned address = reg == 15 ? 14 : 15;
        emit_frame_address(address, offset);
        words_.emit(0xf9400000u | (address << 5) | reg);
    }

    void call_runtime_slot(std::uint32_t slot) {
        if (slot > 4095) throw EncodingFailure("arm64 runtime slot overflow");
        words_.emit(0xf9400269u | (slot << 10));
        words_.emit(0xd63f0120u);
    }

    void emit_abort() {
        call_runtime_slot(10);
        words_.emit(0xd4200000u);
    }

    void release_owned_string(std::uint32_t pointer_offset, std::uint32_t length_offset) {
        load_d(0, length_offset);
        words_.emit(0x9e780000u);
        words_.emit(0xf100001fu);
        const auto borrowed = words_.emit(0x5400000au);
        load_x(0, pointer_offset);
        words_.emit(0xd1002000u);
        call_runtime_slot(9);
        words_.patch_compare_branch19(borrowed, words_.offset());
    }

    void emit_u64(unsigned reg, std::uint64_t value) {
        if (reg > 30) throw EncodingFailure("invalid arm64 integer register");
        words_.emit(0xd2800000u | (static_cast<std::uint32_t>(value & 0xffffu) << 5) | reg);
        words_.emit(0xf2a00000u | (static_cast<std::uint32_t>((value >> 16) & 0xffffu) << 5) | reg);
        words_.emit(0xf2c00000u | (static_cast<std::uint32_t>((value >> 32) & 0xffffu) << 5) | reg);
        words_.emit(0xf2e00000u | (static_cast<std::uint32_t>((value >> 48) & 0xffffu) << 5) | reg);
    }

    void emit_frame_address(unsigned reg, std::uint32_t offset) {
        if (reg > 30) throw EncodingFailure("invalid arm64 frame address register");
        emit_u64(reg, offset);
        words_.emit(0x8b0003a0u | (reg << 16) | reg);
    }

    void emit_number(double value, unsigned dreg = 0) {
        if (dreg > 31) throw EncodingFailure("invalid arm64 number register");
        std::uint64_t bits = 0;
        std::memcpy(&bits, &value, sizeof(bits));
        emit_u64(9, bits);
        words_.emit(0x9e670120u | dreg);
    }

    void emit_string_pointer(unsigned reg, std::uint32_t offset) {
        if (reg > 30) throw EncodingFailure("invalid arm64 string pointer register");
        words_.emit(0xf9401e60u | reg);
        if (offset != 0) {
            emit_u64(10, offset);
            words_.emit(0x8b0a0000u | (reg << 5) | reg);
        }
    }

    void emit_string_address(std::uint32_t offset) {
        emit_string_pointer(9, offset);
        words_.emit(0x9e670120u);
    }

    void emit_owned_string_from_cstring(
        const Frame& frame,
        std::uint32_t first,
        bool release_source
    ) {
        store_x(0, frame.offset(frame.scratch_slot));
        call_runtime_slot(27);
        store_x(0, frame.offset(frame.temp_base + first + 1));
        words_.emit(0xb1002400u);
        const auto size_valid = words_.emit(0x54000003u);
        emit_abort();
        words_.patch_compare_branch19(size_valid, words_.offset());
        call_runtime_slot(8);
        const auto allocated = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(allocated, words_.offset());
        store_x(0, frame.offset(frame.temp_base + first));
        load_x(1, frame.offset(frame.temp_base + first + 1));
        words_.emit(0xf9000001u);
        words_.emit(0x91002000u);
        load_x(1, frame.offset(frame.scratch_slot));
        load_x(2, frame.offset(frame.temp_base + first + 1));
        call_runtime_slot(28);
        load_x(9, frame.offset(frame.temp_base + first));
        load_x(10, frame.offset(frame.temp_base + first + 1));
        words_.emit(0x8b0a012bu);
        words_.emit(0x3900217fu);
        words_.emit(0x91002129u);
        words_.emit(0x9e670120u);
        store_d(0, frame.offset(frame.temp_base + first));
        words_.emit(0x9100054au);
        words_.emit(0xcb0a03eau);
        words_.emit(0x9e620140u);
        store_d(0, frame.offset(frame.temp_base + first + 1));
        if (release_source) {
            load_x(0, frame.offset(frame.scratch_slot));
            call_runtime_slot(9);
        }
    }

    void emit_owned_substring(
        const Frame& frame,
        std::uint32_t output,
        std::uint32_t start_offset,
        std::uint32_t end_offset
    ) {
        load_x(2, end_offset);
        load_x(1, start_offset);
        words_.emit(0xcb010042u);
        store_x(2, frame.offset(frame.scratch_slot + 3));
        words_.emit(0x91002440u);
        call_runtime_slot(8);
        const auto allocated = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(allocated, words_.offset());
        store_x(0, frame.offset(frame.scratch_slot + 2));
        load_x(2, frame.offset(frame.scratch_slot + 3));
        words_.emit(0xf9000002u);
        words_.emit(0x91002000u);
        load_x(1, frame.offset(frame.scratch_slot));
        load_x(9, start_offset);
        words_.emit(0x8b090021u);
        call_runtime_slot(28);
        load_x(9, frame.offset(frame.scratch_slot + 2));
        load_x(10, frame.offset(frame.scratch_slot + 3));
        words_.emit(0x8b0a012bu);
        words_.emit(0x3900217fu);
        words_.emit(0x91002129u);
        store_x(9, frame.offset(frame.temp_base + output));
        words_.emit(0x9100054au);
        words_.emit(0xcb0a03eau);
        words_.emit(0x9e620140u);
        store_d(0, frame.offset(frame.temp_base + output + 1));
    }

    void emit_capture_regex(
        const machine_ir::Function& function,
        const Frame& frame,
        std::uint32_t first,
        const machine_ir::Instruction& instruction,
        bool entry,
        std::vector<BranchPatch>& branches
    ) {
        const auto pattern = capture::parse(instruction.symbol);
        if (pattern.group_names.size() != instruction.argument_count) {
            throw EncodingFailure("capture group count changed after machine lowering");
        }
        load_x(9, frame.offset(frame.temp_base + first));
        store_x(9, frame.offset(frame.scratch_slot));
        load_d(0, frame.offset(frame.temp_base + first + 1));
        words_.emit(0x9e78000du);
        words_.emit(0xf10001bfu);
        const auto decoded = words_.emit(0x5400000au);
        words_.emit(0xcb0d03edu);
        words_.emit(0xd10005adu);
        words_.patch_compare_branch19(decoded, words_.offset());
        store_x(13, frame.offset(frame.scratch_slot + 1));
        store_x(31, frame.offset(frame.scratch_slot + 2));

        const auto search = words_.offset();
        load_x(12, frame.offset(frame.scratch_slot));
        load_x(13, frame.offset(frame.scratch_slot + 1));
        load_x(14, frame.offset(frame.scratch_slot + 2));
        std::vector<std::size_t> failures;
        for (const auto& op : pattern.ops) {
            if (op.kind == capture::OpKind::BeginCapture ||
                op.kind == capture::OpKind::EndCapture) {
                if (op.capture >= instruction.argument_count) {
                    throw EncodingFailure("invalid capture group id");
                }
                store_x(14, frame.offset(
                    frame.temp_base + first + op.capture * 2u +
                    (op.kind == capture::OpKind::EndCapture ? 1u : 0u)));
                continue;
            }
            words_.emit(0xaa1f03efu);
            const auto scan = words_.offset();
            std::vector<std::size_t> scan_ends;
            words_.emit(0xeb0d01dfu);
            scan_ends.push_back(words_.emit(0x54000002u));
            if (op.maximum != std::numeric_limits<std::uint32_t>::max()) {
                emit_u64(17, op.maximum);
                words_.emit(0xeb1101ffu);
                scan_ends.push_back(words_.emit(0x54000002u));
            }
            words_.emit(0x8b0e0191u);
            words_.emit(0x39400230u);
            std::vector<std::size_t> matched;
            unsigned byte = 0;
            while (byte < 256) {
                while (byte < 256 && !op.bytes.contains(byte)) ++byte;
                if (byte == 256) break;
                const unsigned begin = byte;
                while (byte + 1 < 256 && op.bytes.contains(byte + 1)) ++byte;
                const unsigned end = byte++;
                words_.emit(0x7100021fu | (begin << 10));
                if (begin == end) {
                    matched.push_back(words_.emit(0x54000000u));
                } else {
                    const auto below = words_.emit(0x54000003u);
                    words_.emit(0x7100021fu | (end << 10));
                    matched.push_back(words_.emit(0x54000009u));
                    words_.patch_compare_branch19(below, words_.offset());
                }
            }
            scan_ends.push_back(words_.emit(0x14000000u));
            const auto consume = words_.offset();
            for (const auto patch : matched) words_.patch_compare_branch19(patch, consume);
            words_.emit(0x910005ceu);
            words_.emit(0x910005efu);
            const auto repeat = words_.emit(0x14000000u);
            words_.patch_branch26(repeat, scan);
            const auto scan_end = words_.offset();
            for (const auto patch : scan_ends) {
                if ((words_.values[patch] & 0xfc000000u) == 0x14000000u) {
                    words_.patch_branch26(patch, scan_end);
                } else {
                    words_.patch_compare_branch19(patch, scan_end);
                }
            }
            emit_u64(17, op.minimum);
            words_.emit(0xeb1101ffu);
            failures.push_back(words_.emit(0x54000003u));
        }
        if (pattern.anchor_end) {
            words_.emit(0xeb0d01dfu);
            failures.push_back(words_.emit(0x54000001u));
        }
        if (pattern.synthetic_full_capture) {
            load_x(9, frame.offset(frame.scratch_slot + 2));
            store_x(9, frame.offset(frame.temp_base + first));
            store_x(14, frame.offset(frame.temp_base + first + 1));
        }
        for (std::uint32_t group = 0; group < instruction.argument_count; ++group) {
            emit_owned_substring(
                frame,
                first + group * 2u,
                frame.offset(frame.temp_base + first + group * 2u),
                frame.offset(frame.temp_base + first + group * 2u + 1u));
        }
        if (instruction.owns_input) {
            load_x(0, frame.offset(frame.scratch_slot));
            words_.emit(0xd1002000u);
            call_runtime_slot(9);
        }
        const auto done = words_.emit(0x14000000u);
        const auto failed = words_.offset();
        for (const auto patch : failures) words_.patch_compare_branch19(patch, failed);
        const auto emit_no_match = [&]() {
            if (instruction.owns_input) {
                load_x(0, frame.offset(frame.scratch_slot));
                words_.emit(0xd1002000u);
                call_runtime_slot(9);
            }
            emit_instruction_error(
                function, frame, instruction,
                machine_ir::value_error_mask, entry, branches);
        };
        if (pattern.anchor_start) {
            emit_no_match();
        } else {
            load_x(9, frame.offset(frame.scratch_slot + 2));
            words_.emit(0x91000529u);
            store_x(9, frame.offset(frame.scratch_slot + 2));
            load_x(10, frame.offset(frame.scratch_slot + 1));
            words_.emit(0xeb0a013fu);
            const auto retry = words_.emit(0x54000009u);
            words_.patch_compare_branch19(retry, search);
            emit_no_match();
        }
        words_.patch_branch26(done, words_.offset());
    }

    void emit_read_descriptor_string(
        const Frame& frame,
        std::uint32_t first,
        std::uint32_t descriptor_scratch
    ) {
        load_x(0, frame.offset(frame.scratch_slot + descriptor_scratch));
        words_.emit(0xaa1f03e1u);
        words_.emit(0xd2800042u);
        call_runtime_slot(23);
        words_.emit(0xf100001fu);
        const auto size_ready = words_.emit(0x5400000au);
        emit_abort();
        words_.patch_compare_branch19(size_ready, words_.offset());
        store_x(0, frame.offset(frame.temp_base + first + 1));
        words_.emit(0xb1002400u);
        const auto allocation_size_ready = words_.emit(0x54000003u);
        emit_abort();
        words_.patch_compare_branch19(allocation_size_ready, words_.offset());
        call_runtime_slot(8);
        const auto allocated = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(allocated, words_.offset());
        store_x(0, frame.offset(frame.temp_base + first));
        load_x(1, frame.offset(frame.temp_base + first + 1));
        words_.emit(0xf9000001u);
        load_x(0, frame.offset(frame.scratch_slot + descriptor_scratch));
        words_.emit(0xaa1f03e1u);
        words_.emit(0xaa1f03e2u);
        call_runtime_slot(23);
        load_x(0, frame.offset(frame.scratch_slot + descriptor_scratch));
        load_x(1, frame.offset(frame.temp_base + first));
        words_.emit(0x91002021u);
        load_x(2, frame.offset(frame.temp_base + first + 1));
        call_runtime_slot(21);
        load_x(9, frame.offset(frame.temp_base + first));
        load_x(10, frame.offset(frame.temp_base + first + 1));
        words_.emit(0x8b0a012bu);
        words_.emit(0x3900217fu);
        words_.emit(0x91002129u);
        words_.emit(0x9e670120u);
        store_d(0, frame.offset(frame.temp_base + first));
        words_.emit(0x9100054au);
        words_.emit(0xcb0a03eau);
        words_.emit(0x9e620140u);
        store_d(0, frame.offset(frame.temp_base + first + 1));
    }

    void emit_format_f64_string(
        const Frame& frame,
        std::uint32_t first,
        const machine_ir::Instruction& instruction
    ) {
        load_d(0, frame.offset(frame.temp_base + first));
        adjust_stack_pointer(16, false);
        words_.emit(0xfd0003e0u);
        words_.emit(0xaa1f03e0u);
        words_.emit(0xaa1f03e1u);
        emit_string_pointer(2, instruction.index);
        call_runtime_slot(11);
        adjust_stack_pointer(16, true);
        words_.emit(0xf100001fu);
        const auto count_valid = words_.emit(0x5400000au);
        emit_abort();
        words_.patch_compare_branch19(count_valid, words_.offset());
        store_x(0, frame.offset(frame.scratch_slot));
        words_.emit(0xb1002400u);
        const auto size_valid = words_.emit(0x54000003u);
        emit_abort();
        words_.patch_compare_branch19(size_valid, words_.offset());
        call_runtime_slot(8);
        const auto allocated = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(allocated, words_.offset());
        load_x(10, frame.offset(frame.scratch_slot));
        words_.emit(0xf900000au);
        store_x(0, frame.offset(frame.scratch_slot));

        load_d(0, frame.offset(frame.temp_base + first));
        adjust_stack_pointer(16, false);
        words_.emit(0xfd0003e0u);
        load_x(0, frame.offset(frame.scratch_slot));
        words_.emit(0xf9400001u);
        words_.emit(0x91000421u);
        words_.emit(0x91002000u);
        emit_string_pointer(2, instruction.index);
        call_runtime_slot(12);
        adjust_stack_pointer(16, true);
        words_.emit(0xf100001fu);
        const auto write_valid = words_.emit(0x5400000au);
        emit_abort();
        words_.patch_compare_branch19(write_valid, words_.offset());
        load_x(9, frame.offset(frame.scratch_slot));
        words_.emit(0xf940012au);
        words_.emit(0x91002129u);
        store_x(9, frame.offset(frame.temp_base + first));
        words_.emit(0x9e670120u);
        store_d(0, frame.offset(frame.temp_base + first));
        words_.emit(0x9100054au);
        words_.emit(0xcb0a03eau);
        words_.emit(0x9e620140u);
        store_d(0, frame.offset(frame.temp_base + first + 1));
    }

    void emit_format_bit_string(
        const Frame& frame,
        std::uint32_t first,
        const machine_ir::Instruction& instruction
    ) {
        load_d(0, frame.offset(frame.temp_base + first));
        emit_truth_w9(0);
        words_.emit(0x7100013fu);
        const auto render_false = words_.emit(0x54000000u);
        emit_string_pointer(9, instruction.error_message_offset);
        store_x(9, frame.offset(frame.temp_base + first));
        emit_number(4.0);
        store_d(0, frame.offset(frame.temp_base + first + 1));
        const auto done = words_.emit(0x14000000u);
        words_.patch_compare_branch19(render_false, words_.offset());
        emit_string_pointer(9, instruction.index);
        store_x(9, frame.offset(frame.temp_base + first));
        emit_number(5.0);
        store_d(0, frame.offset(frame.temp_base + first + 1));
        words_.patch_branch26(done, words_.offset());
    }

    void emit_format_chr_string(const Frame& frame, std::uint32_t first) {
        load_d(0, frame.offset(frame.temp_base + first));
        words_.emit(0x9e78000cu);
        store_x(12, frame.offset(frame.temp_base + first));
        emit_u64(10, 1);
        words_.emit(0xf101fd9fu);
        const auto length_ready_one = words_.emit(0x5400000du);
        emit_u64(10, 2);
        words_.emit(0xf11ffd9fu);
        const auto length_ready_two = words_.emit(0x5400000du);
        emit_u64(10, 3);
        emit_u64(13, 0xffffu);
        words_.emit(0xeb0d019fu);
        const auto length_ready_three = words_.emit(0x5400000du);
        emit_u64(10, 4);
        const auto length_ready = words_.offset();
        words_.patch_compare_branch19(length_ready_one, length_ready);
        words_.patch_compare_branch19(length_ready_two, length_ready);
        words_.patch_compare_branch19(length_ready_three, length_ready);
        store_x(10, frame.offset(frame.scratch_slot));
        words_.emit(0x91002540u);
        call_runtime_slot(8);
        const auto allocated = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(allocated, words_.offset());
        load_x(10, frame.offset(frame.scratch_slot));
        words_.emit(0xf900000au);
        words_.emit(0x9100200eu);
        load_x(12, frame.offset(frame.temp_base + first));

        emit_u64(13, 0x7fu);
        words_.emit(0xeb0d019fu);
        const auto encode_two_or_more = words_.emit(0x5400000cu);
        words_.emit(0x390001ccu);
        const auto encoded_ascii = words_.emit(0x14000000u);
        words_.patch_compare_branch19(encode_two_or_more, words_.offset());

        emit_u64(13, 0x7ffu);
        words_.emit(0xeb0d019fu);
        const auto encode_three_or_more = words_.emit(0x5400000cu);
        words_.emit(0xd346fd8du);
        emit_u64(15, 0xc0u);
        words_.emit(0xaa0f01adu);
        words_.emit(0x390001cdu);
        emit_u64(15, 0x3fu);
        words_.emit(0x8a0f018du);
        emit_u64(15, 0x80u);
        words_.emit(0xaa0f01adu);
        words_.emit(0x390005cdu);
        const auto encoded_two = words_.emit(0x14000000u);
        words_.patch_compare_branch19(encode_three_or_more, words_.offset());

        emit_u64(13, 0xffffu);
        words_.emit(0xeb0d019fu);
        const auto encode_four = words_.emit(0x5400000cu);
        words_.emit(0xd34cfd8du);
        emit_u64(15, 0xe0u);
        words_.emit(0xaa0f01adu);
        words_.emit(0x390001cdu);
        words_.emit(0xd346fd8du);
        emit_u64(15, 0x3fu);
        words_.emit(0x8a0f018du);
        emit_u64(15, 0x80u);
        words_.emit(0xaa0f01adu);
        words_.emit(0x390005cdu);
        emit_u64(15, 0x3fu);
        words_.emit(0x8a0f018du);
        emit_u64(15, 0x80u);
        words_.emit(0xaa0f01adu);
        words_.emit(0x390009cdu);
        const auto encoded_three = words_.emit(0x14000000u);
        words_.patch_compare_branch19(encode_four, words_.offset());

        words_.emit(0xd352fd8du);
        emit_u64(15, 0xf0u);
        words_.emit(0xaa0f01adu);
        words_.emit(0x390001cdu);
        words_.emit(0xd34cfd8du);
        emit_u64(15, 0x3fu);
        words_.emit(0x8a0f018du);
        emit_u64(15, 0x80u);
        words_.emit(0xaa0f01adu);
        words_.emit(0x390005cdu);
        words_.emit(0xd346fd8du);
        emit_u64(15, 0x3fu);
        words_.emit(0x8a0f018du);
        emit_u64(15, 0x80u);
        words_.emit(0xaa0f01adu);
        words_.emit(0x390009cdu);
        emit_u64(15, 0x3fu);
        words_.emit(0x8a0f018du);
        emit_u64(15, 0x80u);
        words_.emit(0xaa0f01adu);
        words_.emit(0x39000dcdu);

        const auto encoded = words_.offset();
        words_.patch_branch26(encoded_ascii, encoded);
        words_.patch_branch26(encoded_two, encoded);
        words_.patch_branch26(encoded_three, encoded);
        load_x(10, frame.offset(frame.scratch_slot));
        words_.emit(0x8b0a01cfu);
        words_.emit(0x390001ffu);
        store_x(14, frame.offset(frame.temp_base + first));
        words_.emit(0x9100054au);
        words_.emit(0xcb0a03eau);
        words_.emit(0x9e620140u);
        store_d(0, frame.offset(frame.temp_base + first + 1));
    }

    void emit_decode_utf8_at(const Frame& frame, std::uint32_t first) {
        load_x(12, frame.offset(frame.temp_base + first));
        load_d(0, frame.offset(frame.temp_base + first + 2));
        words_.emit(0x9e78000du);
        words_.emit(0x8b0d018eu);
        words_.emit(0x394001cfu);
        words_.emit(0xf10201ffu);
        const auto decode_two_or_more = words_.emit(0x5400000au);
        words_.emit(0xaa0f03f0u);
        words_.emit(0x910005adu);
        const auto decoded_ascii = words_.emit(0x14000000u);
        words_.patch_compare_branch19(decode_two_or_more, words_.offset());

        words_.emit(0xf10381ffu);
        const auto decode_three_or_more = words_.emit(0x5400000au);
        emit_u64(16, 0x1fu);
        words_.emit(0x8a1001efu);
        words_.emit(0xd37ae5efu);
        words_.emit(0x394005d0u);
        emit_u64(17, 0x3fu);
        words_.emit(0x8a110210u);
        words_.emit(0xaa1001f0u);
        words_.emit(0x910009adu);
        const auto decoded_two = words_.emit(0x14000000u);
        words_.patch_compare_branch19(decode_three_or_more, words_.offset());

        words_.emit(0xf103c1ffu);
        const auto decode_four = words_.emit(0x5400000au);
        emit_u64(16, 0x0fu);
        words_.emit(0x8a1001efu);
        words_.emit(0xd374cdefu);
        words_.emit(0x394005d0u);
        emit_u64(17, 0x3fu);
        words_.emit(0x8a110210u);
        words_.emit(0xd37ae610u);
        words_.emit(0xaa1001efu);
        words_.emit(0x394009d0u);
        emit_u64(17, 0x3fu);
        words_.emit(0x8a110210u);
        words_.emit(0xaa1001f0u);
        words_.emit(0x91000dadu);
        const auto decoded_three = words_.emit(0x14000000u);
        words_.patch_compare_branch19(decode_four, words_.offset());

        emit_u64(16, 0x07u);
        words_.emit(0x8a1001efu);
        words_.emit(0xd36eb5efu);
        words_.emit(0x394005d0u);
        emit_u64(17, 0x3fu);
        words_.emit(0x8a110210u);
        words_.emit(0xd374ce10u);
        words_.emit(0xaa1001efu);
        words_.emit(0x394009d0u);
        emit_u64(17, 0x3fu);
        words_.emit(0x8a110210u);
        words_.emit(0xd37ae610u);
        words_.emit(0xaa1001efu);
        words_.emit(0x39400dd0u);
        emit_u64(17, 0x3fu);
        words_.emit(0x8a110210u);
        words_.emit(0xaa1001f0u);
        words_.emit(0x910011adu);

        const auto decoded = words_.offset();
        words_.patch_branch26(decoded_ascii, decoded);
        words_.patch_branch26(decoded_two, decoded);
        words_.patch_branch26(decoded_three, decoded);
        words_.emit(0x9e620200u);
        store_d(0, frame.offset(frame.temp_base + first));
        words_.emit(0x9e6201a0u);
        store_d(0, frame.offset(frame.temp_base + first + 1));
    }

    void emit_error_message_registers(std::uint32_t offset, std::uint32_t byte_count) {
        words_.emit(0xf9401e6cu);
        if (offset != 0) {
            emit_u64(13, offset);
            words_.emit(0x8b0d018cu);
        }
        emit_number(static_cast<double>(byte_count), 7);
    }

    void store_error_message_local(const Frame& frame, std::uint32_t local) {
        if (local + 1 >= frame.local_count) throw EncodingFailure("invalid arm64 caught error local");
        store_x(12, frame.offset(local));
        store_d(7, frame.offset(local + 1));
    }

    void store_error_type_local(const Frame& frame, std::uint32_t local) {
        if (local >= frame.local_count) throw EncodingFailure("invalid arm64 caught error type local");
        words_.emit(0x9e620160u);
        store_d(0, frame.offset(local));
    }

    void store_error_type_constant(const Frame& frame, std::uint32_t local, std::uint32_t mask) {
        if (local >= frame.local_count) throw EncodingFailure("invalid arm64 caught error type local");
        emit_number(static_cast<double>(mask));
        store_d(0, frame.offset(local));
    }

    void load_error_payload_local(
        const Frame& frame, std::uint32_t value_local, std::uint32_t type_local
    ) {
        if (value_local + 1 >= frame.local_count || type_local >= frame.local_count) {
            throw EncodingFailure("invalid arm64 caught error payload local");
        }
        load_x(12, frame.offset(value_local));
        load_d(7, frame.offset(value_local + 1));
        load_d(0, frame.offset(type_local));
        words_.emit(0x9e78000bu);
    }

    void emit_truth_w9(unsigned reg) {
        if (reg > 7) throw EncodingFailure("invalid arm64 truth register");
        words_.emit(0x1e602008u | (reg << 5));
        words_.emit(0x1a9f07e9u);
        words_.emit(0x1a9f77eau);
        words_.emit(0x2a0a0129u);
    }

    void emit_w9_as_f64() { words_.emit(0x1e620120u); }

    void emit_comparison(machine_ir::Opcode opcode) {
        words_.emit(0x1e602020u);
        if (opcode == machine_ir::Opcode::OrderedLessF64) {
            words_.emit(0x1a9fa7e9u);
            words_.emit(0x1a9f67eau);
            words_.emit(0x0a0a0129u);
        } else if (opcode == machine_ir::Opcode::OrderedLessEqualF64) {
            words_.emit(0x1a9fc7e9u);
            words_.emit(0x1a9f67eau);
            words_.emit(0x0a0a0129u);
        } else if (opcode == machine_ir::Opcode::OrderedGreaterF64) {
            words_.emit(0x1a9fd7e9u);
        } else if (opcode == machine_ir::Opcode::OrderedGreaterEqualF64) {
            words_.emit(0x1a9fb7e9u);
        } else if (opcode == machine_ir::Opcode::OrderedEqualF64) {
            words_.emit(0x1a9f17e9u);
        } else if (opcode == machine_ir::Opcode::UnorderedNotEqualF64) {
            words_.emit(0x1a9f07e9u);
        } else {
            throw EncodingFailure("unhandled arm64 comparison");
        }
        emit_w9_as_f64();
    }

    void emit_error_cleanup(
        const machine_ir::Function& function,
        const Frame& frame
    ) {
        for (const auto slot : function.owned_string_locals) {
            release_owned_string(frame.offset(slot), frame.offset(slot + 1));
        }
        for (const auto slot : function.owned_f64_list_locals) {
            load_x(0, frame.offset(slot));
            const auto empty = words_.emit(0xb4000000u);
            call_runtime_slot(9);
            words_.patch_compare_branch19(empty, words_.offset());
        }
    }

    void emit_instruction_error(
        const machine_ir::Function& function,
        const Frame& frame,
        const machine_ir::Instruction& instruction,
        std::uint32_t type_mask,
        bool entry,
        std::vector<BranchPatch>& branches
    ) {
        emit_error_message_registers(
            instruction.error_message_offset, instruction.byte_count);
        if (instruction.has_error_handler) {
            store_error_message_local(frame, instruction.error_value_local);
            store_error_type_constant(frame, instruction.error_type_local, type_mask);
            branches.push_back({words_.emit(0x14000000u), instruction.label, false});
            return;
        }
        if (entry) {
            emit_abort();
            return;
        }
        store_x(12, frame.offset(frame.error_pointer_slot));
        store_d(7, frame.offset(frame.error_length_slot));
        emit_error_cleanup(function, frame);
        load_x(12, frame.offset(frame.error_pointer_slot));
        load_d(7, frame.offset(frame.error_length_slot));
        emit_u64(11, type_mask);
        emit_epilogue(frame, false);
    }

    [[gnu::noinline]] void emit_normalize_f64_multiset(
        const Frame& frame,
        std::uint32_t first
    ) {
        load_x(11, frame.offset(frame.temp_base + first));
        const auto pointer_present = words_.emit(0xb500000bu);
        emit_abort();
        words_.patch_compare_branch19(pointer_present, words_.offset());
        words_.emit(0xf940016cu);
        words_.emit(0xf240019fu);
        const auto even_slots = words_.emit(0x54000000u);
        emit_abort();
        words_.patch_compare_branch19(even_slots, words_.offset());
        words_.emit(0xd341fd8cu);
        words_.emit(0x9100416du);
        words_.emit(0x9100416eu);
        words_.emit(0xaa1f03efu);
        const auto empty = words_.emit(0xb400000cu);
        const auto source_loop = words_.offset();
        words_.emit(0xfd4001a0u);
        words_.emit(0xfd4005a1u);
        words_.emit(0x1e602028u);
        std::vector<std::size_t> invalid;
        invalid.push_back(words_.emit(0x54000006u));
        invalid.push_back(words_.emit(0x5400000bu));
        words_.emit(0x9e780030u);
        words_.emit(0x9e620202u);
        words_.emit(0x1e622020u);
        invalid.push_back(words_.emit(0x54000001u));
        words_.emit(0x1e602028u);
        const auto skip_zero = words_.emit(0x54000000u);
        words_.emit(0x91004170u);
        words_.emit(0xaa0f03f1u);
        const auto append_without_search = words_.emit(0xb4000011u);
        const auto search_loop = words_.offset();
        words_.emit(0xfd400202u);
        words_.emit(0x1e622000u);
        const auto unordered_key = words_.emit(0x54000006u);
        const auto found_key = words_.emit(0x54000000u);
        const auto next_search = words_.offset();
        words_.patch_compare_branch19(unordered_key, next_search);
        words_.emit(0x91004210u);
        words_.emit(0xf1000631u);
        const auto repeat_search = words_.emit(0x54000001u);
        words_.patch_compare_branch19(repeat_search, search_loop);
        const auto append = words_.offset();
        words_.patch_compare_branch19(append_without_search, append);
        words_.emit(0xfd0001c0u);
        words_.emit(0xfd0005c1u);
        words_.emit(0x910041ceu);
        words_.emit(0x910005efu);
        const auto appended = words_.emit(0x14000000u);
        const auto found = words_.offset();
        words_.patch_compare_branch19(found_key, found);
        words_.emit(0xfd400602u);
        words_.emit(0x1e612841u);
        words_.emit(0xfd000601u);
        const auto next_source = words_.offset();
        words_.patch_branch26(appended, next_source);
        words_.patch_compare_branch19(skip_zero, next_source);
        words_.emit(0x910041adu);
        words_.emit(0xf100058cu);
        const auto repeat_source = words_.emit(0x54000001u);
        words_.patch_compare_branch19(repeat_source, source_loop);
        const auto complete = words_.offset();
        words_.patch_compare_branch19(empty, complete);
        words_.emit(0x8b0f01f0u);
        words_.emit(0xf9000170u);
        words_.emit(0xf9000570u);
        const auto done = words_.emit(0x14000000u);
        const auto invalid_count = words_.offset();
        for (const auto branch : invalid) words_.patch_compare_branch19(branch, invalid_count);
        emit_abort();
        words_.patch_branch26(done, words_.offset());
    }

    [[gnu::noinline]] void emit_f64_multiset_scalar(
        const Frame& frame,
        std::uint32_t first,
        machine_ir::Opcode opcode,
        bool owns_multiset
    ) {
        using machine_ir::Opcode;
        load_x(11, frame.offset(frame.temp_base + first));
        const auto pointer_present = words_.emit(0xb500000bu);
        emit_abort();
        words_.patch_compare_branch19(pointer_present, words_.offset());
        load_d(2, frame.offset(frame.temp_base + first + 1));
        words_.emit(0x9e780049u);
        words_.emit(0x9e620123u);
        words_.emit(0x1e632040u);
        const auto integral = words_.emit(0x54000000u);
        emit_abort();
        words_.patch_compare_branch19(integral, words_.offset());
        if (opcode == Opcode::FloorDivideF64MultisetScalar) {
            words_.emit(0x1e602048u);
            const auto nonzero = words_.emit(0x54000001u);
            emit_abort();
            words_.patch_compare_branch19(nonzero, words_.offset());
        }
        words_.emit(0xf940016cu);
        words_.emit(0xd37df180u);
        words_.emit(0x91004000u);
        call_runtime_slot(8);
        const auto allocated = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(allocated, words_.offset());
        store_x(0, frame.offset(frame.scratch_slot));
        load_x(11, frame.offset(frame.temp_base + first));
        load_x(14, frame.offset(frame.scratch_slot));
        words_.emit(0x910041ceu);
        words_.emit(0xaa1f03efu);
        words_.emit(0xf940016cu);
        words_.emit(0xd341fd8cu);
        words_.emit(0x9100416du);
        const auto empty = words_.emit(0xb400000cu);
        const auto loop = words_.offset();
        words_.emit(0xfd4001a0u);
        words_.emit(0xfd4005a1u);
        load_d(2, frame.offset(frame.temp_base + first + 1));
        words_.emit(opcode == Opcode::AddF64MultisetScalar ? 0x1e622821u
            : opcode == Opcode::SubtractF64MultisetScalar ? 0x1e623821u
            : 0x1e621821u);
        if (opcode == Opcode::FloorDivideF64MultisetScalar) {
            words_.emit(0x1e654021u);
        }
        words_.emit(0x1e602028u);
        const auto skip_nonpositive = words_.emit(0x5400000du);
        words_.emit(0xfd0001c0u);
        words_.emit(0xfd0005c1u);
        words_.emit(0x910041ceu);
        words_.emit(0x910005efu);
        const auto next = words_.offset();
        words_.patch_compare_branch19(skip_nonpositive, next);
        words_.emit(0x910041adu);
        words_.emit(0xf100058cu);
        const auto repeat = words_.emit(0x54000001u);
        words_.patch_compare_branch19(repeat, loop);
        words_.patch_compare_branch19(empty, words_.offset());
        load_x(14, frame.offset(frame.scratch_slot));
        words_.emit(0x8b0f01f0u);
        words_.emit(0xf90001d0u);
        words_.emit(0xf90005d0u);
        if (owns_multiset) {
            load_x(0, frame.offset(frame.temp_base + first));
            call_runtime_slot(9);
        }
        load_x(11, frame.offset(frame.scratch_slot));
        store_x(11, frame.offset(frame.temp_base + first));
    }

    [[gnu::noinline]] void emit_binary_f64_multiset(
        const Frame& frame,
        std::uint32_t first,
        machine_ir::Opcode opcode,
        bool owns_left,
        bool owns_right
    ) {
        using machine_ir::Opcode;
        const bool unite = opcode == Opcode::UnionF64Multisets;
        load_x(11, frame.offset(frame.temp_base + first));
        const auto left_present = words_.emit(0xb500000bu);
        emit_abort();
        words_.patch_compare_branch19(left_present, words_.offset());
        load_x(12, frame.offset(frame.temp_base + first + 1));
        const auto right_present = words_.emit(0xb500000cu);
        emit_abort();
        words_.patch_compare_branch19(right_present, words_.offset());
        words_.emit(0xf940016du);
        if (unite) {
            words_.emit(0xf940018eu);
            words_.emit(0xab0e01afu);
            const auto size_sum_valid = words_.emit(0x54000003u);
            emit_abort();
            words_.patch_compare_branch19(size_sum_valid, words_.offset());
        } else {
            words_.emit(0xaa0d03efu);
        }
        words_.emit(0xd37df1e0u);
        words_.emit(0x91004000u);
        call_runtime_slot(8);
        const auto allocated = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(allocated, words_.offset());
        store_x(0, frame.offset(frame.scratch_slot));

        load_x(11, frame.offset(frame.temp_base + first));
        load_x(12, frame.offset(frame.temp_base + first + 1));
        load_x(14, frame.offset(frame.scratch_slot));
        words_.emit(0x910041cfu);
        words_.emit(0xaa1f03eau);
        words_.emit(0xf940016du);
        words_.emit(0xd341fdadu);
        words_.emit(0x9100416bu);
        const auto left_empty = words_.emit(0xb400000du);
        const auto left_loop = words_.offset();
        words_.emit(0xfd400160u);
        words_.emit(0xfd400561u);

        std::size_t missing_right = 0;
        std::size_t missing_after_search = 0;
        std::size_t computed = 0;
        if (!unite) {
            words_.emit(0xf9400190u);
            words_.emit(0xd341fe10u);
            words_.emit(0x91004191u);
            missing_right = words_.emit(0xb4000010u);
            const auto search_loop = words_.offset();
            words_.emit(0xfd400222u);
            words_.emit(0x1e622000u);
            const auto unordered_key = words_.emit(0x54000006u);
            const auto found_right = words_.emit(0x54000000u);
            const auto next_search = words_.offset();
            words_.patch_compare_branch19(unordered_key, next_search);
            words_.emit(0x91004231u);
            words_.emit(0xf1000610u);
            const auto repeat_search = words_.emit(0x54000001u);
            words_.patch_compare_branch19(repeat_search, search_loop);
            missing_after_search = words_.emit(0x14000000u);
            const auto found = words_.offset();
            words_.patch_compare_branch19(found_right, found);
            words_.emit(0xfd400622u);
            if (opcode == Opcode::DifferenceF64Multisets) {
                words_.emit(0x1e623821u);
            } else if (opcode == Opcode::FloorDivideF64Multisets) {
                words_.emit(0x1e621821u);
                words_.emit(0x1e654021u);
            } else {
                words_.emit(0x1e604023u);
                words_.emit(0x1e621821u);
                words_.emit(0x1e654021u);
                words_.emit(0x1e620821u);
                words_.emit(0x1e613861u);
            }
            computed = words_.emit(0x14000000u);
            const auto missing = words_.offset();
            words_.patch_compare_branch19(missing_right, missing);
            words_.patch_branch26(missing_after_search, missing);
            if (opcode != Opcode::DifferenceF64Multisets) {
                const auto skip_missing = words_.emit(0x14000000u);
                const auto append_check = words_.offset();
                words_.patch_branch26(computed, append_check);
                words_.emit(0x1e602028u);
                const auto skip_nonpositive = words_.emit(0x5400000du);
                words_.emit(0xfd0001e0u);
                words_.emit(0xfd0005e1u);
                words_.emit(0x910041efu);
                words_.emit(0x9100054au);
                const auto next_left = words_.offset();
                words_.patch_branch26(skip_missing, next_left);
                words_.patch_compare_branch19(skip_nonpositive, next_left);
            } else {
                const auto append_check = words_.offset();
                words_.patch_branch26(computed, append_check);
                words_.emit(0x1e602028u);
                const auto skip_nonpositive = words_.emit(0x5400000du);
                words_.emit(0xfd0001e0u);
                words_.emit(0xfd0005e1u);
                words_.emit(0x910041efu);
                words_.emit(0x9100054au);
                words_.patch_compare_branch19(skip_nonpositive, words_.offset());
            }
        } else {
            words_.emit(0xfd0001e0u);
            words_.emit(0xfd0005e1u);
            words_.emit(0x910041efu);
            words_.emit(0x9100054au);
        }
        words_.emit(0x9100416bu);
        words_.emit(0xf10005adu);
        const auto repeat_left = words_.emit(0x54000001u);
        words_.patch_compare_branch19(repeat_left, left_loop);
        words_.patch_compare_branch19(left_empty, words_.offset());

        if (unite) {
            words_.emit(0xf940018du);
            words_.emit(0xd341fdadu);
            words_.emit(0x9100418cu);
            const auto right_empty = words_.emit(0xb400000du);
            const auto right_loop = words_.offset();
            words_.emit(0xfd400180u);
            words_.emit(0xfd400581u);
            load_x(14, frame.offset(frame.scratch_slot));
            words_.emit(0x910041d1u);
            words_.emit(0xaa0a03f0u);
            const auto append_new = words_.emit(0xb4000010u);
            const auto search_output = words_.offset();
            words_.emit(0xfd400222u);
            words_.emit(0x1e622000u);
            const auto unordered_key = words_.emit(0x54000006u);
            const auto found_key = words_.emit(0x54000000u);
            const auto next_search = words_.offset();
            words_.patch_compare_branch19(unordered_key, next_search);
            words_.emit(0x91004231u);
            words_.emit(0xf1000610u);
            const auto repeat_search = words_.emit(0x54000001u);
            words_.patch_compare_branch19(repeat_search, search_output);
            const auto append = words_.offset();
            words_.patch_compare_branch19(append_new, append);
            words_.emit(0xfd0001e0u);
            words_.emit(0xfd0005e1u);
            words_.emit(0x910041efu);
            words_.emit(0x9100054au);
            const auto appended = words_.emit(0x14000000u);
            const auto found = words_.offset();
            words_.patch_compare_branch19(found_key, found);
            words_.emit(0xfd400622u);
            words_.emit(0x1e622821u);
            words_.emit(0xfd000621u);
            const auto next_right = words_.offset();
            words_.patch_branch26(appended, next_right);
            words_.emit(0x9100418cu);
            words_.emit(0xf10005adu);
            const auto repeat_right = words_.emit(0x54000001u);
            words_.patch_compare_branch19(repeat_right, right_loop);
            words_.patch_compare_branch19(right_empty, words_.offset());
        }

        load_x(14, frame.offset(frame.scratch_slot));
        words_.emit(0x8b0a0150u);
        words_.emit(0xf90001d0u);
        words_.emit(0xf90005d0u);
        if (owns_left) {
            load_x(0, frame.offset(frame.temp_base + first));
            call_runtime_slot(9);
        }
        if (owns_right) {
            load_x(0, frame.offset(frame.temp_base + first + 1));
            call_runtime_slot(9);
        }
        load_x(11, frame.offset(frame.scratch_slot));
        store_x(11, frame.offset(frame.temp_base + first));
    }

    void emit_string_comparison(
        machine_ir::Opcode opcode,
        const Frame& frame,
        std::uint32_t first,
        bool owns_left,
        bool owns_right
    ) {
        using machine_ir::Opcode;
        const std::uint32_t condition = opcode == Opcode::StringLess ? 0x1a9f27e9u
            : opcode == Opcode::StringLessEqual ? 0x1a9f87e9u
            : opcode == Opcode::StringGreater ? 0x1a9f97e9u
            : opcode == Opcode::StringGreaterEqual ? 0x1a9f37e9u
            : opcode == Opcode::StringEqual ? 0x1a9f17e9u
            : opcode == Opcode::StringNotEqual ? 0x1a9f07e9u
            : 0;
        if (condition == 0) throw EncodingFailure("unhandled arm64 string comparison");

        load_d(0, frame.offset(frame.temp_base + first + 1));
        words_.emit(0x9e78000cu);
        words_.emit(0xf100019fu);
        const auto left_decoded = words_.emit(0x5400000au);
        words_.emit(0xcb0c03ecu);
        words_.emit(0xd100058cu);
        words_.patch_compare_branch19(left_decoded, words_.offset());
        load_d(0, frame.offset(frame.temp_base + first + 3));
        words_.emit(0x9e78000du);
        words_.emit(0xf10001bfu);
        const auto right_decoded = words_.emit(0x5400000au);
        words_.emit(0xcb0d03edu);
        words_.emit(0xd10005adu);
        words_.patch_compare_branch19(right_decoded, words_.offset());
        load_x(11, frame.offset(frame.temp_base + first));
        load_x(10, frame.offset(frame.temp_base + first + 2));

        const auto loop = words_.offset();
        const auto left_empty = words_.emit(0xb400000cu);
        const auto right_empty = words_.emit(0xb400000du);
        words_.emit(0x39400169u);
        words_.emit(0x3940014eu);
        words_.emit(0x6b0e013fu);
        const auto different = words_.emit(0x54000001u);
        words_.emit(0x9100056bu);
        words_.emit(0x9100054au);
        words_.emit(0xf100058cu);
        words_.emit(0xf10005adu);
        const auto repeat = words_.emit(0x14000000u);
        words_.patch_branch26(repeat, loop);

        const auto compare_lengths = words_.offset();
        words_.patch_compare_branch19(left_empty, compare_lengths);
        words_.patch_compare_branch19(right_empty, compare_lengths);
        words_.emit(0xeb0d019fu);
        const auto decision = words_.offset();
        words_.patch_compare_branch19(different, decision);
        words_.emit(condition);
        emit_w9_as_f64();
        store_d(0, frame.offset(frame.scratch_slot));

        if (owns_left) {
            release_owned_string(
                frame.offset(frame.temp_base + first),
                frame.offset(frame.temp_base + first + 1));
        }
        if (owns_right) {
            release_owned_string(
                frame.offset(frame.temp_base + first + 2),
                frame.offset(frame.temp_base + first + 3));
        }
        load_d(0, frame.offset(frame.scratch_slot));
        store_d(0, frame.offset(frame.temp_base + first));
    }

    void emit_read_line_string(const Frame& frame, std::uint32_t first) {
        constexpr std::uint64_t initial_capacity = 256u;
        emit_u64(9, initial_capacity);
        store_x(9, frame.offset(frame.scratch_slot + 1));
        store_x(31, frame.offset(frame.scratch_slot + 2));
        emit_u64(0, initial_capacity + 9u);
        call_runtime_slot(8);
        const auto allocated = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(allocated, words_.offset());
        store_x(0, frame.offset(frame.scratch_slot));

        const auto read_loop = words_.offset();
        load_x(1, frame.offset(frame.scratch_slot));
        words_.emit(0x91002021u);
        load_x(9, frame.offset(frame.scratch_slot + 2));
        words_.emit(0x8b090021u);
        words_.emit(0xaa1f03e0u);
        emit_u64(2, 1u);
        call_runtime_slot(21);
        words_.emit(0xf100001fu);
        const auto eof = words_.emit(0x54000000u);
        const auto read_ok = words_.emit(0x5400000au);
        emit_abort();
        words_.patch_compare_branch19(read_ok, words_.offset());

        load_x(10, frame.offset(frame.scratch_slot));
        words_.emit(0x9100214au);
        load_x(11, frame.offset(frame.scratch_slot + 2));
        words_.emit(0x386b6949u);
        words_.emit(0x7100293fu);
        const auto newline = words_.emit(0x54000000u);
        words_.emit(0x9100056bu);
        store_x(11, frame.offset(frame.scratch_slot + 2));
        load_x(10, frame.offset(frame.scratch_slot + 1));
        words_.emit(0xeb0a017fu);
        const auto continue_reading = words_.emit(0x54000001u);

        words_.emit(0x8b0a0149u);
        store_x(9, frame.offset(frame.scratch_slot + 1));
        words_.emit(0x91002520u);
        call_runtime_slot(8);
        const auto grown = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(grown, words_.offset());
        store_x(0, frame.offset(frame.scratch_slot + 3));
        words_.emit(0x91002000u);
        load_x(1, frame.offset(frame.scratch_slot));
        words_.emit(0x91002021u);
        load_x(2, frame.offset(frame.scratch_slot + 2));
        call_runtime_slot(28);
        load_x(0, frame.offset(frame.scratch_slot));
        call_runtime_slot(9);
        load_x(9, frame.offset(frame.scratch_slot + 3));
        store_x(9, frame.offset(frame.scratch_slot));
        const auto repeat_after_grow = words_.emit(0x14000000u);

        const auto repeat = words_.offset();
        words_.patch_compare_branch19(continue_reading, repeat);
        const auto repeat_without_grow = words_.emit(0x14000000u);
        words_.patch_branch26(repeat_after_grow, read_loop);
        words_.patch_branch26(repeat_without_grow, read_loop);

        const auto complete = words_.offset();
        words_.patch_compare_branch19(eof, complete);
        words_.patch_compare_branch19(newline, complete);
        load_x(10, frame.offset(frame.scratch_slot + 2));
        const auto no_carriage_return = words_.emit(0xb400000au);
        load_x(9, frame.offset(frame.scratch_slot));
        words_.emit(0x8b0a012bu);
        words_.emit(0x39401d69u);
        words_.emit(0x7100353fu);
        const auto keep_length = words_.emit(0x54000001u);
        words_.emit(0xd100054au);
        store_x(10, frame.offset(frame.scratch_slot + 2));
        const auto finalized_length = words_.offset();
        words_.patch_compare_branch19(no_carriage_return, finalized_length);
        words_.patch_compare_branch19(keep_length, finalized_length);
        load_x(9, frame.offset(frame.scratch_slot));
        load_x(10, frame.offset(frame.scratch_slot + 2));
        words_.emit(0xf900012au);
        words_.emit(0x8b0a012bu);
        words_.emit(0x3900217fu);
        words_.emit(0x91002129u);
        store_x(9, frame.offset(frame.temp_base + first));
        words_.emit(0x9100054au);
        words_.emit(0xcb0a03eau);
        words_.emit(0x9e620140u);
        store_d(0, frame.offset(frame.temp_base + first + 1));
    }

    void emit_read_file_string(
        const machine_ir::Function& function,
        const Frame& frame,
        std::uint32_t first,
        const machine_ir::Instruction& instruction,
        bool entry,
        std::vector<BranchPatch>& branches
    ) {
        const bool owns_path = instruction.owns_input;
        load_x(0, frame.offset(frame.temp_base + first));
        emit_u64(1, 0);
        emit_u64(2, 0);
        call_runtime_slot(20);
        words_.emit(0x93407c00u);
        words_.emit(0xf100001fu);
        const auto opened = words_.emit(0x5400000au);
        if (owns_path) {
            release_owned_string(
                frame.offset(frame.temp_base + first),
                frame.offset(frame.temp_base + first + 1));
        }
        emit_instruction_error(
            function, frame, instruction,
            machine_ir::file_not_found_error_mask, entry, branches);
        words_.patch_compare_branch19(opened, words_.offset());
        store_x(0, frame.offset(frame.scratch_slot));
        if (owns_path) {
            load_x(0, frame.offset(frame.temp_base + first));
            words_.emit(0xd1002000u);
            call_runtime_slot(9);
        }
        load_x(0, frame.offset(frame.scratch_slot));
        store_x(0, frame.offset(frame.temp_base + first));

        // lseek(fd, 0, SEEK_END)
        emit_u64(1, 0);
        emit_u64(2, 2);
        call_runtime_slot(23);
        words_.emit(0xf100001fu);
        const auto sized = words_.emit(0x5400000au);
        load_x(0, frame.offset(frame.temp_base + first));
        call_runtime_slot(22);
        emit_instruction_error(
            function, frame, instruction,
            machine_ir::runtime_error_mask, entry, branches);
        words_.patch_compare_branch19(sized, words_.offset());
        store_x(0, frame.offset(frame.temp_base + first + 1));

        // lseek(fd, 0, SEEK_SET)
        load_x(0, frame.offset(frame.temp_base + first));
        emit_u64(1, 0);
        emit_u64(2, 0);
        call_runtime_slot(23);
        words_.emit(0xf100001fu);
        const auto rewound = words_.emit(0x5400000au);
        load_x(0, frame.offset(frame.temp_base + first));
        call_runtime_slot(22);
        emit_instruction_error(
            function, frame, instruction,
            machine_ir::runtime_error_mask, entry, branches);
        words_.patch_compare_branch19(rewound, words_.offset());

        load_x(0, frame.offset(frame.temp_base + first + 1));
        words_.emit(0xb1002400u);
        const auto allocation_size_valid = words_.emit(0x54000003u);
        emit_abort();
        words_.patch_compare_branch19(allocation_size_valid, words_.offset());
        call_runtime_slot(8);
        const auto allocated = words_.emit(0xb5000000u);
        emit_abort();
        words_.patch_compare_branch19(allocated, words_.offset());
        store_x(0, frame.offset(frame.scratch_slot));
        load_x(10, frame.offset(frame.temp_base + first + 1));
        words_.emit(0xf900000au);
        words_.emit(0x91002001u);
        words_.emit(0x8b0a002bu);
        words_.emit(0x3900017fu);

        // read(fd, allocation + 8, size)
        load_x(0, frame.offset(frame.temp_base + first));
        load_x(2, frame.offset(frame.temp_base + first + 1));
        call_runtime_slot(21);
        words_.emit(0xf100001fu);
        const auto read_ok = words_.emit(0x5400000au);
        load_x(0, frame.offset(frame.temp_base + first));
        call_runtime_slot(22);
        load_x(0, frame.offset(frame.scratch_slot));
        call_runtime_slot(9);
        emit_instruction_error(
            function, frame, instruction,
            machine_ir::runtime_error_mask, entry, branches);
        words_.patch_compare_branch19(read_ok, words_.offset());
        words_.emit(0xaa0003eau);
        load_x(9, frame.offset(frame.scratch_slot));
        words_.emit(0xf900012au);
        words_.emit(0x91002121u);
        words_.emit(0x8b0a002bu);
        words_.emit(0x3900017fu);

        load_x(0, frame.offset(frame.temp_base + first));
        call_runtime_slot(22);

        load_x(9, frame.offset(frame.scratch_slot));
        words_.emit(0xf940012au);
        words_.emit(0x91002129u);
        store_x(9, frame.offset(frame.temp_base + first));
        words_.emit(0x9100054au);
        words_.emit(0xcb0a03eau);
        words_.emit(0x9e620140u);
        store_d(0, frame.offset(frame.temp_base + first + 1));
    }

    void emit_write_file_string(
        const machine_ir::Function& function,
        const Frame& frame,
        std::uint32_t first,
        const machine_ir::Instruction& instruction,
        bool entry,
        std::vector<BranchPatch>& branches
    ) {
        const bool owns_path = instruction.owns_left;
        const bool owns_data = instruction.owns_right;
        const bool append = instruction.index != 0;
        load_x(0, frame.offset(frame.temp_base + first));
        // Darwin's open() returns a 32-bit int. Sign-extend it before testing
        // errors. Append currently targets the single-process release contract:
        // open without truncation, then seek to the current end before writing.
        emit_u64(1, append ? 0x201u : 0x601u);
        emit_u64(2, 0600u);
        call_runtime_slot(20);
        words_.emit(0x93407c00u);
        words_.emit(0xf100001fu);
        const auto opened = words_.emit(0x5400000au);
        if (owns_path) {
            release_owned_string(
                frame.offset(frame.temp_base + first),
                frame.offset(frame.temp_base + first + 1));
        }
        if (owns_data) {
            release_owned_string(
                frame.offset(frame.temp_base + first + 2),
                frame.offset(frame.temp_base + first + 3));
        }
        if (append && entry) {
            emit_u64(0, 81);
            call_runtime_slot(14);
        }
        emit_instruction_error(
            function, frame, instruction,
            machine_ir::runtime_error_mask, entry, branches);
        words_.patch_compare_branch19(opened, words_.offset());
        store_x(0, frame.offset(frame.scratch_slot));
        if (owns_path) {
            load_x(0, frame.offset(frame.temp_base + first));
            words_.emit(0xd1002000u);
            call_runtime_slot(9);
        }

        if (append) {
            load_x(0, frame.offset(frame.scratch_slot));
            emit_u64(1, 0);
            emit_u64(2, 2);
            call_runtime_slot(23);
            words_.emit(0xf100001fu);
            const auto positioned = words_.emit(0x5400000au);
            load_x(0, frame.offset(frame.scratch_slot));
            call_runtime_slot(22);
            if (owns_data) {
                release_owned_string(
                    frame.offset(frame.temp_base + first + 2),
                    frame.offset(frame.temp_base + first + 3));
            }
            if (entry) {
                emit_u64(0, 82);
                call_runtime_slot(14);
            }
            emit_instruction_error(
                function, frame, instruction,
                machine_ir::runtime_error_mask, entry, branches);
            words_.patch_compare_branch19(positioned, words_.offset());
        }

        load_x(1, frame.offset(frame.temp_base + first + 2));
        load_d(0, frame.offset(frame.temp_base + first + 3));
        words_.emit(0x9e780002u);
        words_.emit(0xf100005fu);
        const auto decoded = words_.emit(0x5400000au);
        words_.emit(0xcb0203e2u);
        words_.emit(0xd1000442u);
        words_.patch_compare_branch19(decoded, words_.offset());
        load_x(0, frame.offset(frame.scratch_slot));
        call_runtime_slot(13);
        words_.emit(0xf100001fu);
        const auto wrote = words_.emit(0x5400000au);
        load_x(0, frame.offset(frame.scratch_slot));
        call_runtime_slot(22);
        if (owns_data) {
            release_owned_string(
                frame.offset(frame.temp_base + first + 2),
                frame.offset(frame.temp_base + first + 3));
        }
        if (append && entry) {
            emit_u64(0, 83);
            call_runtime_slot(14);
        }
        emit_instruction_error(
            function, frame, instruction,
            machine_ir::runtime_error_mask, entry, branches);
        words_.patch_compare_branch19(wrote, words_.offset());

        load_x(0, frame.offset(frame.scratch_slot));
        call_runtime_slot(22);
        if (owns_data) {
            load_x(0, frame.offset(frame.temp_base + first + 2));
            words_.emit(0xd1002000u);
            call_runtime_slot(9);
        }
        emit_number(machine_ir::null_value());
        store_d(0, frame.offset(frame.temp_base + first));
    }

    void emit_function(const machine_ir::Function& function, bool entry) {
        const Frame frame = make_frame(function, entry);
        emit_prologue(frame, entry);
        if (function.parameter_mask_local) {
            store_x(11, frame.offset(*function.parameter_mask_local));
        }
        for (const auto slot : function.owned_f64_list_locals) {
            if (slot >= frame.local_count) throw EncodingFailure("invalid owned arm64 list local");
            store_x(31, frame.offset(slot));
        }
        for (const auto slot : function.owned_string_locals) {
            if (slot + 1 >= frame.local_count) throw EncodingFailure("invalid owned arm64 string local");
            store_x(31, frame.offset(slot));
            store_x(31, frame.offset(slot + 1));
        }
        for (std::size_t index = 0; index < function.parameters.size(); ++index) {
            if (entry) store_d(static_cast<unsigned>(index), frame.offset(static_cast<std::uint32_t>(index)));
            else {
                load_argument_from_x9(static_cast<std::uint32_t>(index));
                store_d(0, frame.offset(static_cast<std::uint32_t>(index)));
            }
        }

        std::uint32_t stack_depth = 0;
        std::map<std::uint32_t, std::uint32_t> labels;
        std::vector<BranchPatch> branches;
        for (const auto& instruction : function.instructions) {
            using machine_ir::Opcode;
            const auto opcode = instruction.opcode;
            if (opcode == Opcode::PushF64) {
                emit_number(instruction.f64);
                store_d(0, frame.offset(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::PushNull) {
                emit_number(machine_ir::null_value());
                store_d(0, frame.offset(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::PushString) {
                emit_string_address(instruction.index);
                store_d(0, frame.offset(frame.temp_base + stack_depth));
                emit_number(static_cast<double>(instruction.byte_count));
                store_d(0, frame.offset(frame.temp_base + stack_depth + 1));
                stack_depth += 2;
            } else if (opcode == Opcode::FormatF64String) {
                require_stack(stack_depth, 1);
                const auto first = stack_depth - 1;
                emit_format_f64_string(frame, first, instruction);
                stack_depth = first + 2;
            } else if (opcode == Opcode::FormatBitString) {
                require_stack(stack_depth, 1);
                const auto first = stack_depth - 1;
                emit_format_bit_string(frame, first, instruction);
                stack_depth = first + 2;
            } else if (opcode == Opcode::FormatChrString) {
                require_stack(stack_depth, 1);
                const auto first = stack_depth - 1;
                emit_format_chr_string(frame, first);
                stack_depth = first + 2;
            } else if (opcode == Opcode::DecodeUtf8At) {
                require_stack(stack_depth, 3);
                const auto first = stack_depth - 3;
                emit_decode_utf8_at(frame, first);
                stack_depth = first + 2;
            } else if (opcode == Opcode::CloneString) {
                require_stack(stack_depth, 2);
                const auto first = stack_depth - 2;
                load_d(0, frame.offset(frame.temp_base + first + 1));
                words_.emit(0x9e78000cu);
                words_.emit(0xf100019fu);
                const auto decoded = words_.emit(0x5400000au);
                words_.emit(0xcb0c03ecu);
                words_.emit(0xd100058cu);
                words_.patch_compare_branch19(decoded, words_.offset());
                words_.emit(0xb1002580u);
                const auto size_valid = words_.emit(0x54000003u);
                emit_abort();
                words_.patch_compare_branch19(size_valid, words_.offset());
                call_runtime_slot(8);
                const auto allocated = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(allocated, words_.offset());
                words_.emit(0xaa0003edu);
                load_d(0, frame.offset(frame.temp_base + first + 1));
                words_.emit(0x9e78000cu);
                words_.emit(0xf100019fu);
                const auto length_decoded = words_.emit(0x5400000au);
                words_.emit(0xcb0c03ecu);
                words_.emit(0xd100058cu);
                words_.patch_compare_branch19(length_decoded, words_.offset());
                words_.emit(0xf90001acu);
                words_.emit(0x910021aeu);
                load_x(11, frame.offset(frame.temp_base + first));
                words_.emit(0xaa0c03efu);
                const auto empty = words_.emit(0xb400000cu);
                const auto copy = words_.offset();
                words_.emit(0x3940016au);
                words_.emit(0x390001cau);
                words_.emit(0x9100056bu);
                words_.emit(0x910005ceu);
                words_.emit(0xf100058cu);
                const auto repeat = words_.emit(0x54000001u);
                words_.patch_compare_branch19(repeat, copy);
                words_.patch_compare_branch19(empty, words_.offset());
                words_.emit(0x390001dfu);
                words_.emit(0x910021a0u);
                store_x(0, frame.offset(frame.temp_base + first));
                words_.emit(0x910005e9u);
                words_.emit(0xcb0903e9u);
                words_.emit(0x9e620120u);
                store_d(0, frame.offset(frame.temp_base + first + 1));
            } else if (opcode == Opcode::ConcatStrings) {
                require_stack(stack_depth, 4);
                const auto first = stack_depth - 4;
                load_d(0, frame.offset(frame.temp_base + first + 1));
                words_.emit(0x9e78000cu);
                words_.emit(0xf100019fu);
                const auto left_decoded = words_.emit(0x5400000au);
                words_.emit(0xcb0c03ecu);
                words_.emit(0xd100058cu);
                words_.patch_compare_branch19(left_decoded, words_.offset());
                load_d(0, frame.offset(frame.temp_base + first + 3));
                words_.emit(0x9e78000du);
                words_.emit(0xf10001bfu);
                const auto right_decoded = words_.emit(0x5400000au);
                words_.emit(0xcb0d03edu);
                words_.emit(0xd10005adu);
                words_.patch_compare_branch19(right_decoded, words_.offset());
                words_.emit(0xab0d018eu);
                const auto length_valid = words_.emit(0x54000003u);
                emit_abort();
                words_.patch_compare_branch19(length_valid, words_.offset());
                words_.emit(0xb10025c0u);
                const auto size_valid = words_.emit(0x54000003u);
                emit_abort();
                words_.patch_compare_branch19(size_valid, words_.offset());
                call_runtime_slot(8);
                const auto allocated = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(allocated, words_.offset());
                words_.emit(0xaa0003efu);
                load_d(0, frame.offset(frame.temp_base + first + 1));
                words_.emit(0x9e78000cu);
                words_.emit(0xf100019fu);
                const auto left_length_decoded = words_.emit(0x5400000au);
                words_.emit(0xcb0c03ecu);
                words_.emit(0xd100058cu);
                words_.patch_compare_branch19(left_length_decoded, words_.offset());
                load_d(0, frame.offset(frame.temp_base + first + 3));
                words_.emit(0x9e78000du);
                words_.emit(0xf10001bfu);
                const auto right_length_decoded = words_.emit(0x5400000au);
                words_.emit(0xcb0d03edu);
                words_.emit(0xd10005adu);
                words_.patch_compare_branch19(right_length_decoded, words_.offset());
                words_.emit(0x8b0d018eu);
                words_.emit(0xf90001eeu);
                words_.emit(0x910021f0u);
                load_x(11, frame.offset(frame.temp_base + first));
                load_x(10, frame.offset(frame.temp_base + first + 2));
                const auto left_empty = words_.emit(0xb400000cu);
                const auto copy_left = words_.offset();
                words_.emit(0x39400169u);
                words_.emit(0x39000209u);
                words_.emit(0x9100056bu);
                words_.emit(0x91000610u);
                words_.emit(0xf100058cu);
                const auto repeat_left = words_.emit(0x54000001u);
                words_.patch_compare_branch19(repeat_left, copy_left);
                words_.patch_compare_branch19(left_empty, words_.offset());
                const auto right_empty = words_.emit(0xb400000du);
                const auto copy_right = words_.offset();
                words_.emit(0x39400149u);
                words_.emit(0x39000209u);
                words_.emit(0x9100054au);
                words_.emit(0x91000610u);
                words_.emit(0xf10005adu);
                const auto repeat_right = words_.emit(0x54000001u);
                words_.patch_compare_branch19(repeat_right, copy_right);
                words_.patch_compare_branch19(right_empty, words_.offset());
                words_.emit(0x3900021fu);
                load_x(17, frame.offset(frame.temp_base + first));
                words_.emit(0x910021e0u);
                store_x(0, frame.offset(frame.temp_base + first));
                if (instruction.owns_left) {
                    load_d(0, frame.offset(frame.temp_base + first + 1));
                    words_.emit(0x9e780009u);
                    words_.emit(0xf100013fu);
                    const auto borrowed = words_.emit(0x5400000au);
                    words_.emit(0xd1002220u);
                    call_runtime_slot(9);
                    words_.patch_compare_branch19(borrowed, words_.offset());
                }
                if (instruction.owns_right) {
                    release_owned_string(
                        frame.offset(frame.temp_base + first + 2),
                        frame.offset(frame.temp_base + first + 3));
                }
                load_x(0, frame.offset(frame.temp_base + first));
                words_.emit(0xd100200au);
                words_.emit(0xf9400149u);
                words_.emit(0x91000529u);
                words_.emit(0xcb0903e9u);
                words_.emit(0x9e620120u);
                store_d(0, frame.offset(frame.temp_base + first + 1));
                stack_depth = first + 2;
            } else if (opcode == Opcode::WriteString) {
                require_stack(stack_depth, 2);
                const auto first = stack_depth - 2;
                load_x(1, frame.offset(frame.temp_base + first));
                load_d(0, frame.offset(frame.temp_base + first + 1));
                words_.emit(0x9e780002u);
                words_.emit(0xf100005fu);
                const auto decoded = words_.emit(0x5400000au);
                words_.emit(0xcb0203e2u);
                words_.emit(0xd1000442u);
                words_.patch_compare_branch19(decoded, words_.offset());
                emit_u64(0, instruction.index);
                call_runtime_slot(13);
                if (instruction.owns_input) {
                    load_x(0, frame.offset(frame.temp_base + first));
                    words_.emit(0xd1002000u);
                    call_runtime_slot(9);
                }
                stack_depth = first;
            } else if (opcode == Opcode::ReadLineString) {
                const std::uint32_t first = stack_depth;
                emit_read_line_string(frame, first);
                stack_depth = first + 2;
            } else if (opcode == Opcode::ReadFileString) {
                require_stack(stack_depth, 2);
                const auto first = stack_depth - 2;
                emit_read_file_string(
                    function, frame, first, instruction, entry, branches);
                stack_depth = first + 2;
            } else if (opcode == Opcode::WriteFileString) {
                require_stack(stack_depth, 4);
                const auto first = stack_depth - 4;
                emit_write_file_string(
                    function, frame, first, instruction, entry, branches);
                stack_depth = first + 1;
            } else if (opcode == Opcode::StringEqual || opcode == Opcode::StringNotEqual ||
                       opcode == Opcode::StringLess || opcode == Opcode::StringLessEqual ||
                       opcode == Opcode::StringGreater || opcode == Opcode::StringGreaterEqual) {
                require_stack(stack_depth, 4);
                const auto first = stack_depth - 4;
                emit_string_comparison(
                    opcode, frame, first, instruction.owns_left, instruction.owns_right);
                stack_depth = first + 1;
            } else if (opcode == Opcode::LoadLocal) {
                if (instruction.index >= frame.local_count) throw EncodingFailure("invalid arm64 local slot");
                load_d(0, frame.offset(instruction.index));
                store_d(0, frame.offset(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::StoreLocal) {
                require_stack(stack_depth, 1);
                --stack_depth;
                load_d(0, frame.offset(frame.temp_base + stack_depth));
                store_d(0, frame.offset(instruction.index));
            } else if (opcode == Opcode::Drop) {
                require_stack(stack_depth, 1);
                --stack_depth;
            } else if (opcode == Opcode::Duplicate) {
                require_stack(stack_depth, 1);
                load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                store_d(0, frame.offset(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::IdentityF64 || opcode == Opcode::NegateF64 ||
                       opcode == Opcode::LogicalNotF64 || opcode == Opcode::BooleanizeF64) {
                require_stack(stack_depth, 1);
                if (opcode != Opcode::IdentityF64) {
                    load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                    if (opcode == Opcode::NegateF64) {
                        words_.emit(0x1e614000u);
                    } else if (opcode == Opcode::LogicalNotF64) {
                        words_.emit(0x1e602008u);
                        words_.emit(0x1a9f17e9u);
                        emit_w9_as_f64();
                    } else {
                        emit_truth_w9(0);
                        emit_w9_as_f64();
                    }
                    store_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                }
            } else if (opcode == Opcode::AbsF64) {
                require_stack(stack_depth, 1);
                load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                words_.emit(0x1e60c000u);
                store_d(0, frame.offset(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::SqrtF64) {
                require_stack(stack_depth, 1);
                load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                words_.emit(0x1e61c000u);
                store_d(0, frame.offset(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::SinF64 || opcode == Opcode::CosF64 ||
                       opcode == Opcode::ExpF64 || opcode == Opcode::LnF64) {
                require_stack(stack_depth, 1);
                load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                const std::uint32_t slot = opcode == Opcode::LnF64 ? 3u
                    : opcode == Opcode::SinF64 ? 4u
                    : opcode == Opcode::CosF64 ? 5u : 6u;
                words_.emit(0xf9400269u | (slot << 10));
                words_.emit(0xd63f0120u);
                store_d(0, frame.offset(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::MonotonicF64 || opcode == Opcode::WallTimeF64) {
                constexpr std::uint32_t scratch = 176;
                words_.emit(opcode == Opcode::MonotonicF64 ? 0x52800020u : 0x52800000u);
                words_.emit(0x91000000u | (scratch << 10) | (19u << 5) | 1u);
                call_runtime_slot(opcode == Opcode::MonotonicF64 ? 15 : 17);
                words_.emit(0xf9400269u | ((scratch / 8u) << 10));
                words_.emit(0x9e620120u);
                words_.emit(0xf9400269u | (((scratch + 8u) / 8u) << 10));
                words_.emit(0x9e620121u);
                emit_number(1000000000.0, 2);
                words_.emit(0x1e621821u);
                words_.emit(0x1e612800u);
                store_d(0, frame.offset(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::SleepF64) {
                require_stack(stack_depth, 1);
                constexpr std::uint32_t scratch = 176;
                load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                words_.emit(0x9e780009u);
                words_.emit(0xf9000269u | ((scratch / 8u) << 10));
                words_.emit(0x9e620121u);
                words_.emit(0x1e613800u);
                emit_number(1000000000.0, 1);
                words_.emit(0x1e610800u);
                words_.emit(0x9e780009u);
                words_.emit(0xf9000269u | (((scratch + 8u) / 8u) << 10));
                words_.emit(0x91000000u | (scratch << 10) | (19u << 5));
                words_.emit(0xaa1f03e1u);
                call_runtime_slot(18);
                emit_number(machine_ir::null_value());
                store_d(0, frame.offset(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::LocalTimeParts) {
                require_stack(stack_depth, 1);
                const std::uint32_t first = stack_depth - 1;
                constexpr std::uint32_t scratch = 176;
                load_d(0, frame.offset(frame.temp_base + first));
                words_.emit(0x9e780009u);
                words_.emit(0xf9000269u | ((scratch / 8u) << 10));
                words_.emit(0xd2800800u);
                call_runtime_slot(8);
                const auto allocated = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(allocated, words_.offset());
                store_x(0, frame.offset(frame.scratch_slot));
                words_.emit(0x91000000u | (scratch << 10) | (19u << 5));
                load_x(1, frame.offset(frame.scratch_slot));
                call_runtime_slot(19);
                for (std::uint32_t index = 0; index < 9; ++index) {
                    load_x(0, frame.offset(frame.scratch_slot));
                    words_.emit(0xb9800009u | (index << 10));
                    words_.emit(0x9e620120u);
                    if (index == 4 || index == 5) {
                        emit_number(index == 4 ? 1.0 : 1900.0, 1);
                        words_.emit(0x1e612800u);
                    }
                    store_d(0, frame.offset(frame.temp_base + first + index));
                }
                load_x(0, frame.offset(frame.scratch_slot));
                call_runtime_slot(9);
                stack_depth = first + 9;
            } else if (opcode == Opcode::SystemCpuCount) {
                emit_u64(0, 58);
                call_runtime_slot(24);
                words_.emit(0x9e620000u);
                store_d(0, frame.offset(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::SystemCwdString) {
                const std::uint32_t first = stack_depth;
                words_.emit(0xaa1f03e0u);
                words_.emit(0xaa1f03e1u);
                call_runtime_slot(25);
                const auto cwd_ready = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(cwd_ready, words_.offset());
                emit_owned_string_from_cstring(frame, first, true);
                stack_depth = first + 2;
            } else if (opcode == Opcode::SystemEnvString) {
                require_stack(stack_depth, 2);
                const std::uint32_t first = stack_depth - 2;
                load_x(0, frame.offset(frame.temp_base + first));
                call_runtime_slot(26);
                store_x(0, frame.offset(frame.scratch_slot));
                if (instruction.owns_input) {
                    release_owned_string(
                        frame.offset(frame.temp_base + first),
                        frame.offset(frame.temp_base + first + 1));
                }
                load_x(0, frame.offset(frame.scratch_slot));
                const auto missing = words_.emit(0xb4000000u);
                emit_number(1.0);
                store_d(0, frame.offset(frame.temp_base + first));
                load_x(0, frame.offset(frame.scratch_slot));
                emit_owned_string_from_cstring(frame, first + 1, false);
                const auto done = words_.emit(0x14000000u);
                words_.patch_compare_branch19(missing, words_.offset());
                emit_number(0.0);
                store_d(0, frame.offset(frame.temp_base + first));
                emit_string_address(instruction.index);
                store_d(0, frame.offset(frame.temp_base + first + 1));
                emit_number(0.0);
                store_d(0, frame.offset(frame.temp_base + first + 2));
                words_.patch_branch26(done, words_.offset());
                stack_depth = first + 3;
            } else if (opcode == Opcode::ProcessRun) {
                require_stack(stack_depth, 2 + instruction.argument_count * 2);
                const std::uint32_t first =
                    stack_depth - 2 - instruction.argument_count * 2;
                emit_u64(0, static_cast<std::uint64_t>(instruction.argument_count + 2u) * 8u);
                call_runtime_slot(8);
                const auto argv_allocated = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(argv_allocated, words_.offset());
                store_x(0, frame.offset(frame.scratch_slot));
                for (std::uint32_t index = 0; index <= instruction.argument_count; ++index) {
                    load_x(9, frame.offset(frame.temp_base + first + index * 2u));
                    words_.emit(0xf9000009u | (index << 10));
                }
                words_.emit(0xf900001fu | ((instruction.argument_count + 1u) << 10));
                call_runtime_slot(29);
                const auto stdout_file_ready = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(stdout_file_ready, words_.offset());
                store_x(0, frame.offset(frame.scratch_slot + 1));
                call_runtime_slot(29);
                const auto stderr_file_ready = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(stderr_file_ready, words_.offset());
                store_x(0, frame.offset(frame.scratch_slot + 2));
                load_x(0, frame.offset(frame.scratch_slot + 1));
                call_runtime_slot(30);
                store_x(0, frame.offset(frame.scratch_slot + 3));
                load_x(0, frame.offset(frame.scratch_slot + 2));
                call_runtime_slot(30);
                store_x(0, frame.offset(frame.scratch_slot + 4));
                call_runtime_slot(33);
                const auto parent = words_.emit(0xb5000000u);
                load_x(0, frame.offset(frame.scratch_slot + 3));
                words_.emit(0xd2800021u);
                call_runtime_slot(32);
                load_x(0, frame.offset(frame.scratch_slot + 4));
                words_.emit(0xd2800041u);
                call_runtime_slot(32);
                load_x(0, frame.offset(frame.temp_base + first));
                load_x(1, frame.offset(frame.scratch_slot));
                call_runtime_slot(34);
                words_.emit(0xd2800fe0u);
                call_runtime_slot(36);
                words_.emit(0xd4200000u);
                words_.patch_compare_branch19(parent, words_.offset());
                store_x(0, frame.offset(frame.scratch_slot + 5));
                words_.emit(0xf100001fu);
                const auto fork_succeeded = words_.emit(0x5400000au);
                emit_u64(9, UINT64_MAX);
                store_x(9, frame.offset(frame.scratch_slot + 7));
                const auto child_done = words_.emit(0x14000000u);
                words_.patch_compare_branch19(fork_succeeded, words_.offset());
                load_x(0, frame.offset(frame.scratch_slot + 5));
                emit_frame_address(1, frame.offset(frame.scratch_slot + 6));
                words_.emit(0xaa1f03e2u);
                call_runtime_slot(35);
                words_.emit(0xf100001fu);
                const auto wait_succeeded = words_.emit(0x5400000au);
                emit_u64(9, UINT64_MAX);
                store_x(9, frame.offset(frame.scratch_slot + 7));
                const auto status_done = words_.emit(0x14000000u);
                words_.patch_compare_branch19(wait_succeeded, words_.offset());
                load_x(9, frame.offset(frame.scratch_slot + 6));
                words_.emit(0x1200192au);
                const auto signaled = words_.emit(0x3500000au);
                words_.emit(0x53087d29u);
                words_.emit(0x12001d29u);
                const auto decoded = words_.emit(0x14000000u);
                words_.patch_compare_branch19(signaled, words_.offset());
                words_.emit(0x11020149u);
                words_.patch_branch26(decoded, words_.offset());
                words_.emit(0x93407d29u);
                store_x(9, frame.offset(frame.scratch_slot + 7));
                words_.patch_branch26(status_done, words_.offset());
                words_.patch_branch26(child_done, words_.offset());
                for (std::uint32_t index = 0; index <= instruction.argument_count; ++index) {
                    release_owned_string(
                        frame.offset(frame.temp_base + first + index * 2u),
                        frame.offset(frame.temp_base + first + index * 2u + 1u));
                }
                emit_read_descriptor_string(frame, first + 1, 3);
                emit_read_descriptor_string(frame, first + 3, 4);
                for (std::uint32_t file = 1; file <= 2; ++file) {
                    load_x(0, frame.offset(frame.scratch_slot + file));
                    call_runtime_slot(31);
                }
                load_x(0, frame.offset(frame.scratch_slot));
                call_runtime_slot(9);
                load_x(9, frame.offset(frame.scratch_slot + 7));
                words_.emit(0x9e620120u);
                store_d(0, frame.offset(frame.temp_base + first));
                stack_depth = first + 5;
            } else if (opcode == Opcode::CaptureRegex) {
                require_stack(stack_depth, 2);
                const std::uint32_t first = stack_depth - 2;
                emit_capture_regex(function, frame, first, instruction, entry, branches);
                stack_depth = first + instruction.argument_count * 2u;
            } else if (opcode == Opcode::RangeF64Values) {
                require_stack(stack_depth, instruction.argument_count);
                const auto first = stack_depth - instruction.argument_count;
                if (instruction.argument_count == 0) {
                    throw EncodingFailure("arm64 stat.range requires a non-empty input");
                }
                load_d(0, frame.offset(frame.temp_base + first));
                words_.emit(0x1e604001u);
                for (std::uint32_t index = 1; index < instruction.argument_count; ++index) {
                    load_d(2, frame.offset(frame.temp_base + first + index));
                    words_.emit(0x1e625800u);
                    words_.emit(0x1e624821u);
                }
                words_.emit(0x1e603820u);
                store_d(0, frame.offset(frame.temp_base + first));
                stack_depth = first + 1;
            } else if (opcode == Opcode::SumF64Values || opcode == Opcode::MeanF64Values ||
                       opcode == Opcode::VarianceF64Values ||
                       opcode == Opcode::StdDevF64Values ||
                       opcode == Opcode::CountValues) {
                require_stack(stack_depth, instruction.argument_count);
                const auto first = stack_depth - instruction.argument_count;
                if (instruction.argument_count == 0) {
                    throw EncodingFailure("arm64 numeric reduction requires a non-empty input");
                }
                if (opcode == Opcode::CountValues) {
                    emit_number(static_cast<double>(instruction.argument_count));
                } else {
                    load_d(0, frame.offset(frame.temp_base + first));
                    for (std::uint32_t index = 1; index < instruction.argument_count; ++index) {
                        load_d(1, frame.offset(frame.temp_base + first + index));
                        words_.emit(0x1e602820u);
                    }
                    if (opcode == Opcode::MeanF64Values || opcode == Opcode::VarianceF64Values ||
                        opcode == Opcode::StdDevF64Values) {
                        emit_number(static_cast<double>(instruction.argument_count), 1);
                        words_.emit(0x1e611800u);
                    }
                    if (opcode == Opcode::VarianceF64Values || opcode == Opcode::StdDevF64Values) {
                        if (instruction.argument_count <= instruction.degrees_of_freedom) {
                            throw EncodingFailure("arm64 stat.std input is too small for ddof");
                        }
                        emit_number(0.0, 1);
                        for (std::uint32_t index = 0; index < instruction.argument_count; ++index) {
                            load_d(2, frame.offset(frame.temp_base + first + index));
                            words_.emit(0x1e603842u);
                            words_.emit(0x1e620842u);
                            words_.emit(0x1e622821u);
                        }
                        emit_number(static_cast<double>(
                            instruction.argument_count - instruction.degrees_of_freedom), 2);
                        words_.emit(0x1e621821u);
                        words_.emit(opcode == Opcode::StdDevF64Values
                            ? 0x1e61c020u : 0x1e604020u);
                    }
                }
                store_d(0, frame.offset(frame.temp_base + first));
                stack_depth = first + 1;
            } else if (opcode == Opcode::RangeF64Locals) {
                if (instruction.argument_count == 0 || instruction.index > frame.local_count ||
                    instruction.argument_count > frame.local_count - instruction.index) {
                    throw EncodingFailure("invalid arm64 stat.range local reduction range");
                }
                const auto offset = frame.offset(instruction.index);
                if (offset > 4095) throw EncodingFailure("arm64 stat.range local offset overflow");
                words_.emit(0x910003abu | (offset << 10));
                words_.emit(0xfd400160u);
                words_.emit(0x1e604001u);
                if (instruction.argument_count > 1) {
                    words_.emit(0x9100216bu);
                    emit_u64(12, instruction.argument_count - 1);
                    const auto range_loop = words_.offset();
                    words_.emit(0xfd400162u);
                    words_.emit(0x1e625800u);
                    words_.emit(0x1e624821u);
                    words_.emit(0x9100216bu);
                    words_.emit(0xf100058cu);
                    const auto range_repeat = words_.emit(0x54000001u);
                    words_.patch_compare_branch19(range_repeat, range_loop);
                }
                words_.emit(0x1e603820u);
                store_d(0, frame.offset(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::SumF64Locals || opcode == Opcode::MeanF64Locals ||
                       opcode == Opcode::VarianceF64Locals ||
                       opcode == Opcode::StdDevF64Locals ||
                       opcode == Opcode::CountLocalValues) {
                if (instruction.argument_count == 0 || instruction.index > frame.local_count ||
                    instruction.argument_count > frame.local_count - instruction.index) {
                    throw EncodingFailure("invalid arm64 local reduction range");
                }
                if (opcode == Opcode::CountLocalValues) {
                    emit_number(static_cast<double>(instruction.argument_count));
                } else {
                    const auto offset = frame.offset(instruction.index);
                    if (offset > 4095) throw EncodingFailure("arm64 local reduction offset overflow");
                    emit_number(0.0);
                    words_.emit(0x910003abu | (offset << 10));
                    emit_u64(12, instruction.argument_count);
                    const auto loop = words_.offset();
                    words_.emit(0xfd400161u);
                    words_.emit(0x1e612800u);
                    words_.emit(0x9100216bu);
                    words_.emit(0x7100058cu);
                    const auto branch = words_.emit(0x54000001u);
                    words_.patch_compare_branch19(branch, loop);
                    if (opcode == Opcode::MeanF64Locals || opcode == Opcode::VarianceF64Locals ||
                        opcode == Opcode::StdDevF64Locals) {
                        emit_number(static_cast<double>(instruction.argument_count), 1);
                        words_.emit(0x1e611800u);
                    }
                    if (opcode == Opcode::VarianceF64Locals || opcode == Opcode::StdDevF64Locals) {
                        if (instruction.argument_count <= instruction.degrees_of_freedom) {
                            throw EncodingFailure("arm64 stat.std input is too small for ddof");
                        }
                        emit_number(0.0, 1);
                        words_.emit(0x910003abu | (offset << 10));
                        emit_u64(12, instruction.argument_count);
                        const auto variance_loop = words_.offset();
                        words_.emit(0xfd400162u);
                        words_.emit(0x1e603842u);
                        words_.emit(0x1e620842u);
                        words_.emit(0x1e622821u);
                        words_.emit(0x9100216bu);
                        words_.emit(0xf100058cu);
                        const auto variance_repeat = words_.emit(0x54000001u);
                        words_.patch_compare_branch19(variance_repeat, variance_loop);
                        emit_number(static_cast<double>(
                            instruction.argument_count - instruction.degrees_of_freedom), 2);
                        words_.emit(0x1e621821u);
                        words_.emit(opcode == Opcode::StdDevF64Locals
                            ? 0x1e61c020u : 0x1e604020u);
                    }
                }
                store_d(0, frame.offset(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::MakeOwnedF64List) {
                require_stack(stack_depth, instruction.argument_count);
                const auto first = stack_depth - instruction.argument_count;
                const std::uint64_t allocation_bytes = 16ull +
                    static_cast<std::uint64_t>(instruction.argument_count) * 8ull;
                emit_u64(0, allocation_bytes);
                call_runtime_slot(8);
                const auto allocated = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(allocated, words_.offset());
                words_.emit(0xaa0003ebu);
                emit_u64(12, instruction.argument_count);
                words_.emit(0xf900016cu);
                words_.emit(0xf900056cu);
                for (std::uint32_t index = 0; index < instruction.argument_count; ++index) {
                    load_d(0, frame.offset(frame.temp_base + first + index));
                    const auto byte_offset = 16u + index * 8u;
                    if (byte_offset > 32760) throw EncodingFailure("arm64 list literal is too large");
                    words_.emit(0xfd000160u | ((byte_offset / 8) << 10));
                }
                store_x(11, frame.offset(frame.temp_base + first));
                stack_depth = first + 1;
            } else if (opcode == Opcode::MakeOwnedF64ListLiteral) {
                const std::uint64_t payload_bytes =
                    static_cast<std::uint64_t>(instruction.argument_count) * 8ull;
                if (static_cast<std::uint64_t>(instruction.index) + payload_bytes >
                    module_.string_data.size()) {
                    throw EncodingFailure("invalid arm64 numeric-list literal range");
                }
                emit_u64(0, 16ull + payload_bytes);
                call_runtime_slot(8);
                const auto allocated = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(allocated, words_.offset());
                words_.emit(0xaa0003ebu);
                emit_u64(12, instruction.argument_count);
                words_.emit(0xf900016cu);
                words_.emit(0xf900056cu);
                words_.emit(0xf9401e6du);
                if (instruction.index != 0) {
                    emit_u64(14, instruction.index);
                    words_.emit(0x8b0e01adu);
                }
                words_.emit(0x9100416fu);
                const auto copy = words_.offset();
                words_.emit(0xf94001a9u);
                words_.emit(0xf90001e9u);
                words_.emit(0x910021adu);
                words_.emit(0x910021efu);
                words_.emit(0xf100058cu);
                const auto repeat = words_.emit(0x54000001u);
                words_.patch_compare_branch19(repeat, copy);
                store_x(11, frame.offset(frame.temp_base + stack_depth));
                ++stack_depth;
            } else if (opcode == Opcode::NormalizeF64Multiset) {
                require_stack(stack_depth, 1);
                emit_normalize_f64_multiset(frame, stack_depth - 1);
            } else if (opcode == Opcode::UnionF64Multisets ||
                       opcode == Opcode::DifferenceF64Multisets ||
                       opcode == Opcode::FloorDivideF64Multisets ||
                       opcode == Opcode::RemainderF64Multisets) {
                require_stack(stack_depth, 2);
                const auto first = stack_depth - 2;
                emit_binary_f64_multiset(
                    frame, first, opcode, instruction.owns_left, instruction.owns_right);
                stack_depth = first + 1;
            } else if (opcode == Opcode::AddF64MultisetScalar ||
                       opcode == Opcode::SubtractF64MultisetScalar ||
                       opcode == Opcode::FloorDivideF64MultisetScalar) {
                require_stack(stack_depth, 2);
                const auto first = stack_depth - 2;
                emit_f64_multiset_scalar(frame, first, opcode, instruction.owns_left);
                stack_depth = first + 1;
            } else if (opcode == Opcode::RangeF64List) {
                require_stack(stack_depth, 1);
                const auto first = stack_depth - 1;
                load_x(11, frame.offset(frame.temp_base + first));
                words_.emit(0xf940016cu);
                const auto nonempty = words_.emit(0xb500000cu);
                emit_abort();
                words_.patch_compare_branch19(nonempty, words_.offset());
                words_.emit(0x9100416du);
                words_.emit(0xfd4001a0u);
                words_.emit(0x1e604001u);
                words_.emit(0x910021adu);
                words_.emit(0xf100058cu);
                const auto complete = words_.emit(0x54000000u);
                const auto range_loop = words_.offset();
                words_.emit(0xfd4001a2u);
                words_.emit(0x1e625800u);
                words_.emit(0x1e624821u);
                words_.emit(0x910021adu);
                words_.emit(0xf100058cu);
                const auto range_repeat = words_.emit(0x54000001u);
                words_.patch_compare_branch19(range_repeat, range_loop);
                words_.patch_compare_branch19(complete, words_.offset());
                words_.emit(0x1e603820u);
                store_d(0, frame.offset(frame.temp_base + first));
                if (instruction.owns_input) {
                    words_.emit(0xaa0b03e0u);
                    call_runtime_slot(9);
                }
            } else if (opcode == Opcode::SumF64List || opcode == Opcode::MeanF64List ||
                       opcode == Opcode::VarianceF64List ||
                       opcode == Opcode::StdDevF64List ||
                       opcode == Opcode::CountF64List) {
                require_stack(stack_depth, 1);
                const auto first = stack_depth - 1;
                load_x(11, frame.offset(frame.temp_base + first));
                words_.emit(0xf940016cu);
                if (opcode == Opcode::CountF64List) {
                    words_.emit(0x9e620180u);
                } else {
                    if (opcode == Opcode::MeanF64List || opcode == Opcode::VarianceF64List ||
                        opcode == Opcode::StdDevF64List) {
                        const auto ddof = (opcode == Opcode::VarianceF64List ||
                                           opcode == Opcode::StdDevF64List)
                            ? instruction.degrees_of_freedom : 0u;
                        if (ddof > 4095) throw EncodingFailure("arm64 stat.std ddof is too large");
                        words_.emit(0xf100019fu | (ddof << 10));
                        const auto nonempty = words_.emit(0x54000008u);
                        emit_abort();
                        words_.patch_compare_branch19(nonempty, words_.offset());
                    }
                    words_.emit(0x9e6703e0u);
                    words_.emit(0x9100416du);
                    words_.emit(0xaa0c03eeu);
                    const auto empty = words_.emit(0xb400000eu);
                    const auto loop = words_.offset();
                    words_.emit(0xfd4001a1u);
                    words_.emit(0x1e612800u);
                    words_.emit(0x910021adu);
                    words_.emit(0xf10005ceu);
                    const auto repeat = words_.emit(0x54000001u);
                    words_.patch_compare_branch19(repeat, loop);
                    words_.patch_compare_branch19(empty, words_.offset());
                    if (opcode == Opcode::MeanF64List || opcode == Opcode::VarianceF64List ||
                        opcode == Opcode::StdDevF64List) {
                        words_.emit(0x9e620181u);
                        words_.emit(0x1e611800u);
                    }
                    if (opcode == Opcode::VarianceF64List || opcode == Opcode::StdDevF64List) {
                        emit_number(0.0, 1);
                        words_.emit(0x9100416du);
                        words_.emit(0xaa0c03eeu);
                        const auto variance_loop = words_.offset();
                        words_.emit(0xfd4001a2u);
                        words_.emit(0x1e603842u);
                        words_.emit(0x1e620842u);
                        words_.emit(0x1e622821u);
                        words_.emit(0x910021adu);
                        words_.emit(0xf10005ceu);
                        const auto variance_repeat = words_.emit(0x54000001u);
                        words_.patch_compare_branch19(variance_repeat, variance_loop);
                        if (instruction.degrees_of_freedom != 0) {
                            words_.emit(0xd100018cu |
                                (instruction.degrees_of_freedom << 10));
                        }
                        words_.emit(0x9e620182u);
                        words_.emit(0x1e621821u);
                        words_.emit(opcode == Opcode::StdDevF64List
                            ? 0x1e61c020u : 0x1e604020u);
                    }
                }
                store_d(0, frame.offset(frame.temp_base + first));
                if (instruction.owns_input) {
                    words_.emit(0xaa0b03e0u);
                    call_runtime_slot(9);
                }
            } else if (opcode == Opcode::LoadF64LocalsIndex) {
                require_stack(stack_depth, 1);
                if (instruction.index > frame.local_count ||
                    instruction.argument_count > frame.local_count - instruction.index) {
                    throw EncodingFailure("invalid arm64 fixed-vector index range");
                }
                const auto first = stack_depth - 1;
                load_d(0, frame.offset(frame.temp_base + first));
                words_.emit(0x9e78000cu);
                words_.emit(0x9e620181u);
                words_.emit(0x1e602020u);
                std::vector<std::size_t> invalid;
                invalid.push_back(words_.emit(0x54000001u));
                invalid.push_back(words_.emit(0x54000006u));
                words_.emit(0xf100019fu);
                invalid.push_back(words_.emit(0x5400000bu));
                emit_u64(13, instruction.argument_count);
                words_.emit(0xeb0d019fu);
                invalid.push_back(words_.emit(0x54000002u));
                emit_frame_address(11, frame.offset(instruction.index));
                words_.emit(0x8b0c0d6bu);
                words_.emit(0xfd400160u);
                store_d(0, frame.offset(frame.temp_base + first));
                const auto done = words_.emit(0x14000000u);
                const auto abort = words_.offset();
                for (const auto branch : invalid) words_.patch_compare_branch19(branch, abort);
                if (instruction.has_error_handler) {
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_constant(
                        frame, instruction.error_type_local, machine_ir::index_error_mask);
                    branches.push_back({words_.emit(0x14000000u), instruction.label, false});
                } else if (entry) {
                    emit_abort();
                } else {
                    emit_error_cleanup(function, frame);
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    emit_u64(11, machine_ir::index_error_mask);
                    emit_epilogue(frame, false);
                }
                words_.patch_branch26(done, words_.offset());
            } else if (opcode == Opcode::StoreF64LocalsIndex) {
                require_stack(stack_depth, 2);
                if (instruction.index > frame.local_count ||
                    instruction.argument_count > frame.local_count - instruction.index) {
                    throw EncodingFailure("invalid arm64 fixed-vector update range");
                }
                const auto first = stack_depth - 2;
                load_d(0, frame.offset(frame.temp_base + first));
                words_.emit(0x9e78000cu);
                words_.emit(0x9e620181u);
                words_.emit(0x1e602020u);
                std::vector<std::size_t> invalid;
                invalid.push_back(words_.emit(0x54000001u));
                invalid.push_back(words_.emit(0x54000006u));
                words_.emit(0xf100019fu);
                invalid.push_back(words_.emit(0x5400000bu));
                emit_u64(13, instruction.argument_count);
                words_.emit(0xeb0d019fu);
                invalid.push_back(words_.emit(0x54000002u));
                emit_frame_address(11, frame.offset(instruction.index));
                words_.emit(0x8b0c0d6bu);
                load_d(0, frame.offset(frame.temp_base + first + 1));
                words_.emit(0xfd000160u);
                const auto done = words_.emit(0x14000000u);
                const auto abort = words_.offset();
                for (const auto branch : invalid) words_.patch_compare_branch19(branch, abort);
                if (instruction.has_error_handler) {
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_constant(
                        frame, instruction.error_type_local, machine_ir::index_error_mask);
                    branches.push_back({words_.emit(0x14000000u), instruction.label, false});
                } else if (entry) {
                    emit_abort();
                } else {
                    emit_error_cleanup(function, frame);
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    emit_u64(11, machine_ir::index_error_mask);
                    emit_epilogue(frame, false);
                }
                words_.patch_branch26(done, words_.offset());
                stack_depth = first;
            } else if (opcode == Opcode::LoadF64ListIndex) {
                require_stack(stack_depth, 2);
                const auto first = stack_depth - 2;
                load_x(11, frame.offset(frame.temp_base + first));
                load_d(0, frame.offset(frame.temp_base + first + 1));
                words_.emit(0x9e78000cu);
                words_.emit(0x9e620181u);
                words_.emit(0x1e602020u);
                std::vector<std::size_t> invalid;
                invalid.push_back(words_.emit(0x54000001u));
                invalid.push_back(words_.emit(0x54000006u));
                words_.emit(0xf100019fu);
                invalid.push_back(words_.emit(0x5400000bu));
                words_.emit(0xf940016du);
                words_.emit(0xeb0d019fu);
                invalid.push_back(words_.emit(0x54000002u));
                words_.emit(0x8b0c0d6bu);
                words_.emit(0xfd400960u);
                store_d(0, frame.offset(frame.temp_base + first));
                if (instruction.owns_input) {
                    words_.emit(0xaa0b03e0u);
                    call_runtime_slot(9);
                }
                const auto done = words_.emit(0x14000000u);
                const auto abort = words_.offset();
                for (const auto branch : invalid) words_.patch_compare_branch19(branch, abort);
                if (instruction.owns_input) {
                    words_.emit(0xaa0b03e0u);
                    call_runtime_slot(9);
                }
                if (instruction.has_error_handler) {
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_constant(
                        frame, instruction.error_type_local, machine_ir::index_error_mask);
                    branches.push_back({words_.emit(0x14000000u), instruction.label, false});
                } else if (entry) {
                    emit_abort();
                } else {
                    emit_error_cleanup(function, frame);
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    emit_u64(11, machine_ir::index_error_mask);
                    emit_epilogue(frame, false);
                }
                words_.patch_branch26(done, words_.offset());
                stack_depth = first + 1;
            } else if (opcode == Opcode::StoreF64ListIndex) {
                require_stack(stack_depth, 2);
                if (instruction.index >= frame.local_count) {
                    throw EncodingFailure("invalid arm64 list update local");
                }
                const auto first = stack_depth - 2;
                load_x(11, frame.offset(instruction.index));
                std::vector<std::size_t> invalid;
                invalid.push_back(words_.emit(0xb400000bu));
                load_d(0, frame.offset(frame.temp_base + first));
                words_.emit(0x9e78000cu);
                words_.emit(0x9e620181u);
                words_.emit(0x1e602020u);
                invalid.push_back(words_.emit(0x54000001u));
                invalid.push_back(words_.emit(0x54000006u));
                words_.emit(0xf100019fu);
                invalid.push_back(words_.emit(0x5400000bu));
                words_.emit(0xf940016du);
                words_.emit(0xeb0d019fu);
                invalid.push_back(words_.emit(0x54000002u));
                words_.emit(0x8b0c0d6bu);
                load_d(0, frame.offset(frame.temp_base + first + 1));
                words_.emit(0xfd000960u);
                const auto done = words_.emit(0x14000000u);
                const auto abort = words_.offset();
                for (const auto branch : invalid) words_.patch_compare_branch19(branch, abort);
                if (instruction.has_error_handler) {
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_constant(
                        frame, instruction.error_type_local, machine_ir::index_error_mask);
                    branches.push_back({words_.emit(0x14000000u), instruction.label, false});
                } else if (entry) {
                    emit_abort();
                } else {
                    emit_error_cleanup(function, frame);
                    emit_error_message_registers(
                        instruction.error_message_offset, instruction.byte_count);
                    emit_u64(11, machine_ir::index_error_mask);
                    emit_epilogue(frame, false);
                }
                words_.patch_branch26(done, words_.offset());
                stack_depth = first;
            } else if (opcode == Opcode::CloneF64List) {
                require_stack(stack_depth, 1);
                const auto first = stack_depth - 1;
                load_x(11, frame.offset(frame.temp_base + first));
                const auto source_present = words_.emit(0xb500000bu);
                emit_abort();
                words_.patch_compare_branch19(source_present, words_.offset());
                words_.emit(0xf940016cu);
                words_.emit(0xd37df180u);
                words_.emit(0x91004000u);
                call_runtime_slot(8);
                const auto allocated = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(allocated, words_.offset());
                words_.emit(0xaa0003edu);
                load_x(11, frame.offset(frame.temp_base + first));
                words_.emit(0xf940016cu);
                words_.emit(0xf90001acu);
                words_.emit(0xf90005acu);
                const auto empty = words_.emit(0xb400000cu);
                words_.emit(0x9100416bu);
                words_.emit(0x910041adu);
                const auto copy = words_.offset();
                words_.emit(0xfd400160u);
                words_.emit(0xfd0001a0u);
                words_.emit(0x9100216bu);
                words_.emit(0x910021adu);
                words_.emit(0xf100058cu);
                const auto repeat = words_.emit(0x54000001u);
                words_.patch_compare_branch19(repeat, copy);
                words_.patch_compare_branch19(empty, words_.offset());
                store_x(0, frame.offset(frame.temp_base + first));
            } else if (opcode == Opcode::ConcatF64Lists) {
                require_stack(stack_depth, 2);
                const auto first = stack_depth - 2;
                load_x(11, frame.offset(frame.temp_base + first));
                const auto left_present = words_.emit(0xb500000bu);
                emit_abort();
                words_.patch_compare_branch19(left_present, words_.offset());
                load_x(12, frame.offset(frame.temp_base + first + 1));
                const auto right_present = words_.emit(0xb500000cu);
                emit_abort();
                words_.patch_compare_branch19(right_present, words_.offset());
                words_.emit(0xf940016du);
                words_.emit(0xf940018eu);
                words_.emit(0xab0e01afu);
                const auto length_valid = words_.emit(0x54000003u);
                emit_abort();
                words_.patch_compare_branch19(length_valid, words_.offset());
                words_.emit(0xd37dfdf0u);
                const auto size_valid = words_.emit(0xb4000010u);
                emit_abort();
                words_.patch_compare_branch19(size_valid, words_.offset());
                words_.emit(0xd37df1e0u);
                words_.emit(0x91004000u);
                call_runtime_slot(8);
                const auto allocated = words_.emit(0xb5000000u);
                emit_abort();
                words_.patch_compare_branch19(allocated, words_.offset());
                load_x(11, frame.offset(frame.temp_base + first));
                load_x(12, frame.offset(frame.temp_base + first + 1));
                words_.emit(0xf940016du);
                words_.emit(0xf940018eu);
                words_.emit(0x8b0e01afu);
                words_.emit(0xf900000fu);
                words_.emit(0xf900040fu);
                words_.emit(0x91004010u);
                const auto left_empty = words_.emit(0xb400000du);
                words_.emit(0x9100416bu);
                const auto copy_left = words_.offset();
                words_.emit(0xfd400160u);
                words_.emit(0xfd000200u);
                words_.emit(0x9100216bu);
                words_.emit(0x91002210u);
                words_.emit(0xf10005adu);
                const auto repeat_left = words_.emit(0x54000001u);
                words_.patch_compare_branch19(repeat_left, copy_left);
                words_.patch_compare_branch19(left_empty, words_.offset());
                const auto right_empty = words_.emit(0xb400000eu);
                words_.emit(0x9100418cu);
                const auto copy_right = words_.offset();
                words_.emit(0xfd400180u);
                words_.emit(0xfd000200u);
                words_.emit(0x9100218cu);
                words_.emit(0x91002210u);
                words_.emit(0xf10005ceu);
                const auto repeat_right = words_.emit(0x54000001u);
                words_.patch_compare_branch19(repeat_right, copy_right);
                words_.patch_compare_branch19(right_empty, words_.offset());
                if (instruction.owns_left) load_x(17, frame.offset(frame.temp_base + first));
                store_x(0, frame.offset(frame.temp_base + first));
                if (instruction.owns_left) {
                    words_.emit(0xaa1103e0u);
                    call_runtime_slot(9);
                }
                if (instruction.owns_right) {
                    load_x(0, frame.offset(frame.temp_base + first + 1));
                    call_runtime_slot(9);
                }
                stack_depth = first + 1;
            } else if (opcode == Opcode::ReleaseStringValue) {
                require_stack(stack_depth, 2);
                stack_depth -= 2;
                release_owned_string(
                    frame.offset(frame.temp_base + stack_depth),
                    frame.offset(frame.temp_base + stack_depth + 1));
            } else if (opcode == Opcode::ReleaseStringLocal) {
                if (instruction.index + 1 >= frame.local_count) {
                    throw EncodingFailure("invalid arm64 string local");
                }
                release_owned_string(frame.offset(instruction.index), frame.offset(instruction.index + 1));
                store_x(31, frame.offset(instruction.index + 1));
            } else if (opcode == Opcode::ReleaseF64ListValue) {
                require_stack(stack_depth, 1);
                --stack_depth;
                load_x(0, frame.offset(frame.temp_base + stack_depth));
                const auto empty = words_.emit(0xb4000000u);
                call_runtime_slot(9);
                words_.patch_compare_branch19(empty, words_.offset());
            } else if (opcode == Opcode::ReleaseF64ListLocal) {
                if (instruction.index >= frame.local_count) throw EncodingFailure("invalid arm64 list local");
                load_x(0, frame.offset(instruction.index));
                const auto empty = words_.emit(0xb4000000u);
                call_runtime_slot(9);
                store_x(31, frame.offset(instruction.index));
                words_.patch_compare_branch19(empty, words_.offset());
            } else if (opcode == Opcode::EqualBits || opcode == Opcode::NotEqualBits) {
                require_stack(stack_depth, 2);
                load_x(9, frame.offset(frame.temp_base + stack_depth - 2));
                load_x(10, frame.offset(frame.temp_base + stack_depth - 1));
                words_.emit(0xeb0a013fu);
                words_.emit(opcode == Opcode::EqualBits ? 0x1a9f17e9u : 0x1a9f07e9u);
                emit_w9_as_f64();
                --stack_depth;
                store_d(0, frame.offset(frame.temp_base + stack_depth - 1));
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
                    load_d(0, frame.offset(frame.temp_base + stack_depth - 2));
                    load_d(1, frame.offset(frame.temp_base + stack_depth - 1));
                    if (opcode == Opcode::FloorDivideF64) words_.emit(0x1e611800u);
                    words_.emit(opcode == Opcode::PowerF64 ? 0xf9400269u
                        : opcode == Opcode::RemainderF64 ? 0xf9400669u : 0xf9400a69u);
                    words_.emit(0xd63f0120u);
                } else if (opcode == Opcode::LogicalXorF64) {
                    load_d(1, frame.offset(frame.temp_base + stack_depth - 2));
                    emit_truth_w9(1);
                    words_.emit(0x2a0903ebu);
                    load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                    emit_truth_w9(0);
                    words_.emit(0x4a0b0129u);
                    emit_w9_as_f64();
                } else {
                    load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                    load_d(1, frame.offset(frame.temp_base + stack_depth - 2));
                    if (opcode == Opcode::AddF64) words_.emit(0x1e602820u);
                    else if (opcode == Opcode::SubtractF64) words_.emit(0x1e603820u);
                    else if (opcode == Opcode::MultiplyF64) words_.emit(0x1e600820u);
                    else if (opcode == Opcode::DivideF64) words_.emit(0x1e601820u);
                    else emit_comparison(opcode);
                }
                --stack_depth;
                store_d(0, frame.offset(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::Call) {
                require_stack(stack_depth, instruction.argument_count);
                const auto first = stack_depth - instruction.argument_count;
                const auto argument_offset = frame.offset(frame.temp_base + first);
                const std::uint32_t argument_pages = argument_offset >> 12;
                const std::uint32_t argument_remainder = argument_offset & 0xfffu;
                if (argument_pages) {
                    words_.emit(0x914003e9u | (argument_pages << 10));
                    if (argument_remainder) {
                        words_.emit(0x91000129u | (argument_remainder << 10));
                    }
                } else {
                    words_.emit(0x910003e9u | (argument_remainder << 10));
                }
                words_.emit(0xaa0903eau);
                if (instruction.uses_parameter_mask) {
                    emit_u64(11, instruction.provided_parameter_mask);
                }
                calls_.push_back({words_.emit(0x94000000u), instruction.symbol});
                stack_depth = first;
                stack_depth += instruction.result_count;
                if (instruction.may_error) {
                    if (instruction.has_error_handler) {
                        store_error_message_local(frame, instruction.error_value_local);
                        store_error_type_local(frame, instruction.error_type_local);
                        words_.emit(0xf100017fu);
                        branches.push_back({words_.emit(0x54000001u), instruction.label, true});
                    } else {
                        words_.emit(0xf100017fu);
                        const auto succeeded = words_.emit(0x54000000u);
                        if (entry) {
                            emit_abort();
                        } else {
                            store_x(12, frame.offset(frame.error_pointer_slot));
                            store_d(7, frame.offset(frame.error_length_slot));
                            words_.emit(0x9e620160u);
                            store_d(0, frame.offset(frame.error_type_slot));
                            emit_error_cleanup(function, frame);
                            load_x(12, frame.offset(frame.error_pointer_slot));
                            load_d(7, frame.offset(frame.error_length_slot));
                            load_d(0, frame.offset(frame.error_type_slot));
                            words_.emit(0x9e78000bu);
                            emit_epilogue(frame, false);
                        }
                        words_.patch_compare_branch19(succeeded, words_.offset());
                    }
                }
            } else if (opcode == Opcode::Label) {
                if (!labels.emplace(instruction.label, words_.offset()).second) {
                    throw EncodingFailure("duplicate arm64 machine IR label");
                }
            } else if (opcode == Opcode::Jump) {
                branches.push_back({words_.emit(0x14000000u), instruction.label, false});
            } else if (opcode == Opcode::JumpIfFalse || opcode == Opcode::JumpIfTrue) {
                require_stack(stack_depth, 1);
                --stack_depth;
                load_d(0, frame.offset(frame.temp_base + stack_depth));
                emit_truth_w9(0);
                const auto base = opcode == Opcode::JumpIfFalse ? 0x34000009u : 0x35000009u;
                branches.push_back({words_.emit(base), instruction.label, true});
            } else if (opcode == Opcode::JumpIfParameterProvided) {
                if (!function.parameter_mask_local || instruction.index >= 32) {
                    throw EncodingFailure("invalid arm64 parameter-mask branch");
                }
                load_x(11, frame.offset(*function.parameter_mask_local));
                emit_u64(12, 1ull << instruction.index);
                words_.emit(0xea0c017fu);
                branches.push_back({words_.emit(0x54000001u), instruction.label, true});
            } else if (opcode == Opcode::ErrorTypeMatches) {
                require_stack(stack_depth, 1);
                load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                words_.emit(0x9e780009u);
                emit_u64(10, instruction.index);
                words_.emit(0x8a0a0129u);
                words_.emit(0xeb0a013fu);
                words_.emit(0x1a9f17e9u);
                emit_w9_as_f64();
                store_d(0, frame.offset(frame.temp_base + stack_depth - 1));
            } else if (opcode == Opcode::RethrowError) {
                load_error_payload_local(
                    frame, instruction.error_value_local, instruction.error_type_local);
                if (instruction.has_error_handler) {
                    store_error_message_local(frame, instruction.handler_error_value_local);
                    store_error_type_local(frame, instruction.handler_error_type_local);
                    branches.push_back({words_.emit(0x14000000u), instruction.label, false});
                } else if (entry) {
                    emit_abort();
                } else {
                    store_x(12, frame.offset(frame.error_pointer_slot));
                    store_d(7, frame.offset(frame.error_length_slot));
                    store_d(0, frame.offset(frame.error_type_slot));
                    emit_error_cleanup(function, frame);
                    load_x(12, frame.offset(frame.error_pointer_slot));
                    load_d(7, frame.offset(frame.error_length_slot));
                    load_d(0, frame.offset(frame.error_type_slot));
                    words_.emit(0x9e78000bu);
                    emit_epilogue(frame, false);
                }
            } else if (opcode == Opcode::RaiseErrorValue) {
                require_stack(stack_depth, 5);
                const std::uint32_t first = stack_depth - 5;
                if (instruction.owns_input) {
                    release_owned_string(
                        frame.offset(frame.temp_base + first + 2),
                        frame.offset(frame.temp_base + first + 3));
                }
                load_x(12, frame.offset(frame.temp_base + first));
                load_d(7, frame.offset(frame.temp_base + first + 1));
                load_d(0, frame.offset(frame.temp_base + first + 4));
                words_.emit(0x9e78000bu);
                if (instruction.has_error_handler) {
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_local(frame, instruction.error_type_local);
                    branches.push_back({words_.emit(0x14000000u), instruction.label, false});
                } else if (entry) {
                    emit_abort();
                } else {
                    store_x(12, frame.offset(frame.error_pointer_slot));
                    store_d(7, frame.offset(frame.error_length_slot));
                    load_d(0, frame.offset(frame.temp_base + first + 4));
                    store_d(0, frame.offset(frame.error_type_slot));
                    emit_error_cleanup(function, frame);
                    load_x(12, frame.offset(frame.error_pointer_slot));
                    load_d(7, frame.offset(frame.error_length_slot));
                    load_d(0, frame.offset(frame.error_type_slot));
                    words_.emit(0x9e78000bu);
                    emit_epilogue(frame, false);
                }
                emit_number(machine_ir::null_value());
                store_d(0, frame.offset(frame.temp_base + first));
                stack_depth = first + 1;
            } else if (opcode == Opcode::AssertTruthyString) {
                require_stack(stack_depth, 3);
                const std::uint32_t first = stack_depth - 3;
                load_d(0, frame.offset(frame.temp_base + first));
                emit_truth_w9(0);
                const auto passed = words_.emit(0x35000009u);
                if (instruction.has_error_handler) {
                    load_x(12, frame.offset(frame.temp_base + first + 1));
                    load_d(7, frame.offset(frame.temp_base + first + 2));
                    store_error_message_local(frame, instruction.error_value_local);
                    store_error_type_constant(
                        frame, instruction.error_type_local,
                        instruction.error_type_mask);
                    branches.push_back({words_.emit(0x14000000u), instruction.label, false});
                } else if (entry) {
                    emit_abort();
                } else {
                    load_x(12, frame.offset(frame.temp_base + first + 1));
                    load_d(7, frame.offset(frame.temp_base + first + 2));
                    store_x(12, frame.offset(frame.error_pointer_slot));
                    store_d(7, frame.offset(frame.error_length_slot));
                    emit_error_cleanup(function, frame);
                    load_x(12, frame.offset(frame.error_pointer_slot));
                    load_d(7, frame.offset(frame.error_length_slot));
                    emit_u64(11, instruction.error_type_mask);
                    emit_epilogue(frame, false);
                }
                words_.patch_compare_branch19(passed, words_.offset());
                release_owned_string(
                    frame.offset(frame.temp_base + first + 1),
                    frame.offset(frame.temp_base + first + 2));
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
                load_d(0, frame.offset(frame.temp_base + stack_depth - 1));
                emit_truth_w9(0);
                if (instruction.has_error_handler) {
                    branches.push_back({words_.emit(0x34000009u), instruction.label, true});
                } else {
                    const auto passed = words_.emit(0x35000009u);
                    if (entry) {
                        emit_abort();
                    } else {
                        emit_error_cleanup(function, frame);
                        emit_error_message_registers(instruction.index, instruction.byte_count);
                        emit_u64(11, instruction.error_type_mask);
                        emit_epilogue(frame, false);
                    }
                    words_.patch_compare_branch19(passed, words_.offset());
                }
            } else if (opcode == Opcode::ExitProgram) {
                words_.emit(0xaa1f03e0u);
                call_runtime_slot(14);
                words_.emit(0xd4200000u);
            } else if (opcode == Opcode::ReturnF64) {
                require_stack(stack_depth, 1);
                --stack_depth;
                load_d(0, frame.offset(frame.temp_base + stack_depth));
                if (!entry) {
                    words_.emit(0xf9400beau);
                    store_result_to_x10(0);
                    if (function.may_error) words_.emit(0xaa1f03ebu);
                }
                emit_epilogue(frame, entry);
            } else if (opcode == Opcode::ReturnValues) {
                require_stack(stack_depth, instruction.result_count);
                stack_depth -= instruction.result_count;
                if (!entry) words_.emit(0xf9400beau);
                for (std::uint32_t index = 0; index < instruction.result_count; ++index) {
                    if (entry && (module_.output_kind == machine_ir::OutputKind::MultipleF64 ||
                                  module_.output_kind == machine_ir::OutputKind::MixedSequence ||
                                  module_.output_kind == machine_ir::OutputKind::StructuredSequence)) {
                        load_d(0, frame.offset(frame.temp_base + stack_depth + index));
                        store_entry_output(0, index);
                    } else if (entry) {
                        if (index > 7) throw EncodingFailure("too many arm64 entry return registers");
                        load_d(index, frame.offset(frame.temp_base + stack_depth + index));
                    } else {
                        load_d(0, frame.offset(frame.temp_base + stack_depth + index));
                        store_result_to_x10(index);
                    }
                }
                if (!entry && function.may_error) words_.emit(0xaa1f03ebu);
                emit_epilogue(frame, entry);
            } else {
                throw EncodingFailure("unhandled arm64 machine IR opcode");
            }
            if (stack_depth > frame.max_stack) throw EncodingFailure("arm64 stack exceeds frame");
        }
        for (const auto& branch : branches) {
            const auto found = labels.find(branch.label);
            if (found == labels.end()) throw EncodingFailure("unknown arm64 machine IR label");
            if (branch.compare_branch) words_.patch_compare_branch19(branch.instruction, found->second);
            else words_.patch_branch26(branch.instruction, found->second);
        }
        if (stack_depth != 0) throw EncodingFailure("unbalanced arm64 machine IR function stack");
    }
};

}  // namespace detail

inline Result encode(const machine_ir::Module& module) {
    return detail::Encoder(module).encode();
}

}  // namespace vkf::arm64
