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

template<class Arithmetic>
struct RoadMaterialEnergyAtPrecision {
    std::size_t sample_count = 0;
    std::array<float, 5> cosine_probes{1.0f, 0.75f, 0.5f, 0.25f, 0.0f};
    std::vector<float> fresnel_f0;
    std::vector<float> energy_rgb;
    Arithmetic minimum_energy = 0;
    Arithmetic maximum_energy = 0;
    std::size_t violations = 0;
    bool truncated = false;
};
using RoadMaterialEnergy = RoadMaterialEnergyAtPrecision<float>;

template<class Arithmetic>
inline Arithmetic DielectricF0AtPrecision(Arithmetic ior) {
    const Arithmetic ratio = (ior - Arithmetic(1)) / (ior + Arithmetic(1));
    return ratio * ratio;
}
inline float DielectricF0(float ior) { return DielectricF0AtPrecision(ior); }

// Private shared arithmetic kernel. Entry adapters own their existing distinct
// validation contracts; no target-specific copy of the energy equations exists.
template<class Arithmetic, class SampleAt>
inline RoadMaterialEnergyAtPrecision<Arithmetic> EvaluateRoadMaterialEnergyKernel(
    std::size_t available, std::size_t sample_budget, const SampleAt& sample_at
) {
    const Arithmetic aggregate_f0 = DielectricF0AtPrecision(Arithmetic(1.56));
    const Arithmetic binder_f0 = DielectricF0AtPrecision(Arithmetic(1.52));
    const Arithmetic water_f0 = DielectricF0AtPrecision(Arithmetic(4) / Arithmetic(3));
    RoadMaterialEnergyAtPrecision<Arithmetic> result;
    result.sample_count = std::min(available, sample_budget);
    result.truncated = result.sample_count < available;
    result.fresnel_f0.resize(result.sample_count);
    result.energy_rgb.resize(
        result.sample_count * result.cosine_probes.size() * 3);
    Arithmetic minimum_energy = std::numeric_limits<Arithmetic>::infinity();
    Arithmetic maximum_energy = -std::numeric_limits<Arithmetic>::infinity();

    for (std::size_t sample = 0; sample < result.sample_count; ++sample) {
        const auto material = sample_at(sample);
        const Arithmetic aggregate_term =
            material.aggregate_fraction * aggregate_f0;
        const Arithmetic binder_term = material.binder_fraction * binder_f0;
        const Arithmetic dry_f0 = aggregate_term + binder_term;
        const Arithmetic coverage = material.water_coverage;
        const Arithmetic water_term = coverage * (water_f0 - dry_f0);
        const Arithmetic surface_f0 = dry_f0 + water_term;
        result.fresnel_f0[sample] = static_cast<float>(surface_f0);

        for (std::size_t probe = 0;
             probe < result.cosine_probes.size(); ++probe) {
            const Arithmetic one_minus_cosine =
                Arithmetic(1) - result.cosine_probes[probe];
            const Arithmetic square = one_minus_cosine * one_minus_cosine;
            const Arithmetic fourth = square * square;
            const Arithmetic fifth_power = fourth * one_minus_cosine;
            const Arithmetic fresnel_term =
                (Arithmetic(1) - surface_f0) * fifth_power;
            const Arithmetic fresnel = surface_f0 + fresnel_term;
            const std::size_t output =
                (sample * result.cosine_probes.size() + probe) * 3;
            for (std::size_t channel = 0; channel < 3; ++channel) {
                const Arithmetic albedo = material.albedo[channel];
                const Arithmetic diffuse_term = (Arithmetic(1) - fresnel) * albedo;
                const Arithmetic energy = fresnel + diffuse_term;
                result.energy_rgb[output + channel] = static_cast<float>(energy);
                minimum_energy = std::min(minimum_energy, energy);
                maximum_energy = std::max(maximum_energy, energy);
                if (energy < -Arithmetic(1.0e-7) || energy > Arithmetic(1) + Arithmetic(1.0e-7)) {
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

inline RoadMaterialEnergy EvaluateRoadMaterialWhiteFurnace(
    const std::vector<RoadMaterialSample>& samples, std::size_t sample_budget
) {
    if (sample_budget > 65536) throw std::range_error("road material sample budget exceeds 65536");
    return EvaluateRoadMaterialEnergyKernel<float>(samples.size(), sample_budget,
        [&](std::size_t sample) { return samples[sample]; });
}

}  // namespace vkf::material
