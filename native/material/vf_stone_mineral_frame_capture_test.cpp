#include "native/material/vf_stone_mineral_frame_capture.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>

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
    constexpr std::uint64_t stone_identity =
        0x3c6ef372fe94f82bull;
    constexpr std::array<float, 3> incident_radiance{1.0f, 0.9f, 0.8f};

    const auto albite = CaptureMeasuredStoneMineralFrameReference(
        generic,
        stone_identity,
        population,
        minerals,
        StoneMineralConditionV1::albite_plagioclase,
        incident_radiance,
        48,
        48
    );
    const auto repeated = CaptureMeasuredStoneMineralFrameReference(
        generic,
        stone_identity,
        population,
        minerals,
        StoneMineralConditionV1::albite_plagioclase,
        incident_radiance,
        48,
        48
    );
    const auto hornblende = CaptureMeasuredStoneMineralFrameReference(
        generic,
        stone_identity,
        population,
        minerals,
        StoneMineralConditionV1::hornblende_amphibole,
        incident_radiance,
        48,
        48
    );

    require(albite == repeated,
            "native measured-stone capture was not deterministic");
    require(albite.width == 48 && albite.height == 48 &&
                albite.rgba8.size() == 48 * 48 * 4,
            "native measured-stone capture extent changed");
    require(albite.rendered_pixels > 1200 &&
                albite.rendered_pixels < 1900 &&
                albite.spectral_transport_samples ==
                    albite.rendered_pixels,
            "native renderer did not consume one transport sample per stone pixel");
    require(albite.passive_energy &&
                albite.maximum_energy_balance_error <= 1.0e-7f,
            "native frame capture lost passive spectral energy");
    require(albite.rgba8 != hornblende.rgba8 &&
                albite.version != hornblende.version,
            "measured mineral identity did not reach captured pixels");
    require(std::equal(
                albite.rgba8.begin(),
                albite.rgba8.begin() + 4,
                std::array<std::uint8_t, 4>{4, 7, 12, 255}.begin()
            ),
            "native capture background changed");
    require(std::equal(
                albite.rgba8.begin() + 4704,
                albite.rgba8.begin() + 4708,
                std::array<std::uint8_t, 4>{28, 22, 25, 255}.begin()
            ),
            "native capture lost measured spectral channel mapping");

    auto inflated_fit_error = minerals;
    for (auto& condition : inflated_fit_error.conditions) {
        for (auto& member : condition.members) {
            for (auto& value : member.local_fit_standard_error) {
                value *= 100.0;
            }
        }
    }
    const auto unchanged = CaptureMeasuredStoneMineralFrameReference(
        generic,
        stone_identity,
        population,
        inflated_fit_error,
        StoneMineralConditionV1::albite_plagioclase,
        incident_radiance,
        48,
        48
    );
    require(unchanged == albite,
            "measurement fit error changed native captured pixels");

    const auto rejects_capture = [&](const auto& mineral_evidence,
                                     const auto& incident,
                                     std::size_t width,
                                     std::size_t height) {
        try {
            static_cast<void>(CaptureMeasuredStoneMineralFrameReference(
                generic,
                stone_identity,
                population,
                mineral_evidence,
                StoneMineralConditionV1::albite_plagioclase,
                incident,
                width,
                height
            ));
        } catch (const std::invalid_argument&) {
            return true;
        } catch (const std::range_error&) {
            return true;
        }
        return false;
    };
    require(rejects_capture(minerals, incident_radiance, 0, 48) &&
                rejects_capture(minerals, incident_radiance, 257, 48),
            "native capture accepted an unbounded extent");
    require(rejects_capture(
                minerals,
                std::array<float, 3>{
                    1.0f,
                    std::numeric_limits<float>::infinity(),
                    0.8f,
                },
                48,
                48
            ),
            "native capture accepted non-finite illumination");
    auto incompatible = minerals;
    incompatible.provenance.source_archive_sha256 =
        "0000000000000000000000000000000000000000000000000000000000000000";
    require(rejects_capture(incompatible, incident_radiance, 48, 48),
            "native capture accepted incompatible measured evidence");

    std::cout << "stone mineral frame capture: pixels="
              << albite.rendered_pixels
              << " bytes=" << albite.rgba8.size()
              << " center_rgb="
              << static_cast<unsigned>(albite.rgba8[4704]) << ','
              << static_cast<unsigned>(albite.rgba8[4705]) << ','
              << static_cast<unsigned>(albite.rgba8[4706])
              << " version=" << albite.version
              << " passive=" << std::boolalpha << albite.passive_energy
              << '\n';
}
