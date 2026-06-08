#pragma once

#include <cstddef>
#include <cstdint>

namespace vf {

constexpr std::size_t kVfTransformMat4F32 = 16;
constexpr std::size_t kVfGeometryVertexF64 = 3;

struct VfDirtyRange {
    std::uint32_t version = 0;
    std::int32_t min = -1;
    std::int32_t max = -1;
};

struct VfTransformArenaSpan {
    float* mat4 = nullptr;
    std::size_t slot_count = 0;
    VfDirtyRange* dirty = nullptr;
};

struct VfGeometryArenaSpan {
    double* xyz = nullptr;
    std::size_t vertex_capacity = 0;
    VfDirtyRange* dirty = nullptr;
};

struct VfInputHover {
    std::int32_t object_id = -1;
    std::int32_t vertex_id = -1;
    std::int32_t edge_id = -1;
    std::int32_t face_id = -1;
    std::uint32_t mask = 0;
};

struct VfInputSnapshot {
    std::uint32_t sequence = 0;
    double time_ms = 0.0;
    double pointer_x = 0.0;
    double pointer_y = 0.0;
    double pointer_anchor_x = 0.0;
    double pointer_anchor_y = 0.0;
    std::uint32_t pointer_down = 0;
    std::uint32_t buttons = 0;
    std::uint32_t key_mask = 0;
    VfInputHover hover{};
};

struct VfRuntimeApi {
    VfTransformArenaSpan transforms{};
    VfGeometryArenaSpan geometry{};
};

using VfInitFn = std::int32_t (*)(VfRuntimeApi* api);
using VfUpdateFn = std::int32_t (*)(const VfInputSnapshot* input, VfRuntimeApi* api);
using VfShutdownFn = void (*)(VfRuntimeApi* api);

struct VfCompiledUiExports {
    VfInitFn init = nullptr;
    VfUpdateFn update = nullptr;
    VfShutdownFn shutdown = nullptr;
};

}  // namespace vf
