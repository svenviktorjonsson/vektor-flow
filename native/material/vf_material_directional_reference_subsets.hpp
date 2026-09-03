#pragma once

#include "native/material/vf_material_directional_reference_fit.hpp"

#include <array>

namespace vf::material {

inline constexpr std::array<double, 3> kIndexProbeWavelengthsUm{
    0.45,
    0.55,
    0.65,
};

inline constexpr std::array<MaterialOpticalEvidence, 4>
kMaterialOpticalEvidenceV1{{
    {
        MaterialOpticalFamily::stone,
        OpticalEvidenceClass::measured,
        "calcite-ghosh-1999-visible-index-v1",
        "ordinary and extraordinary refractive index",
        "https://doi.org/10.1016/S0030-4018(99)00091-7",
        "refractiveindex.info database v2025-02-23",
        "CC0-1.0",
        "https://github.com/polyanskiy/"
        "refractiveindex.info-database/blob/v2025-02-23/LICENSE",
        "calcite crystal, room temperature, 0.204-2.172 um",
        "source supplies dispersion equations but no scalar accuracy; "
        "VKF reports scalar-collapse residual separately",
        "calcite crystal is a stone constituent, not a universal rough "
        "stone-surface IOR or BRDF",
    },
    {
        MaterialOpticalFamily::road,
        OpticalEvidenceClass::fitted_from_measurements,
        "luis-worn-asphalt-brdf-v1",
        "directional BRDF albedo and energy-normalized Oren-Nayar fit",
        "https://doi.org/10.25835/aq5cdmx7",
        "1.0, updated 2026-07-29",
        "CC-BY-4.0",
        "https://creativecommons.org/licenses/by/4.0/",
        "worn demolition asphalt; 1264 gonioreflectometer directions; "
        "400-1030 nm; AM1.5G weighting",
        "dataset supplies weighted normalized RMSE for each fitted model",
        "one weathered sample is not a road-population distribution; the "
        "Oren-Nayar parameter is not a microfacet specular roughness",
    },
    {
        MaterialOpticalFamily::wood,
        OpticalEvidenceClass::fitted_from_measurements,
        "cellulose-sultanova-2009-visible-index-v1",
        "cellulose refractive index",
        "https://doi.org/10.12693/APhysPolA.116.585",
        "refractiveindex.info database v2025-02-23",
        "CC0-1.0",
        "https://github.com/polyanskiy/"
        "refractiveindex.info-database/blob/v2025-02-23/LICENSE",
        "cellulose optical polymer, 293 K, 0.4368-1.052 um",
        "database records a Sellmeier fit of experimental data but no "
        "measurement uncertainty; VKF reports collapse residual",
        "cellulose is a wood constituent, not bulk anatomical wood, bark, "
        "cut-plane anisotropy, moisture, or a directional wood BRDF",
    },
    {
        MaterialOpticalFamily::vegetation,
        OpticalEvidenceClass::fitted_from_measurements,
        "prospect-pro-v2-leaf-visible-index-v1",
        "leaf interior refractive index",
        "https://doi.org/10.21105/joss.06027",
        "prospect commit 0df0f4fa6dab1ca659e3c72b52800bf470503733",
        "MIT",
        "https://github.com/jbferet/prospect/blob/"
        "0df0f4fa6dab1ca659e3c72b52800bf470503733/LICENSE",
        "PROSPECT-PRO v2 optical constants fitted from experimental leaf "
        "reflectance and transmittance; 400-2500 nm",
        "source publishes no per-wavelength scalar uncertainty for nrefrac; "
        "VKF reports visible-channel collapse residual",
        "leaf-interior optical index is not a leaf-surface roughness, "
        "directional canopy BRDF, or measured species distribution",
    },
}};

inline constexpr std::array<Sellmeier2Reference, 2>
kCalciteIndexReferencesV1{{
    {
        {
            "calcite-ghosh-ordinary-v2025-02-23",
            "https://raw.githubusercontent.com/polyanskiy/"
            "refractiveindex.info-database/v2025-02-23/database/data/"
            "main/CaCO3/nk/Ghosh-o.yml",
            "B7265EE3103905101E42F3CADC19F2A1BEEB06C71173891BD54514AE79C459EC",
        },
        MaterialOpticalFamily::stone,
        "ordinary",
        293.15,
        0.204,
        2.172,
        0.73358749,
        {{{0.96464345, 0.0194325203}, {1.82831454, 120.0}}},
    },
    {
        {
            "calcite-ghosh-extraordinary-v2025-02-23",
            "https://raw.githubusercontent.com/polyanskiy/"
            "refractiveindex.info-database/v2025-02-23/database/data/"
            "main/CaCO3/nk/Ghosh-e.yml",
            "30A16E2BCE992F439A145B008645D35CDA861984F87E58E725124620D0133702",
        },
        MaterialOpticalFamily::stone,
        "extraordinary",
        293.15,
        0.204,
        2.172,
        0.35859695,
        {{{0.82427830, 0.0106689543}, {0.14429128, 120.0}}},
    },
}};

inline constexpr std::array<Sellmeier2Reference, 1>
kCelluloseIndexReferencesV1{{
    {
        {
            "cellulose-sultanova-v2025-02-23",
            "https://raw.githubusercontent.com/polyanskiy/"
            "refractiveindex.info-database/v2025-02-23/database/data/"
            "organic/(C6H10O5)n%20-%20cellulose/nk/Sultanova.yml",
            "2100346CBA95AA70A21712C1F86F17B84501F60B0D92A34013CB0F70178C391E",
        },
        MaterialOpticalFamily::wood,
        "isotropic",
        293.0,
        0.4368,
        1.052,
        0.0,
        {{{1.124, 0.011087}, {0.0, 0.0}}},
    },
}};

inline constexpr ReferenceArtifactIdentity kProspectLeafArtifactV1{
    "prospect-pro-v2-optical-constants",
    "https://raw.githubusercontent.com/jbferet/prospect/"
    "0df0f4fa6dab1ca659e3c72b52800bf470503733/"
    "data-raw/dataSpec_PRO_v2.txt",
    "0D60AB4D67A9FC96424C6098B88C4F22CDF36FA16BB694FF434AE064B87D8419",
};

inline constexpr std::array<SpectralIndexObservation, 3>
kProspectLeafIndexV1{{
    {kProspectLeafArtifactV1.stable_id, 0.45, 1.4955},
    {kProspectLeafArtifactV1.stable_id, 0.55, 1.4739},
    {kProspectLeafArtifactV1.stable_id, 0.65, 1.4473},
}};

inline constexpr RoadDirectionalReference
kWornAsphaltDirectionalReferenceV1{
    {
        "luis-brdf-reflection-model-parameters-v1",
        "https://data.uni-hannover.de/dataset/"
        "aa433cef-c6e3-470a-9e28-a7181fd94f42/resource/"
        "e88bba42-4447-4f2f-a528-03a65b32c41c/download/"
        "reflection_model_parameters.csv",
        "BE6C0BA5E8647980F8B41435729A7A4ACA39C2557B63B8B1311BD8091A29F321",
    },
    {
        "luis-brdf-materials-v1",
        "https://data.uni-hannover.de/dataset/"
        "aa433cef-c6e3-470a-9e28-a7181fd94f42/resource/"
        "57276ffe-eddf-4dd2-a89e-1bb9ae6cd6da/download/materials.csv",
        "5D38C02D0F955C1E0C0DF2BBE7F33144D48D30192046E691E5398024597DAAE9",
    },
    "asphalt",
    "Worn asphalt from demolition waste with weathered surface preserved",
    1264,
    0.1063,
    0.2389,
    0.0298,
};

}  // namespace vf::material
