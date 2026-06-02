#include "native/VfOverlay/vf/json.hpp"

#include <cstdint>
#include <cctype>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include <iomanip>
#include <unordered_map>

namespace {

constexpr const char* compiler_version = "vkf-artifact-smoke-0.1";

class ArtifactFailure : public std::runtime_error {
public:
    explicit ArtifactFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct StoredValue {
    std::string name;
    std::string value;
};

struct Dependency {
    std::string name;
    std::filesystem::path path;
    std::string hash;
};

struct LocalFunction {
    std::string name;
    struct Param {
        std::string name;
        vf::JsonValue default_value;
        bool variadic_positional = false;
        bool variadic_named = false;
    };
    std::vector<Param> params;
    vf::JsonValue body;
};

using LocalFunctionTable = std::map<std::string, LocalFunction>;
using StdlibExportTable = std::map<std::string, std::string>;

struct ImportedFunction {
    std::vector<std::string> params;
    std::string body_expr;
};

struct ImportedModule {
    std::filesystem::path path;
    std::map<std::string, ImportedFunction> functions;
};

class ValueTable {
public:
    void set(std::string name, std::string value) {
        for (auto& stored : values_) {
            if (stored.name == name) {
                stored.value = std::move(value);
                return;
            }
        }
        values_.push_back({std::move(name), std::move(value)});
    }

    std::string get(const std::string& name) const {
        for (auto it = values_.rbegin(); it != values_.rend(); ++it) {
            if (it->name == name) {
                return it->value;
            }
        }
        throw ArtifactFailure("unknown load in artifact emission: " + name);
    }

    const std::vector<StoredValue>& entries() const {
        return values_;
    }

private:
    std::vector<StoredValue> values_;
};

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw ArtifactFailure("expected object for " + context);
    }
    return value.as_object();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) {
        throw ArtifactFailure("expected array for " + context);
    }
    return value.as_array();
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw ArtifactFailure("missing field " + name + " in " + context);
    }
    return found->second;
}

std::string string_field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const vf::JsonValue& value = field(object, name, context);
    if (!value.is_string()) {
        throw ArtifactFailure("expected string field " + name + " in " + context);
    }
    return value.as_string();
}

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw ArtifactFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_file(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw ArtifactFailure("could not write " + path.string());
    }
    output << text;
}

std::string hex_u64(std::uint64_t value) {
    const char* digits = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) {
        out[static_cast<std::size_t>(i)] = digits[value & 0xF];
        value >>= 4;
    }
    return out;
}

std::string stable_hash(const std::string& text) {
    std::uint64_t hash = 1469598103934665603ull;
    for (unsigned char ch : text) {
        hash ^= ch;
        hash *= 1099511628211ull;
    }
    return hex_u64(hash);
}

std::filesystem::path repo_root_from_source(const std::filesystem::path& source) {
    auto parent = std::filesystem::absolute(source).parent_path();
    if (parent.empty()) {
        return std::filesystem::current_path();
    }
    return parent;
}

std::string stem_of(const std::filesystem::path& source) {
    std::string stem = source.stem().string();
    return stem.empty() ? "stdin" : stem;
}

std::string render_value_summary(const vf::JsonValue& value);

std::string render_array_summary(const vf::JsonValue::Array& values) {
    std::string out = "[";
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i > 0) {
            out += ", ";
        }
        out += render_value_summary(values[i]);
    }
    out += "]";
    return out;
}

void validate_value(const vf::JsonValue& value);
void validate_stmt(const vf::JsonValue& stmt);

void validate_call(const vf::JsonValue::Object& object) {
    validate_value(field(object, "callee", "call"));
    for (const auto& arg : array_of(field(object, "args", "call"), "call.args")) {
        validate_value(arg);
    }
    const auto named_it = object.find("named_args");
    if (named_it != object.end() && named_it->second.is_array()) {
        for (const auto& named_arg : named_it->second.as_array()) {
            const auto& named_object = object_of(named_arg, "named_arg");
            (void)string_field(named_object, "name", "named_arg");
            validate_value(field(named_object, "value", "named_arg"));
        }
    }
    const auto spread_it = object.find("spread_args");
    if (spread_it != object.end() && spread_it->second.is_array()) {
        for (const auto& spread_arg : spread_it->second.as_array()) {
            validate_value(spread_arg);
        }
    }
}

void validate_value(const vf::JsonValue& value) {
    const auto& object = object_of(value, "typed IR value");
    const std::string kind = string_field(object, "kind", "typed IR value");
    if (kind == "const") {
        (void)string_field(object, "type", "const");
        (void)field(object, "value", "const");
        return;
    }
    if (kind == "load") {
        (void)string_field(object, "name", "load");
        (void)string_field(object, "type", "load");
        return;
    }
    if (kind == "stdlib_function") {
        const std::string full_name = string_field(object, "full_name", "stdlib_function");
        if (full_name != "io.print"
            && full_name != "math.sqrt"
            && full_name != "math.sin"
            && full_name != "math.cos"
            && full_name != "math.exp"
            && full_name != "stat.mean"
            && full_name != "stat.std"
            && full_name != "stat.median"
            && full_name != "stat.iqr"
            && full_name != "stat.zscore"
            && full_name != "stat.normalize"
            && full_name != "stat.covariance"
            && full_name != "stat.correlation"
            && full_name != "stat.range"
            && full_name != "stat.count"
            && full_name != "collections.map"
            && full_name != "collections.list"
            && full_name != "collections.queue") {
            throw ArtifactFailure("unsupported stdlib function " + full_name);
        }
        return;
    }
    if (kind == "call") {
        validate_call(object);
        return;
    }
    if (kind == "record") {
        for (const auto& field_value : array_of(field(object, "fields", "record"), "record.fields")) {
            const auto& field_object = object_of(field_value, "record field");
            (void)string_field(field_object, "name", "record field");
            validate_value(field(field_object, "value", "record field"));
        }
        return;
    }
    if (kind == "tuple") {
        for (const auto& item : array_of(field(object, "items", "tuple"), "tuple.items")) {
            validate_value(item);
        }
        return;
    }
    if (kind == "list") {
        for (const auto& item : array_of(field(object, "items", "list"), "list.items")) {
            validate_value(item);
        }
        return;
    }
    if (kind == "multiset") {
        for (const auto& pair_value : array_of(field(object, "pairs", "multiset"), "multiset.pairs")) {
            const auto& pair_object = object_of(pair_value, "multiset pair");
            validate_value(field(pair_object, "key", "multiset pair"));
            validate_value(field(pair_object, "count", "multiset pair"));
        }
        return;
    }
    if (kind == "binary_op") {
        validate_value(field(object, "left", "binary_op"));
        validate_value(field(object, "right", "binary_op"));
        return;
    }
    if (kind == "unary_op") {
        validate_value(field(object, "operand", "unary_op"));
        return;
    }
    if (kind == "axis_align") {
        validate_value(field(object, "value", "axis_align"));
        (void)string_field(object, "axis_key", "axis_align");
        return;
    }
    if (kind == "field_access") {
        validate_value(field(object, "object", "field_access"));
        (void)string_field(object, "field", "field_access");
        return;
    }
    if (kind == "scope_identity") {
        return;
    }
    if (kind == "dotted_index") {
        validate_value(field(object, "base", "dotted_index"));
        for (const auto& index : array_of(field(object, "indices", "dotted_index"), "dotted_index.indices")) {
            validate_value(index);
        }
        return;
    }
    if (kind == "block") {
        for (const auto& stmt : array_of(field(object, "body", "block"), "block.body")) {
            validate_stmt(stmt);
        }
        return;
    }
    if (kind == "block_expr") {
        for (const auto& stmt : array_of(field(object, "body", "block_expr"), "block_expr.body")) {
            const auto& stmt_object = object_of(stmt, "block expr stmt");
            const std::string stmt_kind = string_field(stmt_object, "kind", "block expr stmt");
            if (stmt_kind != "expr_stmt" && stmt_kind != "store_binding" && stmt_kind != "return") {
                throw ArtifactFailure("unsupported block expr statement kind " + stmt_kind);
            }
            validate_value(stmt_kind == "expr_stmt"
                ? field(stmt_object, "expr", "expr_stmt")
                : field(stmt_object, stmt_kind == "store_binding" ? "value" : "value", "block expr stmt"));
        }
        return;
    }
    if (kind == "match_stmt") {
        validate_value(field(object, "discriminant", "match_stmt"));
        for (const auto& arm_value : array_of(field(object, "arms", "match_stmt"), "match_stmt.arms")) {
            const auto& arm = object_of(arm_value, "match arm");
            const auto found = arm.find("condition");
            if (found != arm.end() && !found->second.is_null()) {
                validate_value(found->second);
            }
            validate_value(field(arm, "body", "match arm"));
        }
        return;
    }
    throw ArtifactFailure("unsupported typed IR value kind " + kind);
}

void validate_stmt(const vf::JsonValue& stmt) {
    const auto& object = object_of(stmt, "typed IR stmt");
    const std::string kind = string_field(object, "kind", "typed IR stmt");
    if (kind == "store_binding") {
        (void)string_field(object, "name", "store_binding");
        (void)string_field(object, "type", "store_binding");
        validate_value(field(object, "value", "store_binding"));
        return;
    }
    if (kind == "update_attr") {
        (void)string_field(object, "base_name", "update_attr");
        (void)string_field(object, "field", "update_attr");
        validate_value(field(object, "value", "update_attr"));
        return;
    }
    if (kind == "update_index") {
        (void)string_field(object, "base_name", "update_index");
        for (const auto& index : array_of(field(object, "indices", "update_index"), "update_index.indices")) {
            validate_value(index);
        }
        validate_value(field(object, "value", "update_index"));
        return;
    }
    if (kind == "module_import") {
        (void)field(object, "path", "module_import");
        (void)field(object, "alias", "module_import");
        return;
    }
    if (kind == "type_alias") {
        return;
    }
    if (kind == "spill_stmt") {
        validate_value(field(object, "value", "spill_stmt"));
        return;
    }
    if (kind == "expr_stmt") {
        validate_value(field(object, "expr", "expr_stmt"));
        return;
    }
    if (kind == "label_print") {
        (void)string_field(object, "label", "label_print");
        validate_value(field(object, "value", "label_print"));
        return;
    }
    if (kind == "function") {
        validate_value(field(object, "body", "function"));
        return;
    }
    if (kind == "if_stmt") {
        validate_value(field(object, "condition", "if_stmt"));
        (void)field(object, "loop", "if_stmt");
        validate_value(field(object, "body", "if_stmt"));
        return;
    }
    if (kind == "return") {
        validate_value(field(object, "value", "return"));
        return;
    }
    throw ArtifactFailure("unsupported typed IR statement kind " + kind);
}

void validate_typed_ir(const vf::JsonValue& root) {
    const auto& object = object_of(root, "typed IR module");
    const std::string kind = string_field(object, "kind", "typed IR module");
    if (kind != "typed_module") {
        throw ArtifactFailure("unsupported typed IR root kind " + kind);
    }
    for (const auto& stmt : array_of(field(object, "body", "typed_module"), "typed_module.body")) {
        validate_stmt(stmt);
    }
}

std::string value_to_script_text(const vf::JsonValue& value) {
    if (value.is_string()) {
        return value.as_string();
    }
    if (value.is_number()) {
        std::ostringstream out;
        out << std::setprecision(17) << value.as_number();
        std::string text = out.str();
        if (text.size() > 2 && text.substr(text.size() - 2) == ".0") {
            text.resize(text.size() - 2);
        }
        return text;
    }
    if (value.is_boolean()) {
        return value.as_boolean() ? "true" : "false";
    }
    if (value.is_null()) {
        return "null";
    }
    throw ArtifactFailure("unsupported const value for artifact emission");
}

std::string format_number(double value) {
    std::ostringstream out;
    out << std::setprecision(17) << value;
    std::string text = out.str();
    if (text.size() > 2 && text.substr(text.size() - 2) == ".0") {
        text.resize(text.size() - 2);
    }
    return text;
}

std::string trim_copy(const std::string& text) {
    std::size_t start = 0;
    while (start < text.size() && std::isspace(static_cast<unsigned char>(text[start]))) {
        ++start;
    }
    std::size_t end = text.size();
    while (end > start && std::isspace(static_cast<unsigned char>(text[end - 1]))) {
        --end;
    }
    return text.substr(start, end - start);
}

std::vector<std::string> parse_flat_sequence_string(const std::string& text, char open, char close) {
    if (text.size() < 2 || text.front() != open || text.back() != close) {
        return {};
    }
    std::vector<std::string> items;
    std::string current;
    int depth = 0;
    for (std::size_t index = 1; index + 1 < text.size(); ++index) {
        const char ch = text[index];
        if ((ch == '(' || ch == '[' || ch == '{') && ch != open) {
            depth += 1;
        } else if ((ch == ')' || ch == ']' || ch == '}') && ch != close && depth > 0) {
            depth -= 1;
        }
        if (ch == ',' && depth == 0) {
            items.push_back(trim_copy(current));
            current.clear();
            continue;
        }
        current.push_back(ch);
    }
    if (!current.empty() || text == std::string() + open + close) {
        items.push_back(trim_copy(current));
    }
    if (items.size() == 1 && items.front().empty()) {
        items.clear();
    }
    return items;
}

const std::vector<std::string>& cached_flat_sequence_string(const std::string& text, char open, char close) {
    static std::unordered_map<std::string, std::vector<std::string>> cache;
    std::string key;
    key.reserve(text.size() + 2);
    key.push_back(open);
    key.push_back(close);
    key += text;
    auto found = cache.find(key);
    if (found == cache.end()) {
        found = cache.emplace(std::move(key), parse_flat_sequence_string(text, open, close)).first;
    }
    return found->second;
}

std::vector<std::pair<std::string, std::string>> parse_flat_record_string(const std::string& text) {
    std::size_t start = 0;
    std::size_t end = text.size();
    if (text.size() >= 2 && text.front() == '{' && text.back() == '}') {
        start = 1;
        end = text.size() - 1;
    } else {
        const std::size_t lpar = text.find('(');
        if (lpar == std::string::npos || text.back() != ')') {
            return {};
        }
        start = lpar + 1;
        end = text.size() - 1;
    }
    std::vector<std::pair<std::string, std::string>> fields;
    std::string current;
    int depth = 0;
    auto flush = [&]() {
        if (current.empty()) {
            return;
        }
        const std::string part = trim_copy(current);
        current.clear();
        const std::size_t colon = part.find(':');
        if (colon == std::string::npos) {
            throw ArtifactFailure("invalid rendered record field");
        }
        fields.push_back({trim_copy(part.substr(0, colon)), trim_copy(part.substr(colon + 1))});
    };
    for (std::size_t index = start; index < end; ++index) {
        const char ch = text[index];
        if (ch == '{' || ch == '[' || ch == '(') {
            depth += 1;
        } else if ((ch == '}' || ch == ']' || ch == ')') && depth > 0) {
            depth -= 1;
        }
        if (ch == ',' && depth == 0) {
            flush();
            continue;
        }
        current.push_back(ch);
    }
    flush();
    return fields;
}

std::string render_flat_record_string(const std::vector<std::pair<std::string, std::string>>& fields) {
    std::string out = "{";
    for (std::size_t i = 0; i < fields.size(); ++i) {
        if (i > 0) {
            out += ", ";
        }
        out += fields[i].first + ": " + fields[i].second;
    }
    out += "}";
    return out;
}

std::string render_flat_sequence_string(const std::vector<std::string>& items, char open, char close) {
    std::string out(1, open);
    for (std::size_t i = 0; i < items.size(); ++i) {
        if (i > 0) {
            out += ", ";
        }
        out += items[i];
    }
    out.push_back(close);
    return out;
}

bool starts_with(const std::string& text, const std::string& prefix) {
    return text.rfind(prefix, 0) == 0;
}

bool is_sequence_type(const std::string& type) {
    return starts_with(type, "list<")
        || starts_with(type, "tuple<")
        || starts_with(type, "[");
}

std::vector<double> parse_numeric_sequence_string(const std::string& text) {
    std::vector<double> out;
    std::vector<std::string> items = parse_flat_sequence_string(text, '[', ']');
    if (items.empty()) {
        items = parse_flat_sequence_string(text, '(', ')');
    }
    if (items.empty() && text != "[]" && text != "()") {
        return {};
    }
    for (const auto& item : items) {
        if (item.empty()) {
            continue;
        }
        try {
            out.push_back(std::stod(item));
        } catch (const std::exception&) {
            throw ArtifactFailure("expected numeric sequence item");
        }
    }
    return out;
}

using NumericMultiset = std::map<double, long long>;

NumericMultiset parse_numeric_multiset_string(const std::string& text) {
    NumericMultiset out;
    const auto fields = parse_flat_record_string(text);
    if (fields.empty() && text != "{}") {
        throw ArtifactFailure("expected numeric multiset value");
    }
    for (const auto& [key_text, count_text] : fields) {
        try {
            const double key = std::stod(key_text);
            const double raw_count = std::stod(count_text);
            if (!std::isfinite(raw_count) || std::floor(raw_count) != raw_count) {
                throw ArtifactFailure("expected integral multiset count");
            }
            const long long count = static_cast<long long>(raw_count);
            if (count > 0) {
                out[key] += count;
            }
        } catch (const ArtifactFailure&) {
            throw;
        } catch (const std::exception&) {
            throw ArtifactFailure("expected numeric multiset entry");
        }
    }
    return out;
}

std::string render_numeric_multiset_string(const NumericMultiset& multiset) {
    std::vector<std::pair<std::string, std::string>> fields;
    for (const auto& [key, count] : multiset) {
        if (count <= 0) {
            continue;
        }
        fields.push_back({format_number(key), format_number(static_cast<double>(count))});
    }
    return render_flat_record_string(fields);
}

bool parse_truthy_bool(const std::string& text, bool& out) {
    if (text == "true") {
        out = true;
        return true;
    }
    if (text == "false") {
        out = false;
        return true;
    }
    return false;
}

std::string function_name_for_operator(const std::string& op) {
    if (op == "PLUS") return "+";
    if (op == "MINUS") return "-";
    if (op == "STAR") return "*";
    if (op == "SLASH") return "/";
    if (op == "FLOORDIV") return "//";
    if (op == "PERCENT") return "%";
    if (op == "CARET") return "^";
    if (op == "AND") return "/\\";
    if (op == "OR") return "\\/";
    if (op == "XOR") return "><";
    return "";
}

std::string render_scope_identity_record(const ValueTable& values, const std::string& ctor_name) {
    std::vector<std::pair<std::string, std::string>> fields;
    for (const auto& entry : values.entries()) {
        fields.push_back({entry.name, entry.value});
    }
    if (ctor_name.empty()) {
        return render_flat_record_string(fields);
    }
    std::string out = ctor_name + "(";
    for (std::size_t i = 0; i < fields.size(); ++i) {
        if (i > 0) {
            out += ", ";
        }
        out += fields[i].first + ":" + fields[i].second;
    }
    out += ")";
    return out;
}

std::filesystem::path resolve_dot_module_path(
    const vf::JsonValue& path_value,
    const std::filesystem::path& source_path
) {
    const auto& path_object = object_of(path_value, "module_import.path");
    if (string_field(path_object, "kind", "module_import.path") != "dot_module_path") {
        throw ArtifactFailure("artifact emission only supports dot_module_path imports");
    }
    std::filesystem::path resolved = std::filesystem::absolute(source_path).parent_path();
    for (const auto& segment : array_of(field(path_object, "segments", "module_import.path"), "module_import.path.segments")) {
        if (!segment.is_string()) {
            throw ArtifactFailure("module import path segments must be strings");
        }
        resolved /= segment.as_string();
    }
    resolved = resolved.lexically_normal();
    if (std::filesystem::is_regular_file(resolved)) {
        return resolved;
    }
    if (resolved.extension() != ".vkf") {
        const std::filesystem::path direct_file = resolved.string() + ".vkf";
        if (std::filesystem::is_regular_file(direct_file)) {
            return direct_file.lexically_normal();
        }
    }
    if (std::filesystem::is_directory(resolved)) {
        const std::filesystem::path mod_file = resolved / "mod.vkf";
        if (std::filesystem::is_regular_file(mod_file)) {
            return mod_file.lexically_normal();
        }
    }
    return resolved;
}

std::vector<double> require_numeric_vector(const std::string& rendered, const std::string& context) {
    std::vector<double> values = parse_numeric_sequence_string(rendered);
    if (values.empty() && rendered != "[]" && rendered != "()") {
        throw ArtifactFailure(context + " requires rendered numeric sequence");
    }
    return values;
}

double stat_mean(const std::vector<double>& xs) {
    if (xs.empty()) {
        throw ArtifactFailure("stat.mean requires non-empty sequence");
    }
    double total = 0.0;
    for (double x : xs) {
        total += x;
    }
    return total / static_cast<double>(xs.size());
}

double stat_std(const std::vector<double>& xs) {
    if (xs.empty()) {
        throw ArtifactFailure("stat.std requires non-empty sequence");
    }
    const double mu = stat_mean(xs);
    double total = 0.0;
    for (double x : xs) {
        const double d = x - mu;
        total += d * d;
    }
    return std::sqrt(total / static_cast<double>(xs.size()));
}

double stat_median(std::vector<double> xs) {
    if (xs.empty()) {
        throw ArtifactFailure("stat.median requires non-empty sequence");
    }
    std::sort(xs.begin(), xs.end());
    const std::size_t mid = xs.size() / 2;
    if (xs.size() % 2 == 1) {
        return xs[mid];
    }
    return (xs[mid - 1] + xs[mid]) * 0.5;
}

double stat_quantile(std::vector<double> xs, double fraction) {
    if (xs.empty()) {
        throw ArtifactFailure("stat quantile requires non-empty sequence");
    }
    std::sort(xs.begin(), xs.end());
    const double index = fraction * static_cast<double>(xs.size() - 1);
    const std::size_t lower = static_cast<std::size_t>(std::floor(index));
    const std::size_t upper = static_cast<std::size_t>(std::ceil(index));
    if (lower == upper) {
        return xs[lower];
    }
    const double weight = index - static_cast<double>(lower);
    return xs[lower] * (1.0 - weight) + xs[upper] * weight;
}

double stat_covariance(const std::vector<double>& xs, const std::vector<double>& ys) {
    if (xs.size() != ys.size() || xs.empty()) {
        throw ArtifactFailure("stat.covariance requires equal non-empty sequences");
    }
    const double mx = stat_mean(xs);
    const double my = stat_mean(ys);
    double total = 0.0;
    for (std::size_t i = 0; i < xs.size(); ++i) {
        total += (xs[i] - mx) * (ys[i] - my);
    }
    return total / static_cast<double>(xs.size());
}

ImportedModule parse_imported_module_file(const std::filesystem::path& path) {
    ImportedModule module;
    module.path = path;
    std::istringstream lines(read_file(path));
    std::string line;
    std::string active_name;
    std::vector<std::string> active_params;
    std::string active_body;

    auto commit_active = [&]() {
        if (active_name.empty()) {
            return;
        }
        if (active_body.empty()) {
            throw ArtifactFailure("imported module function " + active_name + " must have a single expression body");
        }
        module.functions[active_name] = ImportedFunction{active_params, trim_copy(active_body)};
        active_name.clear();
        active_params.clear();
        active_body.clear();
    };

    while (std::getline(lines, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        const std::string trimmed = trim_copy(line);
        if (trimmed.empty() || trimmed[0] == '#') {
            continue;
        }
        const bool indented = !line.empty() && (line[0] == ' ' || line[0] == '\t');
        if (!indented) {
            commit_active();
            const std::size_t open = trimmed.find('(');
            const std::size_t close = trimmed.rfind(')');
            if (open == std::string::npos || close == std::string::npos || close < open || close + 1 >= trimmed.size()) {
                continue;
            }
            const std::size_t colon = trimmed.find(':', close);
            if (colon == std::string::npos) {
                continue;
            }
            active_name = trim_copy(trimmed.substr(0, open));
            const std::string params_text = trimmed.substr(open + 1, close - open - 1);
            std::size_t start = 0;
            while (start <= params_text.size()) {
                const std::size_t comma = params_text.find(',', start);
                const std::string piece = trim_copy(params_text.substr(start, comma == std::string::npos ? std::string::npos : comma - start));
                if (!piece.empty()) {
                    active_params.push_back(piece);
                }
                if (comma == std::string::npos) {
                    break;
                }
                start = comma + 1;
            }
            const std::string inline_body = trim_copy(trimmed.substr(colon + 1));
            if (!inline_body.empty()) {
                active_body = inline_body;
                commit_active();
            }
            continue;
        }
        if (active_name.empty()) {
            throw ArtifactFailure("unexpected indented line in imported module " + path.string());
        }
        if (!active_body.empty()) {
            throw ArtifactFailure("artifact emission only supports single-expression imported function bodies");
        }
        active_body = trimmed;
    }
    commit_active();
    return module;
}

class ImportedExprParser {
public:
    ImportedExprParser(
        const ImportedModule& module,
        std::map<std::string, double> env,
        std::string text
    )
        : module_(module), env_(std::move(env)), text_(std::move(text)) {}

    double parse() {
        skip_ws();
        const double value = parse_expr();
        skip_ws();
        if (pos_ != text_.size()) {
            throw ArtifactFailure("unsupported imported module expression tail: " + text_.substr(pos_));
        }
        return value;
    }

private:
    double parse_expr() {
        double value = parse_term();
        while (true) {
            skip_ws();
            if (match('+')) {
                value += parse_term();
                continue;
            }
            if (match('-')) {
                value -= parse_term();
                continue;
            }
            return value;
        }
    }

    double parse_term() {
        double value = parse_power();
        while (true) {
            skip_ws();
            if (match('*')) {
                value *= parse_power();
                continue;
            }
            if (match('/')) {
                value /= parse_power();
                continue;
            }
            return value;
        }
    }

    double parse_power() {
        double value = parse_factor();
        skip_ws();
        if (match('^')) {
            value = std::pow(value, parse_power());
        }
        return value;
    }

    double parse_factor() {
        skip_ws();
        if (match('-')) {
            return -parse_factor();
        }
        if (match('(')) {
            const double value = parse_expr();
            skip_ws();
            if (!match(')')) {
                throw ArtifactFailure("missing closing ')' in imported module expression");
            }
            return value;
        }
        if (peek_is_digit()) {
            return parse_number();
        }
        const std::string ident = parse_identifier();
        skip_ws();
        if (match('(')) {
            std::vector<double> args;
            skip_ws();
            if (!match(')')) {
                while (true) {
                    args.push_back(parse_expr());
                    skip_ws();
                    if (match(')')) {
                        break;
                    }
                    if (!match(',')) {
                        throw ArtifactFailure("expected ',' in imported module call");
                    }
                }
            }
            return call_function(ident, args);
        }
        const auto found = env_.find(ident);
        if (found == env_.end()) {
            throw ArtifactFailure("unknown imported module identifier " + ident);
        }
        return found->second;
    }

    double call_function(const std::string& name, const std::vector<double>& args) {
        const auto found = module_.functions.find(name);
        if (found == module_.functions.end()) {
            throw ArtifactFailure("unknown imported module function " + name);
        }
        const ImportedFunction& function = found->second;
        if (args.size() != function.params.size()) {
            throw ArtifactFailure("wrong arity for imported module function " + name);
        }
        std::map<std::string, double> nested_env;
        for (std::size_t index = 0; index < args.size(); ++index) {
            nested_env[function.params[index]] = args[index];
        }
        return ImportedExprParser(module_, std::move(nested_env), function.body_expr).parse();
    }

    double parse_number() {
        const std::size_t start = pos_;
        while (pos_ < text_.size() && (std::isdigit(static_cast<unsigned char>(text_[pos_])) || text_[pos_] == '.')) {
            ++pos_;
        }
        return std::stod(text_.substr(start, pos_ - start));
    }

    std::string parse_identifier() {
        skip_ws();
        if (pos_ >= text_.size() || !(std::isalpha(static_cast<unsigned char>(text_[pos_])) || text_[pos_] == '_')) {
            throw ArtifactFailure("expected identifier in imported module expression");
        }
        const std::size_t start = pos_;
        ++pos_;
        while (pos_ < text_.size() && (std::isalnum(static_cast<unsigned char>(text_[pos_])) || text_[pos_] == '_')) {
            ++pos_;
        }
        return text_.substr(start, pos_ - start);
    }

    bool peek_is_digit() const {
        return pos_ < text_.size() && (std::isdigit(static_cast<unsigned char>(text_[pos_])) || text_[pos_] == '.');
    }

    bool match(char expected) {
        if (pos_ < text_.size() && text_[pos_] == expected) {
            ++pos_;
            return true;
        }
        return false;
    }

    void skip_ws() {
        while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
            ++pos_;
        }
    }

    const ImportedModule& module_;
    std::map<std::string, double> env_;
    std::string text_;
    std::size_t pos_ = 0;
};

using ImportTable = std::map<std::string, ImportedModule>;
struct LocalReturnSignal {
    std::string value;
};

double eval_numeric_value(const vf::JsonValue& value, const ValueTable& values, const ImportTable& imports, const LocalFunctionTable& functions, const StdlibExportTable& stdlib_exports, const std::string& ctor_name = "");
std::string eval_value(const vf::JsonValue& value, const ValueTable& values, const ImportTable& imports, const LocalFunctionTable& functions, const StdlibExportTable& stdlib_exports, const std::string& ctor_name = "", std::vector<std::string>* output_lines = nullptr);

std::string eval_block_value(const vf::JsonValue& block, ValueTable& values, const ImportTable& imports, const LocalFunctionTable& functions, const StdlibExportTable& stdlib_exports, const std::string& ctor_name = "", std::vector<std::string>* output_lines = nullptr);
std::string eval_match_stmt_value(const vf::JsonValue& value, ValueTable& values, const ImportTable& imports, const LocalFunctionTable& functions, const StdlibExportTable& stdlib_exports, const std::string& ctor_name = "", std::vector<std::string>* output_lines = nullptr);
bool eval_condition_value(const vf::JsonValue& value, const ValueTable& values, const ImportTable& imports, const LocalFunctionTable& functions, const StdlibExportTable& stdlib_exports, const std::string& ctor_name = "");

bool is_ui_placeholder(const std::string& rendered) {
    return rendered.rfind("__ui_", 0) == 0;
}

double eval_numeric_value(const vf::JsonValue& value, const ValueTable& values, const ImportTable& imports, const LocalFunctionTable& functions, const StdlibExportTable& stdlib_exports, const std::string& ctor_name) {
    const auto& object = object_of(value, "typed IR numeric value");
    const std::string kind = string_field(object, "kind", "typed IR numeric value");
    if (kind == "const") {
        const vf::JsonValue& raw = field(object, "value", "const");
        if (!raw.is_number()) {
            throw ArtifactFailure("expected numeric const for imported module arithmetic");
        }
        return raw.as_number();
    }
    if (kind == "load") {
        try {
            return std::stod(values.get(string_field(object, "name", "load")));
        } catch (const std::exception&) {
            throw ArtifactFailure("expected numeric load value");
        }
    }
    if (kind == "field_access" || kind == "dotted_index") {
        try {
            return std::stod(eval_value(value, values, imports, functions, stdlib_exports, ctor_name));
        } catch (const std::exception&) {
            throw ArtifactFailure("expected numeric field/index value");
        }
    }
    if (kind == "binary_op") {
        const std::string op = string_field(object, "op", "binary_op");
        const double left = eval_numeric_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name);
        const double right = eval_numeric_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name);
        if (op == "PLUS") {
            return left + right;
        }
        if (op == "MINUS") {
            return left - right;
        }
        if (op == "STAR") {
            return left * right;
        }
        if (op == "SLASH") {
            return left / right;
        }
        if (op == "FLOORDIV") {
            return std::floor(left / right);
        }
        if (op == "PERCENT") {
            return std::fmod(left, right);
        }
        if (op == "CARET") {
            return std::pow(left, right);
        }
        throw ArtifactFailure("unsupported numeric binary op " + op);
    }
    if (kind == "unary_op") {
        const std::string op = string_field(object, "op", "unary_op");
        if (op == "MINUS") {
            return -eval_numeric_value(field(object, "operand", "unary_op"), values, imports, functions, stdlib_exports, ctor_name);
        }
    }
    if (kind == "call") {
        try {
            return std::stod(eval_value(value, values, imports, functions, stdlib_exports, ctor_name));
        } catch (const std::exception&) {
            throw ArtifactFailure("expected numeric call value");
        }
    }
    throw ArtifactFailure("unsupported numeric value kind " + kind);
}

std::string eval_call(
    const vf::JsonValue::Object& object,
    const ValueTable& values,
    const ImportTable& imports,
    const LocalFunctionTable& functions,
    const StdlibExportTable& stdlib_exports,
    const std::string& ctor_name = "",
    std::vector<std::string>* output_lines = nullptr
) {
    const auto& callee = object_of(field(object, "callee", "call"), "call.callee");
    const std::string callee_kind = string_field(callee, "kind", "call.callee");
    if (callee_kind == "load") {
        const std::string callee_name = string_field(callee, "name", "call.callee");
        if (callee_name == "print") {
            // Supported implicitly for historical subset compatibility.
        } else {
            const auto fn_it = functions.find(callee_name);
            if (fn_it == functions.end()) {
                const auto spill_import_it = imports.find("");
                if (spill_import_it != imports.end()) {
                    const auto imported_function_it = spill_import_it->second.functions.find(callee_name);
                    if (imported_function_it != spill_import_it->second.functions.end()) {
                        std::vector<double> args;
                        for (const auto& arg : array_of(field(object, "args", "call"), "call.args")) {
                            args.push_back(eval_numeric_value(arg, values, imports, functions, stdlib_exports, ctor_name));
                        }
                        const ImportedFunction& function = imported_function_it->second;
                        if (args.size() < function.params.size()) {
                            throw ArtifactFailure("wrong arity for imported function " + callee_name);
                        }
                        std::map<std::string, double> env;
                        for (std::size_t index = 0; index < function.params.size(); ++index) {
                            env[function.params[index]] = args[index];
                        }
                        return format_number(ImportedExprParser(spill_import_it->second, std::move(env), function.body_expr).parse());
                    }
                }
                const auto stdlib_it = stdlib_exports.find(callee_name);
                if (stdlib_it != stdlib_exports.end()) {
                    vf::JsonValue::Object stdlib_callee;
                    stdlib_callee["kind"] = vf::JsonValue("stdlib_function");
                    stdlib_callee["full_name"] = vf::JsonValue(stdlib_it->second);
                    stdlib_callee["type"] = vf::JsonValue("fn(any)->any");
                    stdlib_callee["module"] = vf::JsonValue(stdlib_it->second.substr(0, stdlib_it->second.find('.')));
                    stdlib_callee["name"] = vf::JsonValue(stdlib_it->second.substr(stdlib_it->second.find('.') + 1));
                    return eval_call(
                        vf::JsonValue::Object{
                            {"kind", vf::JsonValue("call")},
                            {"callee", vf::JsonValue(std::move(stdlib_callee))},
                            {"args", field(object, "args", "call")},
                            {"named_args", object.count("named_args") ? object.at("named_args") : vf::JsonValue(vf::JsonValue::Array{})},
                            {"spread_args", object.count("spread_args") ? object.at("spread_args") : vf::JsonValue(vf::JsonValue::Array{})},
                            {"type", vf::JsonValue("any")},
                        },
                        values,
                        imports,
                        functions,
                        stdlib_exports,
                        ctor_name,
                        output_lines
                    );
                }
                throw ArtifactFailure("artifact emission only supports io.print calls");
            }
            ValueTable nested_values;
            std::vector<std::string> positional_values;
            for (const auto& arg : array_of(field(object, "args", "call"), "call.args")) {
                positional_values.push_back(eval_value(arg, values, imports, functions, stdlib_exports, ctor_name));
            }
            std::map<std::string, std::string> named_values;
            const auto named_it = object.find("named_args");
            if (named_it != object.end() && named_it->second.is_array()) {
                for (const auto& named_arg : named_it->second.as_array()) {
                    const auto& named_object = object_of(named_arg, "named_arg");
                    named_values[string_field(named_object, "name", "named_arg")] =
                        eval_value(field(named_object, "value", "named_arg"), values, imports, functions, stdlib_exports, ctor_name);
                }
            }
            const auto spread_it = object.find("spread_args");
            if (spread_it != object.end() && spread_it->second.is_array()) {
                for (const auto& spread_arg : spread_it->second.as_array()) {
                    const std::string rendered = eval_value(spread_arg, values, imports, functions, stdlib_exports, ctor_name);
                    auto list_items = parse_flat_sequence_string(rendered, '[', ']');
                    if (list_items.empty()) {
                        list_items = parse_flat_sequence_string(rendered, '(', ')');
                    }
                    if (!list_items.empty() || rendered == "[]" || rendered == "()") {
                        positional_values.insert(positional_values.end(), list_items.begin(), list_items.end());
                        continue;
                    }
                    const auto record_fields = parse_flat_record_string(rendered);
                    if (!record_fields.empty() || rendered == "{}") {
                        for (const auto& field_pair : record_fields) {
                            named_values[field_pair.first] = field_pair.second;
                        }
                        continue;
                    }
                    throw ArtifactFailure("spread arg requires rendered list/tuple/record value");
                }
            }

            const auto& params = fn_it->second.params;
            std::size_t positional_index = 0;
            for (const auto& param : params) {
                if (param.variadic_positional) {
                    std::vector<std::string> rest_values;
                    while (positional_index < positional_values.size()) {
                        rest_values.push_back(positional_values[positional_index]);
                        positional_index += 1;
                    }
                    nested_values.set(param.name, render_flat_sequence_string(rest_values, '[', ']'));
                    continue;
                }
                if (param.variadic_named) {
                    std::vector<std::pair<std::string, std::string>> rest_fields;
                    for (const auto& pair : named_values) {
                        rest_fields.push_back(pair);
                    }
                    named_values.clear();
                    nested_values.set(param.name, render_flat_record_string(rest_fields));
                    continue;
                }
                const auto named_found = named_values.find(param.name);
                if (named_found != named_values.end()) {
                    nested_values.set(param.name, named_found->second);
                    named_values.erase(named_found);
                    continue;
                }
                if (positional_index < positional_values.size()) {
                    nested_values.set(param.name, positional_values[positional_index]);
                    positional_index += 1;
                    continue;
                }
                if (!param.default_value.is_null()) {
                    nested_values.set(param.name, eval_value(param.default_value, nested_values, imports, functions, stdlib_exports, callee_name));
                    continue;
                }
                throw ArtifactFailure("wrong arity for function " + callee_name);
            }
            if (positional_index != positional_values.size()) {
                throw ArtifactFailure("too many positional arguments for function " + callee_name);
            }
            if (!named_values.empty()) {
                throw ArtifactFailure("unknown named arguments for function " + callee_name);
            }
            try {
                return eval_block_value(fn_it->second.body, nested_values, imports, functions, stdlib_exports, fn_it->second.name, output_lines);
            } catch (const LocalReturnSignal& signal) {
                return signal.value;
            }
        }
    } else if (callee_kind == "stdlib_function") {
        const std::string full_name = string_field(callee, "full_name", "call.callee");
        if (full_name == "io.print") {
            std::string line;
            for (const auto& arg : array_of(field(object, "args", "call"), "call.args")) {
                line += eval_value(arg, values, imports, functions, stdlib_exports, ctor_name);
            }
            return line;
        }
        if (full_name == "math.sqrt" || full_name == "math.sin" || full_name == "math.cos" || full_name == "math.exp") {
            const auto& args = array_of(field(object, "args", "call"), "call.args");
            if (args.size() != 1) {
                throw ArtifactFailure(full_name + " expects exactly one argument");
            }
            const double input = eval_numeric_value(args.front(), values, imports, functions, stdlib_exports, ctor_name);
            if (full_name == "math.sqrt") {
                return format_number(std::sqrt(input));
            }
            if (full_name == "math.sin") {
                return format_number(std::sin(input));
            }
            if (full_name == "math.cos") {
                return format_number(std::cos(input));
            }
            return format_number(std::exp(input));
        }
        if (starts_with(full_name, "stat.")) {
            const auto& args = array_of(field(object, "args", "call"), "call.args");
            if (full_name == "stat.mean" || full_name == "stat.std" || full_name == "stat.median"
                || full_name == "stat.iqr" || full_name == "stat.zscore" || full_name == "stat.normalize"
                || full_name == "stat.range" || full_name == "stat.count") {
                if (args.size() != 1) {
                    throw ArtifactFailure(full_name + " expects exactly one argument");
                }
                const auto xs = require_numeric_vector(
                    eval_value(args.front(), values, imports, functions, stdlib_exports, ctor_name),
                    full_name
                );
                if (full_name == "stat.mean") {
                    return format_number(stat_mean(xs));
                }
                if (full_name == "stat.std") {
                    return format_number(stat_std(xs));
                }
                if (full_name == "stat.median") {
                    return format_number(stat_median(xs));
                }
                if (full_name == "stat.iqr") {
                    return format_number(stat_quantile(xs, 0.75) - stat_quantile(xs, 0.25));
                }
                if (full_name == "stat.range") {
                    if (xs.empty()) {
                        throw ArtifactFailure("stat.range requires non-empty sequence");
                    }
                    const auto [lo_it, hi_it] = std::minmax_element(xs.begin(), xs.end());
                    return format_number(*hi_it - *lo_it);
                }
                if (full_name == "stat.count") {
                    return format_number(static_cast<double>(xs.size()));
                }
                const double mu = stat_mean(xs);
                if (full_name == "stat.normalize") {
                    double max_abs = 0.0;
                    for (double x : xs) {
                        max_abs = std::max(max_abs, std::abs(x));
                    }
                    std::vector<std::string> items;
                    for (double x : xs) {
                        items.push_back(format_number(max_abs == 0.0 ? 0.0 : x / max_abs));
                    }
                    return render_flat_sequence_string(items, '[', ']');
                }
                const double sigma = stat_std(xs);
                std::vector<std::string> items;
                for (double x : xs) {
                    items.push_back(format_number(sigma == 0.0 ? 0.0 : (x - mu) / sigma));
                }
                return render_flat_sequence_string(items, '[', ']');
            }
            if (full_name == "stat.covariance" || full_name == "stat.correlation") {
                if (args.size() != 2) {
                    throw ArtifactFailure(full_name + " expects exactly two arguments");
                }
                const auto xs = require_numeric_vector(
                    eval_value(args[0], values, imports, functions, stdlib_exports, ctor_name),
                    full_name
                );
                const auto ys = require_numeric_vector(
                    eval_value(args[1], values, imports, functions, stdlib_exports, ctor_name),
                    full_name
                );
                if (full_name == "stat.covariance") {
                    return format_number(stat_covariance(xs, ys));
                }
                const double sx = stat_std(xs);
                const double sy = stat_std(ys);
                if (sx == 0.0 || sy == 0.0) {
                    return format_number(0.0);
                }
                return format_number(stat_covariance(xs, ys) / (sx * sy));
            }
        }
        if (full_name == "collections.list") {
            std::vector<std::string> items;
            for (const auto& arg : array_of(field(object, "args", "call"), "call.args")) {
                items.push_back(eval_value(arg, values, imports, functions, stdlib_exports, ctor_name));
            }
            const auto spread_it = object.find("spread_args");
            if (spread_it != object.end() && spread_it->second.is_array()) {
                for (const auto& spread_arg : spread_it->second.as_array()) {
                    const std::string rendered = eval_value(spread_arg, values, imports, functions, stdlib_exports, ctor_name);
                    auto spread_items = parse_flat_sequence_string(rendered, '[', ']');
                    if (spread_items.empty()) {
                        spread_items = parse_flat_sequence_string(rendered, '(', ')');
                    }
                    if (spread_items.empty() && rendered != "[]" && rendered != "()") {
                        throw ArtifactFailure("collections.list spread requires rendered list or tuple");
                    }
                    items.insert(items.end(), spread_items.begin(), spread_items.end());
                }
            }
            return render_flat_sequence_string(items, '[', ']');
        }
        if (full_name == "collections.queue") {
            const auto& args = array_of(field(object, "args", "call"), "call.args");
            if (!args.empty()) {
                throw ArtifactFailure("collections.queue expects no positional arguments");
            }
            return "queue[]";
        }
        if (full_name == "collections.map") {
            std::vector<std::pair<std::string, std::string>> fields;
            const auto named_it = object.find("named_args");
            if (named_it != object.end() && named_it->second.is_array()) {
                for (const auto& named_arg : named_it->second.as_array()) {
                    const auto& named_object = object_of(named_arg, "named_arg");
                    fields.push_back({
                        string_field(named_object, "name", "named_arg"),
                        eval_value(field(named_object, "value", "named_arg"), values, imports, functions, stdlib_exports, ctor_name),
                    });
                }
            }
            const auto spread_it = object.find("spread_args");
            if (spread_it != object.end() && spread_it->second.is_array()) {
                for (const auto& spread_arg : spread_it->second.as_array()) {
                    const std::string rendered = eval_value(spread_arg, values, imports, functions, stdlib_exports, ctor_name);
                    const auto spread_fields = parse_flat_record_string(rendered);
                    if (spread_fields.empty() && rendered != "{}") {
                        throw ArtifactFailure("collections.map spread requires rendered record");
                    }
                    fields.insert(fields.end(), spread_fields.begin(), spread_fields.end());
                }
            }
            return render_flat_record_string(fields);
        }
        throw ArtifactFailure("unsupported stdlib runtime call " + full_name);
    } else if (callee_kind == "field_access") {
        const auto& base = object_of(field(callee, "object", "field_access"), "field_access.object");
        if (string_field(base, "kind", "field_access.object") == "field_access") {
            const auto& root = object_of(field(base, "object", "nested field root"), "nested field root");
            if (string_field(root, "kind", "nested field root") == "load") {
                const std::string root_alias = string_field(root, "name", "nested field root");
                const std::string nested_name = string_field(base, "field", "nested field");
                const auto nested_module_it = imports.find(root_alias);
                if (nested_module_it != imports.end() && nested_name == "mod") {
                    const std::string function_name = string_field(callee, "field", "field_access");
                    std::vector<double> args;
                    for (const auto& arg : array_of(field(object, "args", "call"), "call.args")) {
                        args.push_back(eval_numeric_value(arg, values, imports, functions, stdlib_exports, ctor_name));
                    }
                    const auto function_it = nested_module_it->second.functions.find(function_name);
                    if (function_it == nested_module_it->second.functions.end()) {
                        throw ArtifactFailure("unknown imported function " + root_alias + "." + nested_name + "." + function_name);
                    }
                    std::map<std::string, double> env;
                    const ImportedFunction& function = function_it->second;
                    if (args.size() != function.params.size()) {
                        throw ArtifactFailure("wrong arity for imported function " + root_alias + "." + nested_name + "." + function_name);
                    }
                    for (std::size_t index = 0; index < args.size(); ++index) {
                        env[function.params[index]] = args[index];
                    }
                    return format_number(ImportedExprParser(nested_module_it->second, std::move(env), function.body_expr).parse());
                }
            }
            throw ArtifactFailure("artifact emission only supports imported namespace function field calls");
        }
        if (string_field(base, "kind", "field_access.object") != "load") {
            throw ArtifactFailure("artifact emission only supports imported namespace function field calls");
        }
        const std::string alias = string_field(base, "name", "field_access.object");
        const std::string function_name = string_field(callee, "field", "field_access");
        std::string rendered_base;
        bool have_rendered_base = false;
        try {
            rendered_base = values.get(alias);
            have_rendered_base = true;
        } catch (const ArtifactFailure&) {
        }
        if (have_rendered_base && rendered_base == "__ui_module__") {
            if (function_name == "set_mode") {
                return "__ui_noop__";
            }
            if (function_name == "axis_2d") {
                return "__ui_axis2d__";
            }
            if (function_name == "axis_3d") {
                return "__ui_axis3d__";
            }
        }
        if (have_rendered_base && rendered_base == "__ui_display__") {
            if (function_name == "frame") {
                return "__ui_frame__";
            }
            if (function_name == "add_frame") {
                return "__ui_noop__";
            }
        }
        if (have_rendered_base && rendered_base == "__ui_frame__") {
            if (function_name == "add_frame" || function_name == "add_camera" || function_name == "add") {
                return "__ui_noop__";
            }
        }
        if (have_rendered_base && (rendered_base == "__ui_axis2d__" || rendered_base == "__ui_axis3d__")) {
            if (function_name == "crosshair" || function_name == "box" || function_name == "plot") {
                return "__ui_noop__";
            }
        }
        const auto module_it = imports.find(alias);
        if (module_it == imports.end()) {
            if (function_name == "length" && array_of(field(object, "args", "call"), "call.args").empty()) {
                const std::string rendered = have_rendered_base ? rendered_base : values.get(alias);
                auto items = parse_flat_sequence_string(rendered, '[', ']');
                if (items.empty()) {
                    items = parse_flat_sequence_string(rendered, '(', ')');
                }
                if (!items.empty() || rendered == "[]" || rendered == "()") {
                    return format_number(static_cast<double>(items.size()));
                }
            }
            throw ArtifactFailure("unknown imported module alias " + alias);
        }
        std::vector<double> args;
        for (const auto& arg : array_of(field(object, "args", "call"), "call.args")) {
            args.push_back(eval_numeric_value(arg, values, imports, functions, stdlib_exports, ctor_name));
        }
        const auto function_it = module_it->second.functions.find(function_name);
        if (function_it == module_it->second.functions.end()) {
            throw ArtifactFailure("unknown imported function " + alias + "." + function_name);
        }
        std::map<std::string, double> env;
        const ImportedFunction& function = function_it->second;
        if (args.size() < function.params.size()) {
            throw ArtifactFailure("wrong arity for imported function " + alias + "." + function_name);
        }
        for (std::size_t index = 0; index < function.params.size(); ++index) {
            env[function.params[index]] = args[index];
        }
        return format_number(ImportedExprParser(module_it->second, std::move(env), function.body_expr).parse());
    } else {
        throw ArtifactFailure("artifact emission only supports io.print call targets");
    }
    std::string line;
    for (const auto& arg : array_of(field(object, "args", "call"), "call.args")) {
        line += eval_value(arg, values, imports, functions, stdlib_exports, ctor_name);
    }
    return line;
}

std::string eval_value(const vf::JsonValue& value, const ValueTable& values, const ImportTable& imports, const LocalFunctionTable& functions, const StdlibExportTable& stdlib_exports, const std::string& ctor_name, std::vector<std::string>* output_lines) {
    const auto& object = object_of(value, "typed IR value");
    const std::string kind = string_field(object, "kind", "typed IR value");
    if (kind == "const") {
        return value_to_script_text(field(object, "value", "const"));
    }
    if (kind == "load") {
        return values.get(string_field(object, "name", "load"));
    }
    if (kind == "call") {
        return eval_call(object, values, imports, functions, stdlib_exports, ctor_name, output_lines);
    }
    if (kind == "record") {
        std::string out = "{";
        const auto& fields = array_of(field(object, "fields", "record"), "record.fields");
        for (std::size_t i = 0; i < fields.size(); ++i) {
            const auto& field_object = object_of(fields[i], "record field");
            if (i > 0) {
                out += ", ";
            }
            out += string_field(field_object, "name", "record field");
            out += ": ";
            out += eval_value(field(field_object, "value", "record field"), values, imports, functions, stdlib_exports, ctor_name);
        }
        out += "}";
        return out;
    }
    if (kind == "tuple") {
        std::string out = "(";
        const auto& items = array_of(field(object, "items", "tuple"), "tuple.items");
        for (std::size_t i = 0; i < items.size(); ++i) {
            if (i > 0) {
                out += ", ";
            }
            out += eval_value(items[i], values, imports, functions, stdlib_exports, ctor_name);
        }
        out += ")";
        return out;
    }
    if (kind == "list") {
        std::string out = "[";
        const auto& items = array_of(field(object, "items", "list"), "list.items");
        for (std::size_t i = 0; i < items.size(); ++i) {
            if (i > 0) {
                out += ", ";
            }
            out += eval_value(items[i], values, imports, functions, stdlib_exports, ctor_name);
        }
        out += "]";
        return out;
    }
    if (kind == "multiset") {
        NumericMultiset out;
        const auto& pairs = array_of(field(object, "pairs", "multiset"), "multiset.pairs");
        for (const auto& pair_value : pairs) {
            const auto& pair_object = object_of(pair_value, "multiset pair");
            const double key = eval_numeric_value(field(pair_object, "key", "multiset pair"), values, imports, functions, stdlib_exports, ctor_name);
            const double raw_count = eval_numeric_value(field(pair_object, "count", "multiset pair"), values, imports, functions, stdlib_exports, ctor_name);
            if (!std::isfinite(raw_count) || std::floor(raw_count) != raw_count) {
                throw ArtifactFailure("multiset count must be an integer");
            }
            const long long count = static_cast<long long>(raw_count);
            if (count > 0) {
                out[key] += count;
            }
        }
        return render_numeric_multiset_string(out);
    }
    if (kind == "binary_op") {
        const std::string op = string_field(object, "op", "binary_op");
        const std::string left_type = string_field(object, "left_type", "binary_op");
        const std::string right_type = string_field(object, "right_type", "binary_op");
        const std::string overload_name = function_name_for_operator(op);
        if (!overload_name.empty()) {
            const auto fn_it = functions.find(overload_name);
            const bool scalar_builtin = (left_type == "num" && right_type == "num")
                || (left_type == "bool" && right_type == "bool")
                || (left_type == "str" && right_type == "str");
            if (fn_it != functions.end() && !scalar_builtin && left_type != "any" && right_type != "any") {
                if (fn_it->second.params.size() != 2) {
                    throw ArtifactFailure("operator overload requires exactly two params");
                }
                ValueTable nested_values;
                nested_values.set(
                    fn_it->second.params[0].name,
                    eval_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
                );
                nested_values.set(
                    fn_it->second.params[1].name,
                    eval_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
                );
                try {
                    return eval_block_value(fn_it->second.body, nested_values, imports, functions, stdlib_exports, fn_it->second.name, output_lines);
                } catch (const LocalReturnSignal& signal) {
                    return signal.value;
                }
            }
        }
        if (op == "STAR" && starts_with(left_type, "axis<") && starts_with(right_type, "axis<")) {
            const std::vector<double> left_values = parse_numeric_sequence_string(
                eval_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
            );
            const std::vector<double> right_values = parse_numeric_sequence_string(
                eval_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
            );
            if (!left_values.empty() || !right_values.empty()) {
                std::string out = "(";
                for (std::size_t i = 0; i < left_values.size(); ++i) {
                    if (i > 0) {
                        out += ", ";
                    }
                    std::vector<std::string> row;
                    for (double right : right_values) {
                        row.push_back(format_number(left_values[i] * right));
                    }
                    out += render_flat_sequence_string(row, '(', ')');
                }
                out += ")";
                return out;
            }
        }
        if (op == "AMPERSAND") {
            const std::string left = eval_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name);
            const std::string right = eval_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name);
            if (left.size() >= 2 && right.size() >= 2 && left.front() == '[' && left.back() == ']' && right.front() == '[' && right.back() == ']') {
                auto left_items = parse_flat_sequence_string(left, '[', ']');
                auto right_items = parse_flat_sequence_string(right, '[', ']');
                left_items.insert(left_items.end(), right_items.begin(), right_items.end());
                return render_flat_sequence_string(left_items, '[', ']');
            }
            if (left.size() >= 2 && right.size() >= 2 && left.front() == '(' && left.back() == ')' && right.front() == '(' && right.back() == ')') {
                auto left_items = parse_flat_sequence_string(left, '(', ')');
                auto right_items = parse_flat_sequence_string(right, '(', ')');
                left_items.insert(left_items.end(), right_items.begin(), right_items.end());
                return render_flat_sequence_string(left_items, '(', ')');
            }
            return left + right;
        }
        if (starts_with(left_type, "multiset<") && starts_with(right_type, "multiset<")) {
            NumericMultiset left = parse_numeric_multiset_string(
                eval_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
            );
            NumericMultiset right = parse_numeric_multiset_string(
                eval_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
            );
            NumericMultiset out;
            if (op == "PLUS") {
                out = left;
                for (const auto& [key, count] : right) {
                    out[key] += count;
                }
                return render_numeric_multiset_string(out);
            }
            if (op == "MINUS") {
                out = left;
                for (const auto& [key, count] : right) {
                    auto it = out.find(key);
                    if (it == out.end()) {
                        continue;
                    }
                    it->second -= count;
                    if (it->second <= 0) {
                        out.erase(it);
                    }
                }
                return render_numeric_multiset_string(out);
            }
            if (op == "FLOORDIV") {
                for (const auto& [key, left_count] : left) {
                    auto right_it = right.find(key);
                    if (right_it == right.end() || right_it->second <= 0) {
                        continue;
                    }
                    const long long count = left_count / right_it->second;
                    if (count > 0) {
                        out[key] = count;
                    }
                }
                return render_numeric_multiset_string(out);
            }
        }
        if (is_sequence_type(left_type)
            && is_sequence_type(right_type)
            && (op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH")) {
            const std::vector<double> left = parse_numeric_sequence_string(
                eval_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
            );
            const std::vector<double> right = parse_numeric_sequence_string(
                eval_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
            );
            if (left.size() != right.size()) {
                throw ArtifactFailure("vector arithmetic requires equal lengths");
            }
            std::vector<std::string> out;
            for (std::size_t i = 0; i < left.size(); ++i) {
                if (op == "PLUS") {
                    out.push_back(format_number(left[i] + right[i]));
                } else if (op == "MINUS") {
                    out.push_back(format_number(left[i] - right[i]));
                } else if (op == "STAR") {
                    out.push_back(format_number(left[i] * right[i]));
                } else {
                    out.push_back(format_number(left[i] / right[i]));
                }
            }
            return render_flat_sequence_string(out, '[', ']');
        }
        if (is_sequence_type(left_type) && right_type == "num"
            && (op == "STAR" || op == "SLASH")) {
            const std::vector<double> left = parse_numeric_sequence_string(
                eval_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
            );
            const double right = eval_numeric_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name);
            std::vector<std::string> out;
            for (double value : left) {
                out.push_back(format_number(op == "STAR" ? value * right : value / right));
            }
            return render_flat_sequence_string(out, '[', ']');
        }
        if (left_type == "num" && is_sequence_type(right_type) && op == "STAR") {
            const double left = eval_numeric_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name);
            const std::vector<double> right = parse_numeric_sequence_string(
                eval_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines)
            );
            std::vector<std::string> out;
            for (double value : right) {
                out.push_back(format_number(left * value));
            }
            return render_flat_sequence_string(out, '[', ']');
        }
        if (op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH") {
            const std::string left_rendered = eval_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines);
            const std::string right_rendered = eval_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name, output_lines);
            const bool left_seq_shape = (left_rendered.size() >= 2 && ((left_rendered.front() == '[' && left_rendered.back() == ']') || (left_rendered.front() == '(' && left_rendered.back() == ')')));
            const bool right_seq_shape = (right_rendered.size() >= 2 && ((right_rendered.front() == '[' && right_rendered.back() == ']') || (right_rendered.front() == '(' && right_rendered.back() == ')')));
            if (left_seq_shape && right_seq_shape) {
                const std::vector<double> left = parse_numeric_sequence_string(left_rendered);
                const std::vector<double> right = parse_numeric_sequence_string(right_rendered);
                if (left.size() != right.size()) {
                    throw ArtifactFailure("vector arithmetic requires equal lengths");
                }
                std::vector<std::string> out;
                for (std::size_t i = 0; i < left.size(); ++i) {
                    if (op == "PLUS") out.push_back(format_number(left[i] + right[i]));
                    else if (op == "MINUS") out.push_back(format_number(left[i] - right[i]));
                    else if (op == "STAR") out.push_back(format_number(left[i] * right[i]));
                    else out.push_back(format_number(left[i] / right[i]));
                }
                return render_flat_sequence_string(out, '[', ']');
            }
            if (left_seq_shape && (op == "STAR" || op == "SLASH")) {
                try {
                    const std::vector<double> left = parse_numeric_sequence_string(left_rendered);
                    const double right = std::stod(right_rendered);
                    std::vector<std::string> out;
                    for (double value : left) {
                        out.push_back(format_number(op == "STAR" ? value * right : value / right));
                    }
                    return render_flat_sequence_string(out, '[', ']');
                } catch (const std::exception&) {
                }
            }
            if (right_seq_shape && op == "STAR") {
                try {
                    const double left = std::stod(left_rendered);
                    const std::vector<double> right = parse_numeric_sequence_string(right_rendered);
                    std::vector<std::string> out;
                    for (double value : right) {
                        out.push_back(format_number(left * value));
                    }
                    return render_flat_sequence_string(out, '[', ']');
                } catch (const std::exception&) {
                }
            }
            if (left_rendered.size() >= 2 && right_rendered.size() >= 2 && left_rendered.front() == '{' && left_rendered.back() == '}' && right_rendered.front() == '{' && right_rendered.back() == '}') {
                try {
                    NumericMultiset left = parse_numeric_multiset_string(left_rendered);
                    NumericMultiset right = parse_numeric_multiset_string(right_rendered);
                    if (op == "PLUS") {
                        for (const auto& [key, count] : right) {
                            left[key] += count;
                        }
                        return render_numeric_multiset_string(left);
                    }
                    if (op == "MINUS") {
                        for (const auto& [key, count] : right) {
                            auto it = left.find(key);
                            if (it != left.end()) {
                                it->second -= count;
                                if (it->second <= 0) {
                                    left.erase(it);
                                }
                            }
                        }
                        return render_numeric_multiset_string(left);
                    }
                } catch (const ArtifactFailure&) {
                }
            }
        }
        if (op == "PLUS" || op == "MINUS" || op == "STAR" || op == "SLASH" || op == "FLOORDIV" || op == "PERCENT" || op == "CARET") {
            return format_number(eval_numeric_value(value, values, imports, functions, stdlib_exports, ctor_name));
        }
        if (op == "AND" || op == "OR" || op == "XOR") {
            bool left = false;
            bool right = false;
            if (!parse_truthy_bool(eval_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name), left)
                || !parse_truthy_bool(eval_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name), right)) {
                throw ArtifactFailure("boolean op requires rendered bool operands");
            }
            const bool result = op == "AND" ? (left && right) : (op == "OR" ? (left || right) : (left != right));
            return result ? "true" : "false";
        }
        return "("
            + eval_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports, ctor_name)
            + " " + op
            + " " + eval_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports, ctor_name)
            + ")";
    }
    if (kind == "unary_op") {
        const std::string op = string_field(object, "op", "unary_op");
        if (op == "NOT") {
            bool operand = false;
            if (!parse_truthy_bool(eval_value(field(object, "operand", "unary_op"), values, imports, functions, stdlib_exports, ctor_name), operand)) {
                throw ArtifactFailure("NOT requires rendered bool operand");
            }
            return operand ? "false" : "true";
        }
        if (op == "MINUS") {
            return format_number(eval_numeric_value(value, values, imports, functions, stdlib_exports, ctor_name));
        }
    }
    if (kind == "axis_align") {
        return eval_value(field(object, "value", "axis_align"), values, imports, functions, stdlib_exports, ctor_name, output_lines);
    }
    if (kind == "field_access") {
        const vf::JsonValue& base_value = field(object, "object", "field_access");
        const auto& base_object = object_of(base_value, "field_access.object");
        const std::string field_name = string_field(object, "field", "field_access");
        if (string_field(base_object, "kind", "field_access.object") == "load") {
            const std::string rendered = values.get(string_field(base_object, "name", "field_access.object"));
            const auto fields = parse_flat_record_string(rendered);
            if (rendered == "__ui_module__" && field_name == "display") {
                return "__ui_display__";
            }
            if (!fields.empty() || rendered == "{}") {
                for (const auto& pair : fields) {
                    if (pair.first == field_name) {
                        return pair.second;
                    }
                }
            }
        }
        const std::string rendered_base = eval_value(base_value, values, imports, functions, stdlib_exports, ctor_name, output_lines);
        const auto fields = parse_flat_record_string(rendered_base);
        if (!fields.empty() || rendered_base == "{}") {
            for (const auto& pair : fields) {
                if (pair.first == field_name) {
                    return pair.second;
                }
            }
        }
        return rendered_base + "." + field_name;
    }
    if (kind == "scope_identity") {
        return render_scope_identity_record(values, ctor_name);
    }
    if (kind == "dotted_index") {
        const vf::JsonValue& base_value = field(object, "base", "dotted_index");
        const auto& base_object = object_of(base_value, "dotted_index.base");
        const auto& indices = array_of(field(object, "indices", "dotted_index"), "dotted_index.indices");
        if (indices.size() == 1) {
            const auto& index_object = object_of(indices.front(), "dotted_index.index");
            const std::string index_kind = string_field(index_object, "kind", "dotted_index.index");
            if ((index_kind == "const" && field(index_object, "value", "dotted_index.index").is_number())
                || index_kind == "load"
                || index_kind == "binary_op"
                || index_kind == "field_access"
                || index_kind == "dotted_index"
                || index_kind == "call") {
                double raw_index = 0.0;
                if (index_kind == "const") {
                    raw_index = field(index_object, "value", "dotted_index.index").as_number();
                } else {
                    raw_index = eval_numeric_value(indices.front(), values, imports, functions, stdlib_exports, ctor_name);
                }
                if (raw_index < 0 || std::floor(raw_index) != raw_index) {
                    throw ArtifactFailure("dotted_index requires non-negative integral index");
                }
                const std::size_t index = static_cast<std::size_t>(raw_index);
                const std::string base_kind = string_field(base_object, "kind", "dotted_index.base");
                if (base_kind == "tuple") {
                    const auto& items = array_of(field(base_object, "items", "tuple"), "tuple.items");
                    if (index >= items.size()) {
                        throw ArtifactFailure("tuple dotted_index out of range");
                    }
                    return eval_value(items[index], values, imports, functions, stdlib_exports, ctor_name);
                }
                if (base_kind == "list") {
                    const auto& items = array_of(field(base_object, "items", "list"), "list.items");
                    if (index >= items.size()) {
                        throw ArtifactFailure("list dotted_index out of range");
                    }
                    return eval_value(items[index], values, imports, functions, stdlib_exports, ctor_name);
                }
                if (base_kind == "load") {
                    const std::string rendered = values.get(string_field(base_object, "name", "dotted_index.base"));
                    const std::vector<std::string>* items = &cached_flat_sequence_string(rendered, '(', ')');
                    if (items->empty()) {
                        items = &cached_flat_sequence_string(rendered, '[', ']');
                    }
                    if (!items->empty()) {
                        if (index >= items->size()) {
                            throw ArtifactFailure("rendered dotted_index out of range");
                        }
                        return (*items)[index];
                    }
                }
            }
        }
        return eval_value(base_value, values, imports, functions, stdlib_exports, ctor_name, output_lines)
            + ".(" + render_array_summary(indices) + ")";
    }
    if (kind == "block") {
        return "<block>";
    }
    if (kind == "block_expr") {
        return "<block>";
    }
    if (kind == "match_stmt") {
        ValueTable nested_values = values;
        return eval_match_stmt_value(value, nested_values, imports, functions, stdlib_exports, ctor_name, output_lines);
    }
    throw ArtifactFailure("unsupported typed IR value kind " + kind);
}

std::string eval_block_value(const vf::JsonValue& block, ValueTable& values, const ImportTable& imports, const LocalFunctionTable& functions, const StdlibExportTable& stdlib_exports, const std::string& ctor_name, std::vector<std::string>* output_lines) {
    const auto& object = object_of(block, "typed IR function body");
    const std::string kind = string_field(object, "kind", "typed IR function body");
    const vf::JsonValue* body_value = nullptr;
    if (kind == "block" || kind == "block_expr") {
        body_value = &field(object, "body", "typed IR function body");
    } else {
        throw ArtifactFailure("unsupported function body kind " + kind);
    }

    std::string last_value;
    for (const auto& stmt : array_of(*body_value, "typed IR function body items")) {
        const auto& stmt_object = object_of(stmt, "typed IR function stmt");
        const std::string stmt_kind = string_field(stmt_object, "kind", "typed IR function stmt");
        if (stmt_kind == "store_binding") {
            values.set(
                string_field(stmt_object, "name", "store_binding"),
                eval_value(field(stmt_object, "value", "store_binding"), values, imports, functions, stdlib_exports, ctor_name)
            );
            continue;
        }
        if (stmt_kind == "expr_stmt") {
            const vf::JsonValue& expr_value = field(stmt_object, "expr", "expr_stmt");
            const auto& expr_object = object_of(expr_value, "expr_stmt");
            if (string_field(expr_object, "kind", "expr_stmt") == "match_stmt") {
                last_value = eval_match_stmt_value(expr_value, values, imports, functions, stdlib_exports, ctor_name, output_lines);
            } else {
                last_value = eval_value(expr_value, values, imports, functions, stdlib_exports, ctor_name, output_lines);
            }
            continue;
        }
        if (stmt_kind == "label_print") {
            const std::string label = string_field(stmt_object, "label", "label_print");
            const std::string rendered = eval_value(field(stmt_object, "value", "label_print"), values, imports, functions, stdlib_exports, ctor_name, output_lines);
            if (output_lines != nullptr) {
                output_lines->push_back(label + ": " + rendered);
            }
            last_value.clear();
            continue;
        }
        if (stmt_kind == "spill_stmt") {
            const std::string spilled = eval_value(field(stmt_object, "value", "spill_stmt"), values, imports, functions, stdlib_exports, ctor_name, output_lines);
            const auto fields = parse_flat_record_string(spilled);
            if (fields.empty() && spilled != "{}") {
                throw ArtifactFailure("spill_stmt requires rendered record value");
            }
            for (const auto& field_pair : fields) {
                values.set(field_pair.first, field_pair.second);
            }
            last_value = spilled;
            continue;
        }
        if (stmt_kind == "if_stmt") {
            const bool loop = field(stmt_object, "loop", "if_stmt").is_boolean()
                && field(stmt_object, "loop", "if_stmt").as_boolean();
            std::size_t iterations = 0;
            do {
                if (!eval_condition_value(field(stmt_object, "condition", "if_stmt"), values, imports, functions, stdlib_exports, ctor_name)) {
                    break;
                }
                const std::string nested = eval_block_value(field(stmt_object, "body", "if_stmt"), values, imports, functions, stdlib_exports, ctor_name, output_lines);
                if (!nested.empty()) {
                    last_value = nested;
                }
                iterations += 1;
                if (iterations > 1000000) {
                    throw ArtifactFailure("if loop exceeded native artifact iteration limit");
                }
            } while (loop);
            continue;
        }
        if (stmt_kind == "return") {
            throw LocalReturnSignal{eval_value(field(stmt_object, "value", "return"), values, imports, functions, stdlib_exports, ctor_name, output_lines)};
        }
        throw ArtifactFailure("unsupported function statement kind " + stmt_kind);
    }
    return last_value;
}

std::string eval_match_stmt_value(
    const vf::JsonValue& value,
    ValueTable& values,
    const ImportTable& imports,
    const LocalFunctionTable& functions,
    const StdlibExportTable& stdlib_exports,
    const std::string& ctor_name,
    std::vector<std::string>* output_lines
) {
    const auto& object = object_of(value, "typed IR match_stmt");
    const std::string discriminant = eval_value(field(object, "discriminant", "match_stmt"), values, imports, functions, stdlib_exports, ctor_name, output_lines);
    const auto& arms = array_of(field(object, "arms", "match_stmt"), "match_stmt.arms");
    for (const auto& arm_value : arms) {
        const auto& arm = object_of(arm_value, "match arm");
        const auto found = arm.find("condition");
        bool matches = false;
        if (found == arm.end() || found->second.is_null()) {
            matches = true;
        } else {
            matches = eval_value(found->second, values, imports, functions, stdlib_exports, ctor_name, output_lines) == discriminant;
        }
        if (!matches) {
            continue;
        }
        const vf::JsonValue& body = field(arm, "body", "match arm");
        const auto& body_object = object_of(body, "match arm body");
        const std::string body_kind = string_field(body_object, "kind", "match arm body");
        if (body_kind == "block" || body_kind == "block_expr") {
            return eval_block_value(body, values, imports, functions, stdlib_exports, ctor_name, output_lines);
        }
        return eval_value(body, values, imports, functions, stdlib_exports, ctor_name, output_lines);
    }
    return "";
}

bool eval_condition_value(const vf::JsonValue& value, const ValueTable& values, const ImportTable& imports, const LocalFunctionTable& functions, const StdlibExportTable& stdlib_exports, const std::string& ctor_name) {
    const auto& object = object_of(value, "typed IR condition");
    const std::string kind = string_field(object, "kind", "typed IR condition");
    if (kind == "const") {
        const vf::JsonValue& raw = field(object, "value", "const");
        if (raw.is_boolean()) {
            return raw.as_boolean();
        }
        if (raw.is_number()) {
            return raw.as_number() != 0.0;
        }
        if (raw.is_string()) {
            return !raw.as_string().empty();
        }
        return false;
    }
    if (kind == "load") {
        const std::string rendered = values.get(string_field(object, "name", "load"));
        return !(rendered.empty() || rendered == "0" || rendered == "false" || rendered == "null");
    }
    if (kind == "binary_op") {
        const std::string op = string_field(object, "op", "binary_op");
        if (op == "LT" || op == "LE" || op == "GT" || op == "GE" || op == "EQ" || op == "NE") {
            const double left = eval_numeric_value(field(object, "left", "binary_op"), values, imports, functions, stdlib_exports);
            const double right = eval_numeric_value(field(object, "right", "binary_op"), values, imports, functions, stdlib_exports);
            if (op == "LT") return left < right;
            if (op == "LE") return left <= right;
            if (op == "GT") return left > right;
            if (op == "GE") return left >= right;
            if (op == "EQ") return left == right;
            return left != right;
        }
    }
    return !(eval_value(value, values, imports, functions, stdlib_exports).empty());
}

std::string render_value_summary(const vf::JsonValue& value) {
    const auto& object = object_of(value, "typed IR value");
    const std::string kind = string_field(object, "kind", "typed IR value");
    if (kind == "const") {
        return value_to_script_text(field(object, "value", "const"));
    }
    if (kind == "load") {
        return "$" + string_field(object, "name", "load");
    }
    if (kind == "stdlib_function") {
        return string_field(object, "full_name", "stdlib_function");
    }
    if (kind == "record") {
        std::string out = "{";
        const auto& fields = array_of(field(object, "fields", "record"), "record.fields");
        for (std::size_t i = 0; i < fields.size(); ++i) {
            const auto& field_object = object_of(fields[i], "record field");
            if (i > 0) {
                out += ", ";
            }
            out += string_field(field_object, "name", "record field");
            out += ": ";
            out += render_value_summary(field(field_object, "value", "record field"));
        }
        out += "}";
        return out;
    }
    if (kind == "tuple") {
        std::string out = "(";
        const auto& items = array_of(field(object, "items", "tuple"), "tuple.items");
        for (std::size_t i = 0; i < items.size(); ++i) {
            if (i > 0) {
                out += ", ";
            }
            out += render_value_summary(items[i]);
        }
        out += ")";
        return out;
    }
    if (kind == "list") {
        return render_array_summary(array_of(field(object, "items", "list"), "list.items"));
    }
    if (kind == "multiset") {
        std::string out = "{";
        const auto& pairs = array_of(field(object, "pairs", "multiset"), "multiset.pairs");
        for (std::size_t i = 0; i < pairs.size(); ++i) {
            if (i > 0) {
                out += ", ";
            }
            const auto& pair_object = object_of(pairs[i], "multiset pair");
            out += render_value_summary(field(pair_object, "key", "multiset pair"));
            out += ":";
            out += render_value_summary(field(pair_object, "count", "multiset pair"));
        }
        out += "}";
        return out;
    }
    if (kind == "binary_op") {
        return "("
            + render_value_summary(field(object, "left", "binary_op"))
            + " " + string_field(object, "op", "binary_op")
            + " " + render_value_summary(field(object, "right", "binary_op"))
            + ")";
    }
    if (kind == "unary_op") {
        return string_field(object, "op", "unary_op")
            + render_value_summary(field(object, "operand", "unary_op"));
    }
    if (kind == "axis_align") {
        return render_value_summary(field(object, "value", "axis_align"))
            + " -> " + string_field(object, "axis_key", "axis_align");
    }
    if (kind == "field_access") {
        return render_value_summary(field(object, "object", "field_access"))
            + "." + string_field(object, "field", "field_access");
    }
    if (kind == "dotted_index") {
        return render_value_summary(field(object, "base", "dotted_index"))
            + ".(" + render_array_summary(array_of(field(object, "indices", "dotted_index"), "dotted_index.indices")) + ")";
    }
    if (kind == "call") {
        return render_value_summary(field(object, "callee", "call"))
            + "(" + render_array_summary(array_of(field(object, "args", "call"), "call.args")) + ")";
    }
    if (kind == "block") {
        return "<block>";
    }
    if (kind == "block_expr") {
        return "<block>";
    }
    if (kind == "match_stmt") {
        return "<match>";
    }
    if (kind == "scope_identity") {
        return "<scope>";
    }
    return "<" + kind + ">";
}

std::string best_effort_value(const vf::JsonValue& value, const ValueTable& values) {
    try {
        static const ImportTable empty_imports;
        static const LocalFunctionTable empty_functions;
        static const StdlibExportTable empty_stdlib_exports;
        return eval_value(value, values, empty_imports, empty_functions, empty_stdlib_exports);
    } catch (const ArtifactFailure&) {
        return render_value_summary(value);
    }
}

std::string escape_cmd_echo(std::string text) {
    std::string out;
    for (char ch : text) {
        if (ch == '^' || ch == '&' || ch == '|' || ch == '<' || ch == '>') {
            out.push_back('^');
        }
        out.push_back(ch);
    }
    return out;
}

std::string emit_artifact_script(const vf::JsonValue& root, const std::filesystem::path& source_path, std::vector<Dependency>& discovered_dependencies) {
    const auto& module = object_of(root, "typed IR module");
    ValueTable values;
    ImportTable imports;
    LocalFunctionTable functions;
    StdlibExportTable stdlib_exports;
    std::string script = "@echo off\r\n";
    for (const auto& stmt : array_of(field(module, "body", "typed_module"), "typed_module.body")) {
        const auto& object = object_of(stmt, "typed IR stmt");
        if (string_field(object, "kind", "typed IR stmt") != "function") {
            continue;
        }
        std::vector<LocalFunction::Param> params;
        for (const auto& param_value : array_of(field(object, "params", "function"), "function.params")) {
            const auto& param_object = object_of(param_value, "function param");
            params.push_back(LocalFunction::Param{
                string_field(param_object, "name", "function param"),
                field(param_object, "default", "function param"),
                field(param_object, "variadic_positional", "function param").is_boolean()
                    && field(param_object, "variadic_positional", "function param").as_boolean(),
                field(param_object, "variadic_named", "function param").is_boolean()
                    && field(param_object, "variadic_named", "function param").as_boolean(),
            });
        }
        functions[string_field(object, "name", "function")] = LocalFunction{
            string_field(object, "name", "function"),
            std::move(params),
            field(object, "body", "function"),
        };
    }
    for (const auto& stmt : array_of(field(module, "body", "typed_module"), "typed_module.body")) {
        const auto& object = object_of(stmt, "typed IR stmt");
        const std::string kind = string_field(object, "kind", "typed IR stmt");
        if (kind == "store_binding") {
            const vf::JsonValue& stored_value = field(object, "value", "store_binding");
            try {
                values.set(
                    string_field(object, "name", "store_binding"),
                    eval_value(stored_value, values, imports, functions, stdlib_exports)
                );
            } catch (const ArtifactFailure&) {
                values.set(
                    string_field(object, "name", "store_binding"),
                    best_effort_value(stored_value, values)
                );
            }
            continue;
        }
        if (kind == "update_attr") {
            const std::string base_name = string_field(object, "base_name", "update_attr");
            const std::string field_name = string_field(object, "field", "update_attr");
            const std::string rendered = values.get(base_name);
            auto fields = parse_flat_record_string(rendered);
            if (fields.empty() && rendered != "{}") {
                throw ArtifactFailure("update_attr requires rendered record base");
            }
            const std::string field_value = eval_value(field(object, "value", "update_attr"), values, imports, functions, stdlib_exports);
            bool updated = false;
            for (auto& pair : fields) {
                if (pair.first == field_name) {
                    pair.second = field_value;
                    updated = true;
                    break;
                }
            }
            if (!updated) {
                fields.push_back({field_name, field_value});
            }
            values.set(base_name, render_flat_record_string(fields));
            continue;
        }
        if (kind == "update_index") {
            const std::string base_name = string_field(object, "base_name", "update_index");
            const std::string rendered = values.get(base_name);
            const auto& indices = array_of(field(object, "indices", "update_index"), "update_index.indices");
            if (indices.size() != 1) {
                throw ArtifactFailure("update_index only supports one index");
            }
            const auto& index_object = object_of(indices.front(), "update_index.index");
            if (string_field(index_object, "kind", "update_index.index") != "const") {
                throw ArtifactFailure("update_index only supports constant indices");
            }
            const vf::JsonValue& raw_index = field(index_object, "value", "update_index.index");
            if (raw_index.is_number()) {
                const std::size_t index = static_cast<std::size_t>(raw_index.as_number());
                auto items = parse_flat_sequence_string(rendered, '[', ']');
                if (items.empty() && rendered != "[]") {
                    throw ArtifactFailure("update_index requires rendered list base");
                }
                if (index >= items.size()) {
                    throw ArtifactFailure("update_index out of range");
                }
                items[index] = eval_value(field(object, "value", "update_index"), values, imports, functions, stdlib_exports);
                values.set(base_name, render_flat_sequence_string(items, '[', ']'));
                continue;
            }
            if (raw_index.is_string()) {
                auto fields = parse_flat_record_string(rendered);
                if (fields.empty() && rendered != "{}") {
                    throw ArtifactFailure("update_index requires rendered record base for string key");
                }
                const std::string key = raw_index.as_string();
                const std::string new_value = eval_value(field(object, "value", "update_index"), values, imports, functions, stdlib_exports);
                bool updated = false;
                for (auto& pair : fields) {
                    if (pair.first == key) {
                        pair.second = new_value;
                        updated = true;
                        break;
                    }
                }
                if (!updated) {
                    fields.push_back({key, new_value});
                }
                values.set(base_name, render_flat_record_string(fields));
                continue;
            }
            throw ArtifactFailure("update_index only supports constant numeric or string indices");
        }
        if (kind == "module_import") {
            const vf::JsonValue& alias_value = field(object, "alias", "module_import");
            const auto& path_object = object_of(field(object, "path", "module_import"), "module_import.path");
            const auto& segments = array_of(field(path_object, "segments", "module_import.path"), "module_import.path.segments");
            const bool is_stdlib_path = segments.size() == 1
                && segments.front().is_string()
                && (segments.front().as_string() == "math"
                    || segments.front().as_string() == "stat"
                    || segments.front().as_string() == "collections"
                    || segments.front().as_string() == "ui");
            if (is_stdlib_path) {
                const std::string module_name = segments.front().as_string();
                if (alias_value.is_string()) {
                    if (module_name == "ui") {
                        values.set(alias_value.as_string(), "__ui_module__");
                    } else {
                        stdlib_exports[alias_value.as_string()] = module_name;
                    }
                } else if (alias_value.is_null()) {
                    if (module_name == "math") {
                        stdlib_exports["sqrt"] = "math.sqrt";
                        stdlib_exports["sin"] = "math.sin";
                        stdlib_exports["cos"] = "math.cos";
                        stdlib_exports["exp"] = "math.exp";
                    } else if (module_name == "stat") {
                        stdlib_exports["mean"] = "stat.mean";
                        stdlib_exports["std"] = "stat.std";
                        stdlib_exports["median"] = "stat.median";
                        stdlib_exports["iqr"] = "stat.iqr";
                        stdlib_exports["zscore"] = "stat.zscore";
                        stdlib_exports["normalize"] = "stat.normalize";
                        stdlib_exports["covariance"] = "stat.covariance";
                        stdlib_exports["correlation"] = "stat.correlation";
                        stdlib_exports["range"] = "stat.range";
                        stdlib_exports["count"] = "stat.count";
                    } else if (module_name == "collections") {
                        stdlib_exports["map"] = "collections.map";
                        stdlib_exports["list"] = "collections.list";
                        stdlib_exports["queue"] = "collections.queue";
                    } else if (module_name == "ui") {
                        values.set("ui", "__ui_module__");
                    }
                } else {
                    throw ArtifactFailure("unsupported stdlib import alias shape");
                }
                script += "rem stdlib import\r\n";
                continue;
            }
            const std::filesystem::path resolved_path = resolve_dot_module_path(field(object, "path", "module_import"), source_path);
            const std::string alias = alias_value.is_string() ? alias_value.as_string() : "";
            imports[alias] = parse_imported_module_file(resolved_path);
            discovered_dependencies.push_back({"import:" + (alias.empty() ? "<spill>" : alias), resolved_path, stable_hash(read_file(resolved_path))});
            script += "rem module import\r\n";
            continue;
        }
        if (kind == "type_alias") {
            script += "rem type alias\r\n";
            continue;
        }
        if (kind == "expr_stmt") {
            const auto& expr = object_of(field(object, "expr", "expr_stmt"), "expr_stmt.expr");
            if (string_field(expr, "kind", "expr_stmt.expr") == "match_stmt") {
                (void)eval_match_stmt_value(field(object, "expr", "expr_stmt"), values, imports, functions, stdlib_exports, "", nullptr);
                continue;
            }
            if (string_field(expr, "kind", "expr_stmt.expr") == "call") {
                const auto& callee = object_of(field(expr, "callee", "call"), "expr_stmt.call.callee");
                if (string_field(callee, "kind", "expr_stmt.call.callee") == "field_access") {
                    const auto& base = object_of(field(callee, "object", "field_access"), "expr_stmt.call.base");
                    if (string_field(base, "kind", "expr_stmt.call.base") == "load") {
                        const std::string base_name = string_field(base, "name", "expr_stmt.call.base");
                        const std::string field_name = string_field(callee, "field", "expr_stmt.call.callee");
                        const std::string rendered_base = values.get(base_name);
                        if (rendered_base.rfind("queue[", 0) == 0 && rendered_base.size() >= 6 && rendered_base.back() == ']') {
                            auto items = parse_flat_sequence_string(rendered_base.substr(5), '[', ']');
                            if (field_name == "put") {
                                const auto& args = array_of(field(expr, "args", "call"), "expr_stmt.call.args");
                                if (args.size() != 1) {
                                    throw ArtifactFailure("queue.put expects one argument");
                                }
                                items.push_back(eval_value(args.front(), values, imports, functions, stdlib_exports));
                                values.set(base_name, "queue" + render_flat_sequence_string(items, '[', ']'));
                                continue;
                            }
                            if (field_name == "get") {
                                if (items.empty()) {
                                    throw ArtifactFailure("queue.get on empty queue");
                                }
                                const std::string front = items.front();
                                items.erase(items.begin());
                                values.set(base_name, "queue" + render_flat_sequence_string(items, '[', ']'));
                                script += "echo " + escape_cmd_echo(front) + "\r\n";
                                continue;
                            }
                        }
                    }
                }
                std::vector<std::string> output_lines;
                const std::string rendered = eval_call(expr, values, imports, functions, stdlib_exports, "", &output_lines);
                if (rendered == "__ui_noop__") {
                    continue;
                }
                for (const auto& line : output_lines) {
                    script += "echo " + escape_cmd_echo(line) + "\r\n";
                }
                if (output_lines.empty() || !rendered.empty()) {
                    script += "echo " + escape_cmd_echo(rendered) + "\r\n";
                }
                continue;
            }
            script += "rem expr " + escape_cmd_echo(render_value_summary(field(object, "expr", "expr_stmt"))) + "\r\n";
            continue;
        }
        if (kind == "label_print") {
            const vf::JsonValue& label_value = field(object, "value", "label_print");
            const auto& value_object = object_of(label_value, "label_print.value");
            if (string_field(value_object, "kind", "label_print.value") == "call") {
                const auto& callee = object_of(field(value_object, "callee", "call"), "label_print.call.callee");
                if (string_field(callee, "kind", "label_print.call.callee") == "field_access") {
                    const auto& base = object_of(field(callee, "object", "field_access"), "label_print.call.base");
                    if (string_field(base, "kind", "label_print.call.base") == "load") {
                        const std::string base_name = string_field(base, "name", "label_print.call.base");
                        const std::string field_name = string_field(callee, "field", "label_print.call.callee");
                        const std::string rendered_base = values.get(base_name);
                        if (rendered_base.rfind("queue[", 0) == 0 && rendered_base.size() >= 6 && rendered_base.back() == ']') {
                            auto items = parse_flat_sequence_string(rendered_base.substr(5), '[', ']');
                            if (field_name == "get") {
                                if (items.empty()) {
                                    throw ArtifactFailure("queue.get on empty queue");
                                }
                                const std::string front = items.front();
                                items.erase(items.begin());
                                values.set(base_name, "queue" + render_flat_sequence_string(items, '[', ']'));
                                const std::string line = string_field(object, "label", "label_print") + ": " + front;
                                script += "echo " + escape_cmd_echo(line) + "\r\n";
                                continue;
                            }
                        }
                    }
                }
            }
            const std::string rendered = eval_value(label_value, values, imports, functions, stdlib_exports);
            const std::string line = string_field(object, "label", "label_print") + ": " + rendered;
            script += "echo " + escape_cmd_echo(line) + "\r\n";
            continue;
        }
        if (kind == "function") {
            script += "rem function " + escape_cmd_echo(string_field(object, "name", "function")) + "\r\n";
            continue;
        }
        if (kind == "return") {
            script += "rem return " + escape_cmd_echo(render_value_summary(field(object, "value", "return"))) + "\r\n";
            continue;
        }
        throw ArtifactFailure("unsupported typed IR statement kind " + kind);
    }
    script += "exit /b 0\r\n";
    return script;
}

vf::JsonValue::Object manifest_payload(
    const std::filesystem::path& source,
    const std::string& source_hash,
    const std::string& typed_ir_hash,
    const std::string& artifact_content_hash,
    const std::vector<Dependency>& dependencies,
    const std::filesystem::path& artifact_path,
    const std::string& status
) {
    vf::JsonValue::Object manifest;
    manifest["artifact_path"] = vf::JsonValue(artifact_path.string());
    manifest["compiler_version"] = vf::JsonValue(compiler_version);
    manifest["source_path"] = vf::JsonValue(std::filesystem::absolute(source).string());
    manifest["source_sha256"] = vf::JsonValue(source_hash);
    manifest["status"] = vf::JsonValue(status);
    manifest["artifact_content_sha256"] = vf::JsonValue(artifact_content_hash);
    manifest["runtime_hash"] = vf::JsonValue(artifact_content_hash);
    manifest["typed_ir_sha256"] = vf::JsonValue(typed_ir_hash);
    vf::JsonValue::Array deps;
    for (const auto& dependency : dependencies) {
        vf::JsonValue::Object dep;
        dep["name"] = vf::JsonValue(dependency.name);
        dep["path"] = vf::JsonValue(std::filesystem::absolute(dependency.path).string());
        dep["sha256"] = vf::JsonValue(dependency.hash);
        deps.push_back(vf::JsonValue(std::move(dep)));
    }
    manifest["dependencies"] = vf::JsonValue(std::move(deps));
    return manifest;
}

std::string manifest_key(
    const std::string& source_hash,
    const std::string& typed_ir_hash,
    const std::string& artifact_content_hash,
    const std::vector<Dependency>& dependencies,
    const std::filesystem::path& artifact_path
) {
    std::string out = std::string(compiler_version) + "\n" + source_hash + "\n" + typed_ir_hash + "\n"
        + artifact_content_hash + "\n" + artifact_path.string();
    for (const auto& dependency : dependencies) {
        out += "\n" + dependency.name + "\n" + std::filesystem::absolute(dependency.path).string() + "\n" + dependency.hash;
    }
    return out;
}

std::string existing_manifest_hash(const std::filesystem::path& manifest_path) {
    if (!std::filesystem::exists(manifest_path)) {
        return "";
    }
    try {
        const auto manifest = object_of(vf::parse_json(read_file(manifest_path)), "manifest");
        const auto found = manifest.find("manifest_hash");
        if (found == manifest.end() || !found->second.is_string()) {
            return "";
        }
        return found->second.as_string();
    } catch (const std::exception&) {
        return "";
    }
}

struct Args {
    std::filesystem::path source;
    std::filesystem::path typed_ir;
    std::vector<std::pair<std::string, std::filesystem::path>> dependencies;
};

Args parse_args(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--source" && i + 1 < argc) {
            args.source = argv[++i];
            continue;
        }
        if (arg == "--typed-ir" && i + 1 < argc) {
            args.typed_ir = argv[++i];
            continue;
        }
        if (arg == "--dependency" && i + 1 < argc) {
            const std::string spec = argv[++i];
            const std::size_t eq = spec.find('=');
            if (eq == std::string::npos || eq == 0 || eq + 1 >= spec.size()) {
                throw ArtifactFailure("dependency must be name=path");
            }
            args.dependencies.push_back({spec.substr(0, eq), spec.substr(eq + 1)});
            continue;
        }
        throw ArtifactFailure("usage: vkf_compiler_artifact_smoke --source <file.vkf> --typed-ir <file.json>");
    }
    if (args.source.empty() || args.typed_ir.empty()) {
        throw ArtifactFailure("usage: vkf_compiler_artifact_smoke --source <file.vkf> --typed-ir <file.json>");
    }
    return args;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
        const std::string source_text = read_file(args.source);
        const std::string typed_ir_text = read_file(args.typed_ir);
        const vf::JsonValue typed_ir = vf::parse_json(typed_ir_text);
        validate_typed_ir(typed_ir);
        std::vector<Dependency> dependencies;
        for (const auto& dependency : args.dependencies) {
            dependencies.push_back({dependency.first, dependency.second, stable_hash(read_file(dependency.second))});
        }
        const std::string artifact_text = emit_artifact_script(typed_ir, args.source, dependencies);

        const std::string source_hash = stable_hash(source_text);
        const std::string typed_ir_hash = stable_hash(typed_ir_text);
        const std::string artifact_content_hash = stable_hash(artifact_text);
        const auto build_dir = repo_root_from_source(args.source) / ".vkfbuild" / stem_of(args.source);
        const auto manifest_path = build_dir / "manifest.json";
        const auto artifact_path = build_dir / (stem_of(args.source) + ".artifact.cmd");
        const std::string desired_manifest_hash = stable_hash(
            manifest_key(source_hash, typed_ir_hash, artifact_content_hash, dependencies, artifact_path)
        );

        std::filesystem::create_directories(build_dir);
        std::string status = "compiled";
        const bool artifact_current = std::filesystem::exists(artifact_path)
            && stable_hash(read_file(artifact_path)) == artifact_content_hash;
        if (existing_manifest_hash(manifest_path) == desired_manifest_hash && artifact_current) {
            status = "current";
        } else {
            write_file(artifact_path, artifact_text);
        }

        auto manifest = manifest_payload(args.source, source_hash, typed_ir_hash, artifact_content_hash, dependencies, artifact_path, status);
        manifest["manifest_hash"] = vf::JsonValue(desired_manifest_hash);
        write_file(manifest_path, vf::json_stringify(vf::JsonValue(std::move(manifest)), 2) + "\n");

        vf::JsonValue::Object result;
        result["artifact_path"] = vf::JsonValue(artifact_path.string());
        result["manifest_path"] = vf::JsonValue(manifest_path.string());
        result["status"] = vf::JsonValue(status);
        std::cout << vf::json_stringify(vf::JsonValue(std::move(result)), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<artifact-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
