#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

#include "vf/json.hpp"

namespace vf {

enum class GeomLedgerTransportKind {
    Inline,
    SharedBuffer,
};

enum class GeomLedgerStateFormat {
    Unknown = 0,
    JsonUtf8 = 1,
    FaceEdgeVertexV1 = 1001,
};

enum class GeomLedgerSharedBufferHeaderSlot : std::size_t {
    Revision = 0,
    PresentedRevision = 1,
    StateByteLength = 2,
    StateFormat = 3,
    Flags = 4,
    ErrorCode = 5,
    Count = 6,
};

struct GeomLedgerSharedBufferHeader {
    std::int32_t revision = 0;
    std::int32_t presented_revision = -1;
    std::int32_t state_byte_length = 0;
    std::int32_t state_format = static_cast<std::int32_t>(GeomLedgerStateFormat::Unknown);
    std::int32_t flags = 0;
    std::int32_t error_code = 0;
};

struct GeomLedgerTransportDescriptor {
    GeomLedgerTransportKind kind = GeomLedgerTransportKind::Inline;
    std::string source;
    std::string error;
    GeomLedgerSharedBufferHeader header;
};

constexpr std::size_t GeomLedgerSharedBufferHeaderSlotCount =
    static_cast<std::size_t>(GeomLedgerSharedBufferHeaderSlot::Count);

const char* ToString(GeomLedgerTransportKind kind);
GeomLedgerTransportKind ParseGeomLedgerTransportKind(std::string_view kind);

const char* ToString(GeomLedgerStateFormat format);
GeomLedgerStateFormat ParseGeomLedgerStateFormat(std::string_view format);

JsonValue ToJsonValue(const GeomLedgerSharedBufferHeader& header);
JsonValue ToJsonValue(const GeomLedgerTransportDescriptor& descriptor);

void ValidateGeomLedgerSharedBufferHeader(const GeomLedgerSharedBufferHeader& header);
void ValidateGeomLedgerTransportDescriptor(const GeomLedgerTransportDescriptor& descriptor);

GeomLedgerSharedBufferHeader ParseGeomLedgerSharedBufferHeader(const JsonValue& value);
GeomLedgerTransportDescriptor ParseGeomLedgerTransportDescriptor(const JsonValue& value);
GeomLedgerTransportDescriptor ParseGeomLedgerTransportDescriptor(const char* text);
GeomLedgerTransportDescriptor ParseGeomLedgerTransportDescriptor(const std::string& text);

std::string SerializeGeomLedgerTransportDescriptor(
    const GeomLedgerTransportDescriptor& descriptor,
    int indent = 2);

}  // namespace vf
