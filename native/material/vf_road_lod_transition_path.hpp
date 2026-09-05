#pragma once

#include "native/material/vf_road_lod_transition_residency.hpp"

#include <algorithm>
#include <cstddef>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct RoadLodTransitionPathReport {
    std::vector<std::size_t> resident_counts;
    std::size_t peak_resident;
    std::size_t settled_resident;
};

inline RoadLodTransitionPathReport AuditRoadLodTransitionPathReference(
    const RoadProjectedWorkingSet& previous,
    const RoadProjectedWorkingSet& current,
    const std::vector<double>& progress,
    std::size_t resident_budget
) {
    if (
        progress.empty() ||
        progress.front() != 0.0 ||
        progress.back() != 1.0
    ) {
        throw std::invalid_argument(
            "road LOD transition path must include both endpoints"
        );
    }
    for (std::size_t index = 1; index < progress.size(); ++index) {
        if (progress[index] < progress[index - 1]) {
            throw std::invalid_argument(
                "road LOD transition path must not backtrack"
            );
        }
    }

    RoadLodTransitionPathReport report{{}, 0, 0};
    report.resident_counts.reserve(progress.size());
    for (const double position : progress) {
        const auto resident = PlanRoadLodTransitionResidencyReference(
            previous,
            current,
            position,
            resident_budget
        );
        report.resident_counts.push_back(resident.size());
        report.peak_resident = std::max(
            report.peak_resident,
            resident.size()
        );
    }
    report.settled_resident = report.resident_counts.back();
    return report;
}

}  // namespace vf::material
