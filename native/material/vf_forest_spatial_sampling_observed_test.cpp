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
            patch_grid(1400, 16, 16),
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
    const auto replay =
        vf::material::PrepareForestSpatialSamplingReference(
            population,
            96.0,
            640.0,
            200000,
            4096
        );
    require(prepared.observations.distance_squared.size() ==
                200000 &&
                prepared.observations.environment_similarity.size() ==
                    200000 &&
                prepared.observations.same_species.size() == 200000 &&
                replay.observations.distance_squared ==
                    prepared.observations.distance_squared &&
                replay.observations.environment_similarity ==
                    prepared.observations.environment_similarity &&
                replay.observations.same_species ==
                    prepared.observations.same_species,
            "forest pair observations are not deterministic bounded");
    const std::size_t observation_bytes =
        prepared.observations.distance_squared.size() *
            sizeof(double) +
        prepared.observations.environment_similarity.size() *
            sizeof(double) +
        prepared.observations.same_species.size() *
            sizeof(std::uint8_t);
    require(observation_bytes == 3400000,
            "forest pair observation storage changed its bound");
    require(prepared.population_version ==
                10960672012680006616ull,
            "forest pair observation population changed");

    const auto indexed =
        vf::material::
            SampleForestSpatialQualityPreparedPairsParallelReference(
                prepared,
                4
            );
    const auto observed =
        vf::material::
            SampleForestSpatialQualityPreparedParallelReference(
                prepared,
                4
            );
    vf::material::ForestSpatialSamplingExecutorReference executor(4);
    const auto reused = executor.sample(prepared);
    require(observed.sample == indexed.sample &&
                reused.sample == indexed.sample,
            "forest pair observation cache changed audit result");

    const auto indexed_timing = measure(
        [&]() {
            const auto result =
                vf::material::
                    SampleForestSpatialQualityPreparedPairsParallelReference(
                        prepared,
                        4
                    );
            require(result.sample == indexed.sample,
                    "indexed forest audit changed during timing");
        },
        20
    );
    const auto observed_timing = measure(
        [&]() {
            const auto result =
                vf::material::
                    SampleForestSpatialQualityPreparedParallelReference(
                        prepared,
                        4
                    );
            require(result.sample == indexed.sample,
                    "observed forest audit changed during timing");
        },
        20
    );

    std::cout << "forest spatial observations: pairs="
              << prepared.sample_pairs.size()
              << " observation_bytes=" << observation_bytes
              << " indexed_median_us="
              << indexed_timing.median_us
              << " observed_median_us="
              << observed_timing.median_us
              << " indexed_p95_us=" << indexed_timing.p95_us
              << " observed_p95_us=" << observed_timing.p95_us
              << " version=" << prepared.population_version << '\n';
    return 0;
}
