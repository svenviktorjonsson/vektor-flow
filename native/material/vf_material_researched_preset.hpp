#pragma once

#include "native/material/vf_material_directional_reference_subsets.hpp"
#include "native/material/vf_material_reference_manifest.hpp"
#include "native/material/vf_material_reference_subsets.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace vf::material {

enum class OpticalIndexScope {
    constituent,
    leaf_interior_model,
};

enum class DirectionalRoughnessSemantic {
    oren_nayar_diffuse,
};

struct ResearchedSpectralPreset {
    std::string_view subset_id;
    MaterialReferenceFit fit;
    MaterialProvenance provenance;
};

struct ResearchedOpticalIndexPreset {
    OpticalIndexScope scope;
    ScalarIndexFit fit;
    MaterialOpticalEvidence evidence;
};

struct ResearchedDirectionalDiffusePreset {
    DirectionalRoughnessSemantic semantic;
    double albedo;
    double oren_nayar_roughness;
    double weighted_normalized_rmse;
    MaterialOpticalEvidence evidence;
};

struct ResearchedMaterialPreset {
    MaterialOpticalFamily family;
    std::string_view stable_id;
    ResearchedSpectralPreset spectral;
    std::optional<ResearchedOpticalIndexPreset> optical_index;
    std::optional<ResearchedDirectionalDiffusePreset> directional_diffuse;
};

inline bool SameMaterialProvenance(
    const MaterialProvenance& first,
    const MaterialProvenance& second
) {
    return first.kind == second.kind && first.source == second.source &&
        first.source_version == second.source_version &&
        first.license == second.license &&
        first.license_url == second.license_url &&
        first.units == second.units &&
        first.measurement_conditions == second.measurement_conditions &&
        first.fit_method == second.fit_method &&
        first.uncertainty == second.uncertainty &&
        first.generator_version == second.generator_version &&
        first.authoring_note == second.authoring_note;
}

inline bool SameOpticalEvidence(
    const MaterialOpticalEvidence& first,
    const MaterialOpticalEvidence& second
) {
    return first.family == second.family &&
        first.evidence_class == second.evidence_class &&
        first.stable_id == second.stable_id &&
        first.property == second.property &&
        first.source_url == second.source_url &&
        first.source_version == second.source_version &&
        first.license == second.license &&
        first.license_url == second.license_url &&
        first.conditions == second.conditions &&
        first.uncertainty == second.uncertainty &&
        first.limitation == second.limitation;
}

inline bool operator==(
    const ResearchedSpectralPreset& first,
    const ResearchedSpectralPreset& second
) {
    return first.subset_id == second.subset_id &&
        first.fit == second.fit &&
        SameMaterialProvenance(first.provenance, second.provenance);
}

inline bool operator==(
    const ResearchedOpticalIndexPreset& first,
    const ResearchedOpticalIndexPreset& second
) {
    return first.scope == second.scope && first.fit == second.fit &&
        SameOpticalEvidence(first.evidence, second.evidence);
}

inline bool operator==(
    const ResearchedDirectionalDiffusePreset& first,
    const ResearchedDirectionalDiffusePreset& second
) {
    return first.semantic == second.semantic &&
        first.albedo == second.albedo &&
        first.oren_nayar_roughness == second.oren_nayar_roughness &&
        first.weighted_normalized_rmse ==
            second.weighted_normalized_rmse &&
        SameOpticalEvidence(first.evidence, second.evidence);
}

inline bool operator==(
    const ResearchedMaterialPreset& first,
    const ResearchedMaterialPreset& second
) {
    return first.family == second.family &&
        first.stable_id == second.stable_id &&
        first.spectral == second.spectral &&
        first.optical_index == second.optical_index &&
        first.directional_diffuse == second.directional_diffuse;
}

inline std::size_t MaterialFamilyIndex(MaterialOpticalFamily family) {
    const auto index = static_cast<std::size_t>(family);
    if (index >= 4) {
        throw std::invalid_argument(
            "researched material family is invalid"
        );
    }
    return index;
}

inline MaterialProvenance MakeSpectralFitProvenance(
    const MaterialReferenceSubset& subset,
    const MaterialReferenceDataset& dataset
) {
    return {
        EvidenceKind::Measured,
        subset.source_url,
        subset.stable_id,
        dataset.provenance.license,
        dataset.provenance.license_url,
        "wavelength: nanometre; reflectance: unitless",
        "Official USGS Landsat viewer-derived (USL) spectrum; five "
        "observations nearest each 450, 550, and 650 nm channel",
        "Per-channel least-squares constant fit (arithmetic mean)",
        "Per-channel local RMSE and standard error are retained; they are "
        "fit dispersion, not instrument uncertainty",
        1,
        {},
    };
}

inline ResearchedSpectralPreset BuildSpectralPresetV1(
    std::size_t family_index
) {
    const auto& subset = kMaterialReferenceSubsetsV1[family_index];
    const auto& dataset = kMaterialReferenceManifestV1[family_index];
    return {
        subset.stable_id,
        FitMaterialReferenceSubset(subset),
        MakeSpectralFitProvenance(subset, dataset),
    };
}

inline ResearchedOpticalIndexPreset BuildStoneOpticalPresetV1() {
    return {
        OpticalIndexScope::constituent,
        FitScalarIndex(EvaluateSellmeierReferences(
            kCalciteIndexReferencesV1,
            kIndexProbeWavelengthsUm
        )),
        kMaterialOpticalEvidenceV1[0],
    };
}

inline ResearchedOpticalIndexPreset BuildWoodOpticalPresetV1() {
    return {
        OpticalIndexScope::constituent,
        FitScalarIndex(EvaluateSellmeierReferences(
            kCelluloseIndexReferencesV1,
            kIndexProbeWavelengthsUm
        )),
        kMaterialOpticalEvidenceV1[2],
    };
}

inline ResearchedOpticalIndexPreset BuildLeafOpticalPresetV1() {
    return {
        OpticalIndexScope::leaf_interior_model,
        FitScalarIndex(std::vector<SpectralIndexObservation>(
            kProspectLeafIndexV1.begin(),
            kProspectLeafIndexV1.end()
        )),
        kMaterialOpticalEvidenceV1[3],
    };
}

inline ResearchedDirectionalDiffusePreset
BuildRoadDirectionalPresetV1() {
    const auto fit = FitRoadDirectionalReference(
        kWornAsphaltDirectionalReferenceV1
    );
    return {
        DirectionalRoughnessSemantic::oren_nayar_diffuse,
        fit.albedo,
        fit.oren_nayar_roughness,
        fit.weighted_normalized_rmse,
        kMaterialOpticalEvidenceV1[1],
    };
}

inline ResearchedMaterialPreset BuildResearchedMaterialPresetV1(
    MaterialOpticalFamily family
) {
    const auto index = MaterialFamilyIndex(family);
    constexpr std::array<std::string_view, 4> stable_ids{
        "researched-stone-v1",
        "researched-road-asphalt-v1",
        "researched-wood-v1",
        "researched-leaf-v1",
    };
    ResearchedMaterialPreset preset{
        family,
        stable_ids[index],
        BuildSpectralPresetV1(index),
        std::nullopt,
        std::nullopt,
    };
    if (family == MaterialOpticalFamily::stone) {
        preset.optical_index = BuildStoneOpticalPresetV1();
    } else if (family == MaterialOpticalFamily::road) {
        preset.directional_diffuse = BuildRoadDirectionalPresetV1();
    } else if (family == MaterialOpticalFamily::wood) {
        preset.optical_index = BuildWoodOpticalPresetV1();
    } else if (family == MaterialOpticalFamily::vegetation) {
        preset.optical_index = BuildLeafOpticalPresetV1();
    }
    return preset;
}

inline void ValidateResearchedMaterialPreset(
    const ResearchedMaterialPreset& preset
) {
    const auto family_index = MaterialFamilyIndex(preset.family);
    if (preset.stable_id.empty() || preset.spectral.subset_id.empty() ||
        preset.spectral.fit.observation_count != 15) {
        throw std::invalid_argument(
            "researched spectral preset identity is invalid"
        );
    }
    ValidateMaterialProvenance(preset.spectral.provenance);
    if (preset.spectral.provenance.kind != EvidenceKind::Measured) {
        throw std::invalid_argument(
            "researched spectral preset is not measured"
        );
    }
    for (std::size_t channel = 0; channel < 3; ++channel) {
        const double reflectance =
            preset.spectral.fit.spectral_reflectance[channel];
        const double rmse = preset.spectral.fit.band_rmse[channel];
        const double standard_error =
            preset.spectral.fit.band_standard_error[channel];
        if (!std::isfinite(reflectance) || reflectance < 0.0 ||
            reflectance > 1.0 || !std::isfinite(rmse) || rmse < 0.0 ||
            !std::isfinite(standard_error) || standard_error < 0.0) {
            throw std::invalid_argument(
                "researched spectral fit or uncertainty is invalid"
            );
        }
    }
    if (preset.optical_index.has_value()) {
        ValidateOpticalEvidence(preset.optical_index->evidence);
        if (preset.optical_index->evidence.family != preset.family ||
            !std::isfinite(
                preset.optical_index->fit.index_of_refraction
            ) ||
            preset.optical_index->fit.index_of_refraction <= 0.0 ||
            !std::isfinite(preset.optical_index->fit.rmse) ||
            preset.optical_index->fit.rmse < 0.0) {
            throw std::invalid_argument(
                "researched optical-index fit is invalid"
            );
        }
    }
    if (preset.directional_diffuse.has_value()) {
        ValidateOpticalEvidence(preset.directional_diffuse->evidence);
        if (preset.family != MaterialOpticalFamily::road ||
            preset.directional_diffuse->evidence.family != preset.family ||
            preset.directional_diffuse->semantic !=
                DirectionalRoughnessSemantic::oren_nayar_diffuse ||
            !std::isfinite(preset.directional_diffuse->albedo) ||
            preset.directional_diffuse->albedo < 0.0 ||
            preset.directional_diffuse->albedo > 1.0 ||
            !std::isfinite(
                preset.directional_diffuse->oren_nayar_roughness
            ) ||
            preset.directional_diffuse->oren_nayar_roughness < 0.0 ||
            preset.directional_diffuse->oren_nayar_roughness > 1.0 ||
            !std::isfinite(
                preset.directional_diffuse->weighted_normalized_rmse
            ) ||
            preset.directional_diffuse->weighted_normalized_rmse < 0.0) {
            throw std::invalid_argument(
                "researched directional fit semantics are invalid"
            );
        }
    }
    const bool stone_index = preset.family ==
            MaterialOpticalFamily::stone &&
        preset.optical_index.has_value() &&
        preset.optical_index->scope == OpticalIndexScope::constituent &&
        !preset.directional_diffuse.has_value();
    const bool road_directional = preset.family ==
            MaterialOpticalFamily::road &&
        !preset.optical_index.has_value() &&
        preset.directional_diffuse.has_value();
    const bool wood_index = preset.family ==
            MaterialOpticalFamily::wood &&
        preset.optical_index.has_value() &&
        preset.optical_index->scope == OpticalIndexScope::constituent &&
        !preset.directional_diffuse.has_value();
    const bool leaf_index = preset.family ==
            MaterialOpticalFamily::vegetation &&
        preset.optical_index.has_value() &&
        preset.optical_index->scope ==
            OpticalIndexScope::leaf_interior_model &&
        !preset.directional_diffuse.has_value();
    if (!(stone_index || road_directional || wood_index || leaf_index) ||
        family_index >= kMaterialReferenceSubsetsV1.size()) {
        throw std::invalid_argument(
            "researched material evidence was assigned to the wrong scope"
        );
    }
}

inline std::array<ResearchedMaterialPreset, 4>
BuildResearchedMaterialPresetsV1() {
    std::array<ResearchedMaterialPreset, 4> presets{
        BuildResearchedMaterialPresetV1(MaterialOpticalFamily::stone),
        BuildResearchedMaterialPresetV1(MaterialOpticalFamily::road),
        BuildResearchedMaterialPresetV1(MaterialOpticalFamily::wood),
        BuildResearchedMaterialPresetV1(MaterialOpticalFamily::vegetation),
    };
    for (const auto& preset : presets) {
        ValidateResearchedMaterialPreset(preset);
    }
    return presets;
}

}  // namespace vf::material
