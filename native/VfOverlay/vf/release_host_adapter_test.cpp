#include "release_host_adapter.hpp"

#include <array>
#include <cstddef>
#include <iostream>
#include <string>

namespace {

int Fail(const char* message) {
    std::cerr << message << '\n';
    return 1;
}

}  // namespace

int main() {
    vf::ReleaseHostAdapter adapter;
    if (!adapter.ApplyHitRegionAdapterMessage(
            LR"({"type":"vf_host_hit_regions_v1","data":"10,20,30,40;100,200,160,260"})")) {
        return Fail("valid hit-region arena rejected");
    }
    if (!adapter.IsInteractivePoint(10, 20) || !adapter.IsInteractivePoint(159, 259) ||
        adapter.IsInteractivePoint(9, 20) || adapter.IsInteractivePoint(30, 40) ||
        adapter.IsInteractivePoint(99, 199)) {
        return Fail("half-open hit-region behavior mismatch");
    }
    if (adapter.ApplyHitRegionAdapterMessage(
            LR"({"type":"vf_host_hit_regions_v1","data":"10,20,9,40"})")) {
        return Fail("invalid hit-region arena accepted");
    }
    if (!adapter.IsInteractivePoint(10, 20)) {
        return Fail("rejected arena partially mutated retained regions");
    }

    std::array<std::byte, 512> arena{};
    if (!adapter.BindEventArena(arena.data(), arena.size())) {
        return Fail("event arena bind failed");
    }
    const std::string first = R"({"type":"vf_event","event":"first"})";
    const std::string second = R"({"type":"vf_event","event":"second"})";
    if (!adapter.PushOpaqueEvent(first) || !adapter.PushOpaqueEvent(second)) {
        return Fail("opaque event enqueue failed");
    }
    std::string received;
    if (!adapter.TryPopOpaqueEvent(&received) || received != first ||
        !adapter.TryPopOpaqueEvent(&received) || received != second ||
        adapter.TryPopOpaqueEvent(&received)) {
        return Fail("opaque event FIFO mismatch");
    }
    std::cout << "release host adapter tests passed\n";
    return 0;
}
