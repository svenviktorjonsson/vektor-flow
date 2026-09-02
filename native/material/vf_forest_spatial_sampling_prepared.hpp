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
    ForestSpatialSampleObservations observations;
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
    const auto sample_pairs =
        BuildForestSpatialSamplePairsReference(
            population_version,
            population.trees.size(),
            pair_budget
        );
    ForestSpatialSampleObservations observations;
    observations.distance_squared.reserve(pair_budget);
    observations.environment_similarity.reserve(pair_budget);
    observations.same_species.reserve(pair_budget);
    for (const auto& pair : sample_pairs) {
        const auto observation = ObserveForestSpatialPairReference(
            population,
            pair
        );
        observations.distance_squared.push_back(
            observation.distance_squared
        );
        observations.environment_similarity.push_back(
            observation.environment_similarity
        );
        observations.same_species.push_back(
            observation.same_species
        );
    }
    return {
        &population,
        population_version,
        near_distance * near_distance,
        far_distance * far_distance,
        pair_budget,
        std::move(blocks),
        std::move(observations),
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
        nullptr,
        &prepared.observations,
        worker_count
    );
}

inline ForestSpatialParallelSamplingReport
SampleForestSpatialQualityPreparedPairsParallelReference(
    const PreparedForestSpatialSamplingReference& prepared,
    const std::vector<ForestSpatialSamplePair>& sample_pairs,
    std::size_t worker_count
) {
    return SampleForestSpatialQualityPreparedCoreReference(
        *prepared.population,
        prepared.population_version,
        prepared.near_squared,
        prepared.far_squared,
        prepared.pair_budget,
        prepared.blocks,
        &sample_pairs,
        nullptr,
        worker_count
    );
}

inline std::size_t
PreparedForestSpatialSamplingStorageBytesReference(
    const PreparedForestSpatialSamplingReference& prepared
) {
    return prepared.blocks.size() *
            sizeof(ForestSpatialSamplingBlock) +
        prepared.observations.distance_squared.size() *
            sizeof(double) +
        prepared.observations.environment_similarity.size() *
            sizeof(double) +
        prepared.observations.same_species.size() *
            sizeof(std::uint8_t);
}

}  // namespace vf::material
