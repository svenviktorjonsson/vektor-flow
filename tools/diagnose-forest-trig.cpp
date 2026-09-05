// Diagnostic only: no alternative generator or acceptance-gate normalization.
#include "native/material/vf_forest_tree_material_pipeline.hpp"

#include <bit>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <vector>

int main() {
    const vf::material::ForestPopulationDefinition definition{
        {0x6a09e667f3bcc909ull, 0xbb67ae8584caa73bull},
        31, 5, 1000000000ull, 1000000000ull, 64.0, 0.0,
    };
    std::vector<vf::material::ForestPatchDemand> demands;
    for (std::uint64_t patch = 0; patch < 16; ++patch) {
        demands.push_back({2200 + patch,
            {static_cast<std::int64_t>(patch % 4),
             static_cast<std::int64_t>(patch / 4)}, 32});
    }
    const auto forest = vf::material::RealizeForestPopulationReference(
        definition, demands, 512);
    std::cout << "index angle_f32 cos_f32 sin_f32 cos_f64_to_f32 sin_f64_to_f32\n";
    for (std::size_t index = 0; index < forest.trees.size(); ++index) {
        const float angle = forest.trees[index].orientation;
        const float cosine = std::cos(angle);
        const float sine = std::sin(angle);
        const float double_cosine = static_cast<float>(std::cos(static_cast<double>(angle)));
        const float double_sine = static_cast<float>(std::sin(static_cast<double>(angle)));
        std::cout << std::dec << index << ' ' << std::hex
            << std::bit_cast<std::uint32_t>(angle) << ' '
            << std::bit_cast<std::uint32_t>(cosine) << ' '
            << std::bit_cast<std::uint32_t>(sine) << ' '
            << std::bit_cast<std::uint32_t>(double_cosine) << ' '
            << std::bit_cast<std::uint32_t>(double_sine) << '\n';
    }
}
