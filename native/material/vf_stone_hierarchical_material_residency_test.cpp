#include "native/material/vf_stone_hierarchical_material_residency.hpp"

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
    const vf::material::StonePopulationDefinition definition{
        {0x3c6ef372fe94f82bull, 0xa54ff53a5f1d36f1ull},
        42,
        1000000000ull,
    };
    const auto population =
        vf::material::RealizeStonePopulationReference(
            definition,
            {{17, {10.0, 10.0}}},
            1,
            6,
            8
        );
    const auto& member = population.members.front();
    const vf::material::StoneViewCamera camera{
        {8.0, 0.0, 0.0},
        {0.0, 0.0, 0.0},
        {0.0, 0.0, 1.0},
        std::acos(-1.0) / 3.0,
        1080.0,
    };
    const auto refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            member.coarse,
            nullptr,
            camera,
            0.0,
            2,
            8,
            12
        );
    using Kind = vf::material::StoneMaterialElementKind;
    const std::vector<vf::material::StoneMaterialDemand> first_demands{
        {Kind::Vertex, 0},
        {Kind::Face, 0},
    };
    const auto first_draw =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            refined,
            first_demands,
            2,
            nullptr
        );
    constexpr std::size_t packet_bytes = 464 + 2 * 53;
    auto residency =
        vf::material::UpdateStoneHierarchicalMaterialResidencyReference(
            nullptr,
            17,
            refined,
            first_draw,
            packet_bytes
        );
    require(!residency.hit && residency.upload_bytes == packet_bytes &&
                residency.resident_bytes == packet_bytes &&
                residency.entries.size() == 1,
            "initial combined residency accounting changed");
    const auto first_version = residency.active_version;
    const auto first_geometry = residency.active->geometry->vertices;
    const auto first_material = residency.active->material_bytes;
    const auto* first_packet = residency.active.get();
    require(first_version == 17193349899520853817ull,
            "canonical combined packet version changed");

    const auto independent_draw =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            refined,
            first_demands,
            2,
            nullptr
        );
    require(independent_draw.packet.get() != first_packet,
            "independent packet unexpectedly shared residency");
    residency =
        vf::material::UpdateStoneHierarchicalMaterialResidencyReference(
            &residency,
            17,
            refined,
            independent_draw,
            packet_bytes
        );
    require(residency.hit && residency.active.get() == first_packet &&
                residency.upload_bytes == 0,
            "semantic cache hit replaced the resident packet");

    const auto steady_refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            member.coarse,
            &refined,
            camera,
            0.0,
            2,
            8,
            12
        );
    auto reversed_demands = first_demands;
    std::reverse(reversed_demands.begin(), reversed_demands.end());
    const auto steady_draw =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            steady_refined,
            reversed_demands,
            2,
            &first_draw
        );
    residency =
        vf::material::UpdateStoneHierarchicalMaterialResidencyReference(
            &residency,
            17,
            steady_refined,
            steady_draw,
            packet_bytes
        );
    require(residency.hit && residency.active.get() == first_packet &&
                residency.upload_bytes == 0 &&
                residency.active_version == first_version,
            "stable combined residency scheduled an upload");

    const std::vector<vf::material::StoneMaterialDemand> changed_demands{
        {Kind::Vertex, 0},
        {Kind::Face, 1},
    };
    const auto changed_draw =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            steady_refined,
            changed_demands,
            2,
            &steady_draw
        );
    residency =
        vf::material::UpdateStoneHierarchicalMaterialResidencyReference(
            &residency,
            17,
            steady_refined,
            changed_draw,
            packet_bytes
        );
    require(!residency.hit && residency.upload_bytes == 53 &&
                residency.active->geometry->vertices == first_geometry &&
                residency.active_version != first_version,
            "material delta replaced or uploaded stable geometry");
    require(residency.evicted_versions ==
                std::vector<std::uint64_t>({first_version}),
            "material replacement evicted a non-deterministic version");

    auto stale_pair = changed_draw;
    stale_pair.material = first_draw.material;
    bool stale_rejected = false;
    try {
        static_cast<void>(
            vf::material::UpdateStoneHierarchicalMaterialResidencyReference(
                &residency,
                17,
                steady_refined,
                stale_pair,
                packet_bytes
            )
        );
    } catch (const std::invalid_argument&) {
        stale_rejected = true;
    }
    require(stale_rejected,
            "stale geometry/material version pairing entered residency");

    auto opposite = camera;
    opposite.eye = {-8.0, 0.0, 0.0};
    const auto moved_refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            member.coarse,
            &steady_refined,
            opposite,
            0.0,
            2,
            8,
            12
        );
    const auto moved_draw =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            moved_refined,
            changed_demands,
            2,
            &changed_draw
        );
    const std::size_t expected_geometry_delta =
        vf::material::StoneHierarchicalGeometryPacketBytes(
            *moved_draw.packet->geometry
        ) + moved_draw.repacked_samples * 53;
    residency =
        vf::material::UpdateStoneHierarchicalMaterialResidencyReference(
            &residency,
            17,
            moved_refined,
            moved_draw,
            packet_bytes
        );
    require(!residency.hit &&
                residency.upload_bytes == expected_geometry_delta &&
                residency.upload_bytes > 53,
            "geometry replacement was mistaken for a material delta");

    const auto regenerated_draw =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            refined,
            first_demands,
            2,
            &moved_draw
        );
    residency =
        vf::material::UpdateStoneHierarchicalMaterialResidencyReference(
            &residency,
            17,
            refined,
            regenerated_draw,
            packet_bytes
        );
    require(!residency.hit &&
                residency.active_version == first_version &&
                residency.active->geometry->vertices == first_geometry &&
                residency.active->material_bytes == first_material,
            "evicted combined version did not regenerate exactly");
    require(residency.entries.size() == 1 &&
                residency.resident_bytes == packet_bytes &&
                residency.peak_resident_bytes == packet_bytes &&
                residency.cache_hits == 2 && residency.uploads == 4 &&
                residency.evictions == 3,
            "combined residency escaped deterministic bounds");

    std::cout << "combined stone residency: hits="
              << residency.cache_hits
              << " uploads=" << residency.uploads
              << " evictions=" << residency.evictions
              << " resident=" << residency.resident_bytes
              << " version=" << residency.active_version << '\n';
    return 0;
}
