#include "native/material/vf_road_lod_transition_energy.hpp"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    using Key = vf::material::RoadProjectedPacketKey;
    const std::vector<Key> previous{{10, 4}, {20, 2}, {70, 1}};
    const std::vector<Key> current{{20, 3}, {60, 5}, {70, 1}};
    const auto coverage =
        vf::material::PlanRoadLodCoverageTransitionReference(
            previous,
            current,
            0.25,
            5
        );
    const vkf::material::RoadMaterialSample dry{
        0.70f,
        0.20f,
        0.00f,
        {0.10f, 0.10f, 0.10f},
    };
    const vkf::material::RoadMaterialSample wet{
        0.55f,
        0.35f,
        0.70f,
        {0.05f, 0.04f, 0.03f},
    };
    std::vector<vkf::material::RoadLodCoveredMaterial> materials;
    for (const auto& entry : coverage) {
        materials.push_back({
            entry,
            entry.key == Key{20, 3} || entry.key == Key{60, 5}
                ? wet
                : dry,
        });
    }
    const auto forward =
        vkf::material::EvaluateRoadLodTransitionEnergyReference(materials, 5);
    std::reverse(materials.begin(), materials.end());
    const auto reversed =
        vkf::material::EvaluateRoadLodTransitionEnergyReference(materials, 5);

    require(forward.cell_ids == reversed.cell_ids, "cell order changed energy");
    require(forward.energy_rgb == reversed.energy_rgb,
            "material order changed energy");
    require(forward.cell_ids == std::vector<std::uint64_t>({10, 20, 60, 70}),
            "transition energy cell ids changed");
    require(forward.material_evaluations == 5, "transition work changed");
    require(forward.energy_rgb.size() == 60, "transition output shape changed");
    require(forward.violations == 0, "transition escaped passive energy");
    require(
        forward.minimum_energy >= 0.0f,
        "transition energy became negative");
    require(forward.maximum_energy <= 1.0f, "transition energy exceeded one");

    const auto dry_energy = vkf::material::EvaluateRoadMaterialWhiteFurnace(
        {dry},
        1
    );
    const auto wet_energy = vkf::material::EvaluateRoadMaterialWhiteFurnace(
        {wet},
        1
    );
    for (std::size_t index = 0; index < 15; ++index) {
        const float expected = dry_energy.energy_rgb[index] * 0.75f
            + wet_energy.energy_rgb[index] * 0.25f;
        require(
            forward.energy_rgb[15 + index] == expected,
            "changed LOD double-counted material energy"
        );
    }

    try {
        static_cast<void>(
            vkf::material::EvaluateRoadLodTransitionEnergyReference(
                materials,
                4
            )
        );
        throw std::runtime_error("unbounded transition material work accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private road LOD transition energy passed\n";
    return 0;
}
