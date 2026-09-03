#pragma once

#include "native/material/vf_material_reference_fit.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace vf::material {

enum class MaterialOpticalFamily {
    stone,
    road,
    wood,
    vegetation,
};

enum class OpticalEvidenceClass {
    measured,
    fitted_from_measurements,
};

struct MaterialOpticalEvidence {
    MaterialOpticalFamily family;
    OpticalEvidenceClass evidence_class;
    std::string_view stable_id;
    std::string_view property;
    std::string_view source_url;
    std::string_view source_version;
    std::string_view license;
    std::string_view license_url;
    std::string_view conditions;
    std::string_view uncertainty;
    std::string_view limitation;
};

struct ReferenceArtifactIdentity {
    std::string_view stable_id;
    std::string_view url;
    std::string_view sha256;
};

struct SellmeierTerm {
    double numerator;
    double pole_um_squared;
};

struct Sellmeier2Reference {
    ReferenceArtifactIdentity artifact;
    MaterialOpticalFamily family;
    std::string_view axis;
    double temperature_kelvin;
    double minimum_wavelength_um;
    double maximum_wavelength_um;
    double constant;
    std::array<SellmeierTerm, 2> terms;
};

struct SpectralIndexObservation {
    std::string_view source_id;
    double wavelength_um;
    double index_of_refraction;
};

struct ScalarIndexFit {
    double index_of_refraction;
    double fresnel_f0;
    double rmse;
    double standard_error;
    double normalized_rmse;
    std::size_t observation_count;
};

inline bool operator==(
    const ScalarIndexFit& first,
    const ScalarIndexFit& second
) {
    return first.index_of_refraction == second.index_of_refraction &&
        first.fresnel_f0 == second.fresnel_f0 &&
        first.rmse == second.rmse &&
        first.standard_error == second.standard_error &&
        first.normalized_rmse == second.normalized_rmse &&
        first.observation_count == second.observation_count;
}

struct RoadDirectionalReference {
    ReferenceArtifactIdentity parameter_artifact;
    ReferenceArtifactIdentity material_artifact;
    std::string_view material_name;
    std::string_view material_description;
    std::size_t measured_directions;
    double albedo;
    double energy_normalized_oren_nayar_roughness;
    double energy_normalized_oren_nayar_weighted_nrmse;
};

struct RoadDirectionalFit {
    double albedo;
    double oren_nayar_roughness;
    double weighted_normalized_rmse;
};

inline void ValidateReferenceArtifact(
    const ReferenceArtifactIdentity& artifact
) {
    if (artifact.stable_id.empty() ||
        !artifact.url.starts_with("https://") ||
        !IsUpperHexSha256(artifact.sha256)) {
        throw std::invalid_argument(
            "optical reference artifact identity is invalid"
        );
    }
}

inline void ValidateOpticalEvidence(
    const MaterialOpticalEvidence& evidence
) {
    if (evidence.stable_id.empty() || evidence.property.empty() ||
        !evidence.source_url.starts_with("https://") ||
        evidence.source_version.empty() || evidence.license.empty() ||
        !evidence.license_url.starts_with("https://") ||
        evidence.conditions.empty() || evidence.uncertainty.empty() ||
        evidence.limitation.empty()) {
        throw std::invalid_argument(
            "material optical evidence is incomplete"
        );
    }
}

inline double EvaluateSellmeier2(
    const Sellmeier2Reference& reference,
    double wavelength_um
) {
    ValidateReferenceArtifact(reference.artifact);
    if (reference.axis.empty() ||
        !std::isfinite(reference.temperature_kelvin) ||
        reference.temperature_kelvin <= 0.0 ||
        !std::isfinite(wavelength_um) ||
        wavelength_um < reference.minimum_wavelength_um ||
        wavelength_um > reference.maximum_wavelength_um ||
        !std::isfinite(reference.constant)) {
        throw std::invalid_argument(
            "Sellmeier optical reference is invalid"
        );
    }
    const double wavelength_squared = wavelength_um * wavelength_um;
    double index_squared = 1.0 + reference.constant;
    for (const auto& term : reference.terms) {
        if (!std::isfinite(term.numerator) ||
            !std::isfinite(term.pole_um_squared)) {
            throw std::invalid_argument(
                "Sellmeier coefficient is invalid"
            );
        }
        if (term.numerator == 0.0) continue;
        const double denominator =
            wavelength_squared - term.pole_um_squared;
        if (denominator == 0.0) {
            throw std::invalid_argument(
                "Sellmeier wavelength is singular"
            );
        }
        index_squared += term.numerator * wavelength_squared /
            denominator;
    }
    if (!std::isfinite(index_squared) || index_squared <= 0.0) {
        throw std::invalid_argument(
            "Sellmeier optical index is nonphysical"
        );
    }
    return std::sqrt(index_squared);
}

template <std::size_t ReferenceCount, std::size_t WavelengthCount>
inline std::vector<SpectralIndexObservation>
EvaluateSellmeierReferences(
    const std::array<Sellmeier2Reference, ReferenceCount>& references,
    const std::array<double, WavelengthCount>& wavelengths_um
) {
    std::vector<SpectralIndexObservation> observations;
    observations.reserve(ReferenceCount * WavelengthCount);
    for (const auto& reference : references) {
        for (const double wavelength_um : wavelengths_um) {
            observations.push_back({
                reference.artifact.stable_id,
                wavelength_um,
                EvaluateSellmeier2(reference, wavelength_um),
            });
        }
    }
    return observations;
}

inline ScalarIndexFit FitScalarIndex(
    const std::vector<SpectralIndexObservation>& source
) {
    if (source.empty()) {
        throw std::invalid_argument(
            "scalar optical-index fit requires observations"
        );
    }
    auto observations = source;
    std::sort(
        observations.begin(),
        observations.end(),
        [](const auto& first, const auto& second) {
            if (first.source_id != second.source_id) {
                return first.source_id < second.source_id;
            }
            return first.wavelength_um < second.wavelength_um;
        }
    );
    double total = 0.0;
    for (std::size_t index = 0; index < observations.size(); ++index) {
        const auto& observation = observations[index];
        if (observation.source_id.empty() ||
            !std::isfinite(observation.wavelength_um) ||
            observation.wavelength_um <= 0.0 ||
            !std::isfinite(observation.index_of_refraction) ||
            observation.index_of_refraction <= 0.0) {
            throw std::invalid_argument(
                "optical-index observation is invalid"
            );
        }
        if (index != 0 &&
            observation.source_id == observations[index - 1].source_id &&
            observation.wavelength_um ==
                observations[index - 1].wavelength_um) {
            throw std::invalid_argument(
                "optical-index observation is duplicate"
            );
        }
        total += observation.index_of_refraction;
    }
    const double count = static_cast<double>(observations.size());
    const double mean = total / count;
    double square_error = 0.0;
    for (const auto& observation : observations) {
        const double residual = observation.index_of_refraction - mean;
        square_error += residual * residual;
    }
    const double rmse = std::sqrt(square_error / count);
    const double ratio = (mean - 1.0) / (mean + 1.0);
    return {
        mean,
        ratio * ratio,
        rmse,
        rmse / std::sqrt(count),
        rmse / mean,
        observations.size(),
    };
}

inline RoadDirectionalFit FitRoadDirectionalReference(
    const RoadDirectionalReference& reference
) {
    ValidateReferenceArtifact(reference.parameter_artifact);
    ValidateReferenceArtifact(reference.material_artifact);
    const bool valid = !reference.material_name.empty() &&
        !reference.material_description.empty() &&
        reference.measured_directions != 0 &&
        std::isfinite(reference.albedo) && reference.albedo >= 0.0 &&
        reference.albedo <= 1.0 &&
        std::isfinite(
            reference.energy_normalized_oren_nayar_roughness
        ) &&
        reference.energy_normalized_oren_nayar_roughness >= 0.0 &&
        reference.energy_normalized_oren_nayar_roughness <= 1.0 &&
        std::isfinite(
            reference.energy_normalized_oren_nayar_weighted_nrmse
        ) &&
        reference.energy_normalized_oren_nayar_weighted_nrmse >= 0.0;
    if (!valid) {
        throw std::invalid_argument(
            "road directional optical reference is invalid"
        );
    }
    return {
        reference.albedo,
        reference.energy_normalized_oren_nayar_roughness,
        reference.energy_normalized_oren_nayar_weighted_nrmse,
    };
}

}  // namespace vf::material
