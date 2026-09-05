#include "native/material/vf_road_field_energy.hpp"
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
    const ConditionedDemandStream first{{1, 2}, {3, 4}}, second{{5, 6}, {7, 8}};
    const std::array<float, 9> coordinates{12, -1, 0, 12, -1, 1, 12, -1, 2}, positions{22, 19, 3, 22, 19, 2, 22, 19, 1};
    const std::array<std::uint16_t, 3> layers{0, 1, 2};
    const RoadCoordinateBuffers road{coordinates, positions, layers, 300000000000ull};
    const auto construction = RealizeRoadConstructionCellsReference(first, second, road, 3);
    const auto wear = RealizeRoadWearCellsReference(first, second, road, 3);
    const auto water = RealizeRoadWaterCellsReference(first, wear.buffers(), 3);
    const auto energy = EvaluateRoadFieldEnergyReference(construction, water, 2);
    require(construction.source.coordinates.data() == water.coordinates.data(), "material coordinates diverged");
    require(construction.vector_bytes() == 120 && !construction.truncated, "construction bound changed");
    require(construction.aggregate_fraction[0] < construction.aggregate_fraction[1] &&
        construction.aggregate_fraction[1] < construction.aggregate_fraction[2], "layer profiles changed");
    require(energy.sample_count == 2 && energy.truncated && energy.violations == 0 &&
        energy.minimum_energy >= 0 && energy.maximum_energy <= 1, "energy contract changed");
    const auto empty = EvaluateRoadFieldEnergyReference(construction, water, 0);
    require(empty.sample_count == 0 && empty.minimum_energy == 0 && empty.maximum_energy == 0 &&
        empty.energy_rgb.empty() && empty.truncated, "zero energy budget changed");
    auto unaligned = construction;
    const auto other_coordinates = coordinates;
    unaligned.source.coordinates = other_coordinates;
    rejects([&] { EvaluateRoadFieldEnergyReference(unaligned, water, 65537); },
        "aligned road construction and water working sets are required");
    rejects([&] { EvaluateRoadFieldEnergyReference(construction, water, 65537); },
        "road material sampleBudget must be an integer from 0 to 65536");
    auto malformed = road;
    malformed.positions = std::span(positions).first(1);
    rejects([&] { RealizeRoadConstructionCellsReference(first, second, malformed, 65537); },
        "road coordinate working set is required");
    rejects([&] { RealizeRoadConstructionCellsReference(first, second, road, 65537); },
        "road construction sampleBudget must be an integer from 0 to 65536");
    require(energy.energy_rgb == EvaluateRoadFieldEnergyReference(construction, water, 2).energy_rgb,
        "rejection changed existing energy output");
    std::cout << "native road field energy: aligned=true passive=true construction_bytes=120\n";
}
