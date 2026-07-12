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

    const auto phi = vkf_sym_set_repr(vkf_sym_symbol("phi", vkf_sym_domain_real()), "\\phi");
    const auto theta = vkf_sym_set_repr(vkf_sym_symbol("theta", vkf_sym_domain_real()), "\\theta");
    const auto trig_arg = vkf_sym_binary(phi, "+", theta);
    const auto product = vkf_sym_binary(phi, "*", theta);
    const auto partial = vkf_sym_call("derivative", {product, phi});
    const auto integral = vkf_sym_call("integrate", {phi, phi});
    const auto sum = vkf_sym_call("sum", {phi, phi, vkf_sym_integer(1), vkf_sym_symbol("inf")});
    if (vkf_sym_render(phi) != "phi") return 16;
    if (vkf_sym_latex(phi) != "\\phi") return 17;
    if (vkf_sym_latex(trig_arg) != "\\phi+\\theta") return 18;
    if (vkf_sym_latex(partial) != "\\frac{\\partial}{\\partial \\phi} \\phi\\,\\theta") return 19;
    if (vkf_sym_latex(integral) != "\\int \\phi\\,d\\phi") return 20;
    if (vkf_sym_latex(sum) != "\\sum_{\\phi=1}^{\\infty} \\phi") return 21;
    const auto same_path_status = vf_sym_path_status(expr, expr);
    if (vkf_sym_render(same_path_status).find("found: true") == std::string::npos) return 22;
    if (vkf_sym_render(same_path_status).find("steps: 0") == std::string::npos) return 23;
    if (vkf_sym_render(same_path_status).find("reason: same expression") == std::string::npos) return 24;
    const auto a = vkf_sym_symbol("a");
    const auto b = vkf_sym_symbol("b");
    const auto c = vkf_sym_symbol("c");
    const auto distributive = vkf_sym_binary(a, "*", vkf_sym_binary(b, "+", c));
    const auto expanded = vkf_sym_binary(vkf_sym_binary(a, "*", b), "+", vkf_sym_binary(a, "*", c));
    const auto expand_status = vf_sym_path_status(distributive, expanded, 1);
    if (vkf_sym_render(expand_status).find("found: true") == std::string::npos) return 30;
    if (vkf_sym_render(expand_status).find("reason: equivalence path found") == std::string::npos) return 31;
    const auto factor_status = vf_sym_path_status(expanded, distributive, 1);
    if (vkf_sym_render(factor_status).find("found: true") == std::string::npos) return 32;
    const auto missing_path_status = vf_sym_path_status(expr, vkf_sym_binary(x, "+", vkf_sym_integer(2)), 0);
    if (vkf_sym_render(missing_path_status).find("found: false") == std::string::npos) return 25;
    if (vkf_sym_render(missing_path_status).find("capped: true") == std::string::npos) return 26;
    const auto transform_status = vf_sym_transform_path_status(vkf_sym_call("integrate", {vkf_sym_call("gamma", {x}), x}));
    if (vkf_sym_render(transform_status).find("residual_before: 1") == std::string::npos) return 27;
    if (vkf_sym_render(transform_status).find("reason: no transform path found") == std::string::npos) return 28;
    const auto integral_transform_status = vf_sym_transform_path_status(vkf_sym_call("integrate", {x, x}));
    if (vkf_sym_render(integral_transform_status).find("found: true") == std::string::npos) return 33;
    if (vkf_sym_render(integral_transform_status).find("residual_after: 0") == std::string::npos) return 34;
    if (vkf_sym_render(integral_transform_status).find("reason: transform evaluated") == std::string::npos) return 35;
    const auto beam_status = vf_sym_transform_path_beam_status(vkf_sym_call("integrate", {x, x}), 1);
    if (vkf_sym_render(beam_status).find("beam: 1") == std::string::npos) return 29;

    std::cout << vkf_sym_render(expr) << "\n";
    std::cout << vkf_sym_latex(expr) << "\n";
    std::cout << vkf_sym_render(solved.x) << "\n";
    std::cout << vkf_sym_render(solved.y) << "\n";
    std::cout << vkf_sym_render(vkf_sym_diff(x, x)) << "\n";
    std::cout << vkf_sym_render(vkf_sym_integ(x, x)) << "\n";
    std::cout << vkf_sym_render(vkf_sym_grad(expr, x)) << "\n";
    std::cout << vkf_sym_latex(trig_arg) << "\n";
    std::cout << vkf_sym_latex(partial) << "\n";
    std::cout << vkf_sym_latex(integral) << "\n";
    std::cout << vkf_sym_latex(sum) << "\n";
    return 0;
}
