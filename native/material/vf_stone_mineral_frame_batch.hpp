#pragma once

#include "native/material/vf_stone_mineral_frame_capture.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct StoneMineralFrameInstance {
    std::uint64_t identity;
    StoneMineralConditionV1 condition;
    std::uint32_t slot;
};

struct StoneMineralFrameBatchCapture {
    std::size_t width;
    std::size_t height;
    std::vector<std::uint8_t> rgba8;
    std::size_t stone_count;
    std::size_t rendered_pixels;
    std::size_t spectral_transport_samples;
    float maximum_energy_balance_error;
    bool passive_energy;
    std::uint64_t version;
};

inline bool operator==(
    const StoneMineralFrameBatchCapture& first,
    const StoneMineralFrameBatchCapture& second
) {
    return first.width == second.width &&
        first.height == second.height &&
        first.rgba8 == second.rgba8 &&
        first.stone_count == second.stone_count &&
        first.rendered_pixels == second.rendered_pixels &&
        first.spectral_transport_samples ==
            second.spectral_transport_samples &&
        first.maximum_energy_balance_error ==
            second.maximum_energy_balance_error &&
        first.passive_energy == second.passive_energy &&
        first.version == second.version;
}

inline constexpr std::size_t StoneMineralFrameBatchTileExtent() {
    return 12;
}

inline constexpr std::size_t StoneMineralFrameBatchMaximumSlots() {
    return 256;
}

inline constexpr std::size_t StoneMineralFrameBatchMaximumBytes() {
    return StoneMineralFrameBatchMaximumSlots() *
        StoneMineralFrameBatchTileExtent() *
        StoneMineralFrameBatchTileExtent() * 4;
}

inline StoneMineralFrameBatchCapture
CaptureMeasuredStoneMineralFrameBatchReference(
    StoneMineralMaterialSample sample,
    const MeasuredPopulationDistribution& population,
    const StoneMineralConditionedDistribution& mineral_distribution,
    const std::array<float, 3>& incident_radiance,
    const std::vector<StoneMineralFrameInstance>& instances,
    std::size_t columns
) {
    constexpr std::array<std::uint8_t, 4> background{4, 7, 12, 255};
    constexpr std::size_t tile_extent = StoneMineralFrameBatchTileExtent();
    constexpr std::size_t maximum_slots =
        StoneMineralFrameBatchMaximumSlots();
    if (instances.empty()) {
        throw std::invalid_argument(
            "stone mineral frame batch requires at least one instance"
        );
    }
    if (columns == 0 || columns > maximum_slots) {
        throw std::range_error(
            "stone mineral frame batch columns must be in [1, 256]"
        );
    }
    std::array<bool, maximum_slots> occupied{};
    std::size_t maximum_slot = 0;
    for (const auto& instance : instances) {
        if (instance.slot >= maximum_slots) {
            throw std::range_error(
                "stone mineral frame batch slot must be in [0, 255]"
            );
        }
        if (occupied[instance.slot]) {
            throw std::invalid_argument(
                "stone mineral frame batch slots must be unique"
            );
        }
        occupied[instance.slot] = true;
        maximum_slot = std::max(
            maximum_slot,
            static_cast<std::size_t>(instance.slot)
        );
    }
    const std::size_t tile_columns = std::min(columns, maximum_slot + 1);
    const std::size_t tile_rows = maximum_slot / columns + 1;
    if (tile_columns * tile_rows > maximum_slots) {
        throw std::range_error(
            "stone mineral frame batch rectangular demand exceeds 256 tiles"
        );
    }
    StoneMineralFrameBatchCapture capture{
        tile_columns * tile_extent,
        tile_rows * tile_extent,
        std::vector<std::uint8_t>(
            tile_columns * tile_rows * tile_extent * tile_extent * 4
        ),
        instances.size(),
        0,
        0,
        0.0f,
        true,
        0,
    };
    for (std::size_t pixel = 0;
         pixel < capture.width * capture.height;
         ++pixel) {
        std::copy(
            background.begin(),
            background.end(),
            capture.rgba8.begin() +
                static_cast<std::ptrdiff_t>(pixel * 4)
        );
    }
    for (const auto& instance : instances) {
        const auto tile = CaptureMeasuredStoneMineralFrameReference(
            sample,
            instance.identity,
            population,
            mineral_distribution,
            instance.condition,
            incident_radiance,
            tile_extent,
            tile_extent
        );
        const std::size_t tile_x = instance.slot % columns;
        const std::size_t tile_y = instance.slot / columns;
        for (std::size_t y = 0; y < tile_extent; ++y) {
            const std::size_t source = y * tile_extent * 4;
            const std::size_t destination =
                ((tile_y * tile_extent + y) * capture.width +
                 tile_x * tile_extent) * 4;
            std::copy(
                tile.rgba8.begin() + static_cast<std::ptrdiff_t>(source),
                tile.rgba8.begin() +
                    static_cast<std::ptrdiff_t>(source + tile_extent * 4),
                capture.rgba8.begin() +
                    static_cast<std::ptrdiff_t>(destination)
            );
        }
        capture.rendered_pixels += tile.rendered_pixels;
        capture.spectral_transport_samples +=
            tile.spectral_transport_samples;
        capture.maximum_energy_balance_error = std::max(
            capture.maximum_energy_balance_error,
            tile.maximum_energy_balance_error
        );
        capture.passive_energy = capture.passive_energy && tile.passive_energy;
    }
    capture.version = StoneMineralFrameVersionReference(
        capture.width,
        capture.height,
        capture.rgba8
    );
    return capture;
}

}  // namespace vf::material
