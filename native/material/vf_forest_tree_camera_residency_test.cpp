#include "native/material/vf_forest_tree_camera_residency.hpp"

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
        12.0,
    };
    const auto forest =
        vf::material::RealizeForestPopulationReference(
            forest_definition,
            {{3, {1, 3}, 4}, {9, {2, 3}, 4}},
            8
        );
    const vf::material::ForestTreeMaterialPipelineDefinition pipeline{
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
    const vf::material::ForestTreeCameraResidencyDefinition definition{
        pipeline,
        4,
    };
    std::vector<std::uint64_t> first_view;
    for (std::size_t index = 0; index < 4; ++index) {
        first_view.push_back(forest.trees[index].tree_id);
    }
    std::reverse(first_view.begin(), first_view.end());
    constexpr std::size_t bundle_bytes =
        vf::material::kForestTreeMaterialBundleBytes;
    const auto first =
        vf::material::UpdateForestTreeCameraResidencyReference(
            definition,
            forest,
            first_view,
            nullptr
        );
    require(first.cache.size() == 4 &&
                first.upload_bytes == 4 * bundle_bytes &&
                first.resident_bytes == 4 * bundle_bytes &&
                first.evicted_tree_ids.empty(),
            "first camera view escaped bounded forest residency");
    require(first.frame_version == 13159085143290202624ull &&
                first.cache_version == 14088357325055264004ull,
            "forest camera versions changed nondeterministically");

    std::reverse(first_view.begin(), first_view.end());
    const auto stable =
        vf::material::UpdateForestTreeCameraResidencyReference(
            definition,
            forest,
            first_view,
            &first
        );
    require(stable.upload_bytes == 0 &&
                stable.evicted_tree_ids.empty() &&
                stable.resident_bytes == first.resident_bytes &&
                stable.frame_version == first.frame_version &&
                stable.cache_version == first.cache_version,
            "stable or reversed camera view uploaded forest data");

    auto moved_view = first_view;
    moved_view.erase(moved_view.begin());
    moved_view.push_back(forest.trees[4].tree_id);
    const auto moved =
        vf::material::UpdateForestTreeCameraResidencyReference(
            definition,
            forest,
            moved_view,
            &stable
        );
    require(moved.upload_bytes == bundle_bytes &&
                moved.resident_bytes == 4 * bundle_bytes &&
                moved.evicted_tree_ids.size() == 1 &&
                moved.evicted_tree_ids[0] == first_view[0],
            "camera motion did not perform one bounded LRU replacement");

    const auto returned =
        vf::material::UpdateForestTreeCameraResidencyReference(
            definition,
            forest,
            first_view,
            &moved
        );
    require(returned.upload_bytes == bundle_bytes &&
                returned.frame_version == first.frame_version &&
                returned.resident_bytes == first.resident_bytes,
            "evicted forest tree did not regenerate exactly");

    auto reversed_first = first_view;
    auto reversed_moved = moved_view;
    std::reverse(reversed_first.begin(), reversed_first.end());
    std::reverse(reversed_moved.begin(), reversed_moved.end());
    const auto replay_first =
        vf::material::UpdateForestTreeCameraResidencyReference(
            definition,
            forest,
            reversed_first,
            nullptr
        );
    const auto replay_moved =
        vf::material::UpdateForestTreeCameraResidencyReference(
            definition,
            forest,
            reversed_moved,
            &replay_first
        );
    require(replay_first.frame_version == first.frame_version &&
                replay_first.cache_version == first.cache_version &&
                replay_moved.frame_version == moved.frame_version &&
                replay_moved.cache_version == moved.cache_version &&
                replay_moved.evicted_tree_ids ==
                    moved.evicted_tree_ids,
            "forest cache changed under traversal-order replay");

    std::cout << "forest tree camera residency: capacity="
              << definition.bundle_capacity
              << " first_upload=" << first.upload_bytes
              << " stable_upload=" << stable.upload_bytes
              << " moved_upload=" << moved.upload_bytes
              << " returned_upload=" << returned.upload_bytes
              << " frame_version=" << first.frame_version
              << " cache_version=" << first.cache_version << '\n';
    return 0;
}
