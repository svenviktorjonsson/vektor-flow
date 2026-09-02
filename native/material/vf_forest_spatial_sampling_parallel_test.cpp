#include "native/material/vf_forest_spatial_sampling_parallel.hpp"

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
            patch_grid(900, 16, 16),
            4096
        );
    const auto blocks =
        vf::material::BuildForestSpatialSamplingBlocksReference(
            200000,
            4096
        );
    const auto serial =
        vf::material::SampleForestSpatialQualityBlocksReference(
            population,
            96.0,
            640.0,
            200000,
            blocks
        );
    const auto one =
        vf::material::SampleForestSpatialQualityParallelReference(
            population,
            96.0,
            640.0,
            200000,
            4096,
            1
        );
    const auto two =
        vf::material::SampleForestSpatialQualityParallelReference(
            population,
            96.0,
            640.0,
            200000,
            4096,
            2
        );
    const auto four =
        vf::material::SampleForestSpatialQualityParallelReference(
            population,
            96.0,
            640.0,
            200000,
            4096,
            4
        );
    require(one.sample == serial &&
                two.sample == serial &&
                four.sample == serial,
            "forest worker count changed the audit result");
    require(one.worker_count == 1 &&
                two.worker_count == 2 &&
                four.worker_count == 4 &&
                one.block_count == blocks.size() &&
                two.block_count == blocks.size() &&
                four.block_count == blocks.size(),
            "forest parallel audit did not execute fixed blocks");

    bool rejected_zero_workers = false;
    try {
        static_cast<void>(
            vf::material::SampleForestSpatialQualityParallelReference(
                population,
                96.0,
                640.0,
                200000,
                4096,
                0
            )
        );
    } catch (const std::invalid_argument&) {
        rejected_zero_workers = true;
    }
    require(rejected_zero_workers,
            "forest parallel audit accepted zero workers");

    std::cout << "forest spatial parallel: blocks="
              << four.block_count
              << " workers=" << four.worker_count
              << " pairs=" << four.sample.evaluated_pairs
              << " near=" << four.sample.near_pair_count
              << " far=" << four.sample.far_pair_count
              << " version=" << four.sample.population_version
              << '\n';
    return 0;
}
