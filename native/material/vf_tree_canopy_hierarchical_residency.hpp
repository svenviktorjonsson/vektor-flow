#pragma once

#include "native/material/vf_deterministic_packet_reference.hpp"
#include "native/material/vf_tree_wood_hierarchical_residency.hpp"

#include <algorithm>
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

constexpr std::size_t kTreeCanopyHierarchicalRecordBytes =
    3 * sizeof(std::uint64_t) + sizeof(std::uint32_t) +
    13 * sizeof(float);

enum class TreeCanopyPrimitiveKind : std::uint32_t {
    bark = 0,
    foliage = 1,
};

struct TreeCanopyHierarchicalDefinition {
    TreeWoodHierarchicalDefinition hierarchy;
    std::uint64_t potential_primitives_per_tree;
};

struct TreeCanopyHierarchicalDemand {
    std::uint64_t primitive_id;
    std::uint64_t tree_id;
    std::uint32_t species_id;
    std::array<double, 2> tree_position;
    std::uint64_t parent_id;
    TreeCanopyPrimitiveKind kind;
    std::array<double, 3> developmental_position;
    std::array<double, 3> axis;
};

struct TreeCanopyHierarchicalSample {
    std::uint64_t primitive_id;
    std::uint64_t tree_id;
    std::uint64_t parent_id;
    TreeCanopyPrimitiveKind kind;
    std::array<double, 3> developmental_position;
    std::array<float, 3> axis;
    double population_variation;
    double species_variation;
    double individual_variation;
    float primitive_variation;
    float radius;
    float extent;
    std::array<float, 3> base_color;
    float roughness;
    float reflectivity;
};

struct TreeCanopyHierarchicalRealization {
    std::uint64_t potential_trees;
    std::uint64_t potential_primitives_per_tree;
    std::vector<TreeCanopyHierarchicalSample> samples;
    TreeWoodHierarchicalEnergy energy;
};

struct TreeCanopyHierarchicalPacket {
    std::vector<std::uint8_t> bytes;
};

struct TreeCanopyHierarchicalResidencyState {
    TreeCanopyHierarchicalRealization realization;
    std::shared_ptr<const TreeCanopyHierarchicalPacket> packet;
    bool retained;
    std::size_t repacked_primitives;
    std::size_t upload_bytes;
    std::size_t resident_bytes;
    std::uint64_t version;
};

inline bool operator==(
    const TreeCanopyHierarchicalSample& first,
    const TreeCanopyHierarchicalSample& second
) {
    return first.primitive_id == second.primitive_id &&
        first.tree_id == second.tree_id &&
        first.parent_id == second.parent_id &&
        first.kind == second.kind &&
        first.developmental_position ==
            second.developmental_position &&
        first.axis == second.axis &&
        first.population_variation ==
            second.population_variation &&
        first.species_variation == second.species_variation &&
        first.individual_variation ==
            second.individual_variation &&
        first.primitive_variation ==
            second.primitive_variation &&
        first.radius == second.radius &&
        first.extent == second.extent &&
        first.base_color == second.base_color &&
        first.roughness == second.roughness &&
        first.reflectivity == second.reflectivity;
}

inline bool operator==(
    const TreeCanopyHierarchicalRealization& first,
    const TreeCanopyHierarchicalRealization& second
) {
    return first.potential_trees == second.potential_trees &&
        first.potential_primitives_per_tree ==
            second.potential_primitives_per_tree &&
        first.samples == second.samples &&
        first.energy == second.energy;
}

inline TreeWoodHierarchicalEnergy EvaluateTreeCanopyEnergyReference(
    const std::vector<TreeCanopyHierarchicalSample>& samples
) {
    TreeWoodHierarchicalEnergy energy;
    energy.minimum = samples.empty()
        ? 0.0f
        : std::numeric_limits<float>::infinity();
    energy.maximum = samples.empty()
        ? 0.0f
        : -std::numeric_limits<float>::infinity();
    energy.violations = 0;
    energy.values.reserve(
        samples.size() * energy.cosine_probes.size() * 3
    );
    for (const auto& sample : samples) {
        for (const float cosine : energy.cosine_probes) {
            const float complement = 1.0f - cosine;
            const float square = complement * complement;
            const float fresnel = sample.reflectivity +
                (1.0f - sample.reflectivity) *
                square * square * complement;
            for (const float channel : sample.base_color) {
                const float value = fresnel +
                    (1.0f - fresnel) * channel;
                energy.values.push_back(value);
                energy.minimum = std::min(energy.minimum, value);
                energy.maximum = std::max(energy.maximum, value);
                if (value < -1.0e-7f || value > 1.0f + 1.0e-7f) {
                    ++energy.violations;
                }
            }
        }
    }
    return energy;
}

inline TreeCanopyHierarchicalSample
SampleTreeCanopyHierarchicalReference(
    const TreeCanopyHierarchicalDefinition& definition,
    const TreeCanopyHierarchicalDemand& demand
) {
    if (demand.primitive_id >=
        definition.potential_primitives_per_tree) {
        throw std::out_of_range(
            "tree canopy primitive is outside potential hierarchy"
        );
    }
    double axis_length_squared = 0.0;
    for (const double component : demand.axis) {
        if (!std::isfinite(component)) {
            throw std::invalid_argument(
                "tree canopy axis is not finite"
            );
        }
        axis_length_squared += component * component;
    }
    if (axis_length_squared <= 1.0e-20) {
        throw std::invalid_argument("tree canopy axis is zero");
    }
    const double inverse_length =
        1.0 / std::sqrt(axis_length_squared);
    const std::array<float, 3> axis{
        static_cast<float>(demand.axis[0] * inverse_length),
        static_cast<float>(demand.axis[1] * inverse_length),
        static_cast<float>(demand.axis[2] * inverse_length),
    };
    const auto wood = SampleTreeWoodHierarchicalMaterialReference(
        definition.hierarchy,
        {
            demand.tree_id,
            demand.species_id,
            demand.tree_position,
            demand.primitive_id,
            demand.developmental_position,
        }
    );
    const auto channel = [](double value) {
        return static_cast<float>(std::clamp(value, 0.0, 1.0));
    };
    std::array<float, 3> base_color;
    float roughness;
    float reflectivity;
    float radius;
    float extent;
    if (demand.kind == TreeCanopyPrimitiveKind::bark) {
        base_color = {
            channel(0.30 + 0.06 * wood.species_variation +
                    0.03 * wood.surface_variation),
            channel(0.17 + 0.03 * wood.species_variation +
                    0.02 * wood.surface_variation),
            channel(0.075 + 0.015 * wood.species_variation +
                    0.010 * wood.surface_variation),
        };
        roughness = channel(
            0.72 + 0.08 * wood.surface_variation
        );
        reflectivity = vkf::material::DielectricF0(1.53f);
        radius = channel(
            0.20 + 0.04 * wood.species_variation +
            0.02 * wood.individual_variation
        );
        extent = channel(
            0.72 + 0.10 * wood.individual_variation
        );
    } else if (demand.kind ==
               TreeCanopyPrimitiveKind::foliage) {
        base_color = {
            channel(0.10 + 0.025 * wood.species_variation +
                    0.018 * wood.surface_variation),
            channel(0.38 + 0.070 * wood.species_variation +
                    0.035 * wood.surface_variation),
            channel(0.075 + 0.020 * wood.species_variation +
                    0.012 * wood.surface_variation),
        };
        roughness = channel(
            0.49 + 0.07 * wood.surface_variation
        );
        reflectivity = vkf::material::DielectricF0(1.45f);
        radius = channel(
            0.025 + 0.004 * wood.individual_variation
        );
        extent = channel(
            0.42 + 0.06 * wood.species_variation +
            0.04 * wood.individual_variation
        );
    } else {
        throw std::invalid_argument(
            "tree canopy primitive kind is invalid"
        );
    }
    return {
        demand.primitive_id,
        demand.tree_id,
        demand.parent_id,
        demand.kind,
        demand.developmental_position,
        axis,
        wood.population_variation,
        wood.species_variation,
        wood.individual_variation,
        wood.surface_variation,
        radius,
        extent,
        base_color,
        roughness,
        reflectivity,
    };
}

inline TreeCanopyHierarchicalRealization
RealizeTreeCanopyHierarchicalReference(
    const TreeCanopyHierarchicalDefinition& definition,
    const std::vector<TreeCanopyHierarchicalDemand>& demands,
    std::size_t primitive_budget
) {
    if (definition.potential_primitives_per_tree == 0) {
        throw std::invalid_argument(
            "tree canopy hierarchy has no potential primitives"
        );
    }
    if (demands.size() > primitive_budget) {
        throw std::range_error(
            "tree canopy demand exceeds primitive budget"
        );
    }
    auto ordered = demands;
    std::sort(
        ordered.begin(),
        ordered.end(),
        [](const auto& first, const auto& second) {
            return first.primitive_id < second.primitive_id;
        }
    );
    for (std::size_t index = 1; index < ordered.size(); ++index) {
        if (ordered[index - 1].primitive_id ==
            ordered[index].primitive_id) {
            throw std::invalid_argument(
                "tree canopy demand is duplicated"
            );
        }
    }
    std::vector<TreeCanopyHierarchicalSample> samples;
    samples.reserve(ordered.size());
    for (const auto& demand : ordered) {
        samples.push_back(
            SampleTreeCanopyHierarchicalReference(
                definition,
                demand
            )
        );
    }
    auto energy = EvaluateTreeCanopyEnergyReference(samples);
    return {
        definition.hierarchy.potential_trees,
        definition.potential_primitives_per_tree,
        std::move(samples),
        std::move(energy),
    };
}

inline void ValidateTreeCanopyForPacking(
    const TreeCanopyHierarchicalRealization& realization
) {
    for (const auto& sample : realization.samples) {
        const bool passive_color = std::all_of(
            sample.base_color.begin(),
            sample.base_color.end(),
            [](float value) {
                return std::isfinite(value) &&
                    value >= 0.0f && value <= 1.0f;
            }
        );
        if (!passive_color || !std::isfinite(sample.roughness) ||
            sample.roughness < 0.0f || sample.roughness > 1.0f ||
            !std::isfinite(sample.reflectivity) ||
            sample.reflectivity < 0.0f ||
            sample.reflectivity > 1.0f ||
            !std::isfinite(sample.radius) || sample.radius <= 0.0f ||
            !std::isfinite(sample.extent) || sample.extent <= 0.0f) {
            throw std::domain_error(
                "tree canopy packet contains invalid material"
            );
        }
    }
    const auto energy =
        EvaluateTreeCanopyEnergyReference(realization.samples);
    if (!(energy == realization.energy) ||
        realization.energy.violations != 0 ||
        realization.energy.minimum < 0.0f ||
        realization.energy.maximum > 1.0f) {
        throw std::domain_error(
            "tree canopy packet failed passive energy validation"
        );
    }
}

inline std::vector<std::uint8_t>
PackTreeCanopyHierarchicalBytesReference(
    const TreeCanopyHierarchicalRealization& realization
) {
    ValidateTreeCanopyForPacking(realization);
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        realization.samples.size() *
        kTreeCanopyHierarchicalRecordBytes
    );
    for (const auto& sample : realization.samples) {
        AppendDeterministicPacketWord64(bytes, sample.primitive_id);
        AppendDeterministicPacketWord64(bytes, sample.tree_id);
        AppendDeterministicPacketWord64(bytes, sample.parent_id);
        AppendDeterministicPacketWord32(
            bytes,
            static_cast<std::uint32_t>(sample.kind)
        );
        for (const double value : sample.developmental_position) {
            AppendDeterministicPacketFloat32(
                bytes,
                static_cast<float>(value)
            );
        }
        for (const float value : sample.axis) {
            AppendDeterministicPacketFloat32(bytes, value);
        }
        AppendDeterministicPacketFloat32(bytes, sample.radius);
        AppendDeterministicPacketFloat32(bytes, sample.extent);
        for (const float value : sample.base_color) {
            AppendDeterministicPacketFloat32(bytes, value);
        }
        AppendDeterministicPacketFloat32(bytes, sample.roughness);
        AppendDeterministicPacketFloat32(
            bytes,
            sample.reflectivity
        );
    }
    return bytes;
}

inline TreeCanopyHierarchicalResidencyState
UpdateTreeCanopyHierarchicalResidencyReference(
    const TreeCanopyHierarchicalDefinition& definition,
    const std::vector<TreeCanopyHierarchicalDemand>& demands,
    std::size_t primitive_budget,
    const TreeCanopyHierarchicalResidencyState* previous
) {
    auto realization = RealizeTreeCanopyHierarchicalReference(
        definition,
        demands,
        primitive_budget
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
    auto bytes = PackTreeCanopyHierarchicalBytesReference(realization);
    const std::size_t repacked_primitives = previous == nullptr
        ? realization.samples.size()
        : CountDeterministicPacketRecordChanges(
            previous->packet->bytes,
            bytes,
            kTreeCanopyHierarchicalRecordBytes
        );
    auto packet =
        std::make_shared<const TreeCanopyHierarchicalPacket>(
            TreeCanopyHierarchicalPacket{std::move(bytes)}
        );
    const std::size_t resident_bytes = packet->bytes.size();
    const std::uint64_t version =
        HashDeterministicPacketBytes(packet->bytes);
    return {
        std::move(realization),
        std::move(packet),
        false,
        repacked_primitives,
        repacked_primitives *
            kTreeCanopyHierarchicalRecordBytes,
        resident_bytes,
        version,
    };
}

}  // namespace vf::material
