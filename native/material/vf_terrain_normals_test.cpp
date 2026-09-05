#include "native/material/vf_terrain_normals.hpp"
#include <bit>
#include <iostream>
#include <limits>
#include <string_view>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<std::size_t Size> bool identical(const std::array<double, Size>& first,
    const std::array<double, Size>& second) {
    for (std::size_t axis = 0; axis < Size; ++axis)
        if (std::bit_cast<std::uint64_t>(first[axis]) != std::bit_cast<std::uint64_t>(second[axis])) return false;
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
    using namespace vf::material;
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 4, 0, 2};
    const auto packet = [&](std::array<std::int32_t, 2> tile, std::uint32_t level, std::size_t budget) {
        const auto terrain = RealizeTerrainTileReference(condition, tile, level, budget);
        const auto normals = DeriveTerrainNormalsReference(terrain, 0.015625);
        return AssembleTerrainSurfacePacketReference(normals,
            BindTerrainWaterLevelMaterialsReference(terrain, 0.25, 101, 202));
    };
    const auto left = packet({-1, 2}, 3, 81), right = packet({0, 2}, 3, 81), above = packet({-1, 3}, 3, 81);
    for (std::size_t index = 0; index < 9; ++index) {
        require(identical(left.vertices[index * 9 + 8], right.vertices[index * 9]),
            "surface seam differs on first axis");
        require(identical(left.vertices[72 + index], above.vertices[index]),
            "surface seam differs on second axis");
        require(left.material_ids[index * 9 + 8] == right.material_ids[index * 9] &&
            left.material_ids[72 + index] == above.material_ids[index], "surface material seam differs");
    }
    const auto fine = packet({-1, 2}, 4, 289);
    for (std::size_t row = 0; row < 9; ++row)
        for (std::size_t column = 0; column < 9; ++column)
            require(identical(left.vertices[row * 9 + column], fine.vertices[row * 2 * 17 + column * 2]),
                "refinement changed a coarse surface anchor");
    const auto terrain = RealizeTerrainTileReference(condition, {-1, 2}, 3, 81);
    const auto repeated = packet({-1, 2}, 3, 81), limited = packet({-1, 2}, 3, 19);
    require(limited.vertices.size() == 19 && limited.source->truncated, "surface demand bound changed");
    for (std::size_t index = 0; index < left.vertices.size(); ++index) {
        require(identical(left.vertices[index], repeated.vertices[index]), "surface regeneration changed identity");
        if (index < limited.vertices.size())
            require(identical(left.vertices[index], limited.vertices[index]), "surface budget changed identity");
        for (std::size_t axis = 3; axis < 6; ++axis)
            require(std::isfinite(left.vertices[index][axis]) && std::abs(left.vertices[index][axis]) <= 1,
                "surface normal is not finite and bounded");
        require(left.vertices[index][4] > 0, "surface normal has no upward component");
    }
    const auto maximum = packet({-1, 2}, 16, 65536), empty = packet({-1, 2}, 16, 0);
    require(maximum.vertices.size() == 65536 && maximum.material_ids.size() == 65536 &&
        maximum.source->potential_count == 4295098369ull && maximum.source->truncated,
        "surface expanded potential demand");
    require(empty.vertices.empty() && empty.material_ids.empty(), "surface expanded empty demand");
    const auto normals = DeriveTerrainNormalsReference(terrain, 0.015625);
    const auto aligned_material = BindTerrainWaterLevelMaterialsReference(terrain, 0.25, 101, 202);
    const auto owned = AssembleTerrainSurfacePacketReference(normals, aligned_material);
    require(normals->source == terrain && owned.source == terrain, "normal consumer lost exact source ownership");
    auto changed_condition = condition;
    changed_condition.stream.key[0] += 1;
    const auto changed = DeriveTerrainNormalsReference(
        RealizeTerrainTileReference(changed_condition, {-1, 2}, 3, 81), 0.015625);
    require(!identical(normals->normals[0], changed->normals[0]), "seed did not affect normals");
    rejects([&] { AssembleTerrainSurfacePacketReference(changed, aligned_material); },
        "aligned terrain normal and material working sets are required");
    auto short_material = aligned_material;
    short_material.material_ids.pop_back();
    rejects([&] { AssembleTerrainSurfacePacketReference(normals, short_material); },
        "aligned terrain normal and material working sets are required");
    auto wrong_source = aligned_material;
    wrong_source.source = RealizeTerrainTileReference(condition, {-1, 2}, 3, 81);
    rejects([&] { AssembleTerrainSurfacePacketReference(normals, wrong_source); },
        "aligned terrain normal and material working sets are required");
    rejects([&] { DeriveTerrainNormalsReference(terrain, std::numeric_limits<double>::denorm_min()); },
        "terrain normal sampling distance is not representable at position");
    auto extreme_condition = condition;
    extreme_condition.amplitude = 1e200;
    const auto extreme = RealizeTerrainTileReference(extreme_condition, {-1, 2}, 3, 81);
    rejects([&] { DeriveTerrainNormalsReference(extreme, 0.015625); },
        "terrain normal length must be finite and positive");
    auto malformed = std::make_shared<TerrainNormalsWorkingSet>(*DeriveTerrainNormalsReference(terrain, 0.015625));
    malformed->normals[0][0] = std::numeric_limits<double>::quiet_NaN();
    const auto material = BindTerrainWaterLevelMaterialsReference(terrain, 0.25, 101, 202);
    rejects([&] { AssembleTerrainSurfacePacketReference(malformed, material); },
        "terrain surface normals must be finite");
    rejects([&] { AssembleTerrainSurfacePacketReference(malformed, wrong_source); },
        "aligned terrain normal and material working sets are required");
    auto wide_condition = condition;
    wide_condition.correlation_length = 1e308;
    const auto wide = RealizeTerrainTileReference(wide_condition, {0, 0}, 0, 4);
    rejects([&] { DeriveTerrainNormalsReference(wide, 1e308); },
        "terrain normal sampling span must be finite");
    std::cout << "terrain normals: seams=exact refinement=exact consumer=aligned\n";
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
