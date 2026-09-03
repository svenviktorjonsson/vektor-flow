#pragma once

#include "native/material/vf_deterministic_packet_reference.hpp"
#include "native/material/vf_hierarchical_field_reference.hpp"

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

constexpr std::size_t kForestPopulationRecordBytes =
    3 * sizeof(std::uint64_t) + sizeof(std::uint32_t) +
    8 * sizeof(float);

struct ForestPopulationDefinition {
    std::array<std::uint64_t, 2> seed;
    std::uint64_t population_id;
    std::uint32_t species_count;
    std::uint64_t potential_patches;
    std::uint64_t potential_trees_per_patch;
    double patch_extent;
    double minimum_spacing;
};

struct ForestPatchDemand {
    std::uint64_t patch_id;
    std::array<std::int64_t, 2> grid;
    std::size_t tree_budget;
};

struct ForestPopulationTree {
    std::uint64_t patch_id;
    std::uint64_t tree_id;
    std::uint64_t candidate_id;
    std::uint32_t species_id;
    std::array<double, 2> position;
    float age;
    float size;
    float health;
    float orientation;
    double environment_variation;
    double individual_variation;
};

struct ForestPopulationRealization {
    std::uint64_t potential_patches;
    std::uint64_t potential_trees_per_patch;
    std::vector<ForestPopulationTree> trees;
    std::size_t evaluated_candidates;
};

struct ForestPopulationPacket {
    std::vector<std::uint8_t> bytes;
};

struct ForestPopulationResidencyState {
    ForestPopulationRealization realization;
    std::shared_ptr<const ForestPopulationPacket> packet;
    bool retained;
    std::size_t repacked_trees;
    std::size_t upload_bytes;
    std::size_t resident_bytes;
    std::uint64_t version;
};

inline bool operator==(
    const ForestPopulationTree& first,
    const ForestPopulationTree& second
) {
    return first.patch_id == second.patch_id &&
        first.tree_id == second.tree_id &&
        first.candidate_id == second.candidate_id &&
        first.species_id == second.species_id &&
        first.position == second.position &&
        first.age == second.age && first.size == second.size &&
        first.health == second.health &&
        first.orientation == second.orientation &&
        first.environment_variation ==
            second.environment_variation &&
        first.individual_variation ==
            second.individual_variation;
}

inline bool operator==(
    const ForestPopulationRealization& first,
    const ForestPopulationRealization& second
) {
    return first.potential_patches == second.potential_patches &&
        first.potential_trees_per_patch ==
            second.potential_trees_per_patch &&
        first.trees == second.trees &&
        first.evaluated_candidates ==
            second.evaluated_candidates;
}

inline std::uint64_t ForestPopulationRootKey(
    const ForestPopulationDefinition& definition
) {
    return MixHierarchicalKey64(
        definition.seed[0] ^
        MixHierarchicalKey64(definition.seed[1]) ^
        MixHierarchicalKey64(definition.population_id)
    );
}

inline double ForestPopulationUnit(std::uint64_t key) {
    return 0.5 + 0.5 * HierarchicalSignedUnit(
        MixHierarchicalKey64(key)
    );
}

inline ForestPopulationTree SampleForestPopulationTreeReference(
    const ForestPopulationDefinition& definition,
    const ForestPatchDemand& demand,
    std::uint64_t candidate_id
) {
    const std::uint64_t root = ForestPopulationRootKey(definition);
    const std::uint64_t patch_key = MixHierarchicalKey64(
        root ^ MixHierarchicalKey64(demand.patch_id)
    );
    const std::uint64_t candidate_key = MixHierarchicalKey64(
        patch_key ^ MixHierarchicalKey64(candidate_id)
    );
    const double position_x =
        static_cast<double>(demand.grid[0]) *
            definition.patch_extent +
        definition.patch_extent *
            ForestPopulationUnit(candidate_key);
    const double position_y =
        static_cast<double>(demand.grid[1]) *
            definition.patch_extent +
        definition.patch_extent * ForestPopulationUnit(
            candidate_key ^ 0x243f6a8885a308d3ull
        );
    const std::array<double, 2> position{position_x, position_y};
    const double environment = SampleHierarchicalField2DReference(
        root,
        position,
        256.0,
        0
    );
    const double individual = HierarchicalSignedUnit(
        MixHierarchicalKey64(
            candidate_key ^ 0x13198a2e03707344ull
        )
    );
    const double species_noise = HierarchicalSignedUnit(
        MixHierarchicalKey64(
            candidate_key ^ 0xa4093822299f31d0ull
        )
    );
    const double species_unit = std::clamp(
        0.5 + 0.32 * environment + 0.18 * species_noise,
        0.0,
        std::nextafter(1.0, 0.0)
    );
    const auto species_id = static_cast<std::uint32_t>(
        species_unit * definition.species_count
    );
    const auto bounded = [](double value) {
        return static_cast<float>(std::clamp(value, 0.0, 1.0));
    };
    const float age = bounded(
        0.52 + 0.28 * individual + 0.12 * environment
    );
    const float size = bounded(
        0.18 + 0.62 * age + 0.12 * environment +
        0.08 * species_noise
    );
    const float health = bounded(
        0.68 + 0.18 * environment -
        0.10 * individual
    );
    constexpr double two_pi = 6.28318530717958647692;
    const float orientation = static_cast<float>(
        two_pi * ForestPopulationUnit(
            candidate_key ^ 0x082efa98ec4e6c89ull
        )
    );
    const std::uint64_t tree_id =
        demand.patch_id * definition.potential_trees_per_patch +
        candidate_id;
    return {
        demand.patch_id,
        tree_id,
        candidate_id,
        species_id,
        position,
        age,
        size,
        health,
        orientation,
        environment,
        individual,
    };
}

inline bool ForestPopulationHasSpacing(
    const std::vector<ForestPopulationTree>& trees,
    std::size_t patch_begin,
    const ForestPopulationTree& candidate,
    double minimum_spacing
) {
    const double minimum_squared =
        minimum_spacing * minimum_spacing;
    for (std::size_t index = patch_begin;
         index < trees.size();
         ++index) {
        const double dx = trees[index].position[0] -
            candidate.position[0];
        const double dy = trees[index].position[1] -
            candidate.position[1];
        if (dx * dx + dy * dy < minimum_squared) return false;
    }
    return true;
}

inline ForestPopulationRealization
RealizeForestPopulationReference(
    const ForestPopulationDefinition& definition,
    const std::vector<ForestPatchDemand>& demands,
    std::size_t tree_budget
) {
    if (definition.species_count == 0 ||
        definition.potential_patches == 0 ||
        definition.potential_trees_per_patch == 0 ||
        definition.potential_patches - 1 >
            std::numeric_limits<std::uint64_t>::max() /
                definition.potential_trees_per_patch ||
        !std::isfinite(definition.patch_extent) ||
        definition.patch_extent <= 0.0 ||
        !std::isfinite(definition.minimum_spacing) ||
        definition.minimum_spacing < 0.0) {
        throw std::invalid_argument(
            "forest population definition is invalid"
        );
    }
    auto ordered = demands;
    std::sort(
        ordered.begin(),
        ordered.end(),
        [](const auto& first, const auto& second) {
            return first.patch_id < second.patch_id;
        }
    );
    std::size_t requested_trees = 0;
    for (std::size_t index = 0; index < ordered.size(); ++index) {
        const auto& demand = ordered[index];
        if (demand.patch_id >= definition.potential_patches) {
            throw std::out_of_range(
                "forest patch is outside potential population"
            );
        }
        if (demand.tree_budget > 4096) {
            throw std::range_error(
                "forest patch tree budget exceeds 4096"
            );
        }
        if (index != 0 && ordered[index - 1].patch_id ==
                              demand.patch_id) {
            throw std::invalid_argument(
                "forest patch demand is duplicated"
            );
        }
        requested_trees += demand.tree_budget;
    }
    if (requested_trees > tree_budget) {
        throw std::range_error(
            "forest population demand exceeds tree budget"
        );
    }
    std::vector<ForestPopulationTree> trees;
    trees.reserve(requested_trees);
    std::size_t evaluated_candidates = 0;
    for (const auto& demand : ordered) {
        const std::size_t patch_begin = trees.size();
        const std::uint64_t maximum_attempts = std::min(
            definition.potential_trees_per_patch,
            static_cast<std::uint64_t>(
                demand.tree_budget * 64
            )
        );
        for (std::uint64_t candidate_id = 0;
             candidate_id < maximum_attempts &&
             trees.size() - patch_begin < demand.tree_budget;
             ++candidate_id) {
            auto candidate = SampleForestPopulationTreeReference(
                definition,
                demand,
                candidate_id
            );
            ++evaluated_candidates;
            if (ForestPopulationHasSpacing(
                    trees,
                    patch_begin,
                    candidate,
                    definition.minimum_spacing
                )) {
                trees.push_back(std::move(candidate));
            }
        }
        if (trees.size() - patch_begin != demand.tree_budget) {
            throw std::range_error(
                "forest spacing cannot satisfy tree budget"
            );
        }
    }
    return {
        definition.potential_patches,
        definition.potential_trees_per_patch,
        std::move(trees),
        evaluated_candidates,
    };
}

inline void ValidateForestPopulationForPacking(
    const ForestPopulationRealization& realization
) {
    for (const auto& tree : realization.trees) {
        const bool finite_position = std::all_of(
            tree.position.begin(),
            tree.position.end(),
            [](double value) { return std::isfinite(value); }
        );
        if (!finite_position || !std::isfinite(tree.age) ||
            tree.age < 0.0f || tree.age > 1.0f ||
            !std::isfinite(tree.size) || tree.size < 0.0f ||
            tree.size > 1.0f || !std::isfinite(tree.health) ||
            tree.health < 0.0f || tree.health > 1.0f ||
            !std::isfinite(tree.orientation) ||
            !std::isfinite(tree.environment_variation) ||
            !std::isfinite(tree.individual_variation)) {
            throw std::domain_error(
                "forest packet contains invalid tree marks"
            );
        }
    }
}

inline void
AppendForestPopulationTreeBytesReference(
    std::vector<std::uint8_t>& bytes,
    const ForestPopulationTree& tree
) {
    AppendDeterministicPacketWord64(bytes, tree.patch_id);
    AppendDeterministicPacketWord64(bytes, tree.tree_id);
    AppendDeterministicPacketWord64(bytes, tree.candidate_id);
    AppendDeterministicPacketWord32(bytes, tree.species_id);
    for (const double value : tree.position) {
        AppendDeterministicPacketFloat32(
            bytes,
            static_cast<float>(value)
        );
    }
    AppendDeterministicPacketFloat32(bytes, tree.age);
    AppendDeterministicPacketFloat32(bytes, tree.size);
    AppendDeterministicPacketFloat32(bytes, tree.health);
    AppendDeterministicPacketFloat32(bytes, tree.orientation);
    AppendDeterministicPacketFloat32(
        bytes,
        static_cast<float>(tree.environment_variation)
    );
    AppendDeterministicPacketFloat32(
        bytes,
        static_cast<float>(tree.individual_variation)
    );
}

inline std::vector<std::uint8_t>
PackForestPopulationBytesReference(
    const ForestPopulationRealization& realization
) {
    ValidateForestPopulationForPacking(realization);
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        realization.trees.size() * kForestPopulationRecordBytes
    );
    for (const auto& tree : realization.trees) {
        AppendForestPopulationTreeBytesReference(bytes, tree);
    }
    return bytes;
}

inline ForestPopulationResidencyState
UpdateForestPopulationResidencyReference(
    const ForestPopulationDefinition& definition,
    const std::vector<ForestPatchDemand>& demands,
    std::size_t tree_budget,
    const ForestPopulationResidencyState* previous
) {
    auto realization = RealizeForestPopulationReference(
        definition,
        demands,
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
    auto bytes = PackForestPopulationBytesReference(realization);
    const std::size_t repacked_trees = previous == nullptr
        ? realization.trees.size()
        : CountDeterministicPacketRecordChanges(
            previous->packet->bytes,
            bytes,
            kForestPopulationRecordBytes
        );
    auto packet = std::make_shared<const ForestPopulationPacket>(
        ForestPopulationPacket{std::move(bytes)}
    );
    const std::size_t resident_bytes = packet->bytes.size();
    const std::uint64_t version =
        HashDeterministicPacketBytes(packet->bytes);
    return {
        std::move(realization),
        std::move(packet),
        false,
        repacked_trees,
        repacked_trees * kForestPopulationRecordBytes,
        resident_bytes,
        version,
    };
}

}  // namespace vf::material
