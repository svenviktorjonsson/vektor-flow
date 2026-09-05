#pragma once
#include "compiler/native/vkf_value_layout.hpp"

namespace vkf::wasm::record_arguments {

enum class PlanKind { Leaf, Array, Record };

// A representation plan only: the caller evaluates the original argument
// once, stores it in a temporary, and reads these indices from that temporary.
// No source evaluation, name lookup, fallback record access, or ABI extension.
struct Plan {
    PlanKind kind = PlanKind::Leaf;
    std::vector<std::size_t> source_indices;
    std::vector<std::pair<std::string, Plan>> children;
};

namespace detail {
using machine_ir::detail::ValueKind;
using machine_ir::detail::ValueLayout;

inline bool numeric_source_paths(
    const ValueLayout& source,
    std::vector<std::size_t>& path,
    std::vector<std::vector<std::size_t>>& leaves
) {
    if (source.kind == ValueKind::Numeric && source.width == 1 && source.selectors.empty()) {
        leaves.push_back(path);
        return true;
    }
    if (source.kind != ValueKind::Aggregate || machine_ir::detail::is_record_layout(source)) return false;
    const auto elements = machine_ir::detail::indexed_element_layouts(source);
    if (elements.empty()) return false;
    const auto start = leaves.size();
    for (std::size_t index = 0; index < elements.size(); ++index) {
        path.push_back(index);
        if (!numeric_source_paths(elements[index], path, leaves)) return false;
        path.pop_back();
    }
    return leaves.size() - start == source.width;
}

inline std::optional<Plan> target_plan(
    const ValueLayout& target,
    std::uint32_t offset,
    const std::vector<std::vector<std::size_t>>& leaves
) {
    if (target.kind == ValueKind::Numeric && target.width == 1 && target.selectors.empty()) {
        if (offset >= leaves.size()) return std::nullopt;
        return Plan{PlanKind::Leaf, leaves[offset], {}};
    }
    if (target.kind != ValueKind::Aggregate) return std::nullopt;
    Plan result;
    result.kind = machine_ir::detail::is_record_layout(target) ? PlanKind::Record : PlanKind::Array;
    // Native selectors carry flattened offsets. Group only direct children;
    // their offsets, rather than alphabetical field names, define value order.
    std::map<std::uint32_t, std::pair<std::string, machine_ir::detail::ValueSlice>> children;
    for (const auto& [name, slice] : target.selectors) {
        if (name.find('.') != std::string::npos) continue;
        if (!children.emplace(slice.offset, std::make_pair(name, slice)).second) return std::nullopt;
    }
    std::uint32_t covered = 0;
    for (const auto& [position, field] : children) {
        const auto& [name, slice] = field;
        if (position != covered || slice.width == 0) return std::nullopt;
        const auto child = target_plan(machine_ir::detail::record_field_layout(target, name, slice),
            offset + position, leaves);
        if (!child) return std::nullopt;
        result.children.emplace_back(name, *child);
        covered += slice.width;
    }
    if (covered != target.width || children.empty()) return std::nullopt;
    return result;
}
} // namespace detail

inline std::optional<Plan> make_plan(
    const machine_ir::detail::ValueLayout& source,
    const machine_ir::detail::ValueLayout& target,
    const std::string& function,
    const std::string& parameter
) {
    using namespace machine_ir::detail;
    if (source.kind != ValueKind::Aggregate || is_record_layout(source) || !is_record_layout(target)) {
        return std::nullopt;
    }
    // This is the native call's existing equal-width non-record argument rule.
    // The shared inferred signature, not the spelling of a bind expression,
    // supplies the target record structure.
    if (source.width != target.width) {
        throw machine_ir::LoweringFailure(
            "machine IR call argument width mismatch for " + function + "." + parameter + ": expected " +
            describe_layout(target) + ", got " + describe_layout(source));
    }
    std::vector<std::vector<std::size_t>> leaves;
    std::vector<std::size_t> path;
    if (!detail::numeric_source_paths(source, path, leaves)) return std::nullopt;
    return detail::target_plan(target, 0, leaves);
}
} // namespace vkf::wasm::record_arguments
