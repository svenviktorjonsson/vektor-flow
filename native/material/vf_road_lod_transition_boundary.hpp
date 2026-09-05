#pragma once

#include "native/material/vf_road_lod_boundary.hpp"

#include <cstddef>
#include <stdexcept>

namespace vf::material {

struct RoadLodTransitionBoundary {
    RoadSharedBoundary shared;
    std::size_t previous_stride;
    std::size_t current_stride;
};

inline RoadLodTransitionBoundary
ConformRoadLodTransitionBoundaryReference(
    const RoadLodCell& previous_first,
    const RoadLodCell& previous_second,
    const RoadLodCell& current_first,
    const RoadLodCell& current_second,
    std::size_t sample_budget
) {
    const auto same_location = [](const RoadLodCell& first,
                                  const RoadLodCell& second) {
        return first.longitudinal == second.longitudinal &&
            first.lateral == second.lateral;
    };
    const bool same_order =
        same_location(previous_first, current_first) &&
        same_location(previous_second, current_second);
    const bool reversed_order =
        same_location(previous_first, current_second) &&
        same_location(previous_second, current_first);
    if (!same_order && !reversed_order) {
        throw std::invalid_argument(
            "road LOD transition boundary cells changed"
        );
    }

    const auto previous = ConformRoadLodBoundaryReference(
        previous_first,
        previous_second,
        sample_budget
    );
    const auto current = ConformRoadLodBoundaryReference(
        current_first,
        current_second,
        sample_budget
    );
    const RoadSharedBoundary& shared =
        previous.detail_level >= current.detail_level ? previous : current;
    const auto previous_stride = static_cast<std::size_t>(
        shared.denominator / previous.denominator
    );
    const auto current_stride = static_cast<std::size_t>(
        shared.denominator / current.denominator
    );
    return {shared, previous_stride, current_stride};
}

}  // namespace vf::material
