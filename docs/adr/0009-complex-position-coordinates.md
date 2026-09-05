# ADR 0009: Complex Position Coordinates Map To X And Y

Date: 2026-09-05

## Status

Accepted by Viktor Jonsson.

## Decision

`p_<axes>` with complex scalar leaves is a 2D position field. Each value's real
part is `x`; its imaginary part is `y`. The axes determine rank and topology.
This form infers two dimensions and never introduces `z`.

An explicit final `c` remains the component-vector form. For example, `p_tc`
is a time sequence of real position-component vectors, while complex `p_t` is a
time sequence of 2D positions.

This refines ADR 0008 wherever its unqualified `p_t` wording could be read as a
component vector without `c`.

## Verification

Compiler tests must prove exact real-to-x and imaginary-to-y mapping, preserved
axis order, inferred dimension `2`, continuous topology for `u`, and no public
`z` channel.
