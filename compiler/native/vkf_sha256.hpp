#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace vkf::crypto {

inline std::array<std::uint8_t, 32> sha256(const std::uint8_t* data, std::size_t size) {
    static constexpr std::uint32_t k[64] = {
        0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
        0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
        0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
        0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
        0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
        0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
        0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
        0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
    };
    auto rotate = [](std::uint32_t value, unsigned bits) {
        return (value >> bits) | (value << (32 - bits));
    };
    std::array<std::uint32_t, 8> hash = {
        0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
        0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u,
    };
    std::vector<std::uint8_t> message(data, data + size);
    message.push_back(0x80u);
    while ((message.size() % 64) != 56) message.push_back(0);
    const std::uint64_t bit_size = static_cast<std::uint64_t>(size) * 8;
    for (int shift = 56; shift >= 0; shift -= 8) message.push_back(static_cast<std::uint8_t>(bit_size >> shift));

    for (std::size_t block = 0; block < message.size(); block += 64) {
        std::uint32_t w[64]{};
        for (unsigned index = 0; index < 16; ++index) {
            const auto offset = block + index * 4;
            w[index] = (static_cast<std::uint32_t>(message[offset]) << 24)
                | (static_cast<std::uint32_t>(message[offset + 1]) << 16)
                | (static_cast<std::uint32_t>(message[offset + 2]) << 8)
                | static_cast<std::uint32_t>(message[offset + 3]);
        }
        for (unsigned index = 16; index < 64; ++index) {
            const auto s0 = rotate(w[index - 15], 7) ^ rotate(w[index - 15], 18) ^ (w[index - 15] >> 3);
            const auto s1 = rotate(w[index - 2], 17) ^ rotate(w[index - 2], 19) ^ (w[index - 2] >> 10);
            w[index] = w[index - 16] + s0 + w[index - 7] + s1;
        }
        auto a = hash[0]; auto b = hash[1]; auto c = hash[2]; auto d = hash[3];
        auto e = hash[4]; auto f = hash[5]; auto g = hash[6]; auto h = hash[7];
        for (unsigned index = 0; index < 64; ++index) {
            const auto s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const auto choice = (e & f) ^ (~e & g);
            const auto temp1 = h + s1 + choice + k[index] + w[index];
            const auto s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const auto majority = (a & b) ^ (a & c) ^ (b & c);
            const auto temp2 = s0 + majority;
            h = g; g = f; f = e; e = d + temp1;
            d = c; c = b; b = a; a = temp1 + temp2;
        }
        hash[0] += a; hash[1] += b; hash[2] += c; hash[3] += d;
        hash[4] += e; hash[5] += f; hash[6] += g; hash[7] += h;
    }

    std::array<std::uint8_t, 32> digest{};
    for (unsigned index = 0; index < 8; ++index) {
        digest[index * 4] = static_cast<std::uint8_t>(hash[index] >> 24);
        digest[index * 4 + 1] = static_cast<std::uint8_t>(hash[index] >> 16);
        digest[index * 4 + 2] = static_cast<std::uint8_t>(hash[index] >> 8);
        digest[index * 4 + 3] = static_cast<std::uint8_t>(hash[index]);
    }
    return digest;
}

inline std::array<std::uint8_t, 32> sha256(const std::vector<std::uint8_t>& data) {
    return sha256(data.data(), data.size());
}

}  // namespace vkf::crypto
