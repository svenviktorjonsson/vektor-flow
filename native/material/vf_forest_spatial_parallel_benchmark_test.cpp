#include "native/material/vf_forest_spatial_parallel_benchmark.hpp"

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

void require_timing_order(
    const vf::material::ForestSpatialSamplingTimingDistribution& timing
) {
    require(timing.samples_us.size() == 20 &&
                timing.minimum_us >= 0.0 &&
                timing.minimum_us <= timing.median_us &&
                timing.median_us <= timing.p95_us &&
                timing.p95_us <= timing.p99_us &&
                timing.p99_us <= timing.maximum_us,
            "forest worker timing distribution is invalid");
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
            patch_grid(1000, 16, 16),
            4096
        );
    const auto benchmark = [&](std::size_t workers) {
        return vf::material::BenchmarkForestSpatialWorkersReference(
            population,
            96.0,
            640.0,
            400000,
            8192,
            workers,
            2,
            20
        );
    };
    const auto one = benchmark(1);
    const auto two = benchmark(2);
    const auto four = benchmark(4);
    require_timing_order(one.steady);
    require_timing_order(two.steady);
    require_timing_order(four.steady);
    require(one.worker_count == 1 &&
                two.worker_count == 2 &&
                four.worker_count == 4 &&
                one.block_count == 49 &&
                two.block_count == 49 &&
                four.block_count == 49 &&
                one.verified_runs == 23 &&
                two.verified_runs == 23 &&
                four.verified_runs == 23,
            "forest worker benchmark did not verify every run");
    require(one.sample_version == two.sample_version &&
                two.sample_version == four.sample_version &&
                four.sample_version == 11395695950766559153ull,
            "forest worker benchmark changed result by worker count");

    std::cout << "forest worker benchmark: pairs=400000"
              << " one_median_us=" << one.steady.median_us
              << " two_median_us=" << two.steady.median_us
              << " four_median_us=" << four.steady.median_us
              << " one_p95_us=" << one.steady.p95_us
              << " two_p95_us=" << two.steady.p95_us
              << " four_p95_us=" << four.steady.p95_us
              << " version=" << four.sample_version << '\n';
    return 0;
}
