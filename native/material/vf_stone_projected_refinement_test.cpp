#include "native/material/vf_stone_projected_refinement.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

using Triangle = std::array<std::uint32_t, 3>;

}  // namespace

int main() {
    auto stone = vf::material::CreateStoneCoarseShapeReference(
        {3.0f, 2.0f, 1.5f},
        6,
        8
    );
    const vf::material::StoneViewCamera camera{
        {8.0, 0.0, 0.0},
        {0.0, 0.0, 0.0},
        {0.0, 0.0, 1.0},
        std::acos(-1.0) / 3.0,
        1080.0,
    };
    const auto first =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone, nullptr, camera, 0.0, 2, 8, 12
        );
    require(
        first.selection.demands ==
            std::vector<Triangle>({{0, 2, 4}, {0, 5, 2}}),
        "projected refinement consumed the wrong demand"
    );
    require(first.geometry != nullptr,
            "projected refinement did not retain geometry");
    require(first.detail_vertices == 2 && first.detail_faces == 4,
            "projected refinement detail counts changed");
    require(!first.retained,
            "first projected refinement was incorrectly retained");

    const auto steady =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone, &first, camera, 0.0, 2, 8, 12
        );
    require(steady.retained,
            "stable projected demand did not retain geometry");
    require(steady.geometry == first.geometry,
            "stable projected demand replaced geometry storage");

    auto reversed = stone;
    std::reverse(reversed.triangles.begin(), reversed.triangles.end());
    const auto traversal =
        vf::material::UpdateStoneProjectedRefinementReference(
            reversed, &steady, camera, 0.0, 2, 8, 12
        );
    require(traversal.retained,
            "source traversal order invalidated semantic residency");
    require(traversal.geometry == steady.geometry,
            "source traversal order replaced resident geometry");

    auto opposite = camera;
    opposite.eye = {-8.0, 0.0, 0.0};
    const auto moved =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone, &traversal, opposite, 0.0, 2, 8, 12
        );
    require(!moved.retained && moved.geometry != traversal.geometry,
            "changed projected demand retained stale geometry");
    require(moved.detail_vertices == 2 && moved.detail_faces == 4,
            "changed projected demand escaped detail bounds");

    const auto coarse =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone, &moved, camera, 231.0, 4, 8, 12
        );
    require(coarse.selection.demands.empty(),
            "accepted projected error retained detail demand");
    require(coarse.detail_vertices == 0 && coarse.detail_faces == 0,
            "accepted projected error retained detail geometry");
    const auto coarse_steady =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone, &coarse, camera, 231.0, 4, 8, 12
        );
    require(coarse_steady.retained &&
                coarse_steady.geometry == coarse.geometry,
            "stable coarse demand replaced resident geometry");

    bool rejected = false;
    try {
        static_cast<void>(
            vf::material::UpdateStoneProjectedRefinementReference(
                stone, &steady, camera, 0.0, 2, 7, 12
            )
        );
    } catch (const std::range_error&) {
        rejected = true;
    }
    require(rejected,
            "retained projected geometry escaped the reduced budget");

    std::cout << "private native projected refinement passed\n";
    return 0;
}
