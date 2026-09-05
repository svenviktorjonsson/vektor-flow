#pragma once

#include "native/material/vf_stone_projected_refinement.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct StonePopulationDefinition {
    std::array<std::uint64_t, 2> seed;
    std::uint64_t population_id;
    std::uint64_t potential_members;
};

struct StonePopulationDemand {
    std::uint64_t member_id;
    std::array<double, 2> position;
};

struct StonePopulationMember {
    std::uint64_t member_id;
    std::array<double, 2> position;
    double population_variation;
    double instance_variation;
    std::array<float, 3> radii;
    std::uint64_t surface_key;
    StoneCoarseShape coarse;
};

struct StonePopulationRealization {
    std::uint64_t potential_members;
    std::vector<StonePopulationMember> members;
    std::size_t realized_vertices;
    std::size_t realized_faces;
};

struct StonePopulationSurfaceSample {
    double local_variation;
    double roughness;
};

inline bool SameStoneCoarseShape(
    const StoneCoarseShape& first,
    const StoneCoarseShape& second
) {
    return first.radii == second.radii &&
        first.positions == second.positions &&
        first.triangles == second.triangles;
}

inline bool operator==(
    const StonePopulationMember& first,
    const StonePopulationMember& second
) {
    return first.member_id == second.member_id &&
        first.position == second.position &&
        first.population_variation == second.population_variation &&
        first.instance_variation == second.instance_variation &&
        first.radii == second.radii &&
        first.surface_key == second.surface_key &&
        SameStoneCoarseShape(first.coarse, second.coarse);
}

inline bool operator==(
    const StonePopulationRealization& first,
    const StonePopulationRealization& second
) {
    return first.potential_members == second.potential_members &&
        first.members == second.members &&
        first.realized_vertices == second.realized_vertices &&
        first.realized_faces == second.realized_faces;
}

inline bool operator!=(
    const StonePopulationRealization& first,
    const StonePopulationRealization& second
) {
    return !(first == second);
}

inline bool operator==(
    const StonePopulationSurfaceSample& first,
    const StonePopulationSurfaceSample& second
) {
    return first.local_variation == second.local_variation &&
        first.roughness == second.roughness;
}

inline std::uint64_t MixStonePopulation64(std::uint64_t value) {
    value += 0x9e3779b97f4a7c15ull;
    value = (value ^ (value >> 30)) * 0xbf58476d1ce4e5b9ull;
    value = (value ^ (value >> 27)) * 0x94d049bb133111ebull;
    return value ^ (value >> 31);
}

inline double StonePopulationSignedUnit(std::uint64_t value) {
    constexpr double inverse = 1.0 / 9007199254740992.0;
    return 2.0 * static_cast<double>(value >> 11) * inverse - 1.0;
}

inline double StonePopulationFade(double value) {
    return value * value * value *
        (value * (value * 6.0 - 15.0) + 10.0);
}

inline std::uint64_t StonePopulationRootKey(
    const StonePopulationDefinition& definition
) {
    return MixStonePopulation64(
        definition.seed[0] ^
        MixStonePopulation64(definition.seed[1]) ^
        MixStonePopulation64(definition.population_id)
    );
}

inline double SampleStonePopulationField(
    std::uint64_t key,
    const std::array<double, 2>& position,
    double correlation_length,
    std::uint64_t channel
) {
    for (const double coordinate : position) {
        if (!std::isfinite(coordinate)) {
            throw std::invalid_argument(
                "stone population position is not finite"
            );
        }
    }
    const double x = position[0] / correlation_length;
    const double y = position[1] / correlation_length;
    const auto cell_x = static_cast<std::int64_t>(std::floor(x));
    const auto cell_y = static_cast<std::int64_t>(std::floor(y));
    const double fraction_x = x - static_cast<double>(cell_x);
    const double fraction_y = y - static_cast<double>(cell_y);
    auto corner = [key, channel](
        std::int64_t corner_x,
        std::int64_t corner_y
    ) {
        const auto x_word = static_cast<std::uint64_t>(corner_x);
        const auto y_word = static_cast<std::uint64_t>(corner_y);
        return StonePopulationSignedUnit(MixStonePopulation64(
            key ^
            MixStonePopulation64(x_word) ^
            MixStonePopulation64(y_word + 0x517cc1b727220a95ull) ^
            MixStonePopulation64(channel)
        ));
    };
    const double lower = corner(cell_x, cell_y) +
        (corner(cell_x + 1, cell_y) - corner(cell_x, cell_y)) *
        StonePopulationFade(fraction_x);
    const double upper = corner(cell_x, cell_y + 1) +
        (corner(cell_x + 1, cell_y + 1) -
         corner(cell_x, cell_y + 1)) *
        StonePopulationFade(fraction_x);
    return lower + (upper - lower) *
        StonePopulationFade(fraction_y);
}

inline StonePopulationMember RealizeStonePopulationMemberReference(
    const StonePopulationDefinition& definition,
    const StonePopulationDemand& demand,
    std::size_t vertex_budget,
    std::size_t face_budget
) {
    if (demand.member_id >= definition.potential_members) {
        throw std::out_of_range(
            "stone population member is outside potential range"
        );
    }
    const std::uint64_t root = StonePopulationRootKey(definition);
    const double population_variation = SampleStonePopulationField(
        root,
        demand.position,
        64.0,
        0
    );
    const std::uint64_t instance_key = MixStonePopulation64(
        root ^ MixStonePopulation64(demand.member_id) ^
        0x243f6a8885a308d3ull
    );
    const double instance_variation =
        StonePopulationSignedUnit(instance_key);
    const double scale = 0.9 +
        0.12 * population_variation +
        0.08 * instance_variation;
    constexpr std::array<double, 3> base{1.6, 1.15, 0.9};
    std::array<float, 3> radii{};
    for (std::size_t axis = 0; axis < 3; ++axis) {
        const double axis_variation = StonePopulationSignedUnit(
            MixStonePopulation64(instance_key + axis + 1)
        );
        radii[axis] = static_cast<float>(
            base[axis] * scale * (1.0 + 0.08 * axis_variation)
        );
    }
    const std::uint64_t surface_key = MixStonePopulation64(
        instance_key ^ 0x13198a2e03707344ull
    );
    return {
        demand.member_id,
        demand.position,
        population_variation,
        instance_variation,
        radii,
        surface_key,
        CreateStoneCoarseShapeReference(
            radii,
            vertex_budget,
            face_budget
        ),
    };
}

inline StonePopulationRealization RealizeStonePopulationReference(
    const StonePopulationDefinition& definition,
    const std::vector<StonePopulationDemand>& demands,
    std::size_t member_budget,
    std::size_t vertex_budget,
    std::size_t face_budget
) {
    if (definition.potential_members == 0) {
        throw std::invalid_argument(
            "stone population must contain potential members"
        );
    }
    if (demands.size() > member_budget) {
        throw std::range_error(
            "stone population demand exceeds member budget"
        );
    }
    auto ordered = demands;
    std::sort(
        ordered.begin(),
        ordered.end(),
        [](const auto& first, const auto& second) {
            return first.member_id < second.member_id;
        }
    );
    for (std::size_t index = 1; index < ordered.size(); ++index) {
        if (ordered[index - 1].member_id == ordered[index].member_id) {
            throw std::invalid_argument(
                "stone population demand is duplicated"
            );
        }
    }
    StonePopulationRealization result{
        definition.potential_members,
        {},
        0,
        0,
    };
    result.members.reserve(ordered.size());
    for (const auto& demand : ordered) {
        auto member = RealizeStonePopulationMemberReference(
            definition,
            demand,
            vertex_budget,
            face_budget
        );
        result.realized_vertices += member.coarse.positions.size();
        result.realized_faces += member.coarse.triangles.size();
        result.members.push_back(std::move(member));
    }
    return result;
}

inline StonePopulationSurfaceSample
SampleStonePopulationSurfaceReference(
    const StonePopulationMember& member,
    const std::array<double, 2>& surface_position
) {
    const double local = SampleStonePopulationField(
        member.surface_key,
        surface_position,
        0.25,
        1
    );
    const double roughness = std::clamp(
        0.7 +
            0.1 * member.population_variation +
            0.08 * member.instance_variation +
            0.07 * local,
        0.45,
        0.95
    );
    return {local, roughness};
}

}  // namespace vf::material
