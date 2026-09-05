#include "native/material/vf_terrain_waterline.hpp"
#include <bit>
#include <iostream>
#include <limits>
#include <numeric>
#include <string_view>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
bool identical(const std::array<double, 3>& a, const std::array<double, 3>& b) {
    for (std::size_t axis = 0; axis < 3; ++axis)
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
    using namespace vf::material;
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 4, 0, 2};
    // Authored linear-triangle boundary fixtures test consumer degeneracies;
    // they do not stand in for the generated-terrain seam test below.
    const auto authored_mesh = [&](std::array<double, 4> heights, double level) {
        auto terrain = std::make_shared<TerrainTileWorkingSet>();
        terrain->positions = {{0, heights[0], 0}, {1, heights[1], 0}, {0, heights[2], 1}, {1, heights[3], 1}};
        terrain->potential_count = 4;
        terrain->truncated = false;
        terrain->condition = condition;
        terrain->tile = {0, 0};
        terrain->refinement = 0;
        auto normals = std::make_shared<TerrainNormalsWorkingSet>();
        normals->source = terrain;
        normals->normals.assign(4, {0, 1, 0});
        const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
            normals, BindTerrainWaterLevelMaterialsReference(terrain, level, 101, 202)));
        const std::array<std::uint64_t, 1> demand{0};
        return std::make_shared<const TerrainTriangulation>(TriangulateTerrainCellsReference(surface, demand, 1, 2));
    };
    const auto left_terrain = RealizeTerrainTileReference(condition, {-1, 2}, 3, 81);
    const double water_level = (left_terrain->positions[8][1] + left_terrain->positions[17][1]) / 2;
    const auto make_mesh = [&](const TerrainHeightCondition& field, std::array<std::int32_t, 2> tile,
        std::uint64_t cell, double level) {
        const auto terrain = RealizeTerrainTileReference(field, tile, 3, 81);
        const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
            DeriveTerrainNormalsReference(terrain, 0.015625),
            BindTerrainWaterLevelMaterialsReference(terrain, level, 101, 202)));
        const std::array<std::uint64_t, 1> demand{cell};
        return std::make_shared<const TerrainTriangulation>(TriangulateTerrainCellsReference(surface, demand, 1, 2));
    };
    const auto left_mesh = make_mesh(condition, {-1, 2}, 7, water_level);
    const auto right_mesh = make_mesh(condition, {0, 2}, 0, water_level);
    const auto left = ExtractTerrainWaterlineReference(left_mesh, 2);
    const auto right = ExtractTerrainWaterlineReference(right_mesh, 2);
    const auto shared_point = [&](const TerrainWaterline& line) {
        for (const auto& segment : line.segments)
            for (const auto& point : segment)
                if (point[0] == 0 && point[2] > 2 && point[2] < 2.125) return point;
        throw std::runtime_error("waterline did not intersect shared edge");
    };
    require(identical(shared_point(left), shared_point(right)), "waterline seam is not byte-identical");
    require(left.source == left_mesh && right.source == right_mesh &&
        left.source->source->water_level == water_level, "waterline lost retained material threshold");
    require(!left.segments.empty() && !left.truncated && left.segments.size() <= 2, "waterline demand changed");
    for (const auto& segment : left.segments)
        for (const auto& point : segment) require(point[1] == water_level, "waterline left its retained water level");
    auto malformed_surface = std::make_shared<TerrainSurfacePacket>(*left_mesh->source);
    malformed_surface->water_level = std::numeric_limits<double>::quiet_NaN();
    auto malformed_mesh = std::make_shared<TerrainTriangulation>(*left_mesh);
    malformed_mesh->source = malformed_surface;
    rejects([&] { ExtractTerrainWaterlineReference(malformed_mesh, 2); }, "terrain water level must be finite");
    *malformed_surface = *left_mesh->source;
    malformed_surface->material_ids[0] ^= 1;
    rejects([&] { ExtractTerrainWaterlineReference(malformed_mesh, 2); },
        "terrain waterline material truth does not match retained level");
    require(ExtractTerrainWaterlineReference(authored_mesh({0, 0, 0, 0}, 0), 2).segments.empty(),
        "coplanar terrain emitted a separator");
    require(ExtractTerrainWaterlineReference(authored_mesh({0, 1, 1, 1}, 0), 2).segments.empty(),
        "point contact emitted a zero-length segment");
    const auto level_edge_mesh = authored_mesh({1, 0, 0, 1}, 0);
    const auto level_edge = ExtractTerrainWaterlineReference(level_edge_mesh, 2);
    require(level_edge.segments == std::vector<TerrainWaterlineSegment>{{{{0, 0, 1}, {1, 0, 0}}}},
        "shared exposed level edge was not emitted once");
    auto reversed_mesh = std::make_shared<TerrainTriangulation>(*level_edge_mesh);
    std::reverse(reversed_mesh->triangles.begin(), reversed_mesh->triangles.end());
    for (auto& triangle : reversed_mesh->triangles) std::reverse(triangle.begin(), triangle.end());
    require(ExtractTerrainWaterlineReference(reversed_mesh, 2).segments == level_edge.segments,
        "shared level-edge identity depends on triangle order or winding");
    const auto extreme = authored_mesh({-1e308, 1e308, 1e308, -1e308}, 0);
    rejects([&] { ExtractTerrainWaterlineReference(extreme, 2); }, "terrain waterline interpolation must be finite");
    const double upper_level = (left_terrain->positions[72][1] + left_terrain->positions[73][1]) / 2;
    const auto upper = ExtractTerrainWaterlineReference(make_mesh(condition, {-1, 2}, 56, upper_level), 2);
    const auto above = ExtractTerrainWaterlineReference(make_mesh(condition, {-1, 3}, 0, upper_level), 2);
    const auto upper_point = [&](const TerrainWaterline& line) {
        for (const auto& segment : line.segments)
            for (const auto& point : segment)
                if (point[2] == 3 && point[0] > -1 && point[0] < -0.875) return point;
        throw std::runtime_error("waterline did not intersect second shared edge");
    };
    require(identical(upper_point(upper), upper_point(above)), "second-axis waterline seam changed");
    const double changed_level = (3 * left_terrain->positions[8][1] + left_terrain->positions[17][1]) / 4;
    const auto moved = ExtractTerrainWaterlineReference(make_mesh(condition, {-1, 2}, 7, changed_level), 2);
    require(!identical(shared_point(left), shared_point(moved)) && shared_point(moved)[1] == changed_level,
        "changed retained water level did not move the shared waterline");
    const auto replay = ExtractTerrainWaterlineReference(make_mesh(condition, {-1, 2}, 7, water_level), 2);
    require(replay.segments.size() == left.segments.size(), "replay changed waterline count");
    for (std::size_t index = 0; index < left.segments.size(); ++index)
        for (std::size_t end = 0; end < 2; ++end)
            require(identical(replay.segments[index][end], left.segments[index][end]), "replay changed waterline bytes");
    const auto zero = ExtractTerrainWaterlineReference(left_mesh, 0);
    require(zero.segments.empty() && zero.segments.capacity() == 0 && zero.truncated, "zero waterline demand changed");
    const auto prefix = ExtractTerrainWaterlineReference(left_mesh, 1);
    require(prefix.segments.size() == 1 && prefix.segments.capacity() <= 1 && prefix.segments[0] == left.segments[0],
        "waterline prefix changed identity or exceeded budget");
    rejects([&] { ExtractTerrainWaterlineReference(nullptr, 65537); }, "terrain triangulation is required");
    rejects([&] { ExtractTerrainWaterlineReference(left_mesh, 65537); },
        "terrain waterline segment budget must be from 0 to 65536");
    *malformed_mesh = *left_mesh;
    malformed_mesh->triangles[0][0] = 81;
    rejects([&] { ExtractTerrainWaterlineReference(malformed_mesh, 2); }, "terrain waterline triangle index is invalid");
    malformed_mesh->triangles.resize(131073);
    rejects([&] { ExtractTerrainWaterlineReference(malformed_mesh, 0); }, "terrain waterline input exceeds 131072 triangles");
    *malformed_surface = *left_mesh->source;
    malformed_surface->water_level = -100;
    *malformed_mesh = *left_mesh;
    malformed_mesh->source = malformed_surface;
    rejects([&] { ExtractTerrainWaterlineReference(malformed_mesh, 0); },
        "terrain waterline material truth does not match retained level");
    auto detailed_condition = condition;
    detailed_condition.correlation_length = 1.0 / 256;
    const auto detailed_terrain = RealizeTerrainTileReference(detailed_condition, {-1, 2}, 8, 65536);
    const auto detailed_surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(detailed_terrain, 1.0 / 1024),
        BindTerrainWaterLevelMaterialsReference(detailed_terrain, 0, 101, 202)));
    std::vector<std::uint64_t> detailed_demand(65024);
    std::iota(detailed_demand.begin(), detailed_demand.end(), 0);
    const auto detailed_mesh = std::make_shared<const TerrainTriangulation>(TriangulateTerrainCellsReference(
        detailed_surface, detailed_demand, 65536, 131072));
    const auto maximum = ExtractTerrainWaterlineReference(detailed_mesh, 65536);
    require(maximum.segments.size() == 65536 && maximum.segments.capacity() <= 65536 && maximum.truncated,
        "maximum waterline budget was not preserved");
    for (const auto& segment : maximum.segments) {
        require(segment[0] != segment[1], "maximum waterline contains a point-only segment");
        for (const auto& point : segment)
            require(std::isfinite(point[0]) && point[1] == 0 && std::isfinite(point[2]), "maximum waterline is not finite and on-level");
    }
    std::cout << "terrain waterline: seam=exact threshold=retained source=owned\n";
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
