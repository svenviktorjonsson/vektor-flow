#include "native/material/vf_forest_tree_large_scene_path.hpp"

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
    for (std::uint64_t patch = 0; patch < 64; ++patch) {
        patch_demands.push_back(
            {
                100 + patch,
                {static_cast<std::int64_t>(patch), 7},
                8,
            }
        );
    }
    const auto forest =
        vf::material::RealizeForestPopulationReference(
            forest_definition,
            patch_demands,
            512
        );
    require(forest.evaluated_candidates <= 512 * 64,
            "large forest evaluated an unbounded population");
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
        48,
    };
    std::vector<std::vector<std::uint64_t>> camera_path;
    for (std::size_t start = 0; start + 32 <= 512; start += 8) {
        std::vector<std::uint64_t> view;
        for (std::size_t index = start;
             index < start + 32;
             ++index) {
            view.push_back(forest.trees[index].tree_id);
        }
        camera_path.push_back(view);
        std::reverse(view.begin(), view.end());
        camera_path.push_back(std::move(view));
    }
    constexpr std::size_t bundle_bytes =
        vf::material::kForestTreeMaterialBundleBytes;
    const auto report =
        vf::material::AuditForestTreeLargeScenePathReference(
            definition,
            forest,
            camera_path
        );
    require(report.logical_tree_capacity ==
                1000000000000000000ull &&
                report.population_trees == 512 &&
                report.unique_demanded_trees == 512,
            "large forest path materialized the logical population");
    require(report.frame_count == 122 &&
                report.stable_frames == 61,
            "large forest path lost stable duplicate frames");
    require(report.path_version == 3079309886320442288ull,
            "large forest path version changed nondeterministically");
    require(report.peak_resident_bytes == 48 * bundle_bytes &&
                report.first_frame_upload_bytes ==
                    32 * bundle_bytes &&
                report.peak_steady_upload_bytes ==
                    8 * bundle_bytes &&
                report.total_upload_bytes == 512 * bundle_bytes,
            "large forest path escaped upload or residency bounds");
    for (std::size_t index = 1;
         index < report.frame_upload_bytes.size();
         index += 2) {
        require(report.frame_upload_bytes[index] == 0,
                "reversed stable forest frame uploaded data");
    }

    auto reversed_path = camera_path;
    for (auto& view : reversed_path) {
        std::reverse(view.begin(), view.end());
    }
    const auto replay =
        vf::material::AuditForestTreeLargeScenePathReference(
            definition,
            forest,
            reversed_path
        );
    require(replay.frame_versions == report.frame_versions &&
                replay.cache_versions == report.cache_versions &&
                replay.frame_upload_bytes ==
                    report.frame_upload_bytes &&
                replay.path_version == report.path_version,
            "large forest path changed under traversal replay");

    std::cout << "forest tree large scene: population="
              << report.population_trees
              << " frames=" << report.frame_count
              << " unique=" << report.unique_demanded_trees
              << " peak_resident=" << report.peak_resident_bytes
              << " steady_upload="
              << report.peak_steady_upload_bytes
              << " total_upload=" << report.total_upload_bytes
              << " version=" << report.path_version << '\n';
    return 0;
}
