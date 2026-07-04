from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.physics import PhysicsGeometry
from vektorflow.stdlib import resolve_stdlib


def _run(src: str) -> list[str]:
    mod = parse_module(src, filename="<physics-stdlib-test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return [line for line in buf.getvalue().splitlines() if line.strip()]


def test_resolve_stdlib_physics_exposes_core_namespace() -> None:
    ns = resolve_stdlib("physics")

    assert ns["PhysicsGeometry"] is PhysicsGeometry
    assert ns["length"](((0.0, 0.0), (3.0, 4.0)), (0, 1)) == 5.0
    assert ns["stiffness_value"]("rigid") == float("inf")


def test_physics_namespace_import_works_in_vkf() -> None:
    assert _run(
        """
physics: .physics
:: physics.length(((0, 0), (3, 4)), (0, 1))
"""
    ) == ["5"]


def test_physics_spill_import_works_in_vkf() -> None:
    assert _run(
        """
:.physics
g: geometry(((0, 0), (3, 4)), edges: ((0, 1),))
:: g.L(0)
"""
    ) == ["5"]
