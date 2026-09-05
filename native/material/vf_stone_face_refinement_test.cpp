#include "native/material/vf_stone_face_refinement.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <map>
#include <stdexcept>
#include <utility>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

using Point = std::array<float, 3>;

Point subtract(const Point& first, const Point& second) {
    return {
        first[0] - second[0],
        first[1] - second[1],
        first[2] - second[2],
    };
}

Point cross(const Point& first, const Point& second) {
    return {
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
    };
}

float dot(const Point& first, const Point& second) {
    return first[0] * second[0] +
        first[1] * second[1] +
        first[2] * second[2];
}

}  // namespace

int main() {
    const auto coarse = vf::material::CreateStoneCoarseShapeReference(
        {3.0f, 2.0f, 1.5f},
        6,
        8
    );
    const auto refined = vf::material::RefineStoneFaceReference(
        coarse,
        0,
        7,
        10
    );

    require(refined.positions.size() == 7,
            "stone face refinement vertex count changed");
    require(refined.triangles.size() == 10,
            "stone face refinement triangle count changed");
    const float inverse_sqrt_three = 1.0f / std::sqrt(3.0f);
    const Point expected_center{
        3.0f * inverse_sqrt_three,
        2.0f * inverse_sqrt_three,
        1.5f * inverse_sqrt_three,
    };
    require(refined.positions.back() == expected_center,
            "stone refinement center left ellipsoid");
    require(
        refined.triangles[0] ==
            std::array<std::uint32_t, 3>{0, 2, 6} &&
        refined.triangles[1] ==
            std::array<std::uint32_t, 3>{2, 4, 6} &&
        refined.triangles[2] ==
            std::array<std::uint32_t, 3>{4, 0, 6},
        "stone refinement children changed"
    );

    std::map<std::pair<std::uint32_t, std::uint32_t>, int> edge_counts;
    std::map<std::pair<std::uint32_t, std::uint32_t>, int> edge_directions;
    for (const auto& triangle : refined.triangles) {
        const Point& first = refined.positions[triangle[0]];
        const Point& second = refined.positions[triangle[1]];
        const Point& third = refined.positions[triangle[2]];
        const Point normal = cross(
            subtract(second, first),
            subtract(third, first)
        );
        const Point centroid{
            (first[0] + second[0] + third[0]) / 3.0f,
            (first[1] + second[1] + third[1]) / 3.0f,
            (first[2] + second[2] + third[2]) / 3.0f,
        };
        require(dot(normal, centroid) > 0.0f,
                "refined stone face is not outward oriented");
        for (std::size_t edge = 0; edge < 3; ++edge) {
            const std::uint32_t from = triangle[edge];
            const std::uint32_t to = triangle[(edge + 1) % 3];
            const auto key = std::minmax(from, to);
            ++edge_counts[key];
            edge_directions[key] += from < to ? 1 : -1;
        }
    }
    require(edge_counts.size() == 15, "refined stone edge count changed");
    for (const auto& [edge, count] : edge_counts) {
        require(count == 2, "refined stone opened a boundary");
        require(edge_directions.at(edge) == 0,
                "refined stone edge winding changed");
    }
    require(
        refined.positions.size() - edge_counts.size() +
            refined.triangles.size() == 2,
        "refined stone Euler characteristic changed"
    );

    try {
        static_cast<void>(vf::material::RefineStoneFaceReference(
            coarse,
            0,
            6,
            10
        ));
        throw std::runtime_error("undersized refinement budget accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private native stone face refinement passed\n";
    return 0;
}
