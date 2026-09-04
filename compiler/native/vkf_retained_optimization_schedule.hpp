#pragma once

#include "compiler/native/vkf_proof_gated_execution.hpp"

#include <string>
#include <vector>

namespace vkf::retained_optimization_schedule {

struct RetainedDecision {
    std::string program_fingerprint;
    std::string function_fingerprint;
    std::string baseline_policy;
    std::string candidate_policy;
    proof_gated_execution::Evidence evidence;
};

struct ScheduleRequest {
    std::string program_fingerprint;
    std::string function_fingerprint;
    bool deterministic = false;
    proof_gated_execution::Key proof_key;
    std::string baseline_policy;
    std::string candidate_policy;
    const RetainedDecision* retained = nullptr;
    const proof_gated_execution::Evidence* measured = nullptr;
};

enum class Outcome {
    BenchmarkRequired,
    EnabledByMeasurement,
    ReusedProgramProof,
    ReusedFunctionProof,
    BaselineExplicitlyRetained,
    Blocked,
};

enum class Reason {
    None,
    ChangedFunction,
    NondeterministicFunction,
    MeasurementRejected,
    IncorrectOutput,
};

struct Schedule {
    Outcome outcome = Outcome::BenchmarkRequired;
    Reason reason = Reason::ChangedFunction;
    std::string selected_policy;
    std::vector<std::string> benchmark_policies;
    bool optimization_enabled = false;
    proof_gated_execution::Decision proof;
};

inline Schedule plan(const ScheduleRequest& request) {
    Schedule schedule;
    schedule.selected_policy = request.baseline_policy;
    if (!request.deterministic) {
        schedule.outcome = Outcome::BaselineExplicitlyRetained;
        schedule.reason = Reason::NondeterministicFunction;
        return schedule;
    }

    if (request.retained != nullptr &&
        request.retained->function_fingerprint ==
            request.function_fingerprint &&
        request.retained->baseline_policy == request.baseline_policy &&
        request.retained->candidate_policy == request.candidate_policy) {
        schedule.proof = proof_gated_execution::assess(
            request.proof_key,
            request.retained->evidence
        );
        if (schedule.proof.use_candidate) {
            schedule.outcome =
                request.retained->program_fingerprint ==
                        request.program_fingerprint
                    ? Outcome::ReusedProgramProof
                    : Outcome::ReusedFunctionProof;
            schedule.reason = Reason::None;
            schedule.selected_policy = request.candidate_policy;
            schedule.optimization_enabled = true;
            return schedule;
        }
        if (schedule.proof.rejection ==
            proof_gated_execution::Rejection::IncorrectOutput) {
            schedule.outcome = Outcome::Blocked;
            schedule.reason = Reason::IncorrectOutput;
            schedule.selected_policy.clear();
            return schedule;
        }
    }

    if (request.measured != nullptr) {
        schedule.proof = proof_gated_execution::assess(
            request.proof_key,
            *request.measured
        );
        if (schedule.proof.use_candidate) {
            schedule.outcome = Outcome::EnabledByMeasurement;
            schedule.reason = Reason::None;
            schedule.selected_policy = request.candidate_policy;
            schedule.optimization_enabled = true;
            return schedule;
        }
        if (schedule.proof.rejection ==
            proof_gated_execution::Rejection::IncorrectOutput) {
            schedule.outcome = Outcome::Blocked;
            schedule.reason = Reason::IncorrectOutput;
            schedule.selected_policy.clear();
            return schedule;
        }
        schedule.outcome = Outcome::BaselineExplicitlyRetained;
        schedule.reason = Reason::MeasurementRejected;
        return schedule;
    }

    schedule.outcome = Outcome::BenchmarkRequired;
    schedule.reason = Reason::ChangedFunction;
    schedule.benchmark_policies = {
        request.baseline_policy,
        request.candidate_policy,
    };
    return schedule;
}

}  // namespace vkf::retained_optimization_schedule
