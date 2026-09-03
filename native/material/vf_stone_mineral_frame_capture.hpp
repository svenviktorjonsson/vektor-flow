#pragma once

#include "native/material/vf_stone_mineral_spectral_transport.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct StoneMineralFrameCapture {
    std::size_t width;
    std::size_t height;
    std::vector<std::uint8_t> rgba8;
    std::size_t rendered_pixels;
    std::size_t spectral_transport_samples;
    float maximum_energy_balance_error;
    bool passive_energy;
    std::uint64_t version;
};

inline bool operator==(
    const StoneMineralFrameCapture& first,
    const StoneMineralFrameCapture& second
) {
    return first.width == second.width &&
        first.height == second.height &&
        first.rgba8 == second.rgba8 &&
        first.rendered_pixels == second.rendered_pixels &&
        first.spectral_transport_samples ==
            second.spectral_transport_samples &&
        first.maximum_energy_balance_error ==
            second.maximum_energy_balance_error &&
        first.passive_energy == second.passive_energy &&
        first.version == second.version;
}

inline std::uint8_t StoneMineralLinearByteReference(float value) {
    return static_cast<std::uint8_t>(std::lround(
        std::clamp(value, 0.0f, 1.0f) * 255.0f
    ));
}

inline std::uint64_t StoneMineralFrameVersionReference(
    std::size_t width,
    std::size_t height,
    const std::vector<std::uint8_t>& rgba8
) {
    std::uint64_t hash = 1469598103934665603ull;
    const auto mix_word = [&](std::uint64_t word) {
        for (std::size_t byte = 0; byte < sizeof(word); ++byte) {
            hash ^= static_cast<std::uint8_t>(
                (word >> (byte * 8)) & 0xffu
            );
            hash *= 1099511628211ull;
        }
    };
    mix_word(width);
    mix_word(height);
    for (const std::uint8_t byte : rgba8) {
        hash ^= byte;
        hash *= 1099511628211ull;
    }
    return hash;
}

inline StoneMineralFrameCapture CaptureMeasuredStoneMineralFrameReference(
    StoneMineralMaterialSample sample,
    std::uint64_t stone_identity,
    const MeasuredPopulationDistribution& population,
    const StoneMineralConditionedDistribution& mineral_distribution,
    StoneMineralConditionV1 condition,
    const std::array<float, 3>& incident_radiance,
    std::size_t width,
    std::size_t height
) {
    constexpr std::size_t maximum_extent = 256;
    constexpr std::array<std::uint8_t, 4> background{4, 7, 12, 255};
    constexpr std::array<float, 3> light_direction{
        0.4f,
        -0.3f,
        0.8660254037844386f,
    };
    if (width == 0 || height == 0 ||
        width > maximum_extent || height > maximum_extent) {
        throw std::range_error(
            "stone mineral frame extent must be in [1, 256]"
        );
    }
    StoneMineralFrameCapture capture{
        width,
        height,
        std::vector<std::uint8_t>(width * height * 4),
        0,
        0,
        0.0f,
        true,
        0,
    };
    for (std::size_t pixel = 0; pixel < width * height; ++pixel) {
        const std::size_t output = pixel * 4;
        std::copy(
            background.begin(),
            background.end(),
            capture.rgba8.begin() + static_cast<std::ptrdiff_t>(output)
        );
    }
    const float inverse_width = 1.0f / static_cast<float>(width);
    const float inverse_height = 1.0f / static_cast<float>(height);
    for (std::size_t y = 0; y < height; ++y) {
        for (std::size_t x = 0; x < width; ++x) {
            const float local_x =
                (2.0f * (static_cast<float>(x) + 0.5f) *
                    inverse_width - 1.0f) * 1.1f;
            const float local_y =
                (1.0f - 2.0f * (static_cast<float>(y) + 0.5f) *
                    inverse_height) * 1.1f;
            const float radius_squared =
                local_x * local_x + local_y * local_y;
            if (radius_squared > 1.0f) continue;
            const float local_z = std::sqrt(
                std::max(0.0f, 1.0f - radius_squared)
            );
            const float incidence_cosine = std::max(
                0.0f,
                local_x * light_direction[0] +
                    local_y * light_direction[1] +
                    local_z * light_direction[2]
            );
            const auto transport =
                EvaluateMeasuredStoneMineralSpectralTransportReference(
                    sample,
                    stone_identity,
                    population,
                    mineral_distribution,
                    condition,
                    incident_radiance,
                    incidence_cosine
                );
            for (std::size_t band = 0; band < 3; ++band) {
                const float balance = std::abs(
                    transport.reflected_energy[band] +
                    transport.absorbed_energy[band] -
                    transport.projected_incident_energy[band]
                );
                capture.maximum_energy_balance_error = std::max(
                    capture.maximum_energy_balance_error,
                    balance
                );
                capture.passive_energy = capture.passive_energy &&
                    transport.reflected_energy[band] >= 0.0f &&
                    transport.absorbed_energy[band] >= 0.0f &&
                    transport.reflected_energy[band] <=
                        transport.projected_incident_energy[band] &&
                    balance <= 1.0e-7f;
            }
            const std::size_t output = (y * width + x) * 4;
            capture.rgba8[output] = StoneMineralLinearByteReference(
                transport.reflected_energy[2]
            );
            capture.rgba8[output + 1] = StoneMineralLinearByteReference(
                transport.reflected_energy[1]
            );
            capture.rgba8[output + 2] = StoneMineralLinearByteReference(
                transport.reflected_energy[0]
            );
            capture.rgba8[output + 3] = 255;
            ++capture.rendered_pixels;
            ++capture.spectral_transport_samples;
        }
    }
    capture.version = StoneMineralFrameVersionReference(
        capture.width,
        capture.height,
        capture.rgba8
    );
    return capture;
}

}  // namespace vf::material
