#include "native/material/vf_leaf_species_conditioned_distribution.hpp"
#include "native/material/vf_tree_canopy_leaf_species.hpp"

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

    const auto distribution =
        BuildLeafSpeciesConditionedDistributionV1();
    ValidateLeafSpeciesConditionedDistribution(distribution);
    require(distribution.members.size() == 9,
            "leaf species coverage changed");
    require(distribution.provenance.license == "CC-BY-4.0" &&
                distribution.provenance.population_variation_note !=
                    distribution.provenance.uncertainty_note,
            "population variation and uncertainty were conflated");

    for (std::size_t band = 0; band < 3; ++band) {
        double factor_sum = 0.0;
        for (const auto& member : distribution.members) {
            factor_sum += member.centered_factor[band];
            require_near(
                member.centered_factor[band] *
                    distribution.measured_species_mean[band],
                member.mean_spectral_reflectance[band],
                1.0e-14,
                "species factor does not reconstruct its measurement"
            );
            require(member.reported_spectral_mean_error[band] > 0.0,
                    "reported measurement uncertainty was discarded");
        }
        require_near(
            factor_sum /
                static_cast<double>(distribution.members.size()),
            1.0,
            1.0e-14,
            "species factors moved the calibrated leaf center"
        );
        require(
            distribution.species_factor_standard_deviation[band] >
                distribution.reported_relative_mean_error_rms[band],
            "reported uncertainty replaced species variation"
        );
    }
    require_near(
        distribution.members[2].mean_spectral_reflectance[1],
        0.06696810754716982,
        1.0e-14,
        "English oak source fit changed"
    );

    const TreeCanopyHierarchicalDefinition definition{
        {
            {0x1f83d9abfb41bd6bull, 0x5be0cd19137e2179ull},
            19,
            9,
            1000,
            1000,
        },
        1000,
    };
    const TreeCanopyHierarchicalDemand leaf_demand{
        30,
        17,
        2,
        {10.0, 10.0},
        20,
        TreeCanopyPrimitiveKind::foliage,
        {0.8, 0.1, 4.2},
        {0.2, 0.3, 1.0},
    };
    const auto generic = SampleTreeCanopyHierarchicalReference(
        definition,
        leaf_demand
    );
    const auto oak = SampleTreeCanopyLeafSpeciesReference(
        definition,
        leaf_demand,
        LeafSpeciesConditionV1::quercus_robur
    );
    const auto lime = SampleTreeCanopyLeafSpeciesReference(
        definition,
        leaf_demand,
        LeafSpeciesConditionV1::tilia_platyphyllos
    );
    require(oak.base_color != generic.base_color &&
                oak.base_color != lime.base_color,
            "measured species condition did not reach the generator");
    require(oak.primitive_variation == generic.primitive_variation &&
                oak.radius == generic.radius &&
                oak.extent == generic.extent,
            "spectral conditioning changed unrelated geometry");

    auto inflated_uncertainty = distribution;
    for (auto& value :
         inflated_uncertainty.members[2]
             .reported_spectral_mean_error) {
        value *= 100.0;
    }
    const auto unchanged = ApplyLeafSpeciesConditionReference(
        generic,
        inflated_uncertainty,
        LeafSpeciesConditionV1::quercus_robur
    );
    require(unchanged.base_color == oak.base_color,
            "fit uncertainty was sampled as population variation");

    auto bark_demand = leaf_demand;
    bark_demand.kind = TreeCanopyPrimitiveKind::bark;
    const auto bark = SampleTreeCanopyHierarchicalReference(
        definition,
        bark_demand
    );
    require(ApplyLeafSpeciesConditionReference(
                bark,
                distribution,
                LeafSpeciesConditionV1::quercus_robur
            ) == bark,
            "leaf measurements changed bark material");

    const std::vector<LeafSpeciesConditionV1> species{
        LeafSpeciesConditionV1::carpinus_betulus_fastigiata,
        LeafSpeciesConditionV1::acer_campestre,
        LeafSpeciesConditionV1::quercus_robur,
        LeafSpeciesConditionV1::platanus_acerifolia,
        LeafSpeciesConditionV1::tilia_platyphyllos,
        LeafSpeciesConditionV1::acer_freemanii,
        LeafSpeciesConditionV1::betula_pendula,
        LeafSpeciesConditionV1::acer_platanoides_schwedleri,
        LeafSpeciesConditionV1::aesculus_hippocastanum,
    };
    std::vector<std::array<float, 3>> forward;
    for (const auto value : species) {
        forward.push_back(
            ApplyLeafSpeciesConditionReference(
                generic,
                distribution,
                value
            ).base_color
        );
    }
    auto reverse_species = species;
    std::reverse(reverse_species.begin(), reverse_species.end());
    std::vector<std::array<float, 3>> reverse;
    for (const auto value : reverse_species) {
        reverse.push_back(
            ApplyLeafSpeciesConditionReference(
                generic,
                distribution,
                value
            ).base_color
        );
    }
    std::reverse(reverse.begin(), reverse.end());
    require(reverse == forward,
            "species conditioning depended on traversal order");

    auto invalid = distribution;
    invalid.members[1].stable_id = invalid.members[0].stable_id;
    bool rejected_duplicate = false;
    try {
        ValidateLeafSpeciesConditionedDistribution(invalid);
    } catch (const std::invalid_argument&) {
        rejected_duplicate = true;
    }
    require(rejected_duplicate,
            "duplicate species evidence was accepted");

    bool rejected_unknown = false;
    try {
        static_cast<void>(ApplyLeafSpeciesConditionReference(
            generic,
            distribution,
            static_cast<LeafSpeciesConditionV1>(99)
        ));
    } catch (const std::invalid_argument&) {
        rejected_unknown = true;
    }
    require(rejected_unknown,
            "unsupported species was silently approximated");

    const auto energy = EvaluateTreeCanopyEnergyReference({oak, lime});
    require(energy.violations == 0 && energy.minimum >= 0.0f &&
                energy.maximum <= 1.0f,
            "conditioned foliage escaped passive energy bounds");

    std::cout << "conditioned leaf species: species="
              << distribution.members.size()
              << " source_sha="
              << distribution.provenance.source_artifact_sha256
              << " uncertainty_sampled=false\n";
    return 0;
}
