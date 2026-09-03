#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string_view>

namespace vf::material {

struct SpectralReferenceObservation {
    std::uint16_t wavelength_nm;
    double reflectance;
};

struct MaterialReferenceSubset {
    std::string_view stable_id;
    std::string_view source_url;
    std::string_view source_sha256;
    std::array<std::array<SpectralReferenceObservation, 5>, 3> bands;
};

struct MaterialReferenceFit {
    std::array<std::uint16_t, 3> wavelengths_nm;
    std::array<double, 3> spectral_reflectance;
    std::array<double, 3> base_color_proxy;
    std::array<double, 3> band_rmse;
    std::array<double, 3> band_standard_error;
    std::array<double, 3> normalized_rmse;
    std::size_t observation_count;
};

inline bool operator==(
    const MaterialReferenceFit& first,
    const MaterialReferenceFit& second
) {
    return first.wavelengths_nm == second.wavelengths_nm &&
        first.spectral_reflectance == second.spectral_reflectance &&
        first.base_color_proxy == second.base_color_proxy &&
        first.band_rmse == second.band_rmse &&
        first.band_standard_error == second.band_standard_error &&
        first.normalized_rmse == second.normalized_rmse &&
        first.observation_count == second.observation_count;
}

inline bool IsUpperHexSha256(std::string_view value) {
    if (value.size() != 64) return false;
    for (const char character : value) {
        const bool digit = character >= '0' && character <= '9';
        const bool upper_hex = character >= 'A' && character <= 'F';
        if (!digit && !upper_hex) return false;
    }
    return true;
}

inline MaterialReferenceFit FitMaterialReferenceSubset(
    const MaterialReferenceSubset& subset
) {
    if (subset.stable_id.empty() ||
        !subset.source_url.starts_with("https://") ||
        !IsUpperHexSha256(subset.source_sha256)) {
        throw std::invalid_argument(
            "measured reference subset provenance is invalid"
        );
    }
    constexpr std::array<std::uint16_t, 3> centers{450, 550, 650};
    MaterialReferenceFit fit{
        centers,
        {},
        {},
        {},
        {},
        {},
        0,
    };
    for (std::size_t band_index = 0;
         band_index < subset.bands.size();
         ++band_index) {
        auto band = subset.bands[band_index];
        std::sort(
            band.begin(),
            band.end(),
            [](const auto& first, const auto& second) {
                return first.wavelength_nm < second.wavelength_nm;
            }
        );
        double total = 0.0;
        for (std::size_t index = 0; index < band.size(); ++index) {
            const auto& observation = band[index];
            const int distance = std::abs(
                static_cast<int>(observation.wavelength_nm) -
                static_cast<int>(centers[band_index])
            );
            if (distance > 10 || !std::isfinite(observation.reflectance) ||
                observation.reflectance < 0.0 ||
                observation.reflectance > 1.0) {
                throw std::invalid_argument(
                    "measured reference reflectance is invalid"
                );
            }
            if (index != 0 &&
                observation.wavelength_nm ==
                    band[index - 1].wavelength_nm) {
                throw std::invalid_argument(
                    "measured reference wavelength is duplicate"
                );
            }
            total += observation.reflectance;
        }
        const double mean = total / static_cast<double>(band.size());
        double square_error = 0.0;
        for (const auto& observation : band) {
            const double residual = observation.reflectance - mean;
            square_error += residual * residual;
        }
        const double rmse = std::sqrt(
            square_error / static_cast<double>(band.size())
        );
        fit.spectral_reflectance[band_index] = mean;
        fit.band_rmse[band_index] = rmse;
        fit.band_standard_error[band_index] = rmse /
            std::sqrt(static_cast<double>(band.size()));
        fit.normalized_rmse[band_index] = rmse / mean;
        fit.observation_count += band.size();
    }
    fit.base_color_proxy = {
        fit.spectral_reflectance[2],
        fit.spectral_reflectance[1],
        fit.spectral_reflectance[0],
    };
    return fit;
}

}  // namespace vf::material
