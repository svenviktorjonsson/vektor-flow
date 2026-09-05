#pragma once

#include "native/material/vf_road_lod_transition_energy.hpp"

#include <algorithm>
#include <cstddef>
#include <limits>
#include <map>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vkf::material {

struct RoadLodKeyedMaterial {
    vf::material::RoadProjectedPacketKey key;
    RoadMaterialSample material;
};

struct RoadLodTransitionEnergyPathReport {
    std::vector<RoadLodTransitionEnergy> frames;
    std::vector<std::size_t> material_evaluations;
    std::size_t peak_material_evaluations;
    float minimum_energy;
    float maximum_energy;
    std::size_t violations;
};

inline RoadLodTransitionEnergyPathReport
AuditRoadLodTransitionEnergyPathReference(
    const std::vector<vf::material::RoadProjectedPacketKey>& previous,
    const std::vector<vf::material::RoadProjectedPacketKey>& current,
    const std::vector<RoadLodKeyedMaterial>& materials,
    const std::vector<double>& progress,
    std::size_t material_budget
) {
    if (
        progress.empty() ||
        progress.front() != 0.0 ||
        progress.back() != 1.0
    ) {
        throw std::invalid_argument(
            "road LOD energy path must include both endpoints"
        );
    }
    for (std::size_t index = 1; index < progress.size(); ++index) {
        if (progress[index] < progress[index - 1]) {
            throw std::invalid_argument(
                "road LOD energy path must not backtrack"
            );
        }
    }

    std::map<vf::material::RoadProjectedPacketKey, RoadMaterialSample>
        material_by_key;
    for (const auto& entry : materials) {
        if (!material_by_key.emplace(entry.key, entry.material).second) {
            throw std::invalid_argument("road LOD material key is duplicated");
        }
    }

    RoadLodTransitionEnergyPathReport report{
        {},
        {},
        0,
        std::numeric_limits<float>::infinity(),
        -std::numeric_limits<float>::infinity(),
        0,
    };
    report.frames.reserve(progress.size());
    report.material_evaluations.reserve(progress.size());
    for (const double position : progress) {
        const auto coverage =
            vf::material::PlanRoadLodCoverageTransitionReference(
                previous,
                current,
                position,
                material_budget
            );
        std::vector<RoadLodCoveredMaterial> covered;
        covered.reserve(coverage.size());
        for (const auto& entry : coverage) {
            covered.push_back({entry, material_by_key.at(entry.key)});
        }
        auto frame = EvaluateRoadLodTransitionEnergyReference(
            covered,
            material_budget
        );
        report.material_evaluations.push_back(
            frame.material_evaluations
        );
        report.peak_material_evaluations = std::max(
            report.peak_material_evaluations,
            frame.material_evaluations
        );
        report.minimum_energy = std::min(
            report.minimum_energy,
            frame.minimum_energy
        );
        report.maximum_energy = std::max(
            report.maximum_energy,
            frame.maximum_energy
        );
        report.violations += frame.violations;
        report.frames.push_back(std::move(frame));
    }
    return report;
}

}  // namespace vkf::material
