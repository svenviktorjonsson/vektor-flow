#pragma once

#include "native/material/vf_deterministic_packet_reference.hpp"
#include "native/material/vf_forest_population_residency.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct ForestPopulationQualityReport {
    std::size_t tree_count;
    std::vector<std::size_t> species_counts;
    std::size_t mark_bound_violations;
    double mean_age;
    double mean_size;
    double mean_health;
    double age_size_correlation;
    double minimum_within_patch_spacing;
    std::uint64_t population_version;
};

inline bool operator==(
    const ForestPopulationQualityReport& first,
    const ForestPopulationQualityReport& second
) {
    return first.tree_count == second.tree_count &&
        first.species_counts == second.species_counts &&
        first.mark_bound_violations ==
            second.mark_bound_violations &&
        first.mean_age == second.mean_age &&
        first.mean_size == second.mean_size &&
        first.mean_health == second.mean_health &&
        first.age_size_correlation ==
            second.age_size_correlation &&
        first.minimum_within_patch_spacing ==
            second.minimum_within_patch_spacing &&
        first.population_version == second.population_version;
}

inline ForestPopulationQualityReport
AuditForestPopulationQualityReference(
    const ForestPopulationRealization& population,
    std::uint32_t species_count
) {
    if (population.trees.empty() || species_count == 0) {
        throw std::invalid_argument(
            "forest quality audit requires trees and species"
        );
    }
    std::vector<std::size_t> species_counts(species_count, 0);
    std::size_t violations = 0;
    double sum_age = 0.0;
    double sum_size = 0.0;
    double sum_health = 0.0;
    double sum_age_squared = 0.0;
    double sum_size_squared = 0.0;
    double sum_age_size = 0.0;
    double minimum_spacing =
        std::numeric_limits<double>::infinity();
    for (std::size_t first_index = 0;
         first_index < population.trees.size();
         ++first_index) {
        const auto& tree = population.trees[first_index];
        const bool finite_position = std::all_of(
            tree.position.begin(),
            tree.position.end(),
            [](double value) { return std::isfinite(value); }
        );
        const bool bounded = tree.species_id < species_count &&
            finite_position && std::isfinite(tree.age) &&
            tree.age >= 0.0f && tree.age <= 1.0f &&
            std::isfinite(tree.size) && tree.size >= 0.0f &&
            tree.size <= 1.0f && std::isfinite(tree.health) &&
            tree.health >= 0.0f && tree.health <= 1.0f &&
            std::isfinite(tree.orientation) &&
            std::isfinite(tree.environment_variation) &&
            std::isfinite(tree.individual_variation);
        if (!bounded) {
            ++violations;
        } else {
            ++species_counts[tree.species_id];
        }
        sum_age += tree.age;
        sum_size += tree.size;
        sum_health += tree.health;
        sum_age_squared += tree.age * tree.age;
        sum_size_squared += tree.size * tree.size;
        sum_age_size += tree.age * tree.size;
        for (std::size_t second_index = first_index + 1;
             second_index < population.trees.size();
             ++second_index) {
            const auto& other = population.trees[second_index];
            if (tree.patch_id != other.patch_id) continue;
            const double dx = tree.position[0] - other.position[0];
            const double dy = tree.position[1] - other.position[1];
            minimum_spacing = std::min(
                minimum_spacing,
                std::hypot(dx, dy)
            );
        }
    }
    const double count =
        static_cast<double>(population.trees.size());
    const double mean_age = sum_age / count;
    const double mean_size = sum_size / count;
    const double mean_health = sum_health / count;
    const double age_variance =
        sum_age_squared / count - mean_age * mean_age;
    const double size_variance =
        sum_size_squared / count - mean_size * mean_size;
    const double covariance =
        sum_age_size / count - mean_age * mean_size;
    const double correlation =
        age_variance > 0.0 && size_variance > 0.0
        ? covariance / std::sqrt(age_variance * size_variance)
        : 0.0;
    const auto bytes = PackForestPopulationBytesReference(population);
    return {
        population.trees.size(),
        std::move(species_counts),
        violations,
        mean_age,
        mean_size,
        mean_health,
        correlation,
        minimum_spacing,
        HashDeterministicPacketBytes(bytes),
    };
}

}  // namespace vf::material
