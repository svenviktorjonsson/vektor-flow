#include "native/material/vf_stone_projected_draw_residency.hpp"

#include <algorithm>
#include <cmath>
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
    auto residency =
        vf::material::UpdateStoneProjectedDrawResidencyReference(
            stone, nullptr, camera, 0.0, 2, 8, 12
        );
    const auto detailed_vertices = residency.draw.packet->vertices;
    const auto detailed_indices = residency.draw.packet->indices;
    require(residency.uploads == 1 &&
                residency.total_upload_bytes == 464 &&
                residency.resident_bytes == 464 &&
                residency.peak_resident_bytes == 464,
            "initial projected residency accounting changed");

    const auto* stable_packet = residency.draw.packet.get();
    for (std::size_t repeat = 0; repeat < 256; ++repeat) {
        residency =
            vf::material::UpdateStoneProjectedDrawResidencyReference(
                stone, &residency, camera, 0.0, 2, 8, 12
            );
    }
    require(residency.draw.packet.get() == stable_packet,
            "stable view replaced resident draw storage");
    require(residency.uploads == 1 &&
                residency.total_upload_bytes == 464 &&
                residency.cache_hits == 256,
            "stable view scheduled hidden upload work");

    auto reversed = stone;
    std::reverse(reversed.triangles.begin(), reversed.triangles.end());
    residency =
        vf::material::UpdateStoneProjectedDrawResidencyReference(
            reversed, &residency, camera, 0.0, 2, 8, 12
        );
    require(residency.draw.packet.get() == stable_packet &&
                residency.cache_hits == 257,
            "reverse traversal invalidated projected residency");

    std::weak_ptr<const vf::material::StoneProjectedDrawPacket> evicted =
        residency.draw.packet;
    auto opposite = camera;
    opposite.eye = {-8.0, 0.0, 0.0};
    residency =
        vf::material::UpdateStoneProjectedDrawResidencyReference(
            stone, &residency, opposite, 0.0, 2, 8, 12
        );
    require(evicted.expired(),
            "replaced projected draw packet remained resident");
    require(residency.evictions == 1 && residency.uploads == 2 &&
                residency.total_upload_bytes == 928 &&
                residency.resident_bytes == 464 &&
                residency.peak_resident_bytes == 464,
            "camera-change residency escaped its packet bound");

    evicted = residency.draw.packet;
    residency =
        vf::material::UpdateStoneProjectedDrawResidencyReference(
            stone, &residency, camera, 231.0, 4, 8, 12
        );
    require(evicted.expired(),
            "coarse fallback retained evicted detail packet");
    require(residency.refinement.selection.demands.empty() &&
                residency.refinement.detail_vertices == 0 &&
                residency.refinement.detail_faces == 0,
            "coarse fallback retained detail geometry");
    require(residency.evictions == 2 && residency.uploads == 3 &&
                residency.total_upload_bytes == 1264 &&
                residency.resident_bytes == 336 &&
                residency.peak_resident_bytes == 464,
            "coarse fallback residency accounting changed");

    for (std::size_t repeat = 0; repeat < 256; ++repeat) {
        residency =
            vf::material::UpdateStoneProjectedDrawResidencyReference(
                stone, &residency, camera, 231.0, 4, 8, 12
            );
    }
    require(residency.uploads == 3 &&
                residency.cache_hits == 513,
            "stable coarse fallback scheduled hidden uploads");

    residency =
        vf::material::UpdateStoneProjectedDrawResidencyReference(
            stone, &residency, camera, 0.0, 2, 8, 12
        );
    require(residency.evictions == 3 && residency.uploads == 4 &&
                residency.total_upload_bytes == 1728 &&
                residency.peak_resident_bytes == 464,
            "evicted detail regeneration escaped residency bounds");
    require(residency.draw.packet->vertices == detailed_vertices &&
                residency.draw.packet->indices == detailed_indices,
            "evicted projected packet regenerated different geometry");

    std::cout << "projected draw residency benchmark: hits="
              << residency.cache_hits
              << " uploads=" << residency.uploads
              << " bytes=" << residency.total_upload_bytes
              << " peak=" << residency.peak_resident_bytes << '\n';
    return 0;
}
