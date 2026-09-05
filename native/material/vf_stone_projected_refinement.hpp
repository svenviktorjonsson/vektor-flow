#pragma once

#include "native/material/vf_stone_projected_demand.hpp"

#include <algorithm>
#include <cstddef>
#include <memory>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct StoneProjectedRefinementState {
    StoneProjectedDemand selection;
    StoneCoarseShape source;
    std::shared_ptr<const StoneCoarseShape> geometry;
    bool retained;
    std::size_t detail_vertices;
    std::size_t detail_faces;
};

inline std::vector<StoneTriangle> CanonicalStoneFaces(
    const StoneCoarseShape& shape
) {
    std::vector<StoneTriangle> faces;
    faces.reserve(shape.triangles.size());
    for (const auto& face : shape.triangles) {
        faces.push_back(CanonicalStoneFace(face));
    }
    std::sort(faces.begin(), faces.end());
    return faces;
}

inline bool SameStoneSource(
    const StoneCoarseShape& first,
    const StoneCoarseShape& second
) {
    return first.radii == second.radii &&
        first.positions == second.positions &&
        CanonicalStoneFaces(first) == CanonicalStoneFaces(second);
}

inline StoneProjectedRefinementState
UpdateStoneProjectedRefinementReference(
    const StoneCoarseShape& coarse,
    const StoneProjectedRefinementState* previous,
    const StoneViewCamera& camera,
    double max_error_pixels,
    std::size_t demand_budget,
    std::size_t vertex_budget,
    std::size_t face_budget
) {
    auto selection = SelectStoneProjectedDemandReference(
        coarse,
        camera,
        max_error_pixels,
        demand_budget
    );
    const bool same_demand = previous != nullptr &&
        previous->geometry != nullptr &&
        SameStoneSource(previous->source, coarse) &&
        previous->selection.demands == selection.demands;
    if (same_demand) {
        if (
            previous->geometry->positions.size() > vertex_budget ||
            previous->geometry->triangles.size() > face_budget
        ) {
            throw std::range_error(
                "resident stone refinement exceeds shape budget"
            );
        }
        return {
            std::move(selection),
            coarse,
            previous->geometry,
            true,
            previous->geometry->positions.size() -
                coarse.positions.size(),
            previous->geometry->triangles.size() -
                coarse.triangles.size(),
        };
    }
    auto geometry = std::make_shared<const StoneCoarseShape>(
        RefineStoneFacesReference(
            coarse,
            selection.demands,
            vertex_budget,
            face_budget
        )
    );
    return {
        std::move(selection),
        coarse,
        geometry,
        false,
        geometry->positions.size() - coarse.positions.size(),
        geometry->triangles.size() - coarse.triangles.size(),
    };
}

}  // namespace vf::material
