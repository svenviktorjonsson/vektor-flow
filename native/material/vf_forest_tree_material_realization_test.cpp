#include "native/material/vf_forest_tree_large_scene_benchmark.hpp"

#include <algorithm>
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
    std::vector<std::uint64_t> tree_ids;
    tree_ids.reserve(forest.trees.size());
    for (const auto& tree : forest.trees) {
        tree_ids.push_back(tree.tree_id);
    }
    auto reversed_ids = tree_ids;
    std::reverse(reversed_ids.begin(), reversed_ids.end());

    const auto copied = vf::material::
        RealizeForestTreeMaterialPipelineCopiedReference(
            definition,
            forest,
            tree_ids,
            tree_ids.size()
        );
    const auto direct = vf::material::
        RealizeForestTreeMaterialPipelineDirectReference(
            definition,
            forest,
            reversed_ids,
            reversed_ids.size()
        );
    require(copied == direct,
            "direct forest realization changed oracle values");
    const auto copied_packet = vf::material::
        PackForestTreeMaterialPipelineBytesDirectReference(copied);
    const auto direct_packet = vf::material::
        PackForestTreeMaterialPipelineBytesDirectReference(direct);
    require(copied_packet == direct_packet &&
                vf::material::HashDeterministicPacketBytes(
                    direct_packet
                ) == 14970851967876841848ull,
            "direct forest realization changed packet identity");

    const std::size_t copied_sample_bytes = tree_ids.size() *
        (sizeof(vf::material::TreeWoodHierarchicalSample) +
         2 * sizeof(vf::material::TreeCanopyHierarchicalSample));
    require(copied_sample_bytes == 184320,
            "forest realization scratch model changed");
    const auto copied_timing = measure(
        [&]() {
            const auto ignored = vf::material::
                RealizeForestTreeMaterialPipelineCopiedReference(
                    definition,
                    forest,
                    tree_ids,
                    tree_ids.size()
                );
            (void)ignored;
        },
        25
    );
    const auto direct_timing = measure(
        [&]() {
            const auto ignored = vf::material::
                RealizeForestTreeMaterialPipelineDirectReference(
                    definition,
                    forest,
                    tree_ids,
                    tree_ids.size()
                );
            (void)ignored;
        },
        25
    );

    std::cout << "forest tree material realization: bundles="
              << tree_ids.size()
              << " copied_sample_bytes=" << copied_sample_bytes
              << " direct_sample_bytes=0"
              << " copied_median_us=" << copied_timing.median_us
              << " direct_median_us=" << direct_timing.median_us
              << " copied_p95_us=" << copied_timing.p95_us
              << " direct_p95_us=" << direct_timing.p95_us << '\n';
    return 0;
}
