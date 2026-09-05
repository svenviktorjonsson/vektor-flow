#pragma once

#include "native/material/vf_terrain_residency.hpp"
#include "native/material/vf_terrain_triangulation.hpp"

namespace vf::material {

struct TerrainCellSamplePlan {
    TerrainTileRequest request;
    std::vector<std::uint64_t> cells;
    std::vector<std::uint64_t> sample_ids;
    bool truncated;
};

inline TerrainCellSamplePlan PlanTerrainCellSamplesReference(
    const TerrainTileRequest& request, std::span<const std::uint64_t> demands,
    std::size_t cell_budget, std::size_t triangle_budget
) {
    ValidateTerrainTileRequestReference(request.condition, request.tile, request.refinement, request.sample_budget);
    const auto count = SelectTerrainCellDemandCountReference(demands, cell_budget, triangle_budget);
    const auto divisions = std::uint64_t{1} << request.refinement;
    std::unordered_set<std::uint64_t> cells, samples;
    if (count) {
        cells.reserve(count);
        samples.reserve(std::min(count * 4, request.sample_budget));
    }
    for (std::size_t index = 0; index < count; ++index) {
        const auto corners = TerrainCellCornerIdsKernel(divisions, demands[index]);
        if (!cells.insert(demands[index]).second) throw std::invalid_argument("terrain cell demand is duplicated");
        for (const auto id : corners) {
            if (samples.contains(id)) continue;
            if (samples.size() == request.sample_budget)
                throw std::range_error("terrain cell demand exceeds sample budget");
            samples.insert(id);
        }
    }
    TerrainCellSamplePlan result{request, {}, {}, count < demands.size()};
    result.cells.reserve(count);
    result.sample_ids.reserve(samples.size());
    for (std::size_t index = 0; index < count; ++index) {
        result.cells.push_back(demands[index]);
        for (const auto id : TerrainCellCornerIdsKernel(divisions, demands[index]))
            if (samples.erase(id)) result.sample_ids.push_back(id);
    }
    return result;
}

} // namespace vf::material
