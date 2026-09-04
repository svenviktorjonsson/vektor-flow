#include "compiler/native/vkf_retained_optimization_composition.hpp"

#include <chrono>
#include <filesystem>
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

vkf::proof_gated_execution::Evidence proven(
    const vkf::retained_optimization_driver::BuildReceipt& receipt
) {
    return {
        receipt.identity.proof_key,
        true,
        {
            {100.0, 70.0},
            {101.0, 71.0},
            {99.0, 69.0},
            {102.0, 72.0},
            {98.0, 68.0},
        },
    };
}

}  // namespace

int main() {
    namespace composition = vkf::retained_optimization_composition;
    namespace cache = vkf::retained_optimization_cache;
    namespace schedule = vkf::retained_optimization_schedule;

    const auto unique = std::to_string(
        std::chrono::steady_clock::now().time_since_epoch().count()
    );
    const auto root = std::filesystem::temp_directory_path() /
        ("vkf-qopt04-" + unique);
    composition::Request request{
        root,
        "typed-program:{entry:left,right}",
        "windows|x64|cpu-family-25-model-97",
        "clang|22.1.4|x64-emitter-build",
        {
            "adaptive-v4",
            "x64-leaf-emitter-qopt04",
            "numeric-zero-argument-leaf",
            "bit-exact-f64-v1",
        },
        "mask-0",
        "mask-fc",
        {
            {"left", "machine-leaf:{push:20,return}", true},
            {"right", "machine-leaf:{push:22,return}", true},
        },
    };

    auto first = composition::prepare(request);
    expect(first.functions.size() == 2 &&
               first.functions[0].build.cache_reason ==
                   cache::LoadReason::Missing &&
               first.functions[1].build.cache_reason ==
                   cache::LoadReason::Missing,
           "each uncached leaf must have its own explicit missing receipt");
    expect(first.functions[0].build.schedule.benchmark_policies ==
               std::vector<std::string>({"mask-0", "mask-fc"}) &&
               first.functions[1].build.schedule.benchmark_policies ==
                   std::vector<std::string>({"mask-0", "mask-fc"}),
           "each leaf miss must schedule only baseline plus one ABI-neutral candidate");
    expect(first.reason == composition::Reason::MeasurementRequired &&
               !first.optimization_enabled,
           "composition must wait until every leaf has independent proof");

    const auto left_proof = proven(first.functions[0].build);
    first = composition::complete(request, std::move(first), 0, left_proof);
    expect(first.reason == composition::Reason::MeasurementRequired &&
               first.functions[0].build.schedule.optimization_enabled &&
               !first.optimization_enabled,
           "one proven leaf must not enable a partially proven composition");
    const auto right_proof = proven(first.functions[1].build);
    first = composition::complete(request, std::move(first), 1, right_proof);
    expect(first.reason == composition::Reason::AllProven &&
               first.selected_policy == "mask-fc" &&
               first.optimization_enabled,
           "the ABI-neutral policy may compose only after every leaf is proven");

    auto changed = request;
    changed.program_material += "|unrelated-surrounding-change";
    changed.functions[1].material = "machine-leaf:{push:23,return}";
    auto incremental = composition::prepare(changed);
    expect(incremental.functions[0].build.cache_reason ==
               cache::LoadReason::FunctionHit &&
               incremental.functions[0].build.schedule.outcome ==
                   schedule::Outcome::ReusedFunctionProof,
           "an unchanged leaf must reuse its proof across a surrounding program change");
    expect(incremental.functions[1].build.cache_reason ==
               cache::LoadReason::FunctionMismatch &&
               incremental.functions[1].build.schedule.benchmark_policies ==
                   std::vector<std::string>({"mask-0", "mask-fc"}) &&
               incremental.reason == composition::Reason::MeasurementRequired,
           "only the changed leaf must return to the two-candidate measurement gate");
    const auto changed_proof = proven(incremental.functions[1].build);
    incremental = composition::complete(
        changed, std::move(incremental), 1, changed_proof
    );
    expect(incremental.reason == composition::Reason::AllProven &&
               incremental.optimization_enabled,
           "one changed leaf may rejoin independently retained proven leaves");

    auto parity_change = changed;
    parity_change.functions[1].material =
        "machine-leaf:{push:23,negate,return}";
    auto blocked = composition::prepare(parity_change);
    auto incorrect = proven(blocked.functions[1].build);
    incorrect.equivalent_output = false;
    blocked = composition::complete(
        parity_change, std::move(blocked), 1, incorrect
    );
    expect(blocked.reason == composition::Reason::Blocked &&
               blocked.selected_policy.empty() &&
               !blocked.optimization_enabled,
           "one leaf parity failure must block composition without a fallback policy");

    std::filesystem::remove_all(root);
    std::cout << "retained optimization composition: functions="
              << first.functions.size() << " unchanged="
              << cache::reason_name(
                     incremental.functions[0].build.cache_reason)
              << " changed="
              << cache::reason_name(
                     incremental.functions[1].build.cache_reason)
              << " reason=" << composition::reason_name(incremental.reason)
              << '\n';
    return failures == 0 ? 0 : 1;
}
