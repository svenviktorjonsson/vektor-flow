#pragma once

#include "native/material/vf_conditioned_stream.hpp"

#include <algorithm>
#include <memory>
#include <vector>

namespace vf::material {

// Private terrain reference seam. All conditions and identities are supplied;
// these are not public VKF controls, measured terrain, or material defaults.
struct TerrainHeightCondition {
    ConditionedDemandStream stream;
    double correlation_length;
    double mean;
    double amplitude;
};

struct TerrainTileWorkingSet {
    std::vector<std::array<double, 3>> positions;
    std::uint64_t potential_count;
    bool truncated;
    TerrainHeightCondition condition;
};

inline double SampleTerrainHeightReference(const TerrainHeightCondition& condition, double x, double z) {
    const double height = SampleConditionedSpatial2Reference(condition.stream, {x, z},
        condition.correlation_length, condition.mean, condition.amplitude);
    if (!std::isfinite(height)) throw std::range_error("terrain height must be finite");
    return height;
}

inline void RequireTerrainPositions(const std::shared_ptr<const TerrainTileWorkingSet>& terrain) {
    if (!terrain) throw std::invalid_argument("terrain working set is required");
    if (terrain->positions.size() > 65536)
        throw std::invalid_argument("terrain working set must contain at most 65536 finite positions");
    for (const auto& position : terrain->positions)
        for (const auto value : position)
            if (!std::isfinite(value))
                throw std::invalid_argument("terrain working set must contain at most 65536 finite positions");
}

inline std::shared_ptr<const TerrainTileWorkingSet> RealizeTerrainTileReference(
    const TerrainHeightCondition& condition, std::array<std::int32_t, 2> tile,
    std::uint32_t refinement, std::size_t sample_budget
) {
    if (refinement > 16)
        throw std::range_error("terrain refinement must be from 0 to 16");
    if (sample_budget > 65536)
        throw std::range_error("terrain sample budget must be from 0 to 65536");
    const std::uint64_t divisions = std::uint64_t{1} << refinement;
    const std::uint64_t width = divisions + 1;
    const std::uint64_t potential_count = width * width;
    const auto sample_height = [&](double x, double z) {
        return SampleTerrainHeightReference(condition, x, z);
    };
    // Validate the complete tile domain before allocating, including zero demand.
    sample_height(tile[0], tile[1]);
    sample_height(static_cast<double>(tile[0]) + 1, static_cast<double>(tile[1]) + 1);
    const auto count = static_cast<std::size_t>(std::min<std::uint64_t>(potential_count, sample_budget));
    auto result = std::make_shared<TerrainTileWorkingSet>();
    result->condition = condition;
    result->potential_count = potential_count;
    result->truncated = count < potential_count;
    result->positions.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        // The integer global numerator is exact even at the outer int32 tiles.
        // Power-of-two division gives the same coordinate at every shared edge
        // and at each coarse anchor. No per-tile random stream is introduced.
        const double x = static_cast<double>(static_cast<std::int64_t>(tile[0]) *
            static_cast<std::int64_t>(divisions) + static_cast<std::int64_t>(index % width)) /
            static_cast<double>(divisions);
        const double z = static_cast<double>(static_cast<std::int64_t>(tile[1]) *
            static_cast<std::int64_t>(divisions) + static_cast<std::int64_t>(index / width)) /
            static_cast<double>(divisions);
        const double height = sample_height(x, z);
        result->positions.push_back({x, height, z});
    }
    return result;
}

struct TerrainWaterLevelMaterials {
    std::shared_ptr<const TerrainTileWorkingSet> source;
    std::vector<std::uint32_t> material_ids;
};

inline TerrainWaterLevelMaterials BindTerrainWaterLevelMaterialsReference(
    std::shared_ptr<const TerrainTileWorkingSet> terrain, double water_level,
    std::uint32_t exposed_material, std::uint32_t submerged_material
) {
    RequireTerrainPositions(terrain);
    if (!std::isfinite(water_level)) throw std::range_error("terrain water level must be finite");
    TerrainWaterLevelMaterials result{std::move(terrain), {}};
    result.material_ids.reserve(result.source->positions.size());
    for (const auto& position : result.source->positions)
        result.material_ids.push_back(position[1] <= water_level ? submerged_material : exposed_material);
    return result;
}

} // namespace vf::material
