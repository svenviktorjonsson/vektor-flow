#include "native/material/vf_stone_refinement_batch.hpp"

#include <algorithm>
#include <array>
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

using Triangle = std::array<std::uint32_t, 3>;

}  // namespace

int main() {
    const auto coarse = vf::material::CreateStoneCoarseShapeReference(
        {3.0f, 2.0f, 1.5f},
        6,
        8
    );
    std::vector<Triangle> demands{
        coarse.triangles[0],
        coarse.triangles[6],
    };
    const auto forward = vf::material::RefineStoneFacesReference(
        coarse,
        demands,
        8,
        12
    );
    std::reverse(demands.begin(), demands.end());
    const auto reversed = vf::material::RefineStoneFacesReference(
        coarse,
        demands,
        8,
        12
    );

    require(forward.positions == reversed.positions,
            "stone demand order changed generated vertices");
    require(forward.triangles == reversed.triangles,
            "stone demand order changed generated faces");
    require(forward.positions.size() == 8,
            "stone refinement batch vertex count changed");
    require(forward.triangles.size() == 12,
            "stone refinement batch face count changed");

    std::map<std::pair<std::uint32_t, std::uint32_t>, int> edge_counts;
    std::map<std::pair<std::uint32_t, std::uint32_t>, int> edge_directions;
    for (const auto& triangle : forward.triangles) {
        for (std::size_t edge = 0; edge < 3; ++edge) {
            const std::uint32_t from = triangle[edge];
            const std::uint32_t to = triangle[(edge + 1) % 3];
            const auto key = std::minmax(from, to);
            ++edge_counts[key];
            edge_directions[key] += from < to ? 1 : -1;
        }
    }
    require(edge_counts.size() == 18,
            "stone refinement batch edge count changed");
    for (const auto& [edge, count] : edge_counts) {
        require(count == 2, "stone refinement batch opened a boundary");
        require(edge_directions.at(edge) == 0,
                "stone refinement batch changed edge winding");
    }
    require(
        forward.positions.size() - edge_counts.size() +
            forward.triangles.size() == 2,
        "stone refinement batch Euler characteristic changed"
    );

    try {
        static_cast<void>(vf::material::RefineStoneFacesReference(
            coarse,
            demands,
            7,
            12
        ));
        throw std::runtime_error("unbounded stone demand batch accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private native stone refinement batch passed\n";
    return 0;
}
