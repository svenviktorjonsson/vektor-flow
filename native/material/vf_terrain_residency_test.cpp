#include "native/material/vf_terrain_residency.hpp"
#include "native/material/vf_terrain_normals.hpp"
#include <bit>
#include <iostream>
#include <limits>
#include <type_traits>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
bool same_positions(const vf::material::TerrainTileWorkingSet& a,
    const vf::material::TerrainTileWorkingSet& b) {
    if (a.positions.size() != b.positions.size()) return false;
    for (std::size_t i = 0; i < a.positions.size(); ++i)
        for (std::size_t axis = 0; axis < 3; ++axis)
            if (std::bit_cast<std::uint64_t>(a.positions[i][axis]) !=
                std::bit_cast<std::uint64_t>(b.positions[i][axis])) return false;
    return true;
}
template<class Function> void rejects(Function&& call, std::string_view message) {
    try { call(); } catch (const std::exception& error) {
        require(error.what() == message, "changed rejection diagnostic");
        return;
    }
    throw std::runtime_error("invalid input was accepted");
}
std::vector<char> trace;
void word(std::uint64_t value) {
    for (unsigned i = 0; i < 8; ++i) trace.push_back(static_cast<char>((value >> (i * 8)) & 255));
}
void capture(const vf::material::TerrainResidencyState& state) {
    word(state.hit); word(state.resident_samples); word(state.entries.size());
    for (const auto& entry : state.entries) {
        for (const auto value : entry->condition.stream.key) word(value);
        for (const auto value : entry->condition.stream.counter_prefix) word(value);
        for (const auto value : {entry->condition.correlation_length, entry->condition.mean, entry->condition.amplitude})
            word(std::bit_cast<std::uint64_t>(value));
        for (const auto value : entry->tile) word(static_cast<std::uint32_t>(value));
        word(entry->refinement); word(entry->potential_count); word(entry->truncated); word(entry->positions.size());
        for (const auto& position : entry->positions)
            for (const auto value : position) word(std::bit_cast<std::uint64_t>(value));
    }
}
}
int main(int argc, char** argv) try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    static_assert(!std::is_default_constructible_v<TerrainResidencyState>);
    static_assert(!std::is_copy_assignable_v<TerrainResidencyState>);
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 0.125, 0, 2};
    const TerrainTileRequest a{condition, {-1, 2}, 3, 81};
    const TerrainTileRequest b{condition, {0, 2}, 3, 81};
    const auto first = UpdateTerrainResidencyReference(nullptr, a, 1, 81);
    const auto next = UpdateTerrainResidencyReference(&first, b, 1, 81);
    const auto returned = UpdateTerrainResidencyReference(&next, a, 1, 81);
    require(!first.hit && !next.hit && !returned.hit, "evicted tile was reported as resident");
    require(first.entries.size() == 1 && next.entries.size() == 1 && returned.entries.size() == 1,
        "terrain residency exceeded the entry budget");
    require(first.resident_samples == 81 && next.resident_samples == 81 && returned.resident_samples == 81,
        "terrain residency exceeded the sample budget");
    require(first.active != returned.active && same_positions(*first.active, *returned.active),
        "evicted terrain did not regenerate byte-identically");
    const auto hit = UpdateTerrainResidencyReference(&returned, a, 1, 81);
    require(hit.hit && hit.active == returned.active, "exact resident terrain was regenerated");
    rejects([&] { UpdateTerrainResidencyReference(&hit, a, 65537, 81); },
        "terrain residency entry budget must be from 0 to 65536");
    rejects([&] { UpdateTerrainResidencyReference(&hit, a, 1, 65537); },
        "terrain residency sample budget must be from 0 to 65536");
    rejects([&] { UpdateTerrainResidencyReference(&hit, a, 0, 81); }, "terrain tile exceeds residency budget");
    rejects([&] { UpdateTerrainResidencyReference(&hit, a, 1, 80); }, "terrain tile exceeds residency budget");
    auto malformed = a;
    malformed.refinement = 17;
    rejects([&] { UpdateTerrainResidencyReference(&hit, malformed, 65537, 65537); }, "terrain refinement must be from 0 to 16");
    malformed = a; malformed.sample_budget = 65537;
    rejects([&] { UpdateTerrainResidencyReference(&hit, malformed, 0, 0); }, "terrain sample budget must be from 0 to 65536");
    malformed = a; malformed.condition.correlation_length = 0;
    rejects([&] { UpdateTerrainResidencyReference(&hit, malformed, 0, 0); }, "spatial correlation length must be finite and positive");
    malformed = a; malformed.condition.mean = std::numeric_limits<double>::quiet_NaN();
    rejects([&] { UpdateTerrainResidencyReference(&hit, malformed, 0, 0); }, "spatial correlation mean must be finite");
    require(hit.active == returned.active && hit.entries == returned.entries && hit.resident_samples == 81,
        "rejection mutated prior residency");
    const auto ab = UpdateTerrainResidencyReference(&first, b, 2, 162);
    require(ab.entries[0] == first.active && ab.entries[1] == ab.active, "insertion recency changed");
    const auto ba = UpdateTerrainResidencyReference(&ab, a, 2, 162);
    require(ba.hit && ba.entries[0] == ab.active && ba.entries[1] == first.active, "hit did not refresh recency");
    auto c = a; c.tile = {1, 2};
    const auto ac = UpdateTerrainResidencyReference(&ba, c, 2, 162);
    require(ac.entries[0] == first.active && ac.entries[1] == ac.active, "eviction did not remove least-recent tile");
    const auto shrunk = UpdateTerrainResidencyReference(&ac, a, 2, 81);
    require(shrunk.hit && shrunk.entries.size() == 1 && shrunk.active == first.active,
        "sample budget contraction evicted the requested hit");
    require(ab.entries[0] == first.active && ab.entries[1] == ab.active && ab.resident_samples == 162,
        "later update mutated a retained state");
    for (const auto* state : {&first, &next, &returned, &hit, &ab, &ba, &ac, &shrunk}) capture(*state);
    auto alias = a; alias.sample_budget = 65536;
    require(UpdateTerrainResidencyReference(&hit, alias, 1, 81).active == hit.active,
        "equivalent effective demand missed the resident identity");
    for (unsigned changed = 0; changed < 10; ++changed) {
        auto request = a;
        switch (changed) {
        case 0: ++request.condition.stream.key[0]; break;
        case 1: ++request.condition.stream.key[1]; break;
        case 2: ++request.condition.stream.counter_prefix[0]; break;
        case 3: ++request.condition.stream.counter_prefix[1]; break;
        case 4: request.condition.correlation_length = 0.25; break;
        case 5: request.condition.mean = 1; break;
        case 6: request.condition.amplitude = 1; break;
        case 7: request.tile[1] += 1; break;
        case 8: request.refinement = 4; break;
        case 9: request.sample_budget = 80; break;
        }
        const auto changed_state = UpdateTerrainResidencyReference(&hit, request, 2, 162);
        const auto oracle = RealizeTerrainTileReference(request.condition, request.tile, request.refinement, request.sample_budget);
        require(!changed_state.hit && changed_state.active != hit.active && same_positions(*changed_state.active, *oracle),
            "changed condition reused the wrong terrain");
        capture(changed_state);
    }
    auto zero_mean = a; zero_mean.condition.mean = -0.0;
    const auto signed_zero = UpdateTerrainResidencyReference(&hit, zero_mean, 2, 162);
    require(!signed_zero.hit && std::signbit(signed_zero.active->condition.mean), "signed-zero condition identity was lost");
    capture(signed_zero);
    auto zero_demand = a; zero_demand.sample_budget = 0;
    const auto zero = UpdateTerrainResidencyReference(nullptr, zero_demand, 65536, 0);
    require(zero.entries.size() == 1 && zero.entries.capacity() == 1 && zero.resident_samples == 0 &&
        zero.active->positions.capacity() == 0 && zero.active->truncated, "empty tiles allocated potential samples");
    capture(zero);
    auto maximum_request = a; maximum_request.refinement = 16; maximum_request.sample_budget = 65536;
    const auto maximum = UpdateTerrainResidencyReference(&ac, maximum_request, 65536, 65536);
    require(maximum.entries.size() == 1 && maximum.entries.capacity() == 1 && maximum.resident_samples == 65536 &&
        maximum.active->positions.size() == 65536 && maximum.active->potential_count == 4295098369ull,
        "maximum resident demand allocated potential terrain");
    const auto evicted_maximum = UpdateTerrainResidencyReference(&maximum, a, 1, 81);
    const auto regenerated_maximum = UpdateTerrainResidencyReference(&evicted_maximum, maximum_request, 1, 65536);
    require(same_positions(*maximum.active, *regenerated_maximum.active), "full resident tile regeneration changed bytes");
    capture(maximum);
    // Existing consumers retain and use the cache's source, not a second field.
    const auto normals = DeriveTerrainNormalsReference(returned.active, 0.015625);
    const auto materials = BindTerrainWaterLevelMaterialsReference(returned.active, 0.25, 101, 202);
    const auto surface = AssembleTerrainSurfacePacketReference(normals, materials);
    require(surface.source == returned.active && materials.source == returned.active && normals->source == returned.active,
        "downstream terrain consumers lost cache source ownership");
    const auto first_materials = BindTerrainWaterLevelMaterialsReference(first.active, 0.25, 101, 202);
    require(materials.material_ids == first_materials.material_ids, "cache regeneration changed material truth");
    std::weak_ptr<const TerrainTileWorkingSet> released;
    {
        auto owned = std::make_shared<const TerrainResidencyState>(UpdateTerrainResidencyReference(nullptr, a, 1, 81));
        released = owned->active;
        owned = std::make_shared<const TerrainResidencyState>(UpdateTerrainResidencyReference(owned.get(), b, 1, 81));
        require(released.expired(), "evicted tile remained owned after prior state was released");
    }
    for (const auto seed : {1u, 67u}) {
        std::shared_ptr<const TerrainResidencyState> state;
        std::vector<int> reference_recency;
        for (int step = 0; step < 64; ++step) {
            const int tile = (step * step + 3 * step) % 7;
            auto request = a;
            request.condition.stream.key[0] = seed;
            request.tile[0] = tile;
            const auto found = std::find(reference_recency.begin(), reference_recency.end(), tile);
            const bool expected_hit = found != reference_recency.end();
            if (expected_hit) reference_recency.erase(found);
            reference_recency.push_back(tile);
            const std::size_t limit = step % 5 == 0 ? 2 : 3;
            while (reference_recency.size() > limit) reference_recency.erase(reference_recency.begin());
            const auto updated = std::make_shared<const TerrainResidencyState>(
                UpdateTerrainResidencyReference(state.get(), request, 4, limit * 81));
            require(updated->hit == expected_hit && updated->entries.size() == reference_recency.size() &&
                updated->entries.capacity() == updated->entries.size() && updated->resident_samples == reference_recency.size() * 81,
                "trajectory diverged from explicit recency oracle");
            for (std::size_t index = 0; index < reference_recency.size(); ++index)
                require(updated->entries[index]->tile[0] == reference_recency[index], "trajectory evicted the wrong tile");
            const auto direct = RealizeTerrainTileReference(request.condition, request.tile, request.refinement, request.sample_budget);
            require(same_positions(*updated->active, *direct), "trajectory changed active terrain bytes");
            capture(*updated);
            state = updated;
        }
    }
    if (argc == 2 && std::string_view(argv[1]) == "--trace")
        std::cout.write(trace.data(), static_cast<std::streamsize>(trace.size()));
    else {
        require(argc == 1, "terrain residency test mode is invalid");
        std::cout << "terrain residency: replay=exact demand=bounded\n";
    }
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
