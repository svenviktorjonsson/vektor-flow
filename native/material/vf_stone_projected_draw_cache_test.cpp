#include "native/material/vf_stone_projected_draw_cache.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

std::vector<std::uint64_t> ids(
    const vf::material::StoneProjectedDrawCacheState& state
) {
    std::vector<std::uint64_t> result;
    for (const auto& entry : state.entries) {
        result.push_back(entry.stone_id);
    }
    return result;
}

}  // namespace

int main() {
    const vf::material::StoneViewCamera camera{
        {8.0, 0.0, 0.0},
        {0.0, 0.0, 0.0},
        {0.0, 0.0, 1.0},
        std::acos(-1.0) / 3.0,
        1080.0,
    };
    auto stone = [](std::array<float, 3> radii) {
        return vf::material::CreateStoneCoarseShapeReference(
            radii,
            6,
            8
        );
    };
    auto projected = [](
        const vf::material::StoneCoarseShape& shape,
        const vf::material::StoneViewCamera& view
    ) {
        return vf::material::UpdateStoneProjectedRefinementReference(
            shape, nullptr, view, 0.0, 2, 8, 12
        );
    };
    const auto first_shape = stone({3.0f, 2.0f, 1.5f});
    const auto second_shape = stone({2.5f, 1.8f, 1.2f});
    const auto third_shape = stone({2.8f, 1.9f, 1.4f});

    auto first_refined = projected(first_shape, camera);
    auto cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        nullptr,
        1,
        first_refined,
        928
    );
    const auto first_vertices = cache.active->vertices;
    const auto first_indices = cache.active->indices;
    const auto* first_packet = cache.active.get();
    require(!cache.hit && cache.upload_bytes == 464 &&
                cache.resident_bytes == 464 && ids(cache) ==
                std::vector<std::uint64_t>({1}),
            "first stone cache insertion changed");

    first_refined = projected(first_shape, camera);
    cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        &cache,
        1,
        first_refined,
        928
    );
    require(cache.hit && cache.active.get() == first_packet &&
                cache.upload_bytes == 0,
            "semantic stable-view cache lookup missed");

    auto reversed = first_shape;
    std::reverse(reversed.triangles.begin(), reversed.triangles.end());
    const auto reversed_refined = projected(reversed, camera);
    cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        &cache,
        1,
        reversed_refined,
        928
    );
    require(cache.hit && cache.active.get() == first_packet,
            "reverse traversal changed the cache identity");

    const auto second_refined = projected(second_shape, camera);
    cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        &cache,
        2,
        second_refined,
        928
    );
    std::weak_ptr<const vf::material::StoneProjectedDrawPacket>
        second_packet = cache.active;
    const auto second_vertices = cache.active->vertices;
    require(ids(cache) == std::vector<std::uint64_t>({1, 2}) &&
                cache.resident_bytes == 928,
            "second stone escaped cache budget");

    cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        &cache,
        1,
        first_refined,
        928
    );
    require(cache.hit &&
                ids(cache) == std::vector<std::uint64_t>({2, 1}),
            "cache hit did not deterministically refresh LRU order");

    auto third_refined = projected(third_shape, camera);
    cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        &cache,
        3,
        third_refined,
        928
    );
    require(second_packet.expired() &&
                cache.evicted == std::vector<std::uint64_t>({2}) &&
                ids(cache) == std::vector<std::uint64_t>({1, 3}),
            "LRU pressure evicted the wrong stone");

    cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        &cache,
        2,
        second_refined,
        928
    );
    require(!cache.hit && cache.active->vertices == second_vertices &&
                ids(cache) == std::vector<std::uint64_t>({3, 2}),
            "evicted stone did not regenerate exactly");

    std::weak_ptr<const vf::material::StoneProjectedDrawPacket>
        first_view = cache.entries.front().packet;
    const auto first_view_vertices = cache.entries.front().packet->vertices;
    auto opposite = camera;
    opposite.eye = {-8.0, 0.0, 0.0};
    const auto opposite_refined = projected(third_shape, opposite);
    cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        &cache,
        3,
        opposite_refined,
        928
    );
    require(first_view.expired() &&
                cache.evicted == std::vector<std::uint64_t>({3}) &&
                ids(cache) == std::vector<std::uint64_t>({2, 3}),
            "camera variant pressure violated LRU order");

    third_refined = projected(third_shape, camera);
    cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        &cache,
        3,
        third_refined,
        928
    );
    require(!cache.hit &&
                cache.active->vertices == first_view_vertices &&
                ids(cache) == std::vector<std::uint64_t>({3, 3}),
            "evicted camera variant regenerated different geometry");

    const auto changed_shape = stone({3.5f, 1.9f, 1.4f});
    const auto changed_refined = projected(changed_shape, camera);
    cache = vf::material::UpdateStoneProjectedDrawCacheReference(
        &cache,
        3,
        changed_refined,
        928
    );
    require(!cache.hit && cache.active->vertices.front() == 3.5f &&
                cache.evicted == std::vector<std::uint64_t>({3, 3}) &&
                ids(cache) == std::vector<std::uint64_t>({3}),
            "changed stone source reused stale cache data");
    require(cache.resident_bytes == 464 &&
                cache.peak_resident_bytes == 928 &&
                cache.cache_hits == 3 && cache.uploads == 7 &&
                cache.total_upload_bytes == 3248 &&
                cache.evictions == 6,
            "multi-stone cache accounting changed");

    bool rejected = false;
    try {
        static_cast<void>(
            vf::material::UpdateStoneProjectedDrawCacheReference(
                &cache,
                1,
                first_refined,
                463
            )
        );
    } catch (const std::range_error&) {
        rejected = true;
    }
    require(rejected,
            "oversized projected packet escaped the cache budget");
    require(first_vertices.size() == 80 && first_indices.size() == 36,
            "baseline projected packet changed during cache pressure");

    std::cout << "multi-stone cache benchmark: hits="
              << cache.cache_hits
              << " uploads=" << cache.uploads
              << " evictions=" << cache.evictions
              << " bytes=" << cache.total_upload_bytes
              << " peak=" << cache.peak_resident_bytes << '\n';
    return 0;
}
