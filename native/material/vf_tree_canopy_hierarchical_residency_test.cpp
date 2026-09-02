#include "native/material/vf_tree_canopy_hierarchical_residency.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    const vf::material::TreeCanopyHierarchicalDefinition definition{
        {
            {0x1f83d9abfb41bd6bull, 0x5be0cd19137e2179ull},
            19,
            5,
            1000000000ull,
            1000000000ull,
        },
        1000000000ull,
    };
    constexpr std::uint64_t root =
        std::numeric_limits<std::uint64_t>::max();
    using Kind = vf::material::TreeCanopyPrimitiveKind;
    std::vector<vf::material::TreeCanopyHierarchicalDemand> demands{
        {30, 17, 2, {10.0, 10.0}, 20, Kind::foliage,
         {0.8, 0.1, 4.2}, {0.2, 0.3, 1.0}},
        {10, 17, 2, {10.0, 10.0}, root, Kind::bark,
         {0.0, 0.0, 1.0}, {0.0, 0.0, 1.0}},
        {40, 17, 2, {10.0, 10.0}, 20, Kind::foliage,
         {-0.7, 0.2, 4.0}, {-0.1, 0.4, 1.0}},
        {20, 17, 2, {10.0, 10.0}, 10, Kind::bark,
         {0.2, 0.0, 3.0}, {0.7, 0.0, 0.7}},
    };
    constexpr std::size_t record_bytes =
        vf::material::kTreeCanopyHierarchicalRecordBytes;
    const auto first =
        vf::material::UpdateTreeCanopyHierarchicalResidencyReference(
            definition,
            demands,
            4,
            nullptr
        );
    require(first.realization.potential_primitives_per_tree ==
                1000000000ull &&
                first.realization.samples.size() == 4,
            "tree canopy materialized undemanded primitives");
    require(first.realization.samples[0].primitive_id == 10 &&
                first.realization.samples[1].primitive_id == 20 &&
                first.realization.samples[2].primitive_id == 30 &&
                first.realization.samples[3].primitive_id == 40,
            "tree canopy demands were not canonicalized");
    const auto& trunk = first.realization.samples[0];
    const auto& branch = first.realization.samples[1];
    const auto& leaf = first.realization.samples[2];
    require(trunk.parent_id == root && branch.parent_id == 10 &&
                leaf.parent_id == 20,
            "tree canopy lost developmental parent identity");
    require(trunk.kind == Kind::bark && branch.kind == Kind::bark &&
                leaf.kind == Kind::foliage &&
                trunk.base_color[0] > trunk.base_color[1] &&
                leaf.base_color[1] > leaf.base_color[0],
            "tree canopy did not distinguish bark and foliage");
    require(trunk.population_variation == leaf.population_variation &&
                trunk.species_variation == leaf.species_variation &&
                trunk.individual_variation == leaf.individual_variation &&
                trunk.primitive_variation != leaf.primitive_variation,
            "tree canopy lost its hierarchy levels");
    require(first.realization.energy.violations == 0 &&
                first.realization.energy.minimum >= 0.0f &&
                first.realization.energy.maximum <= 1.0f,
            "tree canopy material escaped passive energy bounds");
    require(first.packet != nullptr &&
                first.packet->bytes.size() == 4 * record_bytes &&
                first.upload_bytes == 4 * record_bytes &&
                first.resident_bytes == 4 * record_bytes,
            "first canopy packet escaped residency bounds");
    require(first.version == 9081554265648299290ull,
            "tree canopy version changed nondeterministically");
    const auto first_version = first.version;
    const auto first_bytes = first.packet->bytes;
    const auto* first_packet = first.packet.get();

    std::reverse(demands.begin(), demands.end());
    const auto stable =
        vf::material::UpdateTreeCanopyHierarchicalResidencyReference(
            definition,
            demands,
            4,
            &first
        );
    require(stable.retained && stable.packet.get() == first_packet &&
                stable.upload_bytes == 0 &&
                stable.repacked_primitives == 0 &&
                stable.version == first_version,
            "stable or reversed canopy demand scheduled an upload");

    auto changed_demands = demands;
    changed_demands[1].developmental_position[0] += 0.125;
    const auto changed =
        vf::material::UpdateTreeCanopyHierarchicalResidencyReference(
            definition,
            changed_demands,
            4,
            &stable
        );
    require(!changed.retained && changed.repacked_primitives == 1 &&
                changed.upload_bytes == record_bytes,
            "one changed canopy primitive repacked unrelated records");

    const auto regenerated =
        vf::material::UpdateTreeCanopyHierarchicalResidencyReference(
            definition,
            demands,
            4,
            &changed
        );
    require(regenerated.version == first_version &&
                regenerated.packet->bytes == first_bytes,
            "tree canopy packet did not regenerate exactly");

    auto invalid_demands = demands;
    invalid_demands[0].axis = {0.0, 0.0, 0.0};
    bool rejected_zero_axis = false;
    try {
        static_cast<void>(
            vf::material::RealizeTreeCanopyHierarchicalReference(
                definition,
                invalid_demands,
                4
            )
        );
    } catch (const std::invalid_argument&) {
        rejected_zero_axis = true;
    }
    require(rejected_zero_axis,
            "tree canopy accepted a zero developmental axis");

    auto invalid_material = first.realization;
    invalid_material.energy.maximum = 1.01f;
    bool rejected_invalid_energy = false;
    try {
        static_cast<void>(
            vf::material::PackTreeCanopyHierarchicalBytesReference(
                invalid_material
            )
        );
    } catch (const std::domain_error&) {
        rejected_invalid_energy = true;
    }
    require(rejected_invalid_energy,
            "tree canopy packet accepted non-passive energy");

    std::cout << "hierarchical tree canopy residency: samples="
              << first.realization.samples.size()
              << " resident=" << first.resident_bytes
              << " stable_upload=" << stable.upload_bytes
              << " primitive_delta=" << changed.upload_bytes
              << " version=" << first.version << '\n';
    return 0;
}
