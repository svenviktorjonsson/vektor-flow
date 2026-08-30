#include "compiler/native/vkf_adaptive_optimizer.hpp"

#include <chrono>
#include <future>
#include <iostream>
#include <string>
#include <tuple>
#include <vector>

namespace {

using vkf::machine_ir::Function;
using vkf::machine_ir::Instruction;
using vkf::machine_ir::Opcode;

int failures = 0;

void expect(bool condition, const std::string& message) {
    if (condition) return;
    std::cerr << message << '\n';
    ++failures;
}

Function function_with(std::initializer_list<Opcode> opcodes) {
    Function function;
    function.name = "flow";
    for (const auto opcode : opcodes) function.instructions.push_back(Instruction{opcode});
    return function;
}

}  // namespace

int main() {
    vkf::adaptive_optimizer::AutomaticFlowLimits automatic_limits;
    expect(vkf::adaptive_optimizer::automatic_cpu_partition_limit(
               automatic_limits, 12) == 12,
           "omitted max_cores must preserve automatic host selection");
    expect(automatic_limits.enable_gpu,
           "omitted enable_gpu must preserve automatic GPU eligibility");
    automatic_limits.max_cores = 6;
    expect(vkf::adaptive_optimizer::automatic_cpu_partition_limit(
               automatic_limits, 12) == 6,
           "max_cores must cap automatic CPU partitions");
    expect(vkf::adaptive_optimizer::automatic_cpu_partition_limit(
               automatic_limits, 4) == 4,
           "max_cores must never force more CPU partitions than are available");
    automatic_limits.enable_gpu = false;
    expect(!automatic_limits.enable_gpu,
           "a false enable_gpu bit must forbid GPU eligibility");

    automatic_limits.max_cores = 2;
    const auto left_branch = function_with(
        {Opcode::LoadLocal, Opcode::PushF64, Opcode::MultiplyF64, Opcode::ReturnF64});
    const auto right_branch = function_with(
        {Opcode::LoadLocal, Opcode::PushF64, Opcode::AddF64, Opcode::ReturnF64});
    const auto concurrent_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 8, left_branch, 1'048'576, right_branch, 1'048'576, true);
    expect(concurrent_pair.concurrent(),
           "independent replay-safe branches above the benefit threshold must use two CPU lanes");
    expect(!automatic_limits.enable_gpu,
           "automatic CPU execution must not require or imply GPU permission");
    std::promise<void> right_started;
    auto right_started_future = right_started.get_future();
    const auto concurrent_values = vkf::adaptive_optimizer::execute_automatic_cpu_pair(
        concurrent_pair,
        [&]() {
            return right_started_future.wait_for(std::chrono::seconds(1)) ==
                    std::future_status::ready
                ? 11
                : -1;
        },
        [&]() {
            right_started.set_value();
            return 22;
        });
    expect(std::get<0>(concurrent_values) == 11 && std::get<1>(concurrent_values) == 22,
           "automatic CPU branches must overlap and retain source-order results");

    automatic_limits.max_cores = 1;
    const auto one_core_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 8, left_branch, 1'048'576, right_branch, 1'048'576, true);
    expect(!one_core_pair.concurrent() && one_core_pair.lane_limit() == 1,
           "max_cores one must force serial automatic CPU execution");
    std::vector<int> serial_trace;
    const auto serial_values = vkf::adaptive_optimizer::execute_automatic_cpu_pair(
        one_core_pair,
        [&]() { serial_trace.push_back(1); return 11; },
        [&]() { serial_trace.push_back(2); return 22; });
    expect(serial_trace == std::vector<int>({1, 2}) &&
               std::get<0>(serial_values) == 11 && std::get<1>(serial_values) == 22,
           "serial automatic CPU execution must preserve dependency and value order");

    automatic_limits.max_cores = 2;
    const auto dependent_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 8, left_branch, 1'048'576, right_branch, 1'048'576, false);
    expect(!dependent_pair.concurrent(),
           "branches without an independence proof must stay serial");
    serial_trace.clear();
    vkf::adaptive_optimizer::execute_automatic_cpu_pair(
        dependent_pair,
        [&]() { serial_trace.push_back(3); return 33; },
        [&]() { serial_trace.push_back(4); return 44; });
    expect(serial_trace == std::vector<int>({3, 4}),
           "dependent CPU branches must execute in source order");
    const auto one_available_core_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 1, left_branch, 1'048'576, right_branch, 1'048'576, true);
    expect(!one_available_core_pair.concurrent() && one_available_core_pair.lane_limit() == 1,
           "automatic CPU execution must not exceed available cores");
    const auto small_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 8, left_branch, 1'048'575, right_branch, 1'048'576, true);
    expect(!small_pair.concurrent(),
           "branches below the conservative benefit threshold must stay serial");

    const auto effectful_branch = function_with(
        {Opcode::PushString, Opcode::WriteString, Opcode::ReturnValues});
    const auto effectful_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 8, left_branch, 1'048'576, effectful_branch, 1'048'576, true);
    expect(!effectful_pair.concurrent(),
           "ordered effects must stay outside automatic CPU execution");
    serial_trace.clear();
    vkf::adaptive_optimizer::execute_automatic_cpu_pair(
        effectful_pair,
        [&]() { serial_trace.push_back(5); return 55; },
        [&]() { serial_trace.push_back(6); return 66; });
    expect(serial_trace == std::vector<int>({5, 6}),
           "ordered-effect branches must execute in source order");
    const auto reduction_branch = function_with(
        {Opcode::LoadLocal, Opcode::SumF64List, Opcode::ReturnF64});
    const auto reduction_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 8, left_branch, 1'048'576, reduction_branch, 1'048'576, true);
    expect(!reduction_pair.concurrent(),
           "reductions must stay serial until a stable merge tree exists");

    const auto pure = vkf::adaptive_optimizer::automatic_flow_safety(
        function_with({Opcode::LoadLocal, Opcode::PushF64, Opcode::MultiplyF64,
                       Opcode::ReturnF64}));
    expect(pure.deterministic, "pure numeric flow must be deterministic");
    expect(pure.replay_safe, "pure numeric flow must be privately replayable");
    expect(pure.partition_candidate,
           "pure numeric flow must be an automatic partition candidate");
    expect(!pure.requires_ordered_effects,
           "pure numeric flow must not require effect ordering");

    const auto reduction = vkf::adaptive_optimizer::automatic_flow_safety(
        function_with({Opcode::LoadLocal, Opcode::SumF64List, Opcode::ReturnF64}));
    expect(reduction.deterministic, "numeric reduction must stay deterministic");
    expect(reduction.requires_stable_reduction_tree,
           "numeric reduction must require a stable merge tree");
    expect(!reduction.partition_candidate,
           "reduction must not partition before its stable merge tree is selected");

    auto fallible = function_with({Opcode::DivideF64, Opcode::ReturnF64});
    fallible.may_error = true;
    const auto fallible_safety =
        vkf::adaptive_optimizer::automatic_flow_safety(fallible);
    expect(!fallible_safety.replay_safe,
           "fallible flow must not be speculatively replayed");
    expect(!fallible_safety.partition_candidate,
           "fallible flow must preserve deterministic error demand");

    auto resident_resource = function_with(
        {Opcode::LoadLocal, Opcode::LoadF64ListIndex, Opcode::ReturnF64});
    resident_resource.owned_f64_list_locals.push_back(0);
    const auto resource_safety =
        vkf::adaptive_optimizer::automatic_flow_safety(resident_resource);
    expect(!resource_safety.replay_safe,
           "owned vector storage must not be speculatively replayed");
    expect(!resource_safety.partition_candidate,
           "owned vector storage must remain behind demand analysis");

    const auto process = vkf::adaptive_optimizer::automatic_flow_safety(
        function_with({Opcode::PushString, Opcode::ProcessRun, Opcode::ReturnValues}));
    expect(process.external_process_boundary,
           "process execution must remain an explicit external boundary");
    expect(process.requires_ordered_effects,
           "process execution must remain effect ordered");
    expect(!process.replay_safe,
           "process execution must never be replayed by automatic optimization");
    expect(!process.partition_candidate,
           "process execution must never become ordinary flow work");

    const auto output = vkf::adaptive_optimizer::automatic_flow_safety(
        function_with({Opcode::PushString, Opcode::WriteString, Opcode::ReturnValues}));
    expect(!output.external_process_boundary,
           "ordinary output must not be classified as an external process");
    expect(output.requires_ordered_effects,
           "WriteString (::) must preserve source effect order");
    expect(!output.partition_candidate,
           "a WriteString (::) commit must not be automatically partitioned");

    return failures == 0 ? 0 : 1;
}
