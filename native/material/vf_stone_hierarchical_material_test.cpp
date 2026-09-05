#include "native/material/vf_stone_hierarchical_material.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << message << '\n';
        throw std::runtime_error(message);
    }
}

}  // namespace

int main() {
    const vf::material::StonePopulationDefinition definition{
        {0x3c6ef372fe94f82bull, 0xa54ff53a5f1d36f1ull},
        42,
        1000000000ull,
    };
    const auto population =
        vf::material::RealizeStonePopulationReference(
            definition,
            {{17, {10.0, 10.0}}},
            1,
            6,
            8
        );
    const auto& member = population.members.front();
    const vf::material::StoneViewCamera camera{
        {8.0, 0.0, 0.0},
        {0.0, 0.0, 0.0},
        {0.0, 0.0, 1.0},
        std::acos(-1.0) / 3.0,
        1080.0,
    };
    const auto refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            member.coarse,
            nullptr,
            camera,
            0.0,
            2,
            8,
            12
        );
    using Kind = vf::material::StoneMaterialElementKind;
    std::vector<vf::material::StoneMaterialDemand> demands{
        {Kind::Face, 0},
        {Kind::Vertex, 7},
        {Kind::Vertex, 0},
    };
    const auto material =
        vf::material::RealizeStoneHierarchicalMaterialReference(
            member,
            *refined.geometry,
            demands,
            3
        );
    require(material.potential_elements == 20 &&
                material.samples.size() == 3,
            "stone material realized undemanded geometry");
    require(material.samples[0].kind == Kind::Vertex &&
                material.samples[0].element == 0 &&
                material.samples[1].kind == Kind::Vertex &&
                material.samples[1].element == 7 &&
                material.samples[2].kind == Kind::Face &&
                material.samples[2].element == 0,
            "stone material output order changed");
    for (const auto& sample : material.samples) {
        require(sample.wavelengths_nm ==
                    std::array<float, 3>({450.0f, 550.0f, 650.0f}),
                "stone spectral wavelengths changed");
        for (std::size_t channel = 0; channel < 3; ++channel) {
            require(sample.base_color[channel] >= 0.0f &&
                        sample.base_color[channel] <= 1.0f &&
                        sample.spectral_reflectance[channel] >= 0.0f &&
                        sample.spectral_reflectance[channel] <= 1.0f,
                    "stone reflectance escaped passive bounds");
        }
        require(sample.spectral_reflectance[0] ==
                    sample.base_color[2] &&
                    sample.spectral_reflectance[1] ==
                    sample.base_color[1] &&
                    sample.spectral_reflectance[2] ==
                    sample.base_color[0],
                "stone spectral and RGB reflectance diverged");
        require(sample.roughness >= 0.45f &&
                    sample.roughness <= 0.95f &&
                    sample.reflectivity >= 0.0f &&
                    sample.reflectivity <= 1.0f &&
                    sample.local_variation >= -1.0f &&
                    sample.local_variation <= 1.0f,
                "stone material property escaped hierarchy bounds");
    }
    require(material.energy.violations == 0 &&
                material.energy.minimum >= 0.0f &&
                material.energy.maximum <= 1.0f &&
                material.energy.values.size() == 45,
            "stone material escaped white-furnace bounds");
    const auto& first = material.samples.front();
    const float first_fresnel = first.reflectivity;
    const float expected_energy = first_fresnel +
        (1.0f - first_fresnel) * first.base_color[0];
    require(material.energy.values.front() == expected_energy,
            "stone energy diverged from shared Schlick oracle");

    std::reverse(demands.begin(), demands.end());
    const auto reversed =
        vf::material::RealizeStoneHierarchicalMaterialReference(
            member,
            *refined.geometry,
            demands,
            3
        );
    const auto repeated =
        vf::material::RealizeStoneHierarchicalMaterialReference(
            member,
            *refined.geometry,
            demands,
            3
        );
    require(reversed == material && repeated == material,
            "stone material depended on demand traversal");

    auto changed_definition = definition;
    changed_definition.seed[0] ^= 1ull;
    const auto changed_population =
        vf::material::RealizeStonePopulationReference(
            changed_definition,
            {{17, {10.0, 10.0}}},
            1,
            6,
            8
        );
    const auto changed_refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            changed_population.members.front().coarse,
            nullptr,
            camera,
            0.0,
            2,
            8,
            12
        );
    const auto changed =
        vf::material::RealizeStoneHierarchicalMaterialReference(
            changed_population.members.front(),
            *changed_refined.geometry,
            demands,
            3
        );
    require(changed != material,
            "stone material ignored population seed identity");

    bool rejected = false;
    try {
        static_cast<void>(
            vf::material::RealizeStoneHierarchicalMaterialReference(
                member,
                *refined.geometry,
                demands,
                2
            )
        );
    } catch (const std::range_error&) {
        rejected = true;
    }
    require(rejected,
            "stone material demand escaped sample budget");

    std::cout << "hierarchical stone material: potential="
              << material.potential_elements
              << " sampled=" << material.samples.size()
              << " energy[min/max]=" << material.energy.minimum
              << '/' << material.energy.maximum << '\n';
    return 0;
}
