#pragma once

#include "native/material/vf_stone_coarse_shape.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>

namespace vf::material {

inline StoneCoarseShape RefineStoneFaceReference(
    const StoneCoarseShape& shape,
    std::size_t face_index,
    std::size_t vertex_budget,
    std::size_t face_budget
) {
    if (face_index >= shape.triangles.size()) {
        throw std::out_of_range("stone refinement face is unavailable");
    }
    if (
        shape.positions.size() + 1 > vertex_budget ||
        shape.triangles.size() + 2 > face_budget
    ) {
        throw std::range_error("stone face refinement exceeds shape budget");
    }
    const auto& triangle = shape.triangles[face_index];
    std::array<float, 3> average{};
    for (const std::uint32_t vertex : triangle) {
        if (vertex >= shape.positions.size()) {
            throw std::invalid_argument("stone triangle index is invalid");
        }
        for (std::size_t axis = 0; axis < 3; ++axis) {
            average[axis] += shape.positions[vertex][axis] / 3.0f;
        }
    }
    const float inverse_sqrt_three = 1.0f / std::sqrt(3.0f);
    std::array<float, 3> center{};
    for (std::size_t axis = 0; axis < 3; ++axis) {
        if (average[axis] == 0.0f) {
            throw std::invalid_argument(
                "stone coarse face does not span all axes"
            );
        }
        center[axis] = std::copysign(
            shape.radii[axis] * inverse_sqrt_three,
            average[axis]
        );
    }

    StoneCoarseShape refined = shape;
    const auto center_index = static_cast<std::uint32_t>(
        refined.positions.size()
    );
    refined.positions.push_back(center);
    const std::array<std::array<std::uint32_t, 3>, 3> children{
        std::array<std::uint32_t, 3>{
            triangle[0], triangle[1], center_index},
        std::array<std::uint32_t, 3>{
            triangle[1], triangle[2], center_index},
        std::array<std::uint32_t, 3>{
            triangle[2], triangle[0], center_index},
    };
    const auto target = refined.triangles.begin() +
        static_cast<std::ptrdiff_t>(face_index);
    refined.triangles.erase(target);
    refined.triangles.insert(
        refined.triangles.begin() +
            static_cast<std::ptrdiff_t>(face_index),
        children.begin(),
        children.end()
    );
    return refined;
}

}  // namespace vf::material
