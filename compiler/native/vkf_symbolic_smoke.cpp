#include "compiler/native/vkf_symbolic.hpp"

#include <iostream>

int main() {
    const auto x = vkf_sym_symbol("x", vkf_sym_domain_integer());
    const auto y = vkf_sym_symbol("y", vkf_sym_domain_integer());
    const auto r = vkf_sym_symbol("r", vkf_sym_domain_real());

    if (vkf_sym_conditions(x) != "[x in Z]") return 1;
    if (vkf_sym_conditions(r) != "[r in R]") return 2;

    const auto expr = vkf_sym_binary(x, "+", vkf_sym_integer(1));
    if (vkf_sym_render(expr) != "x + 1") return 3;
    if (vkf_sym_latex(expr) != "x+1") return 4;
    if (expr.node->kind != VkfSymbolicNodeKind::Binary) return 5;
    if (expr.node->domain.kind != VkfSymbolicDomainKind::Integer) return 6;

    const auto eq = vkf_sym_relation(
        vkf_sym_binary(vkf_sym_binary(vkf_sym_integer(2), "*", x), "+", vkf_sym_binary(vkf_sym_integer(3), "*", y)),
        "=",
        vkf_sym_integer(7)
    );
    const auto solved = vkf_sym_solve_linear_diophantine2(eq, x, y);
    if (!solved.solved) return 7;
    if (vkf_sym_render(solved.x) != "-7 + 3*k") return 8;
    if (vkf_sym_render(solved.y) != "7 - 2*k") return 9;

    const auto real_solve = vkf_sym_solve_linear_diophantine2(eq, r, y);
    if (real_solve.solved) return 10;
    if (vkf_sym_render(real_solve.x).find("solve(") != 0) return 11;

    const auto future_np = vkf_sym_domain_modular_integer(5);
    if (vkf_sym_domain_surface(future_np) != "N_5") return 12;
    if (vkf_sym_render(vkf_sym_diff(x, x)) != "1") return 13;
    if (vkf_sym_render(vkf_sym_integ(x, x)) != "x ^ 2 / 2") return 14;
    if (vkf_sym_render(vkf_sym_grad(expr, x)) != "grad(x + 1, x)") return 15;

    std::cout << vkf_sym_render(expr) << "\n";
    std::cout << vkf_sym_latex(expr) << "\n";
    std::cout << vkf_sym_render(solved.x) << "\n";
    std::cout << vkf_sym_render(solved.y) << "\n";
    std::cout << vkf_sym_render(vkf_sym_diff(x, x)) << "\n";
    std::cout << vkf_sym_render(vkf_sym_integ(x, x)) << "\n";
    std::cout << vkf_sym_render(vkf_sym_grad(expr, x)) << "\n";
    return 0;
}
