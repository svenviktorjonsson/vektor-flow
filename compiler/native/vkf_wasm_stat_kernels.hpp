#pragma once

#include "compiler/native/vkf_wasm_value_layout.hpp"
#include <cstdint>
#include <vector>

namespace vkf::wasm::stat_kernels {

enum class Reduction { Sum, Mean, Variance, StdDev, Range, Count };
// Internal lowering flags, not a public VKF API. Small fixed-value reductions
// and axis groups seed from their first value. Native local/list reductions
// seed from +0. Only dynamic list sum/count accept an empty input.
inline constexpr std::uint32_t seed_first = 1;
inline constexpr std::uint32_t allow_empty = 2;

namespace detail {
template<class Writer> struct Code {
    Writer body;
    void op(std::uint8_t byte) { body.u8(byte); }
    void get(std::uint32_t n) { op(0x20); body.u32_leb(n); }
    void set(std::uint32_t n) { op(0x21); body.u32_leb(n); }
    void integer(std::int32_t n) { op(0x41); body.i32_leb(n); }
    void number(double n) { op(0x44); body.f64(n); }
    void load(std::uint32_t offset) { op(0x28); body.u32_leb(2); body.u32_leb(offset); }
    void store(std::uint32_t offset) { op(0x36); body.u32_leb(2); body.u32_leb(offset); }
    void load_number(std::uint32_t offset) { op(0x2b); body.u32_leb(3); body.u32_leb(offset); }
    void store_number(std::uint32_t offset) { op(0x39); body.u32_leb(3); body.u32_leb(offset); }
    void call(std::uint32_t index) { op(0x10); body.u32_leb(index); }
    void begin_if(std::uint8_t type=0x40) { op(0x04); op(type); }
    std::vector<std::uint8_t> finish() {
        op(0x0b);
        auto bytes=body.take(); Writer encoded;
        encoded.u32_leb(static_cast<std::uint32_t>(bytes.size())); encoded.raw(bytes);
        return encoded.take();
    }
};
} // namespace detail

// (i32 value_slot, i32 state_pointer, i32 variance_pass) -> void.
// Recurses through existing numeric aggregate transport slots in source order.
// State: count u32 +0, flags u32 +4, sum f64 +8, minimum +16,
// maximum +24, mean +32, sum of squared deviations +40 (48 bytes).
// The compiler validates static layouts/diagnostics before invoking this helper.
template<class Writer>
std::vector<std::uint8_t> emit_numeric_visit_function(std::uint32_t self_index) {
    detail::Code<Writer> c;
    c.body.u32_leb(2);
    c.body.u32_leb(4); c.op(0x7f); // 3 index, 4 payload, 5 stride, 6 tag
    c.body.u32_leb(1); c.op(0x7c); // 7 value / deviation
    c.get(0); c.load(values::tag_offset); c.set(6);
    c.get(6); c.integer(static_cast<std::int32_t>(values::Tag::Number)); c.op(0x46); c.begin_if();
    c.get(0); c.load_number(values::payload_offset); c.set(7);
    c.get(2); c.begin_if();
    c.get(7); c.get(1); c.load_number(32); c.op(0xa1); c.set(7);
    c.get(1); c.get(1); c.load_number(40); c.get(7); c.get(7); c.op(0xa2); c.op(0xa0); c.store_number(40);
    c.op(0x05);
    c.get(1); c.load(0); c.op(0x45); c.begin_if();
    for (const auto offset : {16u,24u}) { c.get(1); c.get(7); c.store_number(offset); }
    c.get(1); c.get(1); c.load(4); c.integer(seed_first); c.op(0x71); c.begin_if(0x7c);
    c.get(7);
    c.op(0x05); c.number(0); c.get(7); c.op(0xa0); c.op(0x0b); c.store_number(8);
    c.op(0x05);
    c.get(1); c.get(1); c.load_number(8); c.get(7); c.op(0xa0); c.store_number(8);
    // SSE MINSD/MAXSD choose the later operand for equal or unordered values.
    // WASM f64.min/max have different NaN and signed-zero behavior.
    for (const auto offset : {16u,24u}) {
        c.get(1); c.get(1); c.load_number(offset); c.get(7);
        c.get(1); c.load_number(offset); c.get(7); c.op(offset==16 ? 0x63 : 0x64);
        c.op(0x1b); c.store_number(offset);
    }
    c.op(0x0b);
    c.get(1); c.get(1); c.load(0); c.integer(1); c.op(0x6a); c.store(0);
    c.op(0x0b);
    c.op(0x0f);
    c.op(0x0b);
    c.get(6); c.integer(static_cast<std::int32_t>(values::Tag::Array)); c.op(0x46); c.begin_if();
    c.integer(values::pointer_size); c.set(5);
    c.get(0); c.load(values::payload_offset); c.set(4);
    c.op(0x05);
    c.get(6); c.integer(static_cast<std::int32_t>(values::Tag::Record)); c.op(0x47); c.begin_if(); c.op(0x00); c.op(0x0b);
    c.integer(values::record_entry_size); c.set(5);
    c.get(0); c.load(values::payload_offset); c.integer(values::record_value_offset); c.op(0x6a); c.set(4);
    c.op(0x0b);
    c.op(0x02); c.op(0x40); c.op(0x03); c.op(0x40);
    c.get(3); c.get(0); c.load(values::length_offset); c.op(0x4f); c.op(0x0d); c.body.u32_leb(1);
    c.get(4); c.get(3); c.get(5); c.op(0x6c); c.op(0x6a); c.load(0);
    c.get(1); c.get(2); c.call(self_index);
    c.get(3); c.integer(1); c.op(0x6a); c.set(3);
    c.op(0x0c); c.body.u32_leb(0); c.op(0x0b); c.op(0x0b);
    return c.finish();
}

// (i32 value_slot, i32 ddof, i32 lowering_flags) -> i32 numeric result slot.
// allocator: (i32 bytes)->i32; make_number: (f64)->i32.
// Invalid dynamic input aborts in the native backend; unreachable preserves
// that failure here. Static native diagnostics remain the lowerer's job.
template<class Writer>
std::vector<std::uint8_t> emit_reduction_function(
    std::uint32_t allocator_index,
    std::uint32_t make_number_index,
    std::uint32_t visitor_index,
    Reduction operation
) {
    detail::Code<Writer> c;
    c.body.u32_leb(1); c.body.u32_leb(1); c.op(0x7f); // local 3 state
    c.integer(48); c.call(allocator_index); c.set(3);
    c.get(3); c.integer(0); c.store(0);
    c.get(3); c.get(2); c.store(4);
    for(const auto offset : {8u,16u,24u,32u,40u}) {
        c.get(3); c.number(0); c.store_number(offset);
    }
    c.get(0); c.get(3); c.integer(0); c.call(visitor_index);
    c.get(3); c.load(0); c.op(0x45); c.begin_if();
    if(operation==Reduction::Sum || operation==Reduction::Count) {
        c.get(2); c.integer(allow_empty); c.op(0x71); c.begin_if();
        c.number(0); c.call(make_number_index); c.op(0x0f); c.op(0x0b);
    }
    c.op(0x00); c.op(0x0b);
    if(operation==Reduction::Variance || operation==Reduction::StdDev) {
        c.get(3); c.load(0); c.get(1); c.op(0x4d); c.begin_if(); c.op(0x00); c.op(0x0b);
        c.get(3); c.get(3); c.load_number(8); c.get(3); c.load(0); c.op(0xb8); c.op(0xa3); c.store_number(32);
        c.get(0); c.get(3); c.integer(1); c.call(visitor_index);
        c.get(3); c.load_number(40); c.get(3); c.load(0); c.get(1); c.op(0x6b); c.op(0xb8); c.op(0xa3);
        if(operation==Reduction::StdDev) c.op(0x9f);
    } else if(operation==Reduction::Range) {
        c.get(3); c.load_number(24); c.get(3); c.load_number(16); c.op(0xa1);
    } else if(operation==Reduction::Count) {
        c.get(3); c.load(0); c.op(0xb8);
    } else {
        c.get(3); c.load_number(8);
        if(operation==Reduction::Mean) { c.get(3); c.load(0); c.op(0xb8); c.op(0xa3); }
    }
    c.call(make_number_index);
    return c.finish();
}

} // namespace vkf::wasm::stat_kernels
