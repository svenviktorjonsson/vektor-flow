#pragma once

#include <array>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace vkf::physical {

// SI base-dimension order: length, mass, time, current, temperature,
// amount, luminous intensity. Unit systems change scale, never dimension.
struct Dimension {
    std::array<int, 7> exponents{};

    friend bool operator==(const Dimension& left, const Dimension& right) {
        return left.exponents == right.exponents;
    }
    friend bool operator!=(const Dimension& left, const Dimension& right) {
        return !(left == right);
    }
};

struct UnitDescriptor {
    std::string catalog;
    std::string symbol;
    double scale;
    Dimension dimension;
};

struct UnitBase {
    std::string_view symbol;
    double scale;
    Dimension dimension;
    bool prefixable = true;
};

struct Prefix {
    std::string_view symbol;
    double scale;
};

inline constexpr Dimension length{{1, 0, 0, 0, 0, 0, 0}};
inline constexpr Dimension mass{{0, 1, 0, 0, 0, 0, 0}};
inline constexpr Dimension time{{0, 0, 1, 0, 0, 0, 0}};
inline constexpr Dimension current{{0, 0, 0, 1, 0, 0, 0}};
inline constexpr Dimension temperature{{0, 0, 0, 0, 1, 0, 0}};
inline constexpr Dimension amount{{0, 0, 0, 0, 0, 1, 0}};
inline constexpr Dimension luminous_intensity{{0, 0, 0, 0, 0, 0, 1}};
inline constexpr Dimension dimensionless{{0, 0, 0, 0, 0, 0, 0}};

// Prefixes attach to gram, not kilogram; kg remains the coherent mass unit.
// Derived dimensions follow the SI Brochure's seven-base-dimension model.
inline constexpr std::array<UnitBase, 28> si_units{{
    {"m", 1.0, length},
    {"s", 1.0, time},
    {"g", 1e-3, mass},
    {"A", 1.0, current},
    {"K", 1.0, temperature},
    {"mol", 1.0, amount},
    {"cd", 1.0, luminous_intensity},
    {"rad", 1.0, dimensionless},
    {"sr", 1.0, dimensionless},
    {"Hz", 1.0, {{0, 0, -1, 0, 0, 0, 0}}},
    {"N", 1.0, {{1, 1, -2, 0, 0, 0, 0}}},
    {"Pa", 1.0, {{-1, 1, -2, 0, 0, 0, 0}}},
    {"J", 1.0, {{2, 1, -2, 0, 0, 0, 0}}},
    {"W", 1.0, {{2, 1, -3, 0, 0, 0, 0}}},
    {"C", 1.0, {{0, 0, 1, 1, 0, 0, 0}}},
    {"V", 1.0, {{2, 1, -3, -1, 0, 0, 0}}},
    {"F", 1.0, {{-2, -1, 4, 2, 0, 0, 0}}},
    {"ohm", 1.0, {{2, 1, -3, -2, 0, 0, 0}}},
    {"S", 1.0, {{-2, -1, 3, 2, 0, 0, 0}}},
    {"Wb", 1.0, {{2, 1, -2, -1, 0, 0, 0}}},
    {"T", 1.0, {{0, 1, -2, -1, 0, 0, 0}}},
    {"H", 1.0, {{2, 1, -2, -2, 0, 0, 0}}},
    {"lm", 1.0, luminous_intensity},
    {"lx", 1.0, {{-2, 0, 0, 0, 0, 0, 1}}},
    {"Bq", 1.0, {{0, 0, -1, 0, 0, 0, 0}}},
    {"Gy", 1.0, {{2, 0, -2, 0, 0, 0, 0}}},
    {"Sv", 1.0, {{2, 0, -2, 0, 0, 0, 0}}},
    {"kat", 1.0, {{0, 0, -1, 0, 0, 1, 0}}},
}};

inline constexpr std::array<Prefix, 25> si_prefixes{{
    {"q", 1e-30}, {"r", 1e-27}, {"y", 1e-24}, {"z", 1e-21},
    {"a", 1e-18}, {"f", 1e-15}, {"p", 1e-12}, {"n", 1e-9},
    {"u", 1e-6}, {"micro", 1e-6}, {"m", 1e-3}, {"c", 1e-2}, {"d", 1e-1},
    {"da", 1e1}, {"h", 1e2}, {"k", 1e3}, {"M", 1e6},
    {"G", 1e9}, {"T", 1e12}, {"P", 1e15}, {"E", 1e18},
    {"Z", 1e21}, {"Y", 1e24}, {"R", 1e27}, {"Q", 1e30},
}};

inline std::vector<UnitDescriptor> catalog_units(std::string_view catalog) {
    std::vector<UnitDescriptor> result;
    if (catalog != "physics.units.si") return result;
    for (const auto& base : si_units) {
        result.push_back({std::string(catalog), std::string(base.symbol), base.scale, base.dimension});
        if (!base.prefixable) continue;
        for (const auto& prefix : si_prefixes) {
            result.push_back({
                std::string(catalog),
                std::string(prefix.symbol) + std::string(base.symbol),
                prefix.scale * base.scale,
                base.dimension,
            });
        }
    }
    return result;
}

inline std::optional<UnitDescriptor> find_unit(
    std::string_view catalog,
    std::string_view symbol
) {
    for (auto unit : catalog_units(catalog)) {
        if (unit.symbol == symbol) return unit;
    }
    return std::nullopt;
}

inline std::string encoded_dimension(const Dimension& dimension) {
    std::string result;
    for (std::size_t index = 0; index < dimension.exponents.size(); ++index) {
        if (index != 0) result += ',';
        result += std::to_string(dimension.exponents[index]);
    }
    return result;
}

inline std::string unit_type(const Dimension& dimension) {
    return "unit<" + encoded_dimension(dimension) + ">";
}

inline std::string quantity_type(const Dimension& dimension) {
    return "quantity<" + encoded_dimension(dimension) + ">";
}

inline std::optional<Dimension> parse_dimension_type(std::string_view type) {
    std::size_t prefix = std::string_view::npos;
    if (type.size() >= 5 && type.substr(0, 5) == "unit<") prefix = 5;
    if (type.size() >= 9 && type.substr(0, 9) == "quantity<") prefix = 9;
    if (prefix == std::string_view::npos || type.empty() || type.back() != '>') {
        return std::nullopt;
    }
    Dimension dimension;
    std::string body(type.substr(prefix, type.size() - prefix - 1));
    std::istringstream input(body);
    std::string exponent;
    for (std::size_t index = 0; index < dimension.exponents.size(); ++index) {
        if (!std::getline(input, exponent, ',')) return std::nullopt;
        try {
            std::size_t consumed = 0;
            dimension.exponents[index] = std::stoi(exponent, &consumed);
            if (consumed != exponent.size()) return std::nullopt;
        } catch (...) {
            return std::nullopt;
        }
    }
    if (std::getline(input, exponent, ',')) return std::nullopt;
    return dimension;
}

inline Dimension add(Dimension left, const Dimension& right) {
    for (std::size_t index = 0; index < left.exponents.size(); ++index) {
        left.exponents[index] += right.exponents[index];
    }
    return left;
}

inline Dimension subtract(Dimension left, const Dimension& right) {
    for (std::size_t index = 0; index < left.exponents.size(); ++index) {
        left.exponents[index] -= right.exponents[index];
    }
    return left;
}

inline std::string dimension_name(const Dimension& dimension) {
    if (dimension == length) return "length";
    if (dimension == mass) return "mass";
    if (dimension == time) return "time";
    if (dimension == current) return "electric current";
    if (dimension == temperature) return "thermodynamic temperature";
    if (dimension == amount) return "amount of substance";
    if (dimension == luminous_intensity) return "luminous intensity";
    if (dimension == dimensionless) return "dimensionless";
    return "[" + encoded_dimension(dimension) + "]";
}

}  // namespace vkf::physical
