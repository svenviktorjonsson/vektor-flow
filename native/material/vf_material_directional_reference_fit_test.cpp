#include "native/material/vf_material_directional_reference_fit.hpp"
#include "native/material/vf_material_directional_reference_subsets.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

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

    require(kMaterialOpticalEvidenceV1.size() == 4,
            "optical evidence does not cover all material families");
    for (std::size_t index = 0;
         index < kMaterialOpticalEvidenceV1.size(); ++index) {
        require(
            static_cast<std::size_t>(
                kMaterialOpticalEvidenceV1[index].family
            ) == index,
            "optical family evidence order changed"
        );
        ValidateOpticalEvidence(kMaterialOpticalEvidenceV1[index]);
    }

    const auto calcite_observations = EvaluateSellmeierReferences(
        kCalciteIndexReferencesV1,
        kIndexProbeWavelengthsUm
    );
    require(calcite_observations.size() == 6,
            "calcite ordinary/extraordinary coverage changed");
    const std::array<double, 6> expected_calcite{
        1.6725838866584175,
        1.6612745038471788,
        1.6547743019352017,
        1.492807672700906,
        1.4874962565253183,
        1.484492944290112,
    };
    for (std::size_t index = 0; index < expected_calcite.size(); ++index) {
        require_near(
            calcite_observations[index].index_of_refraction,
            expected_calcite[index],
            1.0e-12,
            "calcite Sellmeier evaluation changed"
        );
    }
    const auto calcite_fit = FitScalarIndex(calcite_observations);
    require_near(calcite_fit.index_of_refraction,
                 1.5755715943261892, 1.0e-12,
                 "calcite scalar index fit changed");
    require_near(calcite_fit.rmse,
                 0.08749466155185615, 1.0e-12,
                 "calcite scalar fit RMSE changed");
    require_near(calcite_fit.fresnel_f0,
                 0.04994033503268472, 1.0e-12,
                 "calcite scalar Fresnel fit changed");
    require(calcite_fit.observation_count == 6 &&
                calcite_fit.normalized_rmse > 0.05,
            "calcite birefringence loss is no longer visible");

    auto reversed = calcite_observations;
    std::reverse(reversed.begin(), reversed.end());
    require(FitScalarIndex(reversed) == calcite_fit,
            "scalar index fit depended on observation order");

    const auto cellulose_observations = EvaluateSellmeierReferences(
        kCelluloseIndexReferencesV1,
        kIndexProbeWavelengthsUm
    );
    const auto cellulose_fit = FitScalarIndex(cellulose_observations);
    require_near(cellulose_fit.index_of_refraction,
                 1.4731017296819584, 1.0e-12,
                 "cellulose scalar index fit changed");
    require_near(cellulose_fit.rmse,
                 0.004885589823413606, 1.0e-12,
                 "cellulose scalar fit RMSE changed");
    require_near(cellulose_fit.fresnel_f0,
                 0.036595282941656745, 1.0e-12,
                 "cellulose scalar Fresnel fit changed");

    const auto leaf_fit = FitScalarIndex(
        std::vector<SpectralIndexObservation>(
            kProspectLeafIndexV1.begin(),
            kProspectLeafIndexV1.end()
        )
    );
    require_near(leaf_fit.index_of_refraction,
                 1.4722333333333335, 1.0e-12,
                 "leaf scalar index fit changed");
    require_near(leaf_fit.rmse,
                 0.019712827183221482, 1.0e-12,
                 "leaf scalar fit RMSE changed");
    require_near(leaf_fit.fresnel_f0,
                 0.036486681265301885, 1.0e-12,
                 "leaf scalar Fresnel fit changed");
    ValidateReferenceArtifact(kProspectLeafArtifactV1);

    const auto asphalt_fit = FitRoadDirectionalReference(
        kWornAsphaltDirectionalReferenceV1
    );
    require_near(asphalt_fit.albedo, 0.1063, 1.0e-12,
                 "measured asphalt albedo changed");
    require_near(asphalt_fit.oren_nayar_roughness, 0.2389, 1.0e-12,
                 "measured asphalt Oren-Nayar roughness changed");
    require_near(asphalt_fit.weighted_normalized_rmse, 0.0298,
                 1.0e-12, "measured asphalt fit error changed");
    require(asphalt_fit.weighted_normalized_rmse < 0.05,
            "measured asphalt directional fit quality regressed");

    auto invalid_road = kWornAsphaltDirectionalReferenceV1;
    invalid_road.energy_normalized_oren_nayar_roughness = 1.1;
    try {
        static_cast<void>(FitRoadDirectionalReference(invalid_road));
        throw std::runtime_error(
            "invalid directional roughness was accepted"
        );
    } catch (const std::invalid_argument&) {
    }

    auto invalid_evidence = kMaterialOpticalEvidenceV1.front();
    invalid_evidence.license = {};
    try {
        ValidateOpticalEvidence(invalid_evidence);
        throw std::runtime_error(
            "unlicensed optical evidence was accepted"
        );
    } catch (const std::invalid_argument&) {
    }

    auto invalid = kProspectLeafIndexV1;
    invalid.front().index_of_refraction = -1.0;
    try {
        static_cast<void>(FitScalarIndex(
            std::vector<SpectralIndexObservation>(
                invalid.begin(),
                invalid.end()
            )
        ));
    } catch (const std::invalid_argument&) {
        std::cout << "directional optical references: families=4 "
                     "index_observations=12 brdf_directions=1264\n";
        return 0;
    }
    throw std::runtime_error("invalid optical-index observation was accepted");
}
