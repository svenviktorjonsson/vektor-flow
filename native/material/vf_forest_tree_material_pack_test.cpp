#include "native/material/vf_forest_tree_large_scene_benchmark.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

template <class Function>
vf::material::ForestTreeTimingDistribution measure(
    Function&& function,
    std::size_t runs
) {
    using Clock = std::chrono::steady_clock;
    std::vector<double> samples;
    samples.reserve(runs);
    for (std::size_t run = 0; run < runs; ++run) {
        const auto start = Clock::now();
        function();
        const auto finish = Clock::now();
        samples.push_back(
            std::chrono::duration<double, std::micro>(
                finish - start
            ).count()
        );
    }
    return vf::material::SummarizeForestTreeTimingsReference(
        std::move(samples)
    );
}

std::vector<std::uint8_t> pack_oracle(
    const vf::material::ForestTreeMaterialPipelineRealization&
        realization
) {
    vf::material::ValidateForestTreeMaterialPipelineForPacking(
        realization
    );
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        realization.bundles.size() *
        vf::material::kForestTreeMaterialBundleBytes
    );
    for (const auto& bundle : realization.bundles) {
        const auto population_bytes =
            vf::material::PackForestPopulationBytesReference(
                {1, realization.logical_tree_capacity,
                 {bundle.population}, 0}
            );
        const auto wood_energy =
            vf::material::EvaluateTreeWoodEnergyReference(
                {bundle.wood}
            );
        const auto wood_bytes =
            vf::material::PackTreeWoodMaterialBytesReference(
                {
                    realization.logical_tree_capacity,
                    1,
                    {bundle.wood},
                    wood_energy,
                }
            );
        const std::vector<vf::material::TreeCanopyHierarchicalSample>
            canopy_samples{bundle.bark, bundle.foliage};
        const auto canopy_energy =
            vf::material::EvaluateTreeCanopyEnergyReference(
                canopy_samples
            );
        const auto canopy_bytes =
            vf::material::PackTreeCanopyHierarchicalBytesReference(
                {
                    realization.logical_tree_capacity,
                    2,
                    canopy_samples,
                    canopy_energy,
                }
            );
        bytes.insert(
            bytes.end(),
            population_bytes.begin(),
            population_bytes.end()
        );
        bytes.insert(
            bytes.end(),
            wood_bytes.begin(),
            wood_bytes.end()
        );
        bytes.insert(
            bytes.end(),
            canopy_bytes.begin(),
            canopy_bytes.end()
        );
    }
    return bytes;
}

}  // namespace

int main() {
    const vf::material::ForestPopulationDefinition forest_definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31,
        5,
        1000000000ull,
        1000000000ull,
        64.0,
        0.0,
    };
    std::vector<vf::material::ForestPatchDemand> demands;
    for (std::uint64_t patch = 0; patch < 16; ++patch) {
        demands.push_back(
            {
                2200 + patch,
                {
                    static_cast<std::int64_t>(patch % 4),
                    static_cast<std::int64_t>(patch / 4),
                },
                32,
            }
        );
    }
    const auto forest =
        vf::material::RealizeForestPopulationReference(
            forest_definition,
            demands,
            512
        );
    const vf::material::ForestTreeMaterialPipelineDefinition definition{
        forest_definition,
        {
            forest_definition.seed,
            forest_definition.population_id,
            forest_definition.species_count,
            1000000000000000000ull,
            1000000000ull,
        },
        1000000000ull,
    };
    std::vector<std::uint64_t> demanded_tree_ids;
    demanded_tree_ids.reserve(forest.trees.size());
    for (const auto& tree : forest.trees) {
        demanded_tree_ids.push_back(tree.tree_id);
    }
    const auto realization =
        vf::material::RealizeForestTreeMaterialPipelineReference(
            definition,
            forest,
            demanded_tree_ids,
            demanded_tree_ids.size()
        );
    const auto expected =
        pack_oracle(realization);
    const auto direct =
        vf::material::
            PackForestTreeMaterialPipelineBytesDirectReference(
                realization
            );
    const std::uint64_t expected_version =
        vf::material::HashDeterministicPacketBytes(expected);
    require(expected.size() ==
                512 * vf::material::kForestTreeMaterialBundleBytes &&
                direct == expected &&
                expected_version == 14970851967876841848ull,
            "forest material pack changed bounded output size");

    const auto baseline = measure(
        [&]() {
            const auto bytes =
                pack_oracle(realization);
            require(bytes == expected,
                    "forest material pack changed during timing");
        },
        25
    );
    const auto direct_timing = measure(
        [&]() {
            const auto bytes =
                vf::material::
                    PackForestTreeMaterialPipelineBytesDirectReference(
                        realization
                    );
            require(bytes == expected,
                    "direct forest material pack changed during timing");
        },
        25
    );

    std::cout << "forest tree material pack: bundles="
              << realization.bundles.size()
              << " bytes=" << expected.size()
              << " baseline_median_us=" << baseline.median_us
              << " direct_median_us=" << direct_timing.median_us
              << " baseline_p95_us=" << baseline.p95_us
              << " direct_p95_us=" << direct_timing.p95_us
              << " version=" << expected_version << '\n';
    return 0;
}
