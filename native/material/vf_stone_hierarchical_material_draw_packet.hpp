#pragma once

#include "native/material/vf_stone_hierarchical_material.hpp"
#include "native/material/vf_stone_projected_draw_packet.hpp"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

constexpr std::size_t kStoneHierarchicalMaterialRecordBytes =
    1 + sizeof(std::uint32_t) + 12 * sizeof(float);

struct StoneHierarchicalMaterialDrawPacket {
    std::shared_ptr<const StoneProjectedDrawPacket> geometry;
    std::vector<std::uint8_t> material_bytes;
};

struct StoneHierarchicalMaterialDrawState {
    StoneProjectedDrawState geometry;
    StoneHierarchicalMaterialRealization material;
    std::shared_ptr<const StoneHierarchicalMaterialDrawPacket> packet;
    bool retained;
    std::size_t repacked_samples;
    std::size_t upload_bytes;
};

inline void AppendStoneMaterialWord(
    std::vector<std::uint8_t>& bytes,
    std::uint32_t word
) {
    for (std::size_t offset = 0; offset < sizeof(word); ++offset) {
        bytes.push_back(static_cast<std::uint8_t>(
            (word >> (offset * 8)) & 0xffu
        ));
    }
}

inline void AppendStoneMaterialFloat(
    std::vector<std::uint8_t>& bytes,
    float value
) {
    static_assert(sizeof(float) == sizeof(std::uint32_t));
    AppendStoneMaterialWord(bytes, std::bit_cast<std::uint32_t>(value));
}

inline bool IsPassiveStoneMaterialSample(
    const StoneHierarchicalMaterialSample& sample
) {
    for (const float wavelength : sample.wavelengths_nm) {
        if (!std::isfinite(wavelength) || !(wavelength > 0.0f)) {
            return false;
        }
    }
    for (const auto* channels : {
             &sample.spectral_reflectance,
             &sample.base_color,
         }) {
        for (const float value : *channels) {
            if (!std::isfinite(value) || value < 0.0f || value > 1.0f) {
                return false;
            }
        }
    }
    return std::isfinite(sample.roughness) &&
        sample.roughness >= 0.0f && sample.roughness <= 1.0f &&
        std::isfinite(sample.reflectivity) &&
        sample.reflectivity >= 0.0f && sample.reflectivity <= 1.0f &&
        std::isfinite(sample.local_variation) &&
        sample.local_variation >= -1.0f &&
        sample.local_variation <= 1.0f;
}

inline void ValidateStoneHierarchicalMaterialForPacking(
    const StoneHierarchicalMaterialRealization& material
) {
    if (material.samples.size() > material.potential_elements) {
        throw std::domain_error(
            "stone material packet exceeds potential geometry"
        );
    }
    for (const auto& sample : material.samples) {
        if (!IsPassiveStoneMaterialSample(sample)) {
            throw std::domain_error(
                "stone material packet contains non-passive properties"
            );
        }
    }
    const auto evaluated =
        EvaluateStoneHierarchicalMaterialEnergyReference(
            material.samples
        );
    if (!(evaluated == material.energy) ||
        material.energy.violations != 0 ||
        material.energy.minimum < 0.0f ||
        material.energy.maximum > 1.0f) {
        throw std::domain_error(
            "stone material packet failed passive energy validation"
        );
    }
}

inline void AppendStoneHierarchicalMaterialRecord(
    std::vector<std::uint8_t>& bytes,
    const StoneHierarchicalMaterialSample& sample
) {
    bytes.push_back(static_cast<std::uint8_t>(sample.kind));
    AppendStoneMaterialWord(bytes, sample.element);
    for (const float value : sample.wavelengths_nm) {
        AppendStoneMaterialFloat(bytes, value);
    }
    for (const float value : sample.spectral_reflectance) {
        AppendStoneMaterialFloat(bytes, value);
    }
    for (const float value : sample.base_color) {
        AppendStoneMaterialFloat(bytes, value);
    }
    AppendStoneMaterialFloat(bytes, sample.roughness);
    AppendStoneMaterialFloat(bytes, sample.reflectivity);
    AppendStoneMaterialFloat(bytes, sample.local_variation);
}

inline std::shared_ptr<const StoneHierarchicalMaterialDrawPacket>
PackStoneHierarchicalMaterialDrawPacketReference(
    const std::shared_ptr<const StoneProjectedDrawPacket>& geometry,
    const StoneHierarchicalMaterialRealization& material
) {
    if (geometry == nullptr) {
        throw std::invalid_argument(
            "stone material draw geometry is required"
        );
    }
    ValidateStoneHierarchicalMaterialForPacking(material);
    std::vector<std::uint8_t> material_bytes;
    material_bytes.reserve(
        material.samples.size() *
        kStoneHierarchicalMaterialRecordBytes
    );
    for (const auto& sample : material.samples) {
        AppendStoneHierarchicalMaterialRecord(material_bytes, sample);
    }
    return std::make_shared<const StoneHierarchicalMaterialDrawPacket>(
        StoneHierarchicalMaterialDrawPacket{
            geometry,
            std::move(material_bytes),
        }
    );
}

inline std::size_t CountStoneMaterialRecordChanges(
    const std::vector<std::uint8_t>& previous,
    const std::vector<std::uint8_t>& current
) {
    const std::size_t previous_records =
        previous.size() / kStoneHierarchicalMaterialRecordBytes;
    const std::size_t current_records =
        current.size() / kStoneHierarchicalMaterialRecordBytes;
    const std::size_t shared_records =
        std::min(previous_records, current_records);
    std::size_t changed = current_records - shared_records;
    for (std::size_t record = 0; record < shared_records; ++record) {
        const auto previous_begin = previous.begin() +
            record * kStoneHierarchicalMaterialRecordBytes;
        const auto current_begin = current.begin() +
            record * kStoneHierarchicalMaterialRecordBytes;
        if (!std::equal(
                previous_begin,
                previous_begin +
                    kStoneHierarchicalMaterialRecordBytes,
                current_begin
            )) {
            ++changed;
        }
    }
    return changed;
}

inline StoneHierarchicalMaterialDrawState
UpdateStoneHierarchicalMaterialDrawReference(
    const StonePopulationMember& member,
    const StoneProjectedRefinementState& refinement,
    const std::vector<StoneMaterialDemand>& demands,
    std::size_t sample_budget,
    const StoneHierarchicalMaterialDrawState* previous
) {
    auto geometry = AdaptStoneProjectedDrawPacketReference(
        refinement,
        previous == nullptr ? nullptr : &previous->geometry
    );
    auto material = RealizeStoneHierarchicalMaterialReference(
        member,
        *refinement.geometry,
        demands,
        sample_budget
    );
    if (previous != nullptr &&
        previous->packet != nullptr &&
        geometry.retained &&
        material == previous->material) {
        return {
            std::move(geometry),
            std::move(material),
            previous->packet,
            true,
            0,
            0,
        };
    }
    auto packet = PackStoneHierarchicalMaterialDrawPacketReference(
        geometry.packet,
        material
    );
    const std::size_t repacked_samples = previous == nullptr ||
        previous->packet == nullptr
        ? material.samples.size()
        : CountStoneMaterialRecordChanges(
            previous->packet->material_bytes,
            packet->material_bytes
        );
    const std::size_t upload_bytes = geometry.upload_bytes +
        repacked_samples * kStoneHierarchicalMaterialRecordBytes;
    return {
        std::move(geometry),
        std::move(material),
        std::move(packet),
        false,
        repacked_samples,
        upload_bytes,
    };
}

}  // namespace vf::material
