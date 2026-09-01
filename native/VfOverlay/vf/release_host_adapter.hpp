#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace vf {

bool ReleaseHostMessageContainsType(
    std::wstring_view message,
    std::wstring_view type);

struct ReleaseHostHitRect {
    std::int32_t left = 0;
    std::int32_t top = 0;
    std::int32_t right = 0;
    std::int32_t bottom = 0;
};

class ReleaseHostAdapter final {
public:
    static constexpr std::uint32_t kEventArenaMagic = 0x56464541u;
    static constexpr std::uint32_t kEventArenaVersion = 1u;
    static constexpr std::size_t kEventArenaHeaderBytes = 24u;

    bool ApplyHitRegionAdapterMessage(std::wstring_view message);
    bool IsInteractivePoint(std::int32_t x, std::int32_t y) const noexcept;
    const std::vector<ReleaseHostHitRect>& HitRegions() const noexcept;

    bool BindEventArena(std::byte* bytes, std::size_t size) noexcept;
    bool PushOpaqueEvent(std::string_view bytes) noexcept;
    bool TryPopOpaqueEvent(std::string* bytes) noexcept;

private:
    std::vector<ReleaseHostHitRect> hit_regions_;
    std::byte* event_arena_ = nullptr;
    std::size_t event_arena_size_ = 0;
};

}  // namespace vf
