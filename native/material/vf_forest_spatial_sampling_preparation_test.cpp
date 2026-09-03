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
            patch_grid(1800, 16, 16),
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
    const auto legacy =
        vf::material::BuildForestSpatialSampleObservationsReference(
            population,
            pairs
        );
    const auto direct =
        vf::material::BuildForestSpatialSampleObservationsReference(
            population,
            prepared.population_version,
            prepared.pair_budget
        );
    require(direct.distance_squared == legacy.distance_squared &&
                direct.environment_similarity ==
                    legacy.environment_similarity &&
                direct.same_species == legacy.same_species,
            "direct forest observations changed deterministic samples");

    const std::size_t pair_bytes =
        pairs.size() * sizeof(vf::material::ForestSpatialSamplePair);
    const std::size_t raw_bytes = observation_bytes(legacy);
    const std::size_t retained_bytes =
        vf::material::PreparedForestSpatialSamplingStorageBytesReference(
            prepared
        );
    const std::size_t legacy_peak =
        pair_bytes + raw_bytes + retained_bytes;
    const std::size_t direct_peak = raw_bytes + retained_bytes;
    require(pair_bytes == 3200000 && raw_bytes == 3400000 &&
                legacy_peak == 7270656 &&
                direct_peak == 4070656 &&
                prepared.population_version ==
                    14092030245081234834ull,
            "forest preparation peak model changed unexpectedly");

    const auto legacy_timing = measure(
        [&]() {
            const auto timed_pairs =
                vf::material::BuildForestSpatialSamplePairsReference(
                    prepared.population_version,
                    population.trees.size(),
                    prepared.pair_budget
                );
            const auto timed_observations =
                vf::material::BuildForestSpatialSampleObservationsReference(
                    population,
                    timed_pairs
                );
            require(timed_observations.distance_squared.size() ==
                        prepared.pair_budget,
                    "legacy forest preparation timing changed output");
        },
        20
    );
    const auto direct_timing = measure(
        [&]() {
            const auto timed_observations =
                vf::material::BuildForestSpatialSampleObservationsReference(
                    population,
                    prepared.population_version,
                    prepared.pair_budget
                );
            require(timed_observations.distance_squared.size() ==
                        prepared.pair_budget,
                    "direct forest preparation timing changed output");
        },
        20
    );

    std::cout << "forest spatial preparation: pairs="
              << prepared.pair_budget
              << " legacy_peak_bytes=" << legacy_peak
              << " direct_peak_bytes=" << direct_peak
              << " legacy_median_us=" << legacy_timing.median_us
              << " direct_median_us=" << direct_timing.median_us
              << " legacy_p95_us=" << legacy_timing.p95_us
              << " direct_p95_us=" << direct_timing.p95_us
              << " version=" << prepared.population_version << '\n';
    return 0;
}
