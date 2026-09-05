#pragma once

#include "native/material/vf_stone_projected_camera_path.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct StoneProjectedLargeSceneStone {
    std::uint64_t stone_id;
    StoneCoarseShape source;
};

struct StoneProjectedLargeSceneFrame {
    std::size_t hits;
    std::size_t uploads;
    std::size_t upload_bytes;
    std::size_t resident_bytes;
    std::uint64_t scene_hash;
};

inline bool operator==(
    const StoneProjectedLargeSceneFrame& first,
    const StoneProjectedLargeSceneFrame& second
) {
    return first.hits == second.hits &&
        first.uploads == second.uploads &&
        first.upload_bytes == second.upload_bytes &&
        first.resident_bytes == second.resident_bytes &&
        first.scene_hash == second.scene_hash;
}

struct StoneProjectedLargeSceneReport {
    std::vector<StoneProjectedLargeSceneFrame> frames;
    StoneProjectedDrawCacheState cache;
    std::size_t max_item_upload_bytes;
    std::size_t max_frame_upload_bytes;
    std::size_t max_moving_frame_upload_bytes;
};

inline void MixStoneProjectedSceneHash(
    std::uint64_t& hash,
    std::uint64_t word
) {
    constexpr std::uint64_t prime = 1099511628211ull;
    for (std::size_t byte = 0; byte < sizeof(word); ++byte) {
        hash ^= (word >> (byte * 8)) & 0xffu;
        hash *= prime;
    }
}

inline StoneProjectedLargeSceneReport
RunStoneProjectedLargeSceneReference(
    const std::vector<StoneProjectedLargeSceneStone>& stones,
    const std::vector<StoneViewCamera>& cameras,
    std::size_t cache_byte_budget,
    double max_error_pixels,
    std::size_t demand_budget,
    std::size_t vertex_budget,
    std::size_t face_budget
) {
    if (stones.empty() || cameras.empty()) {
        throw std::invalid_argument(
            "projected large stone scene must not be empty"
        );
    }
    std::optional<StoneProjectedDrawCacheState> cache;
    std::vector<StoneProjectedLargeSceneFrame> frames;
    frames.reserve(cameras.size());
    std::size_t max_item_upload_bytes = 0;
    std::size_t max_frame_upload_bytes = 0;
    std::size_t max_moving_frame_upload_bytes = 0;
    for (std::size_t frame_index = 0;
         frame_index < cameras.size(); ++frame_index) {
        std::size_t hits = 0;
        std::size_t uploads = 0;
        std::size_t upload_bytes = 0;
        std::uint64_t scene_hash = 14695981039346656037ull;
        for (const auto& stone : stones) {
            const auto refinement =
                UpdateStoneProjectedRefinementReference(
                    stone.source,
                    nullptr,
                    cameras[frame_index],
                    max_error_pixels,
                    demand_budget,
                    vertex_budget,
                    face_budget
                );
            cache = UpdateStoneProjectedDrawCacheReference(
                cache.has_value() ? &*cache : nullptr,
                stone.stone_id,
                refinement,
                cache_byte_budget
            );
            hits += static_cast<std::size_t>(cache->hit);
            uploads += static_cast<std::size_t>(!cache->hit);
            upload_bytes += cache->upload_bytes;
            max_item_upload_bytes = std::max(
                max_item_upload_bytes,
                cache->upload_bytes
            );
            MixStoneProjectedSceneHash(scene_hash, stone.stone_id);
            MixStoneProjectedSceneHash(
                scene_hash,
                StoneProjectedPacketHash(*cache->active)
            );
        }
        max_frame_upload_bytes = std::max(
            max_frame_upload_bytes,
            upload_bytes
        );
        if (frame_index > 0) {
            max_moving_frame_upload_bytes = std::max(
                max_moving_frame_upload_bytes,
                upload_bytes
            );
        }
        frames.push_back({
            hits,
            uploads,
            upload_bytes,
            cache->resident_bytes,
            scene_hash,
        });
    }
    return {
        std::move(frames),
        std::move(*cache),
        max_item_upload_bytes,
        max_frame_upload_bytes,
        max_moving_frame_upload_bytes,
    };
}

}  // namespace vf::material
