#pragma once

#include "native/material/vf_forest_population_residency.hpp"
#include "native/material/vf_tree_canopy_hierarchical_residency.hpp"
#include "native/material/vf_tree_wood_hierarchical_residency.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

constexpr std::size_t kForestTreeMaterialBundleBytes =
    kForestPopulationRecordBytes +
    kTreeWoodHierarchicalRecordBytes +
    2 * kTreeCanopyHierarchicalRecordBytes;

struct ForestTreeMaterialPipelineDefinition {
    ForestPopulationDefinition forest;
    TreeWoodHierarchicalDefinition material;
    std::uint64_t potential_canopy_primitives_per_tree;
};

struct ForestTreeMaterialBundle {
    ForestPopulationTree population;
    TreeWoodHierarchicalSample wood;
    TreeCanopyHierarchicalSample bark;
    TreeCanopyHierarchicalSample foliage;
};

struct ForestTreeMaterialPipelineRealization {
    std::uint64_t logical_tree_capacity;
    std::vector<ForestTreeMaterialBundle> bundles;
    TreeWoodHierarchicalEnergy wood_energy;
    TreeWoodHierarchicalEnergy canopy_energy;
};

struct ForestTreeMaterialPipelinePacket {
    std::vector<std::uint8_t> bytes;
};

struct ForestTreeMaterialPipelineState {
    ForestTreeMaterialPipelineRealization realization;
    std::shared_ptr<const ForestTreeMaterialPipelinePacket> packet;
    bool retained;
    std::size_t repacked_bundles;
    std::size_t upload_bytes;
    std::size_t resident_bytes;
    std::uint64_t version;
};

inline bool operator==(
    const ForestTreeMaterialBundle& first,
    const ForestTreeMaterialBundle& second
) {
    return first.population == second.population &&
        first.wood == second.wood &&
        first.bark == second.bark &&
        first.foliage == second.foliage;
}

inline bool operator==(
    const ForestTreeMaterialPipelineRealization& first,
    const ForestTreeMaterialPipelineRealization& second
) {
    return first.logical_tree_capacity ==
            second.logical_tree_capacity &&
        first.bundles == second.bundles &&
        first.wood_energy == second.wood_energy &&
        first.canopy_energy == second.canopy_energy;
}

inline void ValidateForestTreeMaterialDefinition(
    const ForestTreeMaterialPipelineDefinition& definition
) {
    if (definition.forest.potential_patches == 0 ||
        definition.forest.potential_trees_per_patch == 0 ||
        definition.forest.potential_patches >
            std::numeric_limits<std::uint64_t>::max() /
                definition.forest.potential_trees_per_patch) {
        throw std::invalid_argument(
            "forest tree material capacity is invalid"
        );
    }
    const std::uint64_t logical_capacity =
        definition.forest.potential_patches *
        definition.forest.potential_trees_per_patch;
    if (definition.material.seed != definition.forest.seed ||
        definition.material.population_id !=
            definition.forest.population_id ||
        definition.material.species_count !=
            definition.forest.species_count ||
        definition.material.potential_trees != logical_capacity ||
        definition.material.potential_samples_per_tree < 2 ||
        definition.potential_canopy_primitives_per_tree < 2) {
        throw std::invalid_argument(
            "forest tree material hierarchies are inconsistent"
        );
    }
}

inline ForestTreeMaterialBundle
SampleForestTreeMaterialBundleReference(
    const ForestTreeMaterialPipelineDefinition& definition,
    const ForestPopulationTree& population
) {
    const std::array<double, 2> tree_position{
        population.position[0],
        population.position[1],
    };
    const double height = 2.0 + 8.0 * population.size;
    const auto wood =
        SampleTreeWoodHierarchicalMaterialReference(
            definition.material,
            {
                population.tree_id,
                population.species_id,
                tree_position,
                0,
                {0.18, 0.0, 0.4 * height},
            }
        );
    const TreeCanopyHierarchicalDefinition canopy_definition{
        definition.material,
        definition.potential_canopy_primitives_per_tree,
    };
    const auto bark = SampleTreeCanopyHierarchicalReference(
        canopy_definition,
        {
            0,
            population.tree_id,
            population.species_id,
            tree_position,
            std::numeric_limits<std::uint64_t>::max(),
            TreeCanopyPrimitiveKind::bark,
            {0.0, 0.0, 0.45 * height},
            {0.0, 0.0, 1.0},
        }
    );
    const double horizontal_x = std::cos(population.orientation);
    const double horizontal_y = std::sin(population.orientation);
    const auto foliage = SampleTreeCanopyHierarchicalReference(
        canopy_definition,
        {
            1,
            population.tree_id,
            population.species_id,
            tree_position,
            0,
            TreeCanopyPrimitiveKind::foliage,
            {
                horizontal_x * population.size,
                horizontal_y * population.size,
                0.82 * height,
            },
            {0.35 * horizontal_x, 0.35 * horizontal_y, 1.0},
        }
    );
    return {population, wood, bark, foliage};
}

inline std::vector<std::uint64_t>
OrderForestTreeMaterialDemandReference(
    const ForestTreeMaterialPipelineDefinition& definition,
    const ForestPopulationRealization& forest,
    const std::vector<std::uint64_t>& demanded_tree_ids,
    std::size_t tree_budget
) {
    ValidateForestTreeMaterialDefinition(definition);
    if (forest.potential_patches !=
            definition.forest.potential_patches ||
        forest.potential_trees_per_patch !=
            definition.forest.potential_trees_per_patch) {
        throw std::invalid_argument(
            "forest tree material population is incompatible"
        );
    }
    if (demanded_tree_ids.size() > tree_budget) {
        throw std::range_error(
            "forest tree material demand exceeds budget"
        );
    }
    auto ordered_ids = demanded_tree_ids;
    std::sort(ordered_ids.begin(), ordered_ids.end());
    if (std::adjacent_find(
            ordered_ids.begin(),
            ordered_ids.end()
        ) != ordered_ids.end()) {
        throw std::invalid_argument(
            "forest tree material demand is duplicated"
        );
    }
    return ordered_ids;
}

inline const ForestPopulationTree&
FindForestTreeMaterialPopulationReference(
    const ForestPopulationRealization& forest,
    std::uint64_t tree_id
) {
    const auto found = std::lower_bound(
        forest.trees.begin(),
        forest.trees.end(),
        tree_id,
        [](const auto& tree, std::uint64_t id) {
            return tree.tree_id < id;
        }
    );
    if (found == forest.trees.end() || found->tree_id != tree_id) {
        throw std::out_of_range(
            "forest tree material identity is not resident"
        );
    }
    return *found;
}

inline ForestTreeMaterialPipelineRealization
RealizeForestTreeMaterialPipelineCopiedReference(
    const ForestTreeMaterialPipelineDefinition& definition,
    const ForestPopulationRealization& forest,
    const std::vector<std::uint64_t>& demanded_tree_ids,
    std::size_t tree_budget
) {
    const auto ordered_ids = OrderForestTreeMaterialDemandReference(
        definition,
        forest,
        demanded_tree_ids,
        tree_budget
    );
    std::vector<ForestTreeMaterialBundle> bundles;
    bundles.reserve(ordered_ids.size());
    std::vector<TreeWoodHierarchicalSample> wood_samples;
    wood_samples.reserve(ordered_ids.size());
    std::vector<TreeCanopyHierarchicalSample> canopy_samples;
    canopy_samples.reserve(ordered_ids.size() * 2);
    for (const std::uint64_t tree_id : ordered_ids) {
        auto bundle = SampleForestTreeMaterialBundleReference(
            definition,
            FindForestTreeMaterialPopulationReference(
                forest,
                tree_id
            )
        );
        wood_samples.push_back(bundle.wood);
        canopy_samples.push_back(bundle.bark);
        canopy_samples.push_back(bundle.foliage);
        bundles.push_back(std::move(bundle));
    }
    const std::uint64_t logical_capacity =
        definition.forest.potential_patches *
        definition.forest.potential_trees_per_patch;
    return {
        logical_capacity,
        std::move(bundles),
        EvaluateTreeWoodEnergyReference(wood_samples),
        EvaluateTreeCanopyEnergyReference(canopy_samples),
    };
}

inline TreeWoodHierarchicalEnergy
CreateForestTreeMaterialEnergyReference(
    std::size_t sample_count
) {
    TreeWoodHierarchicalEnergy energy{};
    energy.minimum = sample_count == 0
        ? 0.0f
        : std::numeric_limits<float>::infinity();
    energy.maximum = sample_count == 0
        ? 0.0f
        : -std::numeric_limits<float>::infinity();
    energy.violations = 0;
    energy.values.reserve(
        sample_count * energy.cosine_probes.size() * 3
    );
    return energy;
}

inline void AppendForestTreeWoodEnergyReference(
    TreeWoodHierarchicalEnergy& energy,
    const TreeWoodHierarchicalSample& sample
) {
    for (const float cosine : energy.cosine_probes) {
        const float one_minus = 1.0f - cosine;
        const float square = one_minus * one_minus;
        const float fifth = square * square * one_minus;
        const float fresnel = sample.reflectivity +
            (1.0f - sample.reflectivity) * fifth;
        for (const float albedo : sample.base_color) {
            const float value = fresnel +
                (1.0f - fresnel) * albedo;
            energy.values.push_back(value);
            energy.minimum = std::min(energy.minimum, value);
            energy.maximum = std::max(energy.maximum, value);
            if (value < -1.0e-7f || value > 1.0f + 1.0e-7f) {
                ++energy.violations;
            }
        }
    }
}

inline void AppendForestTreeCanopyEnergyReference(
    TreeWoodHierarchicalEnergy& energy,
    const TreeCanopyHierarchicalSample& sample
) {
    for (const float cosine : energy.cosine_probes) {
        const float complement = 1.0f - cosine;
        const float square = complement * complement;
        const float fresnel = sample.reflectivity +
            (1.0f - sample.reflectivity) *
            square * square * complement;
        for (const float channel : sample.base_color) {
            const float value = fresnel +
                (1.0f - fresnel) * channel;
            energy.values.push_back(value);
            energy.minimum = std::min(energy.minimum, value);
            energy.maximum = std::max(energy.maximum, value);
            if (value < -1.0e-7f || value > 1.0f + 1.0e-7f) {
                ++energy.violations;
            }
        }
    }
}

inline ForestTreeMaterialPipelineRealization
RealizeForestTreeMaterialPipelineDirectReference(
    const ForestTreeMaterialPipelineDefinition& definition,
    const ForestPopulationRealization& forest,
    const std::vector<std::uint64_t>& demanded_tree_ids,
    std::size_t tree_budget
) {
    const auto ordered_ids = OrderForestTreeMaterialDemandReference(
        definition,
        forest,
        demanded_tree_ids,
        tree_budget
    );
    std::vector<ForestTreeMaterialBundle> bundles;
    bundles.reserve(ordered_ids.size());
    auto wood_energy = CreateForestTreeMaterialEnergyReference(
        ordered_ids.size()
    );
    auto canopy_energy = CreateForestTreeMaterialEnergyReference(
        ordered_ids.size() * 2
    );
    for (const std::uint64_t tree_id : ordered_ids) {
        auto bundle = SampleForestTreeMaterialBundleReference(
            definition,
            FindForestTreeMaterialPopulationReference(
                forest,
                tree_id
            )
        );
        AppendForestTreeWoodEnergyReference(
            wood_energy,
            bundle.wood
        );
        AppendForestTreeCanopyEnergyReference(
            canopy_energy,
            bundle.bark
        );
        AppendForestTreeCanopyEnergyReference(
            canopy_energy,
            bundle.foliage
        );
        bundles.push_back(std::move(bundle));
    }
    const std::uint64_t logical_capacity =
        definition.forest.potential_patches *
        definition.forest.potential_trees_per_patch;
    return {
        logical_capacity,
        std::move(bundles),
        std::move(wood_energy),
        std::move(canopy_energy),
    };
}

inline ForestTreeMaterialPipelineRealization
RealizeForestTreeMaterialPipelineReference(
    const ForestTreeMaterialPipelineDefinition& definition,
    const ForestPopulationRealization& forest,
    const std::vector<std::uint64_t>& demanded_tree_ids,
    std::size_t tree_budget
) {
    return RealizeForestTreeMaterialPipelineDirectReference(
        definition,
        forest,
        demanded_tree_ids,
        tree_budget
    );
}

inline void ValidateForestTreeMaterialPipelineForPacking(
    const ForestTreeMaterialPipelineRealization& realization
) {
    std::vector<ForestPopulationTree> population_samples;
    std::vector<TreeWoodHierarchicalSample> wood_samples;
    std::vector<TreeCanopyHierarchicalSample> canopy_samples;
    population_samples.reserve(realization.bundles.size());
    wood_samples.reserve(realization.bundles.size());
    canopy_samples.reserve(realization.bundles.size() * 2);
    for (const auto& bundle : realization.bundles) {
        population_samples.push_back(bundle.population);
        wood_samples.push_back(bundle.wood);
        canopy_samples.push_back(bundle.bark);
        canopy_samples.push_back(bundle.foliage);
    }
    ValidateForestPopulationForPacking(
        {
            1,
            realization.logical_tree_capacity,
            std::move(population_samples),
            0,
        }
    );
    ValidateTreeWoodMaterialForPacking(
        {
            realization.logical_tree_capacity,
            1,
            std::move(wood_samples),
            realization.wood_energy,
        }
    );
    ValidateTreeCanopyForPacking(
        {
            realization.logical_tree_capacity,
            2,
            std::move(canopy_samples),
            realization.canopy_energy,
        }
    );
}

struct ForestTreeEnergyValidationCursorReference {
    const TreeWoodHierarchicalEnergy* expected;
    std::size_t value_index;
    float minimum;
    float maximum;
    std::size_t violations;
};

inline ForestTreeEnergyValidationCursorReference
CreateForestTreeEnergyValidationCursorReference(
    const TreeWoodHierarchicalEnergy& expected,
    std::size_t sample_count
) {
    return {
        &expected,
        0,
        sample_count == 0
            ? 0.0f
            : std::numeric_limits<float>::infinity(),
        sample_count == 0
            ? 0.0f
            : -std::numeric_limits<float>::infinity(),
        0,
    };
}

inline void AccumulateForestTreeEnergyValidationReference(
    ForestTreeEnergyValidationCursorReference& cursor,
    float value
) {
    if (cursor.value_index >= cursor.expected->values.size() ||
        cursor.expected->values[cursor.value_index] != value) {
        throw std::domain_error(
            "forest tree packet energy values changed"
        );
    }
    ++cursor.value_index;
    cursor.minimum = std::min(cursor.minimum, value);
    cursor.maximum = std::max(cursor.maximum, value);
    if (value < -1.0e-7f || value > 1.0f + 1.0e-7f) {
        ++cursor.violations;
    }
}

inline void ValidateForestTreeWoodEnergySampleReference(
    const TreeWoodHierarchicalSample& sample,
    const std::array<float, 5>& cosine_probes,
    ForestTreeEnergyValidationCursorReference& cursor
) {
    for (const float cosine : cosine_probes) {
        const float one_minus = 1.0f - cosine;
        const float square = one_minus * one_minus;
        const float fifth = square * square * one_minus;
        const float fresnel = sample.reflectivity +
            (1.0f - sample.reflectivity) * fifth;
        for (const float albedo : sample.base_color) {
            AccumulateForestTreeEnergyValidationReference(
                cursor,
                fresnel + (1.0f - fresnel) * albedo
            );
        }
    }
}

inline void ValidateForestTreeCanopyEnergySampleReference(
    const TreeCanopyHierarchicalSample& sample,
    const std::array<float, 5>& cosine_probes,
    ForestTreeEnergyValidationCursorReference& cursor
) {
    for (const float cosine : cosine_probes) {
        const float complement = 1.0f - cosine;
        const float square = complement * complement;
        const float fresnel = sample.reflectivity +
            (1.0f - sample.reflectivity) *
            square * square * complement;
        for (const float channel : sample.base_color) {
            AccumulateForestTreeEnergyValidationReference(
                cursor,
                fresnel + (1.0f - fresnel) * channel
            );
        }
    }
}

inline void FinishForestTreeEnergyValidationReference(
    const ForestTreeEnergyValidationCursorReference& cursor,
    const std::array<float, 5>& cosine_probes,
    const char* message
) {
    if (cursor.expected->cosine_probes != cosine_probes ||
        cursor.value_index != cursor.expected->values.size() ||
        cursor.minimum != cursor.expected->minimum ||
        cursor.maximum != cursor.expected->maximum ||
        cursor.violations != cursor.expected->violations ||
        cursor.violations != 0 || cursor.minimum < 0.0f ||
        cursor.maximum > 1.0f) {
        throw std::domain_error(message);
    }
}

inline void ValidateForestTreeMaterialPipelineDirectReference(
    const ForestTreeMaterialPipelineRealization& realization
) {
    const TreeWoodHierarchicalEnergy defaults{};
    auto wood = CreateForestTreeEnergyValidationCursorReference(
        realization.wood_energy,
        realization.bundles.size()
    );
    auto canopy = CreateForestTreeEnergyValidationCursorReference(
        realization.canopy_energy,
        realization.bundles.size() * 2
    );
    for (const auto& bundle : realization.bundles) {
        ValidateForestPopulationTreeForPackingReference(
            bundle.population
        );
        ValidateTreeWoodSampleForPackingReference(bundle.wood);
        ValidateTreeCanopySampleForPackingReference(bundle.bark);
        ValidateTreeCanopySampleForPackingReference(
            bundle.foliage
        );
        ValidateForestTreeWoodEnergySampleReference(
            bundle.wood,
            defaults.cosine_probes,
            wood
        );
        ValidateForestTreeCanopyEnergySampleReference(
            bundle.bark,
            defaults.cosine_probes,
            canopy
        );
        ValidateForestTreeCanopyEnergySampleReference(
            bundle.foliage,
            defaults.cosine_probes,
            canopy
        );
    }
    FinishForestTreeEnergyValidationReference(
        wood,
        defaults.cosine_probes,
        "tree/wood packet failed passive energy validation"
    );
    FinishForestTreeEnergyValidationReference(
        canopy,
        defaults.cosine_probes,
        "tree canopy packet failed passive energy validation"
    );
}

inline std::vector<std::uint8_t>
PackForestTreeMaterialPipelineBytesDirectReference(
    const ForestTreeMaterialPipelineRealization& realization
) {
    ValidateForestTreeMaterialPipelineDirectReference(realization);
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        realization.bundles.size() *
        kForestTreeMaterialBundleBytes
    );
    for (const auto& bundle : realization.bundles) {
        AppendForestPopulationTreeBytesReference(
            bytes,
            bundle.population
        );
        AppendTreeWoodSampleBytesReference(
            bytes,
            bundle.wood
        );
        AppendTreeCanopySampleBytesReference(
            bytes,
            bundle.bark
        );
        AppendTreeCanopySampleBytesReference(
            bytes,
            bundle.foliage
        );
    }
    return bytes;
}

inline std::vector<std::uint8_t>
PackForestTreeMaterialPipelineBytesReference(
    const ForestTreeMaterialPipelineRealization& realization
) {
    return PackForestTreeMaterialPipelineBytesDirectReference(
        realization
    );
}

inline ForestTreeMaterialPipelineState
UpdateForestTreeMaterialPipelineReference(
    const ForestTreeMaterialPipelineDefinition& definition,
    const ForestPopulationRealization& forest,
    const std::vector<std::uint64_t>& demanded_tree_ids,
    std::size_t tree_budget,
    const ForestTreeMaterialPipelineState* previous
) {
    auto realization = RealizeForestTreeMaterialPipelineReference(
        definition,
        forest,
        demanded_tree_ids,
        tree_budget
    );
    if (previous != nullptr &&
        realization == previous->realization) {
        return {
            std::move(realization),
            previous->packet,
            true,
            0,
            0,
            previous->resident_bytes,
            previous->version,
        };
    }
    auto bytes = PackForestTreeMaterialPipelineBytesReference(
        realization
    );
    const std::size_t repacked_bundles = previous == nullptr
        ? realization.bundles.size()
        : CountDeterministicPacketRecordChanges(
            previous->packet->bytes,
            bytes,
            kForestTreeMaterialBundleBytes
        );
    auto packet =
        std::make_shared<const ForestTreeMaterialPipelinePacket>(
            ForestTreeMaterialPipelinePacket{std::move(bytes)}
        );
    const std::size_t resident_bytes = packet->bytes.size();
    const std::uint64_t version =
        HashDeterministicPacketBytes(packet->bytes);
    return {
        std::move(realization),
        std::move(packet),
        false,
        repacked_bundles,
        repacked_bundles * kForestTreeMaterialBundleBytes,
        resident_bytes,
        version,
    };
}

}  // namespace vf::material
