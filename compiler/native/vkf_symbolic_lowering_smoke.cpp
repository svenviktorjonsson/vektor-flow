#include "compiler/native/vkf_symbolic_lowering.hpp"

#include <iostream>

int main() {
    const auto real = vkf_symbolic_type_facts("R");
    if (!real.symbolic) return 1;
    if (real.shape != VkfSymbolicTypeShape::ScalarDomain) return 2;
    if (vkf_sym_domain_surface(real.scalar_domain) != "R") return 3;

    const auto integer = vkf_symbolic_type_facts("Z");
    if (!vkf_sym_domain_is_integer(integer.scalar_domain)) return 4;

    const auto function = vkf_symbolic_type_facts("R -> R");
    if (!function.symbolic) return 5;
    if (function.shape != VkfSymbolicTypeShape::FunctionDomain) return 6;
    if (function.domain_surface != "R") return 7;
    if (function.codomain_surface != "R") return 8;

    const auto vector = vkf_symbolic_type_facts("R^n");
    if (!vector.symbolic) return 9;
    if (vector.shape != VkfSymbolicTypeShape::PowerDomain) return 10;
    if (vector.base_surface != "R") return 11;
    if (vector.exponent_surface != "n") return 12;

    const auto ordinary = vkf_symbolic_type_facts("num");
    if (ordinary.symbolic) return 13;
    if (ordinary.shape != VkfSymbolicTypeShape::None) return 14;

    const auto value_expr = vkf_value_expression_facts("num");
    if (vkf_expression_lowers_to_symbolic_node(value_expr)) return 15;

    const auto symbolic_expr = vkf_symbolic_expression_facts("R", VkfSymbolicCompilerNodeKind::Binary, {"x"});
    if (!vkf_expression_lowers_to_symbolic_node(symbolic_expr)) return 16;
    if (symbolic_expr.value_type != "symbolic") return 17;
    if (symbolic_expr.free_variables.size() != 1 || symbolic_expr.free_variables[0] != "x") return 18;

    if (!vkf_symbolic_node_kind_is_calculus(VkfSymbolicCompilerNodeKind::Derivative)) return 19;
    if (vkf_symbolic_node_kind_is_calculus(VkfSymbolicCompilerNodeKind::Binary)) return 20;

    std::cout << vkf_sym_domain_surface(real.scalar_domain) << "\n";
    std::cout << function.domain_surface << "->" << function.codomain_surface << "\n";
    std::cout << vector.base_surface << "^" << vector.exponent_surface << "\n";
    std::cout << symbolic_expr.value_type << "\n";
    return 0;
}
