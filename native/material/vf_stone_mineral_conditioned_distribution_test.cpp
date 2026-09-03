#include "native/material/vf_stone_mineral_conditioned_distribution.hpp"
#include "native/material/vf_stone_mineral_conditioned_material.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void require_near(
    double actual,
    double expected,
    double tolerance,
    const char* message
) {
    require(std::abs(actual - expected) <= tolerance, message);
}

}  // namespace

int main() {
    using namespace vf::material;

    const auto distribution =
        BuildStoneMineralConditionedDistributionV1();
    ValidateStoneMineralConditionedDistribution(distribution);
    require(distribution.conditions.size() == 3,
            "stone mineral condition coverage changed");
    require(distribution.provenance.license == "CC0-1.0" &&
                distribution.provenance.population_variation_note !=
                    distribution.provenance.fit_uncertainty_note,
            "population variation and fit uncertainty were conflated");

    for (std::size_t band = 0; band < 3; ++band) {
        double condition_factor_sum = 0.0;
        for (const auto& condition : distribution.conditions) {
            require(condition.members.size() == 4,
                    "stone mineral condition lost measured members");
            condition_factor_sum += condition.conditioned_factor[band];
            double member_factor_sum = 0.0;
            for (const auto& member : condition.members) {
                member_factor_sum += member.centered_factor[band];
                require_near(
                    member.centered_factor[band] *
                        condition.measured_mean[band],
                    member.spectral_reflectance[band],
                    1.0e-14,
                    "stone specimen factor lost its measurement"
                );
            }
            require_near(
                member_factor_sum /
                    static_cast<double>(condition.members.size()),
                1.0,
                1.0e-14,
                "stone specimen factors moved condition center"
            );
            require(
                condition.member_factor_standard_deviation[band] >
                    condition.fit_relative_standard_error_rms[band],
                "fit error replaced within-condition variation"
            );
        }
        require_near(
            condition_factor_sum /
                static_cast<double>(distribution.conditions.size()),
            1.0,
            1.0e-14,
            "mineral conditions moved calibrated stone center"
        );
    }
    require_near(
        distribution.conditions[0]
            .members[0].spectral_reflectance[0],
        0.77834922,
        1.0e-14,
        "albite source fit changed"
    );

    constexpr std::uint64_t stone_identity =
        0x3c6ef372fe94f82bull;
    const StoneMineralMaterialSample generic{
        {450.0f, 550.0f, 650.0f},
        {0.31f, 0.36f, 0.40f},
        {0.40f, 0.36f, 0.31f},
        0.72f,
        0.08f,
        0.91f,
    };
    const auto albite = SampleStoneMineralConditionedMaterialReference(
        generic,
        stone_identity,
        StoneMineralConditionV1::albite_plagioclase
    );
    const auto hornblende =
        SampleStoneMineralConditionedMaterialReference(
            generic,
            stone_identity,
            StoneMineralConditionV1::hornblende_amphibole
        );
    require(albite.spectral_reflectance !=
                generic.spectral_reflectance &&
                albite.spectral_reflectance !=
                    hornblende.spectral_reflectance,
            "measured mineral condition did not reach generator");
    require(albite.roughness == generic.roughness &&
                albite.reflectivity == generic.reflectivity &&
                albite.local_variation == generic.local_variation,
            "spectral condition changed unsupported properties");
    require(albite.base_color[2] ==
                albite.spectral_reflectance[0] &&
                albite.base_color[1] ==
                    albite.spectral_reflectance[1] &&
                albite.base_color[0] ==
                    albite.spectral_reflectance[2],
            "conditioned spectral and RGB values diverged");

    auto inflated_fit_error = distribution;
    for (auto& value : inflated_fit_error.conditions[0]
                           .members[0]
                           .local_fit_standard_error) {
        value *= 100.0;
    }
    const auto unchanged = ApplyStoneMineralConditionReference(
        generic,
        stone_identity,
        inflated_fit_error,
        StoneMineralConditionV1::albite_plagioclase
    );
    require(unchanged.spectral_reflectance ==
                albite.spectral_reflectance,
            "fit uncertainty was sampled as population variation");

    const std::vector<StoneMineralConditionV1> conditions{
        StoneMineralConditionV1::albite_plagioclase,
        StoneMineralConditionV1::microcline_alkali_feldspar,
        StoneMineralConditionV1::hornblende_amphibole,
    };
    std::vector<std::array<float, 3>> forward;
    for (const auto condition : conditions) {
        forward.push_back(ApplyStoneMineralConditionReference(
            generic,
            stone_identity,
            distribution,
            condition
        ).spectral_reflectance);
    }
    auto reversed_conditions = conditions;
    std::reverse(
        reversed_conditions.begin(),
        reversed_conditions.end()
    );
    std::vector<std::array<float, 3>> reversed;
    for (const auto condition : reversed_conditions) {
        reversed.push_back(ApplyStoneMineralConditionReference(
            generic,
            stone_identity,
            distribution,
            condition
        ).spectral_reflectance);
    }
    std::reverse(reversed.begin(), reversed.end());
    require(reversed == forward,
            "mineral condition depended on traversal order");

    auto invalid = distribution;
    invalid.conditions[1].members[1].source_sha256 =
        invalid.conditions[1].members[0].source_sha256;
    bool rejected_duplicate = false;
    try {
        ValidateStoneMineralConditionedDistribution(invalid);
    } catch (const std::invalid_argument&) {
        rejected_duplicate = true;
    }
    require(rejected_duplicate,
            "duplicate mineral evidence was accepted");

    bool rejected_unknown = false;
    try {
        static_cast<void>(ApplyStoneMineralConditionReference(
            generic,
            stone_identity,
            distribution,
            static_cast<StoneMineralConditionV1>(99)
        ));
    } catch (const std::invalid_argument&) {
        rejected_unknown = true;
    }
    require(rejected_unknown,
            "unsupported mineral condition was approximated");

    const auto passive = [](const StoneMineralMaterialSample& sample) {
        return std::all_of(
            sample.spectral_reflectance.begin(),
            sample.spectral_reflectance.end(),
            [](float value) { return value >= 0.0f && value <= 1.0f; }
        );
    };
    require(passive(albite) && passive(hornblende),
            "conditioned stone escaped passive energy bounds");

    std::cout << "conditioned stone minerals: conditions="
              << distribution.conditions.size()
              << " members=12 source_sha="
              << distribution.provenance.source_archive_sha256
              << " fit_error_sampled=false\n";
    return 0;
}
