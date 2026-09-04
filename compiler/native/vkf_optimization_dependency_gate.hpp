#pragma once

#include "compiler/native/vkf_machine_ir.hpp"

#include <algorithm>
#include <string>
#include <string_view>
#include <vector>

namespace vkf::optimization_dependency_gate {

enum class Reason {
    Independent,
    ParameterizedFunction,
    CallGraphDependency,
    MissingFunction,
    SameFunction,
};

inline std::string_view reason_name(Reason reason) {
    switch (reason) {
        case Reason::Independent: return "independent";
        case Reason::ParameterizedFunction: return "parameterized-function";
        case Reason::CallGraphDependency: return "call-graph-dependency";
        case Reason::MissingFunction: return "missing-function";
        case Reason::SameFunction: return "same-function";
    }
    return "unknown";
}

struct FunctionReceipt {
    std::string name;
    Reason reason = Reason::Independent;
    std::vector<std::string> dependencies;
};

struct Receipt {
    std::vector<FunctionReceipt> functions;
    Reason reason = Reason::Independent;
    bool independence_proven = false;
    bool composition_allowed = false;
    bool parallelism_allowed = false;
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
    receipt.independence_proven = true;
    receipt.composition_allowed = true;
    receipt.parallelism_allowed = true;
    return receipt;
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
    const auto find_named = [&](std::string_view name) {
        return std::find_if(
            module.functions.begin(),
            module.functions.end(),
            [&](const auto& function) { return function.name == name; }
        );
    };
    const auto left = find_named(left_name);
    const auto right = find_named(right_name);
    if (left == module.functions.end() || right == module.functions.end()) {
        receipt.reason = Reason::MissingFunction;
        return receipt;
    }
    receipt.functions = {analyze_function(*left), analyze_function(*right)};
    for (const auto& function : receipt.functions) {
        if (function.reason != Reason::Independent) {
            receipt.reason = function.reason;
            return receipt;
        }
    }
    receipt.independence_proven = true;
    receipt.parallelism_allowed = true;
    return receipt;
}

}  // namespace vkf::optimization_dependency_gate
