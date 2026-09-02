#pragma once

#include "native/material/vf_deterministic_packet_reference.hpp"
#include "native/material/vf_forest_population_residency.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vf::material {

struct ForestSpatialQualityReport {
    std::size_t tree_count;
    std::size_t near_pair_count;
    std::size_t far_pair_count;
    double near_environment_similarity;
    double far_environment_similarity;
    double near_same_species_fraction;
    double far_same_species_fraction;
    double health_environment_correlation;
    double orientation_resultant;
    std::uint64_t population_version;
};

inline bool operator==(
    const ForestSpatialQualityReport& first,
    const ForestSpatialQualityReport& second
) {
    return first.tree_count == second.tree_count &&
        first.near_pair_count == second.near_pair_count &&
        first.far_pair_count == second.far_pair_count &&
        first.near_environment_similarity ==
            second.near_environment_similarity &&
        first.far_environment_similarity ==
            second.far_environment_similarity &&
        first.near_same_species_fraction ==
            second.near_same_species_fraction &&
        first.far_same_species_fraction ==
            second.far_same_species_fraction &&
        first.health_environment_correlation ==
            second.health_environment_correlation &&
        first.orientation_resultant ==
            second.orientation_resultant &&
        first.population_version == second.population_version;
}

inline ForestSpatialQualityReport
AuditForestSpatialQualityReference(
    const ForestPopulationRealization& population,
    double near_distance,
    double far_distance
) {
    if (population.trees.size() < 2 ||
        !std::isfinite(near_distance) || near_distance <= 0.0 ||
        !std::isfinite(far_distance) ||
        far_distance <= near_distance) {
        throw std::invalid_argument(
            "forest spatial quality thresholds are invalid"
        );
    }
    const double near_squared = near_distance * near_distance;
    const double far_squared = far_distance * far_distance;
    std::size_t near_pairs = 0;
    std::size_t far_pairs = 0;
    double near_environment_sum = 0.0;
    double far_environment_sum = 0.0;
    std::size_t near_same_species = 0;
    std::size_t far_same_species = 0;
    for (std::size_t first_index = 0;
         first_index < population.trees.size();
         ++first_index) {
        const auto& first = population.trees[first_index];
        for (std::size_t second_index = first_index + 1;
             second_index < population.trees.size();
             ++second_index) {
            const auto& second = population.trees[second_index];
            const double dx = first.position[0] - second.position[0];
            const double dy = first.position[1] - second.position[1];
            const double distance_squared = dx * dx + dy * dy;
            const double similarity = 1.0 - 0.5 * std::abs(
                first.environment_variation -
                second.environment_variation
            );
            if (distance_squared <= near_squared) {
                ++near_pairs;
                near_environment_sum += similarity;
                near_same_species += static_cast<std::size_t>(
                    first.species_id == second.species_id
                );
            } else if (distance_squared >= far_squared) {
                ++far_pairs;
                far_environment_sum += similarity;
                far_same_species += static_cast<std::size_t>(
                    first.species_id == second.species_id
                );
            }
        }
    }
    if (near_pairs == 0 || far_pairs == 0) {
        throw std::invalid_argument(
            "forest spatial quality has insufficient pairs"
        );
    }
    double environment_sum = 0.0;
    double health_sum = 0.0;
    double environment_squared_sum = 0.0;
    double health_squared_sum = 0.0;
    double environment_health_sum = 0.0;
    double orientation_x = 0.0;
    double orientation_y = 0.0;
    for (const auto& tree : population.trees) {
        const double environment = tree.environment_variation;
        const double health = tree.health;
        environment_sum += environment;
        health_sum += health;
        environment_squared_sum += environment * environment;
        health_squared_sum += health * health;
        environment_health_sum += environment * health;
        orientation_x += std::cos(tree.orientation);
        orientation_y += std::sin(tree.orientation);
    }
    const double count =
        static_cast<double>(population.trees.size());
    const double mean_environment = environment_sum / count;
    const double mean_health = health_sum / count;
    const double environment_variance =
        environment_squared_sum / count -
        mean_environment * mean_environment;
    const double health_variance = health_squared_sum / count -
        mean_health * mean_health;
    const double covariance =
        environment_health_sum / count -
        mean_environment * mean_health;
    const double health_environment_correlation =
        environment_variance > 0.0 && health_variance > 0.0
        ? covariance /
            std::sqrt(environment_variance * health_variance)
        : 0.0;
    orientation_x /= count;
    orientation_y /= count;
    const auto bytes = PackForestPopulationBytesReference(population);
    return {
        population.trees.size(),
        near_pairs,
        far_pairs,
        near_environment_sum / static_cast<double>(near_pairs),
        far_environment_sum / static_cast<double>(far_pairs),
        static_cast<double>(near_same_species) /
            static_cast<double>(near_pairs),
        static_cast<double>(far_same_species) /
            static_cast<double>(far_pairs),
        health_environment_correlation,
        std::hypot(orientation_x, orientation_y),
        HashDeterministicPacketBytes(bytes),
    };
}

}  // namespace vf::material
