#pragma once

#include "native/material/vf_stone_mineral_conditioned_material.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>

namespace vf::material {

struct StoneMineralSpectralTransport {
    StoneMineralMaterialSample material;
    std::array<float, 3> projected_incident_energy{};
    std::array<float, 3> reflected_energy{};
    std::array<float, 3> absorbed_energy{};
};

inline bool operator==(
    const StoneMineralSpectralTransport& first,
    const StoneMineralSpectralTransport& second
) {
    return first.material == second.material &&
        first.projected_incident_energy ==
            second.projected_incident_energy &&
        first.reflected_energy == second.reflected_energy &&
        first.absorbed_energy == second.absorbed_energy;
}

inline StoneMineralSpectralTransport
EvaluateMeasuredStoneMineralSpectralTransportReference(
    StoneMineralMaterialSample sample,
    std::uint64_t stone_identity,
    const MeasuredPopulationDistribution& population,
    const StoneMineralConditionedDistribution& mineral_distribution,
    StoneMineralConditionV1 condition,
    const std::array<float, 3>& incident_radiance,
    float incidence_cosine
) {
    if (!std::isfinite(incidence_cosine) ||
        incidence_cosine < 0.0f || incidence_cosine > 1.0f) {
        throw std::invalid_argument(
            "stone mineral incidence cosine must be finite in [0, 1]"
        );
    }
    for (const float radiance : incident_radiance) {
        if (!std::isfinite(radiance) || radiance < 0.0f) {
            throw std::invalid_argument(
                "stone mineral incident radiance must be finite and nonnegative"
            );
        }
    }
    StoneMineralSpectralTransport result;
    result.material = ApplyStoneMeasuredMineralPipelineReference(
        sample,
        stone_identity,
        population,
        mineral_distribution,
        condition
    );
    for (std::size_t band = 0; band < incident_radiance.size(); ++band) {
        result.projected_incident_energy[band] =
            incident_radiance[band] * incidence_cosine;
        result.reflected_energy[band] =
            result.projected_incident_energy[band] *
            result.material.spectral_reflectance[band];
        result.absorbed_energy[band] =
            result.projected_incident_energy[band] -
            result.reflected_energy[band];
    }
    return result;
}

}  // namespace vf::material
