#pragma once

#include "native/material/vf_forest_spatial_sampling.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct ForestSpatialSamplingBlock {
    std::size_t first_sample;
    std::size_t sample_count;
};

inline bool operator==(
    const ForestSpatialSamplingBlock& first,
    const ForestSpatialSamplingBlock& second
) {
    return first.first_sample == second.first_sample &&
        first.sample_count == second.sample_count;
}

inline std::vector<ForestSpatialSamplingBlock>
BuildForestSpatialSamplingBlocksReference(
    std::size_t pair_budget,
    std::size_t block_size
) {
    if (pair_budget == 0 || pair_budget > 10000000 ||
        block_size == 0 || block_size > pair_budget) {
        throw std::invalid_argument(
            "forest spatial block request is invalid"
        );
    }
    std::vector<ForestSpatialSamplingBlock> blocks;
    blocks.reserve((pair_budget + block_size - 1) / block_size);
    for (std::size_t first = 0; first < pair_budget;
         first += block_size) {
        blocks.push_back(
            {
                first,
                std::min(block_size, pair_budget - first),
            }
        );
    }
    return blocks;
}

inline void ValidateForestSpatialSamplingBlocksReference(
    std::size_t pair_budget,
    std::vector<ForestSpatialSamplingBlock> blocks
) {
    std::sort(
        blocks.begin(),
        blocks.end(),
        [](const auto& first, const auto& second) {
            return first.first_sample < second.first_sample;
        }
    );
    std::size_t expected_first = 0;
    for (const auto& block : blocks) {
        if (block.sample_count == 0 ||
            block.first_sample != expected_first ||
            block.sample_count > pair_budget - expected_first) {
            throw std::invalid_argument(
                "forest spatial blocks do not cover the budget"
            );
        }
        expected_first += block.sample_count;
    }
    if (expected_first != pair_budget) {
        throw std::invalid_argument(
            "forest spatial blocks do not cover the budget"
        );
    }
}

struct ForestSpatialSamplingBlockResult {
    std::size_t first_sample;
    ForestSpatialSamplingAccumulator accumulator;
};

inline ForestSpatialSamplingReport
SampleForestSpatialQualityBlocksReference(
    const ForestPopulationRealization& population,
    double near_distance,
    double far_distance,
    std::size_t pair_budget,
    const std::vector<ForestSpatialSamplingBlock>& blocks
) {
    ValidateForestSpatialSamplingRequestReference(
        population,
        near_distance,
        far_distance,
        pair_budget
    );
    ValidateForestSpatialSamplingBlocksReference(
        pair_budget,
        blocks
    );
    const auto bytes = PackForestPopulationBytesReference(population);
    const std::uint64_t population_version =
        HashDeterministicPacketBytes(bytes);
    const double near_squared = near_distance * near_distance;
    const double far_squared = far_distance * far_distance;
    std::vector<ForestSpatialSamplingBlockResult> completed;
    completed.reserve(blocks.size());
    for (const auto& block : blocks) {
        completed.push_back(
            {
                block.first_sample,
                AccumulateForestSpatialSamplingRangeReference(
                    population,
                    population_version,
                    near_squared,
                    far_squared,
                    block.first_sample,
                    block.sample_count
                ),
            }
        );
    }
    std::sort(
        completed.begin(),
        completed.end(),
        [](const auto& first, const auto& second) {
            return first.first_sample < second.first_sample;
        }
    );
    ForestSpatialSamplingAccumulator total;
    for (const auto& result : completed) {
        total.near_pairs += result.accumulator.near_pairs;
        total.far_pairs += result.accumulator.far_pairs;
        total.near_same_species +=
            result.accumulator.near_same_species;
        total.far_same_species +=
            result.accumulator.far_same_species;
        total.near_environment_sum +=
            result.accumulator.near_environment_sum;
        total.far_environment_sum +=
            result.accumulator.far_environment_sum;
    }
    return FinalizeForestSpatialSamplingReference(
        population,
        pair_budget,
        population_version,
        total
    );
}

}  // namespace vf::material
