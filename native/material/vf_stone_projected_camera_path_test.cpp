#include "native/material/vf_stone_projected_camera_path.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << message << '\n';
        throw std::runtime_error(message);
    }
}

}  // namespace

int main() {
    auto make_stone = [](std::array<float, 3> radii) {
        return vf::material::CreateStoneCoarseShapeReference(
            radii,
            6,
            8
        );
    };
    auto make_camera = [](std::array<double, 3> eye) {
        return vf::material::StoneViewCamera{
            eye,
            {0.0, 0.0, 0.0},
            {0.0, 0.0, 1.0},
            std::acos(-1.0) / 3.0,
            1080.0,
        };
    };
    const auto first = make_stone({3.0f, 2.0f, 1.5f});
    const auto second = make_stone({2.5f, 1.8f, 1.2f});
    const auto third = make_stone({2.8f, 1.9f, 1.4f});
    const auto x_view = make_camera({8.0, 0.0, 0.0});
    const auto diagonal_view = make_camera({8.0, 8.0, 8.0});
    const auto negative_x_view = make_camera({-8.0, 0.0, 0.0});
    const std::vector<vf::material::StoneProjectedCameraPathStep> path{
        {1, first, x_view},
        {2, second, x_view},
        {1, first, x_view},
        {1, first, diagonal_view},
        {3, third, negative_x_view},
        {1, first, x_view},
        {1, first, x_view},
        {2, second, x_view},
        {3, third, negative_x_view},
        {1, first, diagonal_view},
    };

    const auto report =
        vf::material::RunStoneProjectedCameraPathReference(
            path,
            928,
            0.0,
            2,
            8,
            12
        );
    require(report.frames.size() == path.size(),
            "moving camera report dropped frames");
    const std::vector<std::size_t> expected_uploads{
        464, 464, 0, 464, 464, 464, 0, 464, 464, 464,
    };
    std::vector<std::size_t> actual_uploads;
    for (const auto& frame : report.frames) {
        actual_uploads.push_back(frame.upload_bytes);
        require(frame.upload_bytes <= 464,
                "moving camera frame exceeded upload bound");
        require(frame.resident_bytes <= 928,
                "moving camera frame exceeded residency bound");
    }
    if (actual_uploads != expected_uploads) {
        for (const auto upload : actual_uploads) {
            std::cerr << upload << ' ';
        }
        std::cerr << '\n';
    }
    require(actual_uploads == expected_uploads,
            "moving camera upload schedule changed");
    require(report.frames[2].hit && report.frames[6].hit &&
                !report.frames[0].hit && !report.frames[3].hit,
            "stable moving-camera frames lost cache reuse");
    require(report.frames[0].packet_hash ==
                report.frames[5].packet_hash &&
                report.frames[0].packet_hash ==
                report.frames[6].packet_hash,
            "evicted first view regenerated different geometry");
    require(report.frames[1].packet_hash ==
                report.frames[7].packet_hash,
            "evicted second stone regenerated different geometry");
    require(report.frames[4].packet_hash ==
                report.frames[8].packet_hash,
            "evicted third stone regenerated different geometry");
    require(report.frames[3].packet_hash ==
                report.frames[9].packet_hash,
            "evicted moving view regenerated different geometry");
    require(report.frames[0].packet_hash !=
                report.frames[3].packet_hash,
            "distinct camera demand reused stale geometry");
    require(report.max_frame_upload_bytes == 464 &&
                report.cache.cache_hits == 2 &&
                report.cache.uploads == 8 &&
                report.cache.evictions == 6 &&
                report.cache.total_upload_bytes == 3712 &&
                report.cache.peak_resident_bytes == 928,
            "moving camera cache totals changed");

    const auto repeated =
        vf::material::RunStoneProjectedCameraPathReference(
            path,
            928,
            0.0,
            2,
            8,
            12
        );
    require(repeated.frames == report.frames &&
                repeated.max_frame_upload_bytes ==
                report.max_frame_upload_bytes,
            "moving camera path was not deterministic");

    std::cout << "moving camera cache benchmark: frames="
              << report.frames.size()
              << " hits=" << report.cache.cache_hits
              << " uploads=" << report.cache.uploads
              << " bytes=" << report.cache.total_upload_bytes
              << " peak=" << report.cache.peak_resident_bytes << '\n';
    return 0;
}
