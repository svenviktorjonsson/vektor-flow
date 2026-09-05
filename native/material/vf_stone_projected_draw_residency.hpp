#pragma once

#include "native/material/vf_stone_projected_draw_packet.hpp"

#include <algorithm>
#include <cstddef>
#include <utility>

namespace vf::material {

struct StoneProjectedDrawResidencyState {
    StoneProjectedRefinementState refinement;
    StoneProjectedDrawState draw;
    std::size_t cache_hits;
    std::size_t uploads;
    std::size_t evictions;
    std::size_t total_upload_bytes;
    std::size_t resident_bytes;
    std::size_t peak_resident_bytes;
};

inline StoneProjectedDrawResidencyState
UpdateStoneProjectedDrawResidencyReference(
    const StoneCoarseShape& coarse,
    const StoneProjectedDrawResidencyState* previous,
    const StoneViewCamera& camera,
    double max_error_pixels,
    std::size_t demand_budget,
    std::size_t vertex_budget,
    std::size_t face_budget
) {
    auto refinement = UpdateStoneProjectedRefinementReference(
        coarse,
        previous == nullptr ? nullptr : &previous->refinement,
        camera,
        max_error_pixels,
        demand_budget,
        vertex_budget,
        face_budget
    );
    auto draw = AdaptStoneProjectedDrawPacketReference(
        refinement,
        previous == nullptr ? nullptr : &previous->draw
    );
    const std::size_t resident_bytes =
        draw.packet->vertices.size() * sizeof(float) +
        draw.packet->indices.size() * sizeof(std::uint32_t);
    const bool uploaded = !draw.retained;
    const std::size_t previous_hits =
        previous == nullptr ? 0 : previous->cache_hits;
    const std::size_t previous_uploads =
        previous == nullptr ? 0 : previous->uploads;
    const std::size_t previous_evictions =
        previous == nullptr ? 0 : previous->evictions;
    const std::size_t previous_upload_bytes =
        previous == nullptr ? 0 : previous->total_upload_bytes;
    const std::size_t previous_peak =
        previous == nullptr ? 0 : previous->peak_resident_bytes;
    return {
        std::move(refinement),
        std::move(draw),
        previous_hits + static_cast<std::size_t>(!uploaded),
        previous_uploads + static_cast<std::size_t>(uploaded),
        previous_evictions + static_cast<std::size_t>(
            previous != nullptr && uploaded
        ),
        previous_upload_bytes +
            (uploaded ? resident_bytes : 0),
        resident_bytes,
        std::max(previous_peak, resident_bytes),
    };
}

}  // namespace vf::material
