#include "native/material/vf_procedural_scene_integration_inventory.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    const vf::material::StonePopulationDefinition stone_definition{
        {0x3c6ef372fe94f82bull, 0xa54ff53a5f1d36f1ull},
        42,
        1000000000ull,
    };
    const auto stones = vf::material::RealizeStonePopulationReference(
        stone_definition,
        {{17, {10.0, 10.0}}},
        1,
        6,
        8
    );
    const auto& stone = stones.members.front();
    const vf::material::StoneViewCamera camera{
        {8.0, 0.0, 0.0},
        {0.0, 0.0, 0.0},
        {0.0, 0.0, 1.0},
        std::acos(-1.0) / 3.0,
        1080.0,
    };
    const auto refinement =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone.coarse,
            nullptr,
            camera,
            0.0,
            2,
            8,
            12
        );
    using Kind = vf::material::StoneMaterialElementKind;
    const auto stone_draw =
        vf::material::UpdateStoneHierarchicalMaterialDrawReference(
            stone,
            refinement,
            {{Kind::Face, 0}, {Kind::Vertex, 0}},
            2,
            nullptr
        );

    const vf::material::RoadHierarchicalMaterialDefinition
        road_definition{
            {0x3c6ef372fe94f82bull, 0xa54ff53a5f1d36f1ull},
            7,
            1000000000ull,
            1000000000ull,
        };
    const auto road =
        vf::material::UpdateRoadHierarchicalResidencyReference(
            road_definition,
            7,
            {{7, 90, {7.25, -0.5}}, {7, 1, {7.0, 0.0}}},
            2,
            nullptr
        );

    const vf::material::ForestPopulationDefinition forest_definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31,
        5,
        1000000000ull,
        1000000000ull,
        64.0,
        0.0,
    };
    const auto forest =
        vf::material::RealizeForestPopulationReference(
            forest_definition,
            {{27, {3, 7}, 2}},
            2
        );
    std::vector<std::uint64_t> tree_ids;
    for (const auto& tree : forest.trees) {
        tree_ids.push_back(tree.tree_id);
    }
    const vf::material::ForestTreeMaterialPipelineDefinition
        forest_material_definition{
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
    const auto forest_material =
        vf::material::UpdateForestTreeMaterialPipelineReference(
            forest_material_definition,
            forest,
            tree_ids,
            2,
            nullptr
        );

    const auto report = vf::material::
        AuditProceduralFixedSceneIntegrationReference(
            *stone_draw.packet,
            *road.packet,
            *forest_material.packet
        );
    using Gate = vf::material::ProceduralSceneIntegrationGate;
    require(report.entries[0].gate == Gate::ready &&
                report.entries[0].kind ==
                    vf::material::ProceduralSceneContentKind::stone,
            "stone draw packet was not consumer-ready");
    require(report.entries[1].gate ==
                Gate::needs_material_binding &&
                report.entries[1].kind ==
                    vf::material::ProceduralSceneContentKind::road,
            "road integration blocker was not isolated");
    require(report.entries[2].gate == Gate::needs_geometry &&
                report.entries[2].kind ==
                    vf::material::ProceduralSceneContentKind::forest,
            "forest integration blocker was not isolated");
    require(report.ready_entries == 1 &&
                report.blocked_entries == 2 &&
                report.resident_bytes == 1354 &&
                report.resident_bytes == stone_draw.upload_bytes +
                    road.resident_bytes +
                    forest_material.resident_bytes &&
                report.entries[0].geometry_bytes == 464 &&
                report.entries[0].material_bytes == 106 &&
                report.entries[1].geometry_bytes == 72 &&
                report.entries[1].material_bytes == 120 &&
                report.entries[2].geometry_bytes == 0 &&
                report.entries[2].material_bytes == 592 &&
                sizeof(report) == 224 &&
                report.version == 9896093521623019658ull,
            "fixed-scene integration accounting changed");

    auto reversed_tree_ids = tree_ids;
    std::reverse(
        reversed_tree_ids.begin(),
        reversed_tree_ids.end()
    );
    const auto forest_replay =
        vf::material::UpdateForestTreeMaterialPipelineReference(
            forest_material_definition,
            forest,
            reversed_tree_ids,
            2,
            nullptr
        );
    const auto replay = vf::material::
        AuditProceduralFixedSceneIntegrationReference(
            *stone_draw.packet,
            *road.packet,
            *forest_replay.packet
        );
    require(replay == report,
            "integration inventory depended on demand traversal");

    auto invalid_road = *road.packet;
    auto invalid_coarse =
        std::make_shared<vf::material::RoadHierarchicalCoarseStrip>(
            *road.packet->coarse
        );
    invalid_coarse->indices.back() = 99;
    invalid_road.coarse = std::move(invalid_coarse);
    bool invalid_rejected = false;
    try {
        static_cast<void>(
            vf::material::AuditProceduralRoadIntegrationReference(
                invalid_road
            )
        );
    } catch (const std::invalid_argument&) {
        invalid_rejected = true;
    }
    require(invalid_rejected,
            "integration inventory accepted invalid geometry");

    using Clock = std::chrono::steady_clock;
    std::vector<double> timings;
    timings.reserve(25);
    for (std::size_t sample = 0; sample < 25; ++sample) {
        const auto start = Clock::now();
        for (std::size_t run = 0; run < 1000; ++run) {
            const auto measured = vf::material::
                AuditProceduralFixedSceneIntegrationReference(
                    *stone_draw.packet,
                    *road.packet,
                    *forest_material.packet
                );
            require(measured.version == report.version,
                    "timed inventory changed identity");
        }
        const auto finish = Clock::now();
        timings.push_back(
            std::chrono::duration<double, std::micro>(
                finish - start
            ).count()
        );
    }
    std::sort(timings.begin(), timings.end());
    std::cout << "procedural scene integration inventory: ready="
              << report.ready_entries
              << " blocked=" << report.blocked_entries
              << " resident_bytes=" << report.resident_bytes
              << " stone_bytes="
              << report.entries[0].geometry_bytes +
                    report.entries[0].material_bytes
              << " road_bytes="
              << report.entries[1].geometry_bytes +
                    report.entries[1].material_bytes
              << " forest_bytes="
              << report.entries[2].material_bytes
              << " report_bytes=" << sizeof(report)
              << " median_us_per_1000=" << timings[12]
              << " version=" << report.version << '\n';
    return 0;
}
