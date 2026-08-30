#pragma once

#include "compiler/native/vkf_machine_ir.hpp"
#include "compiler/native/vkf_capture_pattern.hpp"
#include "compiler/native/vkf_symbolic_value_encoding.hpp"
#include "native/VfOverlay/vf/json.hpp"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>

#if defined(_WIN32) && defined(_MSC_VER)
#pragma comment(linker, "/STACK:8388608")
#endif

namespace vkf::machine_ir {

class LoweringFailure : public std::runtime_error {
public:
    explicit LoweringFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
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

enum class ValueKind : std::uint8_t {
    Numeric,
    Complex,
    Null,
    String,
    Aggregate,
    DynamicF64List,
    NumericMultiset,
    StringMultiset,
    Range,
};

struct ValueSlice {
    std::uint32_t offset = 0;
    std::uint32_t width = 1;
    ValueKind kind = ValueKind::Numeric;
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
};

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

inline void append_display_tokens(
    const DisplayShape& shape,
    std::vector<OutputToken>& tokens
) {
    const auto text = [&](std::string value) {
        tokens.push_back({OutputTokenKind::Text, std::move(value)});
    };
    if (shape.kind == DisplayKind::F64) {
        tokens.push_back({OutputTokenKind::F64, {}});
        return;
    }
    if (shape.kind == DisplayKind::Complex) {
        tokens.push_back({OutputTokenKind::F64, {}});
        tokens.push_back({OutputTokenKind::F64, {}});
        return;
    }
    if (shape.kind == DisplayKind::String) {
        tokens.push_back({OutputTokenKind::String, {}});
        return;
    }
    if (shape.kind == DisplayKind::Chr) {
        tokens.push_back({OutputTokenKind::F64, {}});
        return;
    }
    if (shape.kind == DisplayKind::Bit) {
        tokens.push_back({OutputTokenKind::Bit, {}});
        return;
    }
    if (shape.kind == DisplayKind::Null) {
        tokens.push_back({OutputTokenKind::Null, {}});
        return;
    }
    if (shape.kind == DisplayKind::Range) {
        tokens.push_back({OutputTokenKind::F64, {}});
        tokens.push_back({OutputTokenKind::Null, {}});
        tokens.push_back({OutputTokenKind::Bit, {}});
        return;
    }
    if (shape.kind == DisplayKind::Record && !shape.label.empty()) text(shape.label);
    text(shape.kind == DisplayKind::Vector ? "[" : "(");
    for (std::size_t index = 0; index < shape.children.size(); ++index) {
        if (index != 0) text(", ");
        if (shape.kind == DisplayKind::Record) text(shape.children[index].first + ":");
        append_display_tokens(shape.children[index].second, tokens);
    }
    text(shape.kind == DisplayKind::Vector ? "]" : ")");
}

inline bool same_layout(const ValueLayout& left, const ValueLayout& right) {
    if (left.width != right.width || left.kind != right.kind ||
        left.selectors.size() != right.selectors.size()) return false;
    if (left.selectors.shares_storage(right.selectors)) return true;
    auto left_field = left.selectors.begin();
    auto right_field = right.selectors.begin();
    for (; left_field != left.selectors.end(); ++left_field, ++right_field) {
        if (left_field->first != right_field->first ||
            left_field->second.offset != right_field->second.offset ||
            left_field->second.width != right_field->second.width ||
            left_field->second.kind != right_field->second.kind) return false;
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

class StringPool {
public:
    std::uint32_t intern(const std::string& value) {
        const auto found = offsets_.find(value);
        if (found != offsets_.end()) return found->second;
        const auto offset = static_cast<std::uint32_t>(bytes.size());
        bytes.insert(bytes.end(), value.begin(), value.end());
        offsets_[value] = offset;
        return offset;
    }

    std::uint32_t intern_f64s(const std::vector<double>& values) {
        while (bytes.size() % alignof(double) != 0) bytes.push_back(0);
        if (bytes.size() > UINT32_MAX) throw LoweringFailure("machine IR literal pool is too large");
        const auto offset = static_cast<std::uint32_t>(bytes.size());
        for (const auto value : values) {
            std::uint64_t bits = 0;
            std::memcpy(&bits, &value, sizeof(bits));
            for (unsigned byte = 0; byte < sizeof(bits); ++byte) {
                bytes.push_back(static_cast<std::uint8_t>(bits >> (byte * 8)));
            }
        }
        return offset;
    }

    std::vector<std::uint8_t> bytes;

private:
    std::map<std::string, std::uint32_t> offsets_;
};

struct FunctionSignature {
    std::vector<std::string> parameter_names;
    std::vector<ValueLayout> parameters;
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
        for (std::size_t index = 0; index < signature.parameters.size(); ++index) {
            if (!same_layout(signature.parameters[index], found->second.parameters[index])) return false;
        }
        if (!same_layout(signature.result, found->second.result)) return false;
    }
    return true;
}

inline ValueLayout indexed_layout(const std::vector<ValueLayout>& elements);
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
    const std::string prefix = name + ".";
    for (const auto& [child, nested] : record.selectors) {
        if (child.rfind(prefix, 0) != 0) continue;
        result.selectors[child.substr(prefix.size())] = {
            nested.offset - slice.offset, nested.width, nested.kind
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
        record.selectors[field_name] = {record.width, layout.width, layout.kind};
        for (const auto& [child, slice] : layout.selectors) {
            record.selectors[field_name + "." + child] = {
                record.width + slice.offset, slice.width, slice.kind
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

inline void merge_inferred_layout(ValueLayout& current, const ValueLayout& candidate) {
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
        merge_inferred_layout(
            field_layout, record_field_layout(candidate, name, supplied->second));
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
    const std::string& parameter
) {
    struct ProjectionNode {
        std::map<std::string, ProjectionNode> children;
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
    const auto collect = [&](const auto& self, const vf::JsonValue& value) -> void {
        if (value.is_array()) {
            for (const auto& item : value.as_array()) self(self, item);
            return;
        }
        if (!value.is_object()) return;
        std::vector<std::string> path;
        if (projection_path(projection_path, value.as_object(), path) && !path.empty()) {
            found = true;
            ProjectionNode* node = &root;
            for (const auto& component : path) node = &node->children[component];
        }
        for (const auto& [name, child] : value.as_object()) {
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
        const bool indexed = !node.children.empty() &&
            std::all_of(node.children.begin(), node.children.end(), [&](const auto& child) {
                return numeric_name(child.first);
            });
        if (indexed) {
            std::uint32_t maximum = 0;
            for (const auto& [name, child] : node.children) {
                (void)child;
                maximum = std::max(maximum, static_cast<std::uint32_t>(std::stoul(name)));
            }
            std::vector<ValueLayout> elements(maximum + 1);
            for (const auto& [name, child] : node.children) {
                if (!child.children.empty()) {
                    elements[static_cast<std::size_t>(std::stoul(name))] = self(self, child);
                }
            }
            return indexed_layout(elements);
        }
        ValueLayout record{0, ValueKind::Aggregate, {}};
        for (const auto& [name, child] : node.children) {
            assign_record_field_layout(
                record, name, child.children.empty() ? ValueLayout{} : self(self, child));
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

inline void refine_callsite_parameter_layouts(
    const vf::JsonValue& value,
    FunctionSignatures& signatures
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            refine_callsite_parameter_layouts(item, signatures);
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
                refine_callsite_parameter_layouts(child, signatures);
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
                        const auto candidate = layout_from_expression_shape(
                            argument, signatures);
                        auto& current = signature->second.parameters[index];
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
    for (const auto& [name, child] : object) {
        (void)name;
        refine_callsite_parameter_layouts(child, signatures);
    }
}

inline void refine_forwarded_parameter_layouts(
    const vf::JsonValue& value,
    FunctionSignature& caller,
    const FunctionSignatures& signatures
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
                const auto target = signatures.find(callee_name->second.as_string());
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
                        const auto& candidate = target->second.parameters[argument_index];
                        auto& current = caller.parameters[parameter_index];
                        if (!forwarded_field.empty()) {
                            assign_record_field_layout(current, forwarded_field, candidate);
                        } else {
                            merge_inferred_layout(current, candidate);
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

inline void collect_error_effects(
    const vf::JsonValue& value,
    bool& directly_raises,
    std::vector<std::string>& callees
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            collect_error_effects(item, directly_raises, callees);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string()) {
        if (kind->second.as_string() == "assert_expr" ||
            kind->second.as_string() == "raise_expr" ||
            kind->second.as_string() == "dotted_index" ||
            kind->second.as_string() == "update_index") {
            directly_raises = true;
        }
        if (kind->second.as_string() == "call") {
            const auto callee = object.find("callee");
            if (callee != object.end() && callee->second.is_object()) {
                const auto& callee_object = callee->second.as_object();
                const auto callee_kind = callee_object.find("kind");
                const auto callee_name = callee_object.find("name");
                if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                    callee_kind->second.as_string() == "load" &&
                    callee_name != callee_object.end() && callee_name->second.is_string()) {
                    if (callee_name->second.as_string() == "int") directly_raises = true;
                    callees.push_back(callee_name->second.as_string());
                } else if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                           callee_kind->second.as_string() == "stdlib_function") {
                    const auto module = callee_object.find("module");
                    if (module != callee_object.end() && module->second.is_string() &&
                        module->second.as_string() == "io" &&
                        callee_name != callee_object.end() && callee_name->second.is_string()) {
                        const std::string name = callee_name->second.as_string();
                        if (name == "read_text" || name == "read_bytes" ||
                            name == "write_text" || name == "write_bytes" ||
                            name == "append_text") {
                            directly_raises = true;
                        }
                    } else if (module != callee_object.end() && module->second.is_string() &&
                               module->second.as_string() == "regex" &&
                               callee_name != callee_object.end() &&
                               callee_name->second.is_string()) {
                        const std::string name = callee_name->second.as_string();
                        if (name == "match" || name == "groups") directly_raises = true;
                    }
                }
            }
        } else if (kind->second.as_string() == "binary_op") {
            const auto op = object.find("op");
            if (op != object.end() && op->second.is_string()) {
                const std::string token = op->second.as_string();
                const std::string overload = token == "PLUS" ? "+" : token == "MINUS" ? "-"
                    : token == "STAR" ? "*" : token == "SLASH" ? "/"
                    : token == "FLOORDIV" ? "//" : token == "PERCENT" ? "%"
                    : token == "CARET" ? "^" : token == "AMPERSAND" ? "&" : "";
                if (!overload.empty()) callees.push_back(overload);
            }
        } else if (kind->second.as_string() == "unary_op") {
            const auto op = object.find("op");
            if (op != object.end() && op->second.is_string()) {
                const std::string token = op->second.as_string();
                const std::string overload = token == "MINUS" ? "-"
                    : token == "NOT" ? "~" : "";
                if (!overload.empty()) callees.push_back(overload);
            }
        }
    }
    for (const auto& [name, child] : object) {
        if (name != "callee" || !child.is_object()) {
            collect_error_effects(child, directly_raises, callees);
        }
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
        layout.selectors[key] = {layout.width, elements[index].width, elements[index].kind};
        for (const auto& [child, slice] : elements[index].selectors) {
            layout.selectors[key + "." + child] = {
                layout.width + slice.offset, slice.width, slice.kind
            };
        }
        layout.width += elements[index].width;
    }
    return layout;
}

struct FixedNumericVectorShape {
    std::vector<std::size_t> dimensions;
};

inline std::optional<FixedNumericVectorShape> fixed_numeric_vector_shape(std::string type) {
    FixedNumericVectorShape result;
    type = trim(type);
    while (type.size() >= 3 && type.front() == '[' && type.back() == ']') {
        const std::string inside = type.substr(1, type.size() - 2);
        const auto colon = find_top_level(inside, ':');
        if (colon == std::string::npos) return std::nullopt;
        const std::string count_text = trim(inside.substr(colon + 1));
        if (count_text.empty() ||
            !std::all_of(count_text.begin(), count_text.end(), [](unsigned char ch) {
                return std::isdigit(ch);
            })) {
            return std::nullopt;
        }
        result.dimensions.push_back(static_cast<std::size_t>(std::stoull(count_text)));
        type = trim(inside.substr(0, colon));
    }
    if (result.dimensions.empty() ||
        (type != "int" && type != "num" && type != "f32" && type != "f64")) {
        return std::nullopt;
    }
    return result;
}

inline std::vector<std::size_t> constant_stat_sum_axes(
    const vf::JsonValue::Array& named_args,
    std::size_t rank
) {
    if (named_args.size() != 1) {
        throw LoweringFailure("stat.sum accepts only one named argument: axis");
    }
    const auto& named = object_of(named_args.front(), "stat.sum axis");
    if (string_field(named, "name", "stat.sum axis") != "axis") {
        throw LoweringFailure("unknown named argument for stat.sum");
    }
    const auto& value = object_of(field(named, "value", "stat.sum axis"), "stat.sum axis value");
    std::vector<std::int64_t> raw_axes;
    const auto append = [&](const vf::JsonValue::Object& axis) {
        const auto& raw = field(axis, "value", "stat.sum axis value");
        if (string_field(axis, "kind", "stat.sum axis value") != "const" ||
            !raw.is_number() || !std::isfinite(raw.as_number()) ||
            std::floor(raw.as_number()) != raw.as_number()) {
            throw LoweringFailure("stat.sum axis must be a constant integer or tuple of integers");
        }
        raw_axes.push_back(static_cast<std::int64_t>(raw.as_number()));
    };
    if (string_field(value, "kind", "stat.sum axis value") == "tuple") {
        const auto& items = array_of(field(value, "items", "stat.sum axis tuple"), "stat.sum axis tuple");
        if (items.empty()) throw LoweringFailure("stat.sum axis tuple must not be empty");
        for (const auto& item : items) append(object_of(item, "stat.sum axis tuple item"));
    } else {
        append(value);
    }

    std::vector<std::size_t> axes;
    for (auto axis : raw_axes) {
        if (axis < 0) axis += static_cast<std::int64_t>(rank);
        if (axis < 0 || axis >= static_cast<std::int64_t>(rank)) {
            throw LoweringFailure("stat.sum axis is out of range for rank " + std::to_string(rank));
        }
        const auto normalized = static_cast<std::size_t>(axis);
        if (std::find(axes.begin(), axes.end(), normalized) != axes.end()) {
            throw LoweringFailure("stat.sum axis tuple contains a duplicate axis");
        }
        axes.push_back(normalized);
    }
    std::sort(axes.begin(), axes.end());
    return axes;
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
            std::string resolved = trim(alias->second);
            if (resolved.size() >= 2 && resolved.front() == '(' && resolved.back() == ')') {
                resolved = "record{" + resolved.substr(1, resolved.size() - 2) + "}";
            }
            return layout_from_type(resolved, signatures);
        }
    }
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
        if (inside == "num" || inside == "int" || inside == "f32" || inside == "f64") {
            return {1, ValueKind::DynamicF64List, {}};
        }
    }
    if (type.rfind("list<", 0) == 0 && type.back() == '>') {
        const std::string element = trim(type.substr(5, type.size() - 6));
        if (element == "num" || element == "int" || element == "f32" || element == "f64") {
            return {1, ValueKind::DynamicF64List, {}};
        }
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
            layout.selectors[field_name] = {layout.width, field_layout.width, field_layout.kind};
            for (const auto& [child, slice] : field_layout.selectors) {
                layout.selectors[field_name + "." + child] = {
                    layout.width + slice.offset, slice.width, slice.kind
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
            source = source.children[position].second;
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
            if (is_explicit_dynamic_f64_list_type(type->second.as_string()) ||
                (type->second.as_string() == "list<any>" &&
                 array_of(field(expression, "items", "list"), "list items").empty())) {
                return {1, ValueKind::DynamicF64List, {}};
            }
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
                layout.width, value_layout.width, value_layout.kind
            };
            const std::string field_name = string_field(record_field, "name", "record field");
            for (const auto& [child, slice] : value_layout.selectors) {
                layout.selectors[field_name + "." + child] = {
                    layout.width + slice.offset, slice.width, slice.kind
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
                        result.width, field_layout.width, field_layout.kind
                    };
                    for (const auto& [child, slice] : field_layout.selectors) {
                        result.selectors[name + "." + child] = {
                            result.width + slice.offset, slice.width, slice.kind
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
        const auto source = layout_from_expression_shape(
            object_of(field(expression, "source", "pipe expression"), "pipe source"),
            signatures);
        const auto declared = expression.find("type");
        if (declared != expression.end() && declared->second.is_string()) {
            const auto result = layout_from_type(declared->second.as_string(), &signatures);
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
        const auto left = layout_from_expression_shape(
            object_of(field(expression, "left", "binary expression"), "binary left"), signatures);
        const auto right = layout_from_expression_shape(
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
            return {1, ValueKind::DynamicF64List, {}};
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
            if (indices.size() <= 1) return {};
            return indexed_layout(std::vector<ValueLayout>(indices.size(), ValueLayout{}));
        }
        std::size_t expanded_index_count = indices.size();
        const auto expanded_count = expression.find("expanded_index_count");
        if (expanded_count != expression.end() && expanded_count->second.is_number()) {
            expanded_index_count = static_cast<std::size_t>(expanded_count->second.as_number());
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
        if (kind == "list" && declared != expression.end() && declared->second.is_string() &&
            (is_explicit_dynamic_f64_list_type(declared->second.as_string()) ||
             (declared->second.as_string() == "list<any>" &&
              array_of(field(expression, "items", "list"), "list items").empty()))) {
            return {1, ValueKind::DynamicF64List, {}};
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
            return {1, ValueKind::DynamicF64List, {}};
        }
        if (op == "AMPERSAND" &&
            ((left.kind == ValueKind::DynamicF64List && right.kind == ValueKind::Aggregate) ||
             (right.kind == ValueKind::DynamicF64List && left.kind == ValueKind::Aggregate))) {
            return {1, ValueKind::DynamicF64List, {}};
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

inline ValueClass scalar_value_class_from_type(
    const std::string& type,
    const ValueLayout& layout
) {
    if (layout.width != 1 || layout.kind != ValueKind::Numeric) return ValueClass::F64;
    if (type == "int") return ValueClass::I64;
    if (type == "bit") return ValueClass::Bool;
    return ValueClass::F64;
}

class FunctionBuilder {
public:
    struct ScopeLocal {
        std::uint32_t base = 0;
        ValueLayout layout;
    };

    struct BlockReturn {
        std::uint32_t label = 0;
        std::uint32_t result = 0;
        ValueLayout layout;
    };

    explicit FunctionBuilder(std::string name, bool may_error = false) {
        function_.name = std::move(name);
        function_.may_error = may_error;
    }

    std::uint32_t add_parameter(
        const std::string& name,
        const ValueLayout& layout = {},
        ValueClass value_class = ValueClass::F64
    ) {
        const auto base = add_local(name, layout, false, value_class);
        for (std::uint32_t index = 0; index < layout.width; ++index) {
            function_.parameters.push_back(component_name(name, index, layout.width));
            function_.parameter_is_numeric_scalar.push_back(
                layout.width == 1 && layout.kind == ValueKind::Numeric);
        }
        return base;
    }

    void set_result_layout(const ValueLayout& layout) {
        function_.result_is_numeric_scalar =
            layout.width == 1 && layout.kind == ValueKind::Numeric;
        function_.result_is_dynamic_f64_list =
            layout.width == 1 && layout.kind == ValueKind::DynamicF64List;
    }

    std::uint32_t add_local(
        const std::string& name,
        const ValueLayout& requested_layout = {},
        bool owned = true,
        ValueClass value_class = ValueClass::F64
    ) {
        ValueLayout layout = requested_layout;
        const auto extensions = pending_record_fields_.find(name);
        if (extensions != pending_record_fields_.end()) {
            for (const auto& [field_name, field_layout] : extensions->second) {
                assign_record_field_layout(layout, field_name, field_layout);
            }
        }
        const auto found = bindings_.find(name);
        if (found != bindings_.end()) {
            if (found->second.layout.width != layout.width) {
                throw LoweringFailure(
                    "incompatible aggregate width for binding " + name + ": " +
                    std::to_string(found->second.layout.width) + " vs " +
                    std::to_string(layout.width));
            }
            for (std::uint32_t index = 0; index < layout.width; ++index) {
                auto& current = function_.local_classes.at(found->second.base + index);
                if (current != value_class) current = ValueClass::F64;
            }
            return found->second.base;
        }
        const auto slot = static_cast<std::uint32_t>(function_.locals.size());
        for (std::uint32_t index = 0; index < layout.width; ++index) {
            function_.locals.push_back(component_name(name, index, layout.width));
            function_.local_classes.push_back(value_class);
        }
        bindings_[name] = {slot, layout};
        if (owned) {
            for (const auto& resource : owned_resource_slices(layout)) {
                if (is_f64_heap_resource_kind(resource.kind)) {
                    function_.owned_f64_list_locals.push_back(slot + resource.offset);
                } else if (resource.kind == ValueKind::String) {
                    function_.owned_string_locals.push_back(slot + resource.offset);
                }
            }
        }
        return slot;
    }

    void declare_record_field(
        const std::string& binding,
        const std::string& field_name,
        const ValueLayout& field_layout
    ) {
        pending_record_fields_[binding][field_name] = field_layout;
    }

    void begin_scope() { scopes_.emplace_back(); }

    std::uint32_t add_scoped_local(
        const std::string& name,
        const ValueLayout& layout = {},
        bool owned = true,
        ValueClass value_class = ValueClass::F64
    ) {
        if (scopes_.empty()) throw LoweringFailure("machine IR scoped local needs an active scope");
        auto& scope = scopes_.back();
        const auto declared = std::find_if(scope.begin(), scope.end(), [&](const ScopeEntry& entry) {
            return entry.name == name;
        });
        if (declared != scope.end()) {
            if (declared->local.layout.width != layout.width) {
                throw LoweringFailure("incompatible aggregate width for scoped binding " + name);
            }
            return declared->local.base;
        }
        ScopeEntry entry;
        entry.name = name;
        const auto previous = bindings_.find(name);
        if (previous != bindings_.end()) entry.previous = previous->second;
        entry.local.base = append_local(name, layout, owned, value_class);
        entry.local.layout = layout;
        bindings_[name] = {entry.local.base, layout};
        scope.push_back(std::move(entry));
        return scope.back().local.base;
    }

    void add_scoped_alias(
        const std::string& name,
        std::uint32_t base,
        const ValueLayout& layout = {}
    ) {
        if (scopes_.empty()) throw LoweringFailure("machine IR scoped alias needs an active scope");
        auto& scope = scopes_.back();
        if (std::any_of(scope.begin(), scope.end(), [&](const ScopeEntry& entry) {
                return entry.name == name;
            })) {
            throw LoweringFailure("duplicate machine IR scoped alias " + name);
        }
        ScopeEntry entry;
        entry.name = name;
        const auto previous = bindings_.find(name);
        if (previous != bindings_.end()) entry.previous = previous->second;
        entry.local.base = base;
        entry.local.layout = layout;
        entry.alias = true;
        bindings_[name] = {base, layout};
        scope.push_back(std::move(entry));
    }

    std::vector<ScopeLocal> end_scope() {
        if (scopes_.empty()) throw LoweringFailure("machine IR scope stack underflow");
        auto scope = std::move(scopes_.back());
        scopes_.pop_back();
        std::vector<ScopeLocal> locals;
        locals.reserve(scope.size());
        for (auto iterator = scope.rbegin(); iterator != scope.rend(); ++iterator) {
            if (!iterator->alias) locals.push_back(iterator->local);
            if (iterator->previous) bindings_[iterator->name] = *iterator->previous;
            else bindings_.erase(iterator->name);
        }
        return locals;
    }

    std::uint32_t slot(const std::string& name, std::uint32_t component = 0) const {
        const auto found = bindings_.find(name);
        if (found == bindings_.end()) throw LoweringFailure("unknown binding " + name);
        if (component >= found->second.layout.width) throw LoweringFailure("binding component out of range");
        return found->second.base + component;
    }

    const ValueLayout& layout(const std::string& name) const {
        const auto found = bindings_.find(name);
        if (found == bindings_.end()) throw LoweringFailure("unknown binding " + name);
        return found->second.layout;
    }

    const ValueLayout* find_layout(const std::string& name) const {
        const auto found = bindings_.find(name);
        return found == bindings_.end() ? nullptr : &found->second.layout;
    }

    void detach_alias(const std::string& name) {
        const auto found = aliases_.find(name);
        if (found == aliases_.end()) return;
        for (const auto& other : found->second) aliases_[other].erase(name);
        aliases_.erase(name);
    }

    void link_alias(const std::string& left, const std::string& right) {
        if (left == right) return;
        detach_alias(left);
        aliases_[left].insert(right);
        aliases_[right].insert(left);
    }

    std::vector<std::string> alias_group(const std::string& name) const {
        std::vector<std::string> pending{name};
        std::set<std::string> visited;
        while (!pending.empty()) {
            const std::string current = std::move(pending.back());
            pending.pop_back();
            if (!visited.insert(current).second) continue;
            const auto found = aliases_.find(current);
            if (found != aliases_.end()) {
                pending.insert(pending.end(), found->second.begin(), found->second.end());
            }
        }
        return {visited.begin(), visited.end()};
    }

    const std::vector<std::uint32_t>& owned_f64_list_locals() const {
        return function_.owned_f64_list_locals;
    }

    const std::vector<std::uint32_t>& owned_string_locals() const {
        return function_.owned_string_locals;
    }

    std::uint32_t next_label() { return next_label_++; }

    void push_loop(std::uint32_t continue_label, std::uint32_t break_label) {
        loops_.push_back({continue_label, break_label});
    }

    void pop_loop() {
        if (loops_.empty()) throw LoweringFailure("machine IR loop stack underflow");
        loops_.pop_back();
    }

    std::uint32_t continue_label() const {
        if (loops_.empty()) throw LoweringFailure("continue outside loop");
        return loops_.back().first;
    }

    std::uint32_t break_label() const {
        if (loops_.empty()) throw LoweringFailure("break outside loop");
        return loops_.back().second;
    }

    void push_block_return(std::uint32_t label, std::uint32_t result, ValueLayout layout) {
        block_returns_.push_back({label, result, std::move(layout)});
    }

    void pop_block_return() {
        if (block_returns_.empty()) throw LoweringFailure("machine IR block-return stack underflow");
        block_returns_.pop_back();
    }

    const BlockReturn* block_return() const {
        return block_returns_.empty() ? nullptr : &block_returns_.back();
    }

    std::optional<std::uint32_t> error_handler() const { return error_handler_; }
    std::optional<std::uint32_t> error_value_local() const { return error_value_local_; }
    std::optional<std::uint32_t> error_type_local() const { return error_type_local_; }
    void set_error_handler(
        std::optional<std::uint32_t> label,
        std::optional<std::uint32_t> value_local = std::nullopt,
        std::optional<std::uint32_t> type_local = std::nullopt
    ) {
        error_handler_ = label;
        error_value_local_ = value_local;
        error_type_local_ = type_local;
    }

    std::uint32_t add_owned_temporary(const ValueLayout& layout) {
        return add_local("$owned_tmp_" + std::to_string(next_owned_temporary_++), layout, true);
    }

    std::uint32_t add_borrowed_temporary(
        const ValueLayout& layout,
        ValueClass value_class = ValueClass::F64
    ) {
        return add_local(
            "$borrowed_tmp_" + std::to_string(next_borrowed_temporary_++),
            layout, false, value_class);
    }

    std::pair<std::uint32_t, bool> flattened_index_local(
        std::uint32_t source,
        std::uint32_t width
    ) {
        const auto key = std::make_pair(source, width);
        const auto found = flattened_index_locals_.find(key);
        if (found != flattened_index_locals_.end()) {
            return {found->second, false};
        }
        const auto local = add_borrowed_temporary({}, ValueClass::I64);
        flattened_index_locals_.emplace(key, local);
        return {local, true};
    }

    void reset_flattened_index_cache() {
        flattened_index_locals_.clear();
        component_scalar_locals_.clear();
    }

    std::pair<std::uint32_t, bool> component_scalar_local(
        const vf::JsonValue::Object* expression
    ) {
        const auto found = component_scalar_locals_.find(expression);
        if (found != component_scalar_locals_.end()) {
            return {found->second, false};
        }
        const auto local = add_borrowed_temporary({});
        component_scalar_locals_.emplace(expression, local);
        return {local, true};
    }

    void set_numeric_interval(std::uint32_t local, double minimum, double maximum) {
        numeric_intervals_[local] = {minimum, maximum};
    }

    std::optional<std::pair<double, double>> numeric_interval(
        std::uint32_t local
    ) const {
        const auto found = numeric_intervals_.find(local);
        return found == numeric_intervals_.end()
            ? std::nullopt
            : std::optional<std::pair<double, double>>(found->second);
    }

    bool local_is_integral(std::uint32_t local) const {
        return local < function_.local_classes.size() &&
            function_.local_classes[local] == ValueClass::I64;
    }

    void enable_parameter_mask() {
        if (!function_.parameter_mask_local) {
            function_.parameter_mask_local = add_local("$provided_parameters", {}, false);
        }
    }

    bool ends_with_return() const {
        return !function_.instructions.empty() &&
            (function_.instructions.back().opcode == Opcode::ReturnF64 ||
             function_.instructions.back().opcode == Opcode::ReturnValues);
    }

    void emit(Instruction instruction) {
        const auto opcode = instruction.opcode;
        current_opcode_ = opcode;
        if (opcode == Opcode::PushF64 || opcode == Opcode::PushNull ||
            opcode == Opcode::LoadLocal || opcode == Opcode::Duplicate) {
            if (opcode == Opcode::Duplicate) require_stack(1);
            ++stack_depth_;
        } else if (opcode == Opcode::MonotonicF64 || opcode == Opcode::WallTimeF64) {
            ++stack_depth_;
        } else if (opcode == Opcode::SystemCpuCount) {
            ++stack_depth_;
        } else if (opcode == Opcode::SystemCwdString) {
            stack_depth_ += 2;
        } else if (opcode == Opcode::SystemEnvString) {
            require_stack(2);
            ++stack_depth_;
        } else if (opcode == Opcode::ProcessRun) {
            require_stack(2 + instruction.argument_count * 2);
            stack_depth_ = stack_depth_ - 2 - instruction.argument_count * 2 + 5;
        } else if (opcode == Opcode::RaiseErrorValue) {
            require_stack(5);
            stack_depth_ -= 4;
        } else if (opcode == Opcode::CaptureRegex) {
            require_stack(2);
            stack_depth_ = stack_depth_ - 2 + instruction.argument_count * 2;
        } else if (opcode == Opcode::PushString) {
            stack_depth_ += 2;
        } else if (opcode == Opcode::FormatF64String || opcode == Opcode::FormatBitString ||
                   opcode == Opcode::FormatChrString) {
            require_stack(1);
            ++stack_depth_;
        } else if (opcode == Opcode::DecodeUtf8At) {
            require_stack(3);
            --stack_depth_;
        } else if (opcode == Opcode::CloneString) {
            require_stack(2);
        } else if (opcode == Opcode::ConcatStrings) {
            require_stack(4);
            stack_depth_ -= 2;
        } else if (opcode == Opcode::WriteString) {
            require_stack(2);
            stack_depth_ -= 2;
        } else if (opcode == Opcode::ReadLineString) {
            stack_depth_ += 2;
        } else if (opcode == Opcode::ReadFileString) {
            require_stack(2);
        } else if (opcode == Opcode::WriteFileString) {
            require_stack(4);
            stack_depth_ -= 3;
        } else if (opcode == Opcode::StringEqual || opcode == Opcode::StringNotEqual ||
                   opcode == Opcode::StringLess || opcode == Opcode::StringLessEqual ||
                   opcode == Opcode::StringGreater || opcode == Opcode::StringGreaterEqual) {
            require_stack(4);
            stack_depth_ -= 3;
        } else if (opcode == Opcode::ReleaseStringValue) {
            require_stack(2);
            stack_depth_ -= 2;
        } else if (opcode == Opcode::ReleaseStringLocal) {
            // Lifetime operation has no value-stack effect.
        } else if (opcode == Opcode::AbsF64 || opcode == Opcode::SqrtF64 || opcode == Opcode::SinF64 ||
                   opcode == Opcode::CosF64 || opcode == Opcode::ExpF64 ||
                   opcode == Opcode::LnF64) {
            require_stack(1);
        } else if (opcode == Opcode::SleepF64) {
            require_stack(1);
        } else if (opcode == Opcode::LocalTimeParts) {
            require_stack(1);
            stack_depth_ += 8;
        } else if (opcode == Opcode::SumF64Values || opcode == Opcode::MeanF64Values ||
                   opcode == Opcode::VarianceF64Values ||
                   opcode == Opcode::StdDevF64Values ||
                   opcode == Opcode::RangeF64Values ||
                   opcode == Opcode::CountValues) {
            require_stack(instruction.argument_count);
            stack_depth_ = stack_depth_ - instruction.argument_count + 1;
        } else if (opcode == Opcode::SumF64Locals || opcode == Opcode::MeanF64Locals ||
                   opcode == Opcode::VarianceF64Locals ||
                   opcode == Opcode::StdDevF64Locals ||
                   opcode == Opcode::RangeF64Locals ||
                   opcode == Opcode::CountLocalValues) {
            ++stack_depth_;
        } else if (opcode == Opcode::MakeOwnedF64List) {
            require_stack(instruction.argument_count);
            stack_depth_ = stack_depth_ - instruction.argument_count + 1;
        } else if (opcode == Opcode::MakeOwnedRepeatedF64List) {
            require_stack(2);
            --stack_depth_;
        } else if (opcode == Opcode::MakeOwnedF64ListLiteral) {
            ++stack_depth_;
        } else if (opcode == Opcode::LoadF64LocalsIndex) {
            require_stack(1);
        } else if (opcode == Opcode::StoreF64LocalsIndex) {
            require_stack(2);
            stack_depth_ -= 2;
        } else if (opcode == Opcode::LoadF64ListIndex) {
            require_stack(2);
            --stack_depth_;
        } else if (opcode == Opcode::StoreF64ListIndex) {
            require_stack(2);
            stack_depth_ -= 2;
        } else if (opcode == Opcode::SumF64List || opcode == Opcode::MeanF64List ||
                   opcode == Opcode::VarianceF64List ||
                   opcode == Opcode::StdDevF64List ||
                   opcode == Opcode::RangeF64List ||
                   opcode == Opcode::CountF64List || opcode == Opcode::CloneF64List) {
            require_stack(1);
        } else if (opcode == Opcode::ReleaseF64ListValue) {
            require_stack(1);
            --stack_depth_;
        } else if (opcode == Opcode::ConcatF64Lists) {
            require_stack(2);
            --stack_depth_;
        } else if (opcode == Opcode::NormalizeF64Multiset) {
            require_stack(1);
        } else if (opcode == Opcode::UnionF64Multisets ||
                   opcode == Opcode::DifferenceF64Multisets ||
                   opcode == Opcode::FloorDivideF64Multisets ||
                   opcode == Opcode::RemainderF64Multisets ||
                   opcode == Opcode::AddF64MultisetScalar ||
                   opcode == Opcode::SubtractF64MultisetScalar ||
                   opcode == Opcode::FloorDivideF64MultisetScalar) {
            require_stack(2);
            --stack_depth_;
        } else if (opcode == Opcode::ReleaseF64ListLocal) {
            // Lifetime operation has no value-stack effect.
        } else if (opcode == Opcode::AssertTruthy || opcode == Opcode::ErrorTypeMatches) {
            require_stack(1);
        } else if (opcode == Opcode::AssertTruthyString) {
            require_stack(3);
            stack_depth_ -= 2;
        } else if (opcode == Opcode::JumpIfParameterProvided) {
            // Hidden parameter-mask branch has no value-stack effect.
        } else if (opcode == Opcode::StoreLocal || opcode == Opcode::Drop ||
                   opcode == Opcode::JumpIfFalse || opcode == Opcode::JumpIfTrue ||
                   opcode == Opcode::ReturnF64) {
            require_stack(1);
            --stack_depth_;
        } else if (opcode == Opcode::ReturnValues) {
            require_stack(instruction.result_count);
            stack_depth_ -= instruction.result_count;
        } else if (opcode == Opcode::AddF64 || opcode == Opcode::SubtractF64 ||
                   opcode == Opcode::MultiplyF64 || opcode == Opcode::DivideF64 ||
                   opcode == Opcode::FloorDivideF64 ||
                   opcode == Opcode::RemainderF64 || opcode == Opcode::PowerF64 ||
                   opcode == Opcode::LogicalXorF64 ||
                   opcode == Opcode::OrderedLessF64 || opcode == Opcode::OrderedLessEqualF64 ||
                   opcode == Opcode::OrderedGreaterF64 || opcode == Opcode::OrderedGreaterEqualF64 ||
                   opcode == Opcode::OrderedEqualF64 || opcode == Opcode::UnorderedNotEqualF64) {
            require_stack(2);
            --stack_depth_;
        } else if (opcode == Opcode::Call) {
            require_stack(instruction.argument_count);
            stack_depth_ = stack_depth_ - instruction.argument_count + instruction.result_count;
        }
        function_.max_stack = std::max(function_.max_stack, stack_depth_);
        function_.instructions.push_back(std::move(instruction));
    }

    Function finish() {
        if (function_.locals.size() != function_.local_classes.size()) {
            throw LoweringFailure("machine IR local class table is not parallel to locals");
        }
        if (function_.parameters.size() != function_.parameter_is_numeric_scalar.size()) {
            throw LoweringFailure("machine IR parameter kind table is not parallel to parameters");
        }
        return std::move(function_);
    }

private:
    struct Binding {
        std::uint32_t base = 0;
        ValueLayout layout;
    };

    struct ScopeEntry {
        std::string name;
        std::optional<Binding> previous;
        ScopeLocal local;
        bool alias = false;
    };

    Function function_;
    std::map<std::string, Binding> bindings_;
    std::map<std::string, std::map<std::string, ValueLayout>> pending_record_fields_;
    std::map<std::string, std::set<std::string>> aliases_;
    std::uint32_t stack_depth_ = 0;
    std::uint32_t next_label_ = 0;
    std::uint32_t next_owned_temporary_ = 0;
    std::uint32_t next_borrowed_temporary_ = 0;
    std::map<std::pair<std::uint32_t, std::uint32_t>, std::uint32_t>
        flattened_index_locals_;
    std::map<const vf::JsonValue::Object*, std::uint32_t>
        component_scalar_locals_;
    std::map<std::uint32_t, std::pair<double, double>> numeric_intervals_;
    std::optional<std::uint32_t> error_handler_;
    std::optional<std::uint32_t> error_value_local_;
    std::optional<std::uint32_t> error_type_local_;
    std::vector<std::vector<ScopeEntry>> scopes_;
    std::vector<std::pair<std::uint32_t, std::uint32_t>> loops_;
    std::vector<BlockReturn> block_returns_;
    Opcode current_opcode_ = Opcode::Drop;

    std::uint32_t append_local(
        const std::string& name,
        const ValueLayout& layout,
        bool owned,
        ValueClass value_class
    ) {
        const auto slot = static_cast<std::uint32_t>(function_.locals.size());
        for (std::uint32_t index = 0; index < layout.width; ++index) {
            function_.locals.push_back(component_name(name, index, layout.width));
            function_.local_classes.push_back(value_class);
        }
        if (owned) {
            for (const auto& resource : owned_resource_slices(layout)) {
                if (is_f64_heap_resource_kind(resource.kind)) {
                    function_.owned_f64_list_locals.push_back(slot + resource.offset);
                } else if (resource.kind == ValueKind::String) {
                    function_.owned_string_locals.push_back(slot + resource.offset);
                }
            }
        }
        return slot;
    }

    void require_stack(std::uint32_t count) const {
        if (stack_depth_ < count) {
            throw LoweringFailure(
                "invalid machine IR stack effect: depth " + std::to_string(stack_depth_) +
                ", required " + std::to_string(count) + ", opcode " +
                std::to_string(static_cast<unsigned>(current_opcode_)) + ", function " +
                function_.name + ", instruction " +
                std::to_string(function_.instructions.size()));
        }
    }

    static std::string component_name(const std::string& name, std::uint32_t index, std::uint32_t width) {
        return width == 1 ? name : name + "." + std::to_string(index);
    }
};

inline ValueLayout layout_from_builder_expression_shape(
    const vf::JsonValue::Object& expression,
    const FunctionBuilder& builder,
    const FunctionSignatures& signatures
) {
    LayoutEnvironment environment;
    const auto collect_locals = [&](const auto& self, const vf::JsonValue& value) -> void {
        if (value.is_array()) {
            for (const auto& item : value.as_array()) self(self, item);
            return;
        }
        if (!value.is_object()) return;
        const auto& object = value.as_object();
        const auto kind = object.find("kind");
        const auto name = object.find("name");
        if (kind != object.end() && kind->second.is_string() &&
            kind->second.as_string() == "load" && name != object.end() &&
            name->second.is_string()) {
            if (const auto* layout = builder.find_layout(name->second.as_string())) {
                environment[name->second.as_string()] = *layout;
            }
        }
        for (const auto& [field_name, child] : object) {
            if (field_name != "callee") self(self, child);
        }
    };
    collect_locals(collect_locals, expression);
    return layout_from_environment_expression_shape(expression, std::move(environment), signatures);
}

inline void discover_bindings(
    const vf::JsonValue::Object& statement,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures
) {
    const std::string kind = string_field(statement, "kind", "statement");
    if (kind == "store_binding") {
        const auto& value = object_of(field(statement, "value", "binding"), "binding value");
        const std::string value_kind = string_field(value, "kind", "binding value");
        auto layout = value_kind == "load"
            ? builder.layout(string_field(value, "name", "binding value"))
            : layout_from_builder_expression_shape(value, builder, signatures);
        if (value_kind == "binary_op") {
            const auto operand_layout = [&](const vf::JsonValue::Object& operand) {
                return string_field(operand, "kind", "binding binary operand") == "load"
                    ? builder.layout(string_field(operand, "name", "binding binary operand"))
                    : layout_from_builder_expression_shape(operand, builder, signatures);
            };
            const auto left = operand_layout(object_of(
                field(value, "left", "binding binary"), "binding binary left"));
            const auto right = operand_layout(object_of(
                field(value, "right", "binding binary"), "binding binary right"));
            if (string_field(value, "op", "binding binary") == "AMPERSAND" &&
                ((left.kind == ValueKind::DynamicF64List && right.kind == ValueKind::Aggregate) ||
                 (right.kind == ValueKind::DynamicF64List && left.kind == ValueKind::Aggregate))) {
                layout = {1, ValueKind::DynamicF64List, {}};
            }
            const std::string binary_op = string_field(value, "op", "binding binary");
            const bool fixed_aggregate_concat = binary_op == "AMPERSAND" &&
                left.kind == ValueKind::Aggregate && right.kind == ValueKind::Aggregate &&
                !is_record_layout(left) && !is_record_layout(right);
            if (!fixed_aggregate_concat &&
                (left.kind == ValueKind::Aggregate || right.kind == ValueKind::Aggregate) &&
                (left.kind == ValueKind::Aggregate || left.kind == ValueKind::Numeric) &&
                (right.kind == ValueKind::Aggregate || right.kind == ValueKind::Numeric)) {
                layout = left.kind == ValueKind::Aggregate ? left : right;
            }
            if (left.kind == ValueKind::Complex || right.kind == ValueKind::Complex) {
                layout = {2, ValueKind::Complex, {}};
            }
            const std::string left_type = string_field(value, "left_type", "binding binary");
            const std::string right_type = string_field(value, "right_type", "binding binary");
            if (left.width > 1 && right.width > 1 &&
                left_type.rfind("axis<", 0) == 0 && right_type.rfind("axis<", 0) == 0 &&
                left_type.substr(5, left_type.find('>') - 5) !=
                    right_type.substr(5, right_type.find('>') - 5)) {
                layout = outer_product_layout(left, right);
            }
        }
        if (value_kind == "block_expr") {
            const auto& body = array_of(field(value, "body", "block expression"), "block body");
            if (!body.empty()) {
                const auto& tail = object_of(body.back(), "block tail");
                if (string_field(tail, "kind", "block tail") == "expr_stmt") {
                    const auto& tail_value = object_of(
                        field(tail, "expr", "block tail"), "block tail value");
                    if (string_field(tail_value, "kind", "block tail value") == "scope_identity") {
                        LayoutEnvironment environment;
                        const std::string type = string_field(
                            tail_value, "type", "scope identity");
                        if (type.rfind("record{", 0) == 0 && !type.empty() && type.back() == '}') {
                            for (const auto& field_surface : split_top_level(
                                     type.substr(7, type.size() - 8), ',')) {
                                const auto colon = find_top_level(field_surface, ':');
                                if (colon == std::string::npos) continue;
                                const std::string name = trim(field_surface.substr(0, colon));
                                if (const auto* outer = builder.find_layout(name)) {
                                    environment[name] = *outer;
                                }
                            }
                            layout = layout_from_environment_expression_shape(
                                value, std::move(environment), signatures);
                        }
                    }
                }
            }
        }
        if (value_kind == "field_access" || value_kind == "dotted_index") {
            if (value_kind == "dotted_index") {
                const auto& indices = array_of(
                    field(value, "indices", "binding projection"), "binding projection indices");
                const auto& base = object_of(
                    field(value, "base", "binding projection"), "binding projection base");
                if (indices.size() > 1 &&
                    string_field(base, "kind", "binding projection base") == "load") {
                    const auto source = builder.layout(
                        string_field(base, "name", "binding projection base"));
                    if (source.kind == ValueKind::DynamicF64List) {
                        layout = indexed_layout(
                            std::vector<ValueLayout>(indices.size(), ValueLayout{}));
                    } else {
                        std::vector<ValueLayout> elements;
                        for (const auto& index_value : indices) {
                            const auto& index = object_of(index_value, "binding projection index");
                            const auto raw_value = index.find("value");
                            if (raw_value == index.end()) {
                                elements.clear();
                                break;
                            }
                            const auto& raw = raw_value->second;
                            if (!raw.is_number() || raw.as_number() < 0 ||
                                raw.as_number() != static_cast<double>(
                                    static_cast<std::uint32_t>(raw.as_number()))) {
                                elements.clear();
                                break;
                            }
                            const std::string key = std::to_string(
                                static_cast<std::uint32_t>(raw.as_number()));
                            const auto selected = source.selectors.find(key);
                            if (selected == source.selectors.end()) {
                                elements.clear();
                                break;
                            }
                            elements.push_back(record_field_layout(source, key, selected->second));
                        }
                        if (elements.size() == indices.size()) layout = indexed_layout(elements);
                    }
                }
            }
            const auto binding_path = [&](const auto& self,
                                          const vf::JsonValue::Object& expression,
                                          std::string& binding,
                                          std::vector<std::string>& path) -> bool {
                const std::string expression_kind = string_field(
                    expression, "kind", "binding projection");
                if (expression_kind == "load") {
                    binding = string_field(expression, "name", "binding projection");
                    return true;
                }
                if (expression_kind == "field_access") {
                    if (!self(self,
                              object_of(field(expression, "object", "binding projection"), "field source"),
                              binding,
                              path)) return false;
                    path.push_back(string_field(expression, "field", "binding projection"));
                    return true;
                }
                if (expression_kind != "dotted_index" ||
                    !self(self,
                          object_of(field(expression, "base", "binding projection"), "index source"),
                          binding,
                          path)) return false;
                for (const auto& index_value : array_of(
                         field(expression, "indices", "binding projection"), "projection indices")) {
                    const auto& index = object_of(index_value, "binding projection index");
                    const auto raw_value = index.find("value");
                    if (raw_value == index.end()) return false;
                    const auto& raw = raw_value->second;
                    if (!raw.is_number() || raw.as_number() < 0 ||
                        raw.as_number() != static_cast<double>(static_cast<std::uint32_t>(raw.as_number()))) {
                        return false;
                    }
                    path.push_back(std::to_string(static_cast<std::uint32_t>(raw.as_number())));
                }
                return true;
            };
            std::string binding;
            std::vector<std::string> path;
            if (layout.width <= 1 && binding_path(binding_path, value, binding, path)) {
                auto source = builder.layout(binding);
                for (const auto& component : path) {
                    const auto selected = source.selectors.find(component);
                    if (selected == source.selectors.end()) break;
                    source = record_field_layout(source, component, selected->second);
                    layout = source;
                }
            }
        }
        const auto declared = statement.find("type");
        if (declared != statement.end() && declared->second.is_string()) {
            const auto declared_layout = layout_from_type(
                declared->second.as_string(), &signatures);
            if (declared_layout.width > layout.width) layout = declared_layout;
        }
        const std::string binding_type = string_field(statement, "type", "binding");
        builder.add_local(
            string_field(statement, "name", "binding"), layout, true,
            scalar_value_class_from_type(binding_type, layout));
    } else if (kind == "spill_stmt") {
        const auto spill_layout = layout_from_expression_shape(
            object_of(field(statement, "value", "spill statement"), "spill value"),
            signatures);
        std::vector<std::pair<std::string, ValueSlice>> fields;
        for (const auto& [field_name, slice] : spill_layout.selectors) {
            if (field_name.find('.') == std::string::npos) fields.push_back({field_name, slice});
        }
        std::stable_sort(fields.begin(), fields.end(), [](const auto& left, const auto& right) {
            return left.second.offset < right.second.offset;
        });
        for (const auto& [field_name, slice] : fields) {
            builder.add_local(
                field_name,
                record_field_layout(spill_layout, field_name, slice));
        }
    } else if (kind == "update_attr") {
        builder.declare_record_field(
            string_field(statement, "base_name", "attribute update"),
            string_field(statement, "field", "attribute update"),
            layout_from_expression_shape(
                object_of(field(statement, "value", "attribute update"), "attribute update value"),
                signatures));
    } else if (kind == "if_stmt") {
        const auto& block = object_of(field(statement, "body", "if statement"), "if body");
        const auto& children = array_of(field(block, "body", "block"), "block body");
        for (auto child = children.rbegin(); child != children.rend(); ++child) {
            discover_bindings(object_of(*child, "statement"), builder, signatures);
        }
    }
}

inline void require_scalar(const ValueLayout& layout, const std::string& context) {
    if (layout.width != 1) {
        throw LoweringFailure(
            context + " requires scalar values, got " + describe_layout(layout));
    }
}

inline void emit_load_binding(FunctionBuilder& builder, const std::string& name, const ValueSlice& slice) {
    for (std::uint32_t component = 0; component < slice.width; ++component) {
        Instruction instruction;
        instruction.opcode = Opcode::LoadLocal;
        instruction.index = builder.slot(name, slice.offset + component);
        builder.emit(std::move(instruction));
    }
}

inline void emit_default_value(
    FunctionBuilder& builder,
    const ValueLayout& layout,
    StringPool& strings
);

inline void emit_store_binding(
    FunctionBuilder& builder,
    const std::string& name,
    const ValueLayout& value_layout,
    StringPool& strings
) {
    const auto& binding_layout = builder.layout(name);
    if (binding_layout.width < value_layout.width) {
        throw LoweringFailure(
            "aggregate width mismatch storing " + name + ": allocated " +
            std::to_string(binding_layout.width) + ", produced " +
            std::to_string(value_layout.width));
    }
    if (binding_layout.width > value_layout.width) {
        ValueLayout extension{
            binding_layout.width - value_layout.width,
            ValueKind::Aggregate,
            {}};
        for (const auto& [field_name, slice] : binding_layout.selectors) {
            if (slice.offset < value_layout.width ||
                field_name.find('.') != std::string::npos) continue;
            extension.selectors[field_name] = {
                slice.offset - value_layout.width, slice.width, slice.kind
            };
        }
        emit_default_value(builder, extension, strings);
    }
    for (std::uint32_t component = binding_layout.width; component > 0; --component) {
        Instruction instruction;
        instruction.opcode = Opcode::StoreLocal;
        instruction.index = builder.slot(name, component - 1);
        builder.emit(std::move(instruction));
    }
}

inline void emit_store_slice(
    FunctionBuilder& builder,
    const std::string& name,
    const ValueSlice& slice,
    const ValueLayout& value_layout
) {
    if (slice.width != value_layout.width) {
        throw LoweringFailure("aggregate width mismatch storing projection of " + name);
    }
    for (std::uint32_t component = value_layout.width; component > 0; --component) {
        Instruction instruction;
        instruction.opcode = Opcode::StoreLocal;
        instruction.index = builder.slot(name, slice.offset + component - 1);
        builder.emit(std::move(instruction));
    }
}

struct Projection {
    std::string binding;
    std::string path;
};

inline Projection projection_of(const vf::JsonValue::Object& expression) {
    const std::string kind = string_field(expression, "kind", "projection");
    if (kind == "load") return {string_field(expression, "name", "projection"), ""};
    if (kind == "field_access") {
        auto projection = projection_of(object_of(field(expression, "object", "field access"), "field access object"));
        const std::string field_name = string_field(expression, "field", "field access");
        projection.path += (projection.path.empty() ? "" : ".") + field_name;
        return projection;
    }
    if (kind == "dotted_index") {
        auto projection = projection_of(object_of(field(expression, "base", "dotted index"), "dotted index base"));
        const auto& indices = array_of(field(expression, "indices", "dotted index"), "dotted indices");
        if (indices.empty()) throw LoweringFailure("machine IR dotted index requires an index");
        for (const auto& raw_index : indices) {
            const auto& index_object = object_of(raw_index, "dotted index");
            const auto& index_value = field(index_object, "value", "dotted index");
            if (!index_value.is_number() || index_value.as_number() < 0 ||
                index_value.as_number() != static_cast<double>(
                    static_cast<std::uint32_t>(index_value.as_number()))) {
                throw LoweringFailure(
                    "machine IR dotted index must use nonnegative integer constants in projections");
            }
            projection.path += (projection.path.empty() ? "" : ".") +
                std::to_string(static_cast<std::uint32_t>(index_value.as_number()));
        }
        return projection;
    }
    throw LoweringFailure("machine IR projection requires a binding base");
}

inline ValueLayout projected_layout(
    const ValueLayout& source,
    const std::string& path,
    const ValueSlice& selected
) {
    ValueLayout result;
    result.width = selected.width;
    result.kind = selected.kind;
    const std::string prefix = path + ".";
    for (const auto& [name, slice] : source.selectors) {
        if (name.rfind(prefix, 0) == 0) {
            result.selectors[name.substr(prefix.size())] = {
                slice.offset - selected.offset, slice.width, slice.kind
            };
        }
    }
    return result;
}

inline std::vector<std::pair<std::string, ValueSlice>> ordered_record_fields(
    const ValueLayout& layout
) {
    std::vector<std::pair<std::string, ValueSlice>> fields;
    for (const auto& [name, slice] : layout.selectors) {
        if (name.find('.') == std::string::npos) fields.push_back({name, slice});
    }
    std::stable_sort(fields.begin(), fields.end(), [](const auto& left, const auto& right) {
        return left.second.offset < right.second.offset;
    });
    return fields;
}

inline bool collect_record_projection(
    const std::string& source_path,
    const ValueLayout& source,
    const ValueLayout& target,
    std::vector<ValueSlice>& slices
) {
    for (const auto& [name, target_slice] : ordered_record_fields(target)) {
        const std::string path = source_path.empty() ? name : source_path + "." + name;
        const auto found = source.selectors.find(path);
        if (found == source.selectors.end()) return false;
        const auto target_field = record_field_layout(target, name, target_slice);
        if (is_record_layout(target_field)) {
            if (!collect_record_projection(path, source, target_field, slices)) return false;
            continue;
        }
        if (found->second.width != target_slice.width || found->second.kind != target_slice.kind) {
            return false;
        }
        slices.push_back(found->second);
    }
    return true;
}

inline std::optional<ValueLayout> lower_open_record_argument(
    const vf::JsonValue::Object& expression,
    const ValueLayout& target,
    FunctionBuilder& builder
) {
    if (!is_record_layout(target)) return std::nullopt;
    const std::string kind = string_field(expression, "kind", "record argument");
    if (kind != "load" && kind != "field_access" && kind != "dotted_index") {
        return std::nullopt;
    }
    const auto projection = projection_of(expression);
    const auto& source = builder.layout(projection.binding);
    std::vector<ValueSlice> slices;
    if (!collect_record_projection(projection.path, source, target, slices)) {
        return std::nullopt;
    }
    for (const auto& slice : slices) emit_load_binding(builder, projection.binding, slice);
    return target;
}

inline bool is_numeric_layout(const ValueLayout& layout) {
    if (layout.width == 0 || layout.kind == ValueKind::String ||
        layout.kind == ValueKind::DynamicF64List ||
        layout.kind == ValueKind::NumericMultiset ||
        layout.kind == ValueKind::StringMultiset ||
        layout.kind == ValueKind::Range) return false;
    return std::none_of(layout.selectors.begin(), layout.selectors.end(), [](const auto& item) {
        return item.second.kind == ValueKind::String;
    });
}

inline bool is_flat_fixed_numeric_vector(const ValueLayout& layout) {
    if (layout.kind != ValueKind::Aggregate || is_record_layout(layout)) return false;
    const auto elements = indexed_element_layouts(layout);
    return !elements.empty() &&
        std::all_of(elements.begin(), elements.end(), [](const auto& element) {
            return element.kind == ValueKind::Numeric && element.width == 1 &&
                element.selectors.empty();
        });
}

inline bool can_project_call_layout(const ValueLayout& source, const ValueLayout& target) {
    if (same_layout(source, target)) return true;
    if (source.kind == ValueKind::DynamicF64List && is_flat_fixed_numeric_vector(target)) {
        return true;
    }
    if (!is_record_layout(source) || !is_record_layout(target)) return false;
    for (const auto& [name, target_slice] : ordered_record_fields(target)) {
        const auto found = source.selectors.find(name);
        if (found == source.selectors.end()) return false;
        if (!can_project_call_layout(
                record_field_layout(source, name, found->second),
                record_field_layout(target, name, target_slice))) {
            return false;
        }
    }
    return true;
}

inline void emit_projected_call_layout(
    FunctionBuilder& builder,
    StringPool& strings,
    std::uint32_t source_local,
    const ValueLayout& source,
    const ValueLayout& target,
    const std::string& context
) {
    if (same_layout(source, target)) {
        for (std::uint32_t component = 0; component < source.width; ++component) {
            Instruction load;
            load.opcode = Opcode::LoadLocal;
            load.index = source_local + component;
            builder.emit(std::move(load));
        }
        return;
    }
    if (source.kind == ValueKind::DynamicF64List && is_flat_fixed_numeric_vector(target)) {
        Instruction load;
        load.opcode = Opcode::LoadLocal;
        load.index = source_local;
        builder.emit(std::move(load));
        builder.emit({Opcode::CountF64List});
        Instruction expected_count;
        expected_count.opcode = Opcode::PushF64;
        expected_count.f64 = static_cast<double>(target.width);
        builder.emit(std::move(expected_count));
        builder.emit({Opcode::OrderedEqualF64});
        Instruction arity;
        arity.opcode = Opcode::AssertTruthy;
        const std::string message = "fixed-vector argument length mismatch for " + context;
        arity.index = strings.intern(message);
        arity.byte_count = static_cast<std::uint32_t>(message.size());
        arity.error_type_mask = value_error_mask;
        if (const auto handler = builder.error_handler()) {
            arity.has_error_handler = true;
            arity.label = *handler;
            arity.error_value_local = *builder.error_value_local();
            arity.error_type_local = *builder.error_type_local();
        }
        builder.emit(std::move(arity));
        builder.emit({Opcode::Drop});
        for (std::uint32_t component = 0; component < target.width; ++component) {
            Instruction list;
            list.opcode = Opcode::LoadLocal;
            list.index = source_local;
            builder.emit(std::move(list));
            Instruction index;
            index.opcode = Opcode::PushF64;
            index.f64 = static_cast<double>(component);
            builder.emit(std::move(index));
            builder.emit({Opcode::LoadF64ListIndex});
        }
        return;
    }
    for (const auto& [name, target_slice] : ordered_record_fields(target)) {
        const auto found = source.selectors.find(name);
        const auto source_field = record_field_layout(source, name, found->second);
        emit_projected_call_layout(
            builder,
            strings,
            source_local + found->second.offset,
            source_field,
            record_field_layout(target, name, target_slice),
            context + "." + name);
    }
}

inline bool expression_produces_owned_f64_list(
    const vf::JsonValue::Object& expression,
    const FunctionSignatures& signatures
) {
    const std::string kind = string_field(expression, "kind", "owned list expression");
    if (kind == "list") {
        const auto type = expression.find("type");
        return type != expression.end() && type->second.is_string() &&
            (is_explicit_dynamic_f64_list_type(type->second.as_string()) ||
             (type->second.as_string() == "list<any>" &&
              array_of(field(expression, "items", "list"), "list items").empty()));
    }
    if (kind == "axis_align") {
        return expression_produces_owned_f64_list(
            object_of(field(expression, "value", "axis align"), "axis align value"), signatures);
    }
    if (kind == "binary_op") {
        const auto type = expression.find("type");
        return string_field(expression, "op", "binary expression") == "AMPERSAND"
            || (type != expression.end() && type->second.is_string()
                && symbolic_expression_surface_type(type->second.as_string()));
    }
    if (kind == "symbolic_var") return true;
    if (kind != "call") return false;
    const auto& callee = object_of(field(expression, "callee", "call"), "callee");
    const std::string callee_kind = string_field(callee, "kind", "callee");
    if (callee_kind == "stdlib_function") {
        return string_field(callee, "module", "callee") == "collections" &&
            string_field(callee, "name", "callee") == "list";
    }
    if (callee_kind != "load") return false;
    const auto found = signatures.find(string_field(callee, "name", "callee"));
    return found != signatures.end() && found->second.result.kind == ValueKind::DynamicF64List;
}

inline bool expression_produces_owned_numeric_multiset(
    const vf::JsonValue::Object& expression,
    const FunctionSignatures& signatures
) {
    const std::string kind = string_field(expression, "kind", "owned multiset expression");
    if (kind == "multiset") return true;
    if (kind == "axis_align") {
        return expression_produces_owned_numeric_multiset(
            object_of(field(expression, "value", "axis align"), "axis align value"), signatures);
    }
    if (kind == "binary_op") return true;
    if (kind != "call") return false;
    const auto& callee = object_of(field(expression, "callee", "call"), "callee");
    if (string_field(callee, "kind", "callee") != "load") return false;
    const std::string symbol = string_field(callee, "name", "callee");
    if (symbol == "str") return true;
    const auto found = signatures.find(symbol);
    return found != signatures.end() && found->second.result.kind == ValueKind::NumericMultiset;
}

inline bool expression_transfers_string_value(
    const vf::JsonValue::Object& expression,
    const FunctionSignatures& signatures
) {
    const std::string kind = string_field(expression, "kind", "string expression");
    if (kind == "axis_align") {
        return expression_transfers_string_value(
            object_of(field(expression, "value", "axis align"), "axis align value"), signatures);
    }
    if (kind == "interpolated_string") return true;
    if (kind == "binary_op") {
        return string_field(expression, "op", "binary expression") == "AMPERSAND";
    }
    if (kind != "call") return false;
    const auto& callee = object_of(field(expression, "callee", "call"), "callee");
    if (string_field(callee, "kind", "callee") != "load") return false;
    const auto found = signatures.find(string_field(callee, "name", "callee"));
    return found != signatures.end() && found->second.result.kind == ValueKind::String;
}

inline bool expression_needs_string_clone(const vf::JsonValue::Object& expression) {
    const std::string kind = string_field(expression, "kind", "string expression");
    if (kind == "axis_align") {
        return expression_needs_string_clone(
            object_of(field(expression, "value", "axis align"), "axis align value"));
    }
    return kind == "load" || kind == "field_access" || kind == "dotted_index";
}

inline bool expression_transfers_aggregate_value(
    const vf::JsonValue::Object& expression,
    const FunctionSignatures& signatures
) {
    const std::string kind = string_field(expression, "kind", "aggregate expression");
    if (kind == "axis_align") {
        return expression_transfers_aggregate_value(
            object_of(field(expression, "value", "axis align"), "axis align value"), signatures);
    }
    if (kind == "record" || kind == "list" || kind == "tuple" || kind == "multiset" ||
        kind == "binary_op") return true;
    if (kind != "call") return false;
    const auto& callee = object_of(field(expression, "callee", "call"), "callee");
    if (string_field(callee, "kind", "callee") != "load") return false;
    const auto found = signatures.find(string_field(callee, "name", "callee"));
    return found != signatures.end() &&
        (found->second.result.kind == ValueKind::Aggregate ||
         found->second.result.kind == ValueKind::StringMultiset);
}

[[gnu::noinline]] inline ValueLayout emit_mixed_f64_list_concat(
    bool dynamic_first,
    const ValueLayout& fixed_layout,
    const vf::JsonValue::Object& dynamic_expression,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures
) {
    const auto dynamic_temporary = builder.add_borrowed_temporary(
        {1, ValueKind::DynamicF64List, {}});
    const auto fixed_temporary = builder.add_borrowed_temporary(fixed_layout);
    if (dynamic_first) {
        for (std::uint32_t component = fixed_layout.width; component > 0; --component) {
            builder.emit({Opcode::StoreLocal, 0.0, fixed_temporary + component - 1});
        }
        builder.emit({Opcode::StoreLocal, 0.0, dynamic_temporary});
        builder.emit({Opcode::LoadLocal, 0.0, dynamic_temporary});
    } else {
        builder.emit({Opcode::StoreLocal, 0.0, dynamic_temporary});
        for (std::uint32_t component = fixed_layout.width; component > 0; --component) {
            builder.emit({Opcode::StoreLocal, 0.0, fixed_temporary + component - 1});
        }
    }
    for (std::uint32_t component = 0; component < fixed_layout.width; ++component) {
        builder.emit({Opcode::LoadLocal, 0.0, fixed_temporary + component});
    }
    Instruction make;
    make.opcode = Opcode::MakeOwnedF64List;
    make.argument_count = fixed_layout.width;
    builder.emit(std::move(make));
    if (!dynamic_first) builder.emit({Opcode::LoadLocal, 0.0, dynamic_temporary});
    Instruction concat;
    concat.opcode = Opcode::ConcatF64Lists;
    concat.owns_left = dynamic_first
        ? expression_produces_owned_f64_list(dynamic_expression, signatures)
        : true;
    concat.owns_right = dynamic_first
        ? true
        : expression_produces_owned_f64_list(dynamic_expression, signatures);
    builder.emit(std::move(concat));
    return {1, ValueKind::DynamicF64List, {}};
}

inline void ensure_owned_f64_list_value(
    const vf::JsonValue::Object& expression,
    const ValueLayout& layout,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures
) {
    if (layout.kind == ValueKind::DynamicF64List &&
        !expression_produces_owned_f64_list(expression, signatures)) {
        builder.emit({Opcode::CloneF64List});
    }
}

inline void ensure_independent_string_value(
    const vf::JsonValue::Object& expression,
    const ValueLayout& layout,
    FunctionBuilder& builder
) {
    if (layout.kind == ValueKind::String && expression_needs_string_clone(expression)) {
        builder.emit({Opcode::CloneString});
    }
}

inline void clone_nested_resource_values(const ValueLayout& layout, FunctionBuilder& builder) {
    const auto resources = owned_resource_slices(layout);
    if (resources.empty()) return;
    const auto temporary = builder.add_borrowed_temporary(layout);
    for (std::uint32_t component = layout.width; component > 0; --component) {
        Instruction store;
        store.opcode = Opcode::StoreLocal;
        store.index = temporary + component - 1;
        builder.emit(std::move(store));
    }
    for (std::uint32_t component = 0; component < layout.width;) {
        const auto resource = std::find_if(resources.begin(), resources.end(), [&](const auto& candidate) {
            return candidate.offset == component;
        });
        if (resource == resources.end()) {
            Instruction load;
            load.opcode = Opcode::LoadLocal;
            load.index = temporary + component;
            builder.emit(std::move(load));
            ++component;
            continue;
        }
        for (std::uint32_t index = 0; index < resource->width; ++index) {
            Instruction load;
            load.opcode = Opcode::LoadLocal;
            load.index = temporary + component + index;
            builder.emit(std::move(load));
        }
        builder.emit({resource->kind == ValueKind::String ? Opcode::CloneString : Opcode::CloneF64List});
        component += resource->width;
    }
}

inline void ensure_independent_value(
    const vf::JsonValue::Object& expression,
    const ValueLayout& layout,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures
) {
    if (layout.kind == ValueKind::DynamicF64List) {
        ensure_owned_f64_list_value(expression, layout, builder, signatures);
    } else if (layout.kind == ValueKind::NumericMultiset) {
        if (!expression_produces_owned_numeric_multiset(expression, signatures)) {
            builder.emit({Opcode::CloneF64List});
        }
    } else if (layout.kind == ValueKind::String) {
        ensure_independent_string_value(expression, layout, builder);
    } else if ((layout.kind == ValueKind::Aggregate || layout.kind == ValueKind::StringMultiset) &&
               has_owned_resources(layout) &&
               !expression_transfers_aggregate_value(expression, signatures)) {
        clone_nested_resource_values(layout, builder);
    }
}

inline void emit_release_layout_local(
    FunctionBuilder& builder,
    std::uint32_t base,
    const ValueLayout& layout
) {
    for (const auto& resource : owned_resource_slices(layout)) {
        Instruction release;
        release.opcode = resource.kind == ValueKind::String
            ? Opcode::ReleaseStringLocal : Opcode::ReleaseF64ListLocal;
        release.index = base + resource.offset;
        builder.emit(std::move(release));
    }
}

inline void emit_discard_owned_value(FunctionBuilder& builder, const ValueLayout& layout) {
    const auto temporary = builder.add_owned_temporary(layout);
    for (std::uint32_t component = layout.width; component > 0; --component) {
        Instruction store;
        store.opcode = Opcode::StoreLocal;
        store.index = temporary + component - 1;
        builder.emit(std::move(store));
    }
    emit_release_layout_local(builder, temporary, layout);
}

inline void emit_discard_value(FunctionBuilder& builder, const ValueLayout& layout) {
    if (has_owned_resources(layout)) {
        emit_discard_owned_value(builder, layout);
        return;
    }
    for (std::uint32_t component = 0; component < layout.width; ++component) {
        builder.emit({Opcode::Drop});
    }
}

inline void emit_default_value(
    FunctionBuilder& builder,
    const ValueLayout& layout,
    StringPool& strings
) {
    const auto resources = owned_resource_slices(layout);
    for (std::uint32_t component = 0; component < layout.width;) {
        const auto resource = std::find_if(resources.begin(), resources.end(), [&](const auto& candidate) {
            return candidate.offset == component;
        });
        if (resource == resources.end()) {
            builder.emit({Opcode::PushF64});
            ++component;
        } else if (resource->kind == ValueKind::String) {
            Instruction empty;
            empty.opcode = Opcode::PushString;
            empty.index = strings.intern("");
            builder.emit(std::move(empty));
            component += resource->width;
        } else {
            builder.emit({Opcode::MakeOwnedF64List});
            component += resource->width;
        }
    }
}

inline void emit_release_owned_values(FunctionBuilder& builder) {
    for (const auto slot : builder.owned_f64_list_locals()) {
        Instruction release;
        release.opcode = Opcode::ReleaseF64ListLocal;
        release.index = slot;
        builder.emit(std::move(release));
    }
    for (const auto slot : builder.owned_string_locals()) {
        Instruction release;
        release.opcode = Opcode::ReleaseStringLocal;
        release.index = slot;
        builder.emit(std::move(release));
    }
}

inline void emit_return(FunctionBuilder& builder, const ValueLayout& layout) {
    if (layout.width == 1) {
        builder.emit({Opcode::ReturnF64});
        return;
    }
    Instruction instruction;
    instruction.opcode = Opcode::ReturnValues;
    instruction.result_count = layout.width;
    builder.emit(std::move(instruction));
}

inline void lower_statements(
    const vf::JsonValue::Array& body,
    FunctionBuilder& builder,
    bool function_tail,
    const FunctionSignatures& signatures,
    StringPool& strings,
    const DisplayEnvironment* display_environment = nullptr,
    const FunctionDisplayShapes* function_displays = nullptr,
    const ValueLayout* function_result_layout = nullptr
);

inline ValueLayout lower_expression(
    const vf::JsonValue::Object& expression,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures,
    StringPool& strings
);

inline bool references_current_pipe_value(
    const vf::JsonValue& value,
    std::uint32_t nested_pipe_depth = 0
) {
    if (value.is_array()) {
        return std::any_of(
            value.as_array().begin(), value.as_array().end(),
            [nested_pipe_depth](const auto& element) {
                return references_current_pipe_value(element, nested_pipe_depth);
            });
    }
    if (!value.is_object()) return false;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "load") {
        const auto name = object.find("name");
        return nested_pipe_depth == 0 && name != object.end() &&
            name->second.is_string() && name->second.as_string() == "$";
    }
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "pipe_chain") {
        const auto source = object.find("source");
        if (source != object.end() &&
            references_current_pipe_value(source->second, nested_pipe_depth)) {
            return true;
        }
        const auto segments = object.find("segments");
        return segments != object.end() &&
            references_current_pipe_value(segments->second, nested_pipe_depth + 1u);
    }
    return std::any_of(
        object.begin(), object.end(),
        [nested_pipe_depth](const auto& field) {
            return references_current_pipe_value(field.second, nested_pipe_depth);
        });
}

inline bool lower_discarded_range_pipe(
    const vf::JsonValue::Object& expression,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures,
    StringPool& strings
);

inline std::optional<ValueLayout> lower_literal_projection_argument(
    const vf::JsonValue::Object& expression,
    const ValueLayout& target,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures,
    StringPool& strings
) {
    if (target.kind != ValueKind::Aggregate) return std::nullopt;
    const std::string kind = string_field(expression, "kind", "literal projection argument");
    std::vector<std::pair<std::string, const vf::JsonValue::Object*>> supplied;
    if (is_record_layout(target)) {
        if (kind == "bind_expr") {
            supplied.push_back({
                string_field(expression, "name", "bound record projection field"),
                &object_of(field(expression, "value", "bound record projection field"),
                           "bound record projection value")
            });
        } else {
            if (kind != "record") return std::nullopt;
            const auto& fields = array_of(field(expression, "fields", "record projection argument"),
                                          "record projection argument fields");
            for (const auto& value : fields) {
                const auto& record_field = object_of(value, "record projection field");
                supplied.push_back({
                    string_field(record_field, "name", "record projection field"),
                    &object_of(field(record_field, "value", "record projection field"),
                               "record projection field value")
                });
            }
        }
    } else {
        if (kind != "list" && kind != "tuple") return std::nullopt;
        const auto& items = array_of(field(expression, "items", "indexed projection argument"),
                                     "indexed projection argument items");
        for (std::size_t index = 0; index < items.size(); ++index) {
            const auto& item = object_of(items[index], "indexed projection item");
            if (string_field(item, "kind", "indexed projection item") == "spread") {
                return std::nullopt;
            }
            supplied.push_back({std::to_string(index), &item});
        }
    }
    std::vector<std::pair<std::string, ValueSlice>> required;
    for (const auto& [name, slice] : target.selectors) {
        if (name.find('.') == std::string::npos) required.push_back({name, slice});
    }
    std::stable_sort(required.begin(), required.end(), [](const auto& left, const auto& right) {
        return left.second.offset < right.second.offset;
    });
    for (const auto& [name, slice] : required) {
        const std::string required_name = name;
        const auto found = std::find_if(supplied.begin(), supplied.end(), [&](const auto& item) {
            return item.first == required_name;
        });
        if (found == supplied.end()) return std::nullopt;
        const auto expected = record_field_layout(target, name, slice);
        const auto nested = lower_literal_projection_argument(
            *found->second, expected, builder, signatures, strings);
        const auto actual = nested
            ? *nested
            : lower_expression(*found->second, builder, signatures, strings);
        if (!same_layout(actual, expected)) {
            throw LoweringFailure(
                "literal call argument field layout mismatch at " + name + ": expected " +
                describe_layout(expected) +
                ", got " + describe_layout(actual));
        }
        ensure_independent_value(*found->second, actual, builder, signatures);
    }
    return target;
}

inline ValueLayout emit_complex_string(FunctionBuilder& builder, StringPool& strings);

inline void emit_static_string(
    FunctionBuilder& builder,
    StringPool& strings,
    const std::string& value
) {
    Instruction instruction;
    instruction.opcode = Opcode::PushString;
    instruction.index = strings.intern(value);
    instruction.byte_count = static_cast<std::uint32_t>(value.size());
    builder.emit(std::move(instruction));
}

inline void emit_interpolation_concat(
    FunctionBuilder& builder,
    bool owns_left,
    bool owns_right
) {
    Instruction concat;
    concat.opcode = Opcode::ConcatStrings;
    concat.owns_left = owns_left;
    concat.owns_right = owns_right;
    builder.emit(std::move(concat));
}

inline std::string interpolation_numeric_format(const std::string& format) {
    if (format.empty()) return "%.15g";
    std::string normalized = format;
    if (std::isdigit(static_cast<unsigned char>(normalized.front()))) {
        normalized.insert(normalized.begin(), '.');
    }
    std::size_t cursor = normalized.front() == '.' ? 1u : 0u;
    while (cursor < normalized.size() &&
           std::isdigit(static_cast<unsigned char>(normalized[cursor]))) ++cursor;
    if (cursor + 1 != normalized.size() ||
        std::string("fFeEgG").find(normalized[cursor]) == std::string::npos) {
        throw LoweringFailure("unsupported numeric interpolation format " + format);
    }
    return "%" + normalized;
}

inline DisplayShape interpolation_display_shape(
    const vf::JsonValue::Object& expression,
    const ValueLayout& layout,
    const FunctionSignatures& signatures
) {
    DisplayShape shape;
    if (string_field(expression, "kind", "interpolation expression") == "call") {
        const auto& callee = object_of(
            field(expression, "callee", "interpolation call"), "interpolation callee");
        if (string_field(callee, "kind", "interpolation callee") == "load") {
            const auto found = signatures.find(string_field(callee, "name", "interpolation callee"));
            if (found != signatures.end()) shape = found->second.result_display;
        }
    }
    if (display_width(shape) == 1 && shape.kind == DisplayKind::F64) {
        shape = display_shape_from_expression(expression, {}, nullptr);
    }
    if (display_width(shape) != layout.width) shape = display_shape_from_layout(layout);
    return shape;
}

[[gnu::noinline]] inline bool emit_local_interpolation_string(
    FunctionBuilder& builder,
    StringPool& strings,
    std::uint32_t base,
    const ValueLayout& layout,
    DisplayShape shape,
    const std::string& format
) {
    if (layout.kind == ValueKind::String) {
        if (!format.empty() && format != "s") {
            throw LoweringFailure("unsupported string interpolation format " + format);
        }
        for (std::uint32_t component = 0; component < 2; ++component) {
            Instruction load;
            load.opcode = Opcode::LoadLocal;
            load.index = base + component;
            builder.emit(std::move(load));
        }
        builder.emit({Opcode::CloneString});
        return true;
    }
    if (layout.kind == ValueKind::Null) {
        if (!format.empty()) throw LoweringFailure("null interpolation does not accept a format");
        emit_static_string(builder, strings, "null");
        return false;
    }
    if (layout.kind == ValueKind::Complex) {
        if (!format.empty()) {
            throw LoweringFailure("complex interpolation does not accept a numeric format");
        }
        Instruction real;
        real.opcode = Opcode::LoadLocal;
        real.index = base;
        builder.emit(std::move(real));
        Instruction imag;
        imag.opcode = Opcode::LoadLocal;
        imag.index = base + 1u;
        builder.emit(std::move(imag));
        emit_complex_string(builder, strings);
        return true;
    }
    if (layout.kind == ValueKind::StringMultiset) {
        if (!format.empty()) {
            throw LoweringFailure("string multiset interpolation does not accept a format");
        }
        const ValueLayout string_layout{2, ValueKind::String, {}};
        const auto result = builder.add_owned_temporary(string_layout);
        const auto emitted = builder.add_borrowed_temporary({});
        const auto store_string = [&](std::uint32_t target) {
            for (std::uint32_t component = 2; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = target + component - 1;
                builder.emit(std::move(store));
            }
        };
        const auto load_string = [&](std::uint32_t source) {
            for (std::uint32_t component = 0; component < 2; ++component) {
                Instruction load;
                load.opcode = Opcode::LoadLocal;
                load.index = source + component;
                builder.emit(std::move(load));
            }
        };
        const auto append_static = [&](const std::string& text) {
            load_string(result);
            emit_static_string(builder, strings, text);
            emit_interpolation_concat(builder, true, false);
            store_string(result);
        };
        emit_static_string(builder, strings, "{");
        store_string(result);
        Instruction zero;
        zero.opcode = Opcode::PushF64;
        zero.f64 = 0.0;
        builder.emit(std::move(zero));
        Instruction initialize;
        initialize.opcode = Opcode::StoreLocal;
        initialize.index = emitted;
        builder.emit(std::move(initialize));
        const std::uint32_t entries = layout.width / 3u;
        for (std::uint32_t entry = 0; entry < entries; ++entry) {
            const auto skip = builder.next_label();
            const auto no_separator = builder.next_label();
            Instruction count;
            count.opcode = Opcode::LoadLocal;
            count.index = base + entry * 3u + 2u;
            builder.emit(std::move(count));
            Instruction count_zero;
            count_zero.opcode = Opcode::PushF64;
            count_zero.f64 = 0.0;
            builder.emit(std::move(count_zero));
            builder.emit({Opcode::OrderedGreaterF64});
            Instruction skip_empty;
            skip_empty.opcode = Opcode::JumpIfFalse;
            skip_empty.label = skip;
            builder.emit(std::move(skip_empty));
            Instruction emitted_value;
            emitted_value.opcode = Opcode::LoadLocal;
            emitted_value.index = emitted;
            builder.emit(std::move(emitted_value));
            Instruction skip_separator;
            skip_separator.opcode = Opcode::JumpIfFalse;
            skip_separator.label = no_separator;
            builder.emit(std::move(skip_separator));
            append_static(", ");
            Instruction separator_label;
            separator_label.opcode = Opcode::Label;
            separator_label.label = no_separator;
            builder.emit(std::move(separator_label));

            load_string(result);
            for (std::uint32_t component = 0; component < 2; ++component) {
                Instruction key;
                key.opcode = Opcode::LoadLocal;
                key.index = base + entry * 3u + component;
                builder.emit(std::move(key));
            }
            builder.emit({Opcode::CloneString});
            emit_interpolation_concat(builder, true, true);
            store_string(result);
            append_static(":");
            load_string(result);
            Instruction count_value;
            count_value.opcode = Opcode::LoadLocal;
            count_value.index = base + entry * 3u + 2u;
            builder.emit(std::move(count_value));
            Instruction render_count;
            render_count.opcode = Opcode::FormatF64String;
            const std::string numeric_format = interpolation_numeric_format("");
            render_count.index = strings.intern(numeric_format + '\0');
            render_count.byte_count = static_cast<std::uint32_t>(numeric_format.size());
            builder.emit(std::move(render_count));
            emit_interpolation_concat(builder, true, true);
            store_string(result);
            Instruction one;
            one.opcode = Opcode::PushF64;
            one.f64 = 1.0;
            builder.emit(std::move(one));
            Instruction mark;
            mark.opcode = Opcode::StoreLocal;
            mark.index = emitted;
            builder.emit(std::move(mark));
            Instruction skip_label;
            skip_label.opcode = Opcode::Label;
            skip_label.label = skip;
            builder.emit(std::move(skip_label));
        }
        append_static("}");
        load_string(result);
        emit_static_string(builder, strings, "");
        store_string(result);
        return true;
    }
    if (layout.kind == ValueKind::DynamicF64List ||
        layout.kind == ValueKind::NumericMultiset) {
        const bool multiset = layout.kind == ValueKind::NumericMultiset;
        if (!format.empty()) {
            throw LoweringFailure("dynamic collection interpolation does not accept a format");
        }
        const ValueLayout string_layout{2, ValueKind::String, {}};
        const auto result = builder.add_owned_temporary(string_layout);
        const auto cursor = builder.add_borrowed_temporary({});
        const auto store_string = [&](std::uint32_t target) {
            for (std::uint32_t component = 2; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = target + component - 1;
                builder.emit(std::move(store));
            }
        };
        const auto load_string = [&](std::uint32_t source) {
            for (std::uint32_t component = 0; component < 2; ++component) {
                Instruction load;
                load.opcode = Opcode::LoadLocal;
                load.index = source + component;
                builder.emit(std::move(load));
            }
        };

        emit_static_string(builder, strings, multiset ? "{" : "[");
        store_string(result);
        Instruction zero;
        zero.opcode = Opcode::PushF64;
        zero.f64 = 0.0;
        builder.emit(std::move(zero));
        Instruction initialize_cursor;
        initialize_cursor.opcode = Opcode::StoreLocal;
        initialize_cursor.index = cursor;
        builder.emit(std::move(initialize_cursor));

        const auto loop = builder.next_label();
        const auto no_separator = builder.next_label();
        const auto finish = builder.next_label();
        Instruction loop_label;
        loop_label.opcode = Opcode::Label;
        loop_label.label = loop;
        builder.emit(std::move(loop_label));
        Instruction load_cursor;
        load_cursor.opcode = Opcode::LoadLocal;
        load_cursor.index = cursor;
        builder.emit(std::move(load_cursor));
        Instruction load_list_for_count;
        load_list_for_count.opcode = Opcode::LoadLocal;
        load_list_for_count.index = base;
        builder.emit(std::move(load_list_for_count));
        Instruction count;
        count.opcode = Opcode::CountF64List;
        count.owns_input = false;
        builder.emit(std::move(count));
        builder.emit({Opcode::OrderedLessF64});
        Instruction done;
        done.opcode = Opcode::JumpIfFalse;
        done.label = finish;
        builder.emit(std::move(done));

        Instruction separator_test;
        separator_test.opcode = Opcode::LoadLocal;
        separator_test.index = cursor;
        builder.emit(std::move(separator_test));
        Instruction skip_separator;
        skip_separator.opcode = Opcode::JumpIfFalse;
        skip_separator.label = no_separator;
        builder.emit(std::move(skip_separator));
        load_string(result);
        emit_static_string(builder, strings, ", ");
        emit_interpolation_concat(builder, true, false);
        store_string(result);
        Instruction separator_label;
        separator_label.opcode = Opcode::Label;
        separator_label.label = no_separator;
        builder.emit(std::move(separator_label));

        load_string(result);
        Instruction load_list;
        load_list.opcode = Opcode::LoadLocal;
        load_list.index = base;
        builder.emit(std::move(load_list));
        Instruction load_index;
        load_index.opcode = Opcode::LoadLocal;
        load_index.index = cursor;
        builder.emit(std::move(load_index));
        Instruction index;
        index.opcode = Opcode::LoadF64ListIndex;
        index.owns_input = false;
        index.may_error = true;
        const std::string message = "list index out of range";
        index.error_message_offset = strings.intern(message);
        index.byte_count = static_cast<std::uint32_t>(message.size());
        if (const auto handler = builder.error_handler()) {
            index.has_error_handler = true;
            index.label = *handler;
            index.error_value_local = *builder.error_value_local();
            index.error_type_local = *builder.error_type_local();
        }
        builder.emit(std::move(index));
        Instruction render;
        render.opcode = Opcode::FormatF64String;
        const std::string numeric_format = interpolation_numeric_format("");
        render.index = strings.intern(numeric_format + '\0');
        render.byte_count = static_cast<std::uint32_t>(numeric_format.size());
        builder.emit(std::move(render));
        emit_interpolation_concat(builder, true, true);
        store_string(result);

        if (multiset) {
            load_string(result);
            emit_static_string(builder, strings, ":");
            emit_interpolation_concat(builder, true, false);
            store_string(result);

            load_string(result);
            Instruction load_count_list;
            load_count_list.opcode = Opcode::LoadLocal;
            load_count_list.index = base;
            builder.emit(std::move(load_count_list));
            Instruction load_count_cursor;
            load_count_cursor.opcode = Opcode::LoadLocal;
            load_count_cursor.index = cursor;
            builder.emit(std::move(load_count_cursor));
            Instruction count_offset;
            count_offset.opcode = Opcode::PushF64;
            count_offset.f64 = 1.0;
            builder.emit(std::move(count_offset));
            builder.emit({Opcode::AddF64});
            Instruction load_count;
            load_count.opcode = Opcode::LoadF64ListIndex;
            load_count.owns_input = false;
            load_count.may_error = true;
            load_count.error_message_offset = strings.intern(message);
            load_count.byte_count = static_cast<std::uint32_t>(message.size());
            if (const auto handler = builder.error_handler()) {
                load_count.has_error_handler = true;
                load_count.label = *handler;
                load_count.error_value_local = *builder.error_value_local();
                load_count.error_type_local = *builder.error_type_local();
            }
            builder.emit(std::move(load_count));
            Instruction render_count;
            render_count.opcode = Opcode::FormatF64String;
            render_count.index = strings.intern(numeric_format + '\0');
            render_count.byte_count = static_cast<std::uint32_t>(numeric_format.size());
            builder.emit(std::move(render_count));
            emit_interpolation_concat(builder, true, true);
            store_string(result);
        }

        Instruction current;
        current.opcode = Opcode::LoadLocal;
        current.index = cursor;
        builder.emit(std::move(current));
        Instruction one;
        one.opcode = Opcode::PushF64;
        one.f64 = multiset ? 2.0 : 1.0;
        builder.emit(std::move(one));
        builder.emit({Opcode::AddF64});
        Instruction advance;
        advance.opcode = Opcode::StoreLocal;
        advance.index = cursor;
        builder.emit(std::move(advance));
        Instruction repeat;
        repeat.opcode = Opcode::Jump;
        repeat.label = loop;
        builder.emit(std::move(repeat));

        Instruction finish_label;
        finish_label.opcode = Opcode::Label;
        finish_label.label = finish;
        builder.emit(std::move(finish_label));
        load_string(result);
        emit_static_string(builder, strings, multiset ? "}" : "]");
        emit_interpolation_concat(builder, true, false);
        store_string(result);
        load_string(result);
        emit_static_string(builder, strings, "");
        store_string(result);
        return true;
    }
    if (layout.kind == ValueKind::Numeric) {
        Instruction load;
        load.opcode = Opcode::LoadLocal;
        load.index = base;
        builder.emit(std::move(load));
        if (shape.kind == DisplayKind::Bit) {
            if (!format.empty()) throw LoweringFailure("bit interpolation does not accept a format");
            Instruction render;
            render.opcode = Opcode::FormatBitString;
            render.index = strings.intern("false");
            render.error_message_offset = strings.intern("true");
            builder.emit(std::move(render));
            return false;
        }
        if (shape.kind == DisplayKind::Chr) {
            if (!format.empty()) throw LoweringFailure("chr interpolation does not accept a format");
            builder.emit({Opcode::FormatChrString});
            return true;
        }
        Instruction render;
        render.opcode = Opcode::FormatF64String;
        const std::string normalized = interpolation_numeric_format(format);
        // Native formatters consume C strings. Keep the byte count separate,
        // but terminate the pooled format string so adjacent constants cannot
        // become part of the format.
        render.index = strings.intern(normalized + '\0');
        render.byte_count = static_cast<std::uint32_t>(normalized.size());
        builder.emit(std::move(render));
        return true;
    }
    if (!format.empty()) throw LoweringFailure("aggregate interpolation does not accept a format");
    if (shape.kind != DisplayKind::Tuple && shape.kind != DisplayKind::Vector &&
        shape.kind != DisplayKind::Record) {
        shape = display_shape_from_layout(layout);
    }
    const auto fields = ordered_record_fields(layout);
    if (shape.children.size() != fields.size()) shape = display_shape_from_layout(layout);
    const std::string opening = shape.kind == DisplayKind::Vector ? "[" : "(";
    const std::string closing = shape.kind == DisplayKind::Vector ? "]" : ")";
    emit_static_string(
        builder, strings,
        (shape.kind == DisplayKind::Record ? shape.label : std::string{}) + opening);
    bool owns_result = false;
    for (std::size_t index = 0; index < fields.size(); ++index) {
        const auto& [name, slice] = fields[index];
        std::string prefix = index == 0 ? "" : ", ";
        if (shape.kind == DisplayKind::Record) prefix += name + ":";
        if (!prefix.empty()) {
            emit_static_string(builder, strings, prefix);
            emit_interpolation_concat(builder, owns_result, false);
            owns_result = true;
        }
        const auto child_layout = record_field_layout(layout, name, slice);
        const DisplayShape child_shape = index < shape.children.size()
            ? shape.children[index].second : display_shape_from_layout(child_layout);
        const bool owns_child = emit_local_interpolation_string(
            builder, strings, base + slice.offset, child_layout, child_shape, "");
        emit_interpolation_concat(builder, owns_result, owns_child);
        owns_result = true;
    }
    emit_static_string(builder, strings, closing);
    emit_interpolation_concat(builder, owns_result, false);
    return true;
}

inline bool lower_interpolation_value(
    const vf::JsonValue::Object& expression,
    const std::string& format,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures,
    StringPool& strings,
    const DisplayShape* display_override = nullptr
) {
    const auto layout = lower_expression(expression, builder, signatures, strings);
    ensure_independent_value(expression, layout, builder, signatures);
    const auto temporary = builder.add_owned_temporary(layout);
    for (std::uint32_t component = layout.width; component > 0; --component) {
        Instruction store;
        store.opcode = Opcode::StoreLocal;
        store.index = temporary + component - 1;
        builder.emit(std::move(store));
    }
    const auto shape = display_override
        ? *display_override
        : interpolation_display_shape(expression, layout, signatures);
    const bool owns_result = emit_local_interpolation_string(
        builder, strings, temporary, layout, shape, format);
    emit_release_layout_local(builder, temporary, layout);
    return owns_result;
}

inline ValueLayout lower_print_expression(
    const vf::JsonValue::Object& expression,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures,
    StringPool& strings,
    const DisplayShape* display_shape = nullptr
) {
    const auto layout = lower_expression(expression, builder, signatures, strings);
    if (layout.kind == ValueKind::Range) {
        const auto temporary = builder.add_borrowed_temporary(layout);
        Instruction store_infinite;
        store_infinite.opcode = Opcode::StoreLocal;
        store_infinite.index = temporary + 2u;
        builder.emit(std::move(store_infinite));
        Instruction store_end;
        store_end.opcode = Opcode::StoreLocal;
        store_end.index = temporary + 1u;
        builder.emit(std::move(store_end));
        Instruction store_start;
        store_start.opcode = Opcode::StoreLocal;
        store_start.index = temporary;
        builder.emit(std::move(store_start));
        emit_static_string(builder, strings, "range from ");
        Instruction load_start;
        load_start.opcode = Opcode::LoadLocal;
        load_start.index = temporary;
        builder.emit(std::move(load_start));
        Instruction render;
        render.opcode = Opcode::FormatF64String;
        const std::string numeric_format = interpolation_numeric_format("");
        render.index = strings.intern(numeric_format + '\0');
        render.byte_count = static_cast<std::uint32_t>(numeric_format.size());
        builder.emit(std::move(render));
        emit_interpolation_concat(builder, false, true);
        return {2, ValueKind::String, {}};
    }
    if (layout.kind == ValueKind::Numeric &&
        string_field(expression, "type", "printed expression") == "chr") {
        builder.emit({Opcode::FormatChrString});
        return {2, ValueKind::String, {}};
    }
    if (layout.kind == ValueKind::Aggregate) {
        const auto shape = display_shape
            ? *display_shape : display_shape_from_layout(layout);
        if (display_width(shape) == layout.width) return layout;
    }
    if (layout.kind != ValueKind::NumericMultiset &&
        layout.kind != ValueKind::StringMultiset &&
        layout.kind != ValueKind::DynamicF64List &&
        layout.kind != ValueKind::Aggregate) {
        return layout;
    }
    ensure_independent_value(expression, layout, builder, signatures);
    const auto temporary = builder.add_owned_temporary(layout);
    for (std::uint32_t component = layout.width; component > 0; --component) {
        Instruction store;
        store.opcode = Opcode::StoreLocal;
        store.index = temporary + component - 1;
        builder.emit(std::move(store));
    }
    emit_local_interpolation_string(
        builder, strings, temporary, layout,
        display_shape ? *display_shape : display_shape_from_layout(layout), "");
    emit_release_layout_local(builder, temporary, layout);
    return {2, ValueKind::String, {}};
}

inline void emit_load_local_component(
    FunctionBuilder& builder,
    std::uint32_t index
) {
    Instruction load;
    load.opcode = Opcode::LoadLocal;
    load.index = index;
    builder.emit(std::move(load));
}

inline void emit_store_local_component(
    FunctionBuilder& builder,
    std::uint32_t index
) {
    Instruction store;
    store.opcode = Opcode::StoreLocal;
    store.index = index;
    builder.emit(std::move(store));
}

inline void emit_string_local_comparison(
    FunctionBuilder& builder,
    std::uint32_t left,
    std::uint32_t right,
    Opcode opcode
) {
    emit_load_local_component(builder, left);
    emit_load_local_component(builder, left + 1u);
    emit_load_local_component(builder, right);
    emit_load_local_component(builder, right + 1u);
    builder.emit({opcode});
}

inline ValueLayout emit_normalize_string_multiset(
    FunctionBuilder& builder,
    const ValueLayout& layout
) {
    if (layout.kind != ValueKind::StringMultiset || layout.width % 3u != 0) {
        throw LoweringFailure("invalid fixed string multiset layout");
    }
    const auto temporary = builder.add_borrowed_temporary(layout);
    for (std::uint32_t component = layout.width; component > 0; --component) {
        emit_store_local_component(builder, temporary + component - 1u);
    }
    const std::uint32_t entries = layout.width / 3u;
    for (std::uint32_t entry = 0; entry < entries; ++entry) {
        const auto positive = builder.next_label();
        emit_load_local_component(builder, temporary + entry * 3u + 2u);
        Instruction zero;
        zero.opcode = Opcode::PushF64;
        zero.f64 = 0.0;
        builder.emit(std::move(zero));
        builder.emit({Opcode::OrderedGreaterF64});
        Instruction keep;
        keep.opcode = Opcode::JumpIfTrue;
        keep.label = positive;
        builder.emit(std::move(keep));
        Instruction replacement;
        replacement.opcode = Opcode::PushF64;
        replacement.f64 = 0.0;
        builder.emit(std::move(replacement));
        emit_store_local_component(builder, temporary + entry * 3u + 2u);
        Instruction positive_label;
        positive_label.opcode = Opcode::Label;
        positive_label.label = positive;
        builder.emit(std::move(positive_label));

        for (std::uint32_t previous = 0; previous < entry; ++previous) {
            const auto next = builder.next_label();
            emit_load_local_component(builder, temporary + entry * 3u + 2u);
            Instruction count_zero;
            count_zero.opcode = Opcode::PushF64;
            count_zero.f64 = 0.0;
            builder.emit(std::move(count_zero));
            builder.emit({Opcode::OrderedGreaterF64});
            Instruction skip_empty;
            skip_empty.opcode = Opcode::JumpIfFalse;
            skip_empty.label = next;
            builder.emit(std::move(skip_empty));
            emit_string_local_comparison(
                builder,
                temporary + entry * 3u,
                temporary + previous * 3u,
                Opcode::StringEqual);
            Instruction skip_different;
            skip_different.opcode = Opcode::JumpIfFalse;
            skip_different.label = next;
            builder.emit(std::move(skip_different));
            emit_load_local_component(builder, temporary + previous * 3u + 2u);
            emit_load_local_component(builder, temporary + entry * 3u + 2u);
            builder.emit({Opcode::AddF64});
            emit_store_local_component(builder, temporary + previous * 3u + 2u);
            Instruction clear;
            clear.opcode = Opcode::PushF64;
            clear.f64 = 0.0;
            builder.emit(std::move(clear));
            emit_store_local_component(builder, temporary + entry * 3u + 2u);
            Instruction next_label;
            next_label.opcode = Opcode::Label;
            next_label.label = next;
            builder.emit(std::move(next_label));
        }
    }

    for (std::uint32_t pass = 0; pass < entries; ++pass) {
        for (std::uint32_t entry = 0; entry + 1u < entries; ++entry) {
            const auto compare_keys = builder.next_label();
            const auto swap = builder.next_label();
            const auto next = builder.next_label();
            emit_load_local_component(builder, temporary + entry * 3u + 2u);
            Instruction zero;
            zero.opcode = Opcode::PushF64;
            zero.f64 = 0.0;
            builder.emit(std::move(zero));
            builder.emit({Opcode::OrderedGreaterF64});
            Instruction left_positive;
            left_positive.opcode = Opcode::JumpIfTrue;
            left_positive.label = compare_keys;
            builder.emit(std::move(left_positive));
            emit_load_local_component(builder, temporary + (entry + 1u) * 3u + 2u);
            Instruction right_zero;
            right_zero.opcode = Opcode::PushF64;
            right_zero.f64 = 0.0;
            builder.emit(std::move(right_zero));
            builder.emit({Opcode::OrderedGreaterF64});
            Instruction move_positive_right;
            move_positive_right.opcode = Opcode::JumpIfTrue;
            move_positive_right.label = swap;
            builder.emit(std::move(move_positive_right));
            Instruction skip_both_empty;
            skip_both_empty.opcode = Opcode::Jump;
            skip_both_empty.label = next;
            builder.emit(std::move(skip_both_empty));

            Instruction compare_label;
            compare_label.opcode = Opcode::Label;
            compare_label.label = compare_keys;
            builder.emit(std::move(compare_label));
            emit_load_local_component(builder, temporary + (entry + 1u) * 3u + 2u);
            Instruction zero_right;
            zero_right.opcode = Opcode::PushF64;
            zero_right.f64 = 0.0;
            builder.emit(std::move(zero_right));
            builder.emit({Opcode::OrderedGreaterF64});
            Instruction skip_empty_right;
            skip_empty_right.opcode = Opcode::JumpIfFalse;
            skip_empty_right.label = next;
            builder.emit(std::move(skip_empty_right));
            emit_string_local_comparison(
                builder,
                temporary + entry * 3u,
                temporary + (entry + 1u) * 3u,
                Opcode::StringGreater);
            Instruction already_sorted;
            already_sorted.opcode = Opcode::JumpIfFalse;
            already_sorted.label = next;
            builder.emit(std::move(already_sorted));

            Instruction swap_label;
            swap_label.opcode = Opcode::Label;
            swap_label.label = swap;
            builder.emit(std::move(swap_label));
            for (std::uint32_t component = 0; component < 3u; ++component) {
                emit_load_local_component(builder, temporary + entry * 3u + component);
                emit_load_local_component(builder, temporary + (entry + 1u) * 3u + component);
                emit_store_local_component(builder, temporary + entry * 3u + component);
                emit_store_local_component(builder, temporary + (entry + 1u) * 3u + component);
            }
            Instruction next_label;
            next_label.opcode = Opcode::Label;
            next_label.label = next;
            builder.emit(std::move(next_label));
        }
    }
    for (std::uint32_t component = 0; component < layout.width; ++component) {
        emit_load_local_component(builder, temporary + component);
    }
    return layout;
}

inline void emit_clone_string_multiset_entries(
    FunctionBuilder& builder,
    std::uint32_t base,
    const ValueLayout& layout
) {
    const std::uint32_t entries = layout.width / 3u;
    for (std::uint32_t entry = 0; entry < entries; ++entry) {
        emit_load_local_component(builder, base + entry * 3u);
        emit_load_local_component(builder, base + entry * 3u + 1u);
        builder.emit({Opcode::CloneString});
        emit_load_local_component(builder, base + entry * 3u + 2u);
    }
}

inline ValueLayout emit_widen_complex(FunctionBuilder& builder, const ValueLayout& layout) {
    if (layout.kind == ValueKind::Complex) return layout;
    if (layout.kind != ValueKind::Numeric || layout.width != 1) {
        throw LoweringFailure("complex arithmetic requires numeric operands");
    }
    Instruction zero;
    zero.opcode = Opcode::PushF64;
    zero.f64 = 0.0;
    builder.emit(std::move(zero));
    return {2, ValueKind::Complex, {}};
}

inline ValueLayout emit_require_real_complex(
    FunctionBuilder& builder,
    StringPool& strings,
    const ValueLayout& layout,
    const std::string& message
) {
    if (layout.kind != ValueKind::Complex) return layout;
    const auto value = builder.add_borrowed_temporary(layout);
    emit_store_local_component(builder, value + 1u);
    emit_store_local_component(builder, value);
    emit_load_local_component(builder, value + 1u);
    Instruction zero;
    zero.opcode = Opcode::PushF64;
    zero.f64 = 0.0;
    builder.emit(std::move(zero));
    builder.emit({Opcode::OrderedEqualF64});
    Instruction check;
    check.opcode = Opcode::AssertTruthy;
    check.index = strings.intern(message);
    check.byte_count = static_cast<std::uint32_t>(message.size());
    check.error_type_mask = value_error_mask;
    if (const auto handler = builder.error_handler()) {
        check.has_error_handler = true;
        check.label = *handler;
        check.error_value_local = *builder.error_value_local();
        check.error_type_local = *builder.error_type_local();
    }
    builder.emit(std::move(check));
    builder.emit({Opcode::Drop});
    emit_load_local_component(builder, value);
    return {};
}

inline void emit_complex_binary_arithmetic(
    FunctionBuilder& builder,
    const std::string& op,
    const ValueLayout& left,
    const ValueLayout& right
) {
    const auto right_value = builder.add_borrowed_temporary(right);
    for (std::uint32_t component = right.width; component > 0; --component) {
        emit_store_local_component(builder, right_value + component - 1u);
    }
    const auto left_value = builder.add_borrowed_temporary(left);
    for (std::uint32_t component = left.width; component > 0; --component) {
        emit_store_local_component(builder, left_value + component - 1u);
    }
    const auto load = [&](bool from_left, std::uint32_t component) {
        const auto& layout = from_left ? left : right;
        if (component == 1u && layout.kind != ValueKind::Complex) {
            Instruction zero;
            zero.opcode = Opcode::PushF64;
            zero.f64 = 0.0;
            builder.emit(std::move(zero));
            return;
        }
        emit_load_local_component(builder, (from_left ? left_value : right_value) + component);
    };
    if (op == "PLUS" || op == "MINUS") {
        load(true, 0); load(false, 0);
        builder.emit({op == "PLUS" ? Opcode::AddF64 : Opcode::SubtractF64});
        load(true, 1); load(false, 1);
        builder.emit({op == "PLUS" ? Opcode::AddF64 : Opcode::SubtractF64});
        return;
    }
    if (op == "STAR") {
        load(true, 0); load(false, 0); builder.emit({Opcode::MultiplyF64});
        load(true, 1); load(false, 1); builder.emit({Opcode::MultiplyF64});
        builder.emit({Opcode::SubtractF64});
        load(true, 0); load(false, 1); builder.emit({Opcode::MultiplyF64});
        load(true, 1); load(false, 0); builder.emit({Opcode::MultiplyF64});
        builder.emit({Opcode::AddF64});
        return;
    }
    if (op == "SLASH") {
        const auto denominator = builder.add_borrowed_temporary({});
        load(false, 0); load(false, 0); builder.emit({Opcode::MultiplyF64});
        load(false, 1); load(false, 1); builder.emit({Opcode::MultiplyF64});
        builder.emit({Opcode::AddF64});
        emit_store_local_component(builder, denominator);
        load(true, 0); load(false, 0); builder.emit({Opcode::MultiplyF64});
        load(true, 1); load(false, 1); builder.emit({Opcode::MultiplyF64});
        builder.emit({Opcode::AddF64});
        emit_load_local_component(builder, denominator);
        builder.emit({Opcode::DivideF64});
        load(true, 1); load(false, 0); builder.emit({Opcode::MultiplyF64});
        load(true, 0); load(false, 1); builder.emit({Opcode::MultiplyF64});
        builder.emit({Opcode::SubtractF64});
        emit_load_local_component(builder, denominator);
        builder.emit({Opcode::DivideF64});
        return;
    }
    throw LoweringFailure("complex operator " + op + " is not implemented");
}

inline void emit_push_f64(FunctionBuilder& builder, double value) {
    Instruction constant;
    constant.opcode = Opcode::PushF64;
    constant.f64 = value;
    builder.emit(std::move(constant));
}

// Consumes one real value and emits atan(value). Two half-angle reductions
// keep the final Gregory series inside |x| <= tan(pi/8).
inline void emit_complex_atan_f64(FunctionBuilder& builder) {
    auto value = builder.add_borrowed_temporary({});
    emit_store_local_component(builder, value);
    for (unsigned reduction = 0; reduction < 2; ++reduction) {
        emit_load_local_component(builder, value);
        emit_load_local_component(builder, value);
        emit_load_local_component(builder, value);
        builder.emit({Opcode::MultiplyF64});
        emit_push_f64(builder, 1.0);
        builder.emit({Opcode::AddF64});
        builder.emit({Opcode::SqrtF64});
        emit_push_f64(builder, 1.0);
        builder.emit({Opcode::AddF64});
        builder.emit({Opcode::DivideF64});
        emit_store_local_component(builder, value);
    }
    const auto squared = builder.add_borrowed_temporary({});
    emit_load_local_component(builder, value);
    emit_load_local_component(builder, value);
    builder.emit({Opcode::MultiplyF64});
    emit_store_local_component(builder, squared);
    const auto term = builder.add_borrowed_temporary({});
    const auto sum = builder.add_borrowed_temporary({});
    emit_load_local_component(builder, value);
    emit_store_local_component(builder, term);
    emit_load_local_component(builder, value);
    emit_store_local_component(builder, sum);
    for (unsigned index = 1; index < 16; ++index) {
        emit_load_local_component(builder, term);
        builder.emit({Opcode::NegateF64});
        emit_load_local_component(builder, squared);
        builder.emit({Opcode::MultiplyF64});
        emit_store_local_component(builder, term);
        emit_load_local_component(builder, sum);
        emit_load_local_component(builder, term);
        emit_push_f64(builder, static_cast<double>(2 * index + 1));
        builder.emit({Opcode::DivideF64});
        builder.emit({Opcode::AddF64});
        emit_store_local_component(builder, sum);
    }
    emit_load_local_component(builder, sum);
    emit_push_f64(builder, 4.0);
    builder.emit({Opcode::MultiplyF64});
}

inline ValueLayout emit_complex_elementary_math(
    FunctionBuilder& builder,
    const std::string& symbol,
    const ValueLayout& argument
) {
    if (argument.kind != ValueKind::Complex) {
        throw LoweringFailure("complex math requires a complex scalar");
    }
    const auto value = builder.add_borrowed_temporary(argument);
    emit_store_local_component(builder, value + 1u);
    emit_store_local_component(builder, value);
    const auto load_real = [&] { emit_load_local_component(builder, value); };
    const auto load_imaginary = [&] { emit_load_local_component(builder, value + 1u); };

    const auto magnitude = [&] {
        load_real(); load_real(); builder.emit({Opcode::MultiplyF64});
        load_imaginary(); load_imaginary(); builder.emit({Opcode::MultiplyF64});
        builder.emit({Opcode::AddF64});
        builder.emit({Opcode::SqrtF64});
    };
    if (symbol == "abs") {
        magnitude();
        return {};
    }
    if (symbol == "exp") {
        const auto scale = builder.add_borrowed_temporary({});
        load_real(); builder.emit({Opcode::ExpF64});
        emit_store_local_component(builder, scale);
        emit_load_local_component(builder, scale);
        load_imaginary(); builder.emit({Opcode::CosF64});
        builder.emit({Opcode::MultiplyF64});
        emit_load_local_component(builder, scale);
        load_imaginary(); builder.emit({Opcode::SinF64});
        builder.emit({Opcode::MultiplyF64});
        return {2, ValueKind::Complex, {}};
    }
    if (symbol == "sin" || symbol == "cos") {
        const auto positive = builder.add_borrowed_temporary({});
        const auto negative = builder.add_borrowed_temporary({});
        const auto hyperbolic_cosine = builder.add_borrowed_temporary({});
        const auto hyperbolic_sine = builder.add_borrowed_temporary({});
        load_imaginary(); builder.emit({Opcode::ExpF64});
        emit_store_local_component(builder, positive);
        load_imaginary(); builder.emit({Opcode::NegateF64}); builder.emit({Opcode::ExpF64});
        emit_store_local_component(builder, negative);
        emit_load_local_component(builder, positive);
        emit_load_local_component(builder, negative);
        builder.emit({Opcode::AddF64}); emit_push_f64(builder, 2.0);
        builder.emit({Opcode::DivideF64});
        emit_store_local_component(builder, hyperbolic_cosine);
        emit_load_local_component(builder, positive);
        emit_load_local_component(builder, negative);
        builder.emit({Opcode::SubtractF64}); emit_push_f64(builder, 2.0);
        builder.emit({Opcode::DivideF64});
        emit_store_local_component(builder, hyperbolic_sine);
        load_real(); builder.emit({symbol == "sin" ? Opcode::SinF64 : Opcode::CosF64});
        emit_load_local_component(builder, hyperbolic_cosine);
        builder.emit({Opcode::MultiplyF64});
        load_real(); builder.emit({symbol == "sin" ? Opcode::CosF64 : Opcode::SinF64});
        emit_load_local_component(builder, hyperbolic_sine);
        builder.emit({Opcode::MultiplyF64});
        if (symbol == "cos") builder.emit({Opcode::NegateF64});
        return {2, ValueKind::Complex, {}};
    }
    if (symbol == "sqrt") {
        const auto radius = builder.add_borrowed_temporary({});
        magnitude(); emit_store_local_component(builder, radius);
        emit_load_local_component(builder, radius); load_real();
        builder.emit({Opcode::AddF64}); emit_push_f64(builder, 2.0);
        builder.emit({Opcode::DivideF64}); builder.emit({Opcode::SqrtF64});
        emit_load_local_component(builder, radius); load_real();
        builder.emit({Opcode::SubtractF64}); emit_push_f64(builder, 2.0);
        builder.emit({Opcode::DivideF64}); builder.emit({Opcode::SqrtF64});
        load_imaginary(); emit_push_f64(builder, 0.0);
        builder.emit({Opcode::OrderedGreaterEqualF64});
        emit_push_f64(builder, 2.0); builder.emit({Opcode::MultiplyF64});
        emit_push_f64(builder, 1.0); builder.emit({Opcode::SubtractF64});
        builder.emit({Opcode::MultiplyF64});
        return {2, ValueKind::Complex, {}};
    }
    if (symbol == "ln") {
        const auto radius = builder.add_borrowed_temporary({});
        const auto real_part = builder.add_borrowed_temporary({});
        const auto angle = builder.add_borrowed_temporary({});
        magnitude(); emit_store_local_component(builder, radius);
        emit_load_local_component(builder, radius); builder.emit({Opcode::LnF64});
        emit_store_local_component(builder, real_part);

        const auto negative_real = builder.next_label();
        const auto negative_imaginary = builder.next_label();
        const auto angle_done = builder.next_label();
        load_real(); emit_push_f64(builder, 0.0);
        builder.emit({Opcode::OrderedGreaterEqualF64});
        Instruction choose_negative_real;
        choose_negative_real.opcode = Opcode::JumpIfFalse;
        choose_negative_real.label = negative_real;
        builder.emit(std::move(choose_negative_real));
        load_imaginary(); emit_load_local_component(builder, radius); load_real();
        builder.emit({Opcode::AddF64}); builder.emit({Opcode::DivideF64});
        emit_complex_atan_f64(builder); emit_push_f64(builder, 2.0);
        builder.emit({Opcode::MultiplyF64}); emit_store_local_component(builder, angle);
        Instruction jump_angle_done;
        jump_angle_done.opcode = Opcode::Jump;
        jump_angle_done.label = angle_done;
        builder.emit(jump_angle_done);

        Instruction negative_real_label;
        negative_real_label.opcode = Opcode::Label;
        negative_real_label.label = negative_real;
        builder.emit(std::move(negative_real_label));
        load_imaginary(); emit_push_f64(builder, 0.0);
        builder.emit({Opcode::OrderedGreaterEqualF64});
        Instruction choose_negative_imaginary;
        choose_negative_imaginary.opcode = Opcode::JumpIfFalse;
        choose_negative_imaginary.label = negative_imaginary;
        builder.emit(std::move(choose_negative_imaginary));
        emit_push_f64(builder, 3.14159265358979323846);
        load_imaginary(); emit_load_local_component(builder, radius); load_real();
        builder.emit({Opcode::SubtractF64}); builder.emit({Opcode::DivideF64});
        emit_complex_atan_f64(builder); emit_push_f64(builder, 2.0);
        builder.emit({Opcode::MultiplyF64}); builder.emit({Opcode::SubtractF64});
        emit_store_local_component(builder, angle);
        builder.emit(jump_angle_done);

        Instruction negative_imaginary_label;
        negative_imaginary_label.opcode = Opcode::Label;
        negative_imaginary_label.label = negative_imaginary;
        builder.emit(std::move(negative_imaginary_label));
        emit_push_f64(builder, -3.14159265358979323846);
        load_imaginary(); emit_load_local_component(builder, radius); load_real();
        builder.emit({Opcode::SubtractF64}); builder.emit({Opcode::DivideF64});
        emit_complex_atan_f64(builder); emit_push_f64(builder, 2.0);
        builder.emit({Opcode::MultiplyF64}); builder.emit({Opcode::SubtractF64});
        emit_store_local_component(builder, angle);

        Instruction angle_done_label;
        angle_done_label.opcode = Opcode::Label;
        angle_done_label.label = angle_done;
        builder.emit(std::move(angle_done_label));
        emit_load_local_component(builder, real_part);
        emit_load_local_component(builder, angle);
        return {2, ValueKind::Complex, {}};
    }
    throw LoweringFailure("unsupported complex elementary math function " + symbol);
}

inline void emit_complex_comparison(
    FunctionBuilder& builder,
    StringPool& strings,
    const std::string& op,
    const ValueLayout& left,
    const ValueLayout& right
) {
    const auto right_value = builder.add_borrowed_temporary(right);
    for (std::uint32_t component = right.width; component > 0; --component) {
        emit_store_local_component(builder, right_value + component - 1u);
    }
    const auto left_value = builder.add_borrowed_temporary(left);
    for (std::uint32_t component = left.width; component > 0; --component) {
        emit_store_local_component(builder, left_value + component - 1u);
    }
    const auto load = [&](bool from_left, std::uint32_t component) {
        const auto& layout = from_left ? left : right;
        if (component == 1u && layout.kind != ValueKind::Complex) {
            Instruction zero;
            zero.opcode = Opcode::PushF64;
            zero.f64 = 0.0;
            builder.emit(std::move(zero));
            return;
        }
        emit_load_local_component(builder, (from_left ? left_value : right_value) + component);
    };
    if (op == "EQ" || op == "EXACT_EQ" || op == "NE" || op == "NEQ" ||
        op == "STRUCT_NEQ") {
        load(true, 0); load(false, 0); builder.emit({Opcode::OrderedEqualF64});
        load(true, 1); load(false, 1); builder.emit({Opcode::OrderedEqualF64});
        builder.emit({Opcode::MultiplyF64});
        if (op == "NE" || op == "NEQ" || op == "STRUCT_NEQ") {
            builder.emit({Opcode::LogicalNotF64});
        }
        return;
    }
    const std::string message = "ordering is only defined for real num values";
    const auto require_zero = [&](bool from_left) {
        load(from_left, 1);
        Instruction zero;
        zero.opcode = Opcode::PushF64;
        zero.f64 = 0.0;
        builder.emit(std::move(zero));
        builder.emit({Opcode::OrderedEqualF64});
        Instruction check;
        check.opcode = Opcode::AssertTruthy;
        check.index = strings.intern(message);
        check.byte_count = static_cast<std::uint32_t>(message.size());
        check.error_type_mask = value_error_mask;
        if (const auto handler = builder.error_handler()) {
            check.has_error_handler = true;
            check.label = *handler;
            check.error_value_local = *builder.error_value_local();
            check.error_type_local = *builder.error_type_local();
        }
        builder.emit(std::move(check));
        builder.emit({Opcode::Drop});
    };
    require_zero(true);
    require_zero(false);
    load(true, 0); load(false, 0);
    const auto opcode = scalar_binary_opcode(op);
    if (!opcode) throw LoweringFailure("unsupported complex comparison " + op);
    builder.emit({*opcode});
}

inline ValueLayout emit_complex_string(
    FunctionBuilder& builder,
    StringPool& strings
) {
    const ValueLayout complex_layout{2, ValueKind::Complex, {}};
    const ValueLayout string_layout{2, ValueKind::String, {}};
    const auto value = builder.add_borrowed_temporary(complex_layout);
    emit_store_local_component(builder, value + 1u);
    emit_store_local_component(builder, value);
    const auto result = builder.add_owned_temporary(string_layout);
    const auto format_number = [&]() {
        Instruction render;
        render.opcode = Opcode::FormatF64String;
        const std::string format = interpolation_numeric_format("");
        render.index = strings.intern(format + '\0');
        render.byte_count = static_cast<std::uint32_t>(format.size());
        builder.emit(std::move(render));
    };
    const auto store_result = [&]() {
        emit_store_local_component(builder, result + 1u);
        emit_store_local_component(builder, result);
    };
    const auto concat_static = [&](const std::string& text, bool owns_left) {
        emit_static_string(builder, strings, text);
        Instruction concat;
        concat.opcode = Opcode::ConcatStrings;
        concat.owns_left = owns_left;
        concat.owns_right = false;
        builder.emit(std::move(concat));
    };
    const auto equal_constant = [&](std::uint32_t component, double constant) {
        emit_load_local_component(builder, value + component);
        Instruction expected;
        expected.opcode = Opcode::PushF64;
        expected.f64 = constant;
        builder.emit(std::move(expected));
        builder.emit({Opcode::OrderedEqualF64});
    };

    const auto non_real = builder.next_label();
    const auto both_parts = builder.next_label();
    const auto pure_not_one = builder.next_label();
    const auto pure_not_minus_one = builder.next_label();
    const auto positive_imag = builder.next_label();
    const auto sign_ready = builder.next_label();
    const auto magnitude_not_one = builder.next_label();
    const auto finish = builder.next_label();

    equal_constant(1u, 0.0);
    Instruction has_imag;
    has_imag.opcode = Opcode::JumpIfFalse;
    has_imag.label = non_real;
    builder.emit(std::move(has_imag));
    emit_load_local_component(builder, value);
    format_number();
    store_result();
    Instruction finish_real;
    finish_real.opcode = Opcode::Jump;
    finish_real.label = finish;
    builder.emit(std::move(finish_real));

    Instruction non_real_label;
    non_real_label.opcode = Opcode::Label;
    non_real_label.label = non_real;
    builder.emit(std::move(non_real_label));
    equal_constant(0u, 0.0);
    Instruction has_real;
    has_real.opcode = Opcode::JumpIfFalse;
    has_real.label = both_parts;
    builder.emit(std::move(has_real));
    equal_constant(1u, 1.0);
    Instruction not_one;
    not_one.opcode = Opcode::JumpIfFalse;
    not_one.label = pure_not_one;
    builder.emit(std::move(not_one));
    emit_static_string(builder, strings, "i");
    builder.emit({Opcode::CloneString});
    store_result();
    Instruction finish_i;
    finish_i.opcode = Opcode::Jump;
    finish_i.label = finish;
    builder.emit(std::move(finish_i));

    Instruction pure_not_one_label;
    pure_not_one_label.opcode = Opcode::Label;
    pure_not_one_label.label = pure_not_one;
    builder.emit(std::move(pure_not_one_label));
    equal_constant(1u, -1.0);
    Instruction not_minus_one;
    not_minus_one.opcode = Opcode::JumpIfFalse;
    not_minus_one.label = pure_not_minus_one;
    builder.emit(std::move(not_minus_one));
    emit_static_string(builder, strings, "-i");
    builder.emit({Opcode::CloneString});
    store_result();
    Instruction finish_minus_i;
    finish_minus_i.opcode = Opcode::Jump;
    finish_minus_i.label = finish;
    builder.emit(std::move(finish_minus_i));

    Instruction pure_not_minus_one_label;
    pure_not_minus_one_label.opcode = Opcode::Label;
    pure_not_minus_one_label.label = pure_not_minus_one;
    builder.emit(std::move(pure_not_minus_one_label));
    emit_load_local_component(builder, value + 1u);
    format_number();
    concat_static("i", true);
    store_result();
    Instruction finish_pure;
    finish_pure.opcode = Opcode::Jump;
    finish_pure.label = finish;
    builder.emit(std::move(finish_pure));

    Instruction both_parts_label;
    both_parts_label.opcode = Opcode::Label;
    both_parts_label.label = both_parts;
    builder.emit(std::move(both_parts_label));
    emit_load_local_component(builder, value);
    format_number();
    store_result();
    emit_load_local_component(builder, value + 1u);
    Instruction zero;
    zero.opcode = Opcode::PushF64;
    zero.f64 = 0.0;
    builder.emit(std::move(zero));
    builder.emit({Opcode::OrderedLessF64});
    Instruction positive;
    positive.opcode = Opcode::JumpIfFalse;
    positive.label = positive_imag;
    builder.emit(std::move(positive));
    emit_load_local_component(builder, result);
    emit_load_local_component(builder, result + 1u);
    builder.emit({Opcode::CloneString});
    concat_static(" - ", true);
    emit_release_layout_local(builder, result, string_layout);
    store_result();
    emit_load_local_component(builder, value + 1u);
    builder.emit({Opcode::NegateF64});
    const auto imag_magnitude = builder.add_borrowed_temporary({});
    emit_store_local_component(builder, imag_magnitude);
    Instruction join_magnitude;
    join_magnitude.opcode = Opcode::Jump;
    join_magnitude.label = sign_ready;
    builder.emit(std::move(join_magnitude));
    Instruction magnitude_label;
    magnitude_label.opcode = Opcode::Label;
    magnitude_label.label = positive_imag;
    builder.emit(std::move(magnitude_label));
    emit_load_local_component(builder, result);
    emit_load_local_component(builder, result + 1u);
    builder.emit({Opcode::CloneString});
    concat_static(" + ", true);
    emit_release_layout_local(builder, result, string_layout);
    store_result();
    emit_load_local_component(builder, value + 1u);
    emit_store_local_component(builder, imag_magnitude);
    Instruction negative_imag_label;
    negative_imag_label.opcode = Opcode::Label;
    negative_imag_label.label = sign_ready;
    builder.emit(std::move(negative_imag_label));
    emit_load_local_component(builder, imag_magnitude);
    Instruction one;
    one.opcode = Opcode::PushF64;
    one.f64 = 1.0;
    builder.emit(std::move(one));
    builder.emit({Opcode::OrderedEqualF64});
    Instruction render_magnitude;
    render_magnitude.opcode = Opcode::JumpIfFalse;
    render_magnitude.label = magnitude_not_one;
    builder.emit(std::move(render_magnitude));
    emit_load_local_component(builder, result);
    emit_load_local_component(builder, result + 1u);
    builder.emit({Opcode::CloneString});
    emit_static_string(builder, strings, "i");
    Instruction concat_i;
    concat_i.opcode = Opcode::ConcatStrings;
    concat_i.owns_left = true;
    concat_i.owns_right = false;
    builder.emit(std::move(concat_i));
    emit_release_layout_local(builder, result, string_layout);
    store_result();
    Instruction finish_both_one;
    finish_both_one.opcode = Opcode::Jump;
    finish_both_one.label = finish;
    builder.emit(std::move(finish_both_one));
    Instruction magnitude_not_one_label;
    magnitude_not_one_label.opcode = Opcode::Label;
    magnitude_not_one_label.label = magnitude_not_one;
    builder.emit(std::move(magnitude_not_one_label));
    emit_load_local_component(builder, result);
    emit_load_local_component(builder, result + 1u);
    builder.emit({Opcode::CloneString});
    emit_load_local_component(builder, imag_magnitude);
    format_number();
    Instruction concat_magnitude;
    concat_magnitude.opcode = Opcode::ConcatStrings;
    concat_magnitude.owns_left = true;
    concat_magnitude.owns_right = true;
    builder.emit(std::move(concat_magnitude));
    concat_static("i", true);
    emit_release_layout_local(builder, result, string_layout);
    store_result();

    Instruction finish_label;
    finish_label.opcode = Opcode::Label;
    finish_label.label = finish;
    builder.emit(std::move(finish_label));
    emit_load_local_component(builder, result);
    emit_load_local_component(builder, result + 1u);
    builder.emit({Opcode::CloneString});
    emit_release_layout_local(builder, result, string_layout);
    return string_layout;
}

inline bool component_lowering_eligible(
    const vf::JsonValue::Object& expression,
    const FunctionSignatures& signatures
) {
    const auto layout = layout_from_expression_shape(expression, signatures);
    if (layout.kind == ValueKind::Numeric && layout.width == 1u) return true;
    if (layout.kind != ValueKind::Aggregate || !is_numeric_layout(layout) ||
        is_record_layout(layout)) {
        return false;
    }
    const std::string kind = string_field(
        expression, "kind", "component expression");
    if (kind == "load" || kind == "field_access" || kind == "dotted_attr" ||
        kind == "dotted_index") {
        return true;
    }
    if (kind != "binary_op") return false;
    const std::string op = string_field(
        expression, "op", "component binary expression");
    if (op != "PLUS" && op != "MINUS" && op != "STAR" && op != "SLASH") {
        return false;
    }
    return component_lowering_eligible(
               object_of(
                   field(expression, "left", "component binary expression"),
                   "component binary left"),
               signatures) &&
        component_lowering_eligible(
            object_of(
                field(expression, "right", "component binary expression"),
                "component binary right"),
            signatures);
}

inline std::optional<std::pair<double, double>> numeric_interval_of(
    const vf::JsonValue::Object& expression,
    FunctionBuilder& builder
) {
    const std::string kind = string_field(expression, "kind", "numeric interval");
    if (kind == "const") {
        const auto found = expression.find("value");
        if (found != expression.end() && found->second.is_number()) {
            const double value = found->second.as_number();
            return std::pair<double, double>{value, value};
        }
        return std::nullopt;
    }
    if (kind == "load") {
        return builder.numeric_interval(
            builder.slot(string_field(expression, "name", "numeric interval load")));
    }
    if (kind != "binary_op") return std::nullopt;
    const auto left = numeric_interval_of(
        object_of(field(expression, "left", "numeric interval binary"),
                  "numeric interval left"),
        builder);
    const auto right = numeric_interval_of(
        object_of(field(expression, "right", "numeric interval binary"),
                  "numeric interval right"),
        builder);
    if (!left || !right) return std::nullopt;
    const std::string op = string_field(expression, "op", "numeric interval binary");
    if (op == "PLUS") {
        return std::pair<double, double>{
            left->first + right->first, left->second + right->second};
    }
    if (op == "MINUS") {
        return std::pair<double, double>{
            left->first - right->second, left->second - right->first};
    }
    return std::nullopt;
}

inline bool fixed_index_proven(
    FunctionBuilder& builder,
    std::uint32_t local,
    std::uint32_t count,
    bool integral
) {
    const auto interval = builder.numeric_interval(local);
    return integral && interval && interval->first >= 0.0 &&
        interval->second < static_cast<double>(count);
}

inline bool numeric_expression_is_integral(
    const vf::JsonValue::Object& expression,
    FunctionBuilder& builder
) {
    const std::string kind = string_field(expression, "kind", "integral expression");
    if (kind == "const") {
        const auto found = expression.find("value");
        return found != expression.end() && found->second.is_number() &&
            std::isfinite(found->second.as_number()) &&
            found->second.as_number() == std::floor(found->second.as_number());
    }
    if (kind == "load") {
        return builder.local_is_integral(
            builder.slot(string_field(expression, "name", "integral expression load")));
    }
    if (kind != "binary_op") return false;
    const std::string op = string_field(expression, "op", "integral binary expression");
    return (op == "PLUS" || op == "MINUS" || op == "STAR") &&
        numeric_expression_is_integral(
            object_of(field(expression, "left", "integral binary expression"),
                      "integral binary left"),
            builder) &&
        numeric_expression_is_integral(
            object_of(field(expression, "right", "integral binary expression"),
                      "integral binary right"),
            builder);
}

inline bool lower_numeric_component(
    const vf::JsonValue::Object& expression,
    std::uint32_t component,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures,
    StringPool& strings
) {
    const auto layout = layout_from_expression_shape(expression, signatures);
    if (layout.kind == ValueKind::Numeric && layout.width == 1u) {
        const std::string scalar_kind = string_field(
            expression, "kind", "component scalar expression");
        if (scalar_kind == "load") {
            emit_load_local_component(
                builder,
                builder.slot(string_field(
                    expression, "name", "component scalar load")));
            return true;
        }
        if (scalar_kind == "field_access" || scalar_kind == "dotted_attr") {
            const auto projection = projection_of(expression);
            const auto& root = builder.layout(projection.binding);
            const auto selected = root.selectors.find(projection.path);
            if (selected == root.selectors.end() || selected->second.width != 1u) {
                return false;
            }
            emit_load_local_component(
                builder,
                builder.slot(projection.binding, selected->second.offset));
            return true;
        }
        const auto [local, initialize] =
            builder.component_scalar_local(&expression);
        if (initialize) {
            const auto scalar = lower_expression(
                expression, builder, signatures, strings);
            require_scalar(scalar, "component scalar");
            emit_store_local_component(builder, local);
        }
        emit_load_local_component(builder, local);
        return true;
    }
    if (component >= layout.width || layout.kind != ValueKind::Aggregate ||
        !is_numeric_layout(layout) || is_record_layout(layout)) {
        return false;
    }
    const std::string kind = string_field(
        expression, "kind", "component expression");
    if (kind == "list" || kind == "tuple") {
        std::uint32_t offset = 0u;
        for (const auto& raw_item : array_of(
                 field(expression, "items", "component collection"),
                 "component collection items")) {
            const auto& item = object_of(raw_item, "component collection item");
            const bool spread =
                string_field(item, "kind", "component collection item") == "spread";
            const auto& value = spread
                ? object_of(field(item, "value", "component spread"),
                            "component spread value")
                : item;
            const auto item_layout =
                layout_from_expression_shape(value, signatures);
            if (component < offset + item_layout.width) {
                return lower_numeric_component(
                    value, component - offset, builder, signatures, strings);
            }
            offset += item_layout.width;
        }
        return false;
    }
    if (kind == "load") {
        emit_load_local_component(
            builder,
            builder.slot(
                string_field(expression, "name", "component load"),
                component));
        return true;
    }
    if (kind == "field_access" || kind == "dotted_attr") {
        const auto projection = projection_of(expression);
        const auto& root = builder.layout(projection.binding);
        const auto selected = root.selectors.find(projection.path);
        if (selected == root.selectors.end() ||
            component >= selected->second.width) {
            return false;
        }
        emit_load_local_component(
            builder,
            builder.slot(
                projection.binding,
                selected->second.offset + component));
        return true;
    }
    if (kind == "dotted_index") {
        const auto& base = object_of(
            field(expression, "base", "component index"),
            "component index base");
        if (string_field(base, "kind", "component index base") != "load") {
            return false;
        }
        const auto& indices = array_of(
            field(expression, "indices", "component index"),
            "component indices");
        if (indices.size() != 1u) return false;
        const auto& index_expression = object_of(
            indices.front(), "component index");
        const std::string binding = string_field(
            base, "name", "component index base");
        const auto& base_layout = builder.layout(binding);
        const auto elements = indexed_element_layouts(base_layout);
        if (elements.empty() || component >= elements.front().width) {
            return false;
        }
        std::uint32_t source_index_local = 0;
        if (string_field(
                index_expression, "kind", "component index") == "load") {
            source_index_local = builder.slot(string_field(
                index_expression, "name", "component index"));
        } else {
            const auto [local, initialize] =
                builder.component_scalar_local(&index_expression);
            source_index_local = local;
            if (initialize) {
                auto index_layout = lower_expression(
                    index_expression, builder, signatures, strings);
                index_layout = emit_require_real_complex(
                    builder, strings, index_layout, "index must be int or str");
                require_scalar(index_layout, "component index");
                emit_store_local_component(builder, source_index_local);
            }
        }
        const auto [flat_index_local, initialize_flat_index] =
            builder.flattened_index_local(
                source_index_local, elements.front().width);
        if (initialize_flat_index) {
            const bool index_is_integral = string_field(
                index_expression, "type", "component index") == "int" ||
                builder.local_is_integral(source_index_local);
            if (!fixed_index_proven(
                    builder, source_index_local,
                    static_cast<std::uint32_t>(elements.size()),
                    index_is_integral)) {
                emit_load_local_component(builder, source_index_local);
                Instruction validate;
                validate.opcode = Opcode::LoadF64LocalsIndex;
                validate.index = builder.slot(binding);
                validate.argument_count =
                    static_cast<std::uint32_t>(elements.size());
                validate.index_local = source_index_local;
                validate.index_is_integral = index_is_integral;
                validate.may_error = true;
                const std::string message = "vector index out of range";
                validate.error_message_offset = strings.intern(message);
                validate.byte_count = static_cast<std::uint32_t>(message.size());
                if (const auto handler = builder.error_handler()) {
                    validate.has_error_handler = true;
                    validate.label = *handler;
                    validate.error_value_local = *builder.error_value_local();
                    validate.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(validate));
                builder.emit({Opcode::Drop});
            }
            emit_load_local_component(builder, source_index_local);
            Instruction width;
            width.opcode = Opcode::PushF64;
            width.f64 = static_cast<double>(elements.front().width);
            builder.emit(std::move(width));
            builder.emit({Opcode::MultiplyF64});
            emit_store_local_component(builder, flat_index_local);
        }
        emit_load_local_component(builder, flat_index_local);
        Instruction load;
        load.opcode = Opcode::LoadF64LocalsIndex;
        load.index = builder.slot(binding, component);
        load.argument_count = base_layout.width - component;
        load.index_local = flat_index_local;
        load.index_is_integral = true;
        load.may_error = false;
        builder.emit(std::move(load));
        return true;
    }
    if (kind == "binary_op") {
        const auto& left = object_of(
            field(expression, "left", "component binary expression"),
            "component binary left");
        const auto& right = object_of(
            field(expression, "right", "component binary expression"),
            "component binary right");
        const auto left_layout = layout_from_expression_shape(left, signatures);
        const auto right_layout = layout_from_expression_shape(right, signatures);
        const auto left_component = left_layout.width == 1u ? 0u : component;
        const auto right_component = right_layout.width == 1u ? 0u : component;
        if (!lower_numeric_component(
                left, left_component, builder, signatures, strings) ||
            !lower_numeric_component(
                right, right_component, builder, signatures, strings)) {
            return false;
        }
        const auto opcode = scalar_binary_opcode(string_field(
            expression, "op", "component binary expression"));
        if (!opcode) return false;
        builder.emit({*opcode});
        return true;
    }
    return false;
}

inline void prepare_numeric_component_expression(
    const vf::JsonValue::Object& expression,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures,
    StringPool& strings
) {
    const std::string kind = string_field(
        expression, "kind", "component expression preparation");
    if (kind == "dotted_index") {
        const auto layout = layout_from_expression_shape(expression, signatures);
        if (is_numeric_layout(layout) &&
            lower_numeric_component(expression, 0u, builder, signatures, strings)) {
            builder.emit({Opcode::Drop});
        }
        return;
    }
    if (kind != "binary_op") return;
    prepare_numeric_component_expression(
        object_of(field(expression, "left", "component preparation binary"),
                  "component preparation left"),
        builder, signatures, strings);
    prepare_numeric_component_expression(
        object_of(field(expression, "right", "component preparation binary"),
                  "component preparation right"),
        builder, signatures, strings);
}

inline ValueLayout lower_expression(
    const vf::JsonValue::Object& expression,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures,
    StringPool& strings
) {
    const std::string kind = string_field(expression, "kind", "expression");
    if (kind == "bind_expr") {
        const std::string name = string_field(expression, "name", "bind expression");
        const auto& value = object_of(
            field(expression, "value", "bind expression"), "bind expression value");
        const auto value_layout = lower_expression(value, builder, signatures, strings);
        ensure_independent_value(value, value_layout, builder, signatures);
        const auto* existing = builder.find_layout(name);
        if (existing) {
            if (!same_layout(*existing, value_layout)) {
                throw LoweringFailure("bind expression layout mismatch for " + name);
            }
            emit_release_layout_local(builder, builder.slot(name), *existing);
        } else {
            builder.add_local(name, value_layout);
        }
        emit_store_binding(builder, name, value_layout, strings);
        emit_load_binding(builder, name, {0, value_layout.width, value_layout.kind});
        if (value_layout.kind == ValueKind::String) {
            builder.emit({Opcode::CloneString});
        } else if (value_layout.kind == ValueKind::DynamicF64List ||
                   value_layout.kind == ValueKind::NumericMultiset) {
            builder.emit({Opcode::CloneF64List});
        } else if ((value_layout.kind == ValueKind::Aggregate ||
                    value_layout.kind == ValueKind::StringMultiset) &&
                   has_owned_resources(value_layout)) {
            clone_nested_resource_values(value_layout, builder);
        }
        return value_layout;
    }
    if (kind == "interpolated_string") {
        emit_static_string(builder, strings, "");
        bool owns_result = false;
        for (const auto& segment_value : array_of(
                 field(expression, "segments", "interpolated string"),
                 "interpolated string segments")) {
            const auto& segment = object_of(segment_value, "interpolation segment");
            const std::string segment_kind = string_field(
                segment, "kind", "interpolation segment");
            bool owns_segment = false;
            if (segment_kind == "interpolation_text") {
                emit_static_string(
                    builder, strings,
                    string_field(segment, "value", "interpolation text"));
            } else if (segment_kind == "interpolation_value") {
                owns_segment = lower_interpolation_value(
                    object_of(field(segment, "value", "interpolation value"),
                              "interpolation value"),
                    string_field(segment, "format", "interpolation value"),
                    builder,
                    signatures,
                    strings);
            } else {
                throw LoweringFailure("unsupported interpolation segment " + segment_kind);
            }
            emit_interpolation_concat(builder, owns_result, owns_segment);
            owns_result = true;
        }
        return {2, ValueKind::String, {}};
    }
    if (kind == "if_expr") {
        const auto& body_expression = object_of(
            field(expression, "body", "conditional expression"), "conditional body");
        auto result_layout = layout_from_expression_shape(body_expression, signatures);
        if (result_layout.width != 1 ||
            (result_layout.kind != ValueKind::Numeric && result_layout.kind != ValueKind::Null)) {
            throw LoweringFailure("machine IR conditional expression requires scalar result");
        }
        result_layout.kind = ValueKind::Numeric;
        const auto result = builder.add_borrowed_temporary(result_layout);
        builder.emit({Opcode::PushNull});
        Instruction initialize;
        initialize.opcode = Opcode::StoreLocal;
        initialize.index = result;
        builder.emit(std::move(initialize));
        const auto condition = lower_expression(
            object_of(field(expression, "condition", "conditional expression"), "conditional condition"),
            builder, signatures, strings);
        require_scalar(condition, "machine IR conditional expression condition");
        const auto finish = builder.next_label();
        Instruction skip;
        skip.opcode = Opcode::JumpIfFalse;
        skip.label = finish;
        builder.emit(std::move(skip));
        const auto body_layout = lower_expression(body_expression, builder, signatures, strings);
        require_scalar(body_layout, "machine IR conditional expression body");
        Instruction store;
        store.opcode = Opcode::StoreLocal;
        store.index = result;
        builder.emit(std::move(store));
        Instruction label;
        label.opcode = Opcode::Label;
        label.label = finish;
        builder.emit(std::move(label));
        Instruction load;
        load.opcode = Opcode::LoadLocal;
        load.index = result;
        builder.emit(std::move(load));
        return result_layout;
    }
    if (kind == "pipe_chain") {
        const auto& source_expression = object_of(
            field(expression, "source", "pipe expression"), "pipe source");
        const auto& pipe_segments = array_of(
            field(expression, "segments", "pipe expression"), "pipe segments");
        const bool source_is_pure_load =
            string_field(source_expression, "kind", "pipe source") == "load";
        const auto* loaded_layout = source_is_pure_load
            ? builder.find_layout(string_field(source_expression, "name", "pipe source"))
            : nullptr;
        const bool elide_unused_fixed_source = loaded_layout != nullptr &&
            !pipe_segments.empty() && loaded_layout->kind == ValueKind::Aggregate &&
            is_numeric_layout(*loaded_layout) && loaded_layout->width != 0u &&
            std::none_of(
                pipe_segments.begin(), pipe_segments.end(), [](const auto& segment) {
                    return references_current_pipe_value(segment);
                });
        const auto source = elide_unused_fixed_source
            ? *loaded_layout
            : lower_expression(source_expression, builder, signatures, strings);
        if (source.kind == ValueKind::Numeric || source.kind == ValueKind::Complex ||
            source.kind == ValueKind::Null) {
            builder.begin_scope();
            const auto current = builder.add_scoped_local("$", source, false);
            for (std::uint32_t component = source.width; component > 0; --component) {
                emit_store_local_component(builder, current + component - 1u);
            }
            const auto& segments = array_of(
                field(expression, "segments", "scalar pipe expression"), "scalar pipe segments");
            ValueLayout result = source;
            for (std::size_t index = 0; index < segments.size(); ++index) {
                result = lower_expression(
                    object_of(segments[index], "scalar pipe segment"),
                    builder, signatures, strings);
                if (index + 1u < segments.size()) {
                    if (!same_layout(result, source)) {
                        throw LoweringFailure(
                            "intermediate scalar pipe segment changes its value layout");
                    }
                    for (std::uint32_t component = source.width; component > 0; --component) {
                        emit_store_local_component(builder, current + component - 1u);
                    }
                }
            }
            builder.end_scope();
            return result;
        }
        if (source.kind == ValueKind::Range) {
            const auto source_local = builder.add_borrowed_temporary(source);
            emit_store_local_component(builder, source_local + 2u);
            emit_store_local_component(builder, source_local + 1u);
            emit_store_local_component(builder, source_local);
            const auto cursor = builder.add_borrowed_temporary({});
            emit_load_local_component(builder, source_local);
            emit_store_local_component(builder, cursor);
            const auto step = builder.add_borrowed_temporary({});
            const auto finite_step = builder.next_label();
            const auto descending = builder.next_label();
            const auto step_ready = builder.next_label();
            emit_load_local_component(builder, source_local + 2u);
            Instruction choose_finite_step;
            choose_finite_step.opcode = Opcode::JumpIfFalse;
            choose_finite_step.label = finite_step;
            builder.emit(std::move(choose_finite_step));
            Instruction one;
            one.opcode = Opcode::PushF64;
            one.f64 = 1.0;
            builder.emit(std::move(one));
            emit_store_local_component(builder, step);
            Instruction skip_finite_step;
            skip_finite_step.opcode = Opcode::Jump;
            skip_finite_step.label = step_ready;
            builder.emit(std::move(skip_finite_step));
            Instruction finite_step_label;
            finite_step_label.opcode = Opcode::Label;
            finite_step_label.label = finite_step;
            builder.emit(std::move(finite_step_label));
            emit_load_local_component(builder, source_local);
            emit_load_local_component(builder, source_local + 1u);
            builder.emit({Opcode::OrderedLessEqualF64});
            Instruction choose_descending;
            choose_descending.opcode = Opcode::JumpIfFalse;
            choose_descending.label = descending;
            builder.emit(std::move(choose_descending));
            Instruction ascending_one;
            ascending_one.opcode = Opcode::PushF64;
            ascending_one.f64 = 1.0;
            builder.emit(std::move(ascending_one));
            emit_store_local_component(builder, step);
            Instruction skip_descending;
            skip_descending.opcode = Opcode::Jump;
            skip_descending.label = step_ready;
            builder.emit(std::move(skip_descending));
            Instruction descending_label;
            descending_label.opcode = Opcode::Label;
            descending_label.label = descending;
            builder.emit(std::move(descending_label));
            Instruction minus_one;
            minus_one.opcode = Opcode::PushF64;
            minus_one.f64 = -1.0;
            builder.emit(std::move(minus_one));
            emit_store_local_component(builder, step);
            Instruction step_ready_label;
            step_ready_label.opcode = Opcode::Label;
            step_ready_label.label = step_ready;
            builder.emit(std::move(step_ready_label));

            const ValueLayout list_layout{1, ValueKind::DynamicF64List, {}};
            const auto result_local = builder.add_owned_temporary(list_layout);
            Instruction empty;
            empty.opcode = Opcode::MakeOwnedF64List;
            empty.argument_count = 0;
            builder.emit(std::move(empty));
            emit_store_local_component(builder, result_local);
            builder.begin_scope();
            const auto current = builder.add_scoped_local("$", {}, false);
            const auto final_value = builder.add_scoped_local("$pipe_result", {}, false);
            const auto loop = builder.next_label();
            const auto descending_check = builder.next_label();
            const auto finite_check = builder.next_label();
            const auto condition_ready = builder.next_label();
            const auto advance = builder.next_label();
            const auto finish = builder.next_label();
            const auto condition = builder.add_borrowed_temporary({});
            Instruction loop_label;
            loop_label.opcode = Opcode::Label;
            loop_label.label = loop;
            builder.emit(std::move(loop_label));
            emit_load_local_component(builder, source_local + 2u);
            Instruction use_finite_check;
            use_finite_check.opcode = Opcode::JumpIfFalse;
            use_finite_check.label = finite_check;
            builder.emit(std::move(use_finite_check));
            Instruction infinite_truth;
            infinite_truth.opcode = Opcode::PushF64;
            infinite_truth.f64 = 1.0;
            builder.emit(std::move(infinite_truth));
            emit_store_local_component(builder, condition);
            Instruction infinite_condition_done;
            infinite_condition_done.opcode = Opcode::Jump;
            infinite_condition_done.label = condition_ready;
            builder.emit(std::move(infinite_condition_done));
            Instruction finite_check_label;
            finite_check_label.opcode = Opcode::Label;
            finite_check_label.label = finite_check;
            builder.emit(std::move(finite_check_label));
            emit_load_local_component(builder, step);
            Instruction zero;
            zero.opcode = Opcode::PushF64;
            zero.f64 = 0.0;
            builder.emit(std::move(zero));
            builder.emit({Opcode::OrderedGreaterEqualF64});
            Instruction use_descending;
            use_descending.opcode = Opcode::JumpIfFalse;
            use_descending.label = descending_check;
            builder.emit(std::move(use_descending));
            emit_load_local_component(builder, cursor);
            emit_load_local_component(builder, source_local + 1u);
            builder.emit({Opcode::OrderedLessEqualF64});
            emit_store_local_component(builder, condition);
            Instruction condition_done;
            condition_done.opcode = Opcode::Jump;
            condition_done.label = condition_ready;
            builder.emit(std::move(condition_done));
            Instruction descending_check_label;
            descending_check_label.opcode = Opcode::Label;
            descending_check_label.label = descending_check;
            builder.emit(std::move(descending_check_label));
            emit_load_local_component(builder, cursor);
            emit_load_local_component(builder, source_local + 1u);
            builder.emit({Opcode::OrderedGreaterEqualF64});
            emit_store_local_component(builder, condition);
            Instruction condition_label;
            condition_label.opcode = Opcode::Label;
            condition_label.label = condition_ready;
            builder.emit(std::move(condition_label));
            emit_load_local_component(builder, condition);
            Instruction done;
            done.opcode = Opcode::JumpIfFalse;
            done.label = finish;
            builder.emit(std::move(done));
            emit_load_local_component(builder, cursor);
            emit_store_local_component(builder, current);
            const auto& segments = array_of(
                field(expression, "segments", "range pipe expression"), "range pipe segments");
            builder.push_loop(advance, finish);
            ValueLayout segment_layout;
            for (std::size_t index = 0; index < segments.size(); ++index) {
                segment_layout = lower_expression(
                    object_of(segments[index], "range pipe segment"),
                    builder, signatures, strings);
                require_scalar(segment_layout, "range pipe segment");
                emit_store_local_component(
                    builder, index + 1u < segments.size() ? current : final_value);
            }
            builder.pop_loop();
            emit_load_local_component(builder, result_local);
            emit_load_local_component(builder, final_value);
            Instruction singleton;
            singleton.opcode = Opcode::MakeOwnedF64List;
            singleton.argument_count = 1;
            builder.emit(std::move(singleton));
            Instruction append;
            append.opcode = Opcode::ConcatF64Lists;
            append.owns_left = true;
            append.owns_right = true;
            builder.emit(std::move(append));
            emit_store_local_component(builder, result_local);
            Instruction advance_label;
            advance_label.opcode = Opcode::Label;
            advance_label.label = advance;
            builder.emit(std::move(advance_label));
            emit_load_local_component(builder, cursor);
            emit_load_local_component(builder, step);
            builder.emit({Opcode::AddF64});
            emit_store_local_component(builder, cursor);
            Instruction repeat;
            repeat.opcode = Opcode::Jump;
            repeat.label = loop;
            builder.emit(std::move(repeat));
            Instruction finish_label;
            finish_label.opcode = Opcode::Label;
            finish_label.label = finish;
            builder.emit(std::move(finish_label));
            builder.end_scope();
            const auto declared_result = layout_from_expression_shape(
                expression, signatures);
            if (declared_result.kind == ValueKind::Aggregate &&
                is_numeric_layout(declared_result) &&
                !is_record_layout(declared_result)) {
                for (std::uint32_t index = 0; index < declared_result.width; ++index) {
                    emit_load_local_component(builder, result_local);
                    Instruction item_index;
                    item_index.opcode = Opcode::PushF64;
                    item_index.f64 = static_cast<double>(index);
                    builder.emit(std::move(item_index));
                    builder.emit({Opcode::LoadF64ListIndex});
                }
                emit_release_layout_local(builder, result_local, list_layout);
                return declared_result;
            }
            emit_load_local_component(builder, result_local);
            builder.emit({Opcode::CloneF64List});
            emit_release_layout_local(builder, result_local, list_layout);
            return list_layout;
        }
        if (source.kind == ValueKind::String) {
            const auto source_local = builder.add_borrowed_temporary(source);
            emit_store_local_component(builder, source_local + 1u);
            emit_store_local_component(builder, source_local);
            const auto byte_count = builder.add_borrowed_temporary({});
            emit_load_local_component(builder, source_local + 1u);
            builder.emit({Opcode::Duplicate});
            Instruction zero;
            zero.opcode = Opcode::PushF64;
            zero.f64 = 0.0;
            builder.emit(std::move(zero));
            builder.emit({Opcode::OrderedGreaterEqualF64});
            const auto length_ready = builder.next_label();
            Instruction borrowed_length;
            borrowed_length.opcode = Opcode::JumpIfTrue;
            borrowed_length.label = length_ready;
            builder.emit(std::move(borrowed_length));
            builder.emit({Opcode::NegateF64});
            Instruction one;
            one.opcode = Opcode::PushF64;
            one.f64 = 1.0;
            builder.emit(std::move(one));
            builder.emit({Opcode::SubtractF64});
            Instruction length_label;
            length_label.opcode = Opcode::Label;
            length_label.label = length_ready;
            builder.emit(std::move(length_label));
            emit_store_local_component(builder, byte_count);

            const auto cursor = builder.add_borrowed_temporary({});
            Instruction start_zero;
            start_zero.opcode = Opcode::PushF64;
            start_zero.f64 = 0.0;
            builder.emit(std::move(start_zero));
            emit_store_local_component(builder, cursor);
            const ValueLayout string_layout{2, ValueKind::String, {}};
            const auto result_local = builder.add_owned_temporary(string_layout);
            emit_static_string(builder, strings, "");
            builder.emit({Opcode::CloneString});
            emit_store_local_component(builder, result_local + 1u);
            emit_store_local_component(builder, result_local);

            const auto& segments = array_of(
                field(expression, "segments", "pipe expression"), "pipe segments");
            if (segments.empty()) {
                emit_load_local_component(builder, source_local);
                emit_load_local_component(builder, source_local + 1u);
                if (!expression_transfers_string_value(source_expression, signatures)) {
                    builder.emit({Opcode::CloneString});
                }
                return string_layout;
            }
            builder.begin_scope();
            const auto current = builder.add_scoped_local("$", {});
            const auto segment_value = builder.add_borrowed_temporary(string_layout);
            const auto loop = builder.next_label();
            const auto finish = builder.next_label();
            Instruction loop_label;
            loop_label.opcode = Opcode::Label;
            loop_label.label = loop;
            builder.emit(std::move(loop_label));
            emit_load_local_component(builder, cursor);
            emit_load_local_component(builder, byte_count);
            builder.emit({Opcode::OrderedLessF64});
            Instruction done;
            done.opcode = Opcode::JumpIfFalse;
            done.label = finish;
            builder.emit(std::move(done));
            emit_load_local_component(builder, source_local);
            emit_load_local_component(builder, source_local + 1u);
            emit_load_local_component(builder, cursor);
            builder.emit({Opcode::DecodeUtf8At});
            emit_store_local_component(builder, cursor);
            emit_store_local_component(builder, current);

            ValueLayout segment_layout;
            const vf::JsonValue::Object* segment_expression = nullptr;
            builder.push_loop(loop, finish);
            for (std::size_t segment_index = 0; segment_index < segments.size(); ++segment_index) {
                segment_expression = &object_of(segments[segment_index], "string pipe segment");
                segment_layout = lower_expression(
                    *segment_expression, builder, signatures, strings);
                if (segment_index + 1u < segments.size()) {
                    require_scalar(segment_layout, "intermediate string pipe segment");
                    emit_store_local_component(builder, current);
                }
            }
            builder.pop_loop();
            if (segment_layout.kind == ValueKind::Numeric && segment_expression &&
                string_field(*segment_expression, "type", "string pipe segment") == "chr") {
                builder.emit({Opcode::FormatChrString});
                segment_layout = string_layout;
            }
            if (segment_layout.kind != ValueKind::String || !segment_expression) {
                throw LoweringFailure("string pipe segment must produce chr or str");
            }
            if (!expression_transfers_string_value(*segment_expression, signatures)) {
                builder.emit({Opcode::CloneString});
            }
            emit_store_local_component(builder, segment_value + 1u);
            emit_store_local_component(builder, segment_value);
            emit_load_local_component(builder, result_local);
            emit_load_local_component(builder, result_local + 1u);
            builder.emit({Opcode::CloneString});
            emit_load_local_component(builder, segment_value);
            emit_load_local_component(builder, segment_value + 1u);
            Instruction concat;
            concat.opcode = Opcode::ConcatStrings;
            concat.owns_left = true;
            concat.owns_right = true;
            builder.emit(std::move(concat));
            emit_release_layout_local(builder, result_local, string_layout);
            emit_store_local_component(builder, result_local + 1u);
            emit_store_local_component(builder, result_local);
            Instruction repeat;
            repeat.opcode = Opcode::Jump;
            repeat.label = loop;
            builder.emit(std::move(repeat));
            Instruction finish_label;
            finish_label.opcode = Opcode::Label;
            finish_label.label = finish;
            builder.emit(std::move(finish_label));
            builder.end_scope();
            emit_load_local_component(builder, result_local);
            emit_load_local_component(builder, result_local + 1u);
            builder.emit({Opcode::CloneString});
            emit_release_layout_local(builder, result_local, string_layout);
            if (expression_transfers_string_value(source_expression, signatures)) {
                emit_release_layout_local(builder, source_local, string_layout);
            }
            return string_layout;
        }
        if (source.kind == ValueKind::NumericMultiset) {
            const auto source_local = builder.add_borrowed_temporary(source);
            emit_store_local_component(builder, source_local);
            const auto result_local = builder.add_owned_temporary(source);
            Instruction empty;
            empty.opcode = Opcode::MakeOwnedF64List;
            empty.argument_count = 0;
            builder.emit(std::move(empty));
            emit_store_local_component(builder, result_local);
            const auto cursor = builder.add_borrowed_temporary({});
            Instruction zero;
            zero.opcode = Opcode::PushF64;
            zero.f64 = 0.0;
            builder.emit(std::move(zero));
            emit_store_local_component(builder, cursor);

            builder.begin_scope();
            const auto current = builder.add_scoped_local("$", {}, false);
            const auto final_value = builder.add_scoped_local("$pipe_result", {}, false);
            const auto count_value = builder.add_scoped_local("$pipe_count", {}, false);
            const auto loop = builder.next_label();
            const auto advance = builder.next_label();
            const auto finish = builder.next_label();
            Instruction loop_label;
            loop_label.opcode = Opcode::Label;
            loop_label.label = loop;
            builder.emit(std::move(loop_label));
            emit_load_local_component(builder, cursor);
            emit_load_local_component(builder, source_local);
            builder.emit({Opcode::CountF64List});
            builder.emit({Opcode::OrderedLessF64});
            Instruction done;
            done.opcode = Opcode::JumpIfFalse;
            done.label = finish;
            builder.emit(std::move(done));
            emit_load_local_component(builder, source_local);
            emit_load_local_component(builder, cursor);
            builder.emit({Opcode::LoadF64ListIndex});
            emit_store_local_component(builder, current);
            emit_load_local_component(builder, source_local);
            emit_load_local_component(builder, cursor);
            Instruction one_for_count;
            one_for_count.opcode = Opcode::PushF64;
            one_for_count.f64 = 1.0;
            builder.emit(std::move(one_for_count));
            builder.emit({Opcode::AddF64});
            builder.emit({Opcode::LoadF64ListIndex});
            emit_store_local_component(builder, count_value);

            const auto& segments = array_of(
                field(expression, "segments", "multiset pipe expression"),
                "multiset pipe segments");
            builder.push_loop(advance, finish);
            ValueLayout segment_layout;
            for (std::size_t index = 0; index < segments.size(); ++index) {
                segment_layout = lower_expression(
                    object_of(segments[index], "multiset pipe segment"),
                    builder, signatures, strings);
                require_scalar(segment_layout, "numeric multiset pipe segment");
                emit_store_local_component(
                    builder, index + 1u < segments.size() ? current : final_value);
            }
            builder.pop_loop();
            emit_load_local_component(builder, result_local);
            emit_load_local_component(builder, final_value);
            emit_load_local_component(builder, count_value);
            Instruction pair;
            pair.opcode = Opcode::MakeOwnedF64List;
            pair.argument_count = 2;
            builder.emit(std::move(pair));
            Instruction append;
            append.opcode = Opcode::ConcatF64Lists;
            append.owns_left = true;
            append.owns_right = true;
            builder.emit(std::move(append));
            emit_store_local_component(builder, result_local);
            Instruction advance_label;
            advance_label.opcode = Opcode::Label;
            advance_label.label = advance;
            builder.emit(std::move(advance_label));
            emit_load_local_component(builder, cursor);
            Instruction two;
            two.opcode = Opcode::PushF64;
            two.f64 = 2.0;
            builder.emit(std::move(two));
            builder.emit({Opcode::AddF64});
            emit_store_local_component(builder, cursor);
            Instruction repeat;
            repeat.opcode = Opcode::Jump;
            repeat.label = loop;
            builder.emit(std::move(repeat));
            Instruction finish_label;
            finish_label.opcode = Opcode::Label;
            finish_label.label = finish;
            builder.emit(std::move(finish_label));
            builder.end_scope();
            emit_load_local_component(builder, result_local);
            builder.emit({Opcode::NormalizeF64Multiset});
            builder.emit({Opcode::CloneF64List});
            emit_release_layout_local(builder, result_local, source);
            if (expression_produces_owned_numeric_multiset(source_expression, signatures)) {
                emit_release_layout_local(builder, source_local, source);
            }
            return source;
        }
        if (source.kind == ValueKind::DynamicF64List) {
            const auto source_local = builder.add_borrowed_temporary(source);
            emit_store_local_component(builder, source_local);
            const auto result_local = builder.add_owned_temporary(source);
            Instruction empty;
            empty.opcode = Opcode::MakeOwnedF64List;
            empty.argument_count = 0;
            builder.emit(std::move(empty));
            emit_store_local_component(builder, result_local);
            const auto cursor = builder.add_borrowed_temporary({});
            Instruction zero;
            zero.opcode = Opcode::PushF64;
            zero.f64 = 0.0;
            builder.emit(std::move(zero));
            emit_store_local_component(builder, cursor);

            builder.begin_scope();
            const auto current = builder.add_scoped_local("$", {}, false);
            const auto final_value = builder.add_scoped_local("$pipe_result", {}, false);
            const auto loop = builder.next_label();
            const auto advance = builder.next_label();
            const auto finish = builder.next_label();
            Instruction loop_label;
            loop_label.opcode = Opcode::Label;
            loop_label.label = loop;
            builder.emit(std::move(loop_label));
            emit_load_local_component(builder, cursor);
            emit_load_local_component(builder, source_local);
            builder.emit({Opcode::CountF64List});
            builder.emit({Opcode::OrderedLessF64});
            Instruction done;
            done.opcode = Opcode::JumpIfFalse;
            done.label = finish;
            builder.emit(std::move(done));
            emit_load_local_component(builder, source_local);
            emit_load_local_component(builder, cursor);
            builder.emit({Opcode::LoadF64ListIndex});
            emit_store_local_component(builder, current);

            const auto& segments = array_of(
                field(expression, "segments", "dynamic pipe expression"), "dynamic pipe segments");
            builder.push_loop(advance, finish);
            ValueLayout segment_layout;
            for (std::size_t index = 0; index < segments.size(); ++index) {
                segment_layout = lower_expression(
                    object_of(segments[index], "dynamic pipe segment"),
                    builder, signatures, strings);
                require_scalar(segment_layout, "dynamic numeric pipe segment");
                emit_store_local_component(
                    builder, index + 1u < segments.size() ? current : final_value);
            }
            builder.pop_loop();
            emit_load_local_component(builder, result_local);
            emit_load_local_component(builder, final_value);
            Instruction singleton;
            singleton.opcode = Opcode::MakeOwnedF64List;
            singleton.argument_count = 1;
            builder.emit(std::move(singleton));
            Instruction append;
            append.opcode = Opcode::ConcatF64Lists;
            append.owns_left = true;
            append.owns_right = true;
            builder.emit(std::move(append));
            emit_store_local_component(builder, result_local);
            Instruction advance_label;
            advance_label.opcode = Opcode::Label;
            advance_label.label = advance;
            builder.emit(std::move(advance_label));
            emit_load_local_component(builder, cursor);
            Instruction one;
            one.opcode = Opcode::PushF64;
            one.f64 = 1.0;
            builder.emit(std::move(one));
            builder.emit({Opcode::AddF64});
            emit_store_local_component(builder, cursor);
            Instruction repeat;
            repeat.opcode = Opcode::Jump;
            repeat.label = loop;
            builder.emit(std::move(repeat));
            Instruction finish_label;
            finish_label.opcode = Opcode::Label;
            finish_label.label = finish;
            builder.emit(std::move(finish_label));
            builder.end_scope();
            emit_load_local_component(builder, result_local);
            builder.emit({Opcode::CloneF64List});
            emit_release_layout_local(builder, result_local, source);
            if (expression_produces_owned_f64_list(source_expression, signatures)) {
                emit_release_layout_local(builder, source_local, source);
            }
            return source;
        }
        if (source.kind != ValueKind::Aggregate || !is_numeric_layout(source) || source.width == 0) {
            throw LoweringFailure("machine IR runtime pipe requires a fixed numeric aggregate");
        }
        const auto source_elements = indexed_element_layouts(source);
        if (source_elements.empty()) {
            throw LoweringFailure("machine IR runtime pipe requires at least one fixed element");
        }
        std::optional<std::uint32_t> source_local;
        if (!elide_unused_fixed_source) {
            source_local = builder.add_borrowed_temporary(source);
            for (std::uint32_t component = source.width; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = *source_local + component - 1;
                builder.emit(std::move(store));
            }
        }
        const auto& segments = array_of(field(expression, "segments", "pipe expression"), "pipe segments");
        if (segments.empty()) {
            for (std::uint32_t component = 0; component < source.width; ++component) {
                Instruction load;
                load.opcode = Opcode::LoadLocal;
                load.index = *source_local + component;
                builder.emit(std::move(load));
            }
            return source;
        }
        builder.begin_scope();
        const auto current = elide_unused_fixed_source
            ? std::optional<std::uint32_t>{}
            : std::optional<std::uint32_t>{
                builder.add_scoped_local("$", source_elements.front(), false)};
        std::uint32_t source_offset = 0;
        std::vector<ValueLayout> result_elements;
        result_elements.reserve(source_elements.size());
        for (const auto& element : source_elements) {
            if (!same_layout(element, source_elements.front())) {
                throw LoweringFailure("machine IR pipe requires homogeneous fixed elements");
            }
            if (!elide_unused_fixed_source) {
                for (std::uint32_t component = 0; component < element.width; ++component) {
                    emit_load_local_component(builder, *source_local + source_offset + component);
                }
                for (std::uint32_t component = element.width; component > 0; --component) {
                    emit_store_local_component(builder, *current + component - 1u);
                }
            }
            ValueLayout result;
            for (std::size_t segment_index = 0; segment_index < segments.size(); ++segment_index) {
                result = lower_expression(
                    object_of(segments[segment_index], "pipe segment"), builder, signatures, strings);
                if (segment_index + 1 < segments.size()) {
                    if (!same_layout(result, element)) {
                        throw LoweringFailure(
                            "intermediate fixed pipe segment changes its element layout");
                    }
                    if (!elide_unused_fixed_source) {
                        for (std::uint32_t component = element.width; component > 0; --component) {
                            emit_store_local_component(builder, *current + component - 1u);
                        }
                    }
                }
            }
            result_elements.push_back(result);
            source_offset += element.width;
        }
        builder.end_scope();
        return indexed_layout(result_elements);
    }
    if (kind == "range") {
        const auto start = lower_expression(
            object_of(field(expression, "start", "range"), "range start"),
            builder, signatures, strings);
        require_scalar(start, "range start");
        const auto& end = field(expression, "end", "range");
        if (end.is_null()) {
            builder.emit({Opcode::PushNull});
        } else {
            const auto end_layout = lower_expression(
                object_of(end, "range end"), builder, signatures, strings);
            require_scalar(end_layout, "range end");
        }
        Instruction infinite;
        infinite.opcode = Opcode::PushF64;
        infinite.f64 = bool_field(expression, "infinite", "range") ? 1.0 : 0.0;
        builder.emit(std::move(infinite));
        return {3, ValueKind::Range, {}};
    }
    if (kind == "complex_const") {
        Instruction real;
        real.opcode = Opcode::PushF64;
        real.f64 = field(expression, "real", "complex constant").as_number();
        builder.emit(std::move(real));
        Instruction imag;
        imag.opcode = Opcode::PushF64;
        imag.f64 = field(expression, "imag", "complex constant").as_number();
        builder.emit(std::move(imag));
        return {2, ValueKind::Complex, {}};
    }
    if (kind == "const") {
        const auto& value = field(expression, "value", "constant");
        Instruction instruction;
        instruction.opcode = Opcode::PushF64;
        if (value.is_number()) instruction.f64 = value.as_number();
        else if (value.is_boolean()) instruction.f64 = value.as_boolean() ? 1.0 : 0.0;
        else if (value.is_string()) {
            instruction.opcode = Opcode::PushString;
            instruction.index = strings.intern(value.as_string());
            instruction.byte_count = static_cast<std::uint32_t>(value.as_string().size());
            builder.emit(std::move(instruction));
            return {2, ValueKind::String, {}};
        } else if (value.is_null()) {
            instruction.opcode = Opcode::PushNull;
            builder.emit(std::move(instruction));
            return {1, ValueKind::Null, {}};
        } else throw LoweringFailure("machine IR supports numeric, string, and null constants only");
        builder.emit(std::move(instruction));
        return {};
    }
    if (kind == "symbolic_var") {
        const std::string name = string_field(expression, "name", "symbolic variable");
        const std::string domain = string_field(expression, "domain", "symbolic variable");
        const auto symbol_kind_field = expression.find("symbol_kind");
        const std::string symbol_kind = symbol_kind_field != expression.end() && symbol_kind_field->second.is_string()
            ? symbol_kind_field->second.as_string() : "variable";
        const double symbol_kind_tag = symbol_kind == "function" ? 2.0 : symbol_kind == "constant" ? 3.0 : 1.0;
        const auto latex_field = expression.find("latex");
        const std::string latex = latex_field != expression.end() && latex_field->second.is_string()
            ? latex_field->second.as_string() : name;
        const auto signature = vkf::symbolic_value::function_signature_tags(domain);
        std::vector<double> encoded{
            1.0,
            static_cast<double>(name.size() + latex.size() + signature.inputs.size() * 2u + 7u),
            vkf::symbolic_value::encoded_domain_tag(domain),
            symbol_kind_tag,
            static_cast<double>(name.size()),
        };
        for (const unsigned char byte : name) encoded.push_back(static_cast<double>(byte));
        encoded.push_back(static_cast<double>(latex.size()));
        for (const unsigned char byte : latex) encoded.push_back(static_cast<double>(byte));
        encoded.push_back(static_cast<double>(signature.inputs.size()));
        for (const auto& input : signature.inputs) {
            encoded.push_back(input.tag);
            encoded.push_back(input.dimension);
        }
        encoded.push_back(signature.output.tag);
        encoded.push_back(signature.output.dimension);
        encoded.push_back(1.0);
        encoded.push_back(0.0);
        encoded.push_back(static_cast<double>(encoded.size() + 1u));
        Instruction symbol;
        symbol.opcode = Opcode::MakeOwnedF64ListLiteral;
        symbol.index = strings.intern_f64s(encoded);
        symbol.argument_count = static_cast<std::uint32_t>(encoded.size());
        builder.emit(std::move(symbol));
        return {1, ValueKind::DynamicF64List, {}};
    }
    if (kind == "load") {
        const std::string name = string_field(expression, "name", "load");
        if (const auto* layout = builder.find_layout(name)) {
            emit_load_binding(builder, name, {0, layout->width});
            return *layout;
        }
        const auto literal = signatures.module_literals.find(name);
        if (literal != signatures.module_literals.end()) {
            return lower_expression(*literal->second, builder, signatures, strings);
        }
        throw LoweringFailure("unknown binding " + name);
    }
    if (kind == "spread") {
        return lower_expression(
            object_of(field(expression, "value", "spread"), "spread value"),
            builder,
            signatures,
            strings);
    }
    if (kind == "scope_identity") {
        const std::string type = string_field(expression, "type", "scope identity");
        if (type.rfind("record{", 0) != 0 || type.empty() || type.back() != '}') {
            throw LoweringFailure("machine IR scope identity requires a record type");
        }
        ValueLayout result;
        result.width = 0;
        result.kind = ValueKind::Aggregate;
        for (const auto& field_surface : split_top_level(type.substr(7, type.size() - 8), ',')) {
            const auto colon = find_top_level(field_surface, ':');
            if (colon == std::string::npos) {
                throw LoweringFailure("machine IR scope identity field needs a type");
            }
            const std::string name = trim(field_surface.substr(0, colon));
            const auto& field_layout = builder.layout(name);
            emit_load_binding(builder, name, {0, field_layout.width, field_layout.kind});
            result.selectors[name] = {result.width, field_layout.width, field_layout.kind};
            for (const auto& [child, slice] : field_layout.selectors) {
                result.selectors[name + "." + child] = {
                    result.width + slice.offset, slice.width, slice.kind
                };
            }
            result.width += field_layout.width;
        }
        return result;
    }
    if (kind == "multiset_from_collection") {
        const auto& value = object_of(
            field(expression, "value", "multiset generation"),
            "multiset generation value");
        const auto source = lower_expression(value, builder, signatures, strings);
        const ValueLayout multiset_layout{1, ValueKind::NumericMultiset, {}};
        if (source.kind == ValueKind::DynamicF64List) {
            const auto source_local = builder.add_borrowed_temporary(source);
            emit_store_local_component(builder, source_local);
            const auto result_local = builder.add_owned_temporary(multiset_layout);
            Instruction empty;
            empty.opcode = Opcode::MakeOwnedF64List;
            empty.argument_count = 0;
            builder.emit(std::move(empty));
            emit_store_local_component(builder, result_local);
            const auto cursor = builder.add_borrowed_temporary({});
            Instruction zero;
            zero.opcode = Opcode::PushF64;
            zero.f64 = 0.0;
            builder.emit(std::move(zero));
            emit_store_local_component(builder, cursor);
            const auto loop = builder.next_label();
            const auto finish = builder.next_label();
            Instruction loop_label;
            loop_label.opcode = Opcode::Label;
            loop_label.label = loop;
            builder.emit(std::move(loop_label));
            emit_load_local_component(builder, cursor);
            emit_load_local_component(builder, source_local);
            builder.emit({Opcode::CountF64List});
            builder.emit({Opcode::OrderedLessF64});
            Instruction done;
            done.opcode = Opcode::JumpIfFalse;
            done.label = finish;
            builder.emit(std::move(done));
            emit_load_local_component(builder, result_local);
            emit_load_local_component(builder, source_local);
            emit_load_local_component(builder, cursor);
            builder.emit({Opcode::LoadF64ListIndex});
            Instruction one;
            one.opcode = Opcode::PushF64;
            one.f64 = 1.0;
            builder.emit(std::move(one));
            Instruction pair;
            pair.opcode = Opcode::MakeOwnedF64List;
            pair.argument_count = 2;
            builder.emit(std::move(pair));
            Instruction append;
            append.opcode = Opcode::ConcatF64Lists;
            append.owns_left = true;
            append.owns_right = true;
            builder.emit(std::move(append));
            emit_store_local_component(builder, result_local);
            emit_load_local_component(builder, cursor);
            Instruction increment;
            increment.opcode = Opcode::PushF64;
            increment.f64 = 1.0;
            builder.emit(std::move(increment));
            builder.emit({Opcode::AddF64});
            emit_store_local_component(builder, cursor);
            Instruction repeat;
            repeat.opcode = Opcode::Jump;
            repeat.label = loop;
            builder.emit(std::move(repeat));
            Instruction finish_label;
            finish_label.opcode = Opcode::Label;
            finish_label.label = finish;
            builder.emit(std::move(finish_label));
            emit_load_local_component(builder, result_local);
            builder.emit({Opcode::NormalizeF64Multiset});
            builder.emit({Opcode::CloneF64List});
            emit_release_layout_local(builder, result_local, multiset_layout);
            if (expression_produces_owned_f64_list(value, signatures)) {
                emit_release_layout_local(builder, source_local, source);
            }
            return multiset_layout;
        }
        if (source.kind != ValueKind::Aggregate || !is_numeric_layout(source) ||
            source.width == 0) {
            throw LoweringFailure(
                "multiset generation requires a numeric vector, tuple, list, or multiset");
        }
        const auto elements = indexed_element_layouts(source);
        if (elements.empty()) {
            throw LoweringFailure("multiset generation requires at least one element");
        }
        const auto source_local = builder.add_borrowed_temporary(source);
        for (std::uint32_t component = source.width; component > 0; --component) {
            emit_store_local_component(builder, source_local + component - 1u);
        }
        std::uint32_t offset = 0;
        for (const auto& element : elements) {
            require_scalar(element, "multiset generation element");
            emit_load_local_component(builder, source_local + offset);
            Instruction one;
            one.opcode = Opcode::PushF64;
            one.f64 = 1.0;
            builder.emit(std::move(one));
            offset += element.width;
        }
        Instruction make;
        make.opcode = Opcode::MakeOwnedF64List;
        make.argument_count = static_cast<std::uint32_t>(elements.size() * 2u);
        builder.emit(std::move(make));
        builder.emit({Opcode::NormalizeF64Multiset});
        return multiset_layout;
    }
    if (kind == "multiset") {
        const std::string element_type = string_field(expression, "element_type", "multiset");
        const auto& pairs = array_of(field(expression, "pairs", "multiset"), "multiset pairs");
        if (element_type == "str") {
            for (const auto& pair_value : pairs) {
                const auto& pair = object_of(pair_value, "string multiset pair");
                const auto& key_expression = object_of(
                    field(pair, "key", "string multiset pair"), "string multiset key");
                const auto key = lower_expression(
                    key_expression, builder, signatures, strings);
                if (key.kind != ValueKind::String) {
                    throw LoweringFailure("string multiset key must be str");
                }
                ensure_independent_value(key_expression, key, builder, signatures);
                const auto count = lower_expression(
                    object_of(field(pair, "count", "string multiset pair"), "string multiset count"),
                    builder, signatures, strings);
                require_scalar(count, "string multiset count");
            }
            return emit_normalize_string_multiset(
                builder, string_multiset_layout(pairs.size()));
        }
        if (element_type != "num" && element_type != "int" &&
            element_type != "f32" && element_type != "f64") {
            throw LoweringFailure("direct machine IR multiset currently requires numeric keys");
        }
        for (const auto& pair_value : pairs) {
            const auto& pair = object_of(pair_value, "multiset pair");
            const auto key = lower_expression(
                object_of(field(pair, "key", "multiset pair"), "multiset key"),
                builder, signatures, strings);
            const auto count = lower_expression(
                object_of(field(pair, "count", "multiset pair"), "multiset count"),
                builder, signatures, strings);
            require_scalar(key, "numeric multiset key");
            require_scalar(count, "numeric multiset count");
        }
        Instruction make;
        make.opcode = Opcode::MakeOwnedF64List;
        make.argument_count = static_cast<std::uint32_t>(pairs.size() * 2u);
        builder.emit(std::move(make));
        builder.emit({Opcode::NormalizeF64Multiset});
        return {1, ValueKind::NumericMultiset, {}};
    }
    if (kind == "repeat_list") {
        const auto value = lower_expression(
            object_of(field(expression, "value", "dynamic repeat list"),
                      "dynamic repeat value"),
            builder, signatures, strings);
        require_scalar(value, "dynamic repeat value");
        const auto count = lower_expression(
            object_of(field(expression, "count", "dynamic repeat list"),
                      "dynamic repeat count"),
            builder, signatures, strings);
        require_scalar(count, "dynamic repeat count");
        builder.emit({Opcode::MakeOwnedRepeatedF64List});
        return {1, ValueKind::DynamicF64List, {}};
    }
    if (kind == "list" || kind == "tuple") {
        const auto type = expression.find("type");
        const auto& items = array_of(field(expression, "items", kind), kind + " items");
        const bool dynamic = kind == "list" && type != expression.end() && type->second.is_string() &&
            (is_explicit_dynamic_f64_list_type(type->second.as_string()) ||
             (type->second.as_string() == "list<any>" && items.empty()));
        if (dynamic && items.size() >= 4) {
            std::vector<double> constants;
            constants.reserve(items.size());
            for (const auto& value : items) {
                const auto& item = object_of(value, kind + " item");
                if (string_field(item, "kind", kind + " item") != "const") {
                    constants.clear();
                    break;
                }
                const auto& raw = field(item, "value", kind + " item");
                if (raw.is_number()) constants.push_back(raw.as_number());
                else if (raw.is_boolean()) constants.push_back(raw.as_boolean() ? 1.0 : 0.0);
                else {
                    constants.clear();
                    break;
                }
            }
            if (constants.size() == items.size()) {
                Instruction make;
                make.opcode = Opcode::MakeOwnedF64ListLiteral;
                make.index = strings.intern_f64s(constants);
                make.argument_count = static_cast<std::uint32_t>(constants.size());
                builder.emit(std::move(make));
                return {1, ValueKind::DynamicF64List, {}};
            }
        }
        std::vector<ValueLayout> elements;
        for (const auto& value : items) {
            const auto& item_expression = object_of(value, kind + " item");
            const bool spread = string_field(item_expression, "kind", kind + " item") == "spread";
            const auto& lowered_expression = spread
                ? object_of(field(item_expression, "value", "spread"), "spread value")
                : item_expression;
            auto element = lower_expression(lowered_expression, builder, signatures, strings);
            if (dynamic) {
                if (spread) {
                    if (element.kind != ValueKind::Aggregate || !is_numeric_layout(element)) {
                        throw LoweringFailure(
                            "dynamic list literal can only spread a fixed numeric collection");
                    }
                    ensure_independent_value(
                        lowered_expression, element, builder, signatures);
                    const auto spread_elements = indexed_element_layouts(element);
                    for (const auto& spread_element : spread_elements) {
                        require_scalar(spread_element, "dynamic numeric list spread element");
                    }
                    elements.insert(
                        elements.end(), spread_elements.begin(), spread_elements.end());
                    continue;
                }
                require_scalar(element, "dynamic numeric list element");
            } else {
                ensure_independent_value(lowered_expression, element, builder, signatures);
            }
            if (spread) {
                const auto spread_elements = indexed_element_layouts(element);
                elements.insert(elements.end(), spread_elements.begin(), spread_elements.end());
            } else {
                elements.push_back(std::move(element));
            }
        }
        if (dynamic) {
            Instruction make;
            make.opcode = Opcode::MakeOwnedF64List;
            make.argument_count = static_cast<std::uint32_t>(elements.size());
            builder.emit(std::move(make));
            return {1, ValueKind::DynamicF64List, {}};
        }
        return indexed_layout(elements);
    }
    if (kind == "record") {
        ValueLayout layout;
        layout.width = 0;
        layout.kind = ValueKind::Aggregate;
        for (const auto& value : array_of(field(expression, "fields", "record"), "record fields")) {
            const auto& record_field = object_of(value, "record field");
            const auto& field_expression = object_of(
                field(record_field, "value", "record field"), "record field value");
            const auto field_layout = lower_expression(
                field_expression,
                builder,
                signatures,
                strings);
            ensure_independent_value(field_expression, field_layout, builder, signatures);
            const std::string field_name = string_field(record_field, "name", "record field");
            layout.selectors[field_name] = {layout.width, field_layout.width, field_layout.kind};
            for (const auto& [child, slice] : field_layout.selectors) {
                layout.selectors[field_name + "." + child] = {
                    layout.width + slice.offset, slice.width, slice.kind
                };
            }
            layout.width += field_layout.width;
        }
        return layout;
    }
    if (kind == "block_expr") {
        const auto& body = array_of(field(expression, "body", "block expression"), "block expression body");
        const ValueLayout result = layout_from_expression_shape(expression, signatures);
        builder.begin_scope();
        const auto result_local = builder.add_scoped_local("$block_result", result);
        emit_default_value(builder, result, strings);
        for (std::uint32_t component = result.width; component > 0; --component) {
            Instruction store;
            store.opcode = Opcode::StoreLocal;
            store.index = result_local + component - 1;
            builder.emit(std::move(store));
        }
        const auto finish = builder.next_label();
        builder.push_block_return(finish, result_local, result);
        for (std::size_t index = 0; index < body.size(); ++index) {
            const auto& statement = object_of(body[index], "block expression statement");
            const std::string statement_kind = string_field(
                statement, "kind", "block expression statement");
            const bool tail = index + 1 == body.size();
            if (statement_kind == "store_binding") {
                const std::string name = string_field(statement, "name", "block binding");
                const auto& value = object_of(field(statement, "value", "block binding"), "block binding value");
                const auto update = statement.find("update");
                const bool is_update = update != statement.end() && update->second.is_boolean() &&
                    update->second.as_boolean();
                if (is_update) {
                    const auto* existing = builder.find_layout(name);
                    if (!existing) {
                        throw LoweringFailure("block update requires an existing binding " + name);
                    }
                    const auto value_layout = lower_expression(value, builder, signatures, strings);
                    if (!same_layout(*existing, value_layout)) {
                        throw LoweringFailure("block update layout mismatch for " + name);
                    }
                    ensure_independent_value(value, value_layout, builder, signatures);
                    emit_release_layout_local(builder, builder.slot(name), *existing);
                    emit_store_binding(builder, name, value_layout, strings);
                    if (tail) {
                        emit_load_binding(builder, name, {0, value_layout.width, value_layout.kind});
                        if (value_layout.kind == ValueKind::String) {
                            builder.emit({Opcode::CloneString});
                        } else if (value_layout.kind == ValueKind::DynamicF64List ||
                                   value_layout.kind == ValueKind::NumericMultiset) {
                            builder.emit({Opcode::CloneF64List});
                        } else if ((value_layout.kind == ValueKind::Aggregate ||
                                    value_layout.kind == ValueKind::StringMultiset) &&
                                   has_owned_resources(value_layout)) {
                            clone_nested_resource_values(value_layout, builder);
                        }
                        emit_release_layout_local(builder, result_local, result);
                        for (std::uint32_t component = result.width; component > 0; --component) {
                            Instruction store;
                            store.opcode = Opcode::StoreLocal;
                            store.index = result_local + component - 1;
                            builder.emit(std::move(store));
                        }
                    }
                    continue;
                }
                const std::string value_kind = string_field(value, "kind", "block binding value");
                auto layout = value_kind == "load"
                    ? builder.layout(string_field(value, "name", "block binding value"))
                    : layout_from_expression_shape(value, signatures);
                const auto declared = statement.find("type");
                if (declared != statement.end() && declared->second.is_string()) {
                    const auto declared_layout = layout_from_type(
                        declared->second.as_string(), &signatures);
                    if (declared_layout.width > layout.width) layout = declared_layout;
                }
                const auto local = builder.add_scoped_local(
                    name, layout, true,
                    scalar_value_class_from_type(
                        string_field(statement, "type", "block binding"), layout));
                const auto value_layout = lower_expression(value, builder, signatures, strings);
                ensure_independent_value(value, value_layout, builder, signatures);
                emit_release_layout_local(builder, local, layout);
                emit_store_binding(builder, name, value_layout, strings);
                continue;
            }
            if (statement_kind == "expr_stmt" && tail) {
                const auto& value = object_of(
                    field(statement, "expr", "block expression tail"), "block expression tail value");
                const auto value_layout = lower_expression(value, builder, signatures, strings);
                if (!same_layout(value_layout, result)) {
                    throw LoweringFailure("machine IR block result layout mismatch");
                }
                ensure_independent_value(value, value_layout, builder, signatures);
                emit_release_layout_local(builder, result_local, result);
                for (std::uint32_t component = result.width; component > 0; --component) {
                    Instruction store;
                    store.opcode = Opcode::StoreLocal;
                    store.index = result_local + component - 1;
                    builder.emit(std::move(store));
                }
                continue;
            }
            vf::JsonValue::Array single_statement;
            single_statement.push_back(body[index]);
            lower_statements(single_statement, builder, false, signatures, strings);
        }
        builder.pop_block_return();
        Instruction finish_label;
        finish_label.opcode = Opcode::Label;
        finish_label.label = finish;
        builder.emit(std::move(finish_label));
        for (std::uint32_t component = 0; component < result.width; ++component) {
            Instruction load;
            load.opcode = Opcode::LoadLocal;
            load.index = result_local + component;
            builder.emit(std::move(load));
        }
        if (result.kind == ValueKind::String) {
            builder.emit({Opcode::CloneString});
        } else if (result.kind == ValueKind::DynamicF64List ||
                   result.kind == ValueKind::NumericMultiset) {
            builder.emit({Opcode::CloneF64List});
        } else if ((result.kind == ValueKind::Aggregate ||
                    result.kind == ValueKind::StringMultiset) &&
                   has_owned_resources(result)) {
            clone_nested_resource_values(result, builder);
        }
        const auto scoped_locals = builder.end_scope();
        for (const auto& local : scoped_locals) {
            emit_release_layout_local(builder, local.base, local.layout);
        }
        return result;
    }
    if (kind == "axis_align") {
        const auto& value = object_of(field(expression, "value", "axis align"), "axis align value");
        const std::string value_kind = string_field(value, "kind", "axis align value");
        if (value_kind == "list" || value_kind == "tuple") {
            const auto target = layout_from_fixed_literal_shape(value, signatures);
            const auto projected = lower_literal_projection_argument(
                value, target, builder, signatures, strings);
            if (projected) return *projected;
        }
        return lower_expression(value, builder, signatures, strings);
    }
    if (kind == "dotted_index" || kind == "field_access") {
        const auto dot_overload = signatures.find(".");
        if (dot_overload != signatures.end() && dot_overload->second.parameters.size() == 2) {
            const vf::JsonValue::Object* base = nullptr;
            std::optional<vf::JsonValue> key;
            bool use_overload = false;
            if (kind == "field_access") {
                base = &object_of(
                    field(expression, "object", "overloaded field access"),
                    "overloaded field access base");
                auto base_layout = layout_from_expression_shape(*base, signatures);
                if (string_field(*base, "kind", "overloaded field access base") == "load") {
                    base_layout = builder.layout(
                        string_field(*base, "name", "overloaded field access base"));
                }
                const std::string field_name = string_field(
                    expression, "field", "overloaded field access");
                use_overload = base_layout.kind == ValueKind::Aggregate &&
                    base_layout.selectors.find(field_name) == base_layout.selectors.end();
                if (use_overload) {
                    vf::JsonValue::Object constant;
                    constant["kind"] = vf::JsonValue("const");
                    constant["value"] = vf::JsonValue(field_name);
                    constant["type"] = vf::JsonValue("str");
                    key = vf::JsonValue(std::move(constant));
                }
            } else {
                base = &object_of(
                    field(expression, "base", "overloaded dotted index"),
                    "overloaded dotted index base");
                const auto& indices = array_of(
                    field(expression, "indices", "overloaded dotted index"),
                    "overloaded dotted indices");
                if (indices.size() == 1 && indices.front().is_object()) {
                    const auto& index = object_of(indices.front(), "overloaded dotted index key");
                    const auto value = index.find("value");
                    use_overload = value != index.end() && value->second.is_string();
                    if (use_overload) key = indices.front();
                }
            }
            if (use_overload && base != nullptr && key.has_value()) {
                vf::JsonValue::Object call;
                call["kind"] = vf::JsonValue("call");
                vf::JsonValue::Array call_args;
                call_args.emplace_back(*base);
                call_args.emplace_back(std::move(*key));
                call["args"] = vf::JsonValue(std::move(call_args));
                call["named_args"] = vf::JsonValue(vf::JsonValue::Array{});
                call["spread_args"] = vf::JsonValue(vf::JsonValue::Array{});
                vf::JsonValue::Object callee;
                callee["kind"] = vf::JsonValue("load");
                callee["name"] = vf::JsonValue(".");
                callee["type"] = vf::JsonValue("any");
                call["callee"] = vf::JsonValue(std::move(callee));
                call["type"] = vf::JsonValue("any");
                return lower_expression(call, builder, signatures, strings);
            }
        }
        if (kind == "dotted_index") {
            const auto& base = object_of(field(expression, "base", "dotted index"), "dotted index base");
            auto base_layout = layout_from_expression_shape(base, signatures);
            const std::string base_kind = string_field(base, "kind", "dotted index base");
            std::optional<std::string> fixed_vector_binding;
            std::uint32_t fixed_vector_offset = 0;
            if (base_kind == "load") {
                fixed_vector_binding = string_field(base, "name", "dotted index base");
                base_layout = builder.layout(*fixed_vector_binding);
            } else if (base_kind == "field_access") {
                const auto base_projection = projection_of(base);
                const auto& root_layout = builder.layout(base_projection.binding);
                const auto selected = root_layout.selectors.find(base_projection.path);
                if (selected != root_layout.selectors.end()) {
                    fixed_vector_binding = base_projection.binding;
                    fixed_vector_offset = selected->second.offset;
                    base_layout = projected_layout(
                        root_layout, base_projection.path, selected->second);
                }
            }
            if (base_layout.kind == ValueKind::DynamicF64List) {
                const auto& indices = array_of(field(expression, "indices", "dotted index"), "dotted indices");
                if (indices.size() > 1) {
                    if (string_field(base, "kind", "dynamic list base") != "load") {
                        throw LoweringFailure("multi-index dynamic list access requires a binding");
                    }
                    std::vector<ValueLayout> elements;
                    for (const auto& raw_index : indices) {
                        const auto lowered_base = lower_expression(base, builder, signatures, strings);
                        auto lowered_index = lower_expression(
                            object_of(raw_index, "dynamic list index"), builder, signatures, strings);
                        if (lowered_base.kind != ValueKind::DynamicF64List) {
                            throw LoweringFailure("dynamic list base layout mismatch");
                        }
                        lowered_index = emit_require_real_complex(
                            builder, strings, lowered_index, "index must be int or str");
                        require_scalar(lowered_index, "dynamic list index");
                        Instruction index;
                        index.opcode = Opcode::LoadF64ListIndex;
                        index.owns_input = false;
                        index.may_error = true;
                        const std::string message = "list index out of range";
                        index.error_message_offset = strings.intern(message);
                        index.byte_count = static_cast<std::uint32_t>(message.size());
                        builder.emit(std::move(index));
                        elements.push_back({});
                    }
                    return indexed_layout(elements);
                }
                if (indices.size() != 1) throw LoweringFailure("dynamic list index requires one index");
                const bool owns_input = expression_produces_owned_f64_list(base, signatures);
                const auto lowered_base = lower_expression(base, builder, signatures, strings);
                auto lowered_index = lower_expression(
                    object_of(indices.front(), "dynamic list index"), builder, signatures, strings);
                if (lowered_base.kind != ValueKind::DynamicF64List) {
                    throw LoweringFailure("dynamic list base layout mismatch");
                }
                lowered_index = emit_require_real_complex(
                    builder, strings, lowered_index, "index must be int or str");
                require_scalar(lowered_index, "dynamic list index");
                Instruction index;
                index.opcode = Opcode::LoadF64ListIndex;
                index.owns_input = owns_input;
                const std::string message = "list index out of range";
                index.may_error = true;
                index.error_message_offset = strings.intern(message);
                index.byte_count = static_cast<std::uint32_t>(message.size());
                if (const auto handler = builder.error_handler()) {
                    index.has_error_handler = true;
                    index.label = *handler;
                    index.error_value_local = *builder.error_value_local();
                    index.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(index));
                return {};
            }
            const auto& indices = array_of(field(expression, "indices", "dotted index"), "dotted indices");
            std::size_t expanded_index_count = indices.size();
            const auto expanded_count = expression.find("expanded_index_count");
            if (expanded_count != expression.end() && expanded_count->second.is_number()) {
                expanded_index_count = static_cast<std::size_t>(
                    expanded_count->second.as_number());
            }
            const auto nested_index = expression.find("nested_index");
            const bool explicitly_nested =
                nested_index != expression.end() && nested_index->second.is_boolean() &&
                nested_index->second.as_boolean();
            std::size_t inferred_rank = 0;
            ValueLayout rank_leaf = base_layout;
            while (rank_leaf.kind == ValueKind::Aggregate && !is_record_layout(rank_leaf)) {
                const auto elements = indexed_element_layouts(rank_leaf);
                if (elements.empty()) break;
                ++inferred_rank;
                rank_leaf = elements.front();
            }
            const bool full_rank_index = expanded_index_count > 1 &&
                (explicitly_nested || inferred_rank == expanded_index_count);
            if (full_rank_index &&
                base_layout.kind == ValueKind::Aggregate && !is_record_layout(base_layout) &&
                fixed_vector_binding.has_value()) {
                std::vector<std::uint32_t> dimensions;
                ValueLayout leaf = base_layout;
                while (leaf.kind == ValueKind::Aggregate) {
                    const auto elements = indexed_element_layouts(leaf);
                    if (elements.empty() || std::any_of(
                            elements.begin(), elements.end(), [&](const auto& candidate) {
                                return !same_layout(candidate, elements.front());
                            })) {
                        throw LoweringFailure(
                            "dynamic multidimensional index requires a rectangular vector");
                    }
                    dimensions.push_back(static_cast<std::uint32_t>(elements.size()));
                    leaf = elements.front();
                }
                if (expanded_index_count != dimensions.size() || leaf.width != 1 ||
                    leaf.kind == ValueKind::Aggregate) {
                    throw LoweringFailure(
                        "dynamic multidimensional index currently requires the full scalar rank");
                }
                std::vector<std::uint32_t> index_locals;
                std::vector<std::uint32_t> index_widths;
                std::optional<std::uint32_t> broadcast_width;
                bool integral = true;
                for (const auto& raw_index : indices) {
                    const auto& index_expression = object_of(
                        raw_index, "multidimensional vector index");
                    if (string_field(
                            index_expression, "kind", "multidimensional vector index") ==
                        "spread_index") {
                        const auto& spread_value = object_of(
                            field(index_expression, "value", "multidimensional index spill"),
                            "multidimensional index spill");
                        const auto spread_layout = lower_expression(
                            spread_value, builder, signatures, strings);
                        if (spread_layout.kind != ValueKind::Aggregate ||
                            !is_numeric_layout(spread_layout)) {
                            throw LoweringFailure(
                                "multidimensional index spill requires a fixed numeric vector");
                        }
                        const auto& count_value = field(
                            index_expression, "count", "multidimensional index spill");
                        if (!count_value.is_number()) {
                            throw LoweringFailure(
                                "multidimensional index spill requires a numeric width");
                        }
                        const auto count = static_cast<std::uint32_t>(
                            count_value.as_number());
                        if (spread_layout.width != count) {
                            throw LoweringFailure(
                                "multidimensional index spill width does not match its type");
                        }
                        const auto local = builder.add_borrowed_temporary(spread_layout);
                        for (std::uint32_t component = spread_layout.width; component > 0; --component) {
                            emit_store_local_component(builder, local + component - 1u);
                        }
                        for (std::uint32_t component = 0; component < count; ++component) {
                            index_locals.push_back(local + component);
                            index_widths.push_back(1u);
                        }
                        integral = false;
                        continue;
                    }
                    auto layout = lower_expression(
                        index_expression, builder, signatures, strings);
                    if (layout.width > 1) {
                        if (layout.kind != ValueKind::Aggregate || !is_numeric_layout(layout)) {
                            throw LoweringFailure(
                                "multidimensional vector index distribution requires a fixed numeric vector");
                        }
                        if (broadcast_width.has_value() && *broadcast_width != layout.width) {
                            throw LoweringFailure(
                                "distributed multidimensional index vectors must have matching shapes");
                        }
                        broadcast_width = layout.width;
                    } else {
                        layout = emit_require_real_complex(
                            builder, strings, layout, "index must be int or str");
                        require_scalar(layout, "multidimensional vector index");
                    }
                    const auto local = builder.add_borrowed_temporary(layout);
                    for (std::uint32_t component = layout.width; component > 0; --component) {
                        emit_store_local_component(builder, local + component - 1u);
                    }
                    index_locals.push_back(local);
                    index_widths.push_back(layout.width);
                    const auto type = index_expression.find("type");
                    integral = integral &&
                        ((type != index_expression.end() && type->second.is_string() &&
                          type->second.as_string() == "int") || builder.local_is_integral(local));
                }
                const std::uint32_t result_width = broadcast_width.value_or(1u);
                std::vector<ValueLayout> results;
                results.reserve(result_width);
                for (std::uint32_t lane = 0; lane < result_width; ++lane) {
                    emit_load_local_component(
                        builder,
                        index_locals.front() + (index_widths.front() > 1 ? lane : 0u));
                    for (std::size_t index = 1; index < index_locals.size(); ++index) {
                        emit_push_f64(builder, static_cast<double>(dimensions[index]));
                        builder.emit({Opcode::MultiplyF64});
                        emit_load_local_component(
                            builder,
                            index_locals[index] + (index_widths[index] > 1 ? lane : 0u));
                        builder.emit({Opcode::AddF64});
                    }
                    const auto flattened = builder.add_borrowed_temporary(
                        {}, integral ? ValueClass::I64 : ValueClass::F64);
                    emit_store_local_component(builder, flattened);
                    emit_load_local_component(builder, flattened);
                    Instruction load;
                    load.opcode = Opcode::LoadF64LocalsIndex;
                    load.index = builder.slot(*fixed_vector_binding, fixed_vector_offset);
                    load.argument_count = base_layout.width;
                    load.index_is_integral = integral;
                    load.index_local = flattened;
                    load.may_error = true;
                    const std::string message = "vector index out of range";
                    load.error_message_offset = strings.intern(message);
                    load.byte_count = static_cast<std::uint32_t>(message.size());
                    if (const auto handler = builder.error_handler()) {
                        load.has_error_handler = true;
                        load.label = *handler;
                        load.error_value_local = *builder.error_value_local();
                        load.error_type_local = *builder.error_type_local();
                    }
                    builder.emit(std::move(load));
                    results.push_back(leaf);
                }
                if (result_width == 1u) return leaf;
                const auto result_layout = layout_from_expression_shape(expression, signatures);
                if (result_layout.width != result_width || !is_numeric_layout(result_layout)) {
                    throw LoweringFailure(
                        "distributed multidimensional index result does not preserve its vector shape");
                }
                return result_layout;
            }
            if (indices.size() > 1 && base_layout.kind == ValueKind::Aggregate &&
                !is_record_layout(base_layout) && fixed_vector_binding.has_value()) {
                std::vector<ValueLayout> elements;
                const std::string& binding = *fixed_vector_binding;
                for (const auto& raw_index : indices) {
                    const auto& index = object_of(raw_index, "fixed multi-index");
                    const auto value = index.find("value");
                    if (value == index.end() || !value->second.is_number() ||
                        value->second.as_number() < 0 ||
                        value->second.as_number() != static_cast<double>(
                            static_cast<std::uint32_t>(value->second.as_number()))) {
                        throw LoweringFailure(
                            "fixed multi-index requires nonnegative integer constants "
                            "(expanded=" + std::to_string(expanded_index_count) +
                            ", inferred rank=" + std::to_string(inferred_rank) +
                            ", explicitly nested=" +
                            std::string(explicitly_nested ? "true" : "false") + ")");
                    }
                    const std::string key = std::to_string(
                        static_cast<std::uint32_t>(value->second.as_number()));
                    const auto selected = base_layout.selectors.find(key);
                    if (selected == base_layout.selectors.end()) {
                        throw LoweringFailure("fixed multi-index out of range");
                    }
                    auto selected_slice = selected->second;
                    selected_slice.offset += fixed_vector_offset;
                    emit_load_binding(builder, binding, selected_slice);
                    elements.push_back(projected_layout(base_layout, key, selected->second));
                }
                return indexed_layout(elements);
            }
            const bool constant_index = indices.size() == 1 && indices.front().is_object() &&
                object_of(indices.front(), "fixed index").find("value") !=
                    object_of(indices.front(), "fixed index").end();
            if (base_layout.kind == ValueKind::Aggregate && !is_record_layout(base_layout) &&
                base_layout.width > 0 && indices.size() == 1 && !constant_index &&
                fixed_vector_binding.has_value() &&
                is_numeric_layout(base_layout)) {
                const auto& index_expression = object_of(indices.front(), "fixed vector index");
                auto lowered_index = lower_expression(
                    index_expression, builder, signatures, strings);
                lowered_index = emit_require_real_complex(
                    builder, strings, lowered_index, "index must be int or str");
                require_scalar(lowered_index, "fixed vector index");
                const std::optional<std::uint32_t> direct_index_local =
                    string_field(index_expression, "kind", "fixed vector index") == "load"
                    ? std::optional<std::uint32_t>(builder.slot(string_field(
                        index_expression, "name", "fixed vector index")))
                    : std::nullopt;
                const auto elements = indexed_element_layouts(base_layout);
                if (elements.empty() ||
                    std::any_of(elements.begin(), elements.end(), [&](const auto& element) {
                        return !same_layout(element, elements.front());
                    })) {
                    throw LoweringFailure(
                        "dynamic fixed vector index requires one uniform element layout");
                }
                const auto index_type = index_expression.find("type");
                const bool index_is_integral =
                    (index_type != index_expression.end() &&
                     index_type->second.is_string() && index_type->second.as_string() == "int") ||
                    (direct_index_local && builder.local_is_integral(*direct_index_local));
                const bool index_is_proven = direct_index_local && fixed_index_proven(
                    builder, *direct_index_local,
                    static_cast<std::uint32_t>(elements.size()),
                    index_is_integral);
                const std::string message = "vector index out of range";
                const auto emit_index = [&](
                    const std::uint32_t count,
                    const bool integral,
                    const std::optional<std::uint32_t> direct_index_local = std::nullopt,
                    const bool may_error = true,
                    const std::uint32_t base_offset = 0u) {
                    Instruction index;
                    index.opcode = Opcode::LoadF64LocalsIndex;
                    index.index = builder.slot(
                        *fixed_vector_binding, fixed_vector_offset + base_offset);
                    index.argument_count = count;
                    index.index_is_integral = integral;
                    index.index_local = direct_index_local;
                    index.may_error = may_error;
                    index.error_message_offset = strings.intern(message);
                    index.byte_count = static_cast<std::uint32_t>(message.size());
                    if (const auto handler = builder.error_handler()) {
                        index.has_error_handler = true;
                        index.label = *handler;
                        index.error_value_local = *builder.error_value_local();
                        index.error_type_local = *builder.error_type_local();
                    }
                    builder.emit(std::move(index));
                };
                if (elements.front().width == 1u) {
                    emit_index(
                        base_layout.width, index_is_integral, direct_index_local,
                        !index_is_proven);
                    return elements.front();
                }
                const auto index_local = builder.add_borrowed_temporary(lowered_index);
                emit_store_local_component(builder, index_local);
                if (!index_is_proven) {
                    emit_load_local_component(builder, index_local);
                    emit_index(static_cast<std::uint32_t>(elements.size()), index_is_integral);
                    builder.emit({Opcode::Drop});
                }
                const auto [component_index_local, initialize_component_index] =
                    builder.flattened_index_local(
                        direct_index_local.value_or(index_local),
                        elements.front().width);
                if (initialize_component_index) {
                    emit_load_local_component(builder, index_local);
                    Instruction width;
                    width.opcode = Opcode::PushF64;
                    width.f64 = static_cast<double>(elements.front().width);
                    builder.emit(std::move(width));
                    builder.emit({Opcode::MultiplyF64});
                    emit_store_local_component(builder, component_index_local);
                }
                for (std::uint32_t component = 0; component < elements.front().width; ++component) {
                    emit_load_local_component(builder, component_index_local);
                    emit_index(
                        base_layout.width - component, true,
                        component_index_local, false, component);
                }
                return elements.front();
            }
        }
        const auto projection = projection_of(expression);
        const auto& layout = builder.layout(projection.binding);
        const auto found = layout.selectors.find(projection.path);
        if (found == layout.selectors.end()) {
            throw LoweringFailure(
                "unknown machine IR aggregate projection " + projection.binding + "." +
                projection.path + " in " + describe_layout(layout));
        }
        emit_load_binding(builder, projection.binding, found->second);
        return projected_layout(layout, projection.path, found->second);
    }
    if (kind == "unary_op") {
        const std::string op = string_field(expression, "op", "unary expression");
        const auto& operand_expression = object_of(
            field(expression, "operand", "unary expression"), "unary operand");
        const auto operand = lower_expression(
            operand_expression, builder, signatures, strings);
        if (operand.kind == ValueKind::Complex) {
            const auto value = builder.add_borrowed_temporary(operand);
            emit_store_local_component(builder, value + 1u);
            emit_store_local_component(builder, value);
            if (op == "PLUS") {
                emit_load_local_component(builder, value);
                emit_load_local_component(builder, value + 1u);
                return operand;
            }
            if (op == "MINUS") {
                emit_load_local_component(builder, value);
                builder.emit({Opcode::NegateF64});
                emit_load_local_component(builder, value + 1u);
                builder.emit({Opcode::NegateF64});
                return operand;
            }
            if (op == "ABS" || op == "NORM") {
                emit_load_local_component(builder, value);
                emit_load_local_component(builder, value);
                builder.emit({Opcode::MultiplyF64});
                emit_load_local_component(builder, value + 1u);
                emit_load_local_component(builder, value + 1u);
                builder.emit({Opcode::MultiplyF64});
                builder.emit({Opcode::AddF64});
                builder.emit({Opcode::SqrtF64});
                return {};
            }
            if (op == "NOT") {
                emit_load_local_component(builder, value);
                builder.emit({Opcode::BooleanizeF64});
                emit_load_local_component(builder, value + 1u);
                builder.emit({Opcode::BooleanizeF64});
                builder.emit({Opcode::AddF64});
                builder.emit({Opcode::LogicalNotF64});
                return {};
            }
            throw LoweringFailure("unsupported complex unary operator " + op);
        }
        if (op == "NORM") {
            if (operand.kind != ValueKind::Aggregate || !is_numeric_layout(operand) ||
                operand.width == 0) {
                throw LoweringFailure("machine IR norm requires a fixed numeric aggregate");
            }
            const auto temporary = builder.add_borrowed_temporary(operand);
            for (std::uint32_t component = operand.width; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = temporary + component - 1;
                builder.emit(std::move(store));
            }
            Instruction zero;
            zero.opcode = Opcode::PushF64;
            zero.f64 = 0.0;
            builder.emit(std::move(zero));
            for (std::uint32_t component = 0; component < operand.width; ++component) {
                Instruction load;
                load.opcode = Opcode::LoadLocal;
                load.index = temporary + component;
                builder.emit(load);
                builder.emit(load);
                builder.emit({Opcode::MultiplyF64});
                builder.emit({Opcode::AddF64});
            }
            builder.emit({Opcode::SqrtF64});
            return {};
        }
        require_scalar(operand, "machine IR unary operator");
        if (op == "ABS") {
            builder.emit({Opcode::AbsF64});
            return {};
        }
        const auto opcode = scalar_unary_opcode(op);
        if (!opcode) throw LoweringFailure("unsupported machine IR unary operator " + op);
        builder.emit({*opcode});
        return {};
    }
    if (kind == "binary_op") {
        const std::string op = string_field(expression, "op", "binary expression");
        if (op == "AND" || op == "OR") {
            const auto left = lower_expression(
                object_of(field(expression, "left", "binary expression"), "left expression"),
                builder, signatures, strings);
            require_scalar(left, "machine IR logical operator");
            builder.emit({Opcode::BooleanizeF64});
            builder.emit({Opcode::Duplicate});
            const std::uint32_t finish = builder.next_label();
            Instruction jump;
            jump.opcode = op == "AND" ? Opcode::JumpIfFalse : Opcode::JumpIfTrue;
            jump.label = finish;
            builder.emit(std::move(jump));
            builder.emit({Opcode::Drop});
            const auto right = lower_expression(
                object_of(field(expression, "right", "binary expression"), "right expression"),
                builder, signatures, strings);
            require_scalar(right, "machine IR logical operator");
            builder.emit({Opcode::BooleanizeF64});
            Instruction label;
            label.opcode = Opcode::Label;
            label.label = finish;
            builder.emit(std::move(label));
            return {};
        }
        const auto& left_expression = object_of(
            field(expression, "left", "binary expression"), "left expression");
        const auto& right_expression = object_of(
            field(expression, "right", "binary expression"), "right expression");
        const std::string result_surface_type = string_field(
            expression, "type", "binary expression");
        if (symbolic_expression_surface_type(result_surface_type)) {
            const auto lower_symbolic_operand = [&](const vf::JsonValue::Object& operand,
                                                    const std::string& context) {
                const auto layout = lower_expression(
                    operand, builder, signatures, strings);
                if (layout.kind == ValueKind::DynamicF64List) {
                    if (!expression_produces_owned_f64_list(operand, signatures)) {
                        builder.emit({Opcode::CloneF64List});
                    }
                    return;
                }
                require_scalar(layout, context);
                const auto numeric_value = builder.add_borrowed_temporary(layout);
                emit_store_local_component(builder, numeric_value);
                Instruction numeric_tag;
                numeric_tag.opcode = Opcode::PushF64;
                numeric_tag.f64 = 2.0;
                builder.emit(std::move(numeric_tag));
                emit_load_local_component(builder, numeric_value);
                Instruction numeric_size;
                numeric_size.opcode = Opcode::PushF64;
                numeric_size.f64 = 3.0;
                builder.emit(std::move(numeric_size));
                Instruction numeric;
                numeric.opcode = Opcode::MakeOwnedF64List;
                numeric.argument_count = 3;
                builder.emit(std::move(numeric));
            };
            lower_symbolic_operand(left_expression, "symbolic left operand");
            lower_symbolic_operand(right_expression, "symbolic right operand");
            const ValueLayout symbolic_layout{1, ValueKind::DynamicF64List, {}};
            const auto right_symbolic = builder.add_borrowed_temporary(symbolic_layout);
            emit_store_local_component(builder, right_symbolic);
            const auto left_symbolic = builder.add_borrowed_temporary(symbolic_layout);
            emit_store_local_component(builder, left_symbolic);
            emit_load_local_component(builder, left_symbolic);
            builder.emit({Opcode::CountF64List});
            emit_load_local_component(builder, right_symbolic);
            builder.emit({Opcode::CountF64List});
            builder.emit({Opcode::AddF64});
            emit_push_f64(builder, 3.0);
            builder.emit({Opcode::AddF64});
            const auto subtree_size = builder.add_borrowed_temporary({});
            emit_store_local_component(builder, subtree_size);
            emit_load_local_component(builder, left_symbolic);
            emit_load_local_component(builder, right_symbolic);
            Instruction join_operands;
            join_operands.opcode = Opcode::ConcatF64Lists;
            join_operands.owns_left = true;
            join_operands.owns_right = true;
            builder.emit(std::move(join_operands));
            const auto symbolic_opcode = op == "PLUS" ? 1.0
                : op == "MINUS" ? 2.0 : op == "STAR" ? 3.0
                : op == "SLASH" ? 4.0 : op == "CARET" ? 5.0
                : op == "EQ" || op == "EXACT_EQ" ? 6.0
                : op == "NE" || op == "NEQ" ? 7.0
                : op == "LT" ? 8.0 : op == "LE" ? 9.0
                : op == "GT" ? 10.0 : op == "GE" ? 11.0
                : op == "AND" ? 12.0 : op == "OR" ? 13.0 : 0.0;
            emit_push_f64(builder, 3.0);
            emit_push_f64(builder, symbolic_opcode);
            emit_load_local_component(builder, subtree_size);
            Instruction operation;
            operation.opcode = Opcode::MakeOwnedF64List;
            operation.argument_count = 3;
            builder.emit(std::move(operation));
            Instruction append_operation;
            append_operation.opcode = Opcode::ConcatF64Lists;
            append_operation.owns_left = true;
            append_operation.owns_right = true;
            builder.emit(std::move(append_operation));
            return {1, ValueKind::DynamicF64List, {}};
        }
        const bool structural_arithmetic =
            op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH" ||
            op == "FLOORDIV" || op == "PERCENT" || op == "CARET";
        if (op == "SLASH" &&
            string_field(
                right_expression, "kind", "inverse norm expression") == "binary_op" &&
            string_field(
                right_expression, "op", "inverse norm expression") == "CARET") {
            const auto& exponent = object_of(
                field(right_expression, "right", "inverse norm expression"),
                "inverse norm exponent");
            const auto& norm = object_of(
                field(right_expression, "left", "inverse norm expression"),
                "inverse norm base");
            const auto exponent_value = exponent.find("value");
            if (string_field(exponent, "kind", "inverse norm exponent") == "const" &&
                exponent_value != exponent.end() && exponent_value->second.is_number() &&
                exponent_value->second.as_number() == 3.0 &&
                string_field(norm, "kind", "inverse norm base") == "unary_op" &&
                string_field(norm, "op", "inverse norm base") == "NORM") {
                const auto& vector = object_of(
                    field(norm, "operand", "inverse norm base"),
                    "inverse norm operand");
                const auto vector_layout =
                    layout_from_expression_shape(vector, signatures);
                if (vector_layout.kind == ValueKind::Aggregate &&
                    !is_record_layout(vector_layout) &&
                    is_numeric_layout(vector_layout) && vector_layout.width > 0u &&
                    component_lowering_eligible(vector, signatures)) {
                    const auto numerator = lower_expression(
                        left_expression, builder, signatures, strings);
                    require_scalar(numerator, "inverse cubic norm numerator");
                    const auto numerator_local =
                        builder.add_borrowed_temporary(numerator);
                    emit_store_local_component(builder, numerator_local);

                    for (std::uint32_t component = 0;
                         component < vector_layout.width; ++component) {
                        if (!lower_numeric_component(
                                vector, component, builder, signatures, strings) ||
                            !lower_numeric_component(
                                vector, component, builder, signatures, strings)) {
                            throw LoweringFailure(
                                "inverse cubic norm component lowering failed");
                        }
                        builder.emit({Opcode::MultiplyF64});
                        if (component != 0u) builder.emit({Opcode::AddF64});
                    }
                    const auto squared_local =
                        builder.add_borrowed_temporary({});
                    emit_store_local_component(builder, squared_local);
                    emit_load_local_component(builder, numerator_local);
                    emit_load_local_component(builder, squared_local);
                    emit_load_local_component(builder, squared_local);
                    builder.emit({Opcode::SqrtF64});
                    builder.emit({Opcode::MultiplyF64});
                    builder.emit({Opcode::DivideF64});
                    return {};
                }
            }
        }
        if (op == "CARET" &&
            string_field(right_expression, "kind", "power exponent") == "const") {
            const auto exponent = right_expression.find("value");
            const std::string left_type = string_field(
                left_expression, "type", "power base");
            const bool scalar_numeric =
                left_type == "int" || left_type == "num" ||
                left_type == "f32" || left_type == "f64";
            const auto power_base_layout =
                layout_from_expression_shape(left_expression, signatures);
            if (scalar_numeric && power_base_layout.width == 1u &&
                power_base_layout.kind == ValueKind::Numeric &&
                exponent != right_expression.end() &&
                exponent->second.is_number() &&
                (exponent->second.as_number() == 2.0 ||
                 exponent->second.as_number() == 3.0)) {
                const auto left = lower_expression(
                    left_expression, builder, signatures, strings);
                require_scalar(left, "small integer power base");
                const auto value = builder.add_borrowed_temporary(left);
                emit_store_local_component(builder, value);
                emit_load_local_component(builder, value);
                emit_load_local_component(builder, value);
                builder.emit({Opcode::MultiplyF64});
                if (exponent->second.as_number() == 3.0) {
                    emit_load_local_component(builder, value);
                    builder.emit({Opcode::MultiplyF64});
                }
                return {};
            }
        }
        if (structural_arithmetic && op != "CARET") {
            const auto left_shape =
                layout_from_expression_shape(left_expression, signatures);
            const auto right_shape =
                layout_from_expression_shape(right_expression, signatures);
            const std::string left_type = string_field(
                left_expression, "type", "component-wise left type");
            const std::string right_type = string_field(
                right_expression, "type", "component-wise right type");
            const bool distinct_named_axes =
                left_type.rfind("axis<", 0) == 0 &&
                right_type.rfind("axis<", 0) == 0 &&
                left_type.substr(5, left_type.find('>') - 5) !=
                    right_type.substr(5, right_type.find('>') - 5);
            const bool left_aggregate =
                left_shape.kind == ValueKind::Aggregate &&
                !is_record_layout(left_shape) && is_numeric_layout(left_shape);
            const bool right_aggregate =
                right_shape.kind == ValueKind::Aggregate &&
                !is_record_layout(right_shape) && is_numeric_layout(right_shape);
            const bool compatible_widths =
                !left_aggregate || !right_aggregate ||
                left_shape.width == right_shape.width;
            const auto is_numeric_zero = [](const vf::JsonValue::Object& value) {
                const auto raw = value.find("value");
                return string_field(value, "kind", "structural zero") == "const" &&
                    raw != value.end() && raw->second.is_number() &&
                    raw->second.as_number() == 0.0;
            };
            const auto is_numeric_one = [](const vf::JsonValue::Object& value) {
                const auto raw = value.find("value");
                return string_field(value, "kind", "structural one") == "const" &&
                    raw != value.end() && raw->second.is_number() &&
                    raw->second.as_number() == 1.0;
            };
            if (op == "STAR" && (left_aggregate || right_aggregate) &&
                ((left_shape.width == 1u && is_numeric_zero(left_expression)) ||
                 (right_shape.width == 1u && is_numeric_zero(right_expression)))) {
                const auto result = left_aggregate ? left_shape : right_shape;
                const auto result_local = builder.add_borrowed_temporary(result);
                for (std::uint32_t component = 0; component < result.width; ++component) {
                    emit_push_f64(builder, 0.0);
                    emit_store_local_component(builder, result_local + component);
                }
                for (std::uint32_t component = 0; component < result.width; ++component) {
                    emit_load_local_component(builder, result_local + component);
                }
                return result;
            }
            if (op == "STAR" && !distinct_named_axes && compatible_widths &&
                ((left_aggregate && right_shape.width == 1u &&
                  is_numeric_one(right_expression)) ||
                 (right_aggregate && left_shape.width == 1u &&
                  is_numeric_one(left_expression)))) {
                return lower_expression(
                    left_aggregate ? left_expression : right_expression,
                    builder, signatures, strings);
            }
            if (!distinct_named_axes && (left_aggregate || right_aggregate) && compatible_widths &&
                component_lowering_eligible(left_expression, signatures) &&
                component_lowering_eligible(right_expression, signatures)) {
                const auto result =
                    left_aggregate ? left_shape : right_shape;
                prepare_numeric_component_expression(
                    left_expression, builder, signatures, strings);
                prepare_numeric_component_expression(
                    right_expression, builder, signatures, strings);
                const auto result_local = builder.add_borrowed_temporary(result);
                for (std::uint32_t component = 0;
                     component < result.width; ++component) {
                    if (!lower_numeric_component(
                            left_expression,
                            left_shape.width == 1u ? 0u : component,
                            builder, signatures, strings) ||
                        !lower_numeric_component(
                            right_expression,
                            right_shape.width == 1u ? 0u : component,
                            builder, signatures, strings)) {
                        throw LoweringFailure(
                            "component-wise fixed vector lowering failed");
                    }
                    const auto opcode = scalar_binary_opcode(op);
                    if (!opcode) {
                        throw LoweringFailure(
                            "unsupported component-wise operator " + op);
                    }
                    builder.emit({*opcode});
                    emit_store_local_component(builder, result_local + component);
                }
                for (std::uint32_t component = 0;
                     component < result.width; ++component) {
                    emit_load_local_component(builder, result_local + component);
                }
                return result;
            }
        }
        const auto left = lower_expression(left_expression, builder, signatures, strings);
        const auto right = lower_expression(right_expression, builder, signatures, strings);
        if (structural_arithmetic && left.kind == ValueKind::Aggregate &&
            right.kind == ValueKind::Numeric && right.width == 1) {
            const auto opcode = scalar_binary_opcode(op);
            if (!opcode) {
                throw LoweringFailure("unsupported structural machine IR operator " + op);
            }
            const auto right_temporary = builder.add_borrowed_temporary(right);
            emit_store_local_component(builder, right_temporary);
            ensure_independent_value(left_expression, left, builder, signatures);
            const auto left_temporary = builder.add_borrowed_temporary(left);
            for (std::uint32_t component = left.width; component > 0; --component) {
                emit_store_local_component(builder, left_temporary + component - 1u);
            }
            const auto matches = numeric_structural_layout_matches(left);
            std::set<std::uint32_t> numeric_offsets;
            for (const auto& match : matches) numeric_offsets.insert(match.offset);
            for (std::uint32_t component = 0; component < left.width; ++component) {
                emit_load_local_component(builder, left_temporary + component);
                if (numeric_offsets.count(component)) {
                    emit_load_local_component(builder, right_temporary);
                    builder.emit({*opcode});
                }
            }
            return left;
        }
        if (structural_arithmetic && left.kind == ValueKind::Numeric && left.width == 1 &&
            right.kind == ValueKind::Aggregate) {
            const auto opcode = scalar_binary_opcode(op);
            if (!opcode) {
                throw LoweringFailure("unsupported structural machine IR operator " + op);
            }
            ensure_independent_value(right_expression, right, builder, signatures);
            const auto right_temporary = builder.add_borrowed_temporary(right);
            for (std::uint32_t component = right.width; component > 0; --component) {
                emit_store_local_component(builder, right_temporary + component - 1u);
            }
            const auto left_temporary = builder.add_borrowed_temporary(left);
            emit_store_local_component(builder, left_temporary);
            const auto matches = numeric_structural_layout_matches(right);
            std::set<std::uint32_t> numeric_offsets;
            for (const auto& match : matches) numeric_offsets.insert(match.offset);
            for (std::uint32_t component = 0; component < right.width; ++component) {
                if (numeric_offsets.count(component)) {
                    emit_load_local_component(builder, left_temporary);
                    emit_load_local_component(builder, right_temporary + component);
                    builder.emit({*opcode});
                } else {
                    emit_load_local_component(builder, right_temporary + component);
                }
            }
            return right;
        }
        const std::string left_surface_type = string_field(
            left_expression, "type", "binary left type");
        const std::string right_surface_type = string_field(
            right_expression, "type", "binary right type");
        if (left.kind == ValueKind::Complex || right.kind == ValueKind::Complex) {
            if ((op == "EXACT_EQ" || op == "NE" || op == "NEQ") &&
                left_surface_type != "any" && right_surface_type != "any" &&
                left_surface_type != right_surface_type) {
                for (std::uint32_t component = 0; component < left.width + right.width; ++component) {
                    builder.emit({Opcode::Drop});
                }
                Instruction result;
                result.opcode = Opcode::PushF64;
                result.f64 = op == "EXACT_EQ" ? 0.0 : 1.0;
                builder.emit(std::move(result));
                return {};
            }
            if (op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH") {
                emit_complex_binary_arithmetic(builder, op, left, right);
                return {2, ValueKind::Complex, {}};
            }
            if (op == "CARET") {
                const auto raw = right_expression.find("value");
                if (string_field(right_expression, "kind", "complex exponent") != "const" ||
                    raw == right_expression.end() || !raw->second.is_number() ||
                    std::floor(raw->second.as_number()) != raw->second.as_number() ||
                    std::fabs(raw->second.as_number()) > 64.0) {
                    throw LoweringFailure(
                        "complex power currently requires an integer exponent from -64 to 64");
                }
                const auto right_value = builder.add_borrowed_temporary(right);
                for (std::uint32_t component = right.width; component > 0; --component) {
                    emit_store_local_component(builder, right_value + component - 1u);
                }
                const auto left_value = builder.add_borrowed_temporary(left);
                for (std::uint32_t component = left.width; component > 0; --component) {
                    emit_store_local_component(builder, left_value + component - 1u);
                }
                const ValueLayout complex_layout{2, ValueKind::Complex, {}};
                const auto result = builder.add_borrowed_temporary(complex_layout);
                Instruction one;
                one.opcode = Opcode::PushF64;
                one.f64 = 1.0;
                builder.emit(std::move(one));
                Instruction zero;
                zero.opcode = Opcode::PushF64;
                zero.f64 = 0.0;
                builder.emit(std::move(zero));
                emit_store_local_component(builder, result + 1u);
                emit_store_local_component(builder, result);
                const auto exponent = static_cast<long long>(raw->second.as_number());
                for (long long iteration = 0; iteration < std::llabs(exponent); ++iteration) {
                    emit_load_local_component(builder, result);
                    emit_load_local_component(builder, result + 1u);
                    emit_load_local_component(builder, left_value);
                    if (left.kind == ValueKind::Complex) {
                        emit_load_local_component(builder, left_value + 1u);
                    }
                    emit_complex_binary_arithmetic(
                        builder, "STAR", complex_layout, left);
                    emit_store_local_component(builder, result + 1u);
                    emit_store_local_component(builder, result);
                }
                if (exponent < 0) {
                    Instruction numerator_real;
                    numerator_real.opcode = Opcode::PushF64;
                    numerator_real.f64 = 1.0;
                    builder.emit(std::move(numerator_real));
                    Instruction numerator_imag;
                    numerator_imag.opcode = Opcode::PushF64;
                    numerator_imag.f64 = 0.0;
                    builder.emit(std::move(numerator_imag));
                    emit_load_local_component(builder, result);
                    emit_load_local_component(builder, result + 1u);
                    emit_complex_binary_arithmetic(
                        builder, "SLASH", complex_layout, complex_layout);
                    emit_store_local_component(builder, result + 1u);
                    emit_store_local_component(builder, result);
                }
                emit_load_local_component(builder, result);
                emit_load_local_component(builder, result + 1u);
                return complex_layout;
            }
            if (op == "EQ" || op == "EXACT_EQ" || op == "NE" || op == "NEQ" ||
                op == "STRUCT_NEQ" || op == "LT" || op == "LE" || op == "GT" || op == "GE") {
                emit_complex_comparison(builder, strings, op, left, right);
                return {};
            }
            throw LoweringFailure("unsupported complex binary operator " + op);
        }
        if (op == "AMPERSAND" &&
            (left_surface_type == "chr" || left.kind == ValueKind::String) &&
            (right_surface_type == "chr" || right.kind == ValueKind::String)) {
            const auto right_temporary = builder.add_borrowed_temporary(right);
            for (std::uint32_t component = right.width; component > 0; --component) {
                emit_store_local_component(builder, right_temporary + component - 1u);
            }
            const auto left_temporary = builder.add_borrowed_temporary(left);
            for (std::uint32_t component = left.width; component > 0; --component) {
                emit_store_local_component(builder, left_temporary + component - 1u);
            }
            const auto render_operand = [&](std::uint32_t base,
                                            const ValueLayout& layout,
                                            const std::string& surface_type) {
                for (std::uint32_t component = 0; component < layout.width; ++component) {
                    emit_load_local_component(builder, base + component);
                }
                if (surface_type == "chr") builder.emit({Opcode::FormatChrString});
                else builder.emit({Opcode::CloneString});
            };
            render_operand(left_temporary, left, left_surface_type);
            render_operand(right_temporary, right, right_surface_type);
            Instruction concat;
            concat.opcode = Opcode::ConcatStrings;
            concat.owns_left = true;
            concat.owns_right = true;
            builder.emit(std::move(concat));
            if (left.kind == ValueKind::String &&
                expression_transfers_string_value(left_expression, signatures)) {
                emit_release_layout_local(builder, left_temporary, left);
            }
            if (right.kind == ValueKind::String &&
                expression_transfers_string_value(right_expression, signatures)) {
                emit_release_layout_local(builder, right_temporary, right);
            }
            return {2, ValueKind::String, {}};
        }
        if (left.kind == ValueKind::StringMultiset || right.kind == ValueKind::StringMultiset) {
            const bool left_multiset = left.kind == ValueKind::StringMultiset;
            const bool right_multiset = right.kind == ValueKind::StringMultiset;
            if (left_multiset && right_multiset) {
                if (op != "PLUS" && op != "AMPERSAND" && op != "MINUS" &&
                    op != "FLOORDIV" && op != "PERCENT" &&
                    op != "EXACT_EQ" && op != "NE" && op != "NEQ") {
                    throw LoweringFailure("string multisets support +, &, -, //, and % count operators");
                }
                const bool owns_right = expression_transfers_aggregate_value(
                    right_expression, signatures);
                const bool owns_left = expression_transfers_aggregate_value(
                    left_expression, signatures);
                const auto right_temporary = owns_right
                    ? builder.add_owned_temporary(right)
                    : builder.add_borrowed_temporary(right);
                for (std::uint32_t component = right.width; component > 0; --component) {
                    emit_store_local_component(builder, right_temporary + component - 1u);
                }
                const auto left_temporary = owns_left
                    ? builder.add_owned_temporary(left)
                    : builder.add_borrowed_temporary(left);
                for (std::uint32_t component = left.width; component > 0; --component) {
                    emit_store_local_component(builder, left_temporary + component - 1u);
                }
                if (op == "EXACT_EQ" || op == "NE" || op == "NEQ") {
                    const auto truth = builder.add_borrowed_temporary({});
                    Instruction one;
                    one.opcode = Opcode::PushF64;
                    one.f64 = 1.0;
                    builder.emit(std::move(one));
                    emit_store_local_component(builder, truth);
                    const auto verify_entries = [&](std::uint32_t source_base,
                                                    const ValueLayout& source_layout,
                                                    std::uint32_t target_base,
                                                    const ValueLayout& target_layout) {
                        const std::uint32_t source_entries = source_layout.width / 3u;
                        const std::uint32_t target_entries = target_layout.width / 3u;
                        const auto matched = builder.add_borrowed_temporary({});
                        for (std::uint32_t source_entry = 0; source_entry < source_entries; ++source_entry) {
                            const auto entry_done = builder.next_label();
                            emit_load_local_component(builder, source_base + source_entry * 3u + 2u);
                            Instruction zero;
                            zero.opcode = Opcode::PushF64;
                            zero.f64 = 0.0;
                            builder.emit(std::move(zero));
                            builder.emit({Opcode::OrderedGreaterF64});
                            Instruction skip_empty;
                            skip_empty.opcode = Opcode::JumpIfFalse;
                            skip_empty.label = entry_done;
                            builder.emit(std::move(skip_empty));
                            Instruction unmatched;
                            unmatched.opcode = Opcode::PushF64;
                            unmatched.f64 = 0.0;
                            builder.emit(std::move(unmatched));
                            emit_store_local_component(builder, matched);
                            const auto scan_done = builder.next_label();
                            for (std::uint32_t target_entry = 0; target_entry < target_entries; ++target_entry) {
                                const auto next = builder.next_label();
                                emit_load_local_component(builder, target_base + target_entry * 3u + 2u);
                                Instruction target_zero;
                                target_zero.opcode = Opcode::PushF64;
                                target_zero.f64 = 0.0;
                                builder.emit(std::move(target_zero));
                                builder.emit({Opcode::OrderedGreaterF64});
                                Instruction skip_target;
                                skip_target.opcode = Opcode::JumpIfFalse;
                                skip_target.label = next;
                                builder.emit(std::move(skip_target));
                                emit_string_local_comparison(
                                    builder,
                                    source_base + source_entry * 3u,
                                    target_base + target_entry * 3u,
                                    Opcode::StringEqual);
                                Instruction skip_key;
                                skip_key.opcode = Opcode::JumpIfFalse;
                                skip_key.label = next;
                                builder.emit(std::move(skip_key));
                                emit_load_local_component(builder, source_base + source_entry * 3u + 2u);
                                emit_load_local_component(builder, target_base + target_entry * 3u + 2u);
                                builder.emit({Opcode::OrderedEqualF64});
                                Instruction skip_count;
                                skip_count.opcode = Opcode::JumpIfFalse;
                                skip_count.label = next;
                                builder.emit(std::move(skip_count));
                                Instruction found;
                                found.opcode = Opcode::PushF64;
                                found.f64 = 1.0;
                                builder.emit(std::move(found));
                                emit_store_local_component(builder, matched);
                                Instruction finish_scan;
                                finish_scan.opcode = Opcode::Jump;
                                finish_scan.label = scan_done;
                                builder.emit(std::move(finish_scan));
                                Instruction next_label;
                                next_label.opcode = Opcode::Label;
                                next_label.label = next;
                                builder.emit(std::move(next_label));
                            }
                            Instruction scan_done_label;
                            scan_done_label.opcode = Opcode::Label;
                            scan_done_label.label = scan_done;
                            builder.emit(std::move(scan_done_label));
                            emit_load_local_component(builder, truth);
                            emit_load_local_component(builder, matched);
                            builder.emit({Opcode::MultiplyF64});
                            emit_store_local_component(builder, truth);
                            Instruction entry_done_label;
                            entry_done_label.opcode = Opcode::Label;
                            entry_done_label.label = entry_done;
                            builder.emit(std::move(entry_done_label));
                        }
                    };
                    verify_entries(left_temporary, left, right_temporary, right);
                    verify_entries(right_temporary, right, left_temporary, left);
                    emit_load_local_component(builder, truth);
                    if (op != "EXACT_EQ") builder.emit({Opcode::LogicalNotF64});
                    if (owns_left) {
                        emit_release_layout_local(builder, left_temporary, left);
                    }
                    if (owns_right) {
                        emit_release_layout_local(builder, right_temporary, right);
                    }
                    return {};
                }
                ValueLayout result_layout;
                if (op == "PLUS" || op == "AMPERSAND") {
                    result_layout = string_multiset_layout(left.width / 3u + right.width / 3u);
                    emit_clone_string_multiset_entries(builder, left_temporary, left);
                    emit_clone_string_multiset_entries(builder, right_temporary, right);
                } else {
                    result_layout = string_multiset_layout(left.width / 3u);
                    const std::uint32_t left_entries = left.width / 3u;
                    const std::uint32_t right_entries = right.width / 3u;
                    const auto count_value = builder.add_borrowed_temporary({});
                    const auto matched = builder.add_borrowed_temporary({});
                    for (std::uint32_t left_entry = 0; left_entry < left_entries; ++left_entry) {
                        emit_load_local_component(builder, left_temporary + left_entry * 3u);
                        emit_load_local_component(builder, left_temporary + left_entry * 3u + 1u);
                        builder.emit({Opcode::CloneString});
                        emit_load_local_component(builder, left_temporary + left_entry * 3u + 2u);
                        emit_store_local_component(builder, count_value);
                        Instruction zero;
                        zero.opcode = Opcode::PushF64;
                        zero.f64 = 0.0;
                        builder.emit(std::move(zero));
                        emit_store_local_component(builder, matched);
                        const auto scan_done = builder.next_label();
                        for (std::uint32_t right_entry = 0; right_entry < right_entries; ++right_entry) {
                            const auto next = builder.next_label();
                            emit_load_local_component(builder, right_temporary + right_entry * 3u + 2u);
                            Instruction count_zero;
                            count_zero.opcode = Opcode::PushF64;
                            count_zero.f64 = 0.0;
                            builder.emit(std::move(count_zero));
                            builder.emit({Opcode::OrderedGreaterF64});
                            Instruction skip_empty;
                            skip_empty.opcode = Opcode::JumpIfFalse;
                            skip_empty.label = next;
                            builder.emit(std::move(skip_empty));
                            emit_string_local_comparison(
                                builder,
                                left_temporary + left_entry * 3u,
                                right_temporary + right_entry * 3u,
                                Opcode::StringEqual);
                            Instruction skip_different;
                            skip_different.opcode = Opcode::JumpIfFalse;
                            skip_different.label = next;
                            builder.emit(std::move(skip_different));
                            emit_load_local_component(builder, count_value);
                            emit_load_local_component(builder, right_temporary + right_entry * 3u + 2u);
                            builder.emit({op == "MINUS" ? Opcode::SubtractF64
                                : op == "FLOORDIV" ? Opcode::FloorDivideF64
                                : Opcode::RemainderF64});
                            emit_store_local_component(builder, count_value);
                            Instruction one;
                            one.opcode = Opcode::PushF64;
                            one.f64 = 1.0;
                            builder.emit(std::move(one));
                            emit_store_local_component(builder, matched);
                            Instruction finish_scan;
                            finish_scan.opcode = Opcode::Jump;
                            finish_scan.label = scan_done;
                            builder.emit(std::move(finish_scan));
                            Instruction next_label;
                            next_label.opcode = Opcode::Label;
                            next_label.label = next;
                            builder.emit(std::move(next_label));
                        }
                        Instruction scan_done_label;
                        scan_done_label.opcode = Opcode::Label;
                        scan_done_label.label = scan_done;
                        builder.emit(std::move(scan_done_label));
                        if (op == "FLOORDIV" || op == "PERCENT") {
                            const auto keep = builder.next_label();
                            emit_load_local_component(builder, matched);
                            Instruction keep_matched;
                            keep_matched.opcode = Opcode::JumpIfTrue;
                            keep_matched.label = keep;
                            builder.emit(std::move(keep_matched));
                            Instruction clear;
                            clear.opcode = Opcode::PushF64;
                            clear.f64 = 0.0;
                            builder.emit(std::move(clear));
                            emit_store_local_component(builder, count_value);
                            Instruction keep_label;
                            keep_label.opcode = Opcode::Label;
                            keep_label.label = keep;
                            builder.emit(std::move(keep_label));
                        }
                        emit_load_local_component(builder, count_value);
                    }
                }
                const auto normalized = emit_normalize_string_multiset(builder, result_layout);
                if (owns_left) {
                    emit_release_layout_local(builder, left_temporary, left);
                }
                if (owns_right) {
                    emit_release_layout_local(builder, right_temporary, right);
                }
                return normalized;
            }
            if ((left_multiset && right.kind == ValueKind::Numeric) ||
                (right_multiset && left.kind == ValueKind::Numeric && op == "PLUS")) {
                if (op != "PLUS" && op != "MINUS" && op != "FLOORDIV") {
                    throw LoweringFailure("unsupported string multiset scalar operator " + op);
                }
                const ValueLayout multiset_layout = left_multiset ? left : right;
                const auto multiset_temporary = builder.add_borrowed_temporary(multiset_layout);
                const auto scalar_temporary = builder.add_borrowed_temporary({});
                if (left_multiset) {
                    emit_store_local_component(builder, scalar_temporary);
                    for (std::uint32_t component = multiset_layout.width; component > 0; --component) {
                        emit_store_local_component(builder, multiset_temporary + component - 1u);
                    }
                } else {
                    for (std::uint32_t component = multiset_layout.width; component > 0; --component) {
                        emit_store_local_component(builder, multiset_temporary + component - 1u);
                    }
                    emit_store_local_component(builder, scalar_temporary);
                }
                const std::uint32_t entries = multiset_layout.width / 3u;
                for (std::uint32_t entry = 0; entry < entries; ++entry) {
                    emit_load_local_component(builder, multiset_temporary + entry * 3u);
                    emit_load_local_component(builder, multiset_temporary + entry * 3u + 1u);
                    builder.emit({Opcode::CloneString});
                    emit_load_local_component(builder, multiset_temporary + entry * 3u + 2u);
                    emit_load_local_component(builder, scalar_temporary);
                    builder.emit({op == "PLUS" ? Opcode::AddF64
                        : op == "MINUS" ? Opcode::SubtractF64
                        : Opcode::FloorDivideF64});
                }
                const auto normalized = emit_normalize_string_multiset(builder, multiset_layout);
                const auto& source_expression = left_multiset ? left_expression : right_expression;
                if (expression_transfers_aggregate_value(source_expression, signatures)) {
                    emit_release_layout_local(builder, multiset_temporary, multiset_layout);
                }
                return normalized;
            }
            throw LoweringFailure("incompatible string multiset operands");
        }
        if (left.kind == ValueKind::NumericMultiset ||
            right.kind == ValueKind::NumericMultiset) {
            if (left.kind == ValueKind::NumericMultiset &&
                right.kind == ValueKind::NumericMultiset &&
                (op == "EQ" || op == "EXACT_EQ" || op == "NE" ||
                 op == "NEQ" || op == "STRUCT_NEQ")) {
                const bool negate = op == "NE" || op == "NEQ" || op == "STRUCT_NEQ";
                const auto right_local = builder.add_borrowed_temporary(right);
                emit_store_local_component(builder, right_local);
                const auto left_local = builder.add_borrowed_temporary(left);
                emit_store_local_component(builder, left_local);
                const auto result = builder.add_borrowed_temporary({});
                Instruction truth;
                truth.opcode = Opcode::PushF64;
                truth.f64 = 1.0;
                builder.emit(std::move(truth));
                emit_store_local_component(builder, result);
                const auto cursor = builder.add_borrowed_temporary({});
                Instruction zero;
                zero.opcode = Opcode::PushF64;
                zero.f64 = 0.0;
                builder.emit(std::move(zero));
                emit_store_local_component(builder, cursor);
                const auto loop = builder.next_label();
                const auto mismatch = builder.next_label();
                const auto finish = builder.next_label();

                emit_load_local_component(builder, left_local);
                builder.emit({Opcode::CountF64List});
                emit_load_local_component(builder, right_local);
                builder.emit({Opcode::CountF64List});
                builder.emit({Opcode::OrderedEqualF64});
                Instruction unequal_size;
                unequal_size.opcode = Opcode::JumpIfFalse;
                unequal_size.label = mismatch;
                builder.emit(std::move(unequal_size));
                Instruction loop_label;
                loop_label.opcode = Opcode::Label;
                loop_label.label = loop;
                builder.emit(std::move(loop_label));
                emit_load_local_component(builder, cursor);
                emit_load_local_component(builder, left_local);
                builder.emit({Opcode::CountF64List});
                builder.emit({Opcode::OrderedLessF64});
                Instruction complete;
                complete.opcode = Opcode::JumpIfFalse;
                complete.label = finish;
                builder.emit(std::move(complete));
                emit_load_local_component(builder, left_local);
                emit_load_local_component(builder, cursor);
                builder.emit({Opcode::LoadF64ListIndex});
                emit_load_local_component(builder, right_local);
                emit_load_local_component(builder, cursor);
                builder.emit({Opcode::LoadF64ListIndex});
                builder.emit({Opcode::OrderedEqualF64});
                Instruction unequal_value;
                unequal_value.opcode = Opcode::JumpIfFalse;
                unequal_value.label = mismatch;
                builder.emit(std::move(unequal_value));
                emit_load_local_component(builder, cursor);
                Instruction one;
                one.opcode = Opcode::PushF64;
                one.f64 = 1.0;
                builder.emit(std::move(one));
                builder.emit({Opcode::AddF64});
                emit_store_local_component(builder, cursor);
                Instruction repeat;
                repeat.opcode = Opcode::Jump;
                repeat.label = loop;
                builder.emit(std::move(repeat));
                Instruction mismatch_label;
                mismatch_label.opcode = Opcode::Label;
                mismatch_label.label = mismatch;
                builder.emit(std::move(mismatch_label));
                Instruction false_value;
                false_value.opcode = Opcode::PushF64;
                false_value.f64 = 0.0;
                builder.emit(std::move(false_value));
                emit_store_local_component(builder, result);
                Instruction finish_label;
                finish_label.opcode = Opcode::Label;
                finish_label.label = finish;
                builder.emit(std::move(finish_label));
                if (expression_produces_owned_numeric_multiset(left_expression, signatures)) {
                    emit_release_layout_local(builder, left_local, left);
                }
                if (expression_produces_owned_numeric_multiset(right_expression, signatures)) {
                    emit_release_layout_local(builder, right_local, right);
                }
                emit_load_local_component(builder, result);
                if (negate) builder.emit({Opcode::LogicalNotF64});
                return {};
            }
            Instruction operation;
            operation.owns_left = expression_produces_owned_numeric_multiset(
                left_expression, signatures);
            operation.owns_right = expression_produces_owned_numeric_multiset(
                right_expression, signatures);
            if (left.kind == ValueKind::NumericMultiset &&
                right.kind == ValueKind::NumericMultiset) {
                operation.opcode = op == "PLUS" || op == "AMPERSAND"
                    ? Opcode::UnionF64Multisets
                    : op == "MINUS" ? Opcode::DifferenceF64Multisets
                    : op == "FLOORDIV" ? Opcode::FloorDivideF64Multisets
                    : op == "PERCENT" ? Opcode::RemainderF64Multisets
                    : throw LoweringFailure("multisets support +, &, -, //, and % count operators");
                builder.emit(std::move(operation));
                return {1, ValueKind::NumericMultiset, {}};
            }
            if (left.kind == ValueKind::NumericMultiset && right.kind == ValueKind::Numeric) {
                operation.opcode = op == "PLUS" ? Opcode::AddF64MultisetScalar
                    : op == "MINUS" ? Opcode::SubtractF64MultisetScalar
                    : op == "FLOORDIV" ? Opcode::FloorDivideF64MultisetScalar
                    : throw LoweringFailure("unsupported numeric multiset scalar operator " + op);
                builder.emit(std::move(operation));
                return {1, ValueKind::NumericMultiset, {}};
            }
            if (right.kind == ValueKind::NumericMultiset && left.kind == ValueKind::Numeric &&
                op == "PLUS") {
                const auto multiset = builder.add_borrowed_temporary(
                    {1, ValueKind::NumericMultiset, {}});
                Instruction store_multiset;
                store_multiset.opcode = Opcode::StoreLocal;
                store_multiset.index = multiset;
                builder.emit(std::move(store_multiset));
                const auto scalar = builder.add_borrowed_temporary({});
                Instruction store_scalar;
                store_scalar.opcode = Opcode::StoreLocal;
                store_scalar.index = scalar;
                builder.emit(std::move(store_scalar));
                Instruction load_multiset;
                load_multiset.opcode = Opcode::LoadLocal;
                load_multiset.index = multiset;
                builder.emit(std::move(load_multiset));
                Instruction load_scalar;
                load_scalar.opcode = Opcode::LoadLocal;
                load_scalar.index = scalar;
                builder.emit(std::move(load_scalar));
                operation.opcode = Opcode::AddF64MultisetScalar;
                operation.owns_left = operation.owns_right;
                operation.owns_right = false;
                builder.emit(std::move(operation));
                return {1, ValueKind::NumericMultiset, {}};
            }
            throw LoweringFailure("incompatible numeric multiset operands");
        }
        if (op == "AMPERSAND" &&
            ((left.kind == ValueKind::String && right.kind == ValueKind::Numeric) ||
             (left.kind == ValueKind::Numeric && right.kind == ValueKind::String))) {
            const auto emit_scalar_as_string = [&](const vf::JsonValue::Object& scalar_expression) {
                Instruction render;
                if (string_field(scalar_expression, "type", "string concatenation scalar") == "bit") {
                    render.opcode = Opcode::FormatBitString;
                    render.index = strings.intern("false");
                    render.error_message_offset = strings.intern("true");
                } else {
                    render.opcode = Opcode::FormatF64String;
                    const std::string format = interpolation_numeric_format("");
                    render.index = strings.intern(format + '\0');
                    render.byte_count = static_cast<std::uint32_t>(format.size());
                }
                builder.emit(std::move(render));
            };
            if (left.kind == ValueKind::String) {
                emit_scalar_as_string(right_expression);
            } else {
                const auto saved_right = builder.add_borrowed_temporary(right);
                for (std::uint32_t component = right.width; component > 0; --component) {
                    Instruction store;
                    store.opcode = Opcode::StoreLocal;
                    store.index = saved_right + component - 1;
                    builder.emit(std::move(store));
                }
                emit_scalar_as_string(left_expression);
                for (std::uint32_t component = 0; component < right.width; ++component) {
                    Instruction load;
                    load.opcode = Opcode::LoadLocal;
                    load.index = saved_right + component;
                    builder.emit(std::move(load));
                }
            }
            Instruction concat;
            concat.opcode = Opcode::ConcatStrings;
            concat.owns_left = left.kind == ValueKind::String
                ? expression_transfers_string_value(left_expression, signatures)
                : true;
            concat.owns_right = right.kind == ValueKind::String
                ? expression_transfers_string_value(right_expression, signatures)
                : true;
            builder.emit(std::move(concat));
            return {2, ValueKind::String, {}};
        }
        if (op == "AMPERSAND" && left.kind == ValueKind::String && right.kind == ValueKind::String) {
            Instruction concat;
            concat.opcode = Opcode::ConcatStrings;
            concat.owns_left = expression_transfers_string_value(left_expression, signatures);
            concat.owns_right = expression_transfers_string_value(right_expression, signatures);
            builder.emit(std::move(concat));
            return {2, ValueKind::String, {}};
        }
        if (left.kind == ValueKind::String && right.kind == ValueKind::String) {
            Instruction comparison;
            comparison.opcode = op == "EQ" || op == "EXACT_EQ" ? Opcode::StringEqual
                : op == "NE" || op == "NEQ" || op == "STRUCT_NEQ" ? Opcode::StringNotEqual
                : op == "LT" ? Opcode::StringLess
                : op == "LE" ? Opcode::StringLessEqual
                : op == "GT" ? Opcode::StringGreater
                : op == "GE" ? Opcode::StringGreaterEqual
                : throw LoweringFailure("unsupported machine IR string operator " + op);
            comparison.owns_left = expression_transfers_string_value(left_expression, signatures);
            comparison.owns_right = expression_transfers_string_value(right_expression, signatures);
            builder.emit(std::move(comparison));
            return {};
        }
        if (op == "AMPERSAND" && left.kind == ValueKind::DynamicF64List &&
            right.kind == ValueKind::Aggregate && !is_record_layout(right) &&
            is_numeric_layout(right)) {
            return emit_mixed_f64_list_concat(
                true, right, left_expression, builder, signatures);
        }
        if (op == "AMPERSAND" && right.kind == ValueKind::DynamicF64List &&
            left.kind == ValueKind::Aggregate && !is_record_layout(left) &&
            is_numeric_layout(left)) {
            return emit_mixed_f64_list_concat(
                false, left, right_expression, builder, signatures);
        }
        if (op == "AMPERSAND" && left.kind == ValueKind::DynamicF64List &&
            right.kind == ValueKind::DynamicF64List) {
            Instruction concat;
            concat.opcode = Opcode::ConcatF64Lists;
            concat.owns_left = expression_produces_owned_f64_list(left_expression, signatures);
            concat.owns_right = expression_produces_owned_f64_list(right_expression, signatures);
            builder.emit(std::move(concat));
            return {1, ValueKind::DynamicF64List, {}};
        }
        if (op == "AMPERSAND" && left.kind == ValueKind::Aggregate &&
            right.kind == ValueKind::Aggregate && !is_record_layout(left) &&
            !is_record_layout(right)) {
            std::vector<ValueLayout> elements;
            const auto append_elements = [&](const ValueLayout& source) {
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
            append_elements(left);
            append_elements(right);
            return indexed_layout(elements);
        }
        if ((op == "EQ" || op == "EXACT_EQ") &&
            (left.kind == ValueKind::Null || right.kind == ValueKind::Null)) {
            builder.emit({Opcode::EqualBits});
            return {};
        }
        if ((op == "NE" || op == "NEQ" || op == "STRUCT_NEQ") &&
            (left.kind == ValueKind::Null || right.kind == ValueKind::Null)) {
            builder.emit({Opcode::NotEqualBits});
            return {};
        }
        if ((op == "EXACT_EQ" || op == "NE" || op == "NEQ") &&
            (left.kind == ValueKind::Aggregate || right.kind == ValueKind::Aggregate)) {
            const bool negate = op != "EXACT_EQ";
            const auto exact_type_key = [](const std::string& raw, const ValueLayout& layout) {
                if (layout.kind == ValueKind::Aggregate && !is_record_layout(layout) &&
                    raw.rfind("list<", 0) == 0 && raw.back() == '>') {
                    std::uint32_t count = 0;
                    for (const auto& [name, slice] : layout.selectors) {
                        (void)slice;
                        if (name.find('.') == std::string::npos) ++count;
                    }
                    return "[" + raw.substr(5, raw.size() - 6) + ":" +
                        std::to_string(count) + "]";
                }
                return raw;
            };
            const std::string left_type = exact_type_key(
                string_field(expression, "left_type", "exact aggregate equality"), left);
            const std::string right_type = exact_type_key(
                string_field(expression, "right_type", "exact aggregate equality"), right);
            const auto right_temporary = builder.add_borrowed_temporary(right);
            for (std::uint32_t component = right.width; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = right_temporary + component - 1;
                builder.emit(std::move(store));
            }
            const auto left_temporary = builder.add_borrowed_temporary(left);
            for (std::uint32_t component = left.width; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = left_temporary + component - 1;
                builder.emit(std::move(store));
            }
            const bool owns_left = expression_transfers_aggregate_value(
                left_expression, signatures);
            const bool owns_right = expression_transfers_aggregate_value(
                right_expression, signatures);
            if (left.width != right.width || left_type != right_type ||
                left.kind != ValueKind::Aggregate || right.kind != ValueKind::Aggregate) {
                Instruction result;
                result.opcode = Opcode::PushF64;
                result.f64 = negate ? 1.0 : 0.0;
                builder.emit(std::move(result));
                if (owns_left) emit_release_layout_local(builder, left_temporary, left);
                if (owns_right) emit_release_layout_local(builder, right_temporary, right);
                return {};
            }
            Instruction truth;
            truth.opcode = Opcode::PushF64;
            truth.f64 = 1.0;
            builder.emit(std::move(truth));
            const auto left_resources = owned_resource_slices(left);
            const auto right_resources = owned_resource_slices(right);
            for (std::uint32_t component = 0; component < left.width;) {
                const auto left_resource = std::find_if(
                    left_resources.begin(), left_resources.end(),
                    [&](const auto& slice) { return slice.offset == component; });
                const auto right_resource = std::find_if(
                    right_resources.begin(), right_resources.end(),
                    [&](const auto& slice) { return slice.offset == component; });
                if (left_resource != left_resources.end() || right_resource != right_resources.end()) {
                    if (left_resource == left_resources.end() || right_resource == right_resources.end() ||
                        left_resource->kind != ValueKind::String ||
                        right_resource->kind != ValueKind::String ||
                        left_resource->width != 2 || right_resource->width != 2) {
                        throw LoweringFailure(
                            "exact aggregate equality supports numeric, null, and string leaves");
                    }
                    for (std::uint32_t string_component = 0; string_component < 2; ++string_component) {
                        Instruction load_left;
                        load_left.opcode = Opcode::LoadLocal;
                        load_left.index = left_temporary + component + string_component;
                        builder.emit(std::move(load_left));
                    }
                    for (std::uint32_t string_component = 0; string_component < 2; ++string_component) {
                        Instruction load_right;
                        load_right.opcode = Opcode::LoadLocal;
                        load_right.index = right_temporary + component + string_component;
                        builder.emit(std::move(load_right));
                    }
                    builder.emit({Opcode::StringEqual});
                    builder.emit({Opcode::MultiplyF64});
                    component += 2;
                    continue;
                }
                Instruction load_left;
                load_left.opcode = Opcode::LoadLocal;
                load_left.index = left_temporary + component;
                builder.emit(std::move(load_left));
                Instruction load_right;
                load_right.opcode = Opcode::LoadLocal;
                load_right.index = right_temporary + component;
                builder.emit(std::move(load_right));
                builder.emit({Opcode::OrderedEqualF64});
                builder.emit({Opcode::MultiplyF64});
                ++component;
            }
            if (negate) builder.emit({Opcode::LogicalNotF64});
            if (owns_left) emit_release_layout_local(builder, left_temporary, left);
            if (owns_right) emit_release_layout_local(builder, right_temporary, right);
            return {};
        }
        if ((left.kind == ValueKind::Aggregate || right.kind == ValueKind::Aggregate) &&
            is_numeric_layout(left) && is_numeric_layout(right)) {
            const auto opcode = scalar_binary_opcode(op);
            if (!opcode) throw LoweringFailure("unsupported aggregate machine IR operator " + op);
            const auto right_temporary = builder.add_borrowed_temporary(right);
            for (std::uint32_t component = right.width; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = right_temporary + component - 1;
                builder.emit(std::move(store));
            }
            const auto left_temporary = builder.add_borrowed_temporary(left);
            for (std::uint32_t component = left.width; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = left_temporary + component - 1;
                builder.emit(std::move(store));
            }
            const bool left_indexed = left.kind == ValueKind::Aggregate && !is_record_layout(left);
            const bool right_indexed = right.kind == ValueKind::Aggregate && !is_record_layout(right);
            const auto left_elements = left_indexed
                ? indexed_element_layouts(left) : std::vector<ValueLayout>{left};
            const auto right_elements = right_indexed
                ? indexed_element_layouts(right) : std::vector<ValueLayout>{right};
            const bool complex_elements = std::any_of(
                    left_elements.begin(), left_elements.end(), [](const auto& value) {
                        return value.kind == ValueKind::Complex;
                    }) || std::any_of(
                    right_elements.begin(), right_elements.end(), [](const auto& value) {
                        return value.kind == ValueKind::Complex;
                    });
            if (complex_elements &&
                (op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH")) {
                if (left_elements.size() != 1u && right_elements.size() != 1u &&
                    left_elements.size() != right_elements.size()) {
                    throw LoweringFailure("complex aggregate operands have incompatible lengths");
                }
                const auto count = std::max(left_elements.size(), right_elements.size());
                const auto element_offset = [](const std::vector<ValueLayout>& elements, std::size_t index) {
                    std::uint32_t offset = 0;
                    for (std::size_t current = 0; current < index; ++current) {
                        offset += elements[current].width;
                    }
                    return offset;
                };
                std::vector<ValueLayout> results;
                results.reserve(count);
                for (std::size_t index = 0; index < count; ++index) {
                    const std::size_t left_index = left_elements.size() == 1u ? 0u : index;
                    const std::size_t right_index = right_elements.size() == 1u ? 0u : index;
                    const auto& left_element = left_elements[left_index];
                    const auto& right_element = right_elements[right_index];
                    const auto left_offset = element_offset(left_elements, left_index);
                    const auto right_offset = element_offset(right_elements, right_index);
                    for (std::uint32_t component = 0; component < left_element.width; ++component) {
                        emit_load_local_component(
                            builder, left_temporary + left_offset + component);
                    }
                    for (std::uint32_t component = 0; component < right_element.width; ++component) {
                        emit_load_local_component(
                            builder, right_temporary + right_offset + component);
                    }
                    emit_complex_binary_arithmetic(
                        builder, op, left_element, right_element);
                    results.push_back({2, ValueKind::Complex, {}});
                }
                return indexed_layout(results);
            }
            const std::string left_type = string_field(expression, "left_type", "binary expression");
            const std::string right_type = string_field(expression, "right_type", "binary expression");
            const bool outer = left.width > 1 && right.width > 1 &&
                left_type.rfind("axis<", 0) == 0 && right_type.rfind("axis<", 0) == 0 &&
                left_type.substr(5, left_type.find('>') - 5) !=
                    right_type.substr(5, right_type.find('>') - 5);
            if (!outer && left.width > 1 && right.width > 1 && left.width != right.width) {
                throw LoweringFailure("aggregate machine IR operands have incompatible widths");
            }
            const std::uint32_t result_width = outer
                ? left.width * right.width : std::max(left.width, right.width);
            for (std::uint32_t result = 0; result < result_width; ++result) {
                const std::uint32_t left_index = outer ? result / right.width
                    : left.width == 1 ? 0 : result;
                const std::uint32_t right_index = outer ? result % right.width
                    : right.width == 1 ? 0 : result;
                Instruction load_left;
                load_left.opcode = Opcode::LoadLocal;
                load_left.index = left_temporary + left_index;
                builder.emit(std::move(load_left));
                Instruction load_right;
                load_right.opcode = Opcode::LoadLocal;
                load_right.index = right_temporary + right_index;
                builder.emit(std::move(load_right));
                builder.emit({*opcode});
            }
            if (outer) {
                return outer_product_layout(left, right);
            }
            return left.width > 1 ? left : right;
        }
        require_scalar(left, "machine IR binary operator");
        require_scalar(right, "machine IR binary operator");
        const auto opcode = scalar_binary_opcode(op);
        if (!opcode) throw LoweringFailure("unsupported machine IR binary operator " + op);
        builder.emit({*opcode});
        return {};
    }
    if (kind == "raise_expr") {
        const auto& value = object_of(
            field(expression, "value", "raise expression"), "raise error value");
        const auto layout = lower_expression(value, builder, signatures, strings);
        const auto message = layout.selectors.find("message");
        const auto type_name = layout.selectors.find("type");
        const auto mask = layout.selectors.find("mask");
        if (layout.kind != ValueKind::Aggregate || layout.width != 5 ||
            message == layout.selectors.end() || message->second.offset != 0 ||
            message->second.width != 2 || message->second.kind != ValueKind::String ||
            type_name == layout.selectors.end() || type_name->second.offset != 2 ||
            type_name->second.width != 2 || type_name->second.kind != ValueKind::String ||
            mask == layout.selectors.end() || mask->second.offset != 4 ||
            mask->second.width != 1) {
            throw LoweringFailure("machine IR `!` expects an error value");
        }
        ensure_independent_value(value, layout, builder, signatures);
        Instruction raise;
        raise.opcode = Opcode::RaiseErrorValue;
        raise.owns_input = true;
        if (const auto handler = builder.error_handler()) {
            raise.has_error_handler = true;
            raise.label = *handler;
            raise.error_value_local = *builder.error_value_local();
            raise.error_type_local = *builder.error_type_local();
        }
        builder.emit(std::move(raise));
        return {1, ValueKind::Null, {}};
    }
    if (kind == "assert_expr") {
        const auto condition = lower_expression(
            object_of(field(expression, "condition", "assert expression"), "assert condition"),
            builder, signatures, strings);
        require_scalar(condition, "machine IR assertion condition");
        Instruction assertion;
        assertion.opcode = Opcode::AssertTruthy;
        std::string message = "assertion failed";
        const auto& message_value = field(expression, "message", "assert expression");
        const vf::JsonValue::Object* dynamic_message = nullptr;
        if (!message_value.is_null()) {
            const auto& message_expression = object_of(message_value, "assert message");
            const auto message_kind = string_field(message_expression, "kind", "assert message");
            const auto raw = message_expression.find("value");
            if (message_kind == "const" && raw != message_expression.end() && raw->second.is_string()) {
                message = raw->second.as_string();
            } else {
                dynamic_message = &message_expression;
            }
        }
        if (dynamic_message) {
            const auto message_layout = lower_expression(
                *dynamic_message, builder, signatures, strings);
            if (message_layout.kind != ValueKind::String) {
                throw LoweringFailure("machine IR assertion message must be str");
            }
            ensure_independent_value(
                *dynamic_message, message_layout, builder, signatures);
            assertion.opcode = Opcode::AssertTruthyString;
        }
        assertion.index = strings.intern(message);
        assertion.byte_count = static_cast<std::uint32_t>(message.size());
        if (const auto handler = builder.error_handler()) {
            assertion.has_error_handler = true;
            assertion.label = *handler;
            assertion.error_value_local = *builder.error_value_local();
            assertion.error_type_local = *builder.error_type_local();
        }
        builder.emit(std::move(assertion));
        return condition;
    }
    if (kind == "call") {
        const auto& callee = object_of(field(expression, "callee", "call"), "callee");
        const std::string callee_kind = string_field(callee, "kind", "callee");
        const auto& args = array_of(field(expression, "args", "call"), "call args");
        if (callee_kind == "field_access" &&
            string_field(callee, "field", "method callee") == "length") {
            if (!args.empty() ||
                !array_of(field(expression, "named_args", "length call"), "length named args").empty() ||
                !array_of(field(expression, "spread_args", "length call"), "length spread args").empty()) {
                throw LoweringFailure("machine IR length() takes no arguments");
            }
            const auto& source = object_of(field(callee, "object", "length callee"), "length source");
            auto source_layout = layout_from_expression_shape(source, signatures);
            if (string_field(source, "kind", "length source") == "load") {
                source_layout = builder.layout(string_field(source, "name", "length source"));
            }
            if (source_layout.kind == ValueKind::DynamicF64List) {
                const bool owns_input = expression_produces_owned_f64_list(source, signatures);
                const auto lowered = lower_expression(source, builder, signatures, strings);
                if (lowered.kind != ValueKind::DynamicF64List) {
                    throw LoweringFailure("machine IR length() source layout mismatch");
                }
                Instruction count;
                count.opcode = Opcode::CountF64List;
                count.owns_input = owns_input;
                builder.emit(std::move(count));
                return {};
            }
            if (source_layout.kind == ValueKind::Aggregate) {
                Instruction count;
                count.opcode = Opcode::PushF64;
                count.f64 = static_cast<double>(source_layout.selectors.empty()
                    ? source_layout.width
                    : std::count_if(
                        source_layout.selectors.begin(), source_layout.selectors.end(),
                        [](const auto& item) { return item.first.find('.') == std::string::npos; }));
                builder.emit(std::move(count));
                return {};
            }
            throw LoweringFailure("machine IR length() requires a tuple, vector, or variadic list");
        }
        if (callee_kind == "stdlib_function") {
            const std::string module = string_field(callee, "module", "stdlib callee");
            const std::string name = string_field(callee, "name", "stdlib callee");
            if (module == "io" && (name == "print" || name == "eprint")) {
                if (args.size() != 1) {
                    throw LoweringFailure("machine IR print requires one argument");
                }
                const auto& argument = object_of(args.front(), "printed expression");
                const auto layout = lower_expression(
                    argument, builder, signatures, strings);
                ensure_independent_value(argument, layout, builder, signatures);
                const auto temporary = builder.add_owned_temporary(layout);
                for (std::uint32_t component = layout.width; component > 0; --component) {
                    emit_store_local_component(builder, temporary + component - 1u);
                }
                const auto shape = display_shape_from_expression(argument, {}, nullptr);
                const bool owns_text = emit_local_interpolation_string(
                    builder, strings, temporary, layout, shape, "");
                emit_static_string(builder, strings, "\n");
                emit_interpolation_concat(builder, owns_text, false);
                Instruction write;
                write.opcode = Opcode::WriteString;
                write.index = name == "eprint" ? 2u : 1u;
                write.owns_input = true;
                builder.emit(std::move(write));
                for (std::uint32_t component = 0; component < layout.width; ++component) {
                    emit_load_local_component(builder, temporary + component);
                }
                clone_nested_resource_values(layout, builder);
                emit_release_layout_local(builder, temporary, layout);
                return layout;
            }
            const auto& named_args = array_of(
                field(expression, "named_args", "stdlib call"), "stdlib named args");
            const auto& spread_args = array_of(
                field(expression, "spread_args", "stdlib call"), "stdlib spread args");
            if (!spread_args.empty()) {
                throw LoweringFailure(
                    "direct machine IR stdlib calls do not accept spread arguments");
            }
            if (module == "io" && name == "read_line") {
                if (!args.empty() || !named_args.empty()) {
                    throw LoweringFailure("machine IR io.read_line takes no arguments");
                }
                builder.emit({Opcode::ReadLineString});
                return {2, ValueKind::String, {}};
            }
            if (module == "io" && (name == "read_text" || name == "read_bytes")) {
                if (args.size() != 1 || !named_args.empty()) {
                    throw LoweringFailure(
                        "machine IR io." + name + " requires one path; direct files are byte-exact UTF-8");
                }
                const auto& path = object_of(args.front(), "io file path");
                const auto path_layout = lower_expression(path, builder, signatures, strings);
                if (path_layout.kind != ValueKind::String || path_layout.width != 2) {
                    throw LoweringFailure("machine IR io." + name + " requires a string path");
                }
                if (!expression_transfers_string_value(path, signatures)) {
                    builder.emit({Opcode::CloneString});
                }
                Instruction read;
                read.opcode = Opcode::ReadFileString;
                read.owns_input = true;
                const std::string message = "file read failed";
                read.error_message_offset = strings.intern(message);
                read.byte_count = static_cast<std::uint32_t>(message.size());
                read.may_error = true;
                if (const auto handler = builder.error_handler()) {
                    read.has_error_handler = true;
                    read.label = *handler;
                    read.error_value_local = *builder.error_value_local();
                    read.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(read));
                return {2, ValueKind::String, {}};
            }
            if (module == "io" &&
                (name == "write_text" || name == "write_bytes" || name == "append_text")) {
                if (args.size() != 2 || !named_args.empty()) {
                    throw LoweringFailure(
                        "machine IR io." + name + " requires path and data; direct files are byte-exact UTF-8");
                }
                const auto& path = object_of(args[0], "io file path");
                const auto path_layout = lower_expression(path, builder, signatures, strings);
                if (path_layout.kind != ValueKind::String || path_layout.width != 2) {
                    throw LoweringFailure("machine IR io." + name + " requires a string path");
                }
                const bool path_transfers = expression_transfers_string_value(path, signatures);
                if (!path_transfers) builder.emit({Opcode::CloneString});

                const auto& data = object_of(args[1], "io file data");
                const auto data_layout = lower_expression(data, builder, signatures, strings);
                if (data_layout.kind != ValueKind::String || data_layout.width != 2) {
                    throw LoweringFailure("machine IR io." + name + " requires string-backed data");
                }
                bool data_owned = expression_transfers_string_value(data, signatures);
                if (!data_owned && expression_needs_string_clone(data)) {
                    builder.emit({Opcode::CloneString});
                    data_owned = true;
                }
                Instruction write;
                write.opcode = Opcode::WriteFileString;
                write.index = name == "append_text" ? 1u : 0u;
                write.owns_left = true;
                write.owns_right = data_owned;
                const std::string message = "file write failed";
                write.error_message_offset = strings.intern(message);
                write.byte_count = static_cast<std::uint32_t>(message.size());
                write.may_error = true;
                if (const auto handler = builder.error_handler()) {
                    write.has_error_handler = true;
                    write.label = *handler;
                    write.error_value_local = *builder.error_value_local();
                    write.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(write));
                return {1, ValueKind::Null, {}};
            }
            std::uint32_t degrees_of_freedom = 0;
            if (module == "stat" && (name == "variance" || name == "std")) {
                bool saw_ddof = false;
                for (const auto& named_value : named_args) {
                    const auto& named = object_of(named_value, "stat.std named argument");
                    if (string_field(named, "name", "stat.std named argument") != "ddof") {
                        throw LoweringFailure("unknown named argument for stat." + name);
                    }
                    if (saw_ddof) {
                        throw LoweringFailure("multiple values for stat." + name + " ddof");
                    }
                    saw_ddof = true;
                    const auto& value = object_of(
                        field(named, "value", "stat.std ddof"), "stat.std ddof value");
                    const auto& raw = field(value, "value", "stat.std ddof value");
                    if (string_field(value, "kind", "stat.std ddof value") != "const" ||
                        !raw.is_number() || !std::isfinite(raw.as_number()) ||
                        std::floor(raw.as_number()) != raw.as_number() ||
                        raw.as_number() < 0 ||
                        raw.as_number() > static_cast<double>(std::numeric_limits<std::int32_t>::max())) {
                        throw LoweringFailure(
                            "stat." + name + " ddof must be a non-negative integer constant");
                    }
                    degrees_of_freedom = static_cast<std::uint32_t>(raw.as_number());
                }
            } else if (!(module == "stat" && name == "sum") && !named_args.empty()) {
                throw LoweringFailure(
                    "direct machine IR stdlib call does not accept named arguments " +
                    module + "." + name);
            }
            if (module == "system" && (name == "os_name" || name == "arch_name")) {
                if (!args.empty()) {
                    throw LoweringFailure("machine IR system." + name + " takes no arguments");
                }
                std::string value;
                if (name == "os_name") {
#if defined(_WIN32)
                    value = "windows";
#elif defined(__APPLE__)
                    value = "macos";
#else
                    value = "linux";
#endif
                } else {
#if defined(__aarch64__) || defined(_M_ARM64)
                    value = "arm64";
#else
                    value = "x86_64";
#endif
                }
                Instruction literal;
                literal.opcode = Opcode::PushString;
                literal.index = strings.intern(value);
                literal.byte_count = static_cast<std::uint32_t>(value.size());
                builder.emit(std::move(literal));
                return {2, ValueKind::String, {}};
            }
            if (module == "system" && name == "cpu_count_native") {
                if (!args.empty()) {
                    throw LoweringFailure("machine IR system.cpu_count_native takes no arguments");
                }
                builder.emit({Opcode::SystemCpuCount});
                return {};
            }
            if (module == "system" && name == "cwd_native") {
                if (!args.empty()) {
                    throw LoweringFailure("machine IR system.cwd_native takes no arguments");
                }
                builder.emit({Opcode::SystemCwdString});
                return {2, ValueKind::String, {}};
            }
            if (module == "system" && name == "env_native") {
                if (args.size() != 1) {
                    throw LoweringFailure("machine IR system.env_native requires one name");
                }
                const auto& key = object_of(args.front(), "system environment name");
                const auto key_layout = lower_expression(key, builder, signatures, strings);
                if (key_layout.kind != ValueKind::String || key_layout.width != 2) {
                    throw LoweringFailure("machine IR system.env_native requires a string name");
                }
                if (!expression_transfers_string_value(key, signatures)) {
                    builder.emit({Opcode::CloneString});
                }
                Instruction environment;
                environment.opcode = Opcode::SystemEnvString;
                environment.index = strings.intern("");
                environment.owns_input = true;
                builder.emit(std::move(environment));
                ValueLayout result{3, ValueKind::Aggregate, {}};
                result.selectors["found"] = {0, 1, ValueKind::Numeric};
                result.selectors["value"] = {1, 2, ValueKind::String};
                return result;
            }
            if (module == "process" && name == "run_native") {
                if (args.size() != 2) {
                    throw LoweringFailure("machine IR process.run_native requires program and args");
                }
                const auto& program = object_of(args[0], "process program");
                const auto program_layout = lower_expression(program, builder, signatures, strings);
                if (program_layout.kind != ValueKind::String || program_layout.width != 2) {
                    throw LoweringFailure("machine IR process.run_native program must be str");
                }
                if (!expression_transfers_string_value(program, signatures)) {
                    builder.emit({Opcode::CloneString});
                }

                const auto& arguments = object_of(args[1], "process arguments");
                const auto arguments_layout = lower_expression(
                    arguments, builder, signatures, strings);
                if (arguments_layout.kind != ValueKind::Aggregate ||
                    arguments_layout.width % 2 != 0) {
                    throw LoweringFailure(
                        "machine IR process.run_native args must be a fixed str vector");
                }
                const auto resources = owned_resource_slices(arguments_layout);
                const auto argument_count = arguments_layout.width / 2;
                if (resources.size() != argument_count ||
                    std::any_of(resources.begin(), resources.end(), [](const auto& slice) {
                        return slice.kind != ValueKind::String || slice.width != 2;
                    })) {
                    throw LoweringFailure(
                        "machine IR process.run_native args must contain only str values");
                }
                clone_nested_resource_values(arguments_layout, builder);
                Instruction run;
                run.opcode = Opcode::ProcessRun;
                run.argument_count = argument_count;
                run.index = strings.intern("\0");
                run.owns_input = true;
                builder.emit(std::move(run));
                ValueLayout result{5, ValueKind::Aggregate, {}};
                result.selectors["code"] = {0, 1, ValueKind::Numeric};
                result.selectors["out"] = {1, 2, ValueKind::String};
                result.selectors["err"] = {3, 2, ValueKind::String};
                return result;
            }
            if (module == "process" && name == "shell_native") {
                if (args.size() != 1) {
                    throw LoweringFailure("machine IR process.shell_native requires one command");
                }
                const auto emit_owned_literal = [&](const std::string& value) {
                    emit_static_string(builder, strings, value);
                    builder.emit({Opcode::CloneString});
                };
#if defined(_WIN32)
                emit_owned_literal("cmd.exe");
                emit_owned_literal("/d");
                emit_owned_literal("/s");
                emit_owned_literal("/c");
                constexpr std::uint32_t shell_argument_count = 4;
#else
                emit_owned_literal("/bin/sh");
                emit_owned_literal("-c");
                constexpr std::uint32_t shell_argument_count = 2;
#endif
                const auto& command = object_of(args.front(), "process shell command");
                const auto command_layout = lower_expression(
                    command, builder, signatures, strings);
                if (command_layout.kind != ValueKind::String || command_layout.width != 2) {
                    throw LoweringFailure("machine IR process.shell_native command must be str");
                }
                if (!expression_transfers_string_value(command, signatures)) {
                    builder.emit({Opcode::CloneString});
                }
                Instruction run;
                run.opcode = Opcode::ProcessRun;
                run.argument_count = shell_argument_count;
                run.index = strings.intern("\0");
                run.owns_input = true;
                builder.emit(std::move(run));
                ValueLayout result{5, ValueKind::Aggregate, {}};
                result.selectors["code"] = {0, 1, ValueKind::Numeric};
                result.selectors["out"] = {1, 2, ValueKind::String};
                result.selectors["err"] = {3, 2, ValueKind::String};
                return result;
            }
            if (module == "regex" && (name == "match" || name == "groups")) {
                if (args.size() != 2) {
                    throw LoweringFailure("machine IR regex." + name +
                        " requires source and pattern");
                }
                const auto& source = object_of(args[0], "regex source");
                const auto source_layout = lower_expression(source, builder, signatures, strings);
                if (source_layout.kind != ValueKind::String || source_layout.width != 2) {
                    throw LoweringFailure("machine IR regex source must be str");
                }
                const auto& pattern_value = object_of(args[1], "regex pattern");
                const auto value = pattern_value.find("value");
                if (string_field(pattern_value, "kind", "regex pattern") != "const" ||
                    value == pattern_value.end() || !value->second.is_string()) {
                    throw LoweringFailure("regex pattern must be a compile-time string constant");
                }
                vkf::capture::Pattern pattern;
                try {
                    pattern = vkf::capture::parse(value->second.as_string());
                } catch (const vkf::capture::PatternFailure& error) {
                    throw LoweringFailure(error.what());
                }
                Instruction capture;
                capture.opcode = Opcode::CaptureRegex;
                capture.argument_count = static_cast<std::uint32_t>(pattern.group_names.size());
                capture.symbol = value->second.as_string();
                capture.owns_input = expression_transfers_string_value(source, signatures);
                const std::string message = "regular expression did not match";
                capture.error_message_offset = strings.intern(message);
                capture.byte_count = static_cast<std::uint32_t>(message.size());
                capture.may_error = true;
                if (const auto handler = builder.error_handler()) {
                    capture.has_error_handler = true;
                    capture.label = *handler;
                    capture.error_value_local = *builder.error_value_local();
                    capture.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(capture));
                ValueLayout result{
                    static_cast<std::uint32_t>(pattern.group_names.size() * 2u),
                    ValueKind::Aggregate,
                    {}};
                for (std::uint32_t index = 0; index < pattern.group_names.size(); ++index) {
                    const std::string selector = name == "match"
                        ? pattern.group_names[index] : std::to_string(index);
                    result.selectors[selector] = {index * 2u, 2, ValueKind::String};
                }
                return result;
            }
            if (module == "collections" && name == "list") {
                for (const auto& arg : args) {
                    const auto element = lower_expression(
                        object_of(arg, "collections.list argument"), builder, signatures, strings);
                    require_scalar(element, "collections.list numeric element");
                }
                Instruction make;
                make.opcode = Opcode::MakeOwnedF64List;
                make.argument_count = static_cast<std::uint32_t>(args.size());
                builder.emit(std::move(make));
                return {1, ValueKind::DynamicF64List, {}};
            }
            if (module == "time") {
                if ((name == "monotonic_seconds" || name == "wall_seconds") && args.empty()) {
                    builder.emit({name == "monotonic_seconds"
                        ? Opcode::MonotonicF64 : Opcode::WallTimeF64});
                    return {};
                }
                if (name == "sleep_seconds" && args.size() == 1) {
                    const auto argument = lower_expression(
                        object_of(args.front(), "time.sleep_seconds argument"),
                        builder, signatures, strings);
                    require_scalar(argument, "machine IR time.sleep_seconds");
                    builder.emit({Opcode::SleepF64});
                    return {1, ValueKind::Null, {}};
                }
                if (name == "local_parts" && args.size() == 1) {
                    const auto argument = lower_expression(
                        object_of(args.front(), "time.local_parts argument"),
                        builder, signatures, strings);
                    require_scalar(argument, "machine IR time.local_parts");
                    builder.emit({Opcode::LocalTimeParts});
                    ValueLayout result{9, ValueKind::Aggregate, {}};
                    const std::vector<std::string> fields{
                        "second", "minute", "hour", "day", "month", "year",
                        "weekday", "yearday", "dst",
                    };
                    for (std::uint32_t index = 0; index < fields.size(); ++index) {
                        result.selectors[fields[index]] = {index, 1, ValueKind::Numeric};
                    }
                    return result;
                }
                throw LoweringFailure("unsupported machine IR time call time." + name);
            }
            if (args.size() != 1) {
                throw LoweringFailure("unsupported machine IR stdlib call " + module + "." + name);
            }
            if (module == "stat" &&
                (name == "sum" || name == "mean" || name == "variance" ||
                 name == "std" || name == "range" || name == "count")) {
                const auto& argument_expression = object_of(args.front(), "stat argument");
                if (name == "sum" && !named_args.empty()) {
                    const auto shape = fixed_numeric_vector_shape(
                        string_field(argument_expression, "type", "stat.sum axis argument"));
                    if (!shape) {
                        throw LoweringFailure(
                            "stat.sum axis requires a fixed rectangular numeric vector");
                    }
                    const auto axes = constant_stat_sum_axes(
                        named_args, shape->dimensions.size());
                    const auto argument = lower_expression(
                        argument_expression, builder, signatures, strings);
                    if (!is_numeric_layout(argument)) {
                        throw LoweringFailure(
                            "stat.sum axis requires a fixed rectangular numeric vector");
                    }
                    std::size_t input_count = 1;
                    for (const auto dimension : shape->dimensions) input_count *= dimension;
                    if (input_count != argument.width) {
                        throw LoweringFailure("stat.sum axis vector shape does not match its machine layout");
                    }

                    const auto temporary = builder.add_borrowed_temporary(argument);
                    for (std::uint32_t component = argument.width; component > 0; --component) {
                        emit_store_local_component(builder, temporary + component - 1u);
                    }

                    std::size_t output_count = 1;
                    for (std::size_t dimension = 0; dimension < shape->dimensions.size(); ++dimension) {
                        if (std::find(axes.begin(), axes.end(), dimension) == axes.end()) {
                            output_count *= shape->dimensions[dimension];
                        }
                    }
                    std::vector<std::vector<std::uint32_t>> groups(output_count);
                    std::vector<std::size_t> coordinates(shape->dimensions.size());
                    for (std::size_t input = 0; input < input_count; ++input) {
                        std::size_t remainder = input;
                        for (std::size_t dimension = shape->dimensions.size(); dimension > 0; --dimension) {
                            const auto index = dimension - 1;
                            coordinates[index] = remainder % shape->dimensions[index];
                            remainder /= shape->dimensions[index];
                        }
                        std::size_t output = 0;
                        for (std::size_t dimension = 0; dimension < shape->dimensions.size(); ++dimension) {
                            if (std::find(axes.begin(), axes.end(), dimension) != axes.end()) continue;
                            output = output * shape->dimensions[dimension] + coordinates[dimension];
                        }
                        groups[output].push_back(static_cast<std::uint32_t>(input));
                    }
                    for (const auto& group : groups) {
                        if (group.empty()) {
                            throw LoweringFailure("stat.sum axis produced an empty reduction group");
                        }
                        emit_load_local_component(builder, temporary + group.front());
                        for (std::size_t index = 1; index < group.size(); ++index) {
                            emit_load_local_component(builder, temporary + group[index]);
                            builder.emit({Opcode::AddF64});
                        }
                    }
                    const auto result = layout_from_type(
                        string_field(expression, "type", "stat.sum axis result"), &signatures);
                    if (result.width != output_count) {
                        throw LoweringFailure("stat.sum axis result type does not match its reduction shape");
                    }
                    return result;
                }
                const std::string argument_kind = string_field(
                    argument_expression, "kind", "stat argument");
                auto dynamic_layout = layout_from_expression_shape(argument_expression, signatures);
                if (argument_kind == "load") {
                    dynamic_layout = builder.layout(string_field(argument_expression, "name", "stat argument"));
                } else if (argument_kind == "field_access" || argument_kind == "dotted_index") {
                    const auto projection = projection_of(argument_expression);
                    const auto& source_layout = builder.layout(projection.binding);
                    if (projection.path.empty()) dynamic_layout = source_layout;
                    else {
                        const auto selected = source_layout.selectors.find(projection.path);
                        if (selected != source_layout.selectors.end()) {
                            dynamic_layout = projected_layout(source_layout, projection.path, selected->second);
                        }
                    }
                }
                if (dynamic_layout.kind == ValueKind::DynamicF64List) {
                    const bool owns_input = expression_produces_owned_f64_list(argument_expression, signatures);
                    const auto argument = lower_expression(
                        argument_expression, builder, signatures, strings);
                    if (argument.kind != ValueKind::DynamicF64List) {
                        throw LoweringFailure("dynamic stat argument layout mismatch");
                    }
                    Instruction instruction;
                    instruction.opcode = name == "sum" ? Opcode::SumF64List
                        : name == "mean" ? Opcode::MeanF64List
                        : name == "variance" ? Opcode::VarianceF64List
                        : name == "std" ? Opcode::StdDevF64List
                        : name == "range" ? Opcode::RangeF64List : Opcode::CountF64List;
                    instruction.owns_input = owns_input;
                    instruction.degrees_of_freedom = degrees_of_freedom;
                    builder.emit(std::move(instruction));
                    return {};
                }
                if (argument_kind == "load" || argument_kind == "field_access" ||
                    argument_kind == "dotted_index") {
                    const auto projection = projection_of(argument_expression);
                    const auto& source_layout = builder.layout(projection.binding);
                    ValueSlice slice{0, source_layout.width, source_layout.kind};
                    ValueLayout argument_layout = source_layout;
                    if (!projection.path.empty()) {
                        const auto found = source_layout.selectors.find(projection.path);
                        if (found == source_layout.selectors.end()) {
                            throw LoweringFailure("unknown machine IR aggregate projection");
                        }
                        slice = found->second;
                        argument_layout = projected_layout(source_layout, projection.path, slice);
                    }
                    if (!is_numeric_layout(argument_layout)) {
                        throw LoweringFailure("machine IR stat call requires a non-empty numeric container");
                    }
                    if (argument_layout.width >= 16) {
                        Instruction instruction;
                        instruction.opcode = name == "sum" ? Opcode::SumF64Locals
                            : name == "mean" ? Opcode::MeanF64Locals
                            : name == "variance" ? Opcode::VarianceF64Locals
                            : name == "std" ? Opcode::StdDevF64Locals
                            : name == "range" ? Opcode::RangeF64Locals : Opcode::CountLocalValues;
                        instruction.index = builder.slot(projection.binding, slice.offset);
                        instruction.argument_count = argument_layout.width;
                        instruction.degrees_of_freedom = degrees_of_freedom;
                        if ((name == "variance" || name == "std") &&
                            instruction.argument_count <= instruction.degrees_of_freedom) {
                            throw LoweringFailure("stat." + name + " input is too small for ddof");
                        }
                        builder.emit(std::move(instruction));
                        return {};
                    }
                }
                const auto argument = lower_expression(
                    argument_expression, builder, signatures, strings);
                if (!is_numeric_layout(argument)) {
                    throw LoweringFailure("machine IR stat call requires a non-empty numeric container");
                }
                Instruction instruction;
                instruction.opcode = name == "sum" ? Opcode::SumF64Values
                    : name == "mean" ? Opcode::MeanF64Values
                    : name == "variance" ? Opcode::VarianceF64Values
                    : name == "std" ? Opcode::StdDevF64Values
                    : name == "range" ? Opcode::RangeF64Values : Opcode::CountValues;
                instruction.argument_count = argument.width;
                instruction.degrees_of_freedom = degrees_of_freedom;
                if ((name == "variance" || name == "std") &&
                    instruction.argument_count <= instruction.degrees_of_freedom) {
                    throw LoweringFailure("stat." + name + " input is too small for ddof");
                }
                builder.emit(std::move(instruction));
                return {};
            }
            if (module != "math") {
                throw LoweringFailure("unsupported machine IR stdlib call " + module + "." + name);
            }
            const auto& math_argument = object_of(args.front(), "math argument");
            const auto argument = lower_expression(
                math_argument, builder, signatures, strings);
            const Opcode opcode = name == "abs" ? Opcode::AbsF64
                : name == "sqrt" ? Opcode::SqrtF64
                : name == "sin" ? Opcode::SinF64
                : name == "cos" ? Opcode::CosF64
                : name == "exp" ? Opcode::ExpF64
                : name == "ln" ? Opcode::LnF64
                : throw LoweringFailure("unsupported machine IR math call math." + name);
            if (argument.kind == ValueKind::Complex) {
                return emit_complex_elementary_math(builder, name, argument);
            }
            if (argument.kind == ValueKind::Aggregate) {
                const auto structural_paths = structural_paths_from_call(expression);
                const auto structural_matches = resolve_structural_layout_matches(
                    argument, structural_paths);
                std::set<std::uint32_t> numeric_offsets;
                for (const auto& match : structural_matches) {
                    if (match.layout.kind != ValueKind::Numeric || match.layout.width != 1) {
                        throw LoweringFailure(
                            "math compatibility path does not resolve to a numeric scalar");
                    }
                    numeric_offsets.insert(match.offset);
                }
                ensure_independent_value(math_argument, argument, builder, signatures);
                const auto temporary = builder.add_borrowed_temporary(argument);
                for (std::uint32_t component = argument.width; component > 0; --component) {
                    emit_store_local_component(builder, temporary + component - 1u);
                }
                for (std::uint32_t component = 0; component < argument.width; ++component) {
                    emit_load_local_component(builder, temporary + component);
                    if (numeric_offsets.count(component)) builder.emit({opcode});
                }
                return argument;
            }
            require_scalar(argument, "machine IR math call");
            builder.emit({opcode});
            return {};
        }
        if (callee_kind != "load") {
            throw LoweringFailure("machine IR supports direct calls only");
        }
        const std::string symbol = string_field(callee, "name", "callee");
        const auto signature = signatures.find(symbol);
        if (signature == signatures.end() && symbol == "bit") {
            if (args.size() != 1 ||
                !array_of(field(expression, "named_args", "call"), "named call args").empty() ||
                !array_of(field(expression, "spread_args", "call"), "spread call args").empty()) {
                throw LoweringFailure("machine IR bit conversion requires one argument");
            }
            const auto argument = lower_expression(
                object_of(args.front(), "bit conversion argument"), builder, signatures, strings);
            require_scalar(argument, "machine IR bit conversion");
            builder.emit({Opcode::BooleanizeF64});
            return {};
        }
        if (signature == signatures.end() && symbol == "str") {
            if (args.size() != 1 ||
                !array_of(field(expression, "named_args", "call"), "named call args").empty() ||
                !array_of(field(expression, "spread_args", "call"), "spread call args").empty()) {
                throw LoweringFailure("machine IR str conversion requires one argument");
            }
            const auto& argument_expression = object_of(args.front(), "str conversion argument");
            const auto argument = lower_expression(
                argument_expression, builder, signatures, strings);
            if (argument.kind == ValueKind::String) {
                if (!expression_transfers_string_value(argument_expression, signatures)) {
                    builder.emit({Opcode::CloneString});
                }
                return {2, ValueKind::String, {}};
            }
            if (argument.kind == ValueKind::Null) {
                builder.emit({Opcode::Drop});
                emit_static_string(builder, strings, "null");
                return {2, ValueKind::String, {}};
            }
            if (argument.kind == ValueKind::Complex) {
                return emit_complex_string(builder, strings);
            }
            if (argument.kind == ValueKind::Range) {
                const auto temporary = builder.add_borrowed_temporary(argument);
                emit_store_local_component(builder, temporary + 2u);
                emit_store_local_component(builder, temporary + 1u);
                emit_store_local_component(builder, temporary);
                emit_static_string(builder, strings, "range from ");
                emit_load_local_component(builder, temporary);
                Instruction render;
                render.opcode = Opcode::FormatF64String;
                const std::string numeric_format = interpolation_numeric_format("");
                render.index = strings.intern(numeric_format + '\0');
                render.byte_count = static_cast<std::uint32_t>(numeric_format.size());
                builder.emit(std::move(render));
                emit_interpolation_concat(builder, false, true);
                return {2, ValueKind::String, {}};
            }
            if (argument.kind == ValueKind::Aggregate ||
                argument.kind == ValueKind::DynamicF64List ||
                argument.kind == ValueKind::NumericMultiset ||
                argument.kind == ValueKind::StringMultiset) {
                ensure_independent_value(
                    argument_expression, argument, builder, signatures);
                const auto temporary = builder.add_owned_temporary(argument);
                for (std::uint32_t component = argument.width; component > 0; --component) {
                    emit_store_local_component(builder, temporary + component - 1u);
                }
                const auto shape = display_shape_from_expression(
                    argument_expression, {}, nullptr);
                emit_local_interpolation_string(
                    builder, strings, temporary, argument, shape, "");
                emit_release_layout_local(builder, temporary, argument);
                return {2, ValueKind::String, {}};
            }
            require_scalar(argument, "machine IR str conversion");
            Instruction render;
            const std::string argument_type = string_field(
                argument_expression, "type", "str conversion argument");
            if (argument_type == "bit") {
                render.opcode = Opcode::FormatBitString;
                render.index = strings.intern("false");
                render.error_message_offset = strings.intern("true");
            } else if (argument_type == "chr") {
                render.opcode = Opcode::FormatChrString;
            } else {
                render.opcode = Opcode::FormatF64String;
                const std::string format = interpolation_numeric_format("");
                render.index = strings.intern(format + '\0');
                render.byte_count = static_cast<std::uint32_t>(format.size());
            }
            builder.emit(std::move(render));
            return {2, ValueKind::String, {}};
        }
        if (signature == signatures.end() && symbol == "chr") {
            if (args.size() != 1 ||
                !array_of(field(expression, "named_args", "call"), "named call args").empty() ||
                !array_of(field(expression, "spread_args", "call"), "spread call args").empty()) {
                throw LoweringFailure("machine IR chr conversion requires one argument");
            }
            const auto argument = lower_expression(
                object_of(args.front(), "chr conversion argument"), builder, signatures, strings);
            require_scalar(argument, "machine IR chr conversion");
            const std::string message = "chr cast requires a Unicode scalar value";
            const auto assert_valid = [&]() {
                Instruction check;
                check.opcode = Opcode::AssertTruthy;
                check.index = strings.intern(message);
                check.byte_count = static_cast<std::uint32_t>(message.size());
                check.error_type_mask = value_error_mask;
                if (const auto handler = builder.error_handler()) {
                    check.has_error_handler = true;
                    check.label = *handler;
                    check.error_value_local = *builder.error_value_local();
                    check.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(check));
                builder.emit({Opcode::Drop});
            };
            const auto compare_constant = [&](double value, Opcode comparison) {
                builder.emit({Opcode::Duplicate});
                Instruction constant;
                constant.opcode = Opcode::PushF64;
                constant.f64 = value;
                builder.emit(std::move(constant));
                builder.emit({comparison});
            };
            builder.emit({Opcode::Duplicate});
            builder.emit({Opcode::Duplicate});
            Instruction one;
            one.opcode = Opcode::PushF64;
            one.f64 = 1.0;
            builder.emit(std::move(one));
            builder.emit({Opcode::FloorDivideF64});
            builder.emit({Opcode::OrderedEqualF64});
            assert_valid();
            compare_constant(0.0, Opcode::OrderedGreaterEqualF64);
            assert_valid();
            compare_constant(1114111.0, Opcode::OrderedLessEqualF64);
            assert_valid();
            const auto below_surrogates = builder.add_borrowed_temporary({});
            compare_constant(55296.0, Opcode::OrderedLessF64);
            Instruction save_below;
            save_below.opcode = Opcode::StoreLocal;
            save_below.index = below_surrogates;
            builder.emit(std::move(save_below));
            builder.emit({Opcode::Duplicate});
            Instruction surrogate_end;
            surrogate_end.opcode = Opcode::PushF64;
            surrogate_end.f64 = 57343.0;
            builder.emit(std::move(surrogate_end));
            builder.emit({Opcode::OrderedGreaterF64});
            Instruction load_below;
            load_below.opcode = Opcode::LoadLocal;
            load_below.index = below_surrogates;
            builder.emit(std::move(load_below));
            builder.emit({Opcode::AddF64});
            builder.emit({Opcode::BooleanizeF64});
            assert_valid();
            return {};
        }
        if (signature == signatures.end() && (symbol == "int" || symbol == "num")) {
            if ((args.size() != 1 && !(symbol == "num" && args.size() == 2)) ||
                !array_of(field(expression, "named_args", "call"), "named call args").empty() ||
                !array_of(field(expression, "spread_args", "call"), "spread call args").empty()) {
                throw LoweringFailure("machine IR numeric conversion " + symbol + " has invalid arity");
            }
            auto argument = lower_expression(
                object_of(args.front(), "numeric conversion argument"), builder, signatures, strings);
            if (symbol == "num" && args.size() == 2) {
                require_scalar(argument, "machine IR num real component");
                const auto imaginary = lower_expression(
                    object_of(args[1], "numeric conversion imaginary argument"),
                    builder, signatures, strings);
                require_scalar(imaginary, "machine IR num imaginary component");
                return {2, ValueKind::Complex, {}};
            }
            if (symbol == "num") {
                if (argument.kind == ValueKind::Complex) return argument;
                require_scalar(argument, "machine IR numeric conversion");
                return argument;
            }
            if (argument.kind == ValueKind::Complex) {
                const auto complex = builder.add_borrowed_temporary(argument);
                emit_store_local_component(builder, complex + 1u);
                emit_store_local_component(builder, complex);
                emit_load_local_component(builder, complex + 1u);
                Instruction zero;
                zero.opcode = Opcode::PushF64;
                zero.f64 = 0.0;
                builder.emit(std::move(zero));
                builder.emit({Opcode::OrderedEqualF64});
                Instruction real_only;
                real_only.opcode = Opcode::AssertTruthy;
                const std::string message = "int cast requires a real integer-valued number";
                real_only.index = strings.intern(message);
                real_only.byte_count = static_cast<std::uint32_t>(message.size());
                real_only.error_type_mask = value_error_mask;
                if (const auto handler = builder.error_handler()) {
                    real_only.has_error_handler = true;
                    real_only.label = *handler;
                    real_only.error_value_local = *builder.error_value_local();
                    real_only.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(real_only));
                builder.emit({Opcode::Drop});
                emit_load_local_component(builder, complex);
                argument = {};
            }
            require_scalar(argument, "machine IR numeric conversion");
            if (symbol == "int") {
                builder.emit({Opcode::Duplicate});
                builder.emit({Opcode::Duplicate});
                Instruction one;
                one.opcode = Opcode::PushF64;
                one.f64 = 1.0;
                builder.emit(std::move(one));
                builder.emit({Opcode::FloorDivideF64});
                builder.emit({Opcode::OrderedEqualF64});
                Instruction check;
                check.opcode = Opcode::AssertTruthy;
                const std::string message = "int cast requires integer-valued number";
                check.index = strings.intern(message);
                check.byte_count = static_cast<std::uint32_t>(message.size());
                check.error_type_mask = value_error_mask;
                if (const auto handler = builder.error_handler()) {
                    check.has_error_handler = true;
                    check.label = *handler;
                    check.error_value_local = *builder.error_value_local();
                    check.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(check));
                builder.emit({Opcode::Drop});
            }
            return {};
        }
        if (signature == signatures.end() &&
            (symbol == "abs" || symbol == "sqrt" || symbol == "sin" ||
             symbol == "cos" || symbol == "exp" || symbol == "ln")) {
            if (args.size() != 1 ||
                !array_of(field(expression, "named_args", "call"), "named call args").empty() ||
                !array_of(field(expression, "spread_args", "call"), "spread call args").empty()) {
                throw LoweringFailure("machine IR math builtin " + symbol + " requires one argument");
            }
            const auto argument = lower_expression(
                object_of(args.front(), "math builtin argument"), builder, signatures, strings);
            if (argument.kind == ValueKind::Complex) {
                return emit_complex_elementary_math(builder, symbol, argument);
            }
            require_scalar(argument, "machine IR math builtin");
            const Opcode opcode = symbol == "abs" ? Opcode::AbsF64
                : symbol == "sqrt" ? Opcode::SqrtF64
                : symbol == "sin" ? Opcode::SinF64
                : symbol == "cos" ? Opcode::CosF64
                : symbol == "exp" ? Opcode::ExpF64 : Opcode::LnF64;
            builder.emit({opcode});
            return {};
        }
        if (signature == signatures.end()) throw LoweringFailure("unknown direct machine IR call " + symbol);
        const auto structural = expression.find("structural_call");
        if (structural != expression.end() && structural->second.is_boolean() &&
            structural->second.as_boolean()) {
            std::set<std::size_t> lifted_indices;
            const auto lifted = expression.find("structural_argument_indices");
            if (lifted != expression.end() && lifted->second.is_array()) {
                for (const auto& value : lifted->second.as_array()) {
                    if (!value.is_number() || value.as_number() < 0) {
                        throw LoweringFailure("structural argument index must be non-negative");
                    }
                    lifted_indices.insert(static_cast<std::size_t>(value.as_number()));
                }
            }
            if (lifted_indices.empty()) lifted_indices.insert(0);
            if (args.size() > 1) {
                if (args.size() != signature->second.parameters.size() ||
                    !array_of(field(expression, "named_args", "structural call"), "structural named args").empty() ||
                    !array_of(field(expression, "spread_args", "structural call"), "structural spread args").empty()) {
                    throw LoweringFailure(
                        "automatic structural calls require positional arguments matching the function arity");
                }
                struct StoredStructuralArgument {
                    std::uint32_t temporary = 0;
                    ValueLayout layout;
                };
                std::vector<StoredStructuralArgument> stored;
                stored.reserve(args.size());
                for (const auto& raw_argument : args) {
                    const auto& argument_expression = object_of(raw_argument, "structural call argument");
                    const auto layout = lower_expression(
                        argument_expression, builder, signatures, strings);
                    const auto temporary = builder.add_borrowed_temporary(layout);
                    for (std::uint32_t component = layout.width; component > 0; --component) {
                        emit_store_local_component(builder, temporary + component - 1u);
                    }
                    stored.push_back({temporary, layout});
                }
                const std::size_t carrier_index = *lifted_indices.begin();
                if (carrier_index >= stored.size() ||
                    stored[carrier_index].layout.kind != ValueKind::Aggregate) {
                    throw LoweringFailure("automatic structural call requires a fixed vector carrier");
                }
                const auto structural_paths = structural_paths_from_call(expression);
                const auto matches = resolve_structural_layout_matches(
                    stored[carrier_index].layout, structural_paths);
                if (matches.empty()) {
                    throw LoweringFailure("automatic structural call found no compatible vector elements");
                }
                for (const auto index : lifted_indices) {
                    if (index >= stored.size() ||
                        !same_layout(stored[index].layout, stored[carrier_index].layout)) {
                        throw LoweringFailure(
                            "lifted structural arguments must have identical fixed vector shapes");
                    }
                    for (const auto& match : matches) {
                        if (!same_layout(match.layout, signature->second.parameters[index])) {
                            throw LoweringFailure(
                                "structural compatibility path has the wrong machine layout for " + symbol +
                                ": expected " + describe_layout(signature->second.parameters[index]) +
                                ", got " + describe_layout(match.layout));
                        }
                    }
                }
                const auto result_layout = layout_from_type(
                    string_field(expression, "type", "structural call"), &signatures);
                const std::uint64_t produced_width =
                    static_cast<std::uint64_t>(matches.size()) * signature->second.result.width;
                if (produced_width != result_layout.width) {
                    throw LoweringFailure(
                        "structural result shape does not match compatible vector elements");
                }
                for (const auto& match : matches) {
                    std::uint32_t argument_width = 0;
                    for (std::size_t index = 0; index < stored.size(); ++index) {
                        if (lifted_indices.count(index)) {
                            for (std::uint32_t component = 0; component < match.layout.width; ++component) {
                                emit_load_local_component(
                                    builder, stored[index].temporary + match.offset + component);
                            }
                            argument_width += match.layout.width;
                        } else {
                            for (std::uint32_t component = 0; component < stored[index].layout.width; ++component) {
                                emit_load_local_component(builder, stored[index].temporary + component);
                            }
                            argument_width += stored[index].layout.width;
                        }
                    }
                    Instruction call;
                    call.opcode = Opcode::Call;
                    call.argument_count = argument_width;
                    call.result_count = signature->second.result.width;
                    call.provided_parameter_mask = signature->second.parameters.size() >= 32
                        ? 0xffffffffu
                        : (1u << static_cast<std::uint32_t>(signature->second.parameters.size())) - 1u;
                    call.symbol = symbol;
                    call.may_error = signature->second.may_error;
                    if (call.may_error) {
                        if (const auto handler = builder.error_handler()) {
                            call.has_error_handler = true;
                            call.label = *handler;
                            call.error_value_local = *builder.error_value_local();
                            call.error_type_local = *builder.error_type_local();
                        }
                    }
                    builder.emit(std::move(call));
                }
                return result_layout;
            }
            if (args.size() != 1 || signature->second.parameters.size() != 1 ||
                !array_of(field(expression, "named_args", "structural call"), "structural named args").empty() ||
                !array_of(field(expression, "spread_args", "structural call"), "structural spread args").empty()) {
                throw LoweringFailure(
                    "automatic structural calls currently require one positional argument");
            }
            const auto& argument_expression = object_of(args.front(), "structural call argument");
            auto argument = lower_expression(
                argument_expression, builder, signatures, strings);
            const auto structural_paths = structural_paths_from_call(expression);
            const auto& parameter = signature->second.parameters.front();
            const bool preserves_match_layout = same_layout(
                parameter, signature->second.result);
            const auto structural_result = preserves_match_layout
                ? argument
                : layout_from_type(
                    string_field(expression, "type", "structural call"), &signatures);
            if (argument.kind == ValueKind::DynamicF64List) {
                if (parameter.kind != ValueKind::Numeric || parameter.width != 1 ||
                    signature->second.result.kind != ValueKind::Numeric ||
                    signature->second.result.width != 1) {
                    throw LoweringFailure(
                        "dynamic structural calls require scalar numeric parameters and results");
                }
                const bool maps_elements = std::find(
                    structural_paths.begin(), structural_paths.end(), "*") != structural_paths.end();
                const auto source_local = builder.add_borrowed_temporary(argument);
                emit_store_local_component(builder, source_local);
                const auto result_local = builder.add_owned_temporary(argument);
                emit_load_local_component(builder, source_local);
                builder.emit({Opcode::CloneF64List});
                emit_store_local_component(builder, result_local);
                if (!maps_elements) {
                    emit_load_local_component(builder, result_local);
                    builder.emit({Opcode::CloneF64List});
                    emit_release_layout_local(builder, result_local, argument);
                    if (expression_produces_owned_f64_list(argument_expression, signatures)) {
                        emit_release_layout_local(builder, source_local, argument);
                    }
                    return structural_result;
                }
                const auto cursor = builder.add_borrowed_temporary({});
                emit_push_f64(builder, 0.0);
                emit_store_local_component(builder, cursor);
                const auto loop = builder.next_label();
                const auto finish = builder.next_label();
                Instruction loop_label;
                loop_label.opcode = Opcode::Label;
                loop_label.label = loop;
                builder.emit(std::move(loop_label));
                emit_load_local_component(builder, cursor);
                emit_load_local_component(builder, source_local);
                builder.emit({Opcode::CountF64List});
                builder.emit({Opcode::OrderedLessF64});
                Instruction done;
                done.opcode = Opcode::JumpIfFalse;
                done.label = finish;
                builder.emit(std::move(done));
                emit_load_local_component(builder, cursor);
                emit_load_local_component(builder, source_local);
                emit_load_local_component(builder, cursor);
                builder.emit({Opcode::LoadF64ListIndex});
                Instruction call;
                call.opcode = Opcode::Call;
                call.argument_count = 1;
                call.result_count = 1;
                call.provided_parameter_mask = 1;
                call.symbol = symbol;
                call.may_error = signature->second.may_error;
                if (call.may_error) {
                    if (const auto handler = builder.error_handler()) {
                        call.has_error_handler = true;
                        call.label = *handler;
                        call.error_value_local = *builder.error_value_local();
                        call.error_type_local = *builder.error_type_local();
                    }
                }
                builder.emit(std::move(call));
                Instruction update;
                update.opcode = Opcode::StoreF64ListIndex;
                update.index = result_local;
                update.may_error = true;
                const std::string update_message = "structural map index out of range";
                update.error_message_offset = strings.intern(update_message);
                update.byte_count = static_cast<std::uint32_t>(update_message.size());
                if (const auto handler = builder.error_handler()) {
                    update.has_error_handler = true;
                    update.label = *handler;
                    update.error_value_local = *builder.error_value_local();
                    update.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(update));
                emit_load_local_component(builder, cursor);
                emit_push_f64(builder, 1.0);
                builder.emit({Opcode::AddF64});
                emit_store_local_component(builder, cursor);
                Instruction repeat;
                repeat.opcode = Opcode::Jump;
                repeat.label = loop;
                builder.emit(std::move(repeat));
                Instruction finish_label;
                finish_label.opcode = Opcode::Label;
                finish_label.label = finish;
                builder.emit(std::move(finish_label));
                emit_load_local_component(builder, result_local);
                builder.emit({Opcode::CloneF64List});
                emit_release_layout_local(builder, result_local, argument);
                if (expression_produces_owned_f64_list(argument_expression, signatures)) {
                    emit_release_layout_local(builder, source_local, argument);
                }
                return structural_result;
            }
            if (argument.kind != ValueKind::Aggregate) {
                throw LoweringFailure("automatic structural call requires a structural argument");
            }

            auto matches = resolve_structural_layout_matches(argument, structural_paths);
            for (const auto& match : matches) {
                if (!same_layout(match.layout, parameter)) {
                    throw LoweringFailure(
                        "structural compatibility path has the wrong machine layout for " + symbol);
                }
            }

            ensure_independent_value(
                argument_expression, argument, builder, signatures);
            const auto temporary = builder.add_borrowed_temporary(argument);
            for (std::uint32_t component = argument.width; component > 0; --component) {
                emit_store_local_component(builder, temporary + component - 1u);
            }
            const bool dense_scalar_map = preserves_match_layout && argument.width >= 8 &&
                !has_owned_resources(argument) && parameter.kind == ValueKind::Numeric &&
                parameter.width == 1 && signature->second.result.kind == ValueKind::Numeric &&
                signature->second.result.width == 1 && matches.size() == argument.width &&
                std::all_of(matches.begin(), matches.end(), [&](const auto& match) {
                    return match.layout.kind == ValueKind::Numeric && match.layout.width == 1 &&
                        match.offset < argument.width &&
                        match.offset == static_cast<std::uint32_t>(&match - matches.data());
                });
            if (dense_scalar_map) {
                const auto cursor = builder.add_borrowed_temporary({});
                emit_push_f64(builder, 0.0);
                emit_store_local_component(builder, cursor);
                const auto loop = builder.next_label();
                const auto finish = builder.next_label();
                Instruction loop_label;
                loop_label.opcode = Opcode::Label;
                loop_label.label = loop;
                builder.emit(std::move(loop_label));
                emit_load_local_component(builder, cursor);
                emit_push_f64(builder, static_cast<double>(argument.width));
                builder.emit({Opcode::OrderedLessF64});
                Instruction done;
                done.opcode = Opcode::JumpIfFalse;
                done.label = finish;
                builder.emit(std::move(done));

                // Keep one copy of the induction value for the in-place store.
                // The second copy addresses the source element consumed by the
                // scalar function.
                emit_load_local_component(builder, cursor);
                emit_load_local_component(builder, cursor);
                Instruction load;
                load.opcode = Opcode::LoadF64LocalsIndex;
                load.index = temporary;
                load.argument_count = argument.width;
                load.index_is_integral = true;
                load.index_local = cursor;
                load.may_error = true;
                const std::string index_message = "structural map index out of range";
                load.error_message_offset = strings.intern(index_message);
                load.byte_count = static_cast<std::uint32_t>(index_message.size());
                if (const auto handler = builder.error_handler()) {
                    load.has_error_handler = true;
                    load.label = *handler;
                    load.error_value_local = *builder.error_value_local();
                    load.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(load));

                Instruction call;
                call.opcode = Opcode::Call;
                call.argument_count = 1;
                call.result_count = 1;
                call.provided_parameter_mask = 1;
                call.symbol = symbol;
                call.may_error = signature->second.may_error;
                if (call.may_error) {
                    if (const auto handler = builder.error_handler()) {
                        call.has_error_handler = true;
                        call.label = *handler;
                        call.error_value_local = *builder.error_value_local();
                        call.error_type_local = *builder.error_type_local();
                    }
                }
                builder.emit(std::move(call));

                Instruction update;
                update.opcode = Opcode::StoreF64LocalsIndex;
                update.index = temporary;
                update.argument_count = argument.width;
                update.index_is_integral = true;
                update.index_local = cursor;
                update.may_error = true;
                update.error_message_offset = strings.intern(index_message);
                update.byte_count = static_cast<std::uint32_t>(index_message.size());
                if (const auto handler = builder.error_handler()) {
                    update.has_error_handler = true;
                    update.label = *handler;
                    update.error_value_local = *builder.error_value_local();
                    update.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(update));

                emit_load_local_component(builder, cursor);
                emit_push_f64(builder, 1.0);
                builder.emit({Opcode::AddF64});
                emit_store_local_component(builder, cursor);
                Instruction repeat;
                repeat.opcode = Opcode::Jump;
                repeat.label = loop;
                builder.emit(std::move(repeat));
                Instruction finish_label;
                finish_label.opcode = Opcode::Label;
                finish_label.label = finish;
                builder.emit(std::move(finish_label));
                for (std::uint32_t component = 0; component < argument.width; ++component) {
                    emit_load_local_component(builder, temporary + component);
                }
                return structural_result;
            }
            std::size_t match_index = 0;
            for (std::uint32_t component = 0; component < argument.width;) {
                if (match_index < matches.size() && matches[match_index].offset == component) {
                    const auto& match = matches[match_index];
                    for (std::uint32_t field = 0; field < match.layout.width; ++field) {
                        emit_load_local_component(builder, temporary + component + field);
                    }
                    Instruction call;
                    call.opcode = Opcode::Call;
                    call.argument_count = match.layout.width;
                    call.result_count = signature->second.result.width;
                    call.provided_parameter_mask = 1;
                    call.symbol = symbol;
                    call.may_error = signature->second.may_error;
                    if (call.may_error) {
                        if (const auto handler = builder.error_handler()) {
                            call.has_error_handler = true;
                            call.label = *handler;
                            call.error_value_local = *builder.error_value_local();
                            call.error_type_local = *builder.error_type_local();
                        }
                    }
                    builder.emit(std::move(call));
                    component += match.layout.width;
                    ++match_index;
                } else {
                    emit_load_local_component(builder, temporary + component);
                    ++component;
                }
            }
            return structural_result;
        }
        const auto elementwise = expression.find("elementwise_math");
        if (elementwise != expression.end() && elementwise->second.is_boolean() &&
            elementwise->second.as_boolean()) {
            if (args.empty() || args.size() != signature->second.parameters.size() ||
                std::any_of(
                    signature->second.parameters.begin(), signature->second.parameters.end(),
                    [](const auto& parameter) { return parameter.width != 1; }) ||
                signature->second.result.width != 1) {
                throw LoweringFailure(
                    "elementwise math function requires scalar arguments and result; got " +
                    std::to_string(signature->second.parameters.size()) + " parameters, widths " +
                    (signature->second.parameters.empty() ? std::string("none")
                        : std::to_string(signature->second.parameters.front().width)) + " -> " +
                    std::to_string(signature->second.result.width));
            }
            struct LiftedArgument {
                std::uint32_t temporary = 0;
                ValueLayout layout;
            };
            std::vector<LiftedArgument> lifted_arguments;
            std::optional<ValueLayout> result_layout;
            for (const auto& value : args) {
                const auto& argument_expression = object_of(value, "elementwise math argument");
                const auto argument = lower_expression(
                    argument_expression, builder, signatures, strings);
                if (argument.kind != ValueKind::Aggregate &&
                    (argument.kind != ValueKind::Numeric || argument.width != 1)) {
                    throw LoweringFailure(
                        "elementwise math requires numeric scalars or fixed structural arguments");
                }
                if (argument.kind == ValueKind::Aggregate) {
                    if (result_layout && !same_layout(*result_layout, argument)) {
                        throw LoweringFailure("elementwise math aggregate arguments must have the same shape");
                    }
                    if (!result_layout) {
                        ensure_independent_value(
                            argument_expression, argument, builder, signatures);
                    }
                    result_layout = argument;
                }
                const auto temporary = builder.add_borrowed_temporary(argument);
                for (std::uint32_t component = argument.width; component > 0; --component) {
                    emit_store_local_component(builder, temporary + component - 1u);
                }
                lifted_arguments.push_back({temporary, argument});
            }
            if (!result_layout) {
                throw LoweringFailure("elementwise math requires a numeric vector, tuple, or struct");
            }
            const auto structural_paths = structural_paths_from_call(expression);
            const auto structural_matches = resolve_structural_layout_matches(
                *result_layout, structural_paths);
            std::set<std::uint32_t> numeric_offsets;
            for (const auto& match : structural_matches) {
                if (match.layout.kind != ValueKind::Numeric || match.layout.width != 1) {
                    throw LoweringFailure(
                        "elementwise math compatibility path does not resolve to a numeric scalar");
                }
                numeric_offsets.insert(match.offset);
            }
            for (std::uint32_t component = 0; component < result_layout->width; ++component) {
                if (numeric_offsets.count(component)) {
                    for (const auto& argument : lifted_arguments) {
                        emit_load_local_component(
                            builder,
                            argument.temporary +
                                (argument.layout.kind == ValueKind::Aggregate ? component : 0u));
                    }
                    Instruction call;
                    call.opcode = Opcode::Call;
                    call.argument_count = static_cast<std::uint32_t>(lifted_arguments.size());
                    call.result_count = 1;
                    call.provided_parameter_mask = lifted_arguments.size() >= 32
                        ? 0xffffffffu
                        : (1u << static_cast<std::uint32_t>(lifted_arguments.size())) - 1u;
                    call.symbol = symbol;
                    call.may_error = signature->second.may_error;
                    if (call.may_error) {
                        if (const auto handler = builder.error_handler()) {
                            call.has_error_handler = true;
                            call.label = *handler;
                            call.error_value_local = *builder.error_value_local();
                            call.error_type_local = *builder.error_type_local();
                        }
                    }
                    builder.emit(std::move(call));
                } else {
                    const auto carrier = std::find_if(
                        lifted_arguments.begin(), lifted_arguments.end(),
                        [](const auto& argument) {
                            return argument.layout.kind == ValueKind::Aggregate;
                        });
                    emit_load_local_component(builder, carrier->temporary + component);
                }
            }
            return *result_layout;
        }
        if (signature->second.parameters.size() > 32) {
            throw LoweringFailure("direct machine IR calls support at most 32 parameters");
        }
        std::vector<const vf::JsonValue::Object*> parameter_values(
            signature->second.parameters.size(), nullptr);
        const auto variadic_index = signature->second.variadic_positional_index;
        const auto variadic_named_index = signature->second.variadic_named_index;
        if (!variadic_index && args.size() > parameter_values.size()) {
            throw LoweringFailure("too many arguments for direct machine IR call " + symbol);
        }
        if (variadic_index && *variadic_index + 1 != parameter_values.size()) {
            throw LoweringFailure("direct machine IR variadic positional parameter must be last");
        }
        const std::size_t fixed_positional_count = variadic_index
            ? std::min(args.size(), *variadic_index)
            : args.size();
        for (std::size_t index = 0; index < fixed_positional_count; ++index) {
            parameter_values[index] = &object_of(args[index], "call argument");
        }
        std::vector<const vf::JsonValue::Object*> variadic_values;
        if (variadic_index) {
            for (std::size_t index = *variadic_index; index < args.size(); ++index) {
                variadic_values.push_back(&object_of(args[index], "variadic call argument"));
            }
        }
        std::map<std::string, const vf::JsonValue::Object*> variadic_named_values;
        const auto& named_args = array_of(field(expression, "named_args", "call"), "named call args");
        for (const auto& named_value : named_args) {
            const auto& named = object_of(named_value, "named call argument");
            const std::string name = string_field(named, "name", "named call argument");
            const auto found = std::find(
                signature->second.parameter_names.begin(),
                signature->second.parameter_names.end(),
                name);
            if (found == signature->second.parameter_names.end()) {
                if (variadic_named_index) {
                    if (variadic_named_values.count(name)) {
                        throw LoweringFailure("multiple values for variadic named argument " + name);
                    }
                    variadic_named_values[name] = &object_of(
                        field(named, "value", "named call argument"),
                        "variadic named argument value");
                    continue;
                }
                throw LoweringFailure("unknown named argument " + name + " for " + symbol);
            }
            const auto index = static_cast<std::size_t>(
                found - signature->second.parameter_names.begin());
            if (variadic_index && index == *variadic_index) {
                throw LoweringFailure("variadic positional argument must be positional for " + symbol);
            }
            if (parameter_values[index]) {
                throw LoweringFailure("multiple values for argument " + name);
            }
            parameter_values[index] = &object_of(
                field(named, "value", "named call argument"), "named call argument value");
        }
        const auto& spread_args = array_of(
            field(expression, "spread_args", "call"), "spread call args");
        std::uint32_t argument_count = 0;
        std::uint32_t provided_parameter_mask = 0;
        std::vector<std::pair<std::uint32_t, ValueLayout>> owned_argument_temporaries;
        struct FixedSpreadComponent {
            std::uint32_t temporary = 0;
            ValueSlice slice;
            ValueLayout layout;
            bool dynamic_list = false;
            std::uint32_t dynamic_index = 0;
        };
        std::map<std::size_t, FixedSpreadComponent> fixed_spread_components;
        if (!spread_args.empty() && !variadic_index) {
            if (spread_args.size() != 1) {
                throw LoweringFailure("direct machine IR fixed calls support one spread value");
            }
            const auto& spread_expression = object_of(spread_args.front(), "fixed spread argument");
            const auto spread_layout = lower_expression(
                spread_expression, builder, signatures, strings);
            const bool owns_spread =
                (spread_layout.kind == ValueKind::DynamicF64List &&
                 expression_produces_owned_f64_list(spread_expression, signatures)) ||
                (spread_layout.kind == ValueKind::Aggregate && has_owned_resources(spread_layout) &&
                 expression_transfers_aggregate_value(spread_expression, signatures));
            const auto temporary = owns_spread
                ? builder.add_owned_temporary(spread_layout)
                : builder.add_borrowed_temporary(spread_layout);
            for (std::uint32_t component = spread_layout.width; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = temporary + component - 1;
                builder.emit(std::move(store));
            }
            if (owns_spread) owned_argument_temporaries.push_back({temporary, spread_layout});
            if (spread_layout.kind == ValueKind::DynamicF64List) {
                std::vector<std::size_t> targets;
                for (std::size_t index = 0; index < parameter_values.size(); ++index) {
                    if (!parameter_values[index] &&
                        (!variadic_named_index || index != *variadic_named_index)) {
                        targets.push_back(index);
                    }
                }
                Instruction load;
                load.opcode = Opcode::LoadLocal;
                load.index = temporary;
                builder.emit(std::move(load));
                builder.emit({Opcode::CountF64List});
                Instruction expected_count;
                expected_count.opcode = Opcode::PushF64;
                expected_count.f64 = static_cast<double>(targets.size());
                builder.emit(std::move(expected_count));
                builder.emit({Opcode::OrderedEqualF64});
                Instruction arity;
                arity.opcode = Opcode::AssertTruthy;
                const std::string message = "spread argument count mismatch for " + symbol;
                arity.index = strings.intern(message);
                arity.byte_count = static_cast<std::uint32_t>(message.size());
                arity.error_type_mask = value_error_mask;
                if (const auto handler = builder.error_handler()) {
                    arity.has_error_handler = true;
                    arity.label = *handler;
                    arity.error_value_local = *builder.error_value_local();
                    arity.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(arity));
                builder.emit({Opcode::Drop});
                for (std::size_t position = 0; position < targets.size(); ++position) {
                    fixed_spread_components[targets[position]] = {
                        temporary,
                        {},
                        signature->second.parameters[targets[position]],
                        true,
                        static_cast<std::uint32_t>(position)
                    };
                }
            } else if (is_record_layout(spread_layout)) {
                for (std::size_t index = 0; index < parameter_values.size(); ++index) {
                    if (parameter_values[index] ||
                        (variadic_named_index && index == *variadic_named_index)) continue;
                    const auto supplied = spread_layout.selectors.find(
                        signature->second.parameter_names[index]);
                    if (supplied == spread_layout.selectors.end()) continue;
                    fixed_spread_components[index] = {
                        temporary,
                        supplied->second,
                        record_field_layout(spread_layout, supplied->first, supplied->second),
                        false,
                        0
                    };
                }
            } else if (spread_layout.kind == ValueKind::Aggregate) {
                std::vector<ValueSlice> items;
                for (const auto& [name, slice] : spread_layout.selectors) {
                    if (name.find('.') != std::string::npos || name.empty() ||
                        !std::all_of(name.begin(), name.end(), [](unsigned char ch) {
                            return std::isdigit(ch);
                        })) continue;
                    items.push_back(slice);
                }
                std::stable_sort(items.begin(), items.end(), [](const auto& left, const auto& right) {
                    return left.offset < right.offset;
                });
                std::vector<std::size_t> targets;
                for (std::size_t index = 0; index < parameter_values.size(); ++index) {
                    if (!parameter_values[index] &&
                        (!variadic_named_index || index != *variadic_named_index)) {
                        targets.push_back(index);
                    }
                }
                if (items.size() != targets.size()) {
                    throw LoweringFailure("spread argument count mismatch for " + symbol);
                }
                for (std::size_t position = 0; position < targets.size(); ++position) {
                    fixed_spread_components[targets[position]] = {
                        temporary,
                        items[position],
                        projected_layout(spread_layout, std::to_string(position), items[position]),
                        false,
                        0
                    };
                }
            } else {
                throw LoweringFailure("fixed spread requires a numeric list or record");
            }
        }
        for (std::size_t index = 0; index < parameter_values.size(); ++index) {
            const auto parameter_layout = signature->second.parameters[index];
            if (variadic_named_index && index == *variadic_named_index) {
                std::vector<std::pair<std::string, ValueSlice>> fields;
                for (const auto& [name, slice] : parameter_layout.selectors) {
                    if (name.find('.') == std::string::npos) fields.push_back({name, slice});
                }
                std::stable_sort(fields.begin(), fields.end(), [](const auto& left, const auto& right) {
                    return left.second.offset < right.second.offset;
                });
                for (const auto& [name, slice] : fields) {
                    const auto supplied = variadic_named_values.find(name);
                    if (supplied == variadic_named_values.end()) {
                        throw LoweringFailure("missing captured named argument " + name + " for " + symbol);
                    }
                    const auto& argument_expression = *supplied->second;
                    const auto layout = lower_expression(
                        argument_expression, builder, signatures, strings);
                    const auto expected = record_field_layout(parameter_layout, name, slice);
                    if (!same_layout(layout, expected)) {
                        throw LoweringFailure(
                            "variadic named argument layout mismatch for " + symbol + "." + name);
                    }
                    const bool transferred =
                        (layout.kind == ValueKind::String &&
                         expression_transfers_string_value(argument_expression, signatures)) ||
                        (layout.kind == ValueKind::DynamicF64List &&
                         expression_produces_owned_f64_list(argument_expression, signatures)) ||
                        ((layout.kind == ValueKind::Aggregate || layout.kind == ValueKind::StringMultiset) &&
                         has_owned_resources(layout) &&
                         expression_transfers_aggregate_value(argument_expression, signatures));
                    if (transferred) {
                        const auto temporary = builder.add_owned_temporary(layout);
                        for (std::uint32_t component = layout.width; component > 0; --component) {
                            Instruction store;
                            store.opcode = Opcode::StoreLocal;
                            store.index = temporary + component - 1;
                            builder.emit(std::move(store));
                        }
                        for (std::uint32_t component = 0; component < layout.width; ++component) {
                            Instruction load;
                            load.opcode = Opcode::LoadLocal;
                            load.index = temporary + component;
                            builder.emit(std::move(load));
                        }
                        owned_argument_temporaries.push_back({temporary, layout});
                    }
                }
                provided_parameter_mask |= 1u << index;
                argument_count += parameter_layout.width;
                continue;
            }
            const auto spread_component = fixed_spread_components.find(index);
            if (spread_component != fixed_spread_components.end()) {
                if (spread_component->second.dynamic_list) {
                    Instruction load;
                    load.opcode = Opcode::LoadLocal;
                    load.index = spread_component->second.temporary;
                    builder.emit(std::move(load));
                    Instruction item_index;
                    item_index.opcode = Opcode::PushF64;
                    item_index.f64 = static_cast<double>(spread_component->second.dynamic_index);
                    builder.emit(std::move(item_index));
                    builder.emit({Opcode::LoadF64ListIndex});
                } else {
                    for (std::uint32_t component = 0;
                         component < spread_component->second.slice.width;
                         ++component) {
                        Instruction load;
                        load.opcode = Opcode::LoadLocal;
                        load.index = spread_component->second.temporary +
                            spread_component->second.slice.offset + component;
                        builder.emit(std::move(load));
                    }
                }
                if (!same_layout(spread_component->second.layout, parameter_layout)) {
                    throw LoweringFailure(
                        "spread argument layout mismatch for " + symbol + "." +
                        signature->second.parameter_names[index]);
                }
                provided_parameter_mask |= 1u << index;
                argument_count += parameter_layout.width;
                continue;
            }
            if (variadic_index && index == *variadic_index) {
                for (const auto* argument_expression : variadic_values) {
                    const auto element = lower_expression(
                        *argument_expression, builder, signatures, strings);
                    require_scalar(element, "variadic numeric argument");
                }
                Instruction make;
                make.opcode = Opcode::MakeOwnedF64List;
                make.argument_count = static_cast<std::uint32_t>(variadic_values.size());
                builder.emit(std::move(make));
                for (const auto& spread_value : spread_args) {
                    const auto& spread_expression = object_of(spread_value, "spread argument");
                    const auto spread_layout = lower_expression(
                        spread_expression, builder, signatures, strings);
                    if (spread_layout.kind != ValueKind::DynamicF64List) {
                        throw LoweringFailure("numeric variadic spread requires a dynamic numeric list");
                    }
                    Instruction concat;
                    concat.opcode = Opcode::ConcatF64Lists;
                    concat.owns_left = true;
                    concat.owns_right = expression_produces_owned_f64_list(
                        spread_expression, signatures);
                    builder.emit(std::move(concat));
                }
                const auto temporary = builder.add_owned_temporary(parameter_layout);
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = temporary;
                builder.emit(std::move(store));
                Instruction load;
                load.opcode = Opcode::LoadLocal;
                load.index = temporary;
                builder.emit(std::move(load));
                owned_argument_temporaries.push_back({temporary, parameter_layout});
                provided_parameter_mask |= 1u << index;
                argument_count += parameter_layout.width;
                continue;
            }
            if (!parameter_values[index]) {
                const bool has_default = index < signature->second.parameter_defaults.size() &&
                    signature->second.parameter_defaults[index] != nullptr;
                if (!has_default) {
                    throw LoweringFailure(
                        "missing argument " + signature->second.parameter_names[index] + " for " + symbol);
                }
                for (std::uint32_t component = 0; component < parameter_layout.width; ++component) {
                    builder.emit({Opcode::PushF64});
                }
                argument_count += parameter_layout.width;
                continue;
            }
            const auto& argument_expression = *parameter_values[index];
            const auto fixed_indexed = lower_literal_projection_argument(
                argument_expression, parameter_layout, builder, signatures, strings);
            const auto projected = fixed_indexed
                ? std::optional<ValueLayout>{}
                : lower_open_record_argument(argument_expression, parameter_layout, builder);
            auto layout = projected
                ? *projected
                : fixed_indexed
                    ? *fixed_indexed
                    : lower_expression(argument_expression, builder, signatures, strings);
            bool projected_from_temporary = false;
            if (!projected && !same_layout(layout, parameter_layout) &&
                can_project_call_layout(layout, parameter_layout)) {
                const bool owns_value =
                    (layout.kind == ValueKind::DynamicF64List &&
                     expression_produces_owned_f64_list(argument_expression, signatures)) ||
                    (has_owned_resources(layout) &&
                     expression_transfers_aggregate_value(argument_expression, signatures));
                const auto temporary = owns_value
                    ? builder.add_owned_temporary(layout)
                    : builder.add_borrowed_temporary(layout);
                for (std::uint32_t component = layout.width; component > 0; --component) {
                    Instruction store;
                    store.opcode = Opcode::StoreLocal;
                    store.index = temporary + component - 1;
                    builder.emit(std::move(store));
                }
                emit_projected_call_layout(
                    builder,
                    strings,
                    temporary,
                    layout,
                    parameter_layout,
                    symbol + "." + signature->second.parameter_names[index]);
                if (owns_value) owned_argument_temporaries.push_back({temporary, layout});
                layout = parameter_layout;
                projected_from_temporary = true;
            }
            if (!projected && is_record_layout(parameter_layout) && is_record_layout(layout) &&
                !same_layout(layout, parameter_layout)) {
                throw LoweringFailure(
                    "machine IR call argument structure mismatch for " + symbol + "." +
                    signature->second.parameter_names[index] + ": expected " +
                    describe_layout(parameter_layout) + ", got " + describe_layout(layout));
            }
            if (layout.width != parameter_layout.width) {
                throw LoweringFailure(
                    "machine IR call argument width mismatch for " + symbol + "." +
                    signature->second.parameter_names[index] + ": expected " +
                    describe_layout(parameter_layout) + ", got " + describe_layout(layout));
            }
            provided_parameter_mask |= 1u << index;
            const bool transferred_list = layout.kind == ValueKind::DynamicF64List &&
                expression_produces_owned_f64_list(argument_expression, signatures);
            const bool transferred_string = layout.kind == ValueKind::String &&
                expression_transfers_string_value(argument_expression, signatures);
            const bool transferred_aggregate =
                (layout.kind == ValueKind::Aggregate || layout.kind == ValueKind::StringMultiset) &&
                has_owned_resources(layout) &&
                expression_transfers_aggregate_value(argument_expression, signatures);
            if (!projected_from_temporary &&
                (transferred_list || transferred_string || transferred_aggregate)) {
                const auto temporary = builder.add_owned_temporary(layout);
                for (std::uint32_t component = layout.width; component > 0; --component) {
                    Instruction store;
                    store.opcode = Opcode::StoreLocal;
                    store.index = temporary + component - 1;
                    builder.emit(std::move(store));
                }
                for (std::uint32_t component = 0; component < layout.width; ++component) {
                    Instruction load;
                    load.opcode = Opcode::LoadLocal;
                    load.index = temporary + component;
                    builder.emit(std::move(load));
                }
                owned_argument_temporaries.push_back({temporary, layout});
            }
            argument_count += layout.width;
        }
        Instruction instruction;
        instruction.opcode = Opcode::Call;
        instruction.argument_count = argument_count;
        instruction.result_count = signature->second.result.width;
        instruction.provided_parameter_mask = provided_parameter_mask;
        instruction.uses_parameter_mask = std::any_of(
            signature->second.parameter_defaults.begin(),
            signature->second.parameter_defaults.end(),
            [](const auto* value) { return value != nullptr; });
        instruction.symbol = symbol;
        instruction.may_error = signature->second.may_error;
        if (instruction.may_error) {
            if (const auto handler = builder.error_handler()) {
                instruction.has_error_handler = true;
                instruction.label = *handler;
                instruction.error_value_local = *builder.error_value_local();
                instruction.error_type_local = *builder.error_type_local();
            }
        }
        builder.emit(std::move(instruction));
        for (const auto& [temporary, layout] : owned_argument_temporaries) {
            emit_release_layout_local(builder, temporary, layout);
        }
        return signature->second.result;
    }
    throw LoweringFailure("unsupported machine IR expression " + kind);
}

inline bool lower_discarded_range_pipe(
    const vf::JsonValue::Object& expression,
    FunctionBuilder& builder,
    const FunctionSignatures& signatures,
    StringPool& strings
) {
    if (string_field(expression, "kind", "discarded expression") != "pipe_chain") {
        return false;
    }
    const auto preserved_range = expression.find("range_source");
    const auto& source_expression = object_of(
        preserved_range == expression.end()
            ? field(expression, "source", "discarded pipe expression")
            : preserved_range->second,
        "discarded pipe source");
    if (layout_from_expression_shape(source_expression, signatures).kind != ValueKind::Range) {
        return false;
    }

    if (!bool_field(source_expression, "infinite", "discarded range pipe source")) {
        const auto& start_expression = object_of(
            field(source_expression, "start", "discarded finite range pipe source"),
            "discarded finite range pipe start");
        const auto& inclusive_end_expression = object_of(
            field(source_expression, "end", "discarded finite range pipe source"),
            "discarded finite range pipe end");
        const vf::JsonValue::Object* loop_end_expression = &inclusive_end_expression;
        bool exclusive_end = false;
        if (string_field(
                inclusive_end_expression, "kind", "discarded finite range pipe end") ==
                "binary_op" &&
            string_field(
                inclusive_end_expression, "op", "discarded finite range pipe end") ==
                "MINUS") {
            const auto& right = object_of(
                field(inclusive_end_expression, "right", "discarded finite range pipe end"),
                "discarded finite range pipe end right");
            if (string_field(right, "kind", "discarded finite range pipe end right") == "const") {
                const auto& right_value = field(
                    right, "value", "discarded finite range pipe end right");
                if (right_value.is_number() && right_value.as_number() == 1.0) {
                    loop_end_expression = &object_of(
                        field(inclusive_end_expression, "left", "discarded finite range pipe end"),
                        "discarded finite range pipe exclusive end");
                    exclusive_end = true;
                }
            }
        }
        const bool integral_range =
            numeric_expression_is_integral(start_expression, builder) &&
            numeric_expression_is_integral(*loop_end_expression, builder);
        const auto cursor = builder.add_borrowed_temporary(
            {}, integral_range ? ValueClass::I64 : ValueClass::F64);
        const auto start_layout = lower_expression(
            start_expression, builder, signatures, strings);
        require_scalar(start_layout, "discarded finite range pipe start");
        emit_store_local_component(builder, cursor);
        const auto end = builder.add_borrowed_temporary(
            {}, integral_range ? ValueClass::I64 : ValueClass::F64);
        const std::string loop_end_kind = string_field(
            *loop_end_expression, "kind", "discarded finite range pipe end");
        const bool direct_exclusive_end = exclusive_end &&
            (loop_end_kind == "load" || loop_end_kind == "const");
        if (!direct_exclusive_end) {
            const auto end_layout = lower_expression(
                *loop_end_expression, builder, signatures, strings);
            require_scalar(end_layout, "discarded finite range pipe end");
            emit_store_local_component(builder, end);
        }
        const auto emit_ascending_end = [&]() {
            if (direct_exclusive_end) {
                const auto end_layout = lower_expression(
                    *loop_end_expression, builder, signatures, strings);
                require_scalar(end_layout, "discarded finite range pipe end");
            } else {
                emit_load_local_component(builder, end);
            }
        };
        const auto descending = builder.next_label();
        const auto ascending_loop = builder.next_label();
        const auto ascending_advance = builder.next_label();
        const auto descending_loop = builder.next_label();
        const auto descending_advance = builder.next_label();
        const auto finish = builder.next_label();

        builder.begin_scope();
        const auto& segments = array_of(
            field(expression, "segments", "discarded finite range pipe expression"),
            "discarded finite range pipe segments");
        const bool direct_cursor = segments.size() == 1u;
        std::uint32_t current = cursor;
        if (direct_cursor) {
            builder.add_scoped_alias("$", cursor);
        } else {
            current = builder.add_scoped_local("$", {}, false);
        }
        std::optional<std::string> cursor_alias;
        if (segments.size() == 1u) {
            const auto& segment = object_of(
                segments.front(), "discarded finite range pipe segment");
            if (string_field(
                    segment, "kind", "discarded finite range pipe segment") ==
                    "block_expr") {
                const auto& block_body = array_of(
                    field(segment, "body", "discarded finite range pipe block"),
                    "discarded finite range pipe block body");
                if (!block_body.empty()) {
                    const auto& first = object_of(
                        block_body.front(), "discarded finite range pipe alias");
                    const auto value = first.find("value");
                    const auto update = first.find("update");
                    if (string_field(
                            first, "kind", "discarded finite range pipe alias") ==
                            "store_binding" &&
                        value != first.end() && value->second.is_object() &&
                        string_field(
                            value->second.as_object(), "kind",
                            "discarded finite range pipe alias value") == "load" &&
                        string_field(
                            value->second.as_object(), "name",
                            "discarded finite range pipe alias value") == "$" &&
                        update != first.end() && update->second.is_boolean() &&
                        !update->second.as_boolean()) {
                        const std::string name = string_field(
                            first, "name", "discarded finite range pipe alias");
                        bool reassigned = false;
                        std::function<void(const vf::JsonValue&)> scan_updates =
                            [&](const vf::JsonValue& node) {
                                if (reassigned) return;
                                if (node.is_array()) {
                                    for (const auto& item : node.as_array()) {
                                        scan_updates(item);
                                    }
                                    return;
                                }
                                if (!node.is_object()) return;
                                const auto& candidate = node.as_object();
                                const auto candidate_kind = candidate.find("kind");
                                const auto candidate_name = candidate.find("name");
                                const auto candidate_update = candidate.find("update");
                                if (candidate_kind != candidate.end() &&
                                    candidate_kind->second.is_string() &&
                                    candidate_kind->second.as_string() == "store_binding" &&
                                    candidate_name != candidate.end() &&
                                    candidate_name->second.is_string() &&
                                    candidate_name->second.as_string() == name &&
                                    candidate_update != candidate.end() &&
                                    candidate_update->second.is_boolean() &&
                                    candidate_update->second.as_boolean()) {
                                    reassigned = true;
                                    return;
                                }
                                for (const auto& [key, child] : candidate) {
                                    (void)key;
                                    scan_updates(child);
                                }
                            };
                        for (std::size_t body_index = 1;
                             body_index < block_body.size(); ++body_index) {
                            scan_updates(block_body[body_index]);
                        }
                        if (!reassigned) {
                            cursor_alias = name;
                            builder.add_scoped_alias(name, current);
                        }
                    }
                }
            }
        }
        const auto emit_body = [&](const std::uint32_t advance) {
            builder.reset_flattened_index_cache();
            if (!direct_cursor) {
                emit_load_local_component(builder, cursor);
                emit_store_local_component(builder, current);
            }
            builder.push_loop(advance, finish);
            for (std::size_t index = 0; index < segments.size(); ++index) {
                const auto& segment = object_of(
                    segments[index], "discarded finite range pipe segment");
                if (index + 1u == segments.size() &&
                    string_field(
                        segment, "kind",
                        "discarded finite range pipe segment") == "block_expr") {
                    const auto& block_body = array_of(
                        field(segment, "body", "discarded finite range pipe block"),
                        "discarded finite range pipe block body");
                    vf::JsonValue::Array effects;
                    const std::size_t begin = cursor_alias ? 1u : 0u;
                    effects.reserve(block_body.size() - begin);
                    for (std::size_t body_index = begin;
                         body_index < block_body.size(); ++body_index) {
                        effects.push_back(block_body[body_index]);
                    }
                    builder.begin_scope();
                    for (const auto& effect : effects) {
                        const auto& effect_statement = object_of(
                            effect, "discarded finite range pipe block effect");
                        const auto effect_kind = string_field(
                            effect_statement, "kind",
                            "discarded finite range pipe block effect");
                        if (effect_kind == "store_binding") {
                            const auto update = effect_statement.find("update");
                            const bool is_update =
                                update != effect_statement.end() &&
                                update->second.is_boolean() &&
                                update->second.as_boolean();
                            if (!is_update) {
                                const std::string name = string_field(
                                    effect_statement, "name",
                                    "discarded finite range pipe binding");
                                const auto& value = object_of(
                                    field(
                                        effect_statement, "value",
                                        "discarded finite range pipe binding"),
                                    "discarded finite range pipe binding value");
                                auto layout =
                                    string_field(
                                        value, "kind",
                                        "discarded finite range pipe binding value") == "load"
                                    ? builder.layout(string_field(
                                        value, "name",
                                        "discarded finite range pipe binding value"))
                                    : layout_from_expression_shape(value, signatures);
                                const auto declared = effect_statement.find("type");
                                if (declared != effect_statement.end() &&
                                    declared->second.is_string()) {
                                    const auto declared_layout = layout_from_type(
                                        declared->second.as_string(), &signatures);
                                    if (declared_layout.width > layout.width) {
                                        layout = declared_layout;
                                    }
                                }
                                builder.add_scoped_local(
                                    name, layout, true,
                                    scalar_value_class_from_type(
                                        string_field(
                                            effect_statement, "type",
                                            "discarded finite range pipe binding"),
                                        layout));
                            }
                        }
                        vf::JsonValue::Array one_effect;
                        one_effect.push_back(effect);
                        lower_statements(
                            one_effect, builder, false, signatures, strings);
                    }
                    const auto scoped_locals = builder.end_scope();
                    for (const auto& local : scoped_locals) {
                        emit_release_layout_local(
                            builder, local.base, local.layout);
                    }
                    continue;
                }
                if (index + 1u == segments.size() &&
                    string_field(segment, "kind", "discarded finite range pipe segment") ==
                        "block_expr") {
                    const auto& block_body = array_of(
                        field(segment, "body", "discarded finite range pipe block"),
                        "discarded finite range pipe block body");
                    if (!block_body.empty()) {
                        const auto& tail = object_of(
                            block_body.back(), "discarded finite range pipe block tail");
                        if (string_field(tail, "kind", "discarded finite range pipe block tail") ==
                                "expr_stmt") {
                            const auto& tail_expression = object_of(
                                field(tail, "expr", "discarded finite range pipe block tail"),
                                "discarded finite range pipe block tail expression");
                            if (string_field(
                                    tail_expression, "kind",
                                    "discarded finite range pipe block tail expression") ==
                                    "load") {
                                const std::string result_name = string_field(
                                    tail_expression, "name",
                                    "discarded finite range pipe block tail expression");
                                vf::JsonValue::Array effects;
                                effects.reserve(block_body.size() - 1u);
                                for (std::size_t body_index = cursor_alias ? 1u : 0u;
                                     body_index + 1u < block_body.size(); ++body_index) {
                                    vf::JsonValue effect = block_body[body_index];
                                    auto& effect_object = effect.as_object();
                                    const auto value = effect_object.find("value");
                                    if (value != effect_object.end() && value->second.is_object()) {
                                        const auto& value_object = value->second.as_object();
                                        if (string_field(
                                                value_object, "kind",
                                                "discarded finite range pipe assignment") ==
                                                "bind_expr" &&
                                            string_field(
                                                value_object, "name",
                                                "discarded finite range pipe assignment") ==
                                                result_name) {
                                            vf::JsonValue unwrapped_value = field(
                                                value_object, "value",
                                                "discarded finite range pipe assignment");
                                            effect_object["value"] = std::move(unwrapped_value);
                                        }
                                    }
                                    effects.emplace_back(std::move(effect));
                                }
                                lower_statements(
                                    effects, builder, false, signatures, strings);
                                continue;
                            }
                        }
                    }
                }
                vf::JsonValue lowered_segment = segments[index];
                if (cursor_alias &&
                    string_field(
                        lowered_segment.as_object(), "kind",
                        "discarded finite range pipe segment") == "block_expr") {
                    auto& body = lowered_segment.as_object().at("body").as_array();
                    body.erase(body.begin());
                }
                const auto segment_layout = lower_expression(
                    lowered_segment.as_object(), builder, signatures, strings);
                if (index + 1u < segments.size()) {
                    require_scalar(segment_layout, "discarded finite range pipe segment");
                    emit_store_local_component(builder, current);
                } else {
                    emit_discard_value(builder, segment_layout);
                }
            }
            builder.pop_loop();
        };

        const auto start_interval = numeric_interval_of(start_expression, builder);
        const auto end_interval = numeric_interval_of(*loop_end_expression, builder);
        const bool known_ascending = start_interval && end_interval &&
            start_interval->second <= end_interval->first;
        if (known_ascending) {
            builder.set_numeric_interval(
                cursor,
                start_interval->first,
                end_interval->second - (exclusive_end ? 1.0 : 0.0));
            Instruction ascending_label;
            ascending_label.opcode = Opcode::Label;
            ascending_label.label = ascending_loop;
            builder.emit(std::move(ascending_label));
            emit_load_local_component(builder, cursor);
            emit_ascending_end();
            builder.emit({
                exclusive_end ? Opcode::OrderedLessF64 : Opcode::OrderedLessEqualF64});
            Instruction ascending_done;
            ascending_done.opcode = Opcode::JumpIfFalse;
            ascending_done.label = finish;
            builder.emit(std::move(ascending_done));
            emit_body(ascending_advance);
            Instruction ascending_advance_label;
            ascending_advance_label.opcode = Opcode::Label;
            ascending_advance_label.label = ascending_advance;
            builder.emit(std::move(ascending_advance_label));
            emit_load_local_component(builder, cursor);
            Instruction one;
            one.opcode = Opcode::PushF64;
            one.f64 = 1.0;
            builder.emit(std::move(one));
            builder.emit({Opcode::AddF64});
            emit_store_local_component(builder, cursor);
            Instruction repeat;
            repeat.opcode = Opcode::Jump;
            repeat.label = ascending_loop;
            builder.emit(std::move(repeat));
            Instruction finish_label;
            finish_label.opcode = Opcode::Label;
            finish_label.label = finish;
            builder.emit(std::move(finish_label));
            builder.end_scope();
            return true;
        }

        emit_load_local_component(builder, cursor);
        emit_ascending_end();
        builder.emit({exclusive_end ? Opcode::OrderedLessF64 : Opcode::OrderedLessEqualF64});
        Instruction choose_descending;
        choose_descending.opcode = Opcode::JumpIfFalse;
        choose_descending.label = descending;
        builder.emit(std::move(choose_descending));

        Instruction ascending_label;
        ascending_label.opcode = Opcode::Label;
        ascending_label.label = ascending_loop;
        builder.emit(std::move(ascending_label));
        emit_load_local_component(builder, cursor);
        emit_ascending_end();
        builder.emit({exclusive_end ? Opcode::OrderedLessF64 : Opcode::OrderedLessEqualF64});
        Instruction ascending_done;
        ascending_done.opcode = Opcode::JumpIfFalse;
        ascending_done.label = finish;
        builder.emit(std::move(ascending_done));
        emit_body(ascending_advance);
        Instruction ascending_advance_label;
        ascending_advance_label.opcode = Opcode::Label;
        ascending_advance_label.label = ascending_advance;
        builder.emit(std::move(ascending_advance_label));
        emit_load_local_component(builder, cursor);
        Instruction one;
        one.opcode = Opcode::PushF64;
        one.f64 = 1.0;
        builder.emit(std::move(one));
        builder.emit({Opcode::AddF64});
        emit_store_local_component(builder, cursor);
        Instruction repeat_ascending;
        repeat_ascending.opcode = Opcode::Jump;
        repeat_ascending.label = ascending_loop;
        builder.emit(std::move(repeat_ascending));

        Instruction descending_label;
        descending_label.opcode = Opcode::Label;
        descending_label.label = descending;
        builder.emit(std::move(descending_label));
        if (exclusive_end) {
            if (direct_exclusive_end) {
                const auto end_layout = lower_expression(
                    *loop_end_expression, builder, signatures, strings);
                require_scalar(end_layout, "discarded finite range pipe descending end");
            } else {
                emit_load_local_component(builder, end);
            }
            Instruction one;
            one.opcode = Opcode::PushF64;
            one.f64 = 1.0;
            builder.emit(std::move(one));
            builder.emit({Opcode::SubtractF64});
            emit_store_local_component(builder, end);
        }
        Instruction descending_loop_label;
        descending_loop_label.opcode = Opcode::Label;
        descending_loop_label.label = descending_loop;
        builder.emit(std::move(descending_loop_label));
        emit_load_local_component(builder, cursor);
        emit_load_local_component(builder, end);
        builder.emit({Opcode::OrderedGreaterEqualF64});
        Instruction descending_done;
        descending_done.opcode = Opcode::JumpIfFalse;
        descending_done.label = finish;
        builder.emit(std::move(descending_done));
        emit_body(descending_advance);
        Instruction descending_advance_label;
        descending_advance_label.opcode = Opcode::Label;
        descending_advance_label.label = descending_advance;
        builder.emit(std::move(descending_advance_label));
        emit_load_local_component(builder, cursor);
        Instruction minus_one;
        minus_one.opcode = Opcode::PushF64;
        minus_one.f64 = -1.0;
        builder.emit(std::move(minus_one));
        builder.emit({Opcode::AddF64});
        emit_store_local_component(builder, cursor);
        Instruction repeat_descending;
        repeat_descending.opcode = Opcode::Jump;
        repeat_descending.label = descending_loop;
        builder.emit(std::move(repeat_descending));

        Instruction finish_label;
        finish_label.opcode = Opcode::Label;
        finish_label.label = finish;
        builder.emit(std::move(finish_label));
        builder.end_scope();
        return true;
    }
    const auto source = lower_expression(source_expression, builder, signatures, strings);
    if (source.kind != ValueKind::Range) {
        throw LoweringFailure("discarded range pipe source layout mismatch");
    }
    const auto source_local = builder.add_borrowed_temporary(source);
    emit_store_local_component(builder, source_local + 2u);
    emit_store_local_component(builder, source_local + 1u);
    emit_store_local_component(builder, source_local);
    const auto cursor = builder.add_borrowed_temporary({});
    emit_load_local_component(builder, source_local);
    emit_store_local_component(builder, cursor);
    const auto step = builder.add_borrowed_temporary({});
    const auto finite_step = builder.next_label();
    const auto descending = builder.next_label();
    const auto step_ready = builder.next_label();
    emit_load_local_component(builder, source_local + 2u);
    Instruction choose_finite_step;
    choose_finite_step.opcode = Opcode::JumpIfFalse;
    choose_finite_step.label = finite_step;
    builder.emit(std::move(choose_finite_step));
    Instruction one;
    one.opcode = Opcode::PushF64;
    one.f64 = 1.0;
    builder.emit(std::move(one));
    emit_store_local_component(builder, step);
    Instruction skip_finite_step;
    skip_finite_step.opcode = Opcode::Jump;
    skip_finite_step.label = step_ready;
    builder.emit(std::move(skip_finite_step));
    Instruction finite_step_label;
    finite_step_label.opcode = Opcode::Label;
    finite_step_label.label = finite_step;
    builder.emit(std::move(finite_step_label));
    emit_load_local_component(builder, source_local);
    emit_load_local_component(builder, source_local + 1u);
    builder.emit({Opcode::OrderedLessEqualF64});
    Instruction choose_descending;
    choose_descending.opcode = Opcode::JumpIfFalse;
    choose_descending.label = descending;
    builder.emit(std::move(choose_descending));
    Instruction ascending_one;
    ascending_one.opcode = Opcode::PushF64;
    ascending_one.f64 = 1.0;
    builder.emit(std::move(ascending_one));
    emit_store_local_component(builder, step);
    Instruction skip_descending;
    skip_descending.opcode = Opcode::Jump;
    skip_descending.label = step_ready;
    builder.emit(std::move(skip_descending));
    Instruction descending_label;
    descending_label.opcode = Opcode::Label;
    descending_label.label = descending;
    builder.emit(std::move(descending_label));
    Instruction minus_one;
    minus_one.opcode = Opcode::PushF64;
    minus_one.f64 = -1.0;
    builder.emit(std::move(minus_one));
    emit_store_local_component(builder, step);
    Instruction step_ready_label;
    step_ready_label.opcode = Opcode::Label;
    step_ready_label.label = step_ready;
    builder.emit(std::move(step_ready_label));

    builder.begin_scope();
    const auto current = builder.add_scoped_local("$", {}, false);
    const auto loop = builder.next_label();
    const auto descending_check = builder.next_label();
    const auto finite_check = builder.next_label();
    const auto condition_ready = builder.next_label();
    const auto advance = builder.next_label();
    const auto finish = builder.next_label();
    const auto condition = builder.add_borrowed_temporary({});
    Instruction loop_label;
    loop_label.opcode = Opcode::Label;
    loop_label.label = loop;
    builder.emit(std::move(loop_label));
    emit_load_local_component(builder, source_local + 2u);
    Instruction use_finite_check;
    use_finite_check.opcode = Opcode::JumpIfFalse;
    use_finite_check.label = finite_check;
    builder.emit(std::move(use_finite_check));
    Instruction infinite_truth;
    infinite_truth.opcode = Opcode::PushF64;
    infinite_truth.f64 = 1.0;
    builder.emit(std::move(infinite_truth));
    emit_store_local_component(builder, condition);
    Instruction infinite_condition_done;
    infinite_condition_done.opcode = Opcode::Jump;
    infinite_condition_done.label = condition_ready;
    builder.emit(std::move(infinite_condition_done));
    Instruction finite_check_label;
    finite_check_label.opcode = Opcode::Label;
    finite_check_label.label = finite_check;
    builder.emit(std::move(finite_check_label));
    emit_load_local_component(builder, step);
    Instruction zero;
    zero.opcode = Opcode::PushF64;
    zero.f64 = 0.0;
    builder.emit(std::move(zero));
    builder.emit({Opcode::OrderedGreaterEqualF64});
    Instruction use_descending;
    use_descending.opcode = Opcode::JumpIfFalse;
    use_descending.label = descending_check;
    builder.emit(std::move(use_descending));
    emit_load_local_component(builder, cursor);
    emit_load_local_component(builder, source_local + 1u);
    builder.emit({Opcode::OrderedLessEqualF64});
    emit_store_local_component(builder, condition);
    Instruction condition_done;
    condition_done.opcode = Opcode::Jump;
    condition_done.label = condition_ready;
    builder.emit(std::move(condition_done));
    Instruction descending_check_label;
    descending_check_label.opcode = Opcode::Label;
    descending_check_label.label = descending_check;
    builder.emit(std::move(descending_check_label));
    emit_load_local_component(builder, cursor);
    emit_load_local_component(builder, source_local + 1u);
    builder.emit({Opcode::OrderedGreaterEqualF64});
    emit_store_local_component(builder, condition);
    Instruction condition_label;
    condition_label.opcode = Opcode::Label;
    condition_label.label = condition_ready;
    builder.emit(std::move(condition_label));
    emit_load_local_component(builder, condition);
    Instruction done;
    done.opcode = Opcode::JumpIfFalse;
    done.label = finish;
    builder.emit(std::move(done));
    emit_load_local_component(builder, cursor);
    emit_store_local_component(builder, current);

    const auto& segments = array_of(
        field(expression, "segments", "discarded range pipe expression"),
        "discarded range pipe segments");
    builder.push_loop(advance, finish);
    for (std::size_t index = 0; index < segments.size(); ++index) {
        const auto segment_layout = lower_expression(
            object_of(segments[index], "discarded range pipe segment"),
            builder, signatures, strings);
        if (index + 1u < segments.size()) {
            require_scalar(segment_layout, "discarded range pipe segment");
            emit_store_local_component(builder, current);
        } else {
            emit_discard_value(builder, segment_layout);
        }
    }
    builder.pop_loop();
    Instruction advance_label;
    advance_label.opcode = Opcode::Label;
    advance_label.label = advance;
    builder.emit(std::move(advance_label));
    emit_load_local_component(builder, cursor);
    emit_load_local_component(builder, step);
    builder.emit({Opcode::AddF64});
    emit_store_local_component(builder, cursor);
    Instruction repeat;
    repeat.opcode = Opcode::Jump;
    repeat.label = loop;
    builder.emit(std::move(repeat));
    Instruction finish_label;
    finish_label.opcode = Opcode::Label;
    finish_label.label = finish;
    builder.emit(std::move(finish_label));
    builder.end_scope();
    return true;
}

inline void lower_statements(
    const vf::JsonValue::Array& body,
    FunctionBuilder& builder,
    bool function_tail,
    const FunctionSignatures& signatures,
    StringPool& strings,
    const DisplayEnvironment* display_environment,
    const FunctionDisplayShapes* function_displays,
    const ValueLayout* function_result_layout
) {
    for (std::size_t index = 0; index < body.size(); ++index) {
        const auto& statement = object_of(body[index], "statement");
        const std::string kind = string_field(statement, "kind", "statement");
        if (kind == "store_binding") {
            const std::string binding_name = string_field(statement, "name", "binding");
            const auto& value = object_of(field(statement, "value", "binding"), "binding value");
            const auto layout = lower_expression(value, builder, signatures, strings);
            ensure_independent_value(value, layout, builder, signatures);
            const auto update = statement.find("update");
            const bool alias_update = update != statement.end() && update->second.is_boolean() &&
                update->second.as_boolean() && layout.kind == ValueKind::Aggregate &&
                !has_owned_resources(layout);
            if (alias_update) {
                const auto temporary = builder.add_borrowed_temporary(layout);
                for (std::uint32_t component = layout.width; component > 0; --component) {
                    Instruction store;
                    store.opcode = Opcode::StoreLocal;
                    store.index = temporary + component - 1;
                    builder.emit(std::move(store));
                }
                for (const auto& target : builder.alias_group(binding_name)) {
                    const auto& target_layout = builder.layout(target);
                    if (target_layout.width != layout.width || target_layout.kind != layout.kind) continue;
                    for (std::uint32_t component = 0; component < layout.width; ++component) {
                        Instruction load;
                        load.opcode = Opcode::LoadLocal;
                        load.index = temporary + component;
                        builder.emit(std::move(load));
                    }
                    emit_store_binding(builder, target, layout, strings);
                }
                continue;
            }
            builder.detach_alias(binding_name);
            emit_release_layout_local(
                builder, builder.slot(binding_name), builder.layout(binding_name));
            emit_store_binding(builder, string_field(statement, "name", "binding"), layout, strings);
            if (string_field(value, "kind", "binding value") == "load" &&
                layout.kind == ValueKind::Aggregate && !has_owned_resources(layout)) {
                const std::string source = string_field(value, "name", "binding alias source");
                if (source != binding_name && builder.find_layout(source)) {
                    builder.link_alias(binding_name, source);
                }
            }
        } else if (kind == "spill_stmt") {
            const auto& spill_expression = object_of(
                field(statement, "value", "spill statement"), "spill value");
            const auto layout = lower_expression(
                spill_expression, builder, signatures, strings);
            if (!is_record_layout(layout)) {
                throw LoweringFailure("machine IR spill requires a record value");
            }
            ensure_independent_value(spill_expression, layout, builder, signatures);
            std::vector<std::pair<std::string, ValueSlice>> fields;
            for (const auto& [field_name, slice] : layout.selectors) {
                if (field_name.find('.') == std::string::npos) fields.push_back({field_name, slice});
            }
            std::stable_sort(fields.begin(), fields.end(), [](const auto& left, const auto& right) {
                return left.second.offset < right.second.offset;
            });
            for (auto field_value = fields.rbegin(); field_value != fields.rend(); ++field_value) {
                const auto field_layout = record_field_layout(
                    layout, field_value->first, field_value->second);
                emit_release_layout_local(
                    builder, builder.slot(field_value->first), builder.layout(field_value->first));
                for (std::uint32_t component = field_layout.width; component > 0; --component) {
                    Instruction store;
                    store.opcode = Opcode::StoreLocal;
                    store.index = builder.slot(field_value->first, component - 1);
                    builder.emit(std::move(store));
                }
            }
        } else if (kind == "update_attr" || kind == "update_index") {
            const std::string binding_name = string_field(statement, "base_name", "update");
            const auto& binding_layout = builder.layout(binding_name);
            if (kind == "update_index" && binding_layout.kind == ValueKind::Aggregate &&
                is_numeric_layout(binding_layout)) {
                const auto& indices = array_of(field(statement, "indices", "index update"), "index update");
                std::size_t expanded_index_count = 0;
                for (const auto& raw_index : indices) {
                    const auto& index_expression = object_of(
                        raw_index, "multidimensional update index");
                    if (string_field(
                            index_expression, "kind", "multidimensional update index") ==
                        "spread_index") {
                        const auto& count = field(
                            index_expression, "count", "multidimensional update index spill");
                        if (!count.is_number()) {
                            throw LoweringFailure(
                                "multidimensional update index spill requires a numeric width");
                        }
                        expanded_index_count += static_cast<std::size_t>(count.as_number());
                    } else {
                        ++expanded_index_count;
                    }
                }
                std::size_t binding_rank = 0;
                ValueLayout rank_element = binding_layout;
                while (rank_element.kind == ValueKind::Aggregate) {
                    const auto rank_elements = indexed_element_layouts(rank_element);
                    if (rank_elements.empty() || std::any_of(
                            rank_elements.begin(), rank_elements.end(), [&](const auto& candidate) {
                                return !same_layout(candidate, rank_elements.front());
                            })) {
                        break;
                    }
                    ++binding_rank;
                    rank_element = rank_elements.front();
                }
                if (binding_rank > 1 && expanded_index_count == binding_rank) {
                    std::vector<std::uint32_t> dimensions;
                    ValueLayout element = binding_layout;
                    while (element.kind == ValueKind::Aggregate) {
                        const auto elements = indexed_element_layouts(element);
                        if (elements.empty() || std::any_of(
                                elements.begin(), elements.end(), [&](const auto& candidate) {
                                    return !same_layout(candidate, elements.front());
                                })) {
                            throw LoweringFailure(
                                "dynamic multidimensional update requires a rectangular vector");
                        }
                        dimensions.push_back(static_cast<std::uint32_t>(elements.size()));
                        element = elements.front();
                    }
                    if (dimensions.size() != expanded_index_count ||
                        element.kind != ValueKind::Numeric || element.width != 1) {
                        throw LoweringFailure(
                            "dynamic multidimensional update rank must match a numeric vector: rank " +
                            std::to_string(dimensions.size()) + ", indices " +
                            std::to_string(expanded_index_count) + ", layout " +
                            describe_layout(binding_layout));
                    }
                    std::vector<std::uint32_t> index_locals;
                    std::vector<std::uint32_t> index_widths;
                    index_locals.reserve(indices.size());
                    index_widths.reserve(indices.size());
                    std::optional<ValueLayout> broadcast_layout;
                    bool integral = true;
                    for (const auto& raw_index : indices) {
                        const auto& index_expression = object_of(raw_index, "multidimensional update index");
                        if (string_field(
                                index_expression, "kind", "multidimensional update index") ==
                            "spread_index") {
                            const auto& spread_value = object_of(
                                field(index_expression, "value", "multidimensional update index spill"),
                                "multidimensional update index spill");
                            const auto spread_layout = lower_expression(
                                spread_value, builder, signatures, strings);
                            if (spread_layout.kind != ValueKind::Aggregate ||
                                !is_numeric_layout(spread_layout)) {
                                throw LoweringFailure(
                                    "multidimensional update index spill requires a fixed numeric vector");
                            }
                            const auto& count_value = field(
                                index_expression, "count", "multidimensional update index spill");
                            const auto count = static_cast<std::uint32_t>(
                                count_value.as_number());
                            if (spread_layout.width != count) {
                                throw LoweringFailure(
                                    "multidimensional update index spill width does not match its type");
                            }
                            const auto local = builder.add_borrowed_temporary(spread_layout);
                            for (std::uint32_t component = spread_layout.width; component > 0; --component) {
                                emit_store_local_component(builder, local + component - 1u);
                            }
                            for (std::uint32_t component = 0; component < count; ++component) {
                                index_locals.push_back(local + component);
                                index_widths.push_back(1u);
                            }
                            integral = false;
                            continue;
                        }
                        auto layout = lower_expression(
                            index_expression, builder, signatures, strings);
                        if (layout.width > 1) {
                            if (layout.kind != ValueKind::Aggregate || !is_numeric_layout(layout)) {
                                throw LoweringFailure(
                                    "distributed multidimensional update requires fixed numeric index vectors");
                            }
                            if (broadcast_layout.has_value() &&
                                !same_layout(*broadcast_layout, layout)) {
                                throw LoweringFailure(
                                    "distributed multidimensional update indices must have matching shapes");
                            }
                            broadcast_layout = layout;
                        } else {
                            layout = emit_require_real_complex(
                                builder, strings, layout, "index must be int or str");
                            require_scalar(layout, "multidimensional vector update index");
                        }
                        const auto local = builder.add_borrowed_temporary(layout);
                        for (std::uint32_t component = layout.width; component > 0; --component) {
                            emit_store_local_component(builder, local + component - 1u);
                        }
                        index_locals.push_back(local);
                        index_widths.push_back(layout.width);
                        const auto type = index_expression.find("type");
                        integral = integral &&
                            ((type != index_expression.end() && type->second.is_string() &&
                              type->second.as_string() == "int") || builder.local_is_integral(local));
                    }
                    const auto& value_expression = object_of(
                        field(statement, "value", "multidimensional vector update"),
                        "multidimensional vector update value");
                    const auto value_layout = lower_expression(
                        value_expression, builder, signatures, strings);
                    if (broadcast_layout.has_value()) {
                        if (!same_layout(value_layout, *broadcast_layout) ||
                            !is_numeric_layout(value_layout)) {
                            throw LoweringFailure(
                                "distributed multidimensional update values must match the index vector shape");
                        }
                    } else {
                        require_scalar(value_layout, "multidimensional vector update value");
                    }
                    const auto value_local = builder.add_borrowed_temporary(value_layout);
                    for (std::uint32_t component = value_layout.width; component > 0; --component) {
                        emit_store_local_component(builder, value_local + component - 1u);
                    }
                    const std::uint32_t lanes = broadcast_layout.has_value()
                        ? broadcast_layout->width : 1u;
                    for (std::uint32_t lane = 0; lane < lanes; ++lane) {
                        emit_load_local_component(
                            builder,
                            index_locals.front() + (index_widths.front() > 1 ? lane : 0u));
                        for (std::size_t index = 1; index < index_locals.size(); ++index) {
                            emit_push_f64(builder, static_cast<double>(dimensions[index]));
                            builder.emit({Opcode::MultiplyF64});
                            emit_load_local_component(
                                builder,
                                index_locals[index] + (index_widths[index] > 1 ? lane : 0u));
                            builder.emit({Opcode::AddF64});
                        }
                        const auto flattened = builder.add_borrowed_temporary(
                            {}, integral ? ValueClass::I64 : ValueClass::F64);
                        emit_store_local_component(builder, flattened);
                        emit_load_local_component(builder, flattened);
                        emit_load_local_component(builder, value_local + lane);
                        Instruction update;
                        update.opcode = Opcode::StoreF64LocalsIndex;
                        update.index = builder.slot(binding_name);
                        update.argument_count = binding_layout.width;
                        update.index_is_integral = integral;
                        update.index_local = flattened;
                        update.may_error = true;
                        const std::string message = "vector index out of range";
                        update.error_message_offset = strings.intern(message);
                        update.byte_count = static_cast<std::uint32_t>(message.size());
                        if (const auto handler = builder.error_handler()) {
                            update.has_error_handler = true;
                            update.label = *handler;
                            update.error_value_local = *builder.error_value_local();
                            update.error_type_local = *builder.error_type_local();
                        }
                        builder.emit(std::move(update));
                    }
                    continue;
                }
                const bool dynamic_index = indices.size() == 1 && indices.front().is_object() &&
                    object_of(indices.front(), "fixed update index").find("value") ==
                        object_of(indices.front(), "fixed update index").end();
                if (dynamic_index) {
                    const auto& index_expression = object_of(indices.front(), "fixed update index");
                    const std::optional<std::uint32_t> known_index_local =
                        string_field(
                            index_expression, "kind", "fixed update index") == "load"
                        ? std::optional<std::uint32_t>(builder.slot(string_field(
                            index_expression, "name", "fixed update index")))
                        : std::nullopt;
                    const auto index_layout = known_index_local
                        ? builder.layout(string_field(
                            index_expression, "name", "fixed update index"))
                        : lower_expression(
                            index_expression, builder, signatures, strings);
                    require_scalar(index_layout, "fixed vector update index");
                    const auto elements = indexed_element_layouts(binding_layout);
                    if (elements.empty() ||
                        std::any_of(elements.begin(), elements.end(), [&](const auto& element) {
                            return !same_layout(element, elements.front());
                        })) {
                        throw LoweringFailure(
                            "dynamic fixed vector update requires one uniform element layout");
                    }
                    const auto& value_expression = object_of(
                        field(statement, "value", "fixed vector update"),
                        "fixed vector update value");
                    const auto index_type = index_expression.find("type");
                    const bool index_is_integral =
                        (index_type != index_expression.end() &&
                         index_type->second.is_string() && index_type->second.as_string() == "int") ||
                        (known_index_local && builder.local_is_integral(*known_index_local));
                    const bool index_is_proven = known_index_local && fixed_index_proven(
                        builder, *known_index_local,
                        static_cast<std::uint32_t>(elements.size()),
                        index_is_integral);
                    const std::string message = "vector index out of range";
                    if (elements.front().width == 1u) {
                        if (known_index_local) {
                            emit_load_local_component(builder, *known_index_local);
                        }
                        const auto value_layout = lower_expression(
                            value_expression, builder, signatures, strings);
                        if (!same_layout(value_layout, elements.front())) {
                            throw LoweringFailure("fixed vector update value layout mismatch");
                        }
                        ensure_independent_value(
                            value_expression, value_layout, builder, signatures);
                        Instruction update;
                        update.opcode = Opcode::StoreF64LocalsIndex;
                        update.index = builder.slot(binding_name);
                        update.argument_count = binding_layout.width;
                        update.index_is_integral = index_is_integral;
                        update.index_local = known_index_local;
                        update.may_error = !index_is_proven;
                        if (update.may_error) {
                            update.error_message_offset = strings.intern(message);
                            update.byte_count = static_cast<std::uint32_t>(message.size());
                            if (const auto handler = builder.error_handler()) {
                                update.has_error_handler = true;
                                update.label = *handler;
                                update.error_value_local = *builder.error_value_local();
                                update.error_type_local = *builder.error_type_local();
                            }
                        }
                        builder.emit(std::move(update));
                        continue;
                    }
                    const auto index_local = known_index_local.value_or(
                        builder.add_borrowed_temporary(index_layout));
                    if (!known_index_local) {
                        emit_store_local_component(builder, index_local);
                    }
                    const auto direct_index_local = index_local;
                    const auto value_layout = layout_from_expression_shape(
                        value_expression, signatures);
                    if (!same_layout(value_layout, elements.front())) {
                        throw LoweringFailure("fixed vector update value layout mismatch");
                    }
                    prepare_numeric_component_expression(
                        value_expression, builder, signatures, strings);
                    if (value_layout.width > 1u && !index_is_proven) {
                        emit_load_local_component(builder, index_local);
                        Instruction validate;
                        validate.opcode = Opcode::LoadF64LocalsIndex;
                        validate.index = builder.slot(binding_name);
                        validate.argument_count = static_cast<std::uint32_t>(elements.size());
                        validate.index_is_integral = index_is_integral;
                        validate.index_local = direct_index_local;
                        validate.may_error = true;
                        validate.error_message_offset = strings.intern(message);
                        validate.byte_count = static_cast<std::uint32_t>(message.size());
                        if (const auto handler = builder.error_handler()) {
                            validate.has_error_handler = true;
                            validate.label = *handler;
                            validate.error_value_local = *builder.error_value_local();
                            validate.error_type_local = *builder.error_type_local();
                        }
                        builder.emit(std::move(validate));
                        builder.emit({Opcode::Drop});
                    }
                    const auto [component_index_local, initialize_component_index] =
                        builder.flattened_index_local(
                            direct_index_local, value_layout.width);
                    if (initialize_component_index) {
                        emit_load_local_component(builder, index_local);
                        Instruction width;
                        width.opcode = Opcode::PushF64;
                        width.f64 = static_cast<double>(value_layout.width);
                        builder.emit(std::move(width));
                        builder.emit({Opcode::MultiplyF64});
                        emit_store_local_component(builder, component_index_local);
                    }
                    for (std::uint32_t component = 0; component < value_layout.width; ++component) {
                        emit_load_local_component(builder, component_index_local);
                        if (!lower_numeric_component(
                                value_expression, component,
                                builder, signatures, strings)) {
                            throw LoweringFailure(
                                "component-wise fixed vector update lowering failed");
                        }
                        Instruction update;
                        update.opcode = Opcode::StoreF64LocalsIndex;
                        update.index = builder.slot(binding_name, component);
                        update.argument_count = binding_layout.width - component;
                        update.index_is_integral = value_layout.width > 1u || index_is_integral;
                        update.index_local = component_index_local;
                        update.may_error = false;
                        builder.emit(std::move(update));
                    }
                    continue;
                }
            }
            if (kind == "update_index" && binding_layout.kind == ValueKind::DynamicF64List) {
                const auto& indices = array_of(field(statement, "indices", "index update"), "index update");
                if (indices.size() > 1) {
                    const auto& value = object_of(
                        field(statement, "value", "list update"), "list update value");
                    const auto value_layout = lower_expression(
                        value, builder, signatures, strings);
                    const auto elements = indexed_element_layouts(value_layout);
                    if (elements.size() != indices.size() ||
                        std::any_of(elements.begin(), elements.end(), [](const auto& element) {
                            return element.width != 1;
                        })) {
                        throw LoweringFailure(
                            "multi-index dynamic list update requires one scalar value per index");
                    }
                    const auto temporary = builder.add_borrowed_temporary(value_layout);
                    for (std::uint32_t component = value_layout.width; component > 0; --component) {
                        emit_store_local_component(builder, temporary + component - 1u);
                    }
                    for (std::size_t item = 0; item < indices.size(); ++item) {
                        const auto index_layout = lower_expression(
                            object_of(indices[item], "list update index"), builder, signatures, strings);
                        require_scalar(index_layout, "dynamic list update index");
                        emit_load_local_component(builder, temporary + static_cast<std::uint32_t>(item));
                        Instruction update;
                        update.opcode = Opcode::StoreF64ListIndex;
                        update.index = builder.slot(binding_name);
                        const std::string message = "list index out of range";
                        update.may_error = true;
                        update.error_message_offset = strings.intern(message);
                        update.byte_count = static_cast<std::uint32_t>(message.size());
                        builder.emit(std::move(update));
                    }
                    continue;
                }
                if (indices.size() != 1) {
                    throw LoweringFailure("dynamic list update requires one index");
                }
                const auto index_layout = lower_expression(
                    object_of(indices.front(), "list update index"), builder, signatures, strings);
                require_scalar(index_layout, "dynamic list update index");
                const auto value_layout = lower_expression(
                    object_of(field(statement, "value", "list update"), "list update value"),
                    builder, signatures, strings);
                require_scalar(value_layout, "dynamic list update value");
                Instruction update;
                update.opcode = Opcode::StoreF64ListIndex;
                update.index = builder.slot(binding_name);
                const std::string message = "list index out of range";
                update.may_error = true;
                update.error_message_offset = strings.intern(message);
                update.byte_count = static_cast<std::uint32_t>(message.size());
                if (const auto handler = builder.error_handler()) {
                    update.has_error_handler = true;
                    update.label = *handler;
                    update.error_value_local = *builder.error_value_local();
                    update.error_type_local = *builder.error_type_local();
                }
                builder.emit(std::move(update));
                continue;
            }

            std::string path;
            if (kind == "update_attr") {
                path = string_field(statement, "field", "attribute update");
            } else {
                const auto& indices = array_of(field(statement, "indices", "index update"), "index update");
                if (indices.size() > 1) {
                    std::vector<std::pair<std::string, ValueLayout>> selected_layouts;
                    for (const auto& raw_index : indices) {
                        const auto& index = object_of(raw_index, "fixed update index");
                        const auto& raw = field(index, "value", "fixed update index");
                        if (!raw.is_number() || raw.as_number() < 0 ||
                            raw.as_number() != static_cast<double>(
                                static_cast<std::uint32_t>(raw.as_number()))) {
                            throw LoweringFailure(
                                "fixed container update index must be a nonnegative integer constant");
                        }
                        const std::string key = std::to_string(
                            static_cast<std::uint32_t>(raw.as_number()));
                        const auto selected = binding_layout.selectors.find(key);
                        if (selected == binding_layout.selectors.end()) {
                            throw LoweringFailure("unknown machine IR update projection " + key);
                        }
                        selected_layouts.push_back({
                            key, projected_layout(binding_layout, key, selected->second)});
                    }
                    std::vector<ValueLayout> expected_elements;
                    for (const auto& selected : selected_layouts) {
                        expected_elements.push_back(selected.second);
                    }
                    const auto expected = indexed_layout(expected_elements);
                    const auto& value = object_of(
                        field(statement, "value", "projection update"), "update value");
                    const auto value_layout = lower_expression(
                        value, builder, signatures, strings);
                    if (!same_layout(value_layout, expected)) {
                        throw LoweringFailure("multi-index update value layout mismatch");
                    }
                    ensure_independent_value(value, value_layout, builder, signatures);
                    const auto temporary = builder.add_owned_temporary(value_layout);
                    for (std::uint32_t component = value_layout.width; component > 0; --component) {
                        emit_store_local_component(builder, temporary + component - 1u);
                    }
                    std::uint32_t value_offset = 0;
                    for (const auto& [key, selected_layout] : selected_layouts) {
                        const auto selected = binding_layout.selectors.find(key);
                        emit_release_layout_local(
                            builder, builder.slot(binding_name, selected->second.offset), selected_layout);
                        for (std::uint32_t component = 0; component < selected_layout.width; ++component) {
                            emit_load_local_component(builder, temporary + value_offset + component);
                        }
                        clone_nested_resource_values(selected_layout, builder);
                        emit_store_slice(builder, binding_name, selected->second, selected_layout);
                        value_offset += selected_layout.width;
                    }
                    emit_release_layout_local(builder, temporary, value_layout);
                    continue;
                }
                if (indices.size() != 1) {
                    throw LoweringFailure("fixed container update requires one index");
                }
                const auto& index = object_of(indices.front(), "fixed update index");
                const auto& raw = field(index, "value", "fixed update index");
                if (!raw.is_number() || raw.as_number() < 0 ||
                    raw.as_number() != static_cast<double>(static_cast<std::uint32_t>(raw.as_number()))) {
                    throw LoweringFailure("fixed container update index must be a nonnegative integer constant");
                }
                path = std::to_string(static_cast<std::uint32_t>(raw.as_number()));
            }
            const auto selected = binding_layout.selectors.find(path);
            if (selected == binding_layout.selectors.end()) {
                throw LoweringFailure("unknown machine IR update projection " + path);
            }
            const ValueLayout selected_layout = projected_layout(
                binding_layout, path, selected->second);
            const auto& value = object_of(field(statement, "value", "projection update"), "update value");
            const auto value_layout = lower_expression(value, builder, signatures, strings);
            if (value_layout.width != selected_layout.width || value_layout.kind != selected_layout.kind) {
                throw LoweringFailure("machine IR update projection layout mismatch");
            }
            ensure_independent_value(value, value_layout, builder, signatures);
            emit_release_layout_local(
                builder, builder.slot(binding_name, selected->second.offset), selected_layout);
            emit_store_slice(builder, binding_name, selected->second, value_layout);
        } else if (kind == "label_print") {
            emit_static_string(
                builder, strings,
                string_field(statement, "label", "label print") + ": ");
            const auto& value = object_of(
                field(statement, "value", "label print"), "label print value");
            const auto display_shape = display_environment
                ? std::optional<DisplayShape>(display_shape_from_expression(
                    value, *display_environment, function_displays))
                : std::nullopt;
            const bool owns_value = lower_interpolation_value(
                value, "", builder, signatures, strings,
                display_shape ? &*display_shape : nullptr);
            emit_interpolation_concat(builder, false, owns_value);
            emit_static_string(builder, strings, "\n");
            emit_interpolation_concat(builder, true, false);
            Instruction write;
            write.opcode = Opcode::WriteString;
            write.owns_input = true;
            builder.emit(std::move(write));
        } else if (kind == "return") {
            const auto& value = object_of(field(statement, "value", "return"), "return value");
            const auto fixed = function_result_layout
                ? lower_literal_projection_argument(
                    value, *function_result_layout, builder, signatures, strings)
                : std::optional<ValueLayout>{};
            const auto layout = fixed
                ? *fixed
                : lower_expression(value, builder, signatures, strings);
            ensure_independent_value(value, layout, builder, signatures);
            if (const auto* block_return = builder.block_return()) {
                if (!same_layout(layout, block_return->layout)) {
                    throw LoweringFailure("machine IR local return layout mismatch");
                }
                emit_release_layout_local(builder, block_return->result, block_return->layout);
                for (std::uint32_t component = layout.width; component > 0; --component) {
                    Instruction store;
                    store.opcode = Opcode::StoreLocal;
                    store.index = block_return->result + component - 1;
                    builder.emit(std::move(store));
                }
                Instruction jump;
                jump.opcode = Opcode::Jump;
                jump.label = block_return->label;
                builder.emit(std::move(jump));
                continue;
            }
            emit_release_owned_values(builder);
            emit_return(builder, layout);
        } else if (kind == "continue" || kind == "break") {
            Instruction jump;
            jump.opcode = Opcode::Jump;
            jump.label = kind == "continue" ? builder.continue_label() : builder.break_label();
            builder.emit(std::move(jump));
        } else if (kind == "exit_program") {
            emit_release_owned_values(builder);
            builder.emit({Opcode::ExitProgram});
        } else if (kind == "expr_stmt") {
            const auto& expression = object_of(field(statement, "expr", "expression statement"), "expression");
            if (string_field(expression, "kind", "expression") == "call") {
                const auto& print_callee = object_of(
                    field(expression, "callee", "print expression"), "print callee");
                if (string_field(print_callee, "kind", "print callee") == "stdlib_function" &&
                    string_field(print_callee, "module", "print callee") == "io" &&
                    string_field(print_callee, "name", "print callee") == "print") {
                    const auto& print_args = array_of(
                        field(expression, "args", "print expression"), "print args");
                    if (print_args.size() != 1) {
                        throw LoweringFailure("machine IR print requires one argument");
                    }
                    const auto& printed = object_of(print_args.front(), "printed expression");
                    const auto shape = display_environment
                        ? display_shape_from_expression(
                            printed, *display_environment, function_displays)
                        : display_shape_from_expression(printed, {}, function_displays);
                    const bool owns_value = lower_interpolation_value(
                        printed, "", builder, signatures, strings, &shape);
                    emit_static_string(builder, strings, "\n");
                    emit_interpolation_concat(builder, owns_value, false);
                    Instruction write;
                    write.opcode = Opcode::WriteString;
                    write.owns_input = true;
                    builder.emit(std::move(write));
                    if (function_tail && index + 1 == body.size()) {
                        builder.emit({Opcode::PushNull});
                        emit_release_owned_values(builder);
                        emit_return(builder, {1, ValueKind::Null, {}});
                    }
                    continue;
                }
            }
            if (string_field(expression, "kind", "expression") == "match_stmt") {
                const auto loop = field(expression, "loop", "match statement");
                const auto caught = field(expression, "catch", "match statement");
                if (!loop.is_boolean() || !caught.is_boolean() ||
                    (loop.as_boolean() && caught.as_boolean())) {
                    throw LoweringFailure("direct machine IR catch matches cannot loop");
                }
                const bool match_loop = loop.as_boolean();
                const std::uint32_t loop_start = builder.next_label();
                if (match_loop) {
                    Instruction start_label;
                    start_label.opcode = Opcode::Label;
                    start_label.label = loop_start;
                    builder.emit(std::move(start_label));
                }
                const auto& discriminant = object_of(
                    field(expression, "discriminant", "match statement"), "match discriminant");
                if (caught.as_boolean()) {
                    const std::uint32_t handler = builder.next_label();
                    const std::uint32_t finish = builder.next_label();
                    const std::uint32_t error_value_local = builder.add_local(
                        "$", layout_from_type("record{message:str}"), false);
                    const std::uint32_t error_type_local = builder.add_local(
                        "$caught_error_type", {}, false);
                    const auto previous_handler = builder.error_handler();
                    const auto previous_error_value = builder.error_value_local();
                    const auto previous_error_type = builder.error_type_local();
                    builder.set_error_handler(handler, error_value_local, error_type_local);
                    const auto discriminant_layout = lower_expression(
                        discriminant, builder, signatures, strings);
                    builder.set_error_handler(
                        previous_handler, previous_error_value, previous_error_type);
                    if (discriminant_layout.kind == ValueKind::DynamicF64List &&
                        expression_produces_owned_f64_list(discriminant, signatures)) {
                        builder.emit({Opcode::ReleaseF64ListValue});
                    } else if (discriminant_layout.kind == ValueKind::String &&
                               expression_transfers_string_value(discriminant, signatures)) {
                        builder.emit({Opcode::ReleaseStringValue});
                    } else {
                        for (std::uint32_t component = 0; component < discriminant_layout.width; ++component) {
                            builder.emit({Opcode::Drop});
                        }
                    }
                    Instruction no_error;
                    no_error.opcode = Opcode::Jump;
                    no_error.label = finish;
                    builder.emit(std::move(no_error));
                    Instruction handler_label;
                    handler_label.opcode = Opcode::Label;
                    handler_label.label = handler;
                    builder.emit(std::move(handler_label));

                    struct CatchArm {
                        const vf::JsonValue::Object* arm = nullptr;
                        std::uint32_t mask = 0;
                        unsigned specificity = 0;
                    };
                    std::vector<CatchArm> typed_arms;
                    const vf::JsonValue::Object* default_arm = nullptr;
                    for (const auto& arm_value : array_of(
                        field(expression, "arms", "catch match"), "catch arms")) {
                        const auto& arm = object_of(arm_value, "catch arm");
                        const auto& arm_condition = field(arm, "condition", "catch arm");
                        if (arm_condition.is_null()) {
                            default_arm = &arm;
                            continue;
                        }
                        const auto& error_type = object_of(arm_condition, "catch error type");
                        if (string_field(error_type, "kind", "catch error type") != "error_type") {
                            throw LoweringFailure("machine IR catch arms must select error types");
                        }
                        const auto& mask_value = field(error_type, "mask", "catch error type");
                        if (!mask_value.is_number()) {
                            throw LoweringFailure("machine IR catch error type needs a mask");
                        }
                        const auto mask = static_cast<std::uint32_t>(mask_value.as_number());
                        unsigned specificity = 0;
                        for (std::uint32_t bits = mask; bits != 0; bits >>= 1) {
                            specificity += bits & 1u;
                        }
                        typed_arms.push_back({&arm, mask, specificity});
                    }
                    std::stable_sort(
                        typed_arms.begin(), typed_arms.end(),
                        [](const CatchArm& left, const CatchArm& right) {
                            return left.specificity > right.specificity;
                        });
                    const auto lower_catch_body = [&](const vf::JsonValue::Object& arm) {
                        const auto& arm_body = object_of(
                            field(arm, "body", "catch arm"), "catch arm body");
                        if (string_field(arm_body, "kind", "catch arm body") == "block") {
                            lower_statements(
                                array_of(field(arm_body, "body", "catch arm block"), "catch arm block body"),
                                builder, false, signatures, strings,
                                display_environment, function_displays);
                        } else {
                            const auto arm_layout = lower_expression(
                                arm_body, builder, signatures, strings);
                            for (std::uint32_t component = 0; component < arm_layout.width; ++component) {
                                builder.emit({Opcode::Drop});
                            }
                        }
                    };
                    for (const auto& arm : typed_arms) {
                        const std::uint32_t next_arm = builder.next_label();
                        Instruction load_type;
                        load_type.opcode = Opcode::LoadLocal;
                        load_type.index = error_type_local;
                        builder.emit(std::move(load_type));
                        Instruction matches;
                        matches.opcode = Opcode::ErrorTypeMatches;
                        matches.index = arm.mask;
                        builder.emit(std::move(matches));
                        Instruction skip;
                        skip.opcode = Opcode::JumpIfFalse;
                        skip.label = next_arm;
                        builder.emit(std::move(skip));
                        lower_catch_body(*arm.arm);
                        emit_release_layout_local(
                            builder, error_value_local,
                            layout_from_type("record{message:str}"));
                        Instruction handled;
                        handled.opcode = Opcode::Jump;
                        handled.label = finish;
                        builder.emit(std::move(handled));
                        Instruction next_label;
                        next_label.opcode = Opcode::Label;
                        next_label.label = next_arm;
                        builder.emit(std::move(next_label));
                    }
                    if (default_arm) {
                        lower_catch_body(*default_arm);
                        emit_release_layout_local(
                            builder, error_value_local,
                            layout_from_type("record{message:str}"));
                    } else {
                        Instruction rethrow;
                        rethrow.opcode = Opcode::RethrowError;
                        rethrow.error_value_local = error_value_local;
                        rethrow.error_type_local = error_type_local;
                        if (previous_handler) {
                            rethrow.has_error_handler = true;
                            rethrow.label = *previous_handler;
                            rethrow.handler_error_value_local = *previous_error_value;
                            rethrow.handler_error_type_local = *previous_error_type;
                        }
                        builder.emit(std::move(rethrow));
                    }
                    Instruction finish_label;
                    finish_label.opcode = Opcode::Label;
                    finish_label.label = finish;
                    builder.emit(std::move(finish_label));
                    continue;
                }
                const auto discriminant_layout = lower_expression(
                    discriminant, builder, signatures, strings);
                const auto& match_arms = array_of(
                    field(expression, "arms", "match statement"), "match arms");
                const bool type_only_match = std::all_of(
                    match_arms.begin(), match_arms.end(), [](const vf::JsonValue& arm_value) {
                        const auto& arm = object_of(arm_value, "match arm");
                        const auto& condition = field(arm, "condition", "match arm");
                        return condition.is_null() || string_field(
                            object_of(condition, "match condition"), "kind", "match condition") == "type_pattern";
                    });
                if (discriminant_layout.kind != ValueKind::Numeric &&
                    discriminant_layout.kind != ValueKind::String &&
                    !(discriminant_layout.kind == ValueKind::Aggregate &&
                      type_only_match && !has_owned_resources(discriminant_layout))) {
                    throw LoweringFailure("machine IR match requires numeric or string discriminant");
                }
                if (discriminant_layout.kind == ValueKind::String &&
                    expression_transfers_string_value(discriminant, signatures)) {
                    throw LoweringFailure("direct machine IR owned string match discriminants are not implemented");
                }
                const auto discriminant_slot = builder.add_borrowed_temporary(discriminant_layout);
                for (std::uint32_t component = discriminant_layout.width; component > 0; --component) {
                    Instruction store_discriminant;
                    store_discriminant.opcode = Opcode::StoreLocal;
                    store_discriminant.index = discriminant_slot + component - 1;
                    builder.emit(std::move(store_discriminant));
                }

                ValueLayout result_layout;
                std::optional<std::uint32_t> result_slot;
                if (function_tail && index + 1 == body.size()) {
                    for (const auto& arm_value : array_of(
                        field(expression, "arms", "match statement"), "match arms")) {
                        const auto& arm = object_of(arm_value, "match arm");
                        const auto& arm_body = object_of(
                            field(arm, "body", "match arm"), "match arm body");
                        if (string_field(arm_body, "kind", "match arm body") == "block") continue;
                        result_layout = layout_from_expression_shape(arm_body, signatures);
                        if (result_layout.kind != ValueKind::Numeric &&
                            result_layout.kind != ValueKind::String) {
                            throw LoweringFailure("machine IR match expression requires numeric or string result");
                        }
                        result_slot = result_layout.kind == ValueKind::String
                            ? builder.add_owned_temporary(result_layout)
                            : builder.add_borrowed_temporary(result_layout);
                        emit_default_value(builder, result_layout, strings);
                        for (std::uint32_t component = result_layout.width; component > 0; --component) {
                            Instruction initialize_result;
                            initialize_result.opcode = Opcode::StoreLocal;
                            initialize_result.index = *result_slot + component - 1;
                            builder.emit(std::move(initialize_result));
                        }
                        break;
                    }
                }

                const std::uint32_t finish = builder.next_label();
                if (match_loop) builder.push_loop(loop_start, finish);
                std::vector<const vf::JsonValue::Object*> ordered_arms;
                const vf::JsonValue::Object* selected_type_arm = nullptr;
                const vf::JsonValue::Object* default_arm = nullptr;
                int selected_type_score = -1;
                const std::string actual_type = string_field(
                    discriminant, "type", "match discriminant");
                for (const auto& arm_value : match_arms) {
                    const auto& arm = object_of(arm_value, "match arm");
                    const auto& condition = field(arm, "condition", "match arm");
                    if (condition.is_null()) {
                        default_arm = &arm;
                        continue;
                    }
                    const auto& condition_expression = object_of(condition, "match condition");
                    if (string_field(condition_expression, "kind", "match condition") != "type_pattern") {
                        ordered_arms.push_back(&arm);
                        continue;
                    }
                    const std::string pattern = string_field(
                        condition_expression, "name", "match type pattern");
                    const int score = type_match_score(actual_type, pattern);
                    if (score > selected_type_score) {
                        selected_type_score = score;
                        selected_type_arm = &arm;
                    }
                }
                if (selected_type_arm) ordered_arms.push_back(selected_type_arm);
                else if (default_arm) ordered_arms.push_back(default_arm);
                bool saw_default = false;
                for (const auto* arm_pointer : ordered_arms) {
                    const auto& arm = *arm_pointer;
                    const auto& condition_value = field(arm, "condition", "match arm");
                    const bool selected_type = arm_pointer == selected_type_arm;
                    std::uint32_t next = finish;
                    if (!condition_value.is_null() && !selected_type) {
                        if (saw_default) {
                            throw LoweringFailure("machine IR match default must be last");
                        }
                        next = builder.next_label();
                        for (std::uint32_t component = 0; component < discriminant_layout.width; ++component) {
                            Instruction load_discriminant;
                            load_discriminant.opcode = Opcode::LoadLocal;
                            load_discriminant.index = discriminant_slot + component;
                            builder.emit(std::move(load_discriminant));
                        }
                        const auto& condition_expression = object_of(
                            condition_value, "match condition");
                        const auto condition_layout = lower_expression(
                            condition_expression,
                            builder, signatures, strings);
                        if (condition_layout.kind != discriminant_layout.kind ||
                            condition_layout.width != discriminant_layout.width) {
                            throw LoweringFailure("machine IR match condition type mismatch");
                        }
                        if (discriminant_layout.kind == ValueKind::String) {
                            Instruction equal;
                            equal.opcode = Opcode::StringEqual;
                            equal.owns_right = expression_transfers_string_value(
                                condition_expression, signatures);
                            builder.emit(std::move(equal));
                        } else {
                            builder.emit({Opcode::OrderedEqualF64});
                        }
                        Instruction miss;
                        miss.opcode = Opcode::JumpIfFalse;
                        miss.label = next;
                        builder.emit(std::move(miss));
                    } else {
                        saw_default = true;
                    }

                    const auto& arm_body = object_of(field(arm, "body", "match arm"), "match arm body");
                    if (string_field(arm_body, "kind", "match arm body") == "block") {
                        lower_statements(
                            array_of(field(arm_body, "body", "match arm block"), "match arm block body"),
                            builder, false, signatures, strings,
                            display_environment, function_displays);
                    } else if (result_slot) {
                        const auto arm_layout = lower_expression(
                            arm_body, builder, signatures, strings);
                        if (arm_layout.width != result_layout.width ||
                            arm_layout.kind != result_layout.kind) {
                            throw LoweringFailure("machine IR match arm result type mismatch");
                        }
                        ensure_independent_value(arm_body, arm_layout, builder, signatures);
                        for (std::uint32_t component = arm_layout.width; component > 0; --component) {
                            Instruction store_result;
                            store_result.opcode = Opcode::StoreLocal;
                            store_result.index = *result_slot + component - 1;
                            builder.emit(std::move(store_result));
                        }
                    } else {
                        const auto arm_layout = lower_expression(
                            arm_body, builder, signatures, strings);
                        for (std::uint32_t component = 0; component < arm_layout.width; ++component) {
                            builder.emit({Opcode::Drop});
                        }
                    }
                    if (!builder.ends_with_return()) {
                        Instruction done;
                        done.opcode = Opcode::Jump;
                        done.label = match_loop ? loop_start : finish;
                        builder.emit(std::move(done));
                    }
                    if (!condition_value.is_null() && !selected_type) {
                        Instruction next_label;
                        next_label.opcode = Opcode::Label;
                        next_label.label = next;
                        builder.emit(std::move(next_label));
                    }
                }
                if (match_loop) builder.pop_loop();
                Instruction finish_label;
                finish_label.opcode = Opcode::Label;
                finish_label.label = finish;
                builder.emit(std::move(finish_label));
                if (result_slot) {
                    for (std::uint32_t component = 0; component < result_layout.width; ++component) {
                        Instruction load_result;
                        load_result.opcode = Opcode::LoadLocal;
                        load_result.index = *result_slot + component;
                        builder.emit(std::move(load_result));
                    }
                    if (result_layout.kind == ValueKind::String) {
                        builder.emit({Opcode::CloneString});
                    }
                    emit_release_owned_values(builder);
                    emit_return(builder, result_layout);
                }
                continue;
            }
            if (!(function_tail && index + 1 == body.size()) &&
                lower_discarded_range_pipe(expression, builder, signatures, strings)) {
                continue;
            }
            const auto fixed = function_tail && index + 1 == body.size() && function_result_layout
                ? lower_literal_projection_argument(
                    expression, *function_result_layout, builder, signatures, strings)
                : std::optional<ValueLayout>{};
            const auto layout = fixed
                ? *fixed
                : lower_expression(expression, builder, signatures, strings);
            if (function_tail && index + 1 == body.size()) {
                ensure_independent_value(expression, layout, builder, signatures);
                emit_release_owned_values(builder);
                emit_return(builder, layout);
            }
            else if (layout.kind == ValueKind::DynamicF64List &&
                     expression_produces_owned_f64_list(expression, signatures)) {
                builder.emit({Opcode::ReleaseF64ListValue});
            } else if (layout.kind == ValueKind::String &&
                       expression_transfers_string_value(expression, signatures)) {
                builder.emit({Opcode::ReleaseStringValue});
            } else if ((layout.kind == ValueKind::Aggregate || layout.kind == ValueKind::StringMultiset) &&
                       has_owned_resources(layout) &&
                       expression_transfers_aggregate_value(expression, signatures)) {
                emit_discard_owned_value(builder, layout);
            } else {
                for (std::uint32_t component = 0; component < layout.width; ++component) {
                    builder.emit({Opcode::Drop});
                }
            }
        } else if (kind == "if_stmt") {
            const auto loop_value = field(statement, "loop", "if statement");
            if (!loop_value.is_boolean()) throw LoweringFailure("expected loop bit in if statement");
            const bool loop = loop_value.as_boolean();
            const std::uint32_t start = builder.next_label();
            const std::uint32_t finish = builder.next_label();
            if (loop) {
                Instruction label;
                label.opcode = Opcode::Label;
                label.label = start;
                builder.emit(std::move(label));
            }
            const auto condition = lower_expression(
                object_of(field(statement, "condition", "if statement"), "condition"),
                builder, signatures, strings);
            require_scalar(condition, "machine IR condition");
            Instruction jump_false;
            jump_false.opcode = Opcode::JumpIfFalse;
            jump_false.label = finish;
            builder.emit(std::move(jump_false));
            const auto& block = object_of(field(statement, "body", "if statement"), "if body");
            if (loop) builder.push_loop(start, finish);
            lower_statements(
                array_of(field(block, "body", "block"), "block body"),
                builder, false, signatures, strings,
                display_environment, function_displays);
            if (loop) builder.pop_loop();
            if (loop) {
                Instruction jump;
                jump.opcode = Opcode::Jump;
                jump.label = start;
                builder.emit(std::move(jump));
            }
            Instruction label;
            label.opcode = Opcode::Label;
            label.label = finish;
            builder.emit(std::move(label));
        } else {
            throw LoweringFailure("unsupported machine IR statement " + kind);
        }
    }
}

inline Function lower_function(
    const vf::JsonValue::Object& function,
    const FunctionSignatures& signatures,
    StringPool& strings
) {
    const std::string function_name = string_field(function, "name", "function");
    const auto signature = signatures.find(function_name);
    FunctionBuilder builder(
        function_name,
        signature != signatures.end() && signature->second.may_error);
    if (signature != signatures.end()) {
        builder.set_result_layout(signature->second.result);
    }
    const auto& params = array_of(field(function, "params", "function"), "function params");
    bool has_defaults = false;
    for (std::size_t index = 0; index < params.size(); ++index) {
        const auto& parameter = object_of(params[index], "param");
        const auto layout = signature != signatures.end()
            ? signature->second.parameters[index]
            : layout_from_type(string_field(parameter, "type", "param"), &signatures);
        const std::string parameter_type = string_field(parameter, "type", "param");
        builder.add_parameter(
            string_field(parameter, "name", "param"), layout,
            scalar_value_class_from_type(parameter_type, layout));
        has_defaults = has_defaults || !field(parameter, "default", "param").is_null();
    }
    if (has_defaults) builder.enable_parameter_mask();
    for (std::size_t index = 0; index < params.size(); ++index) {
        const auto& parameter = object_of(params[index], "param");
        const auto& default_value = field(parameter, "default", "param");
        if (default_value.is_null()) continue;
        const std::string name = string_field(parameter, "name", "param");
        const auto layout = builder.layout(name);
        const bool resource_default = has_owned_resources(layout);
        const auto default_storage = resource_default
            ? std::optional<std::uint32_t>(builder.add_owned_temporary(layout))
            : std::nullopt;
        const std::uint32_t provided = builder.next_label();
        Instruction branch;
        branch.opcode = Opcode::JumpIfParameterProvided;
        branch.index = static_cast<std::uint32_t>(index);
        branch.label = provided;
        builder.emit(std::move(branch));
        const auto& expression = object_of(default_value, "parameter default");
        const auto default_layout = lower_expression(expression, builder, signatures, strings);
        if (default_layout.width != layout.width) {
            throw LoweringFailure("machine IR parameter default width mismatch");
        }
        if (default_layout.kind != layout.kind) {
            throw LoweringFailure("machine IR parameter default layout mismatch");
        }
        if (resource_default) {
            ensure_independent_value(expression, default_layout, builder, signatures);
            for (std::uint32_t component = default_layout.width; component > 0; --component) {
                Instruction store;
                store.opcode = Opcode::StoreLocal;
                store.index = *default_storage + component - 1;
                builder.emit(std::move(store));
            }
            for (std::uint32_t component = 0; component < default_layout.width; ++component) {
                Instruction load;
                load.opcode = Opcode::LoadLocal;
                load.index = *default_storage + component;
                builder.emit(std::move(load));
            }
        }
        emit_store_binding(builder, name, default_layout, strings);
        Instruction label;
        label.opcode = Opcode::Label;
        label.label = provided;
        builder.emit(std::move(label));
    }
    const auto& block = object_of(field(function, "body", "function"), "function body");
    const auto& body = array_of(field(block, "body", "block"), "block body");
    for (const auto& value : body) {
        const auto& statement = object_of(value, "statement");
        if (string_field(statement, "kind", "statement") == "update_attr") {
            discover_bindings(statement, builder, signatures);
        }
    }
    for (const auto& value : body) {
        discover_bindings(object_of(value, "statement"), builder, signatures);
    }
    DisplayEnvironment display_environment;
    if (signature != signatures.end()) {
        for (std::size_t index = 0;
             index < signature->second.parameter_names.size() &&
             index < signature->second.parameter_displays.size();
             ++index) {
            display_environment[signature->second.parameter_names[index]] =
                signature->second.parameter_displays[index];
        }
    }
    lower_statements(
        body, builder, true, signatures, strings, &display_environment, nullptr,
        signature == signatures.end() ? nullptr : &signature->second.result);
    if (!builder.ends_with_return()) {
        const ValueLayout result = signature == signatures.end() ? ValueLayout{} : signature->second.result;
        emit_default_value(builder, result, strings);
        emit_release_owned_values(builder);
        emit_return(builder, result);
    }
    return builder.finish();
}

}  // namespace detail

using detail::array_of;
using detail::field;
using detail::object_of;
using detail::string_field;

struct AnyFunctionCandidate {
    std::vector<std::size_t> parameter_indices;
    std::map<std::size_t, std::string> symbolic_dimensions;
    std::set<std::size_t> metatype_parameters;
    std::map<std::size_t, std::string> named_generic_patterns;
};

inline bool named_generic_type_variable(const std::string& type) {
    const std::string value = detail::trim(type);
    return value.size() == 1 && value.front() >= 'A' && value.front() <= 'Z';
}

inline bool type_contains_named_generic(const std::string& type) {
    const std::string value = detail::trim(type);
    if (named_generic_type_variable(value)) return true;
    if (value.size() >= 3 && value.front() == '[' && value.back() == ']') {
        const std::string inside = value.substr(1, value.size() - 2);
        const auto separator = detail::find_top_level(inside, ':');
        return type_contains_named_generic(separator == std::string::npos
            ? inside : inside.substr(0, separator));
    }
    if (value.rfind("tuple<", 0) == 0 && value.back() == '>') {
        for (const auto& item : detail::split_top_level(
                 value.substr(6, value.size() - 7), ',')) {
            if (type_contains_named_generic(item)) return true;
        }
    }
    if (value.rfind("record{", 0) == 0 && value.back() == '}') {
        for (const auto& field : detail::split_top_level(
                 value.substr(7, value.size() - 8), ',')) {
            const auto separator = detail::find_top_level(field, ':');
            if (separator != std::string::npos &&
                type_contains_named_generic(field.substr(separator + 1))) return true;
        }
    }
    if (value.rfind("list<", 0) == 0 && value.back() == '>') {
        return type_contains_named_generic(value.substr(5, value.size() - 6));
    }
    if (value.rfind("multiset<", 0) == 0 && value.back() == '>') {
        return type_contains_named_generic(value.substr(9, value.size() - 10));
    }
    if (value.size() >= 3 && value.front() == '{' && value.back() == '}') {
        return type_contains_named_generic(value.substr(1, value.size() - 2));
    }
    return false;
}

inline bool bind_named_generic_types(
    const std::string& pattern_text,
    const std::string& concrete_text,
    std::map<std::string, std::string>& bindings
) {
    const std::string pattern = detail::trim(pattern_text);
    const std::string concrete = detail::trim(concrete_text);
    if (named_generic_type_variable(pattern)) {
        const auto found = bindings.find(pattern);
        if (found != bindings.end()) return found->second == concrete;
        bindings[pattern] = concrete;
        return true;
    }
    if (pattern.size() >= 3 && concrete.size() >= 3 &&
        pattern.front() == '[' && pattern.back() == ']' &&
        concrete.front() == '[' && concrete.back() == ']') {
        const std::string pattern_inside = pattern.substr(1, pattern.size() - 2);
        const std::string concrete_inside = concrete.substr(1, concrete.size() - 2);
        const auto pattern_separator = detail::find_top_level(pattern_inside, ':');
        const auto concrete_separator = detail::find_top_level(concrete_inside, ':');
        return bind_named_generic_types(
            pattern_separator == std::string::npos
                ? pattern_inside : pattern_inside.substr(0, pattern_separator),
            concrete_separator == std::string::npos
                ? concrete_inside : concrete_inside.substr(0, concrete_separator),
            bindings);
    }
    if (pattern.rfind("tuple<", 0) == 0 && pattern.back() == '>' &&
        concrete.rfind("tuple<", 0) == 0 && concrete.back() == '>') {
        const auto patterns = detail::split_top_level(
            pattern.substr(6, pattern.size() - 7), ',');
        const auto concretes = detail::split_top_level(
            concrete.substr(6, concrete.size() - 7), ',');
        if (patterns.size() != concretes.size()) return false;
        for (std::size_t index = 0; index < patterns.size(); ++index) {
            if (!bind_named_generic_types(patterns[index], concretes[index], bindings)) {
                return false;
            }
        }
        return true;
    }
    if (pattern.rfind("record{", 0) == 0 && pattern.back() == '}' &&
        concrete.rfind("record{", 0) == 0 && concrete.back() == '}') {
        auto patterns = detail::split_top_level(
            pattern.substr(7, pattern.size() - 8), ',');
        auto concretes = detail::split_top_level(
            concrete.substr(7, concrete.size() - 8), ',');
        const auto remove_empty = [](std::vector<std::string>& fields) {
            fields.erase(std::remove_if(fields.begin(), fields.end(),
                [](const std::string& field) { return detail::trim(field).empty(); }),
                fields.end());
        };
        remove_empty(patterns);
        remove_empty(concretes);
        if (patterns.size() != concretes.size()) return false;
        for (std::size_t index = 0; index < patterns.size(); ++index) {
            const auto pattern_separator = detail::find_top_level(patterns[index], ':');
            const auto concrete_separator = detail::find_top_level(concretes[index], ':');
            if (pattern_separator == std::string::npos ||
                concrete_separator == std::string::npos) return false;
            if (detail::trim(patterns[index].substr(0, pattern_separator)) !=
                detail::trim(concretes[index].substr(0, concrete_separator))) return false;
            if (!bind_named_generic_types(
                    patterns[index].substr(pattern_separator + 1),
                    concretes[index].substr(concrete_separator + 1), bindings)) return false;
        }
        return true;
    }
    const auto bind_wrapped = [&](const std::string& prefix) -> std::optional<bool> {
        if (pattern.rfind(prefix, 0) != 0 || pattern.back() != '>' ||
            concrete.rfind(prefix, 0) != 0 || concrete.back() != '>') {
            return std::nullopt;
        }
        return bind_named_generic_types(
            pattern.substr(prefix.size(), pattern.size() - prefix.size() - 1),
            concrete.substr(prefix.size(), concrete.size() - prefix.size() - 1),
            bindings);
    };
    if (const auto bound = bind_wrapped("list<")) return *bound;
    if (const auto bound = bind_wrapped("multiset<")) return *bound;
    if (pattern.size() >= 3 && concrete.rfind("multiset<", 0) == 0 &&
        pattern.front() == '{' && pattern.back() == '}' && concrete.back() == '>') {
        return bind_named_generic_types(
            pattern.substr(1, pattern.size() - 2),
            concrete.substr(9, concrete.size() - 10), bindings);
    }
    if (pattern.size() >= 3 && concrete.size() >= 3 &&
        pattern.front() == '{' && pattern.back() == '}' &&
        concrete.front() == '{' && concrete.back() == '}') {
        return bind_named_generic_types(
            pattern.substr(1, pattern.size() - 2),
            concrete.substr(1, concrete.size() - 2), bindings);
    }
    return true;
}

inline std::optional<std::string> symbolic_vector_dimension(const std::string& type) {
    if (type.size() < 5 || type.front() != '[' || type.back() != ']') return std::nullopt;
    const std::string inside = type.substr(1, type.size() - 2);
    const auto separator = detail::find_top_level(inside, ':');
    if (separator == std::string::npos) return std::nullopt;
    const std::string shape = detail::trim(inside.substr(separator + 1));
    if (!shape.empty() &&
        (std::isalpha(static_cast<unsigned char>(shape.front())) || shape.front() == '_') &&
        std::all_of(shape.begin() + 1, shape.end(), [](unsigned char ch) {
            return std::isalnum(ch) || ch == '_';
        })) return shape;
    return symbolic_vector_dimension(detail::trim(inside.substr(0, separator)));
}

inline bool concrete_vector_type(const std::string& type) {
    if (type.size() < 5 || type.front() != '[' || type.back() != ']') return false;
    const std::string inside = type.substr(1, type.size() - 2);
    const auto separator = detail::find_top_level(inside, ':');
    if (separator == std::string::npos) {
        const std::string element = detail::trim(inside);
        return !element.empty() &&
            (element.front() != '[' || concrete_vector_type(element));
    }
    const std::string shape = detail::trim(inside.substr(separator + 1));
    if (shape.empty() || !std::all_of(shape.begin(), shape.end(), [](unsigned char ch) {
        return std::isdigit(ch);
    })) return false;
    const std::string element = detail::trim(inside.substr(0, separator));
    return element.empty() || element.front() != '[' || concrete_vector_type(element);
}

inline bool bind_symbolic_vector_dimensions(
    const std::string& pattern,
    const std::string& concrete,
    std::map<std::string, std::string>& dimensions
) {
    if (pattern.size() < 5 || concrete.size() < 5 ||
        pattern.front() != '[' || pattern.back() != ']' ||
        concrete.front() != '[' || concrete.back() != ']') return false;
    const std::string pattern_inside = pattern.substr(1, pattern.size() - 2);
    const std::string concrete_inside = concrete.substr(1, concrete.size() - 2);
    const auto pattern_separator = detail::find_top_level(pattern_inside, ':');
    const auto concrete_separator = detail::find_top_level(concrete_inside, ':');
    if (pattern_separator == std::string::npos) return false;
    const std::string pattern_shape = detail::trim(pattern_inside.substr(pattern_separator + 1));
    const std::string concrete_shape = concrete_separator == std::string::npos
        ? std::string{}
        : detail::trim(concrete_inside.substr(concrete_separator + 1));
    const bool symbolic = !pattern_shape.empty() &&
        (std::isalpha(static_cast<unsigned char>(pattern_shape.front())) || pattern_shape.front() == '_') &&
        std::all_of(pattern_shape.begin() + 1, pattern_shape.end(), [](unsigned char ch) {
            return std::isalnum(ch) || ch == '_';
        });
    if (symbolic) {
        if (!concrete_shape.empty() &&
            !std::all_of(concrete_shape.begin(), concrete_shape.end(), [](unsigned char ch) {
                return std::isdigit(ch);
            })) return false;
        const auto existing = dimensions.find(pattern_shape);
        if (existing != dimensions.end() && existing->second != concrete_shape) return false;
        dimensions[pattern_shape] = concrete_shape;
    } else if (pattern_shape != concrete_shape) {
        return false;
    }
    const std::string pattern_element = detail::trim(pattern_inside.substr(0, pattern_separator));
    const std::string concrete_element = detail::trim(
        concrete_separator == std::string::npos
            ? concrete_inside
            : concrete_inside.substr(0, concrete_separator));
    if (!pattern_element.empty() && pattern_element.front() == '[') {
        return bind_symbolic_vector_dimensions(pattern_element, concrete_element, dimensions);
    }
    if (named_generic_type_variable(pattern_element)) return true;
    return pattern_element == concrete_element;
}

inline std::uint64_t specialization_key_hash(const std::string& key) {
    std::uint64_t hash = 1469598103934665603ull;
    for (const unsigned char ch : key) {
        hash ^= ch;
        hash *= 1099511628211ull;
    }
    return hash;
}

inline std::string specialization_shape_key(const vf::JsonValue& value);

struct HeterogeneousVariadicCandidate {
    std::size_t index = 0;
};

inline void collect_heterogeneous_variadic_calls(
    const vf::JsonValue& value,
    const std::map<std::string, HeterogeneousVariadicCandidate>& candidates,
    std::map<std::string, std::map<std::string, std::string>>& variants
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            collect_heterogeneous_variadic_calls(item, candidates, variants);
        }
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    const auto callee = object.find("callee");
    if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "call" &&
        callee != object.end() && callee->second.is_object()) {
        const auto& callee_object = callee->second.as_object();
        const auto callee_kind = callee_object.find("kind");
        const auto callee_name = callee_object.find("name");
        if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
            callee_kind->second.as_string() == "load" && callee_name != callee_object.end() &&
            callee_name->second.is_string()) {
            const std::string name = callee_name->second.as_string();
            const auto candidate = candidates.find(name);
            if (candidate != candidates.end()) {
                const auto& named = array_of(field(object, "named_args", "heterogeneous variadic call"),
                                             "heterogeneous variadic named args");
                const auto& spread = array_of(field(object, "spread_args", "heterogeneous variadic call"),
                                              "heterogeneous variadic spread args");
                const auto& args = array_of(field(object, "args", "heterogeneous variadic call"),
                                            "heterogeneous variadic args");
                if (named.empty() && spread.empty() && args.size() >= candidate->second.index) {
                    std::string key;
                    for (std::size_t index = candidate->second.index; index < args.size(); ++index) {
                        key += specialization_shape_key(args[index]) + "|";
                    }
                    auto& by_shape = variants[name];
                    if (!by_shape.count(key)) {
                        by_shape[key] = name + "$rest$" + std::to_string(by_shape.size());
                    }
                }
            }
        }
    }
    for (const auto& [name, child] : object) {
        (void)name;
        collect_heterogeneous_variadic_calls(child, candidates, variants);
    }
}

inline void rewrite_heterogeneous_variadic_calls(
    vf::JsonValue& value,
    const std::map<std::string, HeterogeneousVariadicCandidate>& candidates,
    const std::map<std::string, std::map<std::string, std::string>>& variants
) {
    if (value.is_array()) {
        for (auto& item : value.as_array()) {
            rewrite_heterogeneous_variadic_calls(item, candidates, variants);
        }
        return;
    }
    if (!value.is_object()) return;
    auto& object = value.as_object();
    for (auto& [name, child] : object) {
        (void)name;
        rewrite_heterogeneous_variadic_calls(child, candidates, variants);
    }
    const auto kind = object.find("kind");
    auto callee = object.find("callee");
    if (kind == object.end() || !kind->second.is_string() || kind->second.as_string() != "call" ||
        callee == object.end() || !callee->second.is_object()) return;
    auto& callee_object = callee->second.as_object();
    const auto callee_kind = callee_object.find("kind");
    const auto callee_name = callee_object.find("name");
    if (callee_kind == callee_object.end() || !callee_kind->second.is_string() ||
        callee_kind->second.as_string() != "load" || callee_name == callee_object.end() ||
        !callee_name->second.is_string()) return;
    const std::string name = callee_name->second.as_string();
    const auto candidate = candidates.find(name);
    const auto function_variants = variants.find(name);
    if (candidate == candidates.end() || function_variants == variants.end()) return;
    const auto& named = array_of(field(object, "named_args", "heterogeneous variadic call"),
                                 "heterogeneous variadic named args");
    const auto& spread = array_of(field(object, "spread_args", "heterogeneous variadic call"),
                                  "heterogeneous variadic spread args");
    auto& args = object.at("args").as_array();
    if (!named.empty() || !spread.empty() || args.size() < candidate->second.index) return;
    std::string key;
    for (std::size_t index = candidate->second.index; index < args.size(); ++index) {
        key += specialization_shape_key(args[index]) + "|";
    }
    const auto variant = function_variants->second.find(key);
    if (variant == function_variants->second.end()) return;
    vf::JsonValue::Array rest_items;
    while (args.size() > candidate->second.index) {
        rest_items.push_back(std::move(args[candidate->second.index]));
        args.erase(args.begin() + static_cast<std::ptrdiff_t>(candidate->second.index));
    }
    vf::JsonValue::Object packed;
    packed["kind"] = vf::JsonValue("list");
    packed["items"] = vf::JsonValue(std::move(rest_items));
    packed["element_type"] = vf::JsonValue("any");
    packed["type"] = vf::JsonValue("list<any>");
    args.emplace_back(std::move(packed));
    auto arg_types = object.find("arg_types");
    if (arg_types != object.end() && arg_types->second.is_array()) {
        auto& types = arg_types->second.as_array();
        while (types.size() > candidate->second.index) {
            types.erase(types.begin() + static_cast<std::ptrdiff_t>(candidate->second.index));
        }
        types.emplace_back("list<any>");
    }
    callee_object["name"] = vf::JsonValue(variant->second);
}

inline std::optional<vf::JsonValue> specialize_heterogeneous_variadics(
    const vf::JsonValue& typed_ir
) {
    if (!typed_ir.is_object()) return std::nullopt;
    const auto& module = typed_ir.as_object();
    const auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) return std::nullopt;
    std::map<std::string, HeterogeneousVariadicCandidate> candidates;
    for (const auto& statement_value : body->second.as_array()) {
        if (!statement_value.is_object()) continue;
        const auto& statement = statement_value.as_object();
        const auto kind = statement.find("kind");
        const auto name = statement.find("name");
        const auto params = statement.find("params");
        if (kind == statement.end() || !kind->second.is_string() || kind->second.as_string() != "function" ||
            name == statement.end() || !name->second.is_string() ||
            params == statement.end() || !params->second.is_array()) continue;
        for (std::size_t index = 0; index < params->second.as_array().size(); ++index) {
            const auto& parameter = object_of(params->second.as_array()[index], "heterogeneous variadic parameter");
            if (detail::bool_field(parameter, "variadic_positional", "heterogeneous variadic parameter") &&
                string_field(parameter, "type", "heterogeneous variadic parameter") == "any") {
                candidates[name->second.as_string()] = {index};
            }
        }
    }
    if (candidates.empty()) return std::nullopt;
    std::map<std::string, std::map<std::string, std::string>> variants;
    collect_heterogeneous_variadic_calls(typed_ir, candidates, variants);
    if (variants.empty()) return std::nullopt;
    vf::JsonValue rewritten = typed_ir;
    rewrite_heterogeneous_variadic_calls(rewritten, candidates, variants);
    auto& rewritten_body = rewritten.as_object().at("body").as_array();
    vf::JsonValue::Array output;
    for (auto& statement_value : rewritten_body) {
        if (!statement_value.is_object()) {
            output.push_back(std::move(statement_value));
            continue;
        }
        const auto& statement = statement_value.as_object();
        const auto name = statement.find("name");
        const auto function_variants = name != statement.end() && name->second.is_string()
            ? variants.find(name->second.as_string()) : variants.end();
        if (function_variants == variants.end()) {
            output.push_back(std::move(statement_value));
            continue;
        }
        const auto candidate = candidates.find(name->second.as_string());
        for (const auto& [key, variant_name] : function_variants->second) {
            (void)key;
            vf::JsonValue clone = statement_value;
            auto& clone_object = clone.as_object();
            clone_object["name"] = vf::JsonValue(variant_name);
            auto& parameter = clone_object.at("params").as_array()[candidate->second.index].as_object();
            parameter["variadic_positional"] = vf::JsonValue(false);
            parameter["type"] = vf::JsonValue("any");
            output.push_back(std::move(clone));
        }
    }
    rewritten_body = std::move(output);
    return rewritten;
}

inline std::string specialization_shape_key(const vf::JsonValue& value) {
    if (value.is_array()) {
        std::string key = "[";
        for (const auto& item : value.as_array()) key += specialization_shape_key(item) + ";";
        return key + "]";
    }
    if (!value.is_object()) {
        if (value.is_null()) return "null";
        if (value.is_boolean()) return "bit";
        if (value.is_number()) return "num";
        if (value.is_string()) return "str";
        return "value";
    }
    const auto& object = value.as_object();
    const auto kind_it = object.find("kind");
    const std::string kind = kind_it != object.end() && kind_it->second.is_string()
        ? kind_it->second.as_string() : "object";
    const auto type_it = object.find("type");
    const std::string type = type_it != object.end() && type_it->second.is_string()
        ? type_it->second.as_string() : "";
    if (kind == "const" || kind == "load" || kind == "field_access" ||
        kind == "dotted_index" || kind == "call") {
        return kind + ":" + type;
    }
    if (kind == "list") {
        const auto items = object.find("items");
        return "list:" + (items == object.end() ? std::string{} : specialization_shape_key(items->second));
    }
    if (kind == "record") {
        const auto fields = object.find("fields");
        return "record:" + (fields == object.end() ? type : specialization_shape_key(fields->second));
    }
    if (kind == "field") {
        const auto name = object.find("name");
        const auto child = object.find("value");
        return "field:" + (name != object.end() && name->second.is_string() ? name->second.as_string() : "") +
            ":" + (child == object.end() ? type : specialization_shape_key(child->second));
    }
    if (kind == "binary_op") {
        const auto op = object.find("op");
        const auto left = object.find("left");
        const auto right = object.find("right");
        return "binary:" +
            (op != object.end() && op->second.is_string() ? op->second.as_string() : "") + ":" +
            (left == object.end() ? std::string{} : specialization_shape_key(left->second)) + ":" +
            (right == object.end() ? std::string{} : specialization_shape_key(right->second));
    }
    return kind + ":" + type;
}

inline std::optional<std::string> call_specialization_key(
    const vf::JsonValue::Object& call,
    const AnyFunctionCandidate& candidate
) {
    const auto& named = array_of(field(call, "named_args", "specialized call"), "specialized named args");
    const auto& spread = array_of(field(call, "spread_args", "specialized call"), "specialized spread args");
    if (!named.empty() || !spread.empty()) return std::nullopt;
    const auto& args = array_of(field(call, "args", "specialized call"), "specialized args");
    const auto specialization_types = call.find("specialization_arg_types");
    std::string key;
    for (const auto index : candidate.parameter_indices) {
        if (index >= args.size()) return std::nullopt;
        if (candidate.named_generic_patterns.count(index)) {
            std::string concrete;
            if (specialization_types != call.end() && specialization_types->second.is_array() &&
                index < specialization_types->second.as_array().size() &&
                specialization_types->second.as_array()[index].is_string()) {
                concrete = specialization_types->second.as_array()[index].as_string();
            } else {
                if (!args[index].is_object()) return std::nullopt;
                const auto type = args[index].as_object().find("type");
                if (type == args[index].as_object().end() || !type->second.is_string()) {
                    return std::nullopt;
                }
                concrete = type->second.as_string();
            }
            key += "generic:" + concrete + "|";
        } else if (candidate.metatype_parameters.count(index)) {
            std::string concrete;
            if (specialization_types != call.end() && specialization_types->second.is_array() &&
                index < specialization_types->second.as_array().size() &&
                specialization_types->second.as_array()[index].is_string()) {
                concrete = specialization_types->second.as_array()[index].as_string();
            } else {
                if (!args[index].is_object()) return std::nullopt;
                const auto type = args[index].as_object().find("type");
                if (type == args[index].as_object().end() || !type->second.is_string()) {
                    return std::nullopt;
                }
                concrete = type->second.as_string();
            }
            if (concrete.rfind("type<", 0) != 0 || concrete.back() != '>') {
                return std::nullopt;
            }
            key += "type:" + concrete + "|";
        } else if (candidate.symbolic_dimensions.count(index)) {
            std::string concrete;
            if (specialization_types != call.end() && specialization_types->second.is_array() &&
                index < specialization_types->second.as_array().size() &&
                specialization_types->second.as_array()[index].is_string()) {
                concrete = specialization_types->second.as_array()[index].as_string();
            } else {
                if (!args[index].is_object()) return std::nullopt;
                const auto type = args[index].as_object().find("type");
                if (type == args[index].as_object().end() || !type->second.is_string()) return std::nullopt;
                concrete = type->second.as_string();
            }
            if (!concrete_vector_type(concrete) &&
                !detail::is_explicit_dynamic_f64_list_type(concrete)) return std::nullopt;
            key += "type:" + concrete + "|";
        } else {
            key += specialization_shape_key(args[index]) + "|";
        }
    }
    return key;
}

inline void collect_any_call_shapes(
    const vf::JsonValue& value,
    const std::map<std::string, AnyFunctionCandidate>& candidates,
    std::map<std::string, std::set<std::string>>& shapes,
    std::set<std::string>& unsafe
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) collect_any_call_shapes(item, candidates, shapes, unsafe);
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "call") {
        const auto callee = object.find("callee");
        if (callee != object.end() && callee->second.is_object()) {
            const auto& callee_object = callee->second.as_object();
            const auto callee_kind = callee_object.find("kind");
            const auto callee_name = callee_object.find("name");
            if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                callee_kind->second.as_string() == "load" && callee_name != callee_object.end() &&
                callee_name->second.is_string()) {
                const auto candidate = candidates.find(callee_name->second.as_string());
                if (candidate != candidates.end()) {
                    const auto key = call_specialization_key(object, candidate->second);
                    if (key) shapes[candidate->first].insert(*key);
                    else if (candidate->second.symbolic_dimensions.empty() &&
                             candidate->second.named_generic_patterns.empty() &&
                             candidate->second.metatype_parameters.empty()) {
                        unsafe.insert(candidate->first);
                    }
                }
            }
        }
    }
    for (const auto& [name, child] : object) {
        (void)name;
        collect_any_call_shapes(child, candidates, shapes, unsafe);
    }
}

inline void rewrite_specialized_calls(
    vf::JsonValue& value,
    const std::map<std::string, AnyFunctionCandidate>& candidates,
    const std::map<std::string, std::map<std::string, std::string>>& variants
) {
    if (value.is_array()) {
        for (auto& item : value.as_array()) rewrite_specialized_calls(item, candidates, variants);
        return;
    }
    if (!value.is_object()) return;
    auto& object = value.as_object();
    for (auto& [name, child] : object) {
        (void)name;
        rewrite_specialized_calls(child, candidates, variants);
    }
    const auto kind = object.find("kind");
    const auto callee = object.find("callee");
    if (kind == object.end() || !kind->second.is_string() || kind->second.as_string() != "call" ||
        callee == object.end() || !callee->second.is_object()) return;
    auto& callee_object = callee->second.as_object();
    const auto callee_kind = callee_object.find("kind");
    const auto callee_name = callee_object.find("name");
    if (callee_kind == callee_object.end() || !callee_kind->second.is_string() ||
        callee_kind->second.as_string() != "load" || callee_name == callee_object.end() ||
        !callee_name->second.is_string()) return;
    const std::string original_name = callee_name->second.as_string();
    const auto candidate = candidates.find(original_name);
    const auto function_variants = variants.find(original_name);
    if (candidate == candidates.end() || function_variants == variants.end()) return;
    const auto key = call_specialization_key(object, candidate->second);
    if (!key) return;
    const auto variant = function_variants->second.find(*key);
    if (variant != function_variants->second.end()) callee_object["name"] = variant->second;
}

inline std::optional<vf::JsonValue> specialize_any_function_calls(const vf::JsonValue& typed_ir) {
    if (!typed_ir.is_object()) return std::nullopt;
    const auto& input_module = typed_ir.as_object();
    const auto input_body = input_module.find("body");
    if (input_body == input_module.end() || !input_body->second.is_array()) return std::nullopt;
    std::map<std::string, AnyFunctionCandidate> candidates;
    for (const auto& statement_value : input_body->second.as_array()) {
        if (!statement_value.is_object()) continue;
        const auto& statement = statement_value.as_object();
        const auto kind = statement.find("kind");
        const auto name = statement.find("name");
        const auto params = statement.find("params");
        if (kind == statement.end() || !kind->second.is_string() || kind->second.as_string() != "function" ||
            name == statement.end() || !name->second.is_string() ||
            params == statement.end() || !params->second.is_array()) continue;
        AnyFunctionCandidate candidate;
        for (std::size_t index = 0; index < params->second.as_array().size(); ++index) {
            const auto& parameter = object_of(params->second.as_array()[index], "specialized parameter");
            const std::string parameter_type = string_field(
                parameter, "type", "specialized parameter");
            bool specializes = false;
            if (parameter_type == "any" || parameter_type == "{str}" ||
                parameter_type == "multiset<str>") {
                specializes = true;
            }
            if (parameter_type == "type") {
                specializes = true;
                candidate.metatype_parameters.insert(index);
            }
            if (type_contains_named_generic(parameter_type)) {
                specializes = true;
                candidate.named_generic_patterns[index] = parameter_type;
            }
            if (const auto dimension = symbolic_vector_dimension(parameter_type)) {
                specializes = true;
                candidate.symbolic_dimensions[index] = *dimension;
            }
            if (specializes) candidate.parameter_indices.push_back(index);
        }
        if (!candidate.parameter_indices.empty()) candidates[name->second.as_string()] = std::move(candidate);
    }
    std::map<std::string, std::set<std::string>> shapes;
    std::set<std::string> unsafe;
    collect_any_call_shapes(typed_ir, candidates, shapes, unsafe);
    std::map<std::string, std::map<std::string, std::string>> variants;
    for (const auto& [name, keys] : shapes) {
        const auto candidate = candidates.find(name);
        const bool symbolic = candidate != candidates.end() &&
            !candidate->second.symbolic_dimensions.empty();
        const bool metatype = candidate != candidates.end() &&
            !candidate->second.metatype_parameters.empty();
        const bool named_generic = candidate != candidates.end() &&
            !candidate->second.named_generic_patterns.empty();
        if ((!symbolic && !metatype && !named_generic && keys.size() < 2) || unsafe.count(name)) continue;
        for (const auto& key : keys) {
            variants[name][key] = name + "$vkf$" + std::to_string(specialization_key_hash(key));
        }
    }
    if (variants.empty()) return std::nullopt;

    vf::JsonValue specialized = typed_ir;
    rewrite_specialized_calls(specialized, candidates, variants);
    auto& body = specialized.as_object().at("body").as_array();
    std::set<std::string> existing_function_names;
    for (const auto& statement_value : body) {
        if (!statement_value.is_object()) continue;
        const auto& statement = statement_value.as_object();
        const auto kind = statement.find("kind");
        const auto name = statement.find("name");
        if (kind != statement.end() && kind->second.is_string() &&
            kind->second.as_string() == "function" && name != statement.end() && name->second.is_string()) {
            existing_function_names.insert(name->second.as_string());
        }
    }
    vf::JsonValue::Array rewritten_body;
    for (auto& statement_value : body) {
        if (!statement_value.is_object()) {
            rewritten_body.push_back(std::move(statement_value));
            continue;
        }
        auto& statement = statement_value.as_object();
        const auto kind = statement.find("kind");
        const auto name = statement.find("name");
        if (kind == statement.end() || !kind->second.is_string() || kind->second.as_string() != "function" ||
            name == statement.end() || !name->second.is_string()) {
            rewritten_body.push_back(std::move(statement_value));
            continue;
        }
        const auto function_variants = variants.find(name->second.as_string());
        if (function_variants == variants.end()) {
            rewritten_body.push_back(std::move(statement_value));
            continue;
        }
        const auto& candidate = candidates.at(name->second.as_string());
        for (const auto& [key, variant_name] : function_variants->second) {
            if (existing_function_names.count(variant_name)) continue;
            vf::JsonValue clone = statement_value;
            std::map<std::string, std::string> dimensions;
            std::map<std::string, std::string> named_types;
            std::map<std::size_t, std::string> concrete_parameter_types;
            std::size_t key_start = 0;
            for (const auto parameter_index : candidate.parameter_indices) {
                const auto key_end = key.find('|', key_start);
                if (key_end == std::string::npos) break;
                const std::string component = key.substr(key_start, key_end - key_start);
                const auto symbolic = candidate.symbolic_dimensions.find(parameter_index);
                const auto generic = candidate.named_generic_patterns.find(parameter_index);
                if (generic != candidate.named_generic_patterns.end() &&
                    component.rfind("generic:", 0) == 0) {
                    const std::string concrete = component.substr(8);
                    concrete_parameter_types[parameter_index] = concrete;
                    if (!bind_named_generic_types(generic->second, concrete, named_types)) {
                        throw LoweringFailure("inconsistent named generic specialization");
                    }
                    if (symbolic != candidate.symbolic_dimensions.end() &&
                        !bind_symbolic_vector_dimensions(
                            generic->second, concrete, dimensions)) {
                        throw LoweringFailure("inconsistent generic vector dimension specialization");
                    }
                } else if (candidate.metatype_parameters.count(parameter_index) &&
                    component.rfind("type:type<", 0) == 0 && component.back() == '>') {
                    concrete_parameter_types[parameter_index] = component.substr(5);
                } else if (symbolic != candidate.symbolic_dimensions.end() &&
                           component.rfind("type:", 0) == 0) {
                    const std::string concrete = component.substr(5);
                    concrete_parameter_types[parameter_index] = concrete;
                    const auto& parameters = statement_value.as_object().at("params").as_array();
                    const std::string pattern = string_field(
                        object_of(parameters[parameter_index], "specialized parameter"),
                        "type", "specialized parameter");
                    if (!bind_symbolic_vector_dimensions(pattern, concrete, dimensions)) {
                        throw LoweringFailure("inconsistent symbolic vector specialization");
                    }
                }
                key_start = key_end + 1;
            }
            const auto replace_type_dimensions = [&](const auto& self, std::string type) -> std::string {
                type = detail::trim(type);
                if (const auto replacement = named_types.find(type);
                    replacement != named_types.end()) {
                    return replacement->second;
                }
                if (type.size() >= 3 && type.front() == '[' && type.back() == ']') {
                    const std::string inside = type.substr(1, type.size() - 2);
                    const auto separator = detail::find_top_level(inside, ':');
                    if (separator == std::string::npos) {
                        return "[" + self(self, inside) + "]";
                    }
                    const std::string element = self(self, inside.substr(0, separator));
                    std::string shape = detail::trim(inside.substr(separator + 1));
                    if (const auto replacement = dimensions.find(shape);
                        replacement != dimensions.end()) {
                        shape = replacement->second;
                    }
                    return "[" + element + (shape.empty() ? "" : ":" + shape) + "]";
                }
                if (type.rfind("tuple<", 0) == 0 && type.back() == '>') {
                    const auto items = detail::split_top_level(
                        type.substr(6, type.size() - 7), ',');
                    std::string result = "tuple<";
                    for (std::size_t index = 0; index < items.size(); ++index) {
                        if (index != 0) result += ",";
                        result += self(self, items[index]);
                    }
                    return result + ">";
                }
                if (type.rfind("record{", 0) == 0 && type.back() == '}') {
                    const auto fields = detail::split_top_level(
                        type.substr(7, type.size() - 8), ',');
                    std::string result = "record{";
                    for (std::size_t index = 0; index < fields.size(); ++index) {
                        const auto separator = detail::find_top_level(fields[index], ':');
                        if (separator == std::string::npos) return type;
                        if (index != 0) result += ",";
                        result += detail::trim(fields[index].substr(0, separator)) + ":" +
                            self(self, fields[index].substr(separator + 1));
                    }
                    return result + "}";
                }
                if (type.rfind("list<", 0) == 0 && type.back() == '>') {
                    return "list<" + self(self, type.substr(5, type.size() - 6)) + ">";
                }
                if (type.rfind("multiset<", 0) == 0 && type.back() == '>') {
                    return "multiset<" + self(self, type.substr(9, type.size() - 10)) + ">";
                }
                if (type.size() >= 3 && type.front() == '{' && type.back() == '}') {
                    return "{" + self(self, type.substr(1, type.size() - 2)) + "}";
                }
                if (type.rfind("axis<", 0) == 0) {
                    const auto separator = type.find(">:");
                    if (separator != std::string::npos) {
                        return type.substr(0, separator + 2) +
                            self(self, type.substr(separator + 2));
                    }
                }
                return type;
            };
            const auto substitute_types = [&](const auto& self, vf::JsonValue& value, bool type_context) -> void {
                if (value.is_string()) {
                    if (type_context) value = vf::JsonValue(
                        replace_type_dimensions(replace_type_dimensions, value.as_string()));
                    return;
                }
                if (value.is_array()) {
                    for (auto& item : value.as_array()) self(self, item, type_context);
                    return;
                }
                if (!value.is_object()) return;
                for (auto& [field_name, child] : value.as_object()) {
                    const bool child_type_context = field_name == "type" || field_name == "left_type" ||
                        field_name == "right_type" || field_name == "operand_type" ||
                        field_name == "callee_type" || field_name == "return_type" ||
                        field_name == "representation_type" ||
                        field_name == "element_type" || field_name == "arg_types" ||
                        field_name == "specialization_arg_types" ||
                        (type_context && field_name != "name");
                    self(self, child, child_type_context);
                }
            };
            substitute_types(substitute_types, clone, false);
            auto& cloned_parameters = clone.as_object().at("params").as_array();
            for (const auto& [parameter_index, concrete] : concrete_parameter_types) {
                if (parameter_index < cloned_parameters.size()) {
                    cloned_parameters[parameter_index].as_object()["type"] = vf::JsonValue(concrete);
                }
            }
            std::map<std::string, std::string> metatype_callees;
            for (const auto parameter_index : candidate.metatype_parameters) {
                const auto concrete = concrete_parameter_types.find(parameter_index);
                if (concrete == concrete_parameter_types.end() ||
                    concrete->second.rfind("type<", 0) != 0 ||
                    concrete->second.back() != '>' || parameter_index >= cloned_parameters.size()) {
                    continue;
                }
                const auto& parameter = object_of(
                    cloned_parameters[parameter_index], "specialized metatype parameter");
                metatype_callees[string_field(
                    parameter, "name", "specialized metatype parameter")] =
                    concrete->second.substr(5, concrete->second.size() - 6);
            }
            const auto rewrite_metatype_calls = [&](const auto& self, vf::JsonValue& value) -> void {
                if (value.is_array()) {
                    for (auto& item : value.as_array()) self(self, item);
                    return;
                }
                if (!value.is_object()) return;
                auto& object = value.as_object();
                for (auto& [field_name, child] : object) {
                    if (field_name != "callee") self(self, child);
                }
                const auto kind = object.find("kind");
                const auto callee = object.find("callee");
                if (kind == object.end() || !kind->second.is_string() ||
                    kind->second.as_string() != "call" || callee == object.end() ||
                    !callee->second.is_object()) return;
                auto& callee_object = callee->second.as_object();
                const auto callee_kind = callee_object.find("kind");
                const auto callee_name = callee_object.find("name");
                if (callee_kind == callee_object.end() || !callee_kind->second.is_string() ||
                    callee_kind->second.as_string() != "load" ||
                    callee_name == callee_object.end() || !callee_name->second.is_string()) return;
                const auto target = metatype_callees.find(callee_name->second.as_string());
                if (target == metatype_callees.end()) return;
                callee_object["name"] = vf::JsonValue(target->second);
                callee_object["type"] = vf::JsonValue("fn(any)->" + target->second);
                object["callee_type"] = vf::JsonValue("fn(any)->" + target->second);
                object["type"] = vf::JsonValue(target->second);
            };
            rewrite_metatype_calls(rewrite_metatype_calls, clone);
            clone.as_object()["name"] = variant_name;
            rewritten_body.push_back(std::move(clone));
            existing_function_names.insert(variant_name);
        }
        // Keep the generic definition until later passes have rewritten calls
        // exposed by concrete clones. Reachability removes it from emitted code
        // once no concrete call targets the unspecialized symbol.
        rewritten_body.push_back(std::move(statement_value));
    }
    body = std::move(rewritten_body);
    return specialized;
}

inline void substitute_closure_loads(
    vf::JsonValue& value,
    const std::map<std::string, vf::JsonValue>& substitutions
) {
    if (value.is_array()) {
        for (auto& item : value.as_array()) substitute_closure_loads(item, substitutions);
        return;
    }
    if (!value.is_object()) return;
    auto& object = value.as_object();
    const auto kind = object.find("kind");
    const auto name = object.find("name");
    if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "load" &&
        name != object.end() && name->second.is_string()) {
        const auto replacement = substitutions.find(name->second.as_string());
        if (replacement != substitutions.end()) {
            value = replacement->second;
            return;
        }
    }
    for (auto& [field_name, child] : object) {
        (void)field_name;
        substitute_closure_loads(child, substitutions);
    }
}

inline void collect_function_local_names(const vf::JsonValue& value, std::set<std::string>& names) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) collect_function_local_names(item, names);
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    const auto name = object.find("name");
    if (kind != object.end() && kind->second.is_string() &&
        (kind->second.as_string() == "store_binding" || kind->second.as_string() == "function") &&
        name != object.end() && name->second.is_string()) {
        names.insert(name->second.as_string());
    }
    for (const auto& [field_name, child] : object) {
        if (field_name != "callee") collect_function_local_names(child, names);
    }
}

inline std::optional<vf::JsonValue> capture_module_literal_snapshots(const vf::JsonValue& typed_ir) {
    if (!typed_ir.is_object()) return std::nullopt;
    vf::JsonValue rewritten = typed_ir;
    auto& module = rewritten.as_object();
    auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) return std::nullopt;
    std::map<std::string, vf::JsonValue> visible_literals;
    for (auto& statement_value : body->second.as_array()) {
        if (!statement_value.is_object()) continue;
        auto& statement = statement_value.as_object();
        const std::string kind = string_field(statement, "kind", "module snapshot statement");
        if (kind == "store_binding") {
            const std::string name = string_field(statement, "name", "module snapshot binding");
            const auto& value = field(statement, "value", "module snapshot binding");
            if (value.is_object() &&
                string_field(value.as_object(), "kind", "module snapshot value") == "const") {
                visible_literals[name] = value;
            } else {
                visible_literals.erase(name);
            }
            continue;
        }
        if (kind != "function") continue;
        std::set<std::string> shadowed;
        for (const auto& parameter_value : array_of(
                 field(statement, "params", "snapshot function"), "snapshot function params")) {
            shadowed.insert(string_field(
                object_of(parameter_value, "snapshot function param"),
                "name", "snapshot function param"));
        }
        collect_function_local_names(field(statement, "body", "snapshot function"), shadowed);
        std::map<std::string, vf::JsonValue> captures;
        for (const auto& [name, value] : visible_literals) {
            if (!shadowed.count(name)) captures[name] = value;
        }
        auto& function_body = statement.at("body");
        substitute_closure_loads(function_body, captures);
    }
    return rewritten;
}

inline std::optional<vf::JsonValue> resolve_immediate_closure_call(
    const vf::JsonValue::Object& call,
    const std::map<std::string, const vf::JsonValue::Object*>& functions,
    std::uint64_t& next_invocation
) {
    const auto& callee = object_of(field(call, "callee", "closure call"), "closure callee");
    if (string_field(callee, "kind", "closure callee") != "call") return std::nullopt;
    const auto& factory_callee = object_of(
        field(callee, "callee", "closure factory call"), "closure factory callee");
    if (string_field(factory_callee, "kind", "closure factory callee") != "load") {
        return std::nullopt;
    }
    const auto factory = functions.find(string_field(factory_callee, "name", "closure factory"));
    if (factory == functions.end()) return std::nullopt;
    const auto& factory_named = array_of(
        field(callee, "named_args", "closure factory"), "closure factory named args");
    const auto& factory_spread = array_of(
        field(callee, "spread_args", "closure factory"), "closure factory spread args");
    const auto& invocation_named = array_of(
        field(call, "named_args", "closure invocation"), "closure invocation named args");
    const auto& invocation_spread = array_of(
        field(call, "spread_args", "closure invocation"), "closure invocation spread args");
    if (!factory_named.empty() || !factory_spread.empty() ||
        !invocation_named.empty() || !invocation_spread.empty()) return std::nullopt;

    const auto& factory_params = array_of(
        field(*factory->second, "params", "closure factory"), "closure factory params");
    const auto& factory_args = array_of(field(callee, "args", "closure factory"), "closure factory args");
    if (factory_params.size() != factory_args.size()) return std::nullopt;
    std::map<std::string, vf::JsonValue> substitutions;
    for (std::size_t index = 0; index < factory_params.size(); ++index) {
        substitutions[string_field(
            object_of(factory_params[index], "closure factory param"),
            "name", "closure factory param")] = factory_args[index];
    }

    const auto& factory_block = object_of(
        field(*factory->second, "body", "closure factory"), "closure factory body");
    const auto& factory_body = array_of(
        field(factory_block, "body", "closure factory"), "closure factory statements");
    std::map<std::string, const vf::JsonValue::Object*> nested_functions;
    for (const auto& statement_value : factory_body) {
        const auto& statement = object_of(statement_value, "closure factory statement");
        if (string_field(statement, "kind", "closure factory statement") == "function") {
            nested_functions[string_field(statement, "name", "nested closure")] = &statement;
        }
    }
    if (factory_body.empty()) return std::nullopt;
    const auto& tail_statement = object_of(factory_body.back(), "closure factory tail");
    if (string_field(tail_statement, "kind", "closure factory tail") != "expr_stmt") {
        return std::nullopt;
    }
    const auto& tail = object_of(field(tail_statement, "expr", "closure factory tail"), "closure tail");
    if (string_field(tail, "kind", "closure factory tail") != "load") return std::nullopt;
    const auto nested = nested_functions.find(string_field(tail, "name", "closure factory tail"));
    if (nested == nested_functions.end()) return std::nullopt;

    const auto& nested_params = array_of(
        field(*nested->second, "params", "nested closure"), "nested closure params");
    const auto& invocation_args = array_of(
        field(call, "args", "closure invocation"), "closure invocation args");
    if (nested_params.size() != invocation_args.size()) return std::nullopt;
    const auto& nested_block = object_of(
        field(*nested->second, "body", "nested closure"), "nested closure body");
    const auto& nested_body = array_of(
        field(nested_block, "body", "nested closure"), "nested closure statements");
    if (nested_body.empty()) return std::nullopt;
    for (const auto& parameter_value : nested_params) {
        substitutions.erase(string_field(
            object_of(parameter_value, "nested closure param"),
            "name", "nested closure param"));
    }
    vf::JsonValue::Array body;
    for (std::size_t index = 0; index < nested_params.size(); ++index) {
        const auto& parameter = object_of(nested_params[index], "nested closure param");
        const std::string parameter_name = string_field(
            parameter, "name", "nested closure param");
        const std::string hidden = "$invoke$" + std::to_string(next_invocation++);
        vf::JsonValue::Object binding;
        binding["kind"] = vf::JsonValue("store_binding");
        binding["name"] = vf::JsonValue(hidden);
        binding["type"] = field(parameter, "type", "nested closure param");
        binding["update"] = vf::JsonValue(false);
        binding["value"] = invocation_args[index];
        body.emplace_back(std::move(binding));
        vf::JsonValue::Object load;
        load["kind"] = vf::JsonValue("load");
        load["name"] = vf::JsonValue(hidden);
        load["type"] = field(parameter, "type", "nested closure param");
        substitutions[parameter_name] = vf::JsonValue(std::move(load));
    }
    for (const auto& statement : nested_body) body.push_back(statement);
    vf::JsonValue body_value(std::move(body));
    substitute_closure_loads(body_value, substitutions);
    vf::JsonValue::Object result;
    result["kind"] = vf::JsonValue("block_expr");
    result["body"] = std::move(body_value);
    result["type"] = field(call, "type", "closure invocation");
    return vf::JsonValue(std::move(result));
}

inline std::optional<vf::JsonValue> resolve_higher_order_call(
    const vf::JsonValue::Object& call,
    const std::map<std::string, const vf::JsonValue::Object*>& functions,
    std::uint64_t& next_invocation
) {
    const auto& callee = object_of(field(call, "callee", "higher-order call"), "higher-order callee");
    if (string_field(callee, "kind", "higher-order callee") != "load") return std::nullopt;
    const auto function = functions.find(string_field(callee, "name", "higher-order callee"));
    if (function == functions.end()) return std::nullopt;
    const auto& named = array_of(field(call, "named_args", "higher-order call"), "named args");
    const auto& spread = array_of(field(call, "spread_args", "higher-order call"), "spread args");
    if (!named.empty() || !spread.empty()) return std::nullopt;
    const auto& params = array_of(field(*function->second, "params", "higher-order function"), "params");
    const auto& args = array_of(field(call, "args", "higher-order call"), "args");
    if (params.size() != args.size()) return std::nullopt;
    bool has_function_parameter = false;
    std::map<std::string, vf::JsonValue> substitutions;
    vf::JsonValue::Array body;
    for (std::size_t index = 0; index < params.size(); ++index) {
        const auto& parameter = object_of(params[index], "higher-order parameter");
        const std::string name = string_field(parameter, "name", "higher-order parameter");
        const std::string type = string_field(parameter, "type", "higher-order parameter");
        if (type.find("->") != std::string::npos) {
            substitutions[name] = args[index];
            has_function_parameter = true;
            continue;
        }
        const std::string hidden = "$invoke$" + std::to_string(next_invocation++);
        vf::JsonValue::Object binding;
        binding["kind"] = vf::JsonValue("store_binding");
        binding["name"] = vf::JsonValue(hidden);
        binding["type"] = vf::JsonValue(type);
        binding["update"] = vf::JsonValue(false);
        binding["value"] = args[index];
        body.emplace_back(std::move(binding));
        vf::JsonValue::Object load;
        load["kind"] = vf::JsonValue("load");
        load["name"] = vf::JsonValue(hidden);
        load["type"] = vf::JsonValue(type);
        substitutions[name] = vf::JsonValue(std::move(load));
    }
    if (!has_function_parameter) return std::nullopt;
    const auto& function_block = object_of(
        field(*function->second, "body", "higher-order function"), "function body");
    for (const auto& statement : array_of(
             field(function_block, "body", "higher-order function"), "function statements")) {
        body.push_back(statement);
    }
    vf::JsonValue body_value(std::move(body));
    substitute_closure_loads(body_value, substitutions);
    vf::JsonValue::Object result;
    result["kind"] = vf::JsonValue("block_expr");
    result["body"] = std::move(body_value);
    result["type"] = field(call, "type", "higher-order call");
    return vf::JsonValue(std::move(result));
}

inline void rewrite_immediate_closure_calls(
    vf::JsonValue& value,
    const std::map<std::string, const vf::JsonValue::Object*>& functions,
    std::uint64_t& next_invocation
) {
    if (value.is_array()) {
        for (auto& item : value.as_array()) {
            rewrite_immediate_closure_calls(item, functions, next_invocation);
        }
        return;
    }
    if (!value.is_object()) return;
    auto& object = value.as_object();
    const auto initial_kind = object.find("kind");
    if (initial_kind != object.end() && initial_kind->second.is_string() &&
        initial_kind->second.as_string() == "call") {
        if (const auto replacement = resolve_immediate_closure_call(
                object, functions, next_invocation)) {
            value = *replacement;
            rewrite_immediate_closure_calls(value, functions, next_invocation);
            return;
        }
    }
    for (auto& [name, child] : object) {
        (void)name;
        rewrite_immediate_closure_calls(child, functions, next_invocation);
    }
    const auto kind = object.find("kind");
    if (kind == object.end() || !kind->second.is_string() || kind->second.as_string() != "call") return;
    if (const auto replacement = resolve_immediate_closure_call(object, functions, next_invocation)) {
        value = *replacement;
        rewrite_immediate_closure_calls(value, functions, next_invocation);
    } else if (const auto replacement = resolve_higher_order_call(object, functions, next_invocation)) {
        value = *replacement;
        rewrite_immediate_closure_calls(value, functions, next_invocation);
    }
}

inline bool function_value_type(const vf::JsonValue::Object& expression) {
    const auto type = expression.find("type");
    return type != expression.end() && type->second.is_string() &&
        type->second.as_string().find("->") != std::string::npos;
}

inline void substitute_stored_function_loads(
    vf::JsonValue& value,
    const std::map<std::string, vf::JsonValue>& stored
) {
    if (value.is_array()) {
        for (auto& item : value.as_array()) substitute_stored_function_loads(item, stored);
        return;
    }
    if (!value.is_object()) return;
    auto& object = value.as_object();
    const auto kind = object.find("kind");
    const auto name = object.find("name");
    if (kind != object.end() && kind->second.is_string() && kind->second.as_string() == "load" &&
        name != object.end() && name->second.is_string()) {
        const auto replacement = stored.find(name->second.as_string());
        if (replacement != stored.end()) {
            value = replacement->second;
            return;
        }
    }
    for (auto& [field_name, child] : object) {
        if (field_name != "body") substitute_stored_function_loads(child, stored);
    }
}

inline void rewrite_stored_closures_in_value(
    vf::JsonValue& value,
    std::map<std::string, vf::JsonValue> visible,
    std::uint64_t& next_capture
);

inline void rewrite_stored_closures_in_body(
    vf::JsonValue::Array& body,
    std::map<std::string, vf::JsonValue> visible,
    std::uint64_t& next_capture
) {
    vf::JsonValue::Array rewritten;
    for (auto& statement_value : body) {
        if (!statement_value.is_object()) {
            rewritten.push_back(std::move(statement_value));
            continue;
        }
        auto& statement = statement_value.as_object();
        const std::string kind = string_field(statement, "kind", "stored closure statement");
        if (kind == "store_binding") {
            const std::string name = string_field(statement, "name", "stored closure binding");
            auto& raw_value = statement.at("value");
            substitute_stored_function_loads(raw_value, visible);
            if (raw_value.is_object() && function_value_type(raw_value.as_object())) {
                vf::JsonValue stored_value = raw_value;
                auto& stored_object = stored_value.as_object();
                if (string_field(stored_object, "kind", "stored function value") == "call") {
                    const auto& named = array_of(
                        field(stored_object, "named_args", "stored closure call"),
                        "stored closure named args");
                    const auto& spread = array_of(
                        field(stored_object, "spread_args", "stored closure call"),
                        "stored closure spread args");
                    if (!named.empty() || !spread.empty()) {
                        rewritten.push_back(std::move(statement_value));
                        visible.erase(name);
                        continue;
                    }
                    auto& args = stored_object.at("args").as_array();
                    for (std::size_t index = 0; index < args.size(); ++index) {
                        const std::string hidden = "$closure$" + name + "$" +
                            std::to_string(next_capture++);
                        vf::JsonValue::Object capture;
                        capture["kind"] = vf::JsonValue("store_binding");
                        capture["name"] = vf::JsonValue(hidden);
                        capture["type"] = field(
                            object_of(args[index], "stored closure argument"),
                            "type", "stored closure argument");
                        capture["update"] = vf::JsonValue(false);
                        capture["value"] = args[index];
                        rewritten.emplace_back(std::move(capture));
                        vf::JsonValue::Object load;
                        load["kind"] = vf::JsonValue("load");
                        load["name"] = vf::JsonValue(hidden);
                        load["type"] = field(
                            object_of(args[index], "stored closure argument"),
                            "type", "stored closure argument");
                        args[index] = vf::JsonValue(std::move(load));
                    }
                }
                visible[name] = std::move(stored_value);
                continue;
            }
            visible.erase(name);
        } else {
            substitute_stored_function_loads(statement_value, visible);
        }
        rewrite_stored_closures_in_value(statement_value, visible, next_capture);
        rewritten.push_back(std::move(statement_value));
    }
    body = std::move(rewritten);
}

inline void rewrite_stored_closures_in_value(
    vf::JsonValue& value,
    std::map<std::string, vf::JsonValue> visible,
    std::uint64_t& next_capture
) {
    if (value.is_array()) {
        for (auto& item : value.as_array()) {
            rewrite_stored_closures_in_value(item, visible, next_capture);
        }
        return;
    }
    if (!value.is_object()) return;
    auto& object = value.as_object();
    auto body = object.find("body");
    if (body != object.end() && body->second.is_array()) {
        rewrite_stored_closures_in_body(body->second.as_array(), std::move(visible), next_capture);
        return;
    }
    for (auto& [name, child] : object) {
        (void)name;
        rewrite_stored_closures_in_value(child, visible, next_capture);
    }
}

inline std::optional<vf::JsonValue> specialize_stored_closures(const vf::JsonValue& typed_ir) {
    if (!typed_ir.is_object()) return std::nullopt;
    vf::JsonValue rewritten = typed_ir;
    std::uint64_t next_capture = 0;
    rewrite_stored_closures_in_value(rewritten, {}, next_capture);
    return next_capture == 0 ? std::nullopt : std::optional<vf::JsonValue>(std::move(rewritten));
}

inline std::optional<vf::JsonValue> specialize_immediate_closures(const vf::JsonValue& typed_ir) {
    if (!typed_ir.is_object()) return std::nullopt;
    const auto& module = typed_ir.as_object();
    const auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) return std::nullopt;
    std::map<std::string, const vf::JsonValue::Object*> functions;
    for (const auto& statement_value : body->second.as_array()) {
        if (!statement_value.is_object()) continue;
        const auto& statement = statement_value.as_object();
        const auto kind = statement.find("kind");
        const auto name = statement.find("name");
        if (kind != statement.end() && kind->second.is_string() && kind->second.as_string() == "function" &&
            name != statement.end() && name->second.is_string()) {
            functions[name->second.as_string()] = &statement;
        }
    }
    vf::JsonValue rewritten = typed_ir;
    std::uint64_t next_invocation = 0;
    rewrite_immediate_closure_calls(rewritten, functions, next_invocation);
    return rewritten;
}

inline bool contains_direct_call_to(const vf::JsonValue& value, const std::string& name) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) {
            if (contains_direct_call_to(item, name)) return true;
        }
        return false;
    }
    if (!value.is_object()) return false;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "call") {
        const auto callee = object.find("callee");
        if (callee != object.end() && callee->second.is_object()) {
            const auto& callee_object = callee->second.as_object();
            const auto callee_kind = callee_object.find("kind");
            const auto callee_name = callee_object.find("name");
            if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                callee_kind->second.as_string() == "load" &&
                callee_name != callee_object.end() && callee_name->second.is_string() &&
                callee_name->second.as_string() == name) return true;
        }
    }
    for (const auto& [field_name, child] : object) {
        if (field_name != "params" && contains_direct_call_to(child, name)) return true;
    }
    return false;
}

inline void collect_load_names(const vf::JsonValue& value, std::set<std::string>& names) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) collect_load_names(item, names);
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    const auto name = object.find("name");
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "load" &&
        name != object.end() && name->second.is_string()) {
        names.insert(name->second.as_string());
    }
    for (const auto& [field_name, child] : object) {
        if (field_name != "params") collect_load_names(child, names);
    }
}

inline void rewrite_direct_call_target(
    vf::JsonValue& value,
    const std::string& old_name,
    const std::string& new_name,
    const std::vector<vf::JsonValue>& capture_arguments
) {
    if (value.is_array()) {
        for (auto& item : value.as_array()) {
            rewrite_direct_call_target(item, old_name, new_name, capture_arguments);
        }
        return;
    }
    if (!value.is_object()) return;
    auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "call") {
        auto callee = object.find("callee");
        if (callee != object.end() && callee->second.is_object()) {
            auto& callee_object = callee->second.as_object();
            const auto callee_kind = callee_object.find("kind");
            auto callee_name = callee_object.find("name");
            if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                callee_kind->second.as_string() == "load" &&
                callee_name != callee_object.end() && callee_name->second.is_string() &&
                callee_name->second.as_string() == old_name) {
                callee_name->second = vf::JsonValue(new_name);
                auto& args = object.at("args").as_array();
                args.insert(args.begin(), capture_arguments.begin(), capture_arguments.end());
                auto argument_types = object.find("arg_types");
                if (argument_types != object.end() && argument_types->second.is_array()) {
                    vf::JsonValue::Array types;
                    for (const auto& capture : capture_arguments) {
                        types.push_back(field(
                            object_of(capture, "capture argument"),
                            "type", "capture argument"));
                    }
                    auto& existing = argument_types->second.as_array();
                    existing.insert(existing.begin(), types.begin(), types.end());
                }
            }
        }
    }
    for (auto& [field_name, child] : object) {
        if (field_name != "callee" && field_name != "params") {
            rewrite_direct_call_target(
                child, old_name, new_name, capture_arguments);
        }
    }
}

inline std::optional<vf::JsonValue> specialize_recursive_local_functions(
    const vf::JsonValue& typed_ir
) {
    if (!typed_ir.is_object()) return std::nullopt;
    vf::JsonValue rewritten = typed_ir;
    auto& module = rewritten.as_object();
    auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) return std::nullopt;
    vf::JsonValue::Array hoisted_functions;
    std::uint64_t next_function = 0;
    for (auto& outer_value : body->second.as_array()) {
        if (!outer_value.is_object()) continue;
        auto& outer = outer_value.as_object();
        if (string_field(outer, "kind", "outer function") != "function") continue;
        auto& outer_body = outer.at("body").as_object().at("body").as_array();
        std::map<std::string, std::string> visible;
        for (const auto& parameter_value : outer.at("params").as_array()) {
            const auto& parameter = object_of(parameter_value, "outer parameter");
            visible[string_field(parameter, "name", "outer parameter")] =
                string_field(parameter, "type", "outer parameter");
        }
        std::set<std::string> remove_names;
        for (const auto& statement_value : outer_body) {
            if (!statement_value.is_object()) continue;
            const auto& statement = statement_value.as_object();
            const std::string statement_kind = string_field(
                statement, "kind", "outer function statement");
            if (statement_kind == "store_binding") {
                visible[string_field(statement, "name", "outer binding")] =
                    string_field(statement, "type", "outer binding");
                continue;
            }
            if (statement_kind != "function") continue;
            const std::string local_name = string_field(
                statement, "name", "recursive local function");
            if (!contains_direct_call_to(
                    field(statement, "body", "recursive local function"), local_name)) continue;

            std::set<std::string> shadowed;
            for (const auto& parameter_value : array_of(
                     field(statement, "params", "recursive local function"),
                     "recursive local params")) {
                shadowed.insert(string_field(
                    object_of(parameter_value, "recursive local param"),
                    "name", "recursive local param"));
            }
            collect_function_local_names(
                field(statement, "body", "recursive local function"), shadowed);
            std::set<std::string> loads;
            collect_load_names(field(statement, "body", "recursive local function"), loads);
            std::vector<std::pair<std::string, std::string>> captures;
            for (const auto& [capture_name, capture_type] : visible) {
                if (loads.count(capture_name) && !shadowed.count(capture_name)) {
                    captures.push_back({capture_name, capture_type});
                }
            }

            vf::JsonValue hoisted = statement_value;
            auto& function = hoisted.as_object();
            const std::string hoisted_name = "$nested$" +
                string_field(outer, "name", "outer function") + "$" + local_name + "$" +
                std::to_string(next_function++);
            function["name"] = vf::JsonValue(hoisted_name);
            vf::JsonValue::Array capture_params;
            std::map<std::string, vf::JsonValue> substitutions;
            std::vector<vf::JsonValue> outer_capture_args;
            std::vector<vf::JsonValue> recursive_capture_args;
            for (const auto& [capture_name, capture_type] : captures) {
                const std::string hidden = "$capture$" + capture_name;
                vf::JsonValue::Object parameter;
                parameter["kind"] = vf::JsonValue("param");
                parameter["name"] = vf::JsonValue(hidden);
                parameter["type"] = vf::JsonValue(capture_type);
                parameter["default"] = vf::JsonValue(nullptr);
                parameter["variadic_positional"] = vf::JsonValue(false);
                parameter["variadic_named"] = vf::JsonValue(false);
                capture_params.emplace_back(std::move(parameter));
                vf::JsonValue::Object outer_load;
                outer_load["kind"] = vf::JsonValue("load");
                outer_load["name"] = vf::JsonValue(capture_name);
                outer_load["type"] = vf::JsonValue(capture_type);
                outer_capture_args.emplace_back(std::move(outer_load));
                vf::JsonValue::Object recursive_load;
                recursive_load["kind"] = vf::JsonValue("load");
                recursive_load["name"] = vf::JsonValue(hidden);
                recursive_load["type"] = vf::JsonValue(capture_type);
                substitutions[capture_name] = vf::JsonValue(recursive_load);
                recursive_capture_args.emplace_back(std::move(recursive_load));
            }
            auto& params = function.at("params").as_array();
            params.insert(params.begin(), capture_params.begin(), capture_params.end());
            substitute_closure_loads(function.at("body"), substitutions);
            rewrite_direct_call_target(
                function.at("body"), local_name, hoisted_name, recursive_capture_args);
            for (auto& outer_statement : outer_body) {
                if (&outer_statement == &statement_value) continue;
                rewrite_direct_call_target(
                    outer_statement, local_name, hoisted_name, outer_capture_args);
            }
            remove_names.insert(local_name);
            hoisted_functions.push_back(std::move(hoisted));
        }
        if (!remove_names.empty()) {
            vf::JsonValue::Array kept;
            for (auto& statement_value : outer_body) {
                if (statement_value.is_object()) {
                    const auto& statement = statement_value.as_object();
                    if (string_field(statement, "kind", "outer statement") == "function" &&
                        remove_names.count(string_field(
                            statement, "name", "recursive local function"))) continue;
                }
                kept.push_back(std::move(statement_value));
            }
            outer_body = std::move(kept);
        }
    }
    for (auto& function : hoisted_functions) {
        body->second.as_array().push_back(std::move(function));
    }
    return hoisted_functions.empty()
        ? std::nullopt
        : std::optional<vf::JsonValue>(std::move(rewritten));
}

inline std::optional<vf::JsonValue> resolve_direct_local_call(
    const vf::JsonValue::Object& call,
    const std::map<std::string, vf::JsonValue::Object>& local_functions,
    std::uint64_t& next_invocation,
    std::set<std::string>& invoked
) {
    const auto& callee = object_of(field(call, "callee", "local call"), "local callee");
    if (string_field(callee, "kind", "local callee") != "load") return std::nullopt;
    const std::string name = string_field(callee, "name", "local callee");
    const auto function = local_functions.find(name);
    if (function == local_functions.end()) return std::nullopt;
    const auto& named = array_of(field(call, "named_args", "local call"), "local named args");
    const auto& spread = array_of(field(call, "spread_args", "local call"), "local spread args");
    if (!spread.empty()) return std::nullopt;
    const auto& params = array_of(
        field(function->second, "params", "local function"), "local function params");
    const auto& args = array_of(field(call, "args", "local call"), "local call args");
    if (args.size() > params.size()) return std::nullopt;
    std::vector<std::optional<vf::JsonValue>> parameter_values(params.size());
    for (std::size_t index = 0; index < args.size(); ++index) {
        parameter_values[index] = args[index];
    }
    for (const auto& named_value : named) {
        const auto& argument = object_of(named_value, "local named argument");
        const std::string argument_name = string_field(
            argument, "name", "local named argument");
        const auto parameter = std::find_if(
            params.begin(), params.end(), [&](const vf::JsonValue& parameter_value) {
                return string_field(
                    object_of(parameter_value, "local function param"),
                    "name", "local function param") == argument_name;
            });
        if (parameter == params.end()) return std::nullopt;
        const auto index = static_cast<std::size_t>(parameter - params.begin());
        if (parameter_values[index]) return std::nullopt;
        parameter_values[index] = field(argument, "value", "local named argument");
    }
    const auto& function_block = object_of(
        field(function->second, "body", "local function"), "local function body");
    const auto& function_body = array_of(
        field(function_block, "body", "local function"), "local function statements");
    if (function_body.empty()) return std::nullopt;

    vf::JsonValue::Array body;
    std::map<std::string, vf::JsonValue> substitutions;
    for (std::size_t index = 0; index < params.size(); ++index) {
        const auto& parameter = object_of(params[index], "local function param");
        if (!parameter_values[index]) {
            const auto default_value = parameter.find("default");
            if (default_value == parameter.end() || default_value->second.is_null()) {
                return std::nullopt;
            }
            parameter_values[index] = default_value->second;
            substitute_closure_loads(*parameter_values[index], substitutions);
        }
        const std::string parameter_name = string_field(
            parameter, "name", "local function param");
        const std::string hidden = "$local$" + name + "$" +
            std::to_string(next_invocation++);
        vf::JsonValue::Object binding;
        binding["kind"] = vf::JsonValue("store_binding");
        binding["name"] = vf::JsonValue(hidden);
        binding["type"] = field(parameter, "type", "local function param");
        binding["update"] = vf::JsonValue(false);
        binding["value"] = *parameter_values[index];
        body.emplace_back(std::move(binding));
        vf::JsonValue::Object load;
        load["kind"] = vf::JsonValue("load");
        load["name"] = vf::JsonValue(hidden);
        load["type"] = field(parameter, "type", "local function param");
        substitutions[parameter_name] = vf::JsonValue(std::move(load));
    }
    for (const auto& statement : function_body) body.push_back(statement);
    vf::JsonValue body_value(std::move(body));
    substitute_closure_loads(body_value, substitutions);
    vf::JsonValue::Object result;
    result["kind"] = vf::JsonValue("block_expr");
    result["body"] = std::move(body_value);
    result["type"] = field(call, "type", "local call");
    invoked.insert(name);
    return vf::JsonValue(std::move(result));
}

inline void rewrite_direct_local_calls_in_value(
    vf::JsonValue& value,
    const std::map<std::string, vf::JsonValue::Object>& local_functions,
    std::uint64_t& next_invocation,
    std::set<std::string>& invoked
) {
    if (value.is_array()) {
        for (auto& item : value.as_array()) {
            rewrite_direct_local_calls_in_value(
                item, local_functions, next_invocation, invoked);
        }
        return;
    }
    if (!value.is_object()) return;
    auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "call") {
        if (const auto replacement = resolve_direct_local_call(
                object, local_functions, next_invocation, invoked)) {
            value = *replacement;
            return;
        }
    }
    for (auto& [field_name, child] : object) {
        if (field_name != "body") {
            rewrite_direct_local_calls_in_value(
                child, local_functions, next_invocation, invoked);
        }
    }
}

inline void rewrite_direct_local_calls_in_body(
    vf::JsonValue::Array& body,
    std::uint64_t& next_invocation
) {
    std::map<std::string, vf::JsonValue::Object> local_functions;
    for (const auto& statement_value : body) {
        if (!statement_value.is_object()) continue;
        const auto& statement = statement_value.as_object();
        if (string_field(statement, "kind", "local statement") == "function") {
            local_functions[string_field(statement, "name", "local function")] = statement;
        }
    }
    std::set<std::string> invoked;
    for (auto& statement_value : body) {
        if (!statement_value.is_object()) continue;
        auto& statement = statement_value.as_object();
        if (string_field(statement, "kind", "local statement") == "function") continue;
        rewrite_direct_local_calls_in_value(
            statement_value, local_functions, next_invocation, invoked);
    }
    if (!invoked.empty()) {
        vf::JsonValue::Array rewritten;
        for (auto& statement_value : body) {
            if (statement_value.is_object()) {
                const auto& statement = statement_value.as_object();
                if (string_field(statement, "kind", "local statement") == "function" &&
                    invoked.count(string_field(statement, "name", "local function"))) {
                    continue;
                }
            }
            rewritten.push_back(std::move(statement_value));
        }
        body = std::move(rewritten);
    }
    for (auto& statement_value : body) {
        if (!statement_value.is_object()) continue;
        auto& statement = statement_value.as_object();
        auto nested_body = statement.find("body");
        if (nested_body == statement.end() || !nested_body->second.is_object()) continue;
        auto& block = nested_body->second.as_object();
        auto statements = block.find("body");
        if (statements != block.end() && statements->second.is_array()) {
            rewrite_direct_local_calls_in_body(statements->second.as_array(), next_invocation);
        }
    }
}

inline std::optional<vf::JsonValue> specialize_direct_local_calls(const vf::JsonValue& typed_ir) {
    if (!typed_ir.is_object()) return std::nullopt;
    vf::JsonValue rewritten = typed_ir;
    auto& module = rewritten.as_object();
    auto body = module.find("body");
    if (body == module.end() || !body->second.is_array()) return std::nullopt;
    std::uint64_t next_invocation = 0;
    for (auto& statement_value : body->second.as_array()) {
        if (!statement_value.is_object()) continue;
        auto& statement = statement_value.as_object();
        if (string_field(statement, "kind", "module statement") != "function") continue;
        auto& block = statement.at("body").as_object();
        rewrite_direct_local_calls_in_body(block.at("body").as_array(), next_invocation);
    }
    return next_invocation == 0
        ? std::nullopt
        : std::optional<vf::JsonValue>(std::move(rewritten));
}

inline Module lower_monomorphic(const vf::JsonValue& typed_ir) {
    using namespace detail;
    const auto& module = object_of(typed_ir, "typed module");
    if (string_field(module, "kind", "typed module") != "typed_module") {
        throw LoweringFailure("unsupported typed IR root");
    }

    std::map<std::string, const vf::JsonValue::Object*> functions;
    FunctionSignatures signatures;
    std::vector<const vf::JsonValue::Object*> entry_statements;
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
                const bool complex_capable_fixed_vector =
                    parameter_type.rfind("[num:", 0) == 0 && parameter_type.back() == ']';
                const bool inferred_parameter = !elementwise_math_function && (parameter_type == "any" ||
                    parameter_type == "num" ||
                    complex_capable_fixed_vector ||
                    symbolic_vector_shape(parameter_type) ||
                    explicit_parameter_layout.kind == ValueKind::StringMultiset ||
                    (!known_scalar_parameter && !known_aggregate_parameter));
                signature.parameter_is_any.push_back(inferred_parameter);
                if (bool_field(parameter, "variadic_named", "param")) {
                    if (signature.variadic_named_index) {
                        throw LoweringFailure("direct machine IR supports one variadic named parameter");
                    }
                    signature.variadic_named_index = signature.parameters.size();
                    signature.parameters.push_back(
                        inferred_parameter_layout(statement, signature.parameter_names.back()));
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
                    if (inferred_parameter && complex_capable_fixed_vector) {
                        auto parameter_layout = explicit_parameter_layout;
                        const auto inferred_layout = inferred_parameter_layout(
                            statement, signature.parameter_names.back());
                        if (!is_record_layout(inferred_layout)) {
                            merge_inferred_layout(parameter_layout, inferred_layout);
                        }
                        signature.parameters.push_back(std::move(parameter_layout));
                    } else {
                        signature.parameters.push_back(
                            inferred_parameter
                                ? inferred_parameter_layout(statement, signature.parameter_names.back())
                                : explicit_parameter_layout);
                    }
                }
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
            if (elementwise_math_function) signature.result_is_any = false;
            signatures[name] = std::move(signature);
        }
        else if (kind == "store_binding" || kind == "update_attr" ||
                 kind == "update_index" || kind == "expr_stmt") {
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
        const auto stable_signatures = signatures;
        for (const auto& [name, function] : functions) {
            refine_forwarded_parameter_layouts(
                field(*function, "body", "function"), signatures[name], stable_signatures);
        }
        refine_callsite_parameter_layouts(typed_ir, signatures);
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

    std::map<std::string, std::vector<std::string>> function_callees;
    for (const auto& [name, function] : functions) {
        bool raises = false;
        std::vector<std::string> callees;
        collect_error_effects(field(*function, "body", "function"), raises, callees);
        function_callees[name] = std::move(callees);
        signatures[name].may_error = raises;
    }
    std::vector<std::string> reachability_worklist;
    bool entry_raises = false;
    for (const auto* statement : entry_statements) {
        collect_error_effects(*statement, entry_raises, reachability_worklist);
    }
    if (functions.count("::")) reachability_worklist.push_back("::");
    if (functions.count(".")) reachability_worklist.push_back(".");
    std::set<std::string> reachable_functions;
    while (!reachability_worklist.empty()) {
        const std::string name = std::move(reachability_worklist.back());
        reachability_worklist.pop_back();
        if (functions.find(name) == functions.end() || !reachable_functions.insert(name).second) {
            continue;
        }
        const auto callees = function_callees.find(name);
        if (callees != function_callees.end()) {
            reachability_worklist.insert(
                reachability_worklist.end(), callees->second.begin(), callees->second.end());
        }
    }
    bool effects_changed = true;
    while (effects_changed) {
        effects_changed = false;
        for (const auto& [name, callees] : function_callees) {
            if (signatures[name].may_error) continue;
            const bool propagated = std::any_of(callees.begin(), callees.end(), [&](const auto& callee) {
                const auto found = signatures.find(callee);
                return found != signatures.end() && found->second.may_error;
            });
            if (propagated) {
                signatures[name].may_error = true;
                effects_changed = true;
            }
        }
    }

    FunctionDisplayShapes function_displays;
    for (const auto& [name, signature] : signatures) {
        function_displays[name] = signature.result_display;
    }
    for (unsigned pass = 0; pass < 64; ++pass) {
        bool changed = false;
        const auto stable_displays = function_displays;
        for (const auto& [name, function] : functions) {
            const auto inferred = infer_function_display_shape(
                *function, signatures.at(name), stable_displays);
            if (!same_display_shape(inferred, function_displays[name])) {
                function_displays[name] = inferred;
                changed = true;
            }
        }
        if (!changed) break;
    }
    for (auto& [name, signature] : signatures) {
        const auto found = function_displays.find(name);
        if (found != function_displays.end()) signature.result_display = found->second;
    }

    StringPool strings;
    FunctionBuilder entry("$entry");
    DisplayEnvironment display_environment;
    for (const auto* statement : entry_statements) {
        if (string_field(*statement, "kind", "top-level statement") == "update_attr") {
            discover_bindings(*statement, entry, signatures);
        }
    }
    for (const auto* statement : entry_statements) {
        discover_bindings(*statement, entry, signatures);
    }
    const auto is_print_statement = [](const vf::JsonValue::Object& statement) {
        if (string_field(statement, "kind", "top-level statement") != "expr_stmt") return false;
        const auto& expression = object_of(
            field(statement, "expr", "top-level statement"), "top-level expression");
        if (string_field(expression, "kind", "top-level expression") != "call") return false;
        const auto& callee = object_of(
            field(expression, "callee", "top-level expression"), "top-level callee");
        return string_field(callee, "kind", "top-level callee") == "stdlib_function" &&
            string_field(callee, "name", "top-level callee") == "print";
    };
    const auto output_count = static_cast<std::uint32_t>(std::count_if(
        entry_statements.begin(), entry_statements.end(), [&](const auto* statement) {
            return is_print_statement(*statement);
        }));
    std::string custom_display_type;
    const auto custom_display_function = functions.find("::");
    if (custom_display_function != functions.end()) {
        const auto& params = array_of(
            field(*custom_display_function->second, "params", "display overload"),
            "display overload params");
        if (params.size() == 1) {
            custom_display_type = string_field(
                object_of(params.front(), "display overload param"),
                "type", "display overload param");
        }
    }
    DisplayEnvironment custom_display_environment;
    bool has_custom_display_output = false;
    if (!custom_display_type.empty()) {
        for (const auto* statement : entry_statements) {
            const std::string kind = string_field(*statement, "kind", "display scan statement");
            if (kind == "store_binding") {
                const auto& value = object_of(
                    field(*statement, "value", "display scan binding"), "display scan value");
                custom_display_environment[string_field(
                    *statement, "name", "display scan binding")] =
                    display_shape_from_expression(
                        value, custom_display_environment, &function_displays);
                continue;
            }
            if (!is_print_statement(*statement)) continue;
            const auto& call = object_of(
                field(*statement, "expr", "display scan print"), "display scan call");
            const auto& args = array_of(
                field(call, "args", "display scan print"), "display scan args");
            if (args.size() != 1) continue;
            const auto shape = display_shape_from_expression(
                object_of(args.front(), "display scan argument"),
                custom_display_environment,
                &function_displays);
            if (shape.kind == DisplayKind::Record && shape.label == custom_display_type) {
                has_custom_display_output = true;
            }
        }
    }
    const auto contains_complex_display = [&](const auto& self, const DisplayShape& shape) -> bool {
        if (shape.kind == DisplayKind::Complex) return true;
        return std::any_of(shape.children.begin(), shape.children.end(), [&](const auto& child) {
            return self(self, child.second);
        });
    };
    if (!has_custom_display_output) {
        DisplayEnvironment complex_environment;
        for (const auto* statement : entry_statements) {
            const std::string kind = string_field(*statement, "kind", "complex display scan");
            if (kind == "store_binding") {
                const auto& value = object_of(
                    field(*statement, "value", "complex display binding"), "complex display value");
                complex_environment[string_field(*statement, "name", "complex display binding")] =
                    display_shape_from_expression(value, complex_environment, &function_displays);
                continue;
            }
            if (!is_print_statement(*statement)) continue;
            const auto& call = object_of(
                field(*statement, "expr", "complex display print"), "complex display call");
            const auto& args = array_of(
                field(call, "args", "complex display print"), "complex display args");
            if (args.size() == 1 && contains_complex_display(
                    contains_complex_display,
                    display_shape_from_expression(
                        object_of(args.front(), "complex display argument"),
                        complex_environment,
                        &function_displays))) {
                has_custom_display_output = true;
                break;
            }
        }
    }
    if (has_custom_display_output) {
        for (const auto* statement : entry_statements) {
            const std::string kind = string_field(*statement, "kind", "top-level statement");
            if (kind == "store_binding") {
                const auto& value = object_of(
                    field(*statement, "value", "top-level binding"), "binding value");
                display_environment[string_field(*statement, "name", "top-level binding")] =
                    display_shape_from_expression(value, display_environment, &function_displays);
            }
            if (!is_print_statement(*statement)) {
                vf::JsonValue::Array single_statement;
                single_statement.emplace_back(*statement);
                lower_statements(
                    single_statement, entry, false, signatures, strings,
                    &display_environment, &function_displays);
                continue;
            }
            const auto& outer = object_of(
                field(*statement, "expr", "top-level print"), "top-level print call");
            const auto& args = array_of(
                field(outer, "args", "top-level print"), "top-level print args");
            const auto& printed = object_of(args.front(), "printed expression");
            const auto shape = display_shape_from_expression(
                printed, display_environment, &function_displays);
            if (shape.kind != DisplayKind::Record || shape.label != custom_display_type) {
                vf::JsonValue::Array single_statement;
                single_statement.emplace_back(*statement);
                lower_statements(
                    single_statement, entry, false, signatures, strings,
                    &display_environment, &function_displays);
                continue;
            }
            vf::JsonValue::Object callee;
            callee["kind"] = vf::JsonValue("load");
            callee["name"] = vf::JsonValue("::");
            callee["type"] = vf::JsonValue("any");
            vf::JsonValue::Array display_args;
            display_args.emplace_back(printed);
            vf::JsonValue::Object display_call;
            display_call["kind"] = vf::JsonValue("call");
            display_call["callee"] = vf::JsonValue(std::move(callee));
            display_call["args"] = vf::JsonValue(std::move(display_args));
            display_call["named_args"] = vf::JsonValue(vf::JsonValue::Array{});
            display_call["spread_args"] = vf::JsonValue(vf::JsonValue::Array{});
            display_call["type"] = vf::JsonValue("any");
            const auto layout = lower_expression(display_call, entry, signatures, strings);
            for (std::uint32_t component = 0; component < layout.width; ++component) {
                entry.emit({Opcode::Drop});
            }
        }
        emit_release_owned_values(entry);
        Instruction return_without_output;
        return_without_output.opcode = Opcode::ReturnValues;
        return_without_output.result_count = 0;
        entry.emit(std::move(return_without_output));
        Module lowered;
        lowered.entry = entry.finish();
        lowered.output_kind = OutputKind::None;
        lowered.output_count = output_count;
        for (const auto& [name, function] : functions) {
            if (!reachable_functions.count(name)) continue;
            try {
                lowered.functions.push_back(lower_function(*function, signatures, strings));
            } catch (const LoweringFailure& error) {
                throw LoweringFailure("in function " + name + ": " + error.what());
            }
        }
        lowered.string_data = std::move(strings.bytes);
        return lowered;
    }
    if (output_count > 1) {
        std::vector<OutputKind> outputs;
        std::vector<OutputToken> output_tokens;
        std::uint32_t output_components = 0;
        for (const auto* statement : entry_statements) {
            const std::string kind = string_field(*statement, "kind", "top-level statement");
            if (kind == "store_binding") {
                const std::string binding_name = string_field(*statement, "name", "top-level binding");
                const auto& value = object_of(field(*statement, "value", "top-level binding"), "binding value");
                display_environment[binding_name] =
                    display_shape_from_expression(value, display_environment, &function_displays);
                vf::JsonValue::Array single_statement;
                single_statement.emplace_back(*statement);
                lower_statements(single_statement, entry, false, signatures, strings);
                continue;
            }
            if (kind == "update_attr" || kind == "update_index") {
                vf::JsonValue::Array single_statement;
                single_statement.emplace_back(*statement);
                lower_statements(single_statement, entry, false, signatures, strings);
                continue;
            }
            if (!is_print_statement(*statement)) {
                vf::JsonValue::Array single_statement;
                single_statement.emplace_back(*statement);
                lower_statements(single_statement, entry, false, signatures, strings);
                continue;
            }
            const auto& outer = object_of(field(*statement, "expr", "top-level expression"), "top-level call");
            const auto& callee = object_of(field(outer, "callee", "top-level call"), "top-level callee");
            if (string_field(outer, "kind", "top-level expression") != "call" ||
                string_field(callee, "kind", "top-level callee") != "stdlib_function" ||
                string_field(callee, "name", "top-level callee") != "print") {
                throw LoweringFailure("machine IR currently requires top-level print calls");
            }
            const auto& args = array_of(field(outer, "args", "top-level print"), "top-level print args");
            if (args.size() != 1) throw LoweringFailure("machine IR print requires one argument");
            const auto& printed_expression = object_of(args.front(), "printed expression");
            auto display_shape =
                display_shape_from_expression(
                    printed_expression, display_environment, &function_displays);
            auto printed_layout = lower_print_expression(
                printed_expression, entry, signatures, strings, &display_shape);
            if (printed_layout.kind == ValueKind::Complex) {
                printed_layout = emit_complex_string(entry, strings);
                display_shape = {DisplayKind::String, {}};
            }
            if (printed_layout.kind == ValueKind::String) {
                display_shape = {DisplayKind::String, {}};
            }
            if (display_width(display_shape) != printed_layout.width) {
                display_shape = display_shape_from_layout(printed_layout);
            }
            if (display_width(display_shape) != printed_layout.width) {
                throw LoweringFailure("machine IR display shape does not match value layout");
            }
            if (printed_layout.width == 1 && printed_layout.kind == ValueKind::Numeric) {
                outputs.push_back(display_shape.kind == DisplayKind::Bit
                    ? OutputKind::StructuredSequence : OutputKind::F64);
            } else if (printed_layout.width == 2 && printed_layout.kind == ValueKind::String) {
                ensure_independent_value(printed_expression, printed_layout, entry, signatures);
                outputs.push_back(OutputKind::String);
            } else if (printed_layout.kind == ValueKind::Null ||
                       printed_layout.kind == ValueKind::Complex ||
                       printed_layout.kind == ValueKind::Aggregate) {
                ensure_independent_value(printed_expression, printed_layout, entry, signatures);
                outputs.push_back(OutputKind::StructuredSequence);
            } else {
                throw LoweringFailure(
                    "multiple machine IR outputs require displayable core values");
            }
            append_display_tokens(display_shape, output_tokens);
            output_tokens.push_back({OutputTokenKind::Text, "\n"});
            output_components += printed_layout.width;
        }
        emit_release_owned_values(entry);
        Instruction return_outputs;
        return_outputs.opcode = Opcode::ReturnValues;
        return_outputs.result_count = output_components;
        entry.emit(std::move(return_outputs));

        Module lowered;
        lowered.entry = entry.finish();
        const bool structured = std::any_of(outputs.begin(), outputs.end(), [](const auto kind) {
            return kind == OutputKind::StructuredSequence;
        });
        lowered.output_kind = structured ? OutputKind::StructuredSequence
            : std::all_of(outputs.begin(), outputs.end(), [](const auto kind) {
            return kind == OutputKind::F64;
        }) ? OutputKind::MultipleF64 : OutputKind::MixedSequence;
        lowered.output_count = output_count;
        lowered.outputs = std::move(outputs);
        if (structured) lowered.output_tokens = std::move(output_tokens);
        for (const auto& [name, function] : functions) {
            if (!reachable_functions.count(name)) continue;
            try {
                lowered.functions.push_back(lower_function(*function, signatures, strings));
            } catch (const LoweringFailure& error) {
                throw LoweringFailure("in function " + name + ": " + error.what());
            }
        }
        lowered.string_data = std::move(strings.bytes);
        return lowered;
    }
    const vf::JsonValue::Object* output = nullptr;
    for (const auto* statement : entry_statements) {
        const std::string kind = string_field(*statement, "kind", "top-level statement");
        if (kind == "store_binding") {
            if (output) throw LoweringFailure("top-level binding cannot follow output");
            const std::string binding_name = string_field(*statement, "name", "top-level binding");
            const auto& value = object_of(field(*statement, "value", "top-level binding"), "binding value");
            display_environment[binding_name] =
                display_shape_from_expression(value, display_environment, &function_displays);
            vf::JsonValue::Array single_statement;
            single_statement.emplace_back(*statement);
            lower_statements(single_statement, entry, false, signatures, strings);
        } else if (kind == "update_attr" || kind == "update_index") {
            if (output) throw LoweringFailure("top-level update cannot follow output");
            vf::JsonValue::Array single_statement;
            single_statement.emplace_back(*statement);
            lower_statements(single_statement, entry, false, signatures, strings);
        } else if (is_print_statement(*statement)) {
            if (output) throw LoweringFailure("machine IR currently supports one top-level output");
            output = statement;
        } else {
            if (output) throw LoweringFailure("top-level effect cannot follow output");
            vf::JsonValue::Array single_statement;
            single_statement.emplace_back(*statement);
            lower_statements(single_statement, entry, false, signatures, strings);
        }
    }
    OutputKind output_kind = OutputKind::None;
    std::vector<OutputToken> output_tokens;
    if (!output) {
        emit_release_owned_values(entry);
        Instruction return_without_output;
        return_without_output.opcode = Opcode::ReturnValues;
        return_without_output.result_count = 0;
        entry.emit(std::move(return_without_output));
    } else {
        const auto& outer = object_of(field(*output, "expr", "top-level expression"), "top-level call");
        const auto& callee = object_of(field(outer, "callee", "top-level call"), "top-level callee");
        if (string_field(outer, "kind", "top-level expression") != "call" ||
            string_field(callee, "kind", "top-level callee") != "stdlib_function" ||
            string_field(callee, "name", "top-level callee") != "print") {
            throw LoweringFailure("machine IR currently requires one top-level print");
        }
        const auto& args = array_of(field(outer, "args", "top-level print"), "top-level print args");
        if (args.size() != 1) throw LoweringFailure("machine IR print requires one argument");
        const auto& printed_expression = object_of(args.front(), "printed expression");
        auto display_shape =
            display_shape_from_expression(
                printed_expression, display_environment, &function_displays);
        auto printed_layout = lower_print_expression(
            printed_expression, entry, signatures, strings, &display_shape);
        if (printed_layout.kind == ValueKind::Complex) {
            printed_layout = emit_complex_string(entry, strings);
            display_shape = {DisplayKind::String, {}};
        }
        if (printed_layout.kind == ValueKind::String) {
            display_shape = {DisplayKind::String, {}};
        }
        if (display_width(display_shape) != printed_layout.width) {
            display_shape = display_shape_from_layout(printed_layout);
        }
        if (display_width(display_shape) != printed_layout.width) {
            throw LoweringFailure("machine IR display shape does not match value layout");
        }
        const bool structured = display_shape.kind == DisplayKind::Bit ||
            printed_layout.kind == ValueKind::Null ||
            printed_layout.kind == ValueKind::Complex ||
            printed_layout.kind == ValueKind::Aggregate;
        if (!structured && printed_layout.kind != ValueKind::Numeric &&
            printed_layout.kind != ValueKind::String) {
            throw LoweringFailure("machine IR print requires a displayable core value");
        }
        ensure_independent_value(printed_expression, printed_layout, entry, signatures);
        emit_release_owned_values(entry);
        if (structured) {
            Instruction return_values;
            return_values.opcode = Opcode::ReturnValues;
            return_values.result_count = printed_layout.width;
            entry.emit(std::move(return_values));
        } else {
            emit_return(entry, printed_layout);
        }
        output_kind = structured ? OutputKind::StructuredSequence
            : printed_layout.kind == ValueKind::String ? OutputKind::String : OutputKind::F64;
        if (structured) {
            append_display_tokens(display_shape, output_tokens);
            output_tokens.push_back({OutputTokenKind::Text, "\n"});
        }
    }

    Module lowered;
    lowered.entry = entry.finish();
    lowered.output_kind = output_kind;
    lowered.output_count = output ? 1u : 0u;
    lowered.output_tokens = std::move(output_tokens);
    for (const auto& [name, function] : functions) {
        if (!reachable_functions.count(name)) continue;
        try {
            lowered.functions.push_back(lower_function(*function, signatures, strings));
        } catch (const LoweringFailure& error) {
            throw LoweringFailure("in function " + name + ": " + error.what());
        }
    }
    lowered.string_data = std::move(strings.bytes);
    return lowered;
}

inline bool instruction_intrinsically_raises(const Instruction& instruction) {
    if (instruction.opcode != Opcode::Call && instruction.may_error) return true;
    return instruction.opcode == Opcode::RethrowError ||
        instruction.opcode == Opcode::RaiseErrorValue ||
        instruction.opcode == Opcode::AssertTruthy ||
        instruction.opcode == Opcode::AssertTruthyString;
}

inline void refine_machine_error_effects(Module& module) {
    std::map<std::string, bool> raises;
    for (const auto& function : module.functions) {
        raises[function.name] = std::any_of(
            function.instructions.begin(), function.instructions.end(),
            [](const auto& instruction) {
                return instruction_intrinsically_raises(instruction);
            });
    }

    for (std::size_t pass = 0; pass <= module.functions.size(); ++pass) {
        bool changed = false;
        for (const auto& function : module.functions) {
            bool may_raise = raises.at(function.name);
            for (const auto& instruction : function.instructions) {
                if (instruction.opcode != Opcode::Call) continue;
                const auto callee = raises.find(instruction.symbol);
                may_raise = may_raise || (callee == raises.end()
                    ? instruction.may_error : callee->second);
            }
            if (may_raise != raises.at(function.name)) {
                raises[function.name] = may_raise;
                changed = true;
            }
        }
        if (!changed) break;
    }

    const auto refine = [&](Function& function) {
        for (auto& instruction : function.instructions) {
            if (instruction.opcode != Opcode::Call) continue;
            const auto callee = raises.find(instruction.symbol);
            if (callee != raises.end()) instruction.may_error = callee->second;
        }
        const auto known = raises.find(function.name);
        if (known != raises.end()) function.may_error = known->second;
    };
    refine(module.entry);
    for (auto& function : module.functions) refine(function);
}

inline bool is_small_numeric_inline_candidate(
    const Function& function,
    std::size_t instruction_limit = 64u
) {
    if (function.may_error || function.parameter_mask_local ||
        !function.owned_f64_list_locals.empty() || !function.owned_string_locals.empty() ||
        function.instructions.empty() ||
        function.instructions.size() > instruction_limit) {
        return false;
    }
    bool has_return = false;
    for (const auto& instruction : function.instructions) {
        switch (instruction.opcode) {
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
            case Opcode::LoadF64LocalsIndex:
            case Opcode::StoreF64LocalsIndex:
            case Opcode::Label:
            case Opcode::Jump:
            case Opcode::JumpIfFalse:
            case Opcode::JumpIfTrue:
                break;
            case Opcode::ReturnF64:
            case Opcode::ReturnValues:
                has_return = true;
                break;
            default:
                return false;
        }
    }
    return has_return;
}

inline void coalesce_scalar_local_copies(Function& function) {
    using Opcode = vkf::machine_ir::Opcode;
    // This pass repeatedly scans every instruction for every local. Large
    // fixed aggregates make that cost dominate compilation while gaining only
    // a handful of scalar copy removals. Keep it for ordinary functions and
    // leave large aggregate storage to indexed-addressing optimization.
    if (function.locals.size() > 4096u || function.instructions.size() > 200000u) return;
    const auto writes_local = [](const Instruction& instruction, std::uint32_t local) {
        if (instruction.opcode == Opcode::StoreLocal) return instruction.index == local;
        return instruction.opcode == Opcode::StoreF64LocalsIndex &&
            local >= instruction.index &&
            local - instruction.index < instruction.argument_count;
    };
    for (std::size_t pass = 0; pass < function.locals.size(); ++pass) {
        bool changed = false;
        for (std::uint32_t destination = static_cast<std::uint32_t>(
                 function.parameters.size());
             destination < function.locals.size(); ++destination) {
            std::size_t copy_store = function.instructions.size();
            std::size_t writes = 0;
            for (std::size_t position = 0; position < function.instructions.size(); ++position) {
                if (!writes_local(function.instructions[position], destination)) continue;
                ++writes;
                if (function.instructions[position].opcode == Opcode::StoreLocal) {
                    copy_store = position;
                }
            }
            if (writes != 1 || copy_store == 0 ||
                copy_store >= function.instructions.size() ||
                function.instructions[copy_store - 1].opcode != Opcode::LoadLocal) {
                continue;
            }
            const auto source = function.instructions[copy_store - 1].index;
            if (source == destination || source >= function.locals.size() ||
                function.local_classes[source] != function.local_classes[destination]) {
                continue;
            }
            bool unsupported_use = false;
            bool used_before_copy = false;
            std::size_t last_use = copy_store;
            for (std::size_t position = 0; position < function.instructions.size(); ++position) {
                const auto& instruction = function.instructions[position];
                const bool scalar_use = instruction.opcode == Opcode::LoadLocal &&
                    instruction.index == destination;
                const bool index_use = instruction.index_local &&
                    *instruction.index_local == destination;
                const bool fixed_storage_use =
                    (instruction.opcode == Opcode::LoadF64LocalsIndex ||
                     instruction.opcode == Opcode::StoreF64LocalsIndex) &&
                    destination >= instruction.index &&
                    destination - instruction.index < instruction.argument_count;
                const bool metadata_use = instruction.error_value_local == destination ||
                    instruction.error_type_local == destination;
                if (fixed_storage_use || metadata_use) unsupported_use = true;
                if (!scalar_use && !index_use) continue;
                if (position < copy_store) used_before_copy = true;
                last_use = std::max(last_use, position);
            }
            if (unsupported_use || used_before_copy) continue;
            bool source_changes = false;
            for (std::size_t position = copy_store + 1; position <= last_use; ++position) {
                if (writes_local(function.instructions[position], source)) {
                    source_changes = true;
                    break;
                }
            }
            if (source_changes) continue;
            for (auto& instruction : function.instructions) {
                if (instruction.opcode == Opcode::LoadLocal &&
                    instruction.index == destination) {
                    instruction.index = source;
                }
                if (instruction.index_local && *instruction.index_local == destination) {
                    instruction.index_local = source;
                }
            }
            function.instructions.erase(
                function.instructions.begin() + static_cast<std::ptrdiff_t>(copy_store - 1),
                function.instructions.begin() + static_cast<std::ptrdiff_t>(copy_store + 1));
            changed = true;
            break;
        }
        if (!changed) return;
    }
}

inline void coalesce_scalar_local_copies(Module& module) {
    coalesce_scalar_local_copies(module.entry);
    for (auto& function : module.functions) coalesce_scalar_local_copies(function);
}

inline void refine_integral_local_classes(Function& function) {
    using Opcode = vkf::machine_ir::Opcode;
    if (function.local_classes.size() != function.locals.size()) {
        throw LoweringFailure("machine IR local class table width mismatch");
    }
    const auto constant_is_i64 = [](double value) {
        constexpr double minimum = -9223372036854775808.0;
        constexpr double maximum_exclusive = 9223372036854775808.0;
        return std::isfinite(value) && value == std::floor(value) &&
            value >= minimum && value < maximum_exclusive;
    };

    for (std::size_t pass = 0; pass <= function.locals.size(); ++pass) {
        bool changed = false;
        const auto integral_expression_before = [&](const auto& self,
                                                     std::size_t end)
            -> std::optional<std::size_t> {
            if (end == 0) return std::nullopt;
            const auto& instruction = function.instructions[end - 1];
            if (instruction.opcode == Opcode::PushF64) {
                return constant_is_i64(instruction.f64)
                    ? std::optional<std::size_t>(end - 1) : std::nullopt;
            }
            if (instruction.opcode == Opcode::LoadLocal) {
                return instruction.index < function.local_classes.size() &&
                    function.local_classes[instruction.index] == ValueClass::I64
                    ? std::optional<std::size_t>(end - 1) : std::nullopt;
            }
            if (instruction.opcode == Opcode::IdentityF64 ||
                instruction.opcode == Opcode::NegateF64 ||
                instruction.opcode == Opcode::AbsF64) {
                return self(self, end - 1);
            }
            if (instruction.opcode == Opcode::AddF64 ||
                instruction.opcode == Opcode::SubtractF64 ||
                instruction.opcode == Opcode::MultiplyF64 ||
                instruction.opcode == Opcode::FloorDivideF64 ||
                instruction.opcode == Opcode::RemainderF64) {
                const auto right = self(self, end - 1);
                if (!right) return std::nullopt;
                return self(self, *right);
            }
            return std::nullopt;
        };
        for (std::size_t position = 0; position < function.instructions.size(); ++position) {
            const auto& instruction = function.instructions[position];
            if (instruction.opcode != Opcode::StoreLocal ||
                instruction.index >= function.local_classes.size() ||
                function.local_classes[instruction.index] != ValueClass::I64) {
                continue;
            }
            if (!integral_expression_before(integral_expression_before, position)) {
                function.local_classes[instruction.index] = ValueClass::F64;
                changed = true;
            }
        }
        if (!changed) return;
        if (pass == function.locals.size()) {
            throw LoweringFailure("machine IR integral local refinement did not converge");
        }
    }
}

inline void refine_integral_local_classes(Module& module) {
    refine_integral_local_classes(module.entry);
    for (auto& function : module.functions) refine_integral_local_classes(function);
}

inline void promote_integral_numeric_locals(Function& function) {
    using Opcode = vkf::machine_ir::Opcode;
    const auto supported = [](Opcode opcode) {
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
            case Opcode::RemainderF64:
            case Opcode::AbsF64:
            case Opcode::SqrtF64:
            case Opcode::OrderedLessF64:
            case Opcode::OrderedLessEqualF64:
            case Opcode::OrderedGreaterF64:
            case Opcode::OrderedGreaterEqualF64:
            case Opcode::OrderedEqualF64:
            case Opcode::UnorderedNotEqualF64:
            case Opcode::EqualBits:
            case Opcode::NotEqualBits:
            case Opcode::LoadF64LocalsIndex:
            case Opcode::StoreF64LocalsIndex:
            case Opcode::Label:
            case Opcode::Jump:
            case Opcode::JumpIfFalse:
            case Opcode::JumpIfTrue:
            case Opcode::ReturnF64:
            case Opcode::ReturnValues:
                return true;
            default:
                return false;
        }
    };
    if (function.local_classes.size() != function.locals.size() ||
        !std::all_of(function.instructions.begin(), function.instructions.end(),
                     [&](const auto& instruction) { return supported(instruction.opcode); })) {
        return;
    }
    const auto integral_constant = [](double value) {
        constexpr double minimum = -9223372036854775808.0;
        constexpr double maximum_exclusive = 9223372036854775808.0;
        return std::isfinite(value) && value == std::floor(value) &&
            value >= minimum && value < maximum_exclusive;
    };
    for (std::size_t local = function.parameters.size();
         local < function.local_classes.size(); ++local) {
        if (function.local_classes[local] == ValueClass::F64) {
            function.local_classes[local] = ValueClass::I64;
        }
    }
    for (std::size_t pass = 0; pass <= function.locals.size(); ++pass) {
        bool changed = false;
        std::vector<ValueClass> stack;
        const auto pop = [&]() {
            if (stack.empty()) throw LoweringFailure("integral promotion stack underflow");
            const auto value = stack.back();
            stack.pop_back();
            return value;
        };
        const auto range_is_i64 = [&](std::uint32_t base, std::uint32_t width) {
            if (base > function.local_classes.size() ||
                width > function.local_classes.size() - base) return false;
            return std::all_of(
                function.local_classes.begin() + base,
                function.local_classes.begin() + base + width,
                [](ValueClass value) { return value == ValueClass::I64; });
        };
        const auto reject_local = [&](std::uint32_t local) {
            if (local < function.local_classes.size() &&
                function.local_classes[local] == ValueClass::I64) {
                function.local_classes[local] = ValueClass::F64;
                changed = true;
            }
        };
        for (const auto& instruction : function.instructions) {
            switch (instruction.opcode) {
                case Opcode::PushF64:
                    stack.push_back(integral_constant(instruction.f64)
                        ? ValueClass::I64 : ValueClass::F64);
                    break;
                case Opcode::LoadLocal:
                    stack.push_back(function.local_classes.at(instruction.index));
                    break;
                case Opcode::StoreLocal: {
                    const auto value = pop();
                    if (value != ValueClass::I64) reject_local(instruction.index);
                    break;
                }
                case Opcode::Duplicate:
                    if (stack.empty()) throw LoweringFailure("integral promotion stack underflow");
                    stack.push_back(stack.back());
                    break;
                case Opcode::Drop:
                case Opcode::JumpIfFalse:
                case Opcode::JumpIfTrue:
                case Opcode::ReturnF64:
                    (void)pop();
                    break;
                case Opcode::ReturnValues:
                    for (std::uint32_t index = 0; index < instruction.result_count; ++index) {
                        (void)pop();
                    }
                    break;
                case Opcode::IdentityF64:
                case Opcode::NegateF64:
                case Opcode::AbsF64:
                    if (stack.empty()) throw LoweringFailure("integral promotion stack underflow");
                    break;
                case Opcode::LogicalNotF64:
                case Opcode::BooleanizeF64:
                    (void)pop();
                    stack.push_back(ValueClass::I64);
                    break;
                case Opcode::AddF64:
                case Opcode::SubtractF64:
                case Opcode::MultiplyF64:
                case Opcode::FloorDivideF64:
                case Opcode::RemainderF64: {
                    const auto right = pop();
                    const auto left = pop();
                    stack.push_back(left == ValueClass::I64 && right == ValueClass::I64
                        ? ValueClass::I64 : ValueClass::F64);
                    break;
                }
                case Opcode::DivideF64:
                    (void)pop();
                    (void)pop();
                    stack.push_back(ValueClass::F64);
                    break;
                case Opcode::SqrtF64:
                    (void)pop();
                    stack.push_back(ValueClass::F64);
                    break;
                case Opcode::OrderedLessF64:
                case Opcode::OrderedLessEqualF64:
                case Opcode::OrderedGreaterF64:
                case Opcode::OrderedGreaterEqualF64:
                case Opcode::OrderedEqualF64:
                case Opcode::UnorderedNotEqualF64:
                case Opcode::EqualBits:
                case Opcode::NotEqualBits:
                    (void)pop();
                    (void)pop();
                    stack.push_back(ValueClass::I64);
                    break;
                case Opcode::LoadF64LocalsIndex:
                    (void)pop();
                    stack.push_back(range_is_i64(instruction.index, instruction.argument_count)
                        ? ValueClass::I64 : ValueClass::F64);
                    break;
                case Opcode::StoreF64LocalsIndex: {
                    const auto value = pop();
                    (void)pop();
                    if (value != ValueClass::I64) {
                        for (std::uint32_t offset = 0;
                             offset < instruction.argument_count; ++offset) {
                            reject_local(instruction.index + offset);
                        }
                    }
                    break;
                }
                case Opcode::Label:
                case Opcode::Jump:
                    break;
                default:
                    throw LoweringFailure("unsupported integral promotion opcode");
            }
        }
        if (!changed) return;
        if (pass == function.locals.size()) {
            throw LoweringFailure("machine IR integral promotion did not converge");
        }
    }
}

inline void promote_integral_numeric_locals(Module& module) {
    promote_integral_numeric_locals(module.entry);
    for (auto& function : module.functions) promote_integral_numeric_locals(function);
}

inline void refresh_integral_fixed_indices(Function& function) {
    using Opcode = vkf::machine_ir::Opcode;
    // Recover direct index locals from stack-shaped IR after scalar
    // coalescing/inlining. The frontend records these eagerly when possible,
    // but compact expressions such as working.(left): working.(right) can keep
    // the index only as a stack operand. Preserving its origin enables the
    // backend's guarded-loop range proof.
    std::vector<std::optional<std::uint32_t>> origins;
    bool tracking_origins = true;
    const auto pop_origin = [&]() -> std::optional<std::uint32_t> {
        if (origins.empty()) return std::nullopt;
        const auto value = origins.back();
        origins.pop_back();
        return value;
    };
    for (auto& instruction : function.instructions) {
        if (!tracking_origins) {
            if (instruction.opcode == Opcode::Label) {
                origins.clear();
                tracking_origins = true;
            }
            continue;
        }
        switch (instruction.opcode) {
            case Opcode::PushF64:
                origins.push_back(std::nullopt);
                break;
            case Opcode::LoadLocal:
                origins.push_back(instruction.index);
                break;
            case Opcode::StoreLocal:
            case Opcode::Drop:
                (void)pop_origin();
                break;
            case Opcode::Duplicate:
                origins.push_back(origins.empty() ? std::nullopt : origins.back());
                break;
            case Opcode::IdentityF64:
                break;
            case Opcode::NegateF64:
            case Opcode::LogicalNotF64:
            case Opcode::BooleanizeF64:
            case Opcode::AbsF64:
            case Opcode::SqrtF64:
            case Opcode::SinF64:
            case Opcode::CosF64:
            case Opcode::ExpF64:
            case Opcode::LnF64:
                if (!origins.empty()) origins.back() = std::nullopt;
                break;
            case Opcode::AddF64:
            case Opcode::SubtractF64:
            case Opcode::MultiplyF64:
            case Opcode::DivideF64:
            case Opcode::FloorDivideF64:
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
                (void)pop_origin();
                if (!origins.empty()) origins.back() = std::nullopt;
                break;
            case Opcode::LoadF64LocalsIndex: {
                const auto index = pop_origin();
                if (!instruction.index_local && index) instruction.index_local = *index;
                origins.push_back(std::nullopt);
                break;
            }
            case Opcode::LoadF64ListIndex: {
                const auto index = pop_origin();
                (void)pop_origin();
                if (!instruction.index_local && index) instruction.index_local = *index;
                origins.push_back(std::nullopt);
                break;
            }
            case Opcode::StoreF64LocalsIndex: {
                (void)pop_origin();
                const auto index = pop_origin();
                if (!instruction.index_local && index) instruction.index_local = *index;
                break;
            }
            case Opcode::StoreF64ListIndex: {
                (void)pop_origin();
                const auto index = pop_origin();
                if (!instruction.index_local && index) instruction.index_local = *index;
                break;
            }
            case Opcode::JumpIfFalse:
            case Opcode::JumpIfTrue:
                (void)pop_origin();
                break;
            case Opcode::Label:
                origins.clear();
                break;
            case Opcode::Jump:
                tracking_origins = origins.empty();
                origins.clear();
                break;
            case Opcode::ReturnF64:
            case Opcode::ReturnValues:
                origins.clear();
                break;
            default:
                // Unknown stack effects cannot safely preserve an origin.
                origins.clear();
                tracking_origins = false;
                break;
        }
    }
    for (auto& instruction : function.instructions) {
        if ((instruction.opcode != Opcode::LoadF64LocalsIndex &&
             instruction.opcode != Opcode::StoreF64LocalsIndex &&
             instruction.opcode != Opcode::LoadF64ListIndex &&
             instruction.opcode != Opcode::StoreF64ListIndex) ||
            !instruction.index_local ||
            *instruction.index_local >= function.local_classes.size()) {
            continue;
        }
        if (function.local_classes[*instruction.index_local] == ValueClass::I64) {
            instruction.index_is_integral = true;
        }
    }
}

inline void refresh_integral_fixed_indices(Module& module) {
    refresh_integral_fixed_indices(module.entry);
    for (auto& function : module.functions) refresh_integral_fixed_indices(function);
}

inline void inline_small_numeric_calls(Module& module) {
    std::map<std::string, const Function*> candidates;
    std::map<std::string, const Function*> aggregate_loop_candidates;
    for (const auto& function : module.functions) {
        if (is_small_numeric_inline_candidate(function)) {
            candidates.emplace(function.name, &function);
        }
        if (is_small_numeric_inline_candidate(function, 1024u)) {
            aggregate_loop_candidates.emplace(function.name, &function);
        }
    }

    auto inline_calls = [&](Function& caller) {
        const auto original_max_stack = caller.max_stack;
        std::uint32_t next_label = 0;
        for (const auto& instruction : caller.instructions) {
            if (instruction.opcode == Opcode::Label || instruction.opcode == Opcode::Jump ||
                instruction.opcode == Opcode::JumpIfFalse || instruction.opcode == Opcode::JumpIfTrue) {
                next_label = std::max(next_label, instruction.label + 1);
            }
        }
        std::vector<Instruction> rewritten;
        rewritten.reserve(caller.instructions.size());
        std::size_t inline_growth = 0;
        constexpr std::size_t inline_growth_budget = 4096;
        const auto is_in_loop = [&](std::size_t call_index) {
            for (std::size_t jump_index = call_index + 1;
                 jump_index < caller.instructions.size(); ++jump_index) {
                const auto& jump = caller.instructions[jump_index];
                if (jump.opcode != Opcode::Jump && jump.opcode != Opcode::JumpIfFalse &&
                    jump.opcode != Opcode::JumpIfTrue) {
                    continue;
                }
                for (std::size_t label_index = 0; label_index < call_index; ++label_index) {
                    const auto& label = caller.instructions[label_index];
                    if (label.opcode == Opcode::Label && label.label == jump.label) return true;
                }
            }
            return false;
        };
        for (std::size_t caller_index = 0; caller_index < caller.instructions.size(); ++caller_index) {
            const auto& call = caller.instructions[caller_index];
            const auto found = call.opcode == Opcode::Call ? candidates.find(call.symbol) : candidates.end();
            const auto aggregate_found = call.opcode == Opcode::Call
                ? aggregate_loop_candidates.find(call.symbol)
                : aggregate_loop_candidates.end();
            const auto alias_aggregate_candidate = [&]() {
                if (aggregate_found == aggregate_loop_candidates.end() ||
                    call.result_count <= 1u ||
                    call.argument_count != aggregate_found->second->parameters.size() ||
                    call.may_error || call.has_error_handler || call.uses_parameter_mask ||
                    aggregate_found->second->name == caller.name ||
                    !is_in_loop(caller_index) ||
                    rewritten.size() < call.argument_count) {
                    return false;
                }
                const Function& callee = *aggregate_found->second;
                if (callee.instructions.size() < call.result_count + 1u ||
                    callee.instructions.back().opcode != Opcode::ReturnValues ||
                    callee.instructions.back().result_count != call.result_count ||
                    inline_growth + callee.instructions.size() > inline_growth_budget) {
                    return false;
                }
                const auto argument_begin = rewritten.size() - call.argument_count;
                for (std::size_t index = argument_begin; index < rewritten.size(); ++index) {
                    if (rewritten[index].opcode != Opcode::LoadLocal) return false;
                }
                const std::size_t result_width = call.result_count;
                if (caller_index + 3u * result_width >= caller.instructions.size()) {
                    return false;
                }
                std::vector<std::uint32_t> temporaries(result_width);
                for (std::size_t offset = 0; offset < result_width; ++offset) {
                    const auto& store = caller.instructions[caller_index + 1u + offset];
                    if (store.opcode != Opcode::StoreLocal) return false;
                    temporaries[result_width - 1u - offset] = store.index;
                }
                for (std::size_t offset = 0; offset < result_width; ++offset) {
                    const auto& load = caller.instructions[
                        caller_index + 1u + result_width + offset];
                    const auto& store = caller.instructions[
                        caller_index + 1u + 2u * result_width + offset];
                    if (load.opcode != Opcode::LoadLocal ||
                        load.index != temporaries[offset] ||
                        store.opcode != Opcode::StoreLocal) {
                        return false;
                    }
                    const auto destination = caller.instructions[
                        caller_index + 3u * result_width - offset].index;
                    if (destination != rewritten[argument_begin + offset].index) {
                        return false;
                    }
                }
                const auto return_begin = callee.instructions.size() - result_width - 1u;
                for (std::size_t offset = 0; offset < result_width; ++offset) {
                    if (callee.instructions[return_begin + offset].opcode != Opcode::LoadLocal) {
                        return false;
                    }
                }
                return true;
            }();
            if (alias_aggregate_candidate) {
                const Function& callee = *aggregate_found->second;
                const auto argument_begin = rewritten.size() - call.argument_count;
                constexpr std::uint32_t unassigned_local =
                    std::numeric_limits<std::uint32_t>::max();
                std::vector<std::uint32_t> local_map(
                    callee.locals.size(), unassigned_local);
                for (std::uint32_t index = 0; index < call.argument_count; ++index) {
                    local_map[index] = rewritten[argument_begin + index].index;
                }
                const auto body_end = callee.instructions.size() - call.result_count - 1u;
                for (std::uint32_t offset = 0; offset < call.result_count; ++offset) {
                    const auto result_local =
                        callee.instructions[body_end + offset].index;
                    const auto destination = rewritten[argument_begin + offset].index;
                    if (local_map[result_local] != unassigned_local &&
                        local_map[result_local] != destination) {
                        throw LoweringFailure(
                            "aggregate loop inlining result aliases incompatible argument");
                    }
                    local_map[result_local] = destination;
                }
                rewritten.resize(argument_begin);
                for (std::uint32_t index = call.argument_count;
                     index < callee.locals.size(); ++index) {
                    if (local_map[index] != unassigned_local) continue;
                    local_map[index] = static_cast<std::uint32_t>(caller.locals.size());
                    caller.locals.push_back(
                        "$inline$" + callee.name + "$" + callee.locals[index]);
                    caller.local_classes.push_back(callee.local_classes.at(index));
                }
                std::map<std::uint32_t, std::uint32_t> labels;
                for (const auto& instruction : callee.instructions) {
                    if (instruction.opcode == Opcode::Label) {
                        labels.emplace(instruction.label, next_label++);
                    }
                }
                for (std::size_t position = 0; position < body_end; ++position) {
                    auto instruction = callee.instructions[position];
                    if (instruction.opcode == Opcode::LoadLocal ||
                        instruction.opcode == Opcode::StoreLocal) {
                        instruction.index = local_map.at(instruction.index);
                    }
                    if (instruction.opcode == Opcode::LoadF64LocalsIndex ||
                        instruction.opcode == Opcode::StoreF64LocalsIndex) {
                        const auto old_base = instruction.index;
                        instruction.index = local_map.at(old_base);
                        for (std::uint32_t offset = 1u;
                             offset < instruction.argument_count; ++offset) {
                            if (local_map.at(old_base + offset) !=
                                instruction.index + offset) {
                                throw LoweringFailure(
                                    "aggregate loop inlining requires contiguous fixed storage");
                            }
                        }
                    }
                    if (instruction.index_local) {
                        instruction.index_local = local_map.at(*instruction.index_local);
                    }
                    if (instruction.has_error_handler) {
                        instruction.error_value_local =
                            local_map.at(instruction.error_value_local);
                        instruction.error_type_local =
                            local_map.at(instruction.error_type_local);
                    }
                    if (instruction.opcode == Opcode::Label ||
                        instruction.opcode == Opcode::Jump ||
                        instruction.opcode == Opcode::JumpIfFalse ||
                        instruction.opcode == Opcode::JumpIfTrue) {
                        instruction.label = labels.at(instruction.label);
                    }
                    rewritten.push_back(std::move(instruction));
                }
                caller.max_stack = std::max(
                    caller.max_stack, original_max_stack + callee.max_stack);
                inline_growth += callee.instructions.size();
                caller_index += 3u * call.result_count;
                continue;
            }
            const auto aggregate_candidate = [&]() {
                if (found == candidates.end() || call.result_count <= 1 ||
                    call.result_count > 8 || call.argument_count != found->second->parameters.size() ||
                    call.may_error || call.has_error_handler || call.uses_parameter_mask ||
                    found->second->name == caller.name || !is_in_loop(caller_index)) {
                    return false;
                }
                const auto& instructions = found->second->instructions;
                if (instructions.empty() || instructions.back().opcode != Opcode::ReturnValues ||
                    instructions.back().result_count != call.result_count) {
                    return false;
                }
                return std::none_of(
                    instructions.begin(), instructions.end() - 1,
                    [](const auto& instruction) {
                        return instruction.opcode == Opcode::Call ||
                            instruction.opcode == Opcode::Label ||
                            instruction.opcode == Opcode::Jump ||
                            instruction.opcode == Opcode::JumpIfFalse ||
                            instruction.opcode == Opcode::JumpIfTrue ||
                            instruction.opcode == Opcode::ReturnF64 ||
                            instruction.opcode == Opcode::ReturnValues;
                    });
            }();
            if (aggregate_candidate) {
                const Function& callee = *found->second;
                bool direct_local_arguments = rewritten.size() >= call.argument_count;
                const auto argument_begin = rewritten.size() -
                    (direct_local_arguments ? call.argument_count : 0u);
                for (std::size_t index = argument_begin;
                     direct_local_arguments && index < rewritten.size(); ++index) {
                    if (rewritten[index].opcode != Opcode::LoadLocal) {
                        direct_local_arguments = false;
                    }
                }
                for (const auto& instruction : callee.instructions) {
                    if (instruction.opcode == Opcode::StoreLocal &&
                        instruction.index < callee.parameters.size()) {
                        direct_local_arguments = false;
                    }
                }
                if (direct_local_arguments && inline_growth +
                    callee.instructions.size() <= inline_growth_budget) {
                    std::vector<std::uint32_t> local_map(callee.locals.size());
                    for (std::uint32_t index = 0; index < call.argument_count; ++index) {
                        local_map[index] = rewritten[argument_begin + index].index;
                    }
                    rewritten.resize(argument_begin);
                    for (std::uint32_t index = call.argument_count;
                         index < callee.locals.size(); ++index) {
                        local_map[index] = static_cast<std::uint32_t>(caller.locals.size());
                        caller.locals.push_back("$inline$" + callee.name + "$" + callee.locals[index]);
                        caller.local_classes.push_back(callee.local_classes.at(index));
                    }
                    for (auto instruction : callee.instructions) {
                        if (instruction.opcode == Opcode::ReturnValues) break;
                        if (instruction.opcode == Opcode::LoadLocal ||
                            instruction.opcode == Opcode::StoreLocal) {
                            instruction.index = local_map.at(instruction.index);
                        }
                        rewritten.push_back(std::move(instruction));
                    }
                    caller.max_stack = std::max(
                        caller.max_stack, original_max_stack + callee.max_stack);
                    inline_growth += callee.instructions.size();
                    continue;
                }
            }
            const bool scalar_return = found != candidates.end() && std::any_of(
                found->second->instructions.begin(), found->second->instructions.end(),
                [](const auto& instruction) { return instruction.opcode == Opcode::ReturnF64; });
            if (found == candidates.end() || !is_in_loop(caller_index) ||
                found->second->name == caller.name || call.may_error ||
                call.has_error_handler || call.uses_parameter_mask || call.result_count != 1 ||
                !scalar_return || call.argument_count != found->second->parameters.size()) {
                rewritten.push_back(call);
                continue;
            }
            const Function& callee = *found->second;
            const std::uint32_t expected_mask = callee.parameters.size() >= 32
                ? std::numeric_limits<std::uint32_t>::max()
                : (1u << static_cast<std::uint32_t>(callee.parameters.size())) - 1u;
            if (call.provided_parameter_mask != expected_mask || inline_growth +
                callee.instructions.size() > inline_growth_budget) {
                rewritten.push_back(call);
                continue;
            }

            bool parameters_are_read_only = true;
            for (const auto& instruction : callee.instructions) {
                if (instruction.opcode == Opcode::StoreLocal &&
                    instruction.index < callee.parameters.size()) {
                    parameters_are_read_only = false;
                    break;
                }
            }
            bool direct_local_arguments = parameters_are_read_only &&
                rewritten.size() >= call.argument_count;
            const auto argument_begin = rewritten.size() -
                (direct_local_arguments ? call.argument_count : 0u);
            if (direct_local_arguments) {
                for (std::size_t index = argument_begin; index < rewritten.size(); ++index) {
                    if (rewritten[index].opcode != Opcode::LoadLocal) {
                        direct_local_arguments = false;
                        break;
                    }
                }
            }

            std::vector<std::uint32_t> local_map(callee.locals.size());
            const auto allocated_begin = direct_local_arguments
                ? static_cast<std::uint32_t>(callee.parameters.size()) : 0u;
            if (direct_local_arguments) {
                for (std::uint32_t index = 0; index < call.argument_count; ++index) {
                    local_map[index] = rewritten[argument_begin + index].index;
                }
                rewritten.resize(argument_begin);
            }
            for (std::uint32_t index = allocated_begin; index < callee.locals.size(); ++index) {
                local_map[index] = static_cast<std::uint32_t>(caller.locals.size());
                caller.locals.push_back("$inline$" + callee.name + "$" + callee.locals[index]);
                caller.local_classes.push_back(callee.local_classes.at(index));
            }
            if (!direct_local_arguments) {
                for (std::uint32_t index = call.argument_count; index > 0; --index) {
                    Instruction store;
                    store.opcode = Opcode::StoreLocal;
                    store.index = local_map[index - 1];
                    rewritten.push_back(std::move(store));
                }
            }

            const bool terminal_return = !callee.instructions.empty() &&
                callee.instructions.back().opcode == Opcode::ReturnF64 &&
                std::count_if(
                    callee.instructions.begin(), callee.instructions.end(),
                    [](const auto& instruction) {
                        return instruction.opcode == Opcode::ReturnF64;
                    }) == 1;
            if (terminal_return) {
                std::map<std::uint32_t, std::uint32_t> labels;
                for (const auto& instruction : callee.instructions) {
                    if (instruction.opcode == Opcode::Label) {
                        labels.emplace(instruction.label, next_label++);
                    }
                }
                for (auto instruction : callee.instructions) {
                    if (instruction.opcode == Opcode::ReturnF64) break;
                    if (instruction.opcode == Opcode::LoadLocal ||
                        instruction.opcode == Opcode::StoreLocal) {
                        instruction.index = local_map.at(instruction.index);
                    }
                    if (instruction.opcode == Opcode::Label ||
                        instruction.opcode == Opcode::Jump ||
                        instruction.opcode == Opcode::JumpIfFalse ||
                        instruction.opcode == Opcode::JumpIfTrue) {
                        instruction.label = labels.at(instruction.label);
                    }
                    rewritten.push_back(std::move(instruction));
                }
                caller.max_stack = std::max(
                    caller.max_stack, original_max_stack + callee.max_stack);
                inline_growth += callee.instructions.size();
                continue;
            }

            const bool store_result_directly = caller_index + 1 < caller.instructions.size() &&
                caller.instructions[caller_index + 1].opcode == Opcode::StoreLocal;
            const auto result_local = store_result_directly
                ? caller.instructions[++caller_index].index
                : static_cast<std::uint32_t>(caller.locals.size());
            if (!store_result_directly) {
                caller.locals.push_back("$inline$" + callee.name + "$result");
                caller.local_classes.push_back(ValueClass::F64);
            }

            std::map<std::uint32_t, std::uint32_t> labels;
            for (const auto& instruction : callee.instructions) {
                if (instruction.opcode == Opcode::Label) labels.emplace(instruction.label, next_label++);
            }
            const auto end_label = next_label++;
            for (auto instruction : callee.instructions) {
                if (instruction.opcode == Opcode::LoadLocal || instruction.opcode == Opcode::StoreLocal) {
                    instruction.index = local_map.at(instruction.index);
                }
                if (instruction.opcode == Opcode::Label || instruction.opcode == Opcode::Jump ||
                    instruction.opcode == Opcode::JumpIfFalse || instruction.opcode == Opcode::JumpIfTrue) {
                    instruction.label = labels.at(instruction.label);
                }
                if (instruction.opcode == Opcode::ReturnF64) {
                    instruction.opcode = Opcode::StoreLocal;
                    instruction.index = result_local;
                    rewritten.push_back(std::move(instruction));
                    instruction = Instruction{};
                    instruction.opcode = Opcode::Jump;
                    instruction.label = end_label;
                }
                rewritten.push_back(std::move(instruction));
            }
            Instruction end;
            end.opcode = Opcode::Label;
            end.label = end_label;
            rewritten.push_back(std::move(end));
            if (!store_result_directly) {
                Instruction load_result;
                load_result.opcode = Opcode::LoadLocal;
                load_result.index = result_local;
                rewritten.push_back(std::move(load_result));
            }
            caller.max_stack = std::max(
                caller.max_stack, original_max_stack + callee.max_stack);
            inline_growth += callee.instructions.size();
        }
        caller.instructions = std::move(rewritten);
    };

    inline_calls(module.entry);
    for (auto& function : module.functions) inline_calls(function);
}

// A dynamic-list result has value semantics, so returning a borrowed parameter
// normally clones the complete list. When the caller immediately discards that
// result, the clone and its matching release are pure overhead. Build a void
// specialization of exactly those callees: borrowed returns become a Drop,
// while genuinely owned returns are still released. Error transport and every
// side effect in the original function remain intact.
inline void specialize_discarded_dynamic_list_results(Module& module) {
    const auto cleanup_opcode = [](Opcode opcode) {
        return opcode == Opcode::ReleaseF64ListLocal ||
            opcode == Opcode::ReleaseStringLocal;
    };

    std::map<std::string, const Function*> dynamic_results;
    std::set<std::string> existing_names;
    for (const auto& function : module.functions) {
        existing_names.insert(function.name);
        if (function.result_is_dynamic_f64_list) {
            dynamic_results.emplace(function.name, &function);
        }
    }

    std::set<std::string> requested;
    const auto collect = [&](const Function& caller) {
        for (std::size_t index = 0; index + 1u < caller.instructions.size(); ++index) {
            const auto& call = caller.instructions[index];
            if (call.opcode == Opcode::Call && call.result_count == 1u &&
                caller.instructions[index + 1u].opcode == Opcode::ReleaseF64ListValue &&
                dynamic_results.count(call.symbol)) {
                requested.insert(call.symbol);
            }
        }
    };
    collect(module.entry);
    for (const auto& function : module.functions) collect(function);
    if (requested.empty()) return;

    std::map<std::string, std::string> specialized_names;
    std::vector<Function> specializations;
    specializations.reserve(requested.size());
    for (const auto& name : requested) {
        std::string specialized = name + "$discard_result";
        for (std::uint32_t suffix = 2u; existing_names.count(specialized); ++suffix) {
            specialized = name + "$discard_result_" + std::to_string(suffix);
        }
        existing_names.insert(specialized);
        specialized_names.emplace(name, specialized);

        Function clone = *dynamic_results.at(name);
        clone.name = specialized;
        clone.result_is_numeric_scalar = false;
        clone.result_is_dynamic_f64_list = false;

        std::vector<std::size_t> returns;
        for (std::size_t index = 0; index < clone.instructions.size(); ++index) {
            if (clone.instructions[index].opcode == Opcode::ReturnF64) {
                returns.push_back(index);
            }
        }
        for (auto cursor = returns.rbegin(); cursor != returns.rend(); ++cursor) {
            std::size_t return_index = *cursor;
            std::size_t producer_end = return_index;
            while (producer_end > 0u &&
                   cleanup_opcode(clone.instructions[producer_end - 1u].opcode)) {
                --producer_end;
            }
            if (producer_end > 0u &&
                clone.instructions[producer_end - 1u].opcode == Opcode::CloneF64List) {
                // CloneF64List is stack-neutral. Replacing it with Drop consumes
                // the borrowed value without freeing the caller-owned storage.
                clone.instructions[producer_end - 1u] = Instruction{};
                clone.instructions[producer_end - 1u].opcode = Opcode::Drop;
            } else {
                Instruction release;
                release.opcode = Opcode::ReleaseF64ListValue;
                clone.instructions.insert(
                    clone.instructions.begin() +
                        static_cast<std::ptrdiff_t>(return_index),
                    std::move(release));
                ++return_index;
            }
            clone.instructions[return_index] = Instruction{};
            clone.instructions[return_index].opcode = Opcode::ReturnValues;
            clone.instructions[return_index].result_count = 0u;
        }
        specializations.push_back(std::move(clone));
    }

    module.functions.insert(
        module.functions.end(),
        std::make_move_iterator(specializations.begin()),
        std::make_move_iterator(specializations.end()));

    const auto rewrite = [&](Function& caller) {
        for (std::size_t index = 0; index < caller.instructions.size();) {
            if (caller.instructions[index].opcode != Opcode::ReleaseF64ListValue) {
                ++index;
                continue;
            }
            std::size_t call_position = index;
            while (call_position > 0u &&
                   cleanup_opcode(caller.instructions[call_position - 1u].opcode)) {
                --call_position;
            }
            if (call_position == 0u) {
                ++index;
                continue;
            }
            auto& call = caller.instructions[call_position - 1u];
            const auto specialized = specialized_names.find(call.symbol);
            if (call.opcode != Opcode::Call || call.result_count != 1u ||
                specialized == specialized_names.end()) {
                ++index;
                continue;
            }
            call.symbol = specialized->second;
            call.result_count = 0u;
            caller.instructions.erase(
                caller.instructions.begin() + static_cast<std::ptrdiff_t>(index));
        }
    };
    rewrite(module.entry);
    for (auto& function : module.functions) rewrite(function);
}

inline void propagate_constant_numeric_parameters(Module& module) {
    struct ParameterConstant {
        bool seen = false;
        bool valid = true;
        double value = 0.0;
    };
    std::map<std::string, std::size_t> function_indices;
    std::vector<std::vector<ParameterConstant>> constants(module.functions.size());
    for (std::size_t index = 0; index < module.functions.size(); ++index) {
        function_indices.emplace(module.functions[index].name, index);
        constants[index].resize(module.functions[index].parameters.size());
        for (std::size_t parameter = 0; parameter < constants[index].size(); ++parameter) {
            constants[index][parameter].valid =
                parameter < module.functions[index].parameter_is_numeric_scalar.size() &&
                module.functions[index].parameter_is_numeric_scalar[parameter];
        }
    }
    const auto inspect_calls = [&](const Function& caller) {
        for (std::size_t position = 0; position < caller.instructions.size(); ++position) {
            const auto& call = caller.instructions[position];
            if (call.opcode != Opcode::Call) continue;
            const auto found = function_indices.find(call.symbol);
            if (found == function_indices.end()) continue;
            auto& parameters = constants[found->second];
            if (call.argument_count != parameters.size() || position < call.argument_count) {
                for (auto& parameter : parameters) parameter.valid = false;
                continue;
            }
            const auto argument_begin = position - call.argument_count;
            const bool arguments_are_direct_constants = std::all_of(
                caller.instructions.begin() + static_cast<std::ptrdiff_t>(argument_begin),
                caller.instructions.begin() + static_cast<std::ptrdiff_t>(position),
                [](const Instruction& argument) {
                    return argument.opcode == Opcode::PushF64;
                });
            if (!arguments_are_direct_constants) {
                // Without argument-boundary metadata, a multi-instruction
                // argument can place an unrelated PushF64 immediately before
                // the call. Never attribute that constant to another argument.
                for (auto& parameter : parameters) parameter.valid = false;
                continue;
            }
            for (std::size_t parameter = 0; parameter < parameters.size(); ++parameter) {
                auto& state = parameters[parameter];
                const auto& argument = caller.instructions[argument_begin + parameter];
                if (argument.opcode != Opcode::PushF64) {
                    state.valid = false;
                    continue;
                }
                if (!state.seen) {
                    state.seen = true;
                    state.value = argument.f64;
                } else if (state.value != argument.f64) {
                    state.valid = false;
                }
            }
        }
    };
    inspect_calls(module.entry);
    for (const auto& function : module.functions) inspect_calls(function);

    for (std::size_t function_index = 0; function_index < module.functions.size(); ++function_index) {
        auto& function = module.functions[function_index];
        auto& parameters = constants[function_index];
        if (!function.result_is_numeric_scalar) continue;
        for (std::size_t parameter = 0; parameter < parameters.size(); ++parameter) {
            auto& state = parameters[parameter];
            if (!state.seen || !state.valid) continue;
            const bool assigned = std::any_of(
                function.instructions.begin(), function.instructions.end(),
                [parameter](const auto& instruction) {
                    if (instruction.opcode == Opcode::StoreLocal) {
                        return instruction.index == parameter;
                    }
                    return instruction.opcode == Opcode::StoreF64LocalsIndex &&
                        parameter >= instruction.index &&
                        parameter - instruction.index < instruction.argument_count;
                });
            if (assigned) continue;
            for (auto& instruction : function.instructions) {
                if (instruction.opcode == Opcode::LoadLocal && instruction.index == parameter) {
                    instruction = Instruction{};
                    instruction.opcode = Opcode::PushF64;
                    instruction.f64 = state.value;
                }
            }
        }
    }
}

// Aggregate calls use the operand stack to move contiguous records: load every
// source field, then store the fields in reverse stack order.  Once a call is
// inlined and its result aliases its argument, that shuffle can become an exact
// self-copy.  Leaving it in a loop needlessly reloads and rewrites the complete
// record on every iteration (notably System in the N-body kernel).
inline void eliminate_identity_local_shuffles(Function& function) {
    using Opcode = vkf::machine_ir::Opcode;
    std::vector<Instruction> rewritten;
    rewritten.reserve(function.instructions.size());
    for (std::size_t index = 0; index < function.instructions.size();) {
        if (function.instructions[index].opcode != Opcode::LoadLocal) {
            rewritten.push_back(function.instructions[index++]);
            continue;
        }
        std::size_t load_end = index;
        while (load_end < function.instructions.size() &&
               function.instructions[load_end].opcode == Opcode::LoadLocal) {
            ++load_end;
        }
        const std::size_t count = load_end - index;
        std::size_t store_end = load_end;
        while (store_end < function.instructions.size() &&
               store_end - load_end < count &&
               function.instructions[store_end].opcode == Opcode::StoreLocal) {
            ++store_end;
        }
        bool identity = store_end - load_end == count;
        for (std::size_t offset = 0; identity && offset < count; ++offset) {
            identity = function.instructions[index + offset].index ==
                function.instructions[store_end - 1 - offset].index;
        }
        if (identity) {
            index = store_end;
            continue;
        }
        rewritten.push_back(function.instructions[index++]);
    }
    function.instructions = std::move(rewritten);
}

inline void eliminate_identity_local_shuffles(Module& module) {
    eliminate_identity_local_shuffles(module.entry);
    for (auto& function : module.functions) eliminate_identity_local_shuffles(function);
}

// An indexed assignment used only for its side effect is lowered through a
// $pipe_assignment temporary so the assigned value can continue through a
// pipe. When the continuation immediately drops that value, the temporary is
// an exact stack round trip:
//
//   value, store temp, load temp, store[index], load temp, drop
//
// Keeping it hides fixed-vector copy/shift loops from the native backends and
// adds two frame stores plus two frame loads per element. Preserve the indexed
// store and leave the original value on the operand stack until it consumes it.
inline void eliminate_discarded_index_assignment_temporaries(Function& function) {
    using Opcode = vkf::machine_ir::Opcode;
    std::vector<Instruction> rewritten;
    rewritten.reserve(function.instructions.size());
    for (std::size_t index = 0; index < function.instructions.size();) {
        if (index + 4u < function.instructions.size()) {
            const auto& temporary_store = function.instructions[index];
            const auto& temporary_load = function.instructions[index + 1u];
            const auto& indexed_store = function.instructions[index + 2u];
            const auto& result_load = function.instructions[index + 3u];
            const auto& result_drop = function.instructions[index + 4u];
            const auto temporary = temporary_store.index;
            const bool pipe_temporary = temporary < function.locals.size() &&
                function.locals[temporary].rfind("$pipe_assignment_", 0u) == 0u;
            const bool compatible_storage =
                indexed_store.opcode == Opcode::StoreF64LocalsIndex &&
                temporary < function.local_classes.size() &&
                indexed_store.index <= function.local_classes.size() &&
                indexed_store.argument_count <=
                    function.local_classes.size() - indexed_store.index &&
                std::all_of(
                    function.local_classes.begin() + indexed_store.index,
                    function.local_classes.begin() +
                        indexed_store.index + indexed_store.argument_count,
                    [&](ValueClass value_class) {
                        return value_class == function.local_classes[temporary];
                    });
            if (temporary_store.opcode == Opcode::StoreLocal && pipe_temporary &&
                temporary_load.opcode == Opcode::LoadLocal &&
                temporary_load.index == temporary &&
                result_load.opcode == Opcode::LoadLocal &&
                result_load.index == temporary &&
                result_drop.opcode == Opcode::Drop && compatible_storage) {
                rewritten.push_back(indexed_store);
                index += 5u;
                continue;
            }
        }
        rewritten.push_back(function.instructions[index++]);
    }
    function.instructions = std::move(rewritten);
}

inline void eliminate_discarded_index_assignment_temporaries(Module& module) {
    eliminate_discarded_index_assignment_temporaries(module.entry);
    for (auto& function : module.functions) {
        eliminate_discarded_index_assignment_temporaries(function);
    }
}

// Pipe blocks create continuation labels even when no branch targets them.
// Removing these fall-through-only labels exposes the underlying counted-loop
// shape without changing control flow or error-handler destinations.
inline void eliminate_unreferenced_labels(Function& function) {
    using Opcode = vkf::machine_ir::Opcode;
    std::set<std::uint32_t> referenced;
    for (const auto& instruction : function.instructions) {
        if (instruction.opcode == Opcode::Jump ||
            instruction.opcode == Opcode::JumpIfFalse ||
            instruction.opcode == Opcode::JumpIfTrue ||
            instruction.opcode == Opcode::JumpIfParameterProvided ||
            instruction.has_error_handler) {
            referenced.insert(instruction.label);
        }
    }
    function.instructions.erase(
        std::remove_if(
            function.instructions.begin(), function.instructions.end(),
            [&](const Instruction& instruction) {
                return instruction.opcode == Opcode::Label &&
                    !referenced.count(instruction.label);
            }),
        function.instructions.end());
}

inline void eliminate_unreferenced_labels(Module& module) {
    eliminate_unreferenced_labels(module.entry);
    for (auto& function : module.functions) eliminate_unreferenced_labels(function);
}

inline void propagate_constant_numeric_locals(Function& function) {
    // Like scalar-copy coalescing, this fixed-point scan is profitable for
    // normal functions but pathological when a large fixed aggregate expands
    // into thousands of storage locals.
    if (function.locals.size() > 4096u || function.instructions.size() > 200000u) return;
    for (;;) {
        bool changed = false;
        for (std::uint32_t local = static_cast<std::uint32_t>(
                 function.parameters.size());
             local < function.locals.size(); ++local) {
            std::size_t store_position = function.instructions.size();
            std::size_t writes = 0;
            bool metadata_use = false;
            for (std::size_t position = 0;
                 position < function.instructions.size(); ++position) {
                const auto& instruction = function.instructions[position];
                if (instruction.opcode == Opcode::StoreLocal &&
                    instruction.index == local) {
                    ++writes;
                    store_position = position;
                }
                if ((instruction.opcode == Opcode::LoadF64LocalsIndex ||
                     instruction.opcode == Opcode::StoreF64LocalsIndex) &&
                    local >= instruction.index &&
                    local - instruction.index < instruction.argument_count) {
                    ++writes;
                }
                metadata_use = metadata_use ||
                    (instruction.index_local && *instruction.index_local == local) ||
                    instruction.error_value_local == local ||
                    instruction.error_type_local == local;
            }
            if (writes != 1u || metadata_use || store_position == 0u ||
                store_position >= function.instructions.size() ||
                function.instructions[store_position - 1u].opcode != Opcode::PushF64) {
                continue;
            }
            const double value = function.instructions[store_position - 1u].f64;
            for (auto& instruction : function.instructions) {
                if (instruction.opcode != Opcode::LoadLocal ||
                    instruction.index != local) {
                    continue;
                }
                instruction = Instruction{};
                instruction.opcode = Opcode::PushF64;
                instruction.f64 = value;
            }
            function.instructions.erase(
                function.instructions.begin() +
                    static_cast<std::ptrdiff_t>(store_position - 1u),
                function.instructions.begin() +
                    static_cast<std::ptrdiff_t>(store_position + 1u));
            changed = true;
            break;
        }
        if (!changed) return;
    }
}

inline void propagate_constant_numeric_locals(Module& module) {
    propagate_constant_numeric_locals(module.entry);
    for (auto& function : module.functions) {
        propagate_constant_numeric_locals(function);
    }
}

inline void unroll_small_constant_loops(Function& function) {
    for (unsigned pass = 0; pass < 64u; ++pass) {
        bool changed = false;
        std::uint32_t next_label = 0;
        for (const auto& instruction : function.instructions) {
            if (instruction.opcode == Opcode::Label ||
                instruction.opcode == Opcode::Jump ||
                instruction.opcode == Opcode::JumpIfFalse ||
                instruction.opcode == Opcode::JumpIfTrue) {
                next_label = std::max(next_label, instruction.label + 1u);
            }
        }
        for (std::size_t label_position = 0;
             label_position + 5u < function.instructions.size(); ++label_position) {
            const auto& loop_label = function.instructions[label_position];
            if (loop_label.opcode != Opcode::Label) continue;
            const auto& counter_load = function.instructions[label_position + 1u];
            const auto& end_value = function.instructions[label_position + 2u];
            const auto comparison = function.instructions[label_position + 3u].opcode;
            const auto& exit_jump = function.instructions[label_position + 4u];
            if (counter_load.opcode != Opcode::LoadLocal ||
                end_value.opcode != Opcode::PushF64 ||
                (comparison != Opcode::OrderedLessF64 &&
                 comparison != Opcode::OrderedLessEqualF64) ||
                exit_jump.opcode != Opcode::JumpIfFalse) {
                continue;
            }
            const auto counter = counter_load.index;
            std::size_t back_jump = function.instructions.size();
            for (std::size_t position = label_position + 5u;
                 position < function.instructions.size(); ++position) {
                if (function.instructions[position].opcode == Opcode::Jump &&
                    function.instructions[position].label == loop_label.label) {
                    back_jump = position;
                    break;
                }
            }
            if (back_jump < 4u || back_jump + 1u >= function.instructions.size() ||
                function.instructions[back_jump + 1u].opcode != Opcode::Label ||
                function.instructions[back_jump + 1u].label != exit_jump.label) {
                continue;
            }
            const auto& increment_load = function.instructions[back_jump - 4u];
            const auto& increment = function.instructions[back_jump - 3u];
            const auto increment_op = function.instructions[back_jump - 2u].opcode;
            const auto& increment_store = function.instructions[back_jump - 1u];
            if (increment_load.opcode != Opcode::LoadLocal ||
                increment_load.index != counter ||
                increment.opcode != Opcode::PushF64 || increment.f64 != 1.0 ||
                increment_op != Opcode::AddF64 ||
                increment_store.opcode != Opcode::StoreLocal ||
                increment_store.index != counter || label_position == 0u ||
                function.instructions[label_position - 1u].opcode != Opcode::StoreLocal ||
                function.instructions[label_position - 1u].index != counter) {
                continue;
            }
            double start = 0.0;
            std::size_t initialization_begin = 0;
            if (label_position >= 2u &&
                function.instructions[label_position - 2u].opcode == Opcode::PushF64) {
                start = function.instructions[label_position - 2u].f64;
                initialization_begin = label_position - 2u;
            } else if (label_position >= 4u &&
                       function.instructions[label_position - 4u].opcode == Opcode::PushF64 &&
                       function.instructions[label_position - 3u].opcode == Opcode::PushF64) {
                const double left = function.instructions[label_position - 4u].f64;
                const double right = function.instructions[label_position - 3u].f64;
                const auto op = function.instructions[label_position - 2u].opcode;
                if (op == Opcode::AddF64) start = left + right;
                else if (op == Opcode::SubtractF64) start = left - right;
                else if (op == Opcode::MultiplyF64) start = left * right;
                else continue;
                initialization_begin = label_position - 4u;
            } else {
                continue;
            }
            const double end = end_value.f64;
            if (!std::isfinite(start) || !std::isfinite(end) ||
                start != std::floor(start) || end != std::floor(end)) {
                continue;
            }
            const double count_value = comparison == Opcode::OrderedLessEqualF64
                ? end - start + 1.0 : end - start;
            if (count_value < 0.0 || count_value > 8.0 ||
                count_value != std::floor(count_value)) {
                continue;
            }
            const auto body_begin = label_position + 5u;
            const auto body_end = back_jump - 4u;
            std::set<std::uint32_t> body_labels;
            for (std::size_t position = body_begin; position < body_end; ++position) {
                if (function.instructions[position].opcode == Opcode::Label) {
                    body_labels.insert(function.instructions[position].label);
                }
                if (function.instructions[position].opcode == Opcode::StoreLocal &&
                    function.instructions[position].index == counter) {
                    body_labels.clear();
                    break;
                }
            }
            bool closed_control_flow = true;
            for (std::size_t position = body_begin;
                 closed_control_flow && position < body_end; ++position) {
                const auto& instruction = function.instructions[position];
                if ((instruction.opcode == Opcode::Jump ||
                     instruction.opcode == Opcode::JumpIfFalse ||
                     instruction.opcode == Opcode::JumpIfTrue) &&
                    !body_labels.count(instruction.label)) {
                    closed_control_flow = false;
                }
            }
            for (std::size_t position = 0;
                 closed_control_flow && position < function.instructions.size(); ++position) {
                if (position >= initialization_begin && position <= back_jump + 1u) continue;
                const auto& instruction = function.instructions[position];
                if ((instruction.opcode == Opcode::Jump ||
                     instruction.opcode == Opcode::JumpIfFalse ||
                     instruction.opcode == Opcode::JumpIfTrue) &&
                    (instruction.label == loop_label.label ||
                     instruction.label == exit_jump.label)) {
                    closed_control_flow = false;
                }
                if (position > back_jump + 1u &&
                    instruction.opcode == Opcode::LoadLocal &&
                    instruction.index == counter) {
                    closed_control_flow = false;
                }
            }
            if (!closed_control_flow ||
                function.instructions.size() +
                    static_cast<std::size_t>(count_value) * (body_end - body_begin) >
                    16384u) {
                continue;
            }
            std::vector<Instruction> replacement;
            replacement.reserve(
                static_cast<std::size_t>(count_value) * (body_end - body_begin));
            for (std::size_t iteration = 0;
                 iteration < static_cast<std::size_t>(count_value); ++iteration) {
                Instruction iteration_value;
                iteration_value.opcode = Opcode::PushF64;
                iteration_value.f64 = start + static_cast<double>(iteration);
                replacement.push_back(std::move(iteration_value));
                Instruction iteration_store;
                iteration_store.opcode = Opcode::StoreLocal;
                iteration_store.index = counter;
                replacement.push_back(std::move(iteration_store));
                std::map<std::uint32_t, std::uint32_t> labels;
                for (const auto label : body_labels) labels.emplace(label, next_label++);
                for (std::size_t position = body_begin; position < body_end; ++position) {
                    auto instruction = function.instructions[position];
                    if (instruction.opcode == Opcode::LoadLocal &&
                        instruction.index == counter) {
                        instruction = Instruction{};
                        instruction.opcode = Opcode::PushF64;
                        instruction.f64 = start + static_cast<double>(iteration);
                    }
                    if (instruction.opcode == Opcode::Label ||
                        instruction.opcode == Opcode::Jump ||
                        instruction.opcode == Opcode::JumpIfFalse ||
                        instruction.opcode == Opcode::JumpIfTrue) {
                        instruction.label = labels.at(instruction.label);
                    }
                    replacement.push_back(std::move(instruction));
                }
            }
            function.instructions.erase(
                function.instructions.begin() +
                    static_cast<std::ptrdiff_t>(initialization_begin),
                function.instructions.begin() +
                    static_cast<std::ptrdiff_t>(back_jump + 2u));
            function.instructions.insert(
                function.instructions.begin() +
                    static_cast<std::ptrdiff_t>(initialization_begin),
                replacement.begin(), replacement.end());
            changed = true;
            break;
        }
        if (!changed) return;
    }
    throw LoweringFailure("small constant loop unrolling did not converge");
}

inline void unroll_small_constant_loops(Module& module) {
    unroll_small_constant_loops(module.entry);
    for (auto& function : module.functions) unroll_small_constant_loops(function);
}

// Loop unrolling replaces induction-variable reads with constants, but the
// flattened indices derived from those values still pass through local slots.
// Propagate adjacent constant stores inside each straight-line basic block so
// fixed-vector accesses can become direct offsets in the native backend.  All
// control-flow boundaries clear the facts, keeping the pass conservative.
inline void propagate_basic_block_constants(Function& function) {
    for (std::size_t pass = 0; pass <= function.locals.size(); ++pass) {
        bool changed = false;
        std::map<std::uint32_t, double> constants;
        for (std::size_t position = 0; position < function.instructions.size(); ++position) {
            auto& instruction = function.instructions[position];
            if (instruction.opcode == Opcode::Label ||
                instruction.opcode == Opcode::Jump ||
                instruction.opcode == Opcode::JumpIfFalse ||
                instruction.opcode == Opcode::JumpIfTrue ||
                instruction.opcode == Opcode::ReturnF64 ||
                instruction.opcode == Opcode::ReturnValues) {
                constants.clear();
                continue;
            }
            if (instruction.opcode == Opcode::LoadLocal) {
                const auto found = constants.find(instruction.index);
                if (found != constants.end()) {
                    instruction = Instruction{};
                    instruction.opcode = Opcode::PushF64;
                    instruction.f64 = found->second;
                    changed = true;
                }
                continue;
            }
            if (instruction.opcode == Opcode::StoreLocal) {
                if (position > 0u &&
                    function.instructions[position - 1u].opcode == Opcode::PushF64) {
                    constants[instruction.index] =
                        function.instructions[position - 1u].f64;
                } else {
                    constants.erase(instruction.index);
                }
                continue;
            }
            if (instruction.opcode == Opcode::StoreF64LocalsIndex) {
                for (std::uint32_t offset = 0; offset < instruction.argument_count; ++offset) {
                    constants.erase(instruction.index + offset);
                }
            }
        }
        if (!changed) return;
    }
    throw LoweringFailure("basic-block constant propagation did not converge");
}

inline void propagate_basic_block_constants(Module& module) {
    propagate_basic_block_constants(module.entry);
    for (auto& function : module.functions) {
        propagate_basic_block_constants(function);
    }
}

inline void fold_constant_numeric_expressions(Function& function) {
    for (;;) {
        bool changed = false;
        for (std::size_t position = 0;
             position + 2u < function.instructions.size(); ++position) {
            const auto& left = function.instructions[position];
            const auto& right = function.instructions[position + 1u];
            const auto opcode = function.instructions[position + 2u].opcode;
            if (left.opcode != Opcode::PushF64 ||
                right.opcode != Opcode::PushF64 ||
                (opcode != Opcode::AddF64 && opcode != Opcode::SubtractF64 &&
                 opcode != Opcode::MultiplyF64 && opcode != Opcode::DivideF64)) {
                continue;
            }
            double value = 0.0;
            if (opcode == Opcode::AddF64) value = left.f64 + right.f64;
            else if (opcode == Opcode::SubtractF64) value = left.f64 - right.f64;
            else if (opcode == Opcode::MultiplyF64) value = left.f64 * right.f64;
            else value = left.f64 / right.f64;
            Instruction folded;
            folded.opcode = Opcode::PushF64;
            folded.f64 = value;
            function.instructions[position] = std::move(folded);
            function.instructions.erase(
                function.instructions.begin() +
                    static_cast<std::ptrdiff_t>(position + 1u),
                function.instructions.begin() +
                    static_cast<std::ptrdiff_t>(position + 3u));
            changed = true;
            break;
        }
        if (!changed) return;
    }
}

inline void fold_constant_numeric_expressions(Module& module) {
    fold_constant_numeric_expressions(module.entry);
    for (auto& function : module.functions) {
        fold_constant_numeric_expressions(function);
    }
}

inline Module lower(const vf::JsonValue& typed_ir) {
    const auto variadics = specialize_heterogeneous_variadics(typed_ir);
    const vf::JsonValue& variadic_shaped = variadics ? *variadics : typed_ir;
    const auto snapshots = capture_module_literal_snapshots(variadic_shaped);
    const vf::JsonValue& captured = snapshots ? *snapshots : variadic_shaped;
    vf::JsonValue shaped = captured;
    for (unsigned pass = 0; pass < 64; ++pass) {
        auto specialized = specialize_any_function_calls(shaped);
        if (!specialized) break;
        shaped = std::move(*specialized);
        if (pass == 63) throw LoweringFailure("machine IR generic specialization did not converge");
    }
    const auto stored_closures = specialize_stored_closures(shaped);
    const vf::JsonValue& closure_shaped = stored_closures ? *stored_closures : shaped;
    const auto closures = specialize_immediate_closures(closure_shaped);
    const vf::JsonValue& immediate_shaped = closures ? *closures : closure_shaped;
    const auto recursive_locals = specialize_recursive_local_functions(immediate_shaped);
    const vf::JsonValue& recursive_shaped = recursive_locals
        ? *recursive_locals : immediate_shaped;
    const auto local_calls = specialize_direct_local_calls(recursive_shaped);
    auto lowered = lower_monomorphic(local_calls ? *local_calls : recursive_shaped);
    coalesce_scalar_local_copies(lowered);
    refine_machine_error_effects(lowered);
    refine_integral_local_classes(lowered);
    inline_small_numeric_calls(lowered);
    specialize_discarded_dynamic_list_results(lowered);
    refine_machine_error_effects(lowered);
    eliminate_identity_local_shuffles(lowered);
    eliminate_discarded_index_assignment_temporaries(lowered);
    eliminate_unreferenced_labels(lowered);
    propagate_constant_numeric_parameters(lowered);
    propagate_constant_numeric_locals(lowered);
    unroll_small_constant_loops(lowered);
    propagate_basic_block_constants(lowered);
    fold_constant_numeric_expressions(lowered);
    // Constant propagation can turn a parameter-fed numeric local into a
    // provably integral induction variable. Re-run the representation analysis
    // so the direct backend does not retain f64 conversions and redundant
    // integrality checks from the pre-specialized function.
    promote_integral_numeric_locals(lowered);
    refresh_integral_fixed_indices(lowered);
    return lowered;
}

}  // namespace vkf::machine_ir
