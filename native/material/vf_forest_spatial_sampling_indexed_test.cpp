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
            patch_grid(1300, 16, 16),
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
    const auto sample_pairs =
        vf::material::BuildForestSpatialSamplePairsReference(
            prepared.population_version,
            population.trees.size(),
            prepared.pair_budget
        );
    const auto replay_pairs =
        vf::material::BuildForestSpatialSamplePairsReference(
            prepared.population_version,
            population.trees.size(),
            prepared.pair_budget
        );
    require(sample_pairs.size() == 200000 &&
                replay_pairs == sample_pairs &&
                prepared.population_version ==
                    6943120267717801362ull &&
                sample_pairs.size() *
                    sizeof(vf::material::ForestSpatialSamplePair) <=
                    200000 * 2 * sizeof(std::size_t),
            "forest pair-index preparation is not deterministic bounded");
    for (const auto& pair : sample_pairs) {
        require(pair.first_index < population.trees.size() &&
                    pair.second_index < population.trees.size() &&
                    pair.first_index != pair.second_index,
                "forest pair-index preparation emitted invalid pair");
    }

    const auto uncached =
        vf::material::SampleForestSpatialQualityParallelReference(
            population,
            96.0,
            640.0,
            200000,
            4096,
            4
        );
    const auto cached =
        vf::material::
            SampleForestSpatialQualityPreparedPairsParallelReference(
                prepared,
                sample_pairs,
                4
            );
    vf::material::ForestSpatialSamplingExecutorReference executor(4);
    const auto reused = executor.sample(prepared);
    require(cached.sample == uncached.sample &&
                reused.sample == uncached.sample,
            "forest pair-index cache changed audit result");

    const auto uncached_timing = measure(
        [&]() {
            const auto result =
                vf::material::SampleForestSpatialQualityParallelReference(
                    population,
                    96.0,
                    640.0,
                    200000,
                    4096,
                    4
                );
            require(result.sample == uncached.sample,
                    "uncached forest audit changed during timing");
        },
        20
    );
    const auto cached_timing = measure(
        [&]() {
            const auto result =
                vf::material::
                    SampleForestSpatialQualityPreparedPairsParallelReference(
                        prepared,
                        sample_pairs,
                        4
                    );
            require(result.sample == uncached.sample,
                    "cached forest audit changed during timing");
        },
        20
    );

    std::cout << "forest spatial indexed: pairs="
              << sample_pairs.size()
              << " bytes=" << sample_pairs.size() *
                  sizeof(vf::material::ForestSpatialSamplePair)
              << " uncached_median_us="
              << uncached_timing.median_us
              << " cached_median_us=" << cached_timing.median_us
              << " uncached_p95_us=" << uncached_timing.p95_us
              << " cached_p95_us=" << cached_timing.p95_us
              << " version=" << prepared.population_version << '\n';
    return 0;
}
