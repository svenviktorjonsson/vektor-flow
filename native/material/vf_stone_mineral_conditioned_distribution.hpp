#pragma once

#include "native/material/vf_material_researched_preset.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string_view>

namespace vf::material {

enum class StoneMineralConditionV1 : std::uint32_t {
    albite_plagioclase = 0,
    microcline_alkali_feldspar = 1,
    hornblende_amphibole = 2,
};

struct StoneMineralMeasuredMember {
    std::string_view stable_id;
    std::string_view source_entry;
    std::string_view source_sha256;
    std::array<double, 3> spectral_reflectance;
    std::array<double, 3> local_fit_standard_error;
    std::array<double, 3> centered_factor;
};

inline bool operator==(
    const StoneMineralMeasuredMember& first,
    const StoneMineralMeasuredMember& second
) {
    return first.stable_id == second.stable_id &&
        first.source_entry == second.source_entry &&
        first.source_sha256 == second.source_sha256 &&
        first.spectral_reflectance == second.spectral_reflectance &&
        first.local_fit_standard_error ==
            second.local_fit_standard_error &&
        first.centered_factor == second.centered_factor;
}

struct StoneMineralMeasuredCondition {
    StoneMineralConditionV1 condition;
    std::string_view stable_id;
    std::string_view mineral_identity;
    std::string_view mineral_group;
    std::array<double, 3> measured_mean;
    std::array<double, 3> conditioned_factor;
    std::array<double, 3> member_factor_standard_deviation;
    std::array<double, 3> fit_relative_standard_error_rms;
    std::array<StoneMineralMeasuredMember, 4> members;
};

inline bool operator==(
    const StoneMineralMeasuredCondition& first,
    const StoneMineralMeasuredCondition& second
) {
    return first.condition == second.condition &&
        first.stable_id == second.stable_id &&
        first.mineral_identity == second.mineral_identity &&
        first.mineral_group == second.mineral_group &&
        first.measured_mean == second.measured_mean &&
        first.conditioned_factor == second.conditioned_factor &&
        first.member_factor_standard_deviation ==
            second.member_factor_standard_deviation &&
        first.fit_relative_standard_error_rms ==
            second.fit_relative_standard_error_rms &&
        first.members == second.members;
}

struct StoneMineralConditionedProvenance {
    std::string_view source_url;
    std::string_view source_version;
    std::string_view source_archive_sha256;
    std::string_view license;
    std::string_view license_url;
    std::string_view measurement_conditions;
    std::string_view population_variation_note;
    std::string_view fit_uncertainty_note;
    std::string_view limitation;
};

inline bool operator==(
    const StoneMineralConditionedProvenance& first,
    const StoneMineralConditionedProvenance& second
) {
    return first.source_url == second.source_url &&
        first.source_version == second.source_version &&
        first.source_archive_sha256 ==
            second.source_archive_sha256 &&
        first.license == second.license &&
        first.license_url == second.license_url &&
        first.measurement_conditions == second.measurement_conditions &&
        first.population_variation_note ==
            second.population_variation_note &&
        first.fit_uncertainty_note == second.fit_uncertainty_note &&
        first.limitation == second.limitation;
}

struct StoneMineralConditionedDistribution {
    std::string_view stable_id;
    std::array<double, 3> calibrated_center;
    std::array<double, 3> measured_condition_mean;
    std::array<StoneMineralMeasuredCondition, 3> conditions;
    StoneMineralConditionedProvenance provenance;
};

inline bool operator==(
    const StoneMineralConditionedDistribution& first,
    const StoneMineralConditionedDistribution& second
) {
    return first.stable_id == second.stable_id &&
        first.calibrated_center == second.calibrated_center &&
        first.measured_condition_mean ==
            second.measured_condition_mean &&
        first.conditions == second.conditions &&
        first.provenance == second.provenance;
}

inline std::array<StoneMineralMeasuredMember, 4>
AlbitePlagioclaseMembersV1() {
    return {{
        {
            "albite-hs324-1b",
            "ChapterM_Minerals/"
            "splib07a_Albite_HS324.1B_Plagioclase_ASDFRc_AREF.txt",
            "1306BFB1B99E5D0B8C805045EFC88C391B93DD8C8B4E61563922DD69F776C7F3",
            {0.77834922, 0.852810944, 0.890366114},
            {0.0006782045883728581, 0.0003992433301960082,
             0.00020293194047758494},
            {},
        },
        {
            "albite-hs324-2b",
            "ChapterM_Minerals/"
            "splib07a_Albite_HS324.2B_Plagioclase_ASDFRc_AREF.txt",
            "26DCD2A05C74F0073C56CDD1FDD87919A16F1BD034FCF6842271F5CB411F33B9",
            {0.82871449, 0.851360582, 0.856054056},
            {0.0003450247116512131, 0.000024666150571164675,
             0.00006945462091178788},
            {},
        },
        {
            "albite-hs324-3b",
            "ChapterM_Minerals/"
            "splib07a_Albite_HS324.3B_Plagioclase_ASDFRc_AREF.txt",
            "34E2E0738B5A6307739920EF189AB59A86205317CAD858DC213C8F4CEE07084B",
            {0.689326788, 0.7124247659999999, 0.708443118},
            {0.00031905990356670774, 0.00004847191100008432,
             0.00007241398224100044},
            {},
        },
        {
            "albite-hs324-4b",
            "ChapterM_Minerals/"
            "splib07a_Albite_HS324.4B_Plagioclase_ASDFRc_AREF.txt",
            "8AFAE9AC17048C1546017ECFFE90814C185B5FFB10E9F16BA34B1BBB8C872754",
            {0.648967206, 0.679275178, 0.671879184},
            {0.0004230781185856845, 0.00009610528868900935,
             0.00008599511669856815},
            {},
        },
    }};
}

inline std::array<StoneMineralMeasuredMember, 4>
MicroclineAlkaliFeldsparMembersV1() {
    return {{
        {
            "microcline-hs103-1b",
            "ChapterM_Minerals/"
            "splib07a_Microcline_HS103.1B_Feldspar_ASDFRc_AREF.txt",
            "111CF6E19FF7E25A27FA809C4EE6CCFCCBEAD4B0B62BD2D6BC0F9BFE005C579A",
            {0.627089118, 0.68079027, 0.705748808},
            {0.0005602137403830795, 0.0002773980844202119,
             0.0000855402332472923},
            {},
        },
        {
            "microcline-hs103-2b",
            "ChapterM_Minerals/"
            "splib07a_Microcline_HS103.2B_Feldspar_ASDFRc_AREF.txt",
            "7840AA25D0D29EA6DC59B83A4FB547E2D65E09EEB98C9C2FB4268F091A78520F",
            {0.718746364, 0.775471842, 0.792199348},
            {0.0009243783525083246, 0.00027299934676478226,
             0.00006843278259722795},
            {},
        },
        {
            "microcline-hs103-3b",
            "ChapterM_Minerals/"
            "splib07a_Microcline_HS103.3B_Feldspar_ASDFRc_AREF.txt",
            "7E70A95C59A42ED3D56B5C4DE1DFFEA2ADF5456B730F8DA09AE2EA1C11315498",
            {0.644649398, 0.729797662, 0.748292328},
            {0.0018005786459063561, 0.00033745668749336684,
             0.0001011789128919647},
            {},
        },
        {
            "microcline-hs103-4b",
            "ChapterM_Minerals/"
            "splib07a_Microcline_HS103.4B_Feldspar_ASDFRc_AREF.txt",
            "DB83244AF99EECF6A6D55D40C8E0A24F5058115EBE86675CEC142B2D6A757C0F",
            {0.5861719599999999, 0.685943318, 0.705764294},
            {0.002510121645978537, 0.0003666314928835281,
             0.00015307187010028404},
            {},
        },
    }};
}

inline std::array<StoneMineralMeasuredMember, 4>
HornblendeAmphiboleMembersV1() {
    return {{
        {
            "hornblende-hs177-1b",
            "ChapterM_Minerals/"
            "splib07a_Hornblende_HS177.1B_ASDFRc_AREF.txt",
            "C61B2E8F62FCF9A2EE077200AA2E487B95012A2FC623C69959211D8F0305270C",
            {0.132436608, 0.2062959, 0.246770876},
            {0.0004274966280498582, 0.0004383318655653521,
             0.00021534136568713552},
            {},
        },
        {
            "hornblende-hs177-3b",
            "ChapterM_Minerals/"
            "splib07a_Hornblende_HS177.3B_ASDFRc_AREF.txt",
            "A15A2F5D9FBB8D074EE417861C956DC5C103CCB93D5501EC34A4F713378A5D20",
            {0.0537075996, 0.0608977586, 0.064685759},
            {0.000033534601877165594, 0.000028303394553657412,
             0.000026051979251103747},
            {},
        },
        {
            "hornblende-hs177-4b",
            "ChapterM_Minerals/"
            "splib07a_Hornblende_HS177.4B_ASDFRc_AREF.txt",
            "1FCAC19AECFD0C94BDFB5F4B50BEC8A5D4109A5EE68DF49AF4870B755166C018",
            {0.0477426006, 0.051144851, 0.0522558368},
            {0.0000285436501040076, 0.000035681350892308054,
             0.00001687891639709176},
            {},
        },
        {
            "hornblende-hs177-6",
            "ChapterM_Minerals/"
            "splib07a_Hornblende_HS177.6_ASDFRc_AREF.txt",
            "AF8AD047A9B2B50BE2079FCCC1E07370FE037D48F1F36475F50AEDBEB2C58421",
            {0.0851417496, 0.09794666020000001, 0.101218612},
            {0.00010321930881119188, 0.0000408593861400287,
             0.000005927373279962843},
            {},
        },
    }};
}

inline StoneMineralMeasuredCondition FitStoneMineralCondition(
    StoneMineralConditionV1 condition,
    std::string_view stable_id,
    std::string_view mineral_identity,
    std::string_view mineral_group,
    std::array<StoneMineralMeasuredMember, 4> members
) {
    StoneMineralMeasuredCondition result{
        condition,
        stable_id,
        mineral_identity,
        mineral_group,
        {},
        {},
        {},
        {},
        members,
    };
    for (const auto& member : result.members) {
        for (std::size_t band = 0; band < 3; ++band) {
            result.measured_mean[band] +=
                member.spectral_reflectance[band] /
                static_cast<double>(result.members.size());
        }
    }
    for (auto& member : result.members) {
        for (std::size_t band = 0; band < 3; ++band) {
            member.centered_factor[band] =
                member.spectral_reflectance[band] /
                result.measured_mean[band];
            const double residual =
                member.centered_factor[band] - 1.0;
            result.member_factor_standard_deviation[band] +=
                residual * residual;
            const double relative_error =
                member.local_fit_standard_error[band] /
                member.spectral_reflectance[band];
            result.fit_relative_standard_error_rms[band] +=
                relative_error * relative_error /
                static_cast<double>(result.members.size());
        }
    }
    for (std::size_t band = 0; band < 3; ++band) {
        result.member_factor_standard_deviation[band] = std::sqrt(
            result.member_factor_standard_deviation[band] /
            static_cast<double>(result.members.size() - 1)
        );
        result.fit_relative_standard_error_rms[band] = std::sqrt(
            result.fit_relative_standard_error_rms[band]
        );
    }
    return result;
}

inline StoneMineralConditionedDistribution
BuildStoneMineralConditionedDistributionV1() {
    std::array<StoneMineralMeasuredCondition, 3> conditions{
        FitStoneMineralCondition(
            StoneMineralConditionV1::albite_plagioclase,
            "albite-hs324-plagioclase-v1",
            "albite HS324",
            "plagioclase feldspar",
            AlbitePlagioclaseMembersV1()
        ),
        FitStoneMineralCondition(
            StoneMineralConditionV1::microcline_alkali_feldspar,
            "microcline-hs103-alkali-feldspar-v1",
            "microcline HS103",
            "alkali feldspar",
            MicroclineAlkaliFeldsparMembersV1()
        ),
        FitStoneMineralCondition(
            StoneMineralConditionV1::hornblende_amphibole,
            "hornblende-hs177-amphibole-v1",
            "hornblende HS177",
            "amphibole",
            HornblendeAmphiboleMembersV1()
        ),
    };
    std::array<double, 3> measured_condition_mean{};
    for (const auto& condition : conditions) {
        for (std::size_t band = 0; band < 3; ++band) {
            measured_condition_mean[band] +=
                condition.measured_mean[band] /
                static_cast<double>(conditions.size());
        }
    }
    for (auto& condition : conditions) {
        for (std::size_t band = 0; band < 3; ++band) {
            condition.conditioned_factor[band] =
                condition.measured_mean[band] /
                measured_condition_mean[band];
        }
    }
    const auto center = BuildResearchedMaterialPresetV1(
        MaterialOpticalFamily::stone
    ).spectral.fit.spectral_reflectance;
    return {
        "usgs-stone-mineral-conditioned-v1",
        center,
        measured_condition_mean,
        conditions,
        {
            "https://doi.org/10.5066/F7RR1WDJ",
            "USGS Spectral Library Version 7; ASCIIdata_splib07a.zip",
            "D232645740869A82AAFCAD5839448C50B1DC72965CE042D1374F29B7A798A91C",
            "CC0-1.0",
            "https://www.usgs.gov/data/"
            "usgs-spectral-library-version-7-data",
            "ASDFRc reflectance; arithmetic mean of five raw channels "
            "nearest 450, 550, and 650 nm; four specimen fractions per "
            "named mineral condition",
            "Mineral identity conditions the stone-level center; one "
            "measured specimen fraction is chosen deterministically per "
            "stone and retains all three spectral bands together",
            "Local five-channel standard error is retained separately "
            "and is never sampled as procedural variation",
            "Pure mineral specimen fractions are composition evidence, "
            "not whole-rock, lithology, abundance, weathering, or a "
            "universal geological-class prior",
        },
    };
}

inline void ValidateStoneMineralConditionedDistribution(
    const StoneMineralConditionedDistribution& distribution
) {
    if (distribution.stable_id.empty() ||
        !distribution.provenance.source_url.starts_with("https://") ||
        !IsUpperHexSha256(
            distribution.provenance.source_archive_sha256
        ) ||
        distribution.provenance.license != "CC0-1.0" ||
        !distribution.provenance.license_url.starts_with("https://") ||
        distribution.provenance.measurement_conditions.empty() ||
        distribution.provenance.population_variation_note.empty() ||
        distribution.provenance.fit_uncertainty_note.empty() ||
        distribution.provenance.limitation.empty()) {
        throw std::invalid_argument(
            "stone mineral provenance is invalid"
        );
    }
    for (std::size_t index = 0;
         index < distribution.conditions.size();
         ++index) {
        const auto& condition = distribution.conditions[index];
        if (static_cast<std::size_t>(condition.condition) != index ||
            condition.stable_id.empty() ||
            condition.mineral_identity.empty() ||
            condition.mineral_group.empty()) {
            throw std::invalid_argument(
                "stone mineral condition identity is invalid"
            );
        }
        for (std::size_t member_index = 0;
             member_index < condition.members.size();
             ++member_index) {
            const auto& member = condition.members[member_index];
            if (member.stable_id.empty() ||
                member.source_entry.empty() ||
                !IsUpperHexSha256(member.source_sha256)) {
                throw std::invalid_argument(
                    "stone mineral member provenance is invalid"
                );
            }
            for (std::size_t other = 0;
                 other < member_index;
                 ++other) {
                if (condition.members[other].stable_id ==
                        member.stable_id ||
                    condition.members[other].source_entry ==
                        member.source_entry ||
                    condition.members[other].source_sha256 ==
                        member.source_sha256) {
                    throw std::invalid_argument(
                        "stone mineral member is duplicate"
                    );
                }
            }
            for (std::size_t band = 0; band < 3; ++band) {
                const double reflectance =
                    member.spectral_reflectance[band];
                const double fit_error =
                    member.local_fit_standard_error[band];
                if (!std::isfinite(reflectance) ||
                    reflectance <= 0.0 || reflectance > 1.0 ||
                    !std::isfinite(fit_error) || fit_error <= 0.0 ||
                    fit_error >= reflectance ||
                    !std::isfinite(member.centered_factor[band]) ||
                    member.centered_factor[band] <= 0.0) {
                    throw std::invalid_argument(
                        "stone mineral measurement is invalid"
                    );
                }
            }
        }
        for (std::size_t band = 0; band < 3; ++band) {
            if (!std::isfinite(condition.measured_mean[band]) ||
                condition.measured_mean[band] <= 0.0 ||
                !std::isfinite(condition.conditioned_factor[band]) ||
                condition.conditioned_factor[band] <= 0.0 ||
                !std::isfinite(
                    condition.member_factor_standard_deviation[band]
                ) ||
                condition.member_factor_standard_deviation[band] <= 0.0 ||
                !std::isfinite(
                    condition.fit_relative_standard_error_rms[band]
                ) ||
                condition.fit_relative_standard_error_rms[band] <= 0.0) {
                throw std::invalid_argument(
                    "stone mineral distribution is invalid"
                );
            }
        }
    }
}

inline const StoneMineralMeasuredCondition&
StoneMineralConditionReference(
    const StoneMineralConditionedDistribution& distribution,
    StoneMineralConditionV1 condition
) {
    const auto index = static_cast<std::size_t>(condition);
    if (index >= distribution.conditions.size() ||
        distribution.conditions[index].condition != condition) {
        throw std::invalid_argument(
            "stone mineral condition is unsupported"
        );
    }
    return distribution.conditions[index];
}

}  // namespace vf::material
