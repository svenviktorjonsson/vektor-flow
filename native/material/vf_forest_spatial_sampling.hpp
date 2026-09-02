#pragma once

#include "native/material/vf_forest_spatial_quality.hpp"
#include "native/material/vf_hierarchical_field_reference.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>

namespace vf::material {

struct ForestSpatialSamplingReport {
    std::size_t tree_count;
    std::size_t evaluated_pairs;
    std::size_t near_pair_count;
    std::size_t far_pair_count;
    double near_environment_similarity;
    double far_environment_similarity;
    double near_same_species_fraction;
    double far_same_species_fraction;
    std::uint64_t population_version;
};

inline bool operator==(
    const ForestSpatialSamplingReport& first,
    const ForestSpatialSamplingReport& second
) {
    return first.tree_count == second.tree_count &&
        first.evaluated_pairs == second.evaluated_pairs &&
        first.near_pair_count == second.near_pair_count &&
        first.far_pair_count == second.far_pair_count &&
        first.near_environment_similarity ==
            second.near_environment_similarity &&
        first.far_environment_similarity ==
            second.far_environment_similarity &&
        first.near_same_species_fraction ==
            second.near_same_species_fraction &&
        first.far_same_species_fraction ==
            second.far_same_species_fraction &&
        first.population_version == second.population_version;
}

inline ForestSpatialSamplingReport
SampleForestSpatialQualityReference(
    const ForestPopulationRealization& population,
    double near_distance,
    double far_distance,
    std::size_t pair_budget
) {
    if (population.trees.size() < 2 || pair_budget == 0 ||
        pair_budget > 10000000 ||
        !std::isfinite(near_distance) || near_distance <= 0.0 ||
        !std::isfinite(far_distance) ||
        far_distance <= near_distance) {
        throw std::invalid_argument(
            "forest spatial sample request is invalid"
        );
    }
    const auto bytes = PackForestPopulationBytesReference(population);
    const std::uint64_t population_version =
        HashDeterministicPacketBytes(bytes);
    const std::uint64_t tree_count = population.trees.size();
    const double near_squared = near_distance * near_distance;
    const double far_squared = far_distance * far_distance;
    std::size_t near_pairs = 0;
    std::size_t far_pairs = 0;
    std::size_t near_same_species = 0;
    std::size_t far_same_species = 0;
    double near_environment_sum = 0.0;
    double far_environment_sum = 0.0;
    for (std::size_t sample = 0; sample < pair_budget; ++sample) {
        const std::uint64_t sample_key = MixHierarchicalKey64(
            population_version ^ static_cast<std::uint64_t>(sample)
        );
        const std::size_t first_index =
            static_cast<std::size_t>(sample_key % tree_count);
        std::size_t second_index = static_cast<std::size_t>(
            MixHierarchicalKey64(
                sample_key ^ 0x243f6a8885a308d3ull
            ) % (tree_count - 1)
        );
        if (second_index >= first_index) ++second_index;
        const auto& first = population.trees[first_index];
        const auto& second = population.trees[second_index];
        const double dx = first.position[0] - second.position[0];
        const double dy = first.position[1] - second.position[1];
        const double distance_squared = dx * dx + dy * dy;
        const double similarity = 1.0 - 0.5 * std::abs(
            first.environment_variation -
            second.environment_variation
        );
        if (distance_squared <= near_squared) {
            ++near_pairs;
            near_environment_sum += similarity;
            near_same_species += static_cast<std::size_t>(
                first.species_id == second.species_id
            );
        } else if (distance_squared >= far_squared) {
            ++far_pairs;
            far_environment_sum += similarity;
            far_same_species += static_cast<std::size_t>(
                first.species_id == second.species_id
            );
        }
    }
    if (near_pairs == 0 || far_pairs == 0) {
        throw std::range_error(
            "forest spatial sample has insufficient pair support"
        );
    }
    return {
        population.trees.size(),
        pair_budget,
        near_pairs,
        far_pairs,
        near_environment_sum / static_cast<double>(near_pairs),
        far_environment_sum / static_cast<double>(far_pairs),
        static_cast<double>(near_same_species) /
            static_cast<double>(near_pairs),
        static_cast<double>(far_same_species) /
            static_cast<double>(far_pairs),
        population_version,
    };
}

}  // namespace vf::material
