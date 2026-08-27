# One warmed-process Symbolics.jl sample for a pinned SymEngine benchmark kernel.

using Symbolics

function measured(operation)
    GC.gc()
    GC.enable(false)
    started = time_ns()
    result = operation()
    elapsed_ms = (time_ns() - started) / 1_000_000
    GC.enable(true)
    return elapsed_ms, result
end

function term_count(expression)
    unwrapped = Symbolics.unwrap(expression)
    Symbolics.SymbolicUtils.operation(unwrapped) == (+) || return 1
    return length(Symbolics.SymbolicUtils.arguments(unwrapped))
end

function expand1()
    @variables x y z w
    expand((x + y + z + w)^3)
    expression = (x + y + z + w)^60
    elapsed_ms, result = measured(() -> expand(expression))
    return elapsed_ms, term_count(result)
end

function expand2()
    @variables x y z w
    warm = (x + y + z + w)^3
    expand(warm * (warm + w))
    e = (x + y + z + w)^15
    expression = e * (e + w)
    elapsed_ms, result = measured(() -> expand(expression))
    return elapsed_ms, term_count(result)
end

function add1()
    @variables x

    function operation(term_limit)
        accumulator = x
        coefficient = 1
        for exponent in 0:term_limit - 1
            accumulator += coefficient * x^exponent
            coefficient = -coefficient
        end
        return accumulator
    end

    operation(8)
    elapsed_ms, result = measured(() -> operation(3000))
    # Match SymEngine Add.get_dict(): its separately stored constant is excluded.
    return elapsed_ms, term_count(result) - 1
end

function series1()
    @variables x
    warm_polynomial = series(collect(0:7), x)
    polynomial_coeffs(warm_polynomial * warm_polynomial, [x])
    polynomial = series(collect(0:999), x)

    function operation()
        coefficients, _ = polynomial_coeffs(polynomial * polynomial, [x])
        return Symbolics.unwrap_const(coefficients[Symbolics.unwrap(x^999)])
    end

    return measured(operation)
end

const KERNELS = Dict(
    "expand1" => expand1,
    "expand2" => expand2,
    "add1" => add1,
    "series" => series1,
)

function main()
    length(ARGS) == 1 && haskey(KERNELS, ARGS[1]) ||
        error("usage: symbolics_runner.jl expand1|expand2|add1|series")
    elapsed_ms, output = KERNELS[ARGS[1]]()
    println("julia=", VERSION)
    println("symbolics=", pkgversion(Symbolics))
    println("elapsed_ms=", elapsed_ms)
    println("output=", output)
end

main()
