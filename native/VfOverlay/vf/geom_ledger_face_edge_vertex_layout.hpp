#pragma once

#include <cstddef>
#include <cstdint>

namespace vf {

constexpr std::size_t GeomLedgerAlign4(std::size_t offset) noexcept {
    return (offset % 4U) == 0U ? offset : (offset + (4U - (offset % 4U)));
}

struct GeomLedgerFaceEdgeVertexLayout {
    static constexpr std::int32_t kStateFormat = 1001;
    static constexpr std::size_t kPointCount = 8;
    static constexpr std::size_t kEdgeCount = 8;
    static constexpr std::size_t kSelectionEdgeCount = 4;
    static constexpr std::size_t kSelectionVertexCount = 4;
    static constexpr std::size_t kDragVertexCount = 4;

    static constexpr std::size_t kOffF32Points = 0;
    static constexpr std::size_t kOffI32Edges = kOffF32Points + (kPointCount * sizeof(float));
    static constexpr std::size_t kOffU8SelectionFace = kOffI32Edges + (kEdgeCount * sizeof(std::int32_t));
    static constexpr std::size_t kOffU8SelectionEdges = kOffU8SelectionFace + 1;
    static constexpr std::size_t kOffU8SelectionVertices = kOffU8SelectionEdges + kSelectionEdgeCount;
    static constexpr std::size_t kOffU8HoverKind = kOffU8SelectionVertices + kSelectionVertexCount;
    static constexpr std::size_t kOffI32HoverIndex = GeomLedgerAlign4(kOffU8HoverKind + 1);
    static constexpr std::size_t kOffI32LastObjectId = kOffI32HoverIndex + sizeof(std::int32_t);
    static constexpr std::size_t kOffI32LastSimplexId = kOffI32LastObjectId + sizeof(std::int32_t);
    static constexpr std::size_t kOffU8LastKind = kOffI32LastSimplexId + sizeof(std::int32_t);
    static constexpr std::size_t kOffI32LastIndex = GeomLedgerAlign4(kOffU8LastKind + 1);
    static constexpr std::size_t kOffU8DragActive = kOffI32LastIndex + sizeof(std::int32_t);
    static constexpr std::size_t kOffU8DragKind = kOffU8DragActive + 1;
    static constexpr std::size_t kOffI32DragIndex = GeomLedgerAlign4(kOffU8DragKind + 1);
    static constexpr std::size_t kOffI32DragPointerId = kOffI32DragIndex + sizeof(std::int32_t);
    static constexpr std::size_t kOffU8DragVertices = kOffI32DragPointerId + sizeof(std::int32_t);
    static constexpr std::size_t kStateByteLength = kOffU8DragVertices + kDragVertexCount;
};

}  // namespace vf
