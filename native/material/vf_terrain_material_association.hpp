#pragma once

#include "native/material/vf_terrain_triangulation.hpp"
#include "native/material/vf_material_researched_preset.hpp"
#include <map>

namespace vf::material {

struct TerrainMaterialEntry {
    std::uint32_t id;
    std::shared_ptr<const ResearchedMaterialPreset> record;
};
using TerrainMaterialTable = std::vector<TerrainMaterialEntry>;

struct TerrainMaterialAssociation {
    std::shared_ptr<const TerrainSurfacePacket> source;
    std::shared_ptr<const TerrainMaterialTable> table;
    std::vector<std::shared_ptr<const ResearchedMaterialPreset>> records;
    bool truncated;
};

inline TerrainMaterialAssociation AssociateTerrainMaterialsReference(
    std::shared_ptr<const TerrainSurfacePacket> surface,
    std::shared_ptr<const TerrainMaterialTable> table, std::size_t sample_budget
) {
    RequireTerrainSurfaceMaterialTruth(surface, "terrain material association does not match retained level");
    if (!table) throw std::invalid_argument("terrain material table is required");
    if (table->size() > 65536) throw std::range_error("terrain material table must contain at most 65536 records");
    if (sample_budget > 65536) throw std::range_error("terrain material sample budget must be from 0 to 65536");
    std::map<std::uint32_t, std::shared_ptr<const ResearchedMaterialPreset>> by_id;
    for (const auto& entry : *table) {
        if (!entry.record) throw std::invalid_argument("terrain material record is required");
        ValidateResearchedMaterialPreset(*entry.record);
        if (!by_id.emplace(entry.id, entry.record).second)
            throw std::invalid_argument("terrain material table ID is duplicated");
    }
    const auto count = std::min(sample_budget, surface->vertices.size());
    for (std::size_t index = 0; index < count; ++index)
        if (!by_id.contains(surface->material_ids[index]))
            throw std::invalid_argument("terrain material ID has no record");
    const bool truncated = count < surface->vertices.size();
    TerrainMaterialAssociation result{std::move(surface), std::move(table), {}, truncated};
    result.records.reserve(count);
    for (std::size_t index = 0; index < count; ++index)
        result.records.push_back(by_id.at(result.source->material_ids[index]));
    return result;
}

} // namespace vf::material
