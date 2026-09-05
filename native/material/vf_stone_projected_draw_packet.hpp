#pragma once

#include "native/material/vf_stone_projected_refinement.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct StoneProjectedDrawPacket {
    std::vector<float> vertices;
    std::vector<std::uint32_t> indices;
};

struct StoneProjectedDrawState {
    std::shared_ptr<const StoneCoarseShape> source_geometry;
    std::shared_ptr<const StoneProjectedDrawPacket> packet;
    bool retained;
    std::size_t upload_bytes;
};

inline std::array<float, 3> StoneEllipsoidNormal(
    const std::array<float, 3>& position,
    const std::array<float, 3>& radii
) {
    std::array<double, 3> gradient{};
    double squared_length = 0.0;
    for (std::size_t axis = 0; axis < 3; ++axis) {
        gradient[axis] = static_cast<double>(position[axis]) /
            (static_cast<double>(radii[axis]) * radii[axis]);
        squared_length += gradient[axis] * gradient[axis];
    }
    const double length = std::sqrt(squared_length);
    if (!(length > 0.0) || !std::isfinite(length)) {
        throw std::invalid_argument("stone draw normal is invalid");
    }
    return {
        static_cast<float>(gradient[0] / length),
        static_cast<float>(gradient[1] / length),
        static_cast<float>(gradient[2] / length),
    };
}

inline StoneProjectedDrawState AdaptStoneProjectedDrawPacketReference(
    const StoneProjectedRefinementState& state,
    const StoneProjectedDrawState* previous
) {
    if (state.geometry == nullptr) {
        throw std::invalid_argument(
            "projected stone geometry is required"
        );
    }
    if (
        previous != nullptr &&
        previous->packet != nullptr &&
        previous->source_geometry == state.geometry
    ) {
        return {
            state.geometry,
            previous->packet,
            true,
            0,
        };
    }

    constexpr std::array<float, 4> color{
        0.46f, 0.42f, 0.36f, 1.0f,
    };
    auto packet = std::make_shared<StoneProjectedDrawPacket>();
    packet->vertices.reserve(state.geometry->positions.size() * 10);
    for (const auto& position : state.geometry->positions) {
        const auto normal = StoneEllipsoidNormal(
            position,
            state.geometry->radii
        );
        packet->vertices.insert(
            packet->vertices.end(),
            position.begin(),
            position.end()
        );
        packet->vertices.insert(
            packet->vertices.end(),
            normal.begin(),
            normal.end()
        );
        packet->vertices.insert(
            packet->vertices.end(),
            color.begin(),
            color.end()
        );
    }
    packet->indices.reserve(state.geometry->triangles.size() * 3);
    for (const auto& triangle : state.geometry->triangles) {
        for (const std::uint32_t index : triangle) {
            if (index >= state.geometry->positions.size()) {
                throw std::invalid_argument(
                    "stone draw triangle index is invalid"
                );
            }
            packet->indices.push_back(index);
        }
    }
    const std::size_t upload_bytes =
        packet->vertices.size() * sizeof(float) +
        packet->indices.size() * sizeof(std::uint32_t);
    return {
        state.geometry,
        std::move(packet),
        false,
        upload_bytes,
    };
}

}  // namespace vf::material
