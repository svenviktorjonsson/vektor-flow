#include "native/material/vf_forest_tree_large_scene_benchmark.hpp"

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
    const auto synthetic =
        vf::material::SummarizeForestTreeTimingsReference(
            {9.0, 1.0, 5.0, 2.0, 8.0,
             3.0, 7.0, 4.0, 6.0, 10.0}
        );
    require(synthetic.minimum_us == 1.0 &&
                synthetic.median_us == 5.0 &&
                synthetic.p95_us == 10.0 &&
                synthetic.p99_us == 10.0 &&
                synthetic.maximum_us == 10.0,
            "forest benchmark quantiles are not nearest-rank");

    const vf::material::ForestPopulationDefinition forest_definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31,
        5,
        1000000000ull,
        1000000000ull,
        64.0,
        10.0,
    };
    std::vector<vf::material::ForestPatchDemand> patch_demands;
    for (std::uint64_t patch = 0; patch < 16; ++patch) {
        patch_demands.push_back(
            {
                200 + patch,
                {static_cast<std::int64_t>(patch), 11},
                8,
            }
        );
    }
    const auto forest =
        vf::material::RealizeForestPopulationReference(
            forest_definition,
            patch_demands,
            128
        );
    const vf::material::ForestTreeCameraResidencyDefinition definition{
        {
            forest_definition,
            {
                forest_definition.seed,
                forest_definition.population_id,
                forest_definition.species_count,
                1000000000000000000ull,
                1000000000ull,
            },
            1000000000ull,
        },
        24,
    };
    std::vector<std::vector<std::uint64_t>> camera_path;
    for (std::size_t start = 0; start + 16 <= 128; start += 4) {
        std::vector<std::uint64_t> view;
        for (std::size_t index = start;
             index < start + 16;
             ++index) {
            view.push_back(forest.trees[index].tree_id);
        }
        camera_path.push_back(view);
        std::reverse(view.begin(), view.end());
        camera_path.push_back(std::move(view));
    }
    const auto benchmark =
        vf::material::BenchmarkForestTreeLargeScenePathReference(
            definition,
            forest,
            camera_path,
            2,
            20
        );
    require(benchmark.steady.samples_us.size() == 20 &&
                benchmark.first_use_us >= 0.0 &&
                benchmark.steady.minimum_us >= 0.0 &&
                benchmark.steady.minimum_us <=
                    benchmark.steady.median_us &&
                benchmark.steady.median_us <=
                    benchmark.steady.p95_us &&
                benchmark.steady.p95_us <=
                    benchmark.steady.p99_us &&
                benchmark.steady.p99_us <=
                    benchmark.steady.maximum_us,
            "forest benchmark timing distribution is invalid");
    require(benchmark.path_version != 0 &&
                benchmark.verified_runs == 23,
            "forest benchmark did not verify every timed run");
    require(benchmark.path_version == 2091537119291143757ull,
            "forest benchmark path changed nondeterministically");

    std::cout << "forest tree benchmark: runs="
              << benchmark.steady.samples_us.size()
              << " first_us=" << benchmark.first_use_us
              << " median_us=" << benchmark.steady.median_us
              << " p95_us=" << benchmark.steady.p95_us
              << " p99_us=" << benchmark.steady.p99_us
              << " version=" << benchmark.path_version << '\n';
    return 0;
}
