#pragma once

#include "native/material/vf_road_water_field.hpp"
#include "native/material/vf_road_coordinate_buffers.hpp"

namespace vf::material {

struct RoadWearWorkingSet {
    // Borrowed input coordinates; generated geometry and material share them.
    RoadCoordinateBuffers source;
    std::vector<float> drivers, displacement, albedo, roughness, wetness;
    std::size_t sample_count, budget;
    bool truncated;

    RoadWearBuffers buffers() const {
        return {source.coordinates, source.positions, source.layer_indices,
            drivers, albedo, roughness, wetness, source.potential_cell_count};
    }
    std::size_t vector_bytes() const { return sample_count * 8 * sizeof(float); }
};

inline RoadWearWorkingSet RealizeRoadWearCellsReference(
    const ConditionedDemandStream& traffic_stream, const ConditionedDemandStream& exposure_stream,
    const RoadCoordinateBuffers& road, std::size_t sample_budget
) {
    const auto count = road.layer_indices.size();
    RequireRoadCoordinateBuffers(road);
    if (sample_budget > 65536)
        throw std::range_error("road wear sampleBudget must be an integer from 0 to 65536");
    const auto size = std::min(count, sample_budget);
    RoadWearWorkingSet result{{road.coordinates.first(size * 3), road.positions.first(size * 3),
        road.layer_indices.first(size), road.potential_cell_count}, {}, {}, {}, {}, {}, size,
        sample_budget, size < count};
    result.drivers.resize(size * 2); result.displacement.resize(size);
    result.albedo.resize(size * 3); result.roughness.resize(size); result.wetness.resize(size);
    for (std::size_t sample = 0; sample < size; ++sample) {
        const std::array<double, 2> position{road.coordinates[sample * 3], road.coordinates[sample * 3 + 1]};
        result.drivers[sample * 2] = static_cast<float>(
            SampleConditionedSpatial2Reference(traffic_stream, position, 24.0, 0.0, 0.65));
        result.drivers[sample * 2 + 1] = static_cast<float>(
            SampleConditionedSpatial2Reference(exposure_stream, position, 80.0, 0.0, 0.75));
        const double traffic = result.drivers[sample * 2], exposure = result.drivers[sample * 2 + 1];
        const double wear = std::clamp(0.5 + traffic * 0.35 + exposure * 0.15, 0.0, 1.0);
        const double cell_wetness = std::clamp(0.45 - exposure * 0.3 + wear * 0.1, 0.0, 1.0);
        const double color_scale = (1.0 - wear * 0.18) * (1.0 - cell_wetness * 0.25);
        result.displacement[sample] = static_cast<float>(-0.025 * wear);
        result.wetness[sample] = static_cast<float>(cell_wetness);
        result.roughness[sample] = static_cast<float>(0.95 - wear * 0.45 - cell_wetness * 0.2);
        result.albedo[sample * 3] = static_cast<float>(0.12 * color_scale);
        result.albedo[sample * 3 + 1] = static_cast<float>(0.115 * color_scale);
        result.albedo[sample * 3 + 2] = static_cast<float>(0.11 * color_scale);
    }
    return result;
}
} // namespace vf::material
