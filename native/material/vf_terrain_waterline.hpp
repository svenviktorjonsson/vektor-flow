#pragma once

#include "native/material/vf_terrain_triangulation.hpp"
#include <set>

namespace vf::material {

using TerrainWaterlinePoint = std::array<double, 3>;
using TerrainWaterlineSegment = std::array<TerrainWaterlinePoint, 2>;

struct TerrainWaterline {
    std::shared_ptr<const TerrainTriangulation> source;
    std::vector<TerrainWaterlineSegment> segments;
    bool truncated;
};

// Intersections belong to emitted linear triangles, not the continuous field.
inline TerrainWaterline ExtractTerrainWaterlineReference(
    std::shared_ptr<const TerrainTriangulation> mesh, std::size_t segment_budget
) {
    if (!mesh) throw std::invalid_argument("terrain triangulation is required");
    RequireTerrainSurfaceForTopology(mesh->source);
    const double level = mesh->source->water_level;
    if (!std::isfinite(level)) throw std::range_error("terrain water level must be finite");
    for (std::size_t index = 0; index < mesh->source->vertices.size(); ++index) {
        const auto expected = mesh->source->vertices[index][1] <= level ?
            mesh->source->submerged_material : mesh->source->exposed_material;
        if (mesh->source->material_ids[index] != expected)
            throw std::invalid_argument("terrain waterline material truth does not match retained level");
    }
    if (mesh->triangles.size() > 131072)
        throw std::invalid_argument("terrain waterline input exceeds 131072 triangles");
    if (segment_budget > 65536)
        throw std::range_error("terrain waterline segment budget must be from 0 to 65536");
    for (const auto& triangle : mesh->triangles)
        for (const auto index : triangle)
            if (index >= mesh->source->vertices.size()) throw std::invalid_argument("terrain waterline triangle index is invalid");
    TerrainWaterline result{std::move(mesh), {}, false};
    result.segments.reserve(std::min(segment_budget, result.source->triangles.size()));
    std::set<TerrainWaterlineSegment> seen;
    const auto intersect = [&](std::uint32_t first, std::uint32_t second) {
        const auto& vertices = result.source->source->vertices;
        const auto before = [&](std::uint32_t a, std::uint32_t b) {
            return vertices[a][0] < vertices[b][0] ||
                (vertices[a][0] == vertices[b][0] && vertices[a][2] < vertices[b][2]);
        };
        if (before(second, first)) std::swap(first, second);
        const auto& a = vertices[first];
        const auto& b = vertices[second];
        if (a[1] == level) return TerrainWaterlinePoint{a[0], level, a[2]};
        if (b[1] == level) return TerrainWaterlinePoint{b[0], level, b[2]};
        const double numerator = level - a[1], denominator = b[1] - a[1];
        if (!std::isfinite(numerator) || !std::isfinite(denominator) || denominator == 0)
            throw std::range_error("terrain waterline interpolation must be finite");
        const double t = numerator / denominator;
        if (!std::isfinite(t) || t < 0 || t > 1)
            throw std::range_error("terrain waterline interpolation must be finite");
        const TerrainWaterlinePoint point{a[0] + t * (b[0] - a[0]), level, a[2] + t * (b[2] - a[2])};
        for (const auto value : point)
            if (!std::isfinite(value)) throw std::range_error("terrain waterline interpolation must be finite");
        return point;
    };
    for (const auto& triangle : result.source->triangles) {
        TerrainWaterlineSegment segment{};
        std::size_t crossings = 0;
        for (std::size_t edge = 0; edge < 3; ++edge) {
            const auto first = triangle[edge], second = triangle[(edge + 1) % 3];
            if ((result.source->source->vertices[first][1] <= level) !=
                (result.source->source->vertices[second][1] <= level))
                segment[crossings++] = intersect(first, second);
        }
        if (crossings != 2 || segment[0] == segment[1]) continue;
        if (segment[1] < segment[0]) std::swap(segment[0], segment[1]);
        if (seen.contains(segment)) continue;
        if (result.segments.size() == segment_budget) {
            result.truncated = true;
            break;
        }
        seen.insert(segment);
        result.segments.push_back(segment);
    }
    return result;
}

} // namespace vf::material
