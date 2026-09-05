#include "native/material/vf_stone_projected_demand.hpp"

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

void require_near(double actual, double expected, const char* message) {
    if (std::abs(actual - expected) > 1.0e-9) {
        throw std::runtime_error(message);
    }
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
    const auto forward = vf::material::SelectStoneProjectedDemandReference(
        stone,
        camera,
        0.0,
        2
    );
    require(
        forward.demands ==
            std::vector<Triangle>({{0, 2, 4}, {0, 5, 2}}),
        "native projected stone demand changed"
    );
    require(forward.candidates.size() == 4,
            "native projected candidate count changed");
    require(
        std::all_of(
            forward.candidates.begin(),
            forward.candidates.end(),
            [](const auto& candidate) { return candidate.silhouette; }
        ),
        "native projected demand lost silhouette priority"
    );
    require(
        forward.culled == std::vector<Triangle>({
            {1, 4, 2},
            {1, 3, 4},
            {1, 2, 5},
            {1, 5, 3},
        }),
        "native projected culling changed"
    );
    const auto& first = forward.candidates.front();
    require_near(
        first.silhouette_error_pixels,
        60.533910158706625,
        "native silhouette error diverged from JS"
    );
    require_near(
        first.projected_error_pixels,
        108.09023430565387,
        "native projected error diverged from JS"
    );
    require_near(
        first.error_bound_pixels,
        230.11397265001793,
        "native error bound diverged from JS"
    );

    const auto accepted = vf::material::SelectStoneProjectedDemandReference(
        stone,
        camera,
        230.0,
        4
    );
    const auto rejected = vf::material::SelectStoneProjectedDemandReference(
        stone,
        camera,
        231.0,
        4
    );
    require(accepted.demands.size() == 4,
            "native conservative threshold rejected detail");
    require(rejected.demands.empty(),
            "native conservative threshold over-refined detail");

    std::reverse(stone.triangles.begin(), stone.triangles.end());
    const auto reversed = vf::material::SelectStoneProjectedDemandReference(
        stone,
        camera,
        0.0,
        2
    );
    require(reversed.demands == forward.demands,
            "triangle traversal changed projected demand");
    require(reversed.culled == forward.culled,
            "triangle traversal changed projected culling");

    auto diagonal_camera = camera;
    diagonal_camera.eye = {8.0, 8.0, 8.0};
    const auto diagonal =
        vf::material::SelectStoneProjectedDemandReference(
            stone,
            diagonal_camera,
            0.0,
            4
        );
    require(
        diagonal.demands == std::vector<Triangle>({
            {1, 4, 2},
            {0, 4, 3},
            {0, 5, 2},
            {0, 2, 4},
        }),
        "native silhouette ranking diverged from JS"
    );
    require(
        diagonal.candidates[0].silhouette &&
            diagonal.candidates[1].silhouette &&
            diagonal.candidates[2].silhouette &&
            !diagonal.candidates[3].silhouette,
        "native visible interior face outranked silhouette"
    );

    std::cout << "private native stone projected demand passed\n";
    return 0;
}
