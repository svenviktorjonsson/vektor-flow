#pragma once

/* Philox constants and round layout follow Random123 v1.14.0, as in
 * web/vf-ui/vf-demand-random.mjs.
 * Copyright 2010-2012, D. E. Shaw Research. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 * - Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 * - Neither the name of D. E. Shaw Research nor the names of its contributors
 *   may be used to endorse or promote products derived from this software
 *   without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
#include <array>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <string>

namespace vf::material {

// Existing conditionedNodeStreamReference seam, not a new public identity.
struct ConditionedDemandStream {
    std::array<std::uint32_t, 2> key;
    std::array<std::uint32_t, 2> counter_prefix;
};

inline std::array<std::uint32_t, 4> Philox4x32_10(
    std::array<std::uint32_t, 4> words, std::array<std::uint32_t, 2> key
) {
    for (unsigned round = 0; round < 10; ++round) {
        const std::uint64_t first = std::uint64_t{0xd2511f53} * words[0];
        const std::uint64_t second = std::uint64_t{0xcd9e8d57} * words[2];
        words = {static_cast<std::uint32_t>(second >> 32) ^ words[1] ^ key[0],
            static_cast<std::uint32_t>(second),
            static_cast<std::uint32_t>(first >> 32) ^ words[3] ^ key[1],
            static_cast<std::uint32_t>(first)};
        key[0] += 0x9e3779b9u;
        key[1] += 0xbb67ae85u;
    }
    return words;
}

inline double SampleConditionedSpatial2Reference(
    const ConditionedDemandStream& stream, std::array<double, 2> position,
    double correlation_length, double mean, double amplitude
) {
    for (std::size_t index = 0; index < position.size(); ++index) {
        if (!std::isfinite(position[index])) throw std::range_error(
            "spatial correlation position[" + std::to_string(index) + "] must be finite");
    }
    if (!std::isfinite(correlation_length) || !(correlation_length > 0))
        throw std::range_error("spatial correlation length must be finite and positive");
    if (!std::isfinite(mean)) throw std::range_error("spatial correlation mean must be finite");
    if (!std::isfinite(amplitude) || amplitude < 0)
        throw std::range_error("spatial correlation amplitude must be finite and non-negative");
    const double x = position[0] / correlation_length;
    const double y = position[1] / correlation_length;
    if (!std::isfinite(x) || !std::isfinite(y))
        throw std::range_error("normalized spatial correlation position must be finite");
    const double cell_x = std::floor(x), cell_y = std::floor(y);
    if (cell_x < -2147483648.0 || cell_x > 2147483646.0 ||
        cell_y < -2147483648.0 || cell_y > 2147483646.0)
        throw std::range_error("spatial correlation position exceeds the bounded lattice domain");
    const auto corner = [&](int dx, int dy) {
        const auto words = Philox4x32_10({stream.counter_prefix[0], stream.counter_prefix[1],
            static_cast<std::uint32_t>(static_cast<std::int64_t>(cell_x) + dx),
            static_cast<std::uint32_t>(static_cast<std::int64_t>(cell_y) + dy)}, stream.key);
        return -1.0 + 2.0 * (words[0] / 4294967296.0);
    };
    const auto fade = [](double value) {
        return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
    };
    const auto interpolate = [](double a, double b, double t) { return a + (b - a) * t; };
    const double lower = interpolate(corner(0, 0), corner(1, 0), fade(x - cell_x));
    const double upper = interpolate(corner(0, 1), corner(1, 1), fade(x - cell_x));
    return mean + amplitude * interpolate(lower, upper, fade(y - cell_y));
}
} // namespace vf::material
