#include "vf/geom_ledger_contract.hpp"

#include <cmath>
#include <limits>
#include <stdexcept>

namespace vf {

namespace {

const JsonValue& require_object_field(const JsonValue::Object& object, const char* key) {
    const auto it = object.find(key);
    if (it == object.end()) {
        throw std::runtime_error(std::string("missing geometry ledger field: ") + key);
    }
    return it->second;
}

void require_allowed_keys(
    const JsonValue::Object& object,
    std::initializer_list<const char*> allowed,
    const char* context) {
    for (const auto& entry : object) {
        bool ok = false;
        for (const char* key : allowed) {
            if (entry.first == key) {
                ok = true;
                break;
            }
        }
        if (!ok) {
            throw std::runtime_error(std::string("unexpected ") + context + " field: " + entry.first);
        }
    }
}

std::int32_t require_int32(const JsonValue& value, const char* field_name) {
    const double number = value.as_number();
    if (!std::isfinite(number) || std::floor(number) != number) {
        throw std::runtime_error(std::string("geometry ledger field must be an integer: ") + field_name);
    }
    constexpr double kMin = static_cast<double>(std::numeric_limits<std::int32_t>::min());
    constexpr double kMax = static_cast<double>(std::numeric_limits<std::int32_t>::max());
    if (number < kMin || number > kMax) {
        throw std::runtime_error(std::string("geometry ledger field is out of int32 range: ") + field_name);
    }
    return static_cast<std::int32_t>(number);
}

}  // namespace

const char* ToString(GeomLedgerTransportKind kind) {
    switch (kind) {
    case GeomLedgerTransportKind::Inline:
        return "inline";
    case GeomLedgerTransportKind::SharedBuffer:
        return "shared-buffer";
    }
    return "inline";
}

GeomLedgerTransportKind ParseGeomLedgerTransportKind(std::string_view kind) {
    if (kind == "inline") {
        return GeomLedgerTransportKind::Inline;
    }
    if (kind == "shared-buffer") {
        return GeomLedgerTransportKind::SharedBuffer;
    }
    throw std::runtime_error("unsupported geometry ledger transport kind: " + std::string(kind));
}

const char* ToString(GeomLedgerStateFormat format) {
    switch (format) {
    case GeomLedgerStateFormat::Unknown:
        return "unknown";
    case GeomLedgerStateFormat::JsonUtf8:
        return "json-utf8";
    case GeomLedgerStateFormat::FaceEdgeVertexV1:
        return "face-edge-vertex-v1";
    case GeomLedgerStateFormat::SurfaceHeightfieldV1:
        return "surface-heightfield-v1";
    }
    return "unknown";
}

GeomLedgerStateFormat ParseGeomLedgerStateFormat(std::string_view format) {
    if (format == "unknown") {
        return GeomLedgerStateFormat::Unknown;
    }
    if (format == "json-utf8") {
        return GeomLedgerStateFormat::JsonUtf8;
    }
    if (format == "face-edge-vertex-v1") {
        return GeomLedgerStateFormat::FaceEdgeVertexV1;
    }
    if (format == "surface-heightfield-v1") {
        return GeomLedgerStateFormat::SurfaceHeightfieldV1;
    }
    throw std::runtime_error("unsupported geometry ledger state format: " + std::string(format));
}

JsonValue ToJsonValue(const GeomLedgerSharedBufferHeader& header) {
    ValidateGeomLedgerSharedBufferHeader(header);
    return JsonValue::Object{
        {"revision", static_cast<double>(header.revision)},
        {"presentedRevision", static_cast<double>(header.presented_revision)},
        {"stateByteLength", static_cast<double>(header.state_byte_length)},
        {"stateFormat", static_cast<double>(header.state_format)},
        {"flags", static_cast<double>(header.flags)},
        {"errorCode", static_cast<double>(header.error_code)},
    };
}

JsonValue ToJsonValue(const GeomLedgerTransportDescriptor& descriptor) {
    ValidateGeomLedgerTransportDescriptor(descriptor);
    JsonValue::Object object = {
        {"kind", ToString(descriptor.kind)},
        {"source", descriptor.source},
        {"error", descriptor.error},
        {"revision", static_cast<double>(descriptor.header.revision)},
        {"presentedRevision", static_cast<double>(descriptor.header.presented_revision)},
        {"stateByteLength", static_cast<double>(descriptor.header.state_byte_length)},
        {"stateFormat", static_cast<double>(descriptor.header.state_format)},
        {"flags", static_cast<double>(descriptor.header.flags)},
        {"errorCode", static_cast<double>(descriptor.header.error_code)},
    };
    return object;
}

void ValidateGeomLedgerSharedBufferHeader(const GeomLedgerSharedBufferHeader& header) {
    if (header.revision < 0) {
        throw std::runtime_error("geometry ledger revision cannot be negative");
    }
    if (header.presented_revision < -1) {
        throw std::runtime_error("geometry ledger presentedRevision cannot be less than -1");
    }
    if (header.state_byte_length < 0) {
        throw std::runtime_error("geometry ledger stateByteLength cannot be negative");
    }
}

void ValidateGeomLedgerTransportDescriptor(const GeomLedgerTransportDescriptor& descriptor) {
    ValidateGeomLedgerSharedBufferHeader(descriptor.header);
    switch (descriptor.kind) {
    case GeomLedgerTransportKind::Inline:
    case GeomLedgerTransportKind::SharedBuffer:
        break;
    default:
        throw std::runtime_error("geometry ledger descriptor uses unsupported transport kind");
    }
}

GeomLedgerSharedBufferHeader ParseGeomLedgerSharedBufferHeader(const JsonValue& value) {
    const auto& object = value.as_object();
    require_allowed_keys(
        object,
        {"revision", "presentedRevision", "stateByteLength", "stateFormat", "flags", "errorCode"},
        "geometry ledger header");
    GeomLedgerSharedBufferHeader header;
    header.revision = require_int32(require_object_field(object, "revision"), "revision");
    header.presented_revision = require_int32(require_object_field(object, "presentedRevision"), "presentedRevision");
    header.state_byte_length = require_int32(require_object_field(object, "stateByteLength"), "stateByteLength");
    header.state_format = require_int32(require_object_field(object, "stateFormat"), "stateFormat");
    header.flags = require_int32(require_object_field(object, "flags"), "flags");
    header.error_code = require_int32(require_object_field(object, "errorCode"), "errorCode");
    ValidateGeomLedgerSharedBufferHeader(header);
    return header;
}

GeomLedgerTransportDescriptor ParseGeomLedgerTransportDescriptor(const JsonValue& value) {
    const auto& object = value.as_object();
    require_allowed_keys(
        object,
        {"kind", "source", "error", "revision", "presentedRevision", "stateByteLength", "stateFormat", "flags", "errorCode"},
        "geometry ledger descriptor");
    GeomLedgerTransportDescriptor descriptor;
    descriptor.kind = ParseGeomLedgerTransportKind(require_object_field(object, "kind").as_string());
    descriptor.source = require_object_field(object, "source").as_string();
    descriptor.error = require_object_field(object, "error").as_string();
    descriptor.header = ParseGeomLedgerSharedBufferHeader(JsonValue::Object{
        {"revision", require_object_field(object, "revision")},
        {"presentedRevision", require_object_field(object, "presentedRevision")},
        {"stateByteLength", require_object_field(object, "stateByteLength")},
        {"stateFormat", require_object_field(object, "stateFormat")},
        {"flags", require_object_field(object, "flags")},
        {"errorCode", require_object_field(object, "errorCode")},
    });
    ValidateGeomLedgerTransportDescriptor(descriptor);
    return descriptor;
}

GeomLedgerTransportDescriptor ParseGeomLedgerTransportDescriptor(const char* text) {
    return ParseGeomLedgerTransportDescriptor(parse_json(text));
}

GeomLedgerTransportDescriptor ParseGeomLedgerTransportDescriptor(const std::string& text) {
    return ParseGeomLedgerTransportDescriptor(parse_json(text));
}

std::string SerializeGeomLedgerTransportDescriptor(
    const GeomLedgerTransportDescriptor& descriptor,
    int indent) {
    return json_stringify(ToJsonValue(descriptor), indent);
}

}  // namespace vf
