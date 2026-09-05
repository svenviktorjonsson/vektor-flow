#include "native/material/vf_stone_hierarchical_camera_path.hpp"

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
    const vf::material::StoneViewCamera camera{
        {8.0, 0.0, 0.0},
        {0.0, 0.0, 0.0},
        {0.0, 0.0, 1.0},
        std::acos(-1.0) / 3.0,
        1080.0,
    };
    using Kind = vf::material::StoneMaterialElementKind;
    std::vector<vf::material::StoneHierarchicalCameraDemand> visible{
        {
            {900000007ull, {80.0, 15.0}},
            {{Kind::Face, 0}, {Kind::Vertex, 0}},
        },
        {
            {17, {10.0, 10.0}},
            {{Kind::Vertex, 0}, {Kind::Face, 0}},
        },
    };
    constexpr std::size_t frame_budget = 2 * (464 + 2 * 53);
    const auto first =
        vf::material::UpdateStoneHierarchicalCameraPathReference(
            definition,
            nullptr,
            camera,
            visible,
            2,
            2,
            8,
            12,
            2,
            frame_budget
        );
    require(first.potential_members == 1000000000ull &&
                first.realized_identities ==
                    std::vector<std::uint64_t>({17, 900000007ull}),
            "camera path materialized invisible population members");
    require(first.realized_vertices == 16 &&
                first.realized_faces == 24 &&
                first.realized_material_samples == 4,
            "camera path escaped demanded geometry/material bounds");
    require(first.passive_energy && first.frame_upload_bytes ==
                frame_budget && first.residency.resident_bytes ==
                frame_budget,
            "initial camera frame escaped energy or upload bounds");
    const auto first_versions = first.versions;
    const auto first_hash = first.frame_hash;
    require(first_hash == 12071396023394362807ull,
            "canonical camera-path hash changed");

    const auto stable =
        vf::material::UpdateStoneHierarchicalCameraPathReference(
            definition,
            &first,
            camera,
            visible,
            2,
            2,
            8,
            12,
            2,
            frame_budget
        );
    require(stable.frame_upload_bytes == 0 &&
                stable.versions == first_versions &&
                stable.frame_hash == first_hash,
            "stable camera frame repacked demanded content");

    std::reverse(visible.begin(), visible.end());
    for (auto& demand : visible) {
        std::reverse(
            demand.material_demands.begin(),
            demand.material_demands.end()
        );
    }
    const auto reversed =
        vf::material::UpdateStoneHierarchicalCameraPathReference(
            definition,
            &stable,
            camera,
            visible,
            2,
            2,
            8,
            12,
            2,
            frame_budget
        );
    require(reversed.frame_upload_bytes == 0 &&
                reversed.versions == first_versions &&
                reversed.frame_hash == first_hash,
            "reverse traversal changed camera-path residency");

    auto moved_camera = camera;
    moved_camera.eye = {-8.0, 0.0, 0.0};
    const auto moved =
        vf::material::UpdateStoneHierarchicalCameraPathReference(
            definition,
            &reversed,
            moved_camera,
            visible,
            2,
            2,
            8,
            12,
            2,
            frame_budget
        );
    require(moved.frame_upload_bytes == 2 * (464 + 53) &&
                moved.versions != first_versions,
            "camera change escaped its bounded residency delta");
    require(moved.passive_energy &&
                moved.realized_material_samples == 4,
            "camera change invalidated demanded material energy");

    const auto regenerated =
        vf::material::UpdateStoneHierarchicalCameraPathReference(
            definition,
            &moved,
            camera,
            visible,
            2,
            2,
            8,
            12,
            2,
            frame_budget
        );
    require(regenerated.frame_upload_bytes == 2 * (464 + 53) &&
                regenerated.versions == first_versions &&
                regenerated.frame_hash == first_hash,
            "evicted camera frame did not regenerate exactly");

    const auto repeated =
        vf::material::UpdateStoneHierarchicalCameraPathReference(
            definition,
            nullptr,
            camera,
            visible,
            2,
            2,
            8,
            12,
            2,
            frame_budget
        );
    require(repeated.versions == first_versions &&
                repeated.frame_hash == first_hash &&
                repeated.frame_upload_bytes == first.frame_upload_bytes,
            "fresh camera-path realization was not deterministic");

    std::cout << "hierarchical camera path: potential="
              << first.potential_members
              << " realized=" << first.realized_identities.size()
              << " first_upload=" << first.frame_upload_bytes
              << " stable_upload=" << stable.frame_upload_bytes
              << " moved_upload=" << moved.frame_upload_bytes
              << " hash=" << first.frame_hash << '\n';
    return 0;
}
