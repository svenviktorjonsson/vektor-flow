#pragma once

#include "compiler/native/vkf_value_layout.hpp"

namespace vkf::call_binding {

struct FixedSpreadParameter {
    std::string name;
    machine_ir::detail::ValueLayout layout;
    bool bound = false;
    bool captured_named = false;
};

struct FixedSpreadSelection {
    machine_ir::detail::ValueSlice slice;
    machine_ir::detail::ValueLayout layout;
    std::string selector;
    std::uint32_t index = 0;
};

struct FixedSpreadPlan {
    std::map<std::size_t, FixedSpreadSelection> parameters;
    bool dynamic_list = false;
    bool record = false;
    std::size_t required_count = 0;
};

// Extracted native placement, independent of storage and evaluation. Consumers
// evaluate the sole spread once at their existing point, then read these exact
// projections in parameter order. Dynamic-list count is a runtime check.
inline FixedSpreadPlan plan_fixed_spread(
    const machine_ir::detail::ValueLayout& source,
    const std::vector<FixedSpreadParameter>& parameters,
    const std::string& symbol
) {
    using namespace machine_ir::detail;
    FixedSpreadPlan plan;
    std::vector<std::size_t> targets;
    for (std::size_t index = 0; index < parameters.size(); ++index) {
        if (!parameters[index].bound && !parameters[index].captured_named) targets.push_back(index);
    }
    plan.required_count = targets.size();
    if (source.kind == ValueKind::DynamicF64List) {
        plan.dynamic_list = true;
        for (std::size_t position = 0; position < targets.size(); ++position) {
            plan.parameters[targets[position]] = {{}, parameters[targets[position]].layout,
                std::to_string(position), static_cast<std::uint32_t>(position)};
        }
    } else if (is_record_layout(source)) {
        plan.record = true;
        for (const auto index : targets) {
            const auto supplied = source.selectors.find(parameters[index].name);
            if (supplied == source.selectors.end()) continue;
            plan.parameters[index] = {supplied->second,
                record_field_layout(source, supplied->first, supplied->second), supplied->first, 0};
        }
    } else if (source.kind == ValueKind::Aggregate) {
        std::vector<ValueSlice> items;
        for (const auto& [name, slice] : source.selectors) {
            if (name.find('.') != std::string::npos || name.empty() ||
                !std::all_of(name.begin(), name.end(), [](unsigned char ch) { return std::isdigit(ch); })) continue;
            items.push_back(slice);
        }
        std::stable_sort(items.begin(), items.end(), [](const auto& left, const auto& right) {
            return left.offset < right.offset;
        });
        if (items.size() != targets.size()) {
            throw machine_ir::LoweringFailure("spread argument count mismatch for " + symbol);
        }
        for (std::size_t position = 0; position < targets.size(); ++position) {
            plan.parameters[targets[position]] = {items[position],
                record_field_layout(source, std::to_string(position), items[position]),
                std::to_string(position), static_cast<std::uint32_t>(position)};
        }
    } else {
        throw machine_ir::LoweringFailure("fixed spread requires a numeric list or record");
    }
    return plan;
}

} // namespace vkf::call_binding
