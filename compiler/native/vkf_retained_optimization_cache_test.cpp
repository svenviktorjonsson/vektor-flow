#include "compiler/native/vkf_retained_optimization_cache.hpp"
#include "compiler/native/vkf_retained_optimization_schedule.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

namespace {

int failures = 0;

void expect(bool condition, const std::string& message) {
    if (condition) return;
    std::cerr << message << '\n';
    ++failures;
}

std::string read_bytes(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    return {
        std::istreambuf_iterator<char>(input),
        std::istreambuf_iterator<char>(),
    };
}

}  // namespace

int main() {
    using namespace vkf::proof_gated_execution;
    using namespace vkf::retained_optimization_cache;
    namespace schedule = vkf::retained_optimization_schedule;

    const auto unique = std::to_string(
        std::chrono::steady_clock::now().time_since_epoch().count()
    );
    const auto temporary_root = std::filesystem::temp_directory_path() /
        ("vkf-qopt02-" + unique);
    const auto cache_path = temporary_root / "flow.proof";
    std::filesystem::create_directories(temporary_root);

    const Key proof_key{
        "adaptive-v4",
        "x64-emitter-5c0ffee",
        "windows-x64-avx2-7950x",
        "numeric-flow",
        "f64:n=1048576",
        "exact-result-v1",
    };
    const Evidence evidence{
        proof_key,
        true,
        {
            {100.0, 70.0},
            {101.0, 71.0},
            {99.0, 69.0},
            {102.0, 72.0},
            {98.0, 68.0},
        },
    };
    const Identity identity{
        "0123456789abcdef0123456789abcdef",
        "11111111111111112222222222222222",
        "windows-x64-avx2-7950x",
        "clang-22.1.4-35990504507d79e0",
        proof_key,
        "mask-0",
        "mask-ff",
    };
    const Record record{identity, true, evidence};

    const auto stored = store_atomic(cache_path, record);
    expect(stored.reason == StoreReason::Stored,
           "a valid measured proof must be stored atomically");
    const auto loaded = load(cache_path, identity, true);
    expect(loaded.reason == LoadReason::ProgramHit && loaded.decision.has_value(),
           "exact program/function/host/toolchain proof must be a program hit");
    if (loaded.decision) {
        const auto selected = schedule::plan(schedule::ScheduleRequest{
            identity.program_fingerprint,
            identity.function_fingerprint,
            true,
            identity.proof_key,
            identity.baseline_policy,
            identity.candidate_policy,
            &*loaded.decision,
            nullptr,
        });
        expect(selected.outcome == schedule::Outcome::ReusedProgramProof &&
                   selected.optimization_enabled &&
                   selected.selected_policy == "mask-ff" &&
                   selected.benchmark_policies.empty(),
               "a loaded exact proof must select without fresh exploration");
    }

    auto changed_program = identity;
    changed_program.program_fingerprint =
        "fedcba9876543210fedcba9876543210";
    const auto function_hit = load(cache_path, changed_program, true);
    expect(function_hit.reason == LoadReason::FunctionHit &&
               reason_name(function_hit.reason) == "function-hit" &&
               function_hit.decision.has_value(),
           "unchanged function proof must report reuse after a program change");

    auto changed_function = identity;
    changed_function.function_fingerprint =
        "33333333333333334444444444444444";
    const auto function_reject = load(cache_path, changed_function, true);
    expect(function_reject.reason == LoadReason::FunctionMismatch &&
               reason_name(function_reject.reason) == "function-mismatch" &&
               !function_reject.decision.has_value(),
           "changed function proof must report a function mismatch");

    auto changed_host = identity;
    changed_host.host_fingerprint = "linux-x64-avx2-7950x";
    changed_host.proof_key.host = changed_host.host_fingerprint;
    const auto host_reject = load(cache_path, changed_host, true);
    expect(host_reject.reason == LoadReason::HostMismatch &&
               reason_name(host_reject.reason) == "host-mismatch",
           "cross-host proof must report a host mismatch");

    auto changed_toolchain = identity;
    changed_toolchain.toolchain_fingerprint =
        "clang-23.0.0-aaaaaaaaaaaaaaaa";
    const auto toolchain_reject = load(cache_path, changed_toolchain, true);
    expect(toolchain_reject.reason == LoadReason::ToolchainMismatch &&
               reason_name(toolchain_reject.reason) == "toolchain-mismatch",
           "cross-toolchain proof must report a toolchain mismatch");

    auto changed_proof_key = identity;
    changed_proof_key.proof_key.workload_shape = "f64:n=2097152";
    const auto proof_key_reject = load(cache_path, changed_proof_key, true);
    expect(proof_key_reject.reason == LoadReason::ProofKeyMismatch &&
               reason_name(proof_key_reject.reason) == "proof-key-mismatch",
           "cross-workload proof must report a proof-key mismatch");

    const auto nondeterministic = load(cache_path, identity, false);
    expect(nondeterministic.reason == LoadReason::Nondeterministic &&
               reason_name(nondeterministic.reason) == "nondeterministic",
           "nondeterministic reuse must be explicitly rejected");
    const auto missing = load(temporary_root / "missing.proof", identity, true);
    expect(missing.reason == LoadReason::Missing &&
               reason_name(missing.reason) == "missing",
           "an absent proof must be an explicit cache miss");

    const auto original_bytes = read_bytes(cache_path);
    Record rejected_record = record;
    rejected_record.evidence.equivalent_output = false;
    const auto rejected_store = store_atomic(cache_path, rejected_record);
    expect(rejected_store.reason == StoreReason::ProofRejected &&
               reason_name(rejected_store.reason) == "proof-rejected" &&
               read_bytes(cache_path) == original_bytes,
           "rejected proof must leave the prior cache record byte-identical");

    Record replacement = record;
    replacement.identity.program_fingerprint =
        "fedcba9876543210fedcba9876543210";
    const auto replaced = store_atomic(cache_path, replacement);
    const auto replacement_hit = load(cache_path, replacement.identity, true);
    expect(replaced.reason == StoreReason::Stored &&
               replacement_hit.reason == LoadReason::ProgramHit &&
               read_bytes(cache_path) != original_bytes,
           "atomic replacement must expose one complete new record");

    const auto blocked_path = temporary_root / "blocked.proof";
    std::filesystem::create_directory(blocked_path);
    const auto blocked_store = store_atomic(blocked_path, record);
    std::size_t temporary_residue = 0;
    for (const auto& entry : std::filesystem::directory_iterator(temporary_root)) {
        if (entry.path().filename().string().rfind("blocked.proof.tmp.", 0) == 0) {
            ++temporary_residue;
        }
    }
    expect(blocked_store.reason == StoreReason::IoError &&
               reason_name(blocked_store.reason) == "io-error" &&
               temporary_residue == 0,
           "failed atomic replacement must report I/O and remove its temporary file");

    {
        std::ofstream corrupt(cache_path, std::ios::binary | std::ios::trunc);
        corrupt << "VKF-RETAINED-PROOF\nschema 1\nprogram 99:short\n";
    }
    const auto corrupt_load = load(cache_path, replacement.identity, true);
    expect(corrupt_load.reason == LoadReason::Corrupt &&
               reason_name(corrupt_load.reason) == "corrupt" &&
               !corrupt_load.decision.has_value(),
           "corrupt proof cache must reject without selecting a policy");

    std::filesystem::remove_all(temporary_root);
    std::cout << "retained optimization cache: stored="
              << (stored.reason == StoreReason::Stored)
              << " program_hit=" << (loaded.reason == LoadReason::ProgramHit)
              << " function_hit="
              << (function_hit.reason == LoadReason::FunctionHit)
              << " atomic_reject="
              << (rejected_store.reason == StoreReason::ProofRejected)
              << " corrupt_reject="
              << (corrupt_load.reason == LoadReason::Corrupt)
              << " selected=" << loaded.decision.has_value()
              << '\n';
    return failures == 0 ? 0 : 1;
}
