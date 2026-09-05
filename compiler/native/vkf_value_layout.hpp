#pragma once
#include "compiler/native/vkf_stat_semantics.hpp"
#include "native/VfOverlay/vf/json.hpp"
#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <functional>
#include <initializer_list>
#include <limits>
#include <map>
#include <memory>
#include <numeric>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

// Pure native layout inference shared by native and WASM. No code emission,
// runtime storage allocation, or host access occurs here. Existing native
// namespace identities remain stable for callers of the extracted helpers.
namespace vkf::machine_ir {

class LoweringFailure : public std::runtime_error {
public:
    explicit LoweringFailure(const std::string& message)
        : std::runtime_error(message) {}
};

namespace detail {

inline const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) throw LoweringFailure("expected object in " + context);
    return value.as_object();
}

inline const vf::JsonValue& field(
    const vf::JsonValue::Object& object,
    const std::string& name,
    const std::string& context
) {
    const auto found = object.find(name);
    if (found == object.end()) throw LoweringFailure("missing " + name + " in " + context);
    return found->second;
}

inline std::string string_field(
    const vf::JsonValue::Object& object,
    const std::string& name,
    const std::string& context
) {
    const auto& value = field(object, name, context);
    if (!value.is_string()) throw LoweringFailure("expected string " + name + " in " + context);
    return value.as_string();
}

inline bool bool_field(
    const vf::JsonValue::Object& object,
    const std::string& name,
    const std::string& context
) {
    const auto& value = field(object, name, context);
    if (!value.is_boolean()) throw LoweringFailure("expected bit " + name + " in " + context);
    return value.as_boolean();
}

inline const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) throw LoweringFailure("expected array in " + context);
    return value.as_array();
}

inline std::string joined_text(
    std::initializer_list<std::string_view> parts
) {
    std::size_t size = 0;
    for (const auto part : parts) size += part.size();
    std::string result;
    result.reserve(size);
    for (const auto part : parts) result.append(part.data(), part.size());
    return result;
}

inline std::string qualified_name(
    const std::string& parent,
    const std::string& child
) {
    if (parent.empty()) return child;
    return joined_text({parent, ".", child});
}

enum class ValueKind : std::uint8_t {
    Numeric,
    Any,
    Complex,
    Null,
    String,
    Aggregate,
    DynamicF64List,
    NumericMultiset,
    StringMultiset,
    Range,
};

struct ValueLayout;

struct ValueSlice {
    std::uint32_t offset = 0;
    std::uint32_t width = 1;
    ValueKind kind = ValueKind::Numeric;
    std::shared_ptr<ValueLayout> dynamic_element;
};

// Layouts are immutable after construction in almost every lowering path, but
// fixed nested vectors may carry thousands of selector entries.  Sharing the
// ordered selector table avoids deep-copying that metadata for every expression
// while preserving deterministic std::map iteration and copy-on-write mutation.
class SelectorMap {
public:
    using Map = std::map<std::string, ValueSlice>;
    using const_iterator = Map::const_iterator;

    SelectorMap() : values_(std::make_shared<Map>()) {}

    ValueSlice& operator[](const std::string& key) {
        detach();
        return (*values_)[key];
    }

    ValueSlice& operator[](std::string&& key) {
        detach();
        return (*values_)[std::move(key)];
    }

    const ValueSlice& at(const std::string& key) const { return values_->at(key); }
    const ValueSlice& at(const std::string& key) { return values_->at(key); }
    const_iterator find(const std::string& key) const { return values_->find(key); }
    const_iterator find(const std::string& key) { return values_->find(key); }
    const_iterator begin() const { return values_->begin(); }
    const_iterator begin() { return values_->begin(); }
    const_iterator end() const { return values_->end(); }
    const_iterator end() { return values_->end(); }
    bool empty() const { return values_->empty(); }
    std::size_t size() const { return values_->size(); }
    bool shares_storage(const SelectorMap& other) const { return values_ == other.values_; }

    void clear() {
        detach();
        values_->clear();
    }

private:
    void detach() {
        if (values_.use_count() != 1) values_ = std::make_shared<Map>(*values_);
    }

    std::shared_ptr<Map> values_;
};

struct ValueLayout {
    std::uint32_t width = 1;
    ValueKind kind = ValueKind::Numeric;
    SelectorMap selectors;
    std::shared_ptr<ValueLayout> dynamic_element;
};

inline ValueLayout dynamic_list_layout(ValueLayout element = {}) {
    ValueLayout layout{1, ValueKind::DynamicF64List, {}};
    if (element.width == 1 && element.kind == ValueKind::Numeric &&
        element.selectors.empty()) return layout;
    layout.dynamic_element = std::make_shared<ValueLayout>(std::move(element));
    return layout;
}

enum class DisplayKind : std::uint8_t {
    F64,
    Complex,
    String,
    Chr,
    Bit,
    Null,
    Tuple,
    Record,
    Vector,
    Multiset,
    Range,
};

struct DisplayShape {
    DisplayKind kind = DisplayKind::F64;
    std::vector<std::pair<std::string, DisplayShape>> children;
    std::string label;
};

using DisplayEnvironment = std::map<std::string, DisplayShape>;
using FunctionDisplayShapes = std::map<std::string, DisplayShape>;

inline DisplayShape shallow_display_shape(const vf::JsonValue::Object& expression) {
    const auto kind = expression.find("kind");
    if (kind != expression.end() && kind->second.is_string()) {
        if (kind->second.as_string() == "complex_const") {
            return {DisplayKind::Complex, {}};
        }
        if (kind->second.as_string() == "call") {
            const auto callee = expression.find("callee");
            const auto args = expression.find("args");
            if (callee != expression.end() && callee->second.is_object() &&
                args != expression.end() && args->second.is_array() &&
                args->second.as_array().size() == 2) {
                const auto& callee_object = callee->second.as_object();
                const auto callee_kind = callee_object.find("kind");
                const auto callee_name = callee_object.find("name");
                if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                    callee_kind->second.as_string() == "load" &&
                    callee_name != callee_object.end() && callee_name->second.is_string() &&
                    callee_name->second.as_string() == "num") {
                    return {DisplayKind::Complex, {}};
                }
            }
        }
        if (kind->second.as_string() == "const") {
            const auto value = expression.find("value");
            if (value != expression.end()) {
                if (value->second.is_string()) return {DisplayKind::String, {}};
                if (value->second.is_boolean()) return {DisplayKind::Bit, {}};
                if (value->second.is_null()) return {DisplayKind::Null, {}};
            }
        }
    }
    const auto type = expression.find("type");
    if (type != expression.end() && type->second.is_string()) {
        if (type->second.as_string() == "str") return {DisplayKind::String, {}};
        if (type->second.as_string() == "chr") return {DisplayKind::Chr, {}};
        if (type->second.as_string() == "bit") return {DisplayKind::Bit, {}};
        if (type->second.as_string() == "null") return {DisplayKind::Null, {}};
        if (type->second.as_string() == "range<int>") return {DisplayKind::Range, {}};
    }
    return {DisplayKind::F64, {}};
}

inline std::uint32_t display_width(const DisplayShape& shape) {
    if (shape.kind == DisplayKind::String) return 2;
    if (shape.kind == DisplayKind::Complex) return 2;
    if (shape.kind == DisplayKind::Range) return 3;
    if (shape.kind == DisplayKind::F64 || shape.kind == DisplayKind::Chr ||
        shape.kind == DisplayKind::Bit ||
        shape.kind == DisplayKind::Multiset ||
        shape.kind == DisplayKind::Null) return 1;
    std::uint32_t width = 0;
    for (const auto& child : shape.children) width += display_width(child.second);
    return width;
}

inline bool same_layout(const ValueLayout& left, const ValueLayout& right) {
    if (left.width != right.width || left.kind != right.kind ||
        left.selectors.size() != right.selectors.size()) return false;
    if (static_cast<bool>(left.dynamic_element) !=
        static_cast<bool>(right.dynamic_element)) return false;
    if (left.dynamic_element &&
        !same_layout(*left.dynamic_element, *right.dynamic_element)) return false;
    if (left.selectors.shares_storage(right.selectors)) return true;
    auto left_field = left.selectors.begin();
    auto right_field = right.selectors.begin();
    for (; left_field != left.selectors.end(); ++left_field, ++right_field) {
        if (left_field->first != right_field->first ||
            left_field->second.offset != right_field->second.offset ||
            left_field->second.width != right_field->second.width ||
            left_field->second.kind != right_field->second.kind) return false;
        if (static_cast<bool>(left_field->second.dynamic_element) !=
            static_cast<bool>(right_field->second.dynamic_element)) return false;
        if (left_field->second.dynamic_element &&
            !same_layout(*left_field->second.dynamic_element,
                         *right_field->second.dynamic_element)) return false;
    }
    return true;
}

inline std::string describe_layout(const ValueLayout& layout) {
    std::string result = std::to_string(layout.width) + "[";
    bool first = true;
    for (const auto& [name, slice] : layout.selectors) {
        if (name.find('.') != std::string::npos) continue;
        if (!first) result += ",";
        first = false;
        result += name + ":" + std::to_string(slice.width);
    }
    return result + "]";
}

inline bool is_owned_resource_kind(ValueKind kind) {
    return kind == ValueKind::String || kind == ValueKind::DynamicF64List ||
        kind == ValueKind::NumericMultiset;
}

inline bool is_f64_heap_resource_kind(ValueKind kind) {
    return kind == ValueKind::DynamicF64List || kind == ValueKind::NumericMultiset;
}

inline std::vector<ValueSlice> owned_resource_slices(const ValueLayout& layout) {
    if (is_owned_resource_kind(layout.kind)) return {{0, layout.width, layout.kind}};
    std::vector<ValueSlice> slices;
    for (const auto& [name, slice] : layout.selectors) {
        (void)name;
        if (!is_owned_resource_kind(slice.kind)) continue;
        const auto slice_offset = slice.offset;
        const auto slice_kind = slice.kind;
        const bool duplicate = std::any_of(slices.begin(), slices.end(), [&](const auto& existing) {
            return existing.offset == slice_offset && existing.kind == slice_kind;
        });
        if (!duplicate) slices.push_back(slice);
    }
    std::sort(slices.begin(), slices.end(), [](const auto& left, const auto& right) {
        return left.offset < right.offset;
    });
    return slices;
}

inline bool has_owned_resources(const ValueLayout& layout) {
    return !owned_resource_slices(layout).empty();
}

struct FunctionSignature {
    std::vector<std::string> parameter_names;
    std::vector<ValueLayout> parameters;
    std::vector<std::vector<std::string>> parameter_full_projections;
    std::vector<DisplayShape> parameter_displays;
    std::vector<bool> parameter_is_any;
    std::vector<const vf::JsonValue*> parameter_defaults;
    std::optional<std::size_t> variadic_positional_index;
    std::optional<std::size_t> variadic_named_index;
    ValueLayout result;
    DisplayShape result_display;
    bool result_is_any = false;
    bool may_error = false;
};

struct FunctionSignatures : std::map<std::string, FunctionSignature> {
    std::map<std::string, std::string> type_aliases;
    std::map<std::string, const vf::JsonValue::Object*> module_literals;
    std::map<std::string, ValueLayout> module_layouts;
};

inline bool same_signature_layouts(
    const FunctionSignatures& left,
    const FunctionSignatures& right
) {
    if (left.size() != right.size()) return false;
    for (const auto& [name, signature] : left) {
        const auto found = right.find(name);
        if (found == right.end() || signature.parameters.size() != found->second.parameters.size()) {
            return false;
        }
        if (signature.parameter_full_projections !=
            found->second.parameter_full_projections) return false;
        for (std::size_t index = 0; index < signature.parameters.size(); ++index) {
            if (!same_layout(signature.parameters[index], found->second.parameters[index])) return false;
        }
        if (!same_layout(signature.result, found->second.result)) return false;
    }
    return true;
}

inline ValueLayout indexed_layout(const std::vector<ValueLayout>& elements);
inline std::vector<ValueLayout> indexed_element_layouts(const ValueLayout& source);
inline ValueLayout layout_from_expression_shape(
    const vf::JsonValue::Object& expression,
    const FunctionSignatures& signatures
);
inline ValueLayout layout_from_fixed_literal_shape(
    const vf::JsonValue::Object& expression,
    const FunctionSignatures& signatures
);

inline void collect_parameter_fields(
    const vf::JsonValue& value,
    const std::string& parameter,
    std::vector<std::string>& fields
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) collect_parameter_fields(item, parameter, fields);
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "field_access") {
        const auto source = object.find("object");
        const auto field_name = object.find("field");
        if (source != object.end() && source->second.is_object() &&
            field_name != object.end() && field_name->second.is_string()) {
            const auto& source_object = source->second.as_object();
            const auto source_kind = source_object.find("kind");
            const auto source_name = source_object.find("name");
            if (source_kind != source_object.end() && source_kind->second.is_string() &&
                source_kind->second.as_string() == "load" &&
                source_name != source_object.end() && source_name->second.is_string() &&
                source_name->second.as_string() == parameter &&
                std::find(fields.begin(), fields.end(), field_name->second.as_string()) == fields.end()) {
                fields.push_back(field_name->second.as_string());
            }
        }
    }
    for (const auto& [name, child] : object) {
        (void)name;
        collect_parameter_fields(child, parameter, fields);
    }
}

inline ValueLayout record_field_layout(
    const ValueLayout& record,
    const std::string& name,
    const ValueSlice& slice
) {
    ValueLayout result{slice.width, slice.kind, {}};
    result.dynamic_element = slice.dynamic_element;
    const std::string prefix = name + ".";
    for (const auto& [child, nested] : record.selectors) {
        if (child.rfind(prefix, 0) != 0) continue;
        result.selectors[child.substr(prefix.size())] = {
            nested.offset - slice.offset, nested.width, nested.kind,
            nested.dynamic_element
        };
    }
    return result;
}

inline void assign_record_field_layout(
    ValueLayout& record,
    const std::string& name,
    const ValueLayout& field_layout
) {
    std::vector<std::pair<std::string, ValueLayout>> fields;
    if (record.kind == ValueKind::Aggregate) {
        for (const auto& [field_name, slice] : record.selectors) {
            if (field_name.find('.') != std::string::npos) continue;
            fields.push_back({field_name, record_field_layout(record, field_name, slice)});
        }
        std::stable_sort(fields.begin(), fields.end(), [&](const auto& left, const auto& right) {
            return record.selectors.at(left.first).offset < record.selectors.at(right.first).offset;
        });
    }
    const auto existing = std::find_if(fields.begin(), fields.end(), [&](const auto& field) {
        return field.first == name;
    });
    if (existing == fields.end()) fields.push_back({name, field_layout});
    else existing->second = field_layout;
    record.width = 0;
    record.kind = ValueKind::Aggregate;
    record.selectors.clear();
    for (const auto& [field_name, layout] : fields) {
        record.selectors[field_name] = {
            record.width, layout.width, layout.kind, layout.dynamic_element};
        for (const auto& [child, slice] : layout.selectors) {
            record.selectors[qualified_name(field_name, child)] = {
                record.width + slice.offset, slice.width, slice.kind,
                slice.dynamic_element
            };
        }
        record.width += layout.width;
    }
}

inline bool is_record_layout(const ValueLayout& layout) {
    return layout.kind == ValueKind::Aggregate &&
        std::any_of(layout.selectors.begin(), layout.selectors.end(), [](const auto& field) {
            if (field.first.find('.') != std::string::npos) return false;
            return field.first.empty() || !std::all_of(
                field.first.begin(), field.first.end(), [](unsigned char ch) { return std::isdigit(ch); });
        });
}

struct StructuralLayoutMatch {
    std::uint32_t offset = 0;
    ValueLayout layout;
};

inline std::vector<std::string> structural_paths_from_call(
    const vf::JsonValue::Object& expression
) {
    const auto found = expression.find("structural_paths");
    if (found == expression.end()) {
        throw LoweringFailure("typed structural call is missing compatibility paths");
    }
    std::vector<std::string> paths;
    for (const auto& value : array_of(found->second, "structural compatibility paths")) {
        if (!value.is_string()) {
            throw LoweringFailure("structural compatibility path must be a string");
        }
        paths.push_back(value.as_string());
    }
    return paths;
}

inline std::vector<std::string> split_structural_path(const std::string& path) {
    if (path.empty()) return {};
    std::vector<std::string> components;
    std::size_t start = 0;
    while (start <= path.size()) {
        const auto separator = path.find('.', start);
        components.push_back(path.substr(
            start,
            separator == std::string::npos ? std::string::npos : separator - start));
        if (separator == std::string::npos) break;
        start = separator + 1;
    }
    return components;
}

inline std::vector<StructuralLayoutMatch> resolve_structural_layout_matches(
    const ValueLayout& root,
    const std::vector<std::string>& paths
) {
    std::vector<StructuralLayoutMatch> matches;
    const auto resolve = [&](const auto& self,
                             const ValueLayout& candidate,
                             std::uint32_t base,
                             const std::vector<std::string>& components,
                             std::size_t index) -> void {
        if (index == components.size()) {
            matches.push_back({base, candidate});
            return;
        }
        if (candidate.kind != ValueKind::Aggregate) return;
        if (components[index] != "*") {
            const auto selected = candidate.selectors.find(components[index]);
            if (selected == candidate.selectors.end() ||
                components[index].find('.') != std::string::npos) return;
            self(
                self,
                record_field_layout(candidate, components[index], selected->second),
                base + selected->second.offset,
                components,
                index + 1);
            return;
        }
        std::vector<std::pair<std::string, ValueSlice>> children;
        for (const auto& [name, slice] : candidate.selectors) {
            if (name.find('.') == std::string::npos) children.push_back({name, slice});
        }
        std::stable_sort(children.begin(), children.end(), [](const auto& left, const auto& right) {
            return left.second.offset < right.second.offset;
        });
        for (const auto& [name, slice] : children) {
            self(
                self,
                record_field_layout(candidate, name, slice),
                base + slice.offset,
                components,
                index + 1);
        }
    };
    for (const auto& path : paths) {
        const auto components = split_structural_path(path);
        resolve(resolve, root, 0, components, 0);
    }
    std::stable_sort(matches.begin(), matches.end(), [](const auto& left, const auto& right) {
        if (left.offset != right.offset) return left.offset < right.offset;
        return left.layout.width < right.layout.width;
    });
    matches.erase(
        std::unique(matches.begin(), matches.end(), [](const auto& left, const auto& right) {
            return left.offset == right.offset && same_layout(left.layout, right.layout);
        }),
        matches.end());
    return matches;
}

inline std::vector<StructuralLayoutMatch> numeric_structural_layout_matches(
    const ValueLayout& root
) {
    std::vector<StructuralLayoutMatch> matches;
    const auto collect = [&](const auto& self,
                             const ValueLayout& candidate,
                             std::uint32_t base) -> void {
        if (candidate.kind == ValueKind::Numeric && candidate.width == 1) {
            matches.push_back({base, candidate});
            return;
        }
        if (candidate.kind != ValueKind::Aggregate) return;
        std::vector<std::pair<std::string, ValueSlice>> children;
        for (const auto& [name, slice] : candidate.selectors) {
            if (name.find('.') == std::string::npos) children.push_back({name, slice});
        }
        std::stable_sort(children.begin(), children.end(), [](const auto& left, const auto& right) {
            return left.second.offset < right.second.offset;
        });
        for (const auto& [name, slice] : children) {
            self(
                self,
                record_field_layout(candidate, name, slice),
                base + slice.offset);
        }
    };
    collect(collect, root, 0);
    return matches;
}

inline void refine_parameter_from_argument(
    ValueLayout& current,
    const ValueLayout& candidate
);

inline bool has_sparse_fixed_placeholder(const ValueLayout& layout) {
    return std::any_of(layout.selectors.begin(), layout.selectors.end(), [](const auto& field) {
        return field.second.kind == ValueKind::Any && field.second.width == 0;
    });
}

inline void merge_inferred_layout(ValueLayout& current, const ValueLayout& candidate) {
    if (current.kind == ValueKind::DynamicF64List &&
        candidate.kind == ValueKind::DynamicF64List) {
        if (!current.dynamic_element) {
            current.dynamic_element = candidate.dynamic_element;
        } else if (candidate.dynamic_element) {
            merge_inferred_layout(*current.dynamic_element, *candidate.dynamic_element);
        }
        return;
    }
    if (is_record_layout(candidate)) {
        if (!is_record_layout(current)) {
            current.width = 0;
            current.kind = ValueKind::Aggregate;
            current.selectors.clear();
        }
        std::vector<std::pair<std::string, ValueSlice>> fields;
        for (const auto& [name, slice] : candidate.selectors) {
            if (name.find('.') == std::string::npos) fields.push_back({name, slice});
        }
        std::stable_sort(fields.begin(), fields.end(), [](const auto& left, const auto& right) {
            return left.second.offset < right.second.offset;
        });
        for (const auto& [name, slice] : fields) {
            auto merged_field = record_field_layout(candidate, name, slice);
            const auto existing = current.selectors.find(name);
            if (existing != current.selectors.end()) {
                auto current_field = record_field_layout(current, name, existing->second);
                merge_inferred_layout(current_field, merged_field);
                merged_field = std::move(current_field);
            }
            assign_record_field_layout(current, name, merged_field);
        }
        return;
    }
    if (current.kind == ValueKind::Aggregate && candidate.kind == ValueKind::Aggregate &&
        !is_record_layout(current) && !is_record_layout(candidate)) {
        std::vector<std::pair<std::string, ValueSlice>> current_fields;
        for (const auto& [name, slice] : current.selectors) {
            if (name.find('.') == std::string::npos) {
                current_fields.push_back({name, slice});
            }
        }
        std::stable_sort(
            current_fields.begin(), current_fields.end(),
            [](const auto& left, const auto& right) {
                return left.second.offset < right.second.offset;
            });
        const bool sparse = has_sparse_fixed_placeholder(current);
        for (const auto& [name, current_slice] : current_fields) {
            if (current_slice.kind == ValueKind::Any && current_slice.width == 0) continue;
            const auto supplied = candidate.selectors.find(name);
            if (supplied == candidate.selectors.end()) continue;
            auto element = record_field_layout(current, name, current_slice);
            const auto supplied_element = record_field_layout(
                candidate, name, supplied->second);
            if (sparse) refine_parameter_from_argument(element, supplied_element);
            else merge_inferred_layout(element, supplied_element);
            assign_record_field_layout(current, name, element);
        }
        return;
    }
    if (current.width == candidate.width && current.kind == ValueKind::Any) {
        current = candidate;
        return;
    }
    if (current.width == 1 && current.kind == ValueKind::Numeric &&
        current.selectors.empty() && candidate.kind != ValueKind::Numeric) {
        current = candidate;
        return;
    }
    if (candidate.width > current.width ||
        (candidate.width == current.width && candidate.selectors.size() > current.selectors.size())) {
        current = candidate;
    }
}

inline void refine_parameter_from_argument(ValueLayout& current, const ValueLayout& candidate) {
    if (!is_record_layout(current) || !is_record_layout(candidate)) {
        merge_inferred_layout(current, candidate);
        return;
    }
    std::vector<std::pair<std::string, ValueSlice>> required_fields;
    for (const auto& [name, slice] : current.selectors) {
        if (name.find('.') == std::string::npos) required_fields.push_back({name, slice});
    }
    std::stable_sort(required_fields.begin(), required_fields.end(), [](const auto& left, const auto& right) {
        return left.second.offset < right.second.offset;
    });
    for (const auto& [name, current_slice] : required_fields) {
        const auto supplied = candidate.selectors.find(name);
        if (supplied == candidate.selectors.end()) continue;
        auto field_layout = record_field_layout(current, name, current_slice);
        const auto supplied_layout = record_field_layout(candidate, name, supplied->second);
        const bool expands_container = supplied_layout.kind == ValueKind::Aggregate ||
            supplied_layout.kind == ValueKind::DynamicF64List ||
            supplied_layout.kind == ValueKind::NumericMultiset ||
            supplied_layout.kind == ValueKind::StringMultiset ||
            supplied_layout.kind == ValueKind::Range;
        if (field_layout.kind != ValueKind::Any || expands_container) {
            merge_inferred_layout(field_layout, supplied_layout);
        }
        assign_record_field_layout(current, name, field_layout);
    }
}

inline void collect_parameter_indices(
    const vf::JsonValue& value,
    const std::string& parameter,
    bool& found,
    std::uint32_t& maximum
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            collect_parameter_indices(item, parameter, found, maximum);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "dotted_index") {
        const auto base = object.find("base");
        const auto indices = object.find("indices");
        if (base != object.end() && base->second.is_object() &&
            indices != object.end() && indices->second.is_array() &&
            indices->second.as_array().size() == 1) {
            const auto& base_object = base->second.as_object();
            const auto base_kind = base_object.find("kind");
            const auto base_name = base_object.find("name");
            const auto& index = indices->second.as_array().front();
            if (base_kind != base_object.end() && base_kind->second.is_string() &&
                base_kind->second.as_string() == "load" &&
                base_name != base_object.end() && base_name->second.is_string() &&
                base_name->second.as_string() == parameter && index.is_object()) {
                const auto& index_object = index.as_object();
                const auto index_kind = index_object.find("kind");
                const auto index_value = index_object.find("value");
                if (index_kind != index_object.end() && index_kind->second.is_string() &&
                    index_kind->second.as_string() == "const" &&
                    index_value != index_object.end() && index_value->second.is_number()) {
                    const double raw = index_value->second.as_number();
                    if (raw >= 0 && raw == static_cast<double>(static_cast<std::uint32_t>(raw))) {
                        found = true;
                        maximum = std::max(maximum, static_cast<std::uint32_t>(raw));
                    }
                }
            }
        }
    }
    for (const auto& [name, child] : object) {
        (void)name;
        collect_parameter_indices(child, parameter, found, maximum);
    }
}

inline ValueLayout inferred_parameter_layout(
    const vf::JsonValue::Object& function,
    const std::string& parameter,
    std::vector<std::string>* full_projections = nullptr
) {
    struct ProjectionNode {
        std::map<std::string, ProjectionNode> children;
        bool full = false;
    };
    const auto projection_path = [&](const auto& self,
                                     const vf::JsonValue::Object& expression,
                                     std::vector<std::string>& path) -> bool {
        const auto kind = expression.find("kind");
        if (kind == expression.end() || !kind->second.is_string()) return false;
        if (kind->second.as_string() == "load") {
            const auto name = expression.find("name");
            return name != expression.end() && name->second.is_string() &&
                name->second.as_string() == parameter;
        }
        if (kind->second.as_string() == "field_access") {
            const auto source = expression.find("object");
            const auto name = expression.find("field");
            if (source == expression.end() || !source->second.is_object() ||
                name == expression.end() || !name->second.is_string() ||
                !self(self, source->second.as_object(), path)) return false;
            path.push_back(name->second.as_string());
            return true;
        }
        if (kind->second.as_string() != "dotted_index") return false;
        const auto base = expression.find("base");
        const auto indices = expression.find("indices");
        if (base == expression.end() || !base->second.is_object() ||
            indices == expression.end() || !indices->second.is_array() ||
            !self(self, base->second.as_object(), path)) return false;
        for (const auto& index : indices->second.as_array()) {
            if (!index.is_object()) return false;
            const auto& index_object = index.as_object();
            const auto index_kind = index_object.find("kind");
            const auto index_value = index_object.find("value");
            if (index_kind == index_object.end() || !index_kind->second.is_string() ||
                index_kind->second.as_string() != "const" ||
                index_value == index_object.end() || !index_value->second.is_number()) return false;
            const double raw = index_value->second.as_number();
            if (raw < 0 || raw != static_cast<double>(static_cast<std::uint32_t>(raw))) return false;
            path.push_back(std::to_string(static_cast<std::uint32_t>(raw)));
        }
        return true;
    };
    ProjectionNode root;
    bool found = false;
    const auto record_projection = [&](const vf::JsonValue::Object& expression, bool full = false) {
        std::vector<std::string> path;
        if (!projection_path(projection_path, expression, path) || path.empty()) return;
        if (full && full_projections) {
            std::string joined;
            for (const auto& component : path) {
                joined += (joined.empty() ? "" : ".") + component;
            }
            if (std::find(full_projections->begin(), full_projections->end(), joined) ==
                full_projections->end()) full_projections->push_back(std::move(joined));
        }
        found = true;
        ProjectionNode* node = &root;
        for (const auto& component : path) node = &node->children[component];
        node->full = node->full || full;
    };
    const auto collect = [&](const auto& self, const vf::JsonValue& value) -> void {
        if (value.is_array()) {
            for (const auto& item : value.as_array()) self(self, item);
            return;
        }
        if (!value.is_object()) return;
        const auto& object = value.as_object();
        const auto kind = object.find("kind");
        if (kind != object.end() && kind->second.is_string() &&
            kind->second.as_string() == "call") {
            const auto callee = object.find("callee");
            if (callee != object.end() && callee->second.is_object()) {
                const auto& callee_object = callee->second.as_object();
                const auto callee_kind = callee_object.find("kind");
                const auto callee_field = callee_object.find("field");
                const auto callee_source = callee_object.find("object");
                if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                    callee_kind->second.as_string() == "field_access" &&
                    callee_field != callee_object.end() && callee_field->second.is_string() &&
                    callee_field->second.as_string() == "length" &&
                    callee_source != callee_object.end() && callee_source->second.is_object()) {
                    record_projection(callee_source->second.as_object(), true);
                    for (const auto& [name, child] : object) {
                        if (name != "callee") self(self, child);
                    }
                    return;
                }
            }
        }
        record_projection(object);
        for (const auto& [name, child] : object) {
            (void)name;
            self(self, child);
        }
    };
    collect(collect, field(function, "body", "function"));
    if (!found) return {};
    const auto numeric_name = [](const std::string& name) {
        return !name.empty() && std::all_of(name.begin(), name.end(), [](unsigned char ch) {
            return std::isdigit(ch);
        });
    };
    const auto make_layout = [&](const auto& self, const ProjectionNode& node) -> ValueLayout {
        if (node.full) return {};
        const bool indexed = !node.children.empty() &&
            std::all_of(node.children.begin(), node.children.end(), [&](const auto& child) {
                return numeric_name(child.first);
            });
        if (indexed) {
            std::uint32_t maximum = 0;
            for (const auto& [name, child] : node.children) {
                (void)child;
                maximum = std::max(
                    maximum, static_cast<std::uint32_t>(std::stoul(name)));
            }
            std::vector<ValueLayout> elements(
                maximum + 1, ValueLayout{0, ValueKind::Any, {}});
            for (const auto& [name, child] : node.children) {
                elements[static_cast<std::size_t>(std::stoul(name))] =
                    child.full || !child.children.empty() ? self(self, child) : ValueLayout{};
            }
            return indexed_layout(elements);
        }
        ValueLayout record{0, ValueKind::Aggregate, {}};
        for (const auto& [name, child] : node.children) {
            assign_record_field_layout(
                record, name,
                child.full || !child.children.empty() ? self(self, child) : ValueLayout{});
        }
        return record;
    };
    return make_layout(make_layout, root);
}

inline ValueLayout inferred_function_result_layout(
    const vf::JsonValue::Object& function,
    const FunctionSignature& signature,
    const FunctionSignatures& signatures
);

inline void refine_full_projection_path(
    ValueLayout& current,
    const ValueLayout& candidate,
    const std::vector<std::string>& path,
    std::size_t index = 0
) {
    if (index == path.size()) {
        current = candidate;
        return;
    }
    if (candidate.kind != ValueKind::Aggregate) return;
    const auto supplied = candidate.selectors.find(path[index]);
    if (supplied == candidate.selectors.end()) return;
    ValueLayout field_layout;
    if (current.kind == ValueKind::Aggregate) {
        const auto existing = current.selectors.find(path[index]);
        if (existing != current.selectors.end()) {
            field_layout = record_field_layout(current, path[index], existing->second);
        }
    }
    refine_full_projection_path(
        field_layout,
        record_field_layout(candidate, path[index], supplied->second),
        path,
        index + 1);
    assign_record_field_layout(current, path[index], field_layout);
}

inline void refine_full_projection_paths(
    ValueLayout& current,
    const ValueLayout& candidate,
    const std::vector<std::string>& paths
) {
    for (const auto& path : paths) {
        refine_full_projection_path(
            current, candidate, split_structural_path(path));
    }
}

inline void merge_full_projection_paths(
    std::vector<std::string>& current,
    const std::vector<std::string>& candidate,
    const std::string& prefix = ""
) {
    for (const auto& path : candidate) {
        const std::string merged = prefix.empty()
            ? path
            : prefix + (path.empty() ? "" : "." + path);
        if (std::find(current.begin(), current.end(), merged) == current.end()) {
            current.push_back(merged);
        }
    }
    std::sort(current.begin(), current.end());
}

inline void refine_callsite_parameter_layouts(
    const vf::JsonValue& value,
    FunctionSignatures& signatures,
    bool module_scope = false
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            refine_callsite_parameter_layouts(item, signatures, module_scope);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "call") {
        const auto elementwise = object.find("elementwise_math");
        const auto structural = object.find("structural_call");
        const bool is_structural = structural != object.end() &&
            structural->second.is_boolean() && structural->second.as_boolean();
        if (is_structural) {
            const auto& callee = object_of(field(object, "callee", "structural call"), "callee");
            const auto& arguments = array_of(field(object, "args", "structural call"), "call args");
            if (string_field(callee, "kind", "structural callee") == "load" &&
                arguments.size() == 1 && arguments.front().is_object()) {
                const auto target = signatures.find(string_field(callee, "name", "structural callee"));
                if (target != signatures.end() && target->second.parameters.size() == 1) {
                    const auto argument_layout = layout_from_expression_shape(
                        arguments.front().as_object(), signatures);
                    const auto matches = resolve_structural_layout_matches(
                        argument_layout, structural_paths_from_call(object));
                    if (!matches.empty()) {
                        const bool result_tracks_parameter = same_layout(
                            target->second.result, target->second.parameters.front());
                        refine_parameter_from_argument(
                            target->second.parameters.front(), matches.front().layout);
                        if (result_tracks_parameter) {
                            target->second.result = target->second.parameters.front();
                        }
                    }
                }
            }
        }
        if ((elementwise != object.end() && elementwise->second.is_boolean() &&
             elementwise->second.as_boolean()) ||
            is_structural) {
            for (const auto& [name, child] : object) {
                (void)name;
                refine_callsite_parameter_layouts(child, signatures, module_scope);
            }
            return;
        }
        const auto callee = object.find("callee");
        const auto args = object.find("args");
        if (callee != object.end() && callee->second.is_object() &&
            args != object.end() && args->second.is_array()) {
            const auto& callee_object = callee->second.as_object();
            const auto callee_kind = callee_object.find("kind");
            const auto callee_name = callee_object.find("name");
            if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                callee_kind->second.as_string() == "load" &&
                callee_name != callee_object.end() && callee_name->second.is_string()) {
                const auto signature = signatures.find(callee_name->second.as_string());
                if (signature != signatures.end()) {
                    const auto& arguments = args->second.as_array();
                    for (std::size_t index = 0;
                         index < arguments.size() && index < signature->second.parameters.size();
                         ++index) {
                        if (!arguments[index].is_object() ||
                            index >= signature->second.parameter_is_any.size() ||
                            !signature->second.parameter_is_any[index]) continue;
                        const auto& argument = arguments[index].as_object();
                        const auto argument_kind = argument.find("kind");
                        if (argument_kind != argument.end() && argument_kind->second.is_string() &&
                            argument_kind->second.as_string() == "call") {
                            const auto& inner_callee = object_of(
                                field(argument, "callee", "nested call argument"), "nested call callee");
                            if (string_field(inner_callee, "kind", "nested call callee") == "load") {
                                const auto inner = signatures.find(
                                    string_field(inner_callee, "name", "nested call callee"));
                                if (inner != signatures.end() && inner->second.result_is_any) {
                                    merge_inferred_layout(
                                        inner->second.result, signature->second.parameters[index]);
                                }
                            }
                        }
                        ValueLayout candidate;
                        const auto argument_name = argument.find("name");
                        if (module_scope && argument_kind != argument.end() &&
                            argument_kind->second.is_string() &&
                            argument_kind->second.as_string() == "load" &&
                            argument_name != argument.end() && argument_name->second.is_string()) {
                            const auto module_layout = signatures.module_layouts.find(
                                argument_name->second.as_string());
                            candidate = module_layout != signatures.module_layouts.end()
                                ? module_layout->second
                                : layout_from_expression_shape(argument, signatures);
                        } else {
                            candidate = layout_from_expression_shape(argument, signatures);
                        }
                        auto& current = signature->second.parameters[index];
                        if (index < signature->second.parameter_full_projections.size()) {
                            refine_full_projection_paths(
                                current,
                                candidate,
                                signature->second.parameter_full_projections[index]);
                        }
                        refine_parameter_from_argument(current, candidate);
                        if (index < signature->second.parameter_displays.size()) {
                            const auto candidate_display = shallow_display_shape(argument);
                            if (candidate_display.kind != DisplayKind::F64) {
                                signature->second.parameter_displays[index] = candidate_display;
                            }
                        }
                    }
                    if (signature->second.variadic_named_index) {
                        auto& capture = signature->second.parameters[
                            *signature->second.variadic_named_index];
                        const auto named = object.find("named_args");
                        if (named != object.end() && named->second.is_array()) {
                            for (const auto& named_value : named->second.as_array()) {
                                const auto& named_argument = object_of(
                                    named_value, "variadic named call argument");
                                const std::string name = string_field(
                                    named_argument, "name", "variadic named call argument");
                                if (std::find(
                                        signature->second.parameter_names.begin(),
                                        signature->second.parameter_names.end(), name) !=
                                    signature->second.parameter_names.end()) {
                                    continue;
                                }
                                assign_record_field_layout(
                                    capture,
                                    name,
                                    layout_from_expression_shape(
                                        object_of(
                                            field(named_argument, "value", "variadic named argument"),
                                            "variadic named argument value"),
                                        signatures));
                                auto& capture_display = signature->second.parameter_displays[
                                    *signature->second.variadic_named_index];
                                const auto supplied_display = shallow_display_shape(object_of(
                                    field(named_argument, "value", "variadic named argument"),
                                    "variadic named argument value"));
                                const auto display_field = std::find_if(
                                    capture_display.children.begin(), capture_display.children.end(),
                                    [&](const auto& child) { return child.first == name; });
                                if (display_field == capture_display.children.end()) {
                                    capture_display.children.push_back({name, supplied_display});
                                } else {
                                    display_field->second = supplied_display;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    const bool child_module_scope = module_scope &&
        !(kind != object.end() && kind->second.is_string() &&
          kind->second.as_string() == "function");
    for (const auto& [name, child] : object) {
        (void)name;
        refine_callsite_parameter_layouts(child, signatures, child_module_scope);
    }
}

inline void refine_forwarded_parameter_layouts(
    const vf::JsonValue& value,
    FunctionSignature& caller,
    FunctionSignatures& signatures
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            refine_forwarded_parameter_layouts(item, caller, signatures);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "call") {
        const auto callee = object.find("callee");
        const auto args = object.find("args");
        if (callee != object.end() && callee->second.is_object() &&
            args != object.end() && args->second.is_array()) {
            const auto& callee_object = callee->second.as_object();
            const auto callee_kind = callee_object.find("kind");
            const auto callee_name = callee_object.find("name");
            if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                callee_kind->second.as_string() == "load" &&
                callee_name != callee_object.end() && callee_name->second.is_string()) {
                auto target = signatures.find(callee_name->second.as_string());
                if (target != signatures.end()) {
                    const auto& arguments = args->second.as_array();
                    for (std::size_t argument_index = 0;
                         argument_index < arguments.size() &&
                         argument_index < target->second.parameters.size();
                         ++argument_index) {
                        if (!arguments[argument_index].is_object()) continue;
                        const auto& argument = arguments[argument_index].as_object();
                        const auto argument_kind = argument.find("kind");
                        if (argument_kind == argument.end() || !argument_kind->second.is_string()) continue;
                        std::string forwarded_name;
                        std::string forwarded_field;
                        if (argument_kind->second.as_string() == "load") {
                            const auto argument_name = argument.find("name");
                            if (argument_name == argument.end() || !argument_name->second.is_string()) continue;
                            forwarded_name = argument_name->second.as_string();
                        } else if (argument_kind->second.as_string() == "field_access") {
                            const auto source = argument.find("object");
                            const auto field_name = argument.find("field");
                            if (source == argument.end() || !source->second.is_object() ||
                                field_name == argument.end() || !field_name->second.is_string()) continue;
                            const auto& source_object = source->second.as_object();
                            const auto source_kind = source_object.find("kind");
                            const auto source_name = source_object.find("name");
                            if (source_kind == source_object.end() || !source_kind->second.is_string() ||
                                source_kind->second.as_string() != "load" ||
                                source_name == source_object.end() || !source_name->second.is_string()) continue;
                            forwarded_name = source_name->second.as_string();
                            forwarded_field = field_name->second.as_string();
                        } else {
                            continue;
                        }
                        const auto parameter = std::find(
                            caller.parameter_names.begin(), caller.parameter_names.end(),
                            forwarded_name);
                        if (parameter == caller.parameter_names.end()) continue;
                        const auto parameter_index = static_cast<std::size_t>(
                            parameter - caller.parameter_names.begin());
                        if (parameter_index >= caller.parameter_is_any.size() ||
                            !caller.parameter_is_any[parameter_index]) continue;
                        const auto candidate = target->second.parameters[argument_index];
                        auto& current = caller.parameters[parameter_index];
                        if (argument_index <
                            target->second.parameter_full_projections.size()) {
                            if (caller.parameter_full_projections.size() <
                                caller.parameters.size()) {
                                caller.parameter_full_projections.resize(
                                    caller.parameters.size());
                            }
                            merge_full_projection_paths(
                                caller.parameter_full_projections[parameter_index],
                                target->second.parameter_full_projections[argument_index],
                                forwarded_field);
                        }
                        if (!forwarded_field.empty()) {
                            assign_record_field_layout(current, forwarded_field, candidate);
                        } else {
                            merge_inferred_layout(current, candidate);
                        }
                        if (forwarded_field.empty() && argument_index <
                            target->second.parameter_full_projections.size()) {
                            refine_full_projection_paths(
                                target->second.parameters[argument_index],
                                current,
                                target->second.parameter_full_projections[argument_index]);
                        }
                    }
                }
            }
        }
    }
    for (const auto& [name, child] : object) {
        (void)name;
        refine_forwarded_parameter_layouts(child, caller, signatures);
    }
}

inline std::string trim(std::string value) {
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) value.erase(value.begin());
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.pop_back();
    return value;
}

inline std::vector<std::string> split_top_level(const std::string& text, char separator) {
    std::vector<std::string> parts;
    std::size_t start = 0;
    int depth = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch == '[' || ch == '<' || ch == '{' || ch == '(') ++depth;
        else if (ch == ']' || ch == '>' || ch == '}' || ch == ')') --depth;
        else if (ch == separator && depth == 0) {
            parts.push_back(trim(text.substr(start, index - start)));
            start = index + 1;
        }
    }
    parts.push_back(trim(text.substr(start)));
    return parts;
}

inline std::size_t find_top_level(const std::string& text, char separator) {
    int depth = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch == '[' || ch == '<' || ch == '{' || ch == '(') ++depth;
        else if (ch == ']' || ch == '>' || ch == '}' || ch == ')') --depth;
        else if (ch == separator && depth == 0) return index;
    }
    return std::string::npos;
}

inline bool symbolic_expression_surface_type(const std::string& type) {
    return type == "symbolic" || type == "expression" || type == "symbol" ||
        type == "constant" || type == "relation" || type == "proposition";
}

inline int type_match_score(const std::string& raw_actual, const std::string& raw_pattern) {
    const std::string actual = trim(raw_actual);
    const std::string pattern = trim(raw_pattern);
    const auto union_members = split_top_level(pattern, '|');
    if (union_members.size() > 1) {
        int best = -1;
        for (const auto& member : union_members) {
            const int score = type_match_score(actual, member);
            if (score >= 0) best = std::max(best, score - 25);
        }
        return best;
    }
    const auto intersection_members = split_top_level(pattern, '&');
    if (intersection_members.size() > 1) {
        int score = 250;
        for (const auto& member : intersection_members) {
            const int member_score = type_match_score(actual, member);
            if (member_score < 0) return -1;
            score += member_score;
        }
        return score;
    }
    if (pattern == "any") return 1;
    if (pattern == "type" && actual.rfind("type<", 0) == 0 && actual.back() == '>') {
        return 500;
    }
    if (actual == "int" && pattern == "num") return 40;
    if (symbolic_expression_surface_type(actual) && symbolic_expression_surface_type(pattern)) {
        if (actual == pattern) return 1000;
        if (actual == "symbolic" || pattern == "symbolic" || pattern == "expression") return 400;
        if (actual == "constant" && pattern == "symbol") return 500;
        return -1;
    }
    if (actual.size() >= 3 && pattern.size() >= 3 &&
        actual.front() == '[' && actual.back() == ']' &&
        pattern.front() == '[' && pattern.back() == ']') {
        const std::string actual_inner = actual.substr(1, actual.size() - 2);
        const std::string pattern_inner = pattern.substr(1, pattern.size() - 2);
        const auto actual_colon = find_top_level(actual_inner, ':');
        const auto pattern_colon = find_top_level(pattern_inner, ':');
        if (actual_colon == std::string::npos || pattern_colon == std::string::npos ||
            trim(actual_inner.substr(actual_colon + 1)) != trim(pattern_inner.substr(pattern_colon + 1))) {
            return -1;
        }
        const int element_score = type_match_score(
            actual_inner.substr(0, actual_colon), pattern_inner.substr(0, pattern_colon));
        return element_score < 0 ? -1 : 200 + element_score;
    }
    if (actual.size() >= 3 && actual.front() == '[' && actual.back() == ']' && pattern == "vector") {
        return 100;
    }
    if (actual.rfind("record{", 0) == 0 && actual.back() == '}' && pattern == "struct") {
        return 100;
    }
    if (actual.rfind("record{", 0) == 0 && actual.back() == '}' &&
        pattern.rfind("record{", 0) == 0 && pattern.back() == '}') {
        const auto actual_fields = split_top_level(actual.substr(7, actual.size() - 8), ',');
        const auto pattern_fields = split_top_level(pattern.substr(7, pattern.size() - 8), ',');
        if (pattern_fields.size() > actual_fields.size()) return -1;
        std::size_t actual_index = 0;
        int score = 220;
        for (const auto& pattern_field : pattern_fields) {
            const auto pattern_colon = find_top_level(pattern_field, ':');
            if (pattern_colon == std::string::npos) return -1;
            const std::string pattern_name = trim(pattern_field.substr(0, pattern_colon));
            bool matched = false;
            while (actual_index < actual_fields.size()) {
                const auto& actual_field = actual_fields[actual_index++];
                const auto actual_colon = find_top_level(actual_field, ':');
                if (actual_colon == std::string::npos ||
                    trim(actual_field.substr(0, actual_colon)) != pattern_name) {
                    continue;
                }
                const int field_score = type_match_score(
                    actual_field.substr(actual_colon + 1), pattern_field.substr(pattern_colon + 1));
                if (field_score < 0) return -1;
                score += 10 + field_score;
                matched = true;
                break;
            }
            if (!matched) return -1;
        }
        return score;
    }
    if (actual.rfind("tuple<", 0) == 0 && actual.back() == '>' && pattern == "tuple") {
        return 100;
    }
    if (actual.rfind("tuple<", 0) == 0 && actual.back() == '>' &&
        pattern.rfind("tuple<", 0) == 0 && pattern.back() == '>') {
        const auto actual_items = split_top_level(actual.substr(6, actual.size() - 7), ',');
        const auto pattern_items = split_top_level(pattern.substr(6, pattern.size() - 7), ',');
        if (actual_items.size() != pattern_items.size()) return -1;
        int score = 150;
        for (std::size_t index = 0; index < actual_items.size(); ++index) {
            const int item_score = type_match_score(actual_items[index], pattern_items[index]);
            if (item_score < 0) return -1;
            score += item_score;
        }
        return score;
    }
    if (actual == pattern) return 1000;
    return -1;
}

inline ValueLayout indexed_layout(const std::vector<ValueLayout>& elements) {
    ValueLayout layout;
    layout.width = 0;
    layout.kind = ValueKind::Aggregate;
    for (std::size_t index = 0; index < elements.size(); ++index) {
        const std::string key = std::to_string(index);
        layout.selectors[key] = {
            layout.width, elements[index].width, elements[index].kind,
            elements[index].dynamic_element};
        for (const auto& [child, slice] : elements[index].selectors) {
            layout.selectors[qualified_name(key, child)] = {
                layout.width + slice.offset, slice.width, slice.kind,
                slice.dynamic_element
            };
        }
        layout.width += elements[index].width;
    }
    return layout;
}

using StatValidation = vkf::stat_semantics::Validation<LoweringFailure>;
using FixedNumericVectorShape = StatValidation::FixedNumericVectorShape;
inline std::optional<FixedNumericVectorShape> fixed_numeric_vector_shape(std::string type) {
    return StatValidation::fixed_numeric_vector_shape(std::move(type));
}
inline std::vector<std::size_t> constant_stat_sum_axes(const vf::JsonValue::Array& named_args, std::size_t rank) {
    return StatValidation::constant_stat_sum_axes(named_args, rank);
}

inline ValueLayout string_multiset_layout(std::size_t entries) {
    ValueLayout layout;
    layout.width = static_cast<std::uint32_t>(entries * 3u);
    layout.kind = ValueKind::StringMultiset;
    for (std::size_t index = 0; index < entries; ++index) {
        const std::string key = std::to_string(index);
        const auto offset = static_cast<std::uint32_t>(index * 3u);
        layout.selectors[key] = {offset, 3, ValueKind::Aggregate};
        layout.selectors[key + ".key"] = {offset, 2, ValueKind::String};
        layout.selectors[key + ".count"] = {offset + 2, 1, ValueKind::Numeric};
    }
    return layout;
}

inline std::vector<ValueLayout> indexed_element_layouts(const ValueLayout& source) {
    if (source.kind != ValueKind::Aggregate || is_record_layout(source)) {
        throw LoweringFailure("fixed spread requires a tuple or vector value");
    }
    std::vector<std::pair<std::string, ValueSlice>> children;
    for (const auto& [name, slice] : source.selectors) {
        if (name.find('.') == std::string::npos) children.push_back({name, slice});
    }
    std::stable_sort(children.begin(), children.end(), [](const auto& left, const auto& right) {
        return left.second.offset < right.second.offset;
    });
    std::vector<ValueLayout> elements;
    elements.reserve(children.size());
    for (const auto& [name, slice] : children) {
        elements.push_back(record_field_layout(source, name, slice));
    }
    return elements;
}

inline ValueLayout outer_product_layout(
    const ValueLayout& left,
    const ValueLayout& right
) {
    if (left.kind == ValueKind::Aggregate && !is_record_layout(left)) {
        auto elements = indexed_element_layouts(left);
        for (auto& element : elements) {
            element = outer_product_layout(element, right);
        }
        return indexed_layout(elements);
    }
    if (right.kind == ValueKind::Aggregate && !is_record_layout(right)) {
        auto elements = indexed_element_layouts(right);
        for (auto& element : elements) {
            element = outer_product_layout(left, element);
        }
        return indexed_layout(elements);
    }
    return {};
}

inline ValueLayout layout_from_type(
    const std::string& raw_type,
    const FunctionSignatures* signatures = nullptr
) {
    const std::string type = trim(raw_type);
    if (type.rfind("axis<", 0) == 0) {
        const auto separator = type.find(">:");
        if (separator != std::string::npos && separator + 2 < type.size()) {
            return layout_from_type(type.substr(separator + 2), signatures);
        }
    }
    if (signatures) {
        const auto alias = signatures->type_aliases.find(type);
        if (alias != signatures->type_aliases.end() && alias->second != type) {
            return layout_from_type(alias->second, signatures);
        }
    }
    if (type.size() >= 2 && type.front() == '(' && type.back() == ')') {
        const std::string inside = type.substr(1, type.size() - 2);
        const auto items = split_top_level(inside, ',');
        const bool record = std::any_of(items.begin(), items.end(), [](const std::string& item) {
            return find_top_level(item, ':') != std::string::npos;
        });
        if (record) return layout_from_type("record{" + inside + "}", signatures);
        std::vector<ValueLayout> elements;
        for (const auto& item : items) {
            if (!trim(item).empty()) elements.push_back(layout_from_type(item, signatures));
        }
        return indexed_layout(elements);
    }
    if (type == "any") return {1, ValueKind::Any, {}};
    if (type == "null") return {1, ValueKind::Null, {}};
    if (type == "str") return {2, ValueKind::String, {}};
    if (symbolic_expression_surface_type(type)) {
        return {1, ValueKind::DynamicF64List, {}};
    }
    if (type == "symbolic_domain") {
        return {2, ValueKind::String, {}};
    }
    if (type == "type") {
        return {2, ValueKind::String, {}};
    }
    if (type.rfind("type<", 0) == 0 && type.back() == '>') {
        return {2, ValueKind::String, {}};
    }
    if (type == "range<int>") return {3, ValueKind::Range, {}};
    if (type.rfind("multiset<", 0) == 0 && type.back() == '>') {
        const std::string element = trim(type.substr(9, type.size() - 10));
        if (element == "num" || element == "int" || element == "f32" || element == "f64") {
            return {1, ValueKind::NumericMultiset, {}};
        }
        if (element == "str" || element == "type") return string_multiset_layout(0);
    }
    if (type.size() >= 3 && type.front() == '{' && type.back() == '}') {
        const std::string element = trim(type.substr(1, type.size() - 2));
        if (element == "num" || element == "int" || element == "f32" || element == "f64") {
            return {1, ValueKind::NumericMultiset, {}};
        }
        if (element == "str" || element == "type") return string_multiset_layout(0);
    }
    if (type.size() >= 3 && type.front() == '[' && type.back() == ']') {
        const std::string inside = type.substr(1, type.size() - 2);
        const auto colon = inside.rfind(':');
        if (colon != std::string::npos) {
            const std::string count_text = trim(inside.substr(colon + 1));
            if (!count_text.empty() && std::all_of(count_text.begin(), count_text.end(), [](char ch) {
                    return std::isdigit(static_cast<unsigned char>(ch));
                })) {
                const auto count = static_cast<std::uint32_t>(std::stoul(count_text));
                std::vector<ValueLayout> elements(
                    count, layout_from_type(inside.substr(0, colon), signatures));
                return indexed_layout(elements);
            }
        }
        return dynamic_list_layout(layout_from_type(inside, signatures));
    }
    if (type.rfind("list<", 0) == 0 && type.back() == '>') {
        const std::string element = trim(type.substr(5, type.size() - 6));
        return dynamic_list_layout(layout_from_type(element, signatures));
    }
    if (type == "queue<num>" || type == "queue<int>" ||
        type == "queue<f32>" || type == "queue<f64>") {
        ValueLayout layout;
        layout.width = 2;
        layout.kind = ValueKind::Aggregate;
        layout.selectors["values"] = {0, 1, ValueKind::DynamicF64List};
        layout.selectors["head"] = {1, 1, ValueKind::Numeric};
        return layout;
    }
    if (type.rfind("tuple<", 0) == 0 && type.back() == '>') {
        std::vector<ValueLayout> elements;
        for (const auto& item : split_top_level(type.substr(6, type.size() - 7), ',')) {
            elements.push_back(layout_from_type(item, signatures));
        }
        return indexed_layout(elements);
    }
    if (type.rfind("record{", 0) == 0 && type.back() == '}') {
        ValueLayout layout;
        layout.width = 0;
        layout.kind = ValueKind::Aggregate;
        for (const auto& item : split_top_level(type.substr(7, type.size() - 8), ',')) {
            const auto colon = find_top_level(item, ':');
            if (colon == std::string::npos) return {};
            const std::string field_name = trim(item.substr(0, colon));
            const auto field_layout = layout_from_type(item.substr(colon + 1), signatures);
            layout.selectors[field_name] = {
                layout.width, field_layout.width, field_layout.kind,
                field_layout.dynamic_element};
            for (const auto& [child, slice] : field_layout.selectors) {
                layout.selectors[qualified_name(field_name, child)] = {
                    layout.width + slice.offset, slice.width, slice.kind,
                    slice.dynamic_element
                };
            }
            layout.width += field_layout.width;
        }
        return layout;
    }
    return {};
}

inline DisplayShape display_shape_from_type(const std::string& raw_type) {
    const std::string type = trim(raw_type);
    if (type == "str") return {DisplayKind::String, {}};
    if (symbolic_expression_surface_type(type)) return {DisplayKind::String, {}};
    if (type == "chr") return {DisplayKind::Chr, {}};
    if (type == "bit") return {DisplayKind::Bit, {}};
    if (type == "null") return {DisplayKind::Null, {}};
    if (type == "range<int>") return {DisplayKind::Range, {}};
    if (type.rfind("multiset<", 0) == 0 && type.back() == '>') {
        return {DisplayKind::Multiset, {}};
    }
    if (type.size() >= 3 && type.front() == '{' && type.back() == '}') {
        return {DisplayKind::Multiset, {}};
    }
    if (type.rfind("tuple<", 0) == 0 && type.back() == '>') {
        DisplayShape result{DisplayKind::Tuple, {}};
        for (const auto& item : split_top_level(type.substr(6, type.size() - 7), ',')) {
            result.children.push_back({{}, display_shape_from_type(item)});
        }
        return result;
    }
    if (type.rfind("record{", 0) == 0 && type.back() == '}') {
        DisplayShape result{DisplayKind::Record, {}};
        for (const auto& item : split_top_level(type.substr(7, type.size() - 8), ',')) {
            const auto colon = find_top_level(item, ':');
            if (colon == std::string::npos) return {};
            result.children.push_back({
                trim(item.substr(0, colon)), display_shape_from_type(item.substr(colon + 1))
            });
        }
        return result;
    }
    if ((type.rfind("list<", 0) == 0 && type.back() == '>') ||
        (type.size() >= 2 && type.front() == '[' && type.back() == ']')) {
        return {DisplayKind::Vector, {}};
    }
    return {DisplayKind::F64, {}};
}

inline DisplayShape display_shape_from_expression(
    const vf::JsonValue::Object& expression,
    const DisplayEnvironment& environment,
    const FunctionDisplayShapes* function_displays = nullptr
) {
    const std::string kind = string_field(expression, "kind", "display expression");
    // Numeric fixed vectors have a complete homogeneous display contract in
    // their type. Avoid recursively materializing one DisplayShape node per
    // scalar merely because the value is stored; full children are rebuilt
    // from the value layout only when the aggregate itself is printed.
    const auto declared_type = expression.find("type");
    if (declared_type != expression.end() && declared_type->second.is_string() &&
        fixed_numeric_vector_shape(declared_type->second.as_string())) {
        return {DisplayKind::Vector, {}};
    }
    if (kind == "multiset" || kind == "multiset_from_collection") {
        return {DisplayKind::Multiset, {}};
    }
    if (kind == "range") return {DisplayKind::Range, {}};
    if (kind == "complex_const") return {DisplayKind::Complex, {}};
    if (kind == "const") {
        const auto& value = field(expression, "value", "display constant");
        if (value.is_string()) return {DisplayKind::String, {}};
        if (value.is_boolean()) return {DisplayKind::Bit, {}};
        if (value.is_null()) return {DisplayKind::Null, {}};
        return {DisplayKind::F64, {}};
    }
    if (kind == "load") {
        const auto found = environment.find(string_field(expression, "name", "display load"));
        if (found != environment.end()) return found->second;
    }
    if (kind == "spread") {
        return display_shape_from_expression(
            object_of(field(expression, "value", "display spread"), "spread value"),
            environment,
            function_displays);
    }
    if (kind == "list" || kind == "tuple") {
        DisplayShape result{
            kind == "list" ? DisplayKind::Vector : DisplayKind::Tuple, {}};
        for (const auto& item : array_of(field(expression, "items", "display aggregate"),
                                         "display aggregate items")) {
            const auto& item_expression = object_of(item, "display aggregate item");
            const bool spread = string_field(
                item_expression, "kind", "display aggregate item") == "spread";
            const auto shape = display_shape_from_expression(
                spread
                    ? object_of(field(item_expression, "value", "display spread"), "spread value")
                    : item_expression,
                environment,
                function_displays);
            if (spread && (shape.kind == DisplayKind::Tuple || shape.kind == DisplayKind::Vector)) {
                result.children.insert(result.children.end(), shape.children.begin(), shape.children.end());
            } else {
                result.children.push_back({{}, shape});
            }
        }
        return result;
    }
    if (kind == "record") {
        DisplayShape result{DisplayKind::Record, {}};
        for (const auto& item : array_of(field(expression, "fields", "display record"),
                                         "display record fields")) {
            const auto& record_field = object_of(item, "display record field");
            result.children.push_back({
                string_field(record_field, "name", "display record field"),
                display_shape_from_expression(
                    object_of(field(record_field, "value", "display record field"),
                              "display record value"),
                    environment,
                    function_displays)
            });
        }
        return result;
    }
    if (kind == "scope_identity") {
        const std::string type = string_field(expression, "type", "display scope identity");
        if (type.rfind("record{", 0) == 0 && !type.empty() && type.back() == '}') {
            DisplayShape result{DisplayKind::Record, {}};
            for (const auto& field_surface : split_top_level(
                     type.substr(7, type.size() - 8), ',')) {
                const auto colon = find_top_level(field_surface, ':');
                if (colon == std::string::npos) continue;
                const std::string name = trim(field_surface.substr(0, colon));
                const auto found = environment.find(name);
                result.children.push_back({
                    name,
                    found == environment.end()
                        ? display_shape_from_type(field_surface.substr(colon + 1))
                        : found->second
                });
            }
            return result;
        }
    }
    if (kind == "record_selector") {
        return display_shape_from_type(
            string_field(expression, "type", "display record selector"));
    }
    if (kind == "axis_align") {
        return display_shape_from_expression(
            object_of(field(expression, "value", "display axis value"), "display axis value"),
            environment,
            function_displays);
    }
    if (kind == "if_expr") {
        return display_shape_from_expression(
            object_of(field(expression, "body", "display conditional"), "display conditional body"),
            environment,
            function_displays);
    }
    if (kind == "pipe_chain") {
        const auto declared = expression.find("type");
        if (declared != expression.end() && declared->second.is_string()) {
            const auto shape = display_shape_from_type(declared->second.as_string());
            if (shape.kind != DisplayKind::F64 ||
                declared->second.as_string() == "num" ||
                declared->second.as_string() == "int" ||
                declared->second.as_string() == "f32" ||
                declared->second.as_string() == "f64") {
                return shape;
            }
        }
        return display_shape_from_expression(
            object_of(field(expression, "source", "display pipe"), "display pipe source"),
            environment,
            function_displays);
    }
    if (kind == "field_access") {
        const auto source = display_shape_from_expression(
            object_of(field(expression, "object", "display field"), "display field source"),
            environment,
            function_displays);
        const std::string name = string_field(expression, "field", "display field");
        const auto found = std::find_if(source.children.begin(), source.children.end(),
            [&](const auto& child) { return child.first == name; });
        if (found != source.children.end()) return found->second;
    }
    if (kind == "dotted_index") {
        auto source = display_shape_from_expression(
            object_of(field(expression, "base", "display index"), "display index base"),
            environment,
            function_displays);
        for (const auto& raw_index : array_of(field(expression, "indices", "display index"),
                                               "display indices")) {
            const auto& index = object_of(raw_index, "display index value");
            const auto raw_value = index.find("value");
            if (raw_value == index.end()) {
                return source.kind == DisplayKind::Vector
                    ? DisplayShape{DisplayKind::F64, {}}
                    : display_shape_from_type(string_field(
                        expression, "type", "dynamic display index"));
            }
            const auto& value = raw_value->second;
            if (!value.is_number() || value.as_number() < 0) break;
            const auto position = static_cast<std::size_t>(value.as_number());
            if (position >= source.children.size()) {
                return source.kind == DisplayKind::Vector
                    ? DisplayShape{DisplayKind::F64, {}}
                    : DisplayShape{};
            }
            auto selected = source.children[position].second;
            source = std::move(selected);
        }
        return source;
    }
    if (kind == "call") {
        const auto& callee = object_of(field(expression, "callee", "display call"), "display callee");
        const auto elementwise = expression.find("elementwise_math");
        const auto structural = expression.find("structural_call");
        if ((elementwise != expression.end() && elementwise->second.is_boolean() &&
             elementwise->second.as_boolean()) ||
            (structural != expression.end() && structural->second.is_boolean() &&
             structural->second.as_boolean())) {
            const auto& args = array_of(field(expression, "args", "display call"), "display args");
            for (const auto& value : args) {
                const auto shape = display_shape_from_expression(
                    object_of(value, "display elementwise math argument"),
                    environment,
                    function_displays);
                if (shape.kind == DisplayKind::Vector || shape.kind == DisplayKind::Tuple ||
                    shape.kind == DisplayKind::Record) return shape;
            }
            return {};
        }
        if (string_field(callee, "kind", "display callee") == "stdlib_function" &&
            string_field(callee, "module", "display callee") == "math") {
            const auto& args = array_of(field(expression, "args", "display call"), "display args");
            if (!args.empty()) {
                return display_shape_from_expression(
                    object_of(args.front(), "display math argument"),
                    environment,
                    function_displays);
            }
        }
        if (string_field(callee, "kind", "display callee") == "load") {
            const std::string name = string_field(callee, "name", "display callee");
            if (name == "num" &&
                array_of(field(expression, "args", "display call"), "display args").size() == 2) {
                return {DisplayKind::Complex, {}};
            }
            if (function_displays != nullptr) {
                const auto found = function_displays->find(name);
                if (found != function_displays->end()) return found->second;
            }
        }
    }
    if (kind == "interpolated_string") return {DisplayKind::String, {}};
    if (kind == "binary_op") {
        const std::string op = string_field(expression, "op", "display binary expression");
        auto left = display_shape_from_expression(
            object_of(field(expression, "left", "display binary expression"), "display binary left"),
            environment,
            function_displays);
        auto right = display_shape_from_expression(
            object_of(field(expression, "right", "display binary expression"), "display binary right"),
            environment,
            function_displays);
        if (left.kind == DisplayKind::Multiset || right.kind == DisplayKind::Multiset) {
            return {DisplayKind::Multiset, {}};
        }
        const auto aggregate_display = [](const DisplayShape& shape) {
            return shape.kind == DisplayKind::Vector || shape.kind == DisplayKind::Tuple ||
                shape.kind == DisplayKind::Record;
        };
        if (function_displays != nullptr &&
            (aggregate_display(left) || aggregate_display(right))) {
            const std::string overload = op == "PLUS" ? "+" : op == "MINUS" ? "-"
                : op == "STAR" ? "*" : op == "SLASH" ? "/"
                : op == "FLOORDIV" ? "//" : op == "PERCENT" ? "%"
                : op == "CARET" ? "^" : op == "AMPERSAND" ? "&" : "";
            const auto found = function_displays->find(overload);
            if (!overload.empty() && found != function_displays->end()) return found->second;
        }
        if (op == "AMPERSAND" &&
            (left.kind == DisplayKind::Tuple || left.kind == DisplayKind::Vector) &&
            left.kind == right.kind) {
            left.children.insert(left.children.end(), right.children.begin(), right.children.end());
            return left;
        }
        const std::string left_type = string_field(expression, "left_type", "display binary expression");
        const std::string right_type = string_field(expression, "right_type", "display binary expression");
        if (left.kind == DisplayKind::Vector && right.kind == DisplayKind::Vector &&
            left_type.rfind("axis<", 0) == 0 && right_type.rfind("axis<", 0) == 0 &&
            left_type.substr(5, left_type.find('>') - 5) !=
                right_type.substr(5, right_type.find('>') - 5)) {
            const auto outer_display = [&](const auto& self,
                                           const DisplayShape& left_shape,
                                           const DisplayShape& right_shape) -> DisplayShape {
                if (left_shape.kind == DisplayKind::Vector ||
                    left_shape.kind == DisplayKind::Tuple) {
                    auto result = left_shape;
                    for (auto& child : result.children) {
                        child.second = self(self, child.second, right_shape);
                    }
                    return result;
                }
                if (right_shape.kind == DisplayKind::Vector ||
                    right_shape.kind == DisplayKind::Tuple) {
                    auto result = right_shape;
                    for (auto& child : result.children) {
                        child.second = self(self, left_shape, child.second);
                    }
                    return result;
                }
                return {DisplayKind::F64, {}};
            };
            return outer_display(outer_display, left, right);
        }
        if (left.kind == DisplayKind::Vector || left.kind == DisplayKind::Tuple ||
            left.kind == DisplayKind::Record) return left;
        if (right.kind == DisplayKind::Vector || right.kind == DisplayKind::Tuple ||
            right.kind == DisplayKind::Record) return right;
    }
    const auto type = expression.find("type");
    if (type != expression.end() && type->second.is_string()) {
        return display_shape_from_type(type->second.as_string());
    }
    return {};
}

inline DisplayShape display_shape_from_layout(const ValueLayout& layout) {
    if (layout.kind == ValueKind::String) return {DisplayKind::String, {}};
    if (layout.kind == ValueKind::Complex) return {DisplayKind::Complex, {}};
    if (layout.kind == ValueKind::Null) return {DisplayKind::Null, {}};
    if (layout.kind == ValueKind::Range) return {DisplayKind::Range, {}};
    if (layout.kind == ValueKind::NumericMultiset ||
        layout.kind == ValueKind::StringMultiset) return {DisplayKind::Multiset, {}};
    if (layout.kind != ValueKind::Aggregate) return {DisplayKind::F64, {}};
    DisplayShape result{
        is_record_layout(layout) ? DisplayKind::Record : DisplayKind::Vector, {}};
    std::vector<std::pair<std::string, ValueSlice>> children;
    for (const auto& [name, slice] : layout.selectors) {
        if (name.find('.') == std::string::npos) children.push_back({name, slice});
    }
    std::stable_sort(children.begin(), children.end(), [](const auto& left, const auto& right) {
        return left.second.offset < right.second.offset;
    });
    for (const auto& [name, slice] : children) {
        result.children.push_back({
            is_record_layout(layout) ? name : std::string{},
            display_shape_from_layout(record_field_layout(layout, name, slice))
        });
    }
    return result;
}

inline bool is_scalar_f64_output(
    const ValueLayout& layout,
    const DisplayShape& display_shape
) {
    return layout.width == 1 &&
        (layout.kind == ValueKind::Numeric ||
         (layout.kind == ValueKind::Any && display_shape.kind == DisplayKind::F64));
}

inline bool same_display_shape(const DisplayShape& left, const DisplayShape& right) {
    if (left.kind != right.kind || left.label != right.label ||
        left.children.size() != right.children.size()) return false;
    for (std::size_t index = 0; index < left.children.size(); ++index) {
        if (left.children[index].first != right.children[index].first ||
            !same_display_shape(left.children[index].second, right.children[index].second)) {
            return false;
        }
    }
    return true;
}

inline DisplayShape infer_function_display_shape(
    const vf::JsonValue::Object& function,
    const FunctionSignature& signature,
    const FunctionDisplayShapes& function_displays
) {
    DisplayEnvironment environment;
    for (std::size_t index = 0;
         index < signature.parameter_names.size() && index < signature.parameter_displays.size();
         ++index) {
        environment[signature.parameter_names[index]] = signature.parameter_displays[index];
    }
    const auto& block = object_of(field(function, "body", "display function"), "display function body");
    const auto& body = array_of(field(block, "body", "display function body"), "display statements");
    DisplayShape result = signature.result_display;
    bool nominal_scope_result = false;
    for (const auto& value : body) {
        const auto& statement = object_of(value, "display function statement");
        const std::string kind = string_field(statement, "kind", "display function statement");
        if (kind == "store_binding") {
            environment[string_field(statement, "name", "display binding")] =
                display_shape_from_expression(
                    object_of(field(statement, "value", "display binding"), "display binding value"),
                    environment,
                    &function_displays);
        } else if (kind == "expr_stmt") {
            const auto& result_expression = object_of(
                field(statement, "expr", "display result"), "display result expression");
            nominal_scope_result = string_field(
                result_expression, "kind", "display result expression") == "scope_identity";
            result = display_shape_from_expression(
                result_expression,
                environment,
                &function_displays);
        } else if (kind == "return") {
            result = display_shape_from_expression(
                object_of(field(statement, "value", "display return"), "display return value"),
                environment,
                &function_displays);
        }
    }
    const auto nominal_type = function.find("nominal_type");
    if ((nominal_scope_result || nominal_type != function.end()) &&
        result.kind == DisplayKind::Record) {
        result.label = nominal_type != function.end() && nominal_type->second.is_string()
            ? nominal_type->second.as_string()
            : string_field(function, "name", "display function");
    }
    return result;
}

inline void refine_returned_parameter_layout(
    const vf::JsonValue::Object& function,
    FunctionSignature& signature,
    FunctionSignatures& signatures
) {
    if (!signature.result_is_any) return;
    const auto& block = object_of(field(function, "body", "function"), "function body");
    const auto& body = array_of(field(block, "body", "function body"), "function body statements");
    const vf::JsonValue::Object* result = nullptr;
    for (auto statement = body.rbegin(); statement != body.rend(); ++statement) {
        const auto& object = object_of(*statement, "function result statement");
        const std::string kind = string_field(object, "kind", "function result statement");
        if (kind == "expr_stmt") {
            result = &object_of(field(object, "expr", "function result"), "function result expression");
            break;
        }
        if (kind == "return") {
            result = &object_of(field(object, "value", "function return"), "function return value");
            break;
        }
    }
    if (!result) return;
    const std::string kind = string_field(*result, "kind", "function result expression");
    if (kind == "call") {
        const auto& callee = object_of(field(*result, "callee", "returned call"), "returned callee");
        if (string_field(callee, "kind", "returned callee") == "load") {
            const auto target = signatures.find(string_field(callee, "name", "returned callee"));
            if (target != signatures.end() && target->second.result_is_any) {
                merge_inferred_layout(target->second.result, signature.result);
            }
        }
        return;
    }
    std::string parameter_name;
    std::string field_name;
    if (kind == "load") {
        parameter_name = string_field(*result, "name", "function result load");
    } else if (kind == "field_access") {
        const auto& source = object_of(field(*result, "object", "function result field"), "field source");
        if (string_field(source, "kind", "field source") != "load") return;
        parameter_name = string_field(source, "name", "field source");
        field_name = string_field(*result, "field", "function result field");
    } else {
        return;
    }
    const auto parameter = std::find(
        signature.parameter_names.begin(), signature.parameter_names.end(), parameter_name);
    if (parameter == signature.parameter_names.end()) return;
    const auto index = static_cast<std::size_t>(parameter - signature.parameter_names.begin());
    if (index >= signature.parameter_is_any.size() || !signature.parameter_is_any[index]) return;
    if (field_name.empty()) merge_inferred_layout(signature.parameters[index], signature.result);
    else assign_record_field_layout(signature.parameters[index], field_name, signature.result);
}

inline bool is_explicit_dynamic_f64_list_type(const std::string& raw_type) {
    const std::string type = trim(raw_type);
    if (type.rfind("list<", 0) == 0 && type.back() == '>') {
        const std::string element = trim(type.substr(5, type.size() - 6));
        return element == "num" || element == "int" ||
            element == "f32" || element == "f64";
    }
    if (type.size() < 3 || type.front() != '[' || type.back() != ']') return false;
    const std::string element = trim(type.substr(1, type.size() - 2));
    return element == "num" || element == "int" || element == "f32" || element == "f64";
}

inline ValueLayout layout_from_expression_shape(
    const vf::JsonValue::Object& expression,
    const FunctionSignatures& signatures
) {
    const std::string kind = string_field(expression, "kind", "expression shape");
    if (kind == "complex_const") return {2, ValueKind::Complex, {}};
    if (kind == "range") return {3, ValueKind::Range, {}};
    if (kind == "bind_expr") return layout_from_expression_shape(
        object_of(field(expression, "value", "bind expression"), "bind expression value"),
        signatures);
    if (kind == "multiset" || kind == "multiset_from_collection") {
        const std::string element_type = string_field(expression, "element_type", "multiset shape");
        if (element_type == "num" || element_type == "int" ||
            element_type == "f32" || element_type == "f64") {
            return {1, ValueKind::NumericMultiset, {}};
        }
        if (element_type == "str" || element_type == "type") {
            return string_multiset_layout(
                array_of(field(expression, "pairs", "multiset shape"), "multiset pairs").size());
        }
        return {};
    }
    if (kind == "symbolic_var") {
        return {1, ValueKind::DynamicF64List, {}};
    }
    if (kind == "load") {
        // Typed IR already resolved lexical shadowing.  Prefer that type over a
        // same-named module binding; module layouts are only a fallback for
        // legacy/untyped loads.
        const auto type = expression.find("type");
        if (type != expression.end() && type->second.is_string() &&
            type->second.as_string() != "any") {
            return layout_from_type(type->second.as_string(), &signatures);
        }
        const auto known_layout = signatures.module_layouts.find(
            string_field(expression, "name", "module layout load"));
        if (known_layout != signatures.module_layouts.end()) return known_layout->second;
        const auto literal = signatures.module_literals.find(
            string_field(expression, "name", "module literal load"));
        if (literal != signatures.module_literals.end()) {
            return layout_from_expression_shape(*literal->second, signatures);
        }
    }
    if (kind == "list" || kind == "tuple") {
        const auto type = expression.find("type");
        if (kind == "list" && type != expression.end() && type->second.is_string()) {
            const auto declared = layout_from_type(type->second.as_string(), &signatures);
            if (declared.kind == ValueKind::DynamicF64List) return declared;
        }
        std::vector<ValueLayout> elements;
        for (const auto& value : array_of(field(expression, "items", kind), kind + " items")) {
            const auto& item = object_of(value, kind + " item");
            const bool spread = string_field(item, "kind", kind + " item") == "spread";
            const auto layout = layout_from_expression_shape(
                spread ? object_of(field(item, "value", "spread"), "spread value") : item,
                signatures);
            if (spread) {
                const auto spread_elements = indexed_element_layouts(layout);
                elements.insert(elements.end(), spread_elements.begin(), spread_elements.end());
            } else {
                elements.push_back(layout);
            }
        }
        return indexed_layout(elements);
    }
    if (kind == "record") {
        ValueLayout layout;
        layout.width = 0;
        layout.kind = ValueKind::Aggregate;
        for (const auto& value : array_of(field(expression, "fields", "record"), "record fields")) {
            const auto& record_field = object_of(value, "record field");
            const auto value_layout = layout_from_expression_shape(
                object_of(field(record_field, "value", "record field"), "record field value"), signatures);
            layout.selectors[string_field(record_field, "name", "record field")] = {
                layout.width, value_layout.width, value_layout.kind,
                value_layout.dynamic_element
            };
            const std::string field_name = string_field(record_field, "name", "record field");
            for (const auto& [child, slice] : value_layout.selectors) {
                layout.selectors[qualified_name(field_name, child)] = {
                    layout.width + slice.offset, slice.width, slice.kind,
                    slice.dynamic_element
                };
            }
            layout.width += value_layout.width;
        }
        return layout;
    }
    if (kind == "block_expr") {
        const auto& body = array_of(field(expression, "body", "block expression"), "block expression body");
        if (body.empty()) return {};
        const auto& tail = object_of(body.back(), "block expression tail");
        const std::string tail_kind = string_field(tail, "kind", "block expression tail");
        if (tail_kind == "expr_stmt") {
            const auto& value = object_of(field(tail, "expr", "block expression tail"), "block tail value");
            if (string_field(value, "kind", "block tail value") == "scope_identity") {
                const std::string type = string_field(value, "type", "scope identity");
                if (type.rfind("record{", 0) != 0 || type.empty() || type.back() != '}') return {};
                ValueLayout result;
                result.width = 0;
                result.kind = ValueKind::Aggregate;
                for (const auto& field_surface : split_top_level(type.substr(7, type.size() - 8), ',')) {
                    const auto colon = find_top_level(field_surface, ':');
                    if (colon == std::string::npos) return {};
                    const std::string name = trim(field_surface.substr(0, colon));
                    ValueLayout field_layout = layout_from_type(
                        field_surface.substr(colon + 1), &signatures);
                    for (auto statement = body.rbegin(); statement != body.rend(); ++statement) {
                        const auto& candidate = object_of(*statement, "block scope field");
                        if (string_field(candidate, "kind", "block scope field") != "store_binding" ||
                            string_field(candidate, "name", "block scope field") != name) {
                            continue;
                        }
                        field_layout = layout_from_expression_shape(
                            object_of(field(candidate, "value", "block scope field"), "block scope value"),
                            signatures);
                        break;
                    }
                    result.selectors[name] = {
                        result.width, field_layout.width, field_layout.kind,
                        field_layout.dynamic_element
                    };
                    for (const auto& [child, slice] : field_layout.selectors) {
                        result.selectors[qualified_name(name, child)] = {
                            result.width + slice.offset, slice.width, slice.kind,
                            slice.dynamic_element
                        };
                    }
                    result.width += field_layout.width;
                }
                return result;
            }
            return layout_from_expression_shape(value, signatures);
        }
        if (tail_kind == "return") {
            return layout_from_expression_shape(
                object_of(field(tail, "value", "block return"), "block return value"), signatures);
        }
        if (tail_kind == "store_binding") {
            return layout_from_expression_shape(
                object_of(field(tail, "value", "block assignment"), "block assignment value"),
                signatures);
        }
        return {};
    }
    if (kind == "axis_align") {
        return layout_from_fixed_literal_shape(
            object_of(field(expression, "value", "axis align"), "axis align value"), signatures);
    }
    if (kind == "if_expr") {
        return layout_from_expression_shape(
            object_of(field(expression, "body", "conditional expression"), "conditional body"),
            signatures);
    }
    if (kind == "pipe_chain") {
        auto source = layout_from_expression_shape(
            object_of(field(expression, "source", "pipe expression"), "pipe source"),
            signatures);
        const auto declared = expression.find("type");
        if (declared != expression.end() && declared->second.is_string()) {
            auto result = layout_from_type(declared->second.as_string(), &signatures);
            if (result.width > 0) return result;
        }
        if (source.kind == ValueKind::Range) {
            return {1, ValueKind::DynamicF64List, {}};
        }
        return source;
    }
    if (kind == "binary_op") {
        const auto result_type = expression.find("type");
        if (result_type != expression.end() && result_type->second.is_string() &&
            symbolic_expression_surface_type(result_type->second.as_string())) {
            return {1, ValueKind::DynamicF64List, {}};
        }
        auto left = layout_from_expression_shape(
            object_of(field(expression, "left", "binary expression"), "binary left"), signatures);
        auto right = layout_from_expression_shape(
            object_of(field(expression, "right", "binary expression"), "binary right"), signatures);
        const std::string numeric_op = string_field(expression, "op", "binary expression");
        if (left.kind == ValueKind::Complex || right.kind == ValueKind::Complex) {
            if (numeric_op == "EQ" || numeric_op == "EXACT_EQ" || numeric_op == "NE" ||
                numeric_op == "NEQ" || numeric_op == "STRUCT_NEQ" || numeric_op == "LT" ||
                numeric_op == "LE" || numeric_op == "GT" || numeric_op == "GE") return {};
            return {2, ValueKind::Complex, {}};
        }
        if (left.kind == ValueKind::StringMultiset || right.kind == ValueKind::StringMultiset) {
            const std::string op = string_field(expression, "op", "binary expression");
            if (op == "EXACT_EQ" || op == "NE" || op == "NEQ") return {};
            if (left.kind == ValueKind::StringMultiset && right.kind == ValueKind::StringMultiset) {
                return op == "PLUS" || op == "AMPERSAND"
                    ? string_multiset_layout(left.width / 3u + right.width / 3u)
                    : left;
            }
            return left.kind == ValueKind::StringMultiset ? left : right;
        }
        if (left.kind == ValueKind::NumericMultiset || right.kind == ValueKind::NumericMultiset) {
            return numeric_op == "EQ" || numeric_op == "EXACT_EQ" ||
                    numeric_op == "NE" || numeric_op == "NEQ" ||
                    numeric_op == "STRUCT_NEQ"
                ? ValueLayout{}
                : ValueLayout{1, ValueKind::NumericMultiset, {}};
        }
        if (string_field(expression, "op", "binary expression") == "AMPERSAND" &&
            ((left.kind == ValueKind::DynamicF64List && right.kind == ValueKind::Aggregate) ||
             (right.kind == ValueKind::DynamicF64List && left.kind == ValueKind::Aggregate))) {
            const auto& fixed = left.kind == ValueKind::Aggregate ? left : right;
            const auto elements = indexed_element_layouts(fixed);
            return elements.empty()
                ? (left.kind == ValueKind::DynamicF64List ? left : right)
                : dynamic_list_layout(elements.front());
        }
        if (string_field(expression, "op", "binary expression") == "AMPERSAND" &&
            left.kind == right.kind &&
            (left.kind == ValueKind::String || left.kind == ValueKind::DynamicF64List)) {
            return left;
        }
        const std::string op = string_field(expression, "op", "binary expression");
        const std::string overload = op == "PLUS" ? "+" : op == "MINUS" ? "-"
            : op == "STAR" ? "*" : op == "SLASH" ? "/"
            : op == "FLOORDIV" ? "//" : op == "PERCENT" ? "%"
            : op == "CARET" ? "^" : op == "AMPERSAND" ? "&" : "";
        const auto overloaded = signatures.find(overload);
        if (!overload.empty() && overloaded != signatures.end() &&
            (left.kind == ValueKind::Aggregate || right.kind == ValueKind::Aggregate)) {
            return overloaded->second.result;
        }
        if (op == "AMPERSAND" && left.kind == ValueKind::Aggregate &&
            right.kind == ValueKind::Aggregate && !is_record_layout(left) &&
            !is_record_layout(right)) {
            std::vector<ValueLayout> elements;
            const auto append = [&](const ValueLayout& source) {
                std::vector<std::pair<std::string, ValueSlice>> children;
                for (const auto& [name, slice] : source.selectors) {
                    if (name.find('.') == std::string::npos) children.push_back({name, slice});
                }
                std::stable_sort(children.begin(), children.end(), [](const auto& a, const auto& b) {
                    return a.second.offset < b.second.offset;
                });
                for (const auto& [name, slice] : children) {
                    elements.push_back(record_field_layout(source, name, slice));
                }
            };
            append(left);
            append(right);
            return indexed_layout(elements);
        }
        if (left.kind == ValueKind::Aggregate || right.kind == ValueKind::Aggregate) {
            const std::string left_type = string_field(expression, "left_type", "binary expression");
            const std::string right_type = string_field(expression, "right_type", "binary expression");
            if (left.width > 1 && right.width > 1 &&
                left_type.rfind("axis<", 0) == 0 && right_type.rfind("axis<", 0) == 0 &&
                left_type.substr(5, left_type.find('>') - 5) !=
                    right_type.substr(5, right_type.find('>') - 5)) {
                return outer_product_layout(left, right);
            }
            return left.width > 1 ? left : right;
        }
        return {};
    }
    if (kind == "call") {
        const auto& callee = object_of(field(expression, "callee", "call"), "callee");
        const std::string callee_kind = string_field(callee, "kind", "callee");
        const auto elementwise = expression.find("elementwise_math");
        const auto structural = expression.find("structural_call");
        if (structural != expression.end() && structural->second.is_boolean() &&
            structural->second.as_boolean()) {
            return layout_from_type(
                string_field(expression, "type", "structural call"), &signatures);
        }
        if (elementwise != expression.end() && elementwise->second.is_boolean() &&
            elementwise->second.as_boolean()) {
            const auto& args = array_of(field(expression, "args", "call"), "call args");
            for (const auto& value : args) {
                const auto layout = layout_from_expression_shape(
                    object_of(value, "elementwise math shape argument"), signatures);
                if (layout.kind == ValueKind::Aggregate ||
                    layout.kind == ValueKind::DynamicF64List) {
                    return layout;
                }
            }
            return {};
        }
        if (callee_kind == "load" && string_field(callee, "name", "callee") == "num" &&
            array_of(field(expression, "args", "call"), "call args").size() == 2) {
            return {2, ValueKind::Complex, {}};
        }
        if (callee_kind == "stdlib_function" &&
            string_field(callee, "module", "callee") == "collections" &&
            string_field(callee, "name", "callee") == "list") {
            return {1, ValueKind::DynamicF64List, {}};
        }
        if (callee_kind == "stdlib_function" &&
            string_field(callee, "module", "callee") == "math") {
            const auto& args = array_of(field(expression, "args", "call"), "call args");
            if (!args.empty()) {
                return layout_from_expression_shape(
                    object_of(args.front(), "math shape argument"), signatures);
            }
        }
        if (callee_kind == "load") {
            const auto found = signatures.find(string_field(callee, "name", "callee"));
            if (found != signatures.end()) return found->second.result;
        }
    }
    const auto type = expression.find("type");
    if (type != expression.end() && type->second.is_string()) {
        return layout_from_type(type->second.as_string(), &signatures);
    }
    return {};
}

inline ValueLayout layout_from_fixed_literal_shape(
    const vf::JsonValue::Object& expression,
    const FunctionSignatures& signatures
) {
    const std::string kind = string_field(expression, "kind", "fixed literal shape");
    if (kind != "list" && kind != "tuple") {
        return layout_from_expression_shape(expression, signatures);
    }
    std::vector<ValueLayout> elements;
    for (const auto& value : array_of(field(expression, "items", "fixed literal shape"),
                                      "fixed literal items")) {
        const auto& item = object_of(value, "fixed literal item");
        if (string_field(item, "kind", "fixed literal item") == "spread") {
            const auto spread = layout_from_fixed_literal_shape(
                object_of(field(item, "value", "fixed literal spread"), "fixed literal spread value"),
                signatures);
            const auto spread_elements = indexed_element_layouts(spread);
            elements.insert(elements.end(), spread_elements.begin(), spread_elements.end());
        } else {
            elements.push_back(layout_from_fixed_literal_shape(item, signatures));
        }
    }
    return indexed_layout(elements);
}

using LayoutEnvironment = std::map<std::string, ValueLayout>;

inline ValueLayout layout_from_environment_expression_shape(
    const vf::JsonValue::Object& expression,
    LayoutEnvironment environment,
    const FunctionSignatures& signatures
) {
    const std::string kind = string_field(expression, "kind", "environment expression shape");
    if (kind == "complex_const") return {2, ValueKind::Complex, {}};
    if (kind == "range") return {3, ValueKind::Range, {}};
    if (kind == "bind_expr") {
        const auto value = layout_from_environment_expression_shape(
            object_of(field(expression, "value", "bind expression"), "bind expression value"),
            environment, signatures);
        environment[string_field(expression, "name", "bind expression")] = value;
        return value;
    }
    if (kind == "multiset" || kind == "multiset_from_collection") {
        return layout_from_expression_shape(expression, signatures);
    }
    if (kind == "load") {
        const auto found = environment.find(string_field(expression, "name", "environment load"));
        if (found != environment.end()) return found->second;
    }
    if (kind == "call") {
        const auto& callee = object_of(field(expression, "callee", "environment call"), "environment callee");
        const std::string callee_kind = string_field(callee, "kind", "environment callee");
        const auto& args = array_of(field(expression, "args", "environment call"), "environment args");
        const auto elementwise = expression.find("elementwise_math");
        const auto structural = expression.find("structural_call");
        if (structural != expression.end() && structural->second.is_boolean() &&
            structural->second.as_boolean()) {
            return layout_from_type(
                string_field(expression, "type", "structural call"), &signatures);
        }
        if (elementwise != expression.end() && elementwise->second.is_boolean() &&
            elementwise->second.as_boolean()) {
            for (const auto& value : args) {
                const auto layout = layout_from_environment_expression_shape(
                    object_of(value, "environment elementwise argument"), environment, signatures);
                if (layout.kind == ValueKind::Aggregate ||
                    layout.kind == ValueKind::DynamicF64List) {
                    return layout;
                }
            }
            return {};
        }
        if (callee_kind == "load" && string_field(callee, "name", "environment callee") == "num" &&
            args.size() == 2) {
            return {2, ValueKind::Complex, {}};
        }
        if (callee_kind == "stdlib_function" &&
            string_field(callee, "module", "environment callee") == "math" && !args.empty()) {
            const auto input = layout_from_environment_expression_shape(
                object_of(args.front(), "environment math argument"), environment, signatures);
            return string_field(callee, "name", "environment callee") == "abs" &&
                    input.kind == ValueKind::Complex
                ? ValueLayout{} : input;
        }
        if (callee_kind == "load") {
            const auto signature = signatures.find(string_field(callee, "name", "environment callee"));
            if (signature != signatures.end()) return signature->second.result;
        }
    }
    if (kind == "spread") {
        return layout_from_environment_expression_shape(
            object_of(field(expression, "value", "environment spread"), "spread value"),
            environment,
            signatures);
    }
    if (kind == "field_access") {
        const auto source = layout_from_environment_expression_shape(
            object_of(field(expression, "object", "environment field"), "environment field source"),
            environment,
            signatures);
        const std::string name = string_field(expression, "field", "environment field");
        const auto found = source.selectors.find(name);
        if (found != source.selectors.end()) return record_field_layout(source, name, found->second);
    }
    if (kind == "dotted_index") {
        auto source = layout_from_environment_expression_shape(
            object_of(field(expression, "base", "environment index"), "environment index base"),
            environment,
            signatures);
        const auto& indices = array_of(
            field(expression, "indices", "environment index"), "environment indices");
        if (source.kind == ValueKind::DynamicF64List) {
            const ValueLayout element = source.dynamic_element
                ? *source.dynamic_element : ValueLayout{};
            if (indices.size() <= 1) return element;
            return indexed_layout(std::vector<ValueLayout>(indices.size(), element));
        }
        std::size_t expanded_index_count = indices.size();
        const auto expanded_count = expression.find("expanded_index_count");
        if (expanded_count != expression.end() && expanded_count->second.is_number()) {
            expanded_index_count = static_cast<std::size_t>(expanded_count->second.as_number());
        }
        if (expanded_index_count > 1 && expanded_index_count == indices.size()) {
            auto projected = source;
            bool complete_projection = true;
            for (const auto& value : indices) {
                const auto& index = object_of(value, "environment nested index value");
                const auto raw_value = index.find("value");
                if (raw_value == index.end() || !raw_value->second.is_number() ||
                    raw_value->second.as_number() < 0 ||
                    raw_value->second.as_number() != static_cast<double>(
                        static_cast<std::uint32_t>(raw_value->second.as_number()))) {
                    complete_projection = false;
                    break;
                }
                const std::string name = std::to_string(
                    static_cast<std::uint32_t>(raw_value->second.as_number()));
                const auto found = projected.selectors.find(name);
                if (found == projected.selectors.end()) {
                    complete_projection = false;
                    break;
                }
                projected = record_field_layout(projected, name, found->second);
            }
            if (complete_projection) return projected;
        }
        std::size_t source_rank = 0;
        ValueLayout rank_leaf = source;
        while (rank_leaf.kind == ValueKind::Aggregate && !is_record_layout(rank_leaf)) {
            const auto elements = indexed_element_layouts(rank_leaf);
            if (elements.empty() || std::any_of(
                    elements.begin(), elements.end(), [&](const auto& candidate) {
                        return !same_layout(candidate, elements.front());
                    })) break;
            ++source_rank;
            rank_leaf = elements.front();
        }
        if (source_rank > 1 && expanded_index_count == source_rank &&
            expanded_index_count == indices.size()) {
            for (const auto& value : indices) {
                const auto& index = object_of(value, "environment coordinate index value");
                const auto raw_value = index.find("value");
                if (raw_value == index.end()) return {};
                const auto& raw = raw_value->second;
                if (!raw.is_number() || raw.as_number() < 0 ||
                    raw.as_number() != static_cast<double>(
                        static_cast<std::uint32_t>(raw.as_number()))) return {};
                const std::string name = std::to_string(
                    static_cast<std::uint32_t>(raw.as_number()));
                const auto found = source.selectors.find(name);
                if (found == source.selectors.end()) return {};
                source = record_field_layout(source, name, found->second);
            }
            return source;
        }
        if (indices.size() > 1) {
            std::vector<ValueLayout> elements;
            for (const auto& value : indices) {
                const auto& index = object_of(value, "environment multi-index value");
                const auto raw_value = index.find("value");
                if (raw_value == index.end() || !raw_value->second.is_number() ||
                    raw_value->second.as_number() < 0 ||
                    raw_value->second.as_number() != static_cast<double>(
                        static_cast<std::uint32_t>(raw_value->second.as_number()))) return {};
                const std::string name = std::to_string(
                    static_cast<std::uint32_t>(raw_value->second.as_number()));
                const auto found = source.selectors.find(name);
                if (found == source.selectors.end()) return {};
                elements.push_back(record_field_layout(source, name, found->second));
            }
            return indexed_layout(elements);
        }
        for (const auto& value : indices) {
            const auto& index = object_of(value, "environment index value");
            const auto raw_value = index.find("value");
            if (raw_value == index.end()) return {};
            const auto& raw = raw_value->second;
            if (!raw.is_number() || raw.as_number() < 0 ||
                raw.as_number() != static_cast<double>(static_cast<std::uint32_t>(raw.as_number()))) return {};
            const std::string name = std::to_string(static_cast<std::uint32_t>(raw.as_number()));
            const auto found = source.selectors.find(name);
            if (found == source.selectors.end()) return {};
            source = record_field_layout(source, name, found->second);
        }
        return source;
    }
    if (kind == "record") {
        ValueLayout result{0, ValueKind::Aggregate, {}};
        for (const auto& value : array_of(field(expression, "fields", "record"), "record fields")) {
            const auto& record_field = object_of(value, "record field");
            const std::string name = string_field(record_field, "name", "record field");
            assign_record_field_layout(
                result,
                name,
                layout_from_environment_expression_shape(
                    object_of(field(record_field, "value", "record field"), "record field value"),
                    environment,
                    signatures));
        }
        return result;
    }
    if (kind == "list" || kind == "tuple") {
        const auto declared = expression.find("type");
        if (kind == "list" && declared != expression.end() && declared->second.is_string()) {
            const auto layout = layout_from_type(declared->second.as_string(), &signatures);
            if (layout.kind == ValueKind::DynamicF64List) return layout;
        }
        std::vector<ValueLayout> elements;
        for (const auto& value : array_of(field(expression, "items", kind), kind + " items")) {
            const auto& item = object_of(value, kind + " item");
            const bool spread = string_field(item, "kind", kind + " item") == "spread";
            const auto layout = layout_from_environment_expression_shape(
                spread ? object_of(field(item, "value", "spread"), "spread value") : item,
                environment,
                signatures);
            if (spread) {
                const auto spread_elements = indexed_element_layouts(layout);
                elements.insert(elements.end(), spread_elements.begin(), spread_elements.end());
            } else {
                elements.push_back(layout);
            }
        }
        return indexed_layout(elements);
    }
    if (kind == "scope_identity") {
        const std::string type = string_field(expression, "type", "scope identity");
        if (type.rfind("record{", 0) != 0 || type.empty() || type.back() != '}') return {};
        ValueLayout result{0, ValueKind::Aggregate, {}};
        for (const auto& field_surface : split_top_level(type.substr(7, type.size() - 8), ',')) {
            const auto colon = find_top_level(field_surface, ':');
            if (colon == std::string::npos) return {};
            const std::string name = trim(field_surface.substr(0, colon));
            const auto found = environment.find(name);
            assign_record_field_layout(
                result,
                name,
                found == environment.end()
                    ? layout_from_type(field_surface.substr(colon + 1), &signatures)
                    : found->second);
        }
        return result;
    }
    if (kind == "block_expr") {
        const auto& body = array_of(field(expression, "body", "block expression"), "block body");
        for (const auto& value : body) {
            const auto& statement = object_of(value, "block statement");
            const std::string statement_kind = string_field(statement, "kind", "block statement");
            if (statement_kind == "store_binding") {
                const std::string name = string_field(statement, "name", "block binding");
                const auto value_layout = layout_from_environment_expression_shape(
                    object_of(field(statement, "value", "block binding"), "block binding value"),
                    environment,
                    signatures);
                environment[name] = value_layout;
                if (&value == &body.back()) return value_layout;
            } else if (statement_kind == "expr_stmt") {
                const auto& value_expression = object_of(
                    field(statement, "expr", "block result"), "block result expression");
                if (&value == &body.back()) {
                    return layout_from_environment_expression_shape(
                        value_expression, environment, signatures);
                }
            } else if (statement_kind == "return") {
                return layout_from_environment_expression_shape(
                    object_of(field(statement, "value", "block return"), "block return value"),
                    environment,
                    signatures);
            }
        }
        return {};
    }
    if (kind == "pipe_chain") {
        const auto source = layout_from_environment_expression_shape(
            object_of(field(expression, "source", "environment pipe"),
                      "environment pipe source"),
            environment,
            signatures);
        if (source.kind != ValueKind::Aggregate || is_record_layout(source)) {
            return layout_from_expression_shape(expression, signatures);
        }
        const auto elements = indexed_element_layouts(source);
        if (elements.empty() || std::any_of(
                elements.begin(), elements.end(), [&](const auto& element) {
                    return !same_layout(element, elements.front());
                })) {
            return layout_from_expression_shape(expression, signatures);
        }
        auto pipe_environment = environment;
        pipe_environment["$"] = elements.front();
        ValueLayout result = elements.front();
        for (const auto& segment : array_of(
                 field(expression, "segments", "environment pipe"),
                 "environment pipe segments")) {
            result = layout_from_environment_expression_shape(
                object_of(segment, "environment pipe segment"),
                pipe_environment,
                signatures);
            pipe_environment["$"] = result;
        }
        return indexed_layout(std::vector<ValueLayout>(elements.size(), result));
    }
    if (kind == "axis_align") {
        const auto& value = object_of(field(expression, "value", "axis align"), "axis align value");
        const std::string value_kind = string_field(value, "kind", "axis align value");
        return value_kind == "list" || value_kind == "tuple"
            ? layout_from_fixed_literal_shape(value, signatures)
            : layout_from_environment_expression_shape(value, environment, signatures);
    }
    if (kind == "binary_op") {
        const auto result_type = expression.find("type");
        if (result_type != expression.end() && result_type->second.is_string() &&
            symbolic_expression_surface_type(result_type->second.as_string())) {
            return {1, ValueKind::DynamicF64List, {}};
        }
        const auto left = layout_from_environment_expression_shape(
            object_of(field(expression, "left", "environment binary"), "environment binary left"),
            environment,
            signatures);
        const auto right = layout_from_environment_expression_shape(
            object_of(field(expression, "right", "environment binary"), "environment binary right"),
            environment,
            signatures);
        const std::string op = string_field(expression, "op", "environment binary");
        if (left.kind == ValueKind::Complex || right.kind == ValueKind::Complex) {
            if (op == "EQ" || op == "EXACT_EQ" || op == "NE" || op == "NEQ" ||
                op == "STRUCT_NEQ" || op == "LT" || op == "LE" || op == "GT" || op == "GE") {
                return {};
            }
            return {2, ValueKind::Complex, {}};
        }
        if (left.kind == ValueKind::StringMultiset || right.kind == ValueKind::StringMultiset) {
            if (op == "EXACT_EQ" || op == "NE" || op == "NEQ") return {};
            if (left.kind == ValueKind::StringMultiset && right.kind == ValueKind::StringMultiset) {
                return op == "PLUS" || op == "AMPERSAND"
                    ? string_multiset_layout(left.width / 3u + right.width / 3u)
                    : left;
            }
            return left.kind == ValueKind::StringMultiset ? left : right;
        }
        if (left.kind == ValueKind::NumericMultiset || right.kind == ValueKind::NumericMultiset) {
            return op == "EQ" || op == "EXACT_EQ" || op == "NE" ||
                    op == "NEQ" || op == "STRUCT_NEQ"
                ? ValueLayout{}
                : ValueLayout{1, ValueKind::NumericMultiset, {}};
        }
        if (op == "AMPERSAND" &&
            (left.kind == ValueKind::String || right.kind == ValueKind::String)) {
            return {2, ValueKind::String, {}};
        }
        if (op == "AMPERSAND" && left.kind == ValueKind::DynamicF64List &&
            right.kind == ValueKind::DynamicF64List) {
            return left.dynamic_element ? left : right;
        }
        if (op == "AMPERSAND" &&
            ((left.kind == ValueKind::DynamicF64List && right.kind == ValueKind::Aggregate) ||
             (right.kind == ValueKind::DynamicF64List && left.kind == ValueKind::Aggregate))) {
            const auto& fixed = left.kind == ValueKind::Aggregate ? left : right;
            const auto elements = indexed_element_layouts(fixed);
            return elements.empty()
                ? (left.kind == ValueKind::DynamicF64List ? left : right)
                : dynamic_list_layout(elements.front());
        }
        if (op == "AMPERSAND" && left.kind == ValueKind::Aggregate &&
            right.kind == ValueKind::Aggregate && !is_record_layout(left) &&
            !is_record_layout(right)) {
            std::vector<ValueLayout> elements;
            const auto append = [&](const ValueLayout& source) {
                std::vector<std::pair<std::string, ValueSlice>> children;
                for (const auto& [name, slice] : source.selectors) {
                    if (name.find('.') == std::string::npos) children.push_back({name, slice});
                }
                std::stable_sort(children.begin(), children.end(), [](const auto& a, const auto& b) {
                    return a.second.offset < b.second.offset;
                });
                for (const auto& [name, slice] : children) {
                    elements.push_back(record_field_layout(source, name, slice));
                }
            };
            append(left);
            append(right);
            return indexed_layout(elements);
        }
        if (left.kind == ValueKind::Aggregate || right.kind == ValueKind::Aggregate) {
            const std::string left_type = string_field(
                expression, "left_type", "environment binary");
            const std::string right_type = string_field(
                expression, "right_type", "environment binary");
            if (left.width > 1 && right.width > 1 &&
                left_type.rfind("axis<", 0) == 0 && right_type.rfind("axis<", 0) == 0 &&
                left_type.substr(5, left_type.find('>') - 5) !=
                    right_type.substr(5, right_type.find('>') - 5)) {
                return outer_product_layout(left, right);
            }
            return left.width > 1 ? left : right;
        }
        return {};
    }
    return layout_from_expression_shape(expression, signatures);
}

inline ValueLayout inferred_function_result_layout(
    const vf::JsonValue::Object& function,
    const FunctionSignature& signature,
    const FunctionSignatures& signatures
) {
    LayoutEnvironment environment;
    for (std::size_t index = 0;
         index < signature.parameter_names.size() && index < signature.parameters.size();
         ++index) {
        environment[signature.parameter_names[index]] = signature.parameters[index];
    }
    const auto& block = object_of(field(function, "body", "function"), "function body");
    const auto& body = array_of(field(block, "body", "function body"), "function body statements");
    for (const auto& value : body) {
        const auto& statement = object_of(value, "function result statement");
        const std::string kind = string_field(statement, "kind", "function result statement");
        if (kind == "store_binding") {
            const std::string name = string_field(statement, "name", "function binding");
            environment[name] = layout_from_environment_expression_shape(
                object_of(field(statement, "value", "function binding"), "function binding value"),
                environment,
                signatures);
        } else if (kind == "expr_stmt") {
            const auto& result = object_of(
                field(statement, "expr", "function result"), "function result expression");
            if (&value == &body.back()) {
                return layout_from_environment_expression_shape(result, environment, signatures);
            }
        } else if (kind == "return") {
            return layout_from_environment_expression_shape(
                object_of(field(statement, "value", "function return"), "function return value"),
                environment,
                signatures);
        }
    }
    return {};
}

inline void refine_environment_call_layouts(
    const vf::JsonValue& value,
    const LayoutEnvironment& environment,
    FunctionSignatures& signatures
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            refine_environment_call_layouts(item, environment, signatures);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "call") {
        const auto elementwise = object.find("elementwise_math");
        const auto structural = object.find("structural_call");
        const bool is_structural = structural != object.end() &&
            structural->second.is_boolean() && structural->second.as_boolean();
        if (is_structural) {
            const auto& callee = object_of(field(object, "callee", "structural call"), "callee");
            const auto& arguments = array_of(field(object, "args", "structural call"), "call args");
            if (string_field(callee, "kind", "structural callee") == "load" &&
                arguments.size() == 1 && arguments.front().is_object()) {
                const auto target = signatures.find(string_field(callee, "name", "structural callee"));
                if (target != signatures.end() && target->second.parameters.size() == 1) {
                    const auto argument_layout = layout_from_environment_expression_shape(
                        arguments.front().as_object(), environment, signatures);
                    const auto matches = resolve_structural_layout_matches(
                        argument_layout, structural_paths_from_call(object));
                    if (!matches.empty()) {
                        const bool result_tracks_parameter = same_layout(
                            target->second.result, target->second.parameters.front());
                        refine_parameter_from_argument(
                            target->second.parameters.front(), matches.front().layout);
                        if (result_tracks_parameter) {
                            target->second.result = target->second.parameters.front();
                        }
                    }
                }
            }
        }
        if ((elementwise != object.end() && elementwise->second.is_boolean() &&
             elementwise->second.as_boolean()) ||
            is_structural) {
            for (const auto& [name, child] : object) {
                if (name != "callee") refine_environment_call_layouts(child, environment, signatures);
            }
            return;
        }
        const auto& callee = object_of(field(object, "callee", "environment call"), "environment callee");
        if (string_field(callee, "kind", "environment callee") == "load") {
            const auto target = signatures.find(string_field(callee, "name", "environment callee"));
            if (target != signatures.end()) {
                const auto& arguments = array_of(field(object, "args", "environment call"), "call args");
                for (std::size_t index = 0;
                     index < arguments.size() && index < target->second.parameters.size();
                     ++index) {
                    if (!arguments[index].is_object() || index >= target->second.parameter_is_any.size() ||
                        !target->second.parameter_is_any[index]) continue;
                    const auto& argument = arguments[index].as_object();
                    const auto candidate = layout_from_environment_expression_shape(
                        argument, environment, signatures);
                    refine_parameter_from_argument(target->second.parameters[index], candidate);
                    if (string_field(argument, "kind", "environment call argument") == "call") {
                        const auto& inner_callee = object_of(
                            field(argument, "callee", "nested environment call"), "nested callee");
                        if (string_field(inner_callee, "kind", "nested callee") == "load") {
                            const auto inner = signatures.find(
                                string_field(inner_callee, "name", "nested callee"));
                            if (inner != signatures.end() && inner->second.result_is_any) {
                                merge_inferred_layout(
                                    inner->second.result, target->second.parameters[index]);
                            }
                        }
                    }
                }
            }
        }
    }
    for (const auto& [name, child] : object) {
        if (name != "callee") refine_environment_call_layouts(child, environment, signatures);
    }
}

struct ParameterOrigin {
    std::size_t parameter = 0;
    std::vector<std::string> path;
};

inline std::optional<ParameterOrigin> parameter_origin_of(
    const vf::JsonValue::Object& expression,
    const FunctionSignature& caller,
    const std::map<std::string, ParameterOrigin>& locals
) {
    const std::string kind = string_field(expression, "kind", "parameter origin");
    if (kind == "load") {
        const std::string name = string_field(expression, "name", "parameter origin");
        const auto local = locals.find(name);
        if (local != locals.end()) return local->second;
        const auto parameter = std::find(
            caller.parameter_names.begin(), caller.parameter_names.end(), name);
        if (parameter == caller.parameter_names.end()) return std::nullopt;
        return ParameterOrigin{
            static_cast<std::size_t>(parameter - caller.parameter_names.begin()), {}};
    }
    if (kind == "field_access") {
        auto origin = parameter_origin_of(
            object_of(field(expression, "object", "parameter field origin"), "field source"),
            caller,
            locals);
        if (!origin) return std::nullopt;
        origin->path.push_back(string_field(expression, "field", "parameter field origin"));
        return origin;
    }
    if (kind == "dotted_index") {
        auto origin = parameter_origin_of(
            object_of(field(expression, "base", "parameter index origin"), "index source"),
            caller,
            locals);
        if (!origin) return std::nullopt;
        for (const auto& value : array_of(
                 field(expression, "indices", "parameter index origin"), "index values")) {
            const auto& index = object_of(value, "parameter index origin");
            const auto index_kind = index.find("kind");
            const auto raw_value = index.find("value");
            if (index_kind == index.end() || !index_kind->second.is_string() ||
                index_kind->second.as_string() != "const" || raw_value == index.end()) {
                return std::nullopt;
            }
            const auto& raw = raw_value->second;
            if (!raw.is_number() || raw.as_number() < 0 ||
                raw.as_number() != static_cast<double>(static_cast<std::uint32_t>(raw.as_number()))) {
                return std::nullopt;
            }
            origin->path.push_back(std::to_string(static_cast<std::uint32_t>(raw.as_number())));
        }
        return origin;
    }
    return std::nullopt;
}

inline void assign_projection_layout(
    ValueLayout& root,
    const std::vector<std::string>& path,
    std::size_t index,
    const ValueLayout& candidate
) {
    if (index == path.size()) {
        merge_inferred_layout(root, candidate);
        return;
    }
    ValueLayout child;
    const auto existing = root.selectors.find(path[index]);
    if (existing != root.selectors.end()) {
        child = record_field_layout(root, path[index], existing->second);
    }
    assign_projection_layout(child, path, index + 1, candidate);
    assign_record_field_layout(root, path[index], child);
}

inline void refine_origin_call_layouts(
    const vf::JsonValue& value,
    const std::map<std::string, ParameterOrigin>& locals,
    FunctionSignature& caller,
    const FunctionSignatures& signatures
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            refine_origin_call_layouts(item, locals, caller, signatures);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "call") {
        const auto& callee = object_of(field(object, "callee", "origin call"), "origin callee");
        if (string_field(callee, "kind", "origin callee") == "load") {
            const auto target = signatures.find(string_field(callee, "name", "origin callee"));
            if (target != signatures.end()) {
                const auto& arguments = array_of(field(object, "args", "origin call"), "origin args");
                for (std::size_t index = 0;
                     index < arguments.size() && index < target->second.parameters.size();
                     ++index) {
                    if (!arguments[index].is_object()) continue;
                    const auto origin = parameter_origin_of(
                        arguments[index].as_object(), caller, locals);
                    if (!origin || origin->parameter >= caller.parameters.size() ||
                        origin->parameter >= caller.parameter_is_any.size() ||
                        !caller.parameter_is_any[origin->parameter]) continue;
                    assign_projection_layout(
                        caller.parameters[origin->parameter], origin->path, 0,
                        target->second.parameters[index]);
                }
            }
        }
    }
    for (const auto& [name, child] : object) {
        if (name != "callee") refine_origin_call_layouts(child, locals, caller, signatures);
    }
}

inline void refine_function_environment_layouts(
    const vf::JsonValue::Object& function,
    FunctionSignature& caller,
    FunctionSignatures& signatures
) {
    LayoutEnvironment environment;
    for (std::size_t index = 0;
         index < caller.parameter_names.size() && index < caller.parameters.size();
         ++index) {
        environment[caller.parameter_names[index]] = caller.parameters[index];
    }
    const auto& block = object_of(field(function, "body", "function"), "function body");
    const auto& body = array_of(field(block, "body", "function body"), "function statements");
    std::map<std::string, ParameterOrigin> origins;
    for (const auto& value : body) {
        const auto& statement = object_of(value, "function statement");
        refine_environment_call_layouts(value, environment, signatures);
        refine_origin_call_layouts(value, origins, caller, signatures);
        if (string_field(statement, "kind", "function statement") == "store_binding") {
            const std::string name = string_field(statement, "name", "function binding");
            const auto& binding_value = object_of(
                field(statement, "value", "function binding"), "function binding value");
            const auto origin = parameter_origin_of(binding_value, caller, origins);
            if (origin) origins[name] = *origin;
            else origins.erase(name);
            environment[name] = layout_from_environment_expression_shape(
                binding_value,
                environment,
                signatures);
        }
    }
}


struct InferredModuleLayouts {
    // Borrowed pointers remain valid only while the input typed IR is alive
    // and unmodified. Inference does not mutate that input.
    std::map<std::string, const vf::JsonValue::Object*> functions;
    FunctionSignatures signatures;
    std::vector<const vf::JsonValue::Object*> entry_statements;
};

inline InferredModuleLayouts infer_module_layouts(const vf::JsonValue& typed_ir) {
    const auto& module = object_of(typed_ir, "typed module");
    if (string_field(module, "kind", "typed module") != "typed_module") {
        throw LoweringFailure("unsupported typed IR root");
    }

    InferredModuleLayouts plan;
    auto& functions = plan.functions;
    auto& signatures = plan.signatures;
    auto& entry_statements = plan.entry_statements;
    const auto& module_body = array_of(field(module, "body", "typed module"), "typed module body");
    std::set<std::string> module_function_names;
    for (const auto& value : module_body) {
        const auto& statement = object_of(value, "top-level function scan");
        if (string_field(statement, "kind", "top-level function scan") == "function") {
            module_function_names.insert(string_field(statement, "name", "top-level function scan"));
        }
    }
    const auto has_linked_function = [&](const std::string& public_name) {
        return std::any_of(
            module_function_names.begin(), module_function_names.end(),
            [&](const std::string& name) {
                if (name == public_name) return true;
                const auto separator = name.rfind("__");
                return separator != std::string::npos &&
                    name.substr(separator + 2) == public_name;
            });
    };
    const bool linked_math_surface = has_linked_function("tan") &&
        has_linked_function("gamma") && has_linked_function("erf");
    const auto is_elementwise_math_function = [&](const std::string& name) {
        static const std::set<std::string> names{
            "tan", "sec", "cot", "csc", "sinh", "cosh", "tanh",
            "lg", "lg2", "asinh", "acosh", "atanh", "atan", "asin",
            "acos", "atan2", "acot", "asec", "acsc", "gamma", "erf", "log",
        };
        if (!linked_math_surface) return false;
        if (names.count(name)) return true;
        const auto separator = name.rfind("__");
        return separator != std::string::npos && names.count(name.substr(separator + 2));
    };
    for (const auto& value : module_body) {
        const auto& statement = object_of(value, "top-level type declaration");
        const std::string kind = string_field(statement, "kind", "top-level declaration");
        if (kind == "type_alias") {
            const auto& annotation = object_of(
                field(statement, "type_annotation", "type alias"), "type alias annotation");
            signatures.type_aliases[string_field(statement, "name", "type alias")] =
                string_field(annotation, "name", "type alias annotation");
        } else if (kind == "function") {
            const auto nominal = statement.find("nominal_type");
            const auto representation = statement.find("representation_type");
            if (nominal != statement.end() && nominal->second.is_string() &&
                representation != statement.end() && representation->second.is_string()) {
                signatures.type_aliases[nominal->second.as_string()] =
                    representation->second.as_string();
            }
        } else if (kind == "store_binding") {
            const auto& value_expression = object_of(
                field(statement, "value", "top-level binding"), "top-level binding value");
            if (string_field(value_expression, "kind", "top-level binding value") == "const") {
                signatures.module_literals[string_field(statement, "name", "top-level binding")] =
                    &value_expression;
            }
        }
    }
    for (const auto& value : module_body) {
        const auto& statement = object_of(value, "top-level statement");
        const std::string kind = string_field(statement, "kind", "top-level statement");
        if (kind == "function") {
            const std::string name = string_field(statement, "name", "function");
            const bool elementwise_math_function = is_elementwise_math_function(name);
            functions[name] = &statement;
            FunctionSignature signature;
            for (const auto& value : array_of(field(statement, "params", "function"), "function params")) {
                const auto& parameter = object_of(value, "param");
                signature.parameter_names.push_back(string_field(parameter, "name", "param"));
                const std::string parameter_type = string_field(parameter, "type", "param");
                const auto symbolic_vector_shape = [](const std::string& type) {
                    if (type.size() < 5 || type.front() != '[' || type.back() != ']') return false;
                    const auto separator = type.rfind(':');
                    if (separator == std::string::npos) return false;
                    const std::string shape = type.substr(separator + 1, type.size() - separator - 2);
                    return !shape.empty() && !std::all_of(
                        shape.begin(), shape.end(), [](unsigned char ch) { return std::isdigit(ch); });
                };
                const auto explicit_parameter_layout = layout_from_type(parameter_type, &signatures);
                const bool known_scalar_parameter = parameter_type == "num" || parameter_type == "int" ||
                    parameter_type == "f32" || parameter_type == "f64" || parameter_type == "bit" ||
                    parameter_type == "null" || parameter_type == "str";
                const bool known_aggregate_parameter = explicit_parameter_layout.kind != ValueKind::Numeric ||
                    !explicit_parameter_layout.selectors.empty();
                const bool contains_any_record_field =
                    is_record_layout(explicit_parameter_layout) && std::any_of(
                        explicit_parameter_layout.selectors.begin(),
                        explicit_parameter_layout.selectors.end(),
                        [](const auto& selector) { return selector.second.kind == ValueKind::Any; });
                const bool complex_capable_fixed_vector =
                    parameter_type.rfind("[num:", 0) == 0 && parameter_type.back() == ']';
                const bool inferred_parameter = !elementwise_math_function && (parameter_type == "any" ||
                    parameter_type == "num" ||
                    complex_capable_fixed_vector ||
                    symbolic_vector_shape(parameter_type) ||
                    explicit_parameter_layout.kind == ValueKind::StringMultiset ||
                    contains_any_record_field ||
                    (!known_scalar_parameter && !known_aggregate_parameter));
                signature.parameter_is_any.push_back(inferred_parameter);
                std::vector<std::string> full_projections;
                if (bool_field(parameter, "variadic_named", "param")) {
                    if (signature.variadic_named_index) {
                        throw LoweringFailure("direct machine IR supports one variadic named parameter");
                    }
                    signature.variadic_named_index = signature.parameters.size();
                    signature.parameters.push_back(
                        inferred_parameter_layout(
                            statement, signature.parameter_names.back(), &full_projections));
                } else if (bool_field(parameter, "variadic_positional", "param")) {
                    if (signature.variadic_positional_index) {
                        throw LoweringFailure("direct machine IR supports one variadic positional parameter");
                    }
                    if (parameter_type != "any" && parameter_type != "num" && parameter_type != "int" &&
                        parameter_type != "f32" && parameter_type != "f64") {
                        throw LoweringFailure("direct machine IR variadic positional parameters require numeric elements");
                    }
                    signature.variadic_positional_index = signature.parameters.size();
                    signature.parameters.push_back({1, ValueKind::DynamicF64List, {}});
                } else {
                    if (inferred_parameter &&
                        (complex_capable_fixed_vector || contains_any_record_field)) {
                        auto parameter_layout = explicit_parameter_layout;
                        const auto inferred_layout = inferred_parameter_layout(
                            statement, signature.parameter_names.back(), &full_projections);
                        if (!contains_any_record_field && !is_record_layout(inferred_layout)) {
                            merge_inferred_layout(parameter_layout, inferred_layout);
                        }
                        signature.parameters.push_back(std::move(parameter_layout));
                    } else {
                        signature.parameters.push_back(
                            inferred_parameter
                                ? inferred_parameter_layout(
                                    statement, signature.parameter_names.back(), &full_projections)
                                : explicit_parameter_layout);
                    }
                }
                std::sort(full_projections.begin(), full_projections.end());
                full_projections.erase(
                    std::unique(full_projections.begin(), full_projections.end()),
                    full_projections.end());
                signature.parameter_full_projections.push_back(std::move(full_projections));
                if (bool_field(parameter, "variadic_named", "param")) {
                    auto display = display_shape_from_layout(signature.parameters.back());
                    display.kind = DisplayKind::Record;
                    signature.parameter_displays.push_back(std::move(display));
                } else if (bool_field(parameter, "variadic_positional", "param")) {
                    signature.parameter_displays.push_back({DisplayKind::Vector, {}});
                } else {
                    signature.parameter_displays.push_back(display_shape_from_type(parameter_type));
                }
                const auto& default_value = field(parameter, "default", "param");
                signature.parameter_defaults.push_back(
                    default_value.is_null() ? nullptr : &default_value);
            }
            const std::string return_type = string_field(statement, "return_type", "function");
            const auto representation = statement.find("representation_type");
            const std::string representation_type =
                representation != statement.end() && representation->second.is_string()
                ? representation->second.as_string() : return_type;
            signature.result = layout_from_type(representation_type, &signatures);
            signature.result_display = display_shape_from_type(representation_type);
            signature.result_is_any = representation_type == "any" ||
                representation_type == "num" ||
                (representation_type.rfind("[num:", 0) == 0 && representation_type.back() == ']') ||
                signature.result.kind == ValueKind::StringMultiset ||
                (representation_type.size() >= 5 && representation_type.front() == '[' &&
                 representation_type.back() == ']' &&
                 representation_type.rfind(':') != std::string::npos &&
                 !std::all_of(
                    representation_type.begin() + static_cast<std::ptrdiff_t>(
                        representation_type.rfind(':') + 1),
                    representation_type.end() - 1,
                    [](unsigned char ch) { return std::isdigit(ch); }));
            signature.result_is_any = signature.result_is_any || std::any_of(
                signature.result.selectors.begin(), signature.result.selectors.end(),
                [](const auto& selector) { return selector.second.kind == ValueKind::Any; });
            const auto contains_dynamic_any = [](const auto& self,
                                                 const ValueLayout& layout) -> bool {
                if (layout.kind == ValueKind::Any) return true;
                if (layout.dynamic_element && self(self, *layout.dynamic_element)) return true;
                return std::any_of(
                    layout.selectors.begin(), layout.selectors.end(),
                    [&](const auto& selector) {
                        return selector.second.kind == ValueKind::Any ||
                            (selector.second.dynamic_element &&
                             self(self, *selector.second.dynamic_element));
                    });
            };
            signature.result_is_any = signature.result_is_any ||
                contains_dynamic_any(contains_dynamic_any, signature.result);
            if (elementwise_math_function) signature.result_is_any = false;
            signatures[name] = std::move(signature);
        }
        else if (kind == "store_binding" || kind == "update_attr" ||
                 kind == "update_index" || kind == "expr_stmt" || kind == "label_print") {
            entry_statements.push_back(&statement);
        }
        else if (kind != "type_alias" && kind != "module_import") {
            throw LoweringFailure("machine IR does not support top-level " + kind);
        }
    }
    for (const auto& value : module_body) {
        const auto& statement = object_of(value, "top-level layout declaration");
        if (string_field(statement, "kind", "top-level layout declaration") != "store_binding") {
            continue;
        }
        const std::string name = string_field(statement, "name", "top-level layout binding");
        const auto& expression = object_of(
            field(statement, "value", "top-level layout binding"), "top-level layout value");
        signatures.module_layouts[name] = layout_from_expression_shape(expression, signatures);
    }
    bool layouts_converged = false;
    for (unsigned pass = 0; pass < 64; ++pass) {
        // Result layouts can grow during inference. Refresh top-level bindings
        // before refining call sites so `any` parameters receive the current
        // heterogeneous aggregate shape instead of a cached scalar placeholder.
        for (const auto& value : module_body) {
            const auto& statement = object_of(value, "top-level layout declaration");
            if (string_field(statement, "kind", "top-level layout declaration") != "store_binding") {
                continue;
            }
            const std::string name = string_field(statement, "name", "top-level layout binding");
            const auto& expression = object_of(
                field(statement, "value", "top-level layout binding"), "top-level layout value");
            signatures.module_layouts[name] = layout_from_expression_shape(expression, signatures);
        }
        const auto before = signatures;
        for (const auto& [name, function] : functions) {
            refine_forwarded_parameter_layouts(
                field(*function, "body", "function"), signatures[name], signatures);
        }
        refine_callsite_parameter_layouts(typed_ir, signatures, true);
        for (const auto& [name, function] : functions) {
            refine_function_environment_layouts(
                *function, signatures[name], signatures);
        }
        for (const auto& [name, function] : functions) {
            if (signatures[name].result_is_any) {
                const auto candidate = inferred_function_result_layout(
                    *function, signatures[name], signatures);
                merge_inferred_layout(signatures[name].result, candidate);
                refine_returned_parameter_layout(*function, signatures[name], signatures);
            }
        }
        if (same_signature_layouts(before, signatures)) {
            layouts_converged = true;
            break;
        }
    }
    if (!layouts_converged) throw LoweringFailure("machine IR layout inference did not converge");
    for (auto& [name, signature] : signatures) {
        const auto separator = name.rfind("__");
        const std::string base_name = separator == std::string::npos
            ? name : name.substr(separator + 2);
        if ((base_name == "normalize" || base_name == "zscore") &&
            signature.parameters.size() == 1) {
            signature.result = signature.parameters.front();
            signature.result_display = signature.parameter_displays.front();
            signature.result_is_any = false;
        }
    }
    for (auto& [name, signature] : signatures) {
        (void)name;
        const auto contains_complex_layout = [](const ValueLayout& layout) {
            return layout.kind == ValueKind::Complex || std::any_of(
                layout.selectors.begin(), layout.selectors.end(), [](const auto& child) {
                    return child.second.kind == detail::ValueKind::Complex;
                });
        };
        for (std::size_t index = 0; index < signature.parameters.size() &&
             index < signature.parameter_displays.size(); ++index) {
            if (signature.parameters[index].kind == ValueKind::Complex) {
                signature.parameter_displays[index] = {DisplayKind::Complex, {}};
            } else if (contains_complex_layout(signature.parameters[index])) {
                auto refreshed = display_shape_from_layout(signature.parameters[index]);
                refreshed.kind = signature.parameter_displays[index].kind;
                refreshed.label = signature.parameter_displays[index].label;
                signature.parameter_displays[index] = std::move(refreshed);
            }
        }
        if (signature.result.kind == ValueKind::Complex) {
            signature.result_display = {DisplayKind::Complex, {}};
        } else if (contains_complex_layout(signature.result)) {
            auto refreshed = display_shape_from_layout(signature.result);
            refreshed.kind = signature.result_display.kind;
            refreshed.label = signature.result_display.label;
            signature.result_display = std::move(refreshed);
        }
    }


    return plan;
}
} // namespace detail
} // namespace vkf::machine_ir

namespace vkf::value_layout {
using machine_ir::detail::ValueKind;
using machine_ir::detail::ValueLayout;
using machine_ir::detail::ValueSlice;
using machine_ir::detail::FunctionSignatures;
using machine_ir::detail::InferredModuleLayouts;
using machine_ir::detail::infer_module_layouts;
} // namespace vkf::value_layout
