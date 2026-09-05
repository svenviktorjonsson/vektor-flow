#pragma once

#include <bit>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vf::material {

inline void AppendDeterministicPacketWord32(
    std::vector<std::uint8_t>& bytes,
    std::uint32_t word
) {
    for (std::size_t offset = 0; offset < sizeof(word); ++offset) {
        bytes.push_back(static_cast<std::uint8_t>(
            (word >> (offset * 8)) & 0xffu
        ));
    }
}

inline void AppendDeterministicPacketWord64(
    std::vector<std::uint8_t>& bytes,
    std::uint64_t word
) {
    for (std::size_t offset = 0; offset < sizeof(word); ++offset) {
        bytes.push_back(static_cast<std::uint8_t>(
            (word >> (offset * 8)) & 0xffu
        ));
    }
}

inline void AppendDeterministicPacketFloat32(
    std::vector<std::uint8_t>& bytes,
    float value
) {
    static_assert(sizeof(float) == sizeof(std::uint32_t));
    AppendDeterministicPacketWord32(
        bytes,
        std::bit_cast<std::uint32_t>(value)
    );
}

inline std::uint64_t HashDeterministicPacketBytes(
    const std::vector<std::uint8_t>& bytes
) {
    std::uint64_t hash = 1469598103934665603ull;
    for (const std::uint8_t byte : bytes) {
        hash ^= byte;
        hash *= 1099511628211ull;
    }
    return hash;
}

inline std::size_t CountDeterministicPacketRecordChanges(
    const std::vector<std::uint8_t>& previous,
    const std::vector<std::uint8_t>& current,
    std::size_t record_bytes
) {
    if (record_bytes == 0 ||
        previous.size() % record_bytes != 0 ||
        current.size() % record_bytes != 0) {
        throw std::invalid_argument(
            "deterministic packet record layout is invalid"
        );
    }
    const std::size_t previous_records = previous.size() / record_bytes;
    const std::size_t current_records = current.size() / record_bytes;
    const std::size_t shared_records =
        previous_records < current_records
        ? previous_records
        : current_records;
    std::size_t changed = current_records - shared_records;
    for (std::size_t record = 0; record < shared_records; ++record) {
        const std::size_t offset = record * record_bytes;
        bool same = true;
        for (std::size_t byte = 0; byte < record_bytes; ++byte) {
            same = same && previous[offset + byte] == current[offset + byte];
        }
        changed += static_cast<std::size_t>(!same);
    }
    return changed;
}

}  // namespace vf::material
