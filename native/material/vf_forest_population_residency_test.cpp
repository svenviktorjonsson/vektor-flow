#include "native/material/vf_forest_population_residency.hpp"

#include <algorithm>
#include <cmath>
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
    const vf::material::ForestPopulationDefinition definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31,
        5,
        1000000000ull,
        1000000000ull,
        64.0,
        15.0,
    };
    std::vector<vf::material::ForestPatchDemand> demands{
        {9, {2, 3}, 5},
        {3, {1, 3}, 4},
    };
    constexpr std::size_t record_bytes =
        vf::material::kForestPopulationRecordBytes;
    const auto first =
        vf::material::UpdateForestPopulationResidencyReference(
            definition,
            demands,
            9,
            nullptr
        );
    require(first.realization.potential_patches == 1000000000ull &&
                first.realization.potential_trees_per_patch ==
                    1000000000ull &&
                first.realization.trees.size() == 9,
            "forest population materialized undemanded trees");
    require(first.realization.evaluated_candidates <= 9 * 64,
            "forest demand evaluated an unbounded candidate set");
    require(first.realization.evaluated_candidates >
                first.realization.trees.size(),
            "forest local competition did not reject a candidate");
    require(first.realization.trees.front().patch_id == 3 &&
                first.realization.trees.back().patch_id == 9,
            "forest patch demands were not canonicalized");
    for (const auto& tree : first.realization.trees) {
        require(tree.species_id < definition.species_count &&
                    tree.age >= 0.0f && tree.age <= 1.0f &&
                    tree.size >= 0.0f && tree.size <= 1.0f &&
                    tree.health >= 0.0f && tree.health <= 1.0f,
                "forest conditioned marks escaped bounds");
    }
    for (std::size_t first_index = 0;
         first_index < first.realization.trees.size();
         ++first_index) {
        const auto& first_tree = first.realization.trees[first_index];
        for (std::size_t second_index = first_index + 1;
             second_index < first.realization.trees.size();
             ++second_index) {
            const auto& second_tree =
                first.realization.trees[second_index];
            if (first_tree.patch_id != second_tree.patch_id) continue;
            const double dx = first_tree.position[0] -
                second_tree.position[0];
            const double dy = first_tree.position[1] -
                second_tree.position[1];
            require(std::hypot(dx, dy) >=
                        definition.minimum_spacing,
                    "forest local competition violated spacing");
        }
    }
    const auto& nearby_first = first.realization.trees.front();
    const auto nearby_second =
        vf::material::RealizeForestPopulationReference(
            definition,
            {{4, {1, 4}, 1}},
            1
        ).trees.front();
    require(std::abs(
                nearby_first.environment_variation -
                nearby_second.environment_variation
            ) < 0.5,
            "nearby forest patches lost environmental coherence");
    require(first.packet != nullptr &&
                first.packet->bytes.size() == 9 * record_bytes &&
                first.upload_bytes == 9 * record_bytes &&
                first.resident_bytes == 9 * record_bytes,
            "first forest packet escaped residency bounds");
    require(first.version == 11808347755523723790ull,
            "forest population version changed nondeterministically");
    const auto first_version = first.version;
    const auto first_bytes = first.packet->bytes;
    const auto* first_packet = first.packet.get();

    std::reverse(demands.begin(), demands.end());
    const auto stable =
        vf::material::UpdateForestPopulationResidencyReference(
            definition,
            demands,
            9,
            &first
        );
    require(stable.retained && stable.packet.get() == first_packet &&
                stable.upload_bytes == 0 &&
                stable.repacked_trees == 0 &&
                stable.version == first_version,
            "stable or reversed forest demand scheduled an upload");

    auto changed_demands = demands;
    for (auto& demand : changed_demands) {
        if (demand.patch_id == 9) ++demand.tree_budget;
    }
    const auto changed =
        vf::material::UpdateForestPopulationResidencyReference(
            definition,
            changed_demands,
            10,
            &stable
        );
    require(!changed.retained && changed.repacked_trees == 1 &&
                changed.upload_bytes == record_bytes &&
                changed.resident_bytes == 10 * record_bytes,
            "one added forest tree repacked unrelated records");

    const auto regenerated =
        vf::material::UpdateForestPopulationResidencyReference(
            definition,
            demands,
            9,
            &changed
        );
    require(regenerated.version == first_version &&
                regenerated.packet->bytes == first_bytes,
            "forest population packet did not regenerate exactly");

    std::cout << "forest population residency: trees="
              << first.realization.trees.size()
              << " candidates="
              << first.realization.evaluated_candidates
              << " resident=" << first.resident_bytes
              << " stable_upload=" << stable.upload_bytes
              << " tree_delta=" << changed.upload_bytes
              << " version=" << first.version << '\n';
    return 0;
}
