from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib.physics import Quantity


def _run(src: str) -> list[str]:
    mod = parse_module(src, filename="<physics-stdlib-test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return [line for line in buf.getvalue().splitlines() if line.strip()]


def test_resolve_stdlib_physics_exposes_dimension_basis_and_units() -> None:
    ns = resolve_stdlib("physics")

    assert ns["dimensions"].L.dimension == (1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    assert ns["dimensions"].T.dimension == (0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    assert ns["dimensions"].M.dimension == (0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0)
    assert ns["dimensions"].K.symbol == "K"
    assert ns["dimensions"].A.symbol == "A"
    assert ns["dimensions"].Cd.symbol == "Cd"
    assert ns["dimensions"].Mole.symbol == "Mole"
    assert ns["km"].value == 1000
    assert ns["cm"].value == 0.01
    assert ns["mm"].value == 0.001
    assert ns["um"].value == 0.000001
    assert ns["sec"] is ns["s"]
    assert ns["second"] is ns["s"]
    assert ns["seconds"] is ns["s"]
    assert ns["min"].value == 60
    assert ns["minutes"].value == 60
    assert ns["h"].value == 3600
    assert ns["d"].value == 86400
    assert ns["month"].value == 2629800
    assert ns["months"].value == 2629800
    assert ns["y"].value == 31557600


def test_quantity_arithmetic_enforces_matching_dimensions() -> None:
    ns = resolve_stdlib("physics")

    length = 3 * ns["km"] + 200 * ns["m"]
    speed = length / (100 * ns["s"])
    area = ns["m"] * ns["m"]

    assert isinstance(length, Quantity)
    assert length.value == 3200
    assert length.dimension == ns["m"].dimension
    assert speed.dimension == (1.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    assert area.dimension == (2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    with pytest.raises(ValueError, match="cannot add"):
        ns["m"] + ns["s"]
    with pytest.raises(ValueError, match="cannot compare"):
        ns["m"] < ns["s"]
    with pytest.raises(ValueError, match="cannot equate"):
        ns["m"] == ns["s"]


def test_physics_units_work_from_vkf() -> None:
    assert _run(
        """
physics: .physics
d: physics.dimensions
s: d.L
t: d.T
x: 3 * physics.km
y: 200 * physics.m
speed: (x + y) / (100 * physics.s)
:: s.symbol
:: t.symbol
:: (x + y).value
:: speed.dimension_label
"""
    ) == ["L", "T", "3200", "L T^-1"]


def test_physics_spill_import_units_work_from_vkf() -> None:
    assert _run(
        """
:.physics
x: 4 * cm + 2 * mm
:: x.value
:: (m * m).dimension_label
"""
    ) == ["0.042", "L^2"]


def test_vkf_rejects_dimension_mismatched_addition_and_comparison() -> None:
    with pytest.raises(ValueError, match="cannot add"):
        _run(
            """
:.physics
:: m + s
"""
        )
    with pytest.raises(ValueError, match="cannot compare"):
        _run(
            """
:.physics
:: m < s
"""
        )


def test_math_stdlib_requires_unitless_quantities() -> None:
    assert _run(
        """
physics: .physics
math: .math
:: math.sin(physics.unitless(0))
"""
    ) == ["0"]
    with pytest.raises(ValueError, match="unitless"):
        _run(
            """
physics: .physics
math: .math
:: math.sin(physics.m)
"""
        )
