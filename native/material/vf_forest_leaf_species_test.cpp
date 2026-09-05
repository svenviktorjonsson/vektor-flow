#include "native/material/vf_forest_leaf_species.hpp"
#include "native/material/vf_procedural_scene_producer_packets.hpp"

#include <algorithm>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>

namespace {
void require(bool value, const char* message) {
    if (!value) throw std::runtime_error(message);
}
template<class Exception, class Function>
void require_exception(Function function, const char* expected) {
    try { function(); }
    catch (const Exception& error) {
        require(std::string(error.what()) == expected,
                "existing rejection diagnostic changed");
        return;
    }
    throw std::runtime_error("invalid species demand was accepted");
}
vf::material::ForestTreeDrawPacket draw(
    const vf::material::ForestTreeMaterialPipelineRealization& realization
) {
    using namespace vf::material;
    ForestTreeMaterialPipelineState state{};
    state.realization = realization;
    state.packet = std::make_shared<const ForestTreeMaterialPipelinePacket>(
        ForestTreeMaterialPipelinePacket{
            PackForestTreeMaterialPipelineBytesReference(realization)});
    return CreateForestTreeDrawPacketReference(state);
}
}

int main() {
    using namespace vf::material;
    const ForestPopulationDefinition population{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31, 5, 1000000000ull, 1000000000ull, 64.0, 15.0,
    };
    const auto forest = RealizeForestPopulationReference(
        population, {{9, {2, 3}, 5}, {3, {1, 3}, 4}}, 9);
    const ForestTreeMaterialPipelineDefinition definition{
        population,
        {population.seed, population.population_id, population.species_count,
         1000000000000000000ull, 1000000000ull},
        1000000000ull,
    };
    const auto distribution = BuildLeafSpeciesConditionedDistributionV1();
    std::vector<ForestLeafSpeciesDemand> demands;
    std::vector<std::uint64_t> ids;
    for (std::size_t i = 0; i < distribution.members.size(); ++i) {
        ids.push_back(forest.trees[i].tree_id);
        demands.push_back({ids.back(), distribution.members[i].species});
    }
    const auto baseline = RealizeForestTreeMaterialPipelineReference(
        definition, forest, ids, 9);
    const auto conditioned = RealizeForestLeafSpeciesReference(
        definition, forest, demands, 9);
    require(conditioned.bundles.size() == 9 &&
                conditioned.logical_tree_capacity == baseline.logical_tree_capacity,
            "species composition realized undemanded trees");
    std::set<std::array<float, 3>> colors;
    for (std::size_t i = 0; i < demands.size(); ++i) {
        const auto& expected = baseline.bundles[i];
        const auto& actual = conditioned.bundles[i];
        require(actual.population == expected.population &&
                    actual.wood == expected.wood && actual.bark == expected.bark,
                "leaf condition changed population, wood or bark");
        require(actual.foliage == ApplyLeafSpeciesConditionReference(
                    expected.foliage, distribution, demands[i].species),
                "forest leaf material differs from measured species contract");
        colors.insert(actual.foliage.base_color);
    }
    require(colors.size() == 9, "leaf material variants collapsed");
    require(conditioned.wood_energy == baseline.wood_energy &&
                conditioned.canopy_energy.violations == 0 &&
                conditioned.canopy_energy.minimum >= 0.0f &&
                conditioned.canopy_energy.maximum <= 1.0f,
            "conditioned forest escaped existing passive-energy contract");
    const auto baseline_draw = draw(baseline);
    const auto conditioned_draw = draw(conditioned);
    require(conditioned_draw.indices == baseline_draw.indices &&
                conditioned_draw.material_offsets == baseline_draw.material_offsets &&
                conditioned_draw.material->bytes != baseline_draw.material->bytes,
            "measured foliage did not reach existing bound draw packet");
    for (std::size_t i = 0; i < conditioned_draw.vertices.size(); ++i) {
        const auto local_vertex = (i / 10) % 14;
        const auto component = i % 10;
        if (local_vertex < 8 || component < 6 || component == 9)
            require(conditioned_draw.vertices[i] == baseline_draw.vertices[i],
                    "leaf material changed geometry, normal, alpha or bark");
        else {
            const auto tree = (i / 10) / 14;
            require(conditioned_draw.vertices[i] ==
                        conditioned.bundles[tree].foliage.base_color[component - 6],
                    "conditioned leaf color did not reach renderer vertices");
        }
    }
    std::reverse(demands.begin(), demands.end());
    require(RealizeForestLeafSpeciesReference(definition, forest, demands, 9) ==
                conditioned,
            "conditioned material depended on demand traversal");
    require(draw(RealizeForestLeafSpeciesReference(definition, forest, demands, 9)) ==
                conditioned_draw,
            "conditioned draw bytes did not replay exactly");
    auto changed = demands;
    changed.front().species = distribution.members.front().species;
    const auto changed_material = RealizeForestLeafSpeciesReference(
        definition, forest, changed, 9);
    require(CountDeterministicPacketRecordChanges(
                conditioned_draw.material->bytes,
                PackForestTreeMaterialPipelineBytesReference(changed_material),
                kForestTreeMaterialBundleBytes) == 1,
            "one explicit leaf condition changed unrelated material bundles");
    auto unsupported = demands;
    unsupported.front().species = static_cast<LeafSpeciesConditionV1>(99);
    require_exception<std::invalid_argument>([&] {
        RealizeForestLeafSpeciesReference(definition, forest, unsupported, 9);
    }, "leaf species condition is unsupported");
    auto duplicated = demands;
    duplicated.back().tree_id = duplicated.front().tree_id;
    require_exception<std::invalid_argument>([&] {
        RealizeForestLeafSpeciesReference(definition, forest, duplicated, 9);
    }, "forest tree material demand is duplicated");
    auto missing = demands;
    missing.front().tree_id = 7;
    require_exception<std::out_of_range>([&] {
        RealizeForestLeafSpeciesReference(definition, forest, missing, 9);
    }, "forest tree material identity is not resident");
    require_exception<std::range_error>([&] {
        RealizeForestLeafSpeciesReference(definition, forest, demands, 8);
    }, "forest tree material demand exceeds budget");
    require(RealizeForestTreeMaterialPipelineReference(definition, forest, ids, 9) ==
                baseline,
            "conditioning mutated the unconditioned source");
    std::cout << "forest leaf species: variants=" << colors.size()
              << " material_bytes=" << conditioned_draw.material->bytes.size()
              << " draw_version=" << conditioned_draw.version << '\n';
}
