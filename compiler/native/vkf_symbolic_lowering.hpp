#pragma once

#include "compiler/native/vkf_symbolic.hpp"

#include <algorithm>
#include <cctype>
#include <string>
#include <vector>

enum class VkfExpressionLoweringMode {
    Value,
    SymbolicNode,
};

enum class VkfSymbolicTypeShape {
    None,
    ScalarDomain,
    FunctionDomain,
    FixedVectorDomain,
};

enum class VkfSymbolicCompilerNodeKind {
    Symbol,
    Literal,
    Unary,
    Binary,
    Call,
    Relation,
    Derivative,
    Integral,
    Sum,
    Product,
    Vector,
    Matrix,
};

struct VkfSymbolicTypeFacts {
    bool symbolic = false;
    VkfSymbolicTypeShape shape = VkfSymbolicTypeShape::None;
    VkfSymbolicDomain scalar_domain = vkf_sym_domain_unknown();
    std::string surface;
    std::string base_surface;
    std::string exponent_surface;
    std::string domain_surface;
    std::string codomain_surface;
};

struct VkfTypedExpressionFacts {
    VkfExpressionLoweringMode mode = VkfExpressionLoweringMode::Value;
    std::string value_type;
    VkfSymbolicTypeFacts symbolic_type;
    VkfSymbolicCompilerNodeKind symbolic_node_kind = VkfSymbolicCompilerNodeKind::Literal;
    std::vector<std::string> free_variables;
};

inline std::string vkf_trim_ascii(std::string value) {
    auto is_space = [](unsigned char ch) { return std::isspace(ch) != 0; };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), [&](char ch) {
        return !is_space(static_cast<unsigned char>(ch));
    }));
    value.erase(std::find_if(value.rbegin(), value.rend(), [&](char ch) {
        return !is_space(static_cast<unsigned char>(ch));
    }).base(), value.end());
    return value;
}

inline bool vkf_symbolic_surface_is_scalar_domain(const std::string& surface) {
    return surface == "N" || surface == "Z" || surface == "Q" || surface == "R" || surface == "C";
}

inline VkfSymbolicDomain vkf_symbolic_domain_from_surface(const std::string& surface) {
    if (surface == "N") return vkf_sym_domain_natural();
    if (surface == "Z") return vkf_sym_domain_integer();
    if (surface == "Q") return vkf_sym_domain_rational();
    if (surface == "R") return vkf_sym_domain_real();
    if (surface == "C") return vkf_sym_domain_complex();
    return vkf_sym_domain_unknown();
}

inline VkfSymbolicTypeFacts vkf_symbolic_type_facts(std::string surface) {
    surface = vkf_trim_ascii(std::move(surface));
    VkfSymbolicTypeFacts facts;
    facts.surface = surface;

    if (vkf_symbolic_surface_is_scalar_domain(surface)) {
        facts.symbolic = true;
        facts.shape = VkfSymbolicTypeShape::ScalarDomain;
        facts.scalar_domain = vkf_symbolic_domain_from_surface(surface);
        return facts;
    }

    const auto arrow = surface.find("->");
    if (arrow != std::string::npos) {
        const std::string domain = vkf_trim_ascii(surface.substr(0, arrow));
        const std::string codomain = vkf_trim_ascii(surface.substr(arrow + 2));
        if (vkf_symbolic_surface_is_scalar_domain(domain) && vkf_symbolic_surface_is_scalar_domain(codomain)) {
            facts.symbolic = true;
            facts.shape = VkfSymbolicTypeShape::FunctionDomain;
            facts.domain_surface = domain;
            facts.codomain_surface = codomain;
            facts.scalar_domain = vkf_symbolic_domain_from_surface(codomain);
        }
        return facts;
    }

    if (surface.size() >= 5 && surface.front() == '[' && surface.back() == ']') {
        const auto colon = surface.find(':');
        if (colon != std::string::npos) {
            const std::string base = vkf_trim_ascii(surface.substr(1, colon - 1));
            const std::string size = vkf_trim_ascii(surface.substr(colon + 1, surface.size() - colon - 2));
            if (vkf_symbolic_surface_is_scalar_domain(base) && !size.empty()) {
                facts.symbolic = true;
                facts.shape = VkfSymbolicTypeShape::FixedVectorDomain;
                facts.base_surface = base;
                facts.exponent_surface = size;
                facts.scalar_domain = vkf_symbolic_domain_from_surface(base);
            }
        }
    } else {
        const auto power = surface.find('^');
        if (power != std::string::npos) {
            const std::string base = vkf_trim_ascii(surface.substr(0, power));
            const std::string exponent = vkf_trim_ascii(surface.substr(power + 1));
            if (vkf_symbolic_surface_is_scalar_domain(base) && !exponent.empty()) {
                facts.symbolic = true;
                facts.shape = VkfSymbolicTypeShape::ScalarDomain;
                facts.base_surface = base;
                facts.exponent_surface = exponent;
                facts.scalar_domain = vkf_symbolic_domain_from_surface(base);
            }
        }
    }

    return facts;
}

inline VkfTypedExpressionFacts vkf_value_expression_facts(std::string value_type) {
    VkfTypedExpressionFacts facts;
    facts.mode = VkfExpressionLoweringMode::Value;
    facts.value_type = std::move(value_type);
    return facts;
}

inline VkfTypedExpressionFacts vkf_symbolic_expression_facts(
    std::string value_type,
    VkfSymbolicCompilerNodeKind node_kind,
    std::vector<std::string> free_variables = {}
) {
    VkfTypedExpressionFacts facts;
    facts.symbolic_type = vkf_symbolic_type_facts(value_type);
    facts.mode = facts.symbolic_type.symbolic ? VkfExpressionLoweringMode::SymbolicNode : VkfExpressionLoweringMode::Value;
    facts.value_type = facts.symbolic_type.symbolic ? std::string("symbolic") : std::move(value_type);
    facts.symbolic_node_kind = node_kind;
    facts.free_variables = std::move(free_variables);
    return facts;
}

inline bool vkf_expression_lowers_to_symbolic_node(const VkfTypedExpressionFacts& facts) {
    return facts.mode == VkfExpressionLoweringMode::SymbolicNode;
}

inline bool vkf_symbolic_node_kind_is_calculus(VkfSymbolicCompilerNodeKind kind) {
    return kind == VkfSymbolicCompilerNodeKind::Derivative
        || kind == VkfSymbolicCompilerNodeKind::Integral
        || kind == VkfSymbolicCompilerNodeKind::Sum
        || kind == VkfSymbolicCompilerNodeKind::Product;
}
