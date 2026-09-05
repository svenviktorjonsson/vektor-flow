#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct StoneCoarseShape {
    std::array<float, 3> radii;
    std::vector<std::array<float, 3>> positions;
    std::vector<std::array<std::uint32_t, 3>> triangles;
};

inline StoneCoarseShape CreateStoneCoarseShapeReference(
    const std::array<float, 3>& radii,
    std::size_t vertex_budget,
    std::size_t face_budget
) {
    for (const float radius : radii) {
        if (!std::isfinite(radius) || radius <= 0.0f) {
            throw std::invalid_argument(
                "stone radius must be finite and positive"
            );
        }
    }
    constexpr std::size_t vertex_count = 6;
    constexpr std::size_t face_count = 8;
    if (vertex_budget < vertex_count || face_budget < face_count) {
        throw std::range_error("coarse stone exceeds shape budget");
    }
    return {
        radii,
        {
            {radii[0], 0.0f, 0.0f},
            {-radii[0], 0.0f, 0.0f},
            {0.0f, radii[1], 0.0f},
            {0.0f, -radii[1], 0.0f},
            {0.0f, 0.0f, radii[2]},
            {0.0f, 0.0f, -radii[2]},
        },
        {
            {0, 2, 4},
            {1, 4, 2},
            {1, 3, 4},
            {0, 4, 3},
            {0, 5, 2},
            {1, 2, 5},
            {1, 5, 3},
            {0, 3, 5},
        },
    };
}

}  // namespace vf::material
