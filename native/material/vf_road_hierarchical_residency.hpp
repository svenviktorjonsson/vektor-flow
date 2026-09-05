#pragma once

#include "native/material/vf_deterministic_packet_reference.hpp"
#include "native/material/vf_road_hierarchical_material.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

constexpr std::size_t kRoadHierarchicalDetailRecordBytes =
    2 * sizeof(std::uint64_t) + 11 * sizeof(float);

struct RoadHierarchicalCoarseStrip {
    std::vector<float> vertices;
    std::vector<std::uint32_t> indices;
};

struct RoadHierarchicalPacket {
    std::shared_ptr<const RoadHierarchicalCoarseStrip> coarse;
    std::vector<std::uint8_t> detail_bytes;
};

struct RoadHierarchicalResidencyState {
    std::uint64_t segment_id;
    RoadHierarchicalMaterialRealization material;
    std::shared_ptr<const RoadHierarchicalPacket> packet;
    bool retained;
    std::size_t repacked_samples;
    std::size_t upload_bytes;
    std::size_t resident_bytes;
    std::uint64_t version;
};

inline std::shared_ptr<const RoadHierarchicalCoarseStrip>
CreateRoadHierarchicalCoarseStripReference(std::uint64_t segment_id) {
    const float start = static_cast<float>(segment_id * 4.0);
    const float end = start + 4.0f;
    return std::make_shared<const RoadHierarchicalCoarseStrip>(
        RoadHierarchicalCoarseStrip{
            {
                start, -4.0f, 0.0f,
                end, -4.0f, 0.0f,
                end, 4.0f, 0.0f,
                start, 4.0f, 0.0f,
            },
            {0, 1, 2, 0, 2, 3},
        }
    );
}

inline std::size_t RoadHierarchicalCoarseStripBytes(
    const RoadHierarchicalCoarseStrip& coarse
) {
    return coarse.vertices.size() * sizeof(float) +
        coarse.indices.size() * sizeof(std::uint32_t);
}

inline void ValidateRoadHierarchicalMaterialForPacking(
    const RoadHierarchicalMaterialRealization& material
) {
    std::vector<vkf::material::RoadMaterialSample> samples;
    samples.reserve(material.samples.size());
    for (const auto& sample : material.samples) {
        const auto& value = sample.material;
        if (!std::isfinite(value.aggregate_fraction) ||
            !std::isfinite(value.binder_fraction) ||
            !std::isfinite(value.water_coverage) ||
            value.aggregate_fraction < 0.0f ||
            value.binder_fraction < 0.0f ||
            value.aggregate_fraction + value.binder_fraction > 1.0f ||
            value.water_coverage < 0.0f ||
            value.water_coverage > 1.0f ||
            !std::all_of(
                value.albedo.begin(),
                value.albedo.end(),
                [](float channel) {
                    return std::isfinite(channel) &&
                        channel >= 0.0f && channel <= 1.0f;
                }
            )) {
            throw std::domain_error(
                "road residency received non-passive material"
            );
        }
        samples.push_back(value);
    }
    const auto energy = vkf::material::EvaluateRoadMaterialWhiteFurnace(
        samples,
        samples.size()
    );
    if (!SameRoadHierarchicalMaterialEnergy(energy, material.energy) ||
        material.energy.violations != 0 ||
        material.energy.minimum_energy < 0.0f ||
        material.energy.maximum_energy > 1.0f) {
        throw std::domain_error(
            "road residency failed passive energy validation"
        );
    }
}

inline std::vector<std::uint8_t>
PackRoadHierarchicalDetailBytesReference(
    const RoadHierarchicalMaterialRealization& material
) {
    ValidateRoadHierarchicalMaterialForPacking(material);
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        material.samples.size() *
        kRoadHierarchicalDetailRecordBytes
    );
    for (const auto& sample : material.samples) {
        AppendDeterministicPacketWord64(bytes, sample.segment_id);
        AppendDeterministicPacketWord64(bytes, sample.sample_id);
        for (const double coordinate : sample.road_position) {
            AppendDeterministicPacketFloat32(
                bytes,
                static_cast<float>(coordinate)
            );
        }
        AppendDeterministicPacketFloat32(
            bytes,
            0.003f * sample.aggregate_variation -
                0.006f * sample.crack_intensity
        );
        AppendDeterministicPacketFloat32(bytes, sample.crack_intensity);
        AppendDeterministicPacketFloat32(
            bytes,
            sample.aggregate_variation
        );
        AppendDeterministicPacketFloat32(
            bytes,
            sample.material.aggregate_fraction
        );
        AppendDeterministicPacketFloat32(
            bytes,
            sample.material.binder_fraction
        );
        AppendDeterministicPacketFloat32(
            bytes,
            sample.material.water_coverage
        );
        for (const float albedo : sample.material.albedo) {
            AppendDeterministicPacketFloat32(bytes, albedo);
        }
    }
    return bytes;
}

inline std::uint64_t RoadHierarchicalPacketVersion(
    const RoadHierarchicalPacket& packet
) {
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        RoadHierarchicalCoarseStripBytes(*packet.coarse) +
        packet.detail_bytes.size()
    );
    for (const float vertex : packet.coarse->vertices) {
        AppendDeterministicPacketFloat32(bytes, vertex);
    }
    for (const std::uint32_t index : packet.coarse->indices) {
        AppendDeterministicPacketWord32(bytes, index);
    }
    bytes.insert(
        bytes.end(),
        packet.detail_bytes.begin(),
        packet.detail_bytes.end()
    );
    return HashDeterministicPacketBytes(bytes);
}

inline RoadHierarchicalResidencyState
UpdateRoadHierarchicalResidencyReference(
    const RoadHierarchicalMaterialDefinition& definition,
    std::uint64_t segment_id,
    const std::vector<RoadHierarchicalMaterialDemand>& demands,
    std::size_t sample_budget,
    const RoadHierarchicalResidencyState* previous
) {
    for (const auto& demand : demands) {
        if (demand.segment_id != segment_id) {
            throw std::invalid_argument(
                "road residency mixes segment identities"
            );
        }
    }
    auto material = RealizeRoadHierarchicalMaterialReference(
        definition,
        demands,
        sample_budget
    );
    ValidateRoadHierarchicalMaterialForPacking(material);
    if (previous != nullptr &&
        previous->segment_id == segment_id &&
        material == previous->material) {
        return {
            segment_id,
            std::move(material),
            previous->packet,
            true,
            0,
            0,
            previous->resident_bytes,
            previous->version,
        };
    }
    const bool same_segment = previous != nullptr &&
        previous->segment_id == segment_id;
    auto coarse = same_segment
        ? previous->packet->coarse
        : CreateRoadHierarchicalCoarseStripReference(segment_id);
    auto detail_bytes = PackRoadHierarchicalDetailBytesReference(material);
    auto packet = std::make_shared<const RoadHierarchicalPacket>(
        RoadHierarchicalPacket{
            std::move(coarse),
            std::move(detail_bytes),
        }
    );
    const std::size_t repacked_samples = same_segment
        ? CountDeterministicPacketRecordChanges(
            previous->packet->detail_bytes,
            packet->detail_bytes,
            kRoadHierarchicalDetailRecordBytes
        )
        : material.samples.size();
    const std::size_t coarse_upload = same_segment
        ? 0
        : RoadHierarchicalCoarseStripBytes(*packet->coarse);
    const std::size_t upload_bytes = coarse_upload +
        repacked_samples * kRoadHierarchicalDetailRecordBytes;
    const std::size_t resident_bytes =
        RoadHierarchicalCoarseStripBytes(*packet->coarse) +
        packet->detail_bytes.size();
    const std::uint64_t version =
        RoadHierarchicalPacketVersion(*packet);
    return {
        segment_id,
        std::move(material),
        std::move(packet),
        false,
        repacked_samples,
        upload_bytes,
        resident_bytes,
        version,
    };
}

}  // namespace vf::material
