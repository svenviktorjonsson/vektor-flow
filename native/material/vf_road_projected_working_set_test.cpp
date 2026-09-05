#include "native/material/vf_road_projected_working_set.hpp"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

using Key = vf::material::RoadProjectedPacketKey;

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
    const vf::material::RoadProjectedLodPolicy policy{1000.0, 2.0, 2, 8};
    const auto first = vf::material::UpdateRoadProjectedWorkingSetReference(
        nullptr,
        candidates,
        policy
    );
    std::reverse(candidates.begin(), candidates.end());
    const auto steady = vf::material::UpdateRoadProjectedWorkingSetReference(
        &first,
        candidates,
        policy
    );

    require(first.keys == std::vector<Key>({{10, 4}, {20, 2}}),
            "initial projected packet keys changed");
    require(steady.keys == first.keys, "steady packet keys changed");
    require(steady.packets[0] == first.packets[0], "cell 10 was recreated");
    require(steady.packets[1] == first.packets[1], "cell 20 was recreated");
    require(steady.changes.retained == first.keys, "retention changed");
    require(steady.changes.created.empty(), "steady state created packets");
    require(steady.changes.evicted.empty(), "steady state evicted packets");

    for (auto& candidate : candidates) {
        if (candidate.cell_id == 10) candidate.camera_depth = 100.0;
        if (candidate.cell_id == 60) candidate.camera_depth = 2.0;
    }
    const auto moved = vf::material::UpdateRoadProjectedWorkingSetReference(
        &steady,
        candidates,
        policy
    );
    require(moved.keys == std::vector<Key>({{60, 5}, {20, 2}}),
            "camera move selected wrong packets");
    require(moved.packets[1] == steady.packets[1], "retained cell moved");
    require(moved.changes.retained == std::vector<Key>({{20, 2}}),
            "camera move did not retain cell 20");
    require(moved.changes.created == std::vector<Key>({{60, 5}}),
            "camera move did not create cell 60");
    require(moved.changes.evicted == std::vector<Key>({{10, 4}}),
            "camera move did not evict cell 10");

    for (auto& candidate : candidates) candidate.visible = false;
    const auto released = vf::material::UpdateRoadProjectedWorkingSetReference(
        &moved,
        candidates,
        policy
    );
    require(released.packets.empty(), "released road packets remain resident");
    require(released.changes.evicted == moved.keys, "release receipt changed");

    std::reverse(candidates.begin(), candidates.end());
    for (auto& candidate : candidates) {
        candidate.visible = candidate.cell_id != 50;
    }
    for (auto& candidate : candidates) {
        if (candidate.cell_id == 10) candidate.camera_depth = 10.0;
        if (candidate.cell_id == 60) candidate.camera_depth = 10.0;
    }
    const auto regenerated =
        vf::material::UpdateRoadProjectedWorkingSetReference(
            &released,
            candidates,
            policy
        );
    require(regenerated.keys == first.keys, "regenerated packet keys changed");
    require(regenerated.packets[0] != first.packets[0],
            "evicted cell 10 retained stale storage");
    require(regenerated.packets[1] != first.packets[1],
            "evicted cell 20 retained stale storage");

    std::cout << "private road projected working set passed\n";
    return 0;
}
