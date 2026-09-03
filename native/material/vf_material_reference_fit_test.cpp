#include "native/material/vf_material_reference_fit.hpp"
#include "native/material/vf_material_reference_subsets.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>

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
    const auto& subsets = vf::material::kMaterialReferenceSubsetsV1;
    require(subsets.size() == 4,
            "measured reference subset coverage changed");

    const std::array<std::array<double, 3>, 4> expected_means{{
        {0.1576, 0.1908, 0.2136},
        {0.0688089446, 0.0855949224, 0.102650656},
        {0.0659775436, 0.090323873, 0.104028008},
        {0.03738, 0.087, 0.04004},
    }};
    const std::array<std::array<double, 3>, 4> expected_rmse{{
        {0.0024166091947189165, 0.0025612496949731422,
         0.001019803902718558},
        {0.0011041354482519976, 0.0016032759478318904,
         0.000882847041284051},
        {0.0017100224349852957, 0.001674825122642481,
         0.00044409196135034566},
        {0.00041182520563947994, 0.00046904157598234576,
         0.0006086049621881172},
    }};

    for (std::size_t index = 0; index < subsets.size(); ++index) {
        const auto fit =
            vf::material::FitMaterialReferenceSubset(subsets[index]);
        require(fit.wavelengths_nm ==
                    std::array<std::uint16_t, 3>{450, 550, 650} &&
                    fit.observation_count == 15,
                "fit escaped the existing three-channel contract");
        for (std::size_t band = 0; band < 3; ++band) {
            require_near(
                fit.spectral_reflectance[band],
                expected_means[index][band],
                1.0e-12,
                "measured spectral fit changed"
            );
            require_near(
                fit.band_rmse[band],
                expected_rmse[index][band],
                1.0e-12,
                "measured fit RMSE changed"
            );
            require(fit.band_standard_error[band] > 0.0 &&
                        fit.normalized_rmse[band] < 0.05,
                    "measured fit uncertainty or quality is invalid");
        }
        require(fit.base_color_proxy ==
                    std::array<double, 3>{
                        fit.spectral_reflectance[2],
                        fit.spectral_reflectance[1],
                        fit.spectral_reflectance[0],
                    },
                "spectral fit did not map to current RGB field order");

        auto reversed = subsets[index];
        for (auto& band : reversed.bands) {
            std::reverse(band.begin(), band.end());
        }
        require(vf::material::FitMaterialReferenceSubset(reversed) == fit,
                "fit depended on source observation order");
    }

    auto invalid = subsets.front();
    invalid.bands[0][0].reflectance = -0.1;
    try {
        static_cast<void>(
            vf::material::FitMaterialReferenceSubset(invalid)
        );
    } catch (const std::invalid_argument& error) {
        require(std::string(error.what()).find("reflectance") !=
                    std::string::npos,
                "invalid observation produced the wrong diagnostic");
        std::cout << "material reference fits: subsets=4 observations=60\n";
        return 0;
    }
    throw std::runtime_error("invalid measured reflectance was accepted");
}
