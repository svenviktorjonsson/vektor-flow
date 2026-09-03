#pragma once

#include "native/material/vf_material_population_distribution.hpp"
#include "native/material/vf_stone_mineral_conditioned_distribution.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>

namespace vf::material {

struct StoneMineralMaterialSample {
    std::array<float, 3> wavelengths_nm;
    std::array<float, 3> spectral_reflectance;
    std::array<float, 3> base_color;
    float roughness;
    float reflectivity;
    float local_variation;
};

inline bool operator==(
    const StoneMineralMaterialSample& first,
    const StoneMineralMaterialSample& second
) {
    return first.wavelengths_nm == second.wavelengths_nm &&
        first.spectral_reflectance == second.spectral_reflectance &&
        first.base_color == second.base_color &&
        first.roughness == second.roughness &&
        first.reflectivity == second.reflectivity &&
        first.local_variation == second.local_variation;
}

inline std::uint64_t MixStoneMineralIdentity(std::uint64_t value) {
    value ^= value >> 30;
    value *= 0xbf58476d1ce4e5b9ull;
    value ^= value >> 27;
    value *= 0x94d049bb133111ebull;
    return value ^ (value >> 31);
}

inline const StoneMineralMeasuredMember&
SelectStoneMineralMeasuredMemberReference(
    const StoneMineralMeasuredCondition& condition,
    std::uint64_t stone_identity
) {
    const auto condition_index =
        static_cast<std::uint64_t>(condition.condition);
    const std::uint64_t key = MixStoneMineralIdentity(
        stone_identity ^ MixStoneMineralIdentity(
            condition_index + 0x6a09e667f3bcc909ull
        )
    );
    const auto index = static_cast<std::size_t>(
        key % condition.members.size()
    );
    return condition.members[index];
}

inline StoneMineralMaterialSample ApplyStoneMineralConditionReference(
    StoneMineralMaterialSample sample,
    std::uint64_t stone_identity,
    const StoneMineralConditionedDistribution& distribution,
    StoneMineralConditionV1 condition_id
) {
    const auto& condition = StoneMineralConditionReference(
        distribution,
        condition_id
    );
    const auto& measured = SelectStoneMineralMeasuredMemberReference(
        condition,
        stone_identity
    );
    constexpr std::array<double, 3> generic_stone_center{
        0.31,
        0.36,
        0.40,
    };
    for (std::size_t band = 0; band < 3; ++band) {
        const double hierarchical_factor =
            static_cast<double>(sample.spectral_reflectance[band]) /
            generic_stone_center[band];
        const double conditioned =
            distribution.calibrated_center[band] *
            condition.conditioned_factor[band] *
            measured.centered_factor[band] * hierarchical_factor;
        sample.spectral_reflectance[band] = static_cast<float>(
            std::clamp(conditioned, 0.0, 1.0)
        );
    }
    sample.base_color = {
        sample.spectral_reflectance[2],
        sample.spectral_reflectance[1],
        sample.spectral_reflectance[0],
    };
    return sample;
}

inline StoneMineralMaterialSample
ApplyStoneMeasuredMineralPipelineReference(
    StoneMineralMaterialSample sample,
    std::uint64_t stone_identity,
    const MeasuredPopulationDistribution& population,
    const StoneMineralConditionedDistribution& mineral_distribution,
    StoneMineralConditionV1 condition
) {
    ValidateMeasuredPopulationDistribution(population);
    ValidateStoneMineralConditionedDistribution(mineral_distribution);
    if (population.family != MaterialOpticalFamily::stone ||
        population.calibrated_center !=
            mineral_distribution.calibrated_center ||
        population.provenance.source_url !=
            mineral_distribution.provenance.source_url ||
        population.provenance.source_archive_sha256 !=
            mineral_distribution.provenance.source_archive_sha256 ||
        population.provenance.license !=
            mineral_distribution.provenance.license) {
        throw std::invalid_argument(
            "stone measured pipeline evidence is incompatible"
        );
    }
    const std::uint64_t population_key = MixStoneMineralIdentity(
        stone_identity ^ 0xbb67ae8584caa73bull
    );
    const auto population_index = static_cast<std::size_t>(
        population_key % population.centered_factors.size()
    );
    for (std::size_t band = 0; band < 3; ++band) {
        sample.spectral_reflectance[band] *= static_cast<float>(
            population.centered_factors[population_index][band]
        );
    }
    sample.base_color = {
        sample.spectral_reflectance[2],
        sample.spectral_reflectance[1],
        sample.spectral_reflectance[0],
    };
    return ApplyStoneMineralConditionReference(
        sample,
        stone_identity,
        mineral_distribution,
        condition
    );
}

inline StoneMineralMaterialSample
SampleStoneMineralConditionedMaterialReference(
    StoneMineralMaterialSample sample,
    std::uint64_t stone_identity,
    StoneMineralConditionV1 condition
) {
    const auto distribution =
        BuildStoneMineralConditionedDistributionV1();
    ValidateStoneMineralConditionedDistribution(distribution);
    return ApplyStoneMineralConditionReference(
        sample,
        stone_identity,
        distribution,
        condition
    );
}

}  // namespace vf::material
