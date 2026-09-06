#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace vkf::call_binding {

class Error : public std::runtime_error {
public:
    explicit Error(const std::string& message) : std::runtime_error(message) {}
};

struct Parameter {
    std::string name;
    bool has_default = false;
};

enum class OperandKind { Positional, Named, PackedPositional, FixedSpread, PackedNamed };

struct OperandReference {
    OperandKind kind;
    std::size_t index;
};

struct FixedCallPlan {
    std::vector<std::optional<OperandReference>> parameters;
    std::uint32_t provided_mask = 0;
    std::uint32_t defaulted_mask = 0;
    std::uint32_t missing_required_mask = 0;
};

struct PositionalCallPlacement {
    std::size_t fixed_count = 0;
    std::size_t rest_begin = 0;
};

// Native placement rules only. Consumers evaluate fixed operands in their
// existing parameter order, then pack rest operands in original array order.
inline PositionalCallPlacement plan_positional_call(
    std::size_t parameter_count,
    std::size_t argument_count,
    std::optional<std::size_t> variadic_index,
    const std::string& symbol
) {
    if (parameter_count > 32) throw Error("direct machine IR calls support at most 32 parameters");
    if (!variadic_index && argument_count > parameter_count) {
        throw Error("too many arguments for direct machine IR call " + symbol);
    }
    if (variadic_index && *variadic_index + 1 != parameter_count) {
        throw Error("direct machine IR variadic positional parameter must be last");
    }
    return {variadic_index ? std::min(argument_count, *variadic_index) : argument_count,
        variadic_index ? std::min(argument_count, *variadic_index) : argument_count};
}

// Incremental form lets native validate each operand at its original point;
// collecting all names first could change which malformed-IR error wins.
inline std::size_t bind_named_argument(
    FixedCallPlan& plan,
    const std::vector<Parameter>& parameters,
    const std::string& name,
    std::size_t argument_index,
    const std::string& symbol
) {
    const auto found = std::find_if(parameters.begin(), parameters.end(),
        [&](const Parameter& parameter) { return parameter.name == name; });
    if (found == parameters.end()) {
        throw Error("unknown named argument " + name + " for " + symbol);
    }
    const auto index = static_cast<std::size_t>(found - parameters.begin());
    if (plan.parameters[index]) throw Error("multiple values for argument " + name);
    plan.parameters[index] = OperandReference{OperandKind::Named, argument_index};
    const auto bit = std::uint32_t{1} << index;
    plan.provided_mask |= bit;
    plan.defaulted_mask &= ~bit;
    plan.missing_required_mask &= ~bit;
    return index;
}

// Extracted fixed-call binding rules from the native machine-IR lowering.
// This is placement, not evaluation: no expressions/defaults are executed and
// no caller/callee environments, resource layouts, or public ABI are introduced.
// Spreads and variadic parameters must use their existing path until extracted.
// Required holes are reported, not thrown here: native emits their diagnostic
// at its existing parameter-lowering point, after earlier argument processing.
inline FixedCallPlan plan_fixed_call(
    const std::vector<Parameter>& parameters,
    std::size_t positional_count,
    const std::vector<std::string>& named_arguments,
    const std::string& symbol
) {
    if (parameters.size() > 32) {
        throw Error("direct machine IR calls support at most 32 parameters");
    }
    if (positional_count > parameters.size()) {
        throw Error("too many arguments for direct machine IR call " + symbol);
    }
    FixedCallPlan plan;
    plan.parameters.resize(parameters.size());
    for (std::size_t index = 0; index < positional_count; ++index) {
        plan.parameters[index] = OperandReference{OperandKind::Positional, index};
    }
    for (std::size_t index = 0; index < parameters.size(); ++index) {
        const auto bit = std::uint32_t{1} << index;
        if (plan.parameters[index]) plan.provided_mask |= bit;
        else if (parameters[index].has_default) plan.defaulted_mask |= bit;
        else plan.missing_required_mask |= bit;
    }
    for (std::size_t argument = 0; argument < named_arguments.size(); ++argument) {
        bind_named_argument(plan, parameters, named_arguments[argument], argument, symbol);
    }
    return plan;
}

} // namespace vkf::call_binding
