#pragma once

#include "native/material/vf_material_researched_preset.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <string_view>
#include <utility>
#include <vector>

namespace vf::material {

enum class PopulationMeasurementScope {
    specimen_series,
    surface_condition_series,
    weathering_series,
    leaf_state_series,
};

struct MeasuredPopulationMember {
    std::string_view stable_id;
    std::string_view source_entry;
    std::string_view source_sha256;
    std::array<double, 3> spectral_reflectance;
    std::array<double, 3> local_fit_standard_error;
};

inline bool operator==(
    const MeasuredPopulationMember& first,
    const MeasuredPopulationMember& second
) {
    return first.stable_id == second.stable_id &&
        first.source_entry == second.source_entry &&
        first.source_sha256 == second.source_sha256 &&
        first.spectral_reflectance == second.spectral_reflectance &&
        first.local_fit_standard_error ==
            second.local_fit_standard_error;
}

struct MeasuredPopulationProvenance {
    std::string_view source_url;
    std::string_view source_version;
    std::string_view source_archive_sha256;
    std::string_view license;
    std::string_view license_url;
    std::string_view measurement_conditions;
    std::string_view population_scope_note;
    std::string_view limitation;
};

inline bool operator==(
    const MeasuredPopulationProvenance& first,
    const MeasuredPopulationProvenance& second
) {
    return first.source_url == second.source_url &&
        first.source_version == second.source_version &&
        first.source_archive_sha256 == second.source_archive_sha256 &&
        first.license == second.license &&
        first.license_url == second.license_url &&
        first.measurement_conditions == second.measurement_conditions &&
        first.population_scope_note == second.population_scope_note &&
        first.limitation == second.limitation;
}

struct MeasuredPopulationDistribution {
    MaterialOpticalFamily family;
    std::string_view stable_id;
    PopulationMeasurementScope population_scope;
    std::array<double, 3> calibrated_center;
    std::array<double, 3> measured_mean;
    std::array<double, 3> population_factor_standard_deviation;
    std::array<double, 3> fit_relative_standard_error_rms;
    std::vector<MeasuredPopulationMember> members;
    std::vector<std::array<double, 3>> centered_factors;
    MeasuredPopulationProvenance provenance;
};

inline bool operator==(
    const MeasuredPopulationDistribution& first,
    const MeasuredPopulationDistribution& second
) {
    return first.family == second.family &&
        first.stable_id == second.stable_id &&
        first.population_scope == second.population_scope &&
        first.calibrated_center == second.calibrated_center &&
        first.measured_mean == second.measured_mean &&
        first.population_factor_standard_deviation ==
            second.population_factor_standard_deviation &&
        first.fit_relative_standard_error_rms ==
            second.fit_relative_standard_error_rms &&
        first.members == second.members &&
        first.centered_factors == second.centered_factors &&
        first.provenance == second.provenance;
}

inline constexpr std::string_view kPopulationSourceUrl =
    "https://doi.org/10.5066/F7RR1WDJ";
inline constexpr std::string_view kPopulationLicenseUrl =
    "https://www.usgs.gov/data/"
    "usgs-spectral-library-version-7-data";
inline constexpr std::string_view kPopulationArchiveSha256 =
    "D232645740869A82AAFCAD5839448C50B1DC72965CE042D1374F29B7A798A91C";

inline MeasuredPopulationProvenance PopulationProvenanceV1(
    PopulationMeasurementScope scope
) {
    constexpr std::array<std::string_view, 4> scope_notes{
        "Four clinozoisite-epidote HS299 specimen records",
        "One old road asphalt, three asphalt shingles, and one roof tar",
        "Five cedar shake surfaces from fresh through weathered or mossy",
        "Four Aspen surfaces spanning top, bottom, and yellowing states",
    };
    constexpr std::array<std::string_view, 4> limitations{
        "Specimen spread is a bounded mineral-series prior, not a universal "
        "rock or geological-class distribution",
        "The manufactured asphalt supports differ in use and condition; "
        "this is not a universal road-population distribution",
        "Weathering-state spread is not anatomical, cut-plane, species, or "
        "moisture-conditioned wood variation",
        "Leaf state and viewing surface are confounded; this is not a "
        "species, age, or canopy BRDF distribution",
    };
    const auto index = static_cast<std::size_t>(scope);
    if (index >= scope_notes.size()) {
        throw std::invalid_argument("population scope is invalid");
    }
    return {
        kPopulationSourceUrl,
        "USGS Spectral Library Version 7; ASCIIdata_splib07a.zip",
        kPopulationArchiveSha256,
        "CC0-1.0",
        kPopulationLicenseUrl,
        "ASD full-range reflectance; arithmetic mean of the five raw "
        "channels nearest each 450, 550, and 650 nm center",
        scope_notes[index],
        limitations[index],
    };
}

inline std::vector<MeasuredPopulationMember> StonePopulationMembersV1() {
    return {
        {
            "clinozoisite-epidote-hs299-1b",
            "ChapterS_SoilsAndMixtures/"
            "splib07a_ClinozoisiteEpidote_HS299.1B_ASDFRb_AREF.txt",
            "1A4510E9BAA518E8A8450BED9B177229094B1F6610843DB1E798C7DB41A46264",
            {0.455848546, 0.562535618, 0.696678412},
            {0.00023645326059244673, 0.0006191326679760967,
             0.0004359094776248856},
        },
        {
            "clinozoisite-epidote-hs299-2b",
            "ChapterS_SoilsAndMixtures/"
            "splib07a_ClinozoisiteEpidote_HS299.2B_ASDFRb_AREF.txt",
            "EBF07199BBDC1161BF28D59EF219E2D412CB66A18CFE321115E9E1997657087A",
            {0.29061951399999997, 0.373713028, 0.526812756},
            {0.0006808948390029098, 0.0005494917689749305,
             0.0005490433775548059},
        },
        {
            "clinozoisite-epidote-hs299-4b",
            "ChapterS_SoilsAndMixtures/"
            "splib07a_ClinozoisiteEpidote_HS299.4B_ASDFRb_AREF.txt",
            "B4F3F3179BD185EA2AE673320AAA7BE22F49FDEA576A6D13B089DA6325590462",
            {0.0915081354, 0.12321871000000002, 0.260044878},
            {0.000399436967420753, 0.00017093825193911438,
             0.0005504921479432787},
        },
        {
            "clinozoisite-epidote-hs299-6",
            "ChapterS_SoilsAndMixtures/"
            "splib07a_ClinozoisiteEpidote_HS299.6_ASDFRb_AREF.txt",
            "6841BABD1374FF5EBBD2F6F2A53A8AF9B4F53A9E73A9DD64985AD18112CF3544",
            {0.12923806799999998, 0.13595511799999999,
             0.25318801999999996},
            {0.00035359142215161184, 0.00006937768859799152,
             0.00034250652542688973},
        },
    };
}

inline std::vector<MeasuredPopulationMember> RoadPopulationMembersV1() {
    return {
        {
            "asphalt-gds376-black-road-old",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Asphalt_GDS376_Blck_Road_old_ASDFRa_AREF.txt",
            "1904253C15E0D5EA76964A9A0EA25EC05D4C44BB89E0CA2088CE1318C38741DA",
            {0.0689328, 0.0855793044, 0.10264219999999999},
            {0.0000974307599100004, 0.00014095216194116327,
             0.0000791464223828221},
        },
        {
            "asphalt-shingle-gds366-tan",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Asphalt_Shingle_GDS366_Tan_ASDFRa_AREF.txt",
            "6A2731985C52BAC43F71E179937AED527334FDA113570F84C37424A65D01C93F",
            {0.0625866594, 0.09927986520000001,
             0.14517066399999998},
            {0.00019652706545300055, 0.0003806816309013516,
             0.000033963163763113665},
        },
        {
            "asphalt-shingle-gds367-dark-gray",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Asphalt_Shingle_GDS367_DkGry_ASDFRa_AREF.txt",
            "0E2F109274289972045D0B7F1C154A615B1DF430A23768558CDB08E34F3D46E1",
            {0.0932170198, 0.101376604, 0.100285844},
            {0.000017580481755402048, 0.00003377097162949188,
             0.00004130744481083169},
        },
        {
            "asphalt-shingle-gds368-light-gray",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Asphalt_Shingle_GDS368_Lgray_ASDFRa_AREF.txt",
            "124BF54DB0A0A7C8FEDB1E6EC536B022892112768F30814D9FDD5DAC9825C73A",
            {0.18852483199999998, 0.205962334, 0.200747736},
            {0.000020562683949327946, 0.00006729028462415872,
             0.00005325588663049725},
        },
        {
            "asphalt-tar-gds346-black-roof",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Asphalt_Tar_GDS346_Blck_Roof_ASDFRa_AREF.txt",
            "BD773EF9FEC163DB79C0933424C353E52CA369952A805D856585EC4A18B8C895",
            {0.0257138264, 0.025233995600000003,
             0.0248485268},
            {0.0000015669101978098764, 0.000002408453389210283,
             0.0000012622205956170648},
        },
    };
}

inline std::vector<MeasuredPopulationMember> WoodPopulationMembersV1() {
    return {
        {
            "cedar-shake-gds357-fresh",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Cedar_Shake_GDS357_Fresh_ASDFRa_AREF.txt",
            "3D966E874FAA1F18216CED28294F2AE845D88FC704319A57BFB80815C7732D80",
            {0.0480409542, 0.108354654, 0.259793604},
            {0.0002630122514623829, 0.0006295289823771418,
             0.0012427176181340586},
        },
        {
            "cedar-shake-gds358-slight-weathering",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Cedar_Shake_GDS358_SlgWeathr_ASDFRa_AREF.txt",
            "8A3904455956516E325C7CFD3E1457FB9D4510B9BEE9DBE0AE969E0D8C80B1F2",
            {0.0662773014, 0.1210426, 0.21699616800000002},
            {0.0002886244792134731, 0.0004778919042461373,
             0.0007336508832375222},
        },
        {
            "cedar-shake-gds359-medium-weathering",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Cedar_Shake_GDS359_MedWeathr_ASDFRa_AREF.txt",
            "914CC39B9DBA5B76131C2A520D41941F7A3B5CE69D00A99460959FD5A5E83595",
            {0.0583415724, 0.0895212412, 0.13928342600000002},
            {0.00016890012434681004, 0.0002337863117216916,
             0.0004290844110577768},
        },
        {
            "cedar-shake-gds360-heavy-weathering-moss",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Cedar_Shake_GDS360_H_Weamoss_ASDFRa_AREF.txt",
            "0F040538B33EFD1ECE367C9E8DF643BD28449CDDBC6ADE4FB52A13DE24FF2425",
            {0.0660415918, 0.0903680504, 0.10397026000000001},
            {0.00015560094574941283, 0.00014992980542843302,
             0.00004126771183383145},
        },
        {
            "cedar-shake-gds361-high-weathering",
            "ChapterA_ArtificialMaterials/"
            "splib07a_Cedar_Shake_GDS361_HiWeather_ASDFRa_AREF.txt",
            "3724C0C63F62FAEF52DDE65F038380768C14875ABCF76170C5A6C0319DA09BFC",
            {0.0983347058, 0.12670993800000002, 0.154212712},
            {0.00018971559307624737, 0.0001898138689643096,
             0.00016848175999555615},
        },
    };
}

inline std::vector<MeasuredPopulationMember> LeafPopulationMembersV1() {
    return {
        {
            "aspen-1-green-top",
            "ChapterV_Vegetation/"
            "splib07a_Aspen_Aspen-1_green-top_ASDFRa_AREF.txt",
            "7FEAB239763D663A5AFE52011706B09F8BC496C7E4D8B189F851F1FC9F8690ED",
            {0.056793095800000006, 0.124882122, 0.0607945048},
            {0.00009867516238138134, 0.00021547082806542715,
             0.0001689160717330124},
        },
        {
            "aspen-2-green-bottom",
            "ChapterV_Vegetation/"
            "splib07a_Aspen_Aspen-2_green-bottom_ASDFRa_AREF.txt",
            "4B3542EA6324382CDBF0C79BC1440982FAC2B04435ADCED1F7E792B058DFF67B",
            {0.161844338, 0.281598028, 0.19652748999999997},
            {0.0004999422702704788, 0.0002671496845800128,
             0.0006889801820546094},
        },
        {
            "aspen-3-yellow-green-top",
            "ChapterV_Vegetation/"
            "splib07a_Aspen_Aspen-3_yellowGreenTop_ASDFRa_AREF.txt",
            "E73484BAE92C6A220DFE40CC7CD1337DDA642A7EAC169F6C2B994D5298AB414F",
            {0.059670534600000005, 0.334980088,
             0.23935661599999997},
            {0.00012627735655218626, 0.0008986732032119288,
             0.0014446952908585234},
        },
        {
            "aspen-4-yellow-top",
            "ChapterV_Vegetation/"
            "splib07a_Aspen_Aspen-4_yellow-top_ASDFRa_AREF.txt",
            "8EC4A77EF345ACEF35BB10246035077B8CE2312D6C4274D1EDD9532E159DBF64",
            {0.051875000399999996, 0.391847872,
             0.4345732440000001},
            {0.00013664969292101557, 0.0012883585913414026,
             0.00028439741040451884},
        },
    };
}

inline std::vector<MeasuredPopulationMember> PopulationMembersV1(
    MaterialOpticalFamily family
) {
    switch (family) {
        case MaterialOpticalFamily::stone:
            return StonePopulationMembersV1();
        case MaterialOpticalFamily::road:
            return RoadPopulationMembersV1();
        case MaterialOpticalFamily::wood:
            return WoodPopulationMembersV1();
        case MaterialOpticalFamily::vegetation:
            return LeafPopulationMembersV1();
    }
    throw std::invalid_argument("measured population family is invalid");
}

inline PopulationMeasurementScope PopulationScopeV1(
    MaterialOpticalFamily family
) {
    switch (family) {
        case MaterialOpticalFamily::stone:
            return PopulationMeasurementScope::specimen_series;
        case MaterialOpticalFamily::road:
            return PopulationMeasurementScope::surface_condition_series;
        case MaterialOpticalFamily::wood:
            return PopulationMeasurementScope::weathering_series;
        case MaterialOpticalFamily::vegetation:
            return PopulationMeasurementScope::leaf_state_series;
    }
    throw std::invalid_argument("measured population family is invalid");
}

inline MeasuredPopulationDistribution FitMeasuredPopulationDistribution(
    MaterialOpticalFamily family,
    std::vector<MeasuredPopulationMember> members
) {
    if (members.size() < 4) {
        throw std::invalid_argument(
            "measured population requires at least four members"
        );
    }
    constexpr std::array<std::string_view, 4> stable_ids{
        "measured-stone-specimen-population-v1",
        "measured-road-surface-population-v1",
        "measured-wood-weathering-population-v1",
        "measured-leaf-state-population-v1",
    };
    const auto family_index = MaterialFamilyIndex(family);
    const auto center = BuildResearchedMaterialPresetV1(family)
                            .spectral.fit.spectral_reflectance;
    MeasuredPopulationDistribution result{
        family,
        stable_ids[family_index],
        PopulationScopeV1(family),
        center,
        {},
        {},
        {},
        std::move(members),
        {},
        PopulationProvenanceV1(PopulationScopeV1(family)),
    };
    const double member_count = static_cast<double>(result.members.size());
    for (const auto& member : result.members) {
        for (std::size_t band = 0; band < 3; ++band) {
            result.measured_mean[band] +=
                member.spectral_reflectance[band] / member_count;
        }
    }
    result.centered_factors.reserve(result.members.size());
    for (const auto& member : result.members) {
        std::array<double, 3> factors{};
        for (std::size_t band = 0; band < 3; ++band) {
            factors[band] = member.spectral_reflectance[band] /
                result.measured_mean[band];
            const double population_residual = factors[band] - 1.0;
            result.population_factor_standard_deviation[band] +=
                population_residual * population_residual;
            const double fit_relative_error =
                member.local_fit_standard_error[band] /
                member.spectral_reflectance[band];
            result.fit_relative_standard_error_rms[band] +=
                fit_relative_error * fit_relative_error / member_count;
        }
        result.centered_factors.push_back(factors);
    }
    for (std::size_t band = 0; band < 3; ++band) {
        result.population_factor_standard_deviation[band] = std::sqrt(
            result.population_factor_standard_deviation[band] /
            (member_count - 1.0)
        );
        result.fit_relative_standard_error_rms[band] = std::sqrt(
            result.fit_relative_standard_error_rms[band]
        );
    }
    return result;
}

inline MeasuredPopulationDistribution
BuildMeasuredPopulationDistributionV1(MaterialOpticalFamily family) {
    return FitMeasuredPopulationDistribution(
        family,
        PopulationMembersV1(family)
    );
}

inline std::array<MeasuredPopulationDistribution, 4>
BuildMeasuredPopulationDistributionsV1() {
    return {
        BuildMeasuredPopulationDistributionV1(
            MaterialOpticalFamily::stone
        ),
        BuildMeasuredPopulationDistributionV1(
            MaterialOpticalFamily::road
        ),
        BuildMeasuredPopulationDistributionV1(
            MaterialOpticalFamily::wood
        ),
        BuildMeasuredPopulationDistributionV1(
            MaterialOpticalFamily::vegetation
        ),
    };
}

inline void ValidateMeasuredPopulationDistribution(
    const MeasuredPopulationDistribution& distribution
) {
    if (distribution.stable_id.empty() ||
        !distribution.provenance.source_url.starts_with("https://") ||
        distribution.provenance.source_version.empty() ||
        !IsUpperHexSha256(
            distribution.provenance.source_archive_sha256
        ) ||
        distribution.provenance.license != "CC0-1.0" ||
        !distribution.provenance.license_url.starts_with("https://") ||
        distribution.provenance.measurement_conditions.empty() ||
        distribution.provenance.population_scope_note.empty() ||
        distribution.provenance.limitation.empty()) {
        throw std::invalid_argument(
            "measured population provenance is invalid"
        );
    }
    for (std::size_t index = 0;
         index < distribution.members.size();
         ++index) {
        const auto& member = distribution.members[index];
        if (member.stable_id.empty() || member.source_entry.empty() ||
            !IsUpperHexSha256(member.source_sha256)) {
            throw std::invalid_argument(
                "measured population member provenance is invalid"
            );
        }
        for (std::size_t other = 0; other < index; ++other) {
            if (distribution.members[other].stable_id == member.stable_id ||
                distribution.members[other].source_entry ==
                    member.source_entry) {
                throw std::invalid_argument(
                    "measured population member is duplicate"
                );
            }
        }
        for (std::size_t band = 0; band < 3; ++band) {
            const double value = member.spectral_reflectance[band];
            const double fit_error =
                member.local_fit_standard_error[band];
            if (!std::isfinite(value) || value <= 0.0 || value > 1.0 ||
                !std::isfinite(fit_error) || fit_error < 0.0 ||
                fit_error >= value) {
                throw std::invalid_argument(
                    "measured population observation is invalid"
                );
            }
        }
    }
    const auto recomputed = FitMeasuredPopulationDistribution(
        distribution.family,
        distribution.members
    );
    if (recomputed != distribution) {
        throw std::invalid_argument(
            "measured population statistics or semantics changed"
        );
    }
}

}  // namespace vf::material
