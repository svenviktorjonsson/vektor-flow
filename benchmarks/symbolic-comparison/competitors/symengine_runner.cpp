// Exact operation shapes from SymEngine benchmarks at
// 0c183629a35dd9d8123fafcc47b0e0283bbae80d. Timing resolution and output
// validation are added here; the symbolic operations themselves are unchanged.

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#include <symengine/add.h>
#include <symengine/basic.h>
#include <symengine/dict.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/pow.h>
#include <symengine/series_generic.h>
#include <symengine/symbol.h>

using Clock = std::chrono::steady_clock;

template <typename Operation>
double elapsed_ms(Operation operation)
{
    const auto started = Clock::now();
    operation();
    return std::chrono::duration<double, std::milli>(Clock::now() - started).count();
}

int expand1()
{
    using namespace SymEngine;
    const auto x = symbol("x");
    const auto y = symbol("y");
    const auto z = symbol("z");
    const auto w = symbol("w");
    const auto expression = pow(add(add(add(x, y), z), w), integer(60));
    RCP<const Basic> result;
    const auto duration = elapsed_ms([&] { result = expand(expression); });
    if (!is_a<Add>(*result)) return 3;
    std::cout << "elapsed_ms=" << duration << '\n'
              << "output=" << rcp_static_cast<const Add>(result)->get_dict().size() << '\n';
    return 0;
}

int expand2()
{
    using namespace SymEngine;
    const auto x = symbol("x");
    const auto y = symbol("y");
    const auto z = symbol("z");
    const auto w = symbol("w");
    const auto e = pow(add(add(add(x, y), z), w), integer(15));
    const auto expression = mul(e, add(e, w));
    RCP<const Basic> result;
    const auto duration = elapsed_ms([&] { result = expand(expression); });
    if (!is_a<Add>(*result)) return 3;
    std::cout << "elapsed_ms=" << duration << '\n'
              << "output=" << rcp_static_cast<const Add>(result)->get_dict().size() << '\n';
    return 0;
}

int add1()
{
    using namespace SymEngine;
    const auto x = symbol("x");
    RCP<const Basic> accumulator = x;
    RCP<const Basic> coefficient = integer(1);
    const auto duration = elapsed_ms([&] {
        for (int exponent = 0; exponent < 3000; ++exponent) {
            accumulator = add(accumulator,
                              mul(coefficient, pow(x, integer(exponent))));
            coefficient = mul(coefficient, integer(-1));
        }
    });
    if (!is_a<Add>(*accumulator)) return 3;
    std::cout << "elapsed_ms=" << duration << '\n'
              << "output=" << rcp_static_cast<const Add>(accumulator)->get_dict().size() << '\n';
    return 0;
}

int series()
{
    using namespace SymEngine;
    const auto x = symbol("x");
    std::vector<Expression> coefficients;
    coefficients.reserve(1000);
    for (int index = 0; index < 1000; ++index) coefficients.emplace_back(index);
    const UExprDict polynomial(UExprPoly::from_vec(x, coefficients)->get_dict());
    UExprDict product;
    const auto duration = elapsed_ms([&] {
        product = UnivariateSeries::mul(polynomial, polynomial, 1000);
    });
    const auto coefficient = product.find_cf(999);
    std::cout << "elapsed_ms=" << duration << '\n'
              << "output=" << coefficient << '\n';
    return 0;
}

int main(int argc, char** argv)
{
    if (argc != 2) {
        std::cerr << "usage: symengine_runner expand1|expand2|add1|series\n";
        return 2;
    }
    const std::string kernel(argv[1]);
    if (kernel == "expand1") return expand1();
    if (kernel == "expand2") return expand2();
    if (kernel == "add1") return add1();
    if (kernel == "series") return series();
    std::cerr << "unknown kernel: " << kernel << '\n';
    return 2;
}
