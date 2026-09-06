#include "native/material/vf_terrain_refinement_residual.hpp"
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
        require(error.what() == message, "changed residual diagnostic");
        return;
    }
    throw std::runtime_error("invalid residual source was accepted");
}
}
int main() try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    const TerrainHeightCondition flat{{{1, 2}, {3, 4}}, 0.125, 0, 0};
    const TerrainTileRequest request{flat, {-1, 2}, 15, 9};
    const std::array<std::uint64_t, 1> parents{30000ull * 32768 + 25000};
    const auto refinement = RefineTerrainCellDemandReference(request, parents, 4, 8);
    const auto coarse_plan = PlanTerrainCellSamplesReference(request, parents, 1, 2);
    const auto surface = [&](const TerrainCellSamplePlan& plan) {
        const auto source = UpdateTerrainSparseResidencyReference(nullptr, plan.request, plan.sample_ids, 1, 65536).active;
        return std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
            DeriveTerrainNormalsReference(source, 1.0 / 1024),
            BindTerrainWaterLevelMaterialsReference(source, 0.25, 101, 202)));
    };
    const auto coarse = surface(coarse_plan), fine = surface(refinement.children);
    const auto measured = MeasureTerrainRefinementResidualsReference(coarse, fine, parents, 1);
    require(measured.coarse == coarse && measured.fine == fine && measured.cells.size() == 1 &&
        measured.cells[0].parent == parents[0], "sampled residual lost source or parent ownership");
    for (const auto value : measured.cells[0].absolute_errors)
        require(value == 0, "flat terrain produced a nonzero sampled residual");
    require(measured.cells[0].maximum_error == 0, "flat sampled maximum is not zero");
    require(measured.cells.capacity() == 1, "residual allocated beyond selected parent count");
    const auto create_pair = [&](const TerrainTileRequest& authored, std::span<const std::uint64_t> selected) {
        const auto refined = RefineTerrainCellDemandReference(authored, selected, 65536, 131072);
        const auto old = PlanTerrainCellSamplesReference(authored, selected, 65536, 131072);
        return std::array<std::shared_ptr<const TerrainSurfacePacket>, 2>{surface(old), surface(refined.children)};
    };
    auto field_request = request; field_request.refinement = 3; field_request.sample_budget = 65536;
    field_request.condition.amplitude = 2;
    const std::array<std::uint64_t, 3> selected{7, 0, 56};
    const auto pair = create_pair(field_request, selected);
    const auto nonflat = MeasureTerrainRefinementResidualsReference(pair[0], pair[1], selected, 3);
    bool has_error = false;
    for (std::size_t i = 0; i < selected.size(); ++i) {
        const double x = -1 + static_cast<double>(selected[i] % 8) / 8;
        const double z = 2 + static_cast<double>(selected[i] / 8) / 8;
        const auto height = [&](double u, double v) { return SampleTerrainHeightReference(field_request.condition, x + u / 8, z + v / 8); };
        const std::array<double, 4> old{height(0, 0), height(1, 0), height(0, 1), height(1, 1)};
        const std::array<double, 5> actual{height(0.5, 0), height(0, 0.5), height(1, 0.5), height(0.5, 1), height(0.5, 0.5)};
        const std::array<double, 5> expected{std::abs(actual[0] - (0.5 * old[0] + 0.5 * old[1])),
            std::abs(actual[1] - (0.5 * old[0] + 0.5 * old[2])), std::abs(actual[2] - (0.5 * old[1] + 0.5 * old[3])),
            std::abs(actual[3] - (0.5 * old[2] + 0.5 * old[3])), std::abs(actual[4] - (0.5 * old[1] + 0.5 * old[2]))};
        for (std::size_t point = 0; point < 5; ++point) {
            require(std::bit_cast<std::uint64_t>(expected[point]) ==
                std::bit_cast<std::uint64_t>(nonflat.cells[i].absolute_errors[point]), "residual differs from explicit five-point oracle");
            has_error = has_error || expected[point] > 0;
        }
        require(nonflat.cells[i].maximum_error == *std::max_element(expected.begin(), expected.end()), "sampled maximum changed");
    }
    require(has_error, "nonflat fixture has no measurable sampled difference");
    rejects([&] { MeasureTerrainRefinementResidualsReference({}, fine, parents, 1); }, "terrain surface working set is required");
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, coarse, parents, 1); },
        "terrain residual sources must be consecutive refinements of the same field");
    auto altered_source = std::make_shared<TerrainTileWorkingSet>(*fine->source);
    ++altered_source->condition.stream.key[0];
    auto altered = std::make_shared<TerrainSurfacePacket>(*fine); altered->source = altered_source;
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, altered, parents, 65537); },
        "terrain residual sources must be consecutive refinements of the same field");
    *altered_source = *fine->source; altered_source->condition.mean = -0.0;
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, altered, parents, 1); },
        "terrain residual sources must be consecutive refinements of the same field");
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, fine, parents, 65537); },
        "terrain residual parent budget must be from 0 to 65536");
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, fine, parents, 0); }, "terrain residual demand exceeds parent budget");
    const std::vector<std::uint64_t> oversized(65537, parents[0]);
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, fine, oversized, 65536); },
        "terrain cell demand must contain at most 65536 entries");
    const std::array<std::uint64_t, 2> duplicate{parents[0], parents[0]};
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, fine, duplicate, 2); }, "terrain cell demand is duplicated");
    const std::array<std::uint64_t, 1> outside{1073741824ull};
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, fine, outside, 1); }, "terrain cell demand exceeds tile domain");
    *altered_source = *fine->source; *altered = *fine; altered->source = altered_source;
    altered_source->positions[0][1] += 1; altered->vertices[0][1] += 1;
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, altered, parents, 1); },
        "terrain residual coarse anchors do not match fine source");
    *altered_source = *fine->source; *altered = *fine; altered->source = altered_source;
    altered_source->positions.pop_back(); altered_source->sample_ids.pop_back();
    altered->vertices.pop_back(); altered->material_ids.pop_back();
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, altered, parents, 1); }, "terrain demanded cell is not fully resident");
    *altered_source = *fine->source; *altered = *fine; altered->source = altered_source;
    altered->vertices[0][3] = std::numeric_limits<double>::quiet_NaN();
    rejects([&] { MeasureTerrainRefinementResidualsReference(coarse, altered, parents, 1); }, "terrain surface normals must be finite");
    const auto empty = MeasureTerrainRefinementResidualsReference(coarse, fine, {}, 0);
    require(empty.cells.empty() && empty.cells.capacity() == 0 && empty.coarse == coarse && empty.fine == fine,
        "empty residual demand allocated output or lost owners");
    // Validated prefix topology also participates, but selected coordinates must
    // retain their exact dyadic addresses before a midpoint can be interpreted.
    const auto prefix_surface = [&](std::uint32_t level) {
        const auto source = RealizeTerrainTileReference(field_request.condition, {-1, 2}, level, 65536);
        return std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
            DeriveTerrainNormalsReference(source, 1.0 / 1024), BindTerrainWaterLevelMaterialsReference(source, 0.25, 101, 202)));
    };
    const auto prefix_coarse = prefix_surface(3), prefix_fine = prefix_surface(4);
    const auto prefix_result = MeasureTerrainRefinementResidualsReference(prefix_coarse, prefix_fine, selected, 3);
    for (std::size_t i = 0; i < selected.size(); ++i)
        require(prefix_result.cells[i].absolute_errors == nonflat.cells[i].absolute_errors, "prefix residual differs from indexed truth");
    auto corrupt_prefix = std::make_shared<TerrainSurfacePacket>(*prefix_coarse);
    auto corrupt_positions = std::make_shared<TerrainTileWorkingSet>(*prefix_coarse->source);
    corrupt_prefix->source = corrupt_positions;
    corrupt_positions->positions[0][0] += 0.25; corrupt_prefix->vertices[0][0] += 0.25;
    rejects([&] { MeasureTerrainRefinementResidualsReference(corrupt_prefix, prefix_fine, selected, 3); },
        "terrain residual position does not match grid identity");
    const auto mutable_copy = [](const std::shared_ptr<const TerrainSurfacePacket>& original, double height) {
        auto source = std::make_shared<TerrainTileWorkingSet>(*original->source);
        auto changed = std::make_shared<TerrainSurfacePacket>(*original); changed->source = source;
        for (std::size_t i = 0; i < source->positions.size(); ++i) source->positions[i][1] = changed->vertices[i][1] = height;
        return std::pair{source, changed};
    };
    const double maximum = std::numeric_limits<double>::max();
    const auto [huge_old_source, huge_old] = mutable_copy(coarse, -maximum);
    const auto [huge_new_source, huge_new] = mutable_copy(fine, -maximum);
    huge_new_source->positions[1][1] = huge_new->vertices[1][1] = maximum;
    rejects([&] { MeasureTerrainRefinementResidualsReference(huge_old, huge_new, parents, 1); },
        "terrain sampled refinement residual must be finite");
    const auto [finite_old_source, finite_old] = mutable_copy(coarse, maximum);
    const auto [finite_new_source, finite_new] = mutable_copy(fine, maximum);
    require(MeasureTerrainRefinementResidualsReference(finite_old, finite_new, parents, 1).cells[0].maximum_error == 0,
        "finite midpoint overflowed before weighting endpoints");
    auto reversed = selected; std::reverse(reversed.begin(), reversed.end());
    const auto permuted = MeasureTerrainRefinementResidualsReference(pair[0], pair[1], reversed, 3);
    for (std::size_t i = 0; i < 3; ++i)
        require(permuted.cells[i].parent == reversed[i] && permuted.cells[i].absolute_errors == nonflat.cells[2 - i].absolute_errors,
            "parent order changed sampled values");
    auto full_request = field_request; full_request.refinement = 7;
    std::vector<std::uint64_t> full_parents(16256); std::iota(full_parents.begin(), full_parents.end(), 0);
    const auto full_pair = create_pair(full_request, full_parents);
    const auto full = MeasureTerrainRefinementResidualsReference(full_pair[0], full_pair[1], full_parents, 16256);
    require(full.cells.size() == 16256 && full.cells.capacity() == 16256, "full residual demand overallocated");
    for (const auto& cell : full.cells) {
        require(std::isfinite(cell.maximum_error) && cell.maximum_error >= 0, "full sampled maximum is invalid");
        for (const auto value : cell.absolute_errors) require(std::isfinite(value) && value >= 0 && value <= cell.maximum_error,
            "full sampled residual is invalid");
    }
    std::cout << "terrain refinement residual: sampled=exact source=owned\n";
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
