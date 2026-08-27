#pragma once

#include <stdexcept>
#include <string>

enum class VkfSymbolicDomainKind {
    Unknown,
    Natural,
    Integer,
    Rational,
    Real,
    Complex,
    ModularInteger,
};

struct VkfSymbolicDomain {
    VkfSymbolicDomainKind kind = VkfSymbolicDomainKind::Unknown;
    long long modulus = 0;
};

inline VkfSymbolicDomain vkf_sym_domain_unknown() { return {}; }
inline VkfSymbolicDomain vkf_sym_domain_natural() { return {VkfSymbolicDomainKind::Natural, 0}; }
inline VkfSymbolicDomain vkf_sym_domain_integer() { return {VkfSymbolicDomainKind::Integer, 0}; }
inline VkfSymbolicDomain vkf_sym_domain_rational() { return {VkfSymbolicDomainKind::Rational, 0}; }
inline VkfSymbolicDomain vkf_sym_domain_real() { return {VkfSymbolicDomainKind::Real, 0}; }
inline VkfSymbolicDomain vkf_sym_domain_complex() { return {VkfSymbolicDomainKind::Complex, 0}; }

inline VkfSymbolicDomain vkf_sym_domain_modular_integer(long long modulus) {
    if (modulus <= 0) throw std::runtime_error("N_p domain modulus must be positive");
    return {VkfSymbolicDomainKind::ModularInteger, modulus};
}

inline std::string vkf_sym_domain_surface(const VkfSymbolicDomain& domain) {
    switch (domain.kind) {
        case VkfSymbolicDomainKind::Natural: return "N";
        case VkfSymbolicDomainKind::Integer: return "Z";
        case VkfSymbolicDomainKind::Rational: return "Q";
        case VkfSymbolicDomainKind::Real: return "R";
        case VkfSymbolicDomainKind::Complex: return "C";
        case VkfSymbolicDomainKind::ModularInteger:
            return std::string("N_") + std::to_string(domain.modulus);
        case VkfSymbolicDomainKind::Unknown: return "?";
    }
    return "?";
}

inline bool vkf_sym_domain_is_integer(const VkfSymbolicDomain& domain) {
    return domain.kind == VkfSymbolicDomainKind::Natural ||
        domain.kind == VkfSymbolicDomainKind::Integer;
}

inline bool vkf_sym_domain_is_real(const VkfSymbolicDomain& domain) {
    return domain.kind == VkfSymbolicDomainKind::Natural ||
        domain.kind == VkfSymbolicDomainKind::Integer ||
        domain.kind == VkfSymbolicDomainKind::Rational ||
        domain.kind == VkfSymbolicDomainKind::Real;
}
