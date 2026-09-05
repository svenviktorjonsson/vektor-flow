#include "native/material/vf_stone_hierarchical_population.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << message << '\n';
        throw std::runtime_error(message);
    }
}

}  // namespace

int main() {
    const vf::material::StonePopulationDefinition definition{
        {0x3c6ef372fe94f82bull, 0xa54ff53a5f1d36f1ull},
        42,
        1000000000ull,
    };
    const std::vector<vf::material::StonePopulationDemand> demands{
        {3, {10.125, 10.125}},
        {1, {10.0, 10.0}},
        {2, {180.0, -70.0}},
    };
    const auto forward =
        vf::material::RealizeStonePopulationReference(
            definition,
            demands,
            3,
            6,
            8
        );
    require(forward.members.size() == 3 &&
                forward.realized_vertices == 18 &&
                forward.realized_faces == 24 &&
                forward.potential_members == 1000000000ull,
            "lazy stone population materialized hidden members");
    require(forward.members[0].member_id == 1 &&
                forward.members[1].member_id == 2 &&
                forward.members[2].member_id == 3,
            "stone population output order changed");
    const auto& nearby_first = forward.members[0];
    const auto& nearby_second = forward.members[2];
    require(
        std::abs(
            nearby_first.population_variation -
            nearby_second.population_variation
        ) < 0.01,
        "nearby stones lost low-frequency population coherence"
    );
    require(nearby_first.instance_variation !=
                nearby_second.instance_variation,
            "nearby stones lost individual variation");
    for (const auto& member : forward.members) {
        require(member.population_variation >= -1.0 &&
                    member.population_variation <= 1.0 &&
                    member.instance_variation >= -1.0 &&
                    member.instance_variation <= 1.0,
                "stone hierarchy variation escaped bounds");
        for (const float radius : member.radii) {
            require(radius >= 0.5f && radius <= 2.2f,
                    "stone hierarchy radius escaped bounds");
        }
        require(member.coarse.positions.size() == 6 &&
                    member.coarse.triangles.size() == 8 &&
                    member.coarse.radii == member.radii,
                "population member did not feed coarse geometry");
    }

    auto reversed_demands = demands;
    std::reverse(reversed_demands.begin(), reversed_demands.end());
    const auto repeated =
        vf::material::RealizeStonePopulationReference(
            definition,
            demands,
            3,
            6,
            8
        );
    const auto reversed =
        vf::material::RealizeStonePopulationReference(
            definition,
            reversed_demands,
            3,
            6,
            8
        );
    require(repeated == forward && reversed == forward,
            "stone population depended on demand traversal");

    auto changed_definition = definition;
    changed_definition.seed[0] ^= 1ull;
    const auto changed =
        vf::material::RealizeStonePopulationReference(
            changed_definition,
            demands,
            3,
            6,
            8
        );
    require(changed != forward,
            "stone population ignored seed identity");

    const auto surface =
        vf::material::SampleStonePopulationSurfaceReference(
            nearby_first,
            {0.25, 0.75}
        );
    const auto surface_repeated =
        vf::material::SampleStonePopulationSurfaceReference(
            nearby_first,
            {0.25, 0.75}
        );
    const auto surface_nearby =
        vf::material::SampleStonePopulationSurfaceReference(
            nearby_first,
            {0.255, 0.755}
        );
    const auto surface_far =
        vf::material::SampleStonePopulationSurfaceReference(
            nearby_first,
            {0.9, 0.1}
        );
    require(surface == surface_repeated,
            "stone local surface was not deterministic");
    require(std::abs(surface.local_variation -
                surface_nearby.local_variation) < 0.1,
            "stone local surface lost spatial coherence");
    require(surface.local_variation != surface_far.local_variation,
            "stone local surface lost spatial variation");
    for (const auto sample : {surface, surface_nearby, surface_far}) {
        require(sample.local_variation >= -1.0 &&
                    sample.local_variation <= 1.0 &&
                    sample.roughness >= 0.45 &&
                    sample.roughness <= 0.95,
                "stone local surface escaped material bounds");
    }

    const vf::material::StoneViewCamera camera{
        {8.0, 0.0, 0.0},
        {0.0, 0.0, 0.0},
        {0.0, 0.0, 1.0},
        std::acos(-1.0) / 3.0,
        1080.0,
    };
    const auto refined =
        vf::material::UpdateStoneProjectedRefinementReference(
            nearby_first.coarse,
            nullptr,
            camera,
            0.0,
            2,
            8,
            12
        );
    require(refined.detail_vertices == 2 &&
                refined.detail_faces == 4,
            "population member did not feed projected refinement");

    const auto one_distant =
        vf::material::RealizeStonePopulationReference(
            definition,
            {{999999999ull, {500000.0, -500000.0}}},
            1,
            6,
            8
        );
    require(one_distant.members.size() == 1 &&
                one_distant.realized_vertices == 6,
            "distant stone demand materialized intervening population");

    bool rejected = false;
    try {
        static_cast<void>(
            vf::material::RealizeStonePopulationReference(
                definition,
                demands,
                2,
                6,
                8
            )
        );
    } catch (const std::range_error&) {
        rejected = true;
    }
    require(rejected,
            "stone population demand escaped member budget");

    std::cout << "hierarchical stone population: potential="
              << forward.potential_members
              << " realized=" << forward.members.size()
              << " vertices=" << forward.realized_vertices
              << " faces=" << forward.realized_faces << '\n';
    return 0;
}
