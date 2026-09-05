#include "native/material/vf_road_hierarchical_residency.hpp"

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
    const vf::material::RoadHierarchicalMaterialDefinition definition{
        {0x3c6ef372fe94f82bull, 0xa54ff53a5f1d36f1ull},
        7,
        1000000000ull,
        1000000000ull,
    };
    std::vector<vf::material::RoadHierarchicalMaterialDemand> demands{
        {7, 90, {7.25, -0.5}},
        {7, 1, {7.0, 0.0}},
    };
    constexpr std::size_t coarse_bytes = 72;
    constexpr std::size_t record_bytes =
        vf::material::kRoadHierarchicalDetailRecordBytes;
    const auto first =
        vf::material::UpdateRoadHierarchicalResidencyReference(
            definition,
            7,
            demands,
            2,
            nullptr
        );
    require(first.packet != nullptr && !first.retained &&
                first.packet->coarse->vertices.size() == 12 &&
                first.packet->coarse->indices.size() == 6,
            "first road residency omitted its coarse strip");
    require(first.material.samples.size() == 2 &&
                first.packet->detail_bytes.size() == 2 * record_bytes,
            "road packet packed undemanded local detail");
    require(first.material.energy.violations == 0 &&
                first.material.energy.minimum_energy >= 0.0f &&
                first.material.energy.maximum_energy <= 1.0f,
            "road packet admitted non-passive material");
    require(first.repacked_samples == 2 &&
                first.upload_bytes == coarse_bytes + 2 * record_bytes &&
                first.resident_bytes == coarse_bytes + 2 * record_bytes,
            "first road packet escaped residency bounds");
    const auto first_version = first.version;
    const auto first_vertices = first.packet->coarse->vertices;
    const auto first_details = first.packet->detail_bytes;
    const auto* first_packet = first.packet.get();
    require(first_version == 10719266955414531121ull,
            "canonical road packet version changed");

    auto invalid_material = first.material;
    invalid_material.energy.maximum_energy = 1.01f;
    bool passive_rejected = false;
    try {
        static_cast<void>(
            vf::material::PackRoadHierarchicalDetailBytesReference(
                invalid_material
            )
        );
    } catch (const std::domain_error&) {
        passive_rejected = true;
    }
    require(passive_rejected,
            "non-passive road material reached byte packing");

    std::reverse(demands.begin(), demands.end());
    const auto stable =
        vf::material::UpdateRoadHierarchicalResidencyReference(
            definition,
            7,
            demands,
            2,
            &first
        );
    require(stable.retained && stable.packet.get() == first_packet &&
                stable.upload_bytes == 0 &&
                stable.repacked_samples == 0 &&
                stable.version == first_version,
            "stable or reversed road demand scheduled an upload");

    const std::vector<vf::material::RoadHierarchicalMaterialDemand>
        changed_demands{
            {7, 91, {7.4, -0.6}},
            {7, 1, {7.0, 0.0}},
        };
    const auto changed =
        vf::material::UpdateRoadHierarchicalResidencyReference(
            definition,
            7,
            changed_demands,
            2,
            &stable
        );
    require(!changed.retained &&
                changed.packet->coarse == stable.packet->coarse &&
                changed.repacked_samples == 1 &&
                changed.upload_bytes == record_bytes,
            "one road detail change replaced the coarse strip");
    require(std::equal(
                first_details.begin(),
                first_details.begin() + record_bytes,
                changed.packet->detail_bytes.begin()
            ),
            "unchanged road detail bytes were repacked");

    const std::vector<vf::material::RoadHierarchicalMaterialDemand>
        next_segment_demands{
            {8, 1, {8.0, 0.0}},
            {8, 91, {8.4, -0.6}},
        };
    const auto next_segment =
        vf::material::UpdateRoadHierarchicalResidencyReference(
            definition,
            8,
            next_segment_demands,
            2,
            &changed
        );
    require(next_segment.packet->coarse != changed.packet->coarse &&
                next_segment.repacked_samples == 2 &&
                next_segment.upload_bytes ==
                    coarse_bytes + 2 * record_bytes,
            "road segment change escaped its full packet bound");

    std::reverse(demands.begin(), demands.end());
    const auto regenerated =
        vf::material::UpdateRoadHierarchicalResidencyReference(
            definition,
            7,
            demands,
            2,
            &next_segment
        );
    require(regenerated.version == first_version &&
                regenerated.packet->coarse->vertices == first_vertices &&
                regenerated.packet->detail_bytes == first_details,
            "evicted road segment did not regenerate exactly");

    const auto repeated =
        vf::material::UpdateRoadHierarchicalResidencyReference(
            definition,
            7,
            demands,
            2,
            nullptr
        );
    require(repeated.version == first_version &&
                repeated.packet->coarse->vertices == first_vertices &&
                repeated.packet->detail_bytes == first_details,
            "fresh road packet bytes were not deterministic");

    std::cout << "hierarchical road residency: samples="
              << first.material.samples.size()
              << " resident=" << first.resident_bytes
              << " stable_upload=" << stable.upload_bytes
              << " detail_delta=" << changed.upload_bytes
              << " segment_delta=" << next_segment.upload_bytes
              << " version=" << first.version << '\n';
    return 0;
}
