#include "native/material/vf_terrain_triangulation.hpp"
#include "native/material/vf_terrain_residency.hpp"
#include <bit>
#include <iostream>
#include <limits>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<std::size_t N> bool identical(const std::array<double, N>& a, const std::array<double, N>& b) {
    for (std::size_t axis = 0; axis < N; ++axis)
        if (std::bit_cast<std::uint64_t>(a[axis]) != std::bit_cast<std::uint64_t>(b[axis])) return false;
    return true;
}
template<class Function> void rejects(Function&& call, std::string_view message) {
    try { call(); } catch (const std::exception& error) {
        require(error.what() == message, "changed rejection diagnostic");
        return;
    }
    throw std::runtime_error("invalid input was accepted");
}
}
int main() try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 0.125, 0, 2};
    constexpr std::uint64_t divisions = 65536, width = divisions + 1;
    constexpr std::uint64_t first = 60000 * width + 50000;
    const std::array<std::uint64_t, 4> demand{first + width + 1, first, first + width, first + 1};
    const auto terrain = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, demand, 4);
    require(terrain->layout == TerrainSampleLayout::indexed &&
        terrain->sample_ids == std::vector<std::uint64_t>(demand.begin(), demand.end()),
        "sparse terrain lost explicit ordered sample IDs");
    require(terrain->positions.size() == 4 && terrain->potential_count == width * width && terrain->truncated,
        "sparse terrain expanded undemanded samples or changed potential meaning");
    for (std::size_t index = 0; index < demand.size(); ++index) {
        const double x = -1 + static_cast<double>(demand[index] % width) / divisions;
        const double z = 2 + static_cast<double>(demand[index] / width) / divisions;
        require(terrain->positions[index][0] == x && terrain->positions[index][2] == z &&
            std::bit_cast<std::uint64_t>(terrain->positions[index][1]) ==
                std::bit_cast<std::uint64_t>(SampleTerrainHeightReference(condition, x, z)),
            "sparse source does not match existing dyadic height truth");
    }
    const auto normals = DeriveTerrainNormalsReference(terrain, 0.015625);
    const auto material = BindTerrainWaterLevelMaterialsReference(terrain, 0, 101, 202);
    const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(normals, material));
    require(surface->source == terrain && normals->source == terrain && material.source == terrain,
        "sparse consumers lost source ownership");
    const std::array<std::uint64_t, 1> cells{60000 * divisions + 50000};
    rejects([&] { TriangulateTerrainCellsReference(surface, cells, 1, 2); },
        "terrain indexed samples require addressed topology");
    const std::array<std::uint64_t, 1> outside{width * width};
    rejects([&] { RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, outside, 1); },
        "terrain sample demand exceeds tile domain");
    const std::array<std::uint64_t, 2> duplicate{first, first};
    rejects([&] { RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, duplicate, 2); },
        "terrain sample demand is duplicated");
    const std::vector<std::uint64_t> too_many(65537);
    rejects([&] { RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, too_many, 0); },
        "terrain sample demand must contain at most 65536 entries");
    auto malformed = std::make_shared<TerrainTileWorkingSet>(*terrain);
    malformed->sample_ids.pop_back();
    rejects([&] { BindTerrainWaterLevelMaterialsReference(malformed, 0, 101, 202); },
        "terrain indexed sample identity is invalid");
    *malformed = *terrain;
    std::swap(malformed->sample_ids[0], malformed->sample_ids[1]);
    rejects([&] { DeriveTerrainNormalsReference(malformed, 0.015625); },
        "terrain indexed sample position does not match its ID");
    const TerrainTileRequest prefix_request{condition, {-1, 2}, 16, 4};
    require(!SameTerrainResidencyKey(*terrain, prefix_request, 4), "sparse samples matched a prefix residency key");
    const auto prefix = RealizeTerrainTileReference(condition, {-1, 2}, 3, 81);
    require(prefix->layout == TerrainSampleLayout::row_prefix && prefix->sample_ids.empty() &&
        prefix->sample_ids.capacity() == 0, "old prefix allocated indexed metadata");
    const auto prefix_normals = DeriveTerrainNormalsReference(prefix, 0.015625);
    const auto prefix_material = BindTerrainWaterLevelMaterialsReference(prefix, 0, 101, 202);
    const std::array<std::uint64_t, 4> small_ids{80, 0, 17, 41};
    const auto small = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 3, small_ids, 4);
    const auto small_normals = DeriveTerrainNormalsReference(small, 0.015625);
    const auto small_material = BindTerrainWaterLevelMaterialsReference(small, 0, 101, 202);
    for (std::size_t i = 0; i < small_ids.size(); ++i)
        require(identical(small->positions[i], prefix->positions[small_ids[i]]) &&
            identical(small_normals->normals[i], prefix_normals->normals[small_ids[i]]) &&
            small_material.material_ids[i] == prefix_material.material_ids[small_ids[i]],
            "indexed consumers changed existing prefix bytes");
    const std::array<std::uint64_t, 3> edge_left{divisions, 32768 * width + divisions, divisions * width + divisions};
    const std::array<std::uint64_t, 3> edge_right{0, 32768 * width, divisions * width};
    const auto left = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, edge_left, 3);
    const auto right = RealizeTerrainSampleDemandReference(condition, {0, 2}, 16, edge_right, 3);
    const auto left_normals = DeriveTerrainNormalsReference(left, 0.015625);
    const auto right_normals = DeriveTerrainNormalsReference(right, 0.015625);
    for (std::size_t i = 0; i < edge_left.size(); ++i)
        require(identical(left->positions[i], right->positions[i]) && identical(left_normals->normals[i], right_normals->normals[i]),
            "indexed shared-edge position or normal changed");
    const std::array<std::uint64_t, 3> edge_below{divisions * width, divisions * width + 32768, divisions * width + divisions};
    const std::array<std::uint64_t, 3> edge_above{0, 32768, divisions};
    const auto below = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, edge_below, 3);
    const auto above = RealizeTerrainSampleDemandReference(condition, {-1, 3}, 16, edge_above, 3);
    const auto below_normals = DeriveTerrainNormalsReference(below, 0.015625);
    const auto above_normals = DeriveTerrainNormalsReference(above, 0.015625);
    for (std::size_t i = 0; i < edge_below.size(); ++i)
        require(identical(below->positions[i], above->positions[i]) && identical(below_normals->normals[i], above_normals->normals[i]),
            "indexed second-axis seam changed");
    const std::array<std::uint64_t, 1> coarse_id{30000 * 32769ull + 25000};
    const std::array<std::uint64_t, 1> fine_id{first};
    const auto coarse = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 15, coarse_id, 1);
    const auto fine = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, fine_id, 1);
    require(identical(coarse->positions[0], fine->positions[0]) &&
        identical(DeriveTerrainNormalsReference(coarse, 0.015625)->normals[0], DeriveTerrainNormalsReference(fine, 0.015625)->normals[0]),
        "indexed refinement changed a coarse anchor");
    const auto empty = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, outside, 0);
    require(empty->positions.capacity() == 0 && empty->sample_ids.capacity() == 0 && empty->truncated,
        "zero indexed demand allocated data");
    const auto limited = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, duplicate, 1);
    require(limited->positions.size() == 1 && limited->sample_ids[0] == first, "unselected duplicate changed selected demand");
    *malformed = *terrain; malformed->layout = TerrainSampleLayout::row_prefix;
    rejects([&] { BindTerrainWaterLevelMaterialsReference(malformed, 0, 101, 202); }, "terrain sample layout is invalid");
    *malformed = *terrain; malformed->layout = static_cast<TerrainSampleLayout>(255);
    rejects([&] { BindTerrainWaterLevelMaterialsReference(malformed, 0, 101, 202); }, "terrain sample layout is invalid");
    *malformed = *terrain; malformed->sample_ids[1] = malformed->sample_ids[0];
    rejects([&] { BindTerrainWaterLevelMaterialsReference(malformed, 0, 101, 202); }, "terrain indexed sample identity is invalid");
    *malformed = *terrain; malformed->potential_count -= 1;
    rejects([&] { BindTerrainWaterLevelMaterialsReference(malformed, 0, 101, 202); }, "terrain indexed sample identity is invalid");
    *malformed = *terrain; malformed->positions[0][0] = std::numeric_limits<double>::quiet_NaN();
    rejects([&] { BindTerrainWaterLevelMaterialsReference(malformed, 0, 101, 202); },
        "terrain working set must contain at most 65536 finite positions");
    rejects([&] { TriangulateTerrainCellsReference(surface, cells, 65537, 131073); },
        "terrain indexed samples require addressed topology");
    std::vector<std::uint64_t> maximum_ids(65536);
    for (std::size_t i = 0; i < maximum_ids.size(); ++i) maximum_ids[i] = (65536 - i) * 65538ull;
    const auto maximum = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, maximum_ids, 65536);
    require(maximum->positions.size() == 65536 && maximum->positions.capacity() == 65536 &&
        maximum->sample_ids == maximum_ids && maximum->sample_ids.capacity() == 65536,
        "full indexed demand expanded or reordered samples");
    const auto maximum_normals = DeriveTerrainNormalsReference(maximum, 0.015625);
    const auto maximum_material = BindTerrainWaterLevelMaterialsReference(maximum, 0, 101, 202);
    for (std::size_t i = 0; i < maximum_ids.size(); ++i) {
        require(maximum_material.material_ids[i] == (maximum->positions[i][1] <= 0 ? 202u : 101u), "full sparse classification changed");
        for (const auto value : maximum_normals->normals[i]) require(std::isfinite(value), "full sparse normal is not finite");
    }
    std::cout << "sparse terrain: demand=4 source=shared topology=explicit-rejection\n";
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
