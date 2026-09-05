#include "native/material/vf_stone_visible_demand.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

using Triangle = std::array<std::uint32_t, 3>;

}  // namespace

int main() {
    auto coarse = vf::material::CreateStoneCoarseShapeReference(
        {3.0f, 2.0f, 1.5f},
        6,
        8
    );
    const auto forward = vf::material::SelectStoneVisibleFacesReference(
        coarse,
        {8.0f, 0.0f, 0.0f},
        2
    );
    require(
        forward == std::vector<Triangle>({{0, 2, 4}, {0, 5, 2}}),
        "native stone visible demand changed"
    );
    const auto refined = vf::material::RefineStoneFacesReference(
        coarse,
        forward,
        8,
        12
    );
    require(refined.positions.size() == 8,
            "stone visible demand exceeded vertex budget");
    require(refined.triangles.size() == 12,
            "stone visible demand exceeded face budget");

    std::reverse(coarse.triangles.begin(), coarse.triangles.end());
    const auto reversed = vf::material::SelectStoneVisibleFacesReference(
        coarse,
        {8.0f, 0.0f, 0.0f},
        2
    );
    require(reversed == forward, "traversal changed stone visible demand");

    const auto opposite = vf::material::SelectStoneVisibleFacesReference(
        coarse,
        {-8.0f, 0.0f, 0.0f},
        2
    );
    require(
        opposite == std::vector<Triangle>({{1, 4, 2}, {1, 2, 5}}),
        "stone demand selected back-facing geometry"
    );
    require(
        vf::material::SelectStoneVisibleFacesReference(
            coarse,
            {8.0f, 0.0f, 0.0f},
            0
        ).empty(),
        "zero-budget stone view materialized geometry"
    );

    try {
        static_cast<void>(
            vf::material::SelectStoneVisibleFacesReference(
                coarse,
                {std::numeric_limits<float>::infinity(), 0.0f, 0.0f},
                2
            )
        );
        throw std::runtime_error("unsafe stone camera was accepted");
    } catch (const std::invalid_argument&) {
    }

    std::cout << "private native stone visible demand passed\n";
    return 0;
}
