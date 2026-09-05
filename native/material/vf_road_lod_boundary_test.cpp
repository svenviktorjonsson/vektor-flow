#include "native/material/vf_road_lod_boundary.hpp"

#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    const vf::material::RoadLodCell first{7, 2, 1};
    const vf::material::RoadLodCell second{7, 3, 3};
    const auto forward = vf::material::ConformRoadLodBoundaryReference(
        first,
        second,
        9
    );
    const auto reversed = vf::material::ConformRoadLodBoundaryReference(
        second,
        first,
        9
    );

    require(forward.detail_level == 3, "finer boundary level was lost");
    require(forward.denominator == 8, "boundary denominator changed");
    require(forward.numerators.size() == 9, "boundary sample count changed");
    require(
        forward.numerators == reversed.numerators,
        "cell order cracked edge"
    );
    std::vector<std::pair<std::int64_t, std::int64_t>> expected;
    for (std::int64_t longitudinal = 56; longitudinal <= 64;
         ++longitudinal) {
        expected.emplace_back(longitudinal, 24);
    }
    require(forward.numerators == expected, "shared road edge moved");

    try {
        static_cast<void>(vf::material::ConformRoadLodBoundaryReference(
            first,
            second,
            8
        ));
        throw std::runtime_error("undersized boundary budget was accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private road LOD boundary conformance passed\n";
    return 0;
}
