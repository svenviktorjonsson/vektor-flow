"""One fresh-process SymPy sample for a pinned SymEngine benchmark kernel."""

from __future__ import annotations

import gc
import sys
from time import perf_counter_ns

import sympy
from sympy import Add, expand, symbols
from sympy.polys.domains import ZZ
from sympy.polys.ring_series import rs_mul
from sympy.polys.rings import ring


def measured(operation):
    gc.collect()
    gc.disable()
    started = perf_counter_ns()
    result = operation()
    elapsed_ms = (perf_counter_ns() - started) / 1_000_000
    gc.enable()
    return elapsed_ms, result


def expand1():
    x, y, z, w = symbols("x y z w")
    expression = (x + y + z + w) ** 60
    elapsed, result = measured(lambda: expand(expression))
    return elapsed, len(Add.make_args(result))


def expand2():
    x, y, z, w = symbols("x y z w")
    e = (x + y + z + w) ** 15
    expression = e * (e + w)
    elapsed, result = measured(lambda: expand(expression))
    return elapsed, len(Add.make_args(result))


def add1():
    polynomial_ring, x = ring("x", ZZ)

    def operation():
        accumulator = x
        coefficient = polynomial_ring.one
        for exponent in range(3000):
            accumulator += coefficient * x**exponent
            coefficient = -coefficient
        return accumulator

    elapsed, result = measured(operation)
    # Match SymEngine Add.get_dict(): its separately stored constant is excluded.
    return elapsed, len(result) - 1


def series():
    polynomial_ring, x = ring("x", ZZ)
    coefficients = polynomial_ring.from_dict({(index,): index for index in range(1000)})
    elapsed, result = measured(lambda: rs_mul(coefficients, coefficients, x, 1000))
    return elapsed, int(result[(999,)])


KERNELS = {
    "expand1": expand1,
    "expand2": expand2,
    "add1": add1,
    "series": series,
}


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in KERNELS:
        print("usage: sympy_runner.py expand1|expand2|add1|series", file=sys.stderr)
        return 2
    elapsed_ms, output = KERNELS[sys.argv[1]]()
    print(f"sympy={sympy.__version__}")
    print(f"elapsed_ms={elapsed_ms:.9f}")
    print(f"output={output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
