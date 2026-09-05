#pragma once

#include "native/material/vf_conditioned_stream.hpp"

#include <algorithm>
#include <bit>
#include <memory>
#include <span>
#include <unordered_set>
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

enum class TerrainSampleLayout : std::uint8_t { row_prefix, indexed };

struct TerrainTileWorkingSet {
    std::vector<std::array<double, 3>> positions;
    std::uint64_t potential_count;
    bool truncated;
    TerrainHeightCondition condition;
    std::array<std::int32_t, 2> tile;
    std::uint32_t refinement;
    TerrainSampleLayout layout = TerrainSampleLayout::row_prefix;
    std::vector<std::uint64_t> sample_ids{};
};

inline double SampleTerrainHeightReference(const TerrainHeightCondition& condition, double x, double z) {
    const double height = SampleConditionedSpatial2Reference(condition.stream, {x, z},
        condition.correlation_length, condition.mean, condition.amplitude);
    if (!std::isfinite(height)) throw std::range_error("terrain height must be finite");
    return height;
}

// Internal coordinate kernel: callers validate refinement and sample ID first.
inline std::array<double, 2> TerrainSampleCoordinatesKernel(std::array<std::int32_t, 2> tile,
    std::uint64_t divisions, std::uint64_t sample_id) {
    const std::uint64_t width = divisions + 1;
    return {static_cast<double>(static_cast<std::int64_t>(tile[0]) * static_cast<std::int64_t>(divisions) +
                static_cast<std::int64_t>(sample_id % width)) / static_cast<double>(divisions),
            static_cast<double>(static_cast<std::int64_t>(tile[1]) * static_cast<std::int64_t>(divisions) +
                static_cast<std::int64_t>(sample_id / width)) / static_cast<double>(divisions)};
}

inline void RequireTerrainPositions(const std::shared_ptr<const TerrainTileWorkingSet>& terrain) {
    if (!terrain) throw std::invalid_argument("terrain working set is required");
    if (terrain->positions.size() > 65536)
        throw std::invalid_argument("terrain working set must contain at most 65536 finite positions");
    for (const auto& position : terrain->positions)
        for (const auto value : position)
            if (!std::isfinite(value))
                throw std::invalid_argument("terrain working set must contain at most 65536 finite positions");
    if (terrain->layout == TerrainSampleLayout::row_prefix && terrain->sample_ids.empty()) return;
    if (terrain->layout != TerrainSampleLayout::indexed)
        throw std::invalid_argument("terrain sample layout is invalid");
    if (terrain->sample_ids.size() != terrain->positions.size() || terrain->refinement > 16)
        throw std::invalid_argument("terrain indexed sample identity is invalid");
    const std::uint64_t divisions = std::uint64_t{1} << terrain->refinement;
    const std::uint64_t width = divisions + 1;
    if (terrain->potential_count != width * width)
        throw std::invalid_argument("terrain indexed sample identity is invalid");
    std::unordered_set<std::uint64_t> seen;
    if (!terrain->sample_ids.empty()) seen.reserve(terrain->sample_ids.size());
    for (std::size_t index = 0; index < terrain->sample_ids.size(); ++index) {
        const auto id = terrain->sample_ids[index];
        if (id >= terrain->potential_count || !seen.insert(id).second)
            throw std::invalid_argument("terrain indexed sample identity is invalid");
        const auto coordinates = TerrainSampleCoordinatesKernel(terrain->tile, divisions, id);
        if (std::bit_cast<std::uint64_t>(terrain->positions[index][0]) != std::bit_cast<std::uint64_t>(coordinates[0]) ||
            std::bit_cast<std::uint64_t>(terrain->positions[index][2]) != std::bit_cast<std::uint64_t>(coordinates[1]))
            throw std::invalid_argument("terrain indexed sample position does not match its ID");
    }
}

inline std::uint64_t ValidateTerrainTileRequestReference(
    const TerrainHeightCondition& condition, std::array<std::int32_t, 2> tile,
    std::uint32_t refinement, std::size_t sample_budget
) {
    if (refinement > 16)
        throw std::range_error("terrain refinement must be from 0 to 16");
    if (sample_budget > 65536)
        throw std::range_error("terrain sample budget must be from 0 to 65536");
    // Validate the complete tile domain before allocating, including zero demand.
    SampleTerrainHeightReference(condition, tile[0], tile[1]);
    SampleTerrainHeightReference(condition, static_cast<double>(tile[0]) + 1, static_cast<double>(tile[1]) + 1);
    const std::uint64_t width = (std::uint64_t{1} << refinement) + 1;
    return width * width;
}

template<class SampleIdAt>
inline std::shared_ptr<const TerrainTileWorkingSet> RealizeTerrainSamplesKernel(
    const TerrainHeightCondition& condition, std::array<std::int32_t, 2> tile,
    std::uint32_t refinement, std::uint64_t potential_count, std::size_t count,
    TerrainSampleLayout layout, const SampleIdAt& sample_id_at
) {
    const std::uint64_t divisions = std::uint64_t{1} << refinement;
    auto result = std::make_shared<TerrainTileWorkingSet>();
    result->condition = condition;
    result->tile = tile;
    result->refinement = refinement;
    result->potential_count = potential_count;
    result->truncated = count < potential_count;
    result->layout = layout;
    result->positions.reserve(count);
    if (layout == TerrainSampleLayout::indexed) result->sample_ids.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        const std::uint64_t sample_id = sample_id_at(index);
        // The integer global numerator is exact even at the outer int32 tiles.
        // Power-of-two division gives the same coordinate at every shared edge
        // and at each coarse anchor. No per-tile random stream is introduced.
        const auto coordinates = TerrainSampleCoordinatesKernel(tile, divisions, sample_id);
        const double x = coordinates[0], z = coordinates[1];
        const double height = SampleTerrainHeightReference(condition, x, z);
        result->positions.push_back({x, height, z});
        if (layout == TerrainSampleLayout::indexed) result->sample_ids.push_back(sample_id);
    }
    return result;
}

inline std::shared_ptr<const TerrainTileWorkingSet> RealizeTerrainTileReference(
    const TerrainHeightCondition& condition, std::array<std::int32_t, 2> tile,
    std::uint32_t refinement, std::size_t sample_budget
) {
    const auto potential = ValidateTerrainTileRequestReference(condition, tile, refinement, sample_budget);
    const auto count = static_cast<std::size_t>(std::min<std::uint64_t>(potential, sample_budget));
    return RealizeTerrainSamplesKernel(condition, tile, refinement, potential, count,
        TerrainSampleLayout::row_prefix, [](std::size_t index) { return index; });
}

inline std::shared_ptr<const TerrainTileWorkingSet> RealizeTerrainSampleDemandReference(
    const TerrainHeightCondition& condition, std::array<std::int32_t, 2> tile,
    std::uint32_t refinement, std::span<const std::uint64_t> demands, std::size_t sample_budget
) {
    const auto potential = ValidateTerrainTileRequestReference(condition, tile, refinement, sample_budget);
    if (demands.size() > 65536) throw std::range_error("terrain sample demand must contain at most 65536 entries");
    const auto count = std::min(demands.size(), sample_budget);
    std::unordered_set<std::uint64_t> seen;
    if (count) seen.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        if (demands[index] >= potential) throw std::range_error("terrain sample demand exceeds tile domain");
        if (!seen.insert(demands[index]).second) throw std::invalid_argument("terrain sample demand is duplicated");
    }
    return RealizeTerrainSamplesKernel(condition, tile, refinement, potential, count,
        TerrainSampleLayout::indexed, [&](std::size_t index) { return demands[index]; });
}

struct TerrainWaterLevelMaterials {
    std::shared_ptr<const TerrainTileWorkingSet> source;
    std::vector<std::uint32_t> material_ids;
    double water_level;
    std::uint32_t exposed_material;
    std::uint32_t submerged_material;
};

inline TerrainWaterLevelMaterials BindTerrainWaterLevelMaterialsReference(
    std::shared_ptr<const TerrainTileWorkingSet> terrain, double water_level,
    std::uint32_t exposed_material, std::uint32_t submerged_material
) {
    RequireTerrainPositions(terrain);
    if (!std::isfinite(water_level)) throw std::range_error("terrain water level must be finite");
    TerrainWaterLevelMaterials result{std::move(terrain), {}, water_level, exposed_material, submerged_material};
    result.material_ids.reserve(result.source->positions.size());
    for (const auto& position : result.source->positions)
        result.material_ids.push_back(position[1] <= water_level ? submerged_material : exposed_material);
    return result;
}

} // namespace vf::material
