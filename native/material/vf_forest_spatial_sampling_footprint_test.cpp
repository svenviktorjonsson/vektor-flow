#include "native/material/vf_forest_spatial_sampling_executor.hpp"

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
            patch_grid(1500, 16, 16),
            4096
        );
    const auto prepared =
        vf::material::PrepareForestSpatialSamplingReference(
            population,
            96.0,
            640.0,
            200000,
            4096
        );
    require(
        vf::material::PreparedForestSpatialSamplingStorageBytesReference(
            prepared
        ) == 3400784,
        "forest prepared audit retained redundant pair storage"
    );
    require(prepared.population_version == 1415625329643559388ull,
            "forest prepared footprint population changed");
    const auto transient_pairs =
        vf::material::BuildForestSpatialSamplePairsReference(
            prepared.population_version,
            population.trees.size(),
            prepared.pair_budget
        );
    require(transient_pairs.size() == prepared.pair_budget,
            "forest transient pair oracle changed its bound");
    const auto indexed =
        vf::material::
            SampleForestSpatialQualityPreparedPairsParallelReference(
                prepared,
                transient_pairs,
                4
            );
    const auto observed =
        vf::material::
            SampleForestSpatialQualityPreparedParallelReference(
                prepared,
                4
            );
    vf::material::ForestSpatialSamplingExecutorReference executor(4);
    require(indexed.sample == observed.sample &&
                executor.sample(prepared).sample == observed.sample,
            "forest footprint reduction changed audit result");

    std::cout << "forest spatial footprint: pairs="
              << prepared.pair_budget
              << " retained_bytes="
              << vf::material::
                  PreparedForestSpatialSamplingStorageBytesReference(
                      prepared
                  )
              << " transient_pair_bytes="
              << transient_pairs.size() *
                  sizeof(vf::material::ForestSpatialSamplePair)
              << " version=" << prepared.population_version << '\n';
    return 0;
}
