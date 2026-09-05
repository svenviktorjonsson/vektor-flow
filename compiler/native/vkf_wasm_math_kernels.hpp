#pragma once

#include "compiler/native/vkf_wasm_value_layout.hpp"
#include "compiler/native/runtime/vkf_pow_kernel.generated.hpp"

#include <array>
#include <cstdint>
#include <limits>
#include <vector>

namespace vkf::wasm::math_kernels {

template<class Writer>
std::vector<std::uint8_t> emit_natural_log_function(
    std::uint32_t make_number_index
) {
    Writer body;
    const auto get = [&](std::uint32_t local) { body.u8(0x20); body.u32_leb(local); };
    const auto set = [&](std::uint32_t local) { body.u8(0x21); body.u32_leb(local); };
    const auto tee = [&](std::uint32_t local) { body.u8(0x22); body.u32_leb(local); };
    const auto integer = [&](std::int32_t value) { body.u8(0x41); body.i32_leb(value); };
    const auto load = [&]() { body.u8(0x2b); body.u32_leb(3); body.u32_leb(values::payload_offset); };
    const auto number = [&](double value) { body.u8(0x44); body.f64(value); };
    const auto box = [&]() { body.u8(0x10); body.u32_leb(make_number_index); };
    body.u32_leb(2);
    body.u32_leb(1);
    body.u8(0x7f);
    body.u32_leb(5);
    body.u8(0x7c);

    get(0); load(); set(2);
    // Native ln has defined IEEE-754 boundary results. Handle these before
    // normalization so positive infinity never enters an unbounded loop.
    get(2); get(2); body.u8(0x62);
    get(2); number(std::numeric_limits<double>::infinity()); body.u8(0x61);
    body.u8(0x72); body.u8(0x04); body.u8(0x40);
    get(2); box(); body.u8(0x0f); body.u8(0x0b);
    get(2); number(0); body.u8(0x61); body.u8(0x04); body.u8(0x40);
    number(-std::numeric_limits<double>::infinity()); box(); body.u8(0x0f); body.u8(0x0b);
    get(2); number(0); body.u8(0x63); body.u8(0x04); body.u8(0x40);
    number(std::numeric_limits<double>::quiet_NaN()); box(); body.u8(0x0f); body.u8(0x0b);

    integer(0);
    set(1);
    get(0);
    load();
    set(2);

    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    get(2);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0x63);
    body.u8(0x0d);
    body.u32_leb(1);
    get(2);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0xa3);
    set(2);
    get(1);
    integer(1);
    body.u8(0x6a);
    set(1);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);

    body.u8(0x02);
    body.u8(0x40);
    body.u8(0x03);
    body.u8(0x40);
    get(2);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0x66);
    body.u8(0x0d);
    body.u32_leb(1);
    get(2);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0xa2);
    set(2);
    get(1);
    integer(1);
    body.u8(0x6b);
    set(1);
    body.u8(0x0c);
    body.u32_leb(0);
    body.u8(0x0b);
    body.u8(0x0b);

    get(2);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0xa1);
    get(2);
    body.u8(0x44);
    body.f64(1.0);
    body.u8(0xa0);
    body.u8(0xa3);
    tee(3);
    get(3);
    body.u8(0xa2);
    set(4);
    get(3);
    set(5);
    get(3);
    set(6);
    for (std::uint32_t divisor = 3; divisor <= 35; divisor += 2) {
        get(5);
        get(4);
        body.u8(0xa2);
        tee(5);
        body.u8(0x44);
        body.f64(static_cast<double>(divisor));
        body.u8(0xa3);
        get(6);
        body.u8(0xa0);
        set(6);
    }
    get(6);
    body.u8(0x44);
    body.f64(2.0);
    body.u8(0xa2);
    get(1);
    body.u8(0xb7);
    body.u8(0x44);
    body.f64(0.69314718055994530942);
    body.u8(0xa2);
    body.u8(0xa0);
    body.u8(0x10);
    body.u32_leb(make_number_index);
    body.u8(0x0b);
    const auto bytes = body.take();
    Writer encoded;
    encoded.u32_leb(static_cast<std::uint32_t>(bytes.size()));
    encoded.raw(bytes);
    return encoded.take();
}

namespace detail {
template<class Writer> struct ScalarCode {
    Writer body;
    void op(std::uint8_t value) { body.u8(value); }
    void get(std::uint32_t value) { op(0x20); body.u32_leb(value); }
    void set(std::uint32_t value) { op(0x21); body.u32_leb(value); }
    void number(double value) { op(0x44); body.f64(value); }
    void integer(std::int32_t value) { op(0x41); body.i32_leb(value); }
    void load() { op(0x2b); body.u32_leb(3); body.u32_leb(values::payload_offset); }
    void call(std::uint32_t index) { op(0x10); body.u32_leb(index); }
    void branch_if(std::uint8_t type=0x40) { op(0x04); op(type); }
    std::vector<std::uint8_t> finish() {
        op(0x0b); auto bytes=body.take(); Writer encoded;
        encoded.u32_leb(static_cast<std::uint32_t>(bytes.size())); encoded.raw(bytes); return encoded.take();
    }
};
}

// Tagged exp: finite reduction stays in [-ln(2)/2, ln(2)/2]. Splitting
// ln(2) keeps the subtraction accurate near the overflow/underflow limits.
template<class Writer>
std::vector<std::uint8_t> emit_exponential_function(std::uint32_t make_number_index) {
    detail::ScalarCode<Writer> c;
    c.body.u32_leb(2); c.body.u32_leb(19); c.op(0x7c); c.body.u32_leb(1); c.op(0x7f);
    // Pairs: remainder 1/5, term 6/7, sum 3/8. Product 9/10;
    // scratch 11..18, divisor 19, binary exponent i32 20.
    const auto finish_value=[&]() { c.call(make_number_index); c.op(0x0f); };
    const auto product=[&](unsigned left,unsigned right) {
        c.get(left); c.get(right); c.op(0xa2); c.set(9);
        c.get(left); c.number(134217729); c.op(0xa2); c.set(15);
        c.get(15); c.get(15); c.get(left); c.op(0xa1); c.op(0xa1); c.set(11);
        c.get(left); c.get(11); c.op(0xa1); c.set(12);
        c.get(right); c.number(134217729); c.op(0xa2); c.set(15);
        c.get(15); c.get(15); c.get(right); c.op(0xa1); c.op(0xa1); c.set(13);
        c.get(right); c.get(13); c.op(0xa1); c.set(14);
        c.get(11); c.get(13); c.op(0xa2); c.get(9); c.op(0xa1);
        c.get(11); c.get(14); c.op(0xa2); c.op(0xa0);
        c.get(12); c.get(13); c.op(0xa2); c.op(0xa0);
        c.get(12); c.get(14); c.op(0xa2); c.op(0xa0); c.set(10);
    };
    c.get(0); c.load(); c.set(1);
    c.get(1); c.get(1); c.op(0x62); c.branch_if(); c.get(1); finish_value(); c.op(0x0b);
    c.get(1); c.number(709.782712893383973096); c.op(0x64); c.branch_if();
    c.number(std::numeric_limits<double>::infinity()); finish_value(); c.op(0x0b);
    c.get(1); c.number(-745.13321910194110842); c.op(0x63); c.branch_if();
    c.number(0); finish_value(); c.op(0x0b);
    c.get(1); c.number(1.4426950408889634074); c.op(0xa2); c.op(0x9e); c.op(0xaa); c.set(20);
    c.get(1); c.get(20); c.op(0xb7); c.number(6.93147180369123816490e-1); c.op(0xa2); c.op(0xa1); c.set(2);
    c.get(20); c.op(0xb7); c.number(1.90821492927058770002e-10); c.op(0xa2); c.set(4);
    c.get(2); c.get(4); c.op(0xa1); c.set(1);
    c.get(2); c.get(1); c.op(0xa1); c.get(4); c.op(0xa1); c.set(5);
    c.number(1); c.set(6); c.number(1); c.set(3);
    for(unsigned degree=1;degree<=24;++degree) {
        product(6,1);
        c.get(10); c.get(6); c.get(5); c.op(0xa2); c.op(0xa0);
        c.get(7); c.get(1); c.op(0xa2); c.op(0xa0);
        c.get(7); c.get(5); c.op(0xa2); c.op(0xa0); c.set(10);
        c.get(9); c.get(10); c.op(0xa0); c.set(6);
        c.get(9); c.get(6); c.op(0xa1); c.get(10); c.op(0xa0); c.set(7);
        c.number(degree); c.set(19);
        c.get(6); c.get(19); c.op(0xa3); c.set(16);
        product(16,19);
        c.get(6); c.get(9); c.op(0xa1); c.get(10); c.op(0xa1); c.get(7); c.op(0xa0);
        c.get(19); c.op(0xa3); c.set(7);
        c.get(16); c.get(7); c.op(0xa0); c.set(6);
        c.get(16); c.get(6); c.op(0xa1); c.get(7); c.op(0xa0); c.set(7);
        c.get(3); c.get(6); c.op(0xa0); c.set(9);
        c.get(9); c.get(3); c.op(0xa1); c.set(15);
        c.get(3); c.get(9); c.get(15); c.op(0xa1); c.op(0xa1);
        c.get(6); c.get(15); c.op(0xa1); c.op(0xa0);
        c.get(8); c.op(0xa0); c.get(7); c.op(0xa0); c.set(10);
        c.get(9); c.get(10); c.op(0xa0); c.set(3);
        c.get(9); c.get(3); c.op(0xa1); c.get(10); c.op(0xa0); c.set(8);
    }
    c.get(20); c.integer(1023); c.op(0x4a); c.branch_if();
    c.get(3); c.number(2); c.op(0xa2); c.set(3);
    c.get(20); c.integer(1); c.op(0x6b); c.set(20); c.op(0x0b);
    c.number(1); c.set(4);
    c.get(20); c.integer(-1022); c.op(0x48); c.branch_if();
    c.number(2.22507385850720138309e-308); c.set(4);
    c.get(20); c.integer(1022); c.op(0x6a); c.set(20); c.op(0x0b);
    c.get(20); c.integer(1023); c.op(0x6a); c.op(0xad);
    c.op(0x42); c.body.i32_leb(52); c.op(0x86); c.op(0xbf);
    c.get(3); c.op(0xa2); c.get(4); c.op(0xa2);
    c.call(make_number_index); return c.finish();
}

// Tagged wrapper around the dependency-free canonical numeric kernel. Its
// original function label is an f64 block; all exits converge before boxing.
template<class Writer>
std::vector<std::uint8_t> emit_power_function(std::uint32_t make_number_index) {
    detail::ScalarCode<Writer> c;
    for (auto byte : generated::power_locals) c.op(byte);
    c.get(0); c.load(); c.set(2);
    c.get(1); c.load(); c.set(3);
    for (auto byte : generated::power_instructions) c.op(byte);
    c.call(make_number_index);
    return c.finish();
}

} // namespace vkf::wasm::math_kernels
