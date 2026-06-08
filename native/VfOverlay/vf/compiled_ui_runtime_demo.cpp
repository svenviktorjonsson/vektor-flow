#include "vf/compiled_ui_runtime_demo.hpp"

namespace vf {

namespace {

constexpr float kRectWidth = 96.0F;
constexpr float kRectHeight = 64.0F;

void mark_dirty(VfDirtyRange* dirty, std::int32_t index) {
    if (dirty == nullptr || index < 0) {
        return;
    }
    dirty->version += 1U;
    if (dirty->min < 0 || index < dirty->min) {
        dirty->min = index;
    }
    if (dirty->max < 0 || index > dirty->max) {
        dirty->max = index;
    }
}

void write_identity(float* mat4) {
    if (mat4 == nullptr) {
        return;
    }
    for (std::size_t i = 0; i < kVfTransformMat4F32; ++i) {
        mat4[i] = 0.0F;
    }
    mat4[0] = 1.0F;
    mat4[5] = 1.0F;
    mat4[10] = 1.0F;
    mat4[15] = 1.0F;
}

void write_slot_translate(VfTransformArenaSpan* transforms, std::size_t slot, float x, float y) {
    if (transforms == nullptr || transforms->mat4 == nullptr || slot >= transforms->slot_count) {
        return;
    }
    float* mat4 = transforms->mat4 + slot * kVfTransformMat4F32;
    write_identity(mat4);
    mat4[12] = x;
    mat4[13] = y;
    mark_dirty(transforms->dirty, static_cast<std::int32_t>(slot));
}

void write_vertex(VfGeometryArenaSpan* geometry, std::size_t index, double x, double y, double z = 0.0) {
    if (geometry == nullptr || geometry->xyz == nullptr || index >= geometry->vertex_capacity) {
        return;
    }
    double* xyz = geometry->xyz + index * kVfGeometryVertexF64;
    xyz[0] = x;
    xyz[1] = y;
    xyz[2] = z;
    mark_dirty(geometry->dirty, static_cast<std::int32_t>(index));
}

void write_rect_geometry(VfGeometryArenaSpan* geometry, float x, float y) {
    write_vertex(geometry, 0, x, y);
    write_vertex(geometry, 1, x + kRectWidth, y);
    write_vertex(geometry, 2, x + kRectWidth, y + kRectHeight);
    write_vertex(geometry, 3, x, y + kRectHeight);
}

}  // namespace

std::int32_t CompiledUiRectDemoInit(VfRuntimeApi* api) {
    if (api == nullptr) {
        return -1;
    }
    write_slot_translate(&api->transforms, 0, 80.0F, 70.0F);
    write_rect_geometry(&api->geometry, 80.0F, 70.0F);
    return 0;
}

std::int32_t CompiledUiRectDemoUpdate(const VfInputSnapshot* input, VfRuntimeApi* api) {
    if (api == nullptr || input == nullptr) {
        return -1;
    }
    const float x = static_cast<float>(input->pointer_x - input->pointer_anchor_x);
    const float y = static_cast<float>(input->pointer_y - input->pointer_anchor_y);
    write_slot_translate(&api->transforms, 0, x, y);
    write_rect_geometry(&api->geometry, x, y);
    return static_cast<std::int32_t>(input->sequence);
}

void CompiledUiRectDemoShutdown(VfRuntimeApi* api) {
    (void)api;
}

VfCompiledUiExports MakeCompiledUiRectDemoExports() {
    VfCompiledUiExports exports{};
    exports.init = &CompiledUiRectDemoInit;
    exports.update = &CompiledUiRectDemoUpdate;
    exports.shutdown = &CompiledUiRectDemoShutdown;
    return exports;
}

}  // namespace vf

extern "C" {

std::int32_t VkfCompiledUiRectDemoInit(vf::VfRuntimeApi* api) {
    return vf::CompiledUiRectDemoInit(api);
}

std::int32_t VkfCompiledUiRectDemoUpdate(const vf::VfInputSnapshot* input, vf::VfRuntimeApi* api) {
    return vf::CompiledUiRectDemoUpdate(input, api);
}

void VkfCompiledUiRectDemoShutdown(vf::VfRuntimeApi* api) {
    vf::CompiledUiRectDemoShutdown(api);
}

vf::VfCompiledUiExports VkfCompiledUiRectDemoExports() {
    return vf::MakeCompiledUiRectDemoExports();
}

}
