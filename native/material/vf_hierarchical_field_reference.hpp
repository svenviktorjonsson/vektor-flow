#pragma once

#include <array>
#include <cmath>
#include <cstdint>
#include <stdexcept>

namespace vf::material {

inline std::uint64_t MixHierarchicalKey64(std::uint64_t value) {
    value += 0x9e3779b97f4a7c15ull;
    value = (value ^ (value >> 30)) * 0xbf58476d1ce4e5b9ull;
    value = (value ^ (value >> 27)) * 0x94d049bb133111ebull;
    return value ^ (value >> 31);
}

inline double HierarchicalSignedUnit(std::uint64_t value) {
    constexpr double inverse = 1.0 / 9007199254740992.0;
    return 2.0 * static_cast<double>(value >> 11) * inverse - 1.0;
}

inline double HierarchicalFade(double value) {
    return value * value * value *
        (value * (value * 6.0 - 15.0) + 10.0);
}

inline double SampleHierarchicalField2DReference(
    std::uint64_t key,
    const std::array<double, 2>& position,
    double correlation_length,
    std::uint64_t channel
) {
    if (!std::isfinite(correlation_length) ||
        !(correlation_length > 0.0)) {
        throw std::invalid_argument(
            "hierarchical field correlation length must be positive"
        );
    }
    for (const double coordinate : position) {
        if (!std::isfinite(coordinate)) {
            throw std::invalid_argument(
                "hierarchical field position is not finite"
            );
        }
    }
    const double x = position[0] / correlation_length;
    const double y = position[1] / correlation_length;
    const auto cell_x = static_cast<std::int64_t>(std::floor(x));
    const auto cell_y = static_cast<std::int64_t>(std::floor(y));
    const double fraction_x = x - static_cast<double>(cell_x);
    const double fraction_y = y - static_cast<double>(cell_y);
    auto corner = [key, channel](
        std::int64_t corner_x,
        std::int64_t corner_y
    ) {
        const auto x_word = static_cast<std::uint64_t>(corner_x);
        const auto y_word = static_cast<std::uint64_t>(corner_y);
        return HierarchicalSignedUnit(MixHierarchicalKey64(
            key ^
            MixHierarchicalKey64(x_word) ^
            MixHierarchicalKey64(
                y_word + 0x517cc1b727220a95ull
            ) ^
            MixHierarchicalKey64(channel)
        ));
    };
    const double lower_left = corner(cell_x, cell_y);
    const double lower_right = corner(cell_x + 1, cell_y);
    const double upper_left = corner(cell_x, cell_y + 1);
    const double upper_right = corner(cell_x + 1, cell_y + 1);
    const double faded_x = HierarchicalFade(fraction_x);
    const double faded_y = HierarchicalFade(fraction_y);
    const double lower = lower_left +
        (lower_right - lower_left) * faded_x;
    const double upper = upper_left +
        (upper_right - upper_left) * faded_x;
    return lower + (upper - lower) * faded_y;
}

}  // namespace vf::material
