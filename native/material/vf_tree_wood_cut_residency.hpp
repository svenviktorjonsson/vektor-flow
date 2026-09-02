#pragma once

#include "native/material/vf_deterministic_packet_reference.hpp"
#include "native/material/vf_tree_wood_hierarchical_residency.hpp"

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

constexpr std::size_t kTreeWoodCutRecordBytes =
    3 * sizeof(std::uint64_t) + 14 * sizeof(float);

struct TreeWoodCutDemand {
    std::uint64_t cut_id;
    std::uint64_t tree_id;
    std::uint32_t species_id;
    std::array<double, 2> tree_position;
    std::uint64_t sample_id;
    std::array<double, 3> growth_position;
    std::array<double, 3> normal;
};

struct TreeWoodCutSample {
    std::uint64_t cut_id;
    TreeWoodHierarchicalSample wood;
    std::array<float, 3> normal;
    float axial_alignment;
};

struct TreeWoodCutRealization {
    std::uint64_t potential_trees;
    std::uint64_t potential_samples_per_tree;
    std::vector<TreeWoodCutSample> samples;
    TreeWoodHierarchicalEnergy energy;
};

struct TreeWoodCutPacket {
    std::vector<std::uint8_t> bytes;
};

struct TreeWoodCutResidencyState {
    TreeWoodCutRealization realization;
    std::shared_ptr<const TreeWoodCutPacket> packet;
    bool retained;
    std::size_t repacked_samples;
    std::size_t upload_bytes;
    std::size_t resident_bytes;
    std::uint64_t version;
};

inline bool operator==(
    const TreeWoodCutSample& first,
    const TreeWoodCutSample& second
) {
    return first.cut_id == second.cut_id &&
        first.wood == second.wood &&
        first.normal == second.normal &&
        first.axial_alignment == second.axial_alignment;
}

inline bool operator==(
    const TreeWoodCutRealization& first,
    const TreeWoodCutRealization& second
) {
    return first.potential_trees == second.potential_trees &&
        first.potential_samples_per_tree ==
            second.potential_samples_per_tree &&
        first.samples == second.samples &&
        first.energy == second.energy;
}

inline TreeWoodCutSample SampleTreeWoodCutReference(
    const TreeWoodHierarchicalDefinition& definition,
    const TreeWoodCutDemand& demand
) {
    double length_squared = 0.0;
    for (const double component : demand.normal) {
        if (!std::isfinite(component)) {
            throw std::invalid_argument(
                "wood cut normal is not finite"
            );
        }
        length_squared += component * component;
    }
    if (length_squared <= 1.0e-20) {
        throw std::invalid_argument("wood cut normal is zero");
    }
    const double inverse_length = 1.0 / std::sqrt(length_squared);
    const std::array<float, 3> normal{
        static_cast<float>(demand.normal[0] * inverse_length),
        static_cast<float>(demand.normal[1] * inverse_length),
        static_cast<float>(demand.normal[2] * inverse_length),
    };
    const float axial_alignment = std::abs(normal[2]);
    auto wood = SampleTreeWoodHierarchicalMaterialReference(
        definition,
        {
            demand.tree_id,
            demand.species_id,
            demand.tree_position,
            demand.sample_id,
            demand.growth_position,
        }
    );
    wood.roughness = std::clamp(
        wood.roughness + 0.12f * axial_alignment,
        0.0f,
        1.0f
    );
    return {
        demand.cut_id,
        std::move(wood),
        normal,
        axial_alignment,
    };
}

inline TreeWoodCutRealization RealizeTreeWoodCutReference(
    const TreeWoodHierarchicalDefinition& definition,
    const std::vector<TreeWoodCutDemand>& demands,
    std::size_t sample_budget
) {
    if (definition.species_count == 0 ||
        definition.potential_trees == 0 ||
        definition.potential_samples_per_tree == 0) {
        throw std::invalid_argument(
            "wood cut hierarchy must contain potential content"
        );
    }
    if (demands.size() > sample_budget) {
        throw std::range_error("wood cut demand exceeds sample budget");
    }
    auto ordered = demands;
    std::sort(
        ordered.begin(),
        ordered.end(),
        [](const auto& first, const auto& second) {
            return first.cut_id < second.cut_id;
        }
    );
    for (std::size_t index = 1; index < ordered.size(); ++index) {
        if (ordered[index - 1].cut_id == ordered[index].cut_id) {
            throw std::invalid_argument("wood cut demand is duplicated");
        }
    }
    std::vector<TreeWoodCutSample> samples;
    samples.reserve(ordered.size());
    std::vector<TreeWoodHierarchicalSample> wood_samples;
    wood_samples.reserve(ordered.size());
    for (const auto& demand : ordered) {
        auto sample = SampleTreeWoodCutReference(definition, demand);
        wood_samples.push_back(sample.wood);
        samples.push_back(std::move(sample));
    }
    return {
        definition.potential_trees,
        definition.potential_samples_per_tree,
        std::move(samples),
        EvaluateTreeWoodEnergyReference(wood_samples),
    };
}

inline void ValidateTreeWoodCutForPacking(
    const TreeWoodCutRealization& realization
) {
    std::vector<TreeWoodHierarchicalSample> wood_samples;
    wood_samples.reserve(realization.samples.size());
    for (const auto& sample : realization.samples) {
        float length_squared = 0.0f;
        for (const float component : sample.normal) {
            if (!std::isfinite(component)) {
                throw std::domain_error(
                    "wood cut packet contains invalid normal"
                );
            }
            length_squared += component * component;
        }
        if (std::abs(length_squared - 1.0f) > 1.0e-5f ||
            !std::isfinite(sample.axial_alignment) ||
            sample.axial_alignment < 0.0f ||
            sample.axial_alignment > 1.0f) {
            throw std::domain_error(
                "wood cut packet contains invalid orientation"
            );
        }
        wood_samples.push_back(sample.wood);
    }
    const auto energy = EvaluateTreeWoodEnergyReference(wood_samples);
    const TreeWoodHierarchicalMaterialRealization material{
        realization.potential_trees,
        realization.potential_samples_per_tree,
        std::move(wood_samples),
        realization.energy,
    };
    ValidateTreeWoodMaterialForPacking(material);
    if (!(energy == realization.energy)) {
        throw std::domain_error(
            "wood cut packet failed energy validation"
        );
    }
}

inline std::vector<std::uint8_t> PackTreeWoodCutBytesReference(
    const TreeWoodCutRealization& realization
) {
    ValidateTreeWoodCutForPacking(realization);
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        realization.samples.size() * kTreeWoodCutRecordBytes
    );
    for (const auto& sample : realization.samples) {
        AppendDeterministicPacketWord64(bytes, sample.cut_id);
        AppendDeterministicPacketWord64(bytes, sample.wood.tree_id);
        AppendDeterministicPacketWord64(bytes, sample.wood.sample_id);
        for (const double value : sample.wood.growth_position) {
            AppendDeterministicPacketFloat32(
                bytes,
                static_cast<float>(value)
            );
        }
        for (const float value : sample.normal) {
            AppendDeterministicPacketFloat32(bytes, value);
        }
        AppendDeterministicPacketFloat32(
            bytes,
            sample.axial_alignment
        );
        AppendDeterministicPacketFloat32(bytes, sample.wood.ring);
        AppendDeterministicPacketFloat32(bytes, sample.wood.fiber);
        for (const float value : sample.wood.base_color) {
            AppendDeterministicPacketFloat32(bytes, value);
        }
        AppendDeterministicPacketFloat32(
            bytes,
            sample.wood.roughness
        );
        AppendDeterministicPacketFloat32(
            bytes,
            sample.wood.reflectivity
        );
    }
    return bytes;
}

inline TreeWoodCutResidencyState UpdateTreeWoodCutResidencyReference(
    const TreeWoodHierarchicalDefinition& definition,
    const std::vector<TreeWoodCutDemand>& demands,
    std::size_t sample_budget,
    const TreeWoodCutResidencyState* previous
) {
    auto realization = RealizeTreeWoodCutReference(
        definition,
        demands,
        sample_budget
    );
    if (previous != nullptr &&
        realization == previous->realization) {
        return {
            std::move(realization),
            previous->packet,
            true,
            0,
            0,
            previous->resident_bytes,
            previous->version,
        };
    }
    auto bytes = PackTreeWoodCutBytesReference(realization);
    const std::size_t repacked_samples = previous == nullptr
        ? realization.samples.size()
        : CountDeterministicPacketRecordChanges(
            previous->packet->bytes,
            bytes,
            kTreeWoodCutRecordBytes
        );
    auto packet = std::make_shared<const TreeWoodCutPacket>(
        TreeWoodCutPacket{std::move(bytes)}
    );
    const std::size_t resident_bytes = packet->bytes.size();
    const std::uint64_t version =
        HashDeterministicPacketBytes(packet->bytes);
    return {
        std::move(realization),
        std::move(packet),
        false,
        repacked_samples,
        repacked_samples * kTreeWoodCutRecordBytes,
        resident_bytes,
        version,
    };
}

}  // namespace vf::material
