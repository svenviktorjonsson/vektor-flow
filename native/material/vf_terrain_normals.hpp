#pragma once

#include "native/material/vf_terrain_water_level.hpp"

namespace vf::material {

struct TerrainNormalsWorkingSet {
    std::shared_ptr<const TerrainTileWorkingSet> source;
    std::vector<std::array<double, 3>> normals;
};

inline std::shared_ptr<const TerrainNormalsWorkingSet> DeriveTerrainNormalsReference(
    std::shared_ptr<const TerrainTileWorkingSet> terrain, double sampling_distance
) {
    RequireTerrainPositions(terrain);
    if (!std::isfinite(sampling_distance) || !(sampling_distance > 0))
        throw std::range_error("terrain normal sampling distance must be finite and positive");
    if (!std::isfinite(2 * sampling_distance))
        throw std::range_error("terrain normal sampling span must be finite");
    auto result = std::make_shared<TerrainNormalsWorkingSet>();
    result->source = std::move(terrain);
    result->normals.reserve(result->source->positions.size());
    for (const auto& position : result->source->positions) {
        const auto& condition = result->source->condition;
        const double x = position[0], z = position[2];
        if (x + sampling_distance == x || x - sampling_distance == x ||
            z + sampling_distance == z || z - sampling_distance == z)
            throw std::range_error("terrain normal sampling distance is not representable at position");
        // Explicit evaluation order preserves the first failing stencil sample.
        const double positive_x = SampleTerrainHeightReference(condition, x + sampling_distance, z);
        const double negative_x = SampleTerrainHeightReference(condition, x - sampling_distance, z);
        const double positive_z = SampleTerrainHeightReference(condition, x, z + sampling_distance);
        const double negative_z = SampleTerrainHeightReference(condition, x, z - sampling_distance);
        const double slope_x = (positive_x - negative_x) / (2 * sampling_distance);
        const double slope_z = (positive_z - negative_z) / (2 * sampling_distance);
        const double length = std::sqrt(slope_x * slope_x + 1 + slope_z * slope_z);
        if (!std::isfinite(length) || !(length > 0))
            throw std::range_error("terrain normal length must be finite and positive");
        result->normals.push_back({-slope_x / length, 1 / length, -slope_z / length});
    }
    return result;
}

// Private data assembly only: no renderer, lighting, or shading behavior.
struct TerrainSurfacePacket {
    std::shared_ptr<const TerrainTileWorkingSet> source;
    std::vector<std::array<double, 6>> vertices;
    std::vector<std::uint32_t> material_ids;
};

inline TerrainSurfacePacket AssembleTerrainSurfacePacketReference(
    const std::shared_ptr<const TerrainNormalsWorkingSet>& normals,
    const TerrainWaterLevelMaterials& material
) {
    if (!normals || !normals->source || normals->source != material.source ||
        normals->normals.size() != normals->source->positions.size() ||
        material.material_ids.size() != normals->normals.size())
        throw std::invalid_argument("aligned terrain normal and material working sets are required");
    RequireTerrainPositions(normals->source);
    for (const auto& normal : normals->normals)
        for (const auto value : normal)
            if (!std::isfinite(value)) throw std::invalid_argument("terrain surface normals must be finite");
    TerrainSurfacePacket result{normals->source, {}, {}};
    result.vertices.reserve(normals->normals.size());
    for (std::size_t index = 0; index < normals->normals.size(); ++index) {
        const auto& position = normals->source->positions[index];
        const auto& normal = normals->normals[index];
        result.vertices.push_back({position[0], position[1], position[2], normal[0], normal[1], normal[2]});
    }
    result.material_ids = material.material_ids;
    return result;
}

} // namespace vf::material
