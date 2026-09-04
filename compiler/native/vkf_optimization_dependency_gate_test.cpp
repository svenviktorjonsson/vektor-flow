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
               !pair.effect_knowledge_complete &&
               pair.reason == gate::Reason::UnresolvedCall &&
               gate::reason_name(pair.reason) == "unresolved-call" &&
               pair.functions.size() == 2 &&
               pair.functions[0].dependencies ==
                   std::vector<std::string>({"shared"}),
           "an unresolved nested call must keep an automatic CPU pair serial with an explicit reason");

    vkf::machine_ir::Function shared;
    shared.name = "shared";
    call.symbol = "missing-leaf";
    shared.instructions = {call};
    module.functions = {left, right, shared};
    const auto transitive = gate::analyze_pair(module, "left", "right");
    expect(!transitive.effect_knowledge_complete &&
               transitive.reason == gate::Reason::UnresolvedCall,
           "an unresolved transitive call must reject parallelism before selection");

    vkf::machine_ir::Instruction write;
    write.opcode = vkf::machine_ir::Opcode::WriteString;
    shared.instructions = {write};
    module.functions = {left, right, shared};
    const auto effectful = gate::analyze_pair(module, "left", "right");
    expect(effectful.effect_knowledge_complete &&
               !effectful.effects_proven_absent &&
               effectful.reason == gate::Reason::TransitiveOrderedEffect &&
               gate::reason_name(effectful.reason) ==
                   "transitive-ordered-effect" &&
               !effectful.parallelism_allowed,
           "a resolved transitive ordered effect must keep the pair serial with an explicit reason");

    call.symbol = "shared";
    shared.instructions = {call};
    module.functions = {left, right, shared};
    const auto recursive = gate::analyze_pair(module, "left", "right");
    expect(!recursive.effect_knowledge_complete &&
               recursive.reason == gate::Reason::RecursiveCallGraph &&
               gate::reason_name(recursive.reason) ==
                   "recursive-call-graph" &&
               !recursive.parallelism_allowed,
           "a recursive closure must remain serial until recursive effects are proven");

    shared.instructions.clear();
    shared.may_error = true;
    module.functions = {left, right, shared};
    const auto fallible = gate::analyze_pair(module, "left", "right");
    expect(fallible.effect_knowledge_complete &&
               !fallible.effects_proven_absent &&
               fallible.reason == gate::Reason::TransitiveFallibility &&
               gate::reason_name(fallible.reason) ==
                   "transitive-fallibility" &&
               !fallible.parallelism_allowed,
           "a transitive error boundary must keep the pair serial with an explicit reason");

    shared.may_error = false;
    shared.owned_f64_list_locals = {0};
    module.functions = {left, right, shared};
    const auto resource = gate::analyze_pair(module, "left", "right");
    expect(resource.effect_knowledge_complete &&
               !resource.effects_proven_absent &&
               resource.reason == gate::Reason::TransitiveOwnedResource &&
               gate::reason_name(resource.reason) ==
                   "transitive-owned-resource" &&
               !resource.parallelism_allowed,
           "a transitive owned resource must keep the pair serial with an explicit reason");

    shared.owned_f64_list_locals.clear();
    vkf::machine_ir::Instruction system_query;
    system_query.opcode = vkf::machine_ir::Opcode::SystemCpuCount;
    shared.instructions = {system_query, write};
    module.functions = {left, right, shared};
    const auto unclassified = gate::analyze_pair(module, "left", "right");
    expect(!unclassified.effect_knowledge_complete &&
               !unclassified.effects_proven_absent &&
               unclassified.reason ==
                   gate::Reason::TransitiveUnclassifiedOperation &&
               gate::reason_name(unclassified.reason) ==
                   "transitive-unclassified-operation" &&
               !unclassified.parallelism_allowed,
           "an unclassified operation must keep the pair serial regardless of later known effects");

    vkf::machine_ir::Instruction number;
    number.opcode = vkf::machine_ir::Opcode::PushF64;
    vkf::machine_ir::Instruction finish;
    finish.opcode = vkf::machine_ir::Opcode::ReturnF64;
    vkf::machine_ir::Function leaf;
    leaf.name = "leaf";
    leaf.instructions = {number, finish};
    left.instructions[0].argument_count = 0;
    call.symbol = "leaf";
    call.argument_count = 0;
    shared.instructions = {call};
    module.functions = {left, right, shared, leaf};
    const auto complete_pure = gate::analyze_pair(module, "left", "right");
    expect(complete_pure.effect_knowledge_complete &&
               complete_pure.effects_proven_absent &&
               complete_pure.value_knowledge_complete &&
               complete_pure.values_proven_independent &&
               complete_pure.alias_knowledge_complete &&
               complete_pure.mutable_aliases_proven_disjoint &&
               complete_pure.resolved_call_graph &&
               complete_pure.reason == gate::Reason::Independent &&
               complete_pure.functions[0].transitive_dependencies ==
                   std::vector<std::string>({"shared", "leaf"}) &&
               complete_pure.independence_proven &&
               complete_pure.parallelism_allowed,
           "a complete zero-argument scalar-pure call graph must prove value and alias independence");

    shared.locals = {"borrowed"};
    shared.local_classes = {vkf::machine_ir::ValueClass::Address};
    module.functions = {left, right, shared, leaf};
    const auto alias_unknown = gate::analyze_pair(module, "left", "right");
    expect(alias_unknown.effect_knowledge_complete &&
               alias_unknown.effects_proven_absent &&
               alias_unknown.value_knowledge_complete &&
               alias_unknown.values_proven_independent &&
               !alias_unknown.alias_knowledge_complete &&
               !alias_unknown.mutable_aliases_proven_disjoint &&
               alias_unknown.reason == gate::Reason::MutableAliasUnknown &&
               gate::reason_name(alias_unknown.reason) ==
                   "mutable-alias-unknown" &&
               !alias_unknown.parallelism_allowed,
           "an address-bearing closure must remain serial when mutable aliases are unknown");

    shared.locals.clear();
    shared.local_classes.clear();
    shared.parameters = {"value"};
    shared.parameter_is_numeric_scalar = {true};
    left.instructions[0].argument_count = 1;
    module.functions = {left, right, shared, leaf};
    const auto value_dependent = gate::analyze_pair(module, "left", "right");
    expect(value_dependent.effect_knowledge_complete &&
               value_dependent.effects_proven_absent &&
               !value_dependent.value_knowledge_complete &&
               !value_dependent.values_proven_independent &&
               !value_dependent.parameter_provenance_complete &&
               value_dependent.alias_knowledge_complete &&
               value_dependent.mutable_aliases_proven_disjoint &&
               value_dependent.reason ==
                   gate::Reason::ParameterProvenanceUnknown &&
               gate::reason_name(value_dependent.reason) ==
                   "parameter-provenance-unknown" &&
               !value_dependent.parallelism_allowed,
           "a parameter-fed closure must remain serial without a value-flow independence proof");

    vkf::machine_ir::Instruction literal;
    literal.opcode = vkf::machine_ir::Opcode::PushF64;
    literal.f64 = 3.0;
    vkf::machine_ir::Instruction parameter_call;
    parameter_call.opcode = vkf::machine_ir::Opcode::Call;
    parameter_call.symbol = "parameter_shared";
    parameter_call.argument_count = 1;
    parameter_call.result_count = 1;
    parameter_call.provided_parameter_mask = 1;
    vkf::machine_ir::Function parameter_left;
    parameter_left.name = "parameter_left";
    parameter_left.instructions = {literal, parameter_call};
    literal.f64 = 5.0;
    vkf::machine_ir::Function parameter_right;
    parameter_right.name = "parameter_right";
    parameter_right.instructions = {literal, parameter_call};
    vkf::machine_ir::Instruction load_parameter;
    load_parameter.opcode = vkf::machine_ir::Opcode::LoadLocal;
    load_parameter.index = 0;
    vkf::machine_ir::Function parameter_shared;
    parameter_shared.name = "parameter_shared";
    parameter_shared.parameters = {"value"};
    parameter_shared.parameter_is_numeric_scalar = {true};
    parameter_shared.locals = {"value"};
    parameter_shared.local_classes = {vkf::machine_ir::ValueClass::F64};
    parameter_shared.result_is_numeric_scalar = true;
    parameter_shared.instructions = {load_parameter, finish};
    module.functions = {
        parameter_left, parameter_right, parameter_shared,
    };
    const auto scalar_parameter_pair = gate::analyze_pair(
        module, "parameter_left", "parameter_right"
    );
    expect(scalar_parameter_pair.parameter_provenance_complete &&
               scalar_parameter_pair.borrow_regions_complete &&
               scalar_parameter_pair.mutable_borrows_proven_disjoint &&
               scalar_parameter_pair.value_knowledge_complete &&
               scalar_parameter_pair.values_proven_independent &&
               scalar_parameter_pair.alias_knowledge_complete &&
               scalar_parameter_pair.mutable_aliases_proven_disjoint &&
               scalar_parameter_pair.reason == gate::Reason::Independent &&
               scalar_parameter_pair.independence_proven &&
               scalar_parameter_pair.parallelism_allowed,
           "distinct literal scalar arguments and read-only scalar parameter regions must prove the pair independent");

    parameter_shared.parameter_is_numeric_scalar = {false};
    parameter_shared.local_classes = {vkf::machine_ir::ValueClass::Address};
    module.functions = {
        parameter_left, parameter_right, parameter_shared,
    };
    const auto mutable_parameter_pair = gate::analyze_pair(
        module, "parameter_left", "parameter_right"
    );
    expect(mutable_parameter_pair.parameter_provenance_complete &&
               !mutable_parameter_pair.borrow_regions_complete &&
               !mutable_parameter_pair.mutable_borrows_proven_disjoint &&
               !mutable_parameter_pair.alias_knowledge_complete &&
               !mutable_parameter_pair.mutable_aliases_proven_disjoint &&
               mutable_parameter_pair.reason ==
                   gate::Reason::MutableBorrowUnknown &&
               gate::reason_name(mutable_parameter_pair.reason) ==
                   "mutable-borrow-unknown" &&
               !mutable_parameter_pair.parallelism_allowed,
           "an address parameter must remain serial when mutable borrow regions are unknown");

    auto root_left = parameter_shared;
    root_left.name = "root_left";
    root_left.parameter_is_numeric_scalar = {true};
    root_left.local_classes = {vkf::machine_ir::ValueClass::F64};
    auto root_right = root_left;
    root_right.name = "root_right";
    auto root_call = [](const std::string& symbol) {
        vkf::machine_ir::Instruction value;
        value.opcode = vkf::machine_ir::Opcode::Call;
        value.symbol = symbol;
        value.argument_count = 1;
        value.result_count = 1;
        value.provided_parameter_mask = 1;
        return value;
    };
    auto root_local = [](vkf::machine_ir::Opcode opcode, std::uint32_t index) {
        vkf::machine_ir::Instruction value;
        value.opcode = opcode;
        value.index = index;
        return value;
    };
    auto root_finish = finish;
    root_finish.opcode = vkf::machine_ir::Opcode::ReturnValues;
    root_finish.result_count = 2;
    literal.f64 = 7.0;
    module.entry.instructions = {
        literal,
        root_call("root_left"),
        root_local(vkf::machine_ir::Opcode::StoreLocal, 0),
        literal,
        root_call("root_right"),
        root_local(vkf::machine_ir::Opcode::StoreLocal, 1),
        root_local(vkf::machine_ir::Opcode::LoadLocal, 0),
        root_local(vkf::machine_ir::Opcode::LoadLocal, 1),
        root_finish,
    };
    module.functions = {root_left, root_right};
    const auto literal_root_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(literal_root_pair.parameter_provenance_complete &&
               literal_root_pair.borrow_regions_complete &&
               literal_root_pair.independence_proven &&
               literal_root_pair.parallelism_allowed &&
               literal_root_pair.reason == gate::Reason::Independent,
           "entry-supplied literal scalar roots must prove read-only parameter provenance");

    root_left.may_error = true;
    root_right.may_error = true;
    vkf::machine_ir::Instruction assertion_condition;
    assertion_condition.opcode = vkf::machine_ir::Opcode::PushF64;
    assertion_condition.f64 = 0.0;
    vkf::machine_ir::Instruction assertion;
    assertion.opcode = vkf::machine_ir::Opcode::AssertTruthy;
    assertion.index = 0;
    assertion.byte_count = 12;
    vkf::machine_ir::Instruction drop_assertion;
    drop_assertion.opcode = vkf::machine_ir::Opcode::Drop;
    root_left.instructions.insert(
        root_left.instructions.begin(),
        {assertion_condition, assertion, drop_assertion}
    );
    assertion.index = 12;
    root_right.instructions.insert(
        root_right.instructions.begin(),
        {assertion_condition, assertion, drop_assertion}
    );
    module.string_data.assign(
        {'l','e','f','t',' ','f','a','i','l','u','r','e',
         'r','i','g','h','t',' ','f','a','i','l','u','r','e'}
    );
    module.entry.instructions[1].may_error = true;
    module.entry.instructions[4].may_error = true;
    module.functions = {root_left, root_right};
    const auto deterministic_error_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(deterministic_error_pair.error_knowledge_complete &&
               deterministic_error_pair.errors_source_ordered &&
               deterministic_error_pair.join_cleanup_required &&
               deterministic_error_pair.parallelism_allowed &&
               deterministic_error_pair.reason == gate::Reason::Independent,
           "static terminal root errors must be eligible only with source-order and join-cleanup proof");

    root_left.instructions[1].has_error_handler = true;
    module.functions = {root_left, root_right};
    const auto handled_error_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(!handled_error_pair.error_knowledge_complete &&
               handled_error_pair.reason == gate::Reason::TransitiveFallibility &&
               !handled_error_pair.parallelism_allowed,
           "handled or non-terminal fallibility must remain serial");
    root_left.instructions[1].has_error_handler = false;
    root_left.owned_f64_list_locals = {0};
    module.functions = {root_left, root_right};
    const auto owned_error_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(!owned_error_pair.error_knowledge_complete &&
               owned_error_pair.reason == gate::Reason::TransitiveFallibility &&
               !owned_error_pair.parallelism_allowed,
           "terminal fallibility must not mask an owned-resource dependency");
    root_left.owned_f64_list_locals.clear();
    root_left.may_error = false;
    root_right.may_error = false;
    root_left.instructions.erase(root_left.instructions.begin(), root_left.instructions.begin() + 3);
    root_right.instructions.erase(root_right.instructions.begin(), root_right.instructions.begin() + 3);
    module.entry.instructions[1].may_error = false;
    module.entry.instructions[4].may_error = false;
    module.string_data.clear();
    module.functions = {root_left, root_right};

    module.entry.instructions[0].opcode = vkf::machine_ir::Opcode::AddF64;
    const auto computed_root_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(computed_root_pair.reason == gate::Reason::ParameterProvenanceUnknown &&
               !computed_root_pair.parallelism_allowed,
           "a computed entry argument must remain serial without exact provenance");
    module.entry.instructions[0].opcode = vkf::machine_ir::Opcode::LoadLocal;
    const auto forwarded_root_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(forwarded_root_pair.reason == gate::Reason::ParameterProvenanceUnknown &&
               !forwarded_root_pair.parallelism_allowed,
           "a forwarded entry argument must remain serial without exact provenance");
    module.entry.instructions[0] = literal;
    module.entry.instructions[1].provided_parameter_mask = 0;
    const auto defaulted_root_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(defaulted_root_pair.reason == gate::Reason::ParameterProvenanceUnknown &&
               !defaulted_root_pair.parallelism_allowed,
           "a defaulted entry parameter must remain serial");
    module.entry.instructions[1].provided_parameter_mask = 1;
    module.entry.instructions[1].owns_input = true;
    const auto owned_root_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(owned_root_pair.reason == gate::Reason::MutableBorrowUnknown &&
               !owned_root_pair.parallelism_allowed,
           "an owned entry argument must remain serial without a disjoint borrow proof");
    module.entry.instructions[1].owns_input = false;
    root_left.parameter_is_numeric_scalar = {false};
    root_left.local_classes = {vkf::machine_ir::ValueClass::Address};
    module.functions = {root_left, root_right};
    const auto address_root_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(address_root_pair.reason == gate::Reason::MutableBorrowUnknown &&
               !address_root_pair.parallelism_allowed,
           "an address entry parameter must remain serial");
    root_left.local_classes = {vkf::machine_ir::ValueClass::Aggregate};
    module.functions = {root_left, root_right};
    const auto aggregate_root_pair = gate::analyze_pair(
        module, "root_left", "root_right"
    );
    expect(aggregate_root_pair.reason == gate::Reason::MutableBorrowUnknown &&
               !aggregate_root_pair.parallelism_allowed,
           "an aggregate entry parameter must remain serial");

    module.entry.instructions.clear();
    module.functions = {right};
    const auto independent = gate::analyze_module(module);
    expect(independent.independence_proven &&
               independent.composition_allowed &&
               independent.parallelism_allowed &&
               independent.value_knowledge_complete &&
               independent.values_proven_independent &&
               independent.alias_knowledge_complete &&
               independent.mutable_aliases_proven_disjoint &&
               independent.reason == gate::Reason::Independent,
           "call-free zero-argument functions must retain the independent composition path");

    module.entry.instructions = {number, finish};
    module.entry.locals = {"borrowed"};
    module.entry.local_classes = {vkf::machine_ir::ValueClass::Aggregate};
    module.functions.clear();
    const auto module_alias_unknown = gate::analyze_module(module);
    expect(module_alias_unknown.effect_knowledge_complete &&
               module_alias_unknown.effects_proven_absent &&
               module_alias_unknown.value_knowledge_complete &&
               module_alias_unknown.values_proven_independent &&
               !module_alias_unknown.alias_knowledge_complete &&
               !module_alias_unknown.mutable_aliases_proven_disjoint &&
               module_alias_unknown.reason ==
                   gate::Reason::MutableAliasUnknown &&
               !module_alias_unknown.composition_allowed,
           "module composition must remain serial when a mutable alias class is not proven disjoint");

    module.entry.locals.clear();
    module.entry.local_classes.clear();
    module.entry.instructions = {system_query};
    module.functions.clear();
    const auto unknown_module = gate::analyze_module(module);
    expect(!unknown_module.effect_knowledge_complete &&
               !unknown_module.effects_proven_absent &&
               !unknown_module.composition_allowed &&
               unknown_module.reason ==
                   gate::Reason::TransitiveUnclassifiedOperation,
           "module composition must reject an operation without a complete effect summary");

    std::cout << "optimization dependency gate: reason="
              << gate::reason_name(receipt.reason) << " pair="
              << gate::reason_name(pair.reason) << " independent="
              << independent.independence_proven << " pure_call="
              << gate::reason_name(complete_pure.reason) << " parameter_pair="
              << gate::reason_name(scalar_parameter_pair.reason) << " borrow="
              << gate::reason_name(mutable_parameter_pair.reason) << '\n';
    return failures == 0 ? 0 : 1;
}
