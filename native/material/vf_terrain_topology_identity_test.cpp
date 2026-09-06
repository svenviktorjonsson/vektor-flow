#include "native/material/vf_terrain_topology_identity.hpp"
#include <iostream>
#include <limits>
#include <numeric>
#include <string_view>
#include <type_traits>
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
        require(error.what() == message, "changed topology identity diagnostic");
        return;
    }
    throw std::runtime_error("invalid topology identity input was accepted");
}
void word(std::uint64_t value, unsigned bytes) {
    for (unsigned i = 0; i < bytes; ++i) std::cout.put(static_cast<char>((value >> (i * 8)) & 255));
}
}
int main(int argc, char** argv) try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    static_assert(!std::is_default_constructible_v<TerrainTopologyIdentity>);
    static_assert(!std::is_aggregate_v<TerrainTopologyIdentity>);
    const TerrainHeightCondition field{{{1, 2}, {3, 4}}, 0.125, 0, 2};
    constexpr std::uint64_t width = 65537, a = 60000 * width + 50000;
    const std::array<std::uint64_t, 4> ids{a + width + 1, a, a + width, a + 1};
    const auto source = RealizeTerrainSampleDemandReference(field, {-1, 2}, 16, ids, 4);
    const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(source, 1.0 / 1024),
        BindTerrainWaterLevelMaterialsReference(source, 0.25, 101, 202)));
    const std::array<std::uint64_t, 1> cells{60000ull * 65536 + 50000};
    const auto identity = BuildTerrainTopologyIdentityReference(surface, cells, 1, 2);
    const auto first = ResolveTerrainTriangleIdentityReference(identity, 0);
    const auto second = ResolveTerrainTriangleIdentityReference(identity, 1);
    require(identity.source->source == surface && identity.cells == std::vector<std::uint64_t>{cells[0]},
        "topology identity lost source ownership or ordered cells");
    require(first.source == identity.source && second.source == identity.source &&
        first.cell == cells[0] && second.cell == cells[0] && first.local_face == 0 && second.local_face == 1 &&
        first.vertices == std::array<std::uint32_t, 3>{1, 2, 3} && second.vertices == std::array<std::uint32_t, 3>{3, 2, 0},
        "triangle identity differs from emitted source indices");
    rejects([&] { ResolveTerrainTriangleIdentityReference(identity, 2); },
        "terrain triangle ordinal exceeds emitted topology");
    rejects([&] { ResolveTerrainTriangleIdentityReference(identity, std::numeric_limits<std::size_t>::max()); },
        "terrain triangle ordinal exceeds emitted topology");
    require(identity.cells.capacity() == 1 && identity.source->triangles.capacity() == 2,
        "identity storage exceeds selected topology");
    const auto build = [&](std::span<const std::uint64_t> demand, std::size_t cell_cap, std::size_t triangle_cap) {
        return BuildTerrainTopologyIdentityReference(surface, demand, cell_cap, triangle_cap);
    };
    const std::array<std::uint64_t, 3> duplicate{cells[0], cells[0], 4294967296ull};
    const auto truncated = build(duplicate, 1, 3);
    require(truncated.cells == identity.cells && truncated.source->triangles == identity.source->triangles &&
        truncated.source->truncated && truncated.cells.capacity() == 1, "identity changed selected prefix semantics");
    rejects([&] { build(duplicate, 3, 6); }, "terrain cell demand is duplicated");
    const std::array<std::uint64_t, 2> outside{4294967296ull, cells[0]};
    rejects([&] { build(outside, 2, 4); }, "terrain cell demand exceeds tile domain");
    const std::array<std::uint64_t, 2> missing{cells[0] - 1, outside[0]};
    rejects([&] { build(missing, 2, 4); }, "terrain demanded cell is not fully resident");
    rejects([&] { build(outside, 65537, 131073); }, "terrain cell budget must be from 0 to 65536");
    rejects([&] { build(outside, 1, 131073); }, "terrain triangle budget must be from 0 to 131072");
    const std::vector<std::uint64_t> oversized(65537, cells[0]);
    rejects([&] { build(oversized, 0, 0); }, "terrain cell demand must contain at most 65536 entries");
    rejects([&] { BuildTerrainTopologyIdentityReference({}, outside, 65537, 131073); },
        "terrain surface working set is required");
    auto misaligned = std::make_shared<TerrainSurfacePacket>(*surface); misaligned->vertices[0][0] += 1;
    rejects([&] { BuildTerrainTopologyIdentityReference(misaligned, outside, 65537, 131073); },
        "terrain surface must align with source positions and materials");
    const auto zero = build(outside, 2, 1);
    require(zero.cells.empty() && zero.cells.capacity() == 0 && zero.source->triangles.empty() &&
        zero.source->truncated && zero.source->source == surface, "zero identity demand lost bounds or ownership");
    rejects([&] { ResolveTerrainTriangleIdentityReference(zero, 0); }, "terrain triangle ordinal exceeds emitted topology");
    const auto empty = build({}, 0, 0);
    require(empty.cells.empty() && empty.cells.capacity() == 0 && !empty.source->truncated, "empty identity is truncated");
    const auto make_surface = [&](const TerrainHeightCondition& condition, std::array<std::int32_t, 2> tile,
        std::uint32_t refinement, std::span<const std::uint64_t> addresses) {
        const auto terrain = RealizeTerrainSampleDemandReference(condition, tile, refinement, addresses, addresses.size());
        return std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
            DeriveTerrainNormalsReference(terrain, 1.0 / 1024),
            BindTerrainWaterLevelMaterialsReference(terrain, 0.25, 101, 202)));
    };
    const std::array<std::uint64_t, 6> ordered_ids{0, 1, 9, 10, 2, 11};
    const std::array<std::uint64_t, 2> ordered_cells{0, 1}, reversed_cells{1, 0};
    const auto ordered_surface = make_surface(field, {-1, 2}, 3, ordered_ids);
    const auto ordered = BuildTerrainTopologyIdentityReference(ordered_surface, ordered_cells, 2, 4);
    const auto permuted = BuildTerrainTopologyIdentityReference(ordered_surface, reversed_cells, 2, 4);
    for (std::size_t ordinal = 0; ordinal < 4; ++ordinal) {
        const auto actual = ResolveTerrainTriangleIdentityReference(ordered, ordinal);
        const auto other = ResolveTerrainTriangleIdentityReference(permuted, (1 - ordinal / 2) * 2 + ordinal % 2);
        require(actual.cell == other.cell && actual.local_face == other.local_face && actual.vertices == other.vertices,
            "demand order changed stable triangle identity");
    }
    auto reversed_ids = ordered_ids; std::reverse(reversed_ids.begin(), reversed_ids.end());
    const auto reordered = BuildTerrainTopologyIdentityReference(make_surface(field, {-1, 2}, 3, reversed_ids), ordered_cells, 2, 4);
    for (std::size_t ordinal = 0; ordinal < 4; ++ordinal) {
        const auto actual = ResolveTerrainTriangleIdentityReference(ordered, ordinal);
        const auto other = ResolveTerrainTriangleIdentityReference(reordered, ordinal);
        require(actual.cell == other.cell && actual.local_face == other.local_face, "source order changed stable cell/face identity");
        for (std::size_t corner = 0; corner < 3; ++corner)
            require(ordered_ids[actual.vertices[corner]] == reversed_ids[other.vertices[corner]],
                "triangle indices stopped referring to the exact retained source order");
    }
    const auto replay = BuildTerrainTopologyIdentityReference(make_surface(field, {-1, 2}, 3, ordered_ids), ordered_cells, 2, 4);
    require(replay.cells == ordered.cells && replay.source->triangles == ordered.source->triangles &&
        replay.source->source->vertices == ordered.source->source->vertices, "replay changed retained identity bytes");
    auto changed_field = field; ++changed_field.stream.key[0]; changed_field.mean = -0.0;
    const std::array<std::uint64_t, 4> changed_ids{0, 1, 17, 18};
    const auto changed = BuildTerrainTopologyIdentityReference(make_surface(changed_field, {-3, 4}, 4, changed_ids), ordered_cells, 1, 2);
    require(changed.source->source->source->condition.stream.key == changed_field.stream.key &&
        std::bit_cast<std::uint64_t>(changed.source->source->source->condition.mean) == std::bit_cast<std::uint64_t>(-0.0) &&
        changed.source->source->source->tile == std::array<std::int32_t, 2>{-3, 4} && changed.source->source->source->refinement == 4,
        "field/tile/refinement ownership changed");
    const auto prefix_source = RealizeTerrainTileReference(field, {-1, 2}, 3, 65536);
    const auto prefix_surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(prefix_source, 1.0 / 1024), BindTerrainWaterLevelMaterialsReference(prefix_source, 0.25, 101, 202)));
    const auto prefix = BuildTerrainTopologyIdentityReference(prefix_surface, ordered_cells, 2, 4);
    for (std::size_t ordinal = 0; ordinal < 4; ++ordinal) {
        const auto actual = ResolveTerrainTriangleIdentityReference(ordered, ordinal);
        const auto dense = ResolveTerrainTriangleIdentityReference(prefix, ordinal);
        require(actual.cell == dense.cell && actual.local_face == dense.local_face, "prefix/indexed triangle identity differs");
        for (std::size_t corner = 0; corner < 3; ++corner)
            require(ordered_ids[actual.vertices[corner]] == dense.vertices[corner], "prefix indices differ from retained addresses");
    }
    constexpr std::uint64_t high_a = 65535ull * 65537 + 65535;
    const std::array<std::uint64_t, 4> high_ids{high_a, high_a + 1, high_a + 65537, high_a + 65538};
    const std::array<std::uint64_t, 1> high_cell{4294967295ull};
    const auto high = BuildTerrainTopologyIdentityReference(make_surface(field, {-1, 2}, 16, high_ids), high_cell, 1, 2);
    const auto high_face = ResolveTerrainTriangleIdentityReference(high, 1);
    require(high_face.cell == 4294967295ull && high_face.source->source->source->sample_ids[high_face.vertices[2]] == 4295098368ull,
        "highest cell/corner address was truncated");
    const auto retained = [&] {
        const auto local = BuildTerrainTopologyIdentityReference(make_surface(field, {-1, 2}, 3, ordered_ids), ordered_cells, 2, 4);
        return ResolveTerrainTriangleIdentityReference(local, 3);
    }();
    require(retained.source->source->source->sample_ids[retained.vertices[2]] == 11 && retained.cell == 1,
        "resolved identity lost source when its index owner left scope");
    std::vector<std::uint64_t> full_ids(65536), full_cells(65024);
    std::iota(full_ids.begin(), full_ids.end(), 0); std::reverse(full_ids.begin(), full_ids.end());
    std::iota(full_cells.begin(), full_cells.end(), 0);
    const auto full = BuildTerrainTopologyIdentityReference(make_surface(field, {-1, 2}, 8, full_ids), full_cells, 65536, 131072);
    require(full.cells.size() == 65024 && full.cells.capacity() == 65024 && full.source->triangles.size() == 130048 &&
        full.source->triangles.capacity() == 130048 && !full.source->truncated, "full identity demand overallocated");
    for (std::size_t ordinal = 0; ordinal < full.source->triangles.size(); ++ordinal) {
        const auto resolved = ResolveTerrainTriangleIdentityReference(full, ordinal);
        require(resolved.source == full.source && resolved.cell == ordinal / 2 && resolved.local_face == ordinal % 2 &&
            resolved.vertices == full.source->triangles[ordinal], "full identity differs from emitted topology order");
    }
    if (argc == 2 && std::string_view(argv[1]) == "--trace") {
        word(full.source->triangles.size(), 8);
        const auto& retained_source = *full.source->source->source;
        for (const auto value : retained_source.condition.stream.key) word(value, 4);
        for (const auto value : retained_source.condition.stream.counter_prefix) word(value, 4);
        word(std::bit_cast<std::uint64_t>(retained_source.condition.correlation_length), 8);
        word(std::bit_cast<std::uint64_t>(retained_source.condition.mean), 8);
        word(std::bit_cast<std::uint64_t>(retained_source.condition.amplitude), 8);
        for (const auto value : retained_source.tile) word(static_cast<std::uint32_t>(value), 4);
        word(retained_source.refinement, 4);
        for (std::size_t ordinal = 0; ordinal < full.source->triangles.size(); ++ordinal) {
            const auto resolved = ResolveTerrainTriangleIdentityReference(full, ordinal);
            word(resolved.cell, 8); word(resolved.local_face, 4);
            for (const auto index : resolved.vertices) word(index, 4);
        }
    } else std::cout << "terrain topology identity: address=exact source=owned\n";
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
