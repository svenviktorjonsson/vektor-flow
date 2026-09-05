#pragma once

#include "native/material/vf_road_projected_lod.hpp"

#include <cstdint>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct RoadProjectedPacketKey {
    std::uint64_t cell_id;
    std::uint32_t detail_level;
};

inline bool operator==(
    const RoadProjectedPacketKey& first,
    const RoadProjectedPacketKey& second
) {
    return first.cell_id == second.cell_id &&
        first.detail_level == second.detail_level;
}

inline bool operator<(
    const RoadProjectedPacketKey& first,
    const RoadProjectedPacketKey& second
) {
    return first.cell_id < second.cell_id ||
        (first.cell_id == second.cell_id &&
         first.detail_level < second.detail_level);
}

struct RoadProjectedPacket {
    RoadProjectedPacketKey key;
};

struct RoadProjectedWorkingSetChanges {
    std::vector<RoadProjectedPacketKey> retained;
    std::vector<RoadProjectedPacketKey> created;
    std::vector<RoadProjectedPacketKey> evicted;
};

struct RoadProjectedWorkingSet {
    std::vector<RoadProjectedPacketKey> keys;
    std::vector<std::shared_ptr<const RoadProjectedPacket>> packets;
    RoadProjectedWorkingSetChanges changes;
};

inline RoadProjectedWorkingSet UpdateRoadProjectedWorkingSetReference(
    const RoadProjectedWorkingSet* previous,
    const std::vector<RoadProjectedCandidate>& candidates,
    const RoadProjectedLodPolicy& policy
) {
    const auto demands = SelectRoadProjectedLodReference(candidates, policy);
    std::map<
        RoadProjectedPacketKey,
        std::shared_ptr<const RoadProjectedPacket>
    > previous_packets;
    if (previous != nullptr) {
        for (std::size_t index = 0; index < previous->keys.size(); ++index) {
            previous_packets.emplace(
                previous->keys[index],
                previous->packets.at(index)
            );
        }
    }

    RoadProjectedWorkingSet result;
    std::set<RoadProjectedPacketKey> selected;
    result.keys.reserve(demands.size());
    result.packets.reserve(demands.size());
    for (const auto& demand : demands) {
        const RoadProjectedPacketKey key{
            demand.cell_id,
            demand.detail_level,
        };
        if (!selected.insert(key).second) {
            throw std::invalid_argument("road projected packet is duplicated");
        }
        result.keys.push_back(key);
        const auto retained = previous_packets.find(key);
        if (retained != previous_packets.end()) {
            result.packets.push_back(retained->second);
            result.changes.retained.push_back(key);
        } else {
            result.packets.push_back(
                std::make_shared<const RoadProjectedPacket>(
                    RoadProjectedPacket{key}
                )
            );
            result.changes.created.push_back(key);
        }
    }
    if (previous != nullptr) {
        for (const auto& key : previous->keys) {
            if (selected.count(key) == 0) {
                result.changes.evicted.push_back(key);
            }
        }
    }
    return result;
}

}  // namespace vf::material
