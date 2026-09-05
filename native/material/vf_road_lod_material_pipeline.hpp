#pragma once

#include "native/material/vf_road_material_energy.hpp"
#include "native/material/vf_road_projected_lod.hpp"

#include <cstddef>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vkf::material {

struct RoadLodMaterialCandidate {
    vf::material::RoadProjectedCandidate projected;
    RoadMaterialSample material;
};

struct RoadLodMaterialBatch {
    std::size_t candidate_count;
    std::size_t material_evaluations;
    std::vector<std::uint64_t> cell_ids;
    RoadMaterialEnergy energy;
};

inline RoadLodMaterialBatch EvaluateRoadLodRefinementMaterialsReference(
    const std::vector<RoadLodMaterialCandidate>& candidates,
    const vf::material::RoadProjectedLodPolicy& policy
) {
    std::vector<vf::material::RoadProjectedCandidate> projected;
    projected.reserve(candidates.size());
    std::map<std::uint64_t, const RoadMaterialSample*> materials;
    for (const auto& candidate : candidates) {
        projected.push_back(candidate.projected);
        const auto inserted = materials.emplace(
            candidate.projected.cell_id,
            &candidate.material
        );
        if (!inserted.second) {
            throw std::invalid_argument(
                "road LOD material cell id is duplicated"
            );
        }
    }
    const auto demands = vf::material::SelectRoadProjectedLodReference(
        projected,
        policy
    );
    std::vector<std::uint64_t> cell_ids;
    std::vector<RoadMaterialSample> selected_materials;
    cell_ids.reserve(demands.size());
    selected_materials.reserve(demands.size());
    for (const auto& demand : demands) {
        cell_ids.push_back(demand.cell_id);
        selected_materials.push_back(*materials.at(demand.cell_id));
    }
    auto energy = EvaluateRoadMaterialWhiteFurnace(
        selected_materials,
        selected_materials.size()
    );
    return {
        candidates.size(),
        selected_materials.size(),
        std::move(cell_ids),
        std::move(energy),
    };
}

}  // namespace vkf::material
