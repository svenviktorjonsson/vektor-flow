#include "native/material/vf_procedural_scene_producer_packets.hpp"
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
            {{7, 90, {29.0, -0.5}}, {7, 1, {28.25, 0.75}}},
            2,
            nullptr
        );
    const auto road_surface =
        vf::material::BindRoadMaterialSurfaceReference(road);

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
        forest_definition_material{
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
            forest_definition_material,
            forest,
            tree_ids,
            2,
            nullptr
        );
    const auto forest_draw =
        vf::material::CreateForestTreeDrawPacketReference(
            forest_material
        );

    require(road_surface.source == road.packet &&
                road_surface.binding_bytes.size() == 64 &&
                road_surface.version == 3399996020603820144ull,
            "road surface binding copied or omitted source data");
    require(forest_draw.material == forest_material.packet &&
                forest_draw.vertices.size() == 280 &&
                forest_draw.indices.size() == 120 &&
                forest_draw.material_offsets.size() == 28 &&
                vf::material::ForestTreeDrawGeometryBytesReference(
                    forest_draw
                ) == 1712 &&
                forest_draw.version == 226016667512219093ull,
            "forest draw packet escaped bounded coarse geometry");
    const auto report = vf::material::
        AuditProceduralFixedSceneIntegrationReference(
            *stone_draw.packet,
            road_surface,
            forest_draw
        );
    using Gate = vf::material::ProceduralSceneIntegrationGate;
    require(report.ready_entries == 3 &&
                report.blocked_entries == 0 &&
                report.resident_bytes == 3130 &&
                report.version == 17746054028491652131ull &&
                report.entries[0].gate == Gate::ready &&
                report.entries[1].gate == Gate::ready &&
                report.entries[2].gate == Gate::ready,
            "producer adapters did not close inventory gates");

    auto reversed_ids = tree_ids;
    std::reverse(reversed_ids.begin(), reversed_ids.end());
    const auto reversed_material =
        vf::material::UpdateForestTreeMaterialPipelineReference(
            forest_definition_material,
            forest,
            reversed_ids,
            2,
            nullptr
        );
    const auto reversed_draw =
        vf::material::CreateForestTreeDrawPacketReference(
            reversed_material
        );
    const auto road_replay =
        vf::material::BindRoadMaterialSurfaceReference(road);
    require(reversed_draw == forest_draw &&
                road_replay == road_surface,
            "producer packets depended on traversal or allocation");

    auto invalid_road = road;
    invalid_road.material.samples.front().road_position[0] = 100.0;
    bool road_rejected = false;
    try {
        static_cast<void>(
            vf::material::BindRoadMaterialSurfaceReference(
                invalid_road
            )
        );
    } catch (const std::invalid_argument&) {
        road_rejected = true;
    }
    require(road_rejected,
            "road binding accepted a sample outside its surface");

    auto invalid_forest = forest_material;
    invalid_forest.packet =
        std::make_shared<
            const vf::material::ForestTreeMaterialPipelinePacket
        >(
            vf::material::ForestTreeMaterialPipelinePacket{
                {0},
            }
        );
    bool forest_rejected = false;
    try {
        static_cast<void>(
            vf::material::CreateForestTreeDrawPacketReference(
                invalid_forest
            )
        );
    } catch (const std::invalid_argument&) {
        forest_rejected = true;
    }
    require(forest_rejected,
            "forest draw accepted mismatched material bytes");

    using Clock = std::chrono::steady_clock;
    std::vector<double> timings;
    timings.reserve(25);
    for (std::size_t sample = 0; sample < 25; ++sample) {
        const auto start = Clock::now();
        for (std::size_t run = 0; run < 100; ++run) {
            const auto timed_road =
                vf::material::BindRoadMaterialSurfaceReference(road);
            const auto timed_forest =
                vf::material::CreateForestTreeDrawPacketReference(
                    forest_material
                );
            require(timed_road.version == road_surface.version &&
                        timed_forest.version == forest_draw.version,
                    "timed producer packet changed identity");
        }
        const auto finish = Clock::now();
        timings.push_back(
            std::chrono::duration<double, std::micro>(
                finish - start
            ).count()
        );
    }
    std::sort(timings.begin(), timings.end());
    std::cout << "procedural scene producer packets: road_bytes="
              << road_surface.binding_bytes.size()
              << " forest_geometry_bytes="
              << vf::material::ForestTreeDrawGeometryBytesReference(
                    forest_draw
                 )
              << " resident_bytes=" << report.resident_bytes
              << " median_us_per_100=" << timings[12]
              << " road_version=" << road_surface.version
              << " forest_version=" << forest_draw.version
              << " report_version=" << report.version << '\n';
    return 0;
}
