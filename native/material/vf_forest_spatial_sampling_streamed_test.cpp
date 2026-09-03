#include "native/material/vf_forest_spatial_sampling_benchmark.hpp"
#include "native/material/vf_forest_spatial_sampling_prepared.hpp"

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

std::size_t observation_bytes(
    const vf::material::ForestSpatialSampleObservations& observations
) {
    return observations.distance_squared.size() * sizeof(double) +
        observations.environment_similarity.size() * sizeof(double) +
        observations.same_species.size() * sizeof(std::uint8_t);
}

std::size_t classified_bytes(
    const vf::material::ForestSpatialClassifiedObservations& classified
) {
    return classified.blocks.size() *
            sizeof(vf::material::ForestSpatialClassifiedBlock) +
        classified.near_environment_similarity.size() *
            sizeof(double) +
        classified.far_environment_similarity.size() *
            sizeof(double) +
        classified.near_same_species.size() * sizeof(std::uint8_t) +
        classified.far_same_species.size() * sizeof(std::uint8_t);
}

bool same_classified(
    const vf::material::ForestSpatialClassifiedObservations& first,
    const vf::material::ForestSpatialClassifiedObservations& second
) {
    return first.near_environment_similarity ==
            second.near_environment_similarity &&
        first.far_environment_similarity ==
            second.far_environment_similarity &&
        first.near_same_species == second.near_same_species &&
        first.far_same_species == second.far_same_species &&
        first.blocks == second.blocks;
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
            patch_grid(1900, 16, 16),
            4096
        );
    const auto bytes =
        vf::material::PackForestPopulationBytesReference(population);
    const std::uint64_t population_version =
        vf::material::HashDeterministicPacketBytes(bytes);
    const auto blocks =
        vf::material::BuildForestSpatialSamplingBlocksReference(
            200000,
            4096
        );
    const auto raw =
        vf::material::BuildForestSpatialSampleObservationsReference(
            population,
            population_version,
            200000
        );
    const auto oracle =
        vf::material::ClassifyForestSpatialObservationsReference(
            raw,
            96.0 * 96.0,
            640.0 * 640.0,
            blocks
        );
    const auto streamed =
        vf::material::BuildForestSpatialClassifiedObservationsReference(
            population,
            population_version,
            96.0 * 96.0,
            640.0 * 640.0,
            200000,
            blocks
        );
    require(same_classified(streamed, oracle),
            "streamed forest classifier changed observations");
    const std::size_t raw_bytes = observation_bytes(raw);
    const std::size_t compact_bytes =
        classified_bytes(streamed) +
        blocks.size() *
            sizeof(vf::material::ForestSpatialSamplingBlock);
    const std::size_t legacy_peak = raw_bytes + compact_bytes;
    const std::size_t streamed_peak = compact_bytes;
    require(raw_bytes == 3400000 &&
                legacy_peak == 4072204 &&
                streamed_peak == 672204 &&
                population_version == 14609150093325728142ull &&
                streamed_peak * 2 < legacy_peak,
            "streamed forest classifier did not bound live payload");

    const auto legacy_timing = measure(
        [&]() {
            const auto timed_raw =
                vf::material::
                    BuildForestSpatialSampleObservationsReference(
                        population,
                        population_version,
                        200000
                    );
            const auto result =
                vf::material::
                    ClassifyForestSpatialObservationsReference(
                        timed_raw,
                        96.0 * 96.0,
                        640.0 * 640.0,
                        blocks
                    );
            require(same_classified(result, oracle),
                    "legacy classifier timing changed result");
        },
        20
    );
    const auto streamed_timing = measure(
        [&]() {
            const auto result =
                vf::material::
                    BuildForestSpatialClassifiedObservationsReference(
                        population,
                        population_version,
                        96.0 * 96.0,
                        640.0 * 640.0,
                        200000,
                        blocks
                    );
            require(same_classified(result, oracle),
                    "streamed classifier timing changed result");
        },
        20
    );

    std::cout << "forest spatial streamed: pairs=200000"
              << " legacy_peak_bytes=" << legacy_peak
              << " streamed_peak_bytes=" << streamed_peak
              << " legacy_median_us=" << legacy_timing.median_us
              << " streamed_median_us=" << streamed_timing.median_us
              << " legacy_p95_us=" << legacy_timing.p95_us
              << " streamed_p95_us=" << streamed_timing.p95_us
              << " version=" << population_version << '\n';
    return 0;
}
