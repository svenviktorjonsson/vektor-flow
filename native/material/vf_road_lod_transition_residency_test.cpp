#include "native/material/vf_road_lod_transition_residency.hpp"

#include <algorithm>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

using Key = vf::material::RoadProjectedPacketKey;
using Packet = vf::material::RoadProjectedPacket;
using WorkingSet = vf::material::RoadProjectedWorkingSet;

std::shared_ptr<const Packet> packet(Key key) {
    return std::make_shared<const Packet>(Packet{key});
}

WorkingSet working_set(
    std::vector<Key> keys,
    std::vector<std::shared_ptr<const Packet>> packets
) {
    WorkingSet result;
    result.keys = std::move(keys);
    result.packets = std::move(packets);
    return result;
}

}  // namespace

int main() {
    const auto cell_10 = packet({10, 4});
    const auto cell_20_old = packet({20, 2});
    const auto cell_20_new = packet({20, 3});
    const auto cell_60 = packet({60, 5});
    const auto cell_70 = packet({70, 1});
    auto previous = working_set(
        {{10, 4}, {20, 2}, {70, 1}},
        {cell_10, cell_20_old, cell_70}
    );
    auto current = working_set(
        {{20, 3}, {60, 5}, {70, 1}},
        {cell_20_new, cell_60, cell_70}
    );

    const auto middle =
        vf::material::PlanRoadLodTransitionResidencyReference(
            previous,
            current,
            0.25,
            5
        );
    require(middle.size() == 5, "transition residency count changed");
    require(middle[0].coverage.key == Key{10, 4}, "old cell key changed");
    require(middle[0].packet == cell_10, "old cell packet was released");
    require(middle[1].packet == cell_20_old, "old LOD packet was released");
    require(middle[2].packet == cell_20_new, "new LOD packet changed");
    require(middle[3].packet == cell_60, "new cell packet changed");
    require(middle[4].packet == cell_70, "stable packet identity changed");

    const auto start =
        vf::material::PlanRoadLodTransitionResidencyReference(
            previous,
            current,
            0.0,
            3
        );
    require(start.size() == 3, "transition start retained new packets");
    require(start[0].packet == cell_10, "start released previous packet");
    require(start[1].packet == cell_20_old, "start released old LOD packet");
    require(start[2].packet == cell_70, "start changed stable packet");

    const auto finish =
        vf::material::PlanRoadLodTransitionResidencyReference(
            previous,
            current,
            1.0,
            3
        );
    require(finish.size() == 3, "transition finish retained old packets");
    require(finish[0].packet == cell_20_new, "finish lost new LOD packet");
    require(finish[1].packet == cell_60, "finish lost new cell packet");
    require(finish[2].packet == cell_70, "finish changed stable packet");

    std::reverse(previous.keys.begin(), previous.keys.end());
    std::reverse(previous.packets.begin(), previous.packets.end());
    std::reverse(current.keys.begin(), current.keys.end());
    std::reverse(current.packets.begin(), current.packets.end());
    const auto reversed =
        vf::material::PlanRoadLodTransitionResidencyReference(
            previous,
            current,
            0.25,
            5
        );
    for (std::size_t index = 0; index < middle.size(); ++index) {
        require(
            reversed[index].coverage.key == middle[index].coverage.key,
            "working-set order changed transition residency"
        );
        require(
            reversed[index].packet == middle[index].packet,
            "working-set order changed packet identity"
        );
    }

    try {
        static_cast<void>(
            vf::material::PlanRoadLodTransitionResidencyReference(
                previous,
                current,
                0.25,
                4
            )
        );
        throw std::runtime_error("unbounded transition residency accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private road LOD transition residency passed\n";
    return 0;
}
