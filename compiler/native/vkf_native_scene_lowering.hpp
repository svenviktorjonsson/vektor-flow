#pragma once

#include "compiler/native/vkf_spectral_emission.hpp"
#include "vkf_retained_scene_packet.hpp"
#include "native/VfOverlay/vf/json.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <map>
#include <optional>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vkf::native_scene {

class Error : public std::runtime_error {
public:
    explicit Error(const std::string& message) : std::runtime_error(message) {}
};

enum class LiteralKind {
    Null,
    Bool,
    Number,
    String,
    Array,
    Object,
};

struct LiteralValue {
    LiteralKind kind = LiteralKind::Null;
    bool bool_value = false;
    bool compiled_mesh_buffer = false;
    std::string text;
    std::vector<LiteralValue> array;
    std::vector<std::pair<std::string, LiteralValue>> object;
};

inline const LiteralValue* object_field(
    const LiteralValue& value,
    const std::string& key
) {
    if (value.kind != LiteralKind::Object) return nullptr;
    for (const auto& item : value.object) {
        if (item.first == key) return &item.second;
    }
    return nullptr;
}

inline LiteralValue* object_field(LiteralValue& value, const std::string& key) {
    if (value.kind != LiteralKind::Object) return nullptr;
    for (auto& item : value.object) {
        if (item.first == key) return &item.second;
    }
    return nullptr;
}

inline std::string json_escape(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (const char ch : text) {
        switch (ch) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out.push_back(ch); break;
        }
    }
    return out;
}

inline std::string literal_to_json(const LiteralValue& value) {
    switch (value.kind) {
        case LiteralKind::Null: return "null";
        case LiteralKind::Bool: return value.bool_value ? "true" : "false";
        case LiteralKind::Number: return value.text;
        case LiteralKind::String: return "\"" + json_escape(value.text) + "\"";
        case LiteralKind::Array: {
            std::ostringstream out;
            out << "[";
            for (std::size_t index = 0; index < value.array.size(); ++index) {
                if (index > 0) out << ",";
                out << literal_to_json(value.array[index]);
            }
            out << "]";
            return out.str();
        }
        case LiteralKind::Object: {
            std::ostringstream out;
            out << "{";
            for (std::size_t index = 0; index < value.object.size(); ++index) {
                if (index > 0) out << ",";
                out << "\"" << json_escape(value.object[index].first) << "\":"
                    << literal_to_json(value.object[index].second);
            }
            out << "}";
            return out.str();
        }
    }
    return "null";
}

inline LiteralValue literal_from_json(const vf::JsonValue& value) {
    LiteralValue result;
    switch (value.type()) {
        case vf::JsonValue::Type::Null:
            return result;
        case vf::JsonValue::Type::Boolean:
            result.kind = LiteralKind::Bool;
            result.bool_value = value.as_boolean();
            return result;
        case vf::JsonValue::Type::Number:
            result.kind = LiteralKind::Number;
            result.text = vf::json_stringify(value, -1);
            return result;
        case vf::JsonValue::Type::String:
            result.kind = LiteralKind::String;
            result.text = value.as_string();
            return result;
        case vf::JsonValue::Type::Array:
            result.kind = LiteralKind::Array;
            result.array.reserve(value.as_array().size());
            for (const auto& item : value.as_array()) {
                result.array.push_back(literal_from_json(item));
            }
            return result;
        case vf::JsonValue::Type::Object:
            result.kind = LiteralKind::Object;
            result.object.reserve(value.as_object().size());
            for (const auto& [name, item] : value.as_object()) {
                result.object.emplace_back(name, literal_from_json(item));
            }
            return result;
    }
    return result;
}

class LiteralParser {
public:
    LiteralParser(
        const std::string& source,
        std::size_t pos,
        const std::map<std::string, LiteralValue>* symbols = nullptr
    ) : source_(source), pos_(pos), symbols_(symbols) {}

    LiteralValue parse_value() {
        skip_ws_and_comments();
        if (pos_ >= source_.size()) {
            throw Error("native_scene literal ended unexpectedly");
        }
        const char ch = source_[pos_];
        if (ch == '(') return parse_object(')');
        if (ch == '{') return parse_object('}');
        if (ch == '[') return parse_array();
        if (ch == '"') {
            LiteralValue value;
            value.kind = LiteralKind::String;
            value.text = parse_string();
            return value;
        }
        if (ch == '-' || ch == '+' || ch == '.' ||
            std::isdigit(static_cast<unsigned char>(ch))) {
            LiteralValue value;
            value.kind = LiteralKind::Number;
            value.text = parse_number();
            return value;
        }
        if (is_identifier_start(ch)) {
            const std::string ident = parse_identifier();
            if (ident == "true" || ident == "false") {
                LiteralValue value;
                value.kind = LiteralKind::Bool;
                value.bool_value = ident == "true";
                return value;
            }
            if (ident == "null") return {};
            if (symbols_) {
                const auto symbol = symbols_->find(ident);
                if (symbol != symbols_->end()) {
                    LiteralValue value = symbol->second;
                    skip_ws_and_comments();
                    while (pos_ < source_.size() && source_[pos_] == '.') {
                        ++pos_;
                        skip_ws_and_comments();
                        const std::string field_name = parse_identifier();
                        if (value.kind != LiteralKind::Object) {
                            throw Error(
                                "native_scene load field access requires a struct: " +
                                ident);
                        }
                        const LiteralValue* selected = object_field(value, field_name);
                        if (!selected) {
                            throw Error(
                                "native_scene load has no field `" + field_name +
                                "`: " + ident);
                        }
                        value = *selected;
                        skip_ws_and_comments();
                    }
                    return value;
                }
            }
            LiteralValue value;
            value.kind = LiteralKind::String;
            value.text = ident;
            return value;
        }
        throw Error(std::string("unexpected character in native_scene literal: ") + ch);
    }

private:
    const std::string& source_;
    std::size_t pos_ = 0;
    const std::map<std::string, LiteralValue>* symbols_ = nullptr;

    static bool is_identifier_start(char ch) {
        return std::isalpha(static_cast<unsigned char>(ch)) || ch == '_';
    }

    static bool is_identifier_char(char ch) {
        return std::isalnum(static_cast<unsigned char>(ch)) || ch == '_' || ch == '-';
    }

    void skip_ws_and_comments() {
        while (pos_ < source_.size()) {
            const char ch = source_[pos_];
            if (std::isspace(static_cast<unsigned char>(ch))) {
                ++pos_;
                continue;
            }
            if (ch == '#') {
                while (pos_ < source_.size() && source_[pos_] != '\n') ++pos_;
                continue;
            }
            break;
        }
    }

    std::string parse_identifier() {
        if (pos_ >= source_.size() || !is_identifier_start(source_[pos_])) {
            throw Error("expected identifier in native_scene literal");
        }
        const std::size_t start = pos_++;
        while (pos_ < source_.size() && is_identifier_char(source_[pos_])) ++pos_;
        return source_.substr(start, pos_ - start);
    }

    std::string parse_string() {
        if (source_[pos_] != '"') throw Error("expected string in native_scene literal");
        ++pos_;
        std::string out;
        while (pos_ < source_.size()) {
            const char ch = source_[pos_++];
            if (ch == '"') return out;
            if (ch == '\\') {
                if (pos_ >= source_.size()) {
                    throw Error("unterminated string escape in native_scene literal");
                }
                const char escaped = source_[pos_++];
                switch (escaped) {
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case 'n': out.push_back('\n'); break;
                    case 'r': out.push_back('\r'); break;
                    case 't': out.push_back('\t'); break;
                    default: out.push_back(escaped); break;
                }
                continue;
            }
            out.push_back(ch);
        }
        throw Error("unterminated string in native_scene literal");
    }

    std::string parse_number() {
        const std::size_t start = pos_;
        if (pos_ < source_.size() &&
            (source_[pos_] == '-' || source_[pos_] == '+')) ++pos_;
        bool saw_digit = false;
        while (pos_ < source_.size() &&
               std::isdigit(static_cast<unsigned char>(source_[pos_]))) {
            saw_digit = true;
            ++pos_;
        }
        if (pos_ < source_.size() && source_[pos_] == '.') {
            ++pos_;
            while (pos_ < source_.size() &&
                   std::isdigit(static_cast<unsigned char>(source_[pos_]))) {
                saw_digit = true;
                ++pos_;
            }
        }
        if (pos_ < source_.size() &&
            (source_[pos_] == 'e' || source_[pos_] == 'E')) {
            ++pos_;
            if (pos_ < source_.size() &&
                (source_[pos_] == '-' || source_[pos_] == '+')) ++pos_;
            bool saw_exponent = false;
            while (pos_ < source_.size() &&
                   std::isdigit(static_cast<unsigned char>(source_[pos_]))) {
                saw_exponent = true;
                ++pos_;
            }
            if (!saw_exponent) throw Error("invalid exponent in native_scene number");
        }
        if (!saw_digit) throw Error("invalid native_scene number");
        return source_.substr(start, pos_ - start);
    }

    LiteralValue parse_array() {
        LiteralValue value;
        value.kind = LiteralKind::Array;
        ++pos_;
        skip_ws_and_comments();
        while (pos_ < source_.size() && source_[pos_] != ']') {
            value.array.push_back(parse_value());
            skip_ws_and_comments();
            if (pos_ < source_.size() && source_[pos_] == ',') {
                ++pos_;
                skip_ws_and_comments();
            } else if (pos_ < source_.size() && source_[pos_] != ']') {
                throw Error("expected comma or ] in native_scene array");
            }
        }
        if (pos_ >= source_.size() || source_[pos_] != ']') {
            throw Error("unterminated native_scene array");
        }
        ++pos_;
        return value;
    }

    LiteralValue parse_object(char close_ch) {
        LiteralValue value;
        value.kind = LiteralKind::Object;
        ++pos_;
        skip_ws_and_comments();
        while (pos_ < source_.size() && source_[pos_] != close_ch) {
            const std::string key = source_[pos_] == '"'
                ? parse_string()
                : parse_identifier();
            skip_ws_and_comments();
            if (pos_ >= source_.size() || source_[pos_] != ':') {
                throw Error("expected : after native_scene field " + key);
            }
            ++pos_;
            value.object.push_back({key, parse_value()});
            skip_ws_and_comments();
            if (pos_ < source_.size() && source_[pos_] == ',') {
                ++pos_;
                skip_ws_and_comments();
            } else if (pos_ < source_.size() && source_[pos_] != close_ch) {
                throw Error("expected comma or closing paren in native_scene object");
            }
        }
        if (pos_ >= source_.size() || source_[pos_] != close_ch) {
            throw Error("unterminated native_scene object");
        }
        ++pos_;
        return value;
    }
};

inline std::string number_json(double value) {
    std::ostringstream out;
    out << std::setprecision(9) << value;
    return out.str();
}

inline LiteralValue numeric_literal(double value) {
    LiteralValue literal;
    literal.kind = LiteralKind::Number;
    literal.text = number_json(value);
    return literal;
}

inline LiteralValue load_ascii_triangle_ply(const std::filesystem::path& path) {
    std::ifstream input(path);
    if (!input) throw Error("native_scene load could not read " + path.string());
    std::string line;
    if (!std::getline(input, line) || line != "ply") {
        throw Error("native_scene load requires a PLY header: " + path.string());
    }
    bool ascii = false;
    bool ended = false;
    std::size_t vertex_count = 0;
    std::size_t face_count = 0;
    std::vector<std::string> vertex_properties;
    enum class Element { None, Vertex, Face } element = Element::None;
    while (std::getline(input, line)) {
        std::istringstream fields(line);
        std::string keyword;
        fields >> keyword;
        if (keyword == "format") {
            std::string format;
            fields >> format;
            ascii = format == "ascii";
        } else if (keyword == "element") {
            std::string name;
            std::size_t count = 0;
            fields >> name >> count;
            element = name == "vertex" ? Element::Vertex
                : name == "face" ? Element::Face : Element::None;
            if (element == Element::Vertex) vertex_count = count;
            if (element == Element::Face) face_count = count;
        } else if (keyword == "property" && element == Element::Vertex) {
            std::string type;
            std::string name;
            fields >> type >> name;
            if (type != "list") vertex_properties.push_back(name);
        } else if (keyword == "end_header") {
            ended = true;
            break;
        }
    }
    if (!ascii || !ended || vertex_count == 0 || face_count == 0) {
        throw Error(
            "native_scene load supports non-empty ASCII PLY triangle meshes only: " +
            path.string());
    }
    const auto property_index = [&](const std::string& name) {
        const auto found = std::find(
            vertex_properties.begin(), vertex_properties.end(), name);
        if (found == vertex_properties.end()) {
            throw Error(
                "native_scene PLY is missing vertex property `" + name + "`: " +
                path.string());
        }
        return static_cast<std::size_t>(found - vertex_properties.begin());
    };
    const std::size_t x_index = property_index("x");
    const std::size_t y_index = property_index("y");
    const std::size_t z_index = property_index("z");
    std::vector<std::array<double, 3>> positions(vertex_count);
    for (std::size_t index = 0; index < vertex_count; ++index) {
        if (!std::getline(input, line)) {
            throw Error(
                "native_scene PLY ended inside its vertex table: " + path.string());
        }
        std::istringstream values(line);
        std::vector<double> row;
        double item = 0.0;
        while (values >> item) row.push_back(item);
        if (row.size() < vertex_properties.size()) {
            throw Error(
                "native_scene PLY vertex row is shorter than its header: " +
                path.string());
        }
        positions[index] = {row[x_index], row[y_index], row[z_index]};
    }
    std::vector<std::uint32_t> indices;
    indices.reserve(face_count * 3);
    for (std::size_t index = 0; index < face_count; ++index) {
        if (!std::getline(input, line)) {
            throw Error(
                "native_scene PLY ended inside its face table: " + path.string());
        }
        std::istringstream values(line);
        std::size_t count = 0;
        values >> count;
        if (count != 3) {
            throw Error(
                "native_scene load requires triangulated PLY faces: " + path.string());
        }
        std::array<std::uint32_t, 3> face{};
        if (!(values >> face[0] >> face[1] >> face[2]) ||
            face[0] >= vertex_count || face[1] >= vertex_count ||
            face[2] >= vertex_count) {
            throw Error(
                "native_scene PLY face index is invalid: " + path.string());
        }
        indices.insert(indices.end(), face.begin(), face.end());
    }
    std::vector<std::array<double, 3>> normals(
        vertex_count, {0.0, 0.0, 0.0});
    for (std::size_t offset = 0; offset < indices.size(); offset += 3) {
        const auto& a = positions[indices[offset]];
        const auto& b = positions[indices[offset + 1]];
        const auto& c = positions[indices[offset + 2]];
        const std::array<double, 3> ab{
            b[0] - a[0], b[1] - a[1], b[2] - a[2]};
        const std::array<double, 3> ac{
            c[0] - a[0], c[1] - a[1], c[2] - a[2]};
        const std::array<double, 3> normal{
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        };
        for (const auto vertex : {
                 indices[offset], indices[offset + 1], indices[offset + 2]}) {
            for (std::size_t axis = 0; axis < 3; ++axis) {
                normals[vertex][axis] += normal[axis];
            }
        }
    }
    LiteralValue vertices;
    vertices.kind = LiteralKind::Array;
    vertices.compiled_mesh_buffer = true;
    vertices.array.reserve(vertex_count * 10);
    for (std::size_t index = 0; index < vertex_count; ++index) {
        const double length = std::sqrt(
            normals[index][0] * normals[index][0] +
            normals[index][1] * normals[index][1] +
            normals[index][2] * normals[index][2]);
        for (const double coordinate : positions[index]) {
            vertices.array.push_back(numeric_literal(coordinate));
        }
        for (const double coordinate : normals[index]) {
            vertices.array.push_back(numeric_literal(
                length > 0.0 ? coordinate / length : 0.0));
        }
        for (const double channel : {1.0, 1.0, 1.0, 1.0}) {
            vertices.array.push_back(numeric_literal(channel));
        }
    }
    LiteralValue faces;
    faces.kind = LiteralKind::Array;
    faces.compiled_mesh_buffer = true;
    faces.array.reserve(indices.size());
    for (const auto index : indices) {
        faces.array.push_back(numeric_literal(static_cast<double>(index)));
    }
    LiteralValue mesh;
    mesh.kind = LiteralKind::Object;
    mesh.object.push_back({"vertices", std::move(vertices)});
    mesh.object.push_back({"faces", std::move(faces)});
    return mesh;
}

inline std::map<std::string, LiteralValue> source_loads(
    const std::string& source_text,
    const std::filesystem::path& source_path
) {
    static const std::regex load_pattern(
        R"PLY(([A-Za-z_][A-Za-z0-9_]*)\s*:\s*load\(\s*"([^"]+\.ply)"\s*\))PLY",
        std::regex::ECMAScript | std::regex::icase);
    std::map<std::string, LiteralValue> loads;
    for (std::sregex_iterator it(
             source_text.begin(), source_text.end(), load_pattern), end;
         it != end; ++it) {
        const auto requested = (
            source_path.parent_path() / (*it)[2].str()).lexically_normal();
        loads.emplace((*it)[1].str(), load_ascii_triangle_ply(requested));
    }
    return loads;
}

inline vf::JsonValue literal_to_value(const LiteralValue& value);

inline std::map<std::string, vf::JsonValue> canonical_source_loads(
    const std::string& source_text,
    const std::filesystem::path& source_path
) {
    std::map<std::string, vf::JsonValue> result;
    for (const auto& [name, loaded] : source_loads(source_text, source_path)) {
        const auto* packed_vertices = object_field(loaded, "vertices");
        const auto* packed_faces = object_field(loaded, "faces");
        if (!packed_vertices || !packed_faces ||
            packed_vertices->kind != LiteralKind::Array ||
            packed_faces->kind != LiteralKind::Array ||
            packed_vertices->array.size() % 10 != 0 ||
            packed_faces->array.size() % 3 != 0) {
            throw Error("loaded mesh does not contain triangle geometry");
        }
        vf::JsonValue::Array vertices;
        vertices.reserve(packed_vertices->array.size() / 10);
        for (std::size_t offset = 0; offset < packed_vertices->array.size();
             offset += 10) {
            vertices.push_back(vf::JsonValue(vf::JsonValue::Array{
                literal_to_value(packed_vertices->array[offset]),
                literal_to_value(packed_vertices->array[offset + 1]),
                literal_to_value(packed_vertices->array[offset + 2]),
            }));
        }
        vf::JsonValue::Array faces;
        faces.reserve(packed_faces->array.size() / 3);
        for (std::size_t offset = 0; offset < packed_faces->array.size();
             offset += 3) {
            faces.push_back(vf::JsonValue(vf::JsonValue::Array{
                literal_to_value(packed_faces->array[offset]),
                literal_to_value(packed_faces->array[offset + 1]),
                literal_to_value(packed_faces->array[offset + 2]),
            }));
        }
        result[name] = vf::JsonValue(vf::JsonValue::Object{
            {"vertices", vf::JsonValue(std::move(vertices))},
            {"faces", vf::JsonValue(std::move(faces))},
        });
    }
    return result;
}

inline std::optional<LiteralValue> parse_source(
    const std::string& source_text,
    const std::filesystem::path& source_path
) {
    std::size_t marker = source_text.find("native_scene:");
    std::size_t value_start = marker == std::string::npos
        ? std::string::npos
        : marker + std::string("native_scene:").size();
    if (marker == std::string::npos) {
        marker = source_text.find("native_scene(");
        value_start = marker;
        if (marker != std::string::npos) {
            value_start += std::string("native_scene").size();
        }
    }
    if (marker == std::string::npos) return std::nullopt;
    const auto loads = source_loads(source_text, source_path);
    LiteralParser parser(source_text, value_start, &loads);
    LiteralValue root = parser.parse_value();
    if (root.kind != LiteralKind::Object) {
        throw Error("native_scene must be a field object wrapped in parens");
    }
    return root;
}

inline vf::JsonValue literal_to_value(const LiteralValue& value) {
    switch (value.kind) {
        case LiteralKind::Null: return vf::JsonValue(nullptr);
        case LiteralKind::Bool: return vf::JsonValue(value.bool_value);
        case LiteralKind::Number: return vf::JsonValue(std::stod(value.text));
        case LiteralKind::String: return vf::JsonValue(value.text);
        case LiteralKind::Array: {
            vf::JsonValue::Array items;
            items.reserve(value.array.size());
            for (const auto& item : value.array) {
                items.push_back(literal_to_value(item));
            }
            return vf::JsonValue(std::move(items));
        }
        case LiteralKind::Object: {
            vf::JsonValue::Object fields;
            for (const auto& item : value.object) {
                fields[item.first] = literal_to_value(item.second);
            }
            return vf::JsonValue(std::move(fields));
        }
    }
    return vf::JsonValue(nullptr);
}

inline bool bool_field(
    const LiteralValue& value,
    const std::string& name,
    bool fallback
) {
    const auto* field = object_field(value, name);
    return field && field->kind == LiteralKind::Bool
        ? field->bool_value : fallback;
}

inline void bake_compiled_material_color(LiteralValue& root) {
    auto* meshes = object_field(root, "meshes");
    if (!meshes || meshes->kind != LiteralKind::Array) return;
    for (auto& mesh : meshes->array) {
        auto* vertices = object_field(mesh, "vertices");
        const auto* indices = object_field(mesh, "indices");
        const auto* color = object_field(mesh, "color");
        if (!vertices || !indices || !vertices->compiled_mesh_buffer ||
            !indices->compiled_mesh_buffer ||
            bool_field(mesh, "use_vertex_color", false) || !color ||
            color->kind != LiteralKind::Array || color->array.size() < 3) {
            continue;
        }
        LiteralValue alpha = numeric_literal(1.0);
        const std::array<LiteralValue, 4> rgba{
            color->array[0], color->array[1], color->array[2],
            color->array.size() >= 4 ? color->array[3] : alpha,
        };
        for (std::size_t offset = 0; offset + 9 < vertices->array.size();
             offset += 10) {
            for (std::size_t channel = 0; channel < 4; ++channel) {
                vertices->array[offset + 6 + channel] = rgba[channel];
            }
        }
    }
}

inline void append_f32(std::vector<std::uint8_t>& bytes, double value) {
    if (!std::isfinite(value) ||
        std::abs(value) > static_cast<double>(std::numeric_limits<float>::max())) {
        throw Error("retained scene vertex is not f32-compatible");
    }
    const float packed = static_cast<float>(value);
    std::uint32_t bits = 0;
    std::memcpy(&bits, &packed, sizeof(bits));
    for (int shift = 0; shift < 32; shift += 8) {
        bytes.push_back(static_cast<std::uint8_t>((bits >> shift) & 0xffu));
    }
}

inline void append_u32(
    std::vector<std::uint8_t>& bytes,
    const vf::JsonValue& value
) {
    if (!value.is_number() || !std::isfinite(value.as_number()) ||
        value.as_number() < 0.0 || std::floor(value.as_number()) != value.as_number() ||
        value.as_number() >
            static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
        throw Error("retained scene index is not u32-compatible");
    }
    const auto packed = static_cast<std::uint32_t>(value.as_number());
    for (int shift = 0; shift < 32; shift += 8) {
        bytes.push_back(static_cast<std::uint8_t>((packed >> shift) & 0xffu));
    }
}

struct PackedScene {
    std::string metadata_json;
    std::vector<std::uint8_t> arena_bytes;
};

namespace render_parameter_layout {

inline constexpr std::uint32_t camera_stride = 96;
inline constexpr std::uint32_t light_stride = 112;
inline constexpr std::uint32_t object_stride = 128;

}  // namespace render_parameter_layout

struct PackedRenderParameters {
    struct TemporalParameterTarget {
        std::string section;
        std::uint32_t byte_offset = 0;
        bool relative_to_first = false;
        std::optional<std::uint32_t> additive_offset_byte_offset;
    };

    struct TemporalParameterUpdate {
        std::string id;
        std::string channel;
        std::string mode;
        std::vector<double> coordinates;
        std::vector<std::vector<double>> samples;
        std::vector<TemporalParameterTarget> targets;
    };

    std::vector<std::uint8_t> arena_bytes;
    vf::JsonValue::Array sections;
    vf::JsonValue::Array draw_lists;
    std::vector<TemporalParameterUpdate> temporal_parameter_updates;
};

inline double number_or(
    const LiteralValue* value,
    double fallback
) {
    if (!value || value->kind != LiteralKind::Number) return fallback;
    return std::stod(value->text);
}

inline std::string string_or(
    const LiteralValue* value,
    const std::string& fallback
) {
    return value && value->kind == LiteralKind::String ? value->text : fallback;
}

inline std::vector<double> vector_or(
    const LiteralValue* value,
    const std::vector<double>& fallback
) {
    if (!value || value->kind != LiteralKind::Array) return fallback;
    std::vector<double> result = fallback;
    for (std::size_t index = 0;
         index < result.size() && index < value->array.size(); ++index) {
        result[index] = number_or(&value->array[index], result[index]);
    }
    return result;
}

struct RenderEmission {
    bool present = false;
    std::array<double, 3> linear_srgb{};
    double integrated_radiance = 0.0;
    double nonvisible_radiance = 0.0;
};

inline std::vector<double> numeric_vector(
    const LiteralValue* value,
    const std::string& name
) {
    if (!value || value->kind != LiteralKind::Array) {
        throw Error(name + " must be a numeric vector");
    }
    std::vector<double> result;
    result.reserve(value->array.size());
    for (const auto& item : value->array) {
        if (item.kind != LiteralKind::Number) {
            throw Error(name + " must be a numeric vector");
        }
        const double number = std::stod(item.text);
        if (!std::isfinite(number)) {
            throw Error(name + " must contain only finite numbers");
        }
        result.push_back(number);
    }
    return result;
}

inline std::array<double, 4> render_polarization(const LiteralValue& light) {
    const LiteralValue* value = object_field(light, "polarization");
    if (!value) return {1.0, 0.0, 0.0, 0.0};
    const auto stokes = numeric_vector(value, "polarization");
    if (stokes.size() != 4) {
        throw Error("polarization must be a Stokes [I,Q,U,V] vector");
    }
    const double polarized_power = stokes[1] * stokes[1] +
        stokes[2] * stokes[2] + stokes[3] * stokes[3];
    if (stokes[0] <= 0.0 || polarized_power > stokes[0] * stokes[0] + 1.0e-12) {
        throw Error(
            "Stokes polarization requires I > 0 and Q^2+U^2+V^2 <= I^2");
    }
    return {stokes[0], stokes[1], stokes[2], stokes[3]};
}

inline RenderEmission render_emission(const LiteralValue& owner) {
    const LiteralValue* emission = object_field(owner, "emission");
    if (!emission) return {};
    if (emission->kind == LiteralKind::Array) {
        const auto rgb = numeric_vector(emission, "emission");
        if (rgb.size() != 3 || std::any_of(
                rgb.begin(), rgb.end(), [](double value) { return value < 0.0; })) {
            throw Error(
                "RGB emission must contain exactly three nonnegative values");
        }
        return {true, {rgb[0], rgb[1], rgb[2]},
            rgb[0] + rgb[1] + rgb[2], 0.0};
    }
    if (emission->kind != LiteralKind::Object) {
        throw Error(
            "emission must be RGB or a wavelength/radiance struct");
    }
    const auto wavelength = numeric_vector(
        object_field(*emission, "wavelength"), "emission.wavelength");
    const auto radiance = numeric_vector(
        object_field(*emission, "radiance"), "emission.radiance");
    try {
        const auto normalized = vkf::spectral::normalize({wavelength, radiance});
        const auto visible = vkf::spectral::project_visible(normalized);
        const auto visible_bands = vkf::spectral::resample_band_integrals(
            normalized, {360.0e-9, 830.0e-9});
        const double visible_radiance = visible_bands.front();
        return {
            true,
            {
                std::max(visible.linear_srgb[0], 0.0),
                std::max(visible.linear_srgb[1], 0.0),
                std::max(visible.linear_srgb[2], 0.0),
            },
            normalized.integrated_radiance,
            std::max(normalized.integrated_radiance - visible_radiance, 0.0),
        };
    } catch (const vkf::spectral::NormalizationFailure& error) {
        throw Error(error.what());
    }
}

inline constexpr std::uint32_t geometry_emitter_kind_code = 5;
inline constexpr std::uint32_t reflected_emitter_view_kind_code = 2;
inline constexpr std::uint32_t planar_reflection_max_depth = 1;

using PlanarReflectionPath = std::vector<std::size_t>;

inline std::vector<PlanarReflectionPath> planar_reflection_paths(
    std::size_t reflector_count,
    std::uint32_t max_depth
) {
    std::vector<PlanarReflectionPath> paths;
    if (max_depth == 0) return paths;
    std::vector<PlanarReflectionPath> frontier;
    for (std::size_t reflector_index = 0;
         reflector_index < reflector_count; ++reflector_index) {
        frontier.push_back(PlanarReflectionPath{reflector_index});
        paths.push_back(frontier.back());
    }
    for (std::uint32_t depth = 2; depth <= max_depth; ++depth) {
        std::vector<PlanarReflectionPath> next;
        for (const auto& parent : frontier) {
            for (std::size_t reflector_index = 0;
                 reflector_index < reflector_count; ++reflector_index) {
                if (reflector_index == parent.back()) continue;
                auto child = parent;
                child.push_back(reflector_index);
                next.push_back(child);
                paths.push_back(std::move(child));
            }
        }
        frontier = std::move(next);
    }
    return paths;
}

struct GeometryEmitter {
    std::string id;
    std::uint32_t layer_id = 0;
    std::uint32_t object_index = 0;
    std::array<double, 3> position{};
    std::array<double, 3> normal{0.0, 0.0, 1.0};
    double area = 0.0;
    bool casts_shadow = true;
    bool show_marker = false;
    RenderEmission emission;
};

struct GeometryReflector {
    std::string id;
    std::uint32_t object_index = 0;
};

struct GeometryEmitterView {
    std::string id;
    std::string source_id;
    std::uint32_t light_index = 0;
    std::uint32_t source_light_index = 0;
    std::uint32_t source_object_index = 0;
    std::uint32_t source_layer_id = 0;
    std::string reflect_surface_id;
    std::uint32_t reflect_surface_object_index = 0;
    std::vector<std::string> reflection_path;
    bool casts_shadow = true;
};

inline std::vector<PackedRenderParameters::TemporalParameterUpdate>
temporal_parameter_updates(const LiteralValue& root) {
    std::vector<PackedRenderParameters::TemporalParameterUpdate> updates;
    const auto append_channel = [&](const LiteralValue& time,
                                    const std::string& id,
                                    const std::string& channel_name,
                                    std::size_t width,
                                    bool scalar,
                                    const std::string& context) {
        const auto coordinates = numeric_vector(
            object_field(time, "coordinates"), context + " t coordinates");
        const std::string mode = string_or(object_field(time, "mode"), "");
        const LiteralValue* channels = object_field(time, "channels");
        if (mode.empty() || !channels || channels->kind != LiteralKind::Array) {
            throw Error(context + " temporal metadata is incomplete");
        }
        const LiteralValue* values = nullptr;
        for (const auto& channel : channels->array) {
            if (string_or(object_field(channel, "name"), "") == channel_name) {
                values = object_field(channel, "value");
                break;
            }
        }
        if (!values || values->kind != LiteralKind::Array ||
            values->array.size() != coordinates.size()) {
            throw Error(context + " `" + channel_name + "_t` samples are incomplete");
        }
        PackedRenderParameters::TemporalParameterUpdate update;
        update.id = id;
        update.channel = channel_name;
        update.mode = mode;
        update.coordinates = coordinates;
        update.samples.reserve(values->array.size());
        for (const auto& sample : values->array) {
            std::vector<double> components;
            if (scalar) {
                if (sample.kind != LiteralKind::Number) {
                    throw Error(context + " `" + channel_name + "_t` samples must be numeric");
                }
                components.push_back(std::stod(sample.text));
            } else {
                components = numeric_vector(&sample, context + " sample");
            }
            if (components.size() != width) {
                throw Error(context + " `" + channel_name + "_t` sample width is invalid");
            }
            update.samples.push_back(components);
        }
        updates.push_back(std::move(update));
    };

    const LiteralValue* camera = object_field(root, "camera");
    const LiteralValue* camera_time = camera ? object_field(*camera, "_camera_time") : nullptr;
    if (camera_time && camera_time->kind == LiteralKind::Object) {
        const LiteralValue* channels = object_field(*camera_time, "channels");
        if (!channels || channels->kind != LiteralKind::Array) {
            throw Error("Camera temporal metadata is incomplete");
        }
        for (const auto& channel : channels->array) {
            const std::string name = string_or(object_field(channel, "name"), "");
            if (name == "p" || name == "target") {
                append_channel(*camera_time, "camera", name, 3, false, "Camera");
            } else if (name == "x" || name == "y" || name == "z" || name == "fov") {
                append_channel(*camera_time, "camera", name, 1, true, "Camera");
            } else {
                throw Error("Camera temporal channel is unsupported: " + name);
            }
        }
    }

    const LiteralValue* meshes = object_field(root, "meshes");
    if (!meshes || meshes->kind != LiteralKind::Array) return updates;
    for (const auto& mesh : meshes->array) {
        const LiteralValue* time = object_field(mesh, "_layer_time");
        if (!time || time->kind != LiteralKind::Object) continue;
        const std::string id = string_or(object_field(mesh, "id"), "");
        if (id.empty()) throw Error("temporal Layer id is missing");
        const LiteralValue* channels = object_field(*time, "channels");
        const LiteralValue* positions = nullptr;
        if (channels && channels->kind == LiteralKind::Array) {
            for (const auto& channel : channels->array) {
                if (string_or(object_field(channel, "name"), "") == "p") {
                    positions = object_field(channel, "value");
                    break;
                }
            }
        }
        if (!positions || positions->kind != LiteralKind::Array || positions->array.empty()) {
            throw Error("temporal Layer position samples are incomplete");
        }
        const auto first = numeric_vector(&positions->array.front(), "Layer p_t sample");
        if (first.size() != 2 && first.size() != 3) {
            throw Error("Layer p_t sample must have two or three components");
        }
        append_channel(*time, id, "p", first.size(), false, "Layer");
        if (first.size() == 2) {
            auto& samples = updates.back().samples;
            for (auto& sample : samples) sample.push_back(0.0);
        }
    }
    return updates;
}

inline std::vector<GeometryEmitter> geometry_emitters(
    const LiteralValue& root
) {
    std::vector<GeometryEmitter> emitters;
    std::uint32_t object_index = 0;
    for (const char* collection_name : {"surfaces", "meshes"}) {
        const LiteralValue* collection = object_field(root, collection_name);
        if (!collection || collection->kind != LiteralKind::Array) continue;
        for (const auto& object : collection->array) {
            const auto emission = render_emission(object);
            const LiteralValue* vertices = object_field(object, "vertices");
            const LiteralValue* indices = object_field(object, "indices");
            const std::string topology = string_or(
                object_field(object, "topology"), "");
            if (emission.present && topology == "point-list" &&
                object_field(object, "_layer_time") && vertices &&
                vertices->kind == LiteralKind::Array &&
                vertices->array.size() >= 10) {
                const double radius = std::max(
                    number_or(object_field(object, "vertex_size"), 0.0),
                    1.0e-6);
                GeometryEmitter emitter;
                emitter.id = string_or(
                    object_field(object, "id"),
                    "object_" + std::to_string(object_index));
                emitter.layer_id = static_cast<std::uint32_t>(number_or(
                    object_field(object, "layer_id"), object_index));
                emitter.object_index = object_index;
                emitter.position = {
                    number_or(&vertices->array[0], 0.0),
                    number_or(&vertices->array[1], 0.0),
                    number_or(&vertices->array[2], 0.0),
                };
                emitter.normal = {
                    number_or(&vertices->array[3], 0.0),
                    number_or(&vertices->array[4], 0.0),
                    number_or(&vertices->array[5], 1.0),
                };
                emitter.area = 3.14159265358979323846 * radius * radius;
                emitter.casts_shadow = bool_field(object, "casts_shadow", true);
                emitter.show_marker = true;
                emitter.emission = emission;
                emitters.push_back(std::move(emitter));
                ++object_index;
                continue;
            }
            if (!emission.present || topology != "triangle-list" ||
                !vertices || !indices ||
                vertices->kind != LiteralKind::Array ||
                indices->kind != LiteralKind::Array ||
                vertices->array.size() % 10 != 0) {
                ++object_index;
                continue;
            }
            const std::size_t vertex_count = vertices->array.size() / 10;
            std::array<double, 3> weighted_center{};
            std::array<double, 3> normal_sum{};
            double total_area = 0.0;
            for (std::size_t offset = 0; offset + 2 < indices->array.size();
                 offset += 3) {
                const auto read_index = [&](std::size_t index) {
                    const double value = number_or(&indices->array[index], -1.0);
                    if (value < 0.0 || std::floor(value) != value ||
                        value >= static_cast<double>(vertex_count)) {
                        throw Error("emissive geometry index is outside its vertex buffer");
                    }
                    return static_cast<std::size_t>(value);
                };
                const auto read_position = [&](std::size_t index) {
                    const std::size_t base = index * 10;
                    return std::array<double, 3>{
                        number_or(&vertices->array[base], 0.0),
                        number_or(&vertices->array[base + 1], 0.0),
                        number_or(&vertices->array[base + 2], 0.0),
                    };
                };
                const auto a = read_position(read_index(offset));
                const auto b = read_position(read_index(offset + 1));
                const auto c = read_position(read_index(offset + 2));
                const std::array<double, 3> ab{
                    b[0] - a[0], b[1] - a[1], b[2] - a[2]};
                const std::array<double, 3> ac{
                    c[0] - a[0], c[1] - a[1], c[2] - a[2]};
                const std::array<double, 3> cross{
                    ab[1] * ac[2] - ab[2] * ac[1],
                    ab[2] * ac[0] - ab[0] * ac[2],
                    ab[0] * ac[1] - ab[1] * ac[0],
                };
                const double twice_area = std::sqrt(
                    cross[0] * cross[0] + cross[1] * cross[1] +
                    cross[2] * cross[2]);
                if (twice_area <= 1.0e-12) continue;
                const double area = twice_area * 0.5;
                total_area += area;
                for (std::size_t axis = 0; axis < 3; ++axis) {
                    weighted_center[axis] +=
                        (a[axis] + b[axis] + c[axis]) / 3.0 * area;
                    normal_sum[axis] += cross[axis];
                }
            }
            if (total_area > 1.0e-12) {
                const double normal_length = std::sqrt(
                    normal_sum[0] * normal_sum[0] +
                    normal_sum[1] * normal_sum[1] +
                    normal_sum[2] * normal_sum[2]);
                GeometryEmitter emitter;
                emitter.id = string_or(
                    object_field(object, "id"),
                    "object_" + std::to_string(object_index));
                emitter.layer_id = static_cast<std::uint32_t>(number_or(
                    object_field(object, "layer_id"), object_index));
                emitter.object_index = object_index;
                emitter.area = total_area;
                emitter.casts_shadow = bool_field(
                    object, "casts_shadow", true);
                emitter.emission = emission;
                for (std::size_t axis = 0; axis < 3; ++axis) {
                    emitter.position[axis] = weighted_center[axis] / total_area;
                    if (normal_length > 1.0e-12) {
                        emitter.normal[axis] = normal_sum[axis] / normal_length;
                    }
                }
                emitters.push_back(std::move(emitter));
            }
            ++object_index;
        }
    }
    return emitters;
}

inline vf::JsonValue render_field(
    const std::string& name,
    std::uint32_t byte_offset,
    std::uint32_t components
) {
    return vf::JsonValue(vf::JsonValue::Object{
        {"name", vf::JsonValue(name)},
        {"byte_offset", vf::JsonValue(static_cast<double>(byte_offset))},
        {"components", vf::JsonValue(static_cast<double>(components))},
    });
}

inline vf::JsonValue render_entry(
    const std::string& id,
    const std::string& kind,
    std::size_t index
) {
    return vf::JsonValue(vf::JsonValue::Object{
        {"id", vf::JsonValue(id)},
        {"kind", vf::JsonValue(kind)},
        {"index", vf::JsonValue(static_cast<double>(index))},
    });
}

inline void append_render_record(
    std::vector<std::uint8_t>& arena,
    const std::vector<double>& values,
    std::uint32_t stride
) {
    const std::size_t start = arena.size();
    for (const double value : values) append_f32(arena, value);
    if (arena.size() > start + stride) {
        throw Error("render parameter record exceeds its canonical stride");
    }
    while (arena.size() < start + stride) append_f32(arena, 0.0);
}

inline std::uint32_t light_kind_code(const std::string& kind) {
    if (kind == "point") return 1;
    if (kind == "projected") return 2;
    if (kind == "directional") return 3;
    if (kind == "spot") return 4;
    return 0;
}

inline std::uint32_t texture_kind_code(const std::string& kind) {
    if (kind == "checker") return 1;
    if (kind == "image") return 2;
    if (kind == "procedural") return 3;
    return 0;
}

inline std::uint32_t surface_kind_code(const std::string& kind) {
    if (kind == "screen") return 1;
    if (kind == "mirror") return 2;
    return 0;
}

inline bool is_planar_reflective_object(
    const LiteralValue& object,
    bool is_surface
) {
    const LiteralValue* surface_system = object_field(object, "surface_system");
    const std::string legacy_kind = string_or(
        surface_system ? object_field(*surface_system, "kind") : nullptr, "");
    const double reflectivity = number_or(
        object_field(object, "reflectivity"),
        surface_system
            ? number_or(object_field(*surface_system, "reflectivity"), 0.0)
            : 0.0);
    if (reflectivity <= 0.0) return false;
    if (legacy_kind == "mirror" || legacy_kind == "screen") return true;
    if (is_surface) return true;
    if (string_or(object_field(object, "topology"), "triangle-list") !=
        "triangle-list") {
        return false;
    }
    const LiteralValue* vertices = object_field(object, "vertices");
    constexpr std::size_t stride = 10;
    if (vertices == nullptr || vertices->kind != LiteralKind::Array ||
        vertices->array.size() < stride * 3 ||
        vertices->array.size() % stride != 0) {
        return false;
    }
    const auto point = [&](std::size_t vertex) {
        const std::size_t base = vertex * stride;
        return std::array<double, 3>{
            number_or(&vertices->array[base], 0.0),
            number_or(&vertices->array[base + 1], 0.0),
            number_or(&vertices->array[base + 2], 0.0),
        };
    };
    const auto subtract = [](const auto& left, const auto& right) {
        return std::array<double, 3>{
            left[0] - right[0], left[1] - right[1], left[2] - right[2]};
    };
    const auto cross = [](const auto& left, const auto& right) {
        return std::array<double, 3>{
            left[1] * right[2] - left[2] * right[1],
            left[2] * right[0] - left[0] * right[2],
            left[0] * right[1] - left[1] * right[0]};
    };
    const auto dot = [](const auto& left, const auto& right) {
        return left[0] * right[0] + left[1] * right[1] +
            left[2] * right[2];
    };
    const std::size_t count = vertices->array.size() / stride;
    const auto origin = point(0);
    double coordinate_scale = 1.0;
    for (std::size_t vertex = 0; vertex < count; ++vertex) {
        const auto current = point(vertex);
        for (const double coordinate : current) {
            coordinate_scale = std::max(coordinate_scale, std::abs(coordinate));
        }
    }
    const double epsilon = coordinate_scale * 1.0e-6;
    std::optional<std::array<double, 3>> first_edge;
    std::optional<std::array<double, 3>> plane_normal;
    for (std::size_t vertex = 1; vertex < count && !plane_normal; ++vertex) {
        const auto edge = subtract(point(vertex), origin);
        if (!first_edge && dot(edge, edge) > epsilon * epsilon) {
            first_edge = edge;
            continue;
        }
        if (!first_edge) continue;
        const auto normal = cross(*first_edge, edge);
        const double normal_length = std::sqrt(dot(normal, normal));
        if (normal_length > epsilon * epsilon) {
            plane_normal = std::array<double, 3>{
                normal[0] / normal_length,
                normal[1] / normal_length,
                normal[2] / normal_length,
            };
        }
    }
    if (!plane_normal) return false;
    for (std::size_t vertex = 0; vertex < count; ++vertex) {
        if (std::abs(dot(subtract(point(vertex), origin), *plane_normal)) >
            epsilon) {
            return false;
        }
    }
    return true;
}

inline std::vector<GeometryReflector> geometry_reflectors(
    const LiteralValue& root
) {
    std::vector<GeometryReflector> reflectors;
    std::uint32_t object_index = 0;
    for (const char* collection_name : {"surfaces", "meshes"}) {
        const LiteralValue* collection = object_field(root, collection_name);
        if (!collection || collection->kind != LiteralKind::Array) continue;
        const bool is_surface = std::string(collection_name) == "surfaces";
        for (const auto& object : collection->array) {
            if (is_planar_reflective_object(object, is_surface)) {
                reflectors.push_back({
                    string_or(object_field(object, "id"),
                        "object_" + std::to_string(object_index)),
                    object_index,
                });
            }
            ++object_index;
        }
    }
    return reflectors;
}

inline std::vector<GeometryEmitterView> geometry_emitter_views(
    const LiteralValue& root,
    std::uint32_t authored_light_count,
    const std::vector<GeometryEmitter>& emitters,
    std::uint32_t max_reflection_depth = planar_reflection_max_depth
) {
    const auto reflectors = geometry_reflectors(root);
    const auto paths = planar_reflection_paths(
        reflectors.size(), max_reflection_depth);

    std::vector<GeometryEmitterView> views;
    const std::uint32_t emitter_count = static_cast<std::uint32_t>(
        emitters.size());
    for (std::size_t emitter_index = 0;
         emitter_index < emitters.size(); ++emitter_index) {
        const auto& emitter = emitters[emitter_index];
        std::map<PlanarReflectionPath, std::uint32_t> path_light_indices;
        for (const auto& path : paths) {
            const std::uint32_t light_index = authored_light_count +
                emitter_count + static_cast<std::uint32_t>(views.size());
            std::uint32_t source_light_index = authored_light_count +
                static_cast<std::uint32_t>(emitter_index);
            if (path.size() > 1) {
                auto parent = path;
                parent.pop_back();
                const auto source = path_light_indices.find(parent);
                if (source == path_light_indices.end()) {
                    throw Error(
                        "reflected emitter view parent is unavailable");
                }
                source_light_index = source->second;
            }
            std::vector<std::string> path_ids;
            std::string id = emitter.id + "@";
            for (const auto reflector_index : path) {
                if (!path_ids.empty()) id += ">";
                id += reflectors[reflector_index].id;
                path_ids.push_back(reflectors[reflector_index].id);
            }
            const auto& reflector = reflectors[path.back()];
            views.push_back({
                std::move(id),
                emitter.id,
                light_index,
                source_light_index,
                emitter.object_index,
                emitter.layer_id,
                reflector.id,
                reflector.object_index,
                std::move(path_ids),
                emitter.casts_shadow,
            });
            path_light_indices[path] = light_index;
        }
    }
    return views;
}

inline PackedRenderParameters pack_render_parameters(
    const LiteralValue& root,
    bool derive_reflected_emitter_views = false
) {
    using namespace render_parameter_layout;
    PackedRenderParameters packed;
    packed.temporal_parameter_updates = temporal_parameter_updates(root);

    const std::uint32_t camera_offset =
        static_cast<std::uint32_t>(packed.arena_bytes.size());
    const LiteralValue* camera = object_field(root, "camera");
    const auto position = vector_or(
        camera ? object_field(*camera, "pos") : nullptr, {0.0, 0.0, 5.0});
    const auto target = vector_or(
        camera ? object_field(*camera, "target") : nullptr, {0.0, 0.0, 0.0});
    const auto up = vector_or(
        camera ? object_field(*camera, "up") : nullptr, {0.0, 0.0, 1.0});
    const double fov = number_or(
        camera ? object_field(*camera, "fov") : nullptr, 45.0);
    const double near_plane = number_or(
        camera ? object_field(*camera, "near") : nullptr, 0.01);
    const double far_plane = number_or(
        camera ? object_field(*camera, "far") : nullptr, 1000.0);
    auto ambient = vector_or(object_field(root, "ambient"), {
        number_or(object_field(root, "ambient"), 0.12),
        number_or(object_field(root, "ambient"), 0.12),
        number_or(object_field(root, "ambient"), 0.12),
        1.0,
    });
    const LiteralValue* shadow = object_field(root, "shadow");
    const auto shadow_color = vector_or(
        shadow ? object_field(*shadow, "color") : nullptr,
        {0.0, 0.0, 0.0, 1.0});
    const double shadow_lift = number_or(
        shadow ? object_field(*shadow, "lift") : nullptr, 0.0);
    append_render_record(packed.arena_bytes, {
        position[0], position[1], position[2],
        target[0], target[1], target[2],
        up[0], up[1], up[2],
        fov, near_plane, far_plane,
        ambient[0], ambient[1], ambient[2], ambient[3],
        shadow_color[0], shadow_color[1], shadow_color[2], shadow_color[3],
        shadow_lift,
    }, camera_stride);
    for (auto& update : packed.temporal_parameter_updates) {
        if (update.id != "camera") continue;
        std::uint32_t field_offset = 0;
        if (update.channel == "x") field_offset = 0;
        else if (update.channel == "y") field_offset = 4;
        else if (update.channel == "z") field_offset = 8;
        else if (update.channel == "target") field_offset = 12;
        else if (update.channel == "fov") field_offset = 36;
        else if (update.channel != "p") {
            throw Error("unsupported temporal Camera channel: " + update.channel);
        }
        std::optional<std::uint32_t> interaction_offset;
        if (update.channel == "p") interaction_offset = camera_offset + 84;
        else if (update.channel == "x") interaction_offset = camera_offset + 84;
        else if (update.channel == "y") interaction_offset = camera_offset + 88;
        else if (update.channel == "z") interaction_offset = camera_offset + 92;
        update.targets.push_back({
            "camera", camera_offset + field_offset, false, interaction_offset});
    }
    packed.sections.push_back(vf::JsonValue(vf::JsonValue::Object{
        {"name", vf::JsonValue("camera")},
        {"byte_offset", vf::JsonValue(static_cast<double>(camera_offset))},
        {"byte_length", vf::JsonValue(static_cast<double>(camera_stride))},
        {"stride", vf::JsonValue(static_cast<double>(camera_stride))},
        {"fields", vf::JsonValue(vf::JsonValue::Array{
            render_field("position", 0, 3),
            render_field("target", 12, 3),
            render_field("up", 24, 3),
            render_field("fov_y_degrees", 36, 1),
            render_field("near", 40, 1),
            render_field("far", 44, 1),
            render_field("ambient", 48, 4),
            render_field("shadow_color", 64, 4),
            render_field("shadow_lift", 80, 1),
            render_field("interaction_position_offset", 84, 3),
        })},
        {"entries", vf::JsonValue(vf::JsonValue::Array{
            render_entry(string_or(object_field(root, "frame_id"), "camera"),
                         "camera", 0),
        })},
    }));

    const std::uint32_t lights_offset =
        static_cast<std::uint32_t>(packed.arena_bytes.size());
    vf::JsonValue::Array light_entries;
    const LiteralValue* lights = object_field(root, "lights");
    std::map<std::string, std::size_t> light_indices;
    if (lights && lights->kind == LiteralKind::Array) {
        for (std::size_t index = 0; index < lights->array.size(); ++index) {
            const std::string id = string_or(
                object_field(lights->array[index], "id"), "");
            if (!id.empty()) light_indices[id] = index;
        }
    }
    std::map<std::string, std::size_t> object_indices;
    std::size_t next_object_index = 0;
    for (const char* collection_name : {"surfaces", "meshes"}) {
        const LiteralValue* collection = object_field(root, collection_name);
        if (!collection || collection->kind != LiteralKind::Array) continue;
        for (const auto& object : collection->array) {
            const std::string id = string_or(
                object_field(object, "id"), "");
            if (!id.empty()) object_indices[id] = next_object_index;
            ++next_object_index;
        }
    }
    if (lights && lights->kind == LiteralKind::Array) {
        for (std::size_t index = 0; index < lights->array.size(); ++index) {
            const auto& light = lights->array[index];
            const auto light_position = vector_or(
                object_field(light, "pos"), {0.0, 0.0, 0.0});
            const auto light_target = vector_or(
                object_field(light, "target"), {0.0, 0.0, 0.0});
            auto color = vector_or(
                object_field(light, "color"), {1.0, 1.0, 1.0, 1.0});
            const std::string kind = string_or(
                object_field(light, "kind"), "point");
            const double source_radius = number_or(
                object_field(light, "source_radius"), 0.0);
            const auto emission = render_emission(light);
            const auto polarization = render_polarization(light);
            double intensity = number_or(
                object_field(light, "intensity"), 1.0);
            if (emission.present) {
                const double projected_area = source_radius > 0.0
                    ? 3.14159265358979323846 * source_radius * source_radius
                    : 1.0;
                color[0] = emission.linear_srgb[0] * projected_area;
                color[1] = emission.linear_srgb[1] * projected_area;
                color[2] = emission.linear_srgb[2] * projected_area;
                intensity = 1.0;
            }
            double reflected_light_index = -1.0;
            double reflected_object_index = -1.0;
            if (kind == "projected") {
                const std::string light_id = string_or(
                    object_field(light, "reflect_of_light_id"), "");
                const std::string object_id = string_or(
                    object_field(light, "reflect_mirror_mesh_id"), "");
                const auto resolved_light = light_indices.find(light_id);
                const auto resolved_object = object_indices.find(object_id);
                if (resolved_light == light_indices.end()) {
                    throw Error(
                        "projected light references unknown "
                        "reflect_of_light_id " + light_id);
                }
                if (resolved_object == object_indices.end()) {
                    throw Error(
                        "projected light references unknown "
                        "reflect_mirror_mesh_id " + object_id);
                }
                reflected_light_index =
                    static_cast<double>(resolved_light->second);
                reflected_object_index =
                    static_cast<double>(resolved_object->second);
            }
            append_render_record(packed.arena_bytes, {
                light_position[0], light_position[1], light_position[2],
                light_target[0], light_target[1], light_target[2],
                color[0], color[1], color[2], color[3],
                intensity,
                number_or(object_field(light, "range"), 0.0),
                source_radius,
                static_cast<double>(light_kind_code(kind)),
                bool_field(light, "casts_shadow", false) ? 1.0 : 0.0,
                reflected_light_index,
                reflected_object_index,
                bool_field(light, "show_marker", true) ? 1.0 : 0.0,
                emission.integrated_radiance,
                emission.nonvisible_radiance,
                polarization[0], polarization[1],
                polarization[2], polarization[3],
                0.0, 0.0, 1.0, 0.0,
            }, light_stride);
            light_entries.push_back(render_entry(
                string_or(object_field(light, "id"),
                          "light_" + std::to_string(index)),
                kind, index));
        }
    }
    const auto emitters = geometry_emitters(root);
    const std::size_t authored_light_count = lights &&
        lights->kind == LiteralKind::Array ? lights->array.size() : 0;
    for (std::size_t index = 0; index < emitters.size(); ++index) {
        const auto& emitter = emitters[index];
        const double source_radius = std::sqrt(
            emitter.area / 3.14159265358979323846);
        append_render_record(packed.arena_bytes, {
            emitter.position[0], emitter.position[1], emitter.position[2],
            emitter.position[0] + emitter.normal[0],
            emitter.position[1] + emitter.normal[1],
            emitter.position[2] + emitter.normal[2],
            emitter.emission.linear_srgb[0] * emitter.area,
            emitter.emission.linear_srgb[1] * emitter.area,
            emitter.emission.linear_srgb[2] * emitter.area,
            1.0,
            1.0,
            0.0,
            source_radius,
            static_cast<double>(geometry_emitter_kind_code),
            emitter.casts_shadow ? 1.0 : 0.0,
            -1.0,
            -1.0,
            emitter.show_marker ? 1.0 : 0.0,
            emitter.emission.integrated_radiance,
            emitter.emission.nonvisible_radiance,
            1.0, 0.0, 0.0, 0.0,
            emitter.normal[0], emitter.normal[1], emitter.normal[2], 0.0,
        }, light_stride);
        light_entries.push_back(render_entry(
            emitter.id, "geometry_emitter", authored_light_count + index));
    }
    const auto emitter_views = derive_reflected_emitter_views
        ? geometry_emitter_views(
            root, static_cast<std::uint32_t>(authored_light_count), emitters)
        : std::vector<GeometryEmitterView>{};
    for (const auto& view : emitter_views) {
        append_render_record(packed.arena_bytes, {
            0.0, 0.0, 0.0,
            0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
            0.0,
            0.0,
            0.0,
            static_cast<double>(reflected_emitter_view_kind_code),
            view.casts_shadow ? 1.0 : 0.0,
            static_cast<double>(view.source_light_index),
            static_cast<double>(view.reflect_surface_object_index),
            0.0,
            0.0,
            0.0,
            1.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
        }, light_stride);
        light_entries.push_back(render_entry(
            view.id, "projected", view.light_index));
    }
    const std::uint32_t lights_length =
        static_cast<std::uint32_t>(packed.arena_bytes.size()) - lights_offset;
    packed.sections.push_back(vf::JsonValue(vf::JsonValue::Object{
        {"name", vf::JsonValue("lights")},
        {"byte_offset", vf::JsonValue(static_cast<double>(lights_offset))},
        {"byte_length", vf::JsonValue(static_cast<double>(lights_length))},
        {"stride", vf::JsonValue(static_cast<double>(light_stride))},
        {"fields", vf::JsonValue(vf::JsonValue::Array{
            render_field("position", 0, 3),
            render_field("target", 12, 3),
            render_field("color", 24, 4),
            render_field("intensity", 40, 1),
            render_field("range", 44, 1),
            render_field("source_radius", 48, 1),
            render_field("kind", 52, 1),
            render_field("casts_shadow", 56, 1),
            render_field("reflect_light_index", 60, 1),
            render_field("reflect_object_index", 64, 1),
            render_field("show_marker", 68, 1),
            render_field("spectral_radiance_total", 72, 1),
            render_field("spectral_radiance_nonvisible", 76, 1),
            render_field("polarization", 80, 4),
            render_field("polarization_basis", 96, 4),
        })},
        {"entries", vf::JsonValue(std::move(light_entries))},
    }));

    const std::uint32_t objects_offset =
        static_cast<std::uint32_t>(packed.arena_bytes.size());
    vf::JsonValue::Array object_entries;
    const auto pack_objects = [&](const char* collection_name) {
        const LiteralValue* collection = object_field(root, collection_name);
        if (!collection || collection->kind != LiteralKind::Array) return;
        for (const auto& object : collection->array) {
            const std::size_t index = object_entries.size();
            auto center = vector_or(
                object_field(object, "center"), {0.0, 0.0, 0.0});
            center[2] = number_or(object_field(object, "z"), center[2]);
            auto scale = vector_or(
                object_field(object, "scale"), {1.0, 1.0, 1.0});
            if (const auto* size = object_field(object, "size");
                size && size->kind == LiteralKind::Array) {
                scale = vector_or(size, {1.0, 1.0, 1.0});
            }
            const auto rotation = vector_or(
                object_field(object, "rotation"), {0.0, 0.0, 0.0});
            const auto color = vector_or(
                object_field(object, "color"), {1.0, 1.0, 1.0, 1.0});
            const LiteralValue* texture = object_field(object, "texture");
            const auto checker_a = vector_or(
                texture ? object_field(*texture, "color_a") : nullptr, color);
            const auto checker_b = vector_or(
                texture ? object_field(*texture, "color_b") : nullptr, color);
            const auto checker_scale = vector_or(
                texture ? object_field(*texture, "scale") : nullptr,
                {1.0, 1.0});
            const std::string texture_kind = string_or(
                texture ? object_field(*texture, "kind") : nullptr, "");
            const LiteralValue* surface_system =
                object_field(object, "surface_system");
            const std::string surface_kind = string_or(
                surface_system
                    ? object_field(*surface_system, "kind")
                    : nullptr,
                "");
            const bool planar_reflector = is_planar_reflective_object(
                object, std::string(collection_name) == "surfaces");
            append_render_record(packed.arena_bytes, {
                center[0], center[1], center[2],
                scale[0], scale[1], scale[2],
                rotation[0], rotation[1], rotation[2],
                color[0], color[1], color[2], color[3],
                checker_a[0], checker_a[1], checker_a[2], checker_a[3],
                checker_b[0], checker_b[1], checker_b[2], checker_b[3],
                checker_scale[0], checker_scale[1],
                number_or(object_field(object, "reflectivity"), 0.0),
                bool_field(object, "receives_shadow", true) ? 1.0 : 0.0,
                static_cast<double>(texture_kind_code(texture_kind)),
                number_or(object_field(object, "roughness"), 0.0),
                number_or(object_field(object, "specular_strength"), 0.0),
                bool_field(object, "no_backface_specular", false) ? 1.0 : 0.0,
                static_cast<double>(planar_reflector
                    ? 2u : surface_kind_code(surface_kind)),
                number_or(object_field(object, "ior"), 0.0),
                0.0,
            }, object_stride);
            object_entries.push_back(render_entry(
                string_or(object_field(object, "id"),
                          "object_" + std::to_string(index)),
                std::string(collection_name) == "surfaces"
                    ? "surface"
                    : string_or(object_field(object, "kind"), "mesh"),
                index));
        }
    };
    pack_objects("surfaces");
    pack_objects("meshes");
    for (auto& update : packed.temporal_parameter_updates) {
        if (update.id == "camera") continue;
        const auto object = object_indices.find(update.id);
        if (object == object_indices.end()) {
            throw Error("temporal Layer object is unavailable: " + update.id);
        }
        update.targets.push_back({
            "objects",
            objects_offset + static_cast<std::uint32_t>(object->second) * object_stride,
            true,
        });
        const auto emitter = std::find_if(
            emitters.begin(), emitters.end(), [&](const GeometryEmitter& candidate) {
                return candidate.id == update.id;
            });
        if (emitter != emitters.end()) {
            const std::size_t emitter_index = static_cast<std::size_t>(
                std::distance(emitters.begin(), emitter));
            update.targets.push_back({
                "lights",
                lights_offset +
                    static_cast<std::uint32_t>(authored_light_count + emitter_index) *
                        light_stride,
                false,
            });
        }
    }
    const std::uint32_t objects_length =
        static_cast<std::uint32_t>(packed.arena_bytes.size()) - objects_offset;
    packed.sections.push_back(vf::JsonValue(vf::JsonValue::Object{
        {"name", vf::JsonValue("objects")},
        {"byte_offset", vf::JsonValue(static_cast<double>(objects_offset))},
        {"byte_length", vf::JsonValue(static_cast<double>(objects_length))},
        {"stride", vf::JsonValue(static_cast<double>(object_stride))},
        {"fields", vf::JsonValue(vf::JsonValue::Array{
            render_field("center", 0, 3),
            render_field("scale", 12, 3),
            render_field("rotation_degrees", 24, 3),
            render_field("base_color", 36, 4),
            render_field("checker_color_a", 52, 4),
            render_field("checker_color_b", 68, 4),
            render_field("checker_scale", 84, 2),
            render_field("reflectivity", 92, 1),
            render_field("receives_shadow", 96, 1),
            render_field("texture_kind", 100, 1),
            render_field("roughness", 104, 1),
            render_field("specular_strength", 108, 1),
            render_field("no_backface_specular", 112, 1),
            render_field("surface_kind", 116, 1),
            render_field("ior", 120, 1),
            render_field("extinction", 124, 1),
        })},
        {"entries", vf::JsonValue(std::move(object_entries))},
    }));
    return packed;
}

inline PackedScene pack_meshes(LiteralValue root) {
    bake_compiled_material_color(root);
    vf::JsonValue scene = literal_to_value(root);
    std::vector<std::uint8_t> arena;
    auto& scene_object = scene.as_object();
    const auto pack_geometry = [&](vf::JsonValue::Object& geometry) {
        for (const auto& field_spec : {
                 std::pair<const char*, const char*>{"vertices", "float32"},
                 std::pair<const char*, const char*>{"indices", "uint32"}}) {
            const auto found = geometry.find(field_spec.first);
            if (found == geometry.end()) continue;
            if (!found->second.is_array()) {
                throw Error(
                    std::string("native_scene geometry.") +
                    field_spec.first + " must be a vector");
            }
            while ((arena.size() & 3u) != 0u) arena.push_back(0);
            const std::size_t byte_offset = arena.size();
            const std::size_t length = found->second.as_array().size();
            for (const auto& item : found->second.as_array()) {
                if (std::string(field_spec.second) == "float32") {
                    if (!item.is_number()) {
                        throw Error(
                            "retained scene vertex must be numeric");
                    }
                    append_f32(arena, item.as_number());
                } else {
                    append_u32(arena, item);
                }
            }
            found->second = vf::JsonValue(vf::JsonValue::Object{
                {"byte_offset", vf::JsonValue(
                    static_cast<double>(byte_offset))},
                {"length", vf::JsonValue(static_cast<double>(length))},
                {"storage", vf::JsonValue(field_spec.second)},
            });
        }
    };
    const auto surfaces_entry = scene_object.find("surfaces");
    if (surfaces_entry != scene_object.end()) {
        if (!surfaces_entry->second.is_array()) {
            throw Error("native_scene.surfaces must be a vector");
        }
        for (auto& raw_surface : surfaces_entry->second.as_array()) {
            if (!raw_surface.is_object()) {
                throw Error("native_scene surface must be a struct");
            }
            auto& surface = raw_surface.as_object();
            const auto color_it = surface.find("color");
            const auto color = color_it != surface.end() &&
                    color_it->second.is_array()
                ? color_it->second.as_array()
                : vf::JsonValue::Array{};
            const auto component = [](const vf::JsonValue::Array& values,
                                      std::size_t index, double fallback) {
                return index < values.size() && values[index].is_number()
                    ? values[index].as_number() : fallback;
            };
            const std::array<double, 4> rgba{
                component(color, 0, 1.0),
                component(color, 1, 1.0),
                component(color, 2, 1.0),
                component(color, 3, 1.0),
            };
            vf::JsonValue::Array vertices;
            for (const auto& point : std::array<std::array<double, 3>, 4>{{
                     {{-0.5, -0.5, 0.0}},
                     {{0.5, -0.5, 0.0}},
                     {{0.5, 0.5, 0.0}},
                     {{-0.5, 0.5, 0.0}},
                 }}) {
                for (const double value : point) {
                    vertices.push_back(vf::JsonValue(value));
                }
                for (const double value : {0.0, 0.0, 1.0}) {
                    vertices.push_back(vf::JsonValue(value));
                }
                for (const double value : rgba) {
                    vertices.push_back(vf::JsonValue(value));
                }
            }
            surface["vertices"] = vf::JsonValue(std::move(vertices));
            surface["indices"] = vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue(0.0), vf::JsonValue(1.0),
                vf::JsonValue(2.0), vf::JsonValue(0.0),
                vf::JsonValue(2.0), vf::JsonValue(3.0),
            });
            pack_geometry(surface);
        }
    }
    const auto meshes_entry = scene_object.find("meshes");
    if (meshes_entry != scene_object.end()) {
        if (!meshes_entry->second.is_array()) {
            throw Error("native_scene.meshes must be a vector");
        }
        for (auto& raw_mesh : meshes_entry->second.as_array()) {
            if (!raw_mesh.is_object()) {
                throw Error("native_scene mesh must be a struct");
            }
            pack_geometry(raw_mesh.as_object());
        }
    }
    vf::JsonValue::Object metadata{
        {"schema", vf::JsonValue("vektor-flow/retained-scene-arena")},
        {"version", vf::JsonValue(1.0)},
        {"scene", std::move(scene)},
    };
    return {
        vf::json_stringify(vf::JsonValue(std::move(metadata)), -1),
        std::move(arena),
    };
}

inline vf::JsonValue::Array build_draw_lists(
    const LiteralValue& root,
    const PackedScene& packed_scene
) {
    const vf::JsonValue metadata = vf::parse_json(packed_scene.metadata_json);
    const auto metadata_scene = metadata.as_object().find("scene");
    if (metadata_scene == metadata.as_object().end() ||
        !metadata_scene->second.is_object()) {
        throw Error("retained scene metadata is missing its scene");
    }
    const LiteralValue* source_surfaces = object_field(root, "surfaces");
    const std::size_t surface_count =
        source_surfaces && source_surfaces->kind == LiteralKind::Array
        ? source_surfaces->array.size() : 0;
    vf::JsonValue::Array scene_visible;
    vf::JsonValue::Array shadow_casters;
    std::vector<std::pair<std::string, std::size_t>> reflective_surfaces;
    std::set<std::size_t> marker_emitter_indices;
    for (const auto& emitter : geometry_emitters(root)) {
        if (emitter.show_marker) {
            marker_emitter_indices.insert(emitter.object_index);
        }
    }
    const auto append_collection = [&](
        const std::string& collection_name,
        std::size_t object_offset
    ) {
        const auto metadata_collection =
            metadata_scene->second.as_object().find(collection_name);
        const LiteralValue* source_collection =
            object_field(root, collection_name);
        if (metadata_collection == metadata_scene->second.as_object().end() ||
            !metadata_collection->second.is_array() || !source_collection ||
            source_collection->kind != LiteralKind::Array) {
            return;
        }
        const auto& descriptors = metadata_collection->second.as_array();
        const std::size_t count = std::min(
            descriptors.size(), source_collection->array.size());
        for (std::size_t index = 0; index < count; ++index) {
            if (!descriptors[index].is_object()) continue;
            const auto& descriptor = descriptors[index].as_object();
            const auto vertices = descriptor.find("vertices");
            const auto indices = descriptor.find("indices");
            if (vertices == descriptor.end() || indices == descriptor.end() ||
                !vertices->second.is_object() || !indices->second.is_object()) {
                continue;
            }
            const auto& source = source_collection->array[index];
            if (!bool_field(source, "visible", true)) continue;
            const std::string id = string_or(
                object_field(source, "id"),
                collection_name + "_" + std::to_string(index));
            const std::size_t object_index = object_offset + index;
            if (is_planar_reflective_object(
                    source, collection_name == "surfaces")) {
                reflective_surfaces.emplace_back(id, object_index);
            }
            if (marker_emitter_indices.find(object_index) !=
                marker_emitter_indices.end()) {
                continue;
            }
            vf::JsonValue entry(vf::JsonValue::Object{
                {"mesh_id", vf::JsonValue(id)},
                {"object_index", vf::JsonValue(static_cast<double>(
                    object_index))},
                {"object_uniform_byte_offset", vf::JsonValue(
                    static_cast<double>(object_index * 256))},
                {"object_uniform_byte_length", vf::JsonValue(256.0)},
                {"vertices", vertices->second},
                {"indices", indices->second},
                {"vertex_stride", vf::JsonValue(40.0)},
                {"index_format", vf::JsonValue("uint32")},
                {"cull_mode", vf::JsonValue(
                    bool_field(source, "no_cull",
                        collection_name == "surfaces") ? "none" : "back")},
                {"visible", vf::JsonValue(true)},
            });
            scene_visible.push_back(entry);
            if (bool_field(source, "casts_shadow", true)) {
                shadow_casters.push_back(std::move(entry));
            }
        }
    };
    append_collection("surfaces", 0);
    append_collection("meshes", surface_count);
    const auto list = [](const std::string& id, vf::JsonValue::Array entries) {
        return vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue(id)},
            {"entries", vf::JsonValue(std::move(entries))},
        });
    };
    vf::JsonValue::Array draw_lists;
    draw_lists.push_back(list("shadow_casters", shadow_casters));
    const LiteralValue* lights = object_field(root, "lights");
    if (lights && lights->kind == LiteralKind::Array) {
        for (std::size_t light_index = 0;
             light_index < lights->array.size(); ++light_index) {
            const auto& light = lights->array[light_index];
            if (string_or(object_field(light, "kind"), "") != "projected" ||
                !bool_field(light, "casts_shadow", true)) {
                continue;
            }
            const std::string light_id = string_or(
                object_field(light, "id"),
                "light_" + std::to_string(light_index));
            const std::string mirror_id = string_or(
                object_field(light, "reflect_mirror_mesh_id"), "");
            const auto reflecting_surface = std::find_if(
                reflective_surfaces.begin(), reflective_surfaces.end(),
                [&](const auto& surface) { return surface.first == mirror_id; });
            vf::JsonValue::Array entries;
            for (const auto& entry : shadow_casters) {
                const auto index = entry.as_object().find("object_index");
                if (reflecting_surface != reflective_surfaces.end() &&
                    index != entry.as_object().end() &&
                    index->second.is_number() &&
                    static_cast<std::size_t>(index->second.as_number()) ==
                        reflecting_surface->second) {
                    continue;
                }
                entries.push_back(entry);
            }
            draw_lists.push_back(list(
                "shadow_casters_" + light_id, std::move(entries)));
        }
    }
    for (const int depth : {2, 1}) {
        for (const auto& [surface_id, object_index] : reflective_surfaces) {
            vf::JsonValue::Array entries;
            for (const auto& entry : scene_visible) {
                const auto index = entry.as_object().find("object_index");
                if (index != entry.as_object().end() &&
                    index->second.is_number() &&
                    static_cast<std::size_t>(index->second.as_number()) ==
                        object_index) {
                    continue;
                }
                entries.push_back(entry);
            }
            draw_lists.push_back(list(
                "reflection_visible_" + surface_id + "_" +
                    std::to_string(depth),
                std::move(entries)));
        }
    }
    draw_lists.push_back(list("scene_visible", std::move(scene_visible)));
    return draw_lists;
}

inline void attach_mirror_apertures(
    PackedRenderParameters& render_parameters,
    const PackedScene& packed_scene
) {
    const vf::JsonValue metadata = vf::parse_json(packed_scene.metadata_json);
    const auto scene_it = metadata.as_object().find("scene");
    if (scene_it == metadata.as_object().end() ||
        !scene_it->second.is_object()) {
        throw Error("retained scene metadata is missing its scene");
    }
    std::map<std::string, vf::JsonValue> aperture_by_id;
    for (const char* collection_name : {"surfaces", "meshes"}) {
        const auto collection =
            scene_it->second.as_object().find(collection_name);
        if (collection == scene_it->second.as_object().end() ||
            !collection->second.is_array()) {
            continue;
        }
        for (const auto& raw_object : collection->second.as_array()) {
            if (!raw_object.is_object()) continue;
            const auto& object = raw_object.as_object();
            const auto id = object.find("id");
            const auto vertices = object.find("vertices");
            if (id == object.end() || !id->second.is_string() ||
                vertices == object.end() || !vertices->second.is_object()) {
                continue;
            }
            const auto& reference = vertices->second.as_object();
            const auto byte_offset = reference.find("byte_offset");
            const auto length = reference.find("length");
            if (byte_offset == reference.end() ||
                !byte_offset->second.is_number() ||
                length == reference.end() || !length->second.is_number() ||
                std::fmod(length->second.as_number(), 10.0) != 0.0) {
                throw Error(
                    "mirror aperture requires packed pos/normal/RGBA vertices");
            }
            aperture_by_id[id->second.as_string()] = vf::JsonValue(
                vf::JsonValue::Object{
                    {"arena", vf::JsonValue("retained_scene_arena")},
                    {"byte_offset", byte_offset->second},
                    {"vertex_count", vf::JsonValue(
                        length->second.as_number() / 10.0)},
                    {"vertex_stride", vf::JsonValue(40.0)},
                    {"position_offset", vf::JsonValue(0.0)},
                    {"storage", vf::JsonValue("float32")},
                });
        }
    }
    for (auto& raw_section : render_parameters.sections) {
        if (!raw_section.is_object()) continue;
        auto& section = raw_section.as_object();
        const auto name = section.find("name");
        const auto entries = section.find("entries");
        if (name == section.end() || !name->second.is_string() ||
            name->second.as_string() != "objects" ||
            entries == section.end() || !entries->second.is_array()) {
            continue;
        }
        for (auto& raw_entry : entries->second.as_array()) {
            if (!raw_entry.is_object()) continue;
            auto& entry = raw_entry.as_object();
            const auto id = entry.find("id");
            if (id == entry.end() || !id->second.is_string()) continue;
            const auto aperture = aperture_by_id.find(id->second.as_string());
            if (aperture != aperture_by_id.end()) {
                entry["mirror_aperture"] = aperture->second;
            }
        }
    }
}

struct LoweredSourceScene {
    LiteralValue root;
    PackedScene packed;
    PackedRenderParameters render_parameters;
};

inline std::optional<LoweredSourceScene> lower_typed_retained_scene(
    const vf::JsonValue& typed_ir,
    const std::string& source_text,
    const std::filesystem::path& source_path
) {
    const auto loads = canonical_source_loads(source_text, source_path);
    const auto packets = vkf::retained_scene::compile_packets(typed_ir, &loads);
    if (!packets.has_value() || !packets->is_array()) return std::nullopt;

    const vf::JsonValue* retained_scene = nullptr;
    for (const auto& raw_packet : packets->as_array()) {
        if (!raw_packet.is_object()) continue;
        const auto& packet = raw_packet.as_object();
        const auto kind = packet.find("kind");
        const auto payload = packet.find("payload");
        if (kind == packet.end() || !kind->second.is_string() ||
            kind->second.as_string() != "display.replace" ||
            payload == packet.end() || !payload->second.is_object()) {
            continue;
        }
        const auto display = payload->second.as_object().find("display");
        if (display == payload->second.as_object().end() ||
            !display->second.is_object()) {
            continue;
        }
        const auto geom = display->second.as_object().find("geom");
        if (geom == display->second.as_object().end() ||
            !geom->second.is_object() || geom->second.as_object().empty()) {
            continue;
        }
        if (geom->second.as_object().size() != 1) {
            throw Error(
                "specialized retained scene artifact currently requires one retained Frame");
        }
        retained_scene = &geom->second.as_object().begin()->second;
        break;
    }
    if (retained_scene == nullptr || !retained_scene->is_object()) {
        return std::nullopt;
    }

    LoweredSourceScene lowered;
    lowered.root = literal_from_json(*retained_scene);
    lowered.packed = pack_meshes(lowered.root);
    lowered.render_parameters = pack_render_parameters(lowered.root, true);
    lowered.render_parameters.draw_lists =
        build_draw_lists(lowered.root, lowered.packed);
    attach_mirror_apertures(lowered.render_parameters, lowered.packed);
    return lowered;
}

inline std::optional<LoweredSourceScene> lower_source(
    const std::string& source_text,
    const std::filesystem::path& source_path
) {
    auto root = parse_source(source_text, source_path);
    if (!root.has_value()) return std::nullopt;
    LoweredSourceScene lowered;
    lowered.root = std::move(*root);
    lowered.packed = pack_meshes(lowered.root);
    lowered.render_parameters = pack_render_parameters(lowered.root);
    lowered.render_parameters.draw_lists =
        build_draw_lists(lowered.root, lowered.packed);
    attach_mirror_apertures(
        lowered.render_parameters, lowered.packed);
    return lowered;
}

}  // namespace vkf::native_scene
