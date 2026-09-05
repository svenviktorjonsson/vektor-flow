#include "native/material/vf_road_projected_lod.hpp"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void require_equal(
    const std::vector<vf::material::RoadProjectedDemand>& first,
    const std::vector<vf::material::RoadProjectedDemand>& second
) {
    require(first.size() == second.size(), "demand size changed with order");
    for (std::size_t index = 0; index < first.size(); ++index) {
        require(first[index].cell_id == second[index].cell_id, "cell changed");
        require(
            first[index].detail_level == second[index].detail_level,
            "detail changed"
        );
        require(
            first[index].coarse_error_pixels ==
                second[index].coarse_error_pixels,
            "coarse error changed"
        );
        require(
            first[index].residual_error_pixels ==
                second[index].residual_error_pixels,
            "residual error changed"
        );
    }
}

}  // namespace

int main() {
    std::vector<vf::material::RoadProjectedCandidate> candidates{
        {40, 100.0, 0.10, 0.05, true},
        {10, 10.0, 0.20, 0.10, true},
        {20, 20.0, 0.08, 0.16, true},
        {30, 5.0, 0.01, 0.01, true},
        {50, 1.0, 1.00, 1.00, false},
        {60, 10.0, 0.08, 0.04, true},
    };
    const vf::material::RoadProjectedLodPolicy policy{
        1000.0,
        2.0,
        2,
        8,
    };
    const auto forward = vf::material::SelectRoadProjectedLodReference(
        candidates,
        policy
    );
    std::reverse(candidates.begin(), candidates.end());
    const auto reversed = vf::material::SelectRoadProjectedLodReference(
        candidates,
        policy
    );

    require_equal(reversed, forward);
    require(forward.size() == 2, "road projected LOD exceeded its budget");
    require(forward[0].cell_id == 10, "largest road error was not first");
    require(forward[0].detail_level == 4, "near road detail was not refined");
    require(forward[0].coarse_error_pixels == 20.0, "near error changed");
    require(forward[0].residual_error_pixels == 1.25, "near residual changed");
    require(forward[1].cell_id == 20, "stable tie-break changed");
    require(forward[1].detail_level == 2, "material error did not refine");
    require(forward[1].coarse_error_pixels == 8.0, "material error changed");
    require(
        forward[1].residual_error_pixels == 2.0,
        "material residual changed"
    );

    std::cout << "private road projected LOD selection passed\n";
    return 0;
}
