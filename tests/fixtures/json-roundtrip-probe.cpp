#include "native/VfOverlay/vf/json.hpp"
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

int main() {
    std::vector<double> values{0.010000000000000002, 0.0, -0.0,
        std::numeric_limits<double>::denorm_min(),
        std::numeric_limits<double>::min(),
        std::numeric_limits<double>::max()};
    // Deterministic mantissas in every finite binary64 exponent band.
    std::uint64_t state = 0x123456789abcdefULL;
    for (std::uint64_t exponent = 0; exponent < 2047; ++exponent) {
        for (unsigned sample = 0; sample < 8; ++sample) {
            state ^= state << 13; state ^= state >> 7; state ^= state << 17;
            const auto bits = (state & 0x800fffffffffffffULL) | (exponent << 52);
            double value;
            std::memcpy(&value, &bits, sizeof(value));
            values.push_back(value);
        }
    }
    for (const auto value : values) {
        const auto text = vf::json_stringify(vf::JsonValue(value), -1);
        const auto restored = vf::parse_json(text).as_number();
        std::uint64_t before, after;
        std::memcpy(&before, &value, sizeof(before));
        std::memcpy(&after, &restored, sizeof(after));
        if (before != after) {
            std::cerr << "JSON changed binary64 bits: " << std::hex << before
                << " -> " << after << " via " << text << '\n';
            return 1;
        }
    }
    for (const auto text : {"1e9999", "-1e9999", "1e-9999", "-1e-9999", "1.0x", "01"}) {
        bool rejected = false;
        try { (void)vf::parse_json(text); }
        catch (const std::runtime_error&) { rejected = true; }
        if (!rejected) { std::cerr << "Invalid number accepted: " << text << '\n'; return 1; }
    }
    for (const auto value : {std::numeric_limits<double>::infinity(),
             -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
        bool rejected = false;
        try { (void)vf::json_stringify(vf::JsonValue(value), -1); }
        catch (const std::runtime_error& error) {
            rejected = std::string(error.what()) == "cannot stringify non-finite json number";
        }
        if (!rejected) { std::cerr << "Nonfinite output did not retain its diagnostic\n"; return 1; }
    }
    std::cout << values.size() << " exact binary64 round trips; invalid-number regressions pass\n";
}
