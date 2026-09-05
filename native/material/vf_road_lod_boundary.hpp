#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct RoadLodCell {
    std::int64_t longitudinal;
    std::int64_t lateral;
    std::uint32_t detail_level;
};

struct RoadSharedBoundary {
    std::uint32_t detail_level;
    std::int64_t denominator;
    std::vector<std::pair<std::int64_t, std::int64_t>> numerators;
};

inline RoadSharedBoundary ConformRoadLodBoundaryReference(
    const RoadLodCell& first,
    const RoadLodCell& second,
    std::size_t sample_budget
) {
    constexpr std::int64_t minimum_cell = -0x80000000LL;
    constexpr std::int64_t maximum_cell = 0x7fffffffLL;
    constexpr std::uint32_t maximum_detail_level = 20;
    const auto valid_cell = [](const RoadLodCell& cell) {
        return cell.longitudinal >= minimum_cell &&
            cell.longitudinal <= maximum_cell &&
            cell.lateral >= minimum_cell &&
            cell.lateral <= maximum_cell &&
            cell.detail_level <= maximum_detail_level;
    };
    if (!valid_cell(first) || !valid_cell(second)) {
        throw std::invalid_argument("road LOD boundary cell is invalid");
    }
    const std::int64_t longitudinal_delta =
        std::abs(first.longitudinal - second.longitudinal);
    const std::int64_t lateral_delta =
        std::abs(first.lateral - second.lateral);
    if (longitudinal_delta + lateral_delta != 1) {
        throw std::invalid_argument("road LOD cells must share one edge");
    }

    const std::uint32_t detail_level = std::max(
        first.detail_level,
        second.detail_level
    );
    const std::int64_t denominator = std::int64_t{1} << detail_level;
    const std::size_t sample_count =
        static_cast<std::size_t>(denominator) + 1;
    if (sample_count > sample_budget) {
        throw std::range_error("road LOD boundary exceeds sample budget");
    }
    std::vector<std::pair<std::int64_t, std::int64_t>> numerators;
    numerators.reserve(sample_count);
    if (longitudinal_delta == 0) {
        const std::int64_t longitudinal = first.longitudinal * denominator;
        const std::int64_t lateral =
            std::max(first.lateral, second.lateral) * denominator;
        for (std::int64_t offset = 0; offset <= denominator; ++offset) {
            numerators.emplace_back(longitudinal + offset, lateral);
        }
    } else {
        const std::int64_t longitudinal =
            std::max(first.longitudinal, second.longitudinal) * denominator;
        const std::int64_t lateral = first.lateral * denominator;
        for (std::int64_t offset = 0; offset <= denominator; ++offset) {
            numerators.emplace_back(longitudinal, lateral + offset);
        }
    }
    return {detail_level, denominator, std::move(numerators)};
}

}  // namespace vf::material
