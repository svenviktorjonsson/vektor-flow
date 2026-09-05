#pragma once

#include "native/material/vf_hierarchical_field_reference.hpp"
#include "native/material/vf_road_material_energy.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct RoadHierarchicalMaterialDefinition {
    std::array<std::uint64_t, 2> seed;
    std::uint64_t road_id;
    std::uint64_t potential_segments;
    std::uint64_t potential_samples_per_segment;
};

struct RoadHierarchicalMaterialDemand {
    std::uint64_t segment_id;
    std::uint64_t sample_id;
    std::array<double, 2> road_position;
};

struct RoadHierarchicalMaterialSample {
    std::uint64_t segment_id;
    std::uint64_t sample_id;
    std::array<double, 2> road_position;
    double population_variation;
    double segment_variation;
    float crack_intensity;
    float aggregate_variation;
    vkf::material::RoadMaterialSample material;
};

struct RoadHierarchicalMaterialRealization {
    std::uint64_t potential_segments;
    std::uint64_t potential_samples_per_segment;
    std::vector<RoadHierarchicalMaterialSample> samples;
    vkf::material::RoadMaterialEnergy energy;
};

inline bool operator==(
    const RoadHierarchicalMaterialSample& first,
    const RoadHierarchicalMaterialSample& second
) {
    return first.segment_id == second.segment_id &&
        first.sample_id == second.sample_id &&
        first.road_position == second.road_position &&
        first.population_variation == second.population_variation &&
        first.segment_variation == second.segment_variation &&
        first.crack_intensity == second.crack_intensity &&
        first.aggregate_variation == second.aggregate_variation &&
        first.material.aggregate_fraction ==
            second.material.aggregate_fraction &&
        first.material.binder_fraction ==
            second.material.binder_fraction &&
        first.material.water_coverage ==
            second.material.water_coverage &&
        first.material.albedo == second.material.albedo;
}

inline bool SameRoadHierarchicalMaterialEnergy(
    const vkf::material::RoadMaterialEnergy& first,
    const vkf::material::RoadMaterialEnergy& second
) {
    return first.sample_count == second.sample_count &&
        first.cosine_probes == second.cosine_probes &&
        first.fresnel_f0 == second.fresnel_f0 &&
        first.energy_rgb == second.energy_rgb &&
        first.minimum_energy == second.minimum_energy &&
        first.maximum_energy == second.maximum_energy &&
        first.violations == second.violations &&
        first.truncated == second.truncated;
}

inline bool operator==(
    const RoadHierarchicalMaterialRealization& first,
    const RoadHierarchicalMaterialRealization& second
) {
    return first.potential_segments == second.potential_segments &&
        first.potential_samples_per_segment ==
            second.potential_samples_per_segment &&
        first.samples == second.samples &&
        SameRoadHierarchicalMaterialEnergy(first.energy, second.energy);
}

inline bool operator!=(
    const RoadHierarchicalMaterialRealization& first,
    const RoadHierarchicalMaterialRealization& second
) {
    return !(first == second);
}

inline std::uint64_t RoadHierarchicalMaterialRootKey(
    const RoadHierarchicalMaterialDefinition& definition
) {
    return MixHierarchicalKey64(
        definition.seed[0] ^
        MixHierarchicalKey64(definition.seed[1]) ^
        MixHierarchicalKey64(definition.road_id)
    );
}

inline RoadHierarchicalMaterialSample
SampleRoadHierarchicalMaterialReference(
    const RoadHierarchicalMaterialDefinition& definition,
    const RoadHierarchicalMaterialDemand& demand
) {
    if (demand.segment_id >= definition.potential_segments ||
        demand.sample_id >= definition.potential_samples_per_segment) {
        throw std::out_of_range(
            "road material demand is outside potential surface"
        );
    }
    const std::uint64_t root =
        RoadHierarchicalMaterialRootKey(definition);
    const std::array<double, 2> segment_position{
        static_cast<double>(demand.segment_id),
        0.0,
    };
    const double population_variation =
        SampleHierarchicalField2DReference(
            root,
            segment_position,
            64.0,
            0
        );
    const std::uint64_t segment_key = MixHierarchicalKey64(
        root ^ MixHierarchicalKey64(demand.segment_id) ^
        0x243f6a8885a308d3ull
    );
    const double segment_variation =
        HierarchicalSignedUnit(segment_key);
    const float crack_intensity = static_cast<float>(
        0.5 + 0.5 * SampleHierarchicalField2DReference(
            segment_key,
            demand.road_position,
            1.5,
            1
        )
    );
    const float aggregate_variation = static_cast<float>(
        SampleHierarchicalField2DReference(
            segment_key,
            demand.road_position,
            0.12,
            2
        )
    );
    const float aggregate_fraction = static_cast<float>(std::clamp(
        0.58 + 0.06 * population_variation +
            0.05 * segment_variation +
            0.06 * aggregate_variation,
        0.35,
        0.75
    ));
    const float binder_fraction = static_cast<float>(std::clamp(
        0.92 - aggregate_fraction - 0.12 * crack_intensity,
        0.12,
        0.55
    ));
    const double base =
        0.09 + 0.015 * population_variation +
        0.01 * segment_variation +
        0.012 * aggregate_variation -
        0.035 * crack_intensity;
    const std::array<float, 3> albedo{
        static_cast<float>(std::clamp(base + 0.010, 0.02, 0.20)),
        static_cast<float>(std::clamp(base, 0.02, 0.20)),
        static_cast<float>(std::clamp(base - 0.008, 0.02, 0.20)),
    };
    return {
        demand.segment_id,
        demand.sample_id,
        demand.road_position,
        population_variation,
        segment_variation,
        crack_intensity,
        aggregate_variation,
        {
            aggregate_fraction,
            binder_fraction,
            0.0f,
            albedo,
        },
    };
}

inline RoadHierarchicalMaterialRealization
RealizeRoadHierarchicalMaterialReference(
    const RoadHierarchicalMaterialDefinition& definition,
    const std::vector<RoadHierarchicalMaterialDemand>& demands,
    std::size_t sample_budget
) {
    if (definition.potential_segments == 0 ||
        definition.potential_samples_per_segment == 0) {
        throw std::invalid_argument(
            "road material requires a potential surface"
        );
    }
    if (demands.size() > sample_budget) {
        throw std::range_error(
            "road material demand exceeds sample budget"
        );
    }
    auto ordered = demands;
    std::sort(
        ordered.begin(),
        ordered.end(),
        [](const auto& first, const auto& second) {
            return first.segment_id < second.segment_id ||
                (first.segment_id == second.segment_id &&
                 first.sample_id < second.sample_id);
        }
    );
    for (std::size_t index = 1; index < ordered.size(); ++index) {
        if (ordered[index - 1].segment_id ==
                ordered[index].segment_id &&
            ordered[index - 1].sample_id == ordered[index].sample_id) {
            throw std::invalid_argument(
                "road material demand is duplicated"
            );
        }
    }
    std::vector<RoadHierarchicalMaterialSample> samples;
    std::vector<vkf::material::RoadMaterialSample> energy_samples;
    samples.reserve(ordered.size());
    energy_samples.reserve(ordered.size());
    for (const auto& demand : ordered) {
        auto sample = SampleRoadHierarchicalMaterialReference(
            definition,
            demand
        );
        energy_samples.push_back(sample.material);
        samples.push_back(std::move(sample));
    }
    auto energy = vkf::material::EvaluateRoadMaterialWhiteFurnace(
        energy_samples,
        energy_samples.size()
    );
    return {
        definition.potential_segments,
        definition.potential_samples_per_segment,
        std::move(samples),
        std::move(energy),
    };
}

}  // namespace vf::material
