#pragma once

#include "compiler/native/vkf_retained_optimization_schedule.hpp"

#include <atomic>
#include <charconv>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <locale>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>
#endif

namespace vkf::retained_optimization_cache {

inline constexpr std::uint32_t schema_version = 2;
inline constexpr std::uintmax_t maximum_receipt_bytes = 1u << 20u;
inline constexpr std::size_t maximum_field_bytes = 4096;
inline constexpr std::size_t maximum_timing_pairs = 4096;

struct Identity {
    std::string program_fingerprint;
    std::string function_fingerprint;
    std::string host_fingerprint;
    std::string toolchain_fingerprint;
    proof_gated_execution::Key proof_key;
    std::string baseline_policy;
    std::string candidate_policy;
};

struct Record {
    Identity identity;
    bool deterministic = false;
    proof_gated_execution::Evidence evidence;
    std::uint64_t measured_at_unix_seconds = 0;
    std::uint64_t negative_expires_at_unix_seconds = 0;
};

enum class StoreReason {
    Stored,
    InvalidIdentity,
    Nondeterministic,
    InvalidRetention,
    ProofRejected,
    Superseded,
    DurabilityError,
    IoError,
};

struct StoreReceipt {
    StoreReason reason = StoreReason::IoError;
    proof_gated_execution::Rejection proof_rejection =
        proof_gated_execution::Rejection::InsufficientSamples;
    bool durability_confirmed = false;
};

inline std::string_view reason_name(StoreReason reason) {
    switch (reason) {
        case StoreReason::Stored: return "stored";
        case StoreReason::InvalidIdentity: return "invalid-identity";
        case StoreReason::Nondeterministic: return "nondeterministic";
        case StoreReason::InvalidRetention: return "invalid-retention";
        case StoreReason::ProofRejected: return "proof-rejected";
        case StoreReason::Superseded: return "superseded";
        case StoreReason::DurabilityError: return "durability-error";
        case StoreReason::IoError: return "io-error";
    }
    return "unknown";
}

enum class LoadReason {
    ProgramHit,
    FunctionHit,
    NegativeProgramHit,
    NegativeFunctionHit,
    NegativeExpired,
    Missing,
    InvalidRequest,
    Corrupt,
    Nondeterministic,
    FunctionMismatch,
    HostMismatch,
    ToolchainMismatch,
    ProofKeyMismatch,
    PolicyMismatch,
    ProofRejected,
    IoError,
};

inline std::string_view reason_name(LoadReason reason) {
    switch (reason) {
        case LoadReason::ProgramHit: return "program-hit";
        case LoadReason::FunctionHit: return "function-hit";
        case LoadReason::NegativeProgramHit: return "negative-program-hit";
        case LoadReason::NegativeFunctionHit: return "negative-function-hit";
        case LoadReason::NegativeExpired: return "negative-expired";
        case LoadReason::Missing: return "missing";
        case LoadReason::InvalidRequest: return "invalid-request";
        case LoadReason::Corrupt: return "corrupt";
        case LoadReason::Nondeterministic: return "nondeterministic";
        case LoadReason::FunctionMismatch: return "function-mismatch";
        case LoadReason::HostMismatch: return "host-mismatch";
        case LoadReason::ToolchainMismatch: return "toolchain-mismatch";
        case LoadReason::ProofKeyMismatch: return "proof-key-mismatch";
        case LoadReason::PolicyMismatch: return "policy-mismatch";
        case LoadReason::ProofRejected: return "proof-rejected";
        case LoadReason::IoError: return "io-error";
    }
    return "unknown";
}

struct LoadReceipt {
    LoadReason reason = LoadReason::Missing;
    std::optional<retained_optimization_schedule::RetainedDecision> decision;
    proof_gated_execution::Decision proof;
};

inline bool valid_field(std::string_view value) {
    return !value.empty() && value.size() <= maximum_field_bytes &&
        value.find('\n') == std::string_view::npos &&
        value.find('\r') == std::string_view::npos;
}

inline bool valid_identity(const Identity& identity) {
    return valid_field(identity.program_fingerprint) &&
        valid_field(identity.function_fingerprint) &&
        valid_field(identity.host_fingerprint) &&
        valid_field(identity.toolchain_fingerprint) &&
        valid_field(identity.proof_key.optimizer) &&
        valid_field(identity.proof_key.implementation) &&
        valid_field(identity.proof_key.host) &&
        valid_field(identity.proof_key.workload_family) &&
        valid_field(identity.proof_key.workload_shape) &&
        valid_field(identity.proof_key.oracle) &&
        valid_field(identity.baseline_policy) &&
        valid_field(identity.candidate_policy) &&
        identity.baseline_policy != identity.candidate_policy &&
        identity.proof_key.host == identity.host_fingerprint;
}

inline void write_field(
    std::ostream& output,
    std::string_view name,
    std::string_view value
) {
    output << name << ' ' << value.size() << ':' << value << '\n';
}

inline std::size_t parse_size(std::string_view value) {
    std::size_t parsed = 0;
    const auto conversion = std::from_chars(
        value.data(), value.data() + value.size(), parsed
    );
    if (conversion.ec != std::errc{} ||
        conversion.ptr != value.data() + value.size()) {
        throw std::runtime_error("invalid retained proof size");
    }
    return parsed;
}

inline std::string read_field(std::istream& input, std::string_view name) {
    std::string line;
    if (!std::getline(input, line)) {
        throw std::runtime_error("truncated retained proof field");
    }
    const std::string prefix = std::string(name) + ' ';
    if (line.rfind(prefix, 0) != 0) {
        throw std::runtime_error("unexpected retained proof field");
    }
    const auto colon = line.find(':', prefix.size());
    if (colon == std::string::npos) {
        throw std::runtime_error("missing retained proof field length");
    }
    const auto size = parse_size(std::string_view(line).substr(
        prefix.size(), colon - prefix.size()
    ));
    const std::string value = line.substr(colon + 1);
    if (size != value.size() || size > maximum_field_bytes) {
        throw std::runtime_error("retained proof field length mismatch");
    }
    return value;
}

inline void write_record(std::ostream& output, const Record& record) {
    output.imbue(std::locale::classic());
    output << "VKF-RETAINED-PROOF\n";
    output << "schema " << schema_version << '\n';
    write_field(output, "program", record.identity.program_fingerprint);
    write_field(output, "function", record.identity.function_fingerprint);
    write_field(output, "host", record.identity.host_fingerprint);
    write_field(output, "toolchain", record.identity.toolchain_fingerprint);
    write_field(output, "optimizer", record.identity.proof_key.optimizer);
    write_field(output, "implementation", record.identity.proof_key.implementation);
    write_field(output, "proof_host", record.identity.proof_key.host);
    write_field(output, "workload_family", record.identity.proof_key.workload_family);
    write_field(output, "workload_shape", record.identity.proof_key.workload_shape);
    write_field(output, "oracle", record.identity.proof_key.oracle);
    write_field(output, "baseline", record.identity.baseline_policy);
    write_field(output, "candidate", record.identity.candidate_policy);
    output << "deterministic " << (record.deterministic ? 1 : 0) << '\n';
    output << "measured_at " << record.measured_at_unix_seconds << '\n';
    output << "negative_expires "
           << record.negative_expires_at_unix_seconds << '\n';
    output << "equivalent " << (record.evidence.equivalent_output ? 1 : 0) << '\n';
    output << "timings " << record.evidence.timings.size() << '\n';
    output << std::setprecision(std::numeric_limits<double>::max_digits10);
    for (const auto& timing : record.evidence.timings) {
        output << "pair " << timing.baseline_ns << ' '
               << timing.candidate_ns << '\n';
    }
    output << "end\n";
}

inline bool parse_boolean_line(
    const std::string& line,
    std::string_view name
) {
    if (line == std::string(name) + " 0") return false;
    if (line == std::string(name) + " 1") return true;
    throw std::runtime_error("invalid retained proof boolean");
}

inline Record read_record(std::istream& input) {
    input.imbue(std::locale::classic());
    std::string line;
    if (!std::getline(input, line) || line != "VKF-RETAINED-PROOF") {
        throw std::runtime_error("invalid retained proof magic");
    }
    if (!std::getline(input, line) ||
        line != "schema " + std::to_string(schema_version)) {
        throw std::runtime_error("unsupported retained proof schema");
    }
    Record record;
    record.identity.program_fingerprint = read_field(input, "program");
    record.identity.function_fingerprint = read_field(input, "function");
    record.identity.host_fingerprint = read_field(input, "host");
    record.identity.toolchain_fingerprint = read_field(input, "toolchain");
    record.identity.proof_key.optimizer = read_field(input, "optimizer");
    record.identity.proof_key.implementation =
        read_field(input, "implementation");
    record.identity.proof_key.host = read_field(input, "proof_host");
    record.identity.proof_key.workload_family =
        read_field(input, "workload_family");
    record.identity.proof_key.workload_shape =
        read_field(input, "workload_shape");
    record.identity.proof_key.oracle = read_field(input, "oracle");
    record.identity.baseline_policy = read_field(input, "baseline");
    record.identity.candidate_policy = read_field(input, "candidate");
    if (!std::getline(input, line)) {
        throw std::runtime_error("missing retained proof deterministic bit");
    }
    record.deterministic = parse_boolean_line(line, "deterministic");
    if (!std::getline(input, line) || line.rfind("measured_at ", 0) != 0) {
        throw std::runtime_error("missing retained proof measurement time");
    }
    record.measured_at_unix_seconds = static_cast<std::uint64_t>(
        parse_size(std::string_view(line).substr(12))
    );
    if (!std::getline(input, line) ||
        line.rfind("negative_expires ", 0) != 0) {
        throw std::runtime_error("missing retained proof negative expiry");
    }
    record.negative_expires_at_unix_seconds = static_cast<std::uint64_t>(
        parse_size(std::string_view(line).substr(17))
    );
    if (!std::getline(input, line)) {
        throw std::runtime_error("missing retained proof equivalence bit");
    }
    record.evidence.equivalent_output = parse_boolean_line(line, "equivalent");
    if (!std::getline(input, line) || line.rfind("timings ", 0) != 0) {
        throw std::runtime_error("missing retained proof timings");
    }
    const auto timing_count = parse_size(std::string_view(line).substr(8));
    if (timing_count > maximum_timing_pairs) {
        throw std::runtime_error("retained proof timing capacity exceeded");
    }
    record.evidence.timings.reserve(timing_count);
    for (std::size_t index = 0; index < timing_count; ++index) {
        if (!std::getline(input, line)) {
            throw std::runtime_error("truncated retained proof timing");
        }
        std::istringstream pair(line);
        pair.imbue(std::locale::classic());
        std::string tag;
        proof_gated_execution::PairedTiming timing;
        if (!(pair >> tag >> timing.baseline_ns >> timing.candidate_ns) ||
            tag != "pair") {
            throw std::runtime_error("invalid retained proof timing");
        }
        pair >> std::ws;
        if (!pair.eof()) {
            throw std::runtime_error("trailing retained proof timing data");
        }
        record.evidence.timings.push_back(timing);
    }
    if (!std::getline(input, line) || line != "end") {
        throw std::runtime_error("missing retained proof terminator");
    }
    input >> std::ws;
    if (!input.eof()) {
        throw std::runtime_error("trailing retained proof data");
    }
    record.evidence.key = record.identity.proof_key;
    if (!valid_identity(record.identity)) {
        throw std::runtime_error("invalid retained proof identity");
    }
    return record;
}

inline std::filesystem::path temporary_path_for(
    const std::filesystem::path& path
) {
    static std::atomic<std::uint64_t> sequence{0};
#ifdef _WIN32
    const auto process = static_cast<std::uint64_t>(GetCurrentProcessId());
#else
    const auto process = static_cast<std::uint64_t>(getpid());
#endif
    auto temporary = path;
    temporary += ".tmp." + std::to_string(process) + "." +
        std::to_string(sequence.fetch_add(1, std::memory_order_relaxed));
    return temporary;
}

inline std::filesystem::path lock_path_for(const std::filesystem::path& path) {
    auto lock_path = path;
    lock_path += ".lock";
    return lock_path;
}

enum class LockMode { Shared, Exclusive };

class FileLock {
public:
    FileLock(const std::filesystem::path& path, LockMode mode) {
#ifdef _WIN32
        handle_ = CreateFileW(
            lock_path_for(path).c_str(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            nullptr,
            OPEN_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            nullptr
        );
        if (handle_ == INVALID_HANDLE_VALUE) return;
        const DWORD flags = mode == LockMode::Exclusive
            ? LOCKFILE_EXCLUSIVE_LOCK
            : 0;
        acquired_ = LockFileEx(
            handle_, flags, 0, MAXDWORD, MAXDWORD, &overlapped_
        ) != 0;
#else
        descriptor_ = open(
            lock_path_for(path).c_str(), O_RDWR | O_CREAT, 0600
        );
        if (descriptor_ < 0) return;
        acquired_ = flock(
            descriptor_, mode == LockMode::Exclusive ? LOCK_EX : LOCK_SH
        ) == 0;
#endif
    }

    FileLock(const FileLock&) = delete;
    FileLock& operator=(const FileLock&) = delete;

    ~FileLock() {
#ifdef _WIN32
        if (handle_ != INVALID_HANDLE_VALUE) {
            if (acquired_) {
                UnlockFileEx(
                    handle_, 0, MAXDWORD, MAXDWORD, &overlapped_
                );
            }
            CloseHandle(handle_);
        }
#else
        if (descriptor_ >= 0) {
            if (acquired_) flock(descriptor_, LOCK_UN);
            close(descriptor_);
        }
#endif
    }

    bool acquired() const { return acquired_; }

private:
    bool acquired_ = false;
#ifdef _WIN32
    HANDLE handle_ = INVALID_HANDLE_VALUE;
    OVERLAPPED overlapped_{};
#else
    int descriptor_ = -1;
#endif
};

inline std::string serialized_record(const Record& record) {
    std::ostringstream output;
    write_record(output, record);
    return output.str();
}

inline bool existing_record_supersedes(
    const std::filesystem::path& path,
    const Record& candidate
) {
    std::ifstream input(path, std::ios::binary);
    if (!input) return false;
    Record existing;
    try {
        existing = read_record(input);
    } catch (const std::exception&) {
        return false;
    }
    if (!existing.deterministic) return false;
    const auto existing_proof = proof_gated_execution::assess(
        existing.identity.proof_key, existing.evidence
    );
    const bool existing_negative =
        existing_proof.rejection ==
            proof_gated_execution::Rejection::NotFaster ||
        existing_proof.rejection ==
            proof_gated_execution::Rejection::Unproven;
    if (!existing_proof.use_candidate && !existing_negative) return false;
    if ((existing_proof.use_candidate &&
         existing.negative_expires_at_unix_seconds != 0) ||
        (existing_negative &&
         (existing.measured_at_unix_seconds == 0 ||
          existing.negative_expires_at_unix_seconds <=
              existing.measured_at_unix_seconds))) {
        return false;
    }
    if (existing.measured_at_unix_seconds !=
        candidate.measured_at_unix_seconds) {
        return existing.measured_at_unix_seconds >
            candidate.measured_at_unix_seconds;
    }
    return serialized_record(existing) <= serialized_record(candidate);
}

inline bool replace_atomically(
    const std::filesystem::path& temporary,
    const std::filesystem::path& destination
) {
#ifdef _WIN32
    return MoveFileExW(
        temporary.c_str(),
        destination.c_str(),
        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH
    ) != 0;
#else
    std::error_code error;
    std::filesystem::rename(temporary, destination, error);
    return !error;
#endif
}

inline bool flush_file_durably(const std::filesystem::path& path) {
#ifdef _WIN32
    const HANDLE handle = CreateFileW(
        path.c_str(),
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr
    );
    if (handle == INVALID_HANDLE_VALUE) return false;
    const bool flushed = FlushFileBuffers(handle) != 0;
    CloseHandle(handle);
    return flushed;
#else
    const int descriptor = open(path.c_str(), O_RDONLY);
    if (descriptor < 0) return false;
    const bool flushed = fsync(descriptor) == 0;
    close(descriptor);
    return flushed;
#endif
}

inline bool flush_parent_directory_durably(
    const std::filesystem::path& path
) {
#ifdef _WIN32
    (void)path;
    return true;
#else
    const auto parent = path.parent_path().empty()
        ? std::filesystem::path(".")
        : path.parent_path();
    const int descriptor = open(parent.c_str(), O_RDONLY | O_DIRECTORY);
    if (descriptor < 0) return false;
    const bool flushed = fsync(descriptor) == 0;
    close(descriptor);
    return flushed;
#endif
}

inline StoreReceipt store_atomic(
    const std::filesystem::path& path,
    const Record& record
) {
    if (!valid_identity(record.identity) ||
        record.evidence.key != record.identity.proof_key) {
        return {StoreReason::InvalidIdentity,
                proof_gated_execution::Rejection::KeyMismatch};
    }
    if (!record.deterministic) {
        return {StoreReason::Nondeterministic,
                proof_gated_execution::Rejection::Unproven};
    }
    const auto proof = proof_gated_execution::assess(
        record.identity.proof_key,
        record.evidence
    );
    const bool retain_negative =
        proof.rejection == proof_gated_execution::Rejection::NotFaster ||
        proof.rejection == proof_gated_execution::Rejection::Unproven;
    if (!proof.use_candidate && !retain_negative) {
        return {StoreReason::ProofRejected, proof.rejection};
    }
    if ((proof.use_candidate &&
         record.negative_expires_at_unix_seconds != 0) ||
        (retain_negative &&
         (record.measured_at_unix_seconds == 0 ||
          record.negative_expires_at_unix_seconds <=
              record.measured_at_unix_seconds))) {
        return {StoreReason::InvalidRetention, proof.rejection};
    }

    std::error_code error;
    if (!path.parent_path().empty()) {
        std::filesystem::create_directories(path.parent_path(), error);
    }
    if (error) return {StoreReason::IoError, proof.rejection};
    FileLock lock(path, LockMode::Exclusive);
    if (!lock.acquired()) {
        return {StoreReason::IoError, proof.rejection};
    }
    if (std::filesystem::exists(path, error) && !error &&
        existing_record_supersedes(path, record)) {
        return {StoreReason::Superseded, proof.rejection};
    }
    if (error) return {StoreReason::IoError, proof.rejection};
    const auto temporary = temporary_path_for(path);
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output) return {StoreReason::IoError, proof.rejection};
        write_record(output, record);
        output.flush();
        if (!output) {
            output.close();
            std::filesystem::remove(temporary, error);
            return {StoreReason::IoError, proof.rejection};
        }
    }
    if (!flush_file_durably(temporary)) {
        std::filesystem::remove(temporary, error);
        return {StoreReason::DurabilityError, proof.rejection};
    }
    if (!replace_atomically(temporary, path)) {
        std::filesystem::remove(temporary, error);
        return {StoreReason::IoError, proof.rejection};
    }
    if (!flush_parent_directory_durably(path)) {
        return {StoreReason::DurabilityError, proof.rejection};
    }
    return {StoreReason::Stored, proof.rejection, true};
}

inline LoadReceipt load(
    const std::filesystem::path& path,
    const Identity& expected,
    bool deterministic,
    std::uint64_t current_epoch_seconds = 0
) {
    if (!valid_identity(expected)) {
        return {LoadReason::InvalidRequest, std::nullopt, {}};
    }
    std::error_code error;
    const bool exists = std::filesystem::exists(path, error);
    if (error) return {LoadReason::IoError, std::nullopt, {}};
    if (!exists) return {LoadReason::Missing, std::nullopt, {}};
    FileLock lock(path, LockMode::Shared);
    if (!lock.acquired()) {
        return {LoadReason::IoError, std::nullopt, {}};
    }
    const auto bytes = std::filesystem::file_size(path, error);
    if (error) return {LoadReason::IoError, std::nullopt, {}};
    if (bytes == 0 || bytes > maximum_receipt_bytes) {
        return {LoadReason::Corrupt, std::nullopt, {}};
    }

    Record record;
    try {
        std::ifstream input(path, std::ios::binary);
        if (!input) return {LoadReason::IoError, std::nullopt, {}};
        record = read_record(input);
    } catch (const std::exception&) {
        return {LoadReason::Corrupt, std::nullopt, {}};
    }
    if (!deterministic || !record.deterministic) {
        return {LoadReason::Nondeterministic, std::nullopt, {}};
    }
    if (record.identity.host_fingerprint != expected.host_fingerprint) {
        return {LoadReason::HostMismatch, std::nullopt, {}};
    }
    if (record.identity.toolchain_fingerprint !=
        expected.toolchain_fingerprint) {
        return {LoadReason::ToolchainMismatch, std::nullopt, {}};
    }
    if (record.identity.function_fingerprint !=
        expected.function_fingerprint) {
        return {LoadReason::FunctionMismatch, std::nullopt, {}};
    }
    if (record.identity.proof_key != expected.proof_key) {
        return {LoadReason::ProofKeyMismatch, std::nullopt, {}};
    }
    if (record.identity.baseline_policy != expected.baseline_policy ||
        record.identity.candidate_policy != expected.candidate_policy) {
        return {LoadReason::PolicyMismatch, std::nullopt, {}};
    }
    const auto proof = proof_gated_execution::assess(
        expected.proof_key,
        record.evidence
    );
    const bool retain_negative =
        proof.rejection == proof_gated_execution::Rejection::NotFaster ||
        proof.rejection == proof_gated_execution::Rejection::Unproven;
    if (retain_negative) {
        if (current_epoch_seconds == 0 ||
            current_epoch_seconds >=
                record.negative_expires_at_unix_seconds) {
            return {LoadReason::NegativeExpired, std::nullopt, proof};
        }
        retained_optimization_schedule::RetainedDecision decision{
            record.identity.program_fingerprint,
            record.identity.function_fingerprint,
            record.identity.baseline_policy,
            record.identity.candidate_policy,
            record.evidence,
            true,
        };
        return {
            record.identity.program_fingerprint == expected.program_fingerprint
                ? LoadReason::NegativeProgramHit
                : LoadReason::NegativeFunctionHit,
            std::move(decision),
            proof,
        };
    }
    if (!proof.use_candidate) {
        return {LoadReason::ProofRejected, std::nullopt, proof};
    }
    retained_optimization_schedule::RetainedDecision decision{
        record.identity.program_fingerprint,
        record.identity.function_fingerprint,
        record.identity.baseline_policy,
        record.identity.candidate_policy,
        record.evidence,
    };
    return {
        record.identity.program_fingerprint == expected.program_fingerprint
            ? LoadReason::ProgramHit
            : LoadReason::FunctionHit,
        std::move(decision),
        proof,
    };
}

}  // namespace vkf::retained_optimization_cache
