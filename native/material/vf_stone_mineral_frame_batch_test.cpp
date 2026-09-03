#include "native/material/vf_stone_mineral_frame_batch.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    using namespace vf::material;

    const auto population = BuildMeasuredPopulationDistributionV1(
        MaterialOpticalFamily::stone
    );
    const auto minerals = BuildStoneMineralConditionedDistributionV1();
    const StoneMineralMaterialSample generic{
        {450.0f, 550.0f, 650.0f},
        {0.31f, 0.36f, 0.40f},
        {0.40f, 0.36f, 0.31f},
        0.72f,
        0.08f,
        0.91f,
    };
    constexpr std::array<float, 3> incident_radiance{1.0f, 0.9f, 0.8f};
    constexpr std::array<StoneMineralConditionV1, 3> conditions{
        StoneMineralConditionV1::albite_plagioclase,
        StoneMineralConditionV1::microcline_alkali_feldspar,
        StoneMineralConditionV1::hornblende_amphibole,
    };
    std::vector<StoneMineralFrameInstance> instances;
    for (std::uint32_t slot = 0; slot < 128; ++slot) {
        instances.push_back(StoneMineralFrameInstance{
            0x9e3779b97f4a7c15ull *
                (static_cast<std::uint64_t>(slot) + 1),
            conditions[slot % conditions.size()],
            slot,
        });
    }

    const auto forward = CaptureMeasuredStoneMineralFrameBatchReference(
        generic,
        population,
        minerals,
        incident_radiance,
        instances,
        16
    );
    std::reverse(instances.begin(), instances.end());
    const auto reversed = CaptureMeasuredStoneMineralFrameBatchReference(
        generic,
        population,
        minerals,
        incident_radiance,
        instances,
        16
    );

    require(forward == reversed,
            "stone batch capture depended on traversal order");
    require(forward.stone_count == 128 &&
                forward.width == 192 && forward.height == 96 &&
                forward.rgba8.size() == 73'728,
            "stone batch capture extent or fixed storage changed");
    require(forward.rgba8.size() <= StoneMineralFrameBatchMaximumBytes(),
            "stone batch capture exceeded its fixed memory ceiling");
    require(forward.rendered_pixels > 0 &&
                forward.spectral_transport_samples ==
                    forward.rendered_pixels,
            "stone batch did not consume one transport sample per stone pixel");
    require(forward.passive_energy &&
                forward.maximum_energy_balance_error <= 1.0e-7f,
            "stone batch lost passive spectral energy");

    constexpr std::size_t tile_extent = 12;
    const auto tile_center = [&](std::size_t slot) {
        const std::size_t tile_x = slot % 16;
        const std::size_t tile_y = slot / 16;
        return ((tile_y * tile_extent + tile_extent / 2) * forward.width +
                tile_x * tile_extent + tile_extent / 2) * 4;
    };
    const auto first = tile_center(0);
    const auto second = tile_center(1);
    const auto third = tile_center(2);
    require(!std::equal(
                forward.rgba8.begin() + static_cast<std::ptrdiff_t>(first),
                forward.rgba8.begin() + static_cast<std::ptrdiff_t>(first + 3),
                forward.rgba8.begin() + static_cast<std::ptrdiff_t>(second)
            ) ||
                !std::equal(
                    forward.rgba8.begin() + static_cast<std::ptrdiff_t>(first),
                    forward.rgba8.begin() + static_cast<std::ptrdiff_t>(first + 3),
                    forward.rgba8.begin() + static_cast<std::ptrdiff_t>(third)
                ),
            "conditioned mineral variation did not reach batch pixels");

    auto inflated_fit_error = minerals;
    for (auto& condition : inflated_fit_error.conditions) {
        for (auto& member : condition.members) {
            for (auto& value : member.local_fit_standard_error) {
                value *= 100.0;
            }
        }
    }
    const auto unchanged = CaptureMeasuredStoneMineralFrameBatchReference(
        generic,
        population,
        inflated_fit_error,
        incident_radiance,
        instances,
        16
    );
    require(unchanged == forward,
            "measurement fit error changed batch pixels");

    std::vector<StoneMineralFrameInstance> maximum_demand = instances;
    for (std::uint32_t slot = 128; slot < 256; ++slot) {
        maximum_demand.push_back(StoneMineralFrameInstance{
            0x9e3779b97f4a7c15ull *
                (static_cast<std::uint64_t>(slot) + 1),
            conditions[slot % conditions.size()],
            slot,
        });
    }
    const auto maximum = CaptureMeasuredStoneMineralFrameBatchReference(
        generic,
        population,
        minerals,
        incident_radiance,
        maximum_demand,
        16
    );
    require(maximum.stone_count == 256 &&
                maximum.rgba8.size() ==
                    StoneMineralFrameBatchMaximumBytes(),
            "stone batch maximum demand did not meet its memory ceiling");

    const auto rejects = [&](std::vector<StoneMineralFrameInstance> demand,
                             std::size_t columns) {
        try {
            static_cast<void>(CaptureMeasuredStoneMineralFrameBatchReference(
                generic,
                population,
                minerals,
                incident_radiance,
                demand,
                columns
            ));
        } catch (const std::invalid_argument&) {
            return true;
        } catch (const std::range_error&) {
            return true;
        }
        return false;
    };
    auto duplicate_slot = instances;
    duplicate_slot.back().slot = duplicate_slot.front().slot;
    auto over_capacity = instances;
    over_capacity.push_back(StoneMineralFrameInstance{
        1,
        StoneMineralConditionV1::albite_plagioclase,
        256,
    });
    const std::vector<StoneMineralFrameInstance> oversized_rectangle{
        StoneMineralFrameInstance{
            1,
            StoneMineralConditionV1::albite_plagioclase,
            255,
        },
    };
    require(rejects({}, 16) && rejects(instances, 0) &&
                rejects(duplicate_slot, 16) && rejects(over_capacity, 16) &&
                rejects(oversized_rectangle, 255),
            "stone batch accepted invalid or over-capacity demand");

    std::cout << "stone mineral frame batch: stones="
              << forward.stone_count
              << " extent=" << forward.width << 'x' << forward.height
              << " bytes=" << forward.rgba8.size()
              << " pixels=" << forward.rendered_pixels
              << " version=" << forward.version
              << " passive=" << std::boolalpha << forward.passive_energy
              << '\n';
}
