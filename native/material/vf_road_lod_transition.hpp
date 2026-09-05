#pragma once

#include "native/material/vf_road_projected_working_set.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct RoadLodCoverage {
    RoadProjectedPacketKey key;
    double coverage;
};

inline std::map<std::uint64_t, RoadProjectedPacketKey> RoadLodKeysByCell(
    const std::vector<RoadProjectedPacketKey>& keys
) {
    std::map<std::uint64_t, RoadProjectedPacketKey> by_cell;
    for (const auto& key : keys) {
        if (!by_cell.emplace(key.cell_id, key).second) {
            throw std::invalid_argument("road LOD cell is duplicated");
        }
    }
    return by_cell;
}

inline std::vector<RoadLodCoverage>
PlanRoadLodCoverageTransitionReference(
    const std::vector<RoadProjectedPacketKey>& previous,
    const std::vector<RoadProjectedPacketKey>& current,
    double progress,
    std::size_t entry_budget
) {
    if (!std::isfinite(progress) || progress < 0.0 || progress > 1.0) {
        throw std::invalid_argument("road LOD transition progress is invalid");
    }
    const auto previous_by_cell = RoadLodKeysByCell(previous);
    const auto current_by_cell = RoadLodKeysByCell(current);
    std::vector<RoadLodCoverage> entries;
    for (const auto& [cell_id, previous_key] : previous_by_cell) {
        const auto found = current_by_cell.find(cell_id);
        if (found != current_by_cell.end() && found->second == previous_key) {
            entries.push_back({previous_key, 1.0});
            continue;
        }
        if (progress < 1.0) {
            entries.push_back({previous_key, 1.0 - progress});
        }
    }
    for (const auto& [cell_id, current_key] : current_by_cell) {
        const auto found = previous_by_cell.find(cell_id);
        if (found != previous_by_cell.end() && found->second == current_key) {
            continue;
        }
        if (progress > 0.0) {
            entries.push_back({current_key, progress});
        }
    }
    std::sort(
        entries.begin(),
        entries.end(),
        [](const RoadLodCoverage& first, const RoadLodCoverage& second) {
            return first.key < second.key;
        }
    );
    if (entries.size() > entry_budget) {
        throw std::range_error("road LOD transition exceeds entry budget");
    }
    return entries;
}

}  // namespace vf::material
