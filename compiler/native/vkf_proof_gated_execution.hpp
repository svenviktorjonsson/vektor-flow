#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iomanip>
#include <limits>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace vkf::proof_gated_execution {

inline constexpr std::uint32_t schema_version = 1;
inline constexpr std::size_t minimum_paired_samples = 5;

// A proof applies to one implementation, host, workload shape, and oracle.
// Keeping these dimensions separate prevents an FFT win from authorizing a
// symbolic strategy, or one vector size from authorizing every other size.
struct Key {
    std::string optimizer;
    std::string implementation;
    std::string host;
    std::string workload_family;
    std::string workload_shape;
    std::string oracle;
};

inline bool operator==(const Key& left, const Key& right) {
    return left.optimizer == right.optimizer &&
        left.implementation == right.implementation &&
        left.host == right.host &&
        left.workload_family == right.workload_family &&
        left.workload_shape == right.workload_shape &&
        left.oracle == right.oracle;
}

inline bool operator!=(const Key& left, const Key& right) {
    return !(left == right);
}

struct PairedTiming {
    double baseline_ns = 0.0;
    double candidate_ns = 0.0;
};

struct Evidence {
    Key key;
    bool equivalent_output = false;
    std::vector<PairedTiming> timings;
};

enum class Rejection {
    None,
    KeyMismatch,
    IncorrectOutput,
    InsufficientSamples,
    InvalidTiming,
    NotFaster,
    Unproven,
};

struct Decision {
    bool use_candidate = false;
    Rejection rejection = Rejection::InsufficientSamples;
    std::size_t sample_count = 0;
    double observed_ratio = std::numeric_limits<double>::infinity();
    double upper_confidence_ratio = std::numeric_limits<double>::infinity();
};

inline std::uint64_t fnv1a(
    std::string_view value,
    std::uint64_t hash = 1469598103934665603ull
) {
    for (const unsigned char byte : value) {
        hash ^= byte;
        hash *= 1099511628211ull;
    }
    return hash;
}

inline std::string fingerprint(const Key& key) {
    std::uint64_t hash = fnv1a("vkf-proof-gate-v1");
    const auto append = [&](std::string_view field) {
        hash = fnv1a("\n", hash);
        hash = fnv1a(field, hash);
    };
    append(key.optimizer);
    append(key.implementation);
    append(key.host);
    append(key.workload_family);
    append(key.workload_shape);
    append(key.oracle);
    std::ostringstream out;
    out << std::hex << std::setfill('0') << std::setw(16) << hash;
    return out.str();
}

// One-sided 95% Student-t critical values. Samples above 30 use the normal
// limit. The minimum sample count is five, but the complete table keeps the
// statistical rule well-defined for every accepted evidence size.
inline double one_sided_t95(std::size_t degrees_of_freedom) {
    static constexpr double critical[] = {
        0.0, 6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895,
        1.860, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753,
        1.746, 1.740, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714,
        1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697,
    };
    return degrees_of_freedom < (sizeof(critical) / sizeof(critical[0]))
        ? critical[degrees_of_freedom]
        : 1.645;
}

inline Decision assess(
    const Key& expected,
    const Evidence& evidence,
    std::size_t minimum_samples = minimum_paired_samples
) {
    Decision decision;
    decision.sample_count = evidence.timings.size();
    if (evidence.key != expected) {
        decision.rejection = Rejection::KeyMismatch;
        return decision;
    }
    if (!evidence.equivalent_output) {
        decision.rejection = Rejection::IncorrectOutput;
        return decision;
    }
    if (evidence.timings.size() < minimum_samples || evidence.timings.size() < 2) {
        decision.rejection = Rejection::InsufficientSamples;
        return decision;
    }

    std::vector<double> log_ratios;
    log_ratios.reserve(evidence.timings.size());
    for (const auto& timing : evidence.timings) {
        if (!std::isfinite(timing.baseline_ns) ||
            !std::isfinite(timing.candidate_ns) ||
            !(timing.baseline_ns > 0.0) || !(timing.candidate_ns > 0.0)) {
            decision.rejection = Rejection::InvalidTiming;
            return decision;
        }
        log_ratios.push_back(std::log(timing.candidate_ns / timing.baseline_ns));
    }

    double mean_log_ratio = 0.0;
    for (const double value : log_ratios) mean_log_ratio += value;
    mean_log_ratio /= static_cast<double>(log_ratios.size());
    decision.observed_ratio = std::exp(mean_log_ratio);
    if (!(mean_log_ratio < 0.0)) {
        decision.upper_confidence_ratio = decision.observed_ratio;
        decision.rejection = Rejection::NotFaster;
        return decision;
    }

    double squared_deviation = 0.0;
    for (const double value : log_ratios) {
        const double deviation = value - mean_log_ratio;
        squared_deviation += deviation * deviation;
    }
    const double sample_deviation = std::sqrt(
        squared_deviation / static_cast<double>(log_ratios.size() - 1));
    const double standard_error =
        sample_deviation / std::sqrt(static_cast<double>(log_ratios.size()));
    const double upper_log_ratio = mean_log_ratio +
        one_sided_t95(log_ratios.size() - 1) * standard_error;
    decision.upper_confidence_ratio = std::exp(upper_log_ratio);
    if (!(decision.upper_confidence_ratio < 1.0)) {
        decision.rejection = Rejection::Unproven;
        return decision;
    }

    decision.use_candidate = true;
    decision.rejection = Rejection::None;
    return decision;
}

}  // namespace vkf::proof_gated_execution
