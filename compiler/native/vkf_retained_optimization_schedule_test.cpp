#include "compiler/native/vkf_retained_optimization_schedule.hpp"

#include <iostream>
#include <string>
#include <vector>

namespace {

int failures = 0;

void expect(bool condition, const std::string& message) {
    if (condition) return;
    std::cerr << message << '\n';
    ++failures;
}

}  // namespace

int main() {
    using namespace vkf::proof_gated_execution;
    using namespace vkf::retained_optimization_schedule;

    const Key key{
        "adaptive-v4",
        "x64-emitter-a",
        "windows-x64-avx2",
        "numeric-flow",
        "f64:n=1048576",
        "exact-result-v1",
    };
    const Evidence faster{
        key,
        true,
        {
            {100.0, 70.0},
            {101.0, 71.0},
            {99.0, 69.0},
            {102.0, 72.0},
            {98.0, 68.0},
        },
    };
    const RetainedDecision retained{
        "program-a",
        "function-a",
        "mask-0",
        "mask-ff",
        faster,
    };

    const auto exact_program = plan(ScheduleRequest{
        "program-a", "function-a", true, key,
        "mask-0", "mask-ff", &retained, nullptr,
    });
    expect(exact_program.outcome == Outcome::ReusedProgramProof &&
               exact_program.optimization_enabled &&
               exact_program.selected_policy == "mask-ff" &&
               exact_program.benchmark_policies.empty(),
           "an unchanged program/function proof must be reused without exploration");

    const auto unchanged_function = plan(ScheduleRequest{
        "program-b", "function-a", true, key,
        "mask-0", "mask-ff", &retained, nullptr,
    });
    expect(unchanged_function.outcome == Outcome::ReusedFunctionProof &&
               unchanged_function.optimization_enabled &&
               unchanged_function.benchmark_policies.empty(),
           "an unchanged function proof must survive a surrounding program change");

    const auto changed_function = plan(ScheduleRequest{
        "program-b", "function-b", true, key,
        "mask-0", "mask-ff", &retained, nullptr,
    });
    expect(changed_function.outcome == Outcome::BenchmarkRequired &&
               !changed_function.optimization_enabled &&
               changed_function.selected_policy == "mask-0" &&
               changed_function.benchmark_policies ==
                   std::vector<std::string>({"mask-0", "mask-ff"}),
           "changed one-shot code must benchmark only baseline and guided policy");
    expect(changed_function.benchmark_policies.size() < 256,
           "ordinary changed code must not explore the 256-policy landscape");

    const auto measured_faster = plan(ScheduleRequest{
        "program-b", "function-b", true, key,
        "mask-0", "mask-ff", nullptr, &faster,
    });
    expect(measured_faster.outcome == Outcome::EnabledByMeasurement &&
               measured_faster.optimization_enabled &&
               measured_faster.selected_policy == "mask-ff" &&
               measured_faster.proof.use_candidate,
           "only an exactly correct statistically faster policy may be enabled");

    Evidence slower = faster;
    for (auto& timing : slower.timings) {
        timing.candidate_ns = timing.baseline_ns + 10.0;
    }
    const auto measured_slower = plan(ScheduleRequest{
        "program-b", "function-b", true, key,
        "mask-0", "mask-ff", nullptr, &slower,
    });
    expect(measured_slower.outcome == Outcome::BaselineExplicitlyRetained &&
               !measured_slower.optimization_enabled &&
               measured_slower.selected_policy == "mask-0" &&
               measured_slower.proof.rejection == Rejection::NotFaster,
           "a slower policy must retain baseline with an explicit reason");

    Evidence incorrect = faster;
    incorrect.equivalent_output = false;
    const auto parity_failure = plan(ScheduleRequest{
        "program-b", "function-b", true, key,
        "mask-0", "mask-ff", nullptr, &incorrect,
    });
    expect(parity_failure.outcome == Outcome::Blocked &&
               !parity_failure.optimization_enabled &&
               parity_failure.selected_policy.empty() &&
               parity_failure.proof.rejection == Rejection::IncorrectOutput,
           "a parity failure must block instead of silently falling back");

    RetainedDecision corrupted_retained = retained;
    corrupted_retained.evidence.equivalent_output = false;
    const auto corrupted_cache = plan(ScheduleRequest{
        "program-a", "function-a", true, key,
        "mask-0", "mask-ff", &corrupted_retained, nullptr,
    });
    expect(corrupted_cache.outcome == Outcome::Blocked &&
               corrupted_cache.selected_policy.empty() &&
               corrupted_cache.proof.rejection == Rejection::IncorrectOutput,
           "a retained parity failure must block instead of becoming a cache miss");

    const auto nondeterministic = plan(ScheduleRequest{
        "program-b", "function-b", false, key,
        "mask-0", "mask-ff", nullptr, nullptr,
    });
    expect(nondeterministic.outcome == Outcome::BaselineExplicitlyRetained &&
               nondeterministic.reason == Reason::NondeterministicFunction &&
               nondeterministic.benchmark_policies.empty(),
           "nondeterministic code must explicitly remain baseline and unreplayed");

    std::cout << "retained optimization schedule: reused_program="
              << exact_program.optimization_enabled
              << " reused_function=" << unchanged_function.optimization_enabled
              << " changed_candidates="
              << changed_function.benchmark_policies.size()
              << " faster_ratio=" << measured_faster.proof.observed_ratio
              << " parity_blocked="
              << (parity_failure.outcome == Outcome::Blocked)
              << '\n';
    return failures == 0 ? 0 : 1;
}
