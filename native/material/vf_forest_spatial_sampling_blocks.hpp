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

struct ForestSpatialClassifiedBlock {
    std::size_t near_first;
    std::size_t near_count;
    std::size_t far_first;
    std::size_t far_count;

    bool operator==(const ForestSpatialClassifiedBlock&) const =
        default;
};

struct ForestSpatialClassifiedObservations {
    std::vector<double> near_environment_similarity;
    std::vector<double> far_environment_similarity;
    std::vector<std::uint8_t> near_same_species;
    std::vector<std::uint8_t> far_same_species;
    std::vector<ForestSpatialClassifiedBlock> blocks;
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

inline ForestSpatialClassifiedObservations
ClassifyForestSpatialObservationsReference(
    const ForestSpatialSampleObservations& observations,
    double near_squared,
    double far_squared,
    const std::vector<ForestSpatialSamplingBlock>& blocks
) {
    const std::size_t observation_count =
        observations.distance_squared.size();
    if (observations.environment_similarity.size() !=
            observation_count ||
        observations.same_species.size() != observation_count) {
        throw std::invalid_argument(
            "forest spatial observation channels are invalid"
        );
    }
    ValidateForestSpatialSamplingBlocksReference(
        observation_count,
        blocks
    );
    std::size_t near_count = 0;
    std::size_t far_count = 0;
    for (const double distance_squared :
         observations.distance_squared) {
        if (distance_squared <= near_squared) {
            ++near_count;
        } else if (distance_squared >= far_squared) {
            ++far_count;
        }
    }
    ForestSpatialClassifiedObservations classified;
    classified.near_environment_similarity.reserve(near_count);
    classified.far_environment_similarity.reserve(far_count);
    classified.near_same_species.reserve(near_count);
    classified.far_same_species.reserve(far_count);
    classified.blocks.reserve(blocks.size());
    for (const auto& block : blocks) {
        const std::size_t near_first =
            classified.near_environment_similarity.size();
        const std::size_t far_first =
            classified.far_environment_similarity.size();
        const std::size_t last =
            block.first_sample + block.sample_count;
        for (std::size_t index = block.first_sample;
             index < last;
             ++index) {
            const double distance_squared =
                observations.distance_squared[index];
            if (distance_squared <= near_squared) {
                classified.near_environment_similarity.push_back(
                    observations.environment_similarity[index]
                );
                classified.near_same_species.push_back(
                    observations.same_species[index]
                );
            } else if (distance_squared >= far_squared) {
                classified.far_environment_similarity.push_back(
                    observations.environment_similarity[index]
                );
                classified.far_same_species.push_back(
                    observations.same_species[index]
                );
            }
        }
        classified.blocks.push_back(
            {
                near_first,
                classified.near_environment_similarity.size() -
                    near_first,
                far_first,
                classified.far_environment_similarity.size() -
                    far_first,
            }
        );
    }
    return classified;
}

inline ForestSpatialClassifiedObservations
BuildForestSpatialClassifiedObservationsReference(
    const ForestPopulationRealization& population,
    std::uint64_t population_version,
    double near_squared,
    double far_squared,
    std::size_t pair_budget,
    const std::vector<ForestSpatialSamplingBlock>& blocks
) {
    if (population.trees.size() < 2 || pair_budget == 0 ||
        pair_budget > 10000000 ||
        !std::isfinite(near_squared) || near_squared <= 0.0 ||
        !std::isfinite(far_squared) ||
        far_squared <= near_squared) {
        throw std::invalid_argument(
            "forest streamed classification request is invalid"
        );
    }
    ValidateForestSpatialSamplingBlocksReference(
        pair_budget,
        blocks
    );
    ForestSpatialClassifiedObservations classified;
    classified.blocks.reserve(blocks.size());
    for (const auto& block : blocks) {
        const std::size_t near_first =
            classified.near_environment_similarity.size();
        const std::size_t far_first =
            classified.far_environment_similarity.size();
        const std::size_t last =
            block.first_sample + block.sample_count;
        for (std::size_t sample = block.first_sample;
             sample < last;
             ++sample) {
            const auto observation =
                ObserveForestSpatialPairReference(
                    population,
                    ForestSpatialSamplePairReference(
                        population_version,
                        population.trees.size(),
                        sample
                    )
                );
            if (observation.distance_squared <= near_squared) {
                classified.near_environment_similarity.push_back(
                    observation.environment_similarity
                );
                classified.near_same_species.push_back(
                    observation.same_species
                );
            } else if (observation.distance_squared >= far_squared) {
                classified.far_environment_similarity.push_back(
                    observation.environment_similarity
                );
                classified.far_same_species.push_back(
                    observation.same_species
                );
            }
        }
        classified.blocks.push_back(
            {
                near_first,
                classified.near_environment_similarity.size() -
                    near_first,
                far_first,
                classified.far_environment_similarity.size() -
                    far_first,
            }
        );
    }
    classified.near_environment_similarity.shrink_to_fit();
    classified.far_environment_similarity.shrink_to_fit();
    classified.near_same_species.shrink_to_fit();
    classified.far_same_species.shrink_to_fit();
    return classified;
}

struct ForestSpatialSamplingBlockResult {
    std::size_t first_sample;
    ForestSpatialSamplingAccumulator accumulator;
};

inline ForestSpatialSamplingReport
FinalizeForestSpatialSamplingBlocksReference(
    const ForestPopulationRealization& population,
    std::size_t pair_budget,
    std::uint64_t population_version,
    std::vector<ForestSpatialSamplingBlockResult> completed
) {
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

inline ForestSpatialSamplingBlockResult
EvaluateForestSpatialSamplingBlockReference(
    const ForestPopulationRealization& population,
    std::uint64_t population_version,
    double near_squared,
    double far_squared,
    const ForestSpatialSamplingBlock& block
) {
    return {
        block.first_sample,
        AccumulateForestSpatialSamplingRangeReference(
            population,
            population_version,
            near_squared,
            far_squared,
            block.first_sample,
            block.sample_count
        ),
    };
}

inline ForestSpatialSamplingBlockResult
EvaluateForestSpatialIndexedBlockReference(
    const ForestPopulationRealization& population,
    double near_squared,
    double far_squared,
    const std::vector<ForestSpatialSamplePair>& pairs,
    const ForestSpatialSamplingBlock& block
) {
    return {
        block.first_sample,
        AccumulateForestSpatialSamplingPairsReference(
            population,
            near_squared,
            far_squared,
            pairs,
            block.first_sample,
            block.sample_count
        ),
    };
}

inline ForestSpatialSamplingBlockResult
EvaluateForestSpatialObservedBlockReference(
    double near_squared,
    double far_squared,
    const ForestSpatialSampleObservations& observations,
    const ForestSpatialSamplingBlock& block
) {
    return {
        block.first_sample,
        AccumulateForestSpatialObservationsReference(
            near_squared,
            far_squared,
            observations,
            block.first_sample,
            block.sample_count
        ),
    };
}

inline ForestSpatialSamplingBlockResult
EvaluateForestSpatialClassifiedBlockReference(
    const ForestSpatialClassifiedObservations& classified,
    const ForestSpatialSamplingBlock& block,
    std::size_t block_index
) {
    if (block_index >= classified.blocks.size()) {
        throw std::invalid_argument(
            "forest classified block index is invalid"
        );
    }
    const auto& spans = classified.blocks[block_index];
    ForestSpatialSamplingAccumulator accumulator;
    accumulator.near_pairs = spans.near_count;
    accumulator.far_pairs = spans.far_count;
    for (std::size_t offset = 0;
         offset < spans.near_count;
         ++offset) {
        const std::size_t index = spans.near_first + offset;
        accumulator.near_environment_sum +=
            classified.near_environment_similarity[index];
        accumulator.near_same_species +=
            classified.near_same_species[index];
    }
    for (std::size_t offset = 0;
         offset < spans.far_count;
         ++offset) {
        const std::size_t index = spans.far_first + offset;
        accumulator.far_environment_sum +=
            classified.far_environment_similarity[index];
        accumulator.far_same_species +=
            classified.far_same_species[index];
    }
    return {block.first_sample, accumulator};
}

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
            EvaluateForestSpatialSamplingBlockReference(
                population,
                population_version,
                near_squared,
                far_squared,
                block
            )
        );
    }
    return FinalizeForestSpatialSamplingBlocksReference(
        population,
        pair_budget,
        population_version,
        std::move(completed)
    );
}

}  // namespace vf::material
