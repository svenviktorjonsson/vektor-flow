#include "native/material/vf_road_water_field.hpp"
#include "native/material/vf_road_wear_field.hpp"
#include <bit>
#include <cstdint>
#include <iostream>
#include <vector>
#include <optional>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

int main(int argc, char** argv) {
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
        const bool native_wear = argc == 2 && std::string_view(argv[1]) == "--native-wear";
        vf::material::ConditionedDemandStream traffic{}, exposure{};
        if (native_wear && !(std::cin >> traffic.key[0] >> traffic.key[1]
            >> traffic.counter_prefix[0] >> traffic.counter_prefix[1]
            >> exposure.key[0] >> exposure.key[1]
            >> exposure.counter_prefix[0] >> exposure.counter_prefix[1])) return 2;
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
        const auto drivers = floats(native_wear ? 0 : count * 2);
        const auto albedo = floats(native_wear ? 0 : count * 3);
        const auto roughness = floats(native_wear ? 0 : count);
        const auto wetness = floats(native_wear ? 0 : count);
        vf::material::RoadWearBuffers wear{
            coordinates, positions, layers, drivers, albedo, roughness, wetness, potential};
        std::optional<vf::material::RoadWearWorkingSet> realized_wear;
        if (native_wear) {
            realized_wear = vf::material::RealizeRoadWearCellsReference(traffic, exposure,
                {coordinates, positions, layers, potential}, budget);
            wear = realized_wear->buffers();
        }
        const auto result = vf::material::RealizeRoadWaterCellsReference(stream, wear, budget);
        const auto geometry = result.geometry();
        const auto material = result.material();
        if (geometry.water_coverage.data() != material.water_coverage.data() ||
            geometry.water_depth.data() != material.water_depth.data() ||
            geometry.coordinates.data() != coordinates.data() ||
            material.coordinates.data() != geometry.coordinates.data()) return 3;
        const auto print = [](const auto& values) {
            for (const float value : values) std::cout << std::bit_cast<std::uint32_t>(value) << ' ';
        };
        if (realized_wear) {
            std::cout << realized_wear->sample_count << ' ' << realized_wear->vector_bytes() << ' '
                << realized_wear->truncated << ' ';
            print(realized_wear->drivers); print(realized_wear->displacement);
            print(realized_wear->albedo); print(realized_wear->roughness); print(realized_wear->wetness);
            std::cout << '\n';
        }
        std::cout << result.sample_count << ' ' << result.vector_bytes() << ' '
            << result.truncated << '\n';
        print(result.pooling_driver); print(geometry.water_coverage); print(geometry.water_depth);
        print(material.albedo); print(material.roughness); print(material.wetness);
        std::cout << '\n';
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
