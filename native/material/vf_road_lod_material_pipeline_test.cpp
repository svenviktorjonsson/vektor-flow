#include "native/material/vf_road_lod_material_pipeline.hpp"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void require_equal(
    const vkf::material::RoadLodMaterialBatch& first,
    const vkf::material::RoadLodMaterialBatch& second
) {
    require(first.cell_ids == second.cell_ids, "LOD material cells changed");
    require(
        first.energy.fresnel_f0 == second.energy.fresnel_f0,
        "LOD material energy changed"
    );
    require(
        first.energy.energy_rgb == second.energy.energy_rgb,
        "LOD material probes changed"
    );
}

}  // namespace

int main() {
    std::vector<vkf::material::RoadLodMaterialCandidate> candidates{
        {{40, 100.0, 0.10, 0.05, true},
         {0.50f, 0.40f, 0.0f, {0.12f, 0.11f, 0.10f}}},
        {{10, 10.0, 0.20, 0.10, true},
         {0.55f, 0.35f, 0.7f, {0.05f, 0.04f, 0.03f}}},
        {{20, 20.0, 0.08, 0.16, true},
         {0.70f, 0.20f, 0.0f, {0.10f, 0.10f, 0.10f}}},
        {{30, 5.0, 0.01, 0.01, true},
         {0.60f, 0.30f, 0.2f, {0.08f, 0.07f, 0.06f}}},
        {{50, 1.0, 1.00, 1.00, false},
         {0.40f, 0.50f, 0.4f, {0.04f, 0.03f, 0.02f}}},
        {{60, 10.0, 0.08, 0.04, true},
         {0.65f, 0.25f, 0.1f, {0.09f, 0.08f, 0.07f}}},
    };
    const vf::material::RoadProjectedLodPolicy policy{1000.0, 2.0, 2, 8};
    const auto forward =
        vkf::material::EvaluateRoadLodRefinementMaterialsReference(
            candidates,
            policy
        );
    std::reverse(candidates.begin(), candidates.end());
    const auto reversed =
        vkf::material::EvaluateRoadLodRefinementMaterialsReference(
            candidates,
            policy
        );

    require_equal(reversed, forward);
    require(forward.candidate_count == 6, "candidate count changed");
    require(forward.material_evaluations == 2, "material work exceeded LOD");
    require(forward.cell_ids == std::vector<std::uint64_t>({10, 20}),
            "wrong LOD material cells");
    require(forward.energy.sample_count == 2, "wrong energy sample count");
    require(forward.energy.violations == 0, "road refinement lost energy");
    require(
        forward.energy.fresnel_f0 == std::vector<float>({
            0.026652120053768158f,
            0.042012088000774384f,
        }),
        "road refinement F0 changed"
    );

    std::cout << "private road LOD material pipeline passed\n";
    return 0;
}
