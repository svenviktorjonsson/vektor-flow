#include "native/material/vf_stone_coarse_shape.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <map>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

using Point = std::array<float, 3>;
using Triangle = std::array<std::uint32_t, 3>;

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
    const auto stone = vf::material::CreateStoneCoarseShapeReference(
        {3.0f, 2.0f, 1.5f},
        6,
        8
    );
    const std::vector<Point> expected_positions{
        {3.0f, 0.0f, 0.0f},
        {-3.0f, 0.0f, 0.0f},
        {0.0f, 2.0f, 0.0f},
        {0.0f, -2.0f, 0.0f},
        {0.0f, 0.0f, 1.5f},
        {0.0f, 0.0f, -1.5f},
    };
    const std::vector<Triangle> expected_triangles{
        {0, 2, 4},
        {1, 4, 2},
        {1, 3, 4},
        {0, 4, 3},
        {0, 5, 2},
        {1, 2, 5},
        {1, 5, 3},
        {0, 3, 5},
    };
    require(stone.positions == expected_positions,
            "native coarse stone positions changed");
    require(stone.triangles == expected_triangles,
            "native coarse stone winding changed");

    std::map<std::pair<std::uint32_t, std::uint32_t>, int> edge_counts;
    std::map<std::pair<std::uint32_t, std::uint32_t>, int> edge_directions;
    for (const auto& triangle : stone.triangles) {
        const Point& first = stone.positions[triangle[0]];
        const Point& second = stone.positions[triangle[1]];
        const Point& third = stone.positions[triangle[2]];
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
                "coarse stone face is not outward oriented");
        for (std::size_t edge = 0; edge < 3; ++edge) {
            const std::uint32_t from = triangle[edge];
            const std::uint32_t to = triangle[(edge + 1) % 3];
            const auto key = std::minmax(from, to);
            ++edge_counts[key];
            edge_directions[key] += from < to ? 1 : -1;
        }
    }
    require(edge_counts.size() == 12, "coarse stone edge count changed");
    for (const auto& [edge, count] : edge_counts) {
        require(count == 2, "coarse stone is not closed");
        require(edge_directions.at(edge) == 0,
                "coarse stone edge winding is inconsistent");
    }
    for (const auto& point : stone.positions) {
        for (const float value : point) {
            require(std::isfinite(value), "coarse stone is not finite");
        }
    }

    try {
        static_cast<void>(vf::material::CreateStoneCoarseShapeReference(
            {3.0f, 2.0f, 1.5f},
            5,
            8
        ));
        throw std::runtime_error("undersized stone budget accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private native coarse stone shape passed\n";
    return 0;
}
