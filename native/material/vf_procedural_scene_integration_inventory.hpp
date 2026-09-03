#pragma once

#include "native/material/vf_forest_tree_material_pipeline.hpp"
#include "native/material/vf_road_hierarchical_residency.hpp"
#include "native/material/vf_stone_hierarchical_material_draw_packet.hpp"

#include <array>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vf::material {

enum class ProceduralSceneContentKind : std::uint8_t {
    stone,
    road,
    forest,
};

enum class ProceduralSceneIntegrationGate : std::uint8_t {
    ready,
    needs_material_binding,
    needs_geometry,
};

struct ProceduralSceneIntegrationEntry {
    ProceduralSceneContentKind kind;
    ProceduralSceneIntegrationGate gate;
    std::size_t vertex_stride_floats;
    std::size_t vertex_count;
    std::size_t index_count;
    std::size_t material_records;
    std::size_t geometry_bytes;
    std::size_t material_bytes;
    std::uint64_t version;
};

struct ProceduralSceneIntegrationReport {
    std::array<ProceduralSceneIntegrationEntry, 3> entries;
    std::size_t ready_entries;
    std::size_t blocked_entries;
    std::size_t resident_bytes;
    std::uint64_t version;
};

inline bool operator==(
    const ProceduralSceneIntegrationEntry& first,
    const ProceduralSceneIntegrationEntry& second
) {
    return first.kind == second.kind &&
        first.gate == second.gate &&
        first.vertex_stride_floats == second.vertex_stride_floats &&
        first.vertex_count == second.vertex_count &&
        first.index_count == second.index_count &&
        first.material_records == second.material_records &&
        first.geometry_bytes == second.geometry_bytes &&
        first.material_bytes == second.material_bytes &&
        first.version == second.version;
}

inline bool operator==(
    const ProceduralSceneIntegrationReport& first,
    const ProceduralSceneIntegrationReport& second
) {
    return first.entries == second.entries &&
        first.ready_entries == second.ready_entries &&
        first.blocked_entries == second.blocked_entries &&
        first.resident_bytes == second.resident_bytes &&
        first.version == second.version;
}

inline void MixProceduralSceneInventoryWordReference(
    std::uint64_t& hash,
    std::uint64_t word
) {
    for (std::size_t offset = 0; offset < sizeof(word); ++offset) {
        hash ^= static_cast<std::uint8_t>(
            (word >> (offset * 8)) & 0xffu
        );
        hash *= 1099511628211ull;
    }
}

inline void MixProceduralSceneInventoryBytesReference(
    std::uint64_t& hash,
    const std::vector<std::uint8_t>& bytes
) {
    for (const std::uint8_t byte : bytes) {
        hash ^= byte;
        hash *= 1099511628211ull;
    }
}

inline void ValidateProceduralSceneTriangleIndicesReference(
    const std::vector<std::uint32_t>& indices,
    std::size_t vertex_count
) {
    if (indices.empty() || indices.size() % 3 != 0) {
        throw std::invalid_argument(
            "procedural scene triangle indices are incomplete"
        );
    }
    for (const std::uint32_t index : indices) {
        if (index >= vertex_count) {
            throw std::invalid_argument(
                "procedural scene triangle index is invalid"
            );
        }
    }
}

inline ProceduralSceneIntegrationEntry
AuditProceduralStoneIntegrationReference(
    const StoneHierarchicalMaterialDrawPacket& packet
) {
    constexpr std::size_t stride = 10;
    if (packet.geometry == nullptr ||
        packet.geometry->vertices.empty() ||
        packet.geometry->vertices.size() % stride != 0 ||
        packet.material_bytes.empty() ||
        packet.material_bytes.size() %
            kStoneHierarchicalMaterialRecordBytes != 0) {
        throw std::invalid_argument(
            "procedural stone consumer packet is malformed"
        );
    }
    const std::size_t vertex_count =
        packet.geometry->vertices.size() / stride;
    ValidateProceduralSceneTriangleIndicesReference(
        packet.geometry->indices,
        vertex_count
    );
    std::uint64_t version = 1469598103934665603ull;
    for (const float value : packet.geometry->vertices) {
        MixProceduralSceneInventoryWordReference(
            version,
            std::bit_cast<std::uint32_t>(value)
        );
    }
    for (const std::uint32_t index : packet.geometry->indices) {
        MixProceduralSceneInventoryWordReference(version, index);
    }
    MixProceduralSceneInventoryBytesReference(
        version,
        packet.material_bytes
    );
    const std::size_t geometry_bytes =
        packet.geometry->vertices.size() * sizeof(float) +
        packet.geometry->indices.size() * sizeof(std::uint32_t);
    return {
        ProceduralSceneContentKind::stone,
        ProceduralSceneIntegrationGate::ready,
        stride,
        vertex_count,
        packet.geometry->indices.size(),
        packet.material_bytes.size() /
            kStoneHierarchicalMaterialRecordBytes,
        geometry_bytes,
        packet.material_bytes.size(),
        version,
    };
}

inline ProceduralSceneIntegrationEntry
AuditProceduralRoadIntegrationReference(
    const RoadHierarchicalPacket& packet
) {
    constexpr std::size_t stride = 3;
    if (packet.coarse == nullptr || packet.coarse->vertices.empty() ||
        packet.coarse->vertices.size() % stride != 0 ||
        packet.detail_bytes.empty() ||
        packet.detail_bytes.size() %
            kRoadHierarchicalDetailRecordBytes != 0) {
        throw std::invalid_argument(
            "procedural road consumer packet is malformed"
        );
    }
    const std::size_t vertex_count =
        packet.coarse->vertices.size() / stride;
    ValidateProceduralSceneTriangleIndicesReference(
        packet.coarse->indices,
        vertex_count
    );
    std::uint64_t version = 1469598103934665603ull;
    for (const float value : packet.coarse->vertices) {
        MixProceduralSceneInventoryWordReference(
            version,
            std::bit_cast<std::uint32_t>(value)
        );
    }
    for (const std::uint32_t index : packet.coarse->indices) {
        MixProceduralSceneInventoryWordReference(version, index);
    }
    MixProceduralSceneInventoryBytesReference(
        version,
        packet.detail_bytes
    );
    const std::size_t geometry_bytes =
        packet.coarse->vertices.size() * sizeof(float) +
        packet.coarse->indices.size() * sizeof(std::uint32_t);
    return {
        ProceduralSceneContentKind::road,
        ProceduralSceneIntegrationGate::needs_material_binding,
        stride,
        vertex_count,
        packet.coarse->indices.size(),
        packet.detail_bytes.size() /
            kRoadHierarchicalDetailRecordBytes,
        geometry_bytes,
        packet.detail_bytes.size(),
        version,
    };
}

inline ProceduralSceneIntegrationEntry
AuditProceduralForestIntegrationReference(
    const ForestTreeMaterialPipelinePacket& packet
) {
    if (packet.bytes.empty() ||
        packet.bytes.size() % kForestTreeMaterialBundleBytes != 0) {
        throw std::invalid_argument(
            "procedural forest consumer packet is malformed"
        );
    }
    std::uint64_t version = 1469598103934665603ull;
    MixProceduralSceneInventoryBytesReference(version, packet.bytes);
    return {
        ProceduralSceneContentKind::forest,
        ProceduralSceneIntegrationGate::needs_geometry,
        0,
        0,
        0,
        packet.bytes.size() / kForestTreeMaterialBundleBytes,
        0,
        packet.bytes.size(),
        version,
    };
}

inline ProceduralSceneIntegrationReport
AuditProceduralFixedSceneIntegrationReference(
    const StoneHierarchicalMaterialDrawPacket& stone,
    const RoadHierarchicalPacket& road,
    const ForestTreeMaterialPipelinePacket& forest
) {
    const std::array<ProceduralSceneIntegrationEntry, 3> entries{
        AuditProceduralStoneIntegrationReference(stone),
        AuditProceduralRoadIntegrationReference(road),
        AuditProceduralForestIntegrationReference(forest),
    };
    std::size_t ready_entries = 0;
    std::size_t resident_bytes = 0;
    std::uint64_t version = 1469598103934665603ull;
    for (const auto& entry : entries) {
        ready_entries += entry.gate ==
            ProceduralSceneIntegrationGate::ready;
        resident_bytes += entry.geometry_bytes + entry.material_bytes;
        MixProceduralSceneInventoryWordReference(
            version,
            static_cast<std::uint64_t>(entry.kind)
        );
        MixProceduralSceneInventoryWordReference(
            version,
            static_cast<std::uint64_t>(entry.gate)
        );
        MixProceduralSceneInventoryWordReference(
            version,
            entry.version
        );
    }
    return {
        entries,
        ready_entries,
        entries.size() - ready_entries,
        resident_bytes,
        version,
    };
}

}  // namespace vf::material
