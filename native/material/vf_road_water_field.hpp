#pragma once

#include "native/material/vf_conditioned_stream.hpp"
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>
#include <vector>

namespace vf::material {

struct RoadWearBuffers {
    std::span<const float> coordinates, positions;
    std::span<const std::uint16_t> layer_indices;
    std::span<const float> drivers, albedo, roughness, wetness;
    std::uint64_t potential_cell_count;
};
struct RoadWaterGeometryView {
    std::span<const float> coordinates, positions;
    std::span<const std::uint16_t> layer_indices;
    std::span<const float> water_coverage, water_depth;
};
struct RoadWaterMaterialView : RoadWaterGeometryView {
    std::span<const float> albedo, roughness, wetness;
};
struct RoadWaterWorkingSet {
    // Borrowed coordinate buffers retain the same input ownership as the JS
    // subarray contract. The source wear buffers must outlive these views.
    std::span<const float> coordinates, positions;
    std::span<const std::uint16_t> layer_indices;
    std::vector<float> pooling_driver, water_coverage, water_depth, albedo, roughness, wetness;
    std::size_t sample_count, budget;
    std::uint64_t potential_cell_count;
    bool truncated;

    RoadWaterGeometryView geometry() const {
        return {coordinates, positions, layer_indices, water_coverage, water_depth};
    }
    RoadWaterMaterialView material() const { return {geometry(), albedo, roughness, wetness}; }
    std::size_t vector_bytes() const { return sample_count * 8 * sizeof(float); }
};

inline RoadWaterWorkingSet RealizeRoadWaterCellsReference(
    const ConditionedDemandStream& pooling, const RoadWearBuffers& wear, std::size_t sample_budget
) {
    const auto count = wear.layer_indices.size();
    if (wear.coordinates.size() / 3 != count || wear.coordinates.size() % 3 != 0 ||
        wear.positions.size() != wear.coordinates.size() ||
        wear.drivers.size() / 2 != count || wear.drivers.size() % 2 != 0 ||
        wear.albedo.size() != wear.coordinates.size() || wear.roughness.size() != count ||
        wear.wetness.size() != count || wear.potential_cell_count > 9007199254740991ull)
        throw std::invalid_argument("road wear working set is required");
    if (sample_budget > 65536)
        throw std::range_error("road water sampleBudget must be an integer from 0 to 65536");
    const auto size = std::min(count, sample_budget);
    RoadWaterWorkingSet result{wear.coordinates.first(size * 3), wear.positions.first(size * 3),
        wear.layer_indices.first(size), {}, {}, {}, {}, {}, {}, size, sample_budget,
        wear.potential_cell_count, size < count};
    result.pooling_driver.resize(size); result.water_coverage.resize(size); result.water_depth.resize(size);
    result.albedo.resize(size * 3); result.roughness.resize(size); result.wetness.resize(size);
    const auto clamp = [](double value) {
        // The existing reference's Math.min/Math.max propagates NaN. Its
        // captured binary32 result is the negative canonical quiet NaN.
        if (std::isnan(value)) return -std::numeric_limits<double>::quiet_NaN();
        return std::min(1.0, std::max(0.0, value));
    };
    for (std::size_t sample = 0; sample < size; ++sample) {
        const auto offset = sample * 3;
        const double longitudinal = wear.coordinates[offset], lateral = wear.coordinates[offset + 1];
        result.pooling_driver[sample] = static_cast<float>(SampleConditionedSpatial2Reference(
            pooling, {longitudinal, lateral}, 6.0, 0.0, 1.0));
        const double traffic = wear.drivers[sample * 2], exposure = wear.drivers[sample * 2 + 1];
        const double traffic_load = clamp(0.5 + traffic * 0.6);
        const double rainfall = clamp(0.5 + exposure * 0.35);
        const double edge_drainage = clamp(std::abs(lateral) / 4.5);
        const double rut_retention = traffic_load * (1.0 - edge_drainage);
        const double local_pooling = clamp(0.5 + result.pooling_driver[sample] * 0.35);
        const double surface = wear.layer_indices[sample] == 0 ? 1.0 : 0.0;
        const double base_wetness = wear.wetness[sample], base_roughness = wear.roughness[sample];
        const double coverage = surface * clamp(base_wetness * 0.55 + rainfall * 0.25 +
            local_pooling * 0.35 + rut_retention * 0.3 - edge_drainage * 0.55 - 0.25);
        result.water_coverage[sample] = static_cast<float>(coverage);
        result.water_depth[sample] = static_cast<float>(coverage *
            (0.0015 + local_pooling * 0.004 + rut_retention * 0.003));
        result.roughness[sample] = static_cast<float>(base_roughness + coverage * (0.04 - base_roughness));
        result.wetness[sample] = static_cast<float>(base_wetness + coverage * (1.0 - base_wetness));
        const double diffuse_scale = 1.0 - coverage * 0.35;
        for (std::size_t channel = 0; channel < 3; ++channel)
            result.albedo[offset + channel] = static_cast<float>(wear.albedo[offset + channel] * diffuse_scale);
    }
    return result;
}
} // namespace vf::material
