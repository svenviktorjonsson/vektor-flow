#include "native/material/vf_road_water_field.hpp"
#include <bit>
#include <cstdint>
#include <iostream>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

int main() {
#ifdef _WIN32
    // This diagnostic protocol uses LF on both platforms; do not translate its
    // bytes through the Windows CRT text-mode adapter.
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    try {
        std::size_t count{}, budget{};
        std::uint64_t potential{};
        vf::material::ConditionedDemandStream stream{};
        if (!(std::cin >> count >> budget >> potential
              >> stream.key[0] >> stream.key[1]
              >> stream.counter_prefix[0] >> stream.counter_prefix[1])) return 2;
        if (count > 65537) return 2;
        const auto floats = [](std::size_t length) {
            std::vector<float> values(length);
            for (auto& value : values) {
                std::uint32_t bits{};
                if (!(std::cin >> bits)) throw std::runtime_error("invalid probe input");
                value = std::bit_cast<float>(bits);
            }
            return values;
        };
        const auto coordinates = floats(count * 3);
        const auto positions = floats(count * 3);
        std::vector<std::uint16_t> layers(count);
        for (auto& layer : layers) if (!(std::cin >> layer)) return 2;
        const auto drivers = floats(count * 2);
        const auto albedo = floats(count * 3);
        const auto roughness = floats(count);
        const auto wetness = floats(count);
        const vf::material::RoadWearBuffers wear{
            coordinates, positions, layers, drivers, albedo, roughness, wetness, potential};
        const auto result = vf::material::RealizeRoadWaterCellsReference(stream, wear, budget);
        const auto geometry = result.geometry();
        const auto material = result.material();
        if (geometry.water_coverage.data() != material.water_coverage.data() ||
            geometry.water_depth.data() != material.water_depth.data() ||
            geometry.coordinates.data() != coordinates.data() ||
            material.coordinates.data() != geometry.coordinates.data()) return 3;
        std::cout << result.sample_count << ' ' << result.vector_bytes() << ' '
            << result.truncated << '\n';
        const auto print = [](const auto& values) {
            for (const float value : values) std::cout << std::bit_cast<std::uint32_t>(value) << ' ';
        };
        print(result.pooling_driver); print(geometry.water_coverage); print(geometry.water_depth);
        print(material.albedo); print(material.roughness); print(material.wetness);
        std::cout << '\n';
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
