#include "native/material/vf_terrain_triangulation.hpp"
#include <bit>
#include <iostream>
#include <limits>
#include <numeric>
#include <string_view>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<class Function> void rejects(Function&& call, std::string_view message) {
    try { call(); } catch (const std::exception& error) {
        require(error.what() == message, "changed rejection diagnostic");
        return;
    }
    throw std::runtime_error("invalid input was accepted");
}
template<std::size_t Size> bool identical(const std::array<double, Size>& a, const std::array<double, Size>& b) {
    for (std::size_t axis = 0; axis < Size; ++axis)
        if (std::bit_cast<std::uint64_t>(a[axis]) != std::bit_cast<std::uint64_t>(b[axis])) return false;
    return true;
}
}
int main() try {
    using namespace vf::material;
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 4, 0, 2};
    const auto make_surface = [&](const TerrainHeightCondition& field, std::array<std::int32_t, 2> tile,
        std::uint32_t level, std::size_t budget) {
        const auto source = RealizeTerrainTileReference(field, tile, level, budget);
        return std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
            DeriveTerrainNormalsReference(source, 0.015625),
            BindTerrainWaterLevelMaterialsReference(source, 0.25, 101, 202)));
    };
    const auto terrain = RealizeTerrainTileReference(condition, {-1, 2}, 3, 81);
    const auto normals = DeriveTerrainNormalsReference(terrain, 0.015625);
    const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        normals, BindTerrainWaterLevelMaterialsReference(terrain, 0.25, 101, 202)));
    const std::array<std::uint64_t, 1> demand{0};
    const auto mesh = TriangulateTerrainCellsReference(surface, demand, 1, 2);
    require(mesh.source == surface && mesh.source->source == terrain, "triangulation lost source ownership");
    require(mesh.triangles == std::vector<std::array<std::uint32_t, 3>>{{0, 9, 1}, {1, 9, 10}},
        "one cell did not produce the canonical upward triangles");
    require(mesh.bounds.has_value() && !mesh.truncated && mesh.cell_count == 1, "cell bounds missing");
    for (const auto& triangle : mesh.triangles)
        for (const auto index : triangle)
            for (std::size_t axis = 0; axis < 3; ++axis)
                require(surface->vertices[index][axis] >= mesh.bounds->minimum[axis] &&
                    surface->vertices[index][axis] <= mesh.bounds->maximum[axis], "triangle escaped its bounds");
    auto forged = std::make_shared<TerrainSurfacePacket>(*surface);
    forged->vertices[0][0] += 1;
    rejects([&] { TriangulateTerrainCellsReference(forged, demand, 1, 2); },
        "terrain surface must align with source positions and materials");
    *forged = *surface;
    forged->vertices[0][3] = std::numeric_limits<double>::quiet_NaN();
    rejects([&] { TriangulateTerrainCellsReference(forged, demand, 1, 2); },
        "terrain surface normals must be finite");
    *forged = *surface;
    auto wrong_grid = std::make_shared<TerrainTileWorkingSet>(*terrain);
    wrong_grid->refinement = 4;
    forged->source = wrong_grid;
    rejects([&] { TriangulateTerrainCellsReference(forged, demand, 1, 2); },
        "terrain grid identity is invalid");
    const std::array<std::uint64_t, 2> duplicate{0, 0};
    rejects([&] { TriangulateTerrainCellsReference(surface, duplicate, 2, 4); },
        "terrain cell demand is duplicated");
    require(mesh.bounds->minimum[0] == -1 && mesh.bounds->maximum[0] == -0.875 &&
        mesh.bounds->minimum[2] == 2 && mesh.bounds->maximum[2] == 2.125,
        "bounds incorrectly include undemanded terrain");
    const std::array<std::uint64_t, 3> ordered{7, 0, 8};
    const auto all = TriangulateTerrainCellsReference(surface, ordered, 3, 6);
    const auto prefix = TriangulateTerrainCellsReference(surface, ordered, 2, 5);
    require(prefix.cell_count == 2 && prefix.truncated && prefix.triangles.size() == 4 &&
        prefix.triangles.capacity() == 4 && std::equal(prefix.triangles.begin(), prefix.triangles.end(), all.triangles.begin()),
        "triangle budget changed demand order or overallocated");
    const auto zero = TriangulateTerrainCellsReference(surface, ordered, 3, 1);
    require(zero.triangles.empty() && zero.triangles.capacity() == 0 && !zero.bounds && zero.truncated,
        "incomplete triangle budget allocated a partial cell");
    const auto right_surface = make_surface(condition, {0, 2}, 3, 81);
    const auto right = TriangulateTerrainCellsReference(right_surface, demand, 1, 2);
    require(identical(all.source->vertices[8], right.source->vertices[0]) &&
        identical(all.source->vertices[17], right.source->vertices[9]), "first-axis mesh seam changed");
    const std::array<std::uint64_t, 1> upper_demand{56};
    const auto upper = TriangulateTerrainCellsReference(surface, upper_demand, 1, 2);
    const auto above = TriangulateTerrainCellsReference(make_surface(condition, {-1, 3}, 3, 81), demand, 1, 2);
    require(identical(upper.source->vertices[72], above.source->vertices[0]) &&
        identical(upper.source->vertices[73], above.source->vertices[1]), "second-axis mesh seam changed");
    const std::array<std::uint64_t, 4> fine_demand{0, 1, 16, 17};
    const auto fine = TriangulateTerrainCellsReference(make_surface(condition, {-1, 2}, 4, 289), fine_demand, 4, 8);
    for (const auto [coarse_index, fine_index] : std::array<std::array<std::size_t, 2>, 4>{{{0, 0}, {1, 2}, {9, 34}, {10, 36}}})
        require(identical(mesh.source->vertices[coarse_index], fine.source->vertices[fine_index]) &&
            mesh.source->material_ids[coarse_index] == fine.source->material_ids[fine_index],
            "refinement changed an emitted coarse anchor");
    const auto replay = TriangulateTerrainCellsReference(make_surface(condition, {-1, 2}, 3, 81), ordered, 3, 6);
    require(replay.triangles == all.triangles && identical(replay.bounds->minimum, all.bounds->minimum) &&
        identical(replay.bounds->maximum, all.bounds->maximum), "replay changed mesh or bounds");
    auto changed_condition = condition;
    changed_condition.stream.key[0] += 1;
    const auto changed = TriangulateTerrainCellsReference(make_surface(changed_condition, {-1, 2}, 3, 81), demand, 1, 2);
    require(changed.triangles == mesh.triangles && !identical(changed.bounds->minimum, mesh.bounds->minimum),
        "seed changed topology or failed to change surface bounds");
    rejects([&] { TriangulateTerrainCellsReference(make_surface(condition, {-1, 2}, 3, 10), demand, 1, 2); },
        "terrain demanded cell is not fully resident");
    rejects([&] { TriangulateTerrainCellsReference(make_surface(condition, {-1, 2}, 16, 65536), demand, 1, 2); },
        "terrain demanded cell is not fully resident");
    const std::array<std::uint64_t, 1> outside{64};
    rejects([&] { TriangulateTerrainCellsReference(surface, outside, 1, 2); }, "terrain cell demand exceeds tile domain");
    rejects([&] { TriangulateTerrainCellsReference(surface, outside, 65537, 131073); },
        "terrain cell budget must be from 0 to 65536");
    rejects([&] { TriangulateTerrainCellsReference(surface, outside, 1, 131073); },
        "terrain triangle budget must be from 0 to 131072");
    require(TriangulateTerrainCellsReference(surface, outside, 0, 0).triangles.empty(), "zero demand evaluated an unselected cell");
    std::vector<std::uint64_t> huge_demand(65537, 0);
    rejects([&] { TriangulateTerrainCellsReference(surface, huge_demand, 0, 0); },
        "terrain cell demand must contain at most 65536 entries");
    huge_demand.resize(65024);
    std::iota(huge_demand.begin(), huge_demand.end(), 0);
    const auto maximum = TriangulateTerrainCellsReference(make_surface(condition, {-1, 2}, 8, 65536),
        huge_demand, 65536, 131072);
    require(maximum.triangles.size() == 130048 && maximum.triangles.capacity() == 130048 &&
        maximum.source->vertices.size() == 65536 && !maximum.truncated, "maximum mesh demand overallocated");
    for (const auto& triangle : maximum.triangles) {
        for (const auto vertex : triangle) require(vertex < 65536, "mesh referenced a missing vertex");
        const auto& a = maximum.source->vertices[triangle[0]];
        const auto& b = maximum.source->vertices[triangle[1]];
        const auto& c = maximum.source->vertices[triangle[2]];
        require((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0,
            "mesh winding is not upward");
        for (const auto vertex : triangle)
            for (std::size_t axis = 0; axis < 3; ++axis)
                require(maximum.source->vertices[vertex][axis] >= maximum.bounds->minimum[axis] &&
                    maximum.source->vertices[vertex][axis] <= maximum.bounds->maximum[axis], "full mesh escaped bounds");
    }
    auto flat_condition = condition;
    flat_condition.mean = -0.0;
    flat_condition.amplitude = 0;
    flat_condition.correlation_length = 0.125;
    const auto flat_surface = make_surface(flat_condition, {-1, 2}, 3, 81);
    std::array<std::uint64_t, 2> flat_cells{64, 64};
    for (std::uint64_t cell = 0; cell < 64; ++cell) {
        const auto first = (cell / 8) * 9 + cell % 8;
        flat_cells[std::signbit(flat_surface->vertices[static_cast<std::size_t>(first)][1]) ? 1 : 0] = cell;
    }
    require(flat_cells[0] < 64 && flat_cells[1] < 64, "flat fixture lacks both signed zeros");
    const auto flat_forward = TriangulateTerrainCellsReference(flat_surface, flat_cells, 2, 4);
    std::reverse(flat_cells.begin(), flat_cells.end());
    const auto flat_reverse = TriangulateTerrainCellsReference(flat_surface, flat_cells, 2, 4);
    require(identical(flat_forward.bounds->minimum, flat_reverse.bounds->minimum) &&
        identical(flat_forward.bounds->maximum, flat_reverse.bounds->maximum) &&
        std::signbit(flat_forward.bounds->minimum[1]) && !std::signbit(flat_forward.bounds->maximum[1]),
        "signed-zero bounds depend on cell order");
    std::cout << "terrain triangulation: topology=exact bounds=conservative source=owned\n";
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
