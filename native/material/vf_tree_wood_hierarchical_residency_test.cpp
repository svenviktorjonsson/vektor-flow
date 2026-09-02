#include "native/material/vf_tree_wood_hierarchical_residency.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    const vf::material::TreeWoodHierarchicalDefinition definition{
        {0x1f83d9abfb41bd6bull, 0x5be0cd19137e2179ull},
        19,
        5,
        1000000000ull,
        1000000000ull,
    };
    std::vector<vf::material::TreeWoodHierarchicalDemand> demands{
        {17, 2, {10.0, 10.0}, 90, {0.42, 0.0, 2.1}},
        {17, 2, {10.0, 10.0}, 1, {0.18, 0.0, 0.8}},
    };
    constexpr std::size_t geometry_bytes = 240;
    constexpr std::size_t record_bytes =
        vf::material::kTreeWoodHierarchicalRecordBytes;
    const auto first =
        vf::material::UpdateTreeWoodHierarchicalResidencyReference(
            definition,
            17,
            demands,
            2,
            nullptr
        );
    require(first.packet != nullptr && !first.retained &&
                first.packet->geometry->vertices.size() == 24 &&
                first.packet->geometry->indices.size() == 36,
            "tree residency omitted closed coarse trunk geometry");
    require(first.material.potential_trees == 1000000000ull &&
                first.material.potential_samples_per_tree ==
                    1000000000ull &&
                first.material.samples.size() == 2,
            "tree residency materialized undemanded wood surface");
    const auto& lower = first.material.samples[0];
    const auto& upper = first.material.samples[1];
    require(lower.tree_id == 17 && lower.sample_id == 1 &&
                upper.tree_id == 17 && upper.sample_id == 90,
            "wood surface demand order was not canonical");
    require(lower.population_variation == upper.population_variation &&
                lower.species_variation == upper.species_variation &&
                lower.individual_variation ==
                    upper.individual_variation,
            "one tree lost its population/species/individual hierarchy");
    require(lower.surface_variation != upper.surface_variation &&
                lower.ring != upper.ring && lower.fiber != upper.fiber,
            "wood surface demand ignored ring/fiber detail");
    require(first.material.energy.violations == 0 &&
                first.material.energy.minimum >= 0.0f &&
                first.material.energy.maximum <= 1.0f,
            "wood material escaped passive energy bounds");
    require(first.packet->material_bytes.size() == 2 * record_bytes &&
                first.upload_bytes == geometry_bytes + 2 * record_bytes &&
                first.resident_bytes == geometry_bytes + 2 * record_bytes,
            "first tree packet escaped residency bounds");
    require(first.version == 2771558950091527699ull,
            "tree/wood packet version changed nondeterministically");
    auto invalid_material = first.material;
    invalid_material.energy.maximum = 1.01f;
    bool rejected_invalid_energy = false;
    try {
        static_cast<void>(
            vf::material::PackTreeWoodMaterialBytesReference(
                invalid_material
            )
        );
    } catch (const std::domain_error&) {
        rejected_invalid_energy = true;
    }
    require(rejected_invalid_energy,
            "tree/wood packet accepted non-passive energy");
    const auto first_version = first.version;
    const auto first_vertices = first.packet->geometry->vertices;
    const auto first_material_bytes = first.packet->material_bytes;
    const auto* first_packet = first.packet.get();

    const auto peer_material =
        vf::material::RealizeTreeWoodHierarchicalMaterialReference(
            definition,
            {{18, 2, {10.1, 10.0}, 1, {0.18, 0.0, 0.8}}},
            1
        );
    require(peer_material.samples[0].species_variation ==
                lower.species_variation &&
                peer_material.samples[0].individual_variation !=
                    lower.individual_variation,
            "species traits did not persist across tree individuals");

    std::reverse(demands.begin(), demands.end());
    const auto stable =
        vf::material::UpdateTreeWoodHierarchicalResidencyReference(
            definition,
            17,
            demands,
            2,
            &first
        );
    require(stable.retained && stable.packet.get() == first_packet &&
                stable.upload_bytes == 0 &&
                stable.repacked_samples == 0 &&
                stable.version == first_version,
            "stable or reversed wood demand scheduled an upload");

    const std::vector<vf::material::TreeWoodHierarchicalDemand>
        changed_demands{
            {17, 2, {10.0, 10.0}, 91, {0.51, 0.1, 2.3}},
            {17, 2, {10.0, 10.0}, 1, {0.18, 0.0, 0.8}},
        };
    const auto changed =
        vf::material::UpdateTreeWoodHierarchicalResidencyReference(
            definition,
            17,
            changed_demands,
            2,
            &stable
        );
    require(!changed.retained &&
                changed.packet->geometry == stable.packet->geometry &&
                changed.repacked_samples == 1 &&
                changed.upload_bytes == record_bytes,
            "one wood sample change replaced coarse tree geometry");
    require(std::equal(
                first_material_bytes.begin(),
                first_material_bytes.begin() + record_bytes,
                changed.packet->material_bytes.begin()
            ),
            "unchanged wood material bytes were repacked");

    const std::vector<vf::material::TreeWoodHierarchicalDemand>
        next_tree_demands{
            {18, 2, {10.1, 10.0}, 1, {0.18, 0.0, 0.8}},
            {18, 2, {10.1, 10.0}, 91, {0.51, 0.1, 2.3}},
        };
    const auto next_tree =
        vf::material::UpdateTreeWoodHierarchicalResidencyReference(
            definition,
            18,
            next_tree_demands,
            2,
            &changed
        );
    require(next_tree.packet->geometry != changed.packet->geometry &&
                next_tree.repacked_samples == 2 &&
                next_tree.upload_bytes ==
                    geometry_bytes + 2 * record_bytes,
            "tree identity change escaped full packet bound");

    std::reverse(demands.begin(), demands.end());
    const auto regenerated =
        vf::material::UpdateTreeWoodHierarchicalResidencyReference(
            definition,
            17,
            demands,
            2,
            &next_tree
        );
    require(regenerated.version == first_version &&
                regenerated.packet->geometry->vertices == first_vertices &&
                regenerated.packet->material_bytes == first_material_bytes,
            "evicted tree/wood packet did not regenerate exactly");

    std::cout << "hierarchical tree/wood residency: samples="
              << first.material.samples.size()
              << " resident=" << first.resident_bytes
              << " stable_upload=" << stable.upload_bytes
              << " sample_delta=" << changed.upload_bytes
              << " tree_delta=" << next_tree.upload_bytes
              << " version=" << first.version << '\n';
    return 0;
}
