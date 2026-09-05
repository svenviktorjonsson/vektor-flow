#include "native/material/vf_terrain_cell_demand.hpp"
#include "native/material/vf_terrain_waterline.hpp"
#include <iostream>
#include <limits>
#include <numeric>
#include <set>
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
        require(error.what() == message, "changed cell planning diagnostic");
        return;
    }
    throw std::runtime_error("invalid cell sample budget was accepted");
}
std::vector<char> trace;
void word(std::uint64_t value) {
    for (unsigned i = 0; i < 8; ++i) trace.push_back(static_cast<char>((value >> (i * 8)) & 255));
}
void capture(const vf::material::TerrainCellSamplePlan& plan) {
    for (const auto value : plan.request.condition.stream.key) word(value);
    for (const auto value : plan.request.condition.stream.counter_prefix) word(value);
    for (const auto value : {plan.request.condition.correlation_length, plan.request.condition.mean, plan.request.condition.amplitude})
        word(std::bit_cast<std::uint64_t>(value));
    for (const auto value : plan.request.tile) word(static_cast<std::uint32_t>(value));
    word(plan.request.refinement); word(plan.request.sample_budget); word(plan.truncated);
    word(plan.cells.size()); word(plan.sample_ids.size());
    for (const auto value : plan.cells) word(value);
    for (const auto value : plan.sample_ids) word(value);
}
}
int main(int argc, char** argv) try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 0.125, 0, 2};
    const TerrainTileRequest request{condition, {-1, 2}, 16, 6};
    constexpr std::uint64_t width = 65537, a = 60000 * width + 50000, cell = 60000ull * 65536 + 50000;
    const std::array<std::uint64_t, 2> cells{cell + 1, cell};
    const auto plan = PlanTerrainCellSamplesReference(request, cells, 2, 4);
    require(plan.cells == std::vector<std::uint64_t>{cell + 1, cell} && !plan.truncated &&
        plan.sample_ids == std::vector<std::uint64_t>{a + 1, a + 2, a + width + 1, a + width + 2, a, a + width},
        "planner lost caller order or first-use unique corner identity");
    require(plan.request.tile == request.tile && plan.request.refinement == request.refinement &&
        plan.request.condition.stream.key == request.condition.stream.key && plan.request.sample_budget == 6,
        "planned sample addresses lost their request identity");
    const auto cache = UpdateTerrainSparseResidencyReference(nullptr, plan.request, plan.sample_ids, 1, 6);
    const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(cache.active, 1.0 / 1024),
        BindTerrainWaterLevelMaterialsReference(cache.active, 0.25, 101, 202)));
    const auto mesh = std::make_shared<const TerrainTriangulation>(
        TriangulateTerrainAddressedCellsReference(surface, plan.cells, 2, 4));
    require(mesh->triangles == std::vector<std::array<std::uint32_t, 3>>{{0, 2, 1}, {1, 2, 3}, {4, 5, 0}, {0, 5, 2}},
        "planned cells did not feed exact compact topology");
    require(ExtractTerrainWaterlineReference(mesh, 4).source->source->source == cache.active,
        "planned cell consumer lost retained cache ownership");
    auto short_budget = request;
    short_budget.sample_budget = 5;
    rejects([&] { PlanTerrainCellSamplesReference(short_budget, cells, 2, 4); },
        "terrain cell demand exceeds sample budget");
    require(plan.cells.capacity() == 2 && plan.sample_ids.capacity() == 6,
        "planner allocated beyond emitted cell or sample count");
    capture(plan);
    const std::array<std::uint64_t, 3> duplicate{cell, cell, 4294967296ull};
    rejects([&] { PlanTerrainCellSamplesReference(request, duplicate, 3, 6); }, "terrain cell demand is duplicated");
    const std::array<std::uint64_t, 3> outside{4294967296ull, cell, cell};
    rejects([&] { PlanTerrainCellSamplesReference(request, outside, 3, 6); }, "terrain cell demand exceeds tile domain");
    rejects([&] { PlanTerrainCellSamplesReference(request, cells, 65537, 131073); }, "terrain cell budget must be from 0 to 65536");
    rejects([&] { PlanTerrainCellSamplesReference(request, cells, 2, 131073); }, "terrain triangle budget must be from 0 to 131072");
    const std::vector<std::uint64_t> oversized(65537, cell);
    rejects([&] { PlanTerrainCellSamplesReference(request, oversized, 0, 0); }, "terrain cell demand must contain at most 65536 entries");
    auto malformed = request; malformed.refinement = 17;
    rejects([&] { PlanTerrainCellSamplesReference(malformed, oversized, 65537, 131073); }, "terrain refinement must be from 0 to 16");
    malformed = request; malformed.sample_budget = 65537;
    rejects([&] { PlanTerrainCellSamplesReference(malformed, oversized, 65537, 131073); }, "terrain sample budget must be from 0 to 65536");
    malformed = request; malformed.condition.correlation_length = 0;
    rejects([&] { PlanTerrainCellSamplesReference(malformed, oversized, 65537, 131073); }, "spatial correlation length must be finite and positive");
    malformed = request; malformed.condition.mean = std::numeric_limits<double>::quiet_NaN();
    rejects([&] { PlanTerrainCellSamplesReference(malformed, cells, 0, 0); }, "spatial correlation mean must be finite");
    auto single_budget = request; single_budget.sample_budget = 4;
    const auto selected = PlanTerrainCellSamplesReference(single_budget, duplicate, 3, 3);
    require(selected.cells == std::vector<std::uint64_t>{cell} && selected.sample_ids.size() == 4 &&
        selected.truncated && selected.cells.capacity() == 1 && selected.sample_ids.capacity() == 4,
        "partial triangle cap split or reordered a selected cell");
    const auto empty = PlanTerrainCellSamplesReference(single_budget, outside, 0, 0);
    require(empty.cells.empty() && empty.sample_ids.empty() && empty.cells.capacity() == 0 &&
        empty.sample_ids.capacity() == 0 && empty.truncated, "zero selected demand allocated output or evaluated unselected cells");
    auto zero_budget = request; zero_budget.sample_budget = 0;
    require(PlanTerrainCellSamplesReference(zero_budget, {}, 0, 0).sample_ids.empty(), "empty demand cannot fit zero sample budget");
    rejects([&] { PlanTerrainCellSamplesReference(zero_budget, cells, 1, 2); }, "terrain cell demand exceeds sample budget");
    capture(selected); capture(empty);
    const auto replay = PlanTerrainCellSamplesReference(request, cells, 2, 4);
    require(replay.cells == plan.cells && replay.sample_ids == plan.sample_ids, "planner replay changed address order");
    auto changed = request; ++changed.condition.stream.key[0];
    const auto seed_plan = PlanTerrainCellSamplesReference(changed, cells, 2, 4);
    require(seed_plan.cells == plan.cells && seed_plan.sample_ids == plan.sample_ids &&
        seed_plan.request.condition.stream.key == changed.condition.stream.key, "seed changed cell addresses or lost condition identity");
    const auto changed_cache = UpdateTerrainSparseResidencyReference(&cache, seed_plan.request, seed_plan.sample_ids, 1, 6);
    require(!changed_cache.hit && changed_cache.active->positions != cache.active->positions,
        "planned changed condition reused the wrong source");
    capture(seed_plan);
    const auto reversed = PlanTerrainCellSamplesReference(request, std::array<std::uint64_t, 2>{cell, cell + 1}, 2, 4);
    require(reversed.sample_ids == std::vector<std::uint64_t>{a, a + 1, a + width, a + width + 1, a + 2, a + width + 2},
        "cell permutation did not preserve first-use corner order");
    capture(reversed);
    const auto high = PlanTerrainCellSamplesReference(request, std::array<std::uint64_t, 1>{4294967295ull}, 1, 2);
    require(high.sample_ids.back() == 4295098368ull, "planner truncated 64-bit sample address");
    capture(high);
    auto full_request = request; full_request.refinement = 8; full_request.sample_budget = 65535;
    std::vector<std::uint64_t> full_cells(65024);
    std::iota(full_cells.begin(), full_cells.end(), 0);
    const auto full = PlanTerrainCellSamplesReference(full_request, full_cells, 65536, 131072);
    require(full.cells.size() == 65024 && full.sample_ids.size() == 65535 && !full.truncated &&
        full.cells.capacity() == full.cells.size() && full.sample_ids.capacity() == full.sample_ids.size(),
        "full cell plan overallocated or included unused samples");
    auto too_small = full_request; --too_small.sample_budget;
    rejects([&] { PlanTerrainCellSamplesReference(too_small, full_cells, 65536, 131072); },
        "terrain cell demand exceeds sample budget");
    capture(full);
    const auto full_cache = UpdateTerrainSparseResidencyReference(nullptr, full.request, full.sample_ids, 1, 65535);
    const auto full_surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(full_cache.active, 1.0 / 1024),
        BindTerrainWaterLevelMaterialsReference(full_cache.active, 0.25, 101, 202)));
    const auto full_mesh = TriangulateTerrainAddressedCellsReference(full_surface, full.cells, 65536, 131072);
    require(full_mesh.triangles.size() == 130048 && full_mesh.source->vertices.size() == 65535,
        "full plan did not produce exactly demanded complete cells");
    for (std::size_t i = 0; i < full_surface->vertices.size(); ++i) {
        for (const auto value : full_surface->vertices[i]) word(std::bit_cast<std::uint64_t>(value));
        word(full_surface->material_ids[i]);
    }
    for (const auto& triangle : full_mesh.triangles)
        for (const auto index : triangle) word(index);
    const auto edge = [&](std::array<std::int32_t, 2> tile, std::uint32_t refinement, std::uint64_t selected_cell) {
        auto edge_request = request; edge_request.tile = tile; edge_request.refinement = refinement; edge_request.sample_budget = 4;
        return PlanTerrainCellSamplesReference(edge_request, std::array<std::uint64_t, 1>{selected_cell}, 1, 2);
    };
    const auto left = edge({-1, 2}, 16, 12345ull * 65536 + 65535), right = edge({0, 2}, 16, 12345ull * 65536);
    const auto below = edge({-1, 2}, 16, 65535ull * 65536 + 12345), above = edge({-1, 3}, 16, 12345);
    const auto positions = [&](const TerrainCellSamplePlan& demand) {
        return UpdateTerrainSparseResidencyReference(nullptr, demand.request, demand.sample_ids, 1, 4).active;
    };
    const auto l = positions(left), r = positions(right), lo = positions(below), hi = positions(above);
    for (std::size_t axis = 0; axis < 3; ++axis) {
        const auto bits = [](double value) { return std::bit_cast<std::uint64_t>(value); };
        require(bits(l->positions[1][axis]) == bits(r->positions[0][axis]) &&
            bits(l->positions[3][axis]) == bits(r->positions[2][axis]) &&
            bits(lo->positions[2][axis]) == bits(hi->positions[0][axis]) &&
            bits(lo->positions[3][axis]) == bits(hi->positions[1][axis]), "planned seam source bytes differ");
    }
    const auto coarse = edge({-1, 2}, 15, 30000ull * 32768 + 25000), fine = edge({-1, 2}, 16, cell);
    const auto coarse_source = positions(coarse), fine_source = positions(fine);
    for (std::size_t axis = 0; axis < 3; ++axis)
        require(std::bit_cast<std::uint64_t>(coarse_source->positions[0][axis]) ==
            std::bit_cast<std::uint64_t>(fine_source->positions[0][axis]), "planned refinement changed anchor bytes");
    for (const auto* item : {&left, &right, &below, &above, &coarse, &fine}) capture(*item);
    for (std::uint32_t level = 0; level < 6; ++level) {
        const auto divisions = std::uint64_t{1} << level, row_width = divisions + 1;
        auto authored = request; authored.refinement = level; authored.sample_budget = 65536;
        std::vector<std::uint64_t> order(static_cast<std::size_t>(divisions * divisions));
        std::iota(order.begin(), order.end(), 0); std::reverse(order.begin(), order.end());
        const auto planned = PlanTerrainCellSamplesReference(authored, order, 65536, 131072);
        std::set<std::uint64_t> seen;
        std::vector<std::uint64_t> oracle;
        for (const auto id : order) {
            const auto row = id / divisions, column = id % divisions;
            for (const auto address : {(row * row_width + column), (row * row_width + column + 1),
                ((row + 1) * row_width + column), ((row + 1) * row_width + column + 1)})
                if (seen.insert(address).second) oracle.push_back(address);
        }
        require(planned.cells == order && planned.sample_ids == oracle, "planner differs from explicit ordered corner oracle");
        capture(planned);
    }
    if (argc == 2 && std::string_view(argv[1]) == "--trace")
        std::cout.write(trace.data(), static_cast<std::streamsize>(trace.size()));
    else {
        require(argc == 1, "cell demand test mode is invalid");
        std::cout << "terrain cell demand: corners=ordered source=shared\n";
    }
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
