#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace vkf::runtime_value_semantics {

struct SelectorField {
    std::string name;
    std::string type;
};

struct RecordSelectorPlan {
    std::vector<SelectorField> fields;
    std::string result_type;
    std::optional<std::string> fallback_symbol;
};

// The frontend-provided field sequence is semantic: first matching real field
// wins, and fallback dispatch (when present) happens only after this plan.
inline std::optional<RecordSelectorPlan> record_selector_plan(
    std::string_view selector_type,
    std::string result_type,
    std::vector<SelectorField> fields,
    std::optional<std::string> fallback_symbol
) {
    if (selector_type != "str" || (fields.empty() && !fallback_symbol)) {
        return std::nullopt;
    }
    for (const auto& field : fields) {
        if (field.name.empty() || field.type.empty()) return std::nullopt;
    }
    return RecordSelectorPlan{
        std::move(fields), std::move(result_type), std::move(fallback_symbol)};
}

inline constexpr std::string_view missing_record_selector_message =
    "unknown record selector key";
inline constexpr unsigned missing_record_selector_error_mask = 0b1000011;

} // namespace vkf::runtime_value_semantics
