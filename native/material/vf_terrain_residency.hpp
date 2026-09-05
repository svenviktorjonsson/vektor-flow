#pragma once

#include "native/material/vf_terrain_water_level.hpp"
#include <bit>

namespace vf::material {

struct TerrainTileRequest {
    TerrainHeightCondition condition;
    std::array<std::int32_t, 2> tile;
    std::uint32_t refinement;
    std::size_t sample_budget;
};

class TerrainResidencyState {
public:
    const std::vector<std::shared_ptr<const TerrainTileWorkingSet>> entries;
    const std::shared_ptr<const TerrainTileWorkingSet> active;
    const bool hit;
    const std::size_t resident_samples;
private:
    TerrainResidencyState(std::vector<std::shared_ptr<const TerrainTileWorkingSet>> owned,
        std::shared_ptr<const TerrainTileWorkingSet> selected, bool reused, std::size_t samples)
        : entries(std::move(owned)), active(std::move(selected)), hit(reused), resident_samples(samples) {}
    friend TerrainResidencyState UpdateTerrainResidencyReference(
        const TerrainResidencyState*, const TerrainTileRequest&, std::size_t, std::size_t);
    friend TerrainResidencyState UpdateTerrainSparseResidencyReference(
        const TerrainResidencyState*, const TerrainTileRequest&, std::span<const std::uint64_t>, std::size_t, std::size_t);
    template<class Matches, class Realize> static TerrainResidencyState Update(
        const TerrainResidencyState*, std::size_t, std::size_t, std::size_t, const Matches&, const Realize&);
};

inline bool SameTerrainResidencyField(const TerrainTileWorkingSet& stored,
    const TerrainTileRequest& request, std::size_t count) {
    const auto bits = [](double value) { return std::bit_cast<std::uint64_t>(value); };
    return stored.condition.stream.key == request.condition.stream.key &&
        stored.condition.stream.counter_prefix == request.condition.stream.counter_prefix &&
        bits(stored.condition.correlation_length) == bits(request.condition.correlation_length) &&
        bits(stored.condition.mean) == bits(request.condition.mean) &&
        bits(stored.condition.amplitude) == bits(request.condition.amplitude) &&
        stored.tile == request.tile && stored.refinement == request.refinement && stored.positions.size() == count;
}

inline bool SameTerrainResidencyKey(const TerrainTileWorkingSet& stored,
    const TerrainTileRequest& request, std::size_t count) {
    return stored.layout == TerrainSampleLayout::row_prefix && SameTerrainResidencyField(stored, request, count);
}

// Budgets describe each immutable state's logical residency, not process memory
// retained by callers holding earlier states. Entries are least-to-most recent.
template<class Matches, class Realize>
inline TerrainResidencyState TerrainResidencyState::Update(
    const TerrainResidencyState* previous, std::size_t requested,
    std::size_t entry_budget, std::size_t resident_sample_budget, const Matches& matches, const Realize& realize
) {
    if (entry_budget > 65536) throw std::range_error("terrain residency entry budget must be from 0 to 65536");
    if (resident_sample_budget > 65536) throw std::range_error("terrain residency sample budget must be from 0 to 65536");
    if (entry_budget == 0 || requested > resident_sample_budget)
        throw std::range_error("terrain tile exceeds residency budget");
    const auto available = previous ? previous->entries.size() : 0;
    std::size_t exact = available;
    for (std::size_t index = 0; index < available; ++index)
        if (matches(*previous->entries[index])) { exact = index; break; }
    const bool hit = exact != available;
    std::size_t count = available - static_cast<std::size_t>(hit);
    std::size_t samples = previous ? previous->resident_samples - (hit ? requested : 0) : 0;
    std::size_t begin = 0;
    while (count + 1 > entry_budget || samples + requested > resident_sample_budget) {
        if (begin != exact) {
            samples -= previous->entries[begin]->positions.size();
            --count;
        }
        ++begin;
    }
    const auto active = hit ? previous->entries[exact] : realize();
    std::vector<std::shared_ptr<const TerrainTileWorkingSet>> entries;
    entries.reserve(count + 1);
    for (std::size_t index = begin; index < available; ++index)
        if (index != exact) entries.push_back(previous->entries[index]);
    entries.push_back(active);
    return {std::move(entries), active, hit, samples + requested};
}

inline TerrainResidencyState UpdateTerrainResidencyReference(
    const TerrainResidencyState* previous, const TerrainTileRequest& request,
    std::size_t entry_budget, std::size_t resident_sample_budget
) {
    const auto potential = ValidateTerrainTileRequestReference(request.condition, request.tile,
        request.refinement, request.sample_budget);
    const auto requested = static_cast<std::size_t>(std::min<std::uint64_t>(potential, request.sample_budget));
    return TerrainResidencyState::Update(previous, requested, entry_budget, resident_sample_budget,
        [&](const TerrainTileWorkingSet& stored) { return SameTerrainResidencyKey(stored, request, requested); },
        [&] { return RealizeTerrainTileReference(request.condition, request.tile, request.refinement, request.sample_budget); });
}

inline TerrainResidencyState UpdateTerrainSparseResidencyReference(
    const TerrainResidencyState* previous, const TerrainTileRequest& request, std::span<const std::uint64_t> demands,
    std::size_t entry_budget, std::size_t resident_sample_budget
) {
    ValidateTerrainSampleDemandReference(request.condition, request.tile, request.refinement, demands, request.sample_budget);
    const auto requested = std::min(demands.size(), request.sample_budget);
    return TerrainResidencyState::Update(previous, requested, entry_budget, resident_sample_budget,
        [&](const TerrainTileWorkingSet& stored) {
            return stored.layout == TerrainSampleLayout::indexed && SameTerrainResidencyField(stored, request, requested) &&
                std::equal(stored.sample_ids.begin(), stored.sample_ids.end(), demands.begin(), demands.begin() + requested);
        },
        [&] { return RealizeTerrainSampleDemandReference(request.condition, request.tile, request.refinement, demands, request.sample_budget); });
}

} // namespace vf::material
