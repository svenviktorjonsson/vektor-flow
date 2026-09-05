#pragma once
#include "native/material/vf_road_construction_field.hpp"
#include "native/material/vf_road_water_field.hpp"
#include "native/material/vf_road_material_energy.hpp"

namespace vf::material {
inline vkf::material::RoadMaterialEnergyAtPrecision<double> EvaluateRoadFieldEnergyReference(
    const RoadConstructionWorkingSet& construction, const RoadWaterWorkingSet& water,
    std::size_t sample_budget
) {
    if (construction.sample_count != water.sample_count ||
        construction.source.coordinates.data() != water.coordinates.data() ||
        construction.source.coordinates.size() != water.coordinates.size() ||
        construction.aggregate_fraction.size() != construction.sample_count ||
        construction.binder_fraction.size() != construction.sample_count ||
        water.water_coverage.size() != water.sample_count || water.albedo.size() / 3 != water.sample_count ||
        water.albedo.size() % 3 != 0)
        throw std::invalid_argument("aligned road construction and water working sets are required");
    if (sample_budget > 65536)
        throw std::range_error("road material sampleBudget must be an integer from 0 to 65536");
    return vkf::material::EvaluateRoadMaterialEnergyKernel<double>(construction.sample_count, sample_budget,
        [&](std::size_t sample) {
            return vkf::material::RoadMaterialSample{construction.aggregate_fraction[sample],
                construction.binder_fraction[sample], water.water_coverage[sample],
                {water.albedo[sample * 3], water.albedo[sample * 3 + 1], water.albedo[sample * 3 + 2]}};
        });
}
} // namespace vf::material
