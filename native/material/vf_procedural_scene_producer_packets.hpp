#pragma once

#include "native/material/vf_forest_tree_material_pipeline.hpp"
#include "native/material/vf_road_hierarchical_residency.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

constexpr std::size_t kRoadMaterialSurfaceBindingBytes =
    2 * sizeof(std::uint64_t) + sizeof(std::uint32_t) +
    3 * sizeof(float);

struct RoadMaterialSurfacePacket {
    std::shared_ptr<const RoadHierarchicalPacket> source;
    std::vector<std::uint8_t> binding_bytes;
    std::uint64_t version;
};

struct ForestTreeDrawPacket {
    std::shared_ptr<const ForestTreeMaterialPipelinePacket> material;
    std::vector<float> vertices;
    std::vector<std::uint32_t> indices;
    std::vector<std::uint32_t> material_offsets;
    std::uint64_t version;
};

inline bool operator==(
    const RoadMaterialSurfacePacket& first,
    const RoadMaterialSurfacePacket& second
) {
    return first.source != nullptr && second.source != nullptr &&
        RoadHierarchicalPacketVersion(*first.source) ==
            RoadHierarchicalPacketVersion(*second.source) &&
        first.binding_bytes == second.binding_bytes &&
        first.version == second.version;
}

inline bool operator==(
    const ForestTreeDrawPacket& first,
    const ForestTreeDrawPacket& second
) {
    return first.material != nullptr && second.material != nullptr &&
        first.material->bytes == second.material->bytes &&
        first.vertices == second.vertices &&
        first.indices == second.indices &&
        first.material_offsets == second.material_offsets &&
        first.version == second.version;
}

inline RoadMaterialSurfacePacket
BindRoadMaterialSurfaceReference(
    const RoadHierarchicalResidencyState& state
) {
    if (state.packet == nullptr || state.packet->coarse == nullptr ||
        state.material.samples.empty() ||
        state.material.samples.size() >
            std::numeric_limits<std::size_t>::max() /
                kRoadMaterialSurfaceBindingBytes) {
        throw std::invalid_argument(
            "road surface binding requires resident material"
        );
    }
    const auto expected =
        PackRoadHierarchicalDetailBytesReference(state.material);
    const auto expected_coarse =
        CreateRoadHierarchicalCoarseStripReference(state.segment_id);
    if (expected != state.packet->detail_bytes ||
        expected_coarse->vertices != state.packet->coarse->vertices ||
        expected_coarse->indices != state.packet->coarse->indices) {
        throw std::invalid_argument(
            "road surface material bytes do not match samples"
        );
    }
    const double start = static_cast<double>(state.segment_id) * 4.0;
    const double finish = start + 4.0;
    std::vector<std::uint8_t> bindings;
    bindings.reserve(
        state.material.samples.size() *
        kRoadMaterialSurfaceBindingBytes
    );
    for (const auto& sample : state.material.samples) {
        const double x = sample.road_position[0];
        const double y = sample.road_position[1];
        if (sample.segment_id != state.segment_id ||
            !std::isfinite(x) || !std::isfinite(y) ||
            x < start || x > finish || y < -4.0 || y > 4.0) {
            throw std::invalid_argument(
                "road material sample is outside its coarse surface"
            );
        }
        const float u = static_cast<float>((x - start) / 4.0);
        const float v = static_cast<float>((y + 4.0) / 8.0);
        const bool lower_triangle = v <= u;
        const std::uint32_t triangle = lower_triangle ? 0u : 1u;
        const std::array<float, 3> barycentric = lower_triangle
            ? std::array<float, 3>{1.0f - u, u - v, v}
            : std::array<float, 3>{1.0f - v, u, v - u};
        AppendDeterministicPacketWord64(
            bindings,
            sample.segment_id
        );
        AppendDeterministicPacketWord64(
            bindings,
            sample.sample_id
        );
        AppendDeterministicPacketWord32(bindings, triangle);
        for (const float weight : barycentric) {
            AppendDeterministicPacketFloat32(bindings, weight);
        }
    }
    std::vector<std::uint8_t> version_bytes;
    version_bytes.reserve(sizeof(std::uint64_t) + bindings.size());
    AppendDeterministicPacketWord64(
        version_bytes,
        RoadHierarchicalPacketVersion(*state.packet)
    );
    version_bytes.insert(
        version_bytes.end(),
        bindings.begin(),
        bindings.end()
    );
    return {
        state.packet,
        std::move(bindings),
        HashDeterministicPacketBytes(version_bytes),
    };
}

inline void AppendForestTreeDrawVertexReference(
    ForestTreeDrawPacket& packet,
    const ForestTreeMaterialBundle& bundle,
    const std::array<float, 3>& local_position,
    const std::array<float, 3>& local_normal,
    const std::array<float, 3>& color,
    std::uint32_t material_offset
) {
    const float cosine = std::cos(bundle.population.orientation);
    const float sine = std::sin(bundle.population.orientation);
    const float world_x = static_cast<float>(
        bundle.population.position[0]
    ) + cosine * local_position[0] - sine * local_position[1];
    const float world_y = static_cast<float>(
        bundle.population.position[1]
    ) + sine * local_position[0] + cosine * local_position[1];
    const float normal_x =
        cosine * local_normal[0] - sine * local_normal[1];
    const float normal_y =
        sine * local_normal[0] + cosine * local_normal[1];
    const std::array<float, 10> vertex{
        world_x,
        world_y,
        local_position[2],
        normal_x,
        normal_y,
        local_normal[2],
        color[0],
        color[1],
        color[2],
        1.0f,
    };
    packet.vertices.insert(
        packet.vertices.end(),
        vertex.begin(),
        vertex.end()
    );
    packet.material_offsets.push_back(material_offset);
}

inline void AppendForestTreeDrawGeometryReference(
    ForestTreeDrawPacket& packet,
    const ForestTreeMaterialBundle& bundle,
    std::size_t bundle_index
) {
    constexpr float diagonal = 0.7071067811865475f;
    const float height = 2.0f + 8.0f * bundle.population.size;
    const float trunk_radius =
        0.08f + 0.12f * bundle.population.size;
    const float trunk_height = 0.55f * height;
    const float canopy_radius =
        0.6f + 1.8f * bundle.population.size;
    const float canopy_center = 0.78f * height;
    const float canopy_vertical = 0.28f * height;
    const std::size_t bundle_offset =
        bundle_index * kForestTreeMaterialBundleBytes;
    const std::size_t bark_offset = bundle_offset +
        kForestPopulationRecordBytes +
        kTreeWoodHierarchicalRecordBytes;
    const std::size_t foliage_offset =
        bark_offset + kTreeCanopyHierarchicalRecordBytes;
    if (foliage_offset >
        std::numeric_limits<std::uint32_t>::max()) {
        throw std::range_error(
            "forest draw material offset exceeds consumer range"
        );
    }
    const auto bark = static_cast<std::uint32_t>(bark_offset);
    const auto foliage =
        static_cast<std::uint32_t>(foliage_offset);
    const std::uint32_t base = static_cast<std::uint32_t>(
        packet.vertices.size() / 10
    );
    const std::array<std::array<float, 3>, 8> trunk_positions{
        std::array<float, 3>{-trunk_radius, -trunk_radius, 0.0f},
        std::array<float, 3>{trunk_radius, -trunk_radius, 0.0f},
        std::array<float, 3>{trunk_radius, trunk_radius, 0.0f},
        std::array<float, 3>{-trunk_radius, trunk_radius, 0.0f},
        std::array<float, 3>{
            -trunk_radius, -trunk_radius, trunk_height,
        },
        std::array<float, 3>{
            trunk_radius, -trunk_radius, trunk_height,
        },
        std::array<float, 3>{
            trunk_radius, trunk_radius, trunk_height,
        },
        std::array<float, 3>{
            -trunk_radius, trunk_radius, trunk_height,
        },
    };
    const std::array<std::array<float, 3>, 4> trunk_normals{
        std::array<float, 3>{-diagonal, -diagonal, 0.0f},
        std::array<float, 3>{diagonal, -diagonal, 0.0f},
        std::array<float, 3>{diagonal, diagonal, 0.0f},
        std::array<float, 3>{-diagonal, diagonal, 0.0f},
    };
    for (std::size_t vertex = 0; vertex < 8; ++vertex) {
        AppendForestTreeDrawVertexReference(
            packet,
            bundle,
            trunk_positions[vertex],
            trunk_normals[vertex % 4],
            bundle.bark.base_color,
            bark
        );
    }
    const std::array<std::array<float, 3>, 6> canopy_positions{
        std::array<float, 3>{
            -canopy_radius, 0.0f, canopy_center,
        },
        std::array<float, 3>{
            canopy_radius, 0.0f, canopy_center,
        },
        std::array<float, 3>{
            0.0f, -canopy_radius, canopy_center,
        },
        std::array<float, 3>{
            0.0f, canopy_radius, canopy_center,
        },
        std::array<float, 3>{
            0.0f, 0.0f, canopy_center - canopy_vertical,
        },
        std::array<float, 3>{
            0.0f, 0.0f, canopy_center + canopy_vertical,
        },
    };
    const std::array<std::array<float, 3>, 6> canopy_normals{
        std::array<float, 3>{-1.0f, 0.0f, 0.0f},
        std::array<float, 3>{1.0f, 0.0f, 0.0f},
        std::array<float, 3>{0.0f, -1.0f, 0.0f},
        std::array<float, 3>{0.0f, 1.0f, 0.0f},
        std::array<float, 3>{0.0f, 0.0f, -1.0f},
        std::array<float, 3>{0.0f, 0.0f, 1.0f},
    };
    for (std::size_t vertex = 0; vertex < 6; ++vertex) {
        AppendForestTreeDrawVertexReference(
            packet,
            bundle,
            canopy_positions[vertex],
            canopy_normals[vertex],
            bundle.foliage.base_color,
            foliage
        );
    }
    constexpr std::array<std::uint32_t, 60> local_indices{
        0, 2, 1, 0, 3, 2,
        4, 5, 6, 4, 6, 7,
        0, 1, 5, 0, 5, 4,
        1, 2, 6, 1, 6, 5,
        2, 3, 7, 2, 7, 6,
        3, 0, 4, 3, 4, 7,
        13, 9, 11, 13, 11, 8,
        13, 8, 10, 13, 10, 9,
        12, 11, 9, 12, 8, 11,
        12, 10, 8, 12, 9, 10,
    };
    for (const std::uint32_t index : local_indices) {
        packet.indices.push_back(base + index);
    }
}

inline std::size_t ForestTreeDrawGeometryBytesReference(
    const ForestTreeDrawPacket& packet
) {
    return packet.vertices.size() * sizeof(float) +
        packet.indices.size() * sizeof(std::uint32_t) +
        packet.material_offsets.size() * sizeof(std::uint32_t);
}

inline ForestTreeDrawPacket
CreateForestTreeDrawPacketReference(
    const ForestTreeMaterialPipelineState& state
) {
    if (state.packet == nullptr || state.realization.bundles.empty()) {
        throw std::invalid_argument(
            "forest draw requires resident material bundles"
        );
    }
    if (state.realization.bundles.size() >
            std::numeric_limits<std::uint32_t>::max() / 14 ||
        state.realization.bundles.size() >
            std::numeric_limits<std::size_t>::max() / (14 * 10)) {
        throw std::range_error(
            "forest draw demand exceeds bounded geometry"
        );
    }
    const auto expected =
        PackForestTreeMaterialPipelineBytesDirectReference(
            state.realization
        );
    if (expected != state.packet->bytes) {
        throw std::invalid_argument(
            "forest draw material bytes do not match bundles"
        );
    }
    ForestTreeDrawPacket packet{
        state.packet,
        {},
        {},
        {},
        0,
    };
    packet.vertices.reserve(
        state.realization.bundles.size() * 14 * 10
    );
    packet.indices.reserve(
        state.realization.bundles.size() * 60
    );
    packet.material_offsets.reserve(
        state.realization.bundles.size() * 14
    );
    for (std::size_t bundle = 0;
         bundle < state.realization.bundles.size();
         ++bundle) {
        AppendForestTreeDrawGeometryReference(
            packet,
            state.realization.bundles[bundle],
            bundle
        );
    }
    std::vector<std::uint8_t> version_bytes;
    version_bytes.reserve(
        packet.material->bytes.size() +
        ForestTreeDrawGeometryBytesReference(packet)
    );
    version_bytes.insert(
        version_bytes.end(),
        packet.material->bytes.begin(),
        packet.material->bytes.end()
    );
    for (const float value : packet.vertices) {
        AppendDeterministicPacketFloat32(version_bytes, value);
    }
    for (const std::uint32_t index : packet.indices) {
        AppendDeterministicPacketWord32(version_bytes, index);
    }
    for (const std::uint32_t offset : packet.material_offsets) {
        AppendDeterministicPacketWord32(version_bytes, offset);
    }
    packet.version = HashDeterministicPacketBytes(version_bytes);
    return packet;
}

}  // namespace vf::material
