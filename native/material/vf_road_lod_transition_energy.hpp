#pragma once

#include "native/material/vf_road_lod_transition.hpp"
#include "native/material/vf_road_material_energy.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <map>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vkf::material {

struct RoadLodCoveredMaterial {
    vf::material::RoadLodCoverage coverage;
    RoadMaterialSample material;
};

struct RoadLodTransitionEnergy {
    std::size_t material_evaluations;
    std::vector<std::uint64_t> cell_ids;
    std::vector<float> energy_rgb;
    float minimum_energy;
    float maximum_energy;
    std::size_t violations;
};

inline RoadLodTransitionEnergy EvaluateRoadLodTransitionEnergyReference(
    const std::vector<RoadLodCoveredMaterial>& materials,
    std::size_t material_budget
) {
    if (materials.size() > material_budget) {
        throw std::range_error("road LOD transition exceeds material budget");
    }
    auto canonical = materials;
    std::sort(
        canonical.begin(),
        canonical.end(),
        [](const auto& first, const auto& second) {
            return first.coverage.key < second.coverage.key;
        }
    );
    std::map<std::uint64_t, double> coverage_by_cell;
    std::vector<RoadMaterialSample> samples;
    samples.reserve(canonical.size());
    for (std::size_t index = 0; index < canonical.size(); ++index) {
        const auto& entry = canonical[index];
        if (
            !std::isfinite(entry.coverage.coverage) ||
            entry.coverage.coverage < 0.0 ||
            entry.coverage.coverage > 1.0
        ) {
            throw std::invalid_argument(
                "road LOD material coverage is invalid");
        }
        if (
            index != 0 &&
            canonical[index - 1].coverage.key == entry.coverage.key
        ) {
            throw std::invalid_argument("road LOD material key is duplicated");
        }
        auto& cell_coverage = coverage_by_cell[entry.coverage.key.cell_id];
        cell_coverage += entry.coverage.coverage;
        if (cell_coverage > 1.0) {
            throw std::invalid_argument("road LOD cell coverage exceeds one");
        }
        samples.push_back(entry.material);
    }
    const auto evaluated = EvaluateRoadMaterialWhiteFurnace(
        samples,
        samples.size()
    );
    std::vector<std::uint64_t> cell_ids;
    std::map<std::uint64_t, std::size_t> cell_offsets;
    for (const auto& [cell_id, coverage] : coverage_by_cell) {
        static_cast<void>(coverage);
        cell_offsets.emplace(cell_id, cell_ids.size());
        cell_ids.push_back(cell_id);
    }
    constexpr std::size_t values_per_material = 15;
    std::vector<float> energy_rgb(
        cell_ids.size() * values_per_material,
        0.0f
    );
    for (std::size_t sample = 0; sample < canonical.size(); ++sample) {
        const auto output_cell = cell_offsets.at(
            canonical[sample].coverage.key.cell_id
        );
        const float coverage = static_cast<float>(
            canonical[sample].coverage.coverage
        );
        for (std::size_t value = 0; value < values_per_material; ++value) {
            energy_rgb[output_cell * values_per_material + value] +=
                evaluated.energy_rgb[sample * values_per_material + value] *
                coverage;
        }
    }

    float minimum_energy = 0.0f;
    float maximum_energy = 0.0f;
    std::size_t violations = 0;
    if (!energy_rgb.empty()) {
        minimum_energy = std::numeric_limits<float>::infinity();
        maximum_energy = -std::numeric_limits<float>::infinity();
        for (const float energy : energy_rgb) {
            minimum_energy = std::min(minimum_energy, energy);
            maximum_energy = std::max(maximum_energy, energy);
            if (energy < -1.0e-7f || energy > 1.0f + 1.0e-7f) {
                ++violations;
            }
        }
    }
    return {
        canonical.size(),
        std::move(cell_ids),
        std::move(energy_rgb),
        minimum_energy,
        maximum_energy,
        violations,
    };
}

}  // namespace vkf::material
