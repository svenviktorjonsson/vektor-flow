#include "native/material/vf_terrain_waterline.hpp"
#include <iostream>
#include <limits>
#include <numeric>
#include <string_view>
#include <tuple>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<class Function> void rejects(Function&& call, std::string_view message) {
    try { call(); } catch (const std::exception& error) {
        require(error.what() == message, "changed addressed rejection diagnostic");
        return;
    }
    throw std::runtime_error("invalid addressed input was accepted");
}
template<std::size_t Size> bool identical(const std::array<double, Size>& a, const std::array<double, Size>& b) {
    for (std::size_t axis = 0; axis < Size; ++axis)
        if (std::bit_cast<std::uint64_t>(a[axis]) != std::bit_cast<std::uint64_t>(b[axis])) return false;
    return true;
}
}
int main() try {
    using namespace vf::material;
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 0.125, 0, 2};
    const auto make_surface = [&](const TerrainHeightCondition& field, std::array<std::int32_t, 2> tile,
        std::uint32_t refinement, std::span<const std::uint64_t> ids) {
        const auto terrain = RealizeTerrainSampleDemandReference(field, tile, refinement, ids, ids.size());
        return std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
            DeriveTerrainNormalsReference(terrain, 1.0 / 1024),
            BindTerrainWaterLevelMaterialsReference(terrain, 0.25, 101, 202)));
    };
    constexpr std::uint64_t width = 65537, a = 60000 * width + 50000;
    const std::array<std::uint64_t, 4> addresses{a + width + 1, a, a + width, a + 1};
    const auto source = RealizeTerrainSampleDemandReference(condition, {-1, 2}, 16, addresses, 4);
    const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(source, 1.0 / 1024),
        BindTerrainWaterLevelMaterialsReference(source, 0.25, 101, 202)));
    const std::array<std::uint64_t, 1> cells{60000ull * 65536 + 50000};
    const auto mesh = TriangulateTerrainAddressedCellsReference(surface, cells, 1, 2);
    require(mesh.triangles == std::vector<std::array<std::uint32_t, 3>>{{1, 2, 3}, {3, 2, 0}},
        "addressed cell did not map to compact upward triangle indices");
    require(mesh.source == surface && mesh.source->source == source && mesh.bounds &&
        mesh.cell_count == 1 && !mesh.truncated && mesh.triangles.capacity() == 2,
        "addressed topology lost source ownership or demand bounds");
    rejects([&] { TriangulateTerrainCellsReference(surface, cells, 65537, 131073); },
        "terrain indexed samples require addressed topology");
    const auto original = surface->vertices;
    const auto run = [&](std::span<const std::uint64_t> demand, std::size_t cell_cap, std::size_t triangle_cap) {
        return TriangulateTerrainAddressedCellsReference(surface, demand, cell_cap, triangle_cap);
    };
    const std::array<std::uint64_t, 3> duplicate{cells[0], cells[0], 4294967296ull};
    rejects([&] { run(duplicate, 3, 6); }, "terrain cell demand is duplicated");
    const std::array<std::uint64_t, 2> outside{4294967296ull, cells[0]};
    rejects([&] { run(outside, 2, 4); }, "terrain cell demand exceeds tile domain");
    const std::array<std::uint64_t, 2> missing{cells[0] - 1, 4294967296ull};
    rejects([&] { run(missing, 2, 4); }, "terrain demanded cell is not fully resident");
    rejects([&] { run(outside, 65537, 131073); }, "terrain cell budget must be from 0 to 65536");
    rejects([&] { run(outside, 1, 131073); }, "terrain triangle budget must be from 0 to 131072");
    const std::vector<std::uint64_t> oversized(65537, cells[0]);
    rejects([&] { run(oversized, 0, 0); }, "terrain cell demand must contain at most 65536 entries");
    const auto selected = run(duplicate, 1, 3);
    require(selected.triangles == mesh.triangles && selected.truncated && selected.triangles.capacity() == 2,
        "selected prefix evaluated invalid unselected demand or overallocated");
    const auto zero = run(outside, 2, 1);
    require(zero.triangles.empty() && zero.triangles.capacity() == 0 && !zero.bounds && zero.truncated,
        "partial cell allocated triangles or bounds");
    require(surface->vertices == original, "rejected demand mutated source");
    for (std::size_t missing_corner = 0; missing_corner < addresses.size(); ++missing_corner) {
        auto partial = std::vector<std::uint64_t>(addresses.begin(), addresses.end());
        partial.erase(partial.begin() + static_cast<std::ptrdiff_t>(missing_corner));
        rejects([&] { TriangulateTerrainAddressedCellsReference(make_surface(condition, {-1, 2}, 16, partial), cells, 1, 2); },
            "terrain demanded cell is not fully resident");
    }
    auto forged = std::make_shared<TerrainSurfacePacket>(*surface);
    forged->vertices[0][0] += 1;
    rejects([&] { TriangulateTerrainAddressedCellsReference(forged, outside, 65537, 131073); },
        "terrain surface must align with source positions and materials");
    *forged = *surface;
    forged->vertices[0][3] = std::numeric_limits<double>::quiet_NaN();
    rejects([&] { TriangulateTerrainAddressedCellsReference(forged, outside, 65537, 131073); },
        "terrain surface normals must be finite");
    *forged = *surface;
    auto wrong_ids = std::make_shared<TerrainTileWorkingSet>(*source);
    std::swap(wrong_ids->sample_ids[0], wrong_ids->sample_ids[1]);
    forged->source = wrong_ids;
    rejects([&] { TriangulateTerrainAddressedCellsReference(forged, cells, 1, 2); },
        "terrain indexed sample position does not match its ID");
    const auto replay = TriangulateTerrainAddressedCellsReference(make_surface(condition, {-1, 2}, 16, addresses), cells, 1, 2);
    require(replay.triangles == mesh.triangles && identical(replay.bounds->minimum, mesh.bounds->minimum) &&
        identical(replay.bounds->maximum, mesh.bounds->maximum), "addressed replay changed bytes");
    auto changed_condition = condition;
    ++changed_condition.stream.key[0];
    const auto changed = TriangulateTerrainAddressedCellsReference(make_surface(changed_condition, {-1, 2}, 16, addresses), cells, 1, 2);
    require(changed.triangles == mesh.triangles && !identical(changed.bounds->minimum, mesh.bounds->minimum),
        "changed seed altered topology or failed to alter heights");
    const auto one_cell = [&](std::array<std::int32_t, 2> tile, std::uint32_t refinement, std::uint64_t cell) {
        const auto divisions = std::uint64_t{1} << refinement, row_width = divisions + 1;
        const auto first = (cell / divisions) * row_width + cell % divisions;
        const std::array<std::uint64_t, 4> ids{first, first + 1, first + row_width, first + row_width + 1};
        const std::array<std::uint64_t, 1> demand{cell};
        return TriangulateTerrainAddressedCellsReference(make_surface(condition, tile, refinement, ids), demand, 1, 2);
    };
    const auto left = one_cell({-1, 2}, 16, 12345ull * 65536 + 65535);
    const auto right = one_cell({0, 2}, 16, 12345ull * 65536);
    const auto below = one_cell({-1, 2}, 16, 65535ull * 65536 + 12345);
    const auto above = one_cell({-1, 3}, 16, 12345);
    for (const auto& [first, second, index_a, index_b] :
        std::array<std::tuple<const TerrainTriangulation*, const TerrainTriangulation*, std::size_t, std::size_t>, 4>{{
            {&left, &right, 1, 0}, {&left, &right, 3, 2}, {&below, &above, 2, 0}, {&below, &above, 3, 1}}})
        require(identical(first->source->vertices[index_a], second->source->vertices[index_b]) &&
            first->source->material_ids[index_a] == second->source->material_ids[index_b], "addressed seam bytes differ");
    const auto coarse = one_cell({-1, 2}, 15, 30000ull * 32768 + 25000);
    const auto fine = one_cell({-1, 2}, 16, cells[0]);
    require(identical(coarse.source->vertices[0], fine.source->vertices[0]) &&
        coarse.source->material_ids[0] == fine.source->material_ids[0], "refinement changed retained anchor");
    std::vector<std::uint64_t> full_ids(65536), full_cells(65024);
    std::iota(full_ids.begin(), full_ids.end(), 0);
    std::reverse(full_ids.begin(), full_ids.end());
    std::iota(full_cells.begin(), full_cells.end(), 0);
    const auto maximum = TriangulateTerrainAddressedCellsReference(make_surface(condition, {-1, 2}, 8, full_ids),
        full_cells, 65536, 131072);
    require(maximum.triangles.size() == 130048 && maximum.triangles.capacity() == 130048 &&
        maximum.source->vertices.size() == 65536 && !maximum.truncated, "full addressed demand overallocated");
    for (const auto& triangle : maximum.triangles) {
        for (const auto index : triangle) require(index < 65536, "compact triangle index exceeds resident source");
        const auto& first = maximum.source->vertices[triangle[0]];
        const auto& second = maximum.source->vertices[triangle[1]];
        const auto& third = maximum.source->vertices[triangle[2]];
        require((second[2] - first[2]) * (third[0] - first[0]) - (second[0] - first[0]) * (third[2] - first[2]) > 0,
            "addressed winding is not upward");
        for (const auto index : triangle)
            for (std::size_t axis = 0; axis < 3; ++axis)
                require(maximum.source->vertices[index][axis] >= maximum.bounds->minimum[axis] &&
                    maximum.source->vertices[index][axis] <= maximum.bounds->maximum[axis], "triangle escaped emitted bounds");
    }
    const auto high = one_cell({-1, 2}, 16, 4294967295ull);
    require(high.source->source->sample_ids.back() == 4295098368ull && high.triangles.back()[2] == 3,
        "64-bit corner identity was truncated to a dense index");
    const auto consumer = ExtractTerrainWaterlineReference(std::make_shared<const TerrainTriangulation>(mesh), 2);
    require(consumer.source->source == surface, "waterline consumer lost addressed source ownership");
    std::cout << "addressed terrain topology: compact=exact source=owned\n";
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
