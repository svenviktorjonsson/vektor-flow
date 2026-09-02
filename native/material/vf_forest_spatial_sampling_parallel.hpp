#pragma once

#include "native/material/vf_forest_spatial_sampling_blocks.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <future>
#include <iterator>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct ForestSpatialParallelSamplingReport {
    ForestSpatialSamplingReport sample;
    std::size_t block_count;
    std::size_t worker_count;
};

inline ForestSpatialParallelSamplingReport
SampleForestSpatialQualityParallelReference(
    const ForestPopulationRealization& population,
    double near_distance,
    double far_distance,
    std::size_t pair_budget,
    std::size_t block_size,
    std::size_t worker_count
) {
    if (worker_count == 0 || worker_count > 64) {
        throw std::invalid_argument(
            "forest spatial worker count is invalid"
        );
    }
    ValidateForestSpatialSamplingRequestReference(
        population,
        near_distance,
        far_distance,
        pair_budget
    );
    const auto blocks =
        BuildForestSpatialSamplingBlocksReference(
            pair_budget,
            block_size
        );
    const std::size_t active_workers =
        std::min(worker_count, blocks.size());
    const auto bytes = PackForestPopulationBytesReference(population);
    const std::uint64_t population_version =
        HashDeterministicPacketBytes(bytes);
    const double near_squared = near_distance * near_distance;
    const double far_squared = far_distance * far_distance;
    using BlockResults =
        std::vector<ForestSpatialSamplingBlockResult>;
    std::vector<std::future<BlockResults>> futures;
    futures.reserve(active_workers);
    for (std::size_t worker = 0;
         worker < active_workers;
         ++worker) {
        futures.push_back(
            std::async(
                std::launch::async,
                [&, worker]() {
                    BlockResults results;
                    results.reserve(
                        (blocks.size() + active_workers - 1) /
                        active_workers
                    );
                    for (std::size_t index = worker;
                         index < blocks.size();
                         index += active_workers) {
                        results.push_back(
                            EvaluateForestSpatialSamplingBlockReference(
                                population,
                                population_version,
                                near_squared,
                                far_squared,
                                blocks[index]
                            )
                        );
                    }
                    return results;
                }
            )
        );
    }
    BlockResults completed;
    completed.reserve(blocks.size());
    for (auto& future : futures) {
        auto results = future.get();
        completed.insert(
            completed.end(),
            std::make_move_iterator(results.begin()),
            std::make_move_iterator(results.end())
        );
    }
    auto sample = FinalizeForestSpatialSamplingBlocksReference(
        population,
        pair_budget,
        population_version,
        std::move(completed)
    );
    return {
        std::move(sample),
        blocks.size(),
        active_workers,
    };
}

}  // namespace vf::material
