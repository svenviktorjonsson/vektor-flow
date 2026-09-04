#pragma once

#include "compiler/native/vkf_machine_ir.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace vkf::optimization_dependency_gate {

enum class Reason {
    Independent,
    ParameterizedFunction,
    CallGraphDependency,
    UnresolvedCall,
    RecursiveCallGraph,
    TransitiveOrderedEffect,
    TransitiveFallibility,
    TransitiveOwnedResource,
    TransitiveUnclassifiedOperation,
    ValueDependency,
    ParameterProvenanceUnknown,
    MutableBorrowUnknown,
    MutableAliasUnknown,
    MissingFunction,
    SameFunction,
};

inline std::string_view reason_name(Reason reason) {
    switch (reason) {
        case Reason::Independent: return "independent";
        case Reason::ParameterizedFunction: return "parameterized-function";
        case Reason::CallGraphDependency: return "call-graph-dependency";
        case Reason::UnresolvedCall: return "unresolved-call";
        case Reason::RecursiveCallGraph: return "recursive-call-graph";
        case Reason::TransitiveOrderedEffect:
            return "transitive-ordered-effect";
        case Reason::TransitiveFallibility: return "transitive-fallibility";
        case Reason::TransitiveOwnedResource:
            return "transitive-owned-resource";
        case Reason::TransitiveUnclassifiedOperation:
            return "transitive-unclassified-operation";
        case Reason::ValueDependency: return "value-dependency";
        case Reason::ParameterProvenanceUnknown:
            return "parameter-provenance-unknown";
        case Reason::MutableBorrowUnknown: return "mutable-borrow-unknown";
        case Reason::MutableAliasUnknown: return "mutable-alias-unknown";
        case Reason::MissingFunction: return "missing-function";
        case Reason::SameFunction: return "same-function";
    }
    return "unknown";
}

struct FunctionReceipt {
    std::string name;
    Reason reason = Reason::Independent;
    std::vector<std::string> dependencies;
    std::vector<std::string> transitive_dependencies;
};

struct Receipt {
    std::vector<FunctionReceipt> functions;
    Reason reason = Reason::Independent;
    bool independence_proven = false;
    bool composition_allowed = false;
    bool parallelism_allowed = false;
    bool effect_knowledge_complete = false;
    bool effects_proven_absent = false;
    bool value_knowledge_complete = false;
    bool values_proven_independent = false;
    bool parameter_provenance_complete = false;
    bool borrow_regions_complete = false;
    bool mutable_borrows_proven_disjoint = false;
    bool alias_knowledge_complete = false;
    bool mutable_aliases_proven_disjoint = false;
    bool resolved_call_graph = false;
};

inline FunctionReceipt analyze_function(
    const machine_ir::Function& function
) {
    FunctionReceipt receipt;
    receipt.name = function.name;
    if (!function.parameters.empty()) {
        receipt.reason = Reason::ParameterizedFunction;
    }
    for (const auto& instruction : function.instructions) {
        if (instruction.opcode != machine_ir::Opcode::Call) continue;
        receipt.dependencies.push_back(instruction.symbol);
        if (receipt.reason == Reason::Independent) {
            receipt.reason = Reason::CallGraphDependency;
        }
    }
    return receipt;
}

inline bool proven_scalar_pure(machine_ir::Opcode opcode);
inline Reason direct_value_reason(const machine_ir::Function& function);
inline bool direct_mutable_alias_unknown(
    const machine_ir::Function& function
);

inline int effect_reason_priority(Reason reason) {
    switch (reason) {
        case Reason::TransitiveOwnedResource: return 1;
        case Reason::TransitiveFallibility: return 2;
        case Reason::TransitiveOrderedEffect: return 3;
        case Reason::TransitiveUnclassifiedOperation: return 4;
        default: return 0;
    }
}

inline Reason strongest_effect_reason(Reason left, Reason right) {
    return effect_reason_priority(right) > effect_reason_priority(left)
        ? right
        : left;
}

inline Reason direct_effect_reason(const machine_ir::Function& function) {
    Reason reason = Reason::Independent;
    if (!function.owned_f64_list_locals.empty() ||
        !function.owned_string_locals.empty()) {
        reason = strongest_effect_reason(
            reason, Reason::TransitiveOwnedResource
        );
    }
    if (function.may_error) {
        reason = strongest_effect_reason(
            reason, Reason::TransitiveFallibility
        );
    }
    for (const auto& instruction : function.instructions) {
        if (instruction.may_error) {
            reason = strongest_effect_reason(
                reason, Reason::TransitiveFallibility
            );
        }
        if (instruction.opcode == machine_ir::Opcode::Call) continue;
        if (instruction.opcode == machine_ir::Opcode::WriteString) {
            reason = strongest_effect_reason(
                reason, Reason::TransitiveOrderedEffect
            );
        } else if (!proven_scalar_pure(instruction.opcode)) {
            reason = strongest_effect_reason(
                reason, Reason::TransitiveUnclassifiedOperation
            );
        }
    }
    return reason;
}

inline Reason direct_value_reason(const machine_ir::Function& function) {
    Reason reason = function.parameters.empty()
        ? Reason::Independent
        : Reason::ParameterizedFunction;
    for (const auto& instruction : function.instructions) {
        if (instruction.opcode != machine_ir::Opcode::Call) continue;
        if (instruction.argument_count != 0u ||
            instruction.result_count != 1u ||
            instruction.provided_parameter_mask != 0u) {
            reason = Reason::ValueDependency;
        }
    }
    return reason;
}

inline bool direct_mutable_alias_unknown(
    const machine_ir::Function& function
) {
    return function.local_classes.size() != function.locals.size() ||
        std::any_of(
            function.local_classes.begin(),
            function.local_classes.end(),
            [](machine_ir::ValueClass value_class) {
                return value_class == machine_ir::ValueClass::Address ||
                    value_class == machine_ir::ValueClass::Aggregate;
            }
        );
}

inline Reason parameter_call_reason(
    const machine_ir::Function& caller,
    std::size_t instruction_index,
    const machine_ir::Function& callee
) {
    const auto& call = caller.instructions[instruction_index];
    const auto parameter_count = callee.parameters.size();
    if (call.argument_count != parameter_count || call.result_count != 1u ||
        parameter_count > 32u) {
        return Reason::ParameterProvenanceUnknown;
    }
    if (parameter_count == 0u) {
        return call.provided_parameter_mask == 0u
            ? Reason::Independent
            : Reason::ParameterProvenanceUnknown;
    }
    if (instruction_index < parameter_count) {
        return Reason::ParameterProvenanceUnknown;
    }
    if (callee.parameter_is_numeric_scalar.size() != parameter_count ||
        callee.locals.size() < parameter_count ||
        callee.local_classes.size() < parameter_count ||
        !std::equal(
            callee.parameters.begin(), callee.parameters.end(),
            callee.locals.begin()
        ) ||
        !std::all_of(
            callee.parameter_is_numeric_scalar.begin(),
            callee.parameter_is_numeric_scalar.end(),
            [](bool numeric) { return numeric; }
        ) ||
        !std::all_of(
            callee.local_classes.begin(),
            callee.local_classes.begin() +
                static_cast<std::ptrdiff_t>(parameter_count),
            [](machine_ir::ValueClass value_class) {
                return value_class == machine_ir::ValueClass::F64;
            }
        ) || !callee.result_is_numeric_scalar || callee.parameter_mask_local ||
        call.owns_input || call.owns_left || call.owns_right) {
        return Reason::MutableBorrowUnknown;
    }
    const auto provided_mask = parameter_count == 32u
        ? 0xffffffffu
        : (1u << parameter_count) - 1u;
    if (call.provided_parameter_mask != provided_mask) {
        return Reason::ParameterProvenanceUnknown;
    }
    for (std::size_t offset = 0; offset < parameter_count; ++offset) {
        if (caller.instructions[
                instruction_index - parameter_count + offset
            ].opcode != machine_ir::Opcode::PushF64) {
            return Reason::ParameterProvenanceUnknown;
        }
    }
    for (const auto& instruction : callee.instructions) {
        if ((instruction.opcode == machine_ir::Opcode::StoreLocal ||
             instruction.opcode == machine_ir::Opcode::StoreF64LocalsIndex) &&
            instruction.index < parameter_count) {
            return Reason::MutableBorrowUnknown;
        }
    }
    return Reason::Independent;
}

inline Receipt analyze_module(const machine_ir::Module& module) {
    Receipt receipt;
    receipt.functions.reserve(module.functions.size() + 1u);
    receipt.functions.push_back(analyze_function(module.entry));
    for (const auto& function : module.functions) {
        receipt.functions.push_back(analyze_function(function));
    }
    for (const auto& function : receipt.functions) {
        if (function.reason != Reason::Independent) {
            receipt.reason = function.reason;
            return receipt;
        }
    }
    Reason effect_reason = direct_effect_reason(module.entry);
    for (const auto& function : module.functions) {
        const auto function_effect = direct_effect_reason(function);
        effect_reason = strongest_effect_reason(
            effect_reason, function_effect
        );
    }
    if (effect_reason == Reason::TransitiveUnclassifiedOperation) {
        receipt.reason = effect_reason;
        return receipt;
    }
    receipt.effect_knowledge_complete = true;
    receipt.effects_proven_absent = effect_reason == Reason::Independent;
    if (effect_reason != Reason::Independent) {
        receipt.reason = effect_reason;
        return receipt;
    }
    Reason value_reason = direct_value_reason(module.entry);
    bool mutable_alias_unknown =
        direct_mutable_alias_unknown(module.entry);
    for (const auto& function : module.functions) {
        const auto function_value = direct_value_reason(function);
        if (function_value == Reason::ValueDependency ||
            (function_value == Reason::ParameterizedFunction &&
             value_reason == Reason::Independent)) {
            value_reason = function_value;
        }
        mutable_alias_unknown = mutable_alias_unknown ||
            direct_mutable_alias_unknown(function);
    }
    receipt.value_knowledge_complete =
        value_reason == Reason::Independent;
    receipt.values_proven_independent = receipt.value_knowledge_complete;
    receipt.alias_knowledge_complete = !mutable_alias_unknown;
    receipt.mutable_aliases_proven_disjoint =
        receipt.alias_knowledge_complete;
    if (mutable_alias_unknown) {
        receipt.reason = Reason::MutableAliasUnknown;
        return receipt;
    }
    if (value_reason != Reason::Independent) {
        receipt.reason = value_reason;
        return receipt;
    }
    receipt.independence_proven = true;
    receipt.composition_allowed = true;
    receipt.parallelism_allowed = true;
    receipt.value_knowledge_complete = true;
    receipt.values_proven_independent = true;
    receipt.parameter_provenance_complete = true;
    receipt.borrow_regions_complete = true;
    receipt.mutable_borrows_proven_disjoint = true;
    receipt.alias_knowledge_complete = true;
    receipt.mutable_aliases_proven_disjoint = true;
    return receipt;
}

inline const machine_ir::Function* find_function(
    const machine_ir::Module& module,
    std::string_view name
) {
    const auto found = std::find_if(
        module.functions.begin(),
        module.functions.end(),
        [&](const auto& function) { return function.name == name; }
    );
    return found == module.functions.end() ? nullptr : &*found;
}

inline bool proven_scalar_pure(machine_ir::Opcode opcode) {
    using Opcode = machine_ir::Opcode;
    switch (opcode) {
        case Opcode::PushF64:
        case Opcode::LoadLocal:
        case Opcode::StoreLocal:
        case Opcode::Drop:
        case Opcode::Duplicate:
        case Opcode::IdentityF64:
        case Opcode::NegateF64:
        case Opcode::LogicalNotF64:
        case Opcode::BooleanizeF64:
        case Opcode::AddF64:
        case Opcode::SubtractF64:
        case Opcode::MultiplyF64:
        case Opcode::DivideF64:
        case Opcode::FloorDivideF64:
        case Opcode::AbsF64:
        case Opcode::SqrtF64:
        case Opcode::SinF64:
        case Opcode::CosF64:
        case Opcode::ExpF64:
        case Opcode::LnF64:
        case Opcode::RemainderF64:
        case Opcode::PowerF64:
        case Opcode::LogicalXorF64:
        case Opcode::OrderedLessF64:
        case Opcode::OrderedLessEqualF64:
        case Opcode::OrderedGreaterF64:
        case Opcode::OrderedGreaterEqualF64:
        case Opcode::OrderedEqualF64:
        case Opcode::UnorderedNotEqualF64:
        case Opcode::EqualBits:
        case Opcode::NotEqualBits:
        case Opcode::Label:
        case Opcode::Jump:
        case Opcode::JumpIfFalse:
        case Opcode::JumpIfTrue:
        case Opcode::ReturnF64:
            return true;
        default:
            return false;
    }
}

inline Reason resolve_call_closure(
    const machine_ir::Module& module,
    const machine_ir::Function& function,
    bool parameters_proven,
    std::vector<std::string>& visiting,
    std::vector<std::string>& transitive_dependencies,
    Reason& value_reason,
    Reason& parameter_reason,
    bool& mutable_alias_unknown
) {
    if (std::find(visiting.begin(), visiting.end(), function.name) !=
        visiting.end()) {
        return Reason::RecursiveCallGraph;
    }
    visiting.push_back(function.name);
    if (!function.parameters.empty() && !parameters_proven &&
        value_reason == Reason::Independent) {
        value_reason = Reason::ParameterizedFunction;
    }
    mutable_alias_unknown = mutable_alias_unknown ||
        direct_mutable_alias_unknown(function);
    Reason reason = direct_effect_reason(function);
    for (std::size_t instruction_index = 0;
         instruction_index < function.instructions.size();
         ++instruction_index) {
        const auto& instruction = function.instructions[instruction_index];
        if (instruction.opcode != machine_ir::Opcode::Call) continue;
        if (std::find(
                transitive_dependencies.begin(),
                transitive_dependencies.end(),
                instruction.symbol
            ) == transitive_dependencies.end()) {
            transitive_dependencies.push_back(instruction.symbol);
        }
        const auto* dependency = find_function(module, instruction.symbol);
        if (dependency == nullptr) return Reason::UnresolvedCall;
        const auto call_reason = parameter_call_reason(
            function, instruction_index, *dependency
        );
        if (call_reason != Reason::Independent &&
            parameter_reason == Reason::Independent) {
            parameter_reason = call_reason;
        }
        const auto nested = resolve_call_closure(
            module,
            *dependency,
            call_reason == Reason::Independent,
            visiting,
            transitive_dependencies,
            value_reason,
            parameter_reason,
            mutable_alias_unknown
        );
        if (nested == Reason::UnresolvedCall ||
            nested == Reason::RecursiveCallGraph) {
            return nested;
        }
        reason = strongest_effect_reason(reason, nested);
    }
    visiting.pop_back();
    return reason;
}

inline Receipt analyze_pair(
    const machine_ir::Module& module,
    std::string_view left_name,
    std::string_view right_name
) {
    Receipt receipt;
    if (left_name == right_name) {
        receipt.reason = Reason::SameFunction;
        return receipt;
    }
    const auto* left = find_function(module, left_name);
    const auto* right = find_function(module, right_name);
    if (left == nullptr || right == nullptr) {
        receipt.reason = Reason::MissingFunction;
        return receipt;
    }
    receipt.functions = {analyze_function(*left), analyze_function(*right)};
    std::vector<std::string> visiting;
    Reason closure_reason = Reason::Independent;
    Reason value_reason = Reason::Independent;
    Reason parameter_reason = Reason::Independent;
    bool mutable_alias_unknown = false;
    for (std::size_t index = 0; index < receipt.functions.size(); ++index) {
        const auto* function = index == 0u ? left : right;
        const auto closure = resolve_call_closure(
            module,
            *function,
            false,
            visiting,
            receipt.functions[index].transitive_dependencies,
            value_reason,
            parameter_reason,
            mutable_alias_unknown
        );
        if (closure == Reason::UnresolvedCall ||
            closure == Reason::RecursiveCallGraph ||
            closure == Reason::TransitiveUnclassifiedOperation) {
            receipt.reason = closure;
            return receipt;
        }
        closure_reason = strongest_effect_reason(
            closure_reason, closure
        );
    }
    receipt.effect_knowledge_complete = true;
    receipt.effects_proven_absent = closure_reason == Reason::Independent;
    if (closure_reason != Reason::Independent) {
        receipt.reason = closure_reason;
        return receipt;
    }
    receipt.value_knowledge_complete = value_reason == Reason::Independent &&
        parameter_reason != Reason::ParameterProvenanceUnknown;
    receipt.values_proven_independent = receipt.value_knowledge_complete;
    receipt.parameter_provenance_complete =
        parameter_reason != Reason::ParameterProvenanceUnknown;
    receipt.borrow_regions_complete =
        parameter_reason != Reason::MutableBorrowUnknown;
    receipt.mutable_borrows_proven_disjoint =
        receipt.borrow_regions_complete;
    receipt.alias_knowledge_complete = !mutable_alias_unknown &&
        receipt.borrow_regions_complete;
    receipt.mutable_aliases_proven_disjoint =
        receipt.alias_knowledge_complete;
    if (parameter_reason == Reason::ParameterProvenanceUnknown ||
        parameter_reason == Reason::MutableBorrowUnknown) {
        receipt.reason = parameter_reason;
        return receipt;
    }
    if (mutable_alias_unknown) {
        receipt.reason = Reason::MutableAliasUnknown;
        return receipt;
    }
    if (value_reason != Reason::Independent) {
        receipt.reason = value_reason;
        return receipt;
    }
    for (const auto& function : receipt.functions) {
        if (function.reason != Reason::Independent &&
            function.reason != Reason::CallGraphDependency) {
            receipt.reason = function.reason;
            return receipt;
        }
    }
    for (auto& function : receipt.functions) {
        if (function.reason == Reason::CallGraphDependency) {
            function.reason = Reason::Independent;
        }
    }
    receipt.resolved_call_graph = std::any_of(
        receipt.functions.begin(),
        receipt.functions.end(),
        [](const auto& function) { return !function.dependencies.empty(); }
    );
    receipt.independence_proven = true;
    receipt.composition_allowed = true;
    receipt.parallelism_allowed = true;
    receipt.parameter_provenance_complete = true;
    receipt.borrow_regions_complete = true;
    receipt.mutable_borrows_proven_disjoint = true;
    return receipt;
}

}  // namespace vkf::optimization_dependency_gate
