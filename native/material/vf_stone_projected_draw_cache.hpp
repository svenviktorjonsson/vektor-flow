#pragma once

#include "native/material/vf_stone_projected_draw_packet.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct StoneProjectedDrawCacheEntry {
    std::uint64_t stone_id;
    StoneCoarseShape source;
    std::vector<StoneTriangle> demands;
    std::shared_ptr<const StoneProjectedDrawPacket> packet;
    std::size_t bytes;
};

struct StoneProjectedDrawCacheState {
    std::vector<StoneProjectedDrawCacheEntry> entries;
    std::shared_ptr<const StoneProjectedDrawPacket> active;
    bool hit;
    std::size_t upload_bytes;
    std::vector<std::uint64_t> evicted;
    std::size_t cache_hits;
    std::size_t uploads;
    std::size_t evictions;
    std::size_t total_upload_bytes;
    std::size_t resident_bytes;
    std::size_t peak_resident_bytes;
};

inline std::size_t StoneProjectedPacketBytes(
    const StoneProjectedDrawPacket& packet
) {
    return packet.vertices.size() * sizeof(float) +
        packet.indices.size() * sizeof(std::uint32_t);
}

inline std::size_t StoneProjectedCacheBytes(
    const std::vector<StoneProjectedDrawCacheEntry>& entries
) {
    std::size_t bytes = 0;
    for (const auto& entry : entries) bytes += entry.bytes;
    return bytes;
}

inline bool SameStoneProjectedCacheKey(
    const StoneProjectedDrawCacheEntry& entry,
    std::uint64_t stone_id,
    const StoneProjectedRefinementState& refinement
) {
    return entry.stone_id == stone_id &&
        SameStoneSource(entry.source, refinement.source) &&
        entry.demands == refinement.selection.demands;
}

inline StoneProjectedDrawCacheState
UpdateStoneProjectedDrawCacheReference(
    const StoneProjectedDrawCacheState* previous,
    std::uint64_t stone_id,
    const StoneProjectedRefinementState& refinement,
    std::size_t byte_budget
) {
    std::vector<StoneProjectedDrawCacheEntry> entries =
        previous == nullptr
            ? std::vector<StoneProjectedDrawCacheEntry>{}
            : previous->entries;
    std::vector<std::uint64_t> evicted;
    const auto found = std::find_if(
        entries.begin(),
        entries.end(),
        [stone_id, &refinement](const auto& entry) {
            return SameStoneProjectedCacheKey(
                entry,
                stone_id,
                refinement
            );
        }
    );
    const std::size_t previous_hits =
        previous == nullptr ? 0 : previous->cache_hits;
    const std::size_t previous_uploads =
        previous == nullptr ? 0 : previous->uploads;
    const std::size_t previous_evictions =
        previous == nullptr ? 0 : previous->evictions;
    const std::size_t previous_upload_bytes =
        previous == nullptr ? 0 : previous->total_upload_bytes;
    const std::size_t previous_peak =
        previous == nullptr ? 0 : previous->peak_resident_bytes;

    if (found != entries.end()) {
        auto active = *found;
        entries.erase(found);
        entries.push_back(std::move(active));
        while (StoneProjectedCacheBytes(entries) > byte_budget) {
            evicted.push_back(entries.front().stone_id);
            entries.erase(entries.begin());
        }
        if (
            entries.empty() ||
            !SameStoneProjectedCacheKey(
                entries.back(),
                stone_id,
                refinement
            )
        ) {
            throw std::range_error(
                "projected stone packet exceeds cache budget"
            );
        }
        const std::size_t resident_bytes =
            StoneProjectedCacheBytes(entries);
        const auto active_packet = entries.back().packet;
        const std::size_t eviction_count = evicted.size();
        return {
            std::move(entries),
            active_packet,
            true,
            0,
            std::move(evicted),
            previous_hits + 1,
            previous_uploads,
            previous_evictions + eviction_count,
            previous_upload_bytes,
            resident_bytes,
            std::max(previous_peak, resident_bytes),
        };
    }

    const auto draw = AdaptStoneProjectedDrawPacketReference(
        refinement,
        nullptr
    );
    const std::size_t packet_bytes = StoneProjectedPacketBytes(*draw.packet);
    if (packet_bytes > byte_budget) {
        throw std::range_error(
            "projected stone packet exceeds cache budget"
        );
    }
    entries.erase(
        std::remove_if(
            entries.begin(),
            entries.end(),
            [stone_id, &refinement, &evicted](const auto& entry) {
                const bool stale = entry.stone_id == stone_id &&
                    !SameStoneSource(entry.source, refinement.source);
                if (stale) evicted.push_back(entry.stone_id);
                return stale;
            }
        ),
        entries.end()
    );
    while (StoneProjectedCacheBytes(entries) + packet_bytes > byte_budget) {
        evicted.push_back(entries.front().stone_id);
        entries.erase(entries.begin());
    }
    entries.push_back({
        stone_id,
        refinement.source,
        refinement.selection.demands,
        draw.packet,
        packet_bytes,
    });
    const std::size_t resident_bytes = StoneProjectedCacheBytes(entries);
    const std::size_t eviction_count = evicted.size();
    return {
        std::move(entries),
        draw.packet,
        false,
        packet_bytes,
        std::move(evicted),
        previous_hits,
        previous_uploads + 1,
        previous_evictions + eviction_count,
        previous_upload_bytes + packet_bytes,
        resident_bytes,
        std::max(previous_peak, resident_bytes),
    };
}

}  // namespace vf::material
