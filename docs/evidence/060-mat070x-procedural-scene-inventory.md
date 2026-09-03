# MAT070X procedural scene integration inventory

Date: 2026-09-03

## Scope

This private acceptance harness audits one deterministic stone, road, and forest
fixture without selecting VKF author syntax or changing renderer contracts. It
uses the existing material-lane packets as they are rather than pretending that
their geometry and material bindings are interchangeable.

Owned paths:

- `native/material/vf_procedural_scene_integration_inventory.hpp`
- `native/material/vf_procedural_scene_integration_inventory_test.cpp`
- `docs/evidence/060-mat070x-procedural-scene-inventory.md`

## Deterministic inventory

| Content | Geometry bytes | Material bytes | Integration gate |
| --- | ---: | ---: | --- |
| Stone | 464 | 106 | ready |
| Road | 72 | 120 | needs material binding |
| Forest | 0 | 592 | needs geometry |

The complete fixture is 1,354 resident bytes. The allocation-free report is
224 bytes and has version `9896093521623019658`. Reversing forest demand order
produces the identical report. Invalid triangle indices are rejected before a
packet can be reported ready.

Stone is ready for the established ten-float triangle vertex layout and its
material sidecar. Road already has valid coarse triangles and deterministic
detail records, but no private contract binds those spatial records to draw
surface evaluation. Forest has deterministic population, wood, bark, and
foliage records but no draw geometry in its combined packet.

## Executable evidence

The focused stone, road, forest, and inventory chain passed 4/4 under strict
Clang diagnostics. The complete native material suite passed 57/57 with:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.
```

Three descriptive 25-sample runs, each auditing the fixed scene 1,000 times,
reported medians of 3,336.1, 2,834.5, and 3,350.9 microseconds. Timing is
evidence only and is not an acceptance assertion.

## Remaining boundary

The smallest next implementation packet is a private road material-to-surface
binding plus forest draw-geometry adapter into the native material consumer.
That packet touches renderer integration and must be coordinated with the
renderer owner. Selecting generator constructors or distribution controls is a
separate public language decision and is not part of this harness.
