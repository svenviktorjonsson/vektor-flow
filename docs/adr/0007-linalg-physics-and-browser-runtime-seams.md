# ADR 0007: Linear Algebra Owns Solvers And Physics Owns Simulation Truth

Date: 2026-08-25

## Status

Accepted.

## Context

Physics currently contains repeated vector and matrix helpers, while symbolic
equation systems contain another elimination implementation. Platonic Play also
needs one authoritative physics engine rather than a browser implementation
that can drift from native VKF. Numeric and symbolic matrices need the same
mathematical interface without making approximate arithmetic look exact or
creating a dependency cycle between linear algebra and high-level solving.

## Decision

The `.linalg` stdlib is a deep module over ordinary rectangular nested vectors.
It owns:

- `dot`, `cross`, `outer`, and `matmul`;
- `transpose`, `adjoint`, `diag`, `trace`, `determinant`, `rank`,
  `condition_number`, and `inverse`;
- `solve`, `least_squares`, `solution_space`, `rref`, and `null_space`;
- reusable LU, QR, Cholesky, SVD, and eigen factorizations;
- residual and verification operations.

The same operation names accept numeric or symbolic scalar leaves. Numeric
algorithms use pivoting, documented tolerances, and condition diagnostics.
Symbolic algorithms use exact zero proofs, assumptions, simplification, and
conditional results. An exact operation never silently crosses to sampled or
tolerance-based arithmetic.

The scalar algebra seam is internal. Its numeric and symbolic adapters are the
two concrete adapters. `.linalg` does not depend on the high-level symbolic
strategy planner. `.symbolic` may consume `.linalg` through its exact adapter,
and `.physics` depends on `.linalg` for vector, matrix, tensor, and solver work.

Platonic Play supplies editable topology records (stable vertices, edges,
faces, and arcs), authored geometry and material properties, input, and
rendering. VKF owns simulation state, units, constraint and boundary relations,
derived collision geometry, fields, integration, diagnostics, and
verification. When authored topology changes, VKF updates its collision
geometry immediately. Circular arcs and circles remain analytic physics
geometry; tessellation is render-only. Topology edits must not create hidden
overlapping faces: a bounded subset is represented as a separate bounded face.

Browser output consists of CPU logic compiled to WASM, GPU kernels compiled to
WGSL, and a manifest describing exports, typed buffers, resources, events, and
shader bindings. The browser host is a thin adapter for DOM, input, WebGPU, and
artifact loading. Physics state crosses this seam through dense typed buffers,
not per-particle JavaScript objects.

The first cross-runtime physics verification set is deliberately analytic:

- a dropped ball checks impact time and restitution-derived bounce height;
- a sliding block checks friction-derived stopping distance and time;
- a polygon against a moving wall checks live collision-geometry updates;
- circle/polygon and circle/arc contacts check normals, impulses, and inertia;
- an electron gun checks field trajectories, charge repulsion, and SI units;
- every fixture compares native and WASM state/output within documented
  tolerances.

The runtime contract includes deterministic reset to authored state, fixed-step
integration, snapshot/restore, explicit open/absorbing and plate boundaries,
and diagnostics for invalid domains, singular systems, failed contacts, and
solver verification. Bodies are not clamped to an implicit screen: crossing an
open world boundary removes them from that world. Boundary contact may stop
tangential motion only through the declared contact/friction model.

## Consequences

- Physics and symbolic code stop maintaining separate matrix implementations.
- `solve(A, b)` means a unique square solve; rectangular fitting is explicit
  `least_squares`, while empty or affine families use `solution_space`.
- SVD exposes `(u, s, vh)` so the interface remains correct for complex values.
- Platonic Play can replace its temporary physics implementation without
  changing authored topology or renderer logic.
- Deterministic reset, fixed-step integration, snapshot/restore, native/WASM
  parity, and verified solver diagnostics are part of the physics interface.
- Collision and field fixtures verify analytic outcomes and native/WASM parity;
  renderer screenshots do not certify physics behavior.
