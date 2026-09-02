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
    if (!vf::ReleaseHostMessageContainsType(LR"({"type":"close"})", L"close") ||
        !vf::ReleaseHostMessageContainsType(LR"("{\"type\":\"close\"}")", L"close") ||
        vf::ReleaseHostMessageContainsType(LR"({"type":"restore"})", L"close")) {
        return Fail("host message type decoding mismatch");
    }
    if (!vf::ReleaseHostMessageIndicatesContentReady(
            LR"({"type":"layout","contentReady":true})") ||
        !vf::ReleaseHostMessageIndicatesContentReady(
            LR"("{\"type\":\"layout\",\"contentReady\":true}")") ||
        vf::ReleaseHostMessageIndicatesContentReady(
            LR"({"type":"layout","contentReady":false})") ||
        vf::ReleaseHostMessageIndicatesContentReady(
            LR"({"type":"vf_log","message":"contentReady true"})")) {
        return Fail("content-ready decoding mismatch");
    }
    bool always_on_top = false;
    if (!vf::ReleaseHostMessageTryWindowTopmost(
            LR"({"type":"vf-window-mode","always_ontop":true})",
            &always_on_top) ||
        !always_on_top ||
        !vf::ReleaseHostMessageTryWindowTopmost(
            LR"("{\"type\":\"vf-window-mode\",\"always_ontop\":false}")",
            &always_on_top) ||
        always_on_top ||
        vf::ReleaseHostMessageTryWindowTopmost(
            LR"({"type":"vf_log","always_ontop":true})",
            &always_on_top)) {
        return Fail("window-mode decoding mismatch");
    }

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
    if (!adapter.ApplyHitRegionAdapterMessage(
            LR"({"type":"vf_host_hit_regions_v1","data":""})")) {
        return Fail("empty hit-region arena rejected");
    }
    if (!adapter.HitRegions().empty() || adapter.IsInteractivePoint(10, 20)) {
        return Fail("empty hit-region arena did not clear retained regions");
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
