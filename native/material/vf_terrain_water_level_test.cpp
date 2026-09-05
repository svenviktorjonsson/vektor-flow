#include "native/material/vf_terrain_water_level.hpp"

#include <bit>
#include <iostream>
#include <limits>
#include <string_view>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
bool identical(const std::array<double, 3>& first, const std::array<double, 3>& second) {
    for (std::size_t axis = 0; axis < 3; ++axis)
        if (std::bit_cast<std::uint64_t>(first[axis]) !=
            std::bit_cast<std::uint64_t>(second[axis])) return false;
    return true;
}
template<class Function> void rejects(Function&& call, std::string_view message) {
    try { call(); } catch (const std::exception& error) {
        require(error.what() == message, "changed rejection diagnostic");
        return;
    }
    throw std::runtime_error("invalid input was accepted");
}
}

int main() try {
    using namespace vf::material;
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 4, 0, 2};
    const auto left = RealizeTerrainTileReference(condition, {-1, 2}, 3, 81);
    const auto right = RealizeTerrainTileReference(condition, {0, 2}, 3, 81);
    const auto above = RealizeTerrainTileReference(condition, {-1, 3}, 3, 81);
    const auto left_material = BindTerrainWaterLevelMaterialsReference(left, 0.25, 101, 202);
    const auto right_material = BindTerrainWaterLevelMaterialsReference(right, 0.25, 101, 202);
    const auto above_material = BindTerrainWaterLevelMaterialsReference(above, 0.25, 101, 202);
    require(left->positions.size() == 81 && right->positions.size() == 81, "tile demand changed");
    for (std::size_t row = 0; row < 9; ++row) {
        require(identical(left->positions[row * 9 + 8], right->positions[row * 9]),
            "adjacent terrain samples differ");
        require(left_material.material_ids[row * 9 + 8] == right_material.material_ids[row * 9],
            "adjacent material memberships differ");
        require(identical(left->positions[72 + row], above->positions[row]) &&
            left_material.material_ids[72 + row] == above_material.material_ids[row],
            "adjacent terrain/material samples differ on second axis");
    }
    require(left_material.source == left && right_material.source == right,
        "material consumer does not retain its terrain truth");
    const auto fine = RealizeTerrainTileReference(condition, {-1, 2}, 4, 289);
    const auto fine_material = BindTerrainWaterLevelMaterialsReference(fine, 0.25, 101, 202);
    for (std::size_t row = 0; row < 9; ++row)
        for (std::size_t column = 0; column < 9; ++column) {
            const auto coarse_index = row * 9 + column, fine_index = row * 2 * 17 + column * 2;
            require(identical(left->positions[coarse_index], fine->positions[fine_index]),
                "refinement changed a coarse terrain anchor");
            require(left_material.material_ids[coarse_index] == fine_material.material_ids[fine_index],
                "refinement changed coarse material truth");
        }
    const auto limited = RealizeTerrainTileReference(condition, {-1, 2}, 4, 19);
    require(limited->truncated && limited->potential_count == 289 && limited->positions.size() == 19,
        "terrain demand bound changed");
    for (std::size_t index = 0; index < 19; ++index)
        require(identical(limited->positions[index], fine->positions[index]), "budget changed terrain identity");
    const auto regenerated = RealizeTerrainTileReference(condition, {-1, 2}, 3, 81);
    for (std::size_t index = 0; index < 81; ++index)
        require(identical(left->positions[index], regenerated->positions[index]), "regeneration changed terrain identity");
    auto other_condition = condition;
    other_condition.stream.key[0] += 1;
    const auto changed = RealizeTerrainTileReference(other_condition, {-1, 2}, 3, 81);
    require(!identical(changed->positions[0], left->positions[0]), "seed did not affect terrain");
    const auto dry = BindTerrainWaterLevelMaterialsReference(left, -3, 101, 202);
    const auto covered = BindTerrainWaterLevelMaterialsReference(left, 3, 101, 202);
    const auto touching = BindTerrainWaterLevelMaterialsReference(left, left->positions[0][1], 101, 202);
    require(touching.material_ids[0] == 202, "water-level equality must select submerged material");
    for (std::size_t index = 0; index < 81; ++index) {
        require(dry.material_ids[index] == 101 && covered.material_ids[index] == 202,
            "water level did not change material selection");
        require(left_material.material_ids[index] == (left->positions[index][1] <= 0.25 ? 202u : 101u),
            "material consumer resampled its terrain truth");
    }
    const auto empty = RealizeTerrainTileReference(condition, {0, 0}, 16, 0);
    require(empty->positions.empty() && empty->potential_count == 4295098369ull && empty->truncated,
        "zero budget allocated a potential terrain");
    const auto maximum = RealizeTerrainTileReference(condition, {-1, 2}, 16, 65536);
    const auto maximum_material = BindTerrainWaterLevelMaterialsReference(maximum, 0.25, 101, 202);
    require(maximum->positions.size() == 65536 && maximum_material.material_ids.size() == 65536 &&
        maximum->potential_count == 4295098369ull && maximum->truncated,
        "maximum terrain/material demand exceeded its bound");
    auto invalid = condition;
    invalid.correlation_length = 0;
    rejects([&] { RealizeTerrainTileReference(invalid, {0, 0}, 3, 0); },
        "spatial correlation length must be finite and positive");
    auto malformed = std::make_shared<TerrainTileWorkingSet>();
    malformed->positions.resize(65537);
    rejects([&] { BindTerrainWaterLevelMaterialsReference(malformed, 0, 101, 202); },
        "terrain working set must contain at most 65536 finite positions");
    rejects([&] { BindTerrainWaterLevelMaterialsReference(nullptr,
        std::numeric_limits<double>::quiet_NaN(), 101, 202); }, "terrain working set is required");
    require(BindTerrainWaterLevelMaterialsReference(empty, 0, 101, 202).material_ids.empty(),
        "empty terrain material demand expanded");
    malformed->positions.resize(1);
    malformed->positions[0][1] = std::numeric_limits<double>::quiet_NaN();
    rejects([&] { BindTerrainWaterLevelMaterialsReference(malformed, 0, 101, 202); },
        "terrain working set must contain at most 65536 finite positions");
    std::cout << "terrain water-level seam: exact=true owned=true\n";
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
