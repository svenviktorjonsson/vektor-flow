#pragma once

#include "compiler/native/vkf_wasm_value_layout.hpp"
#include "compiler/native/runtime/vkf_pow_kernel.generated.hpp"

#include <array>
#include <cstdint>
#include <limits>
#include <vector>

namespace vkf::wasm::math_kernels {

/*
 * 2/pi digits from musl __rem_pio2_large.c (Emscripten 4.0.14),
 * originating in FreeBSD msun k_rem_pio2.c.
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this software is freely
 * granted, provided that this notice is preserved.
 */
inline constexpr std::array<std::uint32_t, 66> two_over_pi_digits{{
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62,
    0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A,
    0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
    0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41,
    0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8,
    0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
    0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
    0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08,
    0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
    0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880,
    0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B,
}};

// Emits the existing tagged unary signature: (i32 input_slot) -> i32 result_slot.
// The finite-domain reduction is an integer convolution, not floating-point
// subtraction of a huge approximate multiple of pi. Each base-2^24 product
// and carry fits exactly into f64's integer precision. The 1584-bit 2/pi table
// leaves over 500 guard bits even for the largest finite binary64 input.
template<class Writer>
std::vector<std::uint8_t> emit_trigonometric_function(
    std::uint32_t make_number_index,
    bool cosine
) {
    Writer body;
    body.u32_leb(2);
    body.u32_leb(81); body.u8(0x7c);
    body.u32_leb(4); body.u8(0x7f);
    // f64: 1 input, 2 remainder, 3 square, 4 result, 5..7 significand
    // limbs, 8 carry, 9 scratch, 10 divisor, 11 fraction, 12 quotient,
    // 13..81 exact product limbs. i32: 82 shift, 83 limb, 84 quadrant,
    // 85 requested product limb.
    const auto get = [&](std::uint32_t local) { body.u8(0x20); body.u32_leb(local); };
    const auto set = [&](std::uint32_t local) { body.u8(0x21); body.u32_leb(local); };
    const auto number = [&](double value) { body.u8(0x44); body.f64(value); };
    const auto integer = [&](std::int32_t value) { body.u8(0x41); body.i32_leb(value); };
    const auto wide = [&](std::int64_t value) {
        body.u8(0x42);
        bool more = true;
        while (more) {
            auto byte = static_cast<std::uint8_t>(value & 0x7f);
            value >>= 7;
            const bool sign = (byte & 0x40) != 0;
            more = !((value == 0 && !sign) || (value == -1 && sign));
            if (more) byte |= 0x80;
            body.u8(byte);
        }
    };
    const auto box = [&]() { body.u8(0x10); body.u32_leb(make_number_index); };
    get(0); body.u8(0x2b); body.u32_leb(3); body.u32_leb(values::payload_offset); set(1);
    get(1); number(0); body.u8(0x61); body.u8(0x04); body.u8(0x40);
    if (cosine) number(1); else get(1);
    box(); body.u8(0x0f); body.u8(0x0b);
    get(1); body.u8(0x99); number(std::numeric_limits<double>::max()); body.u8(0x65);
    body.u8(0x45); body.u8(0x04); body.u8(0x40);
    get(1); get(1); body.u8(0xa1); box(); body.u8(0x0f); body.u8(0x0b);
    get(1); body.u8(0x99); set(2);
    get(2); number(0.78539816339744830962); body.u8(0x64);
    body.u8(0x04); body.u8(0x40);

    // |x| = significand * 2^(exponent-52), for normal x requiring reduction.
    get(2); body.u8(0xbd); wide((std::int64_t{1} << 52) - 1); body.u8(0x83);
    wide(std::int64_t{1} << 52); body.u8(0x84); body.u8(0xba); set(9);
    constexpr double base = 16777216.0;
    get(9); number(base * base); body.u8(0xa3); body.u8(0x9c); set(7);
    get(9); number(base); body.u8(0xa3); body.u8(0x9c);
    get(7); number(base); body.u8(0xa2); body.u8(0xa1); set(6);
    get(9); get(6); number(base); body.u8(0xa2); body.u8(0xa1);
    get(7); number(base * base); body.u8(0xa2); body.u8(0xa1); set(5);
    integer(1636);
    get(2); body.u8(0xbd); wide(52); body.u8(0x88); body.u8(0xa7);
    integer(2047); body.u8(0x71); integer(1023); body.u8(0x6b);
    body.u8(0x6b); set(82);
    get(82); integer(24); body.u8(0x6d); set(83);
    get(82); integer(24); body.u8(0x6f); set(82);
    get(82); integer(1023); body.u8(0x6a); body.u8(0xad);
    wide(52); body.u8(0x86); body.u8(0xbf); set(10);

    for (std::uint32_t limb = 0; limb < 69; ++limb) {
        get(8);
        for (std::uint32_t component = 0; component < 3; ++component) {
            if (limb < component || limb - component >= two_over_pi_digits.size()) continue;
            get(5 + component);
            number(two_over_pi_digits[two_over_pi_digits.size() - 1 - (limb - component)]);
            body.u8(0xa2); body.u8(0xa0);
        }
        set(9);
        get(9); number(base); body.u8(0xa3); body.u8(0x9c); set(8);
        get(9); get(8); number(base); body.u8(0xa2); body.u8(0xa1); set(13 + limb);
    }
    const auto limb = [&](std::int32_t offset) {
        get(83); integer(offset); body.u8(0x6a); set(85);
        number(0);
        for (std::uint32_t index = 0; index < 69; ++index) {
            get(13 + index);
            get(85); integer(static_cast<std::int32_t>(index)); body.u8(0x47);
            body.u8(0x1b); // retain previous value unless this index matches
        }
    };
    limb(0); limb(1); number(base); body.u8(0xa2); body.u8(0xa0);
    get(10); body.u8(0xa3); body.u8(0x9c); set(12);
    get(12); get(12); number(0.25); body.u8(0xa2); body.u8(0x9c);
    number(4); body.u8(0xa2); body.u8(0xa1); body.u8(0xaa); set(84);
    limb(0); get(10); body.u8(0xa3); set(11);
    get(11); get(11); body.u8(0x9c); body.u8(0xa1); set(11);
    double scale = base;
    for (std::int32_t offset = -1; offset >= -3; --offset) {
        get(11); limb(offset); get(10); number(scale); body.u8(0xa2);
        body.u8(0xa3); body.u8(0xa0); set(11);
        scale *= base;
    }
    get(11); number(0.5); body.u8(0x66); body.u8(0x04); body.u8(0x40);
    get(11); number(1); body.u8(0xa1); set(11);
    get(84); integer(1); body.u8(0x6a); set(84);
    body.u8(0x0b);
    get(11); number(1.57079632679489661923); body.u8(0xa2); set(2);
    body.u8(0x0b);

    get(2); get(2); body.u8(0xa2); set(3);
    get(84);
    if (cosine) { integer(1); body.u8(0x6a); }
    integer(3); body.u8(0x71); set(84);
    const auto horner = [&](const auto& coefficients) {
        number(coefficients.back());
        for (std::size_t index = coefficients.size() - 1; index > 0; --index) {
            get(3); body.u8(0xa2); number(coefficients[index - 1]); body.u8(0xa0);
        }
    };
    get(84); integer(1); body.u8(0x71); body.u8(0x04); body.u8(0x7c);
    horner(std::array<double, 9>{1, -1.0/2, 1.0/24, -1.0/720,
        1.0/40320, -1.0/3628800, 1.0/479001600, -1.0/87178291200,
        1.0/20922789888000});
    body.u8(0x05);
    horner(std::array<double, 9>{1, -1.0/6, 1.0/120, -1.0/5040,
        1.0/362880, -1.0/39916800, 1.0/6227020800, -1.0/1307674368000,
        1.0/355687428096000});
    get(2); body.u8(0xa2); body.u8(0x0b); set(4);
    get(84); integer(2); body.u8(0x71); body.u8(0x04); body.u8(0x40);
    get(4); body.u8(0x9a); set(4); body.u8(0x0b);
    if (!cosine) {
        get(1); number(0); body.u8(0x63); body.u8(0x04); body.u8(0x40);
        get(4); body.u8(0x9a); set(4); body.u8(0x0b);
    }
    get(4); box(); body.u8(0x0b);
    const auto bytes = body.take();
    Writer encoded;
    encoded.u32_leb(static_cast<std::uint32_t>(bytes.size()));
    encoded.raw(bytes);
    return encoded.take();
}

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
