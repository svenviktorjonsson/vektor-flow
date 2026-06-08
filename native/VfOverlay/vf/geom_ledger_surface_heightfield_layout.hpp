#pragma once

#include <cstddef>
#include <cstdint>

#include "vf/geom_ledger_face_edge_vertex_layout.hpp"

namespace vf {

struct GeomLedgerSurfaceHeightfieldLayout {
    static constexpr std::int32_t kStateFormat = 1002;

    static constexpr std::size_t kOffI32UCount = 0;
    static constexpr std::size_t kOffI32VCount = kOffI32UCount + sizeof(std::int32_t);
    static constexpr std::size_t kOffI32FrameIndex = kOffI32VCount + sizeof(std::int32_t);
    static constexpr std::size_t kOffI32Boundary = kOffI32FrameIndex + sizeof(std::int32_t);
    static constexpr std::size_t kOffF32Phase = kOffI32Boundary + sizeof(std::int32_t);
    static constexpr std::size_t kOffF32UValues = GeomLedgerAlign4(kOffF32Phase + sizeof(float));

    static constexpr std::size_t ByteLengthFor(std::size_t uCount, std::size_t vCount) noexcept {
        const std::size_t offV = kOffF32UValues + (uCount * sizeof(float));
        const std::size_t offHeights = offV + (vCount * sizeof(float));
        return offHeights + (uCount * vCount * sizeof(float));
    }
};

}  // namespace vf
