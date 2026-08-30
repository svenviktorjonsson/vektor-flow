#include "compiler/native/vkf_adaptive_optimizer.hpp"

#include <iostream>
#include <string>

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
