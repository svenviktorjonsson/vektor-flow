#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <limits>
#include <stdexcept>
#include <vector>

namespace vkf::material {

struct RoadMaterialSample {
    float aggregate_fraction = 0.0f;
    float binder_fraction = 0.0f;
    float water_coverage = 0.0f;
    std::array<float, 3> albedo{};
};

struct RoadMaterialEnergy {
    std::size_t sample_count = 0;
    std::array<float, 5> cosine_probes{1.0f, 0.75f, 0.5f, 0.25f, 0.0f};
    std::vector<float> fresnel_f0;
    std::vector<float> energy_rgb;
    float minimum_energy = 0.0f;
    float maximum_energy = 0.0f;
    std::size_t violations = 0;
    bool truncated = false;
};

inline float DielectricF0(float ior) {
    const float ratio = (ior - 1.0f) / (ior + 1.0f);
    return ratio * ratio;
}

inline RoadMaterialEnergy EvaluateRoadMaterialWhiteFurnace(
    const std::vector<RoadMaterialSample>& samples,
    std::size_t sample_budget
) {
    constexpr std::size_t max_sample_budget = 65536;
    if (sample_budget > max_sample_budget) {
        throw std::range_error("road material sample budget exceeds 65536");
    }
    const float aggregate_f0 = DielectricF0(1.56f);
    const float binder_f0 = DielectricF0(1.52f);
    const float water_f0 = DielectricF0(4.0f / 3.0f);
    RoadMaterialEnergy result;
    result.sample_count = std::min(samples.size(), sample_budget);
    result.truncated = result.sample_count < samples.size();
    result.fresnel_f0.resize(result.sample_count);
    result.energy_rgb.resize(
        result.sample_count * result.cosine_probes.size() * 3);
    float minimum_energy = std::numeric_limits<float>::infinity();
    float maximum_energy = -std::numeric_limits<float>::infinity();

    for (std::size_t sample = 0; sample < result.sample_count; ++sample) {
        const auto& material = samples[sample];
        const float aggregate_term =
            material.aggregate_fraction * aggregate_f0;
        const float binder_term = material.binder_fraction * binder_f0;
        const float dry_f0 = aggregate_term + binder_term;
        const float coverage = material.water_coverage;
        const float water_term = coverage * (water_f0 - dry_f0);
        const float surface_f0 = dry_f0 + water_term;
        result.fresnel_f0[sample] = surface_f0;

        for (std::size_t probe = 0;
             probe < result.cosine_probes.size(); ++probe) {
            const float one_minus_cosine =
                1.0f - result.cosine_probes[probe];
            const float square = one_minus_cosine * one_minus_cosine;
            const float fourth = square * square;
            const float fifth_power = fourth * one_minus_cosine;
            const float fresnel_term =
                (1.0f - surface_f0) * fifth_power;
            const float fresnel = surface_f0 + fresnel_term;
            const std::size_t output =
                (sample * result.cosine_probes.size() + probe) * 3;
            for (std::size_t channel = 0; channel < 3; ++channel) {
                const float albedo = material.albedo[channel];
                const float diffuse_term = (1.0f - fresnel) * albedo;
                const float energy = fresnel + diffuse_term;
                result.energy_rgb[output + channel] = energy;
                minimum_energy = std::min(minimum_energy, energy);
                maximum_energy = std::max(maximum_energy, energy);
                if (energy < -1.0e-7f || energy > 1.0f + 1.0e-7f) {
                    ++result.violations;
                }
            }
        }
    }
    if (result.sample_count != 0) {
        result.minimum_energy = minimum_energy;
        result.maximum_energy = maximum_energy;
    }
    return result;
}

}  // namespace vkf::material
