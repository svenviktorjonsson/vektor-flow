#include "native/material/vf_stone_projected_large_scene.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
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
    constexpr std::size_t stone_count = 128;
    constexpr std::size_t cache_budget = stone_count * 2 * 464;
    std::vector<vf::material::StoneProjectedLargeSceneStone> stones;
    stones.reserve(stone_count);
    for (std::size_t index = 0; index < stone_count; ++index) {
        const float unit = static_cast<float>(index) /
            static_cast<float>(stone_count - 1);
        const float scale = 0.35f + 0.65f * unit;
        stones.push_back({
            index + 1,
            vf::material::CreateStoneCoarseShapeReference(
                {3.0f * scale, 2.0f * scale, 1.5f * scale},
                6,
                8
            ),
        });
    }
    std::vector<vf::material::StoneViewCamera> cameras;
    for (const double distance : {
             8.0, 8.25, 8.5, 8.75, 9.0,
             8.75, 8.5, 8.25, 8.0,
         }) {
        cameras.push_back({
            {distance, 0.0, 0.0},
            {0.0, 0.0, 0.0},
            {0.0, 0.0, 1.0},
            std::acos(-1.0) / 3.0,
            1080.0,
        });
    }

    std::vector<long long> wall_microseconds;
    std::vector<vf::material::StoneProjectedLargeSceneReport> reports;
    for (std::size_t sample = 0; sample < 5; ++sample) {
        const auto start = std::chrono::steady_clock::now();
        reports.push_back(
            vf::material::RunStoneProjectedLargeSceneReference(
                stones,
                cameras,
                cache_budget,
                100.0,
                2,
                8,
                12
            )
        );
        const auto stop = std::chrono::steady_clock::now();
        wall_microseconds.push_back(
            std::chrono::duration_cast<std::chrono::microseconds>(
                stop - start
            ).count()
        );
    }
    const auto& report = reports.front();
    require(report.frames.size() == cameras.size(),
            "large-scene audit dropped camera frames");
    require(report.frames.front().uploads == stone_count,
            "large-scene first frame did not materialize each stone once");
    std::size_t forward_uploads = 0;
    for (std::size_t frame = 1; frame <= 4; ++frame) {
        require(report.frames[frame].uploads < stone_count,
                "moving camera rematerialized the full stone scene");
        forward_uploads += report.frames[frame].uploads;
    }
    require(forward_uploads > 0,
            "large-scene path did not exercise LOD transitions");
    for (std::size_t frame = 5; frame < report.frames.size(); ++frame) {
        require(report.frames[frame].uploads == 0,
                "return path failed to reuse resident LOD variants");
    }
    for (const auto& frame : report.frames) {
        require(frame.resident_bytes <= cache_budget,
                "large-scene frame exceeded cache budget");
        require(frame.upload_bytes <= frame.uploads * 464,
                "large-scene frame exceeded per-packet upload bound");
    }
    require(report.frames[0].scene_hash ==
                report.frames[8].scene_hash &&
                report.frames[1].scene_hash ==
                report.frames[7].scene_hash &&
                report.frames[2].scene_hash ==
                report.frames[6].scene_hash &&
                report.frames[3].scene_hash ==
                report.frames[5].scene_hash,
            "return camera path changed regenerated scene identity");
    require(report.max_item_upload_bytes == 464 &&
                report.max_frame_upload_bytes ==
                report.frames.front().upload_bytes &&
                report.max_moving_frame_upload_bytes <
                report.frames.front().upload_bytes &&
                report.cache.evictions == 0 &&
                report.cache.entries.size() <= stone_count * 2 &&
                report.cache.peak_resident_bytes <= cache_budget,
            "large-scene residency bounds changed");
    for (std::size_t sample = 1; sample < reports.size(); ++sample) {
        require(reports[sample].frames == report.frames &&
                    reports[sample].max_item_upload_bytes ==
                    report.max_item_upload_bytes &&
                    reports[sample].max_frame_upload_bytes ==
                    report.max_frame_upload_bytes &&
                    reports[sample].max_moving_frame_upload_bytes ==
                    report.max_moving_frame_upload_bytes,
                "large-scene camera path was not deterministic");
    }

    std::sort(wall_microseconds.begin(), wall_microseconds.end());
    std::cout << "large-scene benchmark: stones=" << stone_count
              << " frames=" << cameras.size()
              << " updates=" << stone_count * cameras.size()
              << " wall_us[min/median/max]="
              << wall_microseconds.front() << '/'
              << wall_microseconds[wall_microseconds.size() / 2] << '/'
              << wall_microseconds.back()
              << " max_frame_upload="
              << report.max_frame_upload_bytes
              << " peak_resident="
              << report.cache.peak_resident_bytes << '\n';
    std::cout << "frame uploads:";
    for (const auto& frame : report.frames) {
        std::cout << ' ' << frame.uploads << '/' << frame.upload_bytes;
    }
    std::cout << '\n';
    return 0;
}
