#pragma once
#include "native/material/vf_conditioned_stream.hpp"
#include "native/material/vf_road_coordinate_buffers.hpp"
#include <algorithm>
#include <vector>

namespace vf::material {
struct RoadConstructionWorkingSet {
    RoadCoordinateBuffers source;
    std::vector<float> drivers, displacement, aggregate_fraction, binder_fraction,
        void_fraction, albedo, roughness;
    std::size_t sample_count, budget;
    bool truncated;
    std::size_t vector_bytes() const { return sample_count * 10 * sizeof(float); }
};

inline RoadConstructionWorkingSet RealizeRoadConstructionCellsReference(
    const ConditionedDemandStream& aggregate_stream, const ConditionedDemandStream& binder_stream,
    const RoadCoordinateBuffers& road, std::size_t sample_budget
) {
    RequireRoadCoordinateBuffers(road);
    if (sample_budget > 65536)
        throw std::range_error("road construction sampleBudget must be an integer from 0 to 65536");
    const auto size = std::min(road.layer_indices.size(), sample_budget);
    RoadConstructionWorkingSet result{{road.coordinates.first(size * 3), road.positions.first(size * 3),
        road.layer_indices.first(size), road.potential_cell_count}, {}, {}, {}, {}, {}, {}, {},
        size, sample_budget, size < road.layer_indices.size()};
    result.drivers.resize(size * 2); result.displacement.resize(size);
    result.aggregate_fraction.resize(size); result.binder_fraction.resize(size); result.void_fraction.resize(size);
    result.albedo.resize(size * 3); result.roughness.resize(size);
    struct Profile {
        double aggregate, binder;
        std::array<double, 3> aggregate_color, binder_color;
        double roughness, relief;
    };
    static constexpr std::array<Profile, 3> profiles{{
        {0.58, 0.34, {0.26, 0.25, 0.24}, {0.045, 0.043, 0.04}, 0.78, 0.006},
        {0.72, 0.18, {0.23, 0.21, 0.19}, {0.06, 0.055, 0.05}, 0.88, 0.002},
        {0.82, 0.08, {0.31, 0.28, 0.24}, {0.08, 0.073, 0.065}, 0.94, 0.001},
    }};
    for (std::size_t sample = 0; sample < size; ++sample) {
        const std::array<double, 2> position{road.coordinates[sample * 3], road.coordinates[sample * 3 + 1]};
        const double aggregate_driver = SampleConditionedSpatial2Reference(aggregate_stream, position, 0.45, 0.0, 1.0);
        const double binder_driver = SampleConditionedSpatial2Reference(binder_stream, position, 1.2, 0.0, 1.0);
        result.drivers[sample * 2] = static_cast<float>(aggregate_driver);
        result.drivers[sample * 2 + 1] = static_cast<float>(binder_driver);
        const auto& profile = profiles[std::min<std::size_t>(road.layer_indices[sample], profiles.size() - 1)];
        const double aggregate = profile.aggregate + aggregate_driver * 0.025;
        const double binder = profile.binder + binder_driver * 0.015;
        const double voids = 1.0 - aggregate - binder;
        result.aggregate_fraction[sample] = static_cast<float>(aggregate);
        result.binder_fraction[sample] = static_cast<float>(binder);
        result.void_fraction[sample] = static_cast<float>(voids);
        result.displacement[sample] = static_cast<float>(aggregate_driver * profile.relief);
        result.roughness[sample] = static_cast<float>(std::clamp(
            profile.roughness + aggregate_driver * 0.04 - binder_driver * 0.03, 0.0, 1.0));
        for (std::size_t channel = 0; channel < 3; ++channel)
            result.albedo[sample * 3 + channel] = static_cast<float>(
                aggregate * profile.aggregate_color[channel] + binder * profile.binder_color[channel] + voids * 0.015);
    }
    return result;
}
} // namespace vf::material
