#pragma once

#include <cstdint>
#include <stdexcept>
#include <string_view>

namespace vf::material {

enum class EvidenceKind {
    Measured,
    ArtistAuthored,
};

struct MaterialProvenance {
    EvidenceKind kind;
    std::string_view source;
    std::string_view source_version;
    std::string_view license;
    std::string_view license_url;
    std::string_view units;
    std::string_view measurement_conditions;
    std::string_view fit_method;
    std::string_view uncertainty;
    std::uint32_t generator_version;
    std::string_view authoring_note;
};

inline bool IsHttpsMaterialReferenceUrl(std::string_view value) {
    return value.starts_with("https://");
}

inline void ValidateMaterialProvenance(
    const MaterialProvenance& provenance
) {
    if (provenance.generator_version == 0) {
        throw std::invalid_argument(
            "material provenance generator version is required"
        );
    }
    if (provenance.kind == EvidenceKind::ArtistAuthored) {
        if (provenance.authoring_note.empty()) {
            throw std::invalid_argument(
                "artist-authored provenance requires an authoring note"
            );
        }
        return;
    }
    if (!IsHttpsMaterialReferenceUrl(provenance.source)) {
        throw std::invalid_argument(
            "measured material provenance requires an HTTPS source"
        );
    }
    if (provenance.source_version.empty()) {
        throw std::invalid_argument(
            "measured material provenance requires a source version"
        );
    }
    if (provenance.license.empty()) {
        throw std::invalid_argument(
            "measured material provenance requires a license"
        );
    }
    if (!IsHttpsMaterialReferenceUrl(provenance.license_url)) {
        throw std::invalid_argument(
            "measured material provenance requires an HTTPS license URL"
        );
    }
    if (provenance.units.empty()) {
        throw std::invalid_argument(
            "measured material provenance requires units"
        );
    }
    if (provenance.measurement_conditions.empty()) {
        throw std::invalid_argument(
            "measured material provenance requires measurement conditions"
        );
    }
    if (provenance.fit_method.empty()) {
        throw std::invalid_argument(
            "measured material provenance requires a fit method"
        );
    }
    if (provenance.uncertainty.empty()) {
        throw std::invalid_argument(
            "measured material provenance requires uncertainty"
        );
    }
}

}  // namespace vf::material
