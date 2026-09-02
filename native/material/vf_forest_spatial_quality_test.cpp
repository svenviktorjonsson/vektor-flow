#include "native/material/vf_forest_spatial_quality.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    const vf::material::ForestPopulationDefinition definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31,
        5,
        1000000000ull,
        1000000000ull,
        64.0,
        8.0,
    };
    std::vector<vf::material::ForestPatchDemand> demands;
    for (std::uint64_t patch = 0; patch < 64; ++patch) {
        demands.push_back(
            {
                400 + patch,
                {
                    static_cast<std::int64_t>(patch % 8),
                    static_cast<std::int64_t>(patch / 8),
                },
                16,
            }
        );
    }
    const auto population =
        vf::material::RealizeForestPopulationReference(
            definition,
            demands,
            1024
        );
    const auto report =
        vf::material::AuditForestSpatialQualityReference(
            population,
            96.0,
            320.0
        );
    require(report.tree_count == 1024 &&
                report.near_pair_count > 10000 &&
                report.far_pair_count > 10000,
            "forest spatial audit lacked pair support");
    require(report.near_environment_similarity >
                    report.far_environment_similarity + 0.10,
            "forest environment lost designed spatial coherence");
    require(report.near_same_species_fraction >
                    report.far_same_species_fraction,
            "forest species marks lost environment conditioning");
    require(report.health_environment_correlation > 0.60 &&
                report.health_environment_correlation <= 1.0,
            "forest health lost environment conditioning");
    require(report.orientation_resultant < 0.10,
            "forest orientation generator developed strong bias");
    require(report.population_version == 3403635379503177351ull,
            "forest spatial population changed nondeterministically");

    std::reverse(demands.begin(), demands.end());
    const auto replay_population =
        vf::material::RealizeForestPopulationReference(
            definition,
            demands,
            1024
        );
    const auto replay =
        vf::material::AuditForestSpatialQualityReference(
            replay_population,
            96.0,
            320.0
        );
    require(replay_population == population && replay == report,
            "forest spatial audit changed under traversal replay");

    std::cout << "forest spatial quality: trees="
              << report.tree_count
              << " near_pairs=" << report.near_pair_count
              << " far_pairs=" << report.far_pair_count
              << " near_env="
              << report.near_environment_similarity
              << " far_env="
              << report.far_environment_similarity
              << " near_species="
              << report.near_same_species_fraction
              << " far_species="
              << report.far_same_species_fraction
              << " health_env_r="
              << report.health_environment_correlation
              << " orientation_bias="
              << report.orientation_resultant
              << " version=" << report.population_version << '\n';
    return 0;
}
