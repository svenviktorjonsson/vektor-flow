#include "native/material/vf_forest_population_quality.hpp"

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
                300 + patch,
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
        vf::material::AuditForestPopulationQualityReference(
            population,
            definition.species_count
        );
    require(report.tree_count == 1024 &&
                report.mark_bound_violations == 0 &&
                report.species_counts.size() == 5,
            "forest quality audit omitted or invalidated trees");
    for (const std::size_t count : report.species_counts) {
        require(count != 0,
                "forest quality audit lost a species stratum");
    }
    require(report.minimum_within_patch_spacing >= 8.0 &&
                report.mean_age > 0.35 && report.mean_age < 0.70 &&
                report.mean_size > 0.35 && report.mean_size < 0.75 &&
                report.mean_health > 0.45 &&
                report.mean_health < 0.90,
            "forest generator invariants escaped declared bounds");
    require(report.age_size_correlation > 0.75 &&
                report.age_size_correlation <= 1.0,
            "forest size lost its designed age conditioning");
    require(report.population_version == 13837413865132231587ull,
            "forest quality population changed nondeterministically");

    std::reverse(demands.begin(), demands.end());
    const auto replay_population =
        vf::material::RealizeForestPopulationReference(
            definition,
            demands,
            1024
        );
    const auto replay_report =
        vf::material::AuditForestPopulationQualityReference(
            replay_population,
            definition.species_count
        );
    require(replay_population == population &&
                replay_report == report,
            "forest quality changed under demand traversal replay");

    std::cout << "forest population quality: trees="
              << report.tree_count
              << " species=";
    for (const std::size_t count : report.species_counts) {
        std::cout << count << ',';
    }
    std::cout << " mean_age=" << report.mean_age
              << " mean_size=" << report.mean_size
              << " mean_health=" << report.mean_health
              << " age_size_r=" << report.age_size_correlation
              << " min_spacing="
              << report.minimum_within_patch_spacing
              << " version=" << report.population_version << '\n';
    return 0;
}
