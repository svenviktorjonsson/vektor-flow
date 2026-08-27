# ADR 0006: Native Symbolic Problems Use First-Class Constraints

Date: 2026-08-25

## Status

Accepted.

## Context

Symbolic solving spans algebraic equations, integer domains, recurrences,
limits, transforms, ODEs, and PDEs. Treating each feature as an unrelated
function would duplicate classification and make boundary and verification
semantics inconsistent. Host-language solver stubs would also violate the
native release requirement.

Conditions must describe mathematics directly. Point values, derivative
values, and geometric boundaries are not positional solver options. They are
relations that belong to the problem and must be checked against the result.

## Decision

The symbolic stdlib owns one native VKF problem model:

- expressions are compact owned DAGs;
- `left = right` creates a symbolic relation; the lowered implementation may
  use an internal relation constructor, but public VKF source does not;
- `premise => conclusion` creates a symbolic proposition after both relation
  operands have parsed; the same token remains a context-specific match-arm
  separator after `??`;
- `derivative` and `partial` create unevaluated differential expressions;
- `at` creates point or coordinate evaluation expressions;
- `where(value_constraint, domain_constraint)` binds a PDE boundary value to
  its geometric domain;
- solvers receive governing relations, ordered unknowns, and condition vectors;
- the strategy planner classifies the complete problem before selecting an
  algebraic, transform, recurrence, ODE, or PDE strategy;
- every candidate is filtered through its declared domain;
- solution verification checks original residuals and conditions after strategy
  execution. A constructor does not certify its own output.
- consistent rank-deficient linear systems produce affine solution families:
  one particular point plus a basis for the null space. Verification checks
  both `A p = b` and every homogeneous direction `A v = 0`.

Expression-preserving Laplace and Z transforms share this model. Sampled
Fourier and wavelet transforms operate directly on VKF numeric vectors.
They remain overloads in `.symbolic`: analytical transforms participate in the
same strategy planner and residual verifier, so a separate public `.transforms`
module would either duplicate that machinery or introduce a dependency cycle.

All solver and transform algorithms are VKF stdlib code. Compiler lowering may
preserve symbol domains and compact DAG operations, but C++, Python, JavaScript,
and assembly do not implement native-release symbolic strategies. The strict
frontend includes only symbolic domain/type metadata; it does not include the
legacy host symbolic compatibility engine.

Compact source syntax such as derivative primes or infix `where` may be added as
parser sugar. It must lower to these same relations and constraints; it must not
create a parallel representation. Equality remains type-directed: ordinary
values compare to a bit and symbolic operands construct relations.

Opaque aggregate results use flat owned vector encodings with accessors. This
avoids records that own runtime vectors until the direct backend's aggregate
ownership model is proven safe.

## Consequences

- ODE initial conditions and two-point boundary conditions use the same relation
  model as algebraic constraints.
- PDE boundaries can express implicit domains such as circles and surfaces.
- Strategy selection and verification can be extended independently of source
  sugar.
- Unsupported classifications fail explicitly instead of silently sampling or
  returning an unverified expression.
- Native and WASM releases must run the same VKF symbolic source and conformance
  tests.
