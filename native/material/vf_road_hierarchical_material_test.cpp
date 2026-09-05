#include "native/material/vf_road_hierarchical_material.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    const vf::material::RoadHierarchicalMaterialDefinition definition{
        {0x3c6ef372fe94f82bull, 0xa54ff53a5f1d36f1ull},
        7,
        1000000000ull,
        1000000000ull,
    };
    std::vector<vf::material::RoadHierarchicalMaterialDemand> demands{
        {8, 1, {8.0, 0.0}},
        {7, 90, {7.25, -0.5}},
        {7, 1, {7.0, 0.0}},
    };
    const auto first =
        vf::material::RealizeRoadHierarchicalMaterialReference(
            definition,
            demands,
            3
        );
    require(first.potential_segments == 1000000000ull &&
                first.potential_samples_per_segment == 1000000000ull &&
                first.samples.size() == 3,
            "road tracer materialized undemanded road surface");
    require(first.samples[0].segment_id == 7 &&
                first.samples[0].sample_id == 1 &&
                first.samples[1].segment_id == 7 &&
                first.samples[1].sample_id == 90 &&
                first.samples[2].segment_id == 8,
            "road material demand order was not canonical");
    require(first.samples[0].population_variation ==
                first.samples[1].population_variation &&
                first.samples[0].segment_variation ==
                first.samples[1].segment_variation,
            "one road segment lost its shared hierarchy");
    require(first.samples[0].crack_intensity !=
                first.samples[1].crack_intensity &&
                first.samples[0].aggregate_variation !=
                first.samples[1].aggregate_variation,
            "local cracks and aggregate ignored surface demand");
    for (const auto& sample : first.samples) {
        require(sample.population_variation >= -1.0 &&
                    sample.population_variation <= 1.0 &&
                    sample.segment_variation >= -1.0 &&
                    sample.segment_variation <= 1.0 &&
                    sample.crack_intensity >= 0.0f &&
                    sample.crack_intensity <= 1.0f &&
                    sample.aggregate_variation >= -1.0f &&
                    sample.aggregate_variation <= 1.0f,
                "road hierarchy escaped distribution bounds");
        const auto& material = sample.material;
        require(material.aggregate_fraction >= 0.0f &&
                    material.binder_fraction >= 0.0f &&
                    material.aggregate_fraction +
                        material.binder_fraction <= 1.0f &&
                    material.water_coverage >= 0.0f &&
                    material.water_coverage <= 1.0f,
                "road mixture escaped passive fraction bounds");
        for (const float albedo : material.albedo) {
            require(albedo >= 0.0f && albedo <= 1.0f,
                    "road albedo escaped passive bounds");
        }
    }
    require(first.energy.sample_count == 3 &&
                first.energy.energy_rgb.size() == 45 &&
                first.energy.violations == 0 &&
                first.energy.minimum_energy >= 0.0f &&
                first.energy.maximum_energy <= 1.0f,
            "road hierarchy escaped white-furnace bounds");

    std::reverse(demands.begin(), demands.end());
    const auto reversed =
        vf::material::RealizeRoadHierarchicalMaterialReference(
            definition,
            demands,
            3
        );
    const auto repeated =
        vf::material::RealizeRoadHierarchicalMaterialReference(
            definition,
            demands,
            3
        );
    require(reversed == first && repeated == first,
            "road material depended on demand traversal");

    auto changed_definition = definition;
    changed_definition.seed[0] ^= 1ull;
    const auto changed =
        vf::material::RealizeRoadHierarchicalMaterialReference(
            changed_definition,
            demands,
            3
        );
    require(changed != first,
            "road material ignored generator seed identity");

    bool rejected = false;
    try {
        static_cast<void>(
            vf::material::RealizeRoadHierarchicalMaterialReference(
                definition,
                demands,
                2
            )
        );
    } catch (const std::range_error&) {
        rejected = true;
    }
    require(rejected,
            "road material demand escaped sample budget");

    std::cout << "hierarchical road material: potential_segments="
              << first.potential_segments
              << " sampled=" << first.samples.size()
              << " energy[min/max]=" << first.energy.minimum_energy
              << '/' << first.energy.maximum_energy << '\n';
    return 0;
}
