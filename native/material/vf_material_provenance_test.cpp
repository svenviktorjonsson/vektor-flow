#include "native/material/vf_material_reference_manifest.hpp"

#include <array>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void require_rejected(
    const vf::material::MaterialReferenceDataset& dataset,
    const std::string& expected
) {
    try {
        vf::material::ValidateMaterialReferenceDataset(dataset);
    } catch (const std::invalid_argument& error) {
        if (std::string(error.what()).find(expected) == std::string::npos) {
            throw std::runtime_error("wrong provenance rejection");
        }
        return;
    }
    throw std::runtime_error("invalid measured provenance was accepted");
}

}  // namespace

int main() {
    using Domain = vf::material::MaterialReferenceDomain;
    const auto& manifest = vf::material::kMaterialReferenceManifestV1;
    vf::material::ValidateMaterialReferenceManifest(manifest);
    require(manifest.size() == 5,
            "reference manifest lost required material coverage");

    std::array<std::size_t, 4> domain_counts{};
    for (const auto& dataset : manifest) {
        ++domain_counts[static_cast<std::size_t>(dataset.domain)];
        require(dataset.manifest_version == 1,
                "reference dataset escaped manifest version one");
        require(dataset.provenance.kind ==
                    vf::material::EvidenceKind::Measured,
                "reference dataset was not marked measured");
        require(dataset.provenance.fit_method.find("No fit") !=
                    std::string_view::npos,
                "reference observation silently claimed a fitted preset");
    }
    require(domain_counts[static_cast<std::size_t>(Domain::Stone)] == 1,
            "stone reference coverage changed");
    require(domain_counts[
                static_cast<std::size_t>(Domain::RoadAsphalt)] == 1,
            "road reference coverage changed");
    require(domain_counts[
                static_cast<std::size_t>(Domain::BarkWood)] == 1,
            "bark and wood reference coverage changed");
    require(domain_counts[
                static_cast<std::size_t>(Domain::LeafCanopy)] == 2,
            "leaf and canopy reference coverage changed");
    for (std::size_t index = 0; index < 4; ++index) {
        require(manifest[index].provenance.source ==
                    "https://doi.org/10.5066/F7RR1WDJ" &&
                    manifest[index].provenance.license == "CC0-1.0" &&
                    manifest[index].provenance.source_version.find(
                        "Version 7"
                    ) != std::string_view::npos,
                "USGS reference source, version, or license changed");
    }
    require(manifest[4].provenance.source ==
                "https://doi.org/10.3334/ORNLDAAC/423" &&
                manifest[4].provenance.source_version == "Version 1" &&
                manifest[4].provenance.license ==
                    "NASA Earth Science Data and Information Policy",
            "canopy reference source, version, or policy changed");

    auto missing_license = manifest.front();
    missing_license.provenance.license = {};
    require_rejected(missing_license, "license");
    auto missing_license_url = manifest.front();
    missing_license_url.provenance.license_url = {};
    require_rejected(missing_license_url, "license URL");
    auto missing_uncertainty = manifest.front();
    missing_uncertainty.provenance.uncertainty = {};
    require_rejected(missing_uncertainty, "uncertainty");
    auto missing_fields = manifest.front();
    missing_fields.measured_fields = {};
    require_rejected(missing_fields, "measured fields");
    auto missing_limits = manifest.front();
    missing_limits.limitations = {};
    require_rejected(missing_limits, "limitations");
    auto mutable_manifest = manifest;
    mutable_manifest[1].stable_id = mutable_manifest[0].stable_id;
    try {
        vf::material::ValidateMaterialReferenceManifest(mutable_manifest);
    } catch (const std::invalid_argument& error) {
        require(std::string(error.what()).find("duplicate") !=
                    std::string::npos,
                "duplicate reference produced the wrong diagnostic");
        std::cout << "material reference manifest v1: entries="
                  << manifest.size() << " domains=4\n";
        return 0;
    }
    throw std::runtime_error("duplicate reference identity was accepted");
}
