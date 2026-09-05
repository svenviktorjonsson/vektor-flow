#include "native/material/vf_road_water_field.hpp"
#include <array>
#include <iostream>
#include <stdexcept>
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
}
int main() {
    using namespace vf::material;
    require(Philox4x32_10({0, 0, 0, 0}, {0, 0}) ==
        std::array<std::uint32_t, 4>{0x6627e8d5, 0xe169c58d, 0xbc57ac4c, 0x9b00dbd8},
        "Philox zero known-answer vector changed");
    require(Philox4x32_10({0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff}, {0xffffffff, 0xffffffff}) ==
        std::array<std::uint32_t, 4>{0x408f276d, 0x41c83b0e, 0xa20bc7c6, 0x6d5451fd},
        "Philox all-ones known-answer vector changed");
    require(Philox4x32_10({0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344}, {0xa4093822, 0x299f31d0}) ==
        std::array<std::uint32_t, 4>{0xd16cfe09, 0x94fdcceb, 0x5001e420, 0x24126ea1},
        "Philox mixed known-answer vector changed");
    const ConditionedDemandStream stream{{1, 2}, {3, 4}};
    const std::array<float, 6> coordinates{0, 0, 0, 0, 0, 1}, positions{10, 20, 3, 10, 20, 2};
    const std::array<std::uint16_t, 2> layers{0, 1};
    const std::array<float, 4> drivers{0, 0, 0, 0};
    const std::array<float, 6> albedo{0.1f, 0.2f, 0.3f, 0.1f, 0.2f, 0.3f};
    const std::array<float, 2> roughness{0.6f, 0.6f}, wetness{0.7f, 0.7f};
    const RoadWearBuffers wear{coordinates, positions, layers, drivers, albedo, roughness, wetness, 300000000000ull};
    const auto result = RealizeRoadWaterCellsReference(stream, wear, 2);
    const auto replay = RealizeRoadWaterCellsReference(stream, wear, 2);
    require(result.water_depth == replay.water_depth && result.albedo == replay.albedo,
        "standing water replay changed");
    require(result.geometry().water_depth.data() == result.material().water_depth.data() &&
        result.geometry().water_coverage.data() == result.material().water_coverage.data(),
        "geometry and material do not share water truth");
    require(result.geometry().positions.data() == positions.data() &&
        result.material().coordinates.data() == coordinates.data(), "input coordinates were copied");
    require(result.water_depth[0] > 0 && result.water_depth[1] == 0 &&
        result.water_coverage[1] == 0 && result.albedo[3] == albedo[3], "wet and buried-layer rules changed");
    require(result.sample_count == 2 && result.vector_bytes() == 64 && !result.truncated &&
        result.potential_cell_count == wear.potential_cell_count, "bounded storage changed");
    const auto prefix = RealizeRoadWaterCellsReference(stream, wear, 1);
    require(prefix.truncated && prefix.vector_bytes() == 32 && prefix.water_depth[0] == result.water_depth[0],
        "bounded demand prefix changed");
    const auto empty = RealizeRoadWaterCellsReference(stream, wear, 0);
    require(empty.sample_count == 0 && empty.vector_bytes() == 0 && empty.truncated, "empty budget changed");
    auto malformed = wear;
    malformed.drivers = std::span(drivers).first(1);
    rejects([&] { RealizeRoadWaterCellsReference(stream, malformed, 65537); }, "road wear working set is required");
    rejects([&] { RealizeRoadWaterCellsReference(stream, wear, 65537); },
        "road water sampleBudget must be an integer from 0 to 65536");
    malformed = wear;
    malformed.potential_cell_count = 9007199254740992ull;
    rejects([&] { RealizeRoadWaterCellsReference(stream, malformed, 0); }, "road wear working set is required");
    require(result.water_depth == replay.water_depth && result.albedo == replay.albedo,
        "rejection changed an existing realization");
    std::cout << "native road water: known_vectors=3 shared_buffers=true bounded_bytes=64\n";
}
