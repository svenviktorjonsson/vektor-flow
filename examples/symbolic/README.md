# Symbolic Examples

These examples show the built-in symbolic system. They are part of the native
compiled track: the examples compile to C++ and run as native executables.

- `01_domains_and_types.vkf` - symbolic domains as types: `R`, `N`, `Z`, `Q`, `C`, functions, and vector powers.
- `02_latex_display_names.vkf` - variable display metadata with `.repr` and AST-built LaTeX.
- `03_calculus_and_sums.vkf` - differential notation, integrals, and symbolic range sums.
- `04_relations_and_integer_solve.vkf` - relations and two-variable integer solutions.
- `05_symbolic_status.vkf` - structured status records for equivalence and transform search.

Use `:.symbolic` before using symbolic domain names directly.

## Domains

Symbolic variables are declared through the type system:

```vkf
x: R
n: N
m: Z
q: Q
z: C
f: R -> R
v: [R:n]
```

The domains are compile-time facts carried by the symbolic expression. They are
not ordinary global names unless `:.symbolic` has been imported.

## Representation

The symbolic engine keeps expression representation explicit. Equivalent forms
are not silently rewritten just because they mean the same thing. For example,
`x + 1` and `1 + x` may be equivalent, but they are different representations
until an operation moves between them.

Use `.repr` to control display names without changing the underlying symbol:

```vkf
phi: R
phi.repr: "\\phi"

:: latex(phi)
```

LaTeX is built from the symbolic AST. Range integrals, sums, derivatives, and
multi-letter function names render with mathematical notation.

## Operations And Status

Calculus and algebra operations are expressions too:

```vkf
:: d/dx x^2
:: integrate(x, x, 0, 1)
:: path_status(x, x)
:: transform_path_status(integrate(x, x))
```

`path_status` and `transform_path_status` return record-shaped symbolic values.
The fields are intended as the stable interface for tracing, diagnostics, and
future animation:

- `found`
- `capped`
- `steps`
- `expanded`
- `reached`
- `score`
- `residual_before`
- `residual_after`
- `max_steps`
- `beam`
- `reason`

This keeps the diagnostic interface small while the implementation can deepen
behind it from simple native moves to a fuller equivalence graph.
