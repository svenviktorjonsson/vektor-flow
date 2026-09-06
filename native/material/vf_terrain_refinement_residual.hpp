#pragma once

#include "native/material/vf_terrain_cell_refinement.hpp"

namespace vf::material {

struct TerrainCellResidual {
    std::uint64_t parent;
    // AB, AC, BD, CD edge midpoints, then the existing BC diagonal midpoint.
    std::array<double, 5> absolute_errors;
    double maximum_error;
};

struct TerrainRefinementResiduals {
    std::shared_ptr<const TerrainSurfacePacket> coarse;
    std::shared_ptr<const TerrainSurfacePacket> fine;
    std::vector<TerrainCellResidual> cells;
};

// Sampled vertical differences only: no continuous bound or LOD decision.
inline TerrainRefinementResiduals MeasureTerrainRefinementResidualsReference(
    std::shared_ptr<const TerrainSurfacePacket> coarse,
    std::shared_ptr<const TerrainSurfacePacket> fine,
    std::span<const std::uint64_t> parents, std::size_t parent_budget
) {
    const auto coarse_divisions = RequireTerrainSurfaceForTopology(coarse);
    RequireTerrainSurfaceForTopology(fine);
    const TerrainTileRequest fine_identity{coarse->source->condition, coarse->source->tile,
        coarse->source->refinement + 1, 65536};
    if (coarse->source->refinement == 16 ||
        !SameTerrainResidencyField(*fine->source, fine_identity, fine->source->positions.size()))
        throw std::invalid_argument("terrain residual sources must be consecutive refinements of the same field");
    if (parent_budget > 65536) throw std::range_error("terrain residual parent budget must be from 0 to 65536");
    SelectTerrainCellDemandCountReference(parents, 65536, 131072);
    if (parents.size() > parent_budget) throw std::range_error("terrain residual demand exceeds parent budget");
    const TerrainTileRequest request{coarse->source->condition, coarse->source->tile, coarse->source->refinement, 65536};
    const auto refinement = RefineTerrainCellDemandReference(request, parents, 65536, 131072);
    const auto coarse_mesh = TriangulateTerrainAddressedCellsReference(coarse, parents, 65536, 131072);
    const auto fine_mesh = TriangulateTerrainAddressedCellsReference(fine, refinement.children.cells, 65536, 131072);
    const auto corners = [](const TerrainTriangulation& mesh, std::size_t cell) {
        const auto& first = mesh.triangles[cell * 2];
        return std::array<std::uint32_t, 4>{first[0], first[2], first[1], mesh.triangles[cell * 2 + 1][2]};
    };
    const auto validate_grid = [&](const TerrainTriangulation& mesh, std::span<const std::uint64_t> demands,
        std::uint64_t divisions) {
        for (std::size_t cell = 0; cell < demands.size(); ++cell) {
            const auto ids = TerrainCellCornerIdsKernel(divisions, demands[cell]);
            const auto indices = corners(mesh, cell);
            for (std::size_t corner = 0; corner < 4; ++corner) {
                const auto expected = TerrainSampleCoordinatesKernel(mesh.source->source->tile, divisions, ids[corner]);
                const auto& point = mesh.source->vertices[indices[corner]];
                if (std::bit_cast<std::uint64_t>(point[0]) != std::bit_cast<std::uint64_t>(expected[0]) ||
                    std::bit_cast<std::uint64_t>(point[2]) != std::bit_cast<std::uint64_t>(expected[1]))
                    throw std::invalid_argument("terrain residual position does not match grid identity");
            }
        }
    };
    validate_grid(coarse_mesh, parents, coarse_divisions);
    validate_grid(fine_mesh, refinement.children.cells, coarse_divisions * 2);
    for (std::size_t parent = 0; parent < parents.size(); ++parent) {
        const auto old = corners(coarse_mesh, parent);
        const std::array<std::uint32_t, 4> anchors{corners(fine_mesh, parent * 4)[0],
            corners(fine_mesh, parent * 4 + 1)[1], corners(fine_mesh, parent * 4 + 2)[2],
            corners(fine_mesh, parent * 4 + 3)[3]};
        for (std::size_t corner = 0; corner < 4; ++corner)
            if (std::bit_cast<std::uint64_t>(coarse->vertices[old[corner]][1]) !=
                std::bit_cast<std::uint64_t>(fine->vertices[anchors[corner]][1]))
                throw std::invalid_argument("terrain residual coarse anchors do not match fine source");
    }
    TerrainRefinementResiduals result{std::move(coarse), std::move(fine), {}};
    result.cells.reserve(parents.size());
    for (std::size_t parent = 0; parent < parents.size(); ++parent) {
        const auto old = corners(coarse_mesh, parent);
        const auto first = corners(fine_mesh, parent * 4);
        const std::array<std::uint32_t, 5> points{first[1], first[2], corners(fine_mesh, parent * 4 + 1)[3],
            corners(fine_mesh, parent * 4 + 2)[3], first[3]};
        constexpr std::array<std::array<std::size_t, 2>, 5> endpoints{{{0, 1}, {0, 2}, {1, 3}, {2, 3}, {1, 2}}};
        TerrainCellResidual cell{parents[parent], {}, 0};
        for (std::size_t point = 0; point < points.size(); ++point) {
            const auto edge = endpoints[point];
            const double midpoint = 0.5 * result.coarse->vertices[old[edge[0]]][1] +
                0.5 * result.coarse->vertices[old[edge[1]]][1];
            const double error = std::abs(result.fine->vertices[points[point]][1] - midpoint);
            if (!std::isfinite(error)) throw std::range_error("terrain sampled refinement residual must be finite");
            cell.absolute_errors[point] = error;
            cell.maximum_error = std::max(cell.maximum_error, error);
        }
        result.cells.push_back(cell);
    }
    return result;
}

} // namespace vf::material
