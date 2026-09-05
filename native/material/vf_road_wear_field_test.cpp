#include "native/material/vf_road_wear_field.hpp"
#include <iostream>
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
    const ConditionedDemandStream traffic{{1, 2}, {3, 4}}, exposure{{5, 6}, {7, 8}}, pooling{{9, 10}, {11, 12}};
    const std::array<float, 6> coordinates{12, -1, 0, 16, -1, 0}, positions{22, 19, 3, 26, 19, 3};
    const std::array<std::uint16_t, 2> layers{0, 0};
    const RoadCoordinateBuffers road{coordinates, positions, layers, 12000000000ull};
    const auto wear = RealizeRoadWearCellsReference(traffic, exposure, road, 2);
    const auto replay = RealizeRoadWearCellsReference(traffic, exposure, road, 2);
    require(wear.albedo == replay.albedo && wear.drivers == replay.drivers &&
        wear.displacement == replay.displacement, "wear replay changed");
    require(wear.source.coordinates.data() == coordinates.data() && wear.buffers().coordinates.data() == coordinates.data() &&
        wear.buffers().drivers.data() == wear.drivers.data(), "wear buffer ownership changed");
    require(wear.vector_bytes() == 64 && !wear.truncated, "wear bound changed");
    const auto water = RealizeRoadWaterCellsReference(pooling, wear.buffers(), 2);
    require(water.geometry().coordinates.data() == wear.source.coordinates.data() &&
        water.material().water_depth.data() == water.geometry().water_depth.data(), "water chain copied shared truth");
    const auto prefix = RealizeRoadWearCellsReference(traffic, exposure, road, 1);
    require(prefix.truncated && prefix.vector_bytes() == 32 && prefix.displacement[0] == wear.displacement[0], "wear prefix changed");
    auto malformed = road;
    malformed.positions = std::span(positions).first(1);
    rejects([&] { RealizeRoadWearCellsReference(traffic, exposure, malformed, 65537); }, "road coordinate working set is required");
    rejects([&] { RealizeRoadWearCellsReference(traffic, exposure, road, 65537); },
        "road wear sampleBudget must be an integer from 0 to 65536");
    require(wear.drivers == replay.drivers && wear.displacement == replay.displacement, "rejected request mutated previous output");
    std::cout << "native road wear: shared_chain=true bounded_bytes=64\n";
}
