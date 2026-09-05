#include "native/material/vf_road_material_energy.hpp"

#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require_equal(float actual, float expected) {
    if (actual != expected) {
        throw std::runtime_error("native road energy diverged from JS oracle");
    }
}

}  // namespace

int main() {
    const std::vector<vkf::material::RoadMaterialSample> samples{
        {0.55f, 0.35f, 0.70f, {0.05f, 0.04f, 0.03f}},
        {0.70f, 0.20f, 0.00f, {0.10f, 0.10f, 0.10f}},
    };
    const auto energy = vkf::material::EvaluateRoadMaterialWhiteFurnace(
        samples, 2);

    if (energy.sample_count != 2 || energy.violations != 0 ||
        energy.fresnel_f0.size() != 2 || energy.energy_rgb.size() != 30) {
        throw std::runtime_error("native road energy shape mismatch");
    }
    require_equal(energy.fresnel_f0[0], 0.026652120053768158f);
    require_equal(energy.fresnel_f0[1], 0.042012088000774384f);
    const std::array<float, 30> expected{
        0.07531951367855072f, 0.06558603048324585f,
        0.055852554738521576f, 0.07622252404689789f,
        0.06649854779243469f, 0.056774575263261795f,
        0.10421578586101532f, 0.09478647261857986f,
        0.085357166826725f, 0.29475054144859314f,
        0.287326842546463f, 0.2799031734466553f,
        1.0f, 1.0f, 1.0f,
        0.13781088590621948f, 0.13781088590621948f,
        0.13781088590621948f, 0.13865286111831665f,
        0.13865286111831665f, 0.13865286111831665f,
        0.16475430130958557f, 0.16475430130958557f,
        0.16475430130958557f, 0.34241241216659546f,
        0.34241241216659546f, 0.34241241216659546f,
        1.0f, 1.0f, 1.0f,
    };
    for (std::size_t index = 0; index < expected.size(); ++index) {
        require_equal(energy.energy_rgb[index], expected[index]);
    }
    if (energy.minimum_energy < 0.0f || energy.maximum_energy > 1.0f) {
        throw std::runtime_error("native road energy escaped passive bounds");
    }

    std::cout << "native road material energy parity passed\n";
    return 0;
}
