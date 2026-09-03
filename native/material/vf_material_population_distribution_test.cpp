#include "native/material/vf_material_population_distribution.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <stdexcept>

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

    const auto distributions = BuildMeasuredPopulationDistributionsV1();
    require(distributions.size() == 4,
            "measured population family coverage changed");
    constexpr std::array<std::size_t, 4> member_counts{4, 5, 5, 4};
    for (std::size_t index = 0; index < distributions.size(); ++index) {
        const auto& distribution = distributions[index];
        require(static_cast<std::size_t>(distribution.family) == index,
                "measured population order is not canonical");
        require(distribution.members.size() == member_counts[index],
                "measured member count changed");
        ValidateMeasuredPopulationDistribution(distribution);
        require(distribution == BuildMeasuredPopulationDistributionV1(
                    distribution.family
                ),
                "measured population generation is not deterministic");

        for (std::size_t band = 0; band < 3; ++band) {
            double factor_sum = 0.0;
            for (std::size_t member = 0;
                 member < distribution.members.size();
                 ++member) {
                factor_sum += distribution.centered_factors[member][band];
                require_near(
                    distribution.centered_factors[member][band] *
                        distribution.measured_mean[band],
                    distribution.members[member].spectral_reflectance[band],
                    1.0e-14,
                    "centered factor does not reconstruct measurement"
                );
            }
            require_near(
                factor_sum /
                    static_cast<double>(distribution.members.size()),
                1.0,
                1.0e-14,
                "population factors are not centered around preset"
            );
            require(distribution.population_factor_standard_deviation[band] >
                        distribution.fit_relative_standard_error_rms[band],
                    "fit error was reused as population variation");
        }
    }

    require_near(
        distributions[1].members[0].spectral_reflectance[0],
        0.0689328,
        1.0e-14,
        "measured road member changed"
    );
    require(distributions[1].population_scope ==
                PopulationMeasurementScope::surface_condition_series,
            "road support was mislabeled as a natural rock population");
    require(distributions[2].population_scope ==
                PopulationMeasurementScope::weathering_series,
            "wood weathering support was not retained");
    require(distributions[3].population_scope ==
                PopulationMeasurementScope::leaf_state_series,
            "leaf state support was not retained");

    std::array<MaterialOpticalFamily, 4> reverse_families{
        MaterialOpticalFamily::vegetation,
        MaterialOpticalFamily::wood,
        MaterialOpticalFamily::road,
        MaterialOpticalFamily::stone,
    };
    std::array<MeasuredPopulationDistribution, 4> reverse_distributions;
    std::transform(
        reverse_families.begin(),
        reverse_families.end(),
        reverse_distributions.begin(),
        [](const auto family) {
            return BuildMeasuredPopulationDistributionV1(family);
        }
    );
    std::reverse(
        reverse_distributions.begin(),
        reverse_distributions.end()
    );
    require(reverse_distributions == distributions,
            "population output depended on family traversal");

    auto invalid = distributions[2];
    invalid.members[1].stable_id = invalid.members[0].stable_id;
    try {
        ValidateMeasuredPopulationDistribution(invalid);
    } catch (const std::invalid_argument&) {
        std::cout << std::setprecision(10);
        for (const auto& distribution : distributions) {
            std::cout << "family="
                      << static_cast<std::size_t>(distribution.family)
                      << " population_sd=";
            for (const double value :
                 distribution.population_factor_standard_deviation) {
                std::cout << value << ',';
            }
            std::cout << " fit_relative_se_rms=";
            for (const double value :
                 distribution.fit_relative_standard_error_rms) {
                std::cout << value << ',';
            }
            std::cout << '\n';
        }
        std::cout << "measured population distributions: families=4 "
                     "members=18 fit-error-separate=true\n";
        return 0;
    }
    throw std::runtime_error("duplicate measured member was accepted");
}
