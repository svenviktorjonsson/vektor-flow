#include "native/material/vf_material_researched_preset.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void require_near(
    double actual,
    double expected,
    double tolerance,
    const char* message
) {
    require(std::abs(actual - expected) <= tolerance, message);
}

}  // namespace

int main() {
    using namespace vf::material;

    const auto presets = BuildResearchedMaterialPresetsV1();
    require(presets.size() == 4,
            "researched preset family coverage changed");
    for (std::size_t index = 0; index < presets.size(); ++index) {
        require(static_cast<std::size_t>(presets[index].family) == index,
                "researched preset order is not canonical");
        ValidateResearchedMaterialPreset(presets[index]);
        require(presets[index] == BuildResearchedMaterialPresetV1(
                    presets[index].family
                ),
                "researched preset generation is not deterministic");
        require(presets[index].spectral.provenance.kind ==
                    EvidenceKind::Measured &&
                    !presets[index].spectral.provenance.license.empty() &&
                    presets[index].spectral.fit.observation_count == 15,
                "spectral provenance did not survive preset generation");
    }

    const auto& stone = presets[0];
    require(stone.optical_index.has_value() &&
                stone.optical_index->scope ==
                    OpticalIndexScope::constituent &&
                !stone.directional_diffuse.has_value(),
            "stone constituent index was mislabeled as a surface fit");
    require_near(stone.optical_index->fit.index_of_refraction,
                 1.5755715943261892, 1.0e-12,
                 "stone optical fit was not consumed");
    require_near(stone.spectral.fit.spectral_reflectance[0],
                 0.1576, 1.0e-12,
                 "stone spectral fit was not consumed");

    const auto& road = presets[1];
    require(!road.optical_index.has_value() &&
                road.directional_diffuse.has_value() &&
                road.directional_diffuse->semantic ==
                    DirectionalRoughnessSemantic::oren_nayar_diffuse,
            "road Oren-Nayar roughness crossed into optical/GGX state");
    require_near(road.directional_diffuse->oren_nayar_roughness,
                 0.2389, 1.0e-12,
                 "road directional roughness was not consumed");
    require_near(road.directional_diffuse->weighted_normalized_rmse,
                 0.0298, 1.0e-12,
                 "road directional uncertainty was not retained");
    require_near(road.spectral.fit.spectral_reflectance[1],
                 0.0855949224, 1.0e-12,
                 "road spectral fit was not consumed");

    const auto& wood = presets[2];
    require(wood.optical_index.has_value() &&
                wood.optical_index->scope ==
                    OpticalIndexScope::constituent,
            "cellulose index was mislabeled as whole wood");
    require_near(wood.optical_index->fit.index_of_refraction,
                 1.4731017296819584, 1.0e-12,
                 "wood constituent fit was not consumed");

    const auto& leaf = presets[3];
    require(leaf.optical_index.has_value() &&
                leaf.optical_index->scope ==
                    OpticalIndexScope::leaf_interior_model,
            "PROSPECT index was mislabeled as a leaf surface measurement");
    require_near(leaf.optical_index->fit.index_of_refraction,
                 1.4722333333333335, 1.0e-12,
                 "leaf optical fit was not consumed");
    require_near(leaf.spectral.fit.spectral_reflectance[2],
                 0.04004, 1.0e-12,
                 "leaf spectral fit was not consumed");

    std::array<MaterialOpticalFamily, 4> reverse_families{
        MaterialOpticalFamily::vegetation,
        MaterialOpticalFamily::wood,
        MaterialOpticalFamily::road,
        MaterialOpticalFamily::stone,
    };
    std::array<ResearchedMaterialPreset, 4> reverse_presets;
    std::transform(
        reverse_families.begin(),
        reverse_families.end(),
        reverse_presets.begin(),
        [](const auto family) {
            return BuildResearchedMaterialPresetV1(family);
        }
    );
    std::reverse(reverse_presets.begin(), reverse_presets.end());
    require(reverse_presets == presets,
            "preset output depended on requested family traversal");

    auto invalid_uncertainty = road;
    invalid_uncertainty.directional_diffuse->weighted_normalized_rmse = -1.0;
    try {
        ValidateResearchedMaterialPreset(invalid_uncertainty);
        throw std::runtime_error(
            "invalid directional uncertainty was accepted"
        );
    } catch (const std::invalid_argument&) {
    }

    auto invalid = road;
    invalid.optical_index = stone.optical_index;
    try {
        ValidateResearchedMaterialPreset(invalid);
    } catch (const std::invalid_argument&) {
        std::cout << "researched material presets: families=4 "
                     "spectral_observations=60 optical_observations=12\n";
        return 0;
    }
    throw std::runtime_error("road accepted a constituent index as its own");
}
