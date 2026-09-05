#include "native/material/vf_stone_hierarchical_material_draw_packet.hpp"

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

std::uint64_t HashBytes(const std::vector<std::uint8_t>& bytes) {
    std::uint64_t hash = 1469598103934665603ull;
    for (const std::uint8_t byte : bytes) {
        hash ^= byte;
        hash *= 1099511628211ull;
    }
    return hash;
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
    std::vector<vf::material::StoneMaterialDemand> demands{
        {Kind::Face, 0},
        {Kind::Vertex, 0},
    };
    const auto first =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            refined,
            demands,
            2,
            nullptr
        );
    constexpr std::size_t record_bytes =
        vf::material::kStoneHierarchicalMaterialRecordBytes;
    require(first.packet != nullptr && !first.retained,
            "first material draw packet was not packed");
    require(first.packet->geometry == first.geometry.packet,
            "material packet did not retain demanded geometry");
    require(first.material.samples.size() == 2 &&
                first.packet->material_bytes.size() == 2 * record_bytes,
            "material packet included undemanded surface samples");
    require(first.material.energy.violations == 0 &&
                first.material.energy.minimum >= 0.0f &&
                first.material.energy.maximum <= 1.0f,
            "unvalidated passive material reached draw packing");
    require(first.repacked_samples == 2 &&
                first.upload_bytes ==
                    first.geometry.upload_bytes + 2 * record_bytes,
            "initial material upload accounting changed");

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
    std::reverse(demands.begin(), demands.end());
    const auto steady =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            steady_refined,
            demands,
            2,
            &first
        );
    require(steady.retained && steady.packet == first.packet &&
                steady.geometry.retained,
            "stable view repacked material draw data");
    require(steady.repacked_samples == 0 && steady.upload_bytes == 0,
            "stable view scheduled a material upload");

    const std::vector<vf::material::StoneMaterialDemand> changed_demands{
        {Kind::Face, 1},
        {Kind::Vertex, 0},
    };
    const auto changed =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            steady_refined,
            changed_demands,
            2,
            &steady
        );
    require(!changed.retained && changed.geometry.retained &&
                changed.packet != steady.packet &&
                changed.packet->geometry == steady.packet->geometry,
            "surface demand replaced stable geometry buffers");
    require(changed.repacked_samples == 1 &&
                changed.upload_bytes == record_bytes,
            "surface demand escaped one-record upload bound");
    require(std::equal(
                first.packet->material_bytes.begin(),
                first.packet->material_bytes.begin() + record_bytes,
                changed.packet->material_bytes.begin()
            ),
            "unchanged material record bytes were not preserved");

    std::reverse(demands.begin(), demands.end());
    const auto regenerated =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            member,
            refined,
            demands,
            2,
            nullptr
        );
    require(regenerated.packet->material_bytes ==
                first.packet->material_bytes &&
                HashBytes(regenerated.packet->material_bytes) ==
                    HashBytes(first.packet->material_bytes),
            "material packet bytes depended on traversal or residency");
    require(HashBytes(first.packet->material_bytes) ==
                6565731993597997717ull,
            "canonical material packet hash changed");

    auto invalid = first.material;
    invalid.energy.maximum = 1.01f;
    bool rejected = false;
    try {
        static_cast<void>(
            vf::material::PackStoneHierarchicalMaterialDrawPacketReference(
                first.geometry.packet,
                invalid
            )
        );
    } catch (const std::domain_error&) {
        rejected = true;
    }
    require(rejected,
            "non-passive material was packed for drawing");

    std::cout << "hierarchical material draw packet: samples="
              << first.material.samples.size()
              << " bytes=" << first.packet->material_bytes.size()
              << " stable_upload=" << steady.upload_bytes
              << " delta_upload=" << changed.upload_bytes
              << " hash=" << HashBytes(first.packet->material_bytes)
              << '\n';
    return 0;
}
