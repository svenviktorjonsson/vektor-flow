#include "native/material/vf_terrain_topology_identity.hpp"
#include "native/material/vf_terrain_waterline.hpp"
#include <iostream>
#include <limits>
#include <numeric>
#include <string_view>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<class Function> void rejects(Function&& call, std::string_view message) {
    try { call(); } catch (const std::exception& error) {
        require(error.what() == message, "changed waterline topology diagnostic");
        return;
    }
    throw std::runtime_error("invalid waterline topology input was accepted");
}
}

int main() try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    const TerrainHeightCondition field{{{1, 2}, {3, 4}}, 0.125, 0, 2};
    const auto make_surface = [&](std::span<const std::uint64_t> addresses) {
        const auto terrain = RealizeTerrainSampleDemandReference(field, {-1, 2}, 3, addresses, addresses.size());
        return std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
            DeriveTerrainNormalsReference(terrain, 1.0 / 1024),
            BindTerrainWaterLevelMaterialsReference(terrain, 0.25, 101, 202)));
    };
    const std::array<std::uint64_t, 6> ids{0, 1, 9, 10, 2, 11};
    const std::array<std::uint64_t, 2> cells{0, 1};
    const auto topology = BuildTerrainTopologyIdentityReference(make_surface(ids), cells, 2, 4);
    const auto line = ExtractTerrainWaterlineReference(topology.source, 4);
    require(!line.segments.empty() && line.triangle_ordinals.size() == line.segments.size() &&
        line.triangle_ordinals.capacity() <= 4, "waterline did not retain bounded segment provenance");
    for (std::size_t segment = 0; segment < line.segments.size(); ++segment) {
        std::size_t first = topology.source->triangles.size();
        for (std::size_t triangle = 0; triangle < topology.source->triangles.size(); ++triangle) {
            auto isolated = std::make_shared<TerrainTriangulation>(*topology.source);
            isolated->triangles = {topology.source->triangles[triangle]};
            const auto candidate = ExtractTerrainWaterlineReference(isolated, 1);
            if (!candidate.segments.empty() && candidate.segments[0] == line.segments[segment]) {
                first = triangle;
                break;
            }
        }
        require(line.triangle_ordinals[segment] == first, "waterline provenance is not the first emitting triangle");
        const auto resolved = ResolveTerrainWaterlineSegmentIdentityReference(topology, line, segment);
        require(resolved.source == topology.source && resolved.cell == cells[first / 2] &&
            resolved.local_face == first % 2 && resolved.vertices == topology.source->triangles[first],
            "waterline provenance did not resolve through stable topology identity");
    }
    const auto replay = ExtractTerrainWaterlineReference(topology.source, 4);
    require(replay.segments == line.segments && replay.triangle_ordinals == line.triangle_ordinals,
        "waterline provenance replay changed");
    const auto zero = ExtractTerrainWaterlineReference(topology.source, 0);
    require(zero.segments.empty() && zero.triangle_ordinals.empty() &&
        zero.triangle_ordinals.capacity() == 0 && zero.truncated,
        "zero waterline demand retained provenance storage");
    const auto prefix = ExtractTerrainWaterlineReference(topology.source, 1);
    require(prefix.segments.size() == 1 && prefix.triangle_ordinals.size() == 1 &&
        prefix.triangle_ordinals.capacity() <= 1 && prefix.triangle_ordinals[0] == line.triangle_ordinals[0],
        "waterline provenance prefix changed or exceeded budget");
    auto authored = std::make_shared<TerrainTileWorkingSet>();
    authored->positions = {{0, 1, 0}, {0.5, 0, 0}, {0, 0, 0.5}, {0.5, 1, 0.5}};
    authored->sample_ids = {0, 1, 3, 4};
    authored->potential_count = 9;
    authored->truncated = true;
    authored->condition = field;
    authored->tile = {0, 0};
    authored->refinement = 1;
    authored->layout = TerrainSampleLayout::indexed;
    auto normals = std::make_shared<TerrainNormalsWorkingSet>();
    normals->source = authored;
    normals->normals.assign(4, {0, 1, 0});
    const auto authored_surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        normals, BindTerrainWaterLevelMaterialsReference(authored, 0, 101, 202)));
    const std::array<std::uint64_t, 1> authored_cell{0};
    const auto duplicate_topology = BuildTerrainTopologyIdentityReference(authored_surface, authored_cell, 1, 2);
    const auto duplicate_line = ExtractTerrainWaterlineReference(duplicate_topology.source, 2);
    require(duplicate_line.segments.size() == 1 && duplicate_line.triangle_ordinals == std::vector<std::size_t>{0},
        "duplicate waterline segment did not retain its first emitter");
    const auto duplicate_identity = ResolveTerrainWaterlineSegmentIdentityReference(duplicate_topology, duplicate_line, 0);
    require(duplicate_identity.cell == 0 && duplicate_identity.local_face == 0 &&
        duplicate_identity.vertices == duplicate_topology.source->triangles[0],
        "duplicate waterline segment did not resolve its first stable face");
    rejects([&] { ResolveTerrainWaterlineSegmentIdentityReference(topology, line, line.segments.size()); },
        "terrain waterline segment ordinal exceeds emitted waterline");
    rejects([&] { ResolveTerrainWaterlineSegmentIdentityReference(topology, line,
        std::numeric_limits<std::size_t>::max()); },
        "terrain waterline segment ordinal exceeds emitted waterline");
    const auto other = BuildTerrainTopologyIdentityReference(make_surface(ids), cells, 2, 4);
    rejects([&] { ResolveTerrainWaterlineSegmentIdentityReference(other, line, 0); },
        "terrain waterline and topology identity must share emitted topology");
    std::cout << "terrain waterline topology: first=retained identity=resolved\n";
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
