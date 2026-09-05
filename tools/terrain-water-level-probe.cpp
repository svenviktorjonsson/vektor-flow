#include "native/material/vf_terrain_waterline.hpp"
#include <bit>
#include <iostream>
#include <optional>
#include <string_view>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
void write_word(std::uint64_t word, unsigned bytes) {
    for (unsigned index = 0; index < bytes; ++index)
        std::cout.put(static_cast<char>((word >> (index * 8)) & 255));
}
}
int main(int argc, char** argv) try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    const bool with_indexed_waterline = argc == 2 && std::string_view(argv[1]) == "--indexed-waterline";
    const bool with_addressed = with_indexed_waterline || (argc == 2 && std::string_view(argv[1]) == "--indexed-triangles");
    const bool with_indexed = with_addressed || (argc == 2 && std::string_view(argv[1]) == "--indexed");
    const bool with_waterline = with_indexed_waterline || (argc == 2 && std::string_view(argv[1]) == "--waterline");
    const bool with_triangles = with_addressed || with_waterline || (argc == 2 && std::string_view(argv[1]) == "--triangles");
    const bool with_normals = with_indexed || with_triangles || (argc == 2 && std::string_view(argv[1]) == "--normals");
    if (argc != 1 && !with_normals) throw std::invalid_argument("terrain probe mode is invalid");
    TerrainHeightCondition condition{};
    std::array<std::int32_t, 2> tile{};
    std::uint32_t level{}, exposed{}, submerged{};
    std::size_t budget{};
    std::array<std::uint64_t, 4> scalar_bits{};
    std::cin >> tile[0] >> tile[1] >> level >> budget >> condition.stream.key[0] >>
        condition.stream.key[1] >> condition.stream.counter_prefix[0] >> condition.stream.counter_prefix[1];
    for (auto& bits : scalar_bits) std::cin >> bits;
    std::cin >> exposed >> submerged;
    std::uint64_t distance_bits{};
    if (with_normals) std::cin >> distance_bits;
    std::size_t cell_budget{}, triangle_budget{}, demand_count{}, segment_budget{};
    std::vector<std::uint64_t> demands;
    std::vector<std::uint64_t> sample_ids;
    if (with_indexed) {
        std::size_t sample_demand_count{};
        std::cin >> sample_demand_count;
        if (sample_demand_count > 65536) throw std::range_error("terrain sample demand must contain at most 65536 entries");
        sample_ids.resize(sample_demand_count);
        for (auto& id : sample_ids) std::cin >> id;
    }
    if (with_triangles) {
        std::cin >> cell_budget >> triangle_budget >> demand_count;
        if (demand_count > 65536) throw std::range_error("terrain cell demand must contain at most 65536 entries");
        demands.resize(demand_count);
        for (auto& cell : demands) std::cin >> cell;
        if (with_waterline) std::cin >> segment_budget;
    }
    if (!std::cin) throw std::invalid_argument("terrain probe input is invalid");
    condition.correlation_length = std::bit_cast<double>(scalar_bits[0]);
    condition.mean = std::bit_cast<double>(scalar_bits[1]);
    condition.amplitude = std::bit_cast<double>(scalar_bits[2]);
    const auto terrain = with_indexed ? RealizeTerrainSampleDemandReference(condition, tile, level, sample_ids, budget) :
        RealizeTerrainTileReference(condition, tile, level, budget);
    const auto binding = BindTerrainWaterLevelMaterialsReference(terrain,
        std::bit_cast<double>(scalar_bits[3]), exposed, submerged);
    std::shared_ptr<const TerrainSurfacePacket> surface;
    if (with_normals) surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(terrain, std::bit_cast<double>(distance_bits)), binding));
    std::shared_ptr<const TerrainTriangulation> triangles;
    if (with_triangles) triangles = std::make_shared<const TerrainTriangulation>(
        with_addressed ? TriangulateTerrainAddressedCellsReference(surface, demands, cell_budget, triangle_budget) :
            TriangulateTerrainCellsReference(surface, demands, cell_budget, triangle_budget));
    std::optional<TerrainWaterline> waterline;
    if (with_waterline) waterline = ExtractTerrainWaterlineReference(triangles, segment_budget);
    write_word(terrain->positions.size(), 8);
    write_word(terrain->potential_count, 8);
    write_word(terrain->truncated ? 1 : 0, 4);
    for (std::size_t index = 0; index < terrain->positions.size(); ++index) {
        if (surface) {
            for (const auto value : surface->vertices[index]) write_word(std::bit_cast<std::uint64_t>(value), 8);
            write_word(surface->material_ids[index], 4);
        } else {
            for (const auto value : terrain->positions[index]) write_word(std::bit_cast<std::uint64_t>(value), 8);
            write_word(binding.material_ids[index], 4);
        }
    }
    if (triangles) {
        write_word(triangles->cell_count, 8);
        write_word(triangles->triangles.size(), 8);
        write_word(triangles->truncated ? 1 : 0, 4);
        write_word(triangles->bounds ? 1 : 0, 4);
        if (triangles->bounds) {
            for (const auto value : triangles->bounds->minimum) write_word(std::bit_cast<std::uint64_t>(value), 8);
            for (const auto value : triangles->bounds->maximum) write_word(std::bit_cast<std::uint64_t>(value), 8);
        }
        for (const auto& triangle : triangles->triangles)
            for (const auto index : triangle) write_word(index, 4);
    }
    if (waterline) {
        write_word(waterline->segments.size(), 8);
        write_word(waterline->truncated ? 1 : 0, 4);
        for (const auto& segment : waterline->segments)
            for (const auto& point : segment)
                for (const auto value : point) write_word(std::bit_cast<std::uint64_t>(value), 8);
    }
    if (with_indexed) {
        write_word(static_cast<std::uint8_t>(terrain->layout), 4);
        for (const auto id : terrain->sample_ids) write_word(id, 8);
    }
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
