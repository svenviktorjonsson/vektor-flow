#include "native/material/vf_terrain_refinement_residual.hpp"
#include <iostream>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
void word(std::uint64_t value) {
    for (unsigned i = 0; i < 8; ++i) std::cout.put(static_cast<char>((value >> (i * 8)) & 255));
}
}
int main() try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    TerrainTileRequest request{};
    std::array<std::uint64_t, 5> scalars{};
    std::size_t parent_budget{}, count{};
    std::cin >> request.tile[0] >> request.tile[1] >> request.refinement >> request.sample_budget;
    for (auto& value : request.condition.stream.key) std::cin >> value;
    for (auto& value : request.condition.stream.counter_prefix) std::cin >> value;
    for (auto& value : scalars) std::cin >> value;
    std::cin >> parent_budget >> count;
    if (count > 65536) throw std::range_error("terrain cell demand must contain at most 65536 entries");
    std::vector<std::uint64_t> parents(count);
    for (auto& value : parents) std::cin >> value;
    if (!std::cin) throw std::invalid_argument("terrain residual probe input is invalid");
    request.condition.correlation_length = std::bit_cast<double>(scalars[0]);
    request.condition.mean = std::bit_cast<double>(scalars[1]);
    request.condition.amplitude = std::bit_cast<double>(scalars[2]);
    const auto refinement = RefineTerrainCellDemandReference(request, parents, 65536, 131072);
    const auto coarse_plan = PlanTerrainCellSamplesReference(request, parents, 65536, 131072);
    const auto surface = [&](const TerrainCellSamplePlan& plan) {
        const auto source = UpdateTerrainSparseResidencyReference(nullptr, plan.request, plan.sample_ids, 1, 65536).active;
        const auto materials = BindTerrainWaterLevelMaterialsReference(source, std::bit_cast<double>(scalars[3]), 101, 202);
        const auto normals = DeriveTerrainNormalsReference(source, std::bit_cast<double>(scalars[4]));
        return std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
            normals, materials));
    };
    const auto coarse = surface(coarse_plan);
    const auto fine = surface(refinement.children);
    const auto result = MeasureTerrainRefinementResidualsReference(coarse, fine, parents, parent_budget);
    word(result.cells.size());
    for (const auto& cell : result.cells) {
        word(cell.parent);
        for (const auto value : cell.absolute_errors) word(std::bit_cast<std::uint64_t>(value));
        word(std::bit_cast<std::uint64_t>(cell.maximum_error));
    }
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
