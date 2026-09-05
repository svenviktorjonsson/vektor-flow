#pragma once

#include "native/material/vf_stone_face_refinement.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vf::material {

inline std::array<std::uint32_t, 3> CanonicalStoneFace(
    std::array<std::uint32_t, 3> face
) {
    std::sort(face.begin(), face.end());
    return face;
}

inline StoneCoarseShape RefineStoneFacesReference(
    const StoneCoarseShape& shape,
    const std::vector<std::array<std::uint32_t, 3>>& demands,
    std::size_t vertex_budget,
    std::size_t face_budget
) {
    if (
        vertex_budget < shape.positions.size() ||
        face_budget < shape.triangles.size() ||
        demands.size() > vertex_budget - shape.positions.size() ||
        demands.size() >
            (face_budget - shape.triangles.size()) / 2
    ) {
        throw std::range_error("stone refinement batch exceeds shape budget");
    }
    std::vector<std::array<std::uint32_t, 3>> canonical;
    canonical.reserve(demands.size());
    for (const auto& demand : demands) {
        canonical.push_back(CanonicalStoneFace(demand));
    }
    std::sort(canonical.begin(), canonical.end());
    if (std::adjacent_find(canonical.begin(), canonical.end()) !=
        canonical.end()) {
        throw std::invalid_argument("stone refinement demand is duplicated");
    }

    StoneCoarseShape refined = shape;
    for (const auto& demand : canonical) {
        const auto found = std::find_if(
            refined.triangles.begin(),
            refined.triangles.end(),
            [&demand](const auto& face) {
                return CanonicalStoneFace(face) == demand;
            }
        );
        if (found == refined.triangles.end()) {
            throw std::out_of_range(
                "stone refinement demand is unavailable"
            );
        }
        const auto face_index = static_cast<std::size_t>(
            found - refined.triangles.begin()
        );
        refined = RefineStoneFaceReference(
            refined,
            face_index,
            vertex_budget,
            face_budget
        );
    }
    return refined;
}

}  // namespace vf::material
