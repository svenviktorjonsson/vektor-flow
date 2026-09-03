#include "native/material/vf_stone_mineral_spectral_transport.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void require_near(
    float actual,
    float expected,
    float tolerance,
    const char* message
) {
    require(std::abs(actual - expected) <= tolerance, message);
}

}  // namespace

int main() {
    using namespace vf::material;

    const auto population = BuildMeasuredPopulationDistributionV1(
        MaterialOpticalFamily::stone
    );
    const auto minerals = BuildStoneMineralConditionedDistributionV1();
    const StoneMineralMaterialSample generic{
        {450.0f, 550.0f, 650.0f},
        {0.31f, 0.36f, 0.40f},
        {0.40f, 0.36f, 0.31f},
        0.72f,
        0.08f,
        0.91f,
    };
    constexpr std::uint64_t stone_identity =
        0x3c6ef372fe94f82bull;
    constexpr std::array<float, 3> incident_radiance{1.25f, 0.75f, 0.5f};
    constexpr float incidence_cosine = 0.65f;

    const auto albite = EvaluateMeasuredStoneMineralSpectralTransportReference(
        generic,
        stone_identity,
        population,
        minerals,
        StoneMineralConditionV1::albite_plagioclase,
        incident_radiance,
        incidence_cosine
    );
    const auto hornblende =
        EvaluateMeasuredStoneMineralSpectralTransportReference(
            generic,
            stone_identity,
            population,
            minerals,
            StoneMineralConditionV1::hornblende_amphibole,
            incident_radiance,
            incidence_cosine
        );

    require(albite.material.spectral_reflectance !=
                hornblende.material.spectral_reflectance &&
                albite.reflected_energy != hornblende.reflected_energy,
            "measured mineral identity did not reach spectral transport");
    for (std::size_t band = 0; band < 3; ++band) {
        const float projected = incident_radiance[band] * incidence_cosine;
        require_near(
            albite.projected_incident_energy[band],
            projected,
            1.0e-7f,
            "projected incident spectrum changed"
        );
        require_near(
            albite.reflected_energy[band],
            projected * albite.material.spectral_reflectance[band],
            1.0e-7f,
            "conditioned reflectance did not scale spectral transport"
        );
        require_near(
            albite.reflected_energy[band] +
                albite.absorbed_energy[band],
            projected,
            1.0e-7f,
            "conditioned spectral transport lost passive energy"
        );
    }
    require(albite.material.roughness == generic.roughness &&
                albite.material.reflectivity == generic.reflectivity &&
                albite.material.local_variation == generic.local_variation,
            "spectral transport changed unsupported material properties");

    auto inflated_fit_error = minerals;
    for (auto& condition : inflated_fit_error.conditions) {
        for (auto& member : condition.members) {
            for (auto& value : member.local_fit_standard_error) {
                value *= 100.0;
            }
        }
    }
    const auto unchanged =
        EvaluateMeasuredStoneMineralSpectralTransportReference(
            generic,
            stone_identity,
            population,
            inflated_fit_error,
            StoneMineralConditionV1::albite_plagioclase,
            incident_radiance,
            incidence_cosine
        );
    require(unchanged == albite,
            "measurement fit error was sampled by light transport");

    const auto rejects_transport = [&](const auto& incident, float cosine) {
        try {
            static_cast<void>(
                EvaluateMeasuredStoneMineralSpectralTransportReference(
                    generic,
                    stone_identity,
                    population,
                    minerals,
                    StoneMineralConditionV1::albite_plagioclase,
                    incident,
                    cosine
                )
            );
        } catch (const std::invalid_argument&) {
            return true;
        }
        return false;
    };
    require(rejects_transport(
                std::array<float, 3>{-0.01f, 0.75f, 0.5f},
                incidence_cosine
            ),
            "negative incident spectrum entered light transport");
    require(rejects_transport(
                std::array<float, 3>{
                    1.25f,
                    std::numeric_limits<float>::infinity(),
                    0.5f,
                },
                incidence_cosine
            ),
            "non-finite incident spectrum entered light transport");
    require(rejects_transport(incident_radiance, -0.01f) &&
                rejects_transport(incident_radiance, 1.01f) &&
                rejects_transport(
                    incident_radiance,
                    std::numeric_limits<float>::quiet_NaN()
                ),
            "invalid incidence cosine entered light transport");

    std::cout << "stone mineral spectral transport: reflected="
              << albite.reflected_energy[0] << ','
              << albite.reflected_energy[1] << ','
              << albite.reflected_energy[2]
              << " passive=true fit_error_sampled=false\n";
}
