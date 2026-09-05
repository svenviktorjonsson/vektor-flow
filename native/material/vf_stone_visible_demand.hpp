#pragma once

#include "native/material/vf_stone_refinement_batch.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vf::material {

inline std::vector<std::array<std::uint32_t, 3>>
SelectStoneVisibleFacesReference(
    const StoneCoarseShape& shape,
    const std::array<float, 3>& eye,
    std::size_t face_budget
) {
    for (const float coordinate : eye) {
        if (!std::isfinite(coordinate)) {
            throw std::invalid_argument("stone camera eye must be finite");
        }
    }
    std::vector<std::array<std::uint32_t, 3>> visible;
    for (const auto& triangle : shape.triangles) {
        for (const std::uint32_t vertex : triangle) {
            if (vertex >= shape.positions.size()) {
                throw std::invalid_argument("stone triangle index is invalid");
            }
        }
        const auto& first = shape.positions[triangle[0]];
        const auto& second = shape.positions[triangle[1]];
        const auto& third = shape.positions[triangle[2]];
        const std::array<float, 3> first_edge{
            second[0] - first[0],
            second[1] - first[1],
            second[2] - first[2],
        };
        const std::array<float, 3> second_edge{
            third[0] - first[0],
            third[1] - first[1],
            third[2] - first[2],
        };
        const std::array<float, 3> normal{
            first_edge[1] * second_edge[2] -
                first_edge[2] * second_edge[1],
            first_edge[2] * second_edge[0] -
                first_edge[0] * second_edge[2],
            first_edge[0] * second_edge[1] -
                first_edge[1] * second_edge[0],
        };
        float facing = 0.0f;
        for (std::size_t axis = 0; axis < 3; ++axis) {
            const float centroid =
                (first[axis] + second[axis] + third[axis]) / 3.0f;
            facing += normal[axis] * (eye[axis] - centroid);
        }
        if (facing >= 0.0f) {
            visible.push_back(triangle);
        }
    }
    std::sort(
        visible.begin(),
        visible.end(),
        [](const auto& first, const auto& second) {
            return CanonicalStoneFace(first) < CanonicalStoneFace(second);
        }
    );
    if (visible.size() > face_budget) {
        visible.resize(face_budget);
    }
    return visible;
}

}  // namespace vf::material
