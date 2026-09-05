#pragma once

#include "native/material/vf_stone_hierarchical_material_draw_packet.hpp"

#include <algorithm>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct StoneHierarchicalMaterialResidencyEntry {
    std::uint64_t stone_id;
    StoneCoarseShape source;
    std::vector<StoneTriangle> geometry_demands;
    std::uint64_t version;
    std::shared_ptr<const StoneHierarchicalMaterialDrawPacket> packet;
    std::size_t bytes;
};

struct StoneHierarchicalMaterialResidencyState {
    std::vector<StoneHierarchicalMaterialResidencyEntry> entries;
    std::shared_ptr<const StoneHierarchicalMaterialDrawPacket> active;
    std::uint64_t active_version;
    bool hit;
    std::size_t upload_bytes;
    std::vector<std::uint64_t> evicted_versions;
    std::size_t cache_hits;
    std::size_t uploads;
    std::size_t evictions;
    std::size_t total_upload_bytes;
    std::size_t resident_bytes;
    std::size_t peak_resident_bytes;
};

inline std::size_t StoneHierarchicalGeometryPacketBytes(
    const StoneProjectedDrawPacket& packet
) {
    return packet.vertices.size() * sizeof(float) +
        packet.indices.size() * sizeof(std::uint32_t);
}

inline std::size_t StoneHierarchicalMaterialPacketBytes(
    const StoneHierarchicalMaterialDrawPacket& packet
) {
    return StoneHierarchicalGeometryPacketBytes(*packet.geometry) +
        packet.material_bytes.size();
}

inline std::size_t StoneHierarchicalMaterialResidentBytes(
    const std::vector<StoneHierarchicalMaterialResidencyEntry>& entries
) {
    std::size_t bytes = 0;
    for (const auto& entry : entries) bytes += entry.bytes;
    return bytes;
}

inline void HashStoneResidencyByte(
    std::uint64_t& hash,
    std::uint8_t byte
) {
    hash ^= byte;
    hash *= 1099511628211ull;
}

inline void HashStoneResidencyWord(
    std::uint64_t& hash,
    std::uint32_t word
) {
    for (std::size_t offset = 0; offset < sizeof(word); ++offset) {
        HashStoneResidencyByte(
            hash,
            static_cast<std::uint8_t>(
                (word >> (offset * 8)) & 0xffu
            )
        );
    }
}

inline std::uint64_t StoneHierarchicalMaterialPacketVersion(
    const StoneHierarchicalMaterialDrawPacket& packet
) {
    std::uint64_t hash = 1469598103934665603ull;
    for (const float vertex : packet.geometry->vertices) {
        HashStoneResidencyWord(
            hash,
            std::bit_cast<std::uint32_t>(vertex)
        );
    }
    for (const std::uint32_t index : packet.geometry->indices) {
        HashStoneResidencyWord(hash, index);
    }
    for (const std::uint8_t byte : packet.material_bytes) {
        HashStoneResidencyByte(hash, byte);
    }
    return hash;
}

inline void ValidateStoneHierarchicalMaterialDrawVersion(
    const StoneProjectedRefinementState& refinement,
    const StoneHierarchicalMaterialDrawState& draw
) {
    if (refinement.geometry == nullptr ||
        draw.packet == nullptr ||
        draw.geometry.packet == nullptr ||
        draw.geometry.source_geometry != refinement.geometry ||
        draw.packet->geometry != draw.geometry.packet) {
        throw std::invalid_argument(
            "stone residency received stale geometry version"
        );
    }
    const auto expected =
        PackStoneHierarchicalMaterialDrawPacketReference(
            draw.geometry.packet,
            draw.material
        );
    if (expected->material_bytes != draw.packet->material_bytes) {
        throw std::invalid_argument(
            "stone residency received stale material version"
        );
    }
}

inline bool SameStoneHierarchicalMaterialResidencyKey(
    const StoneHierarchicalMaterialResidencyEntry& entry,
    std::uint64_t stone_id,
    const StoneProjectedRefinementState& refinement,
    const StoneHierarchicalMaterialDrawPacket& packet,
    std::uint64_t version
) {
    return entry.stone_id == stone_id &&
        entry.version == version &&
        SameStoneSource(entry.source, refinement.source) &&
        entry.geometry_demands == refinement.selection.demands &&
        entry.packet->geometry->vertices == packet.geometry->vertices &&
        entry.packet->geometry->indices == packet.geometry->indices &&
        entry.packet->material_bytes == packet.material_bytes;
}

inline StoneHierarchicalMaterialResidencyState
UpdateStoneHierarchicalMaterialResidencyReference(
    const StoneHierarchicalMaterialResidencyState* previous,
    std::uint64_t stone_id,
    const StoneProjectedRefinementState& refinement,
    const StoneHierarchicalMaterialDrawState& draw,
    std::size_t byte_budget
) {
    ValidateStoneHierarchicalMaterialDrawVersion(refinement, draw);
    const std::size_t requested_bytes =
        StoneHierarchicalMaterialPacketBytes(*draw.packet);
    if (requested_bytes > byte_budget) {
        throw std::range_error(
            "stone material packet exceeds residency budget"
        );
    }
    const std::uint64_t version =
        StoneHierarchicalMaterialPacketVersion(*draw.packet);
    auto entries = previous == nullptr
        ? std::vector<StoneHierarchicalMaterialResidencyEntry>{}
        : previous->entries;
    std::vector<std::uint64_t> evicted_versions;
    const auto exact = std::find_if(
        entries.begin(),
        entries.end(),
        [stone_id, &refinement, &draw, version](const auto& entry) {
            return SameStoneHierarchicalMaterialResidencyKey(
                entry,
                stone_id,
                refinement,
                *draw.packet,
                version
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
    if (exact != entries.end()) {
        auto active = *exact;
        entries.erase(exact);
        entries.push_back(std::move(active));
        while (StoneHierarchicalMaterialResidentBytes(entries) >
               byte_budget) {
            evicted_versions.push_back(entries.front().version);
            entries.erase(entries.begin());
        }
        if (entries.empty() || entries.back().version != version) {
            throw std::range_error(
                "active stone material version exceeds residency budget"
            );
        }
        const std::size_t resident_bytes =
            StoneHierarchicalMaterialResidentBytes(entries);
        const std::size_t eviction_count = evicted_versions.size();
        const auto active_packet = entries.back().packet;
        return {
            std::move(entries),
            active_packet,
            version,
            true,
            0,
            std::move(evicted_versions),
            previous_hits + 1,
            previous_uploads,
            previous_evictions + eviction_count,
            previous_upload_bytes,
            resident_bytes,
            std::max(previous_peak, resident_bytes),
        };
    }

    std::size_t upload_bytes = requested_bytes;
    for (auto entry = entries.rbegin(); entry != entries.rend(); ++entry) {
        if (entry->stone_id != stone_id) continue;
        const bool same_geometry =
            entry->packet->geometry->vertices ==
                draw.packet->geometry->vertices &&
            entry->packet->geometry->indices ==
                draw.packet->geometry->indices;
        const std::size_t geometry_upload = same_geometry
            ? 0
            : StoneHierarchicalGeometryPacketBytes(
                *draw.packet->geometry
            );
        upload_bytes = geometry_upload +
            CountStoneMaterialRecordChanges(
                entry->packet->material_bytes,
                draw.packet->material_bytes
            ) * kStoneHierarchicalMaterialRecordBytes;
        break;
    }
    while (StoneHierarchicalMaterialResidentBytes(entries) +
           requested_bytes > byte_budget) {
        evicted_versions.push_back(entries.front().version);
        entries.erase(entries.begin());
    }
    entries.push_back({
        stone_id,
        refinement.source,
        refinement.selection.demands,
        version,
        draw.packet,
        requested_bytes,
    });
    const std::size_t resident_bytes =
        StoneHierarchicalMaterialResidentBytes(entries);
    const std::size_t eviction_count = evicted_versions.size();
    return {
        std::move(entries),
        draw.packet,
        version,
        false,
        upload_bytes,
        std::move(evicted_versions),
        previous_hits,
        previous_uploads + 1,
        previous_evictions + eviction_count,
        previous_upload_bytes + upload_bytes,
        resident_bytes,
        std::max(previous_peak, resident_bytes),
    };
}

}  // namespace vf::material
