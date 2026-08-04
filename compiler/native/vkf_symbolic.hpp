#pragma once

#include <cctype>
#include <cmath>
#include <complex>
#include <cstdlib>
#include <deque>
#include <memory>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

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
        case VkfSymbolicDomainKind::ModularInteger: return std::string("N_") + std::to_string(domain.modulus);
        case VkfSymbolicDomainKind::Unknown: return "?";
    }
    return "?";
}

inline bool vkf_sym_domain_is_integer(const VkfSymbolicDomain& domain) {
    return domain.kind == VkfSymbolicDomainKind::Natural || domain.kind == VkfSymbolicDomainKind::Integer;
}

inline bool vkf_sym_domain_is_real(const VkfSymbolicDomain& domain) {
    return domain.kind == VkfSymbolicDomainKind::Natural
        || domain.kind == VkfSymbolicDomainKind::Integer
        || domain.kind == VkfSymbolicDomainKind::Rational
        || domain.kind == VkfSymbolicDomainKind::Real;
}

enum class VkfSymbolicNodeKind {
    Symbol,
    IntegerLiteral,
    Call,
    Binary,
    Relation,
};

struct VkfSymbolicNode {
    VkfSymbolicNodeKind kind = VkfSymbolicNodeKind::Symbol;
    std::string text;
    std::string latex_text;
    std::string op;
    VkfSymbolicDomain domain;
    std::vector<std::shared_ptr<const VkfSymbolicNode>> children;
};

struct VkfSymbolicExpr {
    std::shared_ptr<const VkfSymbolicNode> node;
    std::vector<std::string> conditions;
};

inline VkfSymbolicExpr vkf_sym_make_expr(
    VkfSymbolicNodeKind kind,
    std::string text,
    std::string op,
    VkfSymbolicDomain domain,
    std::vector<std::shared_ptr<const VkfSymbolicNode>> children,
    std::vector<std::string> conditions = {},
    std::string latex_text = ""
) {
    auto node = std::make_shared<VkfSymbolicNode>();
    const_cast<VkfSymbolicNode&>(*node).kind = kind;
    const_cast<VkfSymbolicNode&>(*node).text = std::move(text);
    const_cast<VkfSymbolicNode&>(*node).latex_text = std::move(latex_text);
    const_cast<VkfSymbolicNode&>(*node).op = std::move(op);
    const_cast<VkfSymbolicNode&>(*node).domain = domain;
    const_cast<VkfSymbolicNode&>(*node).children = std::move(children);
    return {node, std::move(conditions)};
}

inline VkfSymbolicExpr vkf_sym_symbol(
    const std::string& name,
    VkfSymbolicDomain domain = vkf_sym_domain_unknown(),
    const std::string& latex_text = ""
) {
    std::vector<std::string> conditions;
    if (domain.kind != VkfSymbolicDomainKind::Unknown) {
        conditions.push_back(name + std::string(" in ") + vkf_sym_domain_surface(domain));
    }
    return vkf_sym_make_expr(VkfSymbolicNodeKind::Symbol, name, "", domain, {}, conditions, latex_text);
}

inline VkfSymbolicExpr vkf_sym_integer(long long value) {
    return vkf_sym_make_expr(VkfSymbolicNodeKind::IntegerLiteral, std::to_string(value), "", vkf_sym_domain_integer(), {});
}

inline std::vector<std::string> vkf_sym_merge_conditions(const VkfSymbolicExpr& a, const VkfSymbolicExpr& b) {
    std::vector<std::string> out = a.conditions;
    out.insert(out.end(), b.conditions.begin(), b.conditions.end());
    return out;
}

inline VkfSymbolicDomain vkf_sym_promote_domain(const VkfSymbolicDomain& a, const VkfSymbolicDomain& b) {
    if (a.kind == b.kind && a.modulus == b.modulus) return a;
    if (a.kind == VkfSymbolicDomainKind::Complex || b.kind == VkfSymbolicDomainKind::Complex) return vkf_sym_domain_complex();
    if (a.kind == VkfSymbolicDomainKind::Real || b.kind == VkfSymbolicDomainKind::Real) return vkf_sym_domain_real();
    if (a.kind == VkfSymbolicDomainKind::Rational || b.kind == VkfSymbolicDomainKind::Rational) return vkf_sym_domain_rational();
    if (a.kind == VkfSymbolicDomainKind::Integer || b.kind == VkfSymbolicDomainKind::Integer) return vkf_sym_domain_integer();
    if (a.kind == VkfSymbolicDomainKind::Natural || b.kind == VkfSymbolicDomainKind::Natural) return vkf_sym_domain_natural();
    return vkf_sym_domain_unknown();
}

inline VkfSymbolicExpr vkf_sym_binary(const VkfSymbolicExpr& a, const std::string& op, const VkfSymbolicExpr& b) {
    return vkf_sym_make_expr(
        VkfSymbolicNodeKind::Binary,
        "",
        op,
        vkf_sym_promote_domain(a.node->domain, b.node->domain),
        {a.node, b.node},
        vkf_sym_merge_conditions(a, b)
    );
}

inline VkfSymbolicExpr vkf_sym_relation(const VkfSymbolicExpr& a, const std::string& op, const VkfSymbolicExpr& b) {
    return vkf_sym_make_expr(
        VkfSymbolicNodeKind::Relation,
        "",
        op,
        vkf_sym_domain_unknown(),
        {a.node, b.node},
        vkf_sym_merge_conditions(a, b)
    );
}

inline VkfSymbolicExpr vkf_sym_call(const std::string& name, const std::vector<VkfSymbolicExpr>& args) {
    std::vector<std::shared_ptr<const VkfSymbolicNode>> children;
    std::vector<std::string> conditions;
    for (const auto& arg : args) {
        children.push_back(arg.node);
        conditions.insert(conditions.end(), arg.conditions.begin(), arg.conditions.end());
    }
    return vkf_sym_make_expr(VkfSymbolicNodeKind::Call, name, "", vkf_sym_domain_unknown(), children, conditions);
}

inline VkfSymbolicExpr vkf_sym_assume(VkfSymbolicExpr expr, const std::string& condition) {
    expr.conditions.push_back(condition);
    return expr;
}

inline VkfSymbolicExpr vkf_sym_set_repr(const VkfSymbolicExpr& expr, const std::string& latex_text) {
    if (!expr.node) return expr;
    auto node = std::make_shared<VkfSymbolicNode>(*expr.node);
    node->latex_text = latex_text;
    return {node, expr.conditions};
}

inline bool vkf_sym_render_needs_parens(const std::string& text) {
    return text.find(" + ") != std::string::npos
        || text.find(" - ") != std::string::npos
        || text.find(" = ") != std::string::npos
        || text.find(" != ") != std::string::npos;
}

inline std::string vkf_sym_render_node(const std::shared_ptr<const VkfSymbolicNode>& node);

inline std::string vkf_sym_render_child(const std::shared_ptr<const VkfSymbolicNode>& node) {
    const std::string text = vkf_sym_render_node(node);
    return vkf_sym_render_needs_parens(text) ? std::string("(") + text + ")" : text;
}

inline std::string vkf_sym_render_node(const std::shared_ptr<const VkfSymbolicNode>& node) {
    if (!node) return "";
    if (node->kind == VkfSymbolicNodeKind::Symbol || node->kind == VkfSymbolicNodeKind::IntegerLiteral) return node->text;
    if (node->kind == VkfSymbolicNodeKind::Binary || node->kind == VkfSymbolicNodeKind::Relation) {
        if (node->children.size() != 2) throw std::runtime_error("symbolic binary node must have two children");
        return vkf_sym_render_child(node->children[0]) + std::string(" ") + node->op + std::string(" ") + vkf_sym_render_child(node->children[1]);
    }
    if (node->kind == VkfSymbolicNodeKind::Call) {
        std::string out = node->text + "(";
        for (std::size_t i = 0; i < node->children.size(); ++i) {
            if (i) out += ", ";
            out += vkf_sym_render_node(node->children[i]);
        }
        out += ")";
        return out;
    }
    return "";
}

inline std::string vkf_sym_render(const VkfSymbolicExpr& expr) {
    return vkf_sym_render_node(expr.node);
}

inline VkfSymbolicExpr vkf_sym_diff(const VkfSymbolicExpr& expr, const VkfSymbolicExpr& var) {
    if (vkf_sym_render(expr) == vkf_sym_render(var)) return vkf_sym_integer(1);
    if (expr.node->kind == VkfSymbolicNodeKind::IntegerLiteral) return vkf_sym_integer(0);
    return vkf_sym_call("diff", {expr, var});
}

inline VkfSymbolicExpr vkf_sym_differentiate(const VkfSymbolicExpr& expr, const VkfSymbolicExpr& var) {
    return vkf_sym_diff(expr, var);
}

inline VkfSymbolicExpr vkf_sym_integ(const VkfSymbolicExpr& expr, const VkfSymbolicExpr& var) {
    if (vkf_sym_render(expr) == vkf_sym_render(var)) {
        return vkf_sym_binary(vkf_sym_binary(var, "^", vkf_sym_integer(2)), "/", vkf_sym_integer(2));
    }
    if (expr.node->kind == VkfSymbolicNodeKind::IntegerLiteral) return vkf_sym_binary(expr, "*", var);
    return vkf_sym_call("integ", {expr, var});
}

inline VkfSymbolicExpr vkf_sym_integrate(const VkfSymbolicExpr& expr, const VkfSymbolicExpr& var) {
    return vkf_sym_integ(expr, var);
}

inline VkfSymbolicExpr vkf_sym_grad(const VkfSymbolicExpr& expr, const VkfSymbolicExpr& vars) {
    return vkf_sym_call("grad", {expr, vars});
}

inline VkfSymbolicExpr vkf_sym_gradient(const VkfSymbolicExpr& expr, const VkfSymbolicExpr& vars) {
    return vkf_sym_grad(expr, vars);
}

inline std::string vkf_sym_conditions(const VkfSymbolicExpr& expr) {
    std::string out = "[";
    for (std::size_t i = 0; i < expr.conditions.size(); ++i) {
        if (i) out += ", ";
        out += expr.conditions[i];
    }
    out += "]";
    return out;
}

inline std::string vkf_sym_latex_node(const std::shared_ptr<const VkfSymbolicNode>& node);

inline void vkf_sym_collect_symbols(const std::shared_ptr<const VkfSymbolicNode>& node, std::vector<std::string>& out) {
    if (!node) return;
    if (node->kind == VkfSymbolicNodeKind::Symbol) {
        out.push_back(node->text);
        return;
    }
    for (const auto& child : node->children) vkf_sym_collect_symbols(child, out);
}

inline bool vkf_sym_uses_other_symbol(const std::shared_ptr<const VkfSymbolicNode>& node, const std::string& var) {
    std::vector<std::string> symbols;
    vkf_sym_collect_symbols(node, symbols);
    for (const auto& symbol : symbols) {
        if (symbol != var && symbol != "inf" && symbol != "-inf") return true;
    }
    return false;
}

inline std::string vkf_sym_latex_child(const std::shared_ptr<const VkfSymbolicNode>& node) {
    if (node && (node->kind == VkfSymbolicNodeKind::Binary || node->kind == VkfSymbolicNodeKind::Relation)) {
        return std::string("(") + vkf_sym_latex_node(node) + ")";
    }
    return vkf_sym_latex_node(node);
}

inline std::string vkf_sym_latex_node(const std::shared_ptr<const VkfSymbolicNode>& node) {
    if (!node) return "";
    if (node->kind == VkfSymbolicNodeKind::Symbol || node->kind == VkfSymbolicNodeKind::IntegerLiteral) {
        return node->latex_text.empty() ? node->text : node->latex_text;
    }
    if (node->kind == VkfSymbolicNodeKind::Binary || node->kind == VkfSymbolicNodeKind::Relation) {
        if (node->children.size() != 2) throw std::runtime_error("symbolic binary node must have two children");
        if (node->op == "*") return vkf_sym_latex_child(node->children[0]) + "\\," + vkf_sym_latex_child(node->children[1]);
        if (node->op == "/") return "\\frac{" + vkf_sym_latex_node(node->children[0]) + "}{" + vkf_sym_latex_node(node->children[1]) + "}";
        if (node->op == "^") return vkf_sym_latex_child(node->children[0]) + "^{" + vkf_sym_latex_node(node->children[1]) + "}";
        if (node->op == "=") return vkf_sym_latex_node(node->children[0]) + "=" + vkf_sym_latex_node(node->children[1]);
        return vkf_sym_latex_node(node->children[0]) + node->op + vkf_sym_latex_node(node->children[1]);
    }
    if (node->kind == VkfSymbolicNodeKind::Call) {
        if ((node->text == "derivative" || node->text == "differentiate" || node->text == "diff")
            && (node->children.size() == 2 || node->children.size() == 3)) {
            const std::string var = vkf_sym_render_node(node->children[1]);
            const std::string latex_var = vkf_sym_latex_node(node->children[1]);
            const bool partial = vkf_sym_uses_other_symbol(node->children[0], var);
            const std::string op = partial ? "\\partial" : "d";
            const std::string denominator_var = partial ? std::string("\\partial ") + latex_var : std::string("d") + latex_var;
            if (node->children.size() == 3) {
                const std::string order = vkf_sym_latex_node(node->children[2]);
                return "\\frac{" + op + "^{" + order + "}}{" + denominator_var + "^{" + order + "}} "
                    + vkf_sym_latex_node(node->children[0]);
            }
            return "\\frac{" + op + "}{" + denominator_var + "} " + vkf_sym_latex_node(node->children[0]);
        }
        if ((node->text == "integrate" || node->text == "integral" || node->text == "integ")
            && (node->children.size() == 2 || node->children.size() == 4)) {
            const std::string var = vkf_sym_latex_node(node->children[1]);
            if (node->children.size() == 4) {
                return "\\int_{" + vkf_sym_latex_node(node->children[2]) + "}^{" + vkf_sym_latex_node(node->children[3])
                    + "} " + vkf_sym_latex_node(node->children[0]) + "\\,d" + var;
            }
            return "\\int " + vkf_sym_latex_node(node->children[0]) + "\\,d" + var;
        }
        if (node->text == "sum" && node->children.size() == 4) {
            const std::string end = vkf_sym_render_node(node->children[3]) == "inf"
                ? "\\infty"
                : vkf_sym_latex_node(node->children[3]);
            return "\\sum_{" + vkf_sym_latex_node(node->children[1]) + "=" + vkf_sym_latex_node(node->children[2])
                + "}^{" + end + "} " + vkf_sym_latex_node(node->children[0]);
        }
        std::string out = node->text.size() > 1 ? "\\operatorname{" + node->text + "}\\left(" : node->text + "\\left(";
        for (std::size_t i = 0; i < node->children.size(); ++i) {
            if (i) out += ", ";
            out += vkf_sym_latex_node(node->children[i]);
        }
        out += "\\right)";
        return out;
    }
    return "";
}

inline std::string vkf_sym_latex(const VkfSymbolicExpr& expr) {
    return vkf_sym_latex_node(expr.node);
}

inline std::string vkf_sym_compact(std::string text);

struct VkfSymbolicSolve2 {
    VkfSymbolicExpr x;
    VkfSymbolicExpr y;
    bool solved = false;
};

inline VkfSymbolicSolve2 vkf_sym_solve_linear_diophantine2(const VkfSymbolicExpr& relation, const VkfSymbolicExpr& x, const VkfSymbolicExpr& y);

using vf_symbolic = VkfSymbolicExpr;

struct VkfSymSearchStatus {
    bool found = false;
    bool capped = false;
    long long steps = 0;
    long long expanded = 0;
    long long reached = 0;
    long long score = 0;
    long long residual_before = 0;
    long long residual_after = 0;
    long long max_steps = 0;
    long long beam = 0;
    std::string reason;
};

inline std::string vkf_sym_bool_text(bool value) {
    return value ? "true" : "false";
}

inline std::string vkf_sym_status_record_text(const VkfSymSearchStatus& status) {
    return std::string("{found: ") + vkf_sym_bool_text(status.found)
        + ", capped: " + vkf_sym_bool_text(status.capped)
        + ", steps: " + std::to_string(status.steps)
        + ", expanded: " + std::to_string(status.expanded)
        + ", reached: " + std::to_string(status.reached)
        + ", score: " + std::to_string(status.score)
        + ", residual_before: " + std::to_string(status.residual_before)
        + ", residual_after: " + std::to_string(status.residual_after)
        + ", max_steps: " + std::to_string(status.max_steps)
        + ", beam: " + std::to_string(status.beam)
        + ", reason: " + status.reason
        + "}";
}

inline vf_symbolic vkf_sym_status_record(const VkfSymSearchStatus& status) {
    return vkf_sym_symbol(vkf_sym_status_record_text(status));
}

inline long long vkf_sym_residual_transform_count_node(const std::shared_ptr<const VkfSymbolicNode>& node) {
    if (!node) return 0;
    long long count = 0;
    if (node->kind == VkfSymbolicNodeKind::Call
        && (node->text == "diff"
            || node->text == "differentiate"
            || node->text == "derivative"
            || node->text == "integ"
            || node->text == "integrate"
            || node->text == "laplace_transform"
            || node->text == "fourier_transform"
            || node->text == "z_transform"
            || node->text == "wavelet_transform")) {
        ++count;
    }
    for (const auto& child : node->children) {
        count += vkf_sym_residual_transform_count_node(child);
    }
    return count;
}

inline long long vkf_sym_residual_transform_count(const vf_symbolic& expr) {
    return vkf_sym_residual_transform_count_node(expr.node);
}

inline bool vkf_sym_same_surface(const vf_symbolic& a, const vf_symbolic& b) {
    return vkf_sym_render(a) == vkf_sym_render(b) && a.conditions == b.conditions;
}

inline void vkf_sym_push_unique_edge(std::vector<vf_symbolic>& edges, const vf_symbolic& expr) {
    for (const auto& edge : edges) {
        if (vkf_sym_same_surface(edge, expr)) return;
    }
    edges.push_back(expr);
}

inline bool vkf_sym_integer_literal_value(const vf_symbolic& expr, long long& value) {
    if (!expr.node || expr.node->kind != VkfSymbolicNodeKind::IntegerLiteral) return false;
    char* end = nullptr;
    value = std::strtoll(expr.node->text.c_str(), &end, 10);
    return end != nullptr && *end == '\0';
}

inline vf_symbolic vkf_sym_replace_child(const vf_symbolic& expr, std::size_t index, const vf_symbolic& child) {
    if (!expr.node) return expr;
    if ((expr.node->kind == VkfSymbolicNodeKind::Binary || expr.node->kind == VkfSymbolicNodeKind::Relation)
        && expr.node->children.size() == 2) {
        const auto other = VkfSymbolicExpr{expr.node->children[1 - index], {}};
        return index == 0
            ? (expr.node->kind == VkfSymbolicNodeKind::Relation ? vkf_sym_relation(child, expr.node->op, other) : vkf_sym_binary(child, expr.node->op, other))
            : (expr.node->kind == VkfSymbolicNodeKind::Relation ? vkf_sym_relation(other, expr.node->op, child) : vkf_sym_binary(other, expr.node->op, child));
    }
    if (expr.node->kind == VkfSymbolicNodeKind::Call) {
        std::vector<vf_symbolic> args;
        for (std::size_t i = 0; i < expr.node->children.size(); ++i) {
            args.push_back(i == index ? child : VkfSymbolicExpr{expr.node->children[i], {}});
        }
        return vkf_sym_call(expr.node->text, args);
    }
    return expr;
}

inline vf_symbolic vkf_sym_expand_once(const vf_symbolic& expr) {
    if (!expr.node || expr.node->kind != VkfSymbolicNodeKind::Binary || expr.node->op != "*" || expr.node->children.size() != 2) return expr;
    const auto left = VkfSymbolicExpr{expr.node->children[0], {}};
    const auto right = VkfSymbolicExpr{expr.node->children[1], {}};
    if (right.node && right.node->kind == VkfSymbolicNodeKind::Binary && right.node->op == "+" && right.node->children.size() == 2) {
        const auto b = VkfSymbolicExpr{right.node->children[0], {}};
        const auto c = VkfSymbolicExpr{right.node->children[1], {}};
        return vkf_sym_binary(vkf_sym_binary(left, "*", b), "+", vkf_sym_binary(left, "*", c));
    }
    if (left.node && left.node->kind == VkfSymbolicNodeKind::Binary && left.node->op == "+" && left.node->children.size() == 2) {
        const auto a = VkfSymbolicExpr{left.node->children[0], {}};
        const auto b = VkfSymbolicExpr{left.node->children[1], {}};
        return vkf_sym_binary(vkf_sym_binary(a, "*", right), "+", vkf_sym_binary(b, "*", right));
    }
    return expr;
}

inline vf_symbolic vkf_sym_factor_once(const vf_symbolic& expr) {
    if (!expr.node || expr.node->kind != VkfSymbolicNodeKind::Binary || expr.node->op != "+" || expr.node->children.size() != 2) return expr;
    const auto left = VkfSymbolicExpr{expr.node->children[0], {}};
    const auto right = VkfSymbolicExpr{expr.node->children[1], {}};
    if (!left.node || !right.node || left.node->kind != VkfSymbolicNodeKind::Binary || right.node->kind != VkfSymbolicNodeKind::Binary) return expr;
    if (left.node->op != "*" || right.node->op != "*" || left.node->children.size() != 2 || right.node->children.size() != 2) return expr;
    const auto la = VkfSymbolicExpr{left.node->children[0], {}};
    const auto lb = VkfSymbolicExpr{left.node->children[1], {}};
    const auto ra = VkfSymbolicExpr{right.node->children[0], {}};
    const auto rb = VkfSymbolicExpr{right.node->children[1], {}};
    if (vkf_sym_same_surface(la, ra)) return vkf_sym_binary(la, "*", vkf_sym_binary(lb, "+", rb));
    if (vkf_sym_same_surface(la, rb)) return vkf_sym_binary(la, "*", vkf_sym_binary(lb, "+", ra));
    if (vkf_sym_same_surface(lb, ra)) return vkf_sym_binary(lb, "*", vkf_sym_binary(la, "+", rb));
    if (vkf_sym_same_surface(lb, rb)) return vkf_sym_binary(lb, "*", vkf_sym_binary(la, "+", ra));
    return expr;
}

inline vf_symbolic vkf_sym_compute_once(const vf_symbolic& expr) {
    if (!expr.node || expr.node->kind != VkfSymbolicNodeKind::Binary || expr.node->children.size() != 2) return expr;
    const auto left = VkfSymbolicExpr{expr.node->children[0], {}};
    const auto right = VkfSymbolicExpr{expr.node->children[1], {}};
    long long a = 0;
    long long b = 0;
    if (!vkf_sym_integer_literal_value(left, a) || !vkf_sym_integer_literal_value(right, b)) return expr;
    if (expr.node->op == "+") return vkf_sym_integer(a + b);
    if (expr.node->op == "-") return vkf_sym_integer(a - b);
    if (expr.node->op == "*") return vkf_sym_integer(a * b);
    if (expr.node->op == "/" && b != 0 && a % b == 0) return vkf_sym_integer(a / b);
    return expr;
}

inline vf_symbolic vkf_sym_transform_once(const vf_symbolic& expr) {
    if (!expr.node || expr.node->kind != VkfSymbolicNodeKind::Call) return expr;
    if ((expr.node->text == "diff" || expr.node->text == "differentiate" || expr.node->text == "derivative") && expr.node->children.size() >= 2) {
        return vkf_sym_diff(VkfSymbolicExpr{expr.node->children[0], {}}, VkfSymbolicExpr{expr.node->children[1], {}});
    }
    if ((expr.node->text == "integ" || expr.node->text == "integrate") && expr.node->children.size() >= 2) {
        return vkf_sym_integrate(VkfSymbolicExpr{expr.node->children[0], {}}, VkfSymbolicExpr{expr.node->children[1], {}});
    }
    return expr;
}

inline std::vector<vf_symbolic> vkf_sym_graph_edges_once(const vf_symbolic& expr) {
    std::vector<vf_symbolic> edges;
    vkf_sym_push_unique_edge(edges, vkf_sym_expand_once(expr));
    vkf_sym_push_unique_edge(edges, vkf_sym_factor_once(expr));
    vkf_sym_push_unique_edge(edges, vkf_sym_compute_once(expr));
    vkf_sym_push_unique_edge(edges, vkf_sym_transform_once(expr));
    if (expr.node && (expr.node->kind == VkfSymbolicNodeKind::Binary || expr.node->kind == VkfSymbolicNodeKind::Relation || expr.node->kind == VkfSymbolicNodeKind::Call)) {
        for (std::size_t i = 0; i < expr.node->children.size(); ++i) {
            const auto child = VkfSymbolicExpr{expr.node->children[i], {}};
            for (const auto& child_edge : vkf_sym_graph_edges_once(child)) {
                vkf_sym_push_unique_edge(edges, vkf_sym_replace_child(expr, i, child_edge));
            }
        }
    }
    return edges;
}

struct VkfSymPathSearchResult {
    bool found = false;
    bool capped = false;
    long long steps = -1;
    long long expanded = 0;
    long long reached = 0;
};

inline VkfSymPathSearchResult vkf_sym_path_search(const vf_symbolic& start, const vf_symbolic& target, long long max_steps) {
    VkfSymPathSearchResult result;
    if (vkf_sym_same_surface(start, target)) {
        result.found = true;
        result.steps = 0;
        result.reached = 1;
        return result;
    }
    if (max_steps <= 0) {
        result.capped = true;
        result.reached = 1;
        return result;
    }
    struct Item {
        vf_symbolic expr;
        long long depth = 0;
    };
    std::deque<Item> queue;
    std::set<std::string> seen;
    queue.push_back({start, 0});
    seen.insert(vkf_sym_render(start));
    while (!queue.empty()) {
        const auto item = queue.front();
        queue.pop_front();
        if (item.depth >= max_steps) {
            result.capped = true;
            continue;
        }
        ++result.expanded;
        for (const auto& edge : vkf_sym_graph_edges_once(item.expr)) {
            const std::string key = vkf_sym_render(edge);
            if (seen.find(key) != seen.end()) continue;
            seen.insert(key);
            if (vkf_sym_same_surface(edge, target)) {
                result.found = true;
                result.steps = item.depth + 1;
                result.reached = static_cast<long long>(seen.size());
                return result;
            }
            queue.push_back({edge, item.depth + 1});
        }
    }
    result.reached = static_cast<long long>(seen.size());
    return result;
}

inline vf_symbolic vf_sym_path_status(const vf_symbolic& start, const vf_symbolic& target, long long max_steps = 8) {
    const auto search = vkf_sym_path_search(start, target, max_steps);
    VkfSymSearchStatus status;
    status.found = search.found;
    status.capped = search.capped && !search.found;
    status.steps = search.steps;
    status.expanded = search.expanded;
    status.reached = search.reached;
    status.max_steps = max_steps;
    status.reason = search.found
        ? (search.steps == 0 ? "same expression" : "equivalence path found")
        : (status.capped ? "search budget exhausted" : "no equivalence path found");
    return vkf_sym_status_record(status);
}

inline vf_symbolic vf_sym_transform_path_status(const vf_symbolic& expr, long long max_steps = 16, long long beam = 4) {
    const long long residual = vkf_sym_residual_transform_count(expr);
    const auto transformed = vkf_sym_transform_once(expr);
    const long long residual_after = vkf_sym_residual_transform_count(transformed);
    VkfSymSearchStatus status;
    status.found = residual_after == 0;
    status.capped = residual != 0 && max_steps <= 0;
    status.steps = residual == residual_after ? (residual == 0 ? 0 : -1) : 1;
    status.expanded = 1;
    status.reached = 1;
    status.residual_before = residual;
    status.residual_after = residual_after;
    status.max_steps = max_steps;
    status.beam = beam <= 0 ? 1 : beam;
    status.reason = residual == 0
        ? "no residual transforms"
        : (status.found ? "transform evaluated" : (status.capped ? "transform budget exhausted" : "no transform path found"));
    return vkf_sym_status_record(status);
}

inline vf_symbolic vf_sym_transform_path_beam_status(const vf_symbolic& expr, long long beam) {
    return vf_sym_transform_path_status(expr, 16, beam);
}

inline vf_symbolic vf_make_symbolic(const std::string& text) { return vkf_sym_symbol(text); }
inline vf_symbolic vf_to_symbolic(const vf_symbolic& value) { return value; }
inline vf_symbolic vf_to_symbolic(const std::string& value) { return vf_make_symbolic(value); }
inline vf_symbolic vf_to_symbolic(const char* value) { return vf_make_symbolic(std::string(value)); }
inline vf_symbolic vf_to_symbolic(long long value) { return vkf_sym_integer(value); }
inline vf_symbolic vf_to_symbolic(int value) { return vf_to_symbolic(static_cast<long long>(value)); }
inline vf_symbolic vf_to_symbolic(bool value) { return vf_make_symbolic(value ? "true" : "false"); }

inline std::string vkf_sym_format_double(double value) {
    if (std::floor(value) == value) return std::to_string(static_cast<long long>(value));
    std::ostringstream out;
    out.precision(15);
    out << value;
    return out.str();
}

inline vf_symbolic vf_to_symbolic(double value) { return vf_make_symbolic(vkf_sym_format_double(value)); }

inline vf_symbolic vf_to_symbolic(const std::complex<double>& value) {
    if (value.imag() == 0.0) return vf_to_symbolic(value.real());
    if (value.real() == 0.0) {
        if (value.imag() == 1.0) return vf_make_symbolic("i");
        if (value.imag() == -1.0) return vf_make_symbolic("-i");
        return vf_make_symbolic(vkf_sym_format_double(value.imag()) + std::string("i"));
    }
    const std::string imag = std::abs(value.imag()) == 1.0
        ? std::string("i")
        : vkf_sym_format_double(std::abs(value.imag())) + std::string("i");
    return vf_make_symbolic(vkf_sym_format_double(value.real()) + (value.imag() >= 0.0 ? "+" : "-") + imag);
}

template <typename T>
inline auto vf_to_symbolic(const T& value) -> decltype(value.n, value.d, vf_symbolic{}) {
    return vf_make_symbolic(std::to_string(value.n) + (value.d == 1 ? std::string("") : std::string("/") + std::to_string(value.d)));
}

inline vf_symbolic vf_sym_binop(const vf_symbolic& a, const std::string& op, const vf_symbolic& b) {
    return op == "=" || op == "!=" || op == "&" ? vkf_sym_relation(a, op, b) : vkf_sym_binary(a, op, b);
}

inline vf_symbolic operator+(const vf_symbolic& a, const vf_symbolic& b) { return vf_sym_binop(a, "+", b); }
inline vf_symbolic operator-(const vf_symbolic& a, const vf_symbolic& b) { return vf_sym_binop(a, "-", b); }
inline vf_symbolic operator*(const vf_symbolic& a, const vf_symbolic& b) { return vf_sym_binop(a, "*", b); }
inline vf_symbolic operator/(const vf_symbolic& a, const vf_symbolic& b) { return vf_sym_binop(a, "/", b); }
inline vf_symbolic operator-(const vf_symbolic& value) {
    const std::string text = vkf_sym_render(value);
    if (text == "inf") return vf_make_symbolic("-inf");
    if (text == "-inf") return vf_make_symbolic("inf");
    return vkf_sym_binary(vkf_sym_integer(-1), "*", value);
}

inline vf_symbolic vf_sym_pow(const vf_symbolic& a, const vf_symbolic& b) { return vkf_sym_binary(a, "^", b); }
inline vf_symbolic vf_sym_relation(const vf_symbolic& a, const std::string& op, const vf_symbolic& b) { return vkf_sym_relation(a, op, b); }
inline vf_symbolic vf_sym_call_many(const std::string& name, const std::vector<vf_symbolic>& args) { return vkf_sym_call(name, args); }
inline vf_symbolic vf_sym_call(const std::string& name, const vf_symbolic& arg) { return vkf_sym_call(name, {arg}); }
inline vf_symbolic vf_sym_assume(vf_symbolic expr, const std::string& condition) { return vkf_sym_assume(std::move(expr), condition); }
inline vf_symbolic vf_sym_set_repr(const vf_symbolic& expr, const std::string& latex_text) { return vkf_sym_set_repr(expr, latex_text); }
inline std::string vf_sym_conditions(const vf_symbolic& expr) { return vkf_sym_conditions(expr); }
inline std::string vf_format_symbolic(const vf_symbolic& expr) { return vkf_sym_render(expr); }
inline std::string vf_sym_latex(const vf_symbolic& expr) { return vkf_sym_latex(expr); }

inline vf_symbolic vf_sym_expand(const vf_symbolic& value) { return value; }
inline vf_symbolic vf_sym_factor(const vf_symbolic& value) { return value; }
inline vf_symbolic vf_sym_cancel(vf_symbolic value) { value.conditions.push_back("denominator != 0"); return value; }
inline vf_symbolic vf_sym_complete_square(const vf_symbolic& value) { return value; }
inline vf_symbolic vf_sym_compute(const vf_symbolic& value) { return value; }
inline vf_symbolic vf_sym_collect(const vf_symbolic& value) { return value; }
inline vf_symbolic vf_sym_trig_expand(const vf_symbolic& value) { return value; }
inline vf_symbolic vf_sym_trig_compress(const vf_symbolic& value) { return value; }
inline bool vf_sym_same(const vf_symbolic& a, const vf_symbolic& b) { return vkf_sym_render(a) == vkf_sym_render(b); }

inline std::string vf_sym_trace(const vf_symbolic& value, const std::string& direction) {
    vf_symbolic moved = value;
    if (direction == "cancel") moved = vf_sym_cancel(value);
    else if (direction == "expand") moved = vf_sym_expand(value);
    else if (direction == "factor") moved = vf_sym_factor(value);
    else if (direction == "complete_square") moved = vf_sym_complete_square(value);
    std::string out = vkf_sym_render(value) + std::string(" --") + direction + std::string("--> ") + vkf_sym_render(moved);
    if (!moved.conditions.empty()) out += std::string(" when ") + moved.conditions.back();
    return out;
}

inline vf_symbolic vf_sym_solve_linear_diophantine2(const vf_symbolic& expr, const vf_symbolic& vars_sym) {
    std::vector<std::string> vars;
    std::string cur;
    for (char ch : vkf_sym_render(vars_sym)) {
        if (ch == ',') {
            if (!cur.empty()) vars.push_back(vkf_sym_compact(cur));
            cur.clear();
        } else {
            cur.push_back(ch);
        }
    }
    if (!cur.empty()) vars.push_back(vkf_sym_compact(cur));
    if (vars.size() != 2) return vkf_sym_call("solve", {expr, vars_sym});
    const auto x = vkf_sym_symbol(vars[0], vkf_sym_domain_integer());
    const auto y = vkf_sym_symbol(vars[1], vkf_sym_domain_integer());
    const auto solved = vkf_sym_solve_linear_diophantine2(expr, x, y);
    if (!solved.solved && vkf_sym_render(solved.x).find("solve(") == 0) return vkf_sym_call("solve", {expr, vars_sym});
    return vf_make_symbolic(vars[0] + std::string(" = ") + vkf_sym_render(solved.x) + std::string(", ") + vars[1] + std::string(" = ") + vkf_sym_render(solved.y) + std::string(", k integer"));
}

inline std::vector<vf_symbolic> vf_sym_solve_linear_diophantine2_fields(const vf_symbolic& expr, const vf_symbolic& x, const vf_symbolic& y) {
    const auto ix = vkf_sym_symbol(vkf_sym_render(x), vkf_sym_domain_integer());
    const auto iy = vkf_sym_symbol(vkf_sym_render(y), vkf_sym_domain_integer());
    const auto solved = vkf_sym_solve_linear_diophantine2(expr, ix, iy);
    return {solved.x, solved.y};
}

inline vf_symbolic vf_sym_solve(const vf_symbolic& expr, const vf_symbolic& var) {
    if (vkf_sym_render(var).find(',') != std::string::npos) return vf_sym_solve_linear_diophantine2(expr, var);
    return vkf_sym_call("solve", {expr, var});
}

inline vf_symbolic vf_sym_dsolve(const vf_symbolic& expr, const vf_symbolic& fn) { return vkf_sym_call("dsolve", {expr, fn}); }

inline vf_symbolic vf_sym_shift(const vf_symbolic& expr, const vf_symbolic& var, const vf_symbolic& step) {
    if (vkf_sym_render(expr) == vkf_sym_render(var)) return vkf_sym_binary(var, "+", step);
    if (expr.node->kind == VkfSymbolicNodeKind::IntegerLiteral) return expr;
    return vkf_sym_call("shift", {expr, var, step});
}

inline vf_symbolic vf_sym_difference(const vf_symbolic& expr, const vf_symbolic& var) {
    if (vkf_sym_render(expr) == vkf_sym_render(var)) return vkf_sym_integer(1);
    if (expr.node->kind == VkfSymbolicNodeKind::IntegerLiteral) return vkf_sym_integer(0);
    return vkf_sym_binary(vf_sym_shift(expr, var, vkf_sym_integer(1)), "-", expr);
}

inline vf_symbolic vf_sym_summation(const vf_symbolic& expr, const vf_symbolic& var) {
    if (vkf_sym_render(expr) == "1") return var;
    if (vkf_sym_render(expr) == vkf_sym_render(var)) return vf_make_symbolic(vkf_sym_render(var) + std::string(" * (") + vkf_sym_render(var) + std::string(" + 1) / 2"));
    if (expr.node->kind == VkfSymbolicNodeKind::IntegerLiteral) return vkf_sym_binary(expr, "*", var);
    return vkf_sym_call("summation", {expr, var});
}

inline vf_symbolic vf_sym_range_aggregate(const std::string& name, const vf_symbolic& expr, const vf_symbolic& var, const vf_symbolic& start, const vf_symbolic& end) {
    return vkf_sym_call(name, {expr, var, start, end});
}

inline vf_symbolic vf_sym_sum(const vf_symbolic& expr, const vf_symbolic& var, const vf_symbolic& start, const vf_symbolic& end) {
    if (vkf_sym_render(end) == "inf" || vkf_sym_render(end) == "-inf") return vf_sym_range_aggregate("sum", expr, var, start, end);
    if (vkf_sym_render(start) == "1" && vkf_sym_render(expr) == "1") return end;
    if (vkf_sym_render(start) == "1" && vkf_sym_render(expr) == vkf_sym_render(var)) return vf_make_symbolic(vkf_sym_render(end) + std::string(" * (") + vkf_sym_render(end) + std::string(" + 1) / 2"));
    return vf_sym_range_aggregate("sum", expr, var, start, end);
}

inline vf_symbolic vf_sym_mean(const vf_symbolic& expr, const vf_symbolic& var, const vf_symbolic& start, const vf_symbolic& end) { return vf_sym_range_aggregate("mean", expr, var, start, end); }
inline vf_symbolic vf_sym_median(const vf_symbolic& expr, const vf_symbolic& var, const vf_symbolic& start, const vf_symbolic& end) { return vf_sym_range_aggregate("median", expr, var, start, end); }
inline vf_symbolic vf_sym_derivative(const vf_symbolic& expr, const vf_symbolic& var) {
    if (vkf_sym_render(expr) == vkf_sym_render(var)) return vkf_sym_integer(1);
    if (expr.node->kind == VkfSymbolicNodeKind::IntegerLiteral) return vkf_sym_integer(0);
    return vkf_sym_call("derivative", {expr, var});
}
inline vf_symbolic vf_sym_derivative_n(const vf_symbolic& expr, const vf_symbolic& var, const vf_symbolic& order) {
    if (vkf_sym_render(order) == "1") return vf_sym_derivative(expr, var);
    return vkf_sym_call("derivative", {expr, var, order});
}
inline vf_symbolic vf_sym_gradient(const vf_symbolic& expr, const vf_symbolic& var) { return vkf_sym_call("gradient", {expr, var}); }
inline vf_symbolic vf_sym_integral(const vf_symbolic& expr, const vf_symbolic& var) {
    if (vkf_sym_render(expr) == vkf_sym_render(var)) {
        return vkf_sym_binary(vkf_sym_binary(var, "^", vkf_sym_integer(2)), "/", vkf_sym_integer(2));
    }
    if (expr.node->kind == VkfSymbolicNodeKind::IntegerLiteral) return vkf_sym_binary(expr, "*", var);
    return vkf_sym_call("integrate", {expr, var});
}
inline vf_symbolic vf_sym_integral(const vf_symbolic& expr, const vf_symbolic& var, const vf_symbolic& start, const vf_symbolic& end) { return vf_sym_range_aggregate("integrate", expr, var, start, end); }

inline std::string vkf_sym_compact(std::string text) {
    std::string out;
    for (char ch : text) {
        if (!std::isspace(static_cast<unsigned char>(ch))) out.push_back(ch);
    }
    return out;
}

inline std::string vkf_sym_strip_outer_parens(std::string text) {
    text = vkf_sym_compact(std::move(text));
    bool changed = true;
    while (changed && text.size() >= 2 && text.front() == '(' && text.back() == ')') {
        changed = false;
        int depth = 0;
        bool wraps = true;
        for (std::size_t i = 0; i < text.size(); ++i) {
            if (text[i] == '(') ++depth;
            else if (text[i] == ')') --depth;
            if (depth == 0 && i + 1 < text.size()) {
                wraps = false;
                break;
            }
        }
        if (wraps) {
            text = text.substr(1, text.size() - 2);
            changed = true;
        }
    }
    return text;
}

inline bool vkf_sym_is_integer_text(const std::string& text) {
    if (text.empty()) return false;
    std::size_t i = text[0] == '-' ? 1 : 0;
    if (i == text.size()) return false;
    for (; i < text.size(); ++i) {
        if (text[i] < '0' || text[i] > '9') return false;
    }
    return true;
}

struct VkfSymLinear2 {
    long long a = 0;
    long long b = 0;
    long long c = 0;
    bool ok = true;
};

inline bool vkf_sym_parse_ll(const std::string& text, long long& out) {
    if (!vkf_sym_is_integer_text(text)) return false;
    char* end = nullptr;
    out = std::strtoll(text.c_str(), &end, 10);
    return end != nullptr && *end == '\0';
}

inline VkfSymLinear2 vkf_sym_parse_linear_side(const std::string& side, const std::string& x, const std::string& y) {
    VkfSymLinear2 out;
    const std::string s = vkf_sym_strip_outer_parens(side);
    std::size_t i = 0;
    while (i < s.size()) {
        int sign = 1;
        if (s[i] == '+') ++i;
        else if (s[i] == '-') { sign = -1; ++i; }
        const std::size_t start = i;
        int depth = 0;
        while (i < s.size()) {
            if (s[i] == '(') ++depth;
            else if (s[i] == ')') --depth;
            else if (depth == 0 && (s[i] == '+' || s[i] == '-')) break;
            ++i;
        }
        const std::string term = vkf_sym_strip_outer_parens(s.substr(start, i - start));
        if (term.empty()) continue;
        long long coeff = 0;
        if (term == x) out.a += sign;
        else if (term == y) out.b += sign;
        else if (term.size() > x.size() + 1 && term.compare(term.size() - x.size(), x.size(), x) == 0 && term[term.size() - x.size() - 1] == '*') {
            if (!vkf_sym_parse_ll(term.substr(0, term.size() - x.size() - 1), coeff)) { out.ok = false; return out; }
            out.a += sign * coeff;
        }
        else if (term.size() > y.size() + 1 && term.compare(term.size() - y.size(), y.size(), y) == 0 && term[term.size() - y.size() - 1] == '*') {
            if (!vkf_sym_parse_ll(term.substr(0, term.size() - y.size() - 1), coeff)) { out.ok = false; return out; }
            out.b += sign * coeff;
        }
        else {
            if (!vkf_sym_parse_ll(term, coeff)) { out.ok = false; return out; }
            out.c += sign * coeff;
        }
    }
    return out;
}

inline bool vkf_sym_parse_linear_relation2(const VkfSymbolicExpr& relation, const std::string& x, const std::string& y, long long& a, long long& b, long long& c) {
    const std::string text = vkf_sym_render(relation);
    const std::size_t pos = text.find('=');
    if (pos == std::string::npos || text.find("!=") != std::string::npos || text.find('&') != std::string::npos) return false;
    const VkfSymLinear2 left = vkf_sym_parse_linear_side(text.substr(0, pos), x, y);
    const VkfSymLinear2 right = vkf_sym_parse_linear_side(text.substr(pos + 1), x, y);
    if (!left.ok || !right.ok) return false;
    a = left.a - right.a;
    b = left.b - right.b;
    c = right.c - left.c;
    return true;
}

inline long long vkf_sym_ext_gcd(long long a, long long b, long long& x, long long& y) {
    if (b == 0) { x = (a < 0 ? -1 : 1); y = 0; return a < 0 ? -a : a; }
    long long x1 = 0;
    long long y1 = 0;
    const long long g = vkf_sym_ext_gcd(b, a % b, x1, y1);
    x = y1;
    y = x1 - (a / b) * y1;
    return g;
}

inline std::string vkf_sym_signed_term(long long coeff, const std::string& name) {
    if (coeff == 0) return "";
    const std::string sign = coeff > 0 ? " + " : " - ";
    const long long mag = coeff > 0 ? coeff : -coeff;
    return sign + (mag == 1 ? name : std::to_string(mag) + std::string("*") + name);
}

inline std::string vkf_sym_affine(long long base, long long step, const std::string& param) {
    return std::to_string(base) + vkf_sym_signed_term(step, param);
}

inline VkfSymbolicSolve2 vkf_sym_solve_linear_diophantine2(const VkfSymbolicExpr& relation, const VkfSymbolicExpr& x, const VkfSymbolicExpr& y) {
    if (!vkf_sym_domain_is_integer(x.node->domain) || !vkf_sym_domain_is_integer(y.node->domain)) {
        return {vkf_sym_call("solve", {relation, x}), vkf_sym_call("solve", {relation, y}), false};
    }
    long long a = 0;
    long long b = 0;
    long long c = 0;
    if (!vkf_sym_parse_linear_relation2(relation, vkf_sym_render(x), vkf_sym_render(y), a, b, c)) {
        return {vkf_sym_call("solve", {relation, x}), vkf_sym_call("solve", {relation, y}), false};
    }
    if (a == 0 && b == 0) {
        const auto out = vkf_sym_symbol(c == 0 ? "any integer" : "no integer solution");
        return {out, out, c == 0};
    }
    long long s = 0;
    long long t = 0;
    const long long g = vkf_sym_ext_gcd(a, b, s, t);
    if (c % g != 0) {
        const auto out = vkf_sym_symbol("no integer solution");
        return {out, out, false};
    }
    const long long scale = c / g;
    const long long x0 = s * scale;
    const long long y0 = t * scale;
    const long long x_step = b / g;
    const long long y_step = -a / g;
    return {
        vkf_sym_symbol(vkf_sym_affine(x0, x_step, "k")),
        vkf_sym_symbol(vkf_sym_affine(y0, y_step, "k")),
        true,
    };
}
