#pragma once

#include "native/material/vf_forest_spatial_sampling_parallel.hpp"

#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace vf::material {

struct PreparedForestSpatialSamplingReference {
    const ForestPopulationRealization* population;
    std::uint64_t population_version;
    double near_squared;
    double far_squared;
    std::size_t pair_budget;
    std::vector<ForestSpatialSamplingBlock> blocks;
    std::vector<ForestSpatialSamplePair> sample_pairs;
};

inline PreparedForestSpatialSamplingReference
PrepareForestSpatialSamplingReference(
    const ForestPopulationRealization& population,
    double near_distance,
    double far_distance,
    std::size_t pair_budget,
    std::size_t block_size
) {
    ValidateForestSpatialSamplingRequestReference(
        population,
        near_distance,
        far_distance,
        pair_budget
    );
    auto blocks = BuildForestSpatialSamplingBlocksReference(
        pair_budget,
        block_size
    );
    const auto bytes = PackForestPopulationBytesReference(population);
    const std::uint64_t population_version =
        HashDeterministicPacketBytes(bytes);
    std::vector<ForestSpatialSamplePair> sample_pairs;
    sample_pairs.reserve(pair_budget);
    for (std::size_t sample = 0; sample < pair_budget; ++sample) {
        sample_pairs.push_back(
            ForestSpatialSamplePairReference(
                population_version,
                population.trees.size(),
                sample
            )
        );
    }
    return {
        &population,
        population_version,
        near_distance * near_distance,
        far_distance * far_distance,
        pair_budget,
        std::move(blocks),
        std::move(sample_pairs),
    };
}

inline ForestSpatialParallelSamplingReport
SampleForestSpatialQualityPreparedParallelReference(
    const PreparedForestSpatialSamplingReference& prepared,
    std::size_t worker_count
) {
    return SampleForestSpatialQualityPreparedCoreReference(
        *prepared.population,
        prepared.population_version,
        prepared.near_squared,
        prepared.far_squared,
        prepared.pair_budget,
        prepared.blocks,
        &prepared.sample_pairs,
        worker_count
    );
}

}  // namespace vf::material
