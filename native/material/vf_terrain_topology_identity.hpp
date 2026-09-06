#pragma once

#include "native/material/vf_terrain_waterline.hpp"

namespace vf::material {

class TerrainTopologyIdentity {
public:
    const std::shared_ptr<const TerrainTriangulation> source;
    const std::vector<std::uint64_t> cells;
private:
    TerrainTopologyIdentity(std::shared_ptr<const TerrainTriangulation> mesh, std::vector<std::uint64_t> ordered)
        : source(std::move(mesh)), cells(std::move(ordered)) {}
    friend TerrainTopologyIdentity BuildTerrainTopologyIdentityReference(
        std::shared_ptr<const TerrainSurfacePacket>, std::span<const std::uint64_t>, std::size_t, std::size_t);
};

struct TerrainTriangleIdentity {
    std::shared_ptr<const TerrainTriangulation> source;
    std::uint64_t cell;
    std::uint32_t local_face;
    std::array<std::uint32_t, 3> vertices;
};

// Retain the exact selected cell prefix over the existing topology producer.
// Field/tile/refinement identity stays owned through source; no new key hash.
inline TerrainTopologyIdentity BuildTerrainTopologyIdentityReference(
    std::shared_ptr<const TerrainSurfacePacket> surface, std::span<const std::uint64_t> demands,
    std::size_t cell_budget, std::size_t triangle_budget
) {
    auto mesh = std::make_shared<const TerrainTriangulation>(
        TriangulateTerrainAddressedCellsReference(std::move(surface), demands, cell_budget, triangle_budget));
    std::vector<std::uint64_t> cells(demands.begin(), demands.begin() + mesh->cell_count);
    return {std::move(mesh), std::move(cells)};
}

inline TerrainTriangleIdentity ResolveTerrainTriangleIdentityReference(
    const TerrainTopologyIdentity& identity, std::size_t ordinal
) {
    if (ordinal >= identity.source->triangles.size())
        throw std::range_error("terrain triangle ordinal exceeds emitted topology");
    return {identity.source, identity.cells.at(ordinal / 2), static_cast<std::uint32_t>(ordinal % 2),
        identity.source->triangles.at(ordinal)};
}

inline TerrainTriangleIdentity ResolveTerrainWaterlineSegmentIdentityReference(
    const TerrainTopologyIdentity& identity, const TerrainWaterline& waterline, std::size_t segment_ordinal
) {
    if (waterline.source != identity.source)
        throw std::invalid_argument("terrain waterline and topology identity must share emitted topology");
    if (segment_ordinal >= waterline.segments.size())
        throw std::range_error("terrain waterline segment ordinal exceeds emitted waterline");
    return ResolveTerrainTriangleIdentityReference(identity, waterline.triangle_ordinals.at(segment_ordinal));
}

} // namespace vf::material
