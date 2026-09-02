#include "native/material/vf_forest_spatial_sampling_executor.hpp"
#include "native/material/vf_forest_spatial_sampling_benchmark.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <future>
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
            patch_grid(1200, 16, 16),
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
    require(prepared.population_version ==
                16296876073815325444ull,
            "forest executor population version changed");
    const auto alternate =
        vf::material::PrepareForestSpatialSamplingReference(
            population,
            128.0,
            768.0,
            120000,
            4096
        );
    const auto baseline =
        vf::material::
            SampleForestSpatialQualityPreparedParallelReference(
                prepared,
                4
            );
    const auto alternate_baseline =
        vf::material::
            SampleForestSpatialQualityPreparedParallelReference(
                alternate,
                4
            );
    vf::material::ForestSpatialSamplingExecutorReference executor(4);
    require(executor.worker_count() == 4,
            "forest executor did not retain worker count");
    require(executor.sample(prepared).sample == baseline.sample &&
                executor.sample(alternate).sample ==
                    alternate_baseline.sample &&
                executor.sample(prepared).sample == baseline.sample,
            "forest executor leaked state between audit shapes");
    auto concurrent_first = std::async(
        std::launch::async,
        [&]() { return executor.sample(prepared); }
    );
    auto concurrent_second = std::async(
        std::launch::async,
        [&]() { return executor.sample(alternate); }
    );
    require(concurrent_first.get().sample == baseline.sample &&
                concurrent_second.get().sample ==
                    alternate_baseline.sample,
            "forest executor allowed concurrent job state to overlap");

    const auto startup_timing = measure(
        [&]() {
            const auto result =
                vf::material::
                    SampleForestSpatialQualityPreparedParallelReference(
                        prepared,
                        4
                    );
            require(result.sample == baseline.sample,
                    "startup timing changed forest audit");
        },
        20
    );
    const auto reused_timing = measure(
        [&]() {
            const auto result = executor.sample(prepared);
            require(result.sample == baseline.sample,
                    "reused worker timing changed forest audit");
        },
        20
    );

    std::cout << "forest spatial executor: pairs="
              << prepared.pair_budget
              << " workers=" << executor.worker_count()
              << " startup_median_us="
              << startup_timing.median_us
              << " reused_median_us="
              << reused_timing.median_us
              << " startup_p95_us=" << startup_timing.p95_us
              << " reused_p95_us=" << reused_timing.p95_us
              << " version=" << prepared.population_version
              << '\n';
    return 0;
}
