#pragma once

#include "native/material/vf_forest_tree_material_pipeline.hpp"
#include "native/material/vf_tree_canopy_leaf_species.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace vf::material {

// Private composition of existing tree identity and measured leaf condition.
// Population species IDs do not implicitly select a measured species.
struct ForestLeafSpeciesDemand {
    std::uint64_t tree_id;
    LeafSpeciesConditionV1 species;
};

inline ForestTreeMaterialPipelineRealization
RealizeForestLeafSpeciesReference(
    const ForestTreeMaterialPipelineDefinition& definition,
    const ForestPopulationRealization& forest,
    const std::vector<ForestLeafSpeciesDemand>& demands,
    std::size_t tree_budget
) {
    std::vector<std::uint64_t> ids;
    ids.reserve(demands.size());
    for (const auto& demand : demands) ids.push_back(demand.tree_id);
    // Reuse the established hierarchy, bounded demand validation, canonical
    // identity ordering, and exact duplicate/unknown-tree diagnostics.
    auto result = RealizeForestTreeMaterialPipelineReference(
        definition, forest, ids, tree_budget);
    auto ordered = demands;
    std::sort(ordered.begin(), ordered.end(), [](const auto& a, const auto& b) {
        return a.tree_id < b.tree_id;
    });
    const auto distribution = BuildLeafSpeciesConditionedDistributionV1();
    ValidateLeafSpeciesConditionedDistribution(distribution);
    result.canopy_energy = CreateForestTreeMaterialEnergyReference(
        result.bundles.size() * 2);
    for (std::size_t i = 0; i < result.bundles.size(); ++i) {
        auto& bundle = result.bundles[i];
        bundle.foliage = ApplyLeafSpeciesConditionReference(
            bundle.foliage, distribution, ordered[i].species);
        AppendForestTreeCanopyEnergyReference(result.canopy_energy, bundle.bark);
        AppendForestTreeCanopyEnergyReference(result.canopy_energy, bundle.foliage);
    }
    return result;
}

} // namespace vf::material
