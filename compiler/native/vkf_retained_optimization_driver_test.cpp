#include "compiler/native/vkf_retained_optimization_driver.hpp"

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

}  // namespace

int main() {
    namespace driver = vkf::retained_optimization_driver;
    namespace cache = vkf::retained_optimization_cache;
    namespace schedule = vkf::retained_optimization_schedule;

    const auto unique = std::to_string(
        std::chrono::steady_clock::now().time_since_epoch().count()
    );
    const auto temporary_root = std::filesystem::temp_directory_path() /
        ("vkf-qopt03-" + unique);
    const driver::Request request{
        temporary_root / "entry.proof",
        {
            "typed-program:v1:{entry:flow}",
            "machine-function:v1:{push:40,push:2,add,return}",
            "windows|x64|pe|avx2-fma|cpu-family-25-model-97",
            "clang|22.1.4|x64-emitter-build-7ad35c",
        },
        true,
        {
            "adaptive-v4",
            "x64-machine-emitter-v1",
            "numeric-entry-closure",
            "f64:scalar",
            "bit-exact-f64-v1",
        },
        "mask-0",
        "mask-ff",
    };

    const auto first = driver::prepare(request);
    const auto second = driver::prepare(request);
    expect(first.identity.program_fingerprint ==
               second.identity.program_fingerprint &&
               first.identity.function_fingerprint ==
                   second.identity.function_fingerprint &&
               first.identity.host_fingerprint ==
                   second.identity.host_fingerprint &&
               first.identity.toolchain_fingerprint ==
                   second.identity.toolchain_fingerprint,
           "identical program/function/host/toolchain material must fingerprint identically");
    expect(first.identity.program_fingerprint.size() == 64 &&
               first.identity.function_fingerprint.size() == 64 &&
               first.identity.host_fingerprint.size() == 64 &&
               first.identity.toolchain_fingerprint.size() == 64,
           "every private identity must be a complete SHA-256 fingerprint");
    expect(first.cache_reason == cache::LoadReason::Missing &&
               cache::reason_name(first.cache_reason) == "missing",
           "an uncached function must expose an explicit missing receipt");
    expect(first.schedule.outcome == schedule::Outcome::BenchmarkRequired &&
               first.schedule.benchmark_policies ==
                   std::vector<std::string>({"mask-0", "mask-ff"}),
           "a changed one-shot function must benchmark baseline plus one guided candidate");

    const vkf::proof_gated_execution::Evidence proven{
        first.identity.proof_key,
        true,
        {
            {100.0, 70.0},
            {101.0, 71.0},
            {99.0, 69.0},
            {102.0, 72.0},
            {98.0, 68.0},
        },
    };
    const auto measured = driver::complete(request, first, proven);
    expect(measured.schedule.outcome ==
               schedule::Outcome::EnabledByMeasurement &&
               measured.schedule.selected_policy == "mask-ff" &&
               measured.schedule.optimization_enabled &&
               measured.store_reason == cache::StoreReason::Stored,
           "only a measured exact and proven speedup may be stored and selected");
    const auto retained = driver::prepare(request);
    expect(retained.cache_reason == cache::LoadReason::ProgramHit &&
               retained.schedule.outcome ==
                   schedule::Outcome::ReusedProgramProof &&
               retained.schedule.benchmark_policies.empty(),
           "an exact retained proof must select without another benchmark");

    auto parity_request = request;
    parity_request.cache_path = temporary_root / "parity.proof";
    const auto parity_prepared = driver::prepare(parity_request);
    auto incorrect = proven;
    incorrect.equivalent_output = false;
    const auto parity_blocked = driver::complete(
        parity_request, parity_prepared, incorrect
    );
    expect(parity_blocked.schedule.outcome == schedule::Outcome::Blocked &&
               parity_blocked.schedule.selected_policy.empty() &&
               driver::reason_name(parity_blocked.schedule.reason) ==
                   "incorrect-output" &&
               !parity_blocked.store_reason.has_value() &&
               !std::filesystem::exists(parity_request.cache_path),
           "parity failure must block selection and storage without fallback");

    auto surrounding_change = request;
    surrounding_change.material.program += "|unrelated-helper-change";
    const auto function_hit = driver::prepare(surrounding_change);
    expect(driver::cache_reason_name(function_hit) == "function-hit" &&
               function_hit.identity.program_fingerprint !=
                   retained.identity.program_fingerprint &&
               function_hit.identity.function_fingerprint ==
                   retained.identity.function_fingerprint &&
               function_hit.schedule.benchmark_policies.empty(),
           "an unchanged function must reuse proof across a surrounding program change");

    auto function_change = request;
    function_change.material.function += "|multiply-instead";
    const auto function_miss = driver::prepare(function_change);
    expect(driver::cache_reason_name(function_miss) == "function-mismatch" &&
               driver::selection_reason_name(function_miss) ==
                   "changed-function" &&
               function_miss.schedule.benchmark_policies ==
                   std::vector<std::string>({"mask-0", "mask-ff"}),
           "a changed function must reject proof explicitly and schedule only two policies");

    auto host_change = request;
    host_change.material.host += "|cpu-model-changed";
    const auto host_miss = driver::prepare(host_change);
    expect(driver::cache_reason_name(host_miss) == "host-mismatch" &&
               host_miss.identity.host_fingerprint !=
                   retained.identity.host_fingerprint,
           "a host change must derive a distinct fingerprint and explicit rejection");

    auto toolchain_change = request;
    toolchain_change.material.toolchain += "|compiler-rebuilt";
    const auto toolchain_miss = driver::prepare(toolchain_change);
    expect(driver::cache_reason_name(toolchain_miss) == "toolchain-mismatch" &&
               toolchain_miss.identity.toolchain_fingerprint !=
                   retained.identity.toolchain_fingerprint,
           "a toolchain change must derive a distinct fingerprint and explicit rejection");

    auto slower_request = request;
    slower_request.cache_path = temporary_root / "slower.proof";
    auto slower = proven;
    slower.timings = {
        {100.0, 110.0},
        {101.0, 111.0},
        {99.0, 109.0},
        {102.0, 112.0},
        {98.0, 108.0},
    };
    const auto retained_baseline = driver::complete(
        slower_request, driver::prepare(slower_request), slower
    );
    expect(retained_baseline.schedule.outcome ==
               schedule::Outcome::BaselineExplicitlyRetained &&
               retained_baseline.schedule.selected_policy == "mask-0" &&
               driver::selection_reason_name(retained_baseline) ==
                   "measurement-rejected" &&
               driver::store_reason_name(retained_baseline) == "not-attempted",
           "a measured slower candidate must explicitly retain baseline without storage");

    auto blocked_store_request = request;
    blocked_store_request.cache_path = temporary_root / "blocked.proof";
    std::filesystem::create_directory(blocked_store_request.cache_path);
    const auto store_rejected = driver::complete(
        blocked_store_request,
        driver::prepare(blocked_store_request),
        proven
    );
    expect(store_rejected.schedule.optimization_enabled &&
               store_rejected.schedule.selected_policy == "mask-ff" &&
               driver::store_reason_name(store_rejected) == "io-error",
           "a proven current build may select only while exposing failed persistence");

    std::filesystem::remove_all(temporary_root);
    std::cout << "retained optimization driver: cache="
              << cache::reason_name(first.cache_reason)
              << " candidates=" << first.schedule.benchmark_policies.size()
              << " retained=" << cache::reason_name(retained.cache_reason)
              << " parity="
              << driver::reason_name(parity_blocked.schedule.reason)
              << " changed=" << driver::cache_reason_name(function_miss)
              << " slower="
              << driver::selection_reason_name(retained_baseline)
              << " store=" << driver::store_reason_name(store_rejected)
              << '\n';
    return failures == 0 ? 0 : 1;
}
