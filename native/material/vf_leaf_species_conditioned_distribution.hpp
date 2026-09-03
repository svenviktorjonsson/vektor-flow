#pragma once

#include "native/material/vf_material_researched_preset.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string_view>

namespace vf::material {

enum class LeafSpeciesConditionV1 : std::uint32_t {
    carpinus_betulus_fastigiata = 0,
    acer_campestre = 1,
    quercus_robur = 2,
    platanus_acerifolia = 3,
    tilia_platyphyllos = 4,
    acer_freemanii = 5,
    betula_pendula = 6,
    acer_platanoides_schwedleri = 7,
    aesculus_hippocastanum = 8,
};

struct LeafSpeciesConditionedMember {
    LeafSpeciesConditionV1 species;
    std::string_view stable_id;
    std::string_view scientific_name;
    std::array<double, 3> mean_spectral_reflectance;
    std::array<double, 3> reported_spectral_mean_error;
    std::array<double, 3> centered_factor;
};

inline bool operator==(
    const LeafSpeciesConditionedMember& first,
    const LeafSpeciesConditionedMember& second
) {
    return first.species == second.species &&
        first.stable_id == second.stable_id &&
        first.scientific_name == second.scientific_name &&
        first.mean_spectral_reflectance ==
            second.mean_spectral_reflectance &&
        first.reported_spectral_mean_error ==
            second.reported_spectral_mean_error &&
        first.centered_factor == second.centered_factor;
}

struct LeafSpeciesConditionedProvenance {
    std::string_view source_url;
    std::string_view source_artifact_url;
    std::string_view source_artifact_sha256;
    std::string_view source_version;
    std::string_view license;
    std::string_view license_url;
    std::string_view measurement_conditions;
    std::string_view population_variation_note;
    std::string_view uncertainty_note;
    std::string_view limitation;
};

inline bool operator==(
    const LeafSpeciesConditionedProvenance& first,
    const LeafSpeciesConditionedProvenance& second
) {
    return first.source_url == second.source_url &&
        first.source_artifact_url == second.source_artifact_url &&
        first.source_artifact_sha256 ==
            second.source_artifact_sha256 &&
        first.source_version == second.source_version &&
        first.license == second.license &&
        first.license_url == second.license_url &&
        first.measurement_conditions == second.measurement_conditions &&
        first.population_variation_note ==
            second.population_variation_note &&
        first.uncertainty_note == second.uncertainty_note &&
        first.limitation == second.limitation;
}

struct LeafSpeciesConditionedDistribution {
    std::string_view stable_id;
    std::array<double, 3> calibrated_center;
    std::array<double, 3> measured_species_mean;
    std::array<double, 3> species_factor_standard_deviation;
    std::array<double, 3> reported_relative_mean_error_rms;
    std::array<LeafSpeciesConditionedMember, 9> members;
    LeafSpeciesConditionedProvenance provenance;
};

inline bool operator==(
    const LeafSpeciesConditionedDistribution& first,
    const LeafSpeciesConditionedDistribution& second
) {
    return first.stable_id == second.stable_id &&
        first.calibrated_center == second.calibrated_center &&
        first.measured_species_mean ==
            second.measured_species_mean &&
        first.species_factor_standard_deviation ==
            second.species_factor_standard_deviation &&
        first.reported_relative_mean_error_rms ==
            second.reported_relative_mean_error_rms &&
        first.members == second.members &&
        first.provenance == second.provenance;
}

inline std::array<LeafSpeciesConditionedMember, 9>
LeafSpeciesConditionedMembersV1() {
    using Species = LeafSpeciesConditionV1;
    return {{
        {
            Species::carpinus_betulus_fastigiata,
            "carpinus-betulus-fastigiata",
            "Carpinus betulus fastigiata",
            {0.04480216435643564, 0.11634915841584158,
             0.044621613861386134},
            {0.0007653195953247646, 0.00238883925471368,
             0.0012844252943503393},
            {},
        },
        {
            Species::acer_campestre,
            "acer-campestre",
            "Acer campestre",
            {0.04635141777777778, 0.09466135777777779,
             0.0412244},
            {0.0009516217796411708, 0.002898474755145476,
             0.001078347820383578},
            {},
        },
        {
            Species::quercus_robur,
            "quercus-robur",
            "Quercus robur",
            {0.037956705660377364, 0.06696810754716982,
             0.02798969056603774},
            {0.0008362326087031322, 0.001656252256596697,
             0.0008357128753647726},
            {},
        },
        {
            Species::platanus_acerifolia,
            "platanus-x-acerifolia",
            "Platanus x acerifolia",
            {0.03226468704547188, 0.09804735974622643,
             0.02671873822493079},
            {0.001153220588851996, 0.003679739536989642,
             0.0012963804675203028},
            {},
        },
        {
            Species::tilia_platyphyllos,
            "tilia-platyphyllos",
            "Tilia platyphyllos",
            {0.041134898462790455, 0.10039832204043952,
             0.042794145069973706},
            {0.0012467282440321733, 0.0033744064100681755,
             0.0036102506497293287},
            {},
        },
        {
            Species::acer_freemanii,
            "acer-x-freemanii",
            "Acer x freemanii",
            {0.04193508841921052, 0.11620458344115009,
             0.037235235780405274},
            {0.0005737159252077671, 0.0026467672587329695,
             0.000797899844278678},
            {},
        },
        {
            Species::betula_pendula,
            "betula-pendula",
            "Betula pendula",
            {0.04357909453868875, 0.08477355108198864,
             0.034504743586144804},
            {0.0006342954968729819, 0.0015396049383815363,
             0.0005964927477991873},
            {},
        },
        {
            Species::acer_platanoides_schwedleri,
            "acer-platanoides-schwedleri",
            "Acer platanoides schwedleri",
            {0.03260196712569285, 0.0265225638211625,
             0.0253734861418019},
            {0.000738978074830579, 0.0012104016219250536,
             0.0006513444524773129},
            {},
        },
        {
            Species::aesculus_hippocastanum,
            "aesculus-hippocastanum",
            "Aesculus hippocastanum",
            {0.04498399443853257, 0.08611052767313655,
             0.03714823821417744},
            {0.0006312177341637643, 0.0023662817727664134,
             0.0008266777962866485},
            {},
        },
    }};
}

inline LeafSpeciesConditionedDistribution
BuildLeafSpeciesConditionedDistributionV1() {
    auto members = LeafSpeciesConditionedMembersV1();
    std::array<double, 3> measured_species_mean{};
    for (const auto& member : members) {
        for (std::size_t band = 0; band < 3; ++band) {
            measured_species_mean[band] +=
                member.mean_spectral_reflectance[band] /
                static_cast<double>(members.size());
        }
    }
    for (auto& member : members) {
        for (std::size_t band = 0; band < 3; ++band) {
            member.centered_factor[band] =
                member.mean_spectral_reflectance[band] /
                measured_species_mean[band];
        }
    }
    std::array<double, 3> species_factor_standard_deviation{};
    std::array<double, 3> reported_relative_mean_error_rms{};
    for (const auto& member : members) {
        for (std::size_t band = 0; band < 3; ++band) {
            const double residual =
                member.centered_factor[band] - 1.0;
            species_factor_standard_deviation[band] +=
                residual * residual;
            const double relative_error =
                member.reported_spectral_mean_error[band] /
                member.mean_spectral_reflectance[band];
            reported_relative_mean_error_rms[band] +=
                relative_error * relative_error /
                static_cast<double>(members.size());
        }
    }
    for (std::size_t band = 0; band < 3; ++band) {
        species_factor_standard_deviation[band] = std::sqrt(
            species_factor_standard_deviation[band] /
            static_cast<double>(members.size() - 1)
        );
        reported_relative_mean_error_rms[band] = std::sqrt(
            reported_relative_mean_error_rms[band]
        );
    }
    const auto center = BuildResearchedMaterialPresetV1(
        MaterialOpticalFamily::vegetation
    ).spectral.fit.spectral_reflectance;
    return {
        "reading-nine-leaf-species-conditioned-v1",
        center,
        measured_species_mean,
        species_factor_standard_deviation,
        reported_relative_mean_error_rms,
        members,
        {
            "https://doi.org/10.17864/1947.231",
            "https://researchdata.reading.ac.uk/231/7/"
            "Leaf_reflectance_nine_species.xlsx",
            "0F840434030A9CA50B13063861C2A81D924AC85A0AF2245E0464079D87A35EAF",
            "Deng 2019; University of Reading dataset 1947.231",
            "CC-BY-4.0",
            "https://creativecommons.org/licenses/by/4.0/",
            "Laboratory leaf reflectance from 400 to 2500 nm; 5-10 "
            "trees per species and 10 leaves per tree; arithmetic mean "
            "of five source rows nearest 450, 550, and 650 nm",
            "The nine species means condition between-species color; "
            "their centered factors have arithmetic mean one per band",
            "The source-reported standard mean errors are retained "
            "separately and never sampled as procedural variation",
            "Healthy sampled UK urban-tree leaves only; not an age, "
            "moisture, seasonal, canopy-BRDF, or universal species prior",
        },
    };
}

inline void ValidateLeafSpeciesConditionedDistribution(
    const LeafSpeciesConditionedDistribution& distribution
) {
    if (distribution.stable_id.empty() ||
        !distribution.provenance.source_url.starts_with("https://") ||
        !distribution.provenance.source_artifact_url.starts_with(
            "https://"
        ) ||
        !IsUpperHexSha256(
            distribution.provenance.source_artifact_sha256
        ) ||
        distribution.provenance.license != "CC-BY-4.0" ||
        !distribution.provenance.license_url.starts_with("https://") ||
        distribution.provenance.measurement_conditions.empty() ||
        distribution.provenance.population_variation_note.empty() ||
        distribution.provenance.uncertainty_note.empty() ||
        distribution.provenance.limitation.empty()) {
        throw std::invalid_argument(
            "leaf species provenance is invalid"
        );
    }
    for (std::size_t index = 0;
         index < distribution.members.size();
         ++index) {
        const auto& member = distribution.members[index];
        if (static_cast<std::size_t>(member.species) != index ||
            member.stable_id.empty() ||
            member.scientific_name.empty()) {
            throw std::invalid_argument(
                "leaf species identity is invalid"
            );
        }
        for (std::size_t other = 0; other < index; ++other) {
            if (distribution.members[other].stable_id ==
                    member.stable_id ||
                distribution.members[other].scientific_name ==
                    member.scientific_name) {
                throw std::invalid_argument(
                    "leaf species evidence is duplicate"
                );
            }
        }
        for (std::size_t band = 0; band < 3; ++band) {
            const double reflectance =
                member.mean_spectral_reflectance[band];
            const double uncertainty =
                member.reported_spectral_mean_error[band];
            const double factor = member.centered_factor[band];
            if (!std::isfinite(reflectance) || reflectance <= 0.0 ||
                reflectance > 1.0 || !std::isfinite(uncertainty) ||
                uncertainty <= 0.0 || uncertainty >= reflectance ||
                !std::isfinite(factor) || factor <= 0.0) {
                throw std::invalid_argument(
                    "leaf species measurement is invalid"
                );
            }
        }
    }
    for (std::size_t band = 0; band < 3; ++band) {
        if (!std::isfinite(
                distribution.species_factor_standard_deviation[band]
            ) ||
            distribution.species_factor_standard_deviation[band] <= 0.0 ||
            !std::isfinite(
                distribution.reported_relative_mean_error_rms[band]
            ) ||
            distribution.reported_relative_mean_error_rms[band] <= 0.0) {
            throw std::invalid_argument(
                "leaf species dispersion is invalid"
            );
        }
    }
}

inline const LeafSpeciesConditionedMember& LeafSpeciesMemberReference(
    const LeafSpeciesConditionedDistribution& distribution,
    LeafSpeciesConditionV1 species
) {
    const auto index = static_cast<std::size_t>(species);
    if (index >= distribution.members.size() ||
        distribution.members[index].species != species) {
        throw std::invalid_argument(
            "leaf species condition is unsupported"
        );
    }
    return distribution.members[index];
}

}  // namespace vf::material
