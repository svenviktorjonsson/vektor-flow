#include "native/material/vf_road_lod_transition_boundary.hpp"

#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    const vf::material::RoadLodCell previous_first{7, 2, 1};
    const vf::material::RoadLodCell previous_second{7, 3, 3};
    const vf::material::RoadLodCell current_first{7, 2, 6};
    const vf::material::RoadLodCell current_second{7, 3, 2};
    const auto previous = vf::material::ConformRoadLodBoundaryReference(
        previous_first,
        previous_second,
        65
    );
    const auto current = vf::material::ConformRoadLodBoundaryReference(
        current_first,
        current_second,
        65
    );
    const auto transition =
        vf::material::ConformRoadLodTransitionBoundaryReference(
            previous_first,
            previous_second,
            current_first,
            current_second,
            65
        );

    require(transition.shared.detail_level == 6,
            "transition lost finest boundary level");
    require(transition.shared.denominator == 64,
            "transition boundary denominator changed");
    require(transition.shared.numerators.size() == 65,
            "transition boundary sample count changed");
    require(transition.previous_stride == 8,
            "previous boundary stride changed");
    require(transition.current_stride == 1,
            "current boundary stride changed");

    for (std::size_t index = 0; index < previous.numerators.size(); ++index) {
        const auto& coarse = previous.numerators[index];
        const auto& shared = transition.shared.numerators[
            index * transition.previous_stride
        ];
        require(
            shared.first ==
                coarse.first *
                    static_cast<std::int64_t>(transition.previous_stride) &&
            shared.second ==
                coarse.second *
                    static_cast<std::int64_t>(transition.previous_stride),
            "previous boundary sample moved during transition"
        );
    }
    require(
        transition.shared.numerators == current.numerators,
        "current boundary samples moved during transition"
    );

    const auto reversed =
        vf::material::ConformRoadLodTransitionBoundaryReference(
            current_second,
            current_first,
            previous_second,
            previous_first,
            65
        );
    require(
        reversed.shared.numerators == transition.shared.numerators,
        "cell and transition order cracked shared boundary"
    );

    try {
        static_cast<void>(
            vf::material::ConformRoadLodTransitionBoundaryReference(
                previous_first,
                previous_second,
                current_first,
                current_second,
                64
            )
        );
        throw std::runtime_error("undersized transition budget accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private road LOD transition boundary passed\n";
    return 0;
}
