#pragma once

#include "native/material/vf_deterministic_packet_reference.hpp"
#include "native/material/vf_hierarchical_field_reference.hpp"
#include "native/material/vf_road_material_energy.hpp"

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

constexpr std::size_t kTreeWoodHierarchicalRecordBytes =
    sizeof(std::uint64_t) + sizeof(std::uint32_t) +
    sizeof(std::uint64_t) + 14 * sizeof(float);

struct TreeWoodHierarchicalDefinition {
    std::array<std::uint64_t, 2> seed;
    std::uint64_t population_id;
    std::uint32_t species_count;
    std::uint64_t potential_trees;
    std::uint64_t potential_samples_per_tree;
};

struct TreeWoodHierarchicalDemand {
    std::uint64_t tree_id;
    std::uint32_t species_id;
    std::array<double, 2> tree_position;
    std::uint64_t sample_id;
    std::array<double, 3> growth_position;
};

struct TreeWoodHierarchicalSample {
    std::uint64_t tree_id;
    std::uint32_t species_id;
    std::uint64_t sample_id;
    std::array<double, 3> growth_position;
    double population_variation;
    double species_variation;
    double individual_variation;
    float surface_variation;
    float ring;
    float fiber;
    std::array<float, 3> base_color;
    float roughness;
    float reflectivity;
};

struct TreeWoodHierarchicalEnergy {
    std::array<float, 5> cosine_probes{
        1.0f, 0.75f, 0.5f, 0.25f, 0.0f,
    };
    std::vector<float> values;
    float minimum;
    float maximum;
    std::size_t violations;
};

struct TreeWoodHierarchicalMaterialRealization {
    std::uint64_t potential_trees;
    std::uint64_t potential_samples_per_tree;
    std::vector<TreeWoodHierarchicalSample> samples;
    TreeWoodHierarchicalEnergy energy;
};

struct TreeWoodCoarseGeometry {
    std::vector<float> vertices;
    std::vector<std::uint32_t> indices;
};

struct TreeWoodHierarchicalPacket {
    std::shared_ptr<const TreeWoodCoarseGeometry> geometry;
    std::vector<std::uint8_t> material_bytes;
};

struct TreeWoodHierarchicalResidencyState {
    std::uint64_t tree_id;
    TreeWoodHierarchicalMaterialRealization material;
    std::shared_ptr<const TreeWoodHierarchicalPacket> packet;
    bool retained;
    std::size_t repacked_samples;
    std::size_t upload_bytes;
    std::size_t resident_bytes;
    std::uint64_t version;
};

inline bool operator==(
    const TreeWoodHierarchicalSample& first,
    const TreeWoodHierarchicalSample& second
) {
    return first.tree_id == second.tree_id &&
        first.species_id == second.species_id &&
        first.sample_id == second.sample_id &&
        first.growth_position == second.growth_position &&
        first.population_variation == second.population_variation &&
        first.species_variation == second.species_variation &&
        first.individual_variation == second.individual_variation &&
        first.surface_variation == second.surface_variation &&
        first.ring == second.ring && first.fiber == second.fiber &&
        first.base_color == second.base_color &&
        first.roughness == second.roughness &&
        first.reflectivity == second.reflectivity;
}

inline bool operator==(
    const TreeWoodHierarchicalEnergy& first,
    const TreeWoodHierarchicalEnergy& second
) {
    return first.cosine_probes == second.cosine_probes &&
        first.values == second.values &&
        first.minimum == second.minimum &&
        first.maximum == second.maximum &&
        first.violations == second.violations;
}

inline bool operator==(
    const TreeWoodHierarchicalMaterialRealization& first,
    const TreeWoodHierarchicalMaterialRealization& second
) {
    return first.potential_trees == second.potential_trees &&
        first.potential_samples_per_tree ==
            second.potential_samples_per_tree &&
        first.samples == second.samples && first.energy == second.energy;
}

inline std::uint64_t TreeWoodHierarchicalRootKey(
    const TreeWoodHierarchicalDefinition& definition
) {
    return MixHierarchicalKey64(
        definition.seed[0] ^
        MixHierarchicalKey64(definition.seed[1]) ^
        MixHierarchicalKey64(definition.population_id)
    );
}

inline TreeWoodHierarchicalSample
SampleTreeWoodHierarchicalMaterialReference(
    const TreeWoodHierarchicalDefinition& definition,
    const TreeWoodHierarchicalDemand& demand
) {
    if (demand.tree_id >= definition.potential_trees ||
        demand.species_id >= definition.species_count ||
        demand.sample_id >= definition.potential_samples_per_tree) {
        throw std::out_of_range(
            "tree/wood demand is outside potential hierarchy"
        );
    }
    for (const double coordinate : demand.growth_position) {
        if (!std::isfinite(coordinate)) {
            throw std::invalid_argument(
                "wood growth position is not finite"
            );
        }
    }
    const std::uint64_t root = TreeWoodHierarchicalRootKey(definition);
    const double population_variation =
        SampleHierarchicalField2DReference(
            root,
            demand.tree_position,
            64.0,
            0
        );
    const double species_variation = HierarchicalSignedUnit(
        MixHierarchicalKey64(
            root ^ MixHierarchicalKey64(demand.species_id) ^
            0x243f6a8885a308d3ull
        )
    );
    const std::uint64_t individual_key = MixHierarchicalKey64(
        root ^ MixHierarchicalKey64(demand.tree_id) ^
        0x13198a2e03707344ull
    );
    const double individual_variation =
        HierarchicalSignedUnit(individual_key);
    const double radial = std::hypot(
        demand.growth_position[0],
        demand.growth_position[1]
    );
    const std::array<double, 2> surface_position{
        demand.growth_position[2],
        radial,
    };
    const float surface_variation = static_cast<float>(
        SampleHierarchicalField2DReference(
            individual_key,
            surface_position,
            0.25,
            1
        )
    );
    const double ring_spacing =
        0.20 + 0.04 * species_variation;
    constexpr double pi = 3.14159265358979323846;
    const float ring = static_cast<float>(
        0.5 + 0.5 * std::cos(
            2.0 * pi *
            (radial / ring_spacing + 0.08 * surface_variation)
        )
    );
    const float fiber = static_cast<float>(
        0.5 + 0.5 * SampleHierarchicalField2DReference(
            individual_key,
            {
                demand.growth_position[2] +
                    0.31 * demand.growth_position[0],
                demand.growth_position[1],
            },
            0.02,
            2
        )
    );
    const float ray = static_cast<float>(
        0.5 + 0.5 * surface_variation
    );
    const auto channel = [](double value) {
        return static_cast<float>(std::clamp(value, 0.0, 1.0));
    };
    const std::array<float, 3> base_color{
        channel(
            0.46 + 0.22 * ring + 0.04 * ray + 0.025 * fiber +
            0.025 * species_variation +
            0.015 * individual_variation
        ),
        channel(
            0.25 + 0.17 * ring + 0.03 * ray + 0.018 * fiber +
            0.018 * species_variation +
            0.010 * individual_variation
        ),
        channel(
            0.105 + 0.085 * ring + 0.02 * ray + 0.012 * fiber +
            0.010 * species_variation +
            0.006 * individual_variation
        ),
    };
    const float roughness = channel(
        0.56 + 0.22 * ring - 0.05 * ray +
        0.03 * surface_variation
    );
    const float index_of_refraction = static_cast<float>(
        1.53 + 0.02 * species_variation
    );
    return {
        demand.tree_id,
        demand.species_id,
        demand.sample_id,
        demand.growth_position,
        population_variation,
        species_variation,
        individual_variation,
        surface_variation,
        ring,
        fiber,
        base_color,
        roughness,
        vkf::material::DielectricF0(index_of_refraction),
    };
}

inline TreeWoodHierarchicalEnergy EvaluateTreeWoodEnergyReference(
    const std::vector<TreeWoodHierarchicalSample>& samples
) {
    TreeWoodHierarchicalEnergy energy;
    energy.minimum = samples.empty()
        ? 0.0f
        : std::numeric_limits<float>::infinity();
    energy.maximum = samples.empty()
        ? 0.0f
        : -std::numeric_limits<float>::infinity();
    energy.violations = 0;
    energy.values.reserve(samples.size() * 15);
    for (const auto& sample : samples) {
        for (const float cosine : energy.cosine_probes) {
            const float one_minus = 1.0f - cosine;
            const float square = one_minus * one_minus;
            const float fifth = square * square * one_minus;
            const float fresnel = sample.reflectivity +
                (1.0f - sample.reflectivity) * fifth;
            for (const float albedo : sample.base_color) {
                const float value = fresnel +
                    (1.0f - fresnel) * albedo;
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

inline TreeWoodHierarchicalMaterialRealization
RealizeTreeWoodHierarchicalMaterialReference(
    const TreeWoodHierarchicalDefinition& definition,
    const std::vector<TreeWoodHierarchicalDemand>& demands,
    std::size_t sample_budget
) {
    if (definition.species_count == 0 ||
        definition.potential_trees == 0 ||
        definition.potential_samples_per_tree == 0) {
        throw std::invalid_argument(
            "tree/wood hierarchy must contain potential content"
        );
    }
    if (demands.size() > sample_budget) {
        throw std::range_error(
            "tree/wood demand exceeds sample budget"
        );
    }
    auto ordered = demands;
    std::sort(
        ordered.begin(),
        ordered.end(),
        [](const auto& first, const auto& second) {
            return first.tree_id < second.tree_id ||
                (first.tree_id == second.tree_id &&
                 first.sample_id < second.sample_id);
        }
    );
    for (std::size_t index = 1; index < ordered.size(); ++index) {
        const auto& previous = ordered[index - 1];
        const auto& current = ordered[index];
        if (previous.tree_id == current.tree_id &&
            previous.sample_id == current.sample_id) {
            throw std::invalid_argument(
                "tree/wood demand is duplicated"
            );
        }
        if (previous.tree_id == current.tree_id &&
            (previous.species_id != current.species_id ||
             previous.tree_position != current.tree_position)) {
            throw std::invalid_argument(
                "one tree has inconsistent hierarchy identity"
            );
        }
    }
    std::vector<TreeWoodHierarchicalSample> samples;
    samples.reserve(ordered.size());
    for (const auto& demand : ordered) {
        samples.push_back(
            SampleTreeWoodHierarchicalMaterialReference(
                definition,
                demand
            )
        );
    }
    auto energy = EvaluateTreeWoodEnergyReference(samples);
    return {
        definition.potential_trees,
        definition.potential_samples_per_tree,
        std::move(samples),
        std::move(energy),
    };
}

inline void ValidateTreeWoodMaterialForPacking(
    const TreeWoodHierarchicalMaterialRealization& material
) {
    for (const auto& sample : material.samples) {
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
            sample.reflectivity > 1.0f) {
            throw std::domain_error(
                "tree/wood packet contains non-passive material"
            );
        }
    }
    const auto energy = EvaluateTreeWoodEnergyReference(material.samples);
    if (!(energy == material.energy) ||
        material.energy.violations != 0 ||
        material.energy.minimum < 0.0f ||
        material.energy.maximum > 1.0f) {
        throw std::domain_error(
            "tree/wood packet failed passive energy validation"
        );
    }
}

inline void AppendTreeWoodSampleBytesReference(
    std::vector<std::uint8_t>& bytes,
    const TreeWoodHierarchicalSample& sample
) {
    AppendDeterministicPacketWord64(bytes, sample.tree_id);
    AppendDeterministicPacketWord32(bytes, sample.species_id);
    AppendDeterministicPacketWord64(bytes, sample.sample_id);
    for (const double value : sample.growth_position) {
        AppendDeterministicPacketFloat32(
            bytes,
            static_cast<float>(value)
        );
    }
    for (const double value : {
             sample.population_variation,
             sample.species_variation,
             sample.individual_variation,
         }) {
        AppendDeterministicPacketFloat32(
            bytes,
            static_cast<float>(value)
        );
    }
    AppendDeterministicPacketFloat32(
        bytes,
        sample.surface_variation
    );
    AppendDeterministicPacketFloat32(bytes, sample.ring);
    AppendDeterministicPacketFloat32(bytes, sample.fiber);
    for (const float value : sample.base_color) {
        AppendDeterministicPacketFloat32(bytes, value);
    }
    AppendDeterministicPacketFloat32(bytes, sample.roughness);
    AppendDeterministicPacketFloat32(bytes, sample.reflectivity);
}

inline std::vector<std::uint8_t> PackTreeWoodMaterialBytesReference(
    const TreeWoodHierarchicalMaterialRealization& material
) {
    ValidateTreeWoodMaterialForPacking(material);
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        material.samples.size() * kTreeWoodHierarchicalRecordBytes
    );
    for (const auto& sample : material.samples) {
        AppendTreeWoodSampleBytesReference(bytes, sample);
    }
    return bytes;
}

inline std::shared_ptr<const TreeWoodCoarseGeometry>
CreateTreeWoodCoarseGeometryReference(
    const TreeWoodHierarchicalDemand& demand,
    const TreeWoodHierarchicalSample& sample
) {
    const float x = static_cast<float>(demand.tree_position[0]);
    const float y = static_cast<float>(demand.tree_position[1]);
    const float radius = static_cast<float>(std::clamp(
        0.35 + 0.07 * sample.species_variation +
            0.04 * sample.individual_variation,
        0.20,
        0.60
    ));
    const float height = static_cast<float>(std::clamp(
        8.0 + 2.0 * sample.population_variation +
            1.5 * sample.species_variation +
            sample.individual_variation,
        4.0,
        16.0
    ));
    const std::vector<float> vertices{
        x - radius, y - radius, 0.0f,
        x + radius, y - radius, 0.0f,
        x + radius, y + radius, 0.0f,
        x - radius, y + radius, 0.0f,
        x - radius, y - radius, height,
        x + radius, y - radius, height,
        x + radius, y + radius, height,
        x - radius, y + radius, height,
    };
    const std::vector<std::uint32_t> indices{
        0, 2, 1, 0, 3, 2,
        4, 5, 6, 4, 6, 7,
        0, 1, 5, 0, 5, 4,
        1, 2, 6, 1, 6, 5,
        2, 3, 7, 2, 7, 6,
        3, 0, 4, 3, 4, 7,
    };
    return std::make_shared<const TreeWoodCoarseGeometry>(
        TreeWoodCoarseGeometry{vertices, indices}
    );
}

inline std::size_t TreeWoodCoarseGeometryBytes(
    const TreeWoodCoarseGeometry& geometry
) {
    return geometry.vertices.size() * sizeof(float) +
        geometry.indices.size() * sizeof(std::uint32_t);
}

inline std::uint64_t TreeWoodPacketVersion(
    const TreeWoodHierarchicalPacket& packet
) {
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        TreeWoodCoarseGeometryBytes(*packet.geometry) +
        packet.material_bytes.size()
    );
    for (const float vertex : packet.geometry->vertices) {
        AppendDeterministicPacketFloat32(bytes, vertex);
    }
    for (const std::uint32_t index : packet.geometry->indices) {
        AppendDeterministicPacketWord32(bytes, index);
    }
    bytes.insert(
        bytes.end(),
        packet.material_bytes.begin(),
        packet.material_bytes.end()
    );
    return HashDeterministicPacketBytes(bytes);
}

inline TreeWoodHierarchicalResidencyState
UpdateTreeWoodHierarchicalResidencyReference(
    const TreeWoodHierarchicalDefinition& definition,
    std::uint64_t tree_id,
    const std::vector<TreeWoodHierarchicalDemand>& demands,
    std::size_t sample_budget,
    const TreeWoodHierarchicalResidencyState* previous
) {
    if (demands.empty()) {
        throw std::invalid_argument(
            "tree/wood residency requires surface demand"
        );
    }
    for (const auto& demand : demands) {
        if (demand.tree_id != tree_id) {
            throw std::invalid_argument(
                "tree/wood residency mixes tree identities"
            );
        }
    }
    auto material = RealizeTreeWoodHierarchicalMaterialReference(
        definition,
        demands,
        sample_budget
    );
    ValidateTreeWoodMaterialForPacking(material);
    auto ordered = demands;
    std::sort(
        ordered.begin(),
        ordered.end(),
        [](const auto& first, const auto& second) {
            return first.sample_id < second.sample_id;
        }
    );
    auto proposed_geometry = CreateTreeWoodCoarseGeometryReference(
        ordered.front(),
        material.samples.front()
    );
    const bool same_geometry = previous != nullptr &&
        previous->packet->geometry->vertices ==
            proposed_geometry->vertices &&
        previous->packet->geometry->indices ==
            proposed_geometry->indices;
    if (previous != nullptr && same_geometry &&
        material == previous->material) {
        return {
            tree_id,
            std::move(material),
            previous->packet,
            true,
            0,
            0,
            previous->resident_bytes,
            previous->version,
        };
    }
    auto geometry = same_geometry
        ? previous->packet->geometry
        : std::move(proposed_geometry);
    auto material_bytes = PackTreeWoodMaterialBytesReference(material);
    auto packet = std::make_shared<const TreeWoodHierarchicalPacket>(
        TreeWoodHierarchicalPacket{
            std::move(geometry),
            std::move(material_bytes),
        }
    );
    const std::size_t repacked_samples = same_geometry
        ? CountDeterministicPacketRecordChanges(
            previous->packet->material_bytes,
            packet->material_bytes,
            kTreeWoodHierarchicalRecordBytes
        )
        : material.samples.size();
    const std::size_t geometry_upload = same_geometry
        ? 0
        : TreeWoodCoarseGeometryBytes(*packet->geometry);
    const std::size_t upload_bytes = geometry_upload +
        repacked_samples * kTreeWoodHierarchicalRecordBytes;
    const std::size_t resident_bytes =
        TreeWoodCoarseGeometryBytes(*packet->geometry) +
        packet->material_bytes.size();
    const std::uint64_t version = TreeWoodPacketVersion(*packet);
    return {
        tree_id,
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
