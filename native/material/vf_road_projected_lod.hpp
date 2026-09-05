#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct RoadProjectedCandidate {
    std::uint64_t cell_id;
    double camera_depth;
    double geometry_error;
    double material_error;
    bool visible;
};

struct RoadProjectedLodPolicy {
    double focal_pixels;
    double max_error_pixels;
    std::size_t cell_budget;
    std::uint32_t max_detail_level;
};

struct RoadProjectedDemand {
    std::uint64_t cell_id;
    std::uint32_t detail_level;
    double coarse_error_pixels;
    double residual_error_pixels;
};

inline std::vector<RoadProjectedDemand> SelectRoadProjectedLodReference(
    const std::vector<RoadProjectedCandidate>& candidates,
    const RoadProjectedLodPolicy& policy
) {
    if (!std::isfinite(policy.focal_pixels) || policy.focal_pixels <= 0.0) {
        throw std::invalid_argument("road LOD focal pixels must be positive");
    }
    if (
        !std::isfinite(policy.max_error_pixels) ||
        policy.max_error_pixels <= 0.0
    ) {
        throw std::invalid_argument("road LOD maximum error must be positive");
    }

    std::vector<RoadProjectedDemand> demands;
    demands.reserve(std::min(candidates.size(), policy.cell_budget));
    for (const auto& candidate : candidates) {
        if (
            !std::isfinite(candidate.camera_depth) ||
            candidate.camera_depth <= 0.0 ||
            !std::isfinite(candidate.geometry_error) ||
            candidate.geometry_error < 0.0 ||
            !std::isfinite(candidate.material_error) ||
            candidate.material_error < 0.0
        ) {
            throw std::invalid_argument("road LOD candidate is invalid");
        }
        if (!candidate.visible) continue;
        const double scale = policy.focal_pixels / candidate.camera_depth;
        const double coarse_error = scale * std::max(
            candidate.geometry_error,
            candidate.material_error
        );
        if (coarse_error <= policy.max_error_pixels) continue;
        std::uint32_t detail_level = 0;
        double residual_error = coarse_error;
        while (
            residual_error > policy.max_error_pixels &&
            detail_level < policy.max_detail_level
        ) {
            residual_error *= 0.5;
            detail_level += 1;
        }
        demands.push_back({
            candidate.cell_id,
            detail_level,
            coarse_error,
            residual_error,
        });
    }
    std::sort(
        demands.begin(),
        demands.end(),
        [](const auto& first, const auto& second) {
            if (first.coarse_error_pixels != second.coarse_error_pixels) {
                return first.coarse_error_pixels > second.coarse_error_pixels;
            }
            return first.cell_id < second.cell_id;
        }
    );
    if (demands.size() > policy.cell_budget) {
        demands.resize(policy.cell_budget);
    }
    return demands;
}

}  // namespace vf::material
