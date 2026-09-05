#include "native/material/vf_road_lod_transition_energy_path.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

using Key = vf::material::RoadProjectedPacketKey;
using KeyedMaterial = vkf::material::RoadLodKeyedMaterial;

std::size_t cell_offset(
    const vkf::material::RoadLodTransitionEnergy& frame,
    std::uint64_t cell_id
) {
    const auto found = std::find(
        frame.cell_ids.begin(),
        frame.cell_ids.end(),
        cell_id
    );
    if (found == frame.cell_ids.end()) {
        throw std::runtime_error("transition cell is absent");
    }
    return static_cast<std::size_t>(found - frame.cell_ids.begin()) * 15;
}

}  // namespace

int main() {
    const std::vector<Key> previous{{10, 4}, {20, 2}, {70, 1}};
    const std::vector<Key> current{{20, 3}, {60, 5}, {70, 1}};
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
    std::vector<KeyedMaterial> materials{
        {{70, 1}, dry},
        {{20, 3}, wet},
        {{10, 4}, dry},
        {{60, 5}, wet},
        {{20, 2}, dry},
    };
    const std::vector<double> progress{0.0, 0.25, 0.5, 0.75, 1.0};

    const auto forward =
        vkf::material::AuditRoadLodTransitionEnergyPathReference(
            previous,
            current,
            materials,
            progress,
            5
        );
    require(forward.frames.size() == 5, "energy path frame count changed");
    require(
        forward.material_evaluations ==
            std::vector<std::size_t>({3, 5, 5, 5, 3}),
        "energy path material work changed"
    );
    require(forward.peak_material_evaluations == 5,
            "energy path peak work changed");
    require(forward.violations == 0, "energy path escaped passivity");
    require(forward.minimum_energy >= 0.0f, "energy path became negative");
    require(forward.maximum_energy <= 1.0f, "energy path exceeded one");

    const auto dry_energy = vkf::material::EvaluateRoadMaterialWhiteFurnace(
        {dry},
        1
    );
    const auto wet_energy = vkf::material::EvaluateRoadMaterialWhiteFurnace(
        {wet},
        1
    );
    for (std::size_t frame = 0; frame < progress.size(); ++frame) {
        const float new_coverage = static_cast<float>(progress[frame]);
        const float old_coverage = 1.0f - new_coverage;
        const std::size_t output = cell_offset(forward.frames[frame], 20);
        for (std::size_t value = 0; value < 15; ++value) {
            const float expected =
                dry_energy.energy_rgb[value] * old_coverage +
                wet_energy.energy_rgb[value] * new_coverage;
            require(
                forward.frames[frame].energy_rgb[output + value] == expected,
                "LOD energy path did not interpolate exactly"
            );
        }
    }

    std::reverse(materials.begin(), materials.end());
    const auto reversed =
        vkf::material::AuditRoadLodTransitionEnergyPathReference(
            previous,
            current,
            materials,
            progress,
            5
        );
    for (std::size_t frame = 0; frame < forward.frames.size(); ++frame) {
        require(
            reversed.frames[frame].cell_ids == forward.frames[frame].cell_ids,
            "material order changed energy path cells"
        );
        require(
            reversed.frames[frame].energy_rgb ==
                forward.frames[frame].energy_rgb,
            "material order changed energy path values"
        );
    }

    try {
        static_cast<void>(
            vkf::material::AuditRoadLodTransitionEnergyPathReference(
                previous,
                current,
                materials,
                progress,
                4
            )
        );
        throw std::runtime_error("unbounded energy path work accepted");
    } catch (const std::range_error&) {
    }

    std::cout << "private road LOD transition energy path passed\n";
    return 0;
}
