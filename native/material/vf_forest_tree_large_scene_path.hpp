#pragma once

#include "native/material/vf_deterministic_packet_reference.hpp"
#include "native/material/vf_forest_tree_camera_residency.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct ForestTreeLargeScenePathReport {
    std::uint64_t logical_tree_capacity;
    std::size_t population_trees;
    std::size_t frame_count;
    std::size_t unique_demanded_trees;
    std::size_t stable_frames;
    std::size_t peak_resident_bytes;
    std::size_t first_frame_upload_bytes;
    std::size_t peak_steady_upload_bytes;
    std::size_t total_upload_bytes;
    std::vector<std::size_t> frame_upload_bytes;
    std::vector<std::uint64_t> frame_versions;
    std::vector<std::uint64_t> cache_versions;
    std::uint64_t path_version;
};

inline ForestTreeLargeScenePathReport
AuditForestTreeLargeScenePathReference(
    const ForestTreeCameraResidencyDefinition& definition,
    const ForestPopulationRealization& forest,
    const std::vector<std::vector<std::uint64_t>>& camera_path
) {
    if (camera_path.empty()) {
        throw std::invalid_argument(
            "forest camera path is empty"
        );
    }
    ValidateForestTreeMaterialDefinition(definition.pipeline);
    const std::uint64_t logical_tree_capacity =
        definition.pipeline.forest.potential_patches *
        definition.pipeline.forest.potential_trees_per_patch;
    std::vector<std::uint64_t> unique_tree_ids;
    std::vector<std::size_t> frame_upload_bytes;
    std::vector<std::uint64_t> frame_versions;
    std::vector<std::uint64_t> cache_versions;
    frame_upload_bytes.reserve(camera_path.size());
    frame_versions.reserve(camera_path.size());
    cache_versions.reserve(camera_path.size());
    ForestTreeCameraResidencyState state{};
    const ForestTreeCameraResidencyState* previous = nullptr;
    std::size_t stable_frames = 0;
    std::size_t peak_resident_bytes = 0;
    std::size_t peak_steady_upload_bytes = 0;
    std::size_t total_upload_bytes = 0;
    std::vector<std::uint8_t> path_bytes;
    path_bytes.reserve(
        camera_path.size() * 4 * sizeof(std::uint64_t)
    );
    for (std::size_t frame = 0;
         frame < camera_path.size();
         ++frame) {
        state = UpdateForestTreeCameraResidencyReference(
            definition,
            forest,
            camera_path[frame],
            previous
        );
        previous = &state;
        unique_tree_ids.insert(
            unique_tree_ids.end(),
            camera_path[frame].begin(),
            camera_path[frame].end()
        );
        frame_upload_bytes.push_back(state.upload_bytes);
        frame_versions.push_back(state.frame_version);
        cache_versions.push_back(state.cache_version);
        total_upload_bytes += state.upload_bytes;
        peak_resident_bytes = std::max(
            peak_resident_bytes,
            state.resident_bytes
        );
        if (frame != 0) {
            peak_steady_upload_bytes = std::max(
                peak_steady_upload_bytes,
                state.upload_bytes
            );
        }
        if (state.upload_bytes == 0) ++stable_frames;
        AppendDeterministicPacketWord64(
            path_bytes,
            state.frame_version
        );
        AppendDeterministicPacketWord64(
            path_bytes,
            state.cache_version
        );
        AppendDeterministicPacketWord64(
            path_bytes,
            static_cast<std::uint64_t>(state.upload_bytes)
        );
        AppendDeterministicPacketWord64(
            path_bytes,
            static_cast<std::uint64_t>(state.resident_bytes)
        );
    }
    std::sort(unique_tree_ids.begin(), unique_tree_ids.end());
    unique_tree_ids.erase(
        std::unique(
            unique_tree_ids.begin(),
            unique_tree_ids.end()
        ),
        unique_tree_ids.end()
    );
    return {
        logical_tree_capacity,
        forest.trees.size(),
        camera_path.size(),
        unique_tree_ids.size(),
        stable_frames,
        peak_resident_bytes,
        frame_upload_bytes.front(),
        peak_steady_upload_bytes,
        total_upload_bytes,
        std::move(frame_upload_bytes),
        std::move(frame_versions),
        std::move(cache_versions),
        HashDeterministicPacketBytes(path_bytes),
    };
}

}  // namespace vf::material
