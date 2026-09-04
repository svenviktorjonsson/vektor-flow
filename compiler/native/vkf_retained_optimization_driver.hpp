#pragma once

#include "compiler/native/vkf_retained_optimization_cache.hpp"
#include "compiler/native/vkf_sha256.hpp"

#include <filesystem>
#include <iomanip>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>

namespace vkf::retained_optimization_driver {

inline constexpr std::uint64_t default_negative_retention_seconds = 86'400;

struct FingerprintMaterial {
    std::string program;
    std::string function;
    std::string host;
    std::string toolchain;
};

struct ProofScope {
    std::string optimizer;
    std::string implementation;
    std::string workload_family;
    std::string workload_shape;
    std::string oracle;
};

struct Request {
    std::filesystem::path cache_path;
    FingerprintMaterial material;
    bool deterministic = false;
    ProofScope proof;
    std::string baseline_policy;
    std::string candidate_policy;
    std::uint64_t current_epoch_seconds = 0;
    std::uint64_t negative_retention_seconds = 0;
};

struct BuildReceipt {
    retained_optimization_cache::Identity identity;
    retained_optimization_cache::LoadReason cache_reason =
        retained_optimization_cache::LoadReason::Missing;
    retained_optimization_schedule::Schedule schedule;
    std::optional<retained_optimization_cache::StoreReason> store_reason;
};

inline std::string_view reason_name(
    retained_optimization_schedule::Reason reason
) {
    using Reason = retained_optimization_schedule::Reason;
    switch (reason) {
        case Reason::None: return "none";
        case Reason::ChangedFunction: return "changed-function";
        case Reason::NondeterministicFunction:
            return "nondeterministic-function";
        case Reason::MeasurementRejected: return "measurement-rejected";
        case Reason::IncorrectOutput: return "incorrect-output";
    }
    return "unknown";
}

inline std::string_view cache_reason_name(const BuildReceipt& receipt) {
    return retained_optimization_cache::reason_name(receipt.cache_reason);
}

inline std::string_view selection_reason_name(const BuildReceipt& receipt) {
    return reason_name(receipt.schedule.reason);
}

inline std::string_view store_reason_name(const BuildReceipt& receipt) {
    return receipt.store_reason
        ? retained_optimization_cache::reason_name(*receipt.store_reason)
        : std::string_view("not-attempted");
}

inline std::string fingerprint(
    std::string_view domain,
    std::string_view material
) {
    std::string framed = "vkf-retained-driver-v1\n";
    framed.append(domain);
    framed.push_back('\n');
    framed.append(std::to_string(material.size()));
    framed.push_back(':');
    framed.append(material);
    const auto digest = crypto::sha256(
        reinterpret_cast<const std::uint8_t*>(framed.data()), framed.size()
    );
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (const auto byte : digest) {
        output << std::setw(2) << static_cast<unsigned>(byte);
    }
    return output.str();
}

inline retained_optimization_cache::Identity derive_identity(
    const Request& request
) {
    retained_optimization_cache::Identity identity;
    identity.program_fingerprint = fingerprint(
        "program", request.material.program
    );
    identity.function_fingerprint = fingerprint(
        "function", request.material.function
    );
    identity.host_fingerprint = fingerprint("host", request.material.host);
    identity.toolchain_fingerprint = fingerprint(
        "toolchain", request.material.toolchain
    );
    identity.proof_key = {
        request.proof.optimizer,
        request.proof.implementation,
        identity.host_fingerprint,
        request.proof.workload_family,
        request.proof.workload_shape,
        request.proof.oracle,
    };
    identity.baseline_policy = request.baseline_policy;
    identity.candidate_policy = request.candidate_policy;
    return identity;
}

inline BuildReceipt prepare(const Request& request) {
    BuildReceipt receipt;
    receipt.identity = derive_identity(request);
    const auto cached = retained_optimization_cache::load(
        request.cache_path,
        receipt.identity,
        request.deterministic,
        request.current_epoch_seconds
    );
    receipt.cache_reason = cached.reason;
    receipt.schedule = retained_optimization_schedule::plan({
        receipt.identity.program_fingerprint,
        receipt.identity.function_fingerprint,
        request.deterministic,
        receipt.identity.proof_key,
        receipt.identity.baseline_policy,
        receipt.identity.candidate_policy,
        cached.decision ? &*cached.decision : nullptr,
        nullptr,
    });
    return receipt;
}

inline BuildReceipt complete(
    const Request& request,
    BuildReceipt receipt,
    const proof_gated_execution::Evidence& measured
) {
    if (receipt.schedule.outcome !=
        retained_optimization_schedule::Outcome::BenchmarkRequired) {
        return receipt;
    }
    receipt.identity = derive_identity(request);
    receipt.schedule = retained_optimization_schedule::plan({
        receipt.identity.program_fingerprint,
        receipt.identity.function_fingerprint,
        request.deterministic,
        receipt.identity.proof_key,
        receipt.identity.baseline_policy,
        receipt.identity.candidate_policy,
        nullptr,
        &measured,
    });
    const bool candidate_enabled = receipt.schedule.outcome ==
        retained_optimization_schedule::Outcome::EnabledByMeasurement;
    const bool retain_negative = receipt.schedule.outcome ==
            retained_optimization_schedule::Outcome::BaselineExplicitlyRetained &&
        (receipt.schedule.proof.rejection ==
             proof_gated_execution::Rejection::NotFaster ||
         receipt.schedule.proof.rejection ==
             proof_gated_execution::Rejection::Unproven) &&
        request.current_epoch_seconds != 0 &&
        request.negative_retention_seconds != 0;
    if (candidate_enabled || retain_negative) {
        const auto maximum = std::numeric_limits<std::uint64_t>::max();
        const auto negative_expiry = retain_negative
            ? request.current_epoch_seconds >
                    maximum - request.negative_retention_seconds
                ? maximum
                : request.current_epoch_seconds +
                    request.negative_retention_seconds
            : 0;
        const retained_optimization_cache::Record record{
            receipt.identity,
            request.deterministic,
            measured,
            request.current_epoch_seconds,
            negative_expiry,
        };
        receipt.store_reason = retained_optimization_cache::store_atomic(
            request.cache_path, record
        ).reason;
    }
    return receipt;
}

}  // namespace vkf::retained_optimization_driver
