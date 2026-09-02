#include "native/material/vf_tree_wood_cut_residency.hpp"

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
    const vf::material::TreeWoodHierarchicalDefinition definition{
        {0x1f83d9abfb41bd6bull, 0x5be0cd19137e2179ull},
        19,
        5,
        1000000000ull,
        1000000000ull,
    };
    constexpr double diagonal = 0.70710678118654752440;
    std::vector<vf::material::TreeWoodCutDemand> demands{
        {30, 17, 2, {10.0, 10.0}, 3,
         {0.31, 0.07, 2.2}, {0.0, 0.0, 1.0}},
        {10, 17, 2, {10.0, 10.0}, 1,
         {0.31, 0.07, 2.2}, {1.0, 0.0, 0.0}},
        {20, 17, 2, {10.0, 10.0}, 2,
         {0.31, 0.07, 2.2}, {diagonal, 0.0, diagonal}},
    };
    constexpr std::size_t record_bytes =
        vf::material::kTreeWoodCutRecordBytes;
    const auto first = vf::material::UpdateTreeWoodCutResidencyReference(
        definition,
        demands,
        3,
        nullptr
    );
    require(first.realization.potential_samples_per_tree ==
                1000000000ull &&
                first.realization.samples.size() == 3,
            "wood cut tracer materialized undemanded volume samples");
    const auto& face = first.realization.samples[0];
    const auto& oblique = first.realization.samples[1];
    const auto& end = first.realization.samples[2];
    require(face.cut_id == 10 && oblique.cut_id == 20 &&
                end.cut_id == 30,
            "wood cut demands were not canonicalized");
    require(face.wood.ring == oblique.wood.ring &&
                face.wood.ring == end.wood.ring &&
                face.wood.fiber == oblique.wood.fiber &&
                face.wood.fiber == end.wood.fiber &&
                face.wood.base_color == oblique.wood.base_color &&
                face.wood.base_color == end.wood.base_color,
            "cut orientation broke volumetric wood continuity");
    require(face.axial_alignment == 0.0f &&
                end.axial_alignment == 1.0f &&
                face.wood.roughness < oblique.wood.roughness &&
                oblique.wood.roughness < end.wood.roughness,
            "cut orientation did not condition roughness continuously");
    require(first.realization.energy.violations == 0 &&
                first.realization.energy.minimum >= 0.0f &&
                first.realization.energy.maximum <= 1.0f,
            "wood cut material escaped passive energy bounds");
    require(first.packet != nullptr &&
                first.packet->bytes.size() == 3 * record_bytes &&
                first.upload_bytes == 3 * record_bytes &&
                first.repacked_samples == 3,
            "first cut packet escaped bounded residency");
    require(first.version == 9633033755411324438ull,
            "wood cut packet version changed nondeterministically");
    const auto first_version = first.version;
    const auto first_bytes = first.packet->bytes;
    const auto* first_packet = first.packet.get();

    std::reverse(demands.begin(), demands.end());
    const auto stable = vf::material::UpdateTreeWoodCutResidencyReference(
        definition,
        demands,
        3,
        &first
    );
    require(stable.retained && stable.packet.get() == first_packet &&
                stable.upload_bytes == 0 &&
                stable.repacked_samples == 0 &&
                stable.version == first_version,
            "stable or reversed cut demand scheduled an upload");

    auto changed_demands = demands;
    changed_demands[1].normal = {0.0, 1.0, 0.0};
    const auto changed =
        vf::material::UpdateTreeWoodCutResidencyReference(
            definition,
            changed_demands,
            3,
            &stable
        );
    require(!changed.retained && changed.repacked_samples == 1 &&
                changed.upload_bytes == record_bytes,
            "one changed cut orientation repacked unrelated samples");

    const auto regenerated =
        vf::material::UpdateTreeWoodCutResidencyReference(
            definition,
            demands,
            3,
            &changed
        );
    require(regenerated.version == first_version &&
                regenerated.packet->bytes == first_bytes,
            "wood cut packet did not regenerate exactly");

    auto invalid_demands = demands;
    invalid_demands[0].normal = {0.0, 0.0, 0.0};
    bool rejected_zero_normal = false;
    try {
        static_cast<void>(
            vf::material::RealizeTreeWoodCutReference(
                definition,
                invalid_demands,
                3
            )
        );
    } catch (const std::invalid_argument&) {
        rejected_zero_normal = true;
    }
    require(rejected_zero_normal,
            "wood cut tracer accepted a zero surface normal");

    auto invalid_material = first.realization;
    invalid_material.energy.maximum = 1.01f;
    bool rejected_invalid_energy = false;
    try {
        static_cast<void>(
            vf::material::PackTreeWoodCutBytesReference(invalid_material)
        );
    } catch (const std::domain_error&) {
        rejected_invalid_energy = true;
    }
    require(rejected_invalid_energy,
            "wood cut packet accepted non-passive energy");

    std::cout << "tree/wood cut residency: samples="
              << first.realization.samples.size()
              << " resident=" << first.resident_bytes
              << " stable_upload=" << stable.upload_bytes
              << " cut_delta=" << changed.upload_bytes
              << " version=" << first.version << '\n';
    return 0;
}
