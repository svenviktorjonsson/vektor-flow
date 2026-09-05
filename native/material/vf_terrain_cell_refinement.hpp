#pragma once

#include "native/material/vf_terrain_cell_demand.hpp"

namespace vf::material {

struct TerrainCellRefinementPlan {
    TerrainTileRequest parent_request;
    std::vector<std::uint64_t> parents;
    TerrainCellSamplePlan children;
};

inline TerrainCellRefinementPlan RefineTerrainCellDemandReference(
    const TerrainTileRequest& request, std::span<const std::uint64_t> parents,
    std::size_t cell_budget, std::size_t triangle_budget
) {
    ValidateTerrainTileRequestReference(request.condition, request.tile, request.refinement, request.sample_budget);
    if (request.refinement == 16)
        throw std::range_error("terrain cell refinement requires level from 0 to 15");
    SelectTerrainCellDemandCountReference(parents, cell_budget, triangle_budget);
    const auto divisions = std::uint64_t{1} << request.refinement;
    std::unordered_set<std::uint64_t> seen;
    if (!parents.empty()) seen.reserve(parents.size());
    for (const auto parent : parents) {
        TerrainCellCornerIdsKernel(divisions, parent);
        if (!seen.insert(parent).second) throw std::invalid_argument("terrain cell demand is duplicated");
    }
    if (parents.size() > cell_budget / 4)
        throw std::range_error("terrain cell refinement exceeds cell budget");
    if (parents.size() > triangle_budget / 8)
        throw std::range_error("terrain cell refinement exceeds triangle budget");
    std::vector<std::uint64_t> children;
    children.reserve(parents.size() * 4);
    for (const auto parent : parents) {
        const auto child_divisions = divisions * 2;
        const auto first = (parent / divisions) * 2 * child_divisions + (parent % divisions) * 2;
        children.insert(children.end(), {first, first + 1, first + child_divisions, first + child_divisions + 1});
    }
    auto child_request = request;
    ++child_request.refinement;
    auto child_plan = PlanTerrainCellSamplesReference(child_request, children, cell_budget, triangle_budget);
    return {request, std::vector<std::uint64_t>(parents.begin(), parents.end()), std::move(child_plan)};
}

} // namespace vf::material
