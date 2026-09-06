#pragma once

#include "compiler/native/vkf_value_layout.hpp"

namespace vkf::call_binding {

// Existing native capture layout order, shared by both code generators. This
// selects fields only; the caller retains its original evaluation/error point.
inline std::vector<std::pair<std::string, machine_ir::detail::ValueSlice>>
named_variadic_fields(const machine_ir::detail::ValueLayout& layout) {
    std::vector<std::pair<std::string, machine_ir::detail::ValueSlice>> fields;
    for (const auto& [name, slice] : layout.selectors) {
        if (name.find('.') == std::string::npos) fields.push_back({name, slice});
    }
    std::stable_sort(fields.begin(), fields.end(), [](const auto& left, const auto& right) {
        return left.second.offset < right.second.offset;
    });
    return fields;
}

} // namespace vkf::call_binding
