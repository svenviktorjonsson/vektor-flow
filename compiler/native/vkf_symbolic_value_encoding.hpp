#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace vkf::symbolic_value {

enum class DomainTag : std::uint8_t {
    Unknown = 0,
    Natural = 1,
    Integer = 2,
    Rational = 3,
    Real = 4,
    Complex = 5,
};

inline DomainTag domain_tag(const std::string& surface) {
    if (surface == "N") return DomainTag::Natural;
    if (surface == "Z") return DomainTag::Integer;
    if (surface == "Q") return DomainTag::Rational;
    if (surface == "R") return DomainTag::Real;
    if (surface == "C") return DomainTag::Complex;
    return DomainTag::Unknown;
}

struct EncodedDomain {
    double tag = 0.0;
    double dimension = 0.0;
};

inline EncodedDomain encoded_domain(const std::string& surface) {
    const DomainTag scalar = domain_tag(surface);
    if (scalar != DomainTag::Unknown) {
        return {static_cast<double>(static_cast<std::uint8_t>(scalar)), 1.0};
    }
    const auto power = surface.find('^');
    if (power == std::string::npos) return {};
    const DomainTag base = domain_tag(surface.substr(0, power));
    if (base == DomainTag::Unknown) return {};
    const std::string exponent = surface.substr(power + 1u);
    if (exponent.empty()) return {};
    std::uint64_t dimension = 0u;
    for (const unsigned char ch : exponent) {
        if (ch < '0' || ch > '9') return {};
        dimension = dimension * 10u + static_cast<std::uint64_t>(ch - '0');
    }
    if (dimension == 0u) return {};
    return {
        static_cast<double>(static_cast<std::uint8_t>(base)),
        static_cast<double>(dimension),
    };
}

inline double encoded_domain_tag(const std::string& surface) {
    const auto arrow = surface.find("->");
    if (arrow != std::string::npos) {
        const auto input = encoded_domain(surface.substr(0, arrow));
        const auto output = encoded_domain(surface.substr(arrow + 2));
        return 64.0
            + input.tag * 8.0
            + output.tag;
    }
    return encoded_domain(surface).tag;
}

struct FunctionSignatureTags {
    std::vector<EncodedDomain> inputs;
    EncodedDomain output;
};

inline FunctionSignatureTags function_signature_tags(const std::string& surface) {
    FunctionSignatureTags result;
    const auto arrow = surface.find("->");
    if (arrow == std::string::npos) {
        result.output = encoded_domain(surface);
        return result;
    }
    const std::string input = surface.substr(0, arrow);
    result.output = encoded_domain(surface.substr(arrow + 2));
    if (!input.empty() && input.front() == '(' && input.back() == ')') {
        std::size_t start = 1u;
        while (start < input.size() - 1u) {
            const std::size_t separator = input.find(',', start);
            const std::size_t end = separator == std::string::npos ? input.size() - 1u : separator;
            result.inputs.push_back(encoded_domain(input.substr(start, end - start)));
            if (separator == std::string::npos) break;
            start = separator + 1u;
        }
        return result;
    }
    result.inputs.push_back(encoded_domain(input));
    return result;
}

}  // namespace vkf::symbolic_value
