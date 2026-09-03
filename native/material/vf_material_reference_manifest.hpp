#pragma once

#include "native/material/vf_material_provenance.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string_view>

namespace vf::material {

enum class MaterialReferenceDomain : std::uint8_t {
    Stone,
    RoadAsphalt,
    BarkWood,
    LeafCanopy,
};

struct MaterialReferenceDataset {
    std::uint32_t manifest_version;
    std::string_view stable_id;
    MaterialReferenceDomain domain;
    std::string_view title;
    std::string_view documentation_url;
    std::string_view material_selector;
    std::string_view measured_fields;
    std::string_view limitations;
    MaterialProvenance provenance;
};

inline void ValidateMaterialReferenceDataset(
    const MaterialReferenceDataset& dataset
) {
    if (dataset.manifest_version != 1) {
        throw std::invalid_argument(
            "material reference manifest version is unsupported"
        );
    }
    if (dataset.stable_id.empty() || dataset.title.empty()) {
        throw std::invalid_argument(
            "material reference identity and title are required"
        );
    }
    if (!IsHttpsMaterialReferenceUrl(dataset.documentation_url)) {
        throw std::invalid_argument(
            "material reference requires an HTTPS documentation URL"
        );
    }
    if (dataset.material_selector.empty()) {
        throw std::invalid_argument(
            "material reference selector is required"
        );
    }
    if (dataset.measured_fields.empty()) {
        throw std::invalid_argument(
            "material reference measured fields are required"
        );
    }
    if (dataset.limitations.empty()) {
        throw std::invalid_argument(
            "material reference limitations are required"
        );
    }
    ValidateMaterialProvenance(dataset.provenance);
}

template <std::size_t Size>
inline void ValidateMaterialReferenceManifest(
    const std::array<MaterialReferenceDataset, Size>& manifest
) {
    std::array<bool, 4> domains{};
    for (std::size_t index = 0; index < manifest.size(); ++index) {
        const auto& dataset = manifest[index];
        ValidateMaterialReferenceDataset(dataset);
        const auto domain = static_cast<std::size_t>(dataset.domain);
        if (domain >= domains.size()) {
            throw std::invalid_argument(
                "material reference domain is invalid"
            );
        }
        domains[domain] = true;
        for (std::size_t other = 0; other < index; ++other) {
            if (manifest[other].stable_id == dataset.stable_id) {
                throw std::invalid_argument(
                    "material reference identity is duplicate"
                );
            }
        }
    }
    for (const bool covered : domains) {
        if (!covered) {
            throw std::invalid_argument(
                "material reference domain is not covered"
            );
        }
    }
}

inline constexpr std::string_view kUsgsSource =
    "https://doi.org/10.5066/F7RR1WDJ";
inline constexpr std::string_view kUsgsDocumentation =
    "https://doi.org/10.3133/ds1035";
inline constexpr std::string_view kUsgsLicense =
    "https://www.usgs.gov/data/usgs-spectral-library-version-7-data";
inline constexpr std::string_view kNasaDataPolicy =
    "https://science.nasa.gov/earth-science/earth-science-data/"
    "data-information-policy";

inline constexpr MaterialProvenance kUsgsSpectralProvenance{
    EvidenceKind::Measured,
    kUsgsSource,
    "USGS Spectral Library Version 7; original splib07a measurements",
    "CC0-1.0",
    kUsgsLicense,
    "wavelength: micrometre; reflectance: unitless; bandpass FWHM: "
    "micrometre",
    "Original Beckman, ASD, Nicolet, or AVIRIS sampling; use each "
    "spectrum's instrument, geometry, sample, purity, and artifact metadata",
    "No fit; retain splib07a observations and record any later resampling "
    "or model fit separately",
    "No library-wide scalar; use per-spectrum instrument and purity "
    "metadata, measured FWHM, and invalid-band sentinels",
    1,
    {},
};

inline constexpr std::array<MaterialReferenceDataset, 5>
kMaterialReferenceManifestV1{{
    {
        1,
        "usgs-splib07-stone-reflectance",
        MaterialReferenceDomain::Stone,
        "USGS Spectral Library Version 7 rock and mineral observations",
        kUsgsDocumentation,
        "Rock and natural-mixture spectra, including documented limestone "
        "and rock-forming mineral samples",
        "Sample identity, wavelength, channel FWHM, and spectral reflectance",
        "Reflectance spectra are not BRDF, IOR, or microfacet-roughness "
        "measurements; preserve sample grain size and measurement geometry",
        kUsgsSpectralProvenance,
    },
    {
        1,
        "usgs-splib07-road-asphalt-reflectance",
        MaterialReferenceDomain::RoadAsphalt,
        "USGS Spectral Library Version 7 artificial road materials",
        kUsgsDocumentation,
        "Artificial Materials: Asphalt and Concrete-Light Grey Road",
        "Material identity, wavelength, channel FWHM, and spectral "
        "reflectance",
        "No roughness, wetness, aggregate geometry, or directional BRDF; "
        "do not treat one surface condition as an asphalt population fit",
        kUsgsSpectralProvenance,
    },
    {
        1,
        "usgs-splib07-bark-wood-reflectance",
        MaterialReferenceDomain::BarkWood,
        "USGS Spectral Library Version 7 wood and bark observations",
        kUsgsDocumentation,
        "Vegetation plant components documented as bark and Artificial "
        "Materials: Cedar Shake",
        "Plant or material identity, wavelength, channel FWHM, and spectral "
        "reflectance",
        "No anatomical orientation, cut-plane BRDF, moisture series, or "
        "microgeometry; bark and cut wood remain distinct populations",
        kUsgsSpectralProvenance,
    },
    {
        1,
        "usgs-splib07-leaf-vegetation-reflectance",
        MaterialReferenceDomain::LeafCanopy,
        "USGS Spectral Library Version 7 leaf and vegetation observations",
        kUsgsDocumentation,
        "Vegetation leaf, plant, plot, and airborne forest observations, "
        "including Aspen Leaf A",
        "Plant and measurement level, wavelength, channel FWHM, and spectral "
        "reflectance",
        "Leaf, plant, plot, and airborne spectra use different supports and "
        "geometries; no leaf transmittance or universal canopy BRDF",
        kUsgsSpectralProvenance,
    },
    {
        1,
        "ornl-accp-seedling-canopy-reflectance-v1",
        MaterialReferenceDomain::LeafCanopy,
        "Seedling Canopy Reflectance Spectra, 1992-1993 (ACCP)",
        "https://daac.ornl.gov/ACCP/guides/S_can_sp.html",
        "Douglas-fir and bigleaf maple seedling canopies under controlled "
        "fertilization and canopy density treatments",
        "Wavelength, canopy reflectance, Douglas-fir per-band standard "
        "deviation, treatment, and maple canopy-density or LAI class",
        "Controlled seedlings are not mature forests; spectra were smoothed, "
        "maple measurements had wind noise, and no directional canopy BRDF "
        "was measured",
        {
            EvidenceKind::Measured,
            "https://doi.org/10.3334/ORNLDAAC/423",
            "Version 1",
            "NASA Earth Science Data and Information Policy",
            kNasaDataPolicy,
            "wavelength: nanometre; reflectance: percent or unitless "
            "absorbance transform; standard deviation: unitless",
            "Natural sunlight near NASA Ames; GER SIRIS and Spectron SE590; "
            "calibrated Spectralon reference; repeated canopy rotations",
            "No fit; retain measured means and Douglas-fir per-band standard "
            "deviations before any later canopy-model fit",
            "Douglas-fir supplies per-band standard deviation; GER SNR was "
            "about 100 at 800-1100 nm and about 20 at 450-700 nm and longer "
            "NIR; no scalar accuracy was reported",
            1,
            {},
        },
    },
}};

}  // namespace vf::material
