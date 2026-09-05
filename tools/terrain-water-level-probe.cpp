#include "native/material/vf_terrain_normals.hpp"
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
    const bool with_normals = argc == 2 && std::string_view(argv[1]) == "--normals";
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
    if (!std::cin) throw std::invalid_argument("terrain probe input is invalid");
    condition.correlation_length = std::bit_cast<double>(scalar_bits[0]);
    condition.mean = std::bit_cast<double>(scalar_bits[1]);
    condition.amplitude = std::bit_cast<double>(scalar_bits[2]);
    const auto terrain = RealizeTerrainTileReference(condition, tile, level, budget);
    const auto binding = BindTerrainWaterLevelMaterialsReference(terrain,
        std::bit_cast<double>(scalar_bits[3]), exposed, submerged);
    std::optional<TerrainSurfacePacket> surface;
    if (with_normals) surface = AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(terrain, std::bit_cast<double>(distance_bits)), binding);
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
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
