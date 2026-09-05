#pragma once

#include "native/material/vf_stone_hierarchical_material_residency.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct StoneHierarchicalCameraDemand {
    StonePopulationDemand population;
    std::vector<StoneMaterialDemand> material_demands;
};

struct StoneHierarchicalCameraPathState {
    std::uint64_t potential_members;
    std::vector<std::uint64_t> realized_identities;
    std::vector<std::uint64_t> versions;
    StoneHierarchicalMaterialResidencyState residency;
    std::size_t realized_vertices;
    std::size_t realized_faces;
    std::size_t realized_material_samples;
    std::size_t frame_upload_bytes;
    bool passive_energy;
    std::uint64_t frame_hash;
};

inline std::uint64_t HashStoneHierarchicalCameraFrame(
    const std::vector<std::uint64_t>& identities,
    const std::vector<std::uint64_t>& versions
) {
    if (identities.size() != versions.size()) {
        throw std::invalid_argument(
            "stone camera frame identities and versions diverged"
        );
    }
    std::uint64_t hash = 1469598103934665603ull;
    for (std::size_t index = 0; index < identities.size(); ++index) {
        for (const std::uint64_t word : {
                 identities[index],
                 versions[index],
             }) {
            for (std::size_t offset = 0; offset < sizeof(word); ++offset) {
                HashStoneResidencyByte(
                    hash,
                    static_cast<std::uint8_t>(
                        (word >> (offset * 8)) & 0xffu
                    )
                );
            }
        }
    }
    return hash;
}

inline StoneHierarchicalCameraPathState
UpdateStoneHierarchicalCameraPathReference(
    const StonePopulationDefinition& definition,
    const StoneHierarchicalCameraPathState* previous,
    const StoneViewCamera& camera,
    const std::vector<StoneHierarchicalCameraDemand>& visible,
    std::size_t member_budget,
    std::size_t projected_demand_budget,
    std::size_t vertex_budget,
    std::size_t face_budget,
    std::size_t material_sample_budget,
    std::size_t residency_byte_budget
) {
    if (definition.potential_members == 0 || visible.empty()) {
        throw std::invalid_argument(
            "stone camera path requires a visible population"
        );
    }
    if (visible.size() > member_budget) {
        throw std::range_error(
            "stone camera path exceeds visible member budget"
        );
    }
    auto ordered = visible;
    std::sort(
        ordered.begin(),
        ordered.end(),
        [](const auto& first, const auto& second) {
            return first.population.member_id <
                second.population.member_id;
        }
    );
    for (std::size_t index = 1; index < ordered.size(); ++index) {
        if (ordered[index - 1].population.member_id ==
            ordered[index].population.member_id) {
            throw std::invalid_argument(
                "stone camera path duplicates a visible identity"
            );
        }
    }

    std::optional<StoneHierarchicalMaterialResidencyState> working;
    const StoneHierarchicalMaterialResidencyState* resident =
        previous == nullptr ? nullptr : &previous->residency;
    std::vector<std::uint64_t> realized_identities;
    std::vector<std::uint64_t> versions;
    realized_identities.reserve(ordered.size());
    versions.reserve(ordered.size());
    std::size_t realized_vertices = 0;
    std::size_t realized_faces = 0;
    std::size_t realized_material_samples = 0;
    std::size_t frame_upload_bytes = 0;
    bool passive_energy = true;
    for (const auto& demand : ordered) {
        auto member = RealizeStonePopulationMemberReference(
            definition,
            demand.population,
            vertex_budget,
            face_budget
        );
        auto refinement = UpdateStoneProjectedRefinementReference(
            member.coarse,
            nullptr,
            camera,
            0.0,
            projected_demand_budget,
            vertex_budget,
            face_budget
        );
        auto draw = UpdateStoneHierarchicalMaterialDrawReference(
            member,
            refinement,
            demand.material_demands,
            material_sample_budget,
            nullptr
        );
        working = UpdateStoneHierarchicalMaterialResidencyReference(
            resident,
            member.member_id,
            refinement,
            draw,
            residency_byte_budget
        );
        resident = &*working;
        realized_identities.push_back(member.member_id);
        versions.push_back(working->active_version);
        realized_vertices += refinement.geometry->positions.size();
        realized_faces += refinement.geometry->triangles.size();
        realized_material_samples += draw.material.samples.size();
        frame_upload_bytes += working->upload_bytes;
        passive_energy = passive_energy &&
            draw.material.energy.violations == 0 &&
            draw.material.energy.minimum >= 0.0f &&
            draw.material.energy.maximum <= 1.0f;
    }
    const std::uint64_t frame_hash =
        HashStoneHierarchicalCameraFrame(
            realized_identities,
            versions
        );
    return {
        definition.potential_members,
        std::move(realized_identities),
        std::move(versions),
        std::move(*working),
        realized_vertices,
        realized_faces,
        realized_material_samples,
        frame_upload_bytes,
        passive_energy,
        frame_hash,
    };
}

}  // namespace vf::material
