#include "native/material/vf_road_lod_transition_path.hpp"

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
    const std::vector<double> progress{0.0, 0.25, 0.5, 0.75, 1.0};

    const auto forward = vf::material::AuditRoadLodTransitionPathReference(
        previous,
        current,
        progress,
        5
    );
    require(
        forward.resident_counts ==
            std::vector<std::size_t>({3, 5, 5, 5, 3}),
        "camera path residency changed"
    );
    require(forward.peak_resident == 5, "camera path peak changed");
    require(forward.settled_resident == 3, "camera path did not settle");

    std::reverse(previous.keys.begin(), previous.keys.end());
    std::reverse(previous.packets.begin(), previous.packets.end());
    std::reverse(current.keys.begin(), current.keys.end());
    std::reverse(current.packets.begin(), current.packets.end());
    const auto reversed = vf::material::AuditRoadLodTransitionPathReference(
        previous,
        current,
        progress,
        5
    );
    require(
        reversed.resident_counts == forward.resident_counts,
        "working-set order changed camera path residency"
    );
    require(
        reversed.peak_resident == forward.peak_resident,
        "working-set order changed camera path peak"
    );

    try {
        static_cast<void>(
            vf::material::AuditRoadLodTransitionPathReference(
                previous,
                current,
                {0.0, 0.75, 0.5, 1.0},
                5
            )
        );
        throw std::runtime_error("backtracking transition path accepted");
    } catch (const std::invalid_argument&) {
    }
    try {
        static_cast<void>(
            vf::material::AuditRoadLodTransitionPathReference(
                previous,
                current,
                progress,
                4
            )
        );
        throw std::runtime_error("unbounded camera path residency accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private road LOD transition camera path passed\n";
    return 0;
}
