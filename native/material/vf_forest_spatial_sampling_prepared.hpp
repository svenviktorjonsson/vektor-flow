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
    return {
        &population,
        HashDeterministicPacketBytes(bytes),
        near_distance * near_distance,
        far_distance * far_distance,
        pair_budget,
        std::move(blocks),
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
        worker_count
    );
}

}  // namespace vf::material
