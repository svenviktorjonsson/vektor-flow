#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace vkf::stdout_format {

// These are the native result-plan and interpolation precision contracts,
// respectively (platform artifact writers and interpolation_numeric_format).
// Strings cross unchanged; this is VKF display output, not JSON serialization.
inline std::string number_text(double value, unsigned precision) {
    char buffer[64];
    const int length = std::snprintf(buffer, sizeof(buffer), precision == 15 ? "%.15g" : "%.17g", value);
    if (length < 0 || static_cast<std::size_t>(length) >= sizeof(buffer)) {
        throw std::runtime_error("VKF stdout number formatting failed");
    }
    return std::string(buffer, static_cast<std::size_t>(length));
}

class Reader {
    const std::uint8_t* memory_;
    std::size_t size_;

    void range(std::uint32_t pointer, std::size_t length) const {
        if (pointer > size_ || length > size_ - pointer || (!memory_ && length)) {
            throw std::runtime_error("VKF stdout value addressed invalid WASM memory");
        }
    }

    std::uint32_t u32(std::uint32_t pointer) const {
        range(pointer, 4);
        return static_cast<std::uint32_t>(memory_[pointer]) |
            (static_cast<std::uint32_t>(memory_[pointer + 1]) << 8) |
            (static_cast<std::uint32_t>(memory_[pointer + 2]) << 16) |
            (static_cast<std::uint32_t>(memory_[pointer + 3]) << 24);
    }

    double number(std::uint32_t pointer) const {
        range(pointer, 8);
        const std::uint64_t bits = static_cast<std::uint64_t>(u32(pointer)) |
            (static_cast<std::uint64_t>(u32(pointer + 4)) << 32);
        double value;
        static_assert(sizeof(value) == sizeof(bits));
        std::memcpy(&value, &bits, sizeof(value));
        return value;
    }

public:
    Reader(const std::uint8_t* memory, std::size_t size) : memory_(memory), size_(size) {}

    std::string value(std::uint32_t pointer, unsigned precision) const {
        struct Frame {
            std::uint32_t pointer;
            unsigned precision;
            bool opened = false;
            bool record = false;
            std::uint32_t length = 0;
            std::uint32_t payload = 0;
            std::uint32_t next = 0;
        };
        std::string output;
        std::vector<Frame> frames{{pointer, precision}};
        std::set<std::uint32_t> active;
        // Iterative traversal cannot exhaust the C++ call stack on nested values.
        while (!frames.empty()) {
            auto& frame = frames.back();
            if (frame.opened) {
                if (frame.next == frame.length) {
                    output += frame.record ? ')' : ']';
                    active.erase(frame.pointer);
                    frames.pop_back();
                    continue;
                }
                if (frame.next != 0) output += ", ";
                if (frame.record) {
                    const auto entry = frame.payload + 8 * frame.next++;
                    const auto key = u32(entry);
                    range(key, 16);
                    if (u32(key) != 3) {
                        throw std::runtime_error("VKF stdout record keys must be strings");
                    }
                    const auto key_length = u32(key + 4);
                    const auto key_payload = u32(key + 8);
                    range(key_payload, key_length);
                    if (key_length) {
                        output.append(
                            reinterpret_cast<const char*>(memory_ + key_payload),
                            key_length
                        );
                    }
                    output += ':';
                    frames.push_back({u32(entry + 4), 15});
                    continue;
                }
                const auto child = u32(frame.payload + 4 * frame.next++);
                frames.push_back({child, 15});
                continue;
            }
            range(frame.pointer, 16);
            const auto tag = u32(frame.pointer);
            const auto length = u32(frame.pointer + 4);
            const auto payload = u32(frame.pointer + 8);
            switch (tag) {
                case 0: output += "null"; break;
                case 1: output += payload ? "true" : "false"; break;
                case 2: output += number_text(number(frame.pointer + 8), frame.precision); break;
                case 3:
                    range(payload, length);
                    if (length) output.append(reinterpret_cast<const char*>(memory_ + payload), length);
                    break;
                case 4:
                    if (!active.insert(frame.pointer).second) {
                        throw std::runtime_error("cyclic VKF values cannot cross the stdout ABI");
                    }
                    if (length > (size_ / 4)) {
                        throw std::runtime_error("VKF stdout value addressed invalid WASM memory");
                    }
                    range(payload, static_cast<std::size_t>(length) * 4);
                    frame.opened = true;
                    frame.length = length;
                    frame.payload = payload;
                    output += '[';
                    continue;
                case 5:
                    if (!active.insert(frame.pointer).second) {
                        throw std::runtime_error("cyclic VKF values cannot cross the stdout ABI");
                    }
                    if (length > (size_ / 8)) {
                        throw std::runtime_error("VKF stdout value addressed invalid WASM memory");
                    }
                    range(payload, static_cast<std::size_t>(length) * 8);
                    frame.opened = true;
                    frame.record = true;
                    frame.length = length;
                    frame.payload = payload;
                    output += '(';
                    continue;
                default:
                    throw std::runtime_error("unknown VKF stdout value tag " + std::to_string(tag));
            }
            frames.pop_back();
        }
        return output;
    }

    std::string console(std::uint32_t pointer, bool ordered) const {
        range(pointer, 16);
        if (u32(pointer) != 4) throw std::runtime_error("VKF console output must be an array of values");
        const auto length = u32(pointer + 4);
        const auto payload = u32(pointer + 8);
        if (length > size_ / 4) throw std::runtime_error("VKF stdout value addressed invalid WASM memory");
        range(payload, static_cast<std::size_t>(length) * 4);
        std::string output;
        for (std::uint32_t index = 0; index < length; ++index) {
            output += value(u32(payload + index * 4), ordered ? 15 : 17);
            output += '\n';
        }
        return output;
    }
};

inline std::string format_value(const std::uint8_t* memory, std::size_t size,
                                std::uint32_t pointer, bool ordered = false) {
    return Reader(memory, size).value(pointer, ordered ? 15 : 17);
}

inline std::string format_console(const std::uint8_t* memory, std::size_t size,
                                  std::uint32_t pointer, bool ordered = false) {
    return Reader(memory, size).console(pointer, ordered);
}

} // namespace vkf::stdout_format
