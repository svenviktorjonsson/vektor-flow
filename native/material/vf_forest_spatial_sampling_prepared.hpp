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
    ForestSpatialClassifiedObservations classified;
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
    const auto observations =
        BuildForestSpatialSampleObservationsReference(
            population,
            population_version,
            pair_budget
        );
    auto classified = ClassifyForestSpatialObservationsReference(
        observations,
        near_distance * near_distance,
        far_distance * far_distance,
        blocks
    );
    return {
        &population,
        population_version,
        near_distance * near_distance,
        far_distance * far_distance,
        pair_budget,
        std::move(blocks),
        std::move(classified),
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
        nullptr,
        &prepared.classified,
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
        nullptr,
        worker_count
    );
}

inline ForestSpatialParallelSamplingReport
SampleForestSpatialQualityPreparedObservationsParallelReference(
    const PreparedForestSpatialSamplingReference& prepared,
    const ForestSpatialSampleObservations& observations,
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
        &observations,
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
        prepared.classified.blocks.size() *
            sizeof(ForestSpatialClassifiedBlock) +
        prepared.classified.near_environment_similarity.size() *
            sizeof(double) +
        prepared.classified.far_environment_similarity.size() *
            sizeof(double) +
        prepared.classified.near_same_species.size() *
            sizeof(std::uint8_t) +
        prepared.classified.far_same_species.size() *
            sizeof(std::uint8_t);
}

}  // namespace vf::material
