#pragma once

#include "native/material/vf_road_material_energy.hpp"
#include "native/material/vf_stone_hierarchical_population.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

enum class StoneMaterialElementKind : std::uint8_t {
    Vertex = 0,
    Face = 1,
};

struct StoneMaterialDemand {
    StoneMaterialElementKind kind;
    std::uint32_t element;
};

struct StoneHierarchicalMaterialSample {
    StoneMaterialElementKind kind;
    std::uint32_t element;
    std::array<float, 3> wavelengths_nm;
    std::array<float, 3> spectral_reflectance;
    std::array<float, 3> base_color;
    float roughness;
    float reflectivity;
    float local_variation;
};

struct StoneHierarchicalMaterialEnergy {
    std::array<float, 5> cosine_probes{
        1.0f, 0.75f, 0.5f, 0.25f, 0.0f,
    };
    std::vector<float> values;
    float minimum;
    float maximum;
    std::size_t violations;
};

struct StoneHierarchicalMaterialRealization {
    std::size_t potential_elements;
    std::vector<StoneHierarchicalMaterialSample> samples;
    StoneHierarchicalMaterialEnergy energy;
};

inline bool operator==(
    const StoneHierarchicalMaterialSample& first,
    const StoneHierarchicalMaterialSample& second
) {
    return first.kind == second.kind &&
        first.element == second.element &&
        first.wavelengths_nm == second.wavelengths_nm &&
        first.spectral_reflectance == second.spectral_reflectance &&
        first.base_color == second.base_color &&
        first.roughness == second.roughness &&
        first.reflectivity == second.reflectivity &&
        first.local_variation == second.local_variation;
}

inline bool operator==(
    const StoneHierarchicalMaterialEnergy& first,
    const StoneHierarchicalMaterialEnergy& second
) {
    return first.cosine_probes == second.cosine_probes &&
        first.values == second.values &&
        first.minimum == second.minimum &&
        first.maximum == second.maximum &&
        first.violations == second.violations;
}

inline bool operator==(
    const StoneHierarchicalMaterialRealization& first,
    const StoneHierarchicalMaterialRealization& second
) {
    return first.potential_elements == second.potential_elements &&
        first.samples == second.samples &&
        first.energy == second.energy;
}

inline bool operator!=(
    const StoneHierarchicalMaterialRealization& first,
    const StoneHierarchicalMaterialRealization& second
) {
    return !(first == second);
}

inline std::array<float, 3> StoneMaterialElementPosition(
    const StoneCoarseShape& geometry,
    const StoneMaterialDemand& demand
) {
    if (demand.kind == StoneMaterialElementKind::Vertex) {
        if (demand.element >= geometry.positions.size()) {
            throw std::out_of_range(
                "stone material vertex is unavailable"
            );
        }
        return geometry.positions[demand.element];
    }
    if (demand.kind != StoneMaterialElementKind::Face ||
        demand.element >= geometry.triangles.size()) {
        throw std::out_of_range(
            "stone material face is unavailable"
        );
    }
    std::array<float, 3> position{};
    for (const std::uint32_t vertex :
         geometry.triangles[demand.element]) {
        if (vertex >= geometry.positions.size()) {
            throw std::invalid_argument(
                "stone material triangle index is invalid"
            );
        }
        for (std::size_t axis = 0; axis < 3; ++axis) {
            position[axis] += geometry.positions[vertex][axis] / 3.0f;
        }
    }
    return position;
}

inline std::array<double, 2> StoneMaterialSurfaceCoordinates(
    const std::array<float, 3>& position,
    const std::array<float, 3>& radii
) {
    std::array<double, 3> direction{};
    double scale = 0.0;
    for (std::size_t axis = 0; axis < 3; ++axis) {
        direction[axis] = position[axis] / radii[axis];
        scale += std::abs(direction[axis]);
    }
    if (!(scale > 0.0)) {
        throw std::invalid_argument(
            "stone material position is at the origin"
        );
    }
    const double x = direction[0] / scale;
    const double y = direction[1] / scale;
    const double z = direction[2] / scale;
    if (z >= 0.0) return {x, y};
    const double sign_x = x < 0.0 ? -1.0 : 1.0;
    const double sign_y = y < 0.0 ? -1.0 : 1.0;
    return {
        (1.0 - std::abs(y)) * sign_x,
        (1.0 - std::abs(x)) * sign_y,
    };
}

inline StoneHierarchicalMaterialEnergy
EvaluateStoneHierarchicalMaterialEnergyReference(
    const std::vector<StoneHierarchicalMaterialSample>& samples
) {
    StoneHierarchicalMaterialEnergy energy;
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
            const float one_minus_cosine = 1.0f - cosine;
            const float square = one_minus_cosine * one_minus_cosine;
            const float fourth = square * square;
            const float fresnel = sample.reflectivity +
                (1.0f - sample.reflectivity) *
                fourth * one_minus_cosine;
            for (const float reflectance : sample.base_color) {
                const float value = fresnel +
                    (1.0f - fresnel) * reflectance;
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

inline StoneHierarchicalMaterialSample
SampleStoneHierarchicalMaterialReference(
    const StonePopulationMember& member,
    const StoneCoarseShape& geometry,
    const StoneMaterialDemand& demand
) {
    const auto position = StoneMaterialElementPosition(geometry, demand);
    const auto surface_position = StoneMaterialSurfaceCoordinates(
        position,
        member.radii
    );
    const auto surface = SampleStonePopulationSurfaceReference(
        member,
        surface_position
    );
    const double population = member.population_variation;
    const double instance = member.instance_variation;
    const double local = surface.local_variation;
    const std::array<float, 3> base_color{
        static_cast<float>(std::clamp(
            0.40 + 0.08 * population + 0.05 * instance + 0.04 * local,
            0.0,
            1.0
        )),
        static_cast<float>(std::clamp(
            0.36 + 0.06 * population + 0.03 * instance + 0.03 * local,
            0.0,
            1.0
        )),
        static_cast<float>(std::clamp(
            0.31 + 0.04 * population + 0.02 * instance + 0.02 * local,
            0.0,
            1.0
        )),
    };
    const float index_of_refraction = static_cast<float>(
        1.54 + 0.04 * population + 0.02 * instance
    );
    return {
        demand.kind,
        demand.element,
        {450.0f, 550.0f, 650.0f},
        {base_color[2], base_color[1], base_color[0]},
        base_color,
        static_cast<float>(surface.roughness),
        vkf::material::DielectricF0(index_of_refraction),
        static_cast<float>(local),
    };
}

inline StoneHierarchicalMaterialRealization
RealizeStoneHierarchicalMaterialReference(
    const StonePopulationMember& member,
    const StoneCoarseShape& geometry,
    const std::vector<StoneMaterialDemand>& demands,
    std::size_t sample_budget
) {
    if (geometry.radii != member.radii) {
        throw std::invalid_argument(
            "stone material geometry owns another population member"
        );
    }
    if (demands.size() > sample_budget) {
        throw std::range_error(
            "stone material demand exceeds sample budget"
        );
    }
    auto ordered = demands;
    std::sort(
        ordered.begin(),
        ordered.end(),
        [](const auto& first, const auto& second) {
            if (first.kind != second.kind) {
                return first.kind < second.kind;
            }
            return first.element < second.element;
        }
    );
    for (std::size_t index = 1; index < ordered.size(); ++index) {
        if (ordered[index - 1].kind == ordered[index].kind &&
            ordered[index - 1].element == ordered[index].element) {
            throw std::invalid_argument(
                "stone material demand is duplicated"
            );
        }
    }
    std::vector<StoneHierarchicalMaterialSample> samples;
    samples.reserve(ordered.size());
    for (const auto& demand : ordered) {
        samples.push_back(SampleStoneHierarchicalMaterialReference(
            member,
            geometry,
            demand
        ));
    }
    auto energy = EvaluateStoneHierarchicalMaterialEnergyReference(samples);
    return {
        geometry.positions.size() + geometry.triangles.size(),
        std::move(samples),
        std::move(energy),
    };
}

}  // namespace vf::material
