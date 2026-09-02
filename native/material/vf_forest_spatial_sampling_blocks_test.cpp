#include "native/material/vf_forest_spatial_sampling_blocks.hpp"

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
    const auto population =
        vf::material::RealizeForestPopulationReference(
            definition,
            patch_grid(800, 8, 16),
            1024
        );
    const auto serial =
        vf::material::SampleForestSpatialQualityReference(
            population,
            96.0,
            320.0,
            200000
        );
    const auto blocks =
        vf::material::BuildForestSpatialSamplingBlocksReference(
            200000,
            4096
        );
    require(blocks.size() == 49 &&
                blocks.front().first_sample == 0 &&
                blocks.front().sample_count == 4096 &&
                blocks.back().first_sample == 196608 &&
                blocks.back().sample_count == 3392,
            "forest sample blocks did not cover the budget");

    const auto forward =
        vf::material::SampleForestSpatialQualityBlocksReference(
            population,
            96.0,
            320.0,
            200000,
            blocks
        );
    auto reversed_blocks = blocks;
    std::reverse(reversed_blocks.begin(), reversed_blocks.end());
    const auto reverse =
        vf::material::SampleForestSpatialQualityBlocksReference(
            population,
            96.0,
            320.0,
            200000,
            reversed_blocks
        );
    auto rotated_blocks = blocks;
    std::rotate(
        rotated_blocks.begin(),
        rotated_blocks.begin() + 17,
        rotated_blocks.end()
    );
    const auto rotated =
        vf::material::SampleForestSpatialQualityBlocksReference(
            population,
            96.0,
            320.0,
            200000,
            rotated_blocks
        );
    require(forward == reverse && forward == rotated,
            "forest block completion order changed the audit");
    require(forward.tree_count == serial.tree_count &&
                forward.evaluated_pairs == serial.evaluated_pairs &&
                forward.near_pair_count == serial.near_pair_count &&
                forward.far_pair_count == serial.far_pair_count &&
                forward.population_version ==
                    serial.population_version,
            "forest blocked audit changed its sampled pairs");
    require(std::abs(
                forward.near_environment_similarity -
                serial.near_environment_similarity
            ) < 1.0e-12 &&
                std::abs(
                    forward.far_environment_similarity -
                    serial.far_environment_similarity
                ) < 1.0e-12 &&
                std::abs(
                    forward.near_same_species_fraction -
                    serial.near_same_species_fraction
                ) < 1.0e-12 &&
                std::abs(
                    forward.far_same_species_fraction -
                    serial.far_same_species_fraction
                ) < 1.0e-12,
            "forest blocked audit diverged from serial reference");

    auto incomplete_blocks = blocks;
    incomplete_blocks.pop_back();
    bool rejected_incomplete = false;
    try {
        static_cast<void>(
            vf::material::SampleForestSpatialQualityBlocksReference(
                population,
                96.0,
                320.0,
                200000,
                incomplete_blocks
            )
        );
    } catch (const std::invalid_argument&) {
        rejected_incomplete = true;
    }
    require(rejected_incomplete,
            "forest blocked audit accepted incomplete work");

    std::cout << "forest spatial blocks: blocks="
              << blocks.size()
              << " pairs=" << forward.evaluated_pairs
              << " near=" << forward.near_pair_count
              << " far=" << forward.far_pair_count
              << " version=" << forward.population_version << '\n';
    return 0;
}
