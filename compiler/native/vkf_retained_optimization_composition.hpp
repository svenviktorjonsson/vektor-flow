#pragma once

#include "compiler/native/vkf_retained_optimization_driver.hpp"

#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace vkf::retained_optimization_composition {

struct Function {
    std::string name;
    std::string material;
    bool deterministic = false;
};

struct ProofScope {
    std::string optimizer;
    std::string implementation;
    std::string workload_family;
    std::string oracle;
};

struct Request {
    std::filesystem::path cache_root;
    std::string program_material;
    std::string host_material;
    std::string toolchain_material;
    ProofScope proof;
    std::string baseline_policy;
    std::string candidate_policy;
    std::vector<Function> functions;
    std::uint64_t current_epoch_seconds = 0;
    std::uint64_t negative_retention_seconds = 0;
};

struct FunctionBuild {
    std::string name;
    retained_optimization_driver::Request request;
    retained_optimization_driver::BuildReceipt build;
};

enum class Reason {
    AllProven,
    MeasurementRequired,
    BaselineRequired,
    Blocked,
};

inline std::string_view reason_name(Reason reason) {
    switch (reason) {
        case Reason::AllProven: return "all-proven";
        case Reason::MeasurementRequired: return "measurement-required";
        case Reason::BaselineRequired: return "baseline-required";
        case Reason::Blocked: return "blocked";
    }
    return "unknown";
}

struct Receipt {
    std::vector<FunctionBuild> functions;
    Reason reason = Reason::MeasurementRequired;
    std::string selected_policy;
    bool optimization_enabled = false;
};

inline void refresh(Receipt& receipt, const Request& request) {
    bool measurement_required = false;
    bool baseline_required = false;
    for (const auto& function : receipt.functions) {
        if (function.build.schedule.outcome ==
            retained_optimization_schedule::Outcome::Blocked) {
            receipt.reason = Reason::Blocked;
            receipt.selected_policy.clear();
            receipt.optimization_enabled = false;
            return;
        }
        if (function.build.schedule.outcome ==
            retained_optimization_schedule::Outcome::BenchmarkRequired) {
            measurement_required = true;
        } else if (!function.build.schedule.optimization_enabled) {
            baseline_required = true;
        }
    }
    if (measurement_required) {
        receipt.reason = Reason::MeasurementRequired;
        receipt.selected_policy = request.baseline_policy;
        receipt.optimization_enabled = false;
    } else if (baseline_required || receipt.functions.empty()) {
        receipt.reason = Reason::BaselineRequired;
        receipt.selected_policy = request.baseline_policy;
        receipt.optimization_enabled = false;
    } else {
        receipt.reason = Reason::AllProven;
        receipt.selected_policy = request.candidate_policy;
        receipt.optimization_enabled = true;
    }
}

inline Receipt prepare(const Request& request) {
    Receipt receipt;
    receipt.functions.reserve(request.functions.size());
    for (const auto& function : request.functions) {
        retained_optimization_driver::Request driver_request{
            request.cache_root /
                (retained_optimization_driver::fingerprint(
                    "function-slot", function.name
                ) + ".proof"),
            {
                request.program_material,
                function.material,
                request.host_material,
                request.toolchain_material,
            },
            function.deterministic,
            {
                request.proof.optimizer,
                request.proof.implementation,
                request.proof.workload_family,
                "zero-argument-leaf-v1",
                request.proof.oracle,
            },
            request.baseline_policy,
            request.candidate_policy,
            request.current_epoch_seconds,
            request.negative_retention_seconds,
        };
        auto build = retained_optimization_driver::prepare(driver_request);
        receipt.functions.push_back({
            function.name,
            std::move(driver_request),
            std::move(build),
        });
    }
    refresh(receipt, request);
    return receipt;
}

inline Receipt complete(
    const Request& request,
    Receipt receipt,
    std::size_t function_index,
    const proof_gated_execution::Evidence& measured
) {
    if (function_index >= receipt.functions.size()) {
        throw std::out_of_range("retained function receipt index");
    }
    auto& function = receipt.functions[function_index];
    function.build = retained_optimization_driver::complete(
        function.request, std::move(function.build), measured
    );
    refresh(receipt, request);
    return receipt;
}

}  // namespace vkf::retained_optimization_composition
