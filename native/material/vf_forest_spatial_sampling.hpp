#pragma once

#include "native/material/vf_forest_spatial_quality.hpp"
#include "native/material/vf_hierarchical_field_reference.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

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

struct ForestSpatialSamplingAccumulator {
    std::size_t near_pairs = 0;
    std::size_t far_pairs = 0;
    std::size_t near_same_species = 0;
    std::size_t far_same_species = 0;
    double near_environment_sum = 0.0;
    double far_environment_sum = 0.0;
};

inline void ValidateForestSpatialSamplingRequestReference(
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
}

struct ForestSpatialSamplePair {
    std::size_t first_index;
    std::size_t second_index;

    bool operator==(const ForestSpatialSamplePair&) const = default;
};

inline ForestSpatialSamplePair
ForestSpatialSamplePairReference(
    std::uint64_t population_version,
    std::size_t tree_count,
    std::size_t sample
) {
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
    return {first_index, second_index};
}

inline void AccumulateForestSpatialPairReference(
    const ForestPopulationRealization& population,
    double near_squared,
    double far_squared,
    const ForestSpatialSamplePair& pair,
    ForestSpatialSamplingAccumulator& result
) {
    const auto& first = population.trees[pair.first_index];
    const auto& second = population.trees[pair.second_index];
    const double dx = first.position[0] - second.position[0];
    const double dy = first.position[1] - second.position[1];
    const double distance_squared = dx * dx + dy * dy;
    const double similarity = 1.0 - 0.5 * std::abs(
        first.environment_variation -
        second.environment_variation
    );
    if (distance_squared <= near_squared) {
        ++result.near_pairs;
        result.near_environment_sum += similarity;
        result.near_same_species += static_cast<std::size_t>(
            first.species_id == second.species_id
        );
    } else if (distance_squared >= far_squared) {
        ++result.far_pairs;
        result.far_environment_sum += similarity;
        result.far_same_species += static_cast<std::size_t>(
            first.species_id == second.species_id
        );
    }
}

inline ForestSpatialSamplingAccumulator
AccumulateForestSpatialSamplingRangeReference(
    const ForestPopulationRealization& population,
    std::uint64_t population_version,
    double near_squared,
    double far_squared,
    std::size_t first_sample,
    std::size_t sample_count
) {
    ForestSpatialSamplingAccumulator result;
    for (std::size_t offset = 0; offset < sample_count; ++offset) {
        const auto pair = ForestSpatialSamplePairReference(
                population_version,
                population.trees.size(),
                first_sample + offset
            );
        AccumulateForestSpatialPairReference(
            population,
            near_squared,
            far_squared,
            pair,
            result
        );
    }
    return result;
}

inline ForestSpatialSamplingAccumulator
AccumulateForestSpatialSamplingPairsReference(
    const ForestPopulationRealization& population,
    double near_squared,
    double far_squared,
    const std::vector<ForestSpatialSamplePair>& pairs,
    std::size_t first_sample,
    std::size_t sample_count
) {
    if (first_sample > pairs.size() ||
        sample_count > pairs.size() - first_sample) {
        throw std::invalid_argument(
            "forest spatial pair range is invalid"
        );
    }
    ForestSpatialSamplingAccumulator result;
    for (std::size_t offset = 0; offset < sample_count; ++offset) {
        AccumulateForestSpatialPairReference(
            population,
            near_squared,
            far_squared,
            pairs[first_sample + offset],
            result
        );
    }
    return result;
}

inline ForestSpatialSamplingReport
FinalizeForestSpatialSamplingReference(
    const ForestPopulationRealization& population,
    std::size_t evaluated_pairs,
    std::uint64_t population_version,
    const ForestSpatialSamplingAccumulator& accumulator
) {
    if (accumulator.near_pairs == 0 ||
        accumulator.far_pairs == 0) {
        throw std::range_error(
            "forest spatial sample has insufficient pair support"
        );
    }
    return {
        population.trees.size(),
        evaluated_pairs,
        accumulator.near_pairs,
        accumulator.far_pairs,
        accumulator.near_environment_sum /
            static_cast<double>(accumulator.near_pairs),
        accumulator.far_environment_sum /
            static_cast<double>(accumulator.far_pairs),
        static_cast<double>(accumulator.near_same_species) /
            static_cast<double>(accumulator.near_pairs),
        static_cast<double>(accumulator.far_same_species) /
            static_cast<double>(accumulator.far_pairs),
        population_version,
    };
}

inline ForestSpatialSamplingReport
SampleForestSpatialQualityReference(
    const ForestPopulationRealization& population,
    double near_distance,
    double far_distance,
    std::size_t pair_budget
) {
    ValidateForestSpatialSamplingRequestReference(
        population,
        near_distance,
        far_distance,
        pair_budget
    );
    const auto bytes = PackForestPopulationBytesReference(population);
    const std::uint64_t population_version =
        HashDeterministicPacketBytes(bytes);
    const double near_squared = near_distance * near_distance;
    const double far_squared = far_distance * far_distance;
    const auto accumulator =
        AccumulateForestSpatialSamplingRangeReference(
            population,
            population_version,
            near_squared,
            far_squared,
            0,
            pair_budget
        );
    return FinalizeForestSpatialSamplingReference(
        population,
        pair_budget,
        population_version,
        accumulator
    );
}

}  // namespace vf::material
