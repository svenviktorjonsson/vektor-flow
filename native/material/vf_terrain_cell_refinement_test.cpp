#include "native/material/vf_terrain_cell_refinement.hpp"
#include "native/material/vf_terrain_waterline.hpp"
#include <bit>
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
        require(error.what() == message, "changed refinement diagnostic");
        return;
    }
    throw std::runtime_error("invalid refinement request was accepted");
}
std::vector<char> trace;
void word(std::uint64_t value) {
    for (unsigned i = 0; i < 8; ++i) trace.push_back(static_cast<char>((value >> (i * 8)) & 255));
}
void capture(const vf::material::TerrainCellRefinementPlan& refinement) {
    for (const auto* request : {&refinement.parent_request, &refinement.children.request}) {
        for (const auto value : request->condition.stream.key) word(value);
        for (const auto value : request->condition.stream.counter_prefix) word(value);
        for (const auto value : {request->condition.correlation_length, request->condition.mean, request->condition.amplitude})
            word(std::bit_cast<std::uint64_t>(value));
        for (const auto value : request->tile) word(static_cast<std::uint32_t>(value));
        word(request->refinement); word(request->sample_budget);
    }
    word(refinement.parents.size()); word(refinement.children.cells.size());
    word(refinement.children.sample_ids.size()); word(refinement.children.truncated);
    for (const auto id : refinement.parents) word(id);
    for (const auto id : refinement.children.cells) word(id);
    for (const auto id : refinement.children.sample_ids) word(id);
}
}
int main(int argc, char** argv) try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 0.125, 0, 2};
    const TerrainTileRequest request{condition, {-1, 2}, 15, 9};
    constexpr std::uint64_t parent = 30000ull * 32768 + 25000, first_child = 60000ull * 65536 + 50000;
    const std::array<std::uint64_t, 1> parents{parent};
    const auto refinement = RefineTerrainCellDemandReference(request, parents, 4, 8);
    require(refinement.parents == std::vector<std::uint64_t>{parent} &&
        refinement.parent_request.refinement == 15 && refinement.children.request.refinement == 16 &&
        refinement.children.cells == std::vector<std::uint64_t>{first_child, first_child + 1, first_child + 65536, first_child + 65537} &&
        refinement.children.sample_ids.size() == 9 && !refinement.children.truncated,
        "parent identity or complete row-major child group changed");
    const auto coarse_plan = PlanTerrainCellSamplesReference(request, parents, 1, 2);
    const auto coarse = UpdateTerrainSparseResidencyReference(nullptr, coarse_plan.request, coarse_plan.sample_ids, 1, 9);
    const auto fine = UpdateTerrainSparseResidencyReference(nullptr, refinement.children.request, refinement.children.sample_ids, 1, 9);
    for (std::size_t axis = 0; axis < 3; ++axis)
        require(std::bit_cast<std::uint64_t>(coarse.active->positions[0][axis]) ==
            std::bit_cast<std::uint64_t>(fine.active->positions[0][axis]), "child realization changed coarse anchor bytes");
    capture(refinement);
    require(refinement.parents.capacity() == 1 && refinement.children.cells.capacity() == 4 &&
        refinement.children.sample_ids.capacity() == 9, "refinement allocated beyond returned group demand");
    rejects([&] { RefineTerrainCellDemandReference(request, parents, 3, 8); }, "terrain cell refinement exceeds cell budget");
    rejects([&] { RefineTerrainCellDemandReference(request, parents, 4, 7); }, "terrain cell refinement exceeds triangle budget");
    auto short_samples = request; short_samples.sample_budget = 8;
    rejects([&] { RefineTerrainCellDemandReference(short_samples, parents, 4, 8); }, "terrain cell demand exceeds sample budget");
    auto malformed = request; malformed.refinement = 16;
    rejects([&] { RefineTerrainCellDemandReference(malformed, {}, 65537, 131073); },
        "terrain cell refinement requires level from 0 to 15");
    malformed.refinement = 17;
    rejects([&] { RefineTerrainCellDemandReference(malformed, {}, 65537, 131073); }, "terrain refinement must be from 0 to 16");
    malformed = request; malformed.sample_budget = 65537;
    rejects([&] { RefineTerrainCellDemandReference(malformed, parents, 0, 0); }, "terrain sample budget must be from 0 to 65536");
    malformed = request; malformed.condition.mean = std::numeric_limits<double>::quiet_NaN();
    rejects([&] { RefineTerrainCellDemandReference(malformed, parents, 0, 0); }, "spatial correlation mean must be finite");
    rejects([&] { RefineTerrainCellDemandReference(request, parents, 65537, 131073); }, "terrain cell budget must be from 0 to 65536");
    rejects([&] { RefineTerrainCellDemandReference(request, parents, 4, 131073); }, "terrain triangle budget must be from 0 to 131072");
    const std::vector<std::uint64_t> oversized(65537, parent);
    rejects([&] { RefineTerrainCellDemandReference(request, oversized, 0, 0); }, "terrain cell demand must contain at most 65536 entries");
    const std::array<std::uint64_t, 3> duplicate{parent, parent, 1073741824ull};
    rejects([&] { RefineTerrainCellDemandReference(request, duplicate, 0, 0); }, "terrain cell demand is duplicated");
    const std::array<std::uint64_t, 3> outside{1073741824ull, parent, parent};
    rejects([&] { RefineTerrainCellDemandReference(request, outside, 0, 0); }, "terrain cell demand exceeds tile domain");
    auto empty_request = request; empty_request.sample_budget = 0;
    const auto empty = RefineTerrainCellDemandReference(empty_request, {}, 0, 0);
    require(empty.parents.empty() && empty.parents.capacity() == 0 && empty.children.cells.empty() &&
        empty.children.cells.capacity() == 0 && empty.children.sample_ids.capacity() == 0 && !empty.children.truncated,
        "empty refinement allocated output or reported partial groups");
    capture(empty);
    const auto replay = RefineTerrainCellDemandReference(request, parents, 4, 8);
    require(replay.parents == refinement.parents && replay.children.cells == refinement.children.cells &&
        replay.children.sample_ids == refinement.children.sample_ids, "refinement replay changed identities");
    const auto verify_anchors = [&](const TerrainCellRefinementPlan& refined) {
        const auto coarse_plan = PlanTerrainCellSamplesReference(refined.parent_request, refined.parents, 65536, 131072);
        const auto old = UpdateTerrainSparseResidencyReference(nullptr, coarse_plan.request, coarse_plan.sample_ids, 1, 65536);
        const auto next = UpdateTerrainSparseResidencyReference(nullptr, refined.children.request, refined.children.sample_ids, 1, 65536);
        const auto coarse_normals = DeriveTerrainNormalsReference(old.active, 1.0 / 1024);
        const auto fine_normals = DeriveTerrainNormalsReference(next.active, 1.0 / 1024);
        const auto coarse_materials = BindTerrainWaterLevelMaterialsReference(old.active, 0.25, 101, 202);
        const auto fine_materials = BindTerrainWaterLevelMaterialsReference(next.active, 0.25, 101, 202);
        const auto divisions = std::uint64_t{1} << refined.parent_request.refinement;
        for (std::size_t index = 0; index < old.active->sample_ids.size(); ++index) {
            const auto id = old.active->sample_ids[index];
            const auto fine_id = (id / (divisions + 1)) * 2 * (divisions * 2 + 1) + (id % (divisions + 1)) * 2;
            const auto found = std::find(next.active->sample_ids.begin(), next.active->sample_ids.end(), fine_id);
            require(found != next.active->sample_ids.end(), "child group omitted a coarse corner");
            const auto fine_index = static_cast<std::size_t>(found - next.active->sample_ids.begin());
            for (std::size_t axis = 0; axis < 3; ++axis) {
                require(std::bit_cast<std::uint64_t>(old.active->positions[index][axis]) ==
                    std::bit_cast<std::uint64_t>(next.active->positions[fine_index][axis]), "refinement changed coarse position bytes");
                require(std::bit_cast<std::uint64_t>(coarse_normals->normals[index][axis]) ==
                    std::bit_cast<std::uint64_t>(fine_normals->normals[fine_index][axis]), "refinement changed coarse normal bytes");
            }
            require(coarse_materials.material_ids[index] == fine_materials.material_ids[fine_index],
                "refinement changed coarse material truth");
        }
        return next.active;
    };
    auto ordered_request = request; ordered_request.sample_budget = 65536;
    const std::array<std::uint64_t, 3> order{parent + 1, parent, parent + 32768};
    const auto ordered = RefineTerrainCellDemandReference(ordered_request, order, 12, 24);
    require(ordered.parents == std::vector<std::uint64_t>(order.begin(), order.end()), "parent order changed");
    verify_anchors(ordered); capture(ordered);
    auto changed_request = ordered_request; ++changed_request.condition.stream.key[0];
    const auto changed = RefineTerrainCellDemandReference(changed_request, order, 12, 24);
    require(changed.children.cells == ordered.children.cells && changed.children.sample_ids == ordered.children.sample_ids,
        "seed changed refinement addresses");
    require(verify_anchors(changed)->positions != verify_anchors(ordered)->positions, "changed seed failed to change fine geometry");
    capture(changed);
    auto reversed_order = order; std::reverse(reversed_order.begin(), reversed_order.end());
    const auto reversed = RefineTerrainCellDemandReference(ordered_request, reversed_order, 12, 24);
    verify_anchors(reversed); capture(reversed);
    const auto maximum_id = RefineTerrainCellDemandReference(request, std::array<std::uint64_t, 1>{1073741823ull}, 4, 8);
    require(maximum_id.children.cells.back() == 4294967295ull && maximum_id.children.sample_ids.back() == 4295098368ull,
        "maximum child or sample identity was truncated");
    verify_anchors(maximum_id); capture(maximum_id);
    for (std::uint32_t level = 0; level < 16; ++level) {
        auto authored = request; authored.refinement = level; authored.sample_budget = 65536;
        const auto divisions = std::uint64_t{1} << level;
        const std::array<std::uint64_t, 1> last{divisions * divisions - 1};
        const auto refined = RefineTerrainCellDemandReference(authored, last, 4, 8);
        const auto row = (divisions - 1) * 2, column = row, width = divisions * 2;
        require(refined.children.cells == std::vector<std::uint64_t>{row * width + column, row * width + column + 1,
            (row + 1) * width + column, (row + 1) * width + column + 1}, "child group differs from explicit dyadic oracle");
        verify_anchors(refined); capture(refined);
    }
    const auto boundary = [&](std::array<std::int32_t, 2> tile, std::uint64_t selected) {
        auto local = request; local.tile = tile;
        return RefineTerrainCellDemandReference(local, std::array<std::uint64_t, 1>{selected}, 4, 8);
    };
    const auto left = boundary({-1, 2}, 12345ull * 32768 + 32767), right = boundary({0, 2}, 12345ull * 32768);
    const auto below = boundary({-1, 2}, 32767ull * 32768 + 12345), above = boundary({-1, 3}, 12345);
    const auto left_source = verify_anchors(left), right_source = verify_anchors(right);
    const auto below_source = verify_anchors(below), above_source = verify_anchors(above);
    const auto seam = [&](const TerrainTileWorkingSet& first, const TerrainTileWorkingSet& second, std::size_t axis, double coordinate) {
        std::size_t matched = 0;
        for (const auto& point : first.positions) {
            if (point[axis] != coordinate) continue;
            const auto found = std::find_if(second.positions.begin(), second.positions.end(), [&](const auto& candidate) {
                return point[0] == candidate[0] && point[2] == candidate[2];
            });
            require(found != second.positions.end(), "refined seam omitted a shared midpoint");
            for (std::size_t component = 0; component < 3; ++component)
                require(std::bit_cast<std::uint64_t>(point[component]) == std::bit_cast<std::uint64_t>((*found)[component]),
                    "refined seam source bytes differ");
            ++matched;
        }
        require(matched == 3, "refined seam must retain both corners and midpoint");
    };
    seam(*left_source, *right_source, 0, 0); seam(*below_source, *above_source, 2, 3);
    for (const auto* item : {&left, &right, &below, &above}) capture(*item);
    auto full_request = request; full_request.refinement = 7; full_request.sample_budget = 65535;
    std::vector<std::uint64_t> full_parents(16256);
    std::iota(full_parents.begin(), full_parents.end(), 0);
    const auto full = RefineTerrainCellDemandReference(full_request, full_parents, 65024, 130048);
    require(full.parents.capacity() == 16256 && full.children.cells.size() == 65024 && full.children.cells.capacity() == 65024 &&
        full.children.sample_ids.size() == 65535 && full.children.sample_ids.capacity() == 65535 && !full.children.truncated,
        "full refinement overallocated or emitted partial parent groups");
    rejects([&] { RefineTerrainCellDemandReference(full_request, full_parents, 65023, 130048); }, "terrain cell refinement exceeds cell budget");
    rejects([&] { RefineTerrainCellDemandReference(full_request, full_parents, 65024, 130047); }, "terrain cell refinement exceeds triangle budget");
    auto full_short = full_request; --full_short.sample_budget;
    rejects([&] { RefineTerrainCellDemandReference(full_short, full_parents, 65024, 130048); }, "terrain cell demand exceeds sample budget");
    capture(full);
    const auto full_source = UpdateTerrainSparseResidencyReference(nullptr, full.children.request, full.children.sample_ids, 1, 65535);
    const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(full_source.active, 1.0 / 1024),
        BindTerrainWaterLevelMaterialsReference(full_source.active, 0.25, 101, 202)));
    const auto mesh = std::make_shared<const TerrainTriangulation>(TriangulateTerrainAddressedCellsReference(surface, full.children.cells, 65024, 130048));
    const auto waterline = ExtractTerrainWaterlineReference(mesh, 65536);
    require(waterline.source->source->source == full_source.active && mesh->triangles.size() == 130048,
        "refined topology or waterline lost exact source ownership");
    for (std::size_t index = 0; index < surface->vertices.size(); ++index) {
        for (const auto value : surface->vertices[index]) word(std::bit_cast<std::uint64_t>(value));
        word(surface->material_ids[index]);
    }
    for (const auto& triangle : mesh->triangles)
        for (const auto index : triangle) word(index);
    word(waterline.segments.size()); word(waterline.truncated);
    for (const auto& segment : waterline.segments)
        for (const auto& point : segment)
            for (const auto value : point) word(std::bit_cast<std::uint64_t>(value));
    if (argc == 2 && std::string_view(argv[1]) == "--trace")
        std::cout.write(trace.data(), static_cast<std::streamsize>(trace.size()));
    else {
        require(argc == 1, "cell refinement test mode is invalid");
        std::cout << "terrain cell refinement: groups=complete anchors=exact\n";
    }
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
