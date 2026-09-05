#pragma once

#include "native/material/vf_road_lod_transition.hpp"

#include <cstddef>
#include <map>
#include <memory>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct RoadLodResidentPacket {
    RoadLodCoverage coverage;
    std::shared_ptr<const RoadProjectedPacket> packet;
};

inline std::map<
    RoadProjectedPacketKey,
    std::shared_ptr<const RoadProjectedPacket>
> RoadPacketsByKey(const RoadProjectedWorkingSet& working_set) {
    if (working_set.keys.size() != working_set.packets.size()) {
        throw std::invalid_argument("road working-set shape is invalid");
    }
    std::map<
        RoadProjectedPacketKey,
        std::shared_ptr<const RoadProjectedPacket>
    > packets;
    for (std::size_t index = 0; index < working_set.keys.size(); ++index) {
        const auto& packet = working_set.packets[index];
        if (
            packet == nullptr ||
            !(packet->key == working_set.keys[index])
        ) {
            throw std::invalid_argument("road working-set packet is invalid");
        }
        if (!packets.emplace(working_set.keys[index], packet).second) {
            throw std::invalid_argument("road working-set key is duplicated");
        }
    }
    return packets;
}

inline std::vector<RoadLodResidentPacket>
PlanRoadLodTransitionResidencyReference(
    const RoadProjectedWorkingSet& previous,
    const RoadProjectedWorkingSet& current,
    double progress,
    std::size_t resident_budget
) {
    auto packets = RoadPacketsByKey(previous);
    const auto current_packets = RoadPacketsByKey(current);
    for (const auto& [key, packet] : current_packets) {
        const auto found = packets.find(key);
        if (found != packets.end() && found->second != packet) {
            throw std::invalid_argument(
                "stable road packet identity changed"
            );
        }
        packets[key] = packet;
    }
    const auto coverage = PlanRoadLodCoverageTransitionReference(
        previous.keys,
        current.keys,
        progress,
        resident_budget
    );
    std::vector<RoadLodResidentPacket> resident;
    resident.reserve(coverage.size());
    for (const auto& entry : coverage) {
        resident.push_back({entry, packets.at(entry.key)});
    }
    return resident;
}

}  // namespace vf::material
