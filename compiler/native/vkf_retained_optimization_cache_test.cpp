#include "compiler/native/vkf_retained_optimization_cache.hpp"
#include "compiler/native/vkf_retained_optimization_schedule.hpp"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <future>
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

vkf::retained_optimization_cache::Record fixture_record(
    std::string program_fingerprint,
    std::uint64_t measured_at_unix_seconds
) {
    const vkf::proof_gated_execution::Key proof_key{
        "adaptive-v4",
        "x64-emitter-5c0ffee",
        "windows-x64-avx2-7950x",
        "numeric-flow",
        "f64:n=1048576",
        "exact-result-v1",
    };
    const vkf::proof_gated_execution::Evidence evidence{
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
    const vkf::retained_optimization_cache::Identity identity{
        std::move(program_fingerprint),
        "11111111111111112222222222222222",
        "windows-x64-avx2-7950x",
        "clang-22.1.4-35990504507d79e0",
        proof_key,
        "mask-0",
        "mask-ff",
    };
    return {identity, true, evidence, measured_at_unix_seconds};
}

#ifndef _WIN32
std::string shell_quote(const std::filesystem::path& path) {
    const auto value = path.string();
    std::string quoted = "'";
    for (const char character : value) {
        if (character == '\'') quoted += "'\\''";
        else quoted.push_back(character);
    }
    quoted.push_back('\'');
    return quoted;
}
#endif

int run_cache_child(
    const std::filesystem::path& executable,
    std::string_view mode,
    const std::filesystem::path& cache_path,
    std::string_view value = {}
) {
#ifdef _WIN32
    const std::wstring wide_mode(mode.begin(), mode.end());
    const std::wstring wide_value(value.begin(), value.end());
    std::wstring command = L"\"" + executable.wstring() + L"\" " +
        wide_mode + L" \"" + cache_path.wstring() + L"\"";
    if (!wide_value.empty()) command += L" " + wide_value;
    std::vector<wchar_t> command_line(command.begin(), command.end());
    command_line.push_back(L'\0');
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(
            executable.c_str(),
            command_line.data(),
            nullptr,
            nullptr,
            FALSE,
            CREATE_NO_WINDOW,
            nullptr,
            nullptr,
            &startup,
            &process
        )) {
        return -1;
    }
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exit_code = 1;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return static_cast<int>(exit_code);
#else
    std::string command = shell_quote(executable) + " " +
        std::string(mode) + " " + shell_quote(cache_path);
    if (!value.empty()) command += " " + std::string(value);
    return std::system(command.c_str());
#endif
}

}  // namespace

int main(int argc, char** argv) {
    using namespace vkf::proof_gated_execution;
    using namespace vkf::retained_optimization_cache;
    namespace schedule = vkf::retained_optimization_schedule;

    if (argc == 4 && std::string(argv[1]) == "--cache-writer") {
        auto record = fixture_record(
            "process-writer-" + std::string(argv[3]),
            static_cast<std::uint64_t>(std::stoull(argv[3]))
        );
        const auto stored = store_atomic(argv[2], record);
        return stored.reason == StoreReason::Superseded ? 0 : 1;
    }
    if (argc == 3 && std::string(argv[1]) == "--cache-reader") {
        const auto expected = fixture_record("process-newest", 20'000);
        for (std::size_t read = 0; read < 100; ++read) {
            const auto receipt = load(argv[2], expected.identity, true);
            if ((receipt.reason != LoadReason::ProgramHit &&
                 receipt.reason != LoadReason::FunctionHit) ||
                !receipt.decision.has_value()) {
                return 1;
            }
        }
        return 0;
    }

    const auto unique = std::to_string(
        std::chrono::steady_clock::now().time_since_epoch().count()
    );
    const auto temporary_root = std::filesystem::temp_directory_path() /
        ("vkf-qopt02-" + unique);
    const auto cache_path = temporary_root / "flow.proof";
    std::filesystem::create_directories(temporary_root);

    const Record record = fixture_record(
        "0123456789abcdef0123456789abcdef", 100
    );
    const auto& identity = record.identity;

    const auto stored = store_atomic(cache_path, record);
    expect(stored.reason == StoreReason::Stored &&
               stored.durability_confirmed,
           "a valid measured proof must be stored atomically and durably");
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
    replacement.measured_at_unix_seconds = 101;
    const auto replaced = store_atomic(cache_path, replacement);
    const auto replacement_hit = load(cache_path, replacement.identity, true);
    expect(replaced.reason == StoreReason::Stored &&
               replacement_hit.reason == LoadReason::ProgramHit &&
               read_bytes(cache_path) != original_bytes,
           "atomic replacement must expose one complete new record");

    const auto concurrent_path = temporary_root / "concurrent.proof";
    Record newest = record;
    newest.identity.program_fingerprint = "newest-program-fingerprint";
    newest.measured_at_unix_seconds = 2'000;
    expect(store_atomic(concurrent_path, newest).reason == StoreReason::Stored,
           "the newest concurrent proof fixture must be stored");
    std::atomic<bool> start{false};
    std::atomic<std::size_t> invalid_reads{0};
    std::vector<std::future<StoreReceipt>> writers;
    for (std::uint64_t index = 0; index < 8; ++index) {
        Record older = record;
        older.identity.program_fingerprint =
            "older-program-fingerprint-" + std::to_string(index);
        older.measured_at_unix_seconds = 1'000 + index;
        writers.push_back(std::async(
            std::launch::async,
            [&, older] {
                while (!start.load(std::memory_order_acquire)) {}
                return store_atomic(concurrent_path, older);
            }
        ));
    }
    std::vector<std::future<void>> readers;
    for (std::size_t index = 0; index < 4; ++index) {
        readers.push_back(std::async(
            std::launch::async,
            [&] {
                while (!start.load(std::memory_order_acquire)) {}
                for (std::size_t read = 0; read < 100; ++read) {
                    const auto receipt = load(concurrent_path, newest.identity, true);
                    if ((receipt.reason != LoadReason::ProgramHit &&
                         receipt.reason != LoadReason::FunctionHit) ||
                        !receipt.decision.has_value()) {
                        invalid_reads.fetch_add(1, std::memory_order_relaxed);
                    }
                }
            }
        ));
    }
    start.store(true, std::memory_order_release);
    std::size_t superseded_writes = 0;
    for (auto& writer : writers) {
        if (writer.get().reason == StoreReason::Superseded) {
            ++superseded_writes;
        }
    }
    for (auto& reader : readers) reader.get();
    const auto concurrent_final = load(concurrent_path, newest.identity, true);
    expect(superseded_writes == writers.size() &&
               invalid_reads.load(std::memory_order_relaxed) == 0 &&
               concurrent_final.reason == LoadReason::ProgramHit &&
               concurrent_final.decision.has_value(),
           "concurrent readers must observe complete receipts and older writers must be superseded");

    const auto process_path = temporary_root / "process-concurrent.proof";
    const auto process_newest = fixture_record("process-newest", 20'000);
    expect(store_atomic(process_path, process_newest).reason ==
               StoreReason::Stored,
           "the newest process-concurrency fixture must be stored");
    const auto executable = std::filesystem::absolute(argv[0]);
    std::vector<std::future<int>> child_processes;
    for (std::uint64_t index = 0; index < 8; ++index) {
        const std::string timestamp = std::to_string(10'000 + index);
        child_processes.push_back(std::async(
            std::launch::async,
            [=] {
                return run_cache_child(
                    executable, "--cache-writer", process_path, timestamp
                );
            }
        ));
    }
    for (std::size_t index = 0; index < 4; ++index) {
        child_processes.push_back(std::async(
            std::launch::async,
            [=] {
                return run_cache_child(
                    executable, "--cache-reader", process_path
                );
            }
        ));
    }
    bool process_concurrent = true;
    for (auto& child : child_processes) {
        process_concurrent = process_concurrent && child.get() == 0;
    }
    const auto process_final = load(
        process_path, process_newest.identity, true
    );
    process_concurrent = process_concurrent &&
        process_final.reason == LoadReason::ProgramHit &&
        process_final.decision.has_value();
    expect(process_concurrent,
           "concurrent processes must observe complete receipts and preserve the newest writer");

    const auto poisoned_path = temporary_root / "poisoned.proof";
    Record poisoned = newest;
    poisoned.measured_at_unix_seconds = 9'999;
    poisoned.evidence.equivalent_output = false;
    {
        std::ofstream output(poisoned_path, std::ios::binary | std::ios::trunc);
        write_record(output, poisoned);
    }
    Record recovery = newest;
    recovery.measured_at_unix_seconds = 3'000;
    const auto recovered = store_atomic(poisoned_path, recovery);
    expect(recovered.reason == StoreReason::Stored &&
               recovered.durability_confirmed &&
               load(poisoned_path, recovery.identity, true).reason ==
                   LoadReason::ProgramHit,
           "a proof-invalid record must not supersede a valid durable writer");

    Record tie_left = newest;
    tie_left.identity.program_fingerprint = "tie-left-program";
    tie_left.measured_at_unix_seconds = 4'000;
    Record tie_right = newest;
    tie_right.identity.program_fingerprint = "tie-right-program";
    tie_right.measured_at_unix_seconds = 4'000;
    const auto tie_forward_path = temporary_root / "tie-forward.proof";
    const auto tie_reverse_path = temporary_root / "tie-reverse.proof";
    store_atomic(tie_forward_path, tie_left);
    store_atomic(tie_forward_path, tie_right);
    store_atomic(tie_reverse_path, tie_right);
    store_atomic(tie_reverse_path, tie_left);
    const bool deterministic_tie =
        read_bytes(tie_forward_path) == read_bytes(tie_reverse_path);
    expect(deterministic_tie,
           "equal-time writers must converge by a deterministic bytewise tie break");

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
              << " concurrent=" << (invalid_reads.load() == 0)
              << " superseded=" << superseded_writes
              << " process_concurrent=" << process_concurrent
              << " deterministic_tie=" << deterministic_tie
              << " selected=" << loaded.decision.has_value()
              << '\n';
    return failures == 0 ? 0 : 1;
}
