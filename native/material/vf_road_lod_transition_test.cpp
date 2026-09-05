#include "native/material/vf_road_lod_transition.hpp"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void require_equal(
    const std::vector<vf::material::RoadLodCoverage>& first,
    const std::vector<vf::material::RoadLodCoverage>& second
) {
    require(first.size() == second.size(), "transition size changed");
    for (std::size_t index = 0; index < first.size(); ++index) {
        require(
            first[index].key == second[index].key,
            "transition key changed"
        );
        require(
            first[index].coverage == second[index].coverage,
            "transition coverage changed"
        );
    }
}

}  // namespace

int main() {
    using Key = vf::material::RoadProjectedPacketKey;
    std::vector<Key> previous{{10, 4}, {20, 2}, {70, 1}};
    std::vector<Key> current{{20, 3}, {60, 5}, {70, 1}};
    const auto forward =
        vf::material::PlanRoadLodCoverageTransitionReference(
            previous,
            current,
            0.25,
            5
        );
    std::reverse(previous.begin(), previous.end());
    std::reverse(current.begin(), current.end());
    const auto reversed =
        vf::material::PlanRoadLodCoverageTransitionReference(
            previous,
            current,
            0.25,
            5
        );

    require_equal(reversed, forward);
    require(forward.size() == 5, "transition entry count changed");
    require(forward[0].key == Key{10, 4}, "removed cell order changed");
    require(forward[0].coverage == 0.75, "removed cell did not fade out");
    require(forward[1].key == Key{20, 2}, "old LOD key changed");
    require(forward[1].coverage == 0.75, "old LOD did not fade out");
    require(forward[2].key == Key{20, 3}, "new LOD key changed");
    require(forward[2].coverage == 0.25, "new LOD did not fade in");
    require(
        forward[1].coverage + forward[2].coverage == 1.0,
        "LOD transition lost coverage"
    );
    require(forward[3].key == Key{60, 5}, "created cell order changed");
    require(forward[3].coverage == 0.25, "created cell did not fade in");
    require(forward[4].key == Key{70, 1}, "retained cell key changed");
    require(forward[4].coverage == 1.0, "retained cell coverage changed");

    try {
        static_cast<void>(
            vf::material::PlanRoadLodCoverageTransitionReference(
                previous,
                current,
                0.25,
                4
            )
        );
        throw std::runtime_error("partial LOD transition was accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private road LOD coverage transition passed\n";
    return 0;
}
