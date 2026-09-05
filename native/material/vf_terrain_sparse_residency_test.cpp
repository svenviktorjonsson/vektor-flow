#include "native/material/vf_terrain_residency.hpp"
#include "native/material/vf_terrain_waterline.hpp"
#include <iostream>
#include <limits>
#include <numeric>
#include <string_view>
#include <type_traits>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
bool identical(const vf::material::TerrainTileWorkingSet& a, const vf::material::TerrainTileWorkingSet& b) {
    if (a.sample_ids != b.sample_ids || a.positions.size() != b.positions.size()) return false;
    for (std::size_t i = 0; i < a.positions.size(); ++i)
        for (std::size_t axis = 0; axis < 3; ++axis)
            if (std::bit_cast<std::uint64_t>(a.positions[i][axis]) != std::bit_cast<std::uint64_t>(b.positions[i][axis])) return false;
    return true;
}
template<class Function> void rejects(Function&& call, std::string_view message) {
    try { call(); } catch (const std::exception& error) {
        require(error.what() == message, "changed sparse residency diagnostic");
        return;
    }
    throw std::runtime_error("invalid sparse residency input was accepted");
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
        word(entry->refinement); word(entry->potential_count); word(entry->truncated);
        word(static_cast<std::uint8_t>(entry->layout)); word(entry->positions.size());
        for (const auto& position : entry->positions)
            for (const auto value : position) word(std::bit_cast<std::uint64_t>(value));
        word(entry->sample_ids.size());
        for (const auto id : entry->sample_ids) word(id);
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
    const TerrainTileRequest a{condition, {-1, 2}, 16, 4}, b{condition, {0, 2}, 16, 4};
    constexpr std::uint64_t width = 65537, corner = 60000 * width + 50000;
    const std::array<std::uint64_t, 4> ids{corner + width + 1, corner, corner + width, corner + 1};
    const auto first = UpdateTerrainSparseResidencyReference(nullptr, a, ids, 1, 4);
    const auto next = UpdateTerrainSparseResidencyReference(&first, b, ids, 1, 4);
    const auto returned = UpdateTerrainSparseResidencyReference(&next, a, ids, 1, 4);
    const auto hit = UpdateTerrainSparseResidencyReference(&returned, a, ids, 1, 4);
    require(!first.hit && !next.hit && !returned.hit && hit.hit && hit.active == returned.active,
        "sparse eviction or pointer hit identity is incorrect");
    require(first.active != returned.active && identical(*first.active, *returned.active) &&
        returned.active->sample_ids == std::vector<std::uint64_t>(ids.begin(), ids.end()),
        "sparse regeneration did not retain exact ordered IDs and position bytes");
    require(first.entries.size() == 1 && next.entries.size() == 1 && returned.entries.size() == 1 &&
        first.resident_samples == 4 && next.resident_samples == 4 && returned.resident_samples == 4,
        "sparse residency exceeded its logical budgets");
    for (const auto* state : {&first, &next, &returned, &hit}) capture(*state);
    auto reordered = ids;
    std::reverse(reordered.begin(), reordered.end());
    const auto order_miss = UpdateTerrainSparseResidencyReference(&hit, a, reordered, 2, 8);
    require(!order_miss.hit && order_miss.active->sample_ids == std::vector<std::uint64_t>(reordered.begin(), reordered.end()),
        "reordered sample identity aliased the prior source");
    const auto order_hit = UpdateTerrainSparseResidencyReference(&order_miss, a, ids, 2, 8);
    require(order_hit.hit && order_hit.active == hit.active && order_hit.entries.front() == order_miss.active,
        "ordered hit did not preserve pointer and refresh recency");
    capture(order_miss); capture(order_hit);
    std::vector<std::uint64_t> suffix(ids.begin(), ids.end());
    suffix.push_back(4295098369ull); suffix.push_back(ids[0]);
    require(UpdateTerrainSparseResidencyReference(&hit, a, suffix, 1, 4).active == hit.active,
        "unselected suffix altered sparse cache identity");
    auto equivalent = a; equivalent.sample_budget = 65536;
    require(UpdateTerrainSparseResidencyReference(&hit, equivalent, ids, 1, 4).active == hit.active,
        "equivalent selected demand missed");
    const std::array<std::uint64_t, 4> prefix_ids{0, 1, 2, 3};
    const auto prefix = UpdateTerrainResidencyReference(nullptr, a, 2, 8);
    const auto mixed = UpdateTerrainSparseResidencyReference(&prefix, a, prefix_ids, 2, 8);
    require(!mixed.hit && mixed.active != prefix.active && mixed.entries.front() == prefix.active &&
        mixed.active->positions == prefix.active->positions, "equal prefix/indexed bytes aliased cache identity");
    const auto mixed_hit = UpdateTerrainResidencyReference(&mixed, a, 2, 8);
    require(mixed_hit.hit && mixed_hit.active == prefix.active && mixed_hit.entries.front() == mixed.active,
        "prefix update lost its identity among indexed entries");
    capture(prefix); capture(mixed); capture(mixed_hit);
    auto malformed = a; malformed.refinement = 17;
    rejects([&] { UpdateTerrainSparseResidencyReference(&hit, malformed, ids, 65537, 65537); },
        "terrain refinement must be from 0 to 16");
    malformed = a; malformed.sample_budget = 65537;
    rejects([&] { UpdateTerrainSparseResidencyReference(&hit, malformed, ids, 0, 0); },
        "terrain sample budget must be from 0 to 65536");
    malformed = a; malformed.condition.correlation_length = 0;
    rejects([&] { UpdateTerrainSparseResidencyReference(&hit, malformed, ids, 0, 0); },
        "spatial correlation length must be finite and positive");
    malformed = a; malformed.condition.mean = std::numeric_limits<double>::quiet_NaN();
    rejects([&] { UpdateTerrainSparseResidencyReference(&hit, malformed, ids, 0, 0); },
        "spatial correlation mean must be finite");
    const std::vector<std::uint64_t> oversized(65537, 0);
    rejects([&] { UpdateTerrainSparseResidencyReference(&hit, a, oversized, 65537, 65537); },
        "terrain sample demand must contain at most 65536 entries");
    const std::array<std::uint64_t, 3> duplicate{ids[0], ids[0], 4295098369ull};
    rejects([&] { UpdateTerrainSparseResidencyReference(&hit, a, duplicate, 65537, 65537); },
        "terrain sample demand is duplicated");
    const std::array<std::uint64_t, 3> outside{4295098369ull, ids[0], ids[0]};
    rejects([&] { UpdateTerrainSparseResidencyReference(&hit, a, outside, 65537, 65537); },
        "terrain sample demand exceeds tile domain");
    rejects([&] { UpdateTerrainSparseResidencyReference(&hit, a, ids, 65537, 65537); },
        "terrain residency entry budget must be from 0 to 65536");
    rejects([&] { UpdateTerrainSparseResidencyReference(&hit, a, ids, 1, 65537); },
        "terrain residency sample budget must be from 0 to 65536");
    for (const auto caps : {std::array<std::size_t, 2>{0, 4}, {1, 3}})
        rejects([&] { UpdateTerrainSparseResidencyReference(&hit, a, ids, caps[0], caps[1]); }, "terrain tile exceeds residency budget");
    require(hit.active == returned.active && hit.entries == returned.entries && hit.resident_samples == 4,
        "rejection mutated earlier residency");
    const auto contracted = UpdateTerrainSparseResidencyReference(&order_hit, a, reordered, 2, 4);
    require(contracted.hit && contracted.active == order_miss.active && contracted.entries.size() == 1 &&
        contracted.entries.capacity() == 1, "contraction discarded requested hit or overallocated");
    capture(contracted);
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
        case 7: ++request.tile[1]; break;
        case 8: request.condition.mean = -0.0; break;
        case 9: request.sample_budget = 3; break;
        }
        const auto state = UpdateTerrainSparseResidencyReference(&hit, request, ids, 2, 8);
        const auto direct = RealizeTerrainSampleDemandReference(request.condition, request.tile, request.refinement, ids, request.sample_budget);
        require(!state.hit && identical(*state.active, *direct), "changed sparse condition reused the wrong identity");
        capture(state);
    }
    const auto small = UpdateTerrainSparseResidencyReference(nullptr, a, prefix_ids, 2, 8);
    auto refinement = a; refinement.refinement = 3;
    require(!UpdateTerrainSparseResidencyReference(&small, refinement, prefix_ids, 2, 8).hit,
        "changed refinement aliased sparse source");
    auto empty_request = a; empty_request.sample_budget = 0;
    const auto empty = UpdateTerrainSparseResidencyReference(nullptr, empty_request, outside, 1, 0);
    require(empty.resident_samples == 0 && empty.entries.size() == 1 && empty.entries.capacity() == 1 &&
        empty.active->positions.capacity() == 0 && empty.active->sample_ids.capacity() == 0,
        "zero sparse demand allocated potential buffers");
    require(UpdateTerrainSparseResidencyReference(&empty, empty_request, ids, 1, 0).active == empty.active,
        "empty selected demands changed identity");
    capture(empty);
    auto full_request = a; full_request.sample_budget = 65536;
    std::vector<std::uint64_t> full_ids(65536);
    for (std::size_t i = 0; i < full_ids.size(); ++i) full_ids[i] = (65536ull - i) * 65538;
    const auto maximum = UpdateTerrainSparseResidencyReference(&hit, full_request, full_ids, 65536, 65536);
    require(maximum.entries.size() == 1 && maximum.entries.capacity() == 1 && maximum.resident_samples == 65536 &&
        maximum.active->positions.capacity() == 65536 && maximum.active->sample_ids.capacity() == 65536 &&
        maximum.active->sample_ids.front() == 4295098368ull, "full sparse cache allocated potential grid or truncated IDs");
    const auto evicted = UpdateTerrainSparseResidencyReference(&maximum, a, ids, 1, 4);
    const auto regenerated = UpdateTerrainSparseResidencyReference(&evicted, full_request, full_ids, 1, 65536);
    require(!regenerated.hit && identical(*maximum.active, *regenerated.active), "full sparse regeneration changed bytes");
    capture(maximum);
    std::weak_ptr<const TerrainTileWorkingSet> released;
    {
        auto owned = std::make_shared<const TerrainResidencyState>(UpdateTerrainSparseResidencyReference(nullptr, a, ids, 1, 4));
        released = owned->active;
        owned = std::make_shared<const TerrainResidencyState>(UpdateTerrainSparseResidencyReference(owned.get(), b, ids, 1, 4));
        require(released.expired(), "evicted sparse source stayed owned after old state release");
    }
    const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(returned.active, 1.0 / 1024),
        BindTerrainWaterLevelMaterialsReference(returned.active, 0.25, 101, 202)));
    const std::array<std::uint64_t, 1> cells{60000ull * 65536 + 50000};
    const auto mesh = std::make_shared<const TerrainTriangulation>(TriangulateTerrainAddressedCellsReference(surface, cells, 1, 2));
    const auto waterline = ExtractTerrainWaterlineReference(mesh, 2);
    require(mesh->triangles == std::vector<std::array<std::uint32_t, 3>>{{1, 2, 3}, {3, 2, 0}} &&
        waterline.source->source->source == returned.active, "direct topology consumer lost sparse cache truth");
    for (const auto seed : {1u, 67u}) {
        std::shared_ptr<const TerrainResidencyState> state;
        std::vector<std::array<int, 2>> recency;
        for (int step = 0; step < 64; ++step) {
            const std::array<int, 2> key{(step * step + 3 * step) % 7, (step / 3) % 2};
            auto request = a; request.tile[0] = key[0]; request.condition.stream.key[0] = seed;
            const auto& demand = key[1] ? reordered : ids;
            const auto found = std::find(recency.begin(), recency.end(), key);
            const bool expected_hit = found != recency.end();
            if (expected_hit) recency.erase(found);
            recency.push_back(key);
            const std::size_t limit = step % 5 == 0 ? 2 : 3;
            while (recency.size() > limit) recency.erase(recency.begin());
            const auto updated = std::make_shared<const TerrainResidencyState>(
                UpdateTerrainSparseResidencyReference(state.get(), request, demand, 4, limit * 4));
            require(updated->hit == expected_hit && updated->entries.size() == recency.size() &&
                updated->entries.capacity() == recency.size() && updated->resident_samples == recency.size() * 4,
                "sparse trajectory diverged from recency oracle");
            for (std::size_t index = 0; index < recency.size(); ++index) {
                const auto& expected_ids = recency[index][1] ? reordered : ids;
                require(updated->entries[index]->tile[0] == recency[index][0] &&
                    std::equal(expected_ids.begin(), expected_ids.end(), updated->entries[index]->sample_ids.begin()),
                    "sparse trajectory evicted the wrong ordered identity");
            }
            const auto direct = RealizeTerrainSampleDemandReference(request.condition, request.tile, request.refinement, demand, 4);
            require(identical(*updated->active, *direct), "sparse trajectory changed generated bytes");
            capture(*updated);
            state = updated;
        }
    }
    if (argc == 2 && std::string_view(argv[1]) == "--trace")
        std::cout.write(trace.data(), static_cast<std::streamsize>(trace.size()));
    else {
        require(argc == 1, "sparse residency test mode is invalid");
        std::cout << "sparse terrain residency: replay=exact demand=ordered\n";
    }
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
