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

template <class Function>
bool accepts(Function&& function) {
    try {
        function();
        return true;
    } catch (const std::domain_error&) {
        return false;
    }
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
                2300 + patch,
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
    std::vector<std::uint64_t> tree_ids;
    tree_ids.reserve(forest.trees.size());
    for (const auto& tree : forest.trees) {
        tree_ids.push_back(tree.tree_id);
    }
    const auto realization =
        vf::material::RealizeForestTreeMaterialPipelineReference(
            definition,
            forest,
            tree_ids,
            tree_ids.size()
        );
    vf::material::ValidateForestTreeMaterialPipelineForPacking(
        realization
    );
    vf::material::ValidateForestTreeMaterialPipelineDirectReference(
        realization
    );

    auto invalid_population = realization;
    invalid_population.bundles.front().population.age = 2.0f;
    auto invalid_wood_energy = realization;
    invalid_wood_energy.wood_energy.values.front() += 0.01f;
    auto invalid_canopy = realization;
    invalid_canopy.bundles.back().foliage.radius = -0.1f;
    for (const auto* invalid : {
             &invalid_population,
             &invalid_wood_energy,
             &invalid_canopy,
         }) {
        const bool oracle_accepts = accepts(
            [&]() {
                vf::material::
                    ValidateForestTreeMaterialPipelineForPacking(
                        *invalid
                    );
            }
        );
        const bool direct_accepts = accepts(
            [&]() {
                vf::material::
                    ValidateForestTreeMaterialPipelineDirectReference(
                        *invalid
                    );
            }
        );
        require(oracle_accepts == direct_accepts &&
                    !direct_accepts,
                "direct forest validation changed rejection parity");
    }

    const std::size_t copied_sample_bytes =
        realization.bundles.size() *
        (sizeof(vf::material::ForestPopulationTree) +
         sizeof(vf::material::TreeWoodHierarchicalSample) +
         2 * sizeof(vf::material::TreeCanopyHierarchicalSample));
    require(copied_sample_bytes == 225280,
            "forest validation scratch model changed");

    const auto oracle_timing = measure(
        [&]() {
            vf::material::
                ValidateForestTreeMaterialPipelineForPacking(
                    realization
                );
        },
        25
    );
    const auto direct_timing = measure(
        [&]() {
            vf::material::
                ValidateForestTreeMaterialPipelineDirectReference(
                    realization
                );
        },
        25
    );

    std::cout << "forest tree material validation: bundles="
              << realization.bundles.size()
              << " copied_sample_bytes=" << copied_sample_bytes
              << " direct_sample_bytes=0"
              << " oracle_median_us=" << oracle_timing.median_us
              << " direct_median_us=" << direct_timing.median_us
              << " oracle_p95_us=" << oracle_timing.p95_us
              << " direct_p95_us=" << direct_timing.p95_us << '\n';
    return 0;
}
