#include "native/material/vf_stone_projected_draw_packet.hpp"

#include <algorithm>
#include <array>
#include <cmath>
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
    auto stone = vf::material::CreateStoneCoarseShapeReference(
        {3.0f, 2.0f, 1.5f},
        6,
        8
    );
    const vf::material::StoneViewCamera camera{
        {8.0, 0.0, 0.0},
        {0.0, 0.0, 0.0},
        {0.0, 0.0, 1.0},
        std::acos(-1.0) / 3.0,
        1080.0,
    };
    const auto refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone, nullptr, camera, 0.0, 2, 8, 12
        );
    const auto first =
        vf::material::AdaptStoneProjectedDrawPacketReference(
            refined,
            nullptr
        );
    require(first.packet != nullptr && !first.retained,
            "first projected draw packet was not uploaded");
    require(first.packet->vertices.size() == 80,
            "projected draw vertex packing changed");
    require(first.packet->indices.size() == 36,
            "projected draw index packing changed");
    require(first.upload_bytes == 464,
            "projected draw upload bound changed");

    const auto steady_refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone, &refined, camera, 0.0, 2, 8, 12
        );
    const auto steady =
        vf::material::AdaptStoneProjectedDrawPacketReference(
            steady_refined,
            &first
        );
    require(steady.retained && steady.packet == first.packet,
            "stable projected geometry replaced its draw packet");
    require(steady.upload_bytes == 0,
            "stable projected geometry scheduled an upload");

    auto reversed = stone;
    std::reverse(reversed.triangles.begin(), reversed.triangles.end());
    const auto traversal_refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            reversed, &steady_refined, camera, 0.0, 2, 8, 12
        );
    const auto traversal =
        vf::material::AdaptStoneProjectedDrawPacketReference(
            traversal_refined,
            &steady
        );
    require(traversal.retained && traversal.packet == steady.packet,
            "triangle traversal replaced resident draw buffers");

    auto opposite = camera;
    opposite.eye = {-8.0, 0.0, 0.0};
    const auto moved_refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone, &traversal_refined, opposite, 0.0, 2, 8, 12
        );
    const auto moved =
        vf::material::AdaptStoneProjectedDrawPacketReference(
            moved_refined,
            &traversal
        );
    require(!moved.retained && moved.packet != traversal.packet,
            "changed projected geometry retained stale draw buffers");
    require(moved.packet->vertices.size() == 80 &&
                moved.packet->indices.size() == 36 &&
                moved.upload_bytes == 464,
            "changed projected draw packet escaped upload bounds");

    const auto coarse_refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            stone, &moved_refined, camera, 231.0, 4, 8, 12
        );
    const auto coarse =
        vf::material::AdaptStoneProjectedDrawPacketReference(
            coarse_refined,
            &moved
        );
    require(coarse.packet->vertices.size() == 60 &&
                coarse.packet->indices.size() == 24 &&
                coarse.upload_bytes == 336,
            "coarse projected draw packet changed JS parity");
    require(
        std::vector<float>(
            coarse.packet->vertices.begin(),
            coarse.packet->vertices.begin() + 10
        ) == std::vector<float>({
            3.0f, 0.0f, 0.0f,
            1.0f, 0.0f, 0.0f,
            0.46f, 0.42f, 0.36f, 1.0f,
        }),
        "native field-mesh vertex layout diverged from JS"
    );
    require(
        coarse.packet->indices == std::vector<std::uint32_t>({
            0, 2, 4, 1, 4, 2, 1, 3, 4, 0, 4, 3,
            0, 5, 2, 1, 2, 5, 1, 5, 3, 0, 3, 5,
        }),
        "native field-mesh winding diverged from JS"
    );

    std::cout << "private native projected draw packet passed\n";
    return 0;
}
