#pragma once

#include "native/material/vf_terrain_normals.hpp"
#include <bit>
#include <optional>
#include <span>
#include <unordered_set>

namespace vf::material {

struct TerrainTriangleBounds {
    std::array<double, 3> minimum;
    std::array<double, 3> maximum;
};

struct TerrainTriangulation {
    std::shared_ptr<const TerrainSurfacePacket> source;
    std::vector<std::array<std::uint32_t, 3>> triangles;
    std::optional<TerrainTriangleBounds> bounds;
    std::size_t cell_count;
    bool truncated;
};

// Demands are externally ordered cell IDs, not a camera/error policy.
// Bounds enclose emitted linear triangles only, not unsampled terrain relief.
inline TerrainTriangulation TriangulateTerrainCellsReference(
    std::shared_ptr<const TerrainSurfacePacket> surface, std::span<const std::uint64_t> demands,
    std::size_t cell_budget, std::size_t triangle_budget
) {
    if (!surface || !surface->source)
        throw std::invalid_argument("terrain surface working set is required");
    RequireTerrainPositions(surface->source);
    if (surface->vertices.size() != surface->source->positions.size() ||
        surface->material_ids.size() != surface->vertices.size())
        throw std::invalid_argument("terrain surface must align with source positions and materials");
    for (std::size_t index = 0; index < surface->vertices.size(); ++index)
        for (std::size_t axis = 0; axis < 3; ++axis)
            if (std::bit_cast<std::uint64_t>(surface->vertices[index][axis]) !=
                std::bit_cast<std::uint64_t>(surface->source->positions[index][axis]))
                throw std::invalid_argument("terrain surface must align with source positions and materials");
    for (const auto& vertex : surface->vertices)
        for (std::size_t axis = 3; axis < 6; ++axis)
            if (!std::isfinite(vertex[axis])) throw std::invalid_argument("terrain surface normals must be finite");
    if (surface->source->refinement > 16)
        throw std::invalid_argument("terrain grid identity is invalid");
    const std::uint64_t divisions = std::uint64_t{1} << surface->source->refinement;
    const std::uint64_t width = divisions + 1;
    if (surface->source->potential_count != width * width ||
        surface->vertices.size() > surface->source->potential_count)
        throw std::invalid_argument("terrain grid identity is invalid");
    if (cell_budget > 65536) throw std::range_error("terrain cell budget must be from 0 to 65536");
    if (triangle_budget > 131072) throw std::range_error("terrain triangle budget must be from 0 to 131072");
    if (demands.size() > 65536) throw std::range_error("terrain cell demand must contain at most 65536 entries");
    const auto count = std::min({demands.size(), cell_budget, triangle_budget / 2});
    TerrainTriangulation result{std::move(surface), {}, {}, count, count < demands.size()};
    const auto corners = [&](std::uint64_t cell) {
        if (cell >= divisions * divisions) throw std::range_error("terrain cell demand exceeds tile domain");
        const auto a = (cell / divisions) * width + cell % divisions;
        const auto b = a + 1, c = a + width, d = c + 1;
        if (d >= result.source->vertices.size()) throw std::range_error("terrain demanded cell is not fully resident");
        return std::array<std::uint32_t, 4>{static_cast<std::uint32_t>(a), static_cast<std::uint32_t>(b),
            static_cast<std::uint32_t>(c), static_cast<std::uint32_t>(d)};
    };
    // Validate only the selected demand prefix, in caller order. The lookup is
    // bounded by selected cells; its iteration order never affects output.
    std::unordered_set<std::uint64_t> seen;
    if (count != 0) seen.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        corners(demands[index]);
        if (!seen.insert(demands[index]).second) throw std::invalid_argument("terrain cell demand is duplicated");
    }
    result.triangles.reserve(count * 2);
    for (std::size_t index = 0; index < count; ++index) {
        const auto cell = corners(demands[index]);
        result.triangles.push_back({cell[0], cell[2], cell[1]});
        result.triangles.push_back({cell[1], cell[2], cell[3]});
        for (const auto vertex : cell) {
            const auto& position = result.source->vertices[static_cast<std::size_t>(vertex)];
            if (!result.bounds) {
                const std::array<double, 3> point{position[0], position[1], position[2]};
                result.bounds = TerrainTriangleBounds{point, point};
            }
            for (std::size_t axis = 0; axis < 3; ++axis) {
                auto& minimum = result.bounds->minimum[axis];
                auto& maximum = result.bounds->maximum[axis];
                const double value = position[axis];
                // Canonical IEEE zero ties make bounds independent of demand
                // order: negative zero is the minimum, positive the maximum.
                if (value < minimum || (value == 0 && minimum == 0 && std::signbit(value))) minimum = value;
                if (value > maximum || (value == 0 && maximum == 0 && !std::signbit(value))) maximum = value;
            }
        }
    }
    return result;
}

} // namespace vf::material
