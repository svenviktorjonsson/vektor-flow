#pragma once
#include <cstdint>
#include <span>
#include <stdexcept>

namespace vf::material {
struct RoadCoordinateBuffers {
    std::span<const float> coordinates, positions;
    std::span<const std::uint16_t> layer_indices;
    std::uint64_t potential_cell_count;
};
inline void RequireRoadCoordinateBuffers(const RoadCoordinateBuffers& road) {
    const auto count = road.layer_indices.size();
    if (road.coordinates.size() / 3 != count || road.coordinates.size() % 3 != 0 ||
        road.positions.size() != road.coordinates.size() || road.potential_cell_count > 9007199254740991ull)
        throw std::invalid_argument("road coordinate working set is required");
}
} // namespace vf::material
