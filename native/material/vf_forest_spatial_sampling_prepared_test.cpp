#include "native/material/vf_forest_spatial_sampling_prepared.hpp"
#include "native/material/vf_forest_spatial_sampling_benchmark.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
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
            patch_grid(1100, 16, 16),
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
    require(prepared.population_version == 8863207011472877614ull &&
                prepared.blocks.size() == 49 &&
                prepared.pair_budget == 200000,
            "forest spatial preparation omitted stable setup");

    const auto baseline =
        vf::material::SampleForestSpatialQualityParallelReference(
            population,
            96.0,
            640.0,
            200000,
            4096,
            4
        );
    for (const std::size_t workers : {1u, 2u, 4u}) {
        const auto actual =
            vf::material::
                SampleForestSpatialQualityPreparedParallelReference(
                    prepared,
                    workers
                );
        require(actual.sample == baseline.sample &&
                    actual.block_count == baseline.block_count &&
                    actual.worker_count == workers,
                "prepared forest audit changed worker result");
    }

    const auto baseline_timing = measure(
        [&]() {
            const auto result =
                vf::material::
                    SampleForestSpatialQualityParallelReference(
                        population,
                        96.0,
                        640.0,
                        200000,
                        4096,
                        4
                    );
            require(result.sample == baseline.sample,
                    "baseline forest timing changed result");
        },
        20
    );
    const auto prepared_timing = measure(
        [&]() {
            const auto result =
                vf::material::
                    SampleForestSpatialQualityPreparedParallelReference(
                        prepared,
                        4
                    );
            require(result.sample == baseline.sample,
                    "prepared forest timing changed result");
        },
        20
    );

    std::cout << "forest spatial prepared: pairs="
              << prepared.pair_budget
              << " blocks=" << prepared.blocks.size()
              << " baseline_median_us="
              << baseline_timing.median_us
              << " prepared_median_us="
              << prepared_timing.median_us
              << " baseline_p95_us=" << baseline_timing.p95_us
              << " prepared_p95_us=" << prepared_timing.p95_us
              << " version=" << prepared.population_version
              << '\n';
    return 0;
}
