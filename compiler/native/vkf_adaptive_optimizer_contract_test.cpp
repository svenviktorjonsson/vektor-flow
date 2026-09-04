#include "compiler/native/vkf_adaptive_optimizer.hpp"
#include "compiler/native/vkf_proof_gated_execution.hpp"

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
    for (const auto opcode : opcodes) {
        Instruction instruction;
        instruction.opcode = opcode;
        function.instructions.push_back(std::move(instruction));
    }
    return function;
}

Instruction instruction(
    Opcode opcode,
    std::uint32_t index = 0,
    double number = 0.0
) {
    Instruction result;
    result.opcode = opcode;
    result.index = index;
    result.f64 = number;
    return result;
}

Function heavy_calling_branch(const std::string& name) {
    auto label = [](std::uint32_t value) {
        Instruction result;
        result.opcode = Opcode::Label;
        result.label = value;
        return result;
    };
    auto jump = [](Opcode opcode, std::uint32_t value) {
        Instruction result;
        result.opcode = opcode;
        result.label = value;
        return result;
    };
    Instruction call;
    call.opcode = Opcode::Call;
    call.symbol = "shared";
    call.result_count = 1;
    Function function;
    function.name = name;
    function.locals = {"counter"};
    function.local_classes = {vkf::machine_ir::ValueClass::I64};
    function.result_is_numeric_scalar = true;
    function.max_stack = 2;
    function.instructions = {
        instruction(Opcode::PushF64, 0, 0.0),
        instruction(Opcode::StoreLocal, 0),
        label(1),
        instruction(Opcode::LoadLocal, 0),
        instruction(Opcode::PushF64, 0, 1048576.0),
        instruction(Opcode::OrderedLessF64),
        jump(Opcode::JumpIfFalse, 2),
        call,
        instruction(Opcode::Drop),
        instruction(Opcode::LoadLocal, 0),
        instruction(Opcode::PushF64, 0, 1.0),
        instruction(Opcode::AddF64),
        instruction(Opcode::StoreLocal, 0),
        jump(Opcode::Jump, 1),
        label(2),
        instruction(Opcode::PushF64, 0, 1.0),
        instruction(Opcode::ReturnF64),
    };
    return function;
}

}  // namespace

int main() {
    using vkf::proof_gated_execution::Evidence;
    using vkf::proof_gated_execution::Key;
    using vkf::proof_gated_execution::PairedTiming;
    using vkf::proof_gated_execution::Rejection;

    const Key fft_key{
        "adaptive-v4", "implementation-a", "windows-x64-avx2",
        "numeric-fft", "complex-f64:n=1048576", "oracle-a"};
    Evidence proven_fft{
        fft_key, true,
        {{100.0, 50.0}, {101.0, 51.0}, {99.0, 50.0},
         {102.0, 52.0}, {98.0, 49.0}}};
    const auto fft_decision =
        vkf::proof_gated_execution::assess(fft_key, proven_fft);
    expect(fft_decision.use_candidate,
           "a correct statistically faster candidate must be selected");
    expect(fft_decision.rejection == Rejection::None,
           "a proven candidate must have no rejection reason");
    expect(fft_decision.upper_confidence_ratio < 1.0,
           "a proven candidate must have an upper confidence ratio below one");

    Evidence symbolic_evidence = proven_fft;
    symbolic_evidence.key.workload_family = "symbolic-expand";
    expect(!vkf::proof_gated_execution::assess(fft_key, symbolic_evidence).use_candidate,
           "symbolic evidence must never authorize an FFT strategy");
    expect(vkf::proof_gated_execution::assess(fft_key, symbolic_evidence).rejection ==
               Rejection::KeyMismatch,
           "cross-workload evidence must be rejected as a key mismatch");

    Evidence unknown{fft_key, true, {}};
    expect(vkf::proof_gated_execution::assess(fft_key, unknown).rejection ==
               Rejection::InsufficientSamples,
           "unknown evidence must keep execution serial");
    Evidence incorrect = proven_fft;
    incorrect.equivalent_output = false;
    expect(vkf::proof_gated_execution::assess(fft_key, incorrect).rejection ==
               Rejection::IncorrectOutput,
           "incorrect candidate output must keep execution serial");
    Evidence slower{
        fft_key, true,
        {{100.0, 110.0}, {101.0, 112.0}, {99.0, 109.0},
         {102.0, 111.0}, {98.0, 108.0}}};
    expect(vkf::proof_gated_execution::assess(fft_key, slower).rejection ==
               Rejection::NotFaster,
           "a slower candidate must keep execution serial");
    Evidence noisy{
        fft_key, true,
        {{100.0, 50.0}, {100.0, 145.0}, {100.0, 55.0},
         {100.0, 140.0}, {100.0, 50.0}}};
    expect(vkf::proof_gated_execution::assess(fft_key, noisy).rejection ==
               Rejection::Unproven,
           "a noisy apparent win must keep execution serial");
    expect(vkf::proof_gated_execution::fingerprint(fft_key) ==
               vkf::proof_gated_execution::fingerprint(fft_key),
           "proof cache identity must be deterministic");
    auto changed_shape = fft_key;
    changed_shape.workload_shape = "complex-f64:n=2097152";
    expect(vkf::proof_gated_execution::fingerprint(fft_key) !=
               vkf::proof_gated_execution::fingerprint(changed_shape),
           "a workload-shape change must invalidate cached proof");

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
        automatic_limits, 8, left_branch, right_branch, true, fft_decision);
    expect(concurrent_pair.concurrent(),
           "independent replay-safe branches with measured proof must use two CPU lanes");
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
        automatic_limits, 8, left_branch, right_branch, true, fft_decision);
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
        automatic_limits, 8, left_branch, right_branch, false, fft_decision);
    expect(!dependent_pair.concurrent(),
           "branches without an independence proof must stay serial");
    serial_trace.clear();
    vkf::adaptive_optimizer::execute_automatic_cpu_pair(
        dependent_pair,
        [&]() { serial_trace.push_back(3); return 33; },
        [&]() { serial_trace.push_back(4); return 44; });
    expect(serial_trace == std::vector<int>({3, 4}),
           "dependent CPU branches must execute in source order");

    vkf::machine_ir::Instruction call_left;
    call_left.opcode = Opcode::Call;
    call_left.symbol = "left";
    vkf::machine_ir::Instruction call_right = call_left;
    call_right.symbol = "right";
    auto store_left = instruction(Opcode::StoreLocal, 0);
    auto store_right = instruction(Opcode::StoreLocal, 1);
    auto return_pair = instruction(Opcode::ReturnValues);
    return_pair.result_count = 2;
    vkf::machine_ir::Module nested_call_pair;
    nested_call_pair.output_kind = vkf::machine_ir::OutputKind::MultipleF64;
    nested_call_pair.output_count = 2;
    nested_call_pair.entry.locals = {"left", "right"};
    nested_call_pair.entry.instructions = {
        call_left,
        store_left,
        call_right,
        store_right,
        instruction(Opcode::LoadLocal, 0),
        instruction(Opcode::LoadLocal, 1),
        return_pair,
    };
    nested_call_pair.functions = {
        heavy_calling_branch("left"),
        heavy_calling_branch("right"),
        function_with({Opcode::WriteString}),
    };
    nested_call_pair.functions.back().name = "shared";
    const auto nested_dependency =
        vkf::optimization_dependency_gate::analyze_pair(
            nested_call_pair, "left", "right"
        );
    expect(nested_dependency.effect_knowledge_complete &&
               !nested_dependency.effects_proven_absent &&
               nested_dependency.reason ==
                   vkf::optimization_dependency_gate::Reason::
                       TransitiveOrderedEffect,
           "automatic pair analysis must expose the transitive ordered effect");
    expect(!vkf::adaptive_optimizer::select_automatic_cpu_pair(
               nested_call_pair, automatic_limits, 8),
           "nested calls without transitive dependency proof must not select parallel emission");

    nested_call_pair.functions.back() = function_with(
        {Opcode::PushF64, Opcode::ReturnF64}
    );
    nested_call_pair.functions.back().name = "shared";
    nested_call_pair.functions.back().result_is_numeric_scalar = true;
    const auto pure_nested_dependency =
        vkf::optimization_dependency_gate::analyze_pair(
            nested_call_pair, "left", "right"
        );
    expect(pure_nested_dependency.independence_proven &&
               pure_nested_dependency.value_knowledge_complete &&
               pure_nested_dependency.values_proven_independent &&
               pure_nested_dependency.alias_knowledge_complete &&
               pure_nested_dependency.mutable_aliases_proven_disjoint,
           "resolved zero-argument scalar-pure closures must prove independent values and aliases");
    expect(!vkf::adaptive_optimizer::select_automatic_cpu_pair(
               nested_call_pair, automatic_limits, 8),
           "a newly resolved call graph must stay serial without measured pair proof");
    const Key pure_graph_key{
        "adaptive-v4",
        "private-cpu-pair-qopt08",
        "windows-x64-avx2",
        "resolved-scalar-call-pair",
        "left+right:shared-pure-helper",
        "bit-exact-two-f64-v1",
    };
    Evidence pure_graph_evidence{
        pure_graph_key,
        true,
        {{100.0, 50.0}, {101.0, 51.0}, {99.0, 50.0},
         {102.0, 52.0}, {98.0, 49.0}},
    };
    const auto pure_graph_decision =
        vkf::proof_gated_execution::assess(
            pure_graph_key, pure_graph_evidence
        );
    expect(vkf::adaptive_optimizer::select_automatic_cpu_pair(
               nested_call_pair,
               automatic_limits,
               8,
               pure_graph_decision),
           "only a measured-faster value- and alias-independent pure call graph may select the CPU pair candidate");
    Evidence pure_graph_unknown{pure_graph_key, true, {}};
    expect(!vkf::adaptive_optimizer::select_automatic_cpu_pair(
               nested_call_pair,
               automatic_limits,
               8,
               vkf::proof_gated_execution::assess(
                   pure_graph_key, pure_graph_unknown
               )),
           "an eligible pure call graph without sufficient measurements must remain serial");
    nested_call_pair.functions.back().locals = {"borrowed"};
    nested_call_pair.functions.back().local_classes = {
        vkf::machine_ir::ValueClass::Address,
    };
    const auto aliasing_nested_dependency =
        vkf::optimization_dependency_gate::analyze_pair(
            nested_call_pair, "left", "right"
        );
    expect(aliasing_nested_dependency.reason ==
               vkf::optimization_dependency_gate::Reason::
                   MutableAliasUnknown &&
               !aliasing_nested_dependency.alias_knowledge_complete &&
               !aliasing_nested_dependency.parallelism_allowed &&
               !vkf::adaptive_optimizer::select_automatic_cpu_pair(
                   nested_call_pair, automatic_limits, 8),
           "an address-bearing nested closure must keep production CPU-pair selection serial");
    const auto one_available_core_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 1, left_branch, right_branch, true, fft_decision);
    expect(!one_available_core_pair.concurrent() && one_available_core_pair.lane_limit() == 1,
           "automatic CPU execution must not exceed available cores");
    const auto unproven_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 8, left_branch, right_branch, true,
        vkf::proof_gated_execution::assess(fft_key, unknown));
    expect(!unproven_pair.concurrent(),
           "eligible branches without measured proof must stay serial");

    const auto effectful_branch = function_with(
        {Opcode::PushString, Opcode::WriteString, Opcode::ReturnValues});
    const auto effectful_pair = vkf::adaptive_optimizer::automatic_cpu_pair_plan(
        automatic_limits, 8, left_branch, effectful_branch, true, fft_decision);
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
        automatic_limits, 8, left_branch, reduction_branch, true, fft_decision);
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
