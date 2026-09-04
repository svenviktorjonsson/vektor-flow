#pragma once

#include "compiler/native/vkf_machine_ir.hpp"
#include "compiler/native/vkf_optimization_dependency_gate.hpp"
#include "compiler/native/vkf_proof_gated_execution.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <future>
#include <iomanip>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

namespace vkf::adaptive_optimizer {

inline constexpr std::uint32_t schema_version = 4;

// A policy is deliberately data, not a collection of compile-time switches.
// This lets the empirical tuner compile the same program through multiple
// legal lowering paths and retain the fastest result for that program/host.
struct Policy {
    std::string name = "auto";
    bool borrowed_aggregate_parameters = true;
    bool direct_aggregate_results = true;
    bool packed_matrix_reductions = true;
    bool native_integer_locals = true;
    bool native_index_addressing = true;
    bool parity_specialization = true;
    bool fused_multiply_add = true;
    bool packed_dot_reductions = true;
    // The exhaustive experiment showed the general numeric-map emitter losing
    // on every paired structural candidate. Keep it available for repair, but
    // out of the policy budget. The affine emitter remains a static lowering.
    bool dense_numeric_maps = false;
    bool dense_affine_maps = true;
    bool avx_affine_loops = true;
    bool register_cache = true;
    // Experimental until interval proofs can remove checked-index overhead.
    bool integer_function_tier = true;
};

inline constexpr std::uint32_t borrowed_aggregate_parameter_bit = 1u << 0u;
inline constexpr std::uint32_t direct_aggregate_result_bit = 1u << 1u;
inline constexpr std::uint32_t packed_matrix_reduction_bit = 1u << 2u;
inline constexpr std::uint32_t native_integer_local_bit = 1u << 3u;
inline constexpr std::uint32_t native_index_addressing_bit = 1u << 4u;
inline constexpr std::uint32_t parity_specialization_bit = 1u << 5u;
inline constexpr std::uint32_t fused_multiply_add_bit = 1u << 6u;
inline constexpr std::uint32_t packed_dot_reduction_bit = 1u << 7u;
inline constexpr std::uint32_t policy_mask = borrowed_aggregate_parameter_bit |
    direct_aggregate_result_bit | packed_matrix_reduction_bit | native_integer_local_bit |
    native_index_addressing_bit | parity_specialization_bit |
    fused_multiply_add_bit | packed_dot_reduction_bit;

inline Policy policy_from_mask(std::uint32_t mask) {
    mask &= policy_mask;
    std::ostringstream name;
    name << "mask-" << std::hex << mask;
    Policy selected;
    selected.name = name.str();
    selected.borrowed_aggregate_parameters =
        (mask & borrowed_aggregate_parameter_bit) != 0;
    selected.direct_aggregate_results = (mask & direct_aggregate_result_bit) != 0;
    selected.packed_matrix_reductions = (mask & packed_matrix_reduction_bit) != 0;
    selected.native_integer_locals = (mask & native_integer_local_bit) != 0;
    selected.native_index_addressing = (mask & native_index_addressing_bit) != 0;
    selected.parity_specialization = (mask & parity_specialization_bit) != 0;
    selected.fused_multiply_add = (mask & fused_multiply_add_bit) != 0;
    selected.packed_dot_reductions = (mask & packed_dot_reduction_bit) != 0;
    return selected;
}

inline std::uint32_t mask(const Policy& selected) {
    return (selected.borrowed_aggregate_parameters
                ? borrowed_aggregate_parameter_bit : 0u) |
        (selected.direct_aggregate_results ? direct_aggregate_result_bit : 0u) |
        (selected.packed_matrix_reductions ? packed_matrix_reduction_bit : 0u) |
        (selected.native_integer_locals ? native_integer_local_bit : 0u) |
        (selected.native_index_addressing ? native_index_addressing_bit : 0u) |
        (selected.parity_specialization ? parity_specialization_bit : 0u) |
        (selected.fused_multiply_add ? fused_multiply_add_bit : 0u) |
        (selected.packed_dot_reductions ? packed_dot_reduction_bit : 0u);
}

inline Policy policy(std::string_view name) {
    if (name.empty() || name == "auto") return {};
    if (name == "scalar") {
        Policy selected;
        selected.name = "scalar";
        selected.borrowed_aggregate_parameters = false;
        selected.direct_aggregate_results = false;
        selected.packed_matrix_reductions = false;
        selected.native_integer_locals = false;
        selected.native_index_addressing = false;
        selected.parity_specialization = false;
        selected.fused_multiply_add = false;
        selected.packed_dot_reductions = false;
        selected.dense_numeric_maps = false;
        selected.dense_affine_maps = false;
        selected.avx_affine_loops = false;
        selected.register_cache = false;
        selected.integer_function_tier = false;
        return selected;
    }
    if (name.rfind("mask-", 0) == 0 && name.size() > 5) {
        std::uint32_t value = 0;
        for (const char digit : name.substr(5)) {
            value <<= 4u;
            if (digit >= '0' && digit <= '9') value |= static_cast<std::uint32_t>(digit - '0');
            else if (digit >= 'a' && digit <= 'f') value |= static_cast<std::uint32_t>(digit - 'a' + 10);
            else if (digit >= 'A' && digit <= 'F') value |= static_cast<std::uint32_t>(digit - 'A' + 10);
            else throw std::invalid_argument("invalid optimizer policy mask '" + std::string(name) + "'");
        }
        if ((value & ~policy_mask) != 0) {
            throw std::invalid_argument("optimizer policy mask enables unknown switches");
        }
        return policy_from_mask(value);
    }
    throw std::invalid_argument("unknown optimizer policy '" + std::string(name) + "'");
}

struct RegionDecision {
    std::uint32_t label = 0;
    std::uint32_t width = 0;
    std::string kind;
    std::string strategy;
};

struct FunctionDecision {
    std::string name;
    std::string fingerprint;
    std::string target_features;
    bool pure = true;
    bool deterministic = true;
    std::uint32_t instruction_count = 0;
    std::uint32_t local_count = 0;
    std::uint32_t loop_count = 0;
    std::uint32_t integer_local_count = 0;
    std::vector<std::string> strategies;
    std::vector<RegionDecision> regions;
};

inline bool is_effectful(machine_ir::Opcode opcode) {
    using machine_ir::Opcode;
    switch (opcode) {
        case Opcode::WriteString:
        case Opcode::ReadLineString:
        case Opcode::ReadFileString:
        case Opcode::WriteFileString:
        case Opcode::MonotonicF64:
        case Opcode::WallTimeF64:
        case Opcode::SleepF64:
        case Opcode::LocalTimeParts:
        case Opcode::SystemCpuCount:
        case Opcode::SystemCwdString:
        case Opcode::SystemEnvString:
        case Opcode::ProcessRun:
        case Opcode::ExitProgram:
            return true;
        default:
            return false;
    }
}

inline bool is_nondeterministic(machine_ir::Opcode opcode) {
    using machine_ir::Opcode;
    return opcode == Opcode::ReadLineString || opcode == Opcode::ReadFileString ||
        opcode == Opcode::MonotonicF64 || opcode == Opcode::WallTimeF64 ||
        opcode == Opcode::LocalTimeParts || opcode == Opcode::SystemCpuCount ||
        opcode == Opcode::SystemCwdString || opcode == Opcode::SystemEnvString ||
        opcode == Opcode::ProcessRun;
}

// Private safety boundary for automatic ordinary-flow scheduling. This does
// not select a backend or grant permission to reorder dependencies: it only
// records which functions may enter replay/partition analysis at all.
struct AutomaticFlowSafety {
    bool deterministic = true;
    bool replay_safe = true;
    bool partition_candidate = true;
    bool requires_ordered_effects = false;
    bool requires_stable_reduction_tree = false;
    bool external_process_boundary = false;
};

struct AutomaticFlowLimits {
    std::optional<std::uint32_t> max_cores;
    // Mirrors the VKF `process.enable_gpu` bit. Permission is not a command.
    bool enable_gpu = true;
};

inline std::uint32_t automatic_cpu_partition_limit(
    const AutomaticFlowLimits& limits,
    std::uint32_t available_cores
) {
    return limits.max_cores
        ? std::min(available_cores, *limits.max_cores)
        : available_cores;
}

inline bool is_reduction(machine_ir::Opcode opcode) {
    using machine_ir::Opcode;
    switch (opcode) {
        case Opcode::SumF64Values:
        case Opcode::MeanF64Values:
        case Opcode::VarianceF64Values:
        case Opcode::StdDevF64Values:
        case Opcode::RangeF64Values:
        case Opcode::CountValues:
        case Opcode::SumF64Locals:
        case Opcode::MeanF64Locals:
        case Opcode::VarianceF64Locals:
        case Opcode::StdDevF64Locals:
        case Opcode::RangeF64Locals:
        case Opcode::CountLocalValues:
        case Opcode::SumF64List:
        case Opcode::MeanF64List:
        case Opcode::VarianceF64List:
        case Opcode::StdDevF64List:
        case Opcode::RangeF64List:
        case Opcode::CountF64List:
            return true;
        default:
            return false;
    }
}

inline AutomaticFlowSafety automatic_flow_safety(
    const machine_ir::Function& function
) {
    AutomaticFlowSafety safety;
    bool may_error = function.may_error;
    for (const auto& instruction : function.instructions) {
        const bool private_csv_read = instruction.opcode == machine_ir::Opcode::Call &&
            instruction.symbol == "$internal.csv_project_transform_sum";
        safety.deterministic =
            safety.deterministic && !is_nondeterministic(instruction.opcode) &&
            !private_csv_read;
        safety.requires_ordered_effects =
            safety.requires_ordered_effects || is_effectful(instruction.opcode) ||
            private_csv_read;
        safety.requires_stable_reduction_tree =
            safety.requires_stable_reduction_tree || is_reduction(instruction.opcode);
        safety.external_process_boundary = safety.external_process_boundary ||
            instruction.opcode == machine_ir::Opcode::ProcessRun;
        may_error = may_error || instruction.may_error;
    }
    safety.replay_safe = safety.deterministic &&
        !safety.requires_ordered_effects && !may_error &&
        function.owned_f64_list_locals.empty() &&
        function.owned_string_locals.empty();
    // Dependency and demand analysis must still prove independent partitions.
    // Reductions wait for a fixed logical merge tree so device/worker count
    // cannot change the result.
    safety.partition_candidate =
        safety.replay_safe && !safety.requires_stable_reduction_tree;
    return safety;
}

// The first executable CPU-flow seam is deliberately a pair. The caller must
// already have proved the demands independent and supplies a conservative work
// estimate; safety classification and process limits remain authoritative.
inline constexpr std::uint64_t automatic_cpu_minimum_branch_work = 1ull << 20u;

class AutomaticCpuPairPlan {
public:
    bool concurrent() const noexcept { return concurrent_; }
    std::uint32_t lane_limit() const noexcept { return lane_limit_; }

private:
    friend AutomaticCpuPairPlan automatic_cpu_pair_plan(
        const AutomaticFlowLimits&, std::uint32_t,
        const machine_ir::Function&, std::uint64_t,
        const machine_ir::Function&, std::uint64_t, bool);
    friend AutomaticCpuPairPlan automatic_cpu_pair_plan(
        const AutomaticFlowLimits&, std::uint32_t,
        const machine_ir::Function&, const machine_ir::Function&, bool,
        const proof_gated_execution::Decision&, bool);

    bool concurrent_ = false;
    std::uint32_t lane_limit_ = 1;
};

inline AutomaticCpuPairPlan automatic_cpu_pair_plan(
    const AutomaticFlowLimits& limits,
    std::uint32_t available_cores,
    const machine_ir::Function& left,
    std::uint64_t left_work,
    const machine_ir::Function& right,
    std::uint64_t right_work,
    bool independent
) {
    AutomaticCpuPairPlan plan;
    plan.lane_limit_ = std::max(
        1u, automatic_cpu_partition_limit(limits, std::max(1u, available_cores)));
    if (!independent || plan.lane_limit_ < 2 ||
        left_work < automatic_cpu_minimum_branch_work ||
        right_work < automatic_cpu_minimum_branch_work) {
        return plan;
    }
    plan.concurrent_ = automatic_flow_safety(left).partition_candidate &&
        automatic_flow_safety(right).partition_candidate;
    return plan;
}

// Measured-proof variant for new automatic scheduling paths. A correct
// candidate is still insufficient: the paired benchmark must prove it faster
// than baseline before concurrency can be selected.
inline AutomaticCpuPairPlan automatic_cpu_pair_plan(
    const AutomaticFlowLimits& limits,
    std::uint32_t available_cores,
    const machine_ir::Function& left,
    const machine_ir::Function& right,
    bool independent,
    const proof_gated_execution::Decision& proof,
    bool deterministic_error_propagation = false
) {
    AutomaticCpuPairPlan plan;
    plan.lane_limit_ = std::max(
        1u, automatic_cpu_partition_limit(limits, std::max(1u, available_cores)));
    if (!independent || !proof.use_candidate || plan.lane_limit_ < 2) {
        return plan;
    }
    const auto branch_candidate = [&](const machine_ir::Function& function) {
        const auto safety = automatic_flow_safety(function);
        if (safety.partition_candidate) return true;
        return deterministic_error_propagation && safety.deterministic &&
            !safety.requires_ordered_effects &&
            !safety.requires_stable_reduction_tree &&
            function.owned_f64_list_locals.empty() &&
            function.owned_string_locals.empty();
    };
    plan.concurrent_ = branch_candidate(left) && branch_candidate(right);
    return plan;
}

template <typename LeftDemand, typename RightDemand>
auto execute_automatic_cpu_pair(
    const AutomaticCpuPairPlan& plan,
    LeftDemand&& left,
    RightDemand&& right
) {
    using LeftResult = std::decay_t<std::invoke_result_t<LeftDemand>>;
    using RightResult = std::decay_t<std::invoke_result_t<RightDemand>>;
    static_assert(!std::is_void_v<LeftResult> && !std::is_void_v<RightResult>,
                  "automatic CPU demands must return retained values");
    if (!plan.concurrent()) {
        auto left_value = std::forward<LeftDemand>(left)();
        auto right_value = std::forward<RightDemand>(right)();
        return std::tuple<LeftResult, RightResult>(
            std::move(left_value), std::move(right_value));
    }
    auto left_future = std::async(std::launch::async, std::forward<LeftDemand>(left));
    std::optional<RightResult> right_value;
    std::exception_ptr right_error;
    try {
        right_value.emplace(std::forward<RightDemand>(right)());
    } catch (...) {
        right_error = std::current_exception();
    }
    std::optional<LeftResult> left_value;
    std::exception_ptr left_error;
    try {
        left_value.emplace(left_future.get());
    } catch (...) {
        left_error = std::current_exception();
    }
    if (left_error) std::rethrow_exception(left_error);
    if (right_error) std::rethrow_exception(right_error);
    return std::tuple<LeftResult, RightResult>(
        std::move(*left_value), std::move(*right_value));
}

inline std::uint64_t automatic_static_loop_work(
    const machine_ir::Function& function
) {
    using machine_ir::Opcode;
    const auto& code = function.instructions;
    for (std::size_t label_index = 2; label_index + 5 < code.size(); ++label_index) {
        const auto& label = code[label_index];
        const auto& counter = code[label_index + 1];
        const auto& bound = code[label_index + 2];
        const auto comparison = code[label_index + 3].opcode;
        const auto& exit = code[label_index + 4];
        if (label.opcode != Opcode::Label || counter.opcode != Opcode::LoadLocal ||
            bound.opcode != Opcode::PushF64 || comparison != Opcode::OrderedLessF64 ||
            exit.opcode != Opcode::JumpIfFalse ||
            bound.f64 < 1.0 || bound.f64 != std::floor(bound.f64) ||
            bound.f64 > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
            continue;
        }
        bool initialized = false;
        for (std::size_t index = 0; index + 1u < label_index; ++index) {
            initialized = initialized ||
                (code[index].opcode == Opcode::PushF64 && code[index].f64 == 0.0 &&
                 code[index + 1u].opcode == Opcode::StoreLocal &&
                 code[index + 1u].index == counter.index);
        }
        if (!initialized) continue;
        for (std::size_t jump_index = label_index + 5; jump_index < code.size(); ++jump_index) {
            if (code[jump_index].opcode != Opcode::Jump ||
                code[jump_index].label != label.label || jump_index < 4u) {
                continue;
            }
            const bool unit_increment = code[jump_index - 4u].opcode == Opcode::LoadLocal &&
                code[jump_index - 4u].index == counter.index &&
                code[jump_index - 3u].opcode == Opcode::PushF64 &&
                code[jump_index - 3u].f64 == 1.0 &&
                code[jump_index - 2u].opcode == Opcode::AddF64 &&
                code[jump_index - 1u].opcode == Opcode::StoreLocal &&
                code[jump_index - 1u].index == counter.index;
            if (unit_increment) return static_cast<std::uint64_t>(bound.f64);
        }
    }
    return 0;
}

// Resolved call graphs require the measured-proof overload. Static dependency,
// value, and borrow facts admit a benchmark candidate; only the retained exact
// artifact-pair measurement can select concurrent execution.
struct AutomaticCpuPairEntryShape {
    std::size_t left_call = 0;
    std::size_t left_store = 0;
    std::size_t right_call = 0;
    std::size_t right_store = 0;
    std::size_t left_load = 0;
    std::size_t right_load = 0;
    std::size_t result = 0;
    bool literal_scalar_arguments = false;
    bool error_capable = false;
};

inline std::optional<AutomaticCpuPairEntryShape>
automatic_cpu_pair_entry_shape(const machine_ir::Module& module) {
    using machine_ir::Opcode;
    const auto& entry = module.entry.instructions;
    AutomaticCpuPairEntryShape shape;
    if (entry.size() == 7u) {
        shape = {0u, 1u, 2u, 3u, 4u, 5u, 6u, false};
    } else if (entry.size() == 9u &&
               entry[0].opcode == Opcode::PushF64 &&
               entry[3].opcode == Opcode::PushF64) {
        shape = {1u, 2u, 4u, 5u, 6u, 7u, 8u, true};
    } else {
        return std::nullopt;
    }
    const auto& left_call = entry[shape.left_call];
    const auto& right_call = entry[shape.right_call];
    const auto& left_store = entry[shape.left_store];
    const auto& right_store = entry[shape.right_store];
    const auto& left_load = entry[shape.left_load];
    const auto& right_load = entry[shape.right_load];
    const auto& result = entry[shape.result];
    const auto expected_arguments = shape.literal_scalar_arguments ? 1u : 0u;
    const auto expected_mask = shape.literal_scalar_arguments ? 1u : 0u;
    if (left_call.opcode != Opcode::Call ||
        right_call.opcode != Opcode::Call ||
        left_store.opcode != Opcode::StoreLocal ||
        right_store.opcode != Opcode::StoreLocal ||
        left_load.opcode != Opcode::LoadLocal ||
        right_load.opcode != Opcode::LoadLocal ||
        result.opcode != Opcode::ReturnValues ||
        left_call.argument_count != expected_arguments ||
        right_call.argument_count != expected_arguments ||
        left_call.provided_parameter_mask != expected_mask ||
        right_call.provided_parameter_mask != expected_mask ||
        left_call.result_count != 1u || right_call.result_count != 1u ||
        left_store.index == right_store.index ||
        left_load.index != left_store.index ||
        right_load.index != right_store.index || result.result_count != 2u ||
        left_call.symbol == right_call.symbol) {
        return std::nullopt;
    }
    shape.error_capable = left_call.may_error || right_call.may_error;
    return shape;
}

inline bool select_automatic_cpu_pair(
    const machine_ir::Module& module,
    const AutomaticFlowLimits& limits,
    std::uint32_t available_cores,
    const proof_gated_execution::Decision* measured_call_graph_proof
) {
    const auto& entry = module.entry.instructions;
    const auto shape = automatic_cpu_pair_entry_shape(module);
    if (!shape) return false;
    const auto& left_call = entry[shape->left_call];
    const auto& right_call = entry[shape->right_call];
    const auto dependency_receipt =
        optimization_dependency_gate::analyze_pair(
            module, left_call.symbol, right_call.symbol
        );
    if (!dependency_receipt.parallelism_allowed) return false;
    const auto function_named = [&](const std::string& name) {
        return std::find_if(
            module.functions.begin(), module.functions.end(),
            [&](const auto& function) { return function.name == name; });
    };
    const auto left = function_named(left_call.symbol);
    const auto right = function_named(right_call.symbol);
    if (left == module.functions.end() || right == module.functions.end() ||
        left->parameters.size() != right->parameters.size() ||
        left->parameters.size() !=
            static_cast<std::size_t>(shape->literal_scalar_arguments) ||
        !left->result_is_numeric_scalar || !right->result_is_numeric_scalar ||
        left_call.may_error != left->may_error ||
        right_call.may_error != right->may_error ||
        (shape->error_capable &&
         (!dependency_receipt.error_knowledge_complete ||
          !dependency_receipt.errors_source_ordered ||
          !dependency_receipt.join_cleanup_required))) {
        return false;
    }
    const auto left_work = automatic_static_loop_work(*left);
    const auto right_work = automatic_static_loop_work(*right);
    if (dependency_receipt.resolved_call_graph) {
        if (measured_call_graph_proof == nullptr ||
            left_work < automatic_cpu_minimum_branch_work ||
            right_work < automatic_cpu_minimum_branch_work) {
            return false;
        }
        const auto plan = automatic_cpu_pair_plan(
            limits,
            available_cores,
            *left,
            *right,
            true,
            *measured_call_graph_proof,
            dependency_receipt.error_knowledge_complete
        );
        return plan.concurrent();
    }
    const auto plan = automatic_cpu_pair_plan(
        limits, available_cores,
        *left, left_work, *right, right_work, true
    );
    return plan.concurrent();
}

inline bool automatic_cpu_pair_candidate_eligible(
    const machine_ir::Module& module,
    const AutomaticFlowLimits& limits,
    std::uint32_t available_cores
) {
    proof_gated_execution::Decision eligibility;
    eligibility.use_candidate = true;
    eligibility.rejection = proof_gated_execution::Rejection::None;
    return select_automatic_cpu_pair(
        module, limits, available_cores, &eligibility
    );
}

inline bool select_automatic_cpu_pair(
    const machine_ir::Module& module,
    const AutomaticFlowLimits& limits,
    std::uint32_t available_cores
) {
    return select_automatic_cpu_pair(
        module, limits, available_cores, nullptr
    );
}

inline bool select_automatic_cpu_pair(
    const machine_ir::Module& module,
    const AutomaticFlowLimits& limits,
    std::uint32_t available_cores,
    const proof_gated_execution::Decision& measured_call_graph_proof
) {
    return select_automatic_cpu_pair(
        module, limits, available_cores, &measured_call_graph_proof
    );
}

inline void append_unique(std::vector<std::string>& values, std::string value) {
    if (std::find(values.begin(), values.end(), value) == values.end()) {
        values.push_back(std::move(value));
    }
}

inline std::uint64_t fnv1a(std::string_view value, std::uint64_t hash = 1469598103934665603ull) {
    for (const unsigned char byte : value) {
        hash ^= byte;
        hash *= 1099511628211ull;
    }
    return hash;
}

inline std::string hexadecimal(std::uint64_t value) {
    std::ostringstream out;
    out << std::hex << std::setfill('0') << std::setw(16) << value;
    return out.str();
}

inline std::string decision_fingerprint(const FunctionDecision& decision) {
    std::ostringstream material;
    material << "vkf-adaptive-v" << schema_version << '|' << decision.target_features << '|'
             << decision.name << '|' << decision.instruction_count << '|'
             << decision.local_count << '|' << decision.loop_count << '|'
             << decision.integer_local_count << '|' << decision.pure << '|'
             << decision.deterministic;
    for (const auto& strategy : decision.strategies) material << '|' << strategy;
    for (const auto& region : decision.regions) {
        material << '|' << region.label << ':' << region.width << ':'
                 << region.kind << ':' << region.strategy;
    }
    return hexadecimal(fnv1a(material.str()));
}

inline std::vector<RegionDecision> structural_regions(
    const machine_ir::Function& function,
    bool supports_simd
) {
    using machine_ir::Opcode;
    std::vector<RegionDecision> regions;
    const auto& code = function.instructions;
    for (std::size_t index = 0; index + 8 < code.size(); ++index) {
        const auto& label = code[index];
        const auto& counter = code[index + 1];
        const auto& width = code[index + 2];
        const auto& comparison = code[index + 3];
        const auto& exit = code[index + 4];
        const auto& store_index = code[index + 5];
        const auto& load_index = code[index + 6];
        const auto& load = code[index + 7];
        if (label.opcode != Opcode::Label || counter.opcode != Opcode::LoadLocal ||
            width.opcode != Opcode::PushF64 ||
            comparison.opcode != Opcode::OrderedLessF64 ||
            exit.opcode != Opcode::JumpIfFalse ||
            store_index.opcode != Opcode::LoadLocal ||
            load_index.opcode != Opcode::LoadLocal ||
            load.opcode != Opcode::LoadF64LocalsIndex ||
            width.f64 < 1.0 || width.f64 != std::floor(width.f64) ||
            width.f64 > static_cast<double>(std::numeric_limits<std::uint32_t>::max()) ||
            counter.index != store_index.index || counter.index != load_index.index ||
            !load.index_local || *load.index_local != counter.index) {
            continue;
        }
        const auto fixed_width = static_cast<std::uint32_t>(width.f64);
        regions.push_back({
            label.label,
            fixed_width,
            "structural-map",
            supports_simd && fixed_width >= 8u ? "simd" : "scalar"
        });
    }
    return regions;
}

inline FunctionDecision decide(
    const machine_ir::Function& function,
    std::string target_features,
    bool supports_simd
) {
    using machine_ir::Opcode;
    FunctionDecision decision;
    decision.name = function.name;
    decision.target_features = std::move(target_features);
    decision.instruction_count = static_cast<std::uint32_t>(function.instructions.size());
    decision.local_count = static_cast<std::uint32_t>(function.locals.size());
    decision.integer_local_count = static_cast<std::uint32_t>(std::count(
        function.local_classes.begin(), function.local_classes.end(), machine_ir::ValueClass::I64));
    if (decision.integer_local_count != 0) append_unique(decision.strategies, "native-integer");

    for (std::size_t index = 0; index < function.instructions.size(); ++index) {
        const auto& instruction = function.instructions[index];
        const auto opcode = instruction.opcode;
        const bool private_csv_read = opcode == Opcode::Call &&
            instruction.symbol == "$internal.csv_project_transform_sum";
        decision.pure = decision.pure && !is_effectful(opcode) && !private_csv_read;
        decision.deterministic = decision.deterministic &&
            !is_nondeterministic(opcode) && !private_csv_read;
        if (opcode == Opcode::Jump || opcode == Opcode::JumpIfFalse || opcode == Opcode::JumpIfTrue) {
            const auto label = function.instructions[index].label;
            const auto found = std::find_if(
                function.instructions.begin(), function.instructions.begin() + index,
                [label](const auto& instruction) {
                    return instruction.opcode == Opcode::Label && instruction.label == label;
                });
            if (found != function.instructions.begin() + index) ++decision.loop_count;
        }
    }
    decision.regions = structural_regions(function, supports_simd);
    for (const auto& region : decision.regions) {
        append_unique(decision.strategies,
                      region.strategy == "simd" ? "simd-structural" : "scalar-structural");
    }
    if (decision.strategies.empty()) decision.strategies.push_back("baseline");

    decision.fingerprint = decision_fingerprint(decision);
    return decision;
}

inline std::vector<FunctionDecision> decide_module(
    const machine_ir::Module& module,
    std::string target_features,
    bool supports_simd
) {
    std::vector<FunctionDecision> decisions;
    decisions.reserve(module.functions.size() + 1u);
    decisions.push_back(decide(module.entry, target_features, supports_simd));
    for (const auto& function : module.functions) {
        decisions.push_back(decide(function, target_features, supports_simd));
    }
    return decisions;
}

}  // namespace vkf::adaptive_optimizer
