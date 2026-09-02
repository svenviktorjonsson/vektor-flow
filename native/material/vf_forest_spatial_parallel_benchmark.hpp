#pragma once

#include "native/material/vf_forest_spatial_sampling_benchmark.hpp"
#include "native/material/vf_forest_spatial_sampling_parallel.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct ForestSpatialParallelBenchmarkReport {
    double first_use_us;
    ForestSpatialSamplingTimingDistribution steady;
    std::uint64_t sample_version;
    std::size_t evaluated_pairs_per_run;
    std::size_t block_count;
    std::size_t worker_count;
    std::size_t verified_runs;
};

inline ForestSpatialParallelBenchmarkReport
BenchmarkForestSpatialWorkersReference(
    const ForestPopulationRealization& population,
    double near_distance,
    double far_distance,
    std::size_t pair_budget,
    std::size_t block_size,
    std::size_t worker_count,
    std::size_t warmup_runs,
    std::size_t sample_runs
) {
    if (sample_runs == 0 || sample_runs > 1000 ||
        warmup_runs > 100) {
        throw std::range_error(
            "forest worker benchmark run count is invalid"
        );
    }
    using Clock = std::chrono::steady_clock;
    auto run_once = [&]() {
        const auto start = Clock::now();
        auto report = SampleForestSpatialQualityParallelReference(
            population,
            near_distance,
            far_distance,
            pair_budget,
            block_size,
            worker_count
        );
        const auto finish = Clock::now();
        const double microseconds =
            std::chrono::duration<double, std::micro>(
                finish - start
            ).count();
        return std::pair{microseconds, std::move(report)};
    };
    auto first = run_once();
    const auto reference = first.second.sample;
    const std::uint64_t sample_version =
        ForestSpatialSamplingVersionReference(reference);
    std::size_t verified_runs = 1;
    const auto verify = [&](const auto& report) {
        if (!(report.sample == reference) ||
            report.block_count != first.second.block_count ||
            report.worker_count != first.second.worker_count) {
            throw std::logic_error(
                "forest worker benchmark changed result"
            );
        }
    };
    for (std::size_t run = 0; run < warmup_runs; ++run) {
        auto warmup = run_once();
        verify(warmup.second);
        ++verified_runs;
    }
    std::vector<double> samples_us;
    samples_us.reserve(sample_runs);
    for (std::size_t run = 0; run < sample_runs; ++run) {
        auto sample = run_once();
        verify(sample.second);
        samples_us.push_back(sample.first);
        ++verified_runs;
    }
    return {
        first.first,
        SummarizeForestSpatialSamplingTimingsReference(
            std::move(samples_us)
        ),
        sample_version,
        reference.evaluated_pairs,
        first.second.block_count,
        first.second.worker_count,
        verified_runs,
    };
}

}  // namespace vf::material
