#include "native/material/vf_forest_spatial_sampling_benchmark.hpp"
#include "native/material/vf_forest_spatial_sampling_executor.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

std::vector<vf::material::ForestPatchDemand> patch_grid(
    std::uint64_t first_patch,
    std::size_t side,
    std::size_t trees_per_patch
) {
    std::vector<vf::material::ForestPatchDemand> demands;
    for (std::size_t patch = 0; patch < side * side; ++patch) {
        demands.push_back(
            {
                first_patch + patch,
                {
                    static_cast<std::int64_t>(patch % side),
                    static_cast<std::int64_t>(patch / side),
                },
                trees_per_patch,
            }
        );
    }
    return demands;
}

template <class Function>
vf::material::ForestSpatialSamplingTimingDistribution measure(
    Function&& function,
    std::size_t runs
) {
    using Clock = std::chrono::steady_clock;
    std::vector<double> samples;
    samples.reserve(runs);
    for (std::size_t run = 0; run < runs; ++run) {
        const auto start = Clock::now();
        function();
        const auto finish = Clock::now();
        samples.push_back(
            std::chrono::duration<double, std::micro>(
                finish - start
            ).count()
        );
    }
    return vf::material::
        SummarizeForestSpatialSamplingTimingsReference(
            std::move(samples)
        );
}

}  // namespace

int main() {
    const vf::material::ForestPopulationDefinition definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31,
        5,
        1000000000ull,
        1000000000ull,
        64.0,
        8.0,
    };
    const auto population =
        vf::material::RealizeForestPopulationReference(
            definition,
            patch_grid(1700, 16, 16),
            4096
        );
    const auto prepared =
        vf::material::PrepareForestSpatialSamplingReference(
            population,
            96.0,
            640.0,
            200000,
            4096
        );
    const auto pairs =
        vf::material::BuildForestSpatialSamplePairsReference(
            prepared.population_version,
            population.trees.size(),
            prepared.pair_budget
        );
    const auto observations =
        vf::material::BuildForestSpatialSampleObservationsReference(
            population,
            pairs
        );
    const std::size_t raw_observation_bytes =
        observations.distance_squared.size() * sizeof(double) +
        observations.environment_similarity.size() *
            sizeof(double) +
        observations.same_species.size() * sizeof(std::uint8_t);
    const std::size_t retained_bytes =
        vf::material::PreparedForestSpatialSamplingStorageBytesReference(
            prepared
        );
    require(raw_observation_bytes == 3400000 &&
                retained_bytes == 674499 &&
                prepared.population_version ==
                    13386321735724611223ull,
            "forest classified cache did not bound retained memory");

    const auto raw =
        vf::material::
            SampleForestSpatialQualityPreparedObservationsParallelReference(
                prepared,
                observations,
                4
            );
    const auto classified =
        vf::material::
            SampleForestSpatialQualityPreparedParallelReference(
                prepared,
                4
            );
    vf::material::ForestSpatialSamplingExecutorReference executor(4);
    require(classified.sample == raw.sample &&
                executor.sample(prepared).sample == raw.sample &&
                prepared.classified.near_environment_similarity.size() ==
                    raw.sample.near_pair_count &&
                prepared.classified.far_environment_similarity.size() ==
                    raw.sample.far_pair_count &&
                raw.sample.near_pair_count == 5071 &&
                raw.sample.far_pair_count == 69612,
            "forest classified cache changed audit result");

    const auto raw_timing = measure(
        [&]() {
            const auto result = vf::material::
                SampleForestSpatialQualityPreparedObservationsParallelReference(
                    prepared,
                    observations,
                    4
                );
            require(result.sample == raw.sample,
                    "raw observation audit changed during timing");
        },
        20
    );
    const auto classified_timing = measure(
        [&]() {
            const auto result =
                vf::material::
                    SampleForestSpatialQualityPreparedParallelReference(
                        prepared,
                        4
                    );
            require(result.sample == raw.sample,
                    "classified forest audit changed during timing");
        },
        20
    );

    std::cout << "forest spatial classified: pairs="
              << prepared.pair_budget
              << " raw_bytes=" << raw_observation_bytes
              << " retained_bytes=" << retained_bytes
              << " near=" << raw.sample.near_pair_count
              << " far=" << raw.sample.far_pair_count
              << " raw_median_us=" << raw_timing.median_us
              << " classified_median_us="
              << classified_timing.median_us
              << " raw_p95_us=" << raw_timing.p95_us
              << " classified_p95_us="
              << classified_timing.p95_us
              << " version=" << prepared.population_version << '\n';
    return 0;
}
