#include "native/material/vf_procedural_scene_native_frame_capture.hpp"

#include <cmath>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

struct FixedScene {
    vf::material::StoneHierarchicalMaterialDrawState stone;
    vf::material::RoadHierarchicalResidencyState road;
    vf::material::RoadMaterialSurfacePacket road_surface;
    vf::material::ForestTreeMaterialPipelineState forest_material;
    vf::material::ForestTreeDrawPacket forest_draw;
};

FixedScene create_fixed_scene(std::uint64_t road_seed =
    0x3c6ef372fe94f82bull) {
    using namespace vf::material;
    const StonePopulationDefinition stone_definition{
        {0x3c6ef372fe94f82bull, 0xa54ff53a5f1d36f1ull},
        42,
        1000000000ull,
    };
    const auto stones = RealizeStonePopulationReference(
        stone_definition,
        {{17, {10.0, 10.0}}},
        1,
        6,
        8
    );
    const auto& stone = stones.members.front();
    const StoneViewCamera camera{
        {8.0, 0.0, 0.0},
        {0.0, 0.0, 0.0},
        {0.0, 0.0, 1.0},
        std::acos(-1.0) / 3.0,
        1080.0,
    };
    const auto refinement = UpdateStoneProjectedRefinementReference(
        stone.coarse,
        nullptr,
        camera,
        0.0,
        2,
        8,
        12
    );
    using Kind = StoneMaterialElementKind;
    auto stone_draw = UpdateStoneHierarchicalMaterialDrawReference(
        stone,
        refinement,
        {{Kind::Face, 0}, {Kind::Vertex, 0}},
        2,
        nullptr
    );

    const RoadHierarchicalMaterialDefinition road_definition{
        {road_seed, 0xa54ff53a5f1d36f1ull},
        7,
        1000000000ull,
        1000000000ull,
    };
    auto road = UpdateRoadHierarchicalResidencyReference(
        road_definition,
        7,
        {{7, 90, {29.0, -0.5}}, {7, 1, {28.25, 0.75}}},
        2,
        nullptr
    );
    auto road_surface = BindRoadMaterialSurfaceReference(road);

    const ForestPopulationDefinition forest_definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31,
        5,
        1000000000ull,
        1000000000ull,
        64.0,
        0.0,
    };
    const auto forest = RealizeForestPopulationReference(
        forest_definition,
        {{27, {3, 7}, 2}},
        2
    );
    std::vector<std::uint64_t> tree_ids;
    for (const auto& tree : forest.trees) {
        tree_ids.push_back(tree.tree_id);
    }
    const ForestTreeMaterialPipelineDefinition forest_material_definition{
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
    auto forest_material = UpdateForestTreeMaterialPipelineReference(
        forest_material_definition,
        forest,
        tree_ids,
        2,
        nullptr
    );
    auto forest_draw = CreateForestTreeDrawPacketReference(
        forest_material
    );
    return {
        std::move(stone_draw),
        std::move(road),
        std::move(road_surface),
        std::move(forest_material),
        std::move(forest_draw),
    };
}

}  // namespace

int main() {
    using namespace vf::material;
    const auto scene = create_fixed_scene();
    const auto capture = CaptureProceduralSceneNativeFrameReference(
        *scene.stone.packet,
        scene.road_surface,
        scene.forest_draw,
        144,
        64
    );
    const auto repeated = CaptureProceduralSceneNativeFrameReference(
        *scene.stone.packet,
        scene.road_surface,
        scene.forest_draw,
        144,
        64
    );

    require(capture == repeated,
            "procedural native capture was not deterministic");
    require(capture.width == 144 && capture.height == 64 &&
                capture.rgba8.size() == 144 * 64 * 4 &&
                capture.source_bytes == 3130 &&
                capture.source_version == 17746054028491652131ull,
            "procedural native capture lost source accounting");
    require(capture.rendered_pixels > 0 &&
                capture.content_pixels[0] > 0 &&
                capture.content_pixels[1] > 0 &&
                capture.content_pixels[2] > 0,
            "procedural native capture omitted a producer");

    const auto changed_scene = create_fixed_scene(
        0x510e527fade682d1ull
    );
    const auto changed = CaptureProceduralSceneNativeFrameReference(
        *changed_scene.stone.packet,
        changed_scene.road_surface,
        changed_scene.forest_draw,
        144,
        64
    );
    require(changed.rgba8 != capture.rgba8 &&
                changed.version != capture.version,
            "road material did not reach captured pixels");

    auto invalid_road = scene.road_surface;
    invalid_road.binding_bytes[16] = 2;
    bool invalid_rejected = false;
    try {
        static_cast<void>(CaptureProceduralSceneNativeFrameReference(
            *scene.stone.packet,
            invalid_road,
            scene.forest_draw,
            144,
            64
        ));
    } catch (const std::invalid_argument&) {
        invalid_rejected = true;
    }
    require(invalid_rejected,
            "procedural native capture accepted an invalid road binding");

    bool extent_rejected = false;
    try {
        static_cast<void>(CaptureProceduralSceneNativeFrameReference(
            *scene.stone.packet,
            scene.road_surface,
            scene.forest_draw,
            47,
            64
        ));
    } catch (const std::range_error&) {
        extent_rejected = true;
    }
    require(extent_rejected,
            "procedural native capture accepted an undersized frame");

    std::cout << "procedural scene native frame capture: pixels="
              << capture.rendered_pixels
              << " content_pixels=" << capture.content_pixels[0] << ','
              << capture.content_pixels[1] << ','
              << capture.content_pixels[2]
              << " bytes=" << capture.rgba8.size()
              << " source_bytes=" << capture.source_bytes
              << " version=" << capture.version << '\n';
}
