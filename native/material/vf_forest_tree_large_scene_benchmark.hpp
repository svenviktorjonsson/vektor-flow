#pragma once

#include "native/material/vf_forest_tree_large_scene_path.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct ForestTreeTimingDistribution {
    std::vector<double> samples_us;
    double minimum_us;
    double median_us;
    double p95_us;
    double p99_us;
    double maximum_us;
};

struct ForestTreeLargeSceneBenchmarkReport {
    double first_use_us;
    ForestTreeTimingDistribution steady;
    std::uint64_t path_version;
    std::size_t verified_runs;
};

inline double ForestTreeNearestRankReference(
    const std::vector<double>& sorted,
    double quantile
) {
    const auto rank = static_cast<std::size_t>(
        std::ceil(quantile * static_cast<double>(sorted.size()))
    );
    return sorted[std::max<std::size_t>(1, rank) - 1];
}

inline ForestTreeTimingDistribution
SummarizeForestTreeTimingsReference(
    std::vector<double> samples_us
) {
    if (samples_us.empty()) {
        throw std::invalid_argument(
            "forest timing sample set is empty"
        );
    }
    for (const double sample : samples_us) {
        if (!std::isfinite(sample) || sample < 0.0) {
            throw std::invalid_argument(
                "forest timing sample is invalid"
            );
        }
    }
    auto sorted = samples_us;
    std::sort(sorted.begin(), sorted.end());
    return {
        std::move(samples_us),
        sorted.front(),
        ForestTreeNearestRankReference(sorted, 0.50),
        ForestTreeNearestRankReference(sorted, 0.95),
        ForestTreeNearestRankReference(sorted, 0.99),
        sorted.back(),
    };
}

inline ForestTreeLargeSceneBenchmarkReport
BenchmarkForestTreeLargeScenePathReference(
    const ForestTreeCameraResidencyDefinition& definition,
    const ForestPopulationRealization& forest,
    const std::vector<std::vector<std::uint64_t>>& camera_path,
    std::size_t warmup_runs,
    std::size_t sample_runs
) {
    if (sample_runs == 0 || sample_runs > 1000 ||
        warmup_runs > 100) {
        throw std::range_error(
            "forest benchmark run count is invalid"
        );
    }
    using Clock = std::chrono::steady_clock;
    auto run_once = [&]() {
        const auto start = Clock::now();
        auto report = AuditForestTreeLargeScenePathReference(
            definition,
            forest,
            camera_path
        );
        const auto finish = Clock::now();
        const double microseconds =
            std::chrono::duration<double, std::micro>(
                finish - start
            ).count();
        return std::pair{microseconds, std::move(report)};
    };
    auto first = run_once();
    const std::uint64_t path_version = first.second.path_version;
    std::size_t verified_runs = 1;
    for (std::size_t run = 0; run < warmup_runs; ++run) {
        auto warmup = run_once();
        if (warmup.second.path_version != path_version) {
            throw std::logic_error(
                "forest benchmark warmup changed path version"
            );
        }
        ++verified_runs;
    }
    std::vector<double> samples_us;
    samples_us.reserve(sample_runs);
    for (std::size_t run = 0; run < sample_runs; ++run) {
        auto sample = run_once();
        if (sample.second.path_version != path_version) {
            throw std::logic_error(
                "forest benchmark sample changed path version"
            );
        }
        samples_us.push_back(sample.first);
        ++verified_runs;
    }
    return {
        first.first,
        SummarizeForestTreeTimingsReference(
            std::move(samples_us)
        ),
        path_version,
        verified_runs,
    };
}

}  // namespace vf::material
