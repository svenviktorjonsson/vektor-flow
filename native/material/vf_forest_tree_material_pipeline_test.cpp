#include "native/material/vf_forest_tree_material_pipeline.hpp"

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
    const vf::material::ForestPopulationDefinition forest_definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31,
        5,
        1000000000ull,
        1000000000ull,
        64.0,
        12.0,
    };
    const auto forest =
        vf::material::RealizeForestPopulationReference(
            forest_definition,
            {{3, {1, 3}, 3}, {9, {2, 3}, 3}},
            6
        );
    const vf::material::ForestTreeMaterialPipelineDefinition definition{
        forest_definition,
        {
            forest_definition.seed,
            forest_definition.population_id,
            forest_definition.species_count,
            1000000000000000000ull,
            1000000000ull,
        },
        1000000000ull,
    };
    std::vector<std::uint64_t> demanded_tree_ids;
    for (std::size_t index = 0; index < 5; ++index) {
        demanded_tree_ids.push_back(forest.trees[index].tree_id);
    }
    std::reverse(
        demanded_tree_ids.begin(),
        demanded_tree_ids.end()
    );
    constexpr std::size_t bundle_bytes =
        vf::material::kForestTreeMaterialBundleBytes;
    const auto first =
        vf::material::UpdateForestTreeMaterialPipelineReference(
            definition,
            forest,
            demanded_tree_ids,
            5,
            nullptr
        );
    require(first.realization.logical_tree_capacity ==
                1000000000000000000ull &&
                first.realization.bundles.size() == 5,
            "forest material pipeline realized undemanded trees");
    for (const auto& bundle : first.realization.bundles) {
        require(bundle.population.species_id ==
                    bundle.wood.species_id &&
                    bundle.bark.kind ==
                        vf::material::TreeCanopyPrimitiveKind::bark &&
                    bundle.foliage.kind ==
                        vf::material::TreeCanopyPrimitiveKind::foliage &&
                    bundle.wood.tree_id == bundle.population.tree_id &&
                    bundle.bark.tree_id == bundle.population.tree_id &&
                    bundle.foliage.tree_id ==
                        bundle.population.tree_id,
                "forest bundle mixed tree or species identity");
        require(bundle.wood.population_variation ==
                    bundle.bark.population_variation &&
                    bundle.wood.species_variation ==
                        bundle.bark.species_variation &&
                    bundle.wood.individual_variation ==
                        bundle.foliage.individual_variation,
                "forest bundle lost hierarchy conditioning");
    }
    require(first.realization.wood_energy.violations == 0 &&
                first.realization.canopy_energy.violations == 0 &&
                first.realization.wood_energy.maximum <= 1.0f &&
                first.realization.canopy_energy.maximum <= 1.0f,
            "forest tree material pipeline escaped passive energy");
    require(first.packet != nullptr &&
                first.packet->bytes.size() == 5 * bundle_bytes &&
                first.upload_bytes == 5 * bundle_bytes &&
                first.resident_bytes == 5 * bundle_bytes,
            "first forest tree packet escaped residency bounds");
    require(first.version == 7482120284019216133ull,
            "forest tree pipeline version changed nondeterministically");
    const auto first_version = first.version;
    const auto first_bytes = first.packet->bytes;
    const auto* first_packet = first.packet.get();

    std::reverse(
        demanded_tree_ids.begin(),
        demanded_tree_ids.end()
    );
    const auto stable =
        vf::material::UpdateForestTreeMaterialPipelineReference(
            definition,
            forest,
            demanded_tree_ids,
            5,
            &first
        );
    require(stable.retained && stable.packet.get() == first_packet &&
                stable.upload_bytes == 0 &&
                stable.repacked_bundles == 0 &&
                stable.version == first_version,
            "stable or reversed forest tree demand uploaded data");

    auto expanded_tree_ids = demanded_tree_ids;
    expanded_tree_ids.push_back(forest.trees.back().tree_id);
    const auto expanded =
        vf::material::UpdateForestTreeMaterialPipelineReference(
            definition,
            forest,
            expanded_tree_ids,
            6,
            &stable
        );
    require(!expanded.retained && expanded.repacked_bundles == 1 &&
                expanded.upload_bytes == bundle_bytes &&
                expanded.resident_bytes == 6 * bundle_bytes,
            "one demanded tree repacked unrelated forest bundles");

    const auto regenerated =
        vf::material::UpdateForestTreeMaterialPipelineReference(
            definition,
            forest,
            demanded_tree_ids,
            5,
            &expanded
        );
    require(regenerated.version == first_version &&
                regenerated.packet->bytes == first_bytes,
            "forest tree material packet did not regenerate exactly");

    auto invalid_tree_ids = demanded_tree_ids;
    invalid_tree_ids[0] = 7;
    bool rejected_unknown_tree = false;
    try {
        static_cast<void>(
            vf::material::RealizeForestTreeMaterialPipelineReference(
                definition,
                forest,
                invalid_tree_ids,
                5
            )
        );
    } catch (const std::out_of_range&) {
        rejected_unknown_tree = true;
    }
    require(rejected_unknown_tree,
            "forest pipeline accepted an unknown tree identity");

    std::cout << "forest tree material pipeline: bundles="
              << first.realization.bundles.size()
              << " resident=" << first.resident_bytes
              << " stable_upload=" << stable.upload_bytes
              << " tree_delta=" << expanded.upload_bytes
              << " version=" << first.version << '\n';
    return 0;
}
