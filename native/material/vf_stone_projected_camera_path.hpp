#pragma once

#include "native/material/vf_stone_projected_draw_cache.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct StoneProjectedCameraPathStep {
    std::uint64_t stone_id;
    StoneCoarseShape source;
    StoneViewCamera camera;
};

struct StoneProjectedCameraPathFrame {
    std::uint64_t stone_id;
    bool hit;
    std::size_t upload_bytes;
    std::size_t resident_bytes;
    std::uint64_t packet_hash;
};

inline bool operator==(
    const StoneProjectedCameraPathFrame& first,
    const StoneProjectedCameraPathFrame& second
) {
    return first.stone_id == second.stone_id &&
        first.hit == second.hit &&
        first.upload_bytes == second.upload_bytes &&
        first.resident_bytes == second.resident_bytes &&
        first.packet_hash == second.packet_hash;
}

struct StoneProjectedCameraPathReport {
    std::vector<StoneProjectedCameraPathFrame> frames;
    StoneProjectedDrawCacheState cache;
    std::size_t max_frame_upload_bytes;
};

inline std::uint64_t StoneProjectedPacketHash(
    const StoneProjectedDrawPacket& packet
) {
    constexpr std::uint64_t offset = 14695981039346656037ull;
    constexpr std::uint64_t prime = 1099511628211ull;
    std::uint64_t hash = offset;
    auto mix = [&hash](std::uint32_t word) {
        constexpr std::uint64_t word_prime = 1099511628211ull;
        for (std::size_t byte = 0; byte < sizeof(word); ++byte) {
            hash ^= (word >> (byte * 8)) & 0xffu;
            hash *= word_prime;
        }
    };
    mix(static_cast<std::uint32_t>(packet.vertices.size()));
    for (const float value : packet.vertices) {
        std::uint32_t bits = 0;
        std::memcpy(&bits, &value, sizeof(bits));
        mix(bits);
    }
    hash ^= prime;
    mix(static_cast<std::uint32_t>(packet.indices.size()));
    for (const std::uint32_t index : packet.indices) mix(index);
    return hash;
}

inline StoneProjectedCameraPathReport
RunStoneProjectedCameraPathReference(
    const std::vector<StoneProjectedCameraPathStep>& path,
    std::size_t cache_byte_budget,
    double max_error_pixels,
    std::size_t demand_budget,
    std::size_t vertex_budget,
    std::size_t face_budget
) {
    if (path.empty()) {
        throw std::invalid_argument(
            "projected stone camera path must not be empty"
        );
    }
    std::optional<StoneProjectedDrawCacheState> cache;
    std::vector<StoneProjectedCameraPathFrame> frames;
    frames.reserve(path.size());
    std::size_t max_frame_upload_bytes = 0;
    for (const auto& step : path) {
        const auto refinement =
            UpdateStoneProjectedRefinementReference(
                step.source,
                nullptr,
                step.camera,
                max_error_pixels,
                demand_budget,
                vertex_budget,
                face_budget
            );
        cache = UpdateStoneProjectedDrawCacheReference(
            cache.has_value() ? &*cache : nullptr,
            step.stone_id,
            refinement,
            cache_byte_budget
        );
        max_frame_upload_bytes = std::max(
            max_frame_upload_bytes,
            cache->upload_bytes
        );
        frames.push_back({
            step.stone_id,
            cache->hit,
            cache->upload_bytes,
            cache->resident_bytes,
            StoneProjectedPacketHash(*cache->active),
        });
    }
    return {
        std::move(frames),
        std::move(*cache),
        max_frame_upload_bytes,
    };
}

}  // namespace vf::material
