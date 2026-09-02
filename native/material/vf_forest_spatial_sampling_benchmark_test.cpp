#include "native/material/vf_forest_spatial_sampling_benchmark.hpp"

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

}  // namespace

int main() {
    const auto synthetic =
        vf::material::SummarizeForestSpatialSamplingTimingsReference(
            {9.0, 1.0, 5.0, 2.0, 8.0,
             3.0, 7.0, 4.0, 6.0, 10.0}
        );
    require(synthetic.minimum_us == 1.0 &&
                synthetic.median_us == 5.0 &&
                synthetic.p95_us == 10.0 &&
                synthetic.p99_us == 10.0 &&
                synthetic.maximum_us == 10.0,
            "forest sampling quantiles are not nearest-rank");

    const vf::material::ForestPopulationDefinition definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31,
        5,
        1000000000ull,
        1000000000ull,
        64.0,
        8.0,
    };
    const auto forest =
        vf::material::RealizeForestPopulationReference(
            definition,
            patch_grid(700, 16, 16),
            4096
        );
    const auto benchmark =
        vf::material::BenchmarkForestSpatialSamplingReference(
            forest,
            96.0,
            640.0,
            100000,
            2,
            25
        );
    require(benchmark.steady.samples_us.size() == 25 &&
                benchmark.first_use_us >= 0.0 &&
                benchmark.steady.minimum_us >= 0.0 &&
                benchmark.steady.minimum_us <=
                    benchmark.steady.median_us &&
                benchmark.steady.median_us <=
                    benchmark.steady.p95_us &&
                benchmark.steady.p95_us <=
                    benchmark.steady.p99_us &&
                benchmark.steady.p99_us <=
                    benchmark.steady.maximum_us,
            "forest sampling timing distribution is invalid");
    require(benchmark.evaluated_pairs_per_run == 100000 &&
                benchmark.verified_runs == 28,
            "forest sampling benchmark changed its bounded work");
    require(benchmark.sample_version == 1441520296232652930ull,
            "forest sampling benchmark result version changed");

    const auto replay =
        vf::material::BenchmarkForestSpatialSamplingReference(
            forest,
            96.0,
            640.0,
            100000,
            0,
            1
        );
    require(replay.sample_version == benchmark.sample_version &&
                replay.evaluated_pairs_per_run ==
                    benchmark.evaluated_pairs_per_run,
            "forest sampling benchmark result changed on replay");

    std::cout << "forest spatial sampling benchmark: runs="
              << benchmark.steady.samples_us.size()
              << " pairs_per_run="
              << benchmark.evaluated_pairs_per_run
              << " first_us=" << benchmark.first_use_us
              << " median_us=" << benchmark.steady.median_us
              << " p95_us=" << benchmark.steady.p95_us
              << " p99_us=" << benchmark.steady.p99_us
              << " version=" << benchmark.sample_version << '\n';
    return 0;
}
