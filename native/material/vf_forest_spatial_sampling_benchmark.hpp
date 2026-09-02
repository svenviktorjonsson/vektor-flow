#pragma once

#include "native/material/vf_forest_spatial_sampling.hpp"

#include <algorithm>
#include <bit>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct ForestSpatialSamplingTimingDistribution {
    std::vector<double> samples_us;
    double minimum_us;
    double median_us;
    double p95_us;
    double p99_us;
    double maximum_us;
};

struct ForestSpatialSamplingBenchmarkReport {
    double first_use_us;
    ForestSpatialSamplingTimingDistribution steady;
    std::uint64_t sample_version;
    std::size_t evaluated_pairs_per_run;
    std::size_t verified_runs;
};

inline double ForestSpatialSamplingNearestRankReference(
    const std::vector<double>& sorted,
    double quantile
) {
    const auto rank = static_cast<std::size_t>(
        std::ceil(quantile * static_cast<double>(sorted.size()))
    );
    return sorted[std::max<std::size_t>(1, rank) - 1];
}

inline ForestSpatialSamplingTimingDistribution
SummarizeForestSpatialSamplingTimingsReference(
    std::vector<double> samples_us
) {
    if (samples_us.empty()) {
        throw std::invalid_argument(
            "forest spatial timing sample set is empty"
        );
    }
    for (const double sample : samples_us) {
        if (!std::isfinite(sample) || sample < 0.0) {
            throw std::invalid_argument(
                "forest spatial timing sample is invalid"
            );
        }
    }
    auto sorted = samples_us;
    std::sort(sorted.begin(), sorted.end());
    return {
        std::move(samples_us),
        sorted.front(),
        ForestSpatialSamplingNearestRankReference(sorted, 0.50),
        ForestSpatialSamplingNearestRankReference(sorted, 0.95),
        ForestSpatialSamplingNearestRankReference(sorted, 0.99),
        sorted.back(),
    };
}

inline std::uint64_t ForestSpatialSamplingVersionReference(
    const ForestSpatialSamplingReport& report
) {
    std::uint64_t version = report.population_version;
    const auto add = [&version](std::uint64_t value) {
        version = MixHierarchicalKey64(version ^ value);
    };
    add(report.tree_count);
    add(report.evaluated_pairs);
    add(report.near_pair_count);
    add(report.far_pair_count);
    add(std::bit_cast<std::uint64_t>(
        report.near_environment_similarity
    ));
    add(std::bit_cast<std::uint64_t>(
        report.far_environment_similarity
    ));
    add(std::bit_cast<std::uint64_t>(
        report.near_same_species_fraction
    ));
    add(std::bit_cast<std::uint64_t>(
        report.far_same_species_fraction
    ));
    return version;
}

inline ForestSpatialSamplingBenchmarkReport
BenchmarkForestSpatialSamplingReference(
    const ForestPopulationRealization& population,
    double near_distance,
    double far_distance,
    std::size_t pair_budget,
    std::size_t warmup_runs,
    std::size_t sample_runs
) {
    if (sample_runs == 0 || sample_runs > 1000 ||
        warmup_runs > 100) {
        throw std::range_error(
            "forest spatial benchmark run count is invalid"
        );
    }
    using Clock = std::chrono::steady_clock;
    auto run_once = [&]() {
        const auto start = Clock::now();
        auto report = SampleForestSpatialQualityReference(
            population,
            near_distance,
            far_distance,
            pair_budget
        );
        const auto finish = Clock::now();
        const double microseconds =
            std::chrono::duration<double, std::micro>(
                finish - start
            ).count();
        return std::pair{microseconds, std::move(report)};
    };
    auto first = run_once();
    const auto reference = first.second;
    const std::uint64_t sample_version =
        ForestSpatialSamplingVersionReference(reference);
    std::size_t verified_runs = 1;
    for (std::size_t run = 0; run < warmup_runs; ++run) {
        auto warmup = run_once();
        if (!(warmup.second == reference)) {
            throw std::logic_error(
                "forest spatial benchmark warmup changed result"
            );
        }
        ++verified_runs;
    }
    std::vector<double> samples_us;
    samples_us.reserve(sample_runs);
    for (std::size_t run = 0; run < sample_runs; ++run) {
        auto sample = run_once();
        if (!(sample.second == reference)) {
            throw std::logic_error(
                "forest spatial benchmark sample changed result"
            );
        }
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
        verified_runs,
    };
}

}  // namespace vf::material
