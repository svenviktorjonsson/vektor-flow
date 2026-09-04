#include "compiler/native/vkf_optimization_dependency_gate.hpp"

#include <iostream>
#include <string>
#include <utility>
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
    namespace gate = vkf::optimization_dependency_gate;

    vkf::machine_ir::Instruction call;
    call.opcode = vkf::machine_ir::Opcode::Call;
    call.symbol = "scale";
    call.argument_count = 1;
    vkf::machine_ir::Function entry;
    entry.name = "entry";
    entry.instructions = {call};

    vkf::machine_ir::Function scale;
    scale.name = "scale";
    scale.parameters = {"value"};

    vkf::machine_ir::Module module;
    module.entry = std::move(entry);
    module.functions = {std::move(scale)};

    const auto receipt = gate::analyze_module(module);
    expect(!receipt.independence_proven && !receipt.composition_allowed &&
               !receipt.parallelism_allowed,
           "a parameterized call graph must not compose or run in parallel");
    expect(receipt.reason == gate::Reason::CallGraphDependency &&
               gate::reason_name(receipt.reason) == "call-graph-dependency" &&
               receipt.functions.size() == 2 &&
               receipt.functions[1].reason ==
                   gate::Reason::ParameterizedFunction,
           "the private receipt must expose call-graph and parameter rejection reasons");

    vkf::machine_ir::Function left;
    left.name = "left";
    call.symbol = "shared";
    left.instructions = {call};
    vkf::machine_ir::Function right;
    right.name = "right";
    module.functions = {left, right};
    const auto pair = gate::analyze_pair(module, "left", "right");
    expect(!pair.independence_proven && !pair.parallelism_allowed &&
               pair.reason == gate::Reason::CallGraphDependency &&
               pair.functions.size() == 2 &&
               pair.functions[0].dependencies ==
                   std::vector<std::string>({"shared"}),
           "a nested call must keep an automatic CPU pair serial with an explicit dependency");

    module.entry.instructions.clear();
    module.functions = {right};
    const auto independent = gate::analyze_module(module);
    expect(independent.independence_proven &&
               independent.composition_allowed &&
               independent.parallelism_allowed &&
               independent.reason == gate::Reason::Independent,
           "call-free zero-argument functions must retain the independent composition path");

    std::cout << "optimization dependency gate: reason="
              << gate::reason_name(receipt.reason) << " pair="
              << gate::reason_name(pair.reason) << " independent="
              << independent.independence_proven << '\n';
    return failures == 0 ? 0 : 1;
}
