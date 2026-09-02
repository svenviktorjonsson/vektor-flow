#include "native/material/vf_forest_spatial_sampling.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

std::vector<vf::material::ForestPatchDemand> patch_grid(
    std::uint64_t first_patch,
    std::size_t side,
    std::size_t trees_per_patch
) {
    std::vector<vf::material::ForestPatchDemand> demands;
    for (std::size_t patch = 0; patch < side * side; ++patch) {
        demands.push_back(
            {
                first_patch + patch,
                {
                    static_cast<std::int64_t>(patch % side),
                    static_cast<std::int64_t>(patch / side),
                },
                trees_per_patch,
            }
        );
    }
    return demands;
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
    auto base_demands = patch_grid(500, 8, 16);
    const auto base_population =
        vf::material::RealizeForestPopulationReference(
            definition,
            base_demands,
            1024
        );
    const auto exact =
        vf::material::AuditForestSpatialQualityReference(
            base_population,
            96.0,
            320.0
        );
    const auto sampled =
        vf::material::SampleForestSpatialQualityReference(
            base_population,
            96.0,
            320.0,
            200000
        );
    require(sampled.evaluated_pairs == 200000 &&
                sampled.near_pair_count > 10000 &&
                sampled.far_pair_count > 10000,
            "sampled forest audit did not use its pair budget");
    require(std::abs(
                sampled.near_environment_similarity -
                exact.near_environment_similarity
            ) < 0.02 &&
                std::abs(
                    sampled.far_environment_similarity -
                    exact.far_environment_similarity
                ) < 0.02 &&
                std::abs(
                    sampled.near_same_species_fraction -
                    exact.near_same_species_fraction
                ) < 0.02 &&
                std::abs(
                    sampled.far_same_species_fraction -
                    exact.far_same_species_fraction
                ) < 0.02,
            "sampled forest audit diverged from the exact oracle");

    std::reverse(base_demands.begin(), base_demands.end());
    const auto replay_population =
        vf::material::RealizeForestPopulationReference(
            definition,
            base_demands,
            1024
        );
    const auto replay =
        vf::material::SampleForestSpatialQualityReference(
            replay_population,
            96.0,
            320.0,
            200000
        );
    require(replay_population == base_population &&
                replay == sampled,
            "sampled forest audit changed under traversal replay");

    const auto large_population =
        vf::material::RealizeForestPopulationReference(
            definition,
            patch_grid(600, 16, 16),
            4096
        );
    const auto large =
        vf::material::SampleForestSpatialQualityReference(
            large_population,
            96.0,
            640.0,
            200000
        );
    const std::size_t all_large_pairs =
        large_population.trees.size() *
        (large_population.trees.size() - 1) / 2;
    require(large.tree_count == 4096 &&
                large.evaluated_pairs == 200000 &&
                large.evaluated_pairs * 20 < all_large_pairs &&
                large.population_version == 5469603067019739383ull,
            "large forest audit regressed to quadratic evaluation");

    std::cout << "forest spatial sampling: base_pairs="
              << sampled.evaluated_pairs
              << " near_env_error=" << std::abs(
                  sampled.near_environment_similarity -
                  exact.near_environment_similarity
              )
              << " near_species_error=" << std::abs(
                  sampled.near_same_species_fraction -
                  exact.near_same_species_fraction
              )
              << " large_trees=" << large.tree_count
              << " large_pairs=" << large.evaluated_pairs
              << " all_pairs=" << all_large_pairs
              << " version=" << large.population_version << '\n';
    return 0;
}
