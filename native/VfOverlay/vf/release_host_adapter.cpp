#include "release_host_adapter.hpp"

#include <algorithm>
#include <charconv>
#include <cstring>
#include <limits>

namespace vf {
namespace {

constexpr std::wstring_view kHitRegionType = L"vf_host_hit_regions_v1";
constexpr std::size_t kMaxHitRegions = 4096u;
constexpr std::uint32_t kNoOffset = 0u;

std::uint32_t ReadU32(const std::byte* bytes, std::size_t offset) noexcept {
    std::uint32_t value = 0;
    std::memcpy(&value, bytes + offset, sizeof(value));
    return value;
}

void WriteU32(std::byte* bytes, std::size_t offset, std::uint32_t value) noexcept {
    std::memcpy(bytes + offset, &value, sizeof(value));
}

bool ExtractQuotedField(std::wstring_view message, std::wstring_view name, std::wstring_view* value) {
    const std::wstring needle = L"\"" + std::wstring(name) + L"\"";
    std::size_t cursor = message.find(needle);
    if (cursor == std::wstring_view::npos) return false;
    cursor = message.find(L':', cursor + needle.size());
    if (cursor == std::wstring_view::npos) return false;
    cursor = message.find(L'\"', cursor + 1u);
    if (cursor == std::wstring_view::npos) return false;
    const std::size_t begin = ++cursor;
    while (cursor < message.size() && message[cursor] != L'\"') {
        if (message[cursor] == L'\\') return false;
        ++cursor;
    }
    if (cursor >= message.size()) return false;
    *value = message.substr(begin, cursor - begin);
    return true;
}

bool ParseI32(std::wstring_view text, std::int32_t* value) {
    if (text.empty() || value == nullptr) return false;
    std::string narrow;
    narrow.reserve(text.size());
    for (const wchar_t ch : text) {
        if ((ch < L'0' || ch > L'9') && ch != L'-') return false;
        narrow.push_back(static_cast<char>(ch));
    }
    const char* begin = narrow.data();
    const char* end = begin + narrow.size();
    const auto result = std::from_chars(begin, end, *value);
    return result.ec == std::errc{} && result.ptr == end;
}

bool DecodeJsonString(std::wstring_view encoded, std::wstring* decoded) {
    if (decoded == nullptr) return false;
    while (!encoded.empty() &&
           (encoded.front() == L' ' || encoded.front() == L'\t' ||
            encoded.front() == L'\r' || encoded.front() == L'\n')) {
        encoded.remove_prefix(1u);
    }
    while (!encoded.empty() &&
           (encoded.back() == L' ' || encoded.back() == L'\t' ||
            encoded.back() == L'\r' || encoded.back() == L'\n')) {
        encoded.remove_suffix(1u);
    }
    if (encoded.size() < 2u || encoded.front() != L'"' || encoded.back() != L'"') {
        return false;
    }
    decoded->clear();
    decoded->reserve(encoded.size() - 2u);
    for (std::size_t index = 1u; index + 1u < encoded.size(); ++index) {
        wchar_t ch = encoded[index];
        if (ch != L'\\') {
            decoded->push_back(ch);
            continue;
        }
        if (++index + 1u >= encoded.size()) return false;
        switch (encoded[index]) {
        case L'"': decoded->push_back(L'"'); break;
        case L'\\': decoded->push_back(L'\\'); break;
        case L'/': decoded->push_back(L'/'); break;
        case L'b': decoded->push_back(L'\b'); break;
        case L'f': decoded->push_back(L'\f'); break;
        case L'n': decoded->push_back(L'\n'); break;
        case L'r': decoded->push_back(L'\r'); break;
        case L't': decoded->push_back(L'\t'); break;
        default: return false;
        }
    }
    return true;
}

}  // namespace

bool ReleaseHostMessageContainsType(
    std::wstring_view message,
    std::wstring_view expected_type) {
    std::wstring decoded;
    for (int depth = 0; depth < 2; ++depth) {
        std::wstring_view actual_type;
        if (ExtractQuotedField(message, L"type", &actual_type)) {
            return actual_type == expected_type;
        }
        if (!DecodeJsonString(message, &decoded)) return false;
        message = decoded;
    }
    return false;
}

bool ReleaseHostAdapter::ApplyHitRegionAdapterMessage(std::wstring_view message) {
    std::wstring_view type;
    std::wstring_view data;
    if (!ExtractQuotedField(message, L"type", &type) || type != kHitRegionType ||
        !ExtractQuotedField(message, L"data", &data)) {
        return false;
    }

    std::vector<ReleaseHostHitRect> parsed;
    std::size_t record_begin = 0;
    while (record_begin < data.size()) {
        if (parsed.size() >= kMaxHitRegions) return false;
        const std::size_t record_end = data.find(L';', record_begin);
        const std::wstring_view record = data.substr(
            record_begin,
            record_end == std::wstring_view::npos ? data.size() - record_begin : record_end - record_begin);
        std::int32_t values[4]{};
        std::size_t field_begin = 0;
        for (std::size_t index = 0; index < 4u; ++index) {
            const std::size_t field_end = record.find(L',', field_begin);
            if ((index < 3u && field_end == std::wstring_view::npos) ||
                (index == 3u && field_end != std::wstring_view::npos)) {
                return false;
            }
            const auto field = record.substr(
                field_begin,
                field_end == std::wstring_view::npos ? record.size() - field_begin : field_end - field_begin);
            if (!ParseI32(field, &values[index])) return false;
            field_begin = field_end == std::wstring_view::npos ? record.size() : field_end + 1u;
        }
        if (values[2] <= values[0] || values[3] <= values[1]) return false;
        parsed.push_back({values[0], values[1], values[2], values[3]});
        if (record_end == std::wstring_view::npos) break;
        record_begin = record_end + 1u;
    }
    hit_regions_ = std::move(parsed);
    return true;
}

bool ReleaseHostAdapter::IsInteractivePoint(std::int32_t x, std::int32_t y) const noexcept {
    return std::any_of(hit_regions_.begin(), hit_regions_.end(), [x, y](const auto& rect) {
        return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
    });
}

const std::vector<ReleaseHostHitRect>& ReleaseHostAdapter::HitRegions() const noexcept {
    return hit_regions_;
}

bool ReleaseHostAdapter::BindEventArena(std::byte* bytes, std::size_t size) noexcept {
    if (bytes == nullptr || size <= kEventArenaHeaderBytes ||
        size > static_cast<std::size_t>(std::numeric_limits<std::uint32_t>::max())) {
        return false;
    }
    event_arena_ = bytes;
    event_arena_size_ = size;
    std::memset(event_arena_, 0, event_arena_size_);
    WriteU32(event_arena_, 0u, kEventArenaMagic);
    WriteU32(event_arena_, 4u, kEventArenaVersion);
    WriteU32(event_arena_, 8u, static_cast<std::uint32_t>(size - kEventArenaHeaderBytes));
    WriteU32(event_arena_, 12u, kNoOffset);
    WriteU32(event_arena_, 16u, kNoOffset);
    WriteU32(event_arena_, 20u, 0u);
    return true;
}

bool ReleaseHostAdapter::PushOpaqueEvent(std::string_view bytes) noexcept {
    if (event_arena_ == nullptr || bytes.empty() ||
        bytes.size() > event_arena_size_ - kEventArenaHeaderBytes - sizeof(std::uint32_t)) {
        return false;
    }
    const std::uint32_t capacity = ReadU32(event_arena_, 8u);
    std::uint32_t write = ReadU32(event_arena_, 12u);
    const std::uint32_t read = ReadU32(event_arena_, 16u);
    const std::uint32_t needed = static_cast<std::uint32_t>(sizeof(std::uint32_t) + bytes.size());
    if (write > capacity || read > capacity || needed > capacity - write) {
        if (read != write) {
            WriteU32(event_arena_, 20u, ReadU32(event_arena_, 20u) + 1u);
            return false;
        }
        write = 0u;
        WriteU32(event_arena_, 16u, 0u);
    }
    std::byte* payload = event_arena_ + kEventArenaHeaderBytes + write;
    WriteU32(payload, 0u, static_cast<std::uint32_t>(bytes.size()));
    std::memcpy(payload + sizeof(std::uint32_t), bytes.data(), bytes.size());
    WriteU32(event_arena_, 12u, write + needed);
    return true;
}

bool ReleaseHostAdapter::TryPopOpaqueEvent(std::string* bytes) noexcept {
    if (event_arena_ == nullptr || bytes == nullptr) return false;
    const std::uint32_t capacity = ReadU32(event_arena_, 8u);
    const std::uint32_t write = ReadU32(event_arena_, 12u);
    std::uint32_t read = ReadU32(event_arena_, 16u);
    if (read == write) return false;
    if (read > capacity || write > capacity || read + sizeof(std::uint32_t) > write) return false;
    const std::byte* payload = event_arena_ + kEventArenaHeaderBytes + read;
    const std::uint32_t length = ReadU32(payload, 0u);
    if (length == 0u || length > write - read - sizeof(std::uint32_t)) return false;
    bytes->assign(reinterpret_cast<const char*>(payload + sizeof(std::uint32_t)), length);
    read += static_cast<std::uint32_t>(sizeof(std::uint32_t) + length);
    WriteU32(event_arena_, 16u, read);
    if (read == write) {
        WriteU32(event_arena_, 12u, 0u);
        WriteU32(event_arena_, 16u, 0u);
    }
    return true;
}

}  // namespace vf
