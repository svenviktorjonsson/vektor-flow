#pragma once

#include "native/material/vf_leaf_species_conditioned_distribution.hpp"
#include "native/material/vf_tree_canopy_hierarchical_residency.hpp"

#include <algorithm>
#include <array>
#include <cstddef>

namespace vf::material {

inline TreeCanopyHierarchicalSample ApplyLeafSpeciesConditionReference(
    TreeCanopyHierarchicalSample sample,
    const LeafSpeciesConditionedDistribution& distribution,
    LeafSpeciesConditionV1 species
) {
    const auto& member = LeafSpeciesMemberReference(
        distribution,
        species
    );
    if (sample.kind != TreeCanopyPrimitiveKind::foliage) {
        return sample;
    }
    constexpr std::array<double, 3> generic_leaf_center{
        0.10,
        0.38,
        0.075,
    };
    for (std::size_t band = 0; band < 3; ++band) {
        const double hierarchical_factor =
            static_cast<double>(sample.base_color[band]) /
            generic_leaf_center[band];
        const double conditioned =
            distribution.calibrated_center[band] *
            member.centered_factor[band] * hierarchical_factor;
        sample.base_color[band] = static_cast<float>(
            std::clamp(conditioned, 0.0, 1.0)
        );
    }
    return sample;
}

inline TreeCanopyHierarchicalSample
SampleTreeCanopyLeafSpeciesReference(
    const TreeCanopyHierarchicalDefinition& definition,
    const TreeCanopyHierarchicalDemand& demand,
    LeafSpeciesConditionV1 species
) {
    const auto distribution =
        BuildLeafSpeciesConditionedDistributionV1();
    ValidateLeafSpeciesConditionedDistribution(distribution);
    return ApplyLeafSpeciesConditionReference(
        SampleTreeCanopyHierarchicalReference(definition, demand),
        distribution,
        species
    );
}

}  // namespace vf::material
