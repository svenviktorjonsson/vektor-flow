#include "native/material/vf_road_material_energy.hpp"
#include <bit>
#include <cstdint>
#include <iostream>
int main() {
    std::uint32_t state = 0x12345678u;
    const auto unit = [&]() {
        state = state * 1664525u + 1013904223u;
        return static_cast<float>(state >> 8) / 16777216.0f;
    };
    std::vector<vkf::material::RoadMaterialSample> samples;
    for (std::size_t i = 0; i < 4096; ++i) {
        const float aggregate = unit(), binder = unit(), water = unit();
        const float red = unit(), green = unit(), blue = unit();
        samples.push_back({aggregate, binder, water, {red, green, blue}});
    }
    const auto result = vkf::material::EvaluateRoadMaterialWhiteFurnace(samples, samples.size());
    std::cout << std::bit_cast<std::uint32_t>(result.minimum_energy) << ' '
        << std::bit_cast<std::uint32_t>(result.maximum_energy) << ' ' << result.violations << '\n';
    for (const float value : result.fresnel_f0) std::cout << std::bit_cast<std::uint32_t>(value) << '\n';
    for (const float value : result.energy_rgb) std::cout << std::bit_cast<std::uint32_t>(value) << '\n';
}
